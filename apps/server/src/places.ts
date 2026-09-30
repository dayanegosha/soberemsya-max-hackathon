import type { Activity, Coordinates, SessionSettings, Category, Vibe } from "../../../packages/types/src/index.js";
import { CITIES, cityAt, type City, type MeetingPoint } from "../../../packages/shared/src/cities.js";

const agent = "Soberemsya-MAX-Hackathon/0.4.0 (https://soberemsya.139.100.225.250.sslip.io)";
const cityCache = new Map<string, { value: City; expires: number }>();
const placesCache = new Map<string, { value: Activity[]; expires: number }>();
const key = (p: Coordinates) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

async function json(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { "User-Agent": agent, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`places upstream ${response.status}`);
  return response.json() as Promise<any>;
}

async function reversePlace(point: Coordinates): Promise<{ name: string; countryCode: string }> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({ format: "jsonv2", lat: String(point.lat), lon: String(point.lon), zoom: "10", addressdetails: "1", "accept-language": "ru" }).toString();
  const result = await json(url.toString());
  const a = result.address ?? {};
  const name = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state;
  if (typeof name !== "string" || !name.trim()) throw new Error("city not found");
  return { name: name.trim(), countryCode: String(a.country_code ?? "").toLowerCase() };
}
export async function reverseCity(point: Coordinates): Promise<string> {
  const place = await reversePlace(point);
  if (place.countryCode !== "ru") throw new Error("outside Russia");
  return place.name;
}

type SearchResult = { lat: string; lon: string; address?: Record<string, string>; display_name?: string };
export async function searchRussianCities(query: string): Promise<City[]> {
  const q = query.trim();
  if (q.length < 2 || q.length > 80) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    format: "jsonv2", q, countrycodes: "ru", addressdetails: "1", limit: "8", "accept-language": "ru",
  }).toString();
  const results = await json(url.toString()) as SearchResult[];
  const known = CITIES.filter((city) => city.name.toLocaleLowerCase("ru").includes(q.toLocaleLowerCase("ru")));
  const dynamic = results.flatMap((item) => {
    const lat = Number(item.lat), lon = Number(item.lon), a = item.address ?? {};
    const name = a.city ?? a.town ?? a.village ?? a.municipality;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    const curated = cityAt({ lat, lon });
    return [curated ?? {
      id: `geo-${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`,
      name,
      center: { lat, lon },
      coverageKm: 60,
      points: [{ id: "center", name: `Центр города ${name}`, lat, lon }],
    }];
  });
  const seen = new Set<string>();
  return [...known, ...dynamic].filter((city) => {
    const k = city.name.toLocaleLowerCase("ru");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
}

type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: Coordinates; tags?: Record<string, string> };
function kind(tags: Record<string, string>): { category: Category; type: Activity["type"]; tags: Vibe[]; duration: number; price: number } {
  const amenity = tags.amenity, tourism = tags.tourism, leisure = tags.leisure;
  if (["cafe", "restaurant", "fast_food", "food_court"].includes(amenity)) return { category: "food", type: "food", tags: ["food", "calm"], duration: 60, price: 1500 };
  if (amenity === "cinema") return { category: "cinema", type: "entertainment", tags: ["culture", "calm"], duration: 120, price: 1000 };
  if (["library", "arts_centre", "community_centre"].includes(amenity) || ["museum", "gallery"].includes(tourism)) return { category: "culture", type: "culture", tags: ["culture", "calm"], duration: 90, price: 1000 };
  if (["sports_centre", "fitness_centre", "stadium", "pitch"].includes(leisure)) return { category: "active", type: "sport", tags: ["active"], duration: 90, price: 1500 };
  if (["park", "garden", "nature_reserve"].includes(leisure) || ["viewpoint", "attraction"].includes(tourism)) return { category: "outdoor", type: "outdoor", tags: ["outdoor", "calm"], duration: 60, price: 0 };
  return { category: "unusual", type: "tourism", tags: ["unusual", "culture"], duration: 60, price: 1000 };
}
function hours(value?: string) {
  if (value === "24/7") return ["00:00", "23:59"] as const;
  const match = value?.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
  return match ? [match[1]!, match[2]!] as const : ["08:00", "23:00"] as const;
}
function toActivity(element: OsmElement, city: string): Activity | null {
  const t = element.tags ?? {}, name = t["name:ru"] ?? t.name;
  const latitude = element.lat ?? element.center?.lat, longitude = element.lon ?? element.center?.lon;
  if (!name || latitude === undefined || longitude === undefined) return null;
  const meta = kind(t), [opens_at, closes_at] = hours(t.opening_hours);
  const address = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ") || city;
  return {
    id: `osm-${element.type}-${element.id}`, title: name, description: `Реальное место рядом с выбранной точкой встречи.`,
    type: meta.type, category: meta.category, city, district: t["addr:district"] ?? "", address,
    latitude, longitude, price_from: 0, price_to: meta.price, duration_minutes: meta.duration,
    start_time: null, end_time: null, opens_at, closes_at, tags: meta.tags, age_constraints: 0,
    source_name: "OpenStreetMap", source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    source_updated_at: new Date().toISOString().slice(0, 10), availability_status: "unknown", is_demo_data: false,
  };
}
export async function liveActivities(settings: Pick<SessionSettings, "city" | "origin">): Promise<Activity[]> {
  const cacheKey = `${settings.city}:${key(settings.origin)}`, cached = placesCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  const q = `[out:json][timeout:18];(nw(around:4500,${settings.origin.lat},${settings.origin.lon})[name][amenity~"cafe|restaurant|fast_food|food_court|cinema|library|arts_centre|community_centre"];nw(around:4500,${settings.origin.lat},${settings.origin.lon})[name][tourism~"museum|gallery|attraction|viewpoint"];nw(around:4500,${settings.origin.lat},${settings.origin.lon})[name][leisure~"park|garden|nature_reserve|sports_centre|fitness_centre|stadium|pitch"];);out center tags 80;`;
  const body = new URLSearchParams({ data: q });
  let result: { elements: OsmElement[] } | undefined, lastError: unknown;
  for (const endpoint of ["https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass-api.de/api/interpreter"]) {
    try { result = await json(endpoint, { method: "POST", body }); break; }
    catch (error) { lastError = error; }
  }
  if (!result) throw lastError;
  const seen = new Set<string>();
  const value = (result.elements as OsmElement[]).flatMap((e) => { const a = toActivity(e, settings.city); if (!a || seen.has(a.title.toLowerCase())) return []; seen.add(a.title.toLowerCase()); return [a]; });
  if (value.length < 3) throw new Error("not enough places");
  placesCache.set(cacheKey, { value, expires: Date.now() + 15 * 60_000 });
  return value;
}
export async function resolveLocation(point: Coordinates): Promise<City> {
  const cached = cityCache.get(key(point)); if (cached && cached.expires > Date.now()) return cached.value;
  const curated = cityAt(point);
  if (curated) return curated;
  const name = await reverseCity(point);
  let points: MeetingPoint[] = [];
  try { points = (await liveActivities({ city: name, origin: point })).slice(0, 12).map((a) => ({ id: a.id, name: a.title, lat: a.latitude, lon: a.longitude })); }
  catch { points = [{ id: "current", name: "Геопозиция организатора", ...point }]; }
  const city: City = { id: `geo-${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`, name, center: point, coverageKm: 60, points };
  cityCache.set(key(point), { value: city, expires: Date.now() + 15 * 60_000 });
  return city;
}
