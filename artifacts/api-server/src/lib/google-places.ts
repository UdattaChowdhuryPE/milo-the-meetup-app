/**
 * Small server-only adapter for Google Maps Platform. Keep provider credentials
 * and payloads out of logs and expose only the fields used by suggestions.
 */
export type Coordinates = { latitude: number; longitude: number };

export type PlaceHours = {
  openNow?: boolean;
  periods?: unknown[];
  weekdayDescriptions?: string[];
  nextOpenTime?: unknown;
  nextCloseTime?: unknown;
};

export type Place = {
  id: string;
  name: string;
  address: string;
  mapsUrl: string | null;
  types: string[];
  primaryType: string | null;
  coordinates: Coordinates;
  priceLevel: string | null;
  rating: number | null;
  businessStatus: string | null;
  utcOffsetMinutes: number | null;
  attributions: Array<{ provider: string; providerUri: string | null }>;
  servesVegetarianFood: boolean | null;
  currentOpeningHours: PlaceHours | null;
  regularOpeningHours: PlaceHours | null;
};

const PLACES_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.googleMapsUri",
  "places.types",
  "places.primaryType",
  "places.location",
  "places.currentOpeningHours",
  "places.regularOpeningHours",
  "places.servesVegetarianFood",
  "places.priceLevel",
  "places.rating",
  "places.businessStatus",
  "places.utcOffsetMinutes",
  "places.attributions",
].join(",");
const PLACE_FIELDS = PLACES_FIELDS.replaceAll("places.", "");
const TIMEOUT_MS = 8_000;
const PLACES_BASE = "https://places.googleapis.com/v1";

export function hasPlacesKey(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error("Google Maps provider unavailable");
  return key;
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCoordinates(location: unknown): Coordinates | null {
  if (!isRecord(location)) return null;
  const latitude = numberAt(location.latitude);
  const longitude = numberAt(location.longitude);
  if (
    latitude === null || longitude === null ||
    latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ) return null;
  return { latitude, longitude };
}

function parseHours(value: unknown): PlaceHours | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.openNow === "boolean" ? { openNow: value.openNow } : {}),
    ...(Array.isArray(value.periods) ? { periods: value.periods } : {}),
    ...(Array.isArray(value.weekdayDescriptions)
      ? { weekdayDescriptions: value.weekdayDescriptions.filter((item): item is string => typeof item === "string") }
      : {}),
    ...(value.nextOpenTime !== undefined ? { nextOpenTime: value.nextOpenTime } : {}),
    ...(value.nextCloseTime !== undefined ? { nextCloseTime: value.nextCloseTime } : {}),
  };
}

function parsePlace(value: unknown): Place | null {
  if (!isRecord(value)) return null;
  const coords = parseCoordinates(value.location);
  if (!coords || typeof value.id !== "string" || !value.id) return null;
  const displayName = isRecord(value.displayName) && typeof value.displayName.text === "string"
    ? value.displayName.text
    : "";
  if (!displayName.trim() || (typeof value.businessStatus === "string"
    && value.businessStatus !== "OPERATIONAL")) return null;
  return {
    id: value.id,
    name: displayName,
    address: typeof value.formattedAddress === "string" ? value.formattedAddress : "",
    mapsUrl: typeof value.googleMapsUri === "string" ? value.googleMapsUri : null,
    types: Array.isArray(value.types) ? value.types.filter((item): item is string => typeof item === "string") : [],
    primaryType: typeof value.primaryType === "string" ? value.primaryType : null,
    coordinates: coords,
    priceLevel: typeof value.priceLevel === "string" ? value.priceLevel : null,
    rating: numberAt(value.rating),
    businessStatus: typeof value.businessStatus === "string" ? value.businessStatus : null,
    utcOffsetMinutes: numberAt(value.utcOffsetMinutes),
    attributions: Array.isArray(value.attributions) ? value.attributions.flatMap((item) =>
      isRecord(item) && typeof item.provider === "string"
        ? [{ provider: item.provider, providerUri: typeof item.providerUri === "string" ? item.providerUri : null }]
        : []) : [],
    servesVegetarianFood: typeof value.servesVegetarianFood === "boolean" ? value.servesVegetarianFood : null,
    currentOpeningHours: parseHours(value.currentOpeningHours),
    regularOpeningHours: parseHours(value.regularOpeningHours),
  };
}

async function readJson(response: Response, unavailableMessage: string): Promise<unknown> {
  if (!response.ok) throw new Error(unavailableMessage);
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(unavailableMessage);
  }
}

async function fetchProvider(input: string | URL, init: RequestInit, message: string): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    // In particular, never rethrow URL-bearing errors from Geocoding, whose
    // provider credential is passed as a query parameter.
    throw new Error(message);
  }
}

function validateCoordinates(coordinates: Coordinates): void {
  if (
    !Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude) ||
    coordinates.latitude < -90 || coordinates.latitude > 90 ||
    coordinates.longitude < -180 || coordinates.longitude > 180
  ) throw new Error("Invalid coordinates");
}

