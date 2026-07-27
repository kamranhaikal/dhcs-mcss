import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import rssRouter from "./rss.js";
import exportRouter from "./export.js";
import newsRouter from "./news.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(rssRouter);
router.use(exportRouter);
router.use(newsRouter);

export default router;
