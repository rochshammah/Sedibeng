import app from "./app";
import { logger } from "./lib/logger";
import { unverifiedSignupAllowed } from "./lib/email";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

if (unverifiedSignupAllowed()) {
  logger.warn(
    "ALLOW_UNVERIFIED_EMAIL_SIGNUP is ON: new accounts skip email verification. This is for testing only. Configure Resend and remove the setting before launch.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
