import test from "node:test";
import assert from "node:assert/strict";
import type { RoomInsightRecord } from "@workspace/db";
import type { Place } from "./google-places";
import { evaluateRestaurant } from "./suggestion-evaluation";

const people = [{ id: "a", name: "Asha" }, { id: "b", name: "Bela" }];
const place: Place = {
  id: "google-id", name: "Korean Table", address: "Central Market",
  mapsUrl: null, types: ["korean_restaurant", "restaurant"], primaryType: "korean_restaurant",
  coordinates: { latitude: 28.5, longitude: 77.1 }, priceLevel: "PRICE_LEVEL_MODERATE",
  rating: 4.4, businessStatus: "OPERATIONAL", utcOffsetMinutes: 0,
  servesVegetarianFood: null, currentOpeningHours: null, regularOpeningHours: null,
  attributions: [],
};
const routes = { a: 20, b: 25 };

function insight(id: string, kind: string, value: string, strength = "preference",
  normalizedValue: Record<string, unknown> | null = null, participantId: string | null = null): RoomInsightRecord {
  return {
    id, kind, value, strength, normalizedValue, participantId,
    scope: participantId ? "participant" : "group", status: "active", confidence: "high",
  } as unknown as RoomInsightRecord;
}

test("cuisine is verified by provider category, not merely a search hit", () => {
  const korean = insight("cuisine", "cuisine", "Korean");
  assert.equal(evaluateRestaurant(place, [korean], routes, people).reasons[0]?.verdict, "met");
  assert.equal(evaluateRestaurant({ ...place, name: "Table", types: ["restaurant"], primaryType: "restaurant" },
    [korean], routes, people).reasons[0]?.verdict, "unknown");
});

test("unknown allergy and vegetarian evidence cannot be called a verified fit", () => {
  const allergy = insight("allergy", "allergy", "Peanut allergy", "hard_constraint", null, "a");
  const dietary = insight("dietary", "dietary", "Vegetarian", "hard_constraint", null, "b");
  const unknown = evaluateRestaurant(place, [allergy, dietary], routes, people);
  assert.equal(unknown.fit, "partial");
  assert.deepEqual(unknown.reasons.map((reason) => reason.verdict), ["unknown", "unknown"]);
  const explicitlyUnsupported = evaluateRestaurant({ ...place, servesVegetarianFood: false },
    [allergy, dietary], routes, people);
  assert.equal(explicitlyUnsupported.fit, "tradeoff");
  assert.equal(explicitlyUnsupported.reasons[1]?.verdict, "failed");
});

test("a hard travel limit cannot be overridden by a matching cuisine", () => {
  const limit = insight("travel", "max_travel_time", "At most 40 minutes", "hard_constraint",
    { amount: 40, unit: "minutes" }, "a");
  const korean = insight("cuisine", "cuisine", "Korean", "strong_preference", null, "b");
  const failure = evaluateRestaurant(place, [korean, limit], { a: 47, b: 10 }, people);
  assert.equal(failure.fit, "tradeoff");
  assert.equal(failure.reasons[1]?.verdict, "failed");
  const unavailable = evaluateRestaurant(place, [korean, limit], { a: null, b: 10 }, people);
  assert.equal(unavailable.fit, "partial");
  assert.equal(unavailable.reasons[1]?.verdict, "unknown");
  assert.equal(unavailable.travelCoverage, "Travel known for 1 of 2");
  const groupLimit = insight("group-travel", "max_travel_time", "At most 40 minutes",
    "hard_constraint", { amount: 40, unit: "minutes" });
  assert.equal(evaluateRestaurant(place, [groupLimit], { a: 47, b: null }, people).reasons[0]?.verdict,
    "failed", "one missing route must not erase another person's known hard failure");
});

test("provider hours can verify a specific upcoming day and time, not an ambiguous time", (t) => {
  t.mock.method(Date, "now", () => Date.UTC(2026, 8, 21, 12)); // Monday noon, UTC
  const day = insight("day", "date", "Monday");
  const time = insight("time", "time", "After 8:30 PM", "hard_constraint");
  const hours = {
    ...place,
    currentOpeningHours: { periods: [{ open: { day: 1, hour: 17 }, close: { day: 1, hour: 23 } }] },
  };
  const open = evaluateRestaurant(hours, [day, time], routes, people);
  assert.equal(open.reasons[1]?.verdict, "met");
  assert.match(open.openingLabel ?? "", /planned time/);
  const closed = evaluateRestaurant({
    ...hours, currentOpeningHours: { periods: [{ open: { day: 1, hour: 17 }, close: { day: 1, hour: 20 } }] },
  }, [day, time], routes, people);
  assert.equal(closed.reasons[1]?.verdict, "failed");
  assert.equal(closed.fit, "tradeoff");
  assert.equal(evaluateRestaurant(place, [day, time], routes, people).reasons[1]?.verdict, "unknown");
  assert.equal(evaluateRestaurant(hours, [day, insight("ambiguous", "time", "After 8:30")],
    routes, people).reasons[1]?.verdict, "unknown");
  const otherDay = insight("other-day", "date", "Tuesday", "preference", null, "a");
  const myTime = insight("my-time", "time", "After 8:30 PM", "preference", null, "b");
  assert.equal(evaluateRestaurant(hours, [otherDay, myTime], routes, people).reasons[1]?.verdict,
    "unknown", "one person's date is not evidence for another person's time");
  const conflictingDay = insight("conflict", "date", "Tuesday");
  assert.equal(evaluateRestaurant(hours, [day, conflictingDay, time], routes, people).reasons[2]?.verdict,
    "unknown", "two days at the same scope are ambiguous");
});

test("currency amounts without comparable provider prices remain unknown", () => {
  const cash = insight("budget", "budget", "Under ₹1000", "hard_constraint",
    { amount: 1000, unit: "INR", comparison: "under" });
  assert.equal(evaluateRestaurant(place, [cash], routes, people).reasons[0]?.verdict, "unknown");
  const tier = insight("tier", "budget", "Under moderate", "hard_constraint",
    { amount: 2, unit: "tier", comparison: "under" });
  assert.equal(evaluateRestaurant(place, [tier], routes, people).reasons[0]?.verdict, "met");
});

test("similar group preferences rank more balanced travel higher", () => {
  const korean = insight("cuisine", "cuisine", "Korean");
  const balanced = evaluateRestaurant(place, [korean], { a: 20, b: 25 }, people);
  const lopsided = evaluateRestaurant(place, [korean], { a: 5, b: 65 }, people);
  assert.ok(balanced.score > lopsided.score);
});