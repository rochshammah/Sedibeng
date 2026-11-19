import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  auditLogsTable,
  deliveriesTable,
  donorInventoryTable,
  locationsTable,
  notificationsTable,
  orderEventsTable,
  ordersTable,
  requireDb,
  sponsorshipsTable,
  teacherProfilesTable,
  usersTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody, responseDate } from "./shared";

const router = Router();
const workflowMutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many handoff updates. Try again later." }),
});

type WorkflowAction = ReturnType<typeof Contract.UpdateOrderStatusBody.parse>["action"];
type WorkflowRole = "DONOR" | "TEACHER" | "SCHOOL_REPRESENTATIVE";
type WorkflowStatus = typeof ordersTable.$inferSelect.status;

const eventTypeByAction: Record<WorkflowAction, typeof orderEventsTable.$inferInsert.eventType> = {
  START_PREPARING: "PREPARATION_STARTED",
  MARK_READY: "GOODS_READY",
  CONFIRM_HANDOFF: "HANDOFF_CONFIRMED",
  CONFIRM_RECEIPT: "GOODS_RECEIVED",
  REPORT_ISSUE: "ISSUE_REPORTED",
  RESOLVE_ISSUE: "ISSUE_RESOLVED",
  COMPLETE_DISTRIBUTION: "GOODS_DISTRIBUTED",
  CANCEL: "OFFER_CANCELLED",
};

function statusAfterCounts(
  handedOver: number,
  received: number,
  distributed: number,
  accepted: number,
) {
  if (received >= accepted && distributed >= received) return "FULFILLED" as const;
  if (received >= accepted) return "RECEIVED" as const;
  if (received > 0) return "PARTIALLY_RECEIVED" as const;
  if (handedOver >= accepted) return "HANDED_OVER" as const;
  return "PARTIALLY_HANDED_OVER" as const;
}

function actionCopy(action: WorkflowAction) {
  const copy: Record<WorkflowAction, { title: string; body: string }> = {
    START_PREPARING: {
      title: "A handoff is being prepared",
      body: "The school has started preparing for a goods handoff.",
    },
    MARK_READY: {
      title: "Goods are ready for handoff",
      body: "A donor marked goods ready for the next step.",
    },
    CONFIRM_HANDOFF: {
      title: "A goods handoff was recorded",
      body: "A donor recorded goods handed over to the school.",
    },
    CONFIRM_RECEIPT: {
      title: "Goods receipt was recorded",
      body: "The school recorded goods received.",
    },
    REPORT_ISSUE: {
      title: "A goods issue needs attention",
      body: "The school reported an issue with a goods handoff.",
    },
    RESOLVE_ISSUE: {
      title: "A goods issue was updated",
      body: "A donor responded to a reported goods issue.",
    },
    COMPLETE_DISTRIBUTION: {
      title: "School distribution was updated",
      body: "The school recorded private distribution progress.",
    },
    CANCEL: {
      title: "A goods offer was cancelled",
      body: "A goods offer was cancelled before fulfilment was complete.",
    },
  };
  return copy[action];
}

function rolePath(role: WorkflowRole) {
  return role === "DONOR" ? "/donor/activity" : "/teacher/handoffs";
}

