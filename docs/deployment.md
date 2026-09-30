# Сервер команды

Приложение: https://soberemsya.139.100.225.250.sslip.io

Бот: https://max.ru/t243_hakaton_max_bot

Сервер: `139.100.225.250`. Все исходники, ENV, база и конфигурация приложения находятся в **`/root/soberemsya-max-243`**. Используется уже установленный Docker. Node/npm и зависимости на хост глобально не устанавливались; они внутри нашего образа. Образы и контейнеры хранятся стандартным механизмом существующего Docker daemon.

## Изоляция

- Compose project: `soberemsya-max-243`, собственная сеть.
- app: внутренний порт 3000; 1 CPU, 384 MB.
- bot: 0.5 CPU, 192 MB; polling, без второго локального процесса.
- https: Caddy, 0.5 CPU, 128 MB; занял ранее свободные 80/443.
- Данные SQLite: `runtime/data`; сертификаты HTTPS: `runtime/caddy-data`; конфигурация: `runtime/caddy-config`.
- Конфигурации хоста, firewall и шести существовавших контейнеров telephony не изменялись. Их идентификаторы до и после совпадают; время работы не сбрасывалось.
- `.env` имеет права 600, в архив и Docker context не входит.

SSL-сертификат выпущен Let's Encrypt автоматически. Проверка HTTPS проходит без отключения TLS. Домен бесплатного сервиса sslip.io указывает на IP сервера; от доступности этого внешнего DNS-сервиса зависит открытие ссылки. Компьютер капитана для работы приложения больше не нужен. Для постоянного продукта лучше собственный домен.

MAX Bot API требует отдельный доверенный корневой сертификат. Он добавлен только процессу бота через `NODE_EXTRA_CA_CERTS`, см. [certs/README.md](../certs/README.md). Системное хранилище сертификатов хоста не менялось.

## Управление только нашим проектом

Все команды ниже выполняются **в нашей папке**, с явным Compose-файлом. Не применять глобальные `docker system prune`, `docker stop $(docker ps -q)` и другие действия над чужими ресурсами.

```sh
cd /root/soberemsya-max-243
docker compose -f compose.server.yaml ps
docker compose -f compose.server.yaml logs --tail=50 app bot
```

После изменения собственных исходников:

```sh
docker compose -f compose.server.yaml build app
docker compose -f compose.server.yaml up -d
```

Остановка / повторный запуск:

```sh
docker compose -f compose.server.yaml stop
docker compose -f compose.server.yaml start
```

Перезапуск только приложения:

```sh
docker compose -f compose.server.yaml restart app bot
```

## Первичная настройка на другом свободном сервере

Нужны уже установленные Docker и Compose, свободные 80/443, DNS на сервер. В новой отдельной папке разместить исходники, скопировать `.env.example` в `.env`, задать BOT_TOKEN, MAX_BOT_USERNAME, APP_DOMAIN, APP_URL и API_URL. Не публиковать `.env`.

```sh
mkdir -p runtime/data runtime/caddy-data runtime/caddy-config
chown 1000:1000 runtime/data
chmod 600 .env
docker compose -f compose.server.yaml up --build -d
```

Не запускать второй polling worker с тем же BOT_TOKEN. До polling бот проверяет существующие webhook-подписки.

## Резервная копия

Создать внутри нашей папки `backups`, остановить app и bot, скопировать весь `runtime/data`, затем снова запустить app и bot. Не копировать активную SQLite без WAL или согласованного backup. Файлы резервных копий содержат данные пользователей и не входят в архив исходников.

```sh
mkdir -p backups
docker compose -f compose.server.yaml stop app bot
tar -czf "backups/data-$(date +%Y%m%d-%H%M%S).tgz" runtime/data
docker compose -f compose.server.yaml start app bot
```

## Подключение mini app

25 сентября 2026 ссылка отправлена через предоставленную [форму](https://sbor-ssylok-dlya-mini-prilojeniy.testograf.ru/) для команды МАХимы. Ответ формы: «Ваша ссылка получена организаторами. Ожидайте подключения в течение 3 часов». Повторно отправлять её не требуется. Это подтверждение получения заявки, не подтверждение подключения. После подключения выполнить сценарий MAX mobile/web из [demo-script.md](demo-script.md).

## Обновление до 0.2

Бот также монтирует `runtime/data` и работает с общей SQLite. Новые таблицы создаются добавочно, существующие встречи не удаляются. Перед первым запуском 0.2 сделана согласованная копия `backups/data-before-chat-20260926.tgz` при остановленных app/bot. Старый образ 0.1.0 сохранён. Для последующих резервных копий нужно останавливать оба процесса, пишущих в БД.
