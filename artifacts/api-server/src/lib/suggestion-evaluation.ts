import type { RoomInsightRecord, StoredEvaluation, SuggestionVerdict } from "@workspace/db";
import type { Place } from "./google-places.js";

export type SuggestionReason = {
  insightId: string | null;
  label: string;
  verdict: SuggestionVerdict;
  strength: "hard_constraint" | "strong_preference" | "preference";
};

export type RestaurantEvaluation = {
  evaluations: StoredEvaluation[];
  reasons: SuggestionReason[];
  fit: "verified" | "partial" | "tradeoff";
  score: number;
  travelCoverage: string;
  travel: Array<{ participantId: string; participantName: string; minutes: number | null }>;
  openingLabel: string | null;
};

type Participant = { id: string; name: string };
type Strength = "hard_constraint" | "strong_preference" | "preference";

const ACTIVE_STATUSES = new Set(["active", "uncertain", "conflicting"]);
const FOOD_KINDS = new Set(["cuisine", "dietary", "allergy", "budget", "date", "time", "max_travel_time"]);
const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};
const WORD_PRICE_LEVELS: Array<[RegExp, number]> = [
  [/\b(cheap|inexpensive|budget|affordable|low[- ]cost)\b/, 1],
  [/\bmoderate\b|mid[- ]range/, 2],
  [/\b(expensive|premium|high[- ]end)\b/, 3],
];

function lower(value: unknown): string {
  return typeof value === "string" ? value.toLocaleLowerCase("en-US") : "";
}

function strength(value: string): Strength {
  if (value === "hard_constraint" || value === "strong_preference") return value;
  return "preference";
}

function normalizeTokens(value: string): string[] {
  return lower(value).replace(/[_-]+/g, " ").match(/[a-z0-9]+/g) ?? [];
}

function cuisineVerdict(insight: RoomInsightRecord, place: Place): SuggestionVerdict {
  const sought = normalizeTokens(insight.value).filter((token) =>
    !["restaurant", "restaurants", "food", "cuisine", "prefer", "like", "love", "want", "some", "options"].includes(token),
  );
  if (!sought.length) return "unknown";
  // Deliberately inspect only provider-authored category/name metadata. A
  // text-search hit or search query is not evidence of cuisine.
  const metadata = normalizeTokens([
    place.name,
    place.primaryType ?? "",
    ...place.types,
  ].join(" "));
  const metadataText = ` ${metadata.join(" ")} `;
  const found = sought.some((token) => metadataText.includes(` ${token} `));
  return found ? "met" : "unknown";
}

function dietaryVerdict(insight: RoomInsightRecord, place: Place): SuggestionVerdict {
  const value = lower(insight.value);
  if (/\bvegetarian\b/.test(value) && !/\bvegan\b/.test(value)) {
    if (place.servesVegetarianFood === true) return "met";
    if (place.servesVegetarianFood === false) return "failed";
  }
  // This provider field does not establish vegan suitability or any other
  // dietary requirement; it never establishes allergen safety.
  return "unknown";
}

function priceTier(insight: RoomInsightRecord): number | null {
  const value = lower(insight.value);
  for (const [pattern, tier] of WORD_PRICE_LEVELS) if (pattern.test(value)) return tier;
  if (/(?:^|\s)(?:\${3,}|₹{3,})(?:\s|$)/.test(value)) return 3;
  if (/(?:^|\s)(?:\${2}|₹{2})(?:\s|$)/.test(value)) return 2;
  if (/(?:^|\s)(?:\$(?!\$)|₹)(?:\s|$)/.test(value)) return 1;
  const normalized = insight.normalizedValue;
  const unit = lower(normalized?.unit);
  const amount = typeof normalized?.amount === "number" ? normalized.amount : null;
  // Only accept an explicitly coarse tier, not a currency amount with no
  // comparable provider currency/cost basis.
  if (amount !== null && ["tier", "price_level", "pricelevel"].includes(unit) &&
    Number.isInteger(amount) && amount >= 0 && amount <= 4) return amount;
  return null;
}

function budgetVerdict(insight: RoomInsightRecord, place: Place): SuggestionVerdict {
  const target = priceTier(insight);
  const actual = place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined;
  if (target === null || actual === undefined) return "unknown";
  const normalized = insight.normalizedValue;
  const comparison = lower(normalized?.comparison);
  const value = lower(insight.value);
  const maximum = /under|below|less than|at most|maximum|max\b/.test(`${value} ${comparison}`);
  return maximum ? (actual <= target ? "met" : "failed") : (actual === target ? "met" : "unknown");
}

