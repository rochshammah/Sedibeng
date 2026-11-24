# Sedibeng

Sedibeng connects teachers with donors providing physical school essentials while protecting learner privacy and dignity.

## Run & operate

- `pnpm --filter @workspace/api-server run dev` — run the API server on the configured `PORT`.
- `pnpm --filter @workspace/sedibeng run dev` — run the Sedibeng web app.
- `pnpm run typecheck` — typecheck workspace packages.
- `pnpm run build` — typecheck and build workspace artifacts.
- `pnpm --filter @workspace/api-server run test` — run API, authorization, CSRF, and password tests.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI contract.
- `pnpm --filter @workspace/db run generate` — generate Drizzle migrations.
- `pnpm --filter @workspace/db run migrate` — apply migrations to the configured PostgreSQL database.
- `pnpm --filter @workspace/db run seed:development` — add clearly marked sample records in development only.

## Stack

- pnpm workspaces, Node.js, TypeScript
- Web: React, Vite, Wouter, TanStack Query
- API: Express 5, generated OpenAPI contracts, Zod validation
- Database: PostgreSQL, Drizzle ORM, versioned migrations
- Authentication: secure server-side sessions, CSRF protection, scrypt password hashes, email verification and password recovery

## Where things live

- `artifacts/sedibeng` — public website, registration, dashboards, catalogue and PWA shell.
- `artifacts/api-server` — versioned API, authentication, role authorization and business routes.
- `lib/api-spec/openapi.yaml` — API contract source of truth.
- `lib/api-client-react` and `lib/api-zod` — generated API hooks and validation schemas.
- `lib/db` — database schema, migrations and development seed script.
- `DEPLOYMENT.md` — manual Neon, Render and Vercel setup instructions.

## Product and privacy rules

- Describe the app by its current capabilities and setup requirements. Do not label screens with internal development stages or imply features are disabled when they are implemented.
- Seed records are marked with `isSeedData`; hide them in production and identify them as development sample data when shown in development.
- Learners do not have accounts. Do not publish learner names, contact details, faces, documents or private circumstances.
- Donors provide physical goods only. Do not add cash transfer or learner-to-donor contact flows.
- Do not use public photographs of children.
- Official slogan: “Sedibeng go iwa ka tsela”.

## Configuration and security

- In Replit, configure the Neon connection as `NEON_DATABASE_URL`; do not use Replit's managed `DATABASE_URL` for this app.
- On deployment hosts such as Render, configure the Neon connection as `DATABASE_URL`.
- Keep database URLs, `SESSION_SECRET`, email credentials and admin bootstrap values in the host's secret manager, never in committed files or browser code.
- Set `VITE_API_BASE_URL` only when the web app and API use different origins. It is the API origin without a trailing slash.
- Configure `FRONTEND_ORIGIN` and `CORS_ORIGINS` for the deployed browser origin. Use HTTPS in production.
- The API uses `FRONTEND_ORIGIN`, `RESEND_API_KEY` and `EMAIL_FROM` to send verification and password-reset links.
- Remove `ADMIN_BOOTSTRAP_SECRET` after creating the first administrator.
- Never use `drizzle-kit push` for production. Apply committed migrations with the documented migration command.
- Never cache API responses or private account data in the PWA service worker.

## Gotchas

- Regenerate API hooks and schemas after changing `lib/api-spec/openapi.yaml`.
- The production seed script refuses to write sample data.
- The browser preview does not have a signed-in session; verify authenticated routes with tests or an authorized local browser session.
