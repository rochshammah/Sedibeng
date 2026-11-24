import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { isDatabaseConfigured, requireDb, userSessionsTable, usersTable } from "@workspace/db";
import { HttpError } from "./errors";
import {
  isBootstrapRequest,
  isOriginAllowed,
  isSafeMethod,
  sessionCookieName,
  sessionTokenHash,
  verifyCsrfRequest,
} from "./security";
import type { UserRole } from "../types/auth";

export async function loadSession(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const rawSessionId = request.cookies?.[sessionCookieName()];
  if (!isDatabaseConfigured || typeof rawSessionId !== "string") {
    next();
    return;
  }

  if (rawSessionId.length > 128) {
    response.clearCookie(sessionCookieName(), { path: "/" });
    next();
    return;
  }

  const [record] = await requireDb()
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
      emailVerifiedAt: usersTable.emailVerifiedAt,
      expiresAt: userSessionsTable.expiresAt,
      sessionHash: userSessionsTable.sessionHash,
    })
    .from(userSessionsTable)
    .innerJoin(usersTable, eq(userSessionsTable.userId, usersTable.id))
    .where(eq(userSessionsTable.sessionHash, sessionTokenHash(rawSessionId)))
    .limit(1);

  if (
    !record ||
    record.expiresAt <= new Date() ||
    record.status !== "ACTIVE" ||
    !record.emailVerifiedAt
  ) {
    if (record) {
      await requireDb()
        .delete(userSessionsTable)
        .where(eq(userSessionsTable.sessionHash, record.sessionHash));
    }
    response.clearCookie(sessionCookieName(), { path: "/" });
    next();
    return;
  }

  request.authUser = {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    status: record.status,
    emailVerifiedAt: record.emailVerifiedAt,
  };
  next();
}

export function requireAuth(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  if (!request.authUser) {
    next(new HttpError(401, "Sign in to continue."));
    return;
  }
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.authUser) {
      next(new HttpError(401, "Sign in to continue."));
      return;
    }
    if (!roles.includes(request.authUser.role)) {
      next(new HttpError(403, "You do not have permission to perform this action."));
      return;
    }
    next();
  };
}

export function csrfProtection(
  request: Request,
  _response: Response,
  next: NextFunction,
) {
  if (isSafeMethod(request.method) || isBootstrapRequest(request)) {
    next();
    return;
  }
  const origin = request.get("origin");
  if (
    !origin ||
    !isOriginAllowed(request, origin) ||
    !verifyCsrfRequest(request)
  ) {
    next(new HttpError(403, "The request could not be verified. Refresh and try again."));
    return;
  }
  next();
}