/**
 * Search for restaurants near a confirmed geographic center. Only bounded
 * normalized query text and a coarse geographic bias are sent to Google.
 */
export async function searchRestaurants(query: string, center: Coordinates): Promise<Place[]> {
  validateCoordinates(center);
  const cleanQuery = query.trim();
  if (!cleanQuery || cleanQuery.length > 200) throw new Error("Invalid restaurant search query");
  const response = await fetchProvider(`${PLACES_BASE}/places:searchText`, {
    method: "POST",
    signal: timeoutSignal(),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": PLACES_FIELDS,
    },
    body: JSON.stringify({
      textQuery: cleanQuery,
      pageSize: 20,
      includedType: "restaurant",
      strictTypeFiltering: true,
      locationBias: {
        circle: {
          center: { latitude: center.latitude, longitude: center.longitude },
          radius: 30_000,
        },
      },
    }),
  }, "Google Places search request failed");
  const data = await readJson(response, "Google Places search failed");
  if (!isRecord(data)) throw new Error("Google Places returned an invalid search response");
  if (data.places === undefined) return [];
  if (!Array.isArray(data.places)) throw new Error("Google Places returned an invalid search response");
  return data.places.map(parsePlace).filter((place): place is Place => place !== null);
}

/** Refresh one provider place's current facts by its Google Place ID. */
export async function getPlaceDetails(id: string): Promise<Place | null> {
  if (!id || id.length > 300 || /[\r\n]/.test(id)) throw new Error("Invalid Google Place ID");
  const response = await fetchProvider(`${PLACES_BASE}/places/${encodeURIComponent(id)}`, {
    method: "GET",
    signal: timeoutSignal(),
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": PLACE_FIELDS,
    },
  }, "Google Places details request failed");
  if (response.status === 404) return null;
  const data = await readJson(response, "Google Places details request failed");
  const place = parsePlace(data);
  if (!place) throw new Error("Google Places returned invalid place details");
  return place;
}

/** Resolve a user-confirmed coarse location label using Google Geocoding. */
export async function geocodeArea(label: string): Promise<Coordinates> {
  const cleanLabel = label.trim();
  if (!cleanLabel || cleanLabel.length > 160) throw new Error("Invalid geographic area");
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", cleanLabel);
  url.searchParams.set("key", apiKey());
  const response = await fetchProvider(url, { signal: timeoutSignal() }, "Google Geocoding request failed");
  const data = await readJson(response, "Google Geocoding request failed");
  if (!isRecord(data) || data.status !== "OK" || !Array.isArray(data.results)) {
    throw new Error("Google Geocoding could not resolve the confirmed area");
  }
  for (const result of data.results) {
    if (isRecord(result) && isRecord(result.geometry)) {
      const coords = parseCoordinates(result.geometry.location);
      if (coords) return coords;
    }
  }
  throw new Error("Google Geocoding returned no usable coordinates");
}

type RouteMatrixItem = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  condition?: string;
};

function durationMinutes(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds / 60) : null;
}

/**
 * Return Google driving durations, or null when the routing provider is
 * unavailable. Missing/failed individual matrix cells remain null; no
 * straight-line estimate is substituted.
 */
export async function getDrivingMinutes(
  origins: Array<{ participantId: string; coordinates: Coordinates }>,
  places: Place[],
): Promise<Record<string, Record<string, number | null>> | null> {
  if (!origins.length || !places.length) return {};
  if (origins.length > 50 || places.length > 50) throw new Error("Route matrix exceeds provider limits");
  for (const origin of origins) validateCoordinates(origin.coordinates);
  for (const place of places) validateCoordinates(place.coordinates);
  const output: Record<string, Record<string, number | null>> = {};
  for (const origin of origins) {
    if (!origin.participantId) throw new Error("Invalid route origin");
    output[origin.participantId] = Object.fromEntries(places.map((place) => [place.id, null]));
  }
  try {
    const response = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      signal: timeoutSignal(),
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey(),
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,condition,status",
      },
      body: JSON.stringify({
        origins: origins.map(({ coordinates }) => ({
          waypoint: { location: { latLng: { latitude: coordinates.latitude, longitude: coordinates.longitude } } },
        })),
        destinations: places.map(({ coordinates }) => ({
          waypoint: { location: { latLng: { latitude: coordinates.latitude, longitude: coordinates.longitude } } },
        })),
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    });
    if (!response.ok) return null;
    const body = await response.text();
    let entries: unknown[];
    try {
      const data: unknown = JSON.parse(body);
      entries = Array.isArray(data) ? data : [];
    } catch {
      entries = body.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
    }
    for (const item of entries as RouteMatrixItem[]) {
      if (
        typeof item.originIndex !== "number" || typeof item.destinationIndex !== "number" ||
        !origins[item.originIndex] || !places[item.destinationIndex] ||
        item.condition === "ROUTE_NOT_FOUND"
      ) continue;
      output[origins[item.originIndex]!.participantId]![places[item.destinationIndex]!.id] =
        durationMinutes(item.duration);
    }
    return output;
  } catch {
    return null;
  }
}