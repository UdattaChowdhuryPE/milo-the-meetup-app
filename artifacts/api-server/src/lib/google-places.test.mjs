import test from "node:test";
import assert from "node:assert/strict";
import { geocodeArea, searchRestaurants, ProviderRequestError } from "./google-places.ts";

function useTestKey(t) {
  const previous = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = "test-only";
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = previous;
  });
}

test("Ghaziabad's legacy Geocoding coordinates enter Places Text Search", async (t) => {
  useTestKey(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    calls.push({ url: new URL(url).pathname, body: init?.body });
    if (url.includes("/geocode/json")) {
      assert.equal(new URL(url).searchParams.get("address"), "Ghaziabad, India");
      return Response.json({
        status: "OK", results: [{ geometry: { location: { lat: 28.6691565, lng: 77.4537578 } } }],
      });
    }
    assert.equal(url, "https://places.googleapis.com/v1/places:searchText");
    return Response.json({ places: [{
      id: "real-provider-id", displayName: { text: "Restaurant" },
      location: { latitude: 28.67, longitude: 77.45 },
    }] });
  });
  const center = await geocodeArea("Ghaziabad, India");
  const places = await searchRestaurants("restaurants", center);
  assert.deepEqual(center, { latitude: 28.6691565, longitude: 77.4537578 });
  assert.deepEqual(JSON.parse(calls[1].body).locationBias.circle.center, center);
  assert.equal(places[0].name, "Restaurant");
});

test("invalid Geocoding coordinates cannot reach Places", async (t) => {
  useTestKey(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    status: "OK", results: [{ geometry: { location: { lat: 100, lng: 77 } } }],
  }));
  await assert.rejects(geocodeArea("Ghaziabad, India"), (error) =>
    error instanceof ProviderRequestError &&
    error.code === "geocoding_invalid_response" && error.googleStatus === "OK");
});

for (const [status, code] of [
  ["ZERO_RESULTS", "location_not_found"],
  ["REQUEST_DENIED", "geocoding_denied"],
  ["OVER_DAILY_LIMIT", "geocoding_quota"],
  ["OVER_QUERY_LIMIT", "geocoding_quota"],
  ["INVALID_REQUEST", "geocoding_invalid_request"],
  ["UNKNOWN_ERROR", "geocoding_unavailable"],
]) {
  test(`Geocoding ${status} is retained as safe ${code}`, async (t) => {
    useTestKey(t);
    t.mock.method(globalThis, "fetch", async () => Response.json({
      status, error_message: "Untrusted provider text must never be returned",
      results: [],
    }));
    await assert.rejects(geocodeArea("Ghaziabad, India"), (error) =>
      error instanceof ProviderRequestError && error.code === code &&
      error.googleStatus === status && !error.message.includes("Untrusted"));
  });
}

test("Places permission failure is not reported as a location failure", async (t) => {
  useTestKey(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: { status: "PERMISSION_DENIED", message: "Untrusted provider text" },
  }, { status: 403 }));
  await assert.rejects(searchRestaurants("restaurants", { latitude: 28.67, longitude: 77.45 }),
    (error) => error instanceof ProviderRequestError &&
      error.code === "places_denied" && error.googleStatus === "PERMISSION_DENIED");
});