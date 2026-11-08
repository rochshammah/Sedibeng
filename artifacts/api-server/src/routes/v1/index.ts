import { Router } from "express";
import { csrfProtection, loadSession } from "../../lib/auth-middleware";
import accountsRouter from "./accounts";
import assistanceRouter from "./assistance";
import feedRouter from "./feed";
import authRouter from "../auth";
import administrationRouter from "./administration";
import givingRouter from "./giving";
import communicationsRouter from "./communications";
import dashboardsRouter from "./dashboards";

const router = Router();

router.use(loadSession);
router.use(csrfProtection);
router.use(authRouter);
router.use(accountsRouter);
router.use(assistanceRouter);
router.use(feedRouter);
router.use(givingRouter);
router.use(communicationsRouter);
router.use(administrationRouter);
router.use(dashboardsRouter);

export default router;
