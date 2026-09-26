import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import {
  db, pool, participantsTable, roomInsightsTable, roomSuggestionsTable, roomsTable,
  suggestionRunsTable, type ParticipantRecord, type RoomInsightRecord,
} from "@workspace/db";
import { logger } from "./logger";
import {
  geocodeArea, getDrivingMinutes, getPlaceDetails, hasPlacesKey, searchRestaurants,
  type Coordinates, type Place,
} from "./google-places";
import { evaluateRestaurant } from "./suggestion-evaluation";

type Context = {
  participants: ParticipantRecord[];
  insights: RoomInsightRecord[];
  origins: ParticipantRecord[];
  fingerprint: string;
  canSearch: boolean;
  readinessMessage: string | null;
};

const activeStatuses = new Set(["active", "conflicting"]);
const foodActivities = /\b(restaurant|dinner|lunch|brunch|breakfast|food|eat|meal|cafe|coffee)\b/i;

async function roomContext(roomId: string): Promise<Context> {
  const [participants, insights] = await Promise.all([
    db.select().from(participantsTable).where(eq(participantsTable.roomId, roomId)),
    db.select().from(roomInsightsTable).where(eq(roomInsightsTable.roomId, roomId)),
  ]);
  const current = insights.filter((item) => item.status !== "superseded");
  const usable = current.filter((item) => activeStatuses.has(item.status) && item.confidence !== "low");
  const origins = participants.filter((person) => {
    if (!person.originLabel) return false;
    if (!person.originSourceInsightId) return true;
    const source = insights.find((item) => item.id === person.originSourceInsightId);
    return Boolean(source && source.status === "active" && source.kind === "starting_location"
      && source.participantId === person.id
      && source.updatedAt.getTime() === person.originSourceInsightUpdatedAt?.getTime());
  });
  const hasFood = usable.some((item) => item.kind === "cuisine" || item.kind === "dietary"
    || (item.kind === "activity" && foodActivities.test(item.value)));
  const conflictingHardFood = usable.filter((item) =>
    item.status === "conflicting" && item.strength === "hard_constraint"
    && (item.kind === "cuisine" || item.kind === "dietary"));
  let readinessMessage: string | null = null;
  if (!hasFood) readinessMessage = "Talk about a meal or cuisine first so Milo knows what to look for.";
  else if (participants.length > 8) readinessMessage = "Restaurant search supports groups of up to eight people right now.";
  else if (!origins.length) readinessMessage = "Confirm at least one approximate starting area to place the search.";
  else if (conflictingHardFood.length > 1) readinessMessage = "The group has different must-haves. Talk through them before finding options.";

  // Include statuses and values, not just IDs: an insight can change in place.
  const fingerprint = createHash("sha256").update(JSON.stringify({
    participants: participants.map((p) => [p.id, p.originLabel, p.originSourceInsightId, p.originUpdatedAt?.toISOString()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    insights: current.map((i) => [
      i.id, i.kind, i.value, i.normalizedValue, i.scope, i.participantId,
      i.strength, i.confidence, i.status, i.updatedAt.toISOString(),
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  })).digest("hex");
  return { participants, insights: current, origins, fingerprint, canSearch: !readinessMessage, readinessMessage };
}

export async function saveParticipantLocation(
  roomId: string, participantId: string, browserIdentity: string,
  originLabel: string | null, sourceInsightId: string | null,
) {
  const [person] = await db.select().from(participantsTable).where(and(
    eq(participantsTable.roomId, roomId), eq(participantsTable.id, participantId),
  ));
  if (!person) return { status: 404 as const };
  if (!person.browserIdentity || person.browserIdentity !== browserIdentity) return { status: 403 as const };
  const label = originLabel?.trim().replace(/\s+/g, " ") || null;
  if (label && (label.length < 2 || label.length > 100)) return { status: 400 as const };
  // Do not forward exact coordinates, unit numbers, or street numbers to Geocoding.
  if (label && (/-?\d{1,3}\.\d+\s*[,;]\s*-?\d{1,3}\.\d+/.test(label)
    || /\b(?:flat|apartment|apt|unit|suite|house|door|plot)\s*(?:no\.?\s*)?[#\w-]*\d/i.test(label)
    || /^\d{1,5}[a-z]?\s+.+\b(?:road|rd|street|st|avenue|ave|lane|ln|drive|dr)\b/i.test(label))) {
    return { status: 400 as const };
  }
  if (sourceInsightId && !label) return { status: 400 as const };
  let source: RoomInsightRecord | undefined;
  if (sourceInsightId) {
    [source] = await db.select().from(roomInsightsTable).where(and(
      eq(roomInsightsTable.id, sourceInsightId), eq(roomInsightsTable.roomId, roomId),
      eq(roomInsightsTable.participantId, participantId),
    ));
    if (!source || source.kind !== "starting_location" || source.status !== "active"
      || source.confidence === "low") return { status: 400 as const };
  }
  const [saved] = await db.update(participantsTable).set({
    originLabel: label,
    originSourceInsightId: source?.id ?? null,
    originSourceInsightUpdatedAt: source?.updatedAt ?? null,
    originUpdatedAt: label ? new Date() : null,
  }).where(and(eq(participantsTable.roomId, roomId), eq(participantsTable.id, participantId),
    eq(participantsTable.browserIdentity, browserIdentity))).returning();
  return saved ? { status: 200 as const, participant: saved } : { status: 403 as const };
}

export async function requestSuggestionRun(roomId: string, participantId: string, browserIdentity: string) {
  const context = await roomContext(roomId);
  const requester = context.participants.find((person) => person.id === participantId);
  if (!requester) return { status: 404 as const, error: "Participant not found in this room." };
  if (!requester.browserIdentity || requester.browserIdentity !== browserIdentity) {
    return { status: 403 as const, error: "This browser cannot request a search as that participant." };
  }
  if (!context.canSearch) return { status: 400 as const, error: context.readinessMessage ?? "More context is needed." };

  return db.transaction(async (tx) => {
    // Room row lock serializes competing clicks, including those from different server instances.
    await tx.select({ id: roomsTable.id }).from(roomsTable).where(eq(roomsTable.id, roomId)).for("update");
    const [active] = await tx.select().from(suggestionRunsTable).where(and(
      eq(suggestionRunsTable.roomId, roomId), inArray(suggestionRunsTable.status, ["pending", "processing"]),
    )).limit(1);
    if (active) return { status: 202 as const, runId: active.id, runStatus: active.status };
    const [recent] = await tx.select().from(suggestionRunsTable).where(eq(suggestionRunsTable.roomId, roomId))
      .orderBy(desc(suggestionRunsTable.requestedAt), desc(suggestionRunsTable.id)).limit(1);
    const now = Date.now();
    if (recent && now - recent.requestedAt.getTime() < 60_000 && recent.errorCode !== "provider_unavailable") {
      return { status: 429 as const, error: "Please wait a minute before searching again." };
    }
    const pastDay = await tx.select({ id: suggestionRunsTable.id }).from(suggestionRunsTable).where(and(
      eq(suggestionRunsTable.roomId, roomId), gte(suggestionRunsTable.requestedAt, new Date(now - 86_400_000)),
    )).limit(10);
    if (pastDay.length >= 10) return { status: 429 as const, error: "This room has reached today's search limit." };
    const [run] = await tx.insert(suggestionRunsTable).values({
      roomId, requestedBy: participantId, fingerprint: context.fingerprint,
      insightIds: context.insights.map((item) => item.id),
    }).returning();
    if (!run) throw new Error("Suggestion run was not created");
    return { status: 202 as const, runId: run.id, runStatus: run.status };
  });
}

function searchTerms(insights: RoomInsightRecord[]): string[] {
  const cuisines = insights.filter((item) => item.kind === "cuisine" && activeStatuses.has(item.status)
    && item.confidence !== "low").map((item) => item.value.replace(/[^\p{L}\p{N}\s'-]/gu, "").trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(cuisines)].slice(0, 2).map((term) => `${term} restaurants`);
}

function scoreCandidates(
  places: Place[], insights: RoomInsightRecord[], participants: ParticipantRecord[],
  routeMinutes: Record<string, Record<string, number | null>> | null,
) {
  return places.map((place) => {
    const travels = Object.fromEntries(participants.map((p) => [p.id, routeMinutes?.[p.id]?.[place.id] ?? null]));
    return { place, evaluation: evaluateRestaurant(place, insights, travels, participants) };
  }).sort((a, b) => b.evaluation.score - a.evaluation.score || a.place.id.localeCompare(b.place.id));
}

async function findForRun(run: typeof suggestionRunsTable.$inferSelect) {
  if (!hasPlacesKey()) throw new Error("provider_unavailable");
  const context = await roomContext(run.roomId);
  if (context.fingerprint !== run.fingerprint || !context.canSearch) throw new Error("context_changed");
  const resolved = await Promise.allSettled(context.origins.map(async (person) => ({
    participantId: person.id, coordinates: await geocodeArea(person.originLabel!),
  })));
  const locations = resolved.filter((result): result is PromiseFulfilledResult<{
    participantId: string; coordinates: Coordinates
  }> => result.status === "fulfilled").map((result) => result.value);
  if (!locations.length) throw new Error("location_unresolved");
  const center = {
    latitude: locations.reduce((sum, origin) => sum + origin.coordinates.latitude, 0) / locations.length,
    longitude: locations.reduce((sum, origin) => sum + origin.coordinates.longitude, 0) / locations.length,
  };
  const terms = searchTerms(context.insights);
  const searches = terms.length ? terms : ["restaurants"];
  const batches = await Promise.all(searches.map((query) => searchRestaurants(query, center)));
  const unique = new Map<string, Place>();
  for (const batch of batches) for (const place of batch.slice(0, searches.length > 1 ? 10 : 20)) {
    if (!unique.has(place.id) && unique.size < 20) unique.set(place.id, place);
  }
  const candidates = [...unique.values()];
  if (!candidates.length) return [];
  // Route a bounded finalist set. Routing cannot prevent a real-place result.
  const finalists = candidates.slice(0, Math.min(20, Math.floor(40 / locations.length)));
  let routes: Record<string, Record<string, number | null>> | null = null;
  if (locations.length * finalists.length <= 40) {
    try { routes = await getDrivingMinutes(locations, finalists); } catch { /* Optional enhancement. */ }
  }
  return scoreCandidates(finalists, context.insights, context.participants, routes).slice(0, 3);
}

type ClaimedRun = { id: string };
async function claimRun(): Promise<ClaimedRun | undefined> {
  await pool.query(`
    UPDATE suggestion_runs SET status = 'failed', lease_until = NULL, error_code = 'search_timeout',
      completed_at = now()
    WHERE status = 'processing' AND lease_until < now() AND attempts >= 3
  `);
  const result = await pool.query<ClaimedRun>(`
    WITH candidate AS (
      SELECT id FROM suggestion_runs
      WHERE (status = 'pending' AND (lease_until IS NULL OR lease_until < now()) AND attempts < 3)
        OR (status = 'processing' AND lease_until < now() AND attempts < 3)
      ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE suggestion_runs AS run SET status = 'processing', attempts = run.attempts + 1,
      lease_until = now() + interval '90 seconds'
    FROM candidate WHERE run.id = candidate.id
    RETURNING run.id
  `);
  return result.rows[0];
}

async function processNext(): Promise<void> {
  const claim = await claimRun();
  if (!claim) return;
  const [run] = await db.select().from(suggestionRunsTable).where(eq(suggestionRunsTable.id, claim.id));
  if (!run) return;
  try {
    const ranked = await findForRun(run);
    await db.transaction(async (tx) => {
      const [stillClaimed] = await tx.select({ id: suggestionRunsTable.id }).from(suggestionRunsTable)
        .where(and(eq(suggestionRunsTable.id, run.id), eq(suggestionRunsTable.status, "processing"),
          eq(suggestionRunsTable.attempts, run.attempts))).for("update");
      if (!stillClaimed) return;
      if (ranked.length) await tx.insert(roomSuggestionsTable).values(ranked.map(({ place, evaluation }, rank) => ({
        runId: run.id, providerPlaceId: place.id, rank,
        evaluations: evaluation.evaluations,
      })));
      await tx.update(suggestionRunsTable).set({
        status: "ready", errorCode: null, completedAt: new Date(), leaseUntil: null,
      }).where(eq(suggestionRunsTable.id, run.id));
    });
  } catch (error) {
    const code = error instanceof Error && ["provider_unavailable", "context_changed", "location_unresolved"]
      .includes(error.message) ? error.message : "places_unavailable";
    logger.warn({ roomId: run.roomId, code }, "Suggestion search could not complete");
    const retry = code === "places_unavailable" && run.attempts < 2;
    await db.update(suggestionRunsTable).set({
      status: retry ? "pending" : "failed", errorCode: retry ? null : code,
      completedAt: retry ? null : new Date(),
      leaseUntil: retry ? new Date(Date.now() + 10_000) : null,
    }).where(and(eq(suggestionRunsTable.id, run.id), eq(suggestionRunsTable.status, "processing"),
      eq(suggestionRunsTable.attempts, run.attempts)));
  }
}

let workerStarted = false;
export function startRoomSuggestions(): void {
  if (workerStarted) return;
  workerStarted = true;
  let working = false;
  setInterval(() => {
    if (working) return;
    working = true;
    void processNext().catch((error: unknown) => {
      logger.error({ err: error }, "Suggestion worker failed");
    }).finally(() => { working = false; });
  }, 2000).unref();
}

export async function getRoomSuggestions(roomId: string) {
  const context = await roomContext(roomId);
  const [run] = await db.select().from(suggestionRunsTable).where(eq(suggestionRunsTable.roomId, roomId))
    .orderBy(desc(suggestionRunsTable.requestedAt), desc(suggestionRunsTable.id)).limit(1);
  const stale = Boolean(run && context.fingerprint !== run.fingerprint);
  const base = {
    status: run?.status ?? "idle",
    runId: run?.id ?? null,
    stale,
    errorCode: run?.errorCode ?? null,
    requestedAt: run?.requestedAt ?? null,
    completedAt: run?.completedAt ?? null,
    canSearch: context.canSearch && hasPlacesKey(),
    readinessMessage: !hasPlacesKey() ? "Places aren't connected yet. Chat and understanding still work."
      : context.readinessMessage,
    providerAvailable: hasPlacesKey(),
    missingParticipantNames: context.participants.filter((p) => !context.origins.some((origin) => origin.id === p.id))
      .map((p) => p.name),
    suggestions: [] as Array<{
      id: string; placeId: string; name: string; address: string | null; mapsUrl: string | null;
      category: string | null; priceLevel: string | null; rating: number | null; openingLabel: string | null;
      fit: "verified" | "partial" | "tradeoff";
      reasons: Array<{ insightId: string | null; label: string; verdict: "met" | "failed" | "unknown" | "not_applicable";
        strength: "hard_constraint" | "strong_preference" | "preference" }>;
      travel: Array<{ participantId: string; participantName: string; minutes: number | null }>;
      travelCoverage: string;
       attributions: Array<{ provider: string; providerUri: string | null }>;
    }>,
  };
  if (!run || run.status !== "ready" || stale || !hasPlacesKey()) return base;

  const saved = await db.select().from(roomSuggestionsTable).where(eq(roomSuggestionsTable.runId, run.id))
    .orderBy(roomSuggestionsTable.rank);
  if (!saved.length) return base;
  // Each read fetches fresh provider facts; bound this spend in the database
  // instead of caching Google Places content or relying on a process-local counter.
  const [allowed] = await db.update(suggestionRunsTable).set({
    detailsReadCount: sql`${suggestionRunsTable.detailsReadCount} + 1`,
  }).where(and(eq(suggestionRunsTable.id, run.id), lt(suggestionRunsTable.detailsReadCount, 30)))
    .returning({ id: suggestionRunsTable.id });
  if (!allowed) return { ...base, errorCode: "details_limit_reached" };
  try {
    const details = await Promise.all(saved.map((item) => getPlaceDetails(item.providerPlaceId)));
    const places = details.filter((place): place is Place => place !== null);
    const resolved = await Promise.allSettled(context.origins.map(async (person) => ({
      participantId: person.id, coordinates: await geocodeArea(person.originLabel!),
    })));
    const locations = resolved.filter((result): result is PromiseFulfilledResult<{
      participantId: string; coordinates: Coordinates
    }> => result.status === "fulfilled").map((result) => result.value);
    let routes: Record<string, Record<string, number | null>> | null = null;
    if (locations.length && locations.length * places.length <= 40) {
      try { routes = await getDrivingMinutes(locations, places); } catch { /* Display unknown travel. */ }
    }
    base.suggestions = saved.flatMap((item, index) => {
      const place = details[index];
      if (!place) return [];
      const travel = Object.fromEntries(context.participants.map((p) => [p.id, routes?.[p.id]?.[place.id] ?? null]));
      const result = evaluateRestaurant(place, context.insights, travel, context.participants);
      return [{
        id: item.id, placeId: place.id, name: place.name, address: place.address, mapsUrl: place.mapsUrl,
        category: place.primaryType, priceLevel: place.priceLevel, rating: place.rating,
        openingLabel: result.openingLabel, fit: result.fit, reasons: result.reasons,
        travel: result.travel, travelCoverage: result.travelCoverage,
         attributions: place.attributions,
      }];
    });
    return base;
  } catch {
    return { ...base, status: "failed" as const, errorCode: "places_unavailable" };
  }
}