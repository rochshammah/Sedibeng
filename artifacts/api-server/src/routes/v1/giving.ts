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
  ordersTable,
  requireDb,
  sponsorshipsTable,
  usersTable,
  verificationRecordsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody, responseDate } from "./shared";

const router = Router();
const mutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many changes. Try again later." }),
});

function inventoryResponse(row: typeof donorInventoryTable.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    item: row.item,
    description: row.description,
    specifications: row.specifications,
    quantityAvailable: row.quantityAvailable,
    unit: row.unit,
    district: row.district,
    area: row.area,
    status: row.status,
    isSeedData: row.isSeedData,
  };
}

async function requireApprovedVerification(userId: string) {
  const [approved] = await requireDb()
    .select({ id: verificationRecordsTable.id })
    .from(verificationRecordsTable)
    .where(
      and(
        eq(verificationRecordsTable.userId, userId),
        eq(verificationRecordsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!approved) {
    throw new HttpError(403, "Complete account verification before offering goods.");
  }
}

router.get(
  "/inventory",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const rows = await requireDb()
      .select()
      .from(donorInventoryTable)
      .where(eq(donorInventoryTable.donorUserId, request.authUser!.id))
      .orderBy(desc(donorInventoryTable.createdAt));
    response.json(
      Contract.GetInventoryResponse.parse(rows.map(inventoryResponse)),
    );
  },
);

router.post(
  "/inventory",
  requireAuth,
  requireRole("DONOR"),
  mutationLimit,
  async (request, response) => {
    const input = parseBody(
      Contract.CreateInventoryBody,
      request.body,
      response,
    );
    if (!input) return;
    const verified = await requireDb()
      .select({ id: verificationRecordsTable.id })
      .from(verificationRecordsTable)
      .where(
        and(
          eq(verificationRecordsTable.userId, request.authUser!.id),
          eq(verificationRecordsTable.status, "APPROVED"),
        ),
      )
      .limit(1);
    const [row] = await requireDb()
      .insert(donorInventoryTable)
      .values({
        donorUserId: request.authUser!.id,
        title: input.title.trim(),
        category: input.category.trim(),
        item: input.item.trim(),
        description: input.description.trim(),
        specifications: input.specifications?.trim() || null,
        quantityAvailable: input.quantityAvailable,
        unit: input.unit.trim(),
        district: input.district.trim(),
        area: input.area?.trim() || null,
        status: verified.length ? "AVAILABLE" : "DRAFT",
      })
      .returning();
    response.status(201).json(
      Contract.CreateInventoryResponse.parse(inventoryResponse(row)),
    );
  },
);

router.patch(
  "/inventory/:id",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const params = Contract.UpdateInventoryParams.safeParse(request.params);
    const input = parseBody(
      Contract.UpdateInventoryBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The inventory id is not valid." });
      return;
    }
    if (!input) return;
    const [row] = await requireDb()
      .update(donorInventoryTable)
      .set({
        title: input.title.trim(),
        category: input.category.trim(),
        item: input.item.trim(),
        description: input.description.trim(),
        specifications: input.specifications?.trim() || null,
        quantityAvailable: input.quantityAvailable,
        unit: input.unit.trim(),
        district: input.district.trim(),
        area: input.area?.trim() || null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(donorInventoryTable.id, params.data.id),
          eq(donorInventoryTable.donorUserId, request.authUser!.id),
          or(
            eq(donorInventoryTable.status, "DRAFT"),
            eq(donorInventoryTable.status, "AVAILABLE"),
          ),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "The inventory item could not be changed.");
    response.json(
      Contract.UpdateInventoryResponse.parse(inventoryResponse(row)),
    );
  },
);

router.delete(
  "/inventory/:id",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const params = Contract.DeleteInventoryParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The inventory id is not valid." });
      return;
    }
    const [row] = await requireDb()
      .update(donorInventoryTable)
      .set({ status: "WITHDRAWN", updatedAt: new Date() })
      .where(
        and(
          eq(donorInventoryTable.id, params.data.id),
          eq(donorInventoryTable.donorUserId, request.authUser!.id),
          or(
            eq(donorInventoryTable.status, "DRAFT"),
            eq(donorInventoryTable.status, "AVAILABLE"),
          ),
        ),
      )
      .returning({ id: donorInventoryTable.id });
    if (!row) throw new HttpError(404, "The inventory item could not be withdrawn.");
    response.status(204).end();
  },
);

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
        donorName: usersTable.name,
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
      .innerJoin(usersTable, eq(sponsorshipsTable.donorUserId, usersTable.id));
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
          quantity: row.quantity,
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

      if (input.inventoryId) {
        const [item] = await tx
          .select()
          .from(donorInventoryTable)
          .where(
            and(
              eq(donorInventoryTable.id, input.inventoryId),
              eq(donorInventoryTable.donorUserId, request.authUser!.id),
              eq(donorInventoryTable.status, "AVAILABLE"),
              gte(donorInventoryTable.quantityAvailable, input.quantity),
            ),
          )
          .for("update")
          .limit(1);
        if (!item) {
          throw new HttpError(400, "The selected goods are not available in that quantity.");
        }
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
          inventoryId: input.inventoryId ?? null,
          quantity: input.quantity,
          donorMessage: input.donorMessage?.trim() || null,
          status: "PENDING_TEACHER_REVIEW",
        })
        .returning();
      await tx.insert(notificationsTable).values({
        userId: schoolRequest.teacherUserId,
        type: "SPONSORSHIP_OFFER",
        title: "A donor offered goods",
        body: `A donor offered ${input.quantity} ${input.quantity === 1 ? "unit" : "units"} for ${schoolRequest.title}.`,
      });
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: "SPONSORSHIP_CREATED",
        targetType: "SPONSORSHIP",
        targetId: sponsorship.id,
        metadata: { requestId: schoolRequest.id, quantity: input.quantity },
      });
      return { sponsorship, requestTitle: schoolRequest.title };
    });

    response.status(201).json(
      Contract.CreateSponsorshipResponse.parse({
        id: result.sponsorship.id,
        requestId: result.sponsorship.requestId,
        requestTitle: result.requestTitle,
        donorName: request.authUser!.name,
        quantity: result.sponsorship.quantity,
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
      const nextStatus = approved ? "APPROVED" : "REJECTED";
      const [updated] = await tx
        .update(sponsorshipsTable)
        .set({
          status: nextStatus,
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
        await tx.insert(deliveriesTable).values({
          orderId: order.id,
          status: "PLANNED",
        });
        const [{ approvedQuantity }] = await tx
          .select({
            approvedQuantity: sql<number>`coalesce(sum(${sponsorshipsTable.quantity}), 0)::int`,
          })
          .from(sponsorshipsTable)
          .where(
            and(
              eq(sponsorshipsTable.requestId, offer.request.id),
              eq(sponsorshipsTable.status, "APPROVED"),
            ),
          );
        const requestStatus =
          approvedQuantity >= offer.request.quantity ? "MATCHED" : "PARTIALLY_MATCHED";
        await tx
          .update(assistanceRequestsTable)
          .set({ status: requestStatus, updatedAt: new Date() })
          .where(eq(assistanceRequestsTable.id, offer.request.id));
        await tx.insert(notificationsTable).values({
          userId: offer.sponsorship.donorUserId,
          type: "SPONSORSHIP_APPROVED",
          title: "Your goods offer was accepted",
          body: `Your offer for ${offer.request.title} is approved. You can now coordinate the handoff.`,
        });
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
                status: "AVAILABLE",
                updatedAt: new Date(),
              })
              .where(eq(donorInventoryTable.id, item.id));
          }
        }
        await tx.insert(notificationsTable).values({
          userId: offer.sponsorship.donorUserId,
          type: "SPONSORSHIP_REJECTED",
          title: "Your goods offer was declined",
          body: `The school did not accept the offer for ${offer.request.title}.`,
        });
      }
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: approved ? "SPONSORSHIP_APPROVED" : "SPONSORSHIP_REJECTED",
        targetType: "SPONSORSHIP",
        targetId: updated.id,
      });
      return {
        updated,
        request: offer.request,
        donorName: offer.donorName,
      };
    });

    response.json(
      Contract.DecideSponsorshipResponse.parse({
        id: result.updated.id,
        requestId: result.updated.requestId,
        requestTitle: result.request.title,
        donorName: result.donorName,
        quantity: result.updated.quantity,
        status: result.updated.status,
        createdAt: result.updated.createdAt.toISOString(),
      }),
    );
  },
);

