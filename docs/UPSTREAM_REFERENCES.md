# xaxamax — Upstream References

Актуально на `2026-03-24`.

Этот документ фиксирует, какие открытые Telegram-референсы мы используем как источник архитектурных и UX-идей, и что именно из них допустимо адаптировать в `xaxamax`.

## Базовый принцип

`xaxamax` строится как самостоятельный продукт:

- со своим backend
- со своей PostgreSQL БД
- со своим realtime-слоем на `Socket.IO`
- без зависимости от Telegram API / MTProto на production-пути продукта

Поэтому внешние Telegram-репозитории мы используем:

- как UX-референс
- как архитектурный референс
- как источник паттернов по состоянию, кэшу, спискам, медиаслою и адаптивности

И не используем:

- как backend `as-is`
- как прямую замену нашей серверной архитектуры
- как источник бездумного копирования больших блоков кода

## Основные upstream-референсы

### 1. Telegram Web K

URL:

- [Telegram Web K](https://github.com/TelegramOrg/Telegram-web-k)

Почему полезен:

- современный web-клиент
- сильный фокус на UX мессенджера
- оффлайн/кэш/сервис-воркерные паттерны
- интерфейс списков, чатов, медиапотоков, PWA-поведение

Что берём как референс:

- организация chat list / message list UX
- поведение адаптивного web-клиента
- структура взаимодействия UI и фоновых задач
- подход к локальному кэшу и progressive UI

Что не переносим напрямую:

- Telegram API-specific transport
- MTProto-ориентированные слои
- всё, что жёстко завязано на telegram DC / sessions / API semantics

### 2. Telegram Web Z / Web A

URL:

- [Telegram Web Z](https://github.com/TelegramOrg/Telegram-web-z)

Почему полезен:

- сильная web-архитектура
- PWA, многослойный кэш, voice/media streaming, optimistic UI
- хорошие паттерны по производительности и progressive rendering

Что берём как референс:

- offline/cache идеи
- PWA-подход
- media pipeline и UX для вложений
- patterns для voice/media experience

### 3. Telegram Desktop

URL:

- [Telegram Desktop](https://github.com/telegramdesktop/tdesktop)

Почему полезен:

- зрелый desktop UX
- сильные паттерны hotkeys, navigation, multi-pane layouts
- качественная модель взаимодействия для desktop messaging

Что берём как референс:

- desktop information architecture
- горячие клавиши
- 3-column layout
- поведение модалок, call overlays, sidebar/navigation

## Важные лицензионные замечания

По данным upstream-репозиториев:

- `Telegram Web K` опубликован под `GPL-3.0`
- `Telegram Web Z` опубликован под `GPL-3.0`
- `Telegram Desktop` опубликован под `GPLv3` с исключением для `OpenSSL`

Это значит:

- можно изучать архитектуру и идеи
- можно адаптировать общие технические решения и UX-паттерны
- при прямом копировании кода нужно соблюдать требования соответствующих лицензий

Практический вывод для `xaxamax`:

- предпочтительный путь — собственная реализация поверх нашего стека
- допускается точечное заимствование только там, где мы осознанно готовы жить с лицензионными последствиями

## Что именно используем в текущей пересборке

### Для Phase 1-2

- структура навигации и layout-мышление Telegram Web / Desktop
- поведение списков, поисковых панелей, чатов, контекстных меню
- UX-семантика статусов сообщений, reply/forward/pin/edit/delete

### Для Phase 3

- desktop/web-call UX как референс взаимодействия
- но не transport stack Telegram, потому что у нас свой signaling и собственный WebRTC backend path

### Для Phase 4-5

- desktop layout patterns
- mobile adaptive heuristics
- notification и shell behavior как вдохновение, а не как прямое копирование

## Deployment baseline

Для `xaxamax` deployment baseline принимается таким:

- backend и PostgreSQL уже можно считать привязанными к `Railway`
- web frontend можно продолжать деплоить отдельно
- desktop и mobile clients должны подключаться к нашему API, а не к Telegram

## Ближайшее практическое применение

Следующие шаги в коде должны опираться на эти upstream-референсы:

1. выравнивание общих контрактов `client/server`
2. стабилизация message core
3. рефакторинг call-системы по модульной схеме
4. desktop/mobile adaptive polishing по telegram-style паттернам
