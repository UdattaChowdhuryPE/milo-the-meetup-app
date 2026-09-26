# Milo
### The best way to meet your friends.

**The group talks. Milo listens.**

Getting friends to agree on where to go is difficult when everyone has different preferences, constraints, budgets, locations, and opinions. Milo lets the group talk naturally instead of completing a long form. It turns that conversation into structured, source-linked insights, then finds real restaurant options that consider the group.

## Features

- Create a persistent room, share its link, and let friends join and chat.
- Extract group and individual preferences from the conversation; distinguish hard constraints from preferences and link insights back to their source messages.
- Let each participant confirm an approximate starting area rather than collecting a precise device location.
- On a group member's request, resolve those areas, search for real restaurants, and compare travel times.
- Explain each suggestion's fit, tradeoffs, and unknowns. Missing evidence stays unverified rather than becoming a claim.

## How It Works

Conversation → Milo Understanding → confirmed approximate locations → Google Geocoding and Places → Google Routes travel times → group-fit evaluation → explainable restaurant suggestions.

Milo's AI extracts structured insights from chat. Restaurant facts come from Google Places, while travel and fit evaluation follow deterministic application logic. A search runs only when a participant asks for options.

## Tech Stack

- **Web:** React, TypeScript, Vite
- **API:** Node.js, Express, TypeScript, OpenAPI-generated client and Zod schemas
- **Data:** PostgreSQL with Drizzle ORM
- **Understanding:** OpenAI SDK through Replit AI Integrations
- **Places and travel:** Google Maps Platform
- **Workspace:** pnpm monorepo on Node.js 24

The app lives in `artifacts/milo/`, the server in `artifacts/api-server/`, and shared API and database packages in `lib/`. `artifacts/mockup-sandbox/` is the Replit component-preview workspace, not a second product.

## Environment Variables

Copy `.env.example` as a list of the variables to configure; do not commit populated environment files. In Replit, use workspace Secrets and the managed PostgreSQL database.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for the API and schema tooling |
| `GOOGLE_MAPS_API_KEY` | Server-side Google Maps Platform requests |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | Replit AI Integrations access for Milo Understanding |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | Replit AI Integrations API endpoint |

The Replit workflows supply `PORT` and `BASE_PATH`; `LOG_LEVEL` is optional. No provider credentials belong in browser code or committed files.

## Local Development

1. Install Node.js 24 and pnpm, then run `pnpm install`.
2. Configure the four variables above in your local environment or Replit Secrets. Use a PostgreSQL database with this project's schema; for a new **development** database, run `pnpm --filter @workspace/db run push`.
3. In Replit, start the configured **API Server** and **Milo web** workflows. Their underlying commands are `pnpm --filter @workspace/api-server run dev` and `pnpm --filter @workspace/milo run dev`. The managed router maps `/api` to the server and `/` to the web app. Outside Replit, provide equivalent port and `/api` routing.

## Testing

```sh
pnpm run typecheck
PORT=8081 BASE_PATH=/ pnpm run build
node --experimental-strip-types --test artifacts/api-server/src/lib/google-places.test.mjs
pnpm --filter @workspace/api-server exec esbuild src/lib/suggestion-evaluation.test.ts --bundle --platform=node --format=esm --outfile=/tmp/milo-evaluation.test.mjs
node --test /tmp/milo-evaluation.test.mjs
```

The first test checks coordinate handling and safe provider failures without live Google calls; the second checks deterministic restaurant evaluation. The build checks the workspace and builds the artifacts. The explicit `PORT` and `BASE_PATH` are needed when building all artifacts from a standalone shell rather than their configured Replit workflows.

## Google Maps Setup

Enable **Geocoding API**, **Places API (New)**, and **Routes API** for the server-side Google Maps key. Milo uses Geocoding for confirmed area labels, Places Text Search and Place Details for restaurant facts, and Routes Compute Route Matrix for travel times. Configure appropriate Google Cloud billing and key restrictions for those APIs. The key is read by the API server, not shipped to the frontend.

## Deployment

The included Replit artifact configurations build the Vite web app and run the API on an autoscale deployment, with `/api` routed to the server. Set the required secrets for the published environment before publishing. Development and production databases are separate in Replit.

## Demo

The current published app is [Milo](https://milo-the-meetup-app.replit.app/). The public GitHub repository is a separate source-code publication; pushing code there does not update this deployment.