import { SCORING_WEIGHTS as W } from "./weights.js";
import { createHash } from "node:crypto";
import type {
  Activity,
  Category,
  Coordinates,
  Explanation,
  GroupPreferences,
  Plan,
  PlanItem,
  RankedRecommendation,
} from "../../types/src/index.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MOSCOW_OFFSET = 3 * 60 * MINUTE;
export const EXPLANATION_REASONS = [
  "interest_match",
  "within_budget",
  "time_fit",
  "nearby",
  "variety",
] as const;
type ExplanationReason = (typeof EXPLANATION_REASONS)[number];

interface Constraints {
  from: number;
  until: number;
  budget: number;
  radiusKm: number;
  minAge: number;
  vetoes: Set<Category>;
  origin: Coordinates;
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
function validCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lon) &&
    Math.abs(point.lat) <= 90 &&
    Math.abs(point.lon) <= 180
  );
}
function constraints(group: GroupPreferences): Constraints | null {
  const { settings, participants } = group;
  if (
    !participants.length ||
    !validCoordinates(settings.origin) ||
    !finiteNonnegative(settings.budget) ||
    !finiteNonnegative(settings.radiusKm) ||
    !Number.isFinite(settings.durationMinutes) ||
    settings.durationMinutes <= 0
  )
    return null;
  const start = Date.parse(settings.startsAt);
  if (!Number.isFinite(start)) return null;
  let from = start;
  let until = start + settings.durationMinutes * MINUTE;
  let budget = settings.budget;
  let radiusKm = settings.radiusKm;
  let minAge = Infinity;
  const vetoes = new Set<Category>();
  for (const person of participants) {
    const availableFrom = Date.parse(person.availableFrom);
    const availableUntil = Date.parse(person.availableUntil);
    if (
      !Number.isFinite(availableFrom) ||
      !Number.isFinite(availableUntil) ||
      availableUntil <= availableFrom ||
      !finiteNonnegative(person.budget) ||
      !finiteNonnegative(person.radiusKm) ||
      !finiteNonnegative(person.age)
    )
      return null;
    from = Math.max(from, availableFrom);
    until = Math.min(until, availableUntil);
    budget = Math.min(budget, person.budget);
    radiusKm = Math.min(radiusKm, person.radiusKm);
    minAge = Math.min(minAge, person.age);
    if (person.veto) vetoes.add(person.veto);
  }
  return until > from
    ? { from, until, budget, radiusKm, minAge, vetoes, origin: settings.origin }
    : null;
}

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad;
  const dlon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function coordinates(activity: Activity): Coordinates {
  return { lat: activity.latitude, lon: activity.longitude };
}
/** Approximation: 25% walking detour, 80 m/min. No live route or transit data. */
function travelMinutes(distanceKm: number): number {
  return distanceKm < 0.001 ? 0 : Math.ceil((distanceKm * 1.25) / 0.08);
}
function clockMinutes(clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hour = Number(match[1]),
    minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
/** Pilot opening hours use Europe/Moscow, fixed UTC+3 (no DST). */
function nextSlot(
  activity: Activity,
  arrival: number,
  until: number,
): { start: number; end: number } | null {
  const duration = activity.duration_minutes * MINUTE;
  const opens = clockMinutes(activity.opens_at),
    closes = clockMinutes(activity.closes_at);
  if (opens === null || closes === null) return null;
  const day = Math.floor((arrival + MOSCOW_OFFSET) / DAY) * DAY - MOSCOW_OFFSET;
  const eventStart =
    activity.start_time === null ? null : Date.parse(activity.start_time);
  const eventEnd =
    activity.end_time === null ? null : Date.parse(activity.end_time);
  if (
    (eventStart !== null && !Number.isFinite(eventStart)) ||
    (eventEnd !== null && !Number.isFinite(eventEnd))
  )
    return null;
  // A configured end without a fixed start is inconsistent catalogue data.
  if (eventStart === null && eventEnd !== null) return null;
  for (let i = -1; i <= Math.ceil((until - arrival) / DAY); i++) {
    const opening = day + i * DAY + opens * MINUTE;
    const closing =
      day + i * DAY + closes * MINUTE + (closes <= opens ? DAY : 0);
    const start = eventStart ?? Math.max(arrival, opening);
    const end = start + duration;
    if (
      start < arrival ||
      start < opening ||
      end > closing ||
      end > until ||
      (eventEnd !== null && end > eventEnd)
    )
      continue;
    return { start, end };
  }
  return null;
}

function eligible(
  activity: Activity,
  group: GroupPreferences,
  limits: Constraints,
): boolean {
  return (
    activity.city.toLocaleLowerCase("ru") ===
      group.settings.city.toLocaleLowerCase("ru") &&
    activity.availability_status !== "unavailable" &&
    finiteNonnegative(activity.price_from) &&
    finiteNonnegative(activity.price_to) &&
    activity.price_from <= activity.price_to &&
    Number.isFinite(activity.duration_minutes) &&
    activity.duration_minutes > 0 &&
    finiteNonnegative(activity.age_constraints) &&
    activity.age_constraints <= limits.minAge &&
    validCoordinates(coordinates(activity)) &&
    activity.price_to <= limits.budget &&
    !limits.vetoes.has(activity.category) &&
    haversineKm(limits.origin, coordinates(activity)) <= limits.radiusKm + 1e-9
  );
}

export function groupConsensus(
  group: GroupPreferences,
  activities: Activity[],
): number {
  return group.participants.filter((person) =>
    activities.some((activity) =>
      person.vibes.some((vibe) => activity.tags.includes(vibe)),
    ),
  ).length;
}

export function rank(
  group: GroupPreferences,
  activities: Activity[],
): RankedRecommendation[] {
  const limits = constraints(group);
  if (!limits) return [];
  return activities
    .filter((activity) => eligible(activity, group, limits))
    .flatMap((activity) => {
      const distance = haversineKm(limits.origin, coordinates(activity));
      if (
        !nextSlot(
          activity,
          limits.from + travelMinutes(distance) * MINUTE,
          limits.until,
        )
      )
        return [];
      const count = groupConsensus(group, [activity]);
      const interest =
        group.participants.reduce(
          (sum, person) =>
            sum +
            person.vibes.filter((vibe) => activity.tags.includes(vibe)).length /
              Math.max(1, person.vibes.length),
          0,
        ) / group.participants.length;
      const factors = {
        consensus: count / group.participants.length,
        interest,
        affordability:
          limits.budget === 0 ? 1 : 1 - activity.price_to / limits.budget,
        proximity:
          limits.radiusKm === 0
            ? 1
            : Math.max(0, 1 - distance / limits.radiusKm),
        timeFit: Math.min(
          1,
          (activity.duration_minutes * MINUTE) / (limits.until - limits.from),
        ),
      };
      const score =
        Math.round(
          10000 *
            (W.consensus * factors.consensus +
              W.interest * factors.interest +
              W.affordability * factors.affordability +
              W.proximity * factors.proximity +
              W.timeFit * factors.timeFit),
        ) / 100;
      return [
        {
          activity,
          score,
          consensusCount: count,
          totalParticipants: group.participants.length,
          factors,
          reasons: [
            `По интересам: ${count} из ${group.participants.length}`,
            `До ${activity.price_to} ₽ на человека`,
            "Помещается в общее время и радиус",
          ],
        },
      ];
    })
    .sort(
      (a, b) => b.score - a.score || a.activity.id.localeCompare(b.activity.id),
    );
}

export class RecommendationEngine {
  rank(
    group: GroupPreferences,
    activities: Activity[],
  ): RankedRecommendation[] {
    return rank(group, activities);
  }
  buildPlan(
    group: GroupPreferences,
    activities: Activity[],
    revision = 0,
  ): Plan | null {
    return buildPlan(group, activities, revision);
  }
}

interface Route {
  items: PlanItem[];
  end: number;
  price: number;
  distance: number;
  scoreSum: number;
  utility: number;
}
function routeKey(route: Route): string {
  return route.items.map((item) => item.activity.id).join("|");
}
function routeOrder(a: Route, b: Route): number {
  return (
    b.utility - a.utility ||
    a.price - b.price ||
    a.end - b.end ||
    routeKey(a).localeCompare(routeKey(b))
  );
}

export function buildPlan(
  group: GroupPreferences,
  activities: Activity[],
  revision = 0,
): Plan | null {
  const limits = constraints(group);
  if (!limits) return null;
  const candidates = rank(group, activities);
  if (!candidates.length) return null;
  let beam: Route[] = [
    {
      items: [],
      end: limits.from,
      price: 0,
      distance: 0,
      scoreSum: 0,
      utility: 0,
    },
  ];
  const completed: Route[] = [];
  for (let step = 0; step < 3; step++) {
    const next: Route[] = [];
    for (const route of beam) {
      const previous = route.items.at(-1);
      const position = previous
        ? coordinates(previous.activity)
        : limits.origin;
      for (const candidate of candidates) {
        const activity = candidate.activity;
        if (
          route.items.some(
            (item) =>
              item.activity.id === activity.id ||
              item.activity.category === activity.category,
          )
        )
          continue;
        if (route.price + activity.price_to > limits.budget) continue;
        const distance = haversineKm(position, coordinates(activity));
        const travel = travelMinutes(distance);
        const slot = nextSlot(
          activity,
          route.end + travel * MINUTE,
          limits.until,
        );
        if (!slot) continue;
        const items = [
          ...route.items,
          {
            activity,
            startTime: new Date(slot.start).toISOString(),
            endTime: new Date(slot.end).toISOString(),
            travelMinutes: travel,
          },
        ];
        const coverage =
          groupConsensus(
            group,
            items.map((item) => item.activity),
          ) / group.participants.length;
        const scoreSum = route.scoreSum + candidate.score;
        const idleMinutes =
          (slot.end - limits.from) / MINUTE -
          items.reduce((sum, item) => sum + item.activity.duration_minutes, 0);
        // Reward broad interest coverage and category variety, lightly penalise waiting and travel.
        const utility =
          coverage * 100 +
          (scoreSum / items.length) * 0.45 +
          items.length * 12 -
          idleMinutes * 0.06;
        next.push({
          items,
          end: slot.end,
          price: route.price + activity.price_to,
          distance: route.distance + distance,
          scoreSum,
          utility,
        });
      }
    }
    next.sort(routeOrder);
    beam = next.slice(0, 32);
    completed.push(...beam);
    if (!beam.length) break;
  }
  completed.sort(routeOrder);
  const best = completed[0];
  if (!best) return null;
  const selected = new Set(best.items.map((item) => item.activity.id));
  const points = [
    limits.origin,
    ...best.items.map((item) => coordinates(item.activity)),
  ];
  const plan: Plan = {
    id: createHash("sha256")
      .update(
        JSON.stringify({
          revision,
          group,
          items: best.items.map((item) => [item.activity.id, item.startTime]),
        }),
      )
      .digest("hex")
      .slice(0, 20),
    items: best.items,
    priceTotal: best.price,
    durationMinutes: Math.ceil((best.end - limits.from) / MINUTE),
    distanceKm: Math.round(best.distance * 100) / 100,
    consensusCount: groupConsensus(
      group,
      best.items.map((item) => item.activity),
    ),
    totalParticipants: group.participants.length,
    explanation: { text: "", mode: "rules" },
    mapUrl: `https://yandex.ru/maps/?mode=routes&rtext=${points.map((point) => `${point.lat},${point.lon}`).join("~")}&rtt=pd`,
    alternatives: candidates
      .filter((item) => !selected.has(item.activity.id))
      .slice(0, 3),
    vetoes: [...limits.vetoes].sort(),
    revision,
  };
  plan.explanation = deterministicExplanation(plan, group);
  return plan;
}

function allowedReasons(plan: Plan): ExplanationReason[] {
  return [
    "within_budget",
    "time_fit",
    "nearby",
    ...(plan.consensusCount ? ["interest_match" as const] : []),
    ...(plan.items.length > 1 ? ["variety" as const] : []),
  ];
}
function deterministicExplanation(
  plan: Plan,
  group: GroupPreferences,
): Explanation {
  const facts: Record<ExplanationReason, string> = {
    interest_match: `Маршрут совпадает хотя бы с одним интересом у ${plan.consensusCount} из ${group.participants.length} участников.`,
    within_budget: `Сумма верхних оценок цен — ${plan.priceTotal} ₽ на человека, в пределах общего бюджета.`,
    time_fit: `План с переходами и ожиданием занимает ${plan.durationMinutes} мин и помещается в общее окно времени.`,
    nearby: "Все точки находятся в радиусе, подходящем каждому участнику.",
    variety: `В плане ${plan.items.length} остановки разных категорий.`,
  };
  const reasons = allowedReasons(plan);
  return {
    text:
      reasons.map((reason) => facts[reason]).join(" ") +
      "",
    mode: "rules",
  };
}
