# Промпт read-only аудита опубликованной legacy-игры

Этот документ применяется только к уже существующим опубликованным играм с
живыми сохранениями, store identity и старой монетизацией. Для новых игр,
которые сразу создаются на Barsuk Platform, он не используется.

Канонический путь для агентов:

```text
/Users/macintosh/Applications/Multiplatform/game-starter/LEGACY_AUDIT_PROMPT.md
```

Документ намеренно лежит в корне рабочей копии `game-starter`, а не в
`template/`: он не должен копироваться в каждую игру. Не ищи его в
`node_modules/@barsuk/game-starter` и не перепинивай потребителей ради этого
файла — замороженный legacy baseline `10aa559` был создан до его добавления.

Miner — референсная реализация. Смотри `PROJECT_STATUS.md`, `PLATFORM_IDS.md` и
`AGENTS.md` в `/Users/macintosh/Applications/Multiplatform/miner`, а также gym и
gym2.

Подставь имя игры вместо `<GAME>` и выдай агенту текст ниже целиком.

---

Подключаем `<GAME>` к текущему baseline Barsuk Platform. Общий контракт
(`@barsuk/game-starter`, `@barsuk/game-runtime`) **заморожен**: capabilities,
вынос ledger/restore в runtime и централизация тестов сейчас не делаются.

Целевые пины:

- `@barsuk/game-starter`: `10aa559`
- `@barsuk/game-runtime`: `67b5637`

Сейчас нужен **только read-only аудит**. Код, консоли, сборки, `commit` и `push`
не трогай.

## 1. Найди все форки

Папка, которую я назвал, — это одна платформа, а не проект. У одной игры бывает
до четырёх корней: `Cordova/<game>_and`, `Cordova/www_<game>_and`,
`Capacitor/<game>_ios`, `Capacitor/www_<game>_ios`. Шелл и соседний `www_*`
расходятся.

Ищи так:

```bash
find /Users/macintosh/Applications -maxdepth 2 -type d -iname '*<game>*' -print
```

Имя папки принадлежность не доказывает — оно может быть алиасом или рабочим
названием. После find обязательно ищи по идентификаторам: package ID, bundle ID
и Firebase project id в `config.xml`, `capacitor.config.*`, `build.gradle`,
`project.pbxproj`, `google-services.json` и `GoogleService-Info.plist` по всему
`~/Applications`. Форк, найденный только по ID, тоже входит в карту.

Отсутствие платформы утверждай только после явной проверки, включая листинг в
сторе.

## 2. Выпиши идентичность

Фактами, с указанием файла-владельца каждого значения:

- package ID, bundle ID, версии и versionCode в Google Play и App Store;
- ключ подписи Android: какой keystore, где лежит, есть ли он на руках;
- Firebase-проект и app id каждой платформы, какие сервисы включены;
- AdMob app id и все ad units по платформам, Yandex-юниты и правило routing'а;
- продукты: идентификаторы, типы (consumable / non-consumable) и что каждый
  выдаёт в игре;
- ключи `localStorage` и WebView origin (`androidScheme`, `hostname`) — это
  контракт с сохранениями живых игроков.

## 3. Сравни форки между собой

По каждому пункту — что в каком форке, без вывода «как правильно»:

- сохранения: ключи, момент записи, отложенные и немедленные сохранения;
- покупки: плагин, выдача товара, Restore, Remove Ads, ledger или его
  отсутствие;
- реклама: провайдеры, форматы, consent, ретраи, защита rewarded;
- lifecycle: pause/resume, системная кнопка Back, выход, ориентация,
  status bar и вырез экрана;
- ресурсы: иконка, splash, звуки, локализация;
- плагины с auto-init: что инициализируется само, без вызова из JS (Firebase
  messaging, Crashlytics, Performance, аналитика SDK рекламы).

## 4. Таблица legacy-кода

Каждый нетривиальный кусок старого кода — строкой:

| Код | Что делает | preserve / replace / drop / unknown | Почему |

- `preserve` — поведение видно игроку или это контракт с сохранениями;
- `replace` — то же поведение уже есть в starter/runtime;
- `drop` — устаревший workaround под старый SDK;
- `unknown` — не смог доказать назначение. `unknown` не додумывай, выноси в
  вопросы.

Workaround'ы и старые SDK-вызовы автоматически не переносятся. Пример из Miner:
`REWARD_MIN_MS = 10000` (награда по таймеру) — `drop`; четыре немедленные записи
сохранений — `preserve`.

## 5. Границы

- **Starter-owned файлы обязаны побайтно совпадать с установленным шаблоном**
  (`node_modules/@barsuk/game-starter/template/platform/`). Любое
  game-specific отклонение заносится в явный allowlist этой игры и
  согласуется с Олегом; молча править `bridge.js`, `env.js`, `index.js` или
  адаптеры запрещено. Состав allowlist у каждой игры свой: у Miner это
  `config.js`, `purchase-ledger.js` и `purchase-restore-session.js`, но это
  его частный случай, а не правило платформы.
- Новых изменений в starter/runtime не предлагай.
- Package/bundle ID опубликованной игры не меняется никогда.
- Известные общеплатформенные риски (Yandex `setUserConsent(true)` без реального
  сигнала, ATT и privacy declarations) уже открыты на уровне платформы: отметь и
  иди дальше, локально не чини.
- Версии mediation-адаптеров подбираются заново под этот native shell, решением
  платформы не являются.

## 6. Отчёт и стоп

Заверши отчётом из пяти частей:

1. карта форков и идентичность;
2. таблица различий;
3. таблица preserve / replace / drop / unknown;
4. вопросы Олегу — отдельным списком, каждый с ценой ошибки;
5. минимальный фазовый план с гейтами в этом порядке:
   **build/sync → подпись действующим ключом → установка поверх store-версии →
   device QA → Internal Testing / стор.**
   Порядок принципиален: обновление поверх опубликованной сборки нельзя
   проверить без артефакта, подписанного действующим ключом, а device QA на
   свежей установке не доказывает миграцию живых игроков.

Предложи, куда лягут факты в документации целевого репозитория
(`PROJECT_STATUS.md` — релизы и идентичность, `PLATFORM_IDS.md` —
идентификаторы, `TODO.md` — открытое, `MIGRATION_PLAN.md` — план), но файлы не
создавай.

Остановись и жди решения Олега.
