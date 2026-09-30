import type { Button } from "@maxhub/max-bot-api/types";
import type { Identity, SessionView } from "../../../packages/types/src/index.js";
import { AppError, Sessions } from "../../server/src/sessions.js";
import { BotState, type Draft, type Group } from "./state.js";
import { cityAt, cityBy, type City } from "../../../packages/shared/src/cities.js";
import { errorMetadata } from "./errors.js";
import {
  cb,
  link,
  labels,
  time,
  day,
  wizard,
  newDraft,
  applyLocation,
  change,
  textAnswer,
  type View,
} from "./wizard.js";

export interface Event {
  id: string;
  kind: "start" | "message" | "callback" | "added" | "removed";
  chatId: number;
  group: boolean;
  user: Identity;
  messageId?: string;
  text?: string;
  payload?: string;
  location?: {lat:number;lon:number};
}
export interface Transport {
  send(chatId: number, view: View): Promise<string>;
  edit(mid: string, view: View): Promise<boolean>;
}
export interface BotOptions {
  username: string;
  botId: number;
  appUrl: string;
  resolveLocation?: (point: { lat: number; lon: number }) => Promise<City>;
}
const help =
  "Соберёмся помогает компании выбрать досуг.\n\nВ личке: «Создать встречу» → геопозиция → время и место → вайб → бюджет → личное вето. Друзья отвечают по приглашению. Результат с маршрутом приходит прямо в чат.\n\nВ группе: добавьте бота и отправьте /plan. Личные ответы соберём в личке, общая карточка останется в группе.\n\nMini app и бот работают с одними встречами. Места рядом подбираются по карте для города встречи.\n\n18+\n/plan — новая встреча\n/myplans — мои встречи\n/status — состояние встречи\n/cancel — отменить опрос";

