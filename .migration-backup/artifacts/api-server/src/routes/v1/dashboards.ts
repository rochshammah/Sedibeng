import { Router } from "express";
import { and, count, desc, eq, or } from "drizzle-orm";
import * as Contract from "@workspace/api-zod";
import {
  assistanceRequestsTable,
  donorInventoryTable,
  ordersTable,
  requireDb,
  sponsorshipsTable,
  usersTable,
  verificationRecordsTable,
  reportsTable,
} from "@workspace/db";
import { requireAuth, requireRole } from "../../lib/auth-middleware";

const router = Router();

function seedFilter() {
  return process.env.NODE_ENV === "production"
    ? eq(assistanceRequestsTable.isSeedData, false)
    : undefined;
}

function inventoryImage(category: string) {
  if (/book|read/i.test(category)) return "/images/sedibeng-backpack-books.jpg";
  if (/station|pencil/i.test(category)) return "/images/sedibeng-stationery-kit.jpg";
  return "/images/sedibeng-school-shoes.jpg";
}

function module(
  id: string,
  title: string,
  detail: string,
  status: string,
  records: Array<{
    id: string;
    title: string;
    detail: string;
    status: string;
    imageUrl: string;
  }>,
) {
  return { id, title, detail, status, records };
}

function dashboardRecord(
  id: string,
  title: string,
  detail: string,
  status: string,
  category = "",
) {
  return { id, title, detail, status, imageUrl: inventoryImage(category) };
}

router.get(
  "/dashboard/donor",
  requireAuth,
  requireRole("DONOR"),
  async (request, response) => {
    const database = requireDb();
    const userId = request.authUser!.id;
    const [inventoryCounts] = await database
      .select({ total: count() })
      .from(donorInventoryTable)
      .where(eq(donorInventoryTable.donorUserId, userId));
    const [pendingOffers] = await database
      .select({ total: count() })
      .from(sponsorshipsTable)
      .where(
        and(
          eq(sponsorshipsTable.donorUserId, userId),
          eq(sponsorshipsTable.status, "PENDING_TEACHER_REVIEW"),
        ),
      );
    const [fulfilled] = await database
      .select({ total: count() })
      .from(ordersTable)
      .innerJoin(
        sponsorshipsTable,
        eq(ordersTable.sponsorshipId, sponsorshipsTable.id),
      )
      .where(
        and(
          eq(sponsorshipsTable.donorUserId, userId),
          eq(ordersTable.status, "FULFILLED"),
        ),
      );
    const inventory = await database
      .select()
      .from(donorInventoryTable)
      .where(eq(donorInventoryTable.donorUserId, userId))
      .orderBy(desc(donorInventoryTable.createdAt))
      .limit(5);
    const offers = await database
      .select({
        id: sponsorshipsTable.id,
        quantity: sponsorshipsTable.quantity,
        status: sponsorshipsTable.status,
        title: assistanceRequestsTable.title,
        category: assistanceRequestsTable.category,
      })
      .from(sponsorshipsTable)
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .where(eq(sponsorshipsTable.donorUserId, userId))
      .orderBy(desc(sponsorshipsTable.createdAt))
      .limit(5);

    const payload = {
      counts: [
        {
          label: "Goods listed",
          value: inventoryCounts.total,
          detail: "Your current inventory records",
        },
        {
          label: "Offers awaiting review",
          value: pendingOffers.total,
          detail: "Waiting for a teacher's decision",
        },
        {
          label: "Completed handoffs",
          value: fulfilled.total,
          detail: "Goods marked as delivered",
        },
      ],
      records: offers.map((offer) =>
        dashboardRecord(
          offer.id,
          offer.title,
          `${offer.quantity} units offered`,
          offer.status.toLowerCase().replaceAll("_", " "),
          offer.category,
        ),
      ),
      modules: [
        module(
          "inventory",
          "Your goods",
          "Manage available physical goods.",
          `${inventory.length} recent`,
          inventory.map((item) =>
            dashboardRecord(
              item.id,
              item.title,
              `${item.quantityAvailable} ${item.unit} · ${item.district}`,
              item.status.toLowerCase(),
              item.category,
            ),
          ),
        ),
        module(
          "offers",
          "Your offers",
          "Track teacher-reviewed sponsorship offers.",
          `${offers.length} recent`,
          offers.map((offer) =>
            dashboardRecord(
              offer.id,
              offer.title,
              `${offer.quantity} units offered`,
              offer.status.toLowerCase().replaceAll("_", " "),
              offer.category,
            ),
          ),
        ),
      ],
    };
    response.json(Contract.GetDonorDashboardResponse.parse(payload));
  },
);

