import { Bot, Keyboard, MaxError } from "@maxhub/max-bot-api";
import type { Context } from "@maxhub/max-bot-api";
import { createHash } from "node:crypto";
import { getConfig } from "../../server/src/config.js";
import { Store } from "../../server/src/store.js";
import { Sessions } from "../../server/src/sessions.js";
import { BotController, type Event, type Transport } from "./controller.js";
import { errorMetadata } from "./errors.js";
import { liveActivities, resolveLocation } from "../../server/src/places.js";

async function main() {
  const config = getConfig(),
    token = config.botToken.trim();
  if (!token) throw new Error("BOT_TOKEN required");
  const bot = new Bot(token, {
    clientOptions: {
      baseUrl: process.env.MAX_API_BASE_URL || "https://platform-api2.max.ru",
    },
  });
  const info = await bot.api.getMyInfo(),
    subscriptions = await bot.api.getSubscriptions();
  if (subscriptions.length && process.env.MAX_ALLOW_WEBHOOK_REPLACE !== "true")
    throw new Error("Existing webhook; polling refused");
  const username = (config.botUsername || info.username || "").replace(
    /^@/,
    "",
  );
  if (!/^[A-Za-z0-9_]+$/.test(username))
    throw new Error("Bot username missing");
  const store = new Store(config.dbPath);
  const sessions = new Sessions(store, config, (event) =>
    console.info(JSON.stringify(event)), liveActivities,
  );
  const io: Transport = {
    async send(chat, v) {
      const m = await bot.api.sendMessageToChat(chat, v.text, {
        attachments: [Keyboard.inlineKeyboard(v.buttons)],
        disable_link_preview: true,
      });
      return m.body.mid;
    },
    async edit(mid, v) {
      try {
        const r = await bot.api.editMessage(mid, {
          text: v.text,
          attachments: [Keyboard.inlineKeyboard(v.buttons)],
        });
        return r.success;
      } catch (err) {
        if (err instanceof MaxError && err.code === "message.not.modified")
          return true;
        if (err instanceof MaxError && err.status === 404) return false;
        throw err;
      }
    },
  };
  const controller = new BotController(sessions, io, {
    username,
    botId: info.user_id,
    appUrl: config.appUrl,
    resolveLocation,
  });
  function normalize(ctx: Context): Event | null {
    const u = ctx.update;
    if (
      ![
        "bot_started",
        "message_created",
        "message_callback",
        "bot_added",
        "bot_removed",
      ].includes(u.update_type)
    )
      return null;
    if (
      (u.update_type === "bot_added" || u.update_type === "bot_removed") &&
      u.is_channel
    )
      return null;
    const user =
      "callback" in u
        ? u.callback.user
        : "user" in u
          ? u.user
          : "message" in u
            ? u.message?.sender
            : null;
    const message = "message" in u ? u.message : null;
    if (message?.recipient.chat_type === "channel") return null;
    const chat = "chat_id" in u ? u.chat_id : message?.recipient.chat_id;
    if (
      !user ||
      user.is_bot ||
      !Number.isSafeInteger(user.user_id) ||
      chat === null ||
      chat === undefined
    )
      return null;
    const kind: Event["kind"] =
      u.update_type === "bot_started"
        ? "start"
        : u.update_type === "message_created"
          ? "message"
          : u.update_type === "message_callback"
            ? "callback"
            : u.update_type === "bot_added"
              ? "added"
              : "removed";
    const id =
      u.update_type === "message_callback"
        ? "cb:" + u.callback.callback_id
        : u.update_type === "message_created"
          ? "msg:" + u.message.body.mid
          : createHash("sha256").update(JSON.stringify(u)).digest("hex");
    return {
      id,
      kind,
      chatId: chat,
      group:
        kind === "added" ||
        kind === "removed" ||
        message?.recipient.chat_type === "chat",
      user: {
        id: "max:" + user.user_id,
        kind: "max",
        displayName:
          [user.first_name, user.last_name ?? ""]
            .join(" ")
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 128) || "Участник",
      },
      messageId: message?.body.mid,
      text: message?.body.text ?? undefined,
      location: (()=>{const a=message?.body.attachments?.find(a=>a.type==="location");return a&&a.type==="location"?{lat:a.latitude,lon:a.longitude}:undefined;})(),
      payload:
        u.update_type === "message_callback"
          ? u.callback.payload
          : u.update_type === "bot_started"
            ? (u.payload ?? undefined)
            : undefined,
    };
  }
  bot.on(
    [
      "bot_started",
      "message_created",
      "message_callback",
      "bot_added",
      "bot_removed",
    ],
    async (ctx) => {
      if (ctx.update.update_type === "message_callback")
        try {
          await bot.api.answerOnCallback(ctx.update.callback.callback_id);
        } catch {
          /* Callback may have expired; persisted flow is still valid. */
        }
      const event = normalize(ctx);
      if (event) await controller.handle(event);
    },
  );
  bot.catch((err) =>
    console.error(JSON.stringify({ event: "bot_update_failed", cause: errorMetadata(err) })),
  );
  await bot.api.setMyCommands([
    { name: "start", description: "Главное меню" },
    { name: "plan", description: "Создать встречу прямо в чате" },
    { name: "myplans", description: "Мои встречи и маршруты" },
    { name: "status", description: "Кто ответил и общий план" },
    { name: "cancel", description: "Отменить текущий опрос" },
    { name: "help", description: "Как пользоваться и добавить в группу" },
  ]);
  let syncing = false;
  const timer = setInterval(() => {
    if (syncing) return;
    syncing = true;
    void controller.syncGroups().finally(() => {
      syncing = false;
    });
  }, 5000);
  const stop = () => {
    clearInterval(timer);
    bot.stopPolling();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.info(
    JSON.stringify({
      event: "bot_started",
      mode: "full_chat",
      version: "0.4.0",
    }),
  );
  try {
    await bot.start({
      mode: "polling",
      options: {
        allowedUpdates: [
          "bot_started",
          "message_created",
          "message_callback",
          "bot_added",
          "bot_removed",
        ],
        retry: true,
      },
    });
  } finally {
    clearInterval(timer);
    store.close();
  }
}
void main().catch(() => {
  console.error(
    "Бот не запущен: проверьте подключение к MAX, ENV и отсутствие чужого Webhook. Секреты и ответы API не логируются.",
  );
  process.exitCode = 1;
});