/** Verified events only. The controller never accepts user IDs or group destinations from callback data. */
export class BotController {
  readonly state: BotState;
  private queues = new Map<string, Promise<void>>();
  constructor(
    readonly sessions: Sessions,
    readonly io: Transport,
    readonly options: BotOptions,
  ) {
    this.state = new BotState(sessions.store);
    this.state.clean();
  }
  private serial(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    this.queues.set(key, next);
    void next
      .finally(() => {
        if (this.queues.get(key) === next) this.queues.delete(key);
      })
      .catch(() => {});
    return next;
  }
  handle(e: Event) {
    return this.serial("user:" + e.user.id, async () => {
      if (this.state.seen(e.id)) return;
      try {
        await this.dispatch(e);
      } catch (err) {
        if (!(err instanceof AppError)) this.state.forget(e.id);
        const message =
          err instanceof AppError
            ? err.message
            : "Не получилось выполнить действие. Попробуйте ещё раз — сохранённые ответы не потеряны.";
        console.warn(
          JSON.stringify({
            event: "bot_action_failed",
            code: err instanceof AppError ? err.code : "UNEXPECTED",
            cause: errorMetadata(err),
          }),
        );
        if (e.group) {
          const group = this.state.group(e.chatId);
          await this.io.send(e.chatId, {
            text: message,
            buttons: [
              [
                link(
                  "Ответить в личке",
                  this.botLink(group?.room_id ? "s_" + group.room_id : ""),
                ),
              ],
            ],
          });
          return;
        }
        const draft = !e.group ? this.state.draft(e.user.id) : null;
        const roomId =
          !e.group &&
          e.payload?.match(
            /^(?:calc|room|edit|invite):([A-Za-z0-9_-]{20,40})$/,
          )?.[1];
        const buttons = roomId
          ? [
              [cb("Изменить мой ответ", `edit:${roomId}`)],
              [cb("Пригласить друга", `invite:${roomId}`)],
              [cb("К встрече", `room:${roomId}`)],
            ]
          : draft
            ? [[cb("Продолжить опрос", "resume")], ...this.homeButtons()]
            : this.homeButtons(e.group);
        await this.present(e, { text: message, buttons });
      }
    });
  }
  private botLink(payload = "") {
    return `https://max.ru/${this.options.username}${payload ? "?start=" + encodeURIComponent(payload) : ""}`;
  }
  private mini(payload = ""): Button {
    return {
      type: "open_app",
      text: "Открыть mini app",
      // MAX API requires web_app even though SDK 0.3.1 marks it optional.
      web_app: this.options.username,
      contact_id: this.options.botId,
      payload,
    };
  }
  private homeButtons(group = false): Button[][] {
    return group
      ? [[link("Перейти в личку", this.botLink())]]
      : [
          [cb("✨ Создать встречу", "new")],
          [cb("Мои встречи", "mine"), cb("Как собрать группу", "groups")],
          [{type:"request_geo_location",text:"Определить город"}],
          [this.mini()],
          [cb("Как это работает", "help")],
        ];
  }
  private async present(e: Event, v: View) {
    if (
      e.kind === "callback" &&
      e.messageId &&
      (await this.io.edit(e.messageId, v))
    )
      return e.messageId;
    return this.io.send(e.chatId, v);
  }
  private async home(e: Event) {
    const d = this.state.draft(e.user.id),
      buttons = this.homeButtons();
    if (d && !d.resultId)
      buttons.unshift([cb("Продолжить мой опрос", "resume")]);
    await this.present(e, {
      text: "Давайте соберёмся ✨\n\nЯ помогу выбрать общий план прямо в переписке. Создайте встречу кнопками и пригласите друзей — каждый ответит лично.\n\nОтправьте геопозицию: определю город и найду реальные места рядом. Та же встреча доступна в mini app.\n\n18+",
      buttons,
    });
  }
  private async startDraft(e: Event, room?: SessionView, groupId?: number) {
    const saved=this.sessions.store.userCityData(e.user.id);
    const d = newDraft(room, groupId, Date.now(), saved ?? "Москва");
    if(!room)d.step="city";
    if (groupId !== undefined)
      d.groupRoomId = this.state.group(groupId)?.room_id ?? null;
    this.state.save(e.user.id, d);
    await this.present(e, wizard(d));
  }
  private roomText(r: SessionView, auto = false): string {
    const s = r.settings,
      p = r.plan;
    const header = `СОБЕРЁМСЯ · ${s.title}\n${s.city} · ${day(s.startsAt)}, ${time(s.startsAt)} · ${s.durationMinutes / 60} ч\nОтветили: ${r.participants.length}/${s.expectedParticipants}\n${r.participants.map((x) => x.displayName).join(", ")}\n`;
    if (!p)
      return (
        header +
        `\n${r.participants.length < 2 ? "Нужен ответ ещё хотя бы одного друга." : auto ? "Общего варианта пока нет. Проверьте свои ограничения — вето остаётся в силе." : "Можно рассчитать сейчас или дождаться остальных."}\n\nЛичные ответы скрыты. Каждый отвечает в личке бота или mini app.`
      );
    return (
      header +
      `\n✨ ПЛАН ГОТОВ\n${p.items.map((x, i) => `${i + 1}. ${time(x.startTime)}–${time(x.endTime)} · ${x.activity.title} · до ${x.activity.price_to} ₽`).join("\n")}\n\nДо ${p.priceTotal} ₽/чел. · ${p.durationMinutes} мин с переходами\nПо интересам: ${p.consensusCount} из ${p.totalParticipants}\n${p.vetoes.length ? "Учтено вето: " + p.vetoes.map((x) => labels[x]).join(", ") + ".\n" : ""}\n${p.explanation.text}\n\nМеста найдены рядом с точкой встречи. Проверьте режим работы перед выходом.`
    );
  }
  private async showRoom(e: Event, id: string) {
    const r = this.sessions.get(id, e.user);
    const buttons: Button[][] = [
      [
        cb(
          r.myPreference ? "Изменить мой ответ" : "Ответить и присоединиться",
          `edit:${id}`,
        ),
      ],
    ];
    if (r.myPreference && !r.plan)
      buttons.push([
        cb("Найти общий план", `calc:${id}`),
        cb("Кто ответил", `members:${id}`),
      ]);
    else if (r.myPreference)
      buttons.push([cb("Кто ответил", `members:${id}`)]);
    if (r.plan) buttons.push([link("🗺 Открыть маршрут", r.plan.mapUrl)]);
    buttons.push(
      [cb("Пригласить друзей", `invite:${id}`)],
      [this.mini("s_" + id)],
      [cb("← Мои встречи", "mine")],
    );
    await this.present(e, { text: this.roomText(r), buttons });
  }
  private async myPlans(e: Event) {
    const rooms = this.sessions.list(e.user);
    await this.present(e, {
      text: rooms.length
        ? "МОИ ВСТРЕЧИ\n\nВыберите встречу. Здесь также появляются встречи, созданные вами в mini app."
        : "Пока нет встреч. Давайте создадим первую.",
      buttons: [
        ...rooms
          .slice(0, 12)
          .map((r) => [
            cb(
              `${day(r.settings.startsAt)} · ${time(r.settings.startsAt)} · ${r.participants.length} чел.`,
              `room:${r.id}`,
            ),
          ]),
        [cb("✨ Новая встреча", "new")],
        [cb("← Главное меню", "home")],
      ],
    });
  }
  private async saveDraft(e: Event, d: Draft) {
    if (d.resultId) {
      await this.showRoom(e, d.resultId);
      return;
    }
    if (d.groupId && !this.state.group(d.groupId)?.active)
      throw new AppError(
        409,
        "GROUP_REMOVED",
        "Бота уже нет в этой группе. Создайте обычную встречу и пригласите друзей ссылкой.",
      );
    if (
      d.groupId &&
      this.state.group(d.groupId)?.room_id !== (d.groupRoomId ?? null)
    )
      throw new AppError(
        409,
        "GROUP_CHANGED",
        "В этой группе уже создали другую встречу. Откройте актуальную карточку в беседе или начните новую через /plan. Ваш черновик сохранён.",
      );
    const previous = d.roomId ? this.sessions.get(d.roomId, e.user) : null;
    let r = d.roomId
      ? this.sessions.answer(d.roomId, e.user, { preference: d.preference })
      : this.sessions.create(
          e.user,
          { settings: d.settings, preference: d.preference },
          "bot-" + d.id,
        ).view;
    this.sessions.store.setCity(e.user.id,d.city ?? r.settings.city);
    d.resultId = r.id;
    d.revision++;
    this.state.save(e.user.id, d);
    if (previous?.plan && r.canGenerate) {
      try {
        r = await this.sessions.generate(r.id, e.user);
      } catch (err) {
        if (!(err instanceof AppError && err.code === "NO_MATCH")) throw err;
      }
    }
    if (d.groupId) {
      this.state.link(d.groupId, r.id);
      await this.syncGroup(d.groupId);
    }
    await this.showRoom(e, r.id);
  }
  private async dispatch(e: Event) {
    if (e.kind === "removed") {
      this.state.remove(e.chatId);
      return;
    }
    if (e.group) {
      await this.groupEvent(e);
      return;
    }
    if (e.kind === "start") {
      await this.startPayload(e, e.payload ?? "");
      return;
    }
    if(e.kind==="message" && e.location){
      const c=cityAt(e.location) ?? await this.options.resolveLocation?.(e.location);
      if(!c)throw new AppError(400,"CITY_OUTSIDE","Не удалось определить город по этой геопозиции. Попробуйте отправить её ещё раз.");
      this.sessions.store.setCity(e.user.id,c);
      const d=this.state.draft(e.user.id);
      if(d&&!d.resultId&&!d.roomId&&["city","points","meeting"].includes(d.step)){applyLocation(d,e.location,c);this.state.save(e.user.id,d);await this.present(e,wizard(d));}
      else await this.present(e,{text:`Ваш город: ${c.name}. Новые встречи будут здесь. Существующие встречи остаются в своём городе.`,buttons:this.homeButtons()});
      return;
    }
    if (e.kind === "message") {
      const text = (e.text ?? "").trim(),
        m = text.match(/^\/([a-z]+)(?:@[A-Za-z0-9_]+)?(?:\s+(.+))?$/i),
        command = m?.[1]?.toLowerCase();
      if (command === "start") {
        await this.startPayload(e, m?.[2] ?? "");
        return;
      }
      if (
        command === "plan" ||
        /^(создать|новая встреча|собраться)$/i.test(text)
      ) {
        await this.startDraft(e);
        return;
      }
      if (
        command === "myplans" ||
        command === "status" ||
        command === "result"
      ) {
        await this.myPlans(e);
        return;
      }
      if (command === "cancel") {
        this.state.cancel(e.user.id);
        await this.home(e);
        return;
      }
      if (command === "help") {
        await this.present(e, { text: help, buttons: this.homeButtons() });
        return;
      }
      const draft = this.state.draft(e.user.id);
      if (draft && !draft.resultId) {
        if (textAnswer(draft, text)) {
          this.state.save(e.user.id, draft);
          await this.present(e, wizard(draft));
        } else
          await this.present(e, {
            ...wizard(draft),
            text:
              "Ответьте кнопками ниже. /cancel — отменить опрос.\n\n" +
              wizard(draft).text,
          });
        return;
      }
      await this.home(e);
      return;
    }
    const payload = e.payload ?? "";
    if (payload.startsWith("f:")) {
      const [, id, revision, action = "", value = ""] = payload.split(":"),
        d = this.state.draft(e.user.id);
      if (!d || d.id !== id)
        throw new AppError(
          409,
          "OLD_FORM",
          "Этот опрос уже закрыт. Начните новый или откройте встречу в «Мои встречи».",
        );
      if (d.resultId) {
        await this.showRoom(e, d.resultId);
        return;
      }
      if (d.revision !== Number(revision)) {
        await this.present(e, wizard(d));
        return;
      }
      const result = change(d, action, value);
      if (result === "save") await this.saveDraft(e, d);
      else {
        this.state.save(e.user.id, d);
        await this.present(e, wizard(d));
      }
      return;
    }
    const [action, id] = payload.split(":");
    if (action === "new") {
      await this.startDraft(e);
      return;
    }
    if (action === "home") {
      await this.home(e);
      return;
    }
    if (action === "cancel") {
      this.state.cancel(e.user.id);
      await this.home(e);
      return;
    }
    if (action === "resume") {
      const d = this.state.draft(e.user.id);
      if (d) await this.present(e, wizard(d));
      else await this.home(e);
      return;
    }
    if (action === "mine") {
      await this.myPlans(e);
      return;
    }
    if (action === "help") {
      await this.present(e, { text: help, buttons: this.homeButtons() });
      return;
    }
    if (action === "groups") {
      await this.present(e, {
        text: "СОБРАТЬ КОМПАНИЮ\n\n1. Добавьте этого бота в свою группу через меню MAX, если добавление разрешено организаторами.\n2. В группе отправьте /plan.\n3. Настройте встречу в личке. Приглашение появится в группе.\n4. Друзья нажимают «Ответить лично». В группе обновляются только общая карточка и результат.\n\nНе получается добавить бота? Создайте встречу здесь и отправьте друзьям её ссылку. Весь опрос и маршрут работают без mini app.",
        buttons: [
          [cb("Создать встречу здесь", "new")],
          [cb("← Главное меню", "home")],
        ],
      });
      return;
    }
    if (action === "room" && id) {
      await this.showRoom(e, id);
      return;
    }
    if (action === "members" && id) {
      const r = this.sessions.get(id, e.user);
      await this.present(e, {
        text: `КТО ОТВЕТИЛ · ${r.participants.length}/${r.settings.expectedParticipants}\n\n${r.participants.map((p, index) => `${index + 1}. ${p.displayName} — ответ сохранён ✓`).join("\n")}\n\nЛичные ответы и вето остаются скрытыми.`,
        buttons: [[cb("← К встрече", `room:${id}`)]],
      });
      return;
    }
    if (action === "edit" && id) {
      await this.startDraft(e, this.sessions.get(id, e.user));
      return;
    }
    if (action === "calc" && id) {
      await this.sessions.generate(id, e.user);
      await this.showRoom(e, id);
      return;
    }
    if (action === "invite" && id) {
      const r = this.sessions.get(id, e.user),
        url = this.botLink("s_" + id);
      this.sessions.member(this.sessions.room(id, e.user), e.user);
      const text = `Соберёмся? ${day(r.settings.startsAt)}, ${time(r.settings.startsAt)} · ${r.settings.city}\nОтветьте на короткий опрос в боте — найдём общий план.\n${url}`;
      await this.present(e, {
        text: "Отправьте это приглашение друзьям или в общий чат.\n\n" + text,
        buttons: [
          [
            link(
              "Поделиться в MAX",
              `https://max.ru/:share?text=${encodeURIComponent(text)}`,
            ),
          ],
          [
            {
              type: "clipboard",
              text: "Скопировать приглашение",
              payload: text,
            },
          ],
          [cb("← К встрече", `room:${id}`)],
        ],
      });
      return;
    }
    // Legacy callback from the previously deployed bot remains usable.
    await this.home(e);
  }
  private async startPayload(e: Event, payload: string) {
    if (payload.startsWith("s_")) {
      await this.showRoom(e, payload.slice(2));
      return;
    }
    if (payload.startsWith("g_")) {
      const group = this.state.groupFor(payload.slice(2));
      if (group === null)
        throw new AppError(
          410,
          "GROUP_LINK",
          "Приглашение группы истекло. Отправьте /plan в группе ещё раз.",
        );
      await this.startDraft(e, undefined, group);
      return;
    }
    await this.home(e);
  }
  private groupView(g: Group, r: SessionView): View {
    const buttons: Button[][] = [
      [link("Ответить лично", this.botLink("s_" + r.id))],
      [cb("Обновить ответы", `room:${r.id}`)],
    ];
    if (!r.plan) buttons[1]!.push(cb("Найти общий план", `calc:${r.id}`));
    if (r.plan) buttons.push([link("🗺 Открыть маршрут", r.plan.mapUrl)]);
    buttons.push([this.mini("s_" + r.id)]);
    return { text: this.roomText(r, !!g.auto_plan), buttons };
  }
  private async groupEvent(e: Event) {
    const text = (e.text ?? "").trim();
    if (
      e.kind !== "added" &&
      e.kind !== "callback" &&
      !/^\/(?:start|plan|status|result|myplans|help)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(
        text,
      )
    )
      return;
    this.state.activate(e.chatId);
    const g = this.state.group(e.chatId)!;
    if (e.kind === "callback") {
      const [action, id] = (e.payload ?? "").split(":");
      if (id !== g.room_id || !id)
        throw new AppError(
          409,
          "OLD_GROUP",
          "Это карточка прошлой встречи. Отправьте /status в группе.",
        );
      if (action === "calc") {
        await this.sessions.generate(id, e.user);
        this.state.autoPlan(e.chatId);
      } else if (action !== "room") return;
      await this.syncGroup(e.chatId, true);
      return;
    }
    if (g.room_id && e.kind !== "added" && !/^\/plan/.test(text)) {
      await this.syncGroup(e.chatId, true);
      return;
    }
    const token = this.state.groupLink(e.chatId);
    await this.io.send(e.chatId, {
      text: "СОБЕРЁМСЯ ВМЕСТЕ ✨\n\nСоздайте встречу по кнопке ниже. Геопозицию, время и личные предпочтения настроим в личке, затем я опубликую приглашение здесь.\n\nДрузья ответят лично. В группе появятся количество ответов и общий маршрут; авторов вето и личные лимиты я не публикую.\n\n/plan — новая встреча\n/status — текущая встреча\nРаботает в любом городе · 18+",
      buttons: [
        [link("Создать встречу для этой группы", this.botLink("g_" + token))],
        ...(g.room_id ? [[cb("Текущая встреча", `room:${g.room_id}`)]] : []),
      ],
    });
  }
  async syncGroup(chat: number, force = false) {
    return this.serial("group:" + chat, async () => {
      const g = this.state.group(chat);
      if (!g?.active || !g.room_id) return;
      const room = this.sessions.store.room(g.room_id);
      if (!room) return;
      const owner: Identity = {
        id: room.owner,
        kind: "max",
        displayName: "Организатор",
      };
      let r: SessionView;
      try {
        r = this.sessions.get(room.id, owner);
      } catch (err) {
        if (err instanceof AppError && err.code === "EXPIRED") return;
        throw err;
      }
      if (g.auto_plan && !r.plan && r.canGenerate) {
        try {
          r = await this.sessions.generate(r.id, owner);
        } catch (err) {
          if (!(err instanceof AppError && err.code === "NO_MATCH")) throw err;
        }
      }
      if (r.plan && !g.auto_plan) this.state.autoPlan(chat);
      const v = this.groupView(g, r),
        fingerprint = this.sessions.store.hash(JSON.stringify(v));
      if (!force && g.fingerprint === fingerprint) return;
      let mid = g.mid;
      if (!mid || !(await this.io.edit(mid, v)))
        mid = await this.io.send(chat, v);
      this.state.board(chat, mid, fingerprint);
    });
  }
  async syncGroups() {
    for (const g of this.state.groups()) {
      try {
        await this.syncGroup(g.chat_id);
      } catch {
        console.warn(JSON.stringify({ event: "group_refresh_failed" }));
      }
    }
  }
}