function isExplicitlyNow(value: string): boolean {
  return /\b(now|right now|currently|at this moment)\b/i.test(value);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function sameOwner(a: RoomInsightRecord, b: RoomInsightRecord): boolean {
  return a.scope === b.scope && a.participantId === b.participantId;
}

function scheduledMinute(insights: RoomInsightRecord[], place: Place, focus?: RoomInsightRecord): number | null {
  const times = focus?.kind === "time" ? [focus] : insights.filter((item) =>
    item.kind === "time" && (!focus || sameOwner(focus, item)));
  if (times.length !== 1 || place.utcOffsetMinutes === null) return null;
  const time = times[0]!;
  if (time.status !== "active" || time.confidence === "low" || isExplicitlyNow(time.value)) return null;
  const dates = focus?.kind === "date" ? [focus] : insights.filter((item) =>
    item.kind === "date" && sameOwner(item, time));
  if (dates.length > 1 || dates.some((item) => item.status !== "active" || item.confidence === "low")) return null;
  const match = /\b(?:at|after|from|around|by)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i.exec(time.value)
    ?? /\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i.exec(time.value);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const suffix = lower(match[3]).replaceAll(".", "");
  if (minute > 59 || hour > 23 || (suffix && (hour < 1 || hour > 12))) return null;
  if (suffix === "pm") hour = hour % 12 + 12;
  else if (suffix === "am") hour %= 12;
  else if (hour <= 12) return null; // 8:30 without AM/PM is ambiguous.

  const dateText = dates.map((i) => i.value).join(" ");
  const context = `${dateText} ${time.value}`.toLowerCase();
  const localNow = new Date(Date.now() + place.utcOffsetMinutes * 60_000);
  const today = localNow.getUTCDay();
  const explicitDay = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`, "i").test(context));
  const day = explicitDay >= 0 ? explicitDay
    : /\btomorrow\b/.test(context) ? (today + 1) % 7
      : /\b(today|tonight)\b/.test(context) ? today : -1;
  if (day < 0) return null;
  const target = day * 1440 + hour * 60 + minute;
  const nowInWeek = today * 1440 + localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  // Do not reinterpret a time that already passed as next week's plan.
  if (target <= nowInWeek) return null;
  return target;
}

function openingAtScheduledTime(insights: RoomInsightRecord[], place: Place, focus?: RoomInsightRecord): SuggestionVerdict {
  const target = scheduledMinute(insights, place, focus);
  const periods = place.currentOpeningHours?.periods;
  if (target === null || !Array.isArray(periods) || !periods.length) return "unknown";
  let sawValidPeriod = false;
  for (const period of periods) {
    if (!period || typeof period !== "object") continue;
    const record = period as { open?: unknown; close?: unknown };
    const open = record.open as { day?: unknown; hour?: unknown; minute?: unknown } | undefined;
    const close = record.close as { day?: unknown; hour?: unknown; minute?: unknown } | undefined;
    if (!open || !close || typeof open.day !== "number" || typeof close.day !== "number"
      || typeof open.hour !== "number" || typeof close.hour !== "number") continue;
    const start = open.day * 1440 + open.hour * 60 + (typeof open.minute === "number" ? open.minute : 0);
    let end = close.day * 1440 + close.hour * 60 + (typeof close.minute === "number" ? close.minute : 0);
    if (end <= start) end += 10080;
    sawValidPeriod = true;
    if ([target, target + 10080].some((moment) => moment >= start && moment < end)) return "met";
  }
  return sawValidPeriod ? "failed" : "unknown";
}

function maxTravelLimit(insight: RoomInsightRecord): number | null {
  const amount = typeof insight.normalizedValue?.amount === "number" ? insight.normalizedValue.amount : null;
  const unit = lower(insight.normalizedValue?.unit);
  if (amount === null || amount < 0 || !Number.isFinite(amount)) return null;
  if (["minute", "minutes", "min", "mins"].includes(unit)) return amount;
  if (["hour", "hours", "hr", "hrs"].includes(unit)) return amount * 60;
  return null;
}

function relevantFoodInsight(insight: RoomInsightRecord): boolean {
  if (!ACTIVE_STATUSES.has(insight.status)) return false;
  if (FOOD_KINDS.has(insight.kind)) return true;
  return insight.kind === "activity" && /\b(restaurant|dining|dinner|lunch|brunch|food)\b/i.test(insight.value);
}

function evaluateInsight(
  insight: RoomInsightRecord,
  place: Place,
  travels: Record<string, number | null>,
  participants: Participant[],
  insights: RoomInsightRecord[],
): SuggestionVerdict {
  switch (insight.kind) {
    case "cuisine":
      return cuisineVerdict(insight, place);
    case "dietary":
      return dietaryVerdict(insight, place);
    case "allergy":
      return "unknown";
    case "budget":
      return budgetVerdict(insight, place);
    case "time": {
      if (isExplicitlyNow(insight.value)) return typeof place.currentOpeningHours?.openNow === "boolean"
        ? (place.currentOpeningHours.openNow ? "met" : "failed") : "unknown";
      return openingAtScheduledTime(insights, place, insight);
    }
    case "date":
      return openingAtScheduledTime(insights, place, insight);
    case "max_travel_time": {
      const limit = maxTravelLimit(insight);
      if (limit === null) return "unknown";
      const relevantParticipants = insight.scope === "participant" && insight.participantId
        ? participants.filter((participant) => participant.id === insight.participantId)
        : participants;
      if (!relevantParticipants.length) return "unknown";
      const estimates = relevantParticipants.map((participant) => travels[participant.id]);
      // A known breach remains a breach even if a different route is missing.
      if (estimates.some((minutes) => typeof minutes === "number" && minutes > limit)) return "failed";
      if (estimates.some((minutes) => typeof minutes !== "number" || !Number.isFinite(minutes))) return "unknown";
      return estimates.every((minutes) => minutes! <= limit) ? "met" : "failed";
    }
    case "activity":
      return "met";
    default:
      return "not_applicable";
  }
}

function openingLabel(place: Place, insights: RoomInsightRecord[]): string | null {
  const hasTemporalContext = insights.some((insight) =>
    relevantFoodInsight(insight) && insight.kind === "time" && isExplicitlyNow(insight.value),
  );
  if (hasTemporalContext && typeof place.currentOpeningHours?.openNow === "boolean") {
    return place.currentOpeningHours.openNow ? "Open now" : "Closed now";
  }
  if (scheduledMinute(insights, place) !== null && openingAtScheduledTime(insights, place) === "met") {
    return "Hours indicate open at the planned time";
  }
  if (place.regularOpeningHours?.weekdayDescriptions?.length) return "Typical hours available";
  return "Hours unconfirmed";
}

function travelFairness(travel: Array<{ participantId: string; participantName: string; minutes: number | null }>): number {
  const known = travel.map((entry) => entry.minutes).filter((value): value is number => value !== null);
  if (known.length < 2) return 0;
  const max = Math.max(...known);
  const average = known.reduce((sum, item) => sum + item, 0) / known.length;
  const spread = max - Math.min(...known);
  // Small bounded adjustment: route fairness helps break preference ties,
  // but cannot outweigh constraint/preference evidence.
  return Math.max(-8, 4 - max / 30 - average / 60 - spread / 60);
}

/**
 * Deterministically evaluates food-related saved insights against provider
 * facts and explicitly labelled driving estimates. Missing data stays unknown.
 */
export function evaluateRestaurant(
  place: Place,
  insights: RoomInsightRecord[],
  travels: Record<string, number | null>,
  participants: Array<{ id: string; name: string }>,
): RestaurantEvaluation {
  const relevant = insights.filter(relevantFoodInsight);
  const evaluations: StoredEvaluation[] = [];
  const reasons: SuggestionReason[] = [];
  const perParticipant = new Map<string, number>();
  let score = 50;
  let hasHardFailure = false;
  let hasUnknown = false;
  let hasFailure = false;

  for (const insight of relevant) {
    const verdict = evaluateInsight(insight, place, travels, participants, relevant);
    const insightStrength = strength(insight.strength);
    evaluations.push({ insightId: insight.id, verdict, strength: insightStrength });
    reasons.push({ insightId: insight.id, label: insight.value, verdict, strength: insightStrength });
    if (verdict === "unknown") hasUnknown = true;
    if (verdict === "failed") {
      hasFailure = true;
      if (insightStrength === "hard_constraint") hasHardFailure = true;
    }
    if (verdict === "not_applicable") continue;
    const participantKey = insight.scope === "participant" && insight.participantId
      ? insight.participantId
      : "__group__";
    const used = perParticipant.get(participantKey) ?? 0;
    const cap = insightStrength === "hard_constraint" ? 100 : 6;
    const rawWeight = insightStrength === "hard_constraint" ? 100 : insightStrength === "strong_preference" ? 4 : 2;
    const weight = Math.min(rawWeight, Math.max(0, cap - used));
    perParticipant.set(participantKey, used + weight);
    if (verdict === "met") score += weight * (insightStrength === "hard_constraint" ? 0.4 : 1);
    else if (verdict === "failed") score -= weight * (insightStrength === "hard_constraint" ? 1.25 : 0.8);
    else if (verdict === "unknown") score -= weight * (insightStrength === "hard_constraint" ? 0.35 : 0.15);
  }

  const travel = participants.map((participant) => ({
    participantId: participant.id,
    participantName: participant.name,
    minutes: typeof travels[participant.id] === "number" && Number.isFinite(travels[participant.id])
      ? travels[participant.id]!
      : null,
  }));
  const knownTravelCount = travel.filter((entry) => entry.minutes !== null).length;
  if (knownTravelCount < participants.length) hasUnknown = true;
  const travelCoverage = `Travel known for ${knownTravelCount} of ${participants.length}`;
  score += travelFairness(travel);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    evaluations,
    reasons,
    fit: hasHardFailure || hasFailure ? "tradeoff" : hasUnknown ? "partial" : "verified",
    score,
    travelCoverage,
    travel,
    openingLabel: openingLabel(place, relevant),
  };
}