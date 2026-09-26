# Milo

Milo helps friend groups decide where to go and what to do together, while considering everyone's preferences, constraints, and travel burden. It supports group decisions; it does not make the decision for them.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/milo run dev` — run the Milo web app through its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The current landing page needs no API, database, or app secrets.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Web: React + Vite, served at `/`
- Shared API/DB libraries exist in the workspace template but are not used by Milo's first feature.

## Where things live

- `artifacts/milo/src/App.tsx` — frontend-only landing page and geographic hero illustration
- `artifacts/milo/src/index.css` — Milo typography, colors, motion, and responsive styles
- `artifacts/milo/index.html` — page and social metadata

## Architecture decisions

- Build one explicitly requested feature at a time. Do not prebuild rooms, authentication, chat, AI, real maps, location search, recommendations, travel calculations, voting, or persistence.
- Keep AI reasoning separate from deterministic travel and ranking calculations when those features are eventually requested; do not invent factual place or travel data.

## Product

- Feature 1 is a responsive marketing landing page only. Its Create a room buttons explain that room creation is coming soon; they do not create rooms.

## User preferences

- The product is named **Milo**. Earlier background text also said “Converge,” but the explicit Feature 1 request establishes Milo branding.
- Preserve a warm, social, modern, geographic, premium consumer feel. Avoid generic AI SaaS styling, purple gradients, glowing blobs, robot/sparkle art, heavy glassmorphism, oversized rounded cards, and dashboard templates.
- Reuse Milo's existing visual language for subsequent features and do not redesign unrelated areas.

## Gotchas

- The app is intentionally frontend-only for Feature 1; the API server workflow does not need to be started to preview the landing page.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
