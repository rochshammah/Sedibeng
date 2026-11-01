import { Router } from "express";
import rateLimit from "express-rate-limit";
import { and, desc, eq } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  auditLogsTable,
  donorInventoryTable,
  notificationsTable,
  reportsTable,
  requireDb,
  sponsorshipsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../../lib/auth-middleware";
import { HttpError } from "../../lib/errors";
import { parseBody } from "./shared";

const router = Router();
const reportLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: "Too many reports. Try again later." }),
});

router.get("/notifications", requireAuth, async (request, response) => {
  const rows = await requireDb()
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, request.authUser!.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  response.json(
    Contract.GetNotificationsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );
});

router.patch(
  "/notifications/:id/read",
  requireAuth,
  async (request, response) => {
    const params = Contract.MarkNotificationReadParams.safeParse(request.params);
    if (!params.success) {
      response.status(400).json({ error: "The notification id is not valid." });
      return;
    }
    const [row] = await requireDb()
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, params.data.id),
          eq(notificationsTable.userId, request.authUser!.id),
        ),
      )
      .returning();
    if (!row) throw new HttpError(404, "The notification was not found.");
    response.json(
      Contract.MarkNotificationReadResponse.parse({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  },
);

router.get("/reports", requireAuth, async (request, response) => {
  const rows = await requireDb()
    .select()
    .from(reportsTable)
    .where(eq(reportsTable.reporterUserId, request.authUser!.id))
    .orderBy(desc(reportsTable.createdAt));
  response.json(
    Contract.GetMyReportsResponse.parse(
      rows.map((row) => ({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );
});

router.post(
  "/reports",
  requireAuth,
  reportLimit,
  async (request, response) => {
    const input = parseBody(Contract.CreateReportBody, request.body, response);
    if (!input) return;
    if (input.targetType === "USER" && input.targetId === request.authUser!.id) {
      throw new HttpError(400, "You cannot report your own account.");
    }

    let targetExists = false;
    const database = requireDb();
    if (input.targetType === "REQUEST") {
      const [target] = await database
        .select({ id: assistanceRequestsTable.id })
        .from(assistanceRequestsTable)
        .where(eq(assistanceRequestsTable.id, input.targetId))
        .limit(1);
      targetExists = Boolean(target);
    } else if (input.targetType === "INVENTORY") {
      const [target] = await database
        .select({ id: donorInventoryTable.id })
        .from(donorInventoryTable)
        .where(eq(donorInventoryTable.id, input.targetId))
        .limit(1);
      targetExists = Boolean(target);
    } else if (input.targetType === "SPONSORSHIP") {
      const [target] = await database
        .select({ id: sponsorshipsTable.id })
        .from(sponsorshipsTable)
        .where(eq(sponsorshipsTable.id, input.targetId))
        .limit(1);
      targetExists = Boolean(target);
    } else {
      const [target] = await database
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, input.targetId))
        .limit(1);
      targetExists = Boolean(target);
    }
    if (!targetExists) throw new HttpError(404, "The reported item was not found.");

    const [row] = await database
      .insert(reportsTable)
      .values({
        reporterUserId: request.authUser!.id,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason.trim(),
        details: input.details?.trim() || null,
      })
      .returning();
    await database.insert(auditLogsTable).values({
      actorUserId: request.authUser!.id,
      action: "REPORT_SUBMITTED",
      targetType: "REPORT",
      targetId: row.id,
      metadata: { targetType: row.targetType },
    });
    response.status(201).json(
      Contract.CreateReportResponse.parse({
        id: row.id,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  },
);

export default router;
