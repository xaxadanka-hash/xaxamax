# xaxamax — Мастер-план пересборки

Этот документ фиксирует целевое направление развития `xaxamax` как независимого мессенджера уровня Telegram Web/Desktop с собственной инфраструктурой, PostgreSQL, WebRTC-звонками и desktop/mobile-обвязками.

## Видение продукта

- Независимый мессенджер без Telegram API
- Надежная серверная архитектура: `Node.js + Express + Socket.IO + Prisma + PostgreSQL`
- Реaltime-коммуникация: чаты, реакции, статусы, уведомления, звонки
- Desktop-клиент через Electron с DMG для macOS
- Mobile-first web и Android APK через Capacitor
- Уникальная фича продукта: `Watch Together`

## Целевой стек

- Frontend: `React 18`, `TypeScript`, `Vite`, `TailwindCSS`, `Lucide`, `Framer Motion`, `Zustand`
- Backend: `Node.js`, `Express`, `Socket.IO`
- Database: `PostgreSQL`, `Prisma ORM`
- Calls: `WebRTC` для audio/video/screen share, затем group calls
- Desktop: `Electron`
- Mobile packaging: `Capacitor`
- Deploy: `Railway` для backend/PostgreSQL, `Netlify` или `Vercel` для web

## Архитектурные принципы

- PostgreSQL как основная ACID-БД и единый источник истины
- Реaltime-доставка через `Socket.IO`, критические действия дублируются REST API
- Модель данных и transport-контракты должны быть централизованы и не дублироваться между клиентом и сервером
- Оффлайн-слой и локальный кеш строятся вокруг `IndexedDB`
- Сначала стабилизируем базовые пользовательские сценарии, потом добавляем сложные надстройки вроде `Watch Together`

## Целевая структура проекта

```text
xaxamax/
├── client/          # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── store/
│   │   ├── services/
│   │   └── styles/
│   └── electron/    # Electron main process / desktop integration
├── server/          # Node.js backend
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── socket/
│   │   ├── webrtc/
│   │   └── prisma/
│   └── prisma/
│       └── schema.prisma
└── shared/          # Shared types / contracts / constants
```

## Фаза 1 — Фундамент

- Инициализация и выравнивание структуры проекта
- Приведение репозитория к роли `source of truth`: документация, трекер, общие контракты
- PostgreSQL + Prisma схема для:
  - `users`
  - `chats`
  - `messages`
  - `calls`
  - `media`
  - `posts`
  - `comments`
  - `likes`
  - `reactions`
- Express API + Socket.IO server
- Регистрация и авторизация:
  - телефон + пароль
  - `bcrypt`
  - `JWT`

## Фаза 2 — Ядро мессенджера

- Личные и групповые чаты в Telegram-style UI
- Отправка текста, медиа, файлов, голосовых сообщений
- Ответы, пересылка, редактирование, удаление, закреп сообщений
- Статусы сообщений: `sent`, `delivered`, `read`
- Поиск по сообщениям и контактам
- In-app и push-уведомления
- Контекстное меню сообщения:
  - ответить
  - редактировать
  - удалить
  - переслать
  - закрепить
  - копировать текст

## Фаза 2.5 — Стена / лента

- Публикация постов: текст, фото, видео
- Лайки и реакции
- Комментарии, включая голосовые
- Репосты / поделиться постом
- Профильная стена пользователя
- Глобальная лента
- Полная адаптивность на mobile/tablet/desktop

## Фаза 3 — Звонки и трансляция

- WebRTC аудиозвонки `1-на-1`
- WebRTC видеозвонки `1-на-1`
- Screen sharing через `getDisplayMedia`
- Group calls:
  - старт с `mesh` для малых комнат
  - при необходимости переход к `SFU` (`mediasoup`)
- TURN/STUN конфигурация
- Рефакторинг call-слоя:
  - `useWebRTC`
  - `useMediaStreams`
  - `useCallManager`
  - `CallModal`
  - `CallControls`
  - `VideoLayout`
  - `GroupCallGrid`
  - `WatchTogether`

## Фаза 3.5 — Watch Together

- Совместный просмотр внутри звонков
- Синхронизация play/pause/seek и выбранного контента
- Screen share как fallback-режим
- Мульти-провайдерный embed-слой с graceful fallback

## Фаза 4 — Дизайн и адаптивность

- Telegram-inspired UI
- Темная и светлая темы
- Mobile-first layout
- Tablet layout
- Desktop layout
- Анимации и переходы на `Framer Motion`
- Настройки профиля, аватары, темы, язык, приватность

## Фаза 5 — Desktop и mobile packaging

- Electron-обертка для macOS
- Нативные уведомления macOS
- Трей-иконка, горячие клавиши
- Сборка `DMG` через `electron-builder`
- Android APK через Capacitor:
  - camera
  - filesystem
  - haptics
  - status bar
  - push notifications

## Фаза 6 — Публикация и эксплуатация

- Railway: backend + managed PostgreSQL
- Netlify/Vercel: web frontend
- Переменные окружения и домены
- Подключение desktop/mobile клиентов к production API
- Базовая observability и мониторинг

## Фаза 7 — Каналы и медиаслой

- Каналы `broadcast`
- OWNER / ADMIN / MEMBER роли
- Публичные ссылки
- Комментарии к постам канала
- Стикеры
- GIF

## Фаза 8 — Push, оффлайн и локальный кеш

- `Service Worker` + `Web Push`
- FCM для Android
- `IndexedDB` для локального кеша и оффлайн-доступа
- Сохранение токенов устройств и подписок в БД

## Фаза 9 — Безопасность и надежность

- `helmet`
- rate limiting
- input validation / sanitization
- валидация upload-файлов
- auth для WebSocket
- постепенное усиление transport security
- опциональная E2E-эволюция для сообщений

## Порядок реализации

1. Зафиксировать roadmap и единый трекер в репозитории
2. Сверить фактический код с roadmap и определить baseline
3. Стабилизировать фундамент:
   - БД
   - auth
   - API
   - Socket contracts
4. Довести до надежного состояния chat-core
5. Рефакторить и стабилизировать звонки
6. После стабильных звонков развивать `Watch Together`
7. Затем расширять платформенный слой: Electron, Capacitor, push, deploy

## Ближайший фокус

- Документировать roadmap прямо в репозитории
- Вести живой трекер фаз и статусов
- Начать вынос общих контрактов и архитектурное выравнивание между `client` и `server`
