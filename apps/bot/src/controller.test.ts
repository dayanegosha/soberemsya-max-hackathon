import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../../server/src/store.js";
import { Sessions, AppError } from "../../server/src/sessions.js";
import { getConfig } from "../../server/src/config.js";
import { WebAuth } from "../../server/src/web-auth.js";
import { BotController, type Event, type Transport } from "./controller.js";
import { newDraft, change, textAnswer, type View } from "./wizard.js";
import type { Identity } from "../../../packages/types/src/index.js";

class FakeTransport implements Transport {
  views = new Map<string, View>();
  chats = new Map<string, number>();
  sent: { chat: number; view: View; mid: string }[] = [];
  serial = 0;
  async send(chat: number, view: View) {
    const mid = "m" + ++this.serial;
    this.views.set(mid, structuredClone(view));
    this.chats.set(mid, chat);
    this.sent.push({ chat, view: structuredClone(view), mid });
    return mid;
  }
  async edit(mid: string, view: View) {
    if (!this.views.has(mid)) return false;
    this.views.set(mid, structuredClone(view));
    return true;
  }
  latest(chat = 11) {
    const mid = [...this.chats].filter(([, c]) => c === chat).at(-1)?.[0];
    assert.ok(mid);
    return { mid, view: this.views.get(mid)! };
  }
}
const a: Identity = { id: "max:101", displayName: "Аня", kind: "max" },
  b: Identity = { id: "max:202", displayName: "Борис", kind: "max" };
