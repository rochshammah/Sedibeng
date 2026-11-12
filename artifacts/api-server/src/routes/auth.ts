import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  BootstrapAdminBody,
  BootstrapAdminResponse,
  GetAuthSessionResponse,
  GetCsrfTokenResponse,
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterDonorBody,
  RegisterDonorResponse,
  RegisterTeacherBody,
  RegisterTeacherResponse,
  RequestPasswordResetBody,
  RequestPasswordResetResponse,
  ResetPasswordBody,
  ResetPasswordResponse,
  ResendVerificationEmailBody,
  ResendVerificationEmailResponse,
  UpdateCurrentUserBody,
  UpdateCurrentUserResponse,
  VerifyEmailBody,
  VerifyEmailResponse,
} from "@workspace/api-zod";
import {
  auditLogsTable,
  emailVerificationTokensTable,
  isDatabaseConfigured,
  passwordResetTokensTable,
  requireDb,
  schoolsTable,
  teacherProfilesTable,
  userSessionsTable,
  usersTable,
  verificationRecordsTable,
} from "@workspace/db";
import type { AuthenticatedPrincipal, UserRole } from "../types/auth";
import { loadSession, requireAuth } from "../lib/auth-middleware";
import { emailIsConfigured, sendPasswordResetEmail, sendVerificationEmail } from "../lib/email";
import { HttpError } from "../lib/errors";
import {
  clearSessionCookie,
  createOneTimeToken,
  createSession,
  digestOneTimeToken,
  hashPassword,
  issueCsrfToken,
  publicUser,
  revokeCurrentSession,
  safeEqual,
  verifyPassword,
} from "../lib/security";

const router = Router();

const accountLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many attempts. Try again later." });
  },
});

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ error: "Too many sign-in attempts. Try again later." });
  },
});

type ContractSchema<T> = {
  safeParse: (
    value: unknown,
  ) =>
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string }> } };
};

function parseBody<T>(
  schema: ContractSchema<T>,
  body: unknown,
  response: Response,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    response.status(400).json({
      error: result.error.issues[0]?.message ?? "The request is not valid.",
    });
    return null;
  }
  return result.data;
}

