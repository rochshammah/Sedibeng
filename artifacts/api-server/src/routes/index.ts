import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sedibengRouter from "./sedibeng";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sedibengRouter);

export default router;
