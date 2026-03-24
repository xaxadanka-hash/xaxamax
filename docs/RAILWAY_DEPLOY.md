# xaxamax — Railway Runbook

Актуально на `2026-03-24`.

## Что уже есть

- локальный backend уже настроен на Railway PostgreSQL через `server/.env`
- у проекта уже есть рабочий процесс на Railway
- значит текущая задача не в создании деплоя с нуля, а в приведении его к стабильному и повторяемому виду

## Базовая целевая схема

- `Railway PostgreSQL` — основная production БД
- `Railway service` — backend `Express + Socket.IO`
- `Netlify` или `Vercel` — web frontend
- `Electron` и `Capacitor` клиенты подключаются к production API по URL

## Рекомендации по секретам

- не передавать `Railway API key` в чат или в код
- использовать Railway Variables или локальные shell env vars
- не коммитить реальные `.env` файлы
- после публикации токена в переписке выпустить новый токен и старый отозвать

## Минимальный набор backend variables

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `PORT`
- `CLIENT_URL`
- `UPLOAD_DIR`

Опционально для web push:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_CONTACT`

Опционально для `Watch Together` и поиска фильмов:

- `TMDB_API_KEY`
- `TMDB_LANGUAGE`

Опционально для server hardening:

- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_API_MAX`
- `RATE_LIMIT_AUTH_MAX`

Опционально для WebRTC relay:

- `VITE_TURN_URL`
- `VITE_TURN_USER`
- `VITE_TURN_PASS`

## Production checklist

### Backend

- Railway service должен запускать backend из `server/`
- health endpoint: `/api/health`
- Prisma schema должна быть синхронизирована с production БД
- CORS `CLIENT_URL` должен указывать на production web origin
- rate limiting должен быть согласован с реальной нагрузкой и логином
- upload-директория или object storage должны быть определены отдельно

### Database

- production `DATABASE_URL` хранить только в Railway Variables
- миграции применять осознанно и отдельно от локальной разработки
- перед структурными миграциями делать backup / snapshot

### Frontend

- `VITE_API_URL` должен указывать на production backend URL
- service worker и push включать только после проверки production origin

## Практический процесс обновлений

1. Изменения делаются локально в репозитории
2. Локально проверяются `build`, `typecheck`, Prisma и основные сценарии
3. После этого изменения пушатся в GitHub
4. Railway подтягивает backend-изменения из репозитория
5. Production variables остаются в Railway, а не в git

## Ближайшие шаги по Railway-интеграции

- формализовать backend deployment path
- отделить локальные `.env` от production variables полностью
- подготовить отдельный production checklist для:
  - Prisma migrations
  - CORS
  - push keys
  - TURN credentials
  - frontend API origin
