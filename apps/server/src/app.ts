import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { WebAuth } from "./web-auth.js";
import { AppError, Sessions } from "./sessions.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { getConfig, type Config } from "./config.js";
import { Store } from "./store.js";
import { demoSchema } from "./schemas.js";
import { validateMaxInitData } from "../../../packages/shared/src/max-auth.js";
import { CITIES, cityBy, type City } from "../../../packages/shared/src/cities.js";
import { activities } from "../../../data/activities.js";
import { liveActivities, resolveLocation, searchRussianCities } from "./places.js";
import type {
  Identity,
  Preference,
} from "../../../packages/types/src/index.js";
export async function createApp(overrides: Partial<Config> = {}, catalogue = liveActivities) {
  const config = getConfig(overrides),
    store = new Store(config.dbPath);
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.x-max-init-data"],
    },
    disableRequestLogging: true,
    bodyLimit: 24000,
  });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  const webAuth = new WebAuth(store);
  const sessions = new Sessions(store, config, (event) => app.log.info(event), catalogue);
  app.addHook("onClose", () => store.close());
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(req.method) &&
      origin &&
      origin !== new URL(config.appUrl).origin
    ) {
      throw new AppError(
        403,
        "ORIGIN",
        "Откройте приложение по его основной ссылке.",
      );
    }
  });
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: "Проверьте параметры: время, бюджет и выбранные интересы.",
        },
      });
    if (err instanceof AppError)
      return reply
        .code(err.statusCode)
        .send({ error: { code: err.code, message: err.message } });
    const e = err as { statusCode?: number };
    if (e.statusCode === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMIT",
          message: "Слишком много действий. Подождите минуту и повторите.",
        },
      });
    if (e.statusCode === 400 || e.statusCode === 413)
      return reply.code(e.statusCode).send({
        error: {
          code: "INVALID_REQUEST",
          message: "Не удалось прочитать параметры запроса.",
        },
      });
    app.log.error(
      { event: "request_failed", method: req.method },
      "Request failed",
    );
    return reply.code(500).send({
      error: {
        code: "SERVER_ERROR",
        message:
          "Не получилось выполнить действие. Попробуйте ещё раз — ваши ответы сохранены.",
      },
    });
  });
  function auth(req: FastifyRequest): Identity {
    const init = req.headers["x-max-init-data"];
    if (typeof init === "string" && init) {
      try {
        return validateMaxInitData(init, config.botToken);
      } catch {
        throw new AppError(
          401,
          "MAX_AUTH",
          "Сессия MAX истекла. Закройте и снова откройте мини-приложение.",
        );
      }
    }
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const user = bearer
      ? (webAuth.user(bearer) ?? (config.allowDemo ? store.demo(bearer) : null))
      : null;
    if (!user)
      throw new AppError(
        401,
        "AUTH",
        "Откройте приложение из MAX или запустите демо.",
      );
    return user;
  }
  const room = sessions.room.bind(sessions);
  const view = sessions.view.bind(sessions);
  const member = sessions.member.bind(sessions);
  app.get("/api/health", () => ({
    status: "ok",
    service: "soberemsya",
    version: "0.4.0",
  }));
  app.get("/api/config", () => ({
    allowDemo: config.allowDemo,
    botUsername: config.botUsername,
    appUrl: config.appUrl,
    cities: CITIES,
  }));
  app.post("/api/location/resolve", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const body = req.body as { lat?: number; lon?: number };
    if (!Number.isFinite(body?.lat) || !Number.isFinite(body?.lon) || Math.abs(body.lat!) > 90 || Math.abs(body.lon!) > 180)
      throw new AppError(400, "LOCATION", "Не удалось прочитать геопозицию.");
    try { return await resolveLocation({ lat: body.lat!, lon: body.lon! }); }
    catch { throw new AppError(503, "LOCATION", "Не удалось определить город и места рядом. Попробуйте ещё раз."); }
  });
  app.get("/api/location/search", { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } }, async (req) => {
    const q = String((req.query as {q?:string}).q ?? "").trim();
    if (q.length < 2) return { cities: [] };
    try { return { cities: await searchRussianCities(q) }; }
    catch { throw new AppError(503, "CITY_SEARCH", "Не удалось выполнить поиск. Отправьте геопозицию или повторите через минуту."); }
  });
  app.get("/api/profile", (req) => ({city:store.userCityData(auth(req).id) ?? null}));
  app.put("/api/profile", (req) => {
    const user=auth(req), value=(req.body as {city?:string|City})?.city;
    const city=typeof value==="string"?cityBy(value):value;
    if(!city||typeof city.name!=="string"||!Number.isFinite(city.center?.lat)||!Number.isFinite(city.center?.lon)||!Array.isArray(city.points))throw new AppError(400,"CITY","Выберите город из результатов поиска.");
    const safe:City={id:String(city.id).slice(0,100),name:city.name.trim().slice(0,100),center:{lat:city.center.lat,lon:city.center.lon},coverageKm:Math.min(100,Math.max(10,Number(city.coverageKm)||60)),points:city.points.filter((p)=>p&&typeof p.name==="string"&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)).slice(0,20)};
    store.setCity(user.id,safe);return {city:safe};
  });
  app.get("/api/catalog", (req) => {
    const city = cityBy((req.query as {city?:string}).city);
    if (!city) throw new AppError(400, "CITY_REQUIRED", "Выберите город каталога.");
    return {city:city.name, activities:activities.filter(x=>x.city===city.name)};
  });
  app.post(
    "/api/auth/demo",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      if (!config.allowDemo)
        throw new AppError(
          403,
          "DEMO_DISABLED",
          "Демо отключено. Откройте приложение из MAX.",
        );
      return store.createDemo(demoSchema.parse(req.body).displayName);
    },
  );
  app.post(
    "/api/auth/link",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const body = req.body as { ticket?: unknown } | null;
      if (typeof body?.ticket !== "string")
        throw new AppError(
          400,
          "LINK_INVALID",
          "Откройте личную ссылку из бота.",
        );
      return webAuth.exchange(body.ticket);
    },
  );
  app.get("/api/auth/me", async (req) => ({ user: auth(req) }));
  app.get("/api/sessions", async (req) => ({
    sessions: sessions.list(auth(req)),
  }));
  app.post("/api/sessions", async (req, reply) => {
    const result = sessions.create(
      auth(req),
      req.body,
      String(req.headers["idempotency-key"] ?? ""),
    );
    reply.code(result.created ? 201 : 200);
    return result.view;
  });
  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) =>
    sessions.get(req.params.id, auth(req)),
  );
  const answer = async (req: FastifyRequest<{ Params: { id: string } }>) =>
    sessions.answer(req.params.id, auth(req), req.body);
  app.post<{ Params: { id: string } }>("/api/sessions/:id/join", answer);
  app.put<{ Params: { id: string } }>("/api/sessions/:id/preferences", answer);
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/demo-fill",
    async (req) => {
      const u = auth(req),
        r = room(req.params.id, u);
      member(r, u);
      if (!r.isDemo || r.owner !== u.id)
        throw new AppError(
          403,
          "DEMO_ONLY",
          "Тестовые участники доступны только автору демо-плана.",
        );
      const remaining = Math.max(
        0,
        Math.min(4, 8 - store.members(r.id).length),
      );
      const specs: [string, Preference["vibes"], Preference["veto"]][] = [
        ["Аня", ["outdoor", "food", "calm"], null],
        ["Миша", ["active", "food", "unusual"], null],
        ["Саша", ["games", "food", "outdoor"], "cinema"],
        ["Даша", ["culture", "calm", "food"], null],
      ];
      let added = 0;
      for (const [i, [name, vibes, veto]] of specs.entries()) {
        const id = `demo-seed:${r.id}:${i}`;
        if (store.members(r.id).some((p) => p.id === id) || added >= remaining)
          continue;
        store.answer(
          r.id,
          { id, displayName: name + " · демо", kind: "demo" },
          {
            vibes,
            veto,
            budget: r.settings.budget,
            radiusKm: r.settings.radiusKm,
            availableFrom: r.settings.startsAt,
            availableUntil: new Date(
              Date.parse(r.settings.startsAt) +
                r.settings.durationMinutes * 60000,
            ).toISOString(),
            age: 25,
          },
        );
        added++;
      }
      return view(room(r.id, u), u);
    },
  );
  app.post<{ Params: { id: string } }>("/api/sessions/:id/plan", async (req) =>
    sessions.generate(req.params.id, auth(req)),
  );
  app.post<{ Params: { id: string } }>("/api/sessions/:id/share", async (req) =>
    sessions.share(req.params.id, auth(req)),
  );
  await app.register(fastifyStatic, {
    root: resolve("data/sources"),
    prefix: "/data/sources/",
    decorateReply: false,
  });
  if (existsSync(config.staticRoot)) {
    await app.register(fastifyStatic, { root: config.staticRoot, prefix: "/" });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api/")
        ? reply.code(404).send({
            error: { code: "NOT_FOUND", message: "Такой адрес не найден." },
          })
        : reply.sendFile("index.html"),
    );
  }
  return { app, store, config };
}