router.get(
  "/orders",
  requireAuth,
  requireRole("DONOR", "TEACHER"),
  async (request, response) => {
    const query = requireDb()
      .select({
        order: ordersTable,
        sponsorship: sponsorshipsTable,
        schoolRequest: assistanceRequestsTable,
        delivery: deliveriesTable,
      })
      .from(ordersTable)
      .innerJoin(
        sponsorshipsTable,
        eq(ordersTable.sponsorshipId, sponsorshipsTable.id),
      )
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .leftJoin(deliveriesTable, eq(deliveriesTable.orderId, ordersTable.id));
    const rows =
      request.authUser!.role === "DONOR"
        ? await query
            .where(eq(sponsorshipsTable.donorUserId, request.authUser!.id))
            .orderBy(desc(ordersTable.createdAt))
        : await query
            .where(eq(assistanceRequestsTable.teacherUserId, request.authUser!.id))
            .orderBy(desc(ordersTable.createdAt));
    response.json(
      Contract.GetOrdersResponse.parse(
        rows.map(({ order, sponsorship, schoolRequest, delivery }) => ({
          id: order.id,
          sponsorshipId: sponsorship.id,
          requestTitle: schoolRequest.title,
          quantity: sponsorship.quantity,
          status: order.status,
          generalArea: delivery?.generalArea ?? null,
          scheduledAt: responseDate(delivery?.scheduledAt),
        })),
      ),
    );
  },
);

