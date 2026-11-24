import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  auditLogsTable,
  deliveriesTable,
  donorInventoryTable,
  notificationsTable,
  orderEventsTable,
  ordersTable,
  requireDb,
  sponsorshipsTable,
  usersTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody, responseDate } from "./shared";
import fulfilmentRouter from "./fulfilment";

const router = Router();
const mutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many changes. Try again later." }),
});

async function requireApprovedVerification(userId: string) {
  const [approved] = await requireDb()
    .select({ id: verificationRecordsTable.id })
    .from(verificationRecordsTable)
    .where(
      and(
        eq(verificationRecordsTable.userId, userId),
        eq(verificationRecordsTable.status, "VERIFIED"),
      ),
    )
    .limit(1);
  if (!approved) {
    throw new HttpError(403, "Complete account verification before offering goods.");
  }
}

router.get(
  "/sponsorships",
  requireAuth,
  requireRole("DONOR", "TEACHER"),
  async (request, response) => {
    const base = requireDb()
      .select({
        id: sponsorshipsTable.id,
        requestId: sponsorshipsTable.requestId,
        requestTitle: assistanceRequestsTable.title,
        inventoryTitle: donorInventoryTable.title,
        donorName: usersTable.name,
        donorMessage: sponsorshipsTable.donorMessage,
        acceptedQuantity: sponsorshipsTable.acceptedQuantity,
        inventoryId: sponsorshipsTable.inventoryId,
        donorUserId: sponsorshipsTable.donorUserId,
        teacherUserId: assistanceRequestsTable.teacherUserId,
        quantity: sponsorshipsTable.quantity,
        status: sponsorshipsTable.status,
        createdAt: sponsorshipsTable.createdAt,
      })
      .from(sponsorshipsTable)
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .innerJoin(usersTable, eq(sponsorshipsTable.donorUserId, usersTable.id))
      .leftJoin(donorInventoryTable, eq(sponsorshipsTable.inventoryId, donorInventoryTable.id));
    const rows =
      request.authUser!.role === "DONOR"
        ? await base
            .where(eq(sponsorshipsTable.donorUserId, request.authUser!.id))
            .orderBy(desc(sponsorshipsTable.createdAt))
        : await base
            .where(eq(assistanceRequestsTable.teacherUserId, request.authUser!.id))
            .orderBy(desc(sponsorshipsTable.createdAt));
    response.json(
      Contract.GetSponsorshipsResponse.parse(
        rows.map((row) => ({
          id: row.id,
          requestId: row.requestId,
          requestTitle: row.requestTitle,
          donorName: row.donorName,
          inventoryTitle: row.inventoryTitle,
          donorMessage: row.donorMessage,
          quantity: row.quantity,
          acceptedQuantity: row.acceptedQuantity,
          donorWillSource: row.inventoryId === null,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      ),
    );
  },
);

router.post(
  "/sponsorships",
  requireAuth,
  requireRole("DONOR"),
  mutationLimit,
  async (request, response) => {
    const input = parseBody(
      Contract.CreateSponsorshipBody,
      request.body,
      response,
    );
    if (!input) return;
    await requireApprovedVerification(request.authUser!.id);
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      // Serialize this donor's offer submissions so a retried actionId cannot reserve
      // inventory or create a second offer while its first transaction is in flight.
      await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, request.authUser!.id))
        .for("update")
        .limit(1);
      const [existing] = await tx
        .select({
          sponsorship: sponsorshipsTable,
          requestTitle: assistanceRequestsTable.title,
          inventoryTitle: donorInventoryTable.title,
        })
        .from(sponsorshipsTable)
        .innerJoin(
          assistanceRequestsTable,
          eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
        )
        .leftJoin(
          donorInventoryTable,
          eq(sponsorshipsTable.inventoryId, donorInventoryTable.id),
        )
        .where(
          and(
            eq(sponsorshipsTable.donorUserId, request.authUser!.id),
            eq(sponsorshipsTable.clientActionId, input.actionId),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.sponsorship.requestId !== input.requestId ||
          existing.sponsorship.inventoryId !== (input.inventoryId ?? null) ||
          existing.sponsorship.quantity !== input.quantity ||
          (existing.sponsorship.donorMessage ?? null) !==
            (input.donorMessage?.trim() || null)
        ) {
          throw new HttpError(409, "This offer retry does not match the original action.");
        }
        return {
          sponsorship: existing.sponsorship,
          requestTitle: existing.requestTitle,
          inventoryTitle: existing.inventoryTitle,
          created: false,
        };
      }
      const [schoolRequest] = await tx
        .select()
        .from(assistanceRequestsTable)
        .where(
          and(
            eq(assistanceRequestsTable.id, input.requestId),
            or(
              eq(assistanceRequestsTable.status, "OPEN"),
              eq(assistanceRequestsTable.status, "PARTIALLY_MATCHED"),
            ),
          ),
        )
        .for("update")
        .limit(1);
      if (!schoolRequest) {
        throw new HttpError(404, "This request is not accepting offers.");
      }

      let item: typeof donorInventoryTable.$inferSelect | undefined;
      if (input.inventoryId) {
        // Listed goods are reserved while the offer is reviewed. A donor who will
        // source goods later has no inventory row to reserve.
        const [availableItem] = await tx
          .select()
          .from(donorInventoryTable)
          .where(
            and(
              eq(donorInventoryTable.id, input.inventoryId),
              eq(donorInventoryTable.donorUserId, request.authUser!.id),
              eq(donorInventoryTable.status, "AVAILABLE"),
            ),
          )
          .for("update")
          .limit(1);
        if (!availableItem) {
          throw new HttpError(400, "Choose one of your available goods or select that you will source them.");
        }
        if (availableItem.categoryGroup !== schoolRequest.categoryGroup) {
          throw new HttpError(400, "Those goods are not the kind of item this request asks for.");
        }
        if (availableItem.quantityAvailable < input.quantity) {
          throw new HttpError(400, `You only have ${availableItem.quantityAvailable} of those goods available.`);
        }
        item = availableItem;
        const remaining = item.quantityAvailable - input.quantity;
        await tx
          .update(donorInventoryTable)
          .set({
            quantityAvailable: remaining,
            status: remaining === 0 ? "RESERVED" : "AVAILABLE",
            updatedAt: new Date(),
          })
          .where(eq(donorInventoryTable.id, item.id));
      }

      const [sponsorship] = await tx
        .insert(sponsorshipsTable)
        .values({
          requestId: schoolRequest.id,
          donorUserId: request.authUser!.id,
          inventoryId: input.inventoryId,
          clientActionId: input.actionId,
          quantity: input.quantity,
          donorMessage: input.donorMessage?.trim() || null,
          status: "PENDING_TEACHER_REVIEW",
        })
        .returning();
      await tx.insert(notificationsTable).values({
        userId: schoolRequest.teacherUserId,
        type: "SPONSORSHIP_OFFER",
        title: "A new goods offer",
        body: "A donor has offered goods for a school request.",
        targetPath: "/teacher/offers",
        dedupeKey: `sponsorship:${sponsorship.id}:offer:${schoolRequest.teacherUserId}`,
      }).onConflictDoNothing();
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: "SPONSORSHIP_CREATED",
        targetType: "SPONSORSHIP",
        targetId: sponsorship.id,
        metadata: {
          requestId: schoolRequest.id,
          quantity: input.quantity,
          donorWillSource: input.inventoryId === null,
        },
      });
      return {
        sponsorship,
        requestTitle: schoolRequest.title,
        inventoryTitle: item?.title ?? null,
        created: true,
      };
    });

    response.status(result.created ? 201 : 200).json(
      Contract.CreateSponsorshipResponse.parse({
        id: result.sponsorship.id,
        requestId: result.sponsorship.requestId,
        requestTitle: result.requestTitle,
        donorName: request.authUser!.name,
        inventoryTitle: result.inventoryTitle,
        donorMessage: result.sponsorship.donorMessage,
        quantity: result.sponsorship.quantity,
        acceptedQuantity: result.sponsorship.acceptedQuantity,
        donorWillSource: result.sponsorship.inventoryId === null,
        status: result.sponsorship.status,
        createdAt: result.sponsorship.createdAt.toISOString(),
      }),
    );
  },
);

