import test from "node:test";
import assert from "node:assert/strict";
import { rank, buildPlan, haversineKm } from "./index.js";
import { activities } from "../../../data/activities.js";
import type {
  Activity,
  GroupPreferences,
  Preference,
} from "../../types/src/index.js";
const person = (extra: Partial<Preference> = {}): Preference => ({
  vibes: ["food", "outdoor", "games"],
  budget: 1500,
  radiusKm: 5,
  availableFrom: "2026-09-26T15:00:00Z",
  availableUntil: "2026-09-26T20:00:00Z",
  veto: null,
  age: 25,
  ...extra,
});
const group = (people = [person()]): GroupPreferences => ({
  settings: {
    title: "Тест",
    city: "Казань",
    startsAt: "2026-09-26T15:00:00Z",
    durationMinutes: 300,
    budget: 1500,
    radiusKm: 5,
    origin: { lat: 55.7879, lon: 49.1233 },
    expectedParticipants: 5,
  },
  participants: people,
});
const activity = (extra: Partial<Activity> = {}): Activity => ({
  ...activities[0],
  id: "a",
  category: "outdoor",
  price_from: 0,
  price_to: 0,
  duration_minutes: 30,
  latitude: 55.7879,
  longitude: 49.1233,
  opens_at: "00:00",
  closes_at: "23:59",
  start_time: null,
  end_time: null,
  tags: ["outdoor"],
  ...extra,
});
test("catalogue has 112 marked and traceable demo activities", () => {
  assert.equal(activities.length, 112);
  assert.equal(new Set(activities.map((a) => a.id)).size, 112);
  assert.ok(
    activities.every(
      (a) => a.is_demo_data && a.source_url && a.source_updated_at,
    ),
  );
});
test("empty group has no recommendations", () =>
  assert.deepEqual(rank(group([]), activities), []));
test("empty catalogue has no plan", () =>
  assert.equal(buildPlan(group(), []), null));
test("one participant gets reproducible ranking", () => {
  assert.ok(rank(group(), activities).length);
  assert.deepEqual(
    rank(group(), activities),
    rank(group(), [...activities].reverse()),
  );
});
test("five participants consensus is computed from actual interests", () => {
  const r = rank(
    group([
      person(),
      person(),
      person(),
      person(),
      person({ vibes: ["culture"] }),
    ]),
    [activity()],
  );
  assert.equal(r[0].consensusCount, 4);
  assert.equal(r[0].totalParticipants, 5);
});
test("veto hard excludes even highest scoring category", () =>
  assert.deepEqual(
    rank(group([person({ veto: "outdoor" })]), [activity()]),
    [],
  ));
test("all category vetoes cannot be relaxed", () => {
  const g = group(
    [
      "outdoor",
      "food",
      "games",
      "culture",
      "active",
      "cinema",
      "unusual",
      "volunteer",
    ].map((v) => person({ veto: v as Preference["veto"] })),
  );
  assert.equal(buildPlan(g, activities), null);
});
test("no veto leaves valid item", () =>
  assert.equal(rank(group(), [activity()]).length, 1));
test("minimum group budget filters upper price bound", () =>
  assert.equal(
    rank(group([person(), person({ budget: 100 })]), [
      activity({ price_from: 50, price_to: 101 }),
    ]).length,
    0,
  ));
test("zero budget accepts free plans only", () => {
  const p = buildPlan(group([person({ budget: 0 })]), activities);
  assert.ok(p);
  assert.equal(p.priceTotal, 0);
});
test("budget applies to whole route", () => {
  const p = buildPlan(group([person({ budget: 700 })]), [
    activity({ id: "a", price_to: 500 }),
    activity({ id: "b", category: "food", price_to: 500 }),
  ]);
  assert.ok(p);
  assert.ok(p.priceTotal <= 700);
  assert.equal(p.items.length, 1);
});
test("nonoverlapping participant availability produces no result", () =>
  assert.equal(
    buildPlan(
      group([
        person(),
        person({
          availableFrom: "2026-09-27T15:00:00Z",
          availableUntil: "2026-09-27T17:00:00Z",
        }),
      ]),
      activities,
    ),
    null,
  ));
test("closed venue excluded", () =>
  assert.equal(
    rank(group(), [activity({ opens_at: "08:00", closes_at: "12:00" })]).length,
    0,
  ));
test("fixed event cannot be joined after it starts", () =>
  assert.equal(
    rank(group(), [
      activity({
        start_time: "2026-09-26T14:00:00Z",
        end_time: "2026-09-26T16:00:00Z",
      }),
    ]).length,
    0,
  ));
test("walking time must fit remaining interval", () =>
  assert.equal(
    rank(group([person({ availableUntil: "2026-09-26T15:30:00Z" })]), [
      activity({ latitude: 55.798, duration_minutes: 30 }),
    ]).length,
    0,
  ));
test("strictest participant radius applies", () =>
  assert.equal(
    rank(group([person({ radiusKm: 0.2 })]), [activity({ latitude: 55.82 })])
      .length,
    0,
  ));
test("haversine returns zero at origin and symmetric positive distance", () => {
  const a = { lat: 55, lon: 49 },
    b = { lat: 56, lon: 50 };
  assert.equal(haversineKm(a, a), 0);
  assert.equal(haversineKm(a, b), haversineKm(b, a));
  assert.ok(haversineKm(a, b) > 100);
});
test("age restrictions apply to youngest member", () =>
  assert.equal(
    rank(group([person({ age: 18 })]), [activity({ age_constraints: 21 })])
      .length,
    0,
  ));
test("another city excluded", () =>
  assert.equal(rank(group(), [activity({ city: "Самара" })]).length, 0));
test("unavailable excluded", () =>
  assert.equal(
    rank(group(), [activity({ availability_status: "unavailable" })]).length,
    0,
  ));
test("tied scores use stable IDs", () =>
  assert.deepEqual(
    rank(group(), [activity({ id: "b" }), activity({ id: "a" })]).map(
      (r) => r.activity.id,
    ),
    ["a", "b"],
  ));
test("route respects chronological time and total duration", () => {
  const g = group([person(), person()]);
  const p = buildPlan(g, activities, 4);
  assert.ok(p);
  assert.equal(p.revision, 4);
  assert.ok(p.durationMinutes <= 300);
  assert.ok(p.items.length <= 3);
  for (let i = 1; i < p.items.length; i++)
    assert.ok(
      Date.parse(p.items[i].startTime) >=
        Date.parse(p.items[i - 1].endTime) + p.items[i].travelMinutes * 60000,
    );
});
test("independent groups do not share veto state", () => {
  const a = group([person({ veto: "outdoor" })]),
    b = group();
  assert.equal(rank(a, [activity()]).length, 0);
  assert.equal(rank(b, [activity()]).length, 1);
});
