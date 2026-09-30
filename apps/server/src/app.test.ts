import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp } from "./app.js";
import type { SessionView } from "../../../packages/types/src/index.js";
import { activities } from "../../../data/activities.js";
const start = new Date();
start.setUTCDate(start.getUTCDate() + 1);
start.setUTCHours(15, 0, 0, 0);
const preference = {
  vibes: ["outdoor", "food"],
  budget: 1500,
  radiusKm: 5,
  availableFrom: start.toISOString(),
  availableUntil: new Date(+start + 4 * 3600000).toISOString(),
  veto: null,
  age: 25,
};
const settings = {
  title: "Тестовая встреча",
  city: "Казань",
  startsAt: start.toISOString(),
  durationMinutes: 240,
  budget: 1500,
  radiusKm: 5,
  origin: { lat: 55.7879, lon: 49.1233 },
  expectedParticipants: 5,
};
test("full API scenario, privacy, idempotency, veto and invalidation", async (t) => {
  const { app, store } = await createApp({
    dbPath: ":memory:",
    allowDemo: true,
    botToken: "test-only-token",
    staticRoot: "/nonexistent",
  }, async () => activities);
  t.after(() => app.close());
  const identity = async (name: string) =>
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/demo",
        payload: { displayName: name },
      })
    ).json() as { token: string };
  const a = await identity("Организатор"),
    b = await identity("Друг");
  const headers = { authorization: `Bearer ${a.token}` },
    headersB = { authorization: `Bearer ${b.token}` };
  const make = () =>
    app.inject({
      method: "POST",
      url: "/api/sessions",
      headers: { ...headers, "idempotency-key": "create-test-123" },
      payload: { settings, preference },
    });
  const created = await make();
  assert.equal(created.statusCode, 201);
  let room = created.json<SessionView>();
  assert.equal(room.participants.length, 1);
  assert.equal((await make()).json<SessionView>().id, room.id);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/sessions/${room.id}/plan`,
        headers,
        payload: {},
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/api/sessions/${room.id}/share`,
        headers: headersB,
        payload: {},
      })
    ).statusCode,
    403,
  );
  const joined = await app.inject({
    method: "POST",
    url: `/api/sessions/${room.id}/join`,
    headers: headersB,
    payload: { preference: { ...preference, veto: "outdoor" } },
  });
  assert.equal(joined.statusCode, 200);
  const again = await app.inject({
    method: "POST",
    url: `/api/sessions/${room.id}/join`,
    headers: headersB,
    payload: { preference: { ...preference, veto: "outdoor" } },
  });
  assert.equal(
    again.json<SessionView>().revision,
    joined.json<SessionView>().revision,
  );
  const publicRoom = (
    await app.inject({ url: `/api/sessions/${room.id}`, headers })
  ).json<SessionView>();
  assert.equal(publicRoom.myPreference?.veto, null);
  assert.ok(
    publicRoom.participants.every(
      (p) => !("preference" in p) && !("veto" in p),
    ),
  );
  const planned = await app.inject({
    method: "POST",
    url: `/api/sessions/${room.id}/plan`,
    headers,
    payload: {},
  });
  assert.equal(planned.statusCode, 200, planned.body);
  room = planned.json<SessionView>();
  assert.ok(room.plan);
  assert.ok(room.plan.items.every((i) => i.activity.category !== "outdoor"));
  const shared = await app.inject({
    method: "POST",
    url: `/api/sessions/${room.id}/share`,
    headers,
    payload: {},
  });
  assert.ok(shared.json().link.includes(room.id));
  assert.ok(!shared.body.includes(a.token));
  await app.inject({
    method: "PUT",
    url: `/api/sessions/${room.id}/preferences`,
    headers: headersB,
    payload: { preference: { ...preference, veto: "food" } },
  });
  assert.equal(
    (
      await app.inject({ url: `/api/sessions/${room.id}`, headers })
    ).json<SessionView>().plan,
    null,
  );
  assert.equal(
    (await app.inject({ url: "/api/sessions/no-such-id", headers })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: `/api/sessions/${room.id}` })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/api/sessions/${room.id}/preferences`,
        headers,
        payload: { preference: { ...preference, budget: -1 } },
      })
    ).statusCode,
    400,
  );
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 77, first_name: "MAX" }),
  });
  const secret = createHmac("sha256", "WebAppData")
    .update("test-only-token")
    .digest();
  p.set(
    "hash",
    createHmac("sha256", secret)
      .update(
        [...p]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      )
      .digest("hex"),
  );
  assert.equal(
    (
      await app.inject({
        url: `/api/sessions/${room.id}`,
        headers: { "x-max-init-data": p.toString() },
      })
    ).statusCode,
    404,
    "MAX identity cannot access demo room",
  );
  store.db
    .prepare("UPDATE sessions SET expires_at=? WHERE id=?")
    .run("2020-01-01T00:00:00Z", room.id);
  assert.equal(
    (await app.inject({ url: `/api/sessions/${room.id}`, headers })).statusCode,
    410,
  );
});
test("demo disabled rejects unauthenticated browser identity", async (t) => {
  const { app } = await createApp({
    dbPath: ":memory:",
    allowDemo: false,
    staticRoot: "/nonexistent",
  });
  t.after(() => app.close());
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/demo",
        payload: { displayName: "Тест" },
      })
    ).statusCode,
    403,
  );
});

test("profile city persists and catalog stays inside the selected city", async (t) => {
  const { app } = await createApp({
    dbPath: ":memory:",
    allowDemo: true,
    staticRoot: "/nonexistent",
  });
  t.after(() => app.close());
  const identity = (
    await app.inject({
      method: "POST",
      url: "/api/auth/demo",
      payload: { displayName: "Петербуржец" },
    })
  ).json<{ token: string }>();
  const headers = { authorization: `Bearer ${identity.token}` };
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/api/profile",
        headers,
        payload: { city: "Санкт-Петербург" },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/api/profile", headers })).json().city.name,
    "Санкт-Петербург",
  );
  const catalog = (
    await app.inject({ url: "/api/catalog?city=spb" })
  ).json<{ activities: { city: string }[] }>();
  assert.equal(catalog.activities.length, 56);
  assert.ok(catalog.activities.every((activity) => activity.city === "Санкт-Петербург"));
  assert.equal((await app.inject({ url: "/api/catalog" })).statusCode, 400);
});
