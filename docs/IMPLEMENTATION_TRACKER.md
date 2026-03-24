# xaxamax — Трекер реализации

Актуально на `2026-03-24`.

## Базовый срез текущего репозитория

- Есть `client`, `server`, `electron`
- Есть Prisma schema и PostgreSQL-бэкенд
- Есть auth, чаты, сообщения, посты, каналы, stories, push-маршруты
- Есть WebRTC/call-слой и `Watch Together`, но он требует стабилизации
- Есть Capacitor Android-конфиг в клиенте
- Нет выделенного `shared/` слоя как источника общих контрактов
- Нет зафиксированного master-plan документа в репо до текущего изменения

## Текущий рабочий фокус

- [x] Зафиксировать roadmap в репозитории
- [x] Создать трекер выполнения
- [x] Завести стартовый `shared/` каркас и канонический каталог socket events
- [x] Превратить `shared/` в реальный пакет `@xaxamax/shared`
- [x] Зафиксировать upstream Telegram-референсы и правила их использования
- [x] Зафиксировать Railway runbook и усилить gitignore для вложенных env-файлов
- [x] Централизовать серверный env/config слой и убрать часть скрытых runtime-рисков
- [x] Перевести поиск сообщений в чате на серверный API и исправить конфликт маршрутов
- [x] Выравнять пересылку сообщений с realtime-моделью через Socket.IO
- [x] Подключить delivery/read статусы на клиенте и сузить server-side read updates
- [x] Собрать global search в sidebar по чатам, пользователям и сообщениям
- [x] Нормализовать chat payloads и убрать часть рассинхрона sidebar/message list
- [x] Добавить membership-guards в chat/message socket events
- [x] Развести семантику delete-for-me и delete-for-all без поломки серверных данных
- [x] Канонизировать server-side message include для fetch/search/socket payloads
- [x] Сохранить voice duration в media и добавить recorder mime-type fallback
- [x] Выравнять reload-поведение delete-for-all как tombstone, а не исчезновение
- [x] Подтянуть integrity-checks для socket edit/pin
- [x] Починить audio-to-video upgrade в active WebRTC calls
- [x] Починить lifecycle screen share: browser-stop, rollback camera track и снятие screen-audio
- [x] Добавить access-guards и room-validation для group call signaling
- [x] Провалидировать direct call signaling и Watch Together relay по membership call-а
- [x] Синхронизировать выбранный фильм для позднего join в group call
- [x] Добавить jump-to-reply / jump-to-pin и видимый typing-status в ChatView
- [x] Перенести TMDB-поиск фильмов с клиента на серверный API
- [x] Добавить helmet, rate limiting и production-safe CORS на backend
- [x] Добавить upload mime validation и явные ошибки по размеру/типу файла
- [x] Закрыть banned-user доступ в login / refresh / socket auth
- [x] Перевести backend на единый Prisma singleton вместо нескольких клиентов
- [x] Обновить frontend toolchain до `vite 8` и убрать `npm audit` уязвимости клиента
- [x] Дожать socket guards для reactions и invalid call initiation
- [x] Починить регистрацию service worker и системные web notifications для realtime-событий
- [x] Усилить Electron shell: tray, native notifications, desktop IPC и root desktop scripts
- [x] Добить базовый adaptive audit для MainLayout / Sidebar / Chat / Feed / Settings
- [x] Подтвердить зелёные сборки `client`, `server` и корневого `build`
- [ ] Сверить текущую реализацию с планом по фазам
- [ ] Выделить первый инженерный milestone без конфликтов с текущими незакоммиченными правками

## Phase 1 — Foundation

- [ ] Выделить и описать общие контракты между клиентом и сервером
- [~] Подготовить `shared/` слой
- [ ] Провести ревизию Prisma schema против фактических product-целей
- [~] Убрать архитектурные расхождения между REST и Socket.IO
- [~] Проверить env/config слой и startup reliability

## Phase 2 — Messenger Core

- [~] Стабилизировать список чатов и окно сообщений
- [~] Добить message actions: reply / edit / delete / pin
- [~] Сделать навигацию по reply / pin и живой typing UX
- [x] Перевести forward в realtime-path c ack и обновлением списка чатов
- [~] Привести голосовые сообщения к production-ready состоянию
- [x] Доделать базовый поиск по сообщениям внутри чата
- [x] Расширить поиск до чатов / пользователей / глобального message scope
- [~] Унифицировать статусы сообщений и доставку событий

## Phase 2.5 — Feed / Wall

- [ ] Проверить completeness постов, реакций и комментариев
- [ ] Доделать media-flow в постах и комментариях
- [ ] Выравнять адаптивность ленты

## Phase 3 — Calls / WebRTC

- [ ] Разбить call-монолит на устойчивые модули
- [~] Стабилизировать `1-на-1` audio/video
- [~] Починить screen share
- [~] Проверить group calls
- [~] После этого стабилизировать `Watch Together`

## Phase 4 — UI / Adaptive

- [~] Провести mobile audit
- [~] Провести tablet audit
- [~] Провести desktop audit
- [~] Завести единый подход к темам, safe-area и touch targets

## Phase 5 — Desktop / Mobile Packaging

- [~] Проверить Electron shell и build pipeline
- [ ] Подготовить DMG-сборку
- [ ] Проверить Capacitor Android pipeline

## Phase 6 — Deploy / Production

- [~] Актуализировать Railway-конфиг
- [~] Подготовить production env matrix
- [ ] Проверить web deploy
- [ ] Подготовить desktop/mobile clients к prod API

## Next milestone

Текущий инженерный milestone:

- выделить общие transport contracts и event names
- подготовить `shared/` слой без ломающих изменений
- стабилизировать message core без конфликта с локальными незакоммиченными правками
- затем перейти к аудиту и стабилизации call/message core
