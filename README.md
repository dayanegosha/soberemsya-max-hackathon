# .soberemsya max

приложение и бот для MAX, которые помогают компании выбрать общий досуг.

организатор создаёт встречу, участники отдельно указывают интересы, бюджет, время и нежелательные варианты. сервис ищет подходящие места рядом, собирает план и объясняет выбор, не показывая личные ответы другим участникам.

## быстрый запуск

нужны Docker и Docker Compose.

```sh
docker compose up --build
```

после запуска приложение доступно на `http://localhost:3000`. без токена работает демонстрационный режим.

для настоящего бота скопируйте `.env.example` в `.env` и заполните `BOT_TOKEN`, `MAX_BOT_USERNAME` и `APP_URL`. внутри MAX нужен публичный HTTPS-адрес.

## разработка

нужны Node.js 24+ и npm.

```sh
npm ci
npm test
npm run build
npm start
```

в `apps/webapp` находится интерфейс, в `apps/server` — API, в `apps/bot` — бот, а в `packages/recommendation` — подбор общего плана.

подробности интеграции есть в [`docs/max-integration.md`](docs/max-integration.md), сценарий демонстрации — в [`docs/demo-script.md`](docs/demo-script.md).
