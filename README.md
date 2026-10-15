# .soberemsya max

Приложение и бот для MAX, которые помогают компании выбрать общий досуг.

Организатор создаёт встречу, участники отдельно указывают интересы, бюджет, время и нежелательные варианты. Сервис ищет подходящие места рядом, собирает план и объясняет выбор, не показывая личные ответы другим участникам.

## быстрый запуск

Нужны Docker и Docker Compose.

```sh
docker compose up --build
```

После запуска приложение доступно на `http://localhost:3000`. Без токена работает демонстрационный режим.

Для настоящего бота скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `MAX_BOT_USERNAME` и `APP_URL`. Внутри MAX нужен публичный HTTPS-адрес.

## разработка

Нужны Node.js 24+ и npm.

```sh
npm ci
npm test
npm run build
npm start
```

В `apps/webapp` находится интерфейс, в `apps/server` — API, в `apps/bot` — бот, а в `packages/recommendation` — подбор общего плана.

Подробности интеграции есть в [`docs/max-integration.md`](docs/max-integration.md), сценарий демонстрации — в [`docs/demo-script.md`](docs/demo-script.md).