router.post(
  "/sponsorships/:id/decision",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const params = Contract.DecideSponsorshipParams.safeParse(request.params);
    const input = parseBody(
      Contract.DecideSponsorshipBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The sponsorship id is not valid." });
      return;
    }
    if (!input) return;
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      const [offer] = await tx
        .select({
          sponsorship: sponsorshipsTable,
          request: assistanceRequestsTable,
          donorName: usersTable.name,
        })
        .from(sponsorshipsTable)
        .innerJoin(
          assistanceRequestsTable,
          eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
        )
        .innerJoin(usersTable, eq(sponsorshipsTable.donorUserId, usersTable.id))
        .where(
          and(
            eq(sponsorshipsTable.id, params.data.id),
            eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
            eq(sponsorshipsTable.status, "PENDING_TEACHER_REVIEW"),
          ),
        )
        .for("update")
        .limit(1);
      if (!offer) throw new HttpError(404, "The offer could not be reviewed.");

      const approved = input.decision === "APPROVE";
      if (approved && offer.request.status === "FULFILLED") {
        throw new HttpError(409, "This request has already received the quantity it needs.");
      }
      const nextStatus = approved ? "APPROVED" : "REJECTED";
      const [updated] = await tx
        .update(sponsorshipsTable)
        .set({
          status: nextStatus,
          acceptedQuantity: approved ? offer.sponsorship.quantity : null,
          reviewedBy: request.authUser!.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sponsorshipsTable.id, offer.sponsorship.id))
        .returning();

      if (approved) {
        const [order] = await tx
          .insert(ordersTable)
          .values({
            sponsorshipId: updated.id,
            status: "PREPARING",
          })
          .returning();
        await tx.insert(orderEventsTable).values({
          orderId: order.id,
          actionId: crypto.randomUUID(),
          actorUserId: request.authUser!.id,
          actorRole: "TEACHER",
          eventType: "OFFER_ACCEPTED",
          statusAfter: "PREPARING",
          quantity: offer.sponsorship.quantity,
        });
        await tx.insert(deliveriesTable).values({
          orderId: order.id,
          status: "PLANNED",
        });
        const [{ approvedQuantity }] = await tx
          .select({
            approvedQuantity: sql<number>`coalesce(sum(coalesce(${sponsorshipsTable.acceptedQuantity}, ${sponsorshipsTable.quantity})), 0)::int`,
          })
          .from(sponsorshipsTable)
          .where(
            and(
              eq(sponsorshipsTable.requestId, offer.request.id),
              eq(sponsorshipsTable.status, "APPROVED"),
            ),
          );
        const [{ totalReceived }] = await tx
          .select({
            totalReceived: sql<number>`coalesce(sum(${ordersTable.receivedQuantity}), 0)::int`,
          })
          .from(ordersTable)
          .innerJoin(
            sponsorshipsTable,
            eq(ordersTable.sponsorshipId, sponsorshipsTable.id),
          )
          .where(eq(sponsorshipsTable.requestId, offer.request.id));
        const totalCovered = approvedQuantity + totalReceived;
        const requestStatus =
          totalReceived >= offer.request.quantity
            ? "FULFILLED"
            : totalCovered >= offer.request.quantity
              ? "MATCHED"
              : totalCovered > 0
                ? "PARTIALLY_MATCHED"
                : "OPEN";
        await tx
          .update(assistanceRequestsTable)
          .set({ status: requestStatus, updatedAt: new Date() })
          .where(eq(assistanceRequestsTable.id, offer.request.id));
        await tx.insert(notificationsTable).values({
          userId: offer.sponsorship.donorUserId,
          type: "SPONSORSHIP_APPROVED",
          title: "Your offer was accepted",
          body: "A school has accepted your goods offer. You can now prepare the handoff.",
          targetPath: "/donor/activity",
          dedupeKey: `sponsorship:${updated.id}:accepted:${offer.sponsorship.donorUserId}`,
        }).onConflictDoNothing();
      } else {
        if (offer.sponsorship.inventoryId) {
          const [item] = await tx
            .select()
            .from(donorInventoryTable)
            .where(eq(donorInventoryTable.id, offer.sponsorship.inventoryId))
            .for("update")
            .limit(1);
          if (item) {
            const remaining = item.quantityAvailable + offer.sponsorship.quantity;
            await tx
              .update(donorInventoryTable)
              .set({
                quantityAvailable: remaining,
                // Giving goods back must never revive a listing the donor withdrew.
                status: item.status === "WITHDRAWN" ? "WITHDRAWN" : "AVAILABLE",
                updatedAt: new Date(),
              })
              .where(eq(donorInventoryTable.id, item.id));
          }
        }
        await tx.insert(notificationsTable).values({
          userId: offer.sponsorship.donorUserId,
          type: "SPONSORSHIP_REJECTED",
          title: "Your offer was declined",
          body: "The school could not accept this goods offer.",
          targetPath: "/donor/activity",
          dedupeKey: `sponsorship:${updated.id}:declined:${offer.sponsorship.donorUserId}`,
        }).onConflictDoNothing();
      }
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: approved ? "SPONSORSHIP_APPROVED" : "SPONSORSHIP_REJECTED",
        targetType: "SPONSORSHIP",
        targetId: updated.id,
      });
      const [goods] = updated.inventoryId
        ? await tx.select({ title: donorInventoryTable.title }).from(donorInventoryTable).where(eq(donorInventoryTable.id, updated.inventoryId)).limit(1)
        : [];
      return {
        updated,
        request: offer.request,
        donorName: offer.donorName,
        inventoryTitle: goods?.title ?? null,
      };
    });

    response.json(
      Contract.DecideSponsorshipResponse.parse({
        id: result.updated.id,
        requestId: result.updated.requestId,
        requestTitle: result.request.title,
        donorName: result.donorName,
        inventoryTitle: result.inventoryTitle,
        donorMessage: result.updated.donorMessage,
        quantity: result.updated.quantity,
        acceptedQuantity: result.updated.acceptedQuantity,
        donorWillSource: result.updated.inventoryId === null,
        status: result.updated.status,
        createdAt: result.updated.createdAt.toISOString(),
      }),
    );
  },
);

router.use(fulfilmentRouter);

export default router;