function asPrincipal(user: {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
  emailVerifiedAt: Date | null;
}): AuthenticatedPrincipal {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

function requestOrigin(request: Request) {
  return request.get("origin");
}

async function writeAudit(
  actorUserId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  await requireDb().insert(auditLogsTable).values({
    actorUserId,
    action,
    targetType,
    targetId,
    metadata,
  });
}

async function registerAccount(
  request: Request,
  response: Response,
  role: "DONOR" | "TEACHER",
) {
  const schema = role === "DONOR" ? RegisterDonorBody : RegisterTeacherBody;
  const input = parseBody(schema, request.body, response);
  if (!input) return;
  if (!isDatabaseConfigured) {
    throw new HttpError(503, "The service is not connected to its database.");
  }
  if (!emailIsConfigured()) {
    throw new HttpError(503, "Email delivery is not configured on this server.");
  }

  const database = requireDb();
  const email = input.email.trim().toLowerCase();
  const [existing] = await database
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);
  if (existing) {
    throw new HttpError(409, "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const token = createOneTimeToken();
  const tokenHash = digestOneTimeToken(token);
  const now = new Date();
  const [user] = await database.transaction(async (tx) => {
    const [createdUser] = await tx
      .insert(usersTable)
      .values({
        name: input.name.trim(),
        email,
        passwordHash,
        role,
        status: "PENDING_VERIFICATION",
      })
      .returning();

    if (role === "TEACHER") {
      const teacherInput = input as unknown as {
        schoolId?: string;
        schoolName?: string;
        district?: string;
        area?: string;
      };
      let schoolId: string | undefined;
      if (teacherInput.schoolId) {
        // Preferred: pick a school from the administrator-managed directory.
        const [chosen] = await tx
          .select({ id: schoolsTable.id })
          .from(schoolsTable)
          .where(sql`${schoolsTable.id} = ${teacherInput.schoolId} and ${schoolsTable.status} = 'ACTIVE'`)
          .limit(1);
        if (!chosen) throw new HttpError(400, "Please choose a school from the list.");
        schoolId = chosen.id;
      } else {
        if (!teacherInput.schoolName?.trim() || !teacherInput.district?.trim()) {
          throw new HttpError(400, "Choose your school, or enter its name and district.");
        }
        const schoolName = teacherInput.schoolName.trim();
        const district = teacherInput.district.trim();
        const area = teacherInput.area?.trim() || null;
        const [existingSchool] = await tx
          .select({ id: schoolsTable.id })
          .from(schoolsTable)
          .where(
            sql`lower(${schoolsTable.name}) = ${schoolName.toLowerCase()}
              and lower(${schoolsTable.district}) = ${district.toLowerCase()}
              and lower(coalesce(${schoolsTable.area}, '')) = ${(area ?? "").toLowerCase()}`,
          )
          .limit(1);
        schoolId = existingSchool?.id;
        if (!schoolId) {
          // A school that is not in the directory yet waits for an administrator to confirm it.
          const [school] = await tx
            .insert(schoolsTable)
            .values({ name: schoolName, district, area, status: "PENDING_REVIEW" })
            .returning({ id: schoolsTable.id });
          schoolId = school.id;
        }
      }
      await tx.insert(teacherProfilesTable).values({
        userId: createdUser.id,
        schoolId,
      });
    }

    // Donors start a single verification request. Teachers verify in two stages
    // (identity, then professional) which they submit later with documents.
    if (role === "DONOR") {
      await tx.insert(verificationRecordsTable).values({
        userId: createdUser.id,
        type: "DONOR",
        status: "PENDING",
      });
    }
    await tx.insert(emailVerificationTokensTable).values({
      userId: createdUser.id,
      tokenHash,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    await tx.insert(auditLogsTable).values({
      actorUserId: createdUser.id,
      action: "ACCOUNT_REGISTERED",
      targetType: "USER",
      targetId: createdUser.id,
      metadata: { role },
    });
    return [createdUser] as const;
  });

  try {
    await sendVerificationEmail(
      { to: user.email, name: user.name, token },
      requestOrigin(request),
    );
  } catch {
    throw new HttpError(
      503,
      "Your account was created, but its verification email could not be sent. Request another verification email.",
    );
  }

  const result = { message: "Check your email to verify your account." };
  const contract =
    role === "DONOR" ? RegisterDonorResponse : RegisterTeacherResponse;
  response.status(201).json(contract.parse(result));
}

router.get("/auth/csrf", (_request, response) => {
  response.json(GetCsrfTokenResponse.parse({ csrfToken: issueCsrfToken(response) }));
});

router.get("/auth/session", loadSession, (request, response) => {
  response.json(
    GetAuthSessionResponse.parse({
      user: request.authUser ? publicUser(request.authUser) : null,
    }),
  );
});

router.post("/auth/register/donor", accountLimit, async (request, response) => {
  await registerAccount(request, response, "DONOR");
});

router.post("/auth/register/teacher", accountLimit, async (request, response) => {
  await registerAccount(request, response, "TEACHER");
});

router.post("/auth/login", loginLimit, async (request, response) => {
  const input = parseBody(LoginBody, request.body, response);
  if (!input) return;
  const email = input.email.trim().toLowerCase();
  const [user] = await requireDb()
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    await hashPassword(input.password);
    await writeAudit(null, "SIGN_IN_FAILED", "USER", null);
    throw new HttpError(401, "Email or password is incorrect.");
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatches) {
    await writeAudit(null, "SIGN_IN_FAILED", "USER", user.id);
    throw new HttpError(401, "Email or password is incorrect.");
  }
  if (!user.emailVerifiedAt || user.status === "PENDING_VERIFICATION") {
    throw new HttpError(403, "Verify your email before signing in.");
  }
  if (user.status !== "ACTIVE") {
    throw new HttpError(403, "This account cannot sign in.");
  }

  const principal = asPrincipal(user);
  await revokeCurrentSession(request, response);
  await createSession(principal, response);
  await writeAudit(user.id, "SIGNED_IN", "USER", user.id);
  response.json(
    LoginResponse.parse({ user: publicUser(principal) }),
  );
});

router.post("/auth/logout", async (request, response) => {
  if (request.authUser) {
    await writeAudit(request.authUser.id, "SIGNED_OUT", "USER", request.authUser.id);
  }
  await revokeCurrentSession(request, response);
  response.json(LogoutResponse.parse({ message: "You have signed out." }));
});

router.post(
  "/auth/password/forgot",
  accountLimit,
  async (request, response) => {
    const input = parseBody(RequestPasswordResetBody, request.body, response);
    if (!input) return;
    if (!emailIsConfigured()) {
      throw new HttpError(503, "Email delivery is not configured on this server.");
    }
    const email = input.email.trim().toLowerCase();
    const [user] = await requireDb()
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        status: usersTable.status,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (user && user.status !== "SUSPENDED") {
      const token = createOneTimeToken();
      const now = new Date();
      await requireDb().transaction(async (tx) => {
        await tx
          .delete(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.userId, user.id));
        await tx.insert(passwordResetTokensTable).values({
          userId: user.id,
          tokenHash: digestOneTimeToken(token),
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        });
      });
      await sendPasswordResetEmail(
        { to: user.email, name: user.name, token },
        requestOrigin(request),
      );
      await writeAudit(user.id, "PASSWORD_RESET_REQUESTED", "USER", user.id);
    }

    response
      .status(202)
      .json(
        RequestPasswordResetResponse.parse({
          message: "If an account matches that email, a reset link will be sent.",
        }),
      );
  },
);

router.post("/auth/password/reset", accountLimit, async (request, response) => {
  const input = parseBody(ResetPasswordBody, request.body, response);
  if (!input) return;
  const now = new Date();
  const tokenHash = digestOneTimeToken(input.token);
  const passwordHash = await hashPassword(input.newPassword);
  const database = requireDb();
  const userId = await database.transaction(async (tx) => {
    const [consumed] = await tx
      .update(passwordResetTokensTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResetTokensTable.tokenHash, tokenHash),
          isNull(passwordResetTokensTable.consumedAt),
          gt(passwordResetTokensTable.expiresAt, now),
        ),
      )
      .returning({ userId: passwordResetTokensTable.userId });

    if (!consumed) return null;
    await tx
      .update(usersTable)
      .set({ passwordHash, updatedAt: now })
      .where(eq(usersTable.id, consumed.userId));
    await tx
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, consumed.userId));
    await tx
      .delete(userSessionsTable)
      .where(eq(userSessionsTable.userId, consumed.userId));
    await tx.insert(auditLogsTable).values({
      actorUserId: consumed.userId,
      action: "PASSWORD_RESET_COMPLETED",
      targetType: "USER",
      targetId: consumed.userId,
    });
    return consumed.userId;
  });

  if (!userId) throw new HttpError(400, "This password reset link is invalid or expired.");
  clearSessionCookie(response);
  response.json(
    ResetPasswordResponse.parse({ message: "Your password has been updated." }),
  );
});