async function listOrdersFor(userId: string, role: WorkflowRole) {
  const database = requireDb();
  const donorLocation = alias(locationsTable, "donor_location");
  const schoolLocation = alias(locationsTable, "school_location");
  const base = database
    .select({
      order: ordersTable,
      sponsorship: sponsorshipsTable,
      schoolRequest: assistanceRequestsTable,
      delivery: deliveriesTable,
      donorLocationName: donorLocation.name,
      schoolLocationName: schoolLocation.name,
      goodsUnit: donorInventoryTable.unit,
      requestUnit: assistanceRequestsTable.unit,
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
    .leftJoin(
      donorInventoryTable,
      eq(donorInventoryTable.id, sponsorshipsTable.inventoryId),
    )
    .leftJoin(
      donorLocation,
      eq(donorLocation.id, donorInventoryTable.locationId),
    )
    .leftJoin(
      schoolLocation,
      eq(schoolLocation.id, assistanceRequestsTable.locationId),
    )
    .leftJoin(
      teacherProfilesTable,
      and(
        eq(teacherProfilesTable.schoolId, assistanceRequestsTable.schoolId),
        eq(teacherProfilesTable.userId, userId),
      ),
    );
  const rows =
    role === "DONOR"
      ? await base
          .where(eq(sponsorshipsTable.donorUserId, userId))
          .orderBy(desc(ordersTable.createdAt))
      : role === "TEACHER"
        ? await base
            .where(eq(assistanceRequestsTable.teacherUserId, userId))
            .orderBy(desc(ordersTable.createdAt))
        : await base
            .where(eq(teacherProfilesTable.userId, userId))
            .orderBy(desc(ordersTable.createdAt));
  if (rows.length === 0) return [];

  const eventRows = await database
    .select()
    .from(orderEventsTable)
    .where(inArray(orderEventsTable.orderId, rows.map(({ order }) => order.id)))
    .orderBy(asc(orderEventsTable.createdAt));
  const eventsByOrder = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    const list = eventsByOrder.get(event.orderId) ?? [];
    list.push(event);
    eventsByOrder.set(event.orderId, list);
  }

  return Contract.GetOrdersResponse.parse(
    rows.map(({ order, sponsorship, schoolRequest, delivery, donorLocationName, schoolLocationName, goodsUnit, requestUnit }) => ({
      id: order.id,
      sponsorshipId: sponsorship.id,
      requestId: schoolRequest.id,
      requestTitle: schoolRequest.title,
      quantity: sponsorship.quantity,
      unit: goodsUnit ?? requestUnit,
      acceptedQuantity: sponsorship.acceptedQuantity ?? sponsorship.quantity,
      handedOverQuantity: order.handedOverQuantity,
      receivedQuantity: order.receivedQuantity,
      distributedQuantity: order.distributedQuantity,
      status: order.status,
      generalArea: delivery?.generalArea ?? null,
      handoffNotes: delivery?.handoffNotes ?? null,
      donorLocationName: donorLocationName ?? null,
      schoolLocationName: schoolLocationName ?? null,
      scheduledAt: responseDate(delivery?.scheduledAt),
      events: (eventsByOrder.get(order.id) ?? []).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        statusAfter: event.statusAfter,
        actorRole: event.actorRole,
        quantity: event.quantity,
        issueType: event.issueType,
        note: event.note,
        privateNote: role === "DONOR" ? null : event.privateNote,
        createdAt: event.createdAt.toISOString(),
      })),
    })),
  );
}

router.get(
  "/orders",
  requireAuth,
  requireRole("DONOR", "TEACHER", "SCHOOL_REPRESENTATIVE"),
  async (request, response): Promise<void> => {
    response.json(
      await listOrdersFor(
        request.authUser!.id,
        request.authUser!.role as WorkflowRole,
      ),
    );
  },
);

