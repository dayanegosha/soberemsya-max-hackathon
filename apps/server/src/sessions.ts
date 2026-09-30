import { randomBytes } from "node:crypto";
import type {
  Identity,
  Preference,
  SessionView,
} from "../../../packages/types/src/index.js";
import { activities } from "../../../data/activities.js";
import { buildPlan } from "../../../packages/recommendation/src/index.js";
import { answerSchema, createSchema } from "./schemas.js";
import { Store, type Room } from "./store.js";
import type { Config } from "./config.js";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const publicId = (id: string) => Buffer.from(id).toString("base64url");
type Log = (event: Record<string, unknown>) => void;

/** One domain service for the signed MAX mini app and verified Bot API events. */
export class Sessions {
  constructor(
    readonly store: Store,
    readonly config: Config,
    private log: Log = () => {},
    private catalogue: (settings: SessionView["settings"]) => Promise<typeof activities> = async () => activities,
  ) {}
  room(id: string, user: Identity): Room {
    const r = /^[a-zA-Z0-9_-]{20,40}$/.test(id) ? this.store.room(id) : null;
    if (!r || r.isDemo !== (user.kind === "demo"))
      throw new AppError(
        404,
        "NOT_FOUND",
        "Такой план не найден. Проверьте ссылку приглашения.",
      );
    if (Date.parse(r.expiresAt) < Date.now())
      throw new AppError(
        410,
        "EXPIRED",
        "Этот план уже завершён. Создайте новую встречу.",
      );
    return r;
  }
  member(r: Room, u: Identity) {
    if (!this.store.members(r.id).some((p) => p.id === u.id))
      throw new AppError(
        403,
        "JOIN_REQUIRED",
        "Сначала ответьте на короткий опрос и присоединитесь.",
      );
  }
  invite(r: Room) {
    return !r.isDemo && this.config.botUsername
      ? `https://max.ru/${this.config.botUsername}?start=s_${r.id}`
      : `${this.config.appUrl}/?session=${r.id}`;
  }
  view(r: Room, u: Identity): SessionView {
    const members = this.store.members(r.id),
      mine = members.find((p) => p.id === u.id);
    return {
      id: r.id,
      settings: r.settings,
      participants: members.map((p) => ({
        id: publicId(p.id),
        displayName: p.displayName,
        answered: !!p.preference,
      })),
      myPreference: mine?.preference ?? null,
      me: publicId(u.id),
      revision: r.revision,
      plan: r.plan,
      isDemo: r.isDemo,
      expiresAt: r.expiresAt,
      inviteUrl: this.invite(r),
      canGenerate: !!mine && members.filter((p) => p.preference).length >= 2,
    };
  }
  get(id: string, u: Identity) {
    return this.view(this.room(id, u), u);
  }
  list(u: Identity) {
    const rows = this.store.db
      .prepare(
        "SELECT s.id FROM sessions s JOIN participants p ON p.session_id=s.id WHERE p.user_id=? AND s.expires_at>? ORDER BY s.rowid DESC LIMIT 30",
      )
      .all(u.id, new Date().toISOString()) as { id: string }[];
    return rows.map((r) => this.get(r.id, u));
  }
  create(
    u: Identity,
    input: unknown,
    key: string,
  ): { view: SessionView; created: boolean } {
    const body = createSchema.parse(input),
      start = Date.parse(body.settings.startsAt);
    if (start < Date.now() - 300000 || start > Date.now() + 30 * 86400000)
      throw new AppError(
        400,
        "DATE",
        "Выберите время в ближайшие 30 дней, которое ещё не прошло.",
      );
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(key))
      throw new AppError(400, "IDEMPOTENCY", "Повторите создание плана.");
    const hash = this.store.hash(JSON.stringify(body));
    const existing = this.store.db
      .prepare(
        "SELECT session_id,body_hash FROM idempotency WHERE user_id=? AND key=?",
      )
      .get(u.id, key) as { session_id: string; body_hash: string } | undefined;
    if (existing) {
      if (existing.body_hash !== hash)
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Этот запрос уже использован. Начните новый план.",
        );
      return { view: this.get(existing.session_id, u), created: false };
    }
    const id = randomBytes(18).toString("base64url"),
      expires = new Date(
        start + body.settings.durationMinutes * 60000 + 86400000,
      ).toISOString();
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      this.store.db
        .prepare(
          "INSERT INTO sessions(id,owner,settings,is_demo,expires_at) VALUES (?,?,?,?,?)",
        )
        .run(
          id,
          u.id,
          JSON.stringify(body.settings),
          u.kind === "demo" ? 1 : 0,
          expires,
        );
      this.store.db
        .prepare("INSERT INTO participants VALUES (?,?,?,?)")
        .run(id, u.id, u.displayName, JSON.stringify(body.preference));
      this.store.db
        .prepare("INSERT INTO idempotency VALUES (?,?,?,?)")
        .run(u.id, key, hash, id);
      this.store.db.exec("COMMIT");
    } catch (e) {
      this.store.db.exec("ROLLBACK");
      throw e;
    }
    this.log({ event: "session_created", demo: u.kind === "demo" });
    return { view: this.get(id, u), created: true };
  }
  answer(id: string, u: Identity, input: unknown) {
    const r = this.room(id, u),
      { preference } = answerSchema.parse(input),
      members = this.store.members(id),
      existing = members.find((p) => p.id === u.id);
    if (!existing && members.length >= r.settings.expectedParticipants)
      throw new AppError(
        409,
        "FULL",
        "Все места в этой встрече уже заняты.",
      );
    if (
      existing &&
      JSON.stringify(existing.preference) === JSON.stringify(preference)
    )
      return this.view(r, u);
    this.store.answer(id, u, preference);
    this.log({
      event: existing ? "preferences_submitted" : "participant_joined",
      participantCount: members.length + (existing ? 0 : 1),
    });
    return this.get(id, u);
  }
  async generate(id: string, u: Identity) {
    const r = this.room(id, u);
    this.member(r, u);
    if (r.plan) return this.view(r, u);
    const participants = this.store
      .members(id)
      .flatMap((p) => (p.preference ? [p.preference] : []));
    if (participants.length < 2)
      throw new AppError(
        409,
        "MORE_PEOPLE",
        "Нужны ответы хотя бы двух участников. Пригласите друзей.",
      );
    const group = { settings: r.settings, participants };
    let catalogue: typeof activities;
    try {
      catalogue = await this.catalogue(r.settings);
    } catch {
      throw new AppError(503, "PLACES_UNAVAILABLE", "Не удалось загрузить места рядом. Попробуйте ещё раз через минуту.");
    }
    const plan = buildPlan(group, catalogue, r.revision);
    if (!plan)
      throw new AppError(
        422,
        "NO_MATCH",
        "Нет вариантов для всех ограничений. Измените свой бюджет, время или радиус и попробуйте снова. Вето остаётся в силе.",
      );
    const updated = this.store.db
      .prepare("UPDATE sessions SET plan=? WHERE id=? AND revision=?")
      .run(JSON.stringify(plan), id, r.revision);
    if (!updated.changes)
      throw new AppError(
        409,
        "CHANGED",
        "Кто-то обновил ответ. Рассчитайте план ещё раз.",
      );
    this.log({
      event: "recommendation_generated",
      participantCount: participants.length,
    });
    this.log({ event: "plan_generated", stops: plan.items.length });
    return this.get(id, u);
  }
  share(id: string, u: Identity) {
    const r = this.room(id, u);
    this.member(r, u);
    const p = r.plan;
    const text = p
      ? `ВЕЧЕР НАШЁЛСЯ ✨\n${p.items.map((x) => x.activity.title).join(" → ")}\nДо ${p.priceTotal} ₽ / человек · ${p.durationMinutes} мин\nСовпадение интересов: ${p.consensusCount} из ${p.totalParticipants}`
      : `Соберёмся? ${r.settings.title}\nВыберите свой вайб и поможем компании договориться.`;
    this.log({ event: "share_created", hasPlan: !!p });
    return { text, link: this.invite(r) };
  }
}
