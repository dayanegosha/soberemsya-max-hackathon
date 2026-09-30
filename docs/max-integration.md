# MAX implementation contracts — verified 2026-09-25

Only official MAX documentation and the official `max-messenger` repository were used. No team token was read, stored, or used for this research.

## API transport and important current changes

- Base URL: `https://platform-api2.max.ru`; old `platform-api.max.ru` is deprecated. The change took effect July 19, 2026.
- Authentication: raw `Authorization: <access_token>`, **without** `Bearer`. Tokens in query strings are no longer supported.
- Docs require trusting the relevant Минцифры certificate chain. Handle any deployment trust failure explicitly; do not disable TLS validation.
- `GET /me` returns bot identity including `user_id`, `username`, `first_name`.
- `GET /chats` has been removed since June 2026. Store known chat IDs from authenticated update events (webhook or GET /updates); it is not a discovery endpoint anymore.
- `POST /chats/{chatId}/members` restricted since September 9 and removed September 30, 2026. Do not design an MVP around programmatically adding group members.

[API overview](https://dev.max.ru/docs-api), [API changelog](https://dev.max.ru/docs-api/changelog-api)

## Official JS SDK

Package: `@maxhub/max-bot-api`. Official repository currently identifies version `0.3.1`, Node `>=20.19.0`.

```ts
import { Bot, Keyboard } from '@maxhub/max-bot-api';
const bot = new Bot(process.env.BOT_TOKEN!, {
  clientOptions: { baseUrl: 'https://platform-api2.max.ru' },
});
bot.command('start', ctx => ctx.reply('Привет'));
bot.on('bot_started', ctx => ctx.reply('Привет'));
bot.on('message_created', ctx => { /* ctx.message */ });
bot.action('payload', ctx => { /* callback */ });
await bot.api.sendMessageToUser(userId, text, extra);
await bot.api.sendMessageToChat(chatId, text, extra);
```

`sendMessageToUser(userId: number, text: string, extra?: SendMessageExtra)` and `sendMessageToChat(chatId: number, text: string, extra?: SendMessageExtra)` return the message directly; `message.body.mid` is the identifier. Additional options include `attachments`, `format: 'markdown' | 'html'`, `notify`, and `link`.

[JS guide](https://dev.max.ru/docs/chatbots/bots-coding/js), [SDK package](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/package.json), [API source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/api.ts)

Exact useful helper signatures from current SDK source:

```ts
Keyboard.inlineKeyboard(buttons: Button[][])
Keyboard.button.callback(text: string, payload: string)
Keyboard.button.link(text: string, url: string)
Keyboard.button.openApp(text: string, webApp: string, contactId?: number, payload?: string)
bot.api.setMyCommands(commands: BotCommand[])
bot.api.answerOnCallback(callbackId: string, extra?: AnswerOnCallbackExtra)
bot.api.editMessage(messageId: string, extra?: EditMessageExtra)
bot.api.uploadImage({ source: '/local/image.png' })
bot.api.uploadImage({ url: 'https://host/image.png' })
```

`webApp` in `openApp` is a bot username/link, not an arbitrary mini-app URL. Source supports the fourth `payload` argument even though the prose JS guide shows an older shorter signature.

[Keyboard helper](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/helpers/keyboard.ts), [button helpers](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/helpers/buttons.ts), [types](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/core/network/api/types/keyboard.ts)

## Webhook and polling

Production delivery: `POST /subscriptions`, JSON `{url, update_types, secret}`. HTTPS port 443; trusted certificate; return HTTP 200 within 30 seconds. Verify `X-Max-Bot-Api-Secret`. Events may retry, so handle duplicates. Secret allows `[a-zA-Z0-9_-]{5,256}`. Active webhook subscriptions disable long polling. Useful event types: `bot_started`, `message_created`, `message_callback`, `bot_added`, `bot_removed`.

[Webhook contract](https://dev.max.ru/docs-api/methods/POST/subscriptions)

SDK startup:

```ts
await bot.start({ mode: 'polling', options: { allowedUpdates: ['bot_started', 'message_created'] } });
await bot.start({ mode: 'webhook', options: {
  domain: 'https://example.com', port: 3000, path: '/api/max/webhook',
  secret: process.env.WEBHOOK_SECRET!,
  allowedUpdates: ['bot_started', 'message_created', 'message_callback'],
} });
const callback = bot.webhookCallback({ domain, path, secret });
```

Important: `bot.start()` in polling mode **clears existing webhook subscriptions**. `bot.createWebhook()` also clears other subscriptions. Do not start a shared-token polling worker casually. `bot.webhookCallback()` builds a request handler without registering a subscription, useful behind an existing HTTP server.

[Bot source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/bot.ts), [Webhook source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/core/network/webhook.ts)

## Mini-app initialization and auth

Load `https://st.max.ru/js/max-web-app.js`; API is `window.WebApp` and requires no separate initialization. Send `WebApp.initData` string to your backend. `initDataUnsafe` is usable for provisional display only, never authorization.

Validation algorithm on server:

1. Parse raw initData URL pairs and reject duplicate keys, missing/multiple `hash`.
2. URL-decode values exactly once; preserve JSON string values.
3. Exclude `hash`; sort keys; join `key=value` with `\n`.
4. `secret = HMAC_SHA256(key='WebAppData', message=BOT_TOKEN)` as raw bytes.
5. `expected = HMAC_SHA256(key=secret, message=checkString).hex()`.
6. Compare decoded hashes in constant time; check `auth_date` age. Bridge recommends a one-hour validity period. Reject future timestamps beyond a small clock tolerance.

`auth_date` is seconds. The user object has `id` (not Bot API's `user_id`), `first_name`, `last_name`, `username`, `language_code`, `photo_url`. `chat` is `{ id, type: 'DIALOG' | 'CHAT' | 'CHANNEL' }`. Validate before trusting either identity.

[Validation](https://dev.max.ru/docs/webapps/validation), [Bridge](https://dev.max.ru/docs/webapps/bridge)

## Sharing, download, navigation

```ts
WebApp.shareContent({ text?: string, link?: string })
WebApp.shareMaxContent({ text?: string, link?: string })
WebApp.shareMaxContent({ mid: string, chatType: 'DIALOG' | 'CHAT' })
WebApp.downloadFile(url: string, file_name: string)
WebApp.openLink(url: string)
WebApp.openMaxLink(url: string)
WebApp.BackButton.show()
WebApp.BackButton.hide()
WebApp.BackButton.onClick(callback: () => void)
WebApp.BackButton.offClick(callback: () => void)
```

Share at least text or link. External sharing is mobile-only. For media sharing, the bot first sends the media to the user; then forward its `mid` with `shareMaxContent`. These operations require a user gesture. Downloads require a direct HTTPS URL and MAX native client; HTML `download` links do not work inside MAX. Use browser fallback only outside MAX. Generic `href` is not native download support.

[Bridge sharing/download contract](https://dev.max.ru/docs/webapps/bridge)

Mini-app deep link: `https://max.ru/<botUsername>?startapp=<payload>`. Payload max 512 characters, allowed `[A-Za-z0-9_-]`; read as `initDataUnsafe.start_param`, but trust it only once server-authenticated. Keep referral/room IDs short and opaque.

An additional browser share fallback exists: `https://max.ru/:share?text=<URL-encoded text>`. Officially supported on iOS, Android and web; desktop support is still in development. It opens a recipient picker and lets the user send the prepared text.

[Mini-app deep links](https://dev.max.ru/docs/webapps/introduction)

## MAX UI React setup

```tsx
import { MaxUI, Button, Panel, Typography } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
<MaxUI platform="android" colorScheme="light"><App /></MaxUI>
```

React 18+; platform/theme normally auto-detect. Explicit supported values: platform `ios | android`, colorScheme `light | dark`. Use actual MAX UI components and CSS tokens. Components include `Panel`, `Grid`, `Container`, `Flex`, `Avatar`, `Typography`. Provider and one decorative component alone should not be treated as a complete design integration.

[Official MAX UI setup](https://dev.max.ru/ui)

## Group limitations and product implications

- Bot group access is disabled by default and must be enabled in partner settings.
- `read_all_messages` admin permission is required to receive group webhook messages reliably according to current docs; receiving every group message is not implicit bot membership.
- Store groups from authenticated updates and remove on `bot_removed`. Current chat-id documentation supports both `POST /subscriptions` and `GET /updates`; the deployed worker uses polling after checking that there is no existing webhook subscription.
- No current documented group-creation endpoint in the Bot API method inventory. Use a room inside the mini-app and invite/share a deep link; let users create their MAX group themselves if needed.
- Sending: `POST /messages?user_id=...` or `?chat_id=...`, body `{text, attachments, format, notify}`; returns `{message}`. Max 4000 characters, max 2 messages per second per destination.
- Registering a mini-app URL is performed in MAX partner settings, not through a documented Bot API endpoint. Mini-apps attach to a bot.

[Bot settings FAQ](https://dev.max.ru/help/chatbots), [Group permissions](https://dev.max.ru/docs-api/methods/POST/chats/-chatId-/members/admins), [Removed chat listing](https://dev.max.ru/docs-api/methods/GET/chats), [Send message](https://dev.max.ru/docs-api/methods/POST/messages), [Mini-app registration](https://dev.max.ru/help/miniapps)
