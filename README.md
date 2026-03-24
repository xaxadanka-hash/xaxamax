# xaxamax Messenger

Мессенджер нового поколения с чатами, звонками, стеной и многим другим.

## План и статус

- [MASTER_PLAN.md](docs/MASTER_PLAN.md) — мастер-план пересборки и развития продукта
- [IMPLEMENTATION_TRACKER.md](docs/IMPLEMENTATION_TRACKER.md) — текущий трекер выполнения, статус фаз и ближайшие шаги
- [UPSTREAM_REFERENCES.md](docs/UPSTREAM_REFERENCES.md) — внешние open-source референсы и правила их использования
- [RAILWAY_DEPLOY.md](docs/RAILWAY_DEPLOY.md) — runbook по текущей Railway-базе и deploy-процессу

## Технологии

- **Backend**: Node.js, Express, Socket.IO, Prisma, PostgreSQL
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **Calls**: WebRTC (audio, video, screen sharing)
- **Desktop**: Electron (macOS DMG)
- **Deploy**: Railway.app

## Быстрый старт

### 1. PostgreSQL
```bash
brew install postgresql@16
brew services start postgresql@16
createdb xaxamax
```

### 2. Сервер
```bash
cd server
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run dev
```

Для `Watch Together` и поиска фильмов на сервере желательно задать `TMDB_API_KEY`.

### 3. Клиент
```bash
cd client
npm install
npm run dev
```

Приложение будет доступно на http://localhost:5173

### 4. Desktop Electron
```bash
npm run dev:desktop
```

Для desktop-упаковки:
```bash
npm run pack:desktop
npm run build:desktop
```

## Структура проекта

```
xaxamax/
├── server/           # Express + Socket.IO backend
│   ├── prisma/       # Database schema & migrations
│   ├── src/
│   │   ├── routes/   # API routes (auth, users, chats, messages, posts, media)
│   │   ├── socket/   # Socket.IO handlers
│   │   ├── middleware/# Auth middleware
│   │   └── index.ts  # Server entry point
│   └── uploads/      # File uploads
├── client/           # React + Vite frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── pages/       # Auth pages
│   │   ├── store/       # Zustand stores
│   │   ├── services/    # API & Socket services
│   │   └── styles/      # Global styles
│   └── public/
├── docs/             # План, трекер, архитектурные заметки
├── shared/           # Общие контракты и типы (целевая структура)
└── electron/         # Electron app (Phase 5)
```