router.post("/auth/email/verify", accountLimit, async (request, response) => {
  const input = parseBody(VerifyEmailBody, request.body, response);
  if (!input) return;
  const now = new Date();
  const tokenHash = digestOneTimeToken(input.token);
  const userId = await requireDb().transaction(async (tx) => {
    const [consumed] = await tx
      .update(emailVerificationTokensTable)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailVerificationTokensTable.tokenHash, tokenHash),
          isNull(emailVerificationTokensTable.consumedAt),
          gt(emailVerificationTokensTable.expiresAt, now),
        ),
      )
      .returning({ userId: emailVerificationTokensTable.userId });

    if (!consumed) return null;
    await tx
      .update(usersTable)
      .set({
        emailVerifiedAt: now,
        status: "ACTIVE",
        updatedAt: now,
      })
      .where(eq(usersTable.id, consumed.userId));
    await tx
      .update(verificationRecordsTable)
      .set({ status: "PENDING", updatedAt: now })
      .where(eq(verificationRecordsTable.userId, consumed.userId));
    await tx.insert(auditLogsTable).values({
      actorUserId: consumed.userId,
      action: "EMAIL_VERIFIED",
      targetType: "USER",
      targetId: consumed.userId,
    });
    return consumed.userId;
  });

  if (!userId) throw new HttpError(400, "This verification link is invalid or expired.");
  response.json(VerifyEmailResponse.parse({ message: "Your email has been verified." }));
});

