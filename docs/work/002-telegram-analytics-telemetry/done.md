# Сделано — телеметрия аналитики (форк-сторона)

Исходники: [`input-events.md`](./input-events.md) (кто производит кадры и транспорт),
[`input-backend.md`](./input-backend.md) (контракт бэка). Ветка `feature/tg-analytics-events`
от `dev`, мержится в `dev`.

## Решения (согласованы)
- **Транспорт — вариант A**: кадры `{type:'events'}` / `{type:'unread'}` едут по уже открытому
  gateway-WS. Ничего от бэка/платформы не требуется.
- **Объём — полный**: presence + message (вх/исх) + unread + досылка на каждый sync + батчинг +
  главная вкладка.

## Архитектура
Main-thread производит кадры → воркер релеит их по WS.

```
presence timer ─┐
message hooks  ─┼─► telemetry.ts (буфер, дедуп, батч ≤500, flush/10с)
unread callback─┤        │ callApi
backfill/sync  ─┘        ▼
                 client.ts sendGatewayEvents / sendGatewayUnread
                        ▼  client.sendGatewayData
                 GatewayTransport.sendData → ws.send({type:'events'|'unread'})
```

## Файлы

**Транспорт (воркер):**
- `src/api/gramjs/methods/gatewayTransport.ts` — `sendData(frame)` (fire-and-forget по WS).
- `src/lib/gramjs/client/gatewayTypes.ts` / `TelegramClient.ts` — интерфейс + `sendGatewayData`.
- `src/api/gramjs/methods/client.ts` (+ `index.ts`) — воркер-методы `sendGatewayEvents` /
  `sendGatewayUnread` для `callApi`.

**Производство (main):**
- `src/util/analytics/telemetry.ts` — буфер, дедуп по серверному ключу, батч ≤500, flush 10с;
  `queuePresence` / `queueMessageEvent` / `reportUnread` / `resetMessageDedup`. Копит только
  собирающая (главная) вкладка.
- `src/util/analytics/presence.ts` — раз в минуту секунды видимости (0–60), `document.visibilityState`,
  только master.
- `src/util/analytics/reportMessage.ts` — событие из `ApiMessage`: пропускает локальные (нет
  серверного ключа) и сервисные; `at` = дата сообщения (правильный суточный бакет).
- `src/util/analytics/unread.ts` — по колбэку folderManager (ALL-папка `chatsCount` /
  `notificationsCount`), только master, гашение повторов.
- `src/util/analytics/backfill.ts` — последнее сообщение каждого чата.
- `src/util/analytics/index.ts` — `startAnalytics` / `stopAnalytics` / `backfillHistory`.

**Проводка:**
- `apiUpdaters/messages.ts` — `reportMessage` в `newMessage` (входящие) и
  `updateMessageSendSucceeded` (исходящие, у вкладки-отправителя).
- `api/initial.ts` — `startAnalytics()` в gateway-ветке `initApi`.
- `api/sync.ts` — `backfillHistory()` после каждого sync.

## Как выполнены требования из ТЗ
- **presence** — раз в минуту, только видимая вкладка (свёрнутое = 0, не шлётся), главная вкладка. ✅
- **message** — исходящее у вкладки-отправителя (`updateMessageSendSucceeded`, есть `previousLocalId`),
  входящее у обработчика апдейтов; `messageId` — серверный (через `getMessageServerKey`); дедуп по ключу. ✅
- **unread** — отдельным кадром при изменении сводных счётчиков. ✅
- **досылка на каждый sync** (не только старт) — реконнект/смена анкеты переоткрывают соединение и
  ре-синкают → досылка повторяется, дедуп держит идемпотентность. ✅
- **батчинг ≤500**, дроп >500 не наступает (шлём порциями). ✅
- **главная вкладка** — `isCurrentTabMaster()`; в обычной сборке всё выключено (`IS_GATEWAY`). ✅

## Проверка
- eslint + `npm run check:ts` — по изменённым файлам чисто.

## Ограничения / на будущее
- **Смена главной вкладки посреди сессии**: presence/unread-таймеры стартуют на инициализирующей
  (master) вкладке; если та закроется и master сменится, таймеры на новой не поднимутся до
  перезагрузки. Смена анкеты сейчас = reload iframe, так что на практике не всплывает. Для in-place
  switch (TODO A.5) — поднимать `startAnalytics` per-tab с self-gate по master.
- **Best-effort доставка**: при закрытом WS во flush кадр теряется (контракт это допускает); история
  до-сылается на следующем sync, presence — раз в минуту.
- **`presence` = время на странице Telegram**, а не «в системе»: уход на другую страницу платформы
  размонтирует iframe. Проговорить с продуктом (см. `input-events.md`).
- **`unread.messages`** = `notificationsCount` (немьютнутые), как в бейдже приложения.
