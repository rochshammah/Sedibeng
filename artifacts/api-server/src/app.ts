import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./lib/errors";

const app: Express = express();

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
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
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, false);
        return;
      }
      const configuredOrigins = [
        process.env.FRONTEND_ORIGIN,
        ...(process.env.CORS_ORIGINS ?? "").split(","),
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => {
          try {
            return new URL(value.trim()).origin;
          } catch {
            return "";
          }
        });
      if (process.env.NODE_ENV !== "production") {
        configuredOrigins.push("http://localhost:5173", "http://127.0.0.1:5173");
      }
      let normalizedOrigin = "";
      try {
        normalizedOrigin = new URL(origin).origin;
      } catch {
        callback(null, false);
        return;
      }
      callback(null, configuredOrigins.includes(normalizedOrigin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Bootstrap-Secret"],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", router);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
