# Sedibeng

Sedibeng connects teachers with donors providing physical school essentials while protecting learner privacy and dignity.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/sedibeng run dev` — run the Sedibeng web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Phase 1 uses demonstration data and does not require a database connection.
- Configure Neon credentials in Replit Secrets when database integration is approved; never commit them.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/sedibeng` — public app, catalogue, authentication previews, dashboards, PWA shell and visual assets
- `artifacts/api-server` — shared Express API and read-only demonstration endpoints
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/api-client-react` and `lib/api-zod` — generated client hooks and validation schemas
- `lib/db` — existing Drizzle foundation; not connected by Sedibeng Phase 1

## Architecture decisions

- Phase 1 catalogue and dashboard APIs return explicitly labeled sample data; there is no persistence or real verification.
- Learner identities and private circumstances are excluded from public request data.
- Authentication screens are previews only. Do not implement local authentication; use a supported identity integration in a later phase.
- Donors provide physical goods only. No cash transfer or learner-to-donor contact flow.

## Product

- The public catalogue lets donors search demonstration requests for school shoes, uniforms, bags, books and stationery in Gaborone.
- Donor, teacher and admin areas preview future workflows and are not operational systems.
- Official slogan: “Sedibeng go iwa ka tsela”.

## User preferences

- Keep Phase 1 focused on a premium identity, responsive UI and a clean foundation; stop for review before Phase 2.
- Do not use public photographs of children or expose learner-identifying information.
- Clearly label demonstration data and never imply live verification, fulfilment or saved actions.

## Gotchas

- Regenerate API hooks and schemas after changing `lib/api-spec/openapi.yaml`.
- The PWA service worker caches only the public shell and static assets; never add API or private-response caching.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
