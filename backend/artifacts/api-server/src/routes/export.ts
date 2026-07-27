import { Router } from "express";
import ExcelJS from "exceljs";
import { ListNewsQueryParams } from "@workspace/api-zod";
import { groupByMonth } from "../lib/scraper.js";
import { getNews } from "../lib/news-cache.js";
import { filterNewsItems } from "../lib/news-query.js";
import { logger } from "../lib/logger.js";

const exportRouter = Router();

// Same filters /api/news exposes; no limit/offset/includeBody — export is unpaginated.
// hpMapping is added via .extend, mirroring news.ts: the built @workspace/api-zod
// dist predates that field, so it isn't in ListNewsQueryParams's shape yet. .pick()
// first (on the fields the stale type does know about) so limit/offset/includeBody
// — present on the real runtime schema — get dropped rather than silently accepted.
export const ExportQueryParams = ListNewsQueryParams.pick({
  q: true,
  category: true,
  month: true,
  source: true,
  classification: true,
}).extend({
  hpMapping: ListNewsQueryParams.shape.q,
});

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF005A9C" },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFFFFFFF" },
  bold: true,
  size: 11,
};

function formatPostedAt(d: Date): string {
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${month}/${day}/${year} ${hours}:${mins} ${ampm}`;
}

const COLUMNS: Array<{
  header: string;
  key: string;
  width: number;
}> = [
  { header: "Title", key: "title", width: 55 },
  { header: "Link", key: "link", width: 60 },
  { header: "Published Date", key: "publishedDate", width: 18 },
  { header: "Summary", key: "summary", width: 70 },
  { header: "Source", key: "source", width: 14 },
  { header: "Type", key: "classification", width: 16 },
  { header: "DHCS Category", key: "categories", width: 35 },
  { header: "Time Posted", key: "postedAt", width: 20 },
  { header: "HP Mapping", key: "hpMappings", width: 45 },
];

exportRouter.get("/export.xlsx", async (req, res) => {
  const parsed = ExportQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid export query parameters", issues: parsed.error.issues });
    return;
  }

  try {
    logger.info({ filters: parsed.data }, "Fetching news for Excel export");
    const allItems = await getNews();
    const items = filterNewsItems(allItems, parsed.data);
    const grouped = groupByMonth(items);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Medi-Cal RSS Exporter";
    workbook.created = new Date();

    if (grouped.size === 0) {
      // No matches: still emit a valid workbook, headers only.
      const sheet = workbook.addWorksheet("Results");
      sheet.columns = COLUMNS;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
      headerRow.height = 20;

      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: COLUMNS.length },
      };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    }

    for (const [monthYear, { items: monthItems }] of grouped) {
      const safeSheetName = monthYear.slice(0, 31);
      const sheet = workbook.addWorksheet(safeSheetName);

      sheet.columns = COLUMNS;

      const headerRow = sheet.getRow(1);
      headerRow.eachCell((cell) => {
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: "middle", horizontal: "left" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
      headerRow.height = 20;

      for (const item of monthItems) {
        const row = sheet.addRow({
          title: item.title,
          link: item.link,
          publishedDate: item.publishedDate,
          summary: item.summary,
          source: item.source,
          classification: item.classification,
          categories: item.categories.join(", "),
          postedAt: formatPostedAt(item.postedAt),
          hpMappings: item.hpMappings.join(", "),
        });

        // Hyperlink the URL column
        const linkCell = row.getCell("link");
        linkCell.value = { text: item.link, hyperlink: item.link };
        linkCell.font = { color: { argb: "FF0563C1" }, underline: true };

        // Format date column
        const pubCell = row.getCell("publishedDate");
        pubCell.numFmt = "mm/dd/yyyy";

        row.eachCell((cell) => {
          cell.alignment = { ...cell.alignment, wrapText: true, vertical: "top" };
        });
      }

      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: COLUMNS.length },
      };

      sheet.views = [{ state: "frozen", ySplit: 1 }];
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="medi-cal-publications-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    );
    res.setHeader("Cache-Control", "no-store");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error(err, "Failed to generate Excel export");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate Excel export" });
    }
  }
});

export default exportRouter;
