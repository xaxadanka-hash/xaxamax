# xaxamax Messenger

Мессенджер нового поколения с чатами, звонками, стеной и многим другим.

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

### 3. Клиент
```bash
cd client
npm install
npm run dev
```

Приложение будет доступно на http://localhost:5173

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
└── electron/         # Electron app (Phase 5)
```