const opts = {
  username: "test_bot",
  botId: 777,
  appUrl: "https://example.com",
};
let eventId = 0;
const ev = (patch: Partial<Event> = {}): Event => ({
  id: "e" + ++eventId,
  kind: "callback",
  chatId: 11,
  group: false,
  user: a,
  ...patch,
});
function setup(path = ":memory:") {
  const store = new Store(path),
    service = new Sessions(
      store,
      getConfig({
        dbPath: path,
        botToken: "test-token",
        botUsername: opts.username,
        appUrl: opts.appUrl,
      }),
    ),
    io = new FakeTransport(),
    bot = new BotController(service, io, opts);
  return { store, service, io, bot };
}
async function press(
  bot: BotController,
  io: FakeTransport,
  label: string,
  user = a,
  chat = 11,
) {
  const { mid, view } = io.latest(chat),
    button = view.buttons.flat().find((x) => x.text.includes(label));
  assert.ok(button, `Missing button ${label} in ${view.text}`);
  assert.equal(button.type, "callback");
  if (button.type === "callback")
    await bot.handle(
      ev({ user, chatId: chat, messageId: mid, payload: button.payload }),
    );
}
async function finish(
  bot: BotController,
  io: FakeTransport,
  user = a,
  chat = 11,
  veto = "Кино",
) {
  let d = bot.state.draft(user.id)!;
  if (d.step === "city") {await bot.handle(ev({kind:"message",user,chatId:chat,location:{lat:55.79,lon:49.12}}));d=bot.state.draft(user.id)!;}
  if (d.step === "meeting") await press(bot, io, "Мой вайб", user, chat);
  await press(bot, io, "Бюджет и время", user, chat);
  await press(bot, io, "Моё вето", user, chat);
  await press(bot, io, veto, user, chat);
  await press(bot, io, "Готово", user, chat);
  return bot.state.draft(user.id)!.resultId!;
}
test("full button-only bot flow, second participant, veto, result and map", async (t) => {
  const { store, service, io, bot } = setup();
  t.after(() => store.close());
  await bot.handle(ev({ kind: "start" }));
  assert.match(io.latest().view.text, /прямо в переписке/);
  await press(bot, io, "Создать встречу");
  const id = await finish(bot, io);
  assert.ok(id);
  assert.equal(service.get(id, a).participants.length, 1);
  await bot.handle(
    ev({ kind: "start", user: b, chatId: 22, payload: "s_" + id }),
  );
  await press(bot, io, "Ответить и присоединиться", b, 22);
  await finish(bot, io, b, 22, "Без вето");
  await press(bot, io, "Найти общий план", b, 22);
  const plan = service.get(id, b).plan!;
  assert.ok(plan.items.length);
  assert.ok(plan.items.every((i) => i.activity.category !== "cinema"));
  assert.match(io.latest(22).view.text, /ПЛАН ГОТОВ/);
  assert.ok(!io.latest(22).view.buttons.flat().some((button) => button.text.includes("Обновить план")));
  assert.ok(
    io
      .latest(22)
      .view.buttons.flat()
      .some((x) => x.type === "link" && x.url.includes("yandex.ru/maps")),
  );
  assert.equal(service.list(a).length, 1);
  assert.equal(service.list(b).length, 1);
});
test("old and duplicate callback cannot toggle twice, skip steps or create a second room", async (t) => {
  const { store, io, bot, service } = setup();
  t.after(() => store.close());
  await bot.handle(ev({ payload: "new" }));
  await bot.handle(ev({kind:"message",location:{lat:55.79,lon:49.12}}));
  await press(bot, io, "Мой вайб");
  const { mid, view } = io.latest(),
    button = view.buttons.flat().find((x) => x.text.includes("Активно"))!;
  assert.equal(button.type, "callback");
  if (button.type !== "callback") return;
  const event = ev({ messageId: mid, payload: button.payload });
  await bot.handle(event);
  await bot.handle(event);
  await bot.handle(ev({ messageId: mid, payload: button.payload }));
  assert.ok(bot.state.draft(a.id)!.preference.vibes.includes("active"));
  const d = bot.state.draft(a.id)!;
  await bot.handle(
    ev({ messageId: mid, payload: `f:${d.id}:${d.revision}:save:` }),
  );
  assert.equal(service.list(a).length, 0);
  await press(bot, io, "Продолжить опрос");
  await press(bot, io, "Бюджет и время");
  await press(bot, io, "Моё вето");
  const save = io
    .latest()
    .view.buttons.flat()
    .find((x) => x.text.startsWith("Готово"))!;
  assert.equal(save.type, "callback");
  if (save.type !== "callback") return;
  await bot.handle(ev({ messageId: mid, payload: save.payload }));
  await bot.handle(ev({ messageId: mid, payload: save.payload }));
  assert.equal(service.list(a).length, 1);
});
test("a different user cannot continue another user draft", async (t) => {
  const { store, io, bot, service } = setup();
  t.after(() => store.close());
  await bot.handle(ev({ payload: "new" }));
  const d = bot.state.draft(a.id)!;
  await bot.handle(ev({ user: b, chatId: 22, payload: `f:${d.id}:0:next:` }));
  assert.equal(bot.state.draft(a.id)!.step, "city");
  assert.equal(service.list(b).length, 0);
});
test("draft and completed sessions survive process restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "soberemsya-bot-")),
    path = join(dir, "app.sqlite");
  try {
    const x = setup(path);
    await x.bot.handle(ev({ payload: "new" }));
    const id = x.bot.state.draft(a.id)!.id;
    x.store.close();
    const y = setup(path);
    await y.bot.handle(ev({ payload: "resume" }));
    assert.equal(y.bot.state.draft(a.id)!.id, id);
    assert.match(y.io.latest().view.text, /ГДЕ СОБИРАЕМСЯ/);
    await finish(y.bot, y.io);
    assert.equal(y.service.list(a).length, 1);
    y.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("group create collects private answers only in DM; board synchronizes bot and service changes", async (t) => {
  const { store, io, bot, service } = setup();
  t.after(() => store.close());
  const group = -555;
  await bot.handle(ev({ kind: "added", group: true, chatId: group }));
  const button = io
    .latest(group)
    .view.buttons.flat()
    .find((x) => x.type === "link")!;
  assert.equal(button.type, "link");
  if (button.type !== "link") return;
  const payload = new URL(button.url).searchParams.get("start")!;
  await bot.handle(ev({ kind: "start", payload }));
  const id = await finish(bot, io);
  assert.equal(bot.state.group(group)!.room_id, id);
  assert.match(io.latest(group).view.text, /Ответили: 1\/5/);
  const r = service.get(id, a);
  service.answer(id, b, { preference: { ...r.myPreference!, veto: "food" } });
  await bot.syncGroups();
  assert.match(io.latest(group).view.text, /Ответили: 2\/5/);
  await bot.handle(
    ev({
      group: true,
      chatId: group,
      user: b,
      payload: "calc:" + id,
      messageId: bot.state.group(group)!.mid!,
    }),
  );
  assert.ok(service.get(id, a).plan);
  assert.match(io.latest(group).view.text, /ПЛАН ГОТОВ/);
  const before = service.get(id, b);
  service.answer(id, b, {
    preference: { ...before.myPreference!, veto: "outdoor" },
  });
  assert.equal(service.get(id, a).plan, null);
  await bot.syncGroups();
  assert.ok(
    service
      .get(id, a)
      .plan!.items.every((x) => x.activity.category !== "outdoor"),
  );
  const publicText = io.latest(group).view.text;
  assert.ok(!publicText.includes("Борис:"));
  assert.ok(!publicText.includes("Мои ограничения"));
  assert.ok(
    !io.sent
      .filter((x) => x.chat === group)
      .some((x) => x.view.text.includes("ЛИЧНОЕ ВЕТО")),
  );
});
test("groups ignore conversation, reject room spoofing and stop updating after removal", async (t) => {
  const { store, io, bot } = setup();
  t.after(() => store.close());
  await bot.handle(
    ev({ kind: "message", group: true, chatId: -2, text: "куда идём?" }),
  );
  assert.equal(io.sent.length, 0);
  await bot.handle(ev({ kind: "added", group: true, chatId: -2 }));
  await bot.handle(ev({ group: true, chatId: -2, payload: "web" }));
  assert.ok(!JSON.stringify(io.sent).includes("#login="));
  await bot.handle(ev({ kind: "removed", group: true, chatId: -2 }));
  assert.equal(bot.state.group(-2)!.active, 0);
});
test("room exposes mini app and working member list without browser action", async (t) => {
  const x = setup();
  t.after(() => x.store.close());
  await x.bot.handle(ev({ payload: "new" }));
  const id = await finish(x.bot, x.io);
  const labels = x.io.latest().view.buttons.flat().map((button) => button.text);
  assert.ok(labels.includes("Открыть mini app"));
  assert.ok(!labels.some((label) => /браузер/i.test(label)));
  await press(x.bot, x.io, "Кто ответил");
  assert.match(x.io.latest().view.text, /Аня — ответ сохранён/);
  await press(x.bot, x.io, "К встрече");
  await press(x.bot, x.io, "Пригласить друзей");
  assert.match(x.io.latest().view.text, /Казань/);
});
test("expired browser tickets and sessions are rejected", (t) => {
  const x = setup();
  t.after(() => x.store.close());
  const web = new WebAuth(x.store);
  const ticket = web.ticket(a, 1000);
  assert.throws(() => web.exchange(ticket, 302000), AppError);
  const fresh = web.ticket(a);
  const auth = web.exchange(fresh);
  assert.equal(web.user(auth.token)?.id, a.id);
  assert.equal(web.user(auth.token, Date.now() + 86400001), null);
});
test("date and private availability editing respects Kazan time and rejects invalid ranges", () => {
  const now = Date.parse("2026-09-26T12:00:00+03:00"),
    d = newDraft(undefined, undefined, now);
  assert.ok(textAnswer(d, "27.09 19:30", now));
  assert.equal(timePart(d.settings.startsAt), "19:30");
  d.step = "time";
  assert.ok(textAnswer(d, "20:00–22:30", now));
  assert.equal(timePart(d.preference.availableFrom), "20:00");
  d.step = "time";
  assert.throws(() => textAnswer(d, "28:00–29:00", now), AppError);
  d.step = "meeting";
  assert.throws(() => textAnswer(d, "31.09 19:00", now), AppError);
  const p = newDraft(
    undefined,
    undefined,
    Date.parse("2026-09-26T20:00:00+03:00"),
  );
  change(p, "day", "0", Date.parse("2026-09-26T20:00:00+03:00"));
  assert.throws(
    () => change(p, "next", "", Date.parse("2026-09-26T20:00:00+03:00")),
    AppError,
  );
});
function timePart(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
}

test("a rejected group action does not overwrite the shared board", async (t) => {
  const { store, io, bot } = setup();
  t.after(() => store.close());
  const group = -777;
  await bot.handle(ev({ kind: "added", group: true, chatId: group }));
  const l = io
    .latest(group)
    .view.buttons.flat()
    .find((x) => x.type === "link")!;
  if (l.type !== "link") throw Error("link missing");
  await bot.handle(
    ev({ kind: "start", payload: new URL(l.url).searchParams.get("start")! }),
  );
  const id = await finish(bot, io);
  const mid = bot.state.group(group)!.mid!,
    before = JSON.stringify(io.views.get(mid));
  await bot.handle(
    ev({
      group: true,
      chatId: group,
      user: b,
      messageId: mid,
      payload: "calc:" + id,
    }),
  );
  assert.equal(JSON.stringify(io.views.get(mid)), before);
  assert.match(io.latest(group).view.text, /Сначала ответьте/);
});
test("two group organizers cannot silently replace each other during simultaneous drafts", async (t) => {
  const { store, io, bot, service } = setup();
  t.after(() => store.close());
  const group = -888;
  await bot.handle(ev({ kind: "added", group: true, chatId: group }));
  const l = io
    .latest(group)
    .view.buttons.flat()
    .find((x) => x.type === "link")!;
  if (l.type !== "link") throw Error("link missing");
  const payload = new URL(l.url).searchParams.get("start")!;
  await bot.handle(ev({ kind: "start", payload }));
  await bot.handle(ev({ kind: "start", payload, user: b, chatId: 22 }));
  const id = await finish(bot, io);
  await finish(bot, io, b, 22);
  assert.equal(bot.state.group(group)!.room_id, id);
  assert.equal(service.list(b).length, 0);
  assert.match(io.latest(22).view.text, /уже создали другую встречу/);
});

test("SDK wire payloads for every private command satisfy MAX open_app contract", async (t) => {
  const { Bot, Keyboard } = await import("@maxhub/max-bot-api");
  const { store, service } = setup();
  t.after(() => store.close());
  const accepted: { text: string; attachments: { payload: { buttons: View["buttons"] } }[] }[] = [];
  let rejected = 0;
  const sdk = new Bot("test-token", {clientOptions: {fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const buttons = body.attachments[0].payload.buttons.flat();
    // Actual API rejection reproduced against SDK-serialized requests, not SDK's permissive type.
    if (buttons.some((b: {type: string; web_app?: string}) => b.type === "open_app" && !b.web_app)) {
      rejected++;
      return new Response(JSON.stringify({code:"proto.payload",message:"Field 'webApp' cannot be null"}), {status:400});
    }
    accepted.push(body);
    return new Response(JSON.stringify({message:{body:{mid:"wire-"+accepted.length}}}), {status:200});
  }}});
  const io: Transport = {
    async send(chat, v) { return (await sdk.api.sendMessageToChat(chat, v.text, {attachments:[Keyboard.inlineKeyboard(v.buttons)]})).body.mid; },
    async edit() { throw new Error("Commands must create a response"); },
  };
  const bot = new BotController(service,io,opts);
  for (const text of ["/start","/help","/myplans","/status","/plan","/cancel"]) {
    const count = accepted.length;
    await bot.handle(ev({kind:"message",text}));
    assert.equal(accepted.length,count+1,`${text} needs a delivered response`);
  }
  assert.equal(rejected,0,"No command should produce the observed MAX 400 response");
  assert.ok(accepted.some(x=>x.text.includes("ГДЕ СОБИРАЕМСЯ")),"/plan must deliver the survey");
  assert.ok(accepted.some(x=>x.attachments[0]!.payload.buttons.flat().some(b=>b.type==="open_app")),"Native miniapp remains reachable");
});

test("MAX geolocation selects Petersburg without publishing exact location; custom point is explicit",async(t)=>{
 const {store,bot,io,service}=setup();t.after(()=>store.close());
 await bot.handle(ev({kind:"message",location:{lat:59.94,lon:30.32}}));
 assert.equal(store.userCity(a.id),"Санкт-Петербург");
 assert.ok(!io.latest().view.text.includes("59.94"));
 await bot.handle(ev({kind:"message",text:"/plan"}));
 await bot.handle(ev({kind:"message",location:{lat:59.94,lon:30.32}}));
 assert.equal(bot.state.draft(a.id)!.settings.city,"Санкт-Петербург");
 await press(bot,io,"Место встречи");
 await bot.handle(ev({kind:"message",location:{lat:59.936,lon:30.33}}));
 assert.deepEqual(bot.state.draft(a.id)!.settings.origin,{lat:59.936,lon:30.33});
 const id=await finish(bot,io,a,11,"Без вето");
 assert.equal(service.get(id,a).settings.city,"Санкт-Петербург");
 await press(bot,io,"Пригласить друзей");
 assert.match(io.latest().view.text,/Санкт-Петербург/);
 assert.doesNotMatch(io.latest().view.text,/· Казань/);
 await bot.handle(ev({kind:"start",user:b,chatId:22,payload:"s_"+id}));
 await press(bot,io,"Ответить и присоединиться",b,22);await finish(bot,io,b,22,"Без вето");
 const r=await service.generate(id,a);assert.ok(r.plan!.items.every(x=>x.activity.city==="Санкт-Петербург"));
 await bot.handle(ev({kind:"message",location:{lat:55.75,lon:37.62}}));
 assert.equal(store.userCity(a.id),"Москва");assert.match(io.latest().view.text,/Ваш город: Москва/);
});
