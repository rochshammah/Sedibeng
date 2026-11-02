# Sedibeng deployment guide

This guide deploys the web app to Vercel, the API to Render, and PostgreSQL to Neon. Keep all database and service credentials on the API host; the browser must never receive them.

## 1. Create the Neon database

1. Sign in to Neon and create a PostgreSQL project. Choose a region close to the Render service.
2. In Neon, open **Connect**, select the project, branch, and database, then copy the connection URI. Keep the SSL parameters provided by Neon.
3. Use the pooled connection option for the long-running API service when Neon offers one. Keep the connection URI private.
4. In Replit, add the URI to **Secrets** under `NEON_DATABASE_URL`. Do not set this app's connection under Replit's `DATABASE_URL`.
5. In Render, add the same Neon URI as the server-only environment variable `DATABASE_URL`.
6. With `NEON_DATABASE_URL` available in Replit, apply the schema:

   ```sh
   pnpm --filter @workspace/db run migrate
   ```

   This applies pending Drizzle migrations to Neon. It does not create or migrate a database automatically during app startup. Review and back up important production data before applying future migrations.

7. Do not run `drizzle-kit push` against production. The development seed script is optional and must only be used against a non-production database:

   ```sh
   pnpm --filter @workspace/db run seed:development
   ```

## 2. Configure email and session security

Create and verify a sending domain with your email provider (the API currently sends through Resend). Add these values to Replit Secrets for development and to the Render service's environment settings for production:

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | Your email provider's server-side API key |
| `EMAIL_FROM` | A verified sender, for example `Sedibeng <accounts@your-domain.org>` |
| `FRONTEND_ORIGIN` | The exact HTTPS origin of the deployed web app, with no trailing slash |
| `CORS_ORIGINS` | Optional comma-separated list of additional approved browser origins |
| `SESSION_SECRET` | A random secret of at least 32 bytes, stored only in the host's secret manager |

The existing `SESSION_SECRET` in the Replit workspace is available for development; do not print it, commit it, or place it in a Vite variable. Generate a separate production secret and keep it stable across API instances. Verification and password-reset emails link to `FRONTEND_ORIGIN`.

Production cookies use HTTPS and `SameSite=None` by default so browser requests can carry a session between the web and API origins. For the most reliable browser behavior, give Vercel and Render subdomains of the same domain, such as `www.example.org` and `api.example.org`. If using unrelated domains, browsers that block third-party cookies may prevent sign-in from persisting even when CORS is correct.

## 3. Deploy the API to Render

1. Create a Render **Web Service** from the repository. Set the repository root as the service root.
2. Use these commands:

   - Build: `pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server run build`
   - Pre-deploy: `pnpm --filter @workspace/db run migrate`
   - Start: `pnpm --filter @workspace/api-server run start`

   If your Render plan does not provide a pre-deploy command, run the migration command from the Replit Shell after configuring `NEON_DATABASE_URL`, before sending production traffic.

3. Add the environment variables from sections 1–2 to the Render service. Also set:

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `ADMIN_BOOTSTRAP_SECRET` | A temporary random value of at least 32 characters; remove it after creating the first administrator |
   | `COOKIE_SAME_SITE` | Leave unset for the secure production default, or set to `none` for cross-site hosting |

   Render supplies `PORT`; do not hard-code it in the service settings.

4. Set the Render health-check path to `/api/healthz`. Confirm it returns a successful response after the first deployment.
5. Add a custom API domain if available, such as `api.example.org`, and keep it on the same parent domain as the Vercel web domain.

## 4. Create the first administrator

The app does not offer public administrator registration. After the API is online and its database migration has run:

1. Use an HTTPS API client to send a one-time `POST` request to:

   `https://YOUR_API_ORIGIN/api/v1/admin/bootstrap`

2. Add the header `X-Bootstrap-Secret` with the temporary `ADMIN_BOOTSTRAP_SECRET`.
3. Send JSON with `name`, `email`, and a strong `password` of at least 12 characters.
4. Confirm the API returns `201`, then immediately remove `ADMIN_BOOTSTRAP_SECRET` from Render and redeploy the API. The endpoint also refuses to create another administrator once one exists.
5. Sign in through the web app and use the administrator workspace to review account verification and school requests.

Do not put the bootstrap value or administrator password in source control, Vercel settings, screenshots, or shared logs.

## 5. Deploy the web app to Vercel

1. Import the same repository into Vercel and set the project root to the repository root.
2. Configure the project:

   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/sedibeng run build`
   - Output directory: `artifacts/sedibeng/dist/public`

   The checked-in `vercel.json` rewrites app routes to the Vite entry page so nested routes such as `/register/donor` and `/dashboard/teacher` load directly.

3. Add this Vercel environment variable for Production. Also set it for the Preview environment if those builds should connect to a test API:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | The API origin, for example `https://api.example.org`, with no trailing slash and no `/api` suffix |

   The generated API client appends `/api/v1` to this origin. This value is public; never put database URLs, email API keys, session secrets, or bootstrap secrets in Vercel's `VITE_` variables.

4. Add the Vercel web domain to Render's `FRONTEND_ORIGIN`. Add any additional approved domains to `CORS_ORIGINS` as comma-separated origins. Redeploy the API after changing them.
5. Add the Vercel custom domain, preferably under the same parent domain as the Render API domain. Redeploy the web app after setting `VITE_API_BASE_URL`.

## 6. Verify the deployed flows

Run these checks after both services are live:

1. Open `https://YOUR_API_ORIGIN/api/healthz`; confirm the health check succeeds.
2. Open the web app and browse requests. A database or API configuration problem should show an error with a retry action, not invented records.
3. Register a donor and a teacher with test email addresses. Confirm each receives an email verification link and can verify the address.
4. Sign in as each test account. Confirm donor, teacher, and administrator accounts only reach their own workspaces.
5. Submit an account-verification note, review it as an administrator, and approve it. Teachers can then submit requests; verified donors can offer goods.
6. Approve a request as an administrator, submit a goods offer as a donor, decide it as a teacher, mark the goods ready as the donor, and confirm receipt as the teacher.
7. Test password recovery from request through the email link and a successful new sign-in.
8. Confirm that unauthorized requests return `401`, wrong-role requests return `403`, and public request data contains no learner identities or private review notes.

The current verification workflow is administrator-reviewed account information and a user-submitted note. Private document storage/upload is not part of this implementation; do not claim that verification documents have been collected.

## Environment variable summary

| Service | Required variables |
| --- | --- |
| Replit development | `NEON_DATABASE_URL`, `SESSION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`; set `FRONTEND_ORIGIN` when email links should use a fixed development origin |
| Render API | `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`, `FRONTEND_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM`; temporary `ADMIN_BOOTSTRAP_SECRET` |
| Vercel web | `VITE_API_BASE_URL` |