router.get(
  "/dashboard/teacher",
  requireAuth,
  requireRole("TEACHER"),
  async (request, response) => {
    const database = requireDb();
    const userId = request.authUser!.id;
    const [{ total: requestCount }] = await database
      .select({ total: count() })
      .from(assistanceRequestsTable)
      .where(
        and(
          eq(assistanceRequestsTable.teacherUserId, userId),
          seedFilter(),
        ),
      );
    const [{ total: pendingOffers }] = await database
      .select({ total: count() })
      .from(sponsorshipsTable)
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .where(
        and(
          eq(assistanceRequestsTable.teacherUserId, userId),
          eq(sponsorshipsTable.status, "PENDING_TEACHER_REVIEW"),
          seedFilter(),
        ),
      );
    const [{ total: fulfilled }] = await database
      .select({ total: count() })
      .from(ordersTable)
      .innerJoin(
        sponsorshipsTable,
        eq(ordersTable.sponsorshipId, sponsorshipsTable.id),
      )
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .where(
        and(
          eq(assistanceRequestsTable.teacherUserId, userId),
          eq(ordersTable.status, "FULFILLED"),
          seedFilter(),
        ),
      );
    const requests = await database
      .select({
        id: assistanceRequestsTable.id,
        title: assistanceRequestsTable.title,
        quantity: assistanceRequestsTable.quantity,
        unit: assistanceRequestsTable.unit,
        status: assistanceRequestsTable.status,
        category: assistanceRequestsTable.category,
      })
      .from(assistanceRequestsTable)
      .where(
        and(eq(assistanceRequestsTable.teacherUserId, userId), seedFilter()),
      )
      .orderBy(desc(assistanceRequestsTable.createdAt))
      .limit(5);
    const offers = await database
      .select({
        id: sponsorshipsTable.id,
        quantity: sponsorshipsTable.quantity,
        status: sponsorshipsTable.status,
        title: assistanceRequestsTable.title,
        category: assistanceRequestsTable.category,
      })
      .from(sponsorshipsTable)
      .innerJoin(
        assistanceRequestsTable,
        eq(sponsorshipsTable.requestId, assistanceRequestsTable.id),
      )
      .where(
        and(
          eq(assistanceRequestsTable.teacherUserId, userId),
          seedFilter(),
        ),
      )
      .orderBy(desc(sponsorshipsTable.createdAt))
      .limit(5);

    const payload = {
      counts: [
        {
          label: "School requests",
          value: requestCount,
          detail: "Your requests across all stages",
        },
        {
          label: "Offers to review",
          value: pendingOffers,
          detail: "Donor offers awaiting your decision",
        },
        {
          label: "Completed handoffs",
          value: fulfilled,
          detail: "Goods marked as received",
        },
      ],
      records: requests.map((item) =>
        dashboardRecord(
          item.id,
          item.title,
          `${item.quantity} ${item.unit} requested`,
          item.status.toLowerCase().replaceAll("_", " "),
          item.category,
        ),
      ),
      modules: [
        module(
          "requests",
          "Your school requests",
          "Manage the needs submitted for your school.",
          `${requests.length} recent`,
          requests.map((item) =>
            dashboardRecord(
              item.id,
              item.title,
              `${item.quantity} ${item.unit} requested`,
              item.status.toLowerCase().replaceAll("_", " "),
              item.category,
            ),
          ),
        ),
        module(
          "offers",
          "Donor offers",
          "Review goods offered for your requests.",
          `${offers.length} recent`,
          offers.map((offer) =>
            dashboardRecord(
              offer.id,
              offer.title,
              `${offer.quantity} units offered`,
              offer.status.toLowerCase().replaceAll("_", " "),
              offer.category,
            ),
          ),
        ),
      ],
    };
    response.json(Contract.GetTeacherDashboardResponse.parse(payload));
  },
);

router.get(
  "/dashboard/admin",
  requireAuth,
  requireRole("ADMIN"),
  async (_request, response) => {
    const database = requireDb();
    const [{ total: users }] = await database
      .select({ total: count() })
      .from(usersTable);
    const [{ total: verifications }] = await database
      .select({ total: count() })
      .from(verificationRecordsTable)
      .where(eq(verificationRecordsTable.status, "PENDING"));
    const [{ total: moderation }] = await database
      .select({ total: count() })
      .from(assistanceRequestsTable)
      .where(
        and(
          eq(assistanceRequestsTable.status, "PENDING_MODERATION"),
          seedFilter(),
        ),
      );
    const [{ total: openReports }] = await database
      .select({ total: count() })
      .from(reportsTable)
      .where(
        or(
          eq(reportsTable.status, "OPEN"),
          eq(reportsTable.status, "UNDER_REVIEW"),
        ),
      );
    const pendingRequests = await database
      .select({
        id: assistanceRequestsTable.id,
        title: assistanceRequestsTable.title,
        category: assistanceRequestsTable.category,
        status: assistanceRequestsTable.status,
      })
      .from(assistanceRequestsTable)
      .where(
        and(
          eq(assistanceRequestsTable.status, "PENDING_MODERATION"),
          seedFilter(),
        ),
      )
      .orderBy(desc(assistanceRequestsTable.createdAt))
      .limit(5);

    const payload = {
      counts: [
        {
          label: "Accounts",
          value: users,
          detail: "Registered platform accounts",
        },
        {
          label: "Verification reviews",
          value: verifications,
          detail: "Waiting for an administrator",
        },
        {
          label: "Request reviews",
          value: moderation,
          detail: "Waiting for moderation",
        },
        {
          label: "Open reports",
          value: openReports,
          detail: "Require administrator attention",
        },
      ],
      records: pendingRequests.map((item) =>
        dashboardRecord(
          item.id,
          item.title,
          item.category,
          item.status.toLowerCase().replaceAll("_", " "),
          item.category,
        ),
      ),
      modules: [
        module(
          "moderation",
          "Request moderation",
          "Review school-level requests before publication.",
          `${pendingRequests.length} recent`,
          pendingRequests.map((item) =>
            dashboardRecord(
              item.id,
              item.title,
              item.category,
              item.status.toLowerCase().replaceAll("_", " "),
              item.category,
            ),
          ),
        ),
      ],
    };
    response.json(Contract.GetAdminDashboardResponse.parse(payload));
  },
);

export default router;