router.post(
  "/auth/email/resend",
  accountLimit,
  async (request, response) => {
    const input = parseBody(ResendVerificationEmailBody, request.body, response);
    if (!input) return;
    if (!emailIsConfigured()) {
      throw new HttpError(503, "Email delivery is not configured on this server.");
    }
    const email = input.email.trim().toLowerCase();
    const [user] = await requireDb()
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        status: usersTable.status,
        emailVerifiedAt: usersTable.emailVerifiedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (user && user.status === "PENDING_VERIFICATION" && !user.emailVerifiedAt) {
      const token = createOneTimeToken();
      const now = new Date();
      await requireDb().transaction(async (tx) => {
        await tx
          .delete(emailVerificationTokensTable)
          .where(eq(emailVerificationTokensTable.userId, user.id));
        await tx.insert(emailVerificationTokensTable).values({
          userId: user.id,
          tokenHash: digestOneTimeToken(token),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      });
      await sendVerificationEmail(
        { to: user.email, name: user.name, token },
        requestOrigin(request),
      );
    }

    response
      .status(202)
      .json(
        ResendVerificationEmailResponse.parse({
          message: "If an account needs verification, a new link will be sent.",
        }),
      );
  },
);

router.get("/users/me", loadSession, requireAuth, (request, response) => {
  response.json(
    GetCurrentUserResponse.parse(publicUser(request.authUser!)),
  );
});

router.patch(
  "/users/me",
  loadSession,
  requireAuth,
  async (request, response) => {
    const input = parseBody(UpdateCurrentUserBody, request.body, response);
    if (!input) return;
    const [updated] = await requireDb()
      .update(usersTable)
      .set({ name: input.name.trim(), updatedAt: new Date() })
      .where(eq(usersTable.id, request.authUser!.id))
      .returning({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        role: usersTable.role,
        status: usersTable.status,
        emailVerifiedAt: usersTable.emailVerifiedAt,
      });
    response.json(
      UpdateCurrentUserResponse.parse(
        publicUser(asPrincipal(updated)),
      ),
    );
  },
);

router.post(
  "/admin/bootstrap",
  accountLimit,
  async (request, response) => {
    const providedSecret = request.get("x-bootstrap-secret") ?? "";
    const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET ?? "";
    if (
      expectedSecret.length < 32 ||
      !safeEqual(providedSecret, expectedSecret)
    ) {
      throw new HttpError(403, "Administrator provisioning is not authorized.");
    }
    const input = parseBody(BootstrapAdminBody, request.body, response);
    if (!input) return;

    const database = requireDb();
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    const admin = await database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(673598412)`);
      const [existingAdmin] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.role, "ADMIN"))
        .limit(1);
      if (existingAdmin) {
        throw new HttpError(409, "An administrator account already exists.");
      }
      const [existingEmail] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (existingEmail) {
        throw new HttpError(409, "An account with this email already exists.");
      }
      const [created] = await tx
        .insert(usersTable)
        .values({
          name: input.name.trim(),
          email,
          passwordHash,
          role: "ADMIN",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
        })
        .returning({ id: usersTable.id });
      await tx.insert(auditLogsTable).values({
        actorUserId: created.id,
        action: "ADMIN_BOOTSTRAPPED",
        targetType: "USER",
        targetId: created.id,
      });
      return created;
    });
    response.status(201).json(
      BootstrapAdminResponse.parse({
        message: "Administrator account created. Remove the bootstrap secret now.",
      }),
    );
  },
);

export default router;
