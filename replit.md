# Milo

Milo helps friend groups decide where to eat together, considering preferences, constraints, and travel burden. It supports a group decision; it does not make the decision for them. See `README.md` for the public overview and setup instructions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server behind the managed `/api` route
- `pnpm --filter @workspace/milo run dev` — web app behind the managed `/` route
- `pnpm run typecheck` — typecheck all packages
- `PORT=8081 BASE_PATH=/ pnpm run build` — typecheck and build all artifacts from a standalone shell (the managed workflows inject their own port and base path)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate client and Zod code after OpenAPI edits
- `pnpm --filter @workspace/db run push` — development database schema only
- The API requires `DATABASE_URL`; Understanding requires both `AI_INTEGRATIONS_OPENAI_*` variables; restaurant search requires `GOOGLE_MAPS_API_KEY`. Keep values in Secrets, never source files.

## Structure

- `artifacts/milo/` — React/Vite landing page and room experience
- `artifacts/api-server/` — Express routes, Understanding worker, server-side Google adapter, and suggestion evaluation
- `lib/api-spec/`, `lib/api-zod/`, `lib/api-client-react/`, `lib/db/` — API contract, generated clients, and PostgreSQL schema
- `artifacts/mockup-sandbox/` — component preview for design work

## Product invariants

- Group chat is persistent and Understanding links insights to source messages.
- Participants confirm their own approximate starting areas. Search starts only when a member requests it.
- AI extracts preferences; Google supplies current restaurant and route facts. Do not invent verified place or travel facts.
- Unknown facts remain unverified. Keep hard constraints distinct from softer preferences.
- Keep provider keys and raw provider errors out of browser responses and logs.
