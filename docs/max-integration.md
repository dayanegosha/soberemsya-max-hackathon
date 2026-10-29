# .soberemsya max / интеграция с MAX

Справочник по официальной документации MAX и исходникам `max-messenger`. Сведения проверены 25 сентября 2026 года.

## API и изменения протокола

- Базовый URL: `https://platform-api2.max.ru`. Прежний `platform-api.max.ru` устарел; переход состоялся 19 июля 2026 года.
- Авторизация: `Authorization: <access_token>`, **без** `Bearer`. Передача токена в query string больше не поддерживается.
- Нужна доверенная цепочка сертификатов Минцифры. При ошибке доверия настройте сертификат; проверку TLS отключать нельзя.
- `GET /me` возвращает данные бота, включая `user_id`, `username` и `first_name`.
- `GET /chats` удалён в июне 2026 года. Сохраняйте ID чатов из проверенных событий webhook или `GET /updates`; получить список чатов этим методом больше нельзя.
- `POST /chats/{chatId}/members` ограничен с 9 сентября и удалён 30 сентября 2026 года. MVP не должен зависеть от программного добавления участников в группу.

[API overview](https://dev.max.ru/docs-api), [API changelog](https://dev.max.ru/docs-api/changelog-api)

## официальный JS SDK

Пакет: `@maxhub/max-bot-api`. На дату проверки в официальном репозитории указаны версия `0.3.1` и Node `>=20.19.0`.

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

`sendMessageToUser(userId: number, text: string, extra?: SendMessageExtra)` и `sendMessageToChat(chatId: number, text: string, extra?: SendMessageExtra)` возвращают само сообщение; его ID — `message.body.mid`. Дополнительные параметры: `attachments`, `format: 'markdown' | 'html'`, `notify` и `link`.

[JS guide](https://dev.max.ru/docs/chatbots/bots-coding/js), [SDK package](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/package.json), [API source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/api.ts)

Сигнатуры вспомогательных методов из исходников SDK:

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

`webApp` в `openApp` — username или ссылка бота. Произвольный URL mini app сюда не подходит. В исходниках есть четвёртый аргумент `payload`, хотя в текстовом JS-руководстве приведена более короткая прежняя сигнатура.

[Keyboard helper](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/helpers/keyboard.ts), [button helpers](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/helpers/buttons.ts), [types](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/core/network/api/types/keyboard.ts)

## webhook и polling

Для webhook используется `POST /subscriptions` с JSON `{url, update_types, secret}`. Нужны HTTPS на порту 443, доверенный сертификат и ответ HTTP 200 за 30 секунд. Проверяйте `X-Max-Bot-Api-Secret` и учитывайте повторную доставку событий. Формат секрета: `[a-zA-Z0-9_-]{5,256}`. При активной webhook-подписке long polling отключён. Основные события: `bot_started`, `message_created`, `message_callback`, `bot_added`, `bot_removed`.

[Webhook contract](https://dev.max.ru/docs-api/methods/POST/subscriptions)

Запуск через SDK:

```ts
await bot.start({ mode: 'polling', options: { allowedUpdates: ['bot_started', 'message_created'] } });
await bot.start({ mode: 'webhook', options: {
  domain: 'https://example.com', port: 3000, path: '/api/max/webhook',
  secret: process.env.WEBHOOK_SECRET!,
  allowedUpdates: ['bot_started', 'message_created', 'message_callback'],
} });
const callback = bot.webhookCallback({ domain, path, secret });
```

`bot.start()` в режиме polling **удаляет существующие webhook-подписки**. `bot.createWebhook()` также удаляет другие подписки. Перед запуском с общим токеном проверьте действующий способ доставки. `bot.webhookCallback()` создаёт обработчик без регистрации подписки; его можно подключить к существующему HTTP-серверу.

[Bot source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/bot.ts), [Webhook source](https://github.com/max-messenger/max-bot-api-client-ts/blob/main/src/core/network/webhook.ts)

## запуск mini app и авторизация

Подключите `https://st.max.ru/js/max-web-app.js`. API доступен через `window.WebApp`, отдельная инициализация не нужна. Передайте строку `WebApp.initData` на сервер. `initDataUnsafe` подходит только для предварительного отображения, но не для авторизации.

Проверка на сервере:

1. Разберите URL-пары исходного initData. Отклоните повторяющиеся ключи, отсутствие `hash` и несколько значений `hash`.
2. Выполните URL-декодирование значений ровно один раз, сохранив строковое представление JSON.
3. Исключите `hash`, отсортируйте ключи и соедините `key=value` через `\n`.
4. Вычислите `secret = HMAC_SHA256(key='WebAppData', message=BOT_TOKEN)` в виде байтов.
5. Вычислите `expected = HMAC_SHA256(key=secret, message=checkString).hex()`.
6. Сравните декодированные хеши за постоянное время и проверьте возраст `auth_date`. Bridge рекомендует срок действия один час. Отклоняйте время из будущего с учётом небольшого допустимого расхождения часов.

`auth_date` задан в секундах. Объект пользователя содержит `id` (в Bot API используется `user_id`), `first_name`, `last_name`, `username`, `language_code`, `photo_url`. Формат `chat`: `{ id, type: 'DIALOG' | 'CHAT' | 'CHANNEL' }`. Данные пользователя и чата можно считать достоверными только после проверки.

[Validation](https://dev.max.ru/docs/webapps/validation), [Bridge](https://dev.max.ru/docs/webapps/bridge)

## отправка, скачивание и навигация

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

Для отправки нужны текст или ссылка. Отправка во внешние приложения доступна только на мобильных устройствах. Для отправки медиа бот сначала присылает файл пользователю, затем его `mid` передаётся в `shareMaxContent`. Эти действия требуют нажатия пользователя. Для скачивания нужны прямая HTTPS-ссылка и нативный клиент MAX: HTML-атрибут `download` внутри MAX не работает. Браузерный резервный способ используется только вне MAX; обычный `href` не заменяет нативное скачивание.

[Bridge sharing/download contract](https://dev.max.ru/docs/webapps/bridge)

Диплинк mini app: `https://max.ru/<botUsername>?startapp=<payload>`. Максимум 512 символов, допустимы `[A-Za-z0-9_-]`. Значение читается из `initDataUnsafe.start_param`, но доверять ему можно только после серверной проверки. ID приглашений и комнат должны быть короткими и непрозрачными.

Резервная ссылка для отправки из браузера: `https://max.ru/:share?text=<URL-encoded text>`. Официально поддерживаются iOS, Android и веб-версия; поддержка desktop находится в разработке. Ссылка открывает выбор получателя, после чего пользователь отправляет подготовленный текст.

[Mini-app deep links](https://dev.max.ru/docs/webapps/introduction)

## MAX UI для React

```tsx
import { MaxUI, Button, Panel, Typography } from '@maxhub/max-ui';
import '@maxhub/max-ui/dist/styles.css';
<MaxUI platform="android" colorScheme="light"><App /></MaxUI>
```

Нужен React 18+. Платформа и тема обычно определяются автоматически. Явные значения: platform `ios | android`, colorScheme `light | dark`. Для интерфейса используются компоненты и CSS-токены MAX UI: `Panel`, `Grid`, `Container`, `Flex`, `Avatar`, `Typography`. Подключение одного провайдера и декоративного компонента само по себе не означает полного перехода на MAX UI.

[Official MAX UI setup](https://dev.max.ru/ui)

## группы и ограничения API

- Добавление бота в группы по умолчанию отключено; его нужно разрешить в партнёрских настройках.
- Согласно документации, для получения всех сообщений группы через webhook нужно право администратора `read_all_messages`. Само присутствие бота в группе этого права не даёт.
- Сохраняйте группы из проверенных событий и удаляйте их при `bot_removed`. Документация по chat_id описывает `POST /subscriptions` и `GET /updates`. Развёрнутый worker использует polling после проверки отсутствия действующей webhook-подписки.
- В перечне методов Bot API нет документированного метода создания группы. Встреча создаётся внутри mini app, приглашение передаётся диплинком. Группу MAX при необходимости создают сами участники.
- Отправка: `POST /messages?user_id=...` или `?chat_id=...`, тело `{text, attachments, format, notify}`, ответ `{message}`. Лимиты: 4000 символов и 2 сообщения в секунду на одного получателя.
- URL mini app регистрируется в партнёрских настройках MAX. Документированного метода Bot API для этого нет. Mini app привязывается к боту.

[Bot settings FAQ](https://dev.max.ru/help/chatbots), [Group permissions](https://dev.max.ru/docs-api/methods/POST/chats/-chatId-/members/admins), [Removed chat listing](https://dev.max.ru/docs-api/methods/GET/chats), [Send message](https://dev.max.ru/docs-api/methods/POST/messages), [Mini-app registration](https://dev.max.ru/help/miniapps)
