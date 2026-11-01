import { HttpError } from "./errors";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character] ?? character;
  });
}

export function emailIsConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function actionUrl(path: string, token: string, requestOrigin?: string) {
  const configuredOrigin = process.env.FRONTEND_ORIGIN;
  const origin = configuredOrigin ?? requestOrigin;
  if (!origin) {
    throw new HttpError(503, "Email delivery is not configured on this server.");
  }

  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    throw new HttpError(503, "Email delivery is not configured on this server.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (url.protocol !== "https:" || !configuredOrigin)
  ) {
    throw new HttpError(503, "Email delivery is not configured on this server.");
  }
  url.searchParams.set("token", token);
  return url.toString();
}

async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new HttpError(503, "Email delivery is not configured on this server.");
  }

  let response: Response;
  try {
    const { to, ...message } = input;
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], ...message }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(503, "Email delivery is temporarily unavailable.");
  }
  if (!response.ok) {
    throw new HttpError(503, "Email delivery is temporarily unavailable.");
  }
}

export async function sendVerificationEmail(
  input: { to: string; name: string; token: string },
  requestOrigin?: string,
) {
  const url = actionUrl("/verify-email", input.token, requestOrigin);
  const name = escapeHtml(input.name);
  await sendEmail({
    to: input.to,
    subject: "Verify your Sedibeng email",
    text: `Hello ${input.name}, verify your email address by visiting: ${url}`,
    html: `<p>Hello ${name},</p><p>Verify your email address to finish setting up your Sedibeng account.</p><p><a href="${url}">Verify email</a></p><p>If you did not request this account, you can ignore this message.</p>`,
  });
}

export async function sendPasswordResetEmail(
  input: { to: string; name: string; token: string },
  requestOrigin?: string,
) {
  const url = actionUrl("/reset-password", input.token, requestOrigin);
  const name = escapeHtml(input.name);
  await sendEmail({
    to: input.to,
    subject: "Reset your Sedibeng password",
    text: `Hello ${input.name}, reset your password by visiting: ${url}`,
    html: `<p>Hello ${name},</p><p>Use the link below to choose a new Sedibeng password. It expires in one hour.</p><p><a href="${url}">Reset password</a></p><p>If you did not request this, you can ignore this message.</p>`,
  });
}
