import type { ErrorRequestHandler, RequestHandler } from "express";
import { DatabaseUnavailableError } from "@workspace/db";
import { logger } from "./logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "The requested resource was not found." });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (res.headersSent) return;

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  if (error instanceof DatabaseUnavailableError) {
    res.status(503).json({
      error: "The service is not connected to its database.",
    });
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }

  logger.error(
    {
      requestId: req.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    },
    "Request failed",
  );
  res.status(500).json({ error: "An unexpected error occurred." });
};
