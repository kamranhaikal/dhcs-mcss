import { Router, type IRouter } from "express";
import { GetNewsMetaResponse, ListNewsQueryParams } from "@workspace/api-zod";
import { getNews } from "../lib/news-cache.js";
import { filterNewsItems, findNewsItem, listNewsItems, toListItem } from "../lib/news-query.js";

const router: IRouter = Router();

const optionalText = ListNewsQueryParams.shape.q;
const optionalInteger = (minimum: number, maximum?: number) => optionalText
  .refine((value) => value === undefined || /^\d+$/.test(value), "must be an integer")
  .transform((value) => value === undefined ? undefined : Number(value))
  .refine((value) => value === undefined || value >= minimum, `must be at least ${minimum}`)
  .refine((value) => value === undefined || maximum === undefined || value <= maximum, maximum === undefined ? "invalid maximum" : `must be at most ${maximum}`);

export const NewsQueryParams = ListNewsQueryParams.extend({
  hpMapping: optionalText,
  limit: optionalInteger(1, 100),
  offset: optionalInteger(0),
  includeBody: optionalText
    .refine((value) => value === undefined || value === "true" || value === "false", "must be true or false")
    .transform((value) => value === undefined ? undefined : value === "true"),
});

router.get("/news/meta", async (req, res): Promise<void> => {
  try {
    const items = await getNews();
    const categorySet = new Set<string>();
    const monthSet = new Set<string>();
    for (const item of items) {
      for (const cat of item.categories) categorySet.add(cat);
      for (const my of item.monthYears) monthSet.add(my);
    }
    res.json(GetNewsMetaResponse.parse({ categories: Array.from(categorySet).sort(), months: Array.from(monthSet) }));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch news meta");
    res.status(500).json({ error: "Failed to fetch news metadata" });
  }
});

router.get("/news/:id", async (req, res): Promise<void> => {
  try {
    const item = findNewsItem(await getNews(), req.params.id);
    if (!item) {
      res.status(404).json({ error: "News item not found" });
      return;
    }
    res.json(toListItem(item, true));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch news item");
    res.status(500).json({ error: "Failed to fetch news item" });
  }
});

router.get("/news", async (req, res): Promise<void> => {
  const parsed = NewsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid news query parameters", issues: parsed.error.issues });
    return;
  }

  try {
    const { limit, offset, includeBody, ...filters } = parsed.data;
    const filtered = filterNewsItems(await getNews(), filters);
    const result = listNewsItems(filtered, { limit, offset });
    res.json({ ...result, items: result.items.map((item) => toListItem(item, includeBody !== false)) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch news");
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

export default router;
