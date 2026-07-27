import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve dashboard static files in production
const dashboardDist = path.resolve(__dirname, "../../dashboard/dist/public");
app.use(express.static(dashboardDist));
app.get("{*path}", (req, res, next) => {
  // Only serve index.html for non-API routes
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(dashboardDist, "index.html"));
});

export default app;