router.patch(
  "/orders/:id/status",
  requireAuth,
  requireRole("DONOR", "TEACHER", "SCHOOL_REPRESENTATIVE"),
  workflowMutationLimit,
  async (request, response): Promise<void> => {
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

    const actor = request.authUser!;
    const actorRole = actor.role as WorkflowRole;
    const quantityActions = [
      "CONFIRM_HANDOFF",
      "CONFIRM_RECEIPT",
      "REPORT_ISSUE",
      "COMPLETE_DISTRIBUTION",
    ].includes(input.action);
    if (input.quantity !== undefined && !quantityActions) {
      throw new HttpError(400, "This action does not accept a quantity.");
    }
    if (input.issueType !== undefined && input.action !== "REPORT_ISSUE") {
      throw new HttpError(400, "Choose an issue type only when reporting an issue.");
    }
    if (
      input.note != null &&
      input.action !== "RESOLVE_ISSUE" &&
      input.action !== "CANCEL"
    ) {
      throw new HttpError(400, "This action does not accept a shared note.");
    }
    if (
      input.privateNote != null &&
      (actorRole === "DONOR" ||
        (input.action !== "REPORT_ISSUE" &&
          input.action !== "COMPLETE_DISTRIBUTION"))
    ) {
      throw new HttpError(400, "Private notes are only available to school staff for issues or distribution.");
    }
    if (
      (input.generalArea !== undefined ||
        input.handoffNotes !== undefined ||
        input.scheduledAt !== undefined) &&
      input.action !== "MARK_READY"
    ) {
      throw new HttpError(400, "Handoff details can only be changed when goods are marked ready.");
    }
    const database = requireDb();
    await database.transaction(async (tx) => {
      const [record] = await tx
        .select({
          order: ordersTable,
          sponsorship: sponsorshipsTable,
          schoolRequest: assistanceRequestsTable,
          delivery: deliveriesTable,
          representative: teacherProfilesTable.userId,
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
        .leftJoin(
          teacherProfilesTable,
          and(
            eq(teacherProfilesTable.schoolId, assistanceRequestsTable.schoolId),
            eq(teacherProfilesTable.userId, actor.id),
          ),
        )
        .where(eq(ordersTable.id, params.data.id))
        .for("update", { of: ordersTable })
        .limit(1);

      const authorized =
        record &&
        (actorRole === "DONOR"
          ? record.sponsorship.donorUserId === actor.id
          : actorRole === "TEACHER"
            ? record.schoolRequest.teacherUserId === actor.id
            : record.representative === actor.id);
      if (!authorized || !record) {
        throw new HttpError(404, "The order could not be updated.");
      }
      if (
        input.action === "START_PREPARING" &&
        actorRole !== "TEACHER" &&
        actorRole !== "SCHOOL_REPRESENTATIVE"
      ) {
        throw new HttpError(403, "Only the school can start preparation.");
      }
      if (
        ["MARK_READY", "CONFIRM_HANDOFF"].includes(input.action) &&
        actorRole !== "DONOR"
      ) {
        throw new HttpError(403, "Only the donor can update handoff progress.");
      }
      if (
        ["CONFIRM_RECEIPT", "REPORT_ISSUE", "COMPLETE_DISTRIBUTION"].includes(input.action) &&
        actorRole === "DONOR"
      ) {
        throw new HttpError(403, "Only authorized school personnel can confirm receipt or distribution.");
      }
      if (
        input.action === "RESOLVE_ISSUE" &&
        actorRole !== "DONOR"
      ) {
        throw new HttpError(403, "Only the donor can respond to a reported issue.");
      }
      const eventType = eventTypeByAction[input.action];
      const [priorAction] = await tx
        .select()
        .from(orderEventsTable)
        .where(
          and(
            eq(orderEventsTable.orderId, record.order.id),
            eq(orderEventsTable.actionId, input.actionId),
          ),
        )
        .limit(1);
      if (priorAction) {
      const samePayload =
          priorAction.eventType === eventType &&
          priorAction.quantity === (input.quantity ?? null) &&
          priorAction.issueType === (input.issueType ?? null) &&
          priorAction.note === (
            input.action === "RESOLVE_ISSUE" || input.action === "CANCEL"
              ? input.note?.trim() || null
              : null
          ) &&
          priorAction.privateNote === (input.privateNote?.trim() || null);
        if (!samePayload) {
          throw new HttpError(409, "This action id was already used for a different update.");
        }
        return;
      }
      if (record.order.status === "FULFILLED" || record.order.status === "CANCELLED") {
        if (
          input.action !== "COMPLETE_DISTRIBUTION" ||
          record.order.status !== "CANCELLED" ||
          record.order.distributedQuantity >= record.order.receivedQuantity
        ) {
          throw new HttpError(409, "This offer is already closed.");
        }
      }

      const [schoolRequest] = await tx
        .select()
        .from(assistanceRequestsTable)
        .where(eq(assistanceRequestsTable.id, record.schoolRequest.id))
        .for("update")
        .limit(1);
      if (!schoolRequest) throw new HttpError(404, "The school request no longer exists.");

      const accepted = record.sponsorship.acceptedQuantity ?? record.sponsorship.quantity;
      const handedOver = record.order.handedOverQuantity;
      const received = record.order.receivedQuantity;
      const distributed = record.order.distributedQuantity;
      let status: WorkflowStatus = record.order.status;
      let nextHandedOver = handedOver;
      let nextReceived = received;
      let nextDistributed = distributed;
      let eventQuantity = input.quantity ?? null;

      if (input.action === "START_PREPARING") {
        if (status !== "AWAITING_TEACHER_APPROVAL") {
          throw new HttpError(409, "Preparation has already started.");
        }
        status = "PREPARING";
      } else if (input.action === "MARK_READY") {
        if (
          !["PREPARING", "PARTIALLY_HANDED_OVER", "PARTIALLY_RECEIVED"].includes(status) ||
          handedOver >= accepted
        ) {
          throw new HttpError(409, "There are no remaining goods to mark ready.");
        }
        status = "READY_FOR_HANDOFF";
      } else if (input.action === "CONFIRM_HANDOFF") {
        if (status !== "READY_FOR_HANDOFF" || !input.quantity) {
          throw new HttpError(409, "Mark the goods ready before confirming a handoff.");
        }
        if (handedOver + input.quantity > accepted) {
          throw new HttpError(400, "The handoff quantity cannot exceed the remaining accepted goods.");
        }
        nextHandedOver += input.quantity;
        status = nextHandedOver >= accepted ? "HANDED_OVER" : "PARTIALLY_HANDED_OVER";
      } else if (input.action === "CONFIRM_RECEIPT") {
        if (!input.quantity || handedOver <= received) {
          throw new HttpError(409, "There are no unconfirmed handed-over goods to receive.");
        }
        if (received + input.quantity > handedOver || received + input.quantity > accepted) {
          throw new HttpError(400, "Received goods cannot exceed the quantity handed over or accepted.");
        }
        nextReceived += input.quantity;
        status = nextReceived >= accepted ? "RECEIVED" : "PARTIALLY_RECEIVED";
      } else if (input.action === "REPORT_ISSUE") {
        if (
          !input.quantity ||
          !input.issueType ||
          handedOver === 0 ||
          input.quantity > handedOver
        ) {
          throw new HttpError(400, "Choose an issue type and a quantity no greater than the goods handed over.");
        }
        status = "RESOLUTION_REQUIRED";
      } else if (input.action === "RESOLVE_ISSUE") {
        if (status !== "RESOLUTION_REQUIRED" || !input.note?.trim()) {
          throw new HttpError(409, "Add a resolution update to close this issue.");
        }
        status = statusAfterCounts(handedOver, received, distributed, accepted);
      } else if (input.action === "COMPLETE_DISTRIBUTION") {
        if (
          actorRole === "DONOR" ||
          !input.quantity ||
          input.quantity > received - distributed ||
          status === "RESOLUTION_REQUIRED" ||
          status === "PREPARING" ||
          status === "READY_FOR_HANDOFF"
        ) {
          throw new HttpError(400, "Distribution quantity must be within goods the school has received.");
        }
        nextDistributed += input.quantity;
        if (
          record.order.status !== "CANCELLED" &&
          nextReceived >= accepted &&
          nextDistributed >= nextReceived
        ) {
          status = "FULFILLED";
        } else if (record.order.status !== "CANCELLED") {
          status = statusAfterCounts(handedOver, received, nextDistributed, accepted);
        }
      } else if (input.action === "CANCEL") {
        if (!input.note?.trim()) throw new HttpError(409, "Add a reason to cancel this offer.");
        if (actorRole === "DONOR" && handedOver > 0) {
          throw new HttpError(403, "The school must resolve or cancel an offer after goods are handed over.");
        }
        status = "CANCELLED";
      }

      const [updatedOrder] = await tx
        .update(ordersTable)
        .set({
          status,
          handedOverQuantity: nextHandedOver,
          receivedQuantity: nextReceived,
          distributedQuantity: nextDistributed,
          updatedAt: new Date(),
        })
        .where(eq(ordersTable.id, record.order.id))
        .returning();
      if (!updatedOrder) throw new HttpError(500, "The handoff could not be saved.");

      const deliveryStatus =
        status === "FULFILLED"
          ? "COMPLETED"
          : status === "CANCELLED"
            ? "CANCELLED"
            : input.action === "MARK_READY"
              ? "READY"
              : record.delivery?.status ?? "PLANNED";
      const deliveryValues = {
        status: deliveryStatus,
        generalArea:
          input.generalArea === undefined
            ? record.delivery?.generalArea ?? null
            : input.generalArea?.trim() || null,
        handoffNotes:
          input.handoffNotes === undefined
            ? record.delivery?.handoffNotes ?? null
            : input.handoffNotes?.trim() || null,
        scheduledAt:
          input.scheduledAt === null
            ? null
            : input.scheduledAt
              ? new Date(input.scheduledAt)
              : record.delivery?.scheduledAt ?? null,
        completedAt: status === "FULFILLED" ? new Date() : record.delivery?.completedAt ?? null,
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

      if (status === "FULFILLED") {
        await tx
          .update(sponsorshipsTable)
          .set({ status: "FULFILLED", updatedAt: new Date() })
          .where(eq(sponsorshipsTable.id, record.sponsorship.id));
      } else if (status === "CANCELLED") {
        await tx
          .update(sponsorshipsTable)
          .set({ status: "CANCELLED", updatedAt: new Date() })
          .where(eq(sponsorshipsTable.id, record.sponsorship.id));
        if (record.sponsorship.inventoryId) {
          const [inventory] = await tx
            .select()
            .from(donorInventoryTable)
            .where(eq(donorInventoryTable.id, record.sponsorship.inventoryId))
            .for("update")
            .limit(1);
          const remainingReservation = Math.max(0, accepted - handedOver);
          if (inventory && remainingReservation > 0) {
            await tx
              .update(donorInventoryTable)
              .set({
                quantityAvailable: inventory.quantityAvailable + remainingReservation,
                status: inventory.status === "WITHDRAWN" ? "WITHDRAWN" : "AVAILABLE",
                updatedAt: new Date(),
              })
              .where(eq(donorInventoryTable.id, inventory.id));
          }
        }
      }

      await tx.insert(orderEventsTable).values({
        orderId: record.order.id,
        actionId: input.actionId,
        actorUserId: actor.id,
        actorRole,
        eventType,
        statusAfter: status,
        quantity: eventQuantity,
        issueType: input.action === "REPORT_ISSUE" ? input.issueType : null,
        note:
          input.action === "RESOLVE_ISSUE" || input.action === "CANCEL"
            ? input.note?.trim() || null
            : null,
        privateNote:
          actorRole === "DONOR" ? null : input.privateNote?.trim() || null,
      });

      const [{ acceptedQuantity }] = await tx
        .select({
          acceptedQuantity: sql<number>`coalesce(sum(coalesce(${sponsorshipsTable.acceptedQuantity}, ${sponsorshipsTable.quantity})), 0)::int`,
        })
        .from(sponsorshipsTable)
        .where(
          and(
            eq(sponsorshipsTable.requestId, schoolRequest.id),
            or(
              eq(sponsorshipsTable.status, "APPROVED"),
              eq(sponsorshipsTable.status, "FULFILLED"),
            ),
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
        .where(eq(sponsorshipsTable.requestId, schoolRequest.id));
      const requestStatus =
        totalReceived >= schoolRequest.quantity
          ? "FULFILLED"
          : acceptedQuantity >= schoolRequest.quantity
            ? "MATCHED"
            : acceptedQuantity > 0 || totalReceived > 0
              ? "PARTIALLY_MATCHED"
              : "OPEN";
      const oldRequestStatus = schoolRequest.status;
      if (oldRequestStatus !== "CANCELLED" && oldRequestStatus !== requestStatus) {
        await tx
          .update(assistanceRequestsTable)
          .set({ status: requestStatus, updatedAt: new Date() })
          .where(eq(assistanceRequestsTable.id, schoolRequest.id));
      }

      const notificationTargets: Array<{ id: string; role: WorkflowRole }> = [];
      if (actorRole === "DONOR") {
        notificationTargets.push({
          id: schoolRequest.teacherUserId,
          role: "TEACHER",
        });
        const reps = await tx
          .select({ id: usersTable.id })
          .from(teacherProfilesTable)
          .innerJoin(usersTable, eq(usersTable.id, teacherProfilesTable.userId))
          .where(
            and(
              eq(teacherProfilesTable.schoolId, schoolRequest.schoolId),
              eq(usersTable.role, "SCHOOL_REPRESENTATIVE"),
            ),
          );
        notificationTargets.push(...reps.map(({ id }) => ({ id, role: "SCHOOL_REPRESENTATIVE" as const })));
      } else {
        notificationTargets.push({
          id: record.sponsorship.donorUserId,
          role: "DONOR",
        });
      }
      const copy = actionCopy(input.action);
      for (const target of notificationTargets) {
        if (target.id === actor.id) continue;
        await tx
          .insert(notificationsTable)
          .values({
            userId: target.id,
            type: `ORDER_${input.action}`,
            title: copy.title,
            body: copy.body,
            targetPath: rolePath(target.role),
            dedupeKey: `order:${record.order.id}:action:${input.actionId}:${target.id}`,
          })
          .onConflictDoNothing();
      }
      if (input.action === "CONFIRM_RECEIPT" && totalReceived > 0) {
        const progressText =
          requestStatus === "FULFILLED"
            ? "A school request has now received the quantity it needs."
            : "A school has recorded progress receiving goods.";
        const progressTargets = new Map<string, WorkflowRole>([
          [schoolRequest.teacherUserId, "TEACHER"],
          [record.sponsorship.donorUserId, "DONOR"],
        ]);
        for (const [userId, role] of progressTargets) {
          await tx
            .insert(notificationsTable)
            .values({
              userId,
              type: requestStatus === "FULFILLED" ? "REQUEST_FULFILLED" : "REQUEST_RECEIPT_PROGRESS",
              title: requestStatus === "FULFILLED" ? "Request quantity received" : "Goods receipt updated",
              body: progressText,
              targetPath: rolePath(role),
              dedupeKey: `order:${record.order.id}:action:${input.actionId}:request:${userId}`,
            })
            .onConflictDoNothing();
        }
      }

      await tx.insert(auditLogsTable).values({
        actorUserId: actor.id,
        action: `ORDER_${input.action}`,
        targetType: "ORDER",
        targetId: record.order.id,
        metadata: {
          status,
          quantity: eventQuantity,
          receivedQuantity: nextReceived,
          handedOverQuantity: nextHandedOver,
          distributedQuantity: nextDistributed,
        },
      });
    });

    const updated = (await listOrdersFor(actor.id, actorRole)).find(
      (order) => order.id === params.data.id,
    );
    if (!updated) throw new HttpError(404, "The order could not be loaded.");
    response.json(Contract.UpdateOrderStatusResponse.parse(updated));
  },
);

export default router;
