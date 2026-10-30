import { Router, type IRouter } from "express";
import {
  GetAdminDashboardResponse,
  GetDonorDashboardResponse,
  GetRequestParams,
  GetRequestResponse,
  GetRequestsQueryParams,
  GetRequestsResponse,
  GetTeacherDashboardResponse,
} from "@workspace/api-zod";
import {
  adminDashboard,
  assistanceRequests,
  donorDashboard,
  teacherDashboard,
} from "../lib/sedibeng-demo-data";

const router: IRouter = Router();

router.get("/requests", (req, res) => {
  const parsedQuery = GetRequestsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    req.log.warn(
      { errors: parsedQuery.error.issues },
      "Invalid assistance request filters",
    );
    res.status(400).json({ error: parsedQuery.error.message });
    return;
  }

  const search = parsedQuery.data.search?.trim().toLocaleLowerCase();
  const category = parsedQuery.data.category?.trim().toLocaleLowerCase();
  const priority = parsedQuery.data.priority?.trim().toLocaleLowerCase();

  const matchingRequests = assistanceRequests.filter((request) => {
    const matchesSearch =
      !search ||
      [
        request.title,
        request.item,
        request.description,
        request.specifications,
        request.location,
        request.category,
      ].some((value) => value.toLocaleLowerCase().includes(search));
    const matchesCategory =
      !category || request.category.toLocaleLowerCase() === category;
    const matchesPriority =
      !priority || request.priority.toLocaleLowerCase() === priority;

    return matchesSearch && matchesCategory && matchesPriority;
  });

  res.json(GetRequestsResponse.parse(matchingRequests));
});

router.get("/requests/:id", (req, res) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsedParams = GetRequestParams.safeParse({ id: rawId });
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.message });
    return;
  }

  const request = assistanceRequests.find(
    (item) => item.id === parsedParams.data.id,
  );
  if (!request) {
    res.status(404).json({ error: "Demonstration request not found" });
    return;
  }

  res.json(GetRequestResponse.parse(request));
});

router.get("/demo/donor-dashboard", (_req, res) => {
  res.json(GetDonorDashboardResponse.parse(donorDashboard));
});

router.get("/demo/teacher-dashboard", (_req, res) => {
  res.json(GetTeacherDashboardResponse.parse(teacherDashboard));
});

router.get("/demo/admin-dashboard", (_req, res) => {
  res.json(GetAdminDashboardResponse.parse(adminDashboard));
});

export default router;
