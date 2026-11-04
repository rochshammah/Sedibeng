# Sedibeng deployment guide

This guide uses the services you already created:

- Website: Vercel — `https://sedibeng.vercel.app`
- API: Render — `https://sedibeng.onrender.com`
- Database: Neon

The website now sends its `/api/...` requests through Vercel to Render. This means **you do not need to add `VITE_API_BASE_URL` or any other variable in Vercel**. Do not put database credentials or server secrets in Vercel.

## Fix the current “Secure connection unavailable” screen

The Render API is responding, but its secure-session endpoint currently says that `SESSION_SECRET` is not configured. The API also needs its database schema applied. Do these steps:

### 1. Add the missing Render settings

In Render, open the `sedibeng` web service, then **Environment**. Keep the values you already added and check these:

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon PostgreSQL connection string. Keep it private. |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | `https://sedibeng.vercel.app` — no trailing slash |
| `SESSION_SECRET` | A newly generated random value at least 32 characters long |

Use a password manager to generate `SESSION_SECRET`. Do not use your Neon password, and do not share or put this value in Vercel. Save the Environment settings and redeploy the Render service so the running API receives them.

### 2. Apply the database migration

In the Render service's **Settings → Build & Deploy**, set the **Pre-Deploy Command** to:

```sh
pnpm --filter @workspace/db run migrate
```

Save and deploy. This applies the migration files already in the repository to the database named by Render's `DATABASE_URL`.

If your Render plan does not show a Pre-Deploy Command, run this once from the Replit Shell instead:

1. In Replit Secrets, temporarily add `NEON_DATABASE_URL` with the same Neon production connection string used for Render's `DATABASE_URL`.
2. Run:

   ```sh
   pnpm --filter @workspace/db run migrate
   ```

3. Remove `NEON_DATABASE_URL` from Replit Secrets when the command finishes. **Do not run the development seed command against this production database.**

### 3. Redeploy the website

Deploy the latest project code to Vercel. No Vercel environment variables are needed. If you previously added `VITE_API_BASE_URL`, remove it; the Vercel rewrite now routes API calls to Render and keeps sign-in cookies on the website's domain.

If you need to check the Vercel build settings, open **Project Settings → Build and Deployment**:

| Setting | Value |
| --- | --- |
| Root Directory | Repository root (`.`) |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/sedibeng run build` |
| Output Directory | `artifacts/sedibeng/dist/public` |

The checked-in `vercel.json` routes `/api/...` to Render and sends other paths to the website, so direct links such as `/register/donor` continue to work.

## Confirm the fix

After both services finish deploying, open these links:

1. `https://sedibeng.onrender.com/api/healthz` — should show `{"status":"ok"}`.
2. `https://sedibeng.onrender.com/api/v1/auth/csrf` — should return status 200 and a JSON `csrfToken`.
3. `https://sedibeng.vercel.app/api/healthz` — should also show `{"status":"ok"}`. This confirms Vercel is proxying API requests to Render.
4. Reload `https://sedibeng.vercel.app`. The secure-connection message should be gone.

If the first health check works but the second still returns 503, confirm `SESSION_SECRET` is saved on the Render **web service** and redeploy that service. If `/api/v1/requests` returns 500 after the migration, open Render's service logs and check the database error; the usual causes are an unapplied migration or an incorrect `DATABASE_URL`.

## Enable account verification and password recovery emails

Registration verification and password recovery send email through Resend. Add these to the Render service's Environment settings:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | Your Resend API key |
| `EMAIL_FROM` | A sender address verified with Resend, such as `Sedibeng <accounts@your-domain.org>` |

Save and redeploy Render. Without these settings, the website can load, but registration and password recovery emails cannot be sent.

## Create the first administrator

Administrator accounts are not created through public registration.

1. Temporarily add `ADMIN_BOOTSTRAP_SECRET` to Render. Generate a separate random value of at least 32 characters.
2. After the database migration is applied, send this request from a terminal, replacing the example values:

   ```sh
   curl -X POST https://sedibeng.onrender.com/api/v1/admin/bootstrap \
     -H "Content-Type: application/json" \
     -H "X-Bootstrap-Secret: YOUR_TEMPORARY_SECRET" \
     -d '{"name":"Your Name","email":"you@example.com","password":"Use-A-Strong-Password-Here"}'
   ```

3. After a successful response, remove `ADMIN_BOOTSTRAP_SECRET` from Render and redeploy. The bootstrap endpoint will not create another administrator once one exists.

## How future database changes are deployed

Changing a TypeScript schema file does **not** change the Neon database by itself. For each schema change:

1. Edit the schema in the project.
2. Generate a migration:

   ```sh
   pnpm --filter @workspace/db run generate
   ```

3. Review the generated SQL, then commit the schema change and migration files together.
4. Deploy the code. Render's Pre-Deploy Command runs `pnpm --filter @workspace/db run migrate` and applies migrations that have not run yet.

This is automatic **only after** the Pre-Deploy Command is configured and the generated migration files are included in the deployment. If there is no Pre-Deploy Command on your Render plan, run the migration manually before sending traffic to the new API code.

For safer development, use a separate Neon development branch/database for testing and keep Render pointed at the production branch. Never use `drizzle-kit push` or the development seed script on production.