router.patch(
  "/orders/:id/status",
  requireAuth,
  requireRole("DONOR", "TEACHER"),
  async (request, response) => {
    const params = Contract.UpdateOrderStatusParams.safeParse(request.params);
    const input = parseBody(
      Contract.UpdateOrderStatusBody,
      request.body,
      response,
    );
    if (!params.success) {
      response.status(400).json({ error: "The order id is not valid." });
      return;
    }
    if (!input) return;
    const database = requireDb();
    const result = await database.transaction(async (tx) => {
      const [record] = await tx
        .select({
          order: ordersTable,
          sponsorship: sponsorshipsTable,
          schoolRequest: assistanceRequestsTable,
          delivery: deliveriesTable,
        })
        .from(ordersTable)
        .innerJoin(
          sponsorshipsTable,
          eq(ordersTable.sponsorshipId, sponsorshipsTable.id),
        )
        .innerJoin(
          assistanceRequestsTable,
          eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
        )
        .leftJoin(deliveriesTable, eq(deliveriesTable.orderId, ordersTable.id))
        .where(
          and(
            eq(ordersTable.id, params.data.id),
            request.authUser!.role === "DONOR"
              ? eq(sponsorshipsTable.donorUserId, request.authUser!.id)
              : eq(assistanceRequestsTable.teacherUserId, request.authUser!.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!record) throw new HttpError(404, "The order could not be updated.");

      const nextStatus = input.status;
      if (
        request.authUser!.role === "DONOR" &&
        !["PREPARING", "READY_FOR_HANDOFF", "CANCELLED"].includes(nextStatus)
      ) {
        throw new HttpError(403, "Only the school can confirm a completed handoff.");
      }
      if (
        request.authUser!.role === "TEACHER" &&
        !["FULFILLED", "CANCELLED"].includes(nextStatus)
      ) {
        throw new HttpError(403, "Only the donor can update preparation progress.");
      }

      const [updatedOrder] = await tx
        .update(ordersTable)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(ordersTable.id, record.order.id))
        .returning();
      const deliveryStatus: "COMPLETED" | "CANCELLED" | "READY" | "PLANNED" =
        nextStatus === "FULFILLED"
          ? "COMPLETED"
          : nextStatus === "CANCELLED"
            ? "CANCELLED"
            : nextStatus === "READY_FOR_HANDOFF"
              ? "READY"
              : "PLANNED";
      const deliveryValues = {
        status: deliveryStatus,
        generalArea: input.generalArea?.trim() || record.delivery?.generalArea || null,
        handoffNotes: input.handoffNotes?.trim() || record.delivery?.handoffNotes || null,
        scheduledAt: record.delivery?.scheduledAt ?? null,
        completedAt: nextStatus === "FULFILLED" ? new Date() : null,
        updatedAt: new Date(),
      };
      if (record.delivery) {
        await tx
          .update(deliveriesTable)
          .set(deliveryValues)
          .where(eq(deliveriesTable.id, record.delivery.id));
      } else {
        await tx.insert(deliveriesTable).values({
          orderId: record.order.id,
          ...deliveryValues,
        });
      }

      if (nextStatus === "FULFILLED") {
        await tx
          .update(assistanceRequestsTable)
          .set({ status: "FULFILLED", updatedAt: new Date() })
          .where(eq(assistanceRequestsTable.id, record.schoolRequest.id));
      }

      const otherUserId =
        request.authUser!.role === "DONOR"
          ? record.schoolRequest.teacherUserId
          : record.sponsorship.donorUserId;
      await tx.insert(notificationsTable).values({
        userId: otherUserId,
        type: "ORDER_STATUS",
        title: "A goods handoff was updated",
        body: `${record.schoolRequest.title} is now marked ${nextStatus.toLowerCase().replaceAll("_", " ")}.`,
      });
      await tx.insert(auditLogsTable).values({
        actorUserId: request.authUser!.id,
        action: "ORDER_STATUS_UPDATED",
        targetType: "ORDER",
        targetId: record.order.id,
        metadata: { status: nextStatus },
      });
      return {
        order: updatedOrder,
        sponsorship: record.sponsorship,
        request: record.schoolRequest,
        deliveryValues,
      };
    });

    response.json(
      Contract.UpdateOrderStatusResponse.parse({
        id: result.order.id,
        sponsorshipId: result.sponsorship.id,
        requestTitle: result.request.title,
        quantity: result.sponsorship.quantity,
        status: result.order.status,
        generalArea: result.deliveryValues.generalArea,
        scheduledAt: responseDate(result.deliveryValues.scheduledAt),
      }),
    );
  },
);

export default router;
