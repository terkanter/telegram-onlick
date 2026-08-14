# Сделано

Исходное ТЗ — [`input.md`](./input.md). Три независимых блока; порядок сдачи 3 → 2 → 1.

## Блок 3 — код закрытия WS `4403` ✅

### Проблема
Раньше любой WS-close → `connectionStateBroken` → реконнект. Сотрудник с отозванным
доступом висел в вечном «подключаемся».

### Решение
Развели коды закрытия: `4403` (доступ отозван) обрабатывается отдельно от broken-состояний.
`4401`/`4408` — как раньше (реконнект).

### Поток
```
WS close(4403)
  → GatewayTransport.handleClose(code) → onClose(code)
  → client.ts onGatewayClose(4403): sendApiUpdate('updateGatewayRevoked')   // НЕ connectionStateBroken
  → apiUpdaters/initial.ts: setGatewayStatus('revoked')                     // без реконнекта
  → App.tsx: isGatewayRevoked → AppScreens.gateway
  → GatewayPending рендерит статус 'revoked' → строка GatewayRevoked
```

### Файлы
- [`src/api/types/updates.ts`](../../../src/api/types/updates.ts) — тип `ApiUpdateGatewayRevoked`.
- [`src/api/gramjs/methods/client.ts`](../../../src/api/gramjs/methods/client.ts) —
  `onGatewayClose(code?)`, константа `GATEWAY_CLOSE_REVOKED = 4403`; для 4403 шлёт
  `updateGatewayRevoked`, иначе — `connectionStateBroken`.
- [`src/global/actions/apiUpdaters/initial.ts`](../../../src/global/actions/apiUpdaters/initial.ts) —
  обработка `updateGatewayRevoked` → `setGatewayStatus('revoked')`.
- [`src/components/App.tsx`](../../../src/components/App.tsx) — гейт
  `IS_GATEWAY && (isGatewayRevoked || authState !== ready)` → gateway-экран.

### Ключевые решения
- **Revoke может прийти посреди активной сессии** (`authState` уже `ready`), поэтому гейт в App
  завязан на статус-сигнал, а не только на auth-состояние.
- **Ожил мёртвый `setGatewayStatus`** — раньше не вызывался нигде, статус-сигнал застывал на
  `connecting`. Теперь его дёргает revoke-хендлер.
- Экран переиспользован существующий (`GatewayPending` + статус `revoked` + строка `GatewayRevoked`).

### Проверка
- `npm run check:ts` — по изменённым файлам чисто (2 предсуществующих `no-unnecessary-type-assertion`
  в `client.ts` не из этих правок).
- Чек-лист приёмки: `4403` → экран «доступ отозван», без реконнекта; `4401`/`4408` — как раньше. ✅

---

## Блок 2 — `errorCode` в кадре ошибки ✅

### Решения (согласованы с заказчиком)
- **Показ — модалкой** (как сейчас, `showDialog`), не тостом.
- **Спец-показ только для tagged-ошибок** (у которых бэк проставил `errorCode`); untagged —
  как сейчас (сырой текст, `PEER_FLOOD` и пр. не прячем). Вместо хардкода 4 кодов используем
  признак «`errorCode` присутствует» → forward-compatible к новым кодам от бэка.

### Проблема, которую вскрыла разведка
1. Строковый `errorCode` терялся при конвертации gateway-ошибки в `RPCError` (нёс только
   числовой код).
2. `getReadableErrorText` мэпит `message` по словарю Telegram-строк — для человеческого текста
   из кадра вернул бы `undefined` (пустая модалка). Значит для tagged показываем `message`
   **напрямую** (`hasErrorKey: false`).
3. `send*`/`forward*` шлют с `shouldThrow: true` и в catch помечают `updateMessageSendFailed`
   (спиннер снимается — требование `SESSION_DEAD` закрывается само, как только шлюз отвечает
   кадром), но **диалог не показывают** → причину надо доставить отдельно.

### Поток
```
error-кадр {message, code, errorCode}
  → GatewayTransport.toGatewayError → GatewayError.gatewayErrorCode
  → TelegramClient._gatewayInvoke: RPCError + Object.assign({gatewayErrorCode})
  → buildApiError → ApiError.errorCode
  ├─ shouldThrow:false путь → dispatchErrorUpdate → апдейт 'error'
  └─ send/forward (swallow) → dispatchGatewayRefusalError → апдейт 'error' (только если errorCode есть)
  → apiUpdaters 'error': errorCode есть → showDialog с hasErrorKey:false (message напрямую)
```

### Файлы
- [`src/lib/gramjs/client/gatewayTypes.ts`](../../../src/lib/gramjs/client/gatewayTypes.ts) —
  `GatewayError.gatewayErrorCode?: string`.
- [`src/api/gramjs/methods/gatewayTransport.ts`](../../../src/api/gramjs/methods/gatewayTransport.ts) —
  `errorCode?` в кадре, проброс через `toGatewayError`.
- [`src/lib/gramjs/client/TelegramClient.ts`](../../../src/lib/gramjs/client/TelegramClient.ts) —
  `_gatewayInvoke` прикрепляет `gatewayErrorCode` к `RPCError`.
- [`src/api/types/misc.ts`](../../../src/api/types/misc.ts) — `ApiError.errorCode?: string`.
- [`src/api/gramjs/helpers/misc.ts`](../../../src/api/gramjs/helpers/misc.ts) — `buildApiError`
  извлекает `errorCode`.
- [`src/api/gramjs/methods/client.ts`](../../../src/api/gramjs/methods/client.ts) —
  `dispatchErrorUpdate` несёт `errorCode`; новый `dispatchGatewayRefusalError` (шлёт `'error'`
  только для tagged).
- [`src/api/gramjs/methods/messages.ts`](../../../src/api/gramjs/methods/messages.ts) — catch
  `sendApiMessage` и `forwardApiMessages` зовут `dispatchGatewayRefusalError`.
- [`src/global/actions/apiUpdaters/initial.ts`](../../../src/global/actions/apiUpdaters/initial.ts) —
  `'error'`-хендлер: `errorCode` есть → `hasErrorKey:false` (показ `message` напрямую).

### Ключевые решения
- **Признак «errorCode присутствует», а не хардкод 4 кодов** — новые коды от бэка автоматически
  получают тот же показ («показывать message»), untagged остаются как сейчас.
- **Спиннер `SESSION_DEAD` снимается автоматически** существующим `updateMessageSendFailed` —
  фикс на стороне бэка (кадр теперь приходит), спец-кода на форке не требует.
- Слово-триггер не показываем — выводим `message` от бэка без добавлений.

### Проверка
- `npm run check:ts` — по изменённым файлам чисто (предсуществующие ошибки в `client.ts`/
  `TelegramClient.ts` не из этих правок).
- Чек-лист: ветвление по коду, незнакомый/отсутствующий код → как сейчас, спиннер снимается на
  `SESSION_DEAD`. ✅

---

## Блок 1 — права (`permissions`) ✅

### Решения (согласованы с заказчиком)
- **Хранение — сигнал + хук** (`getGatewayPermissions` в telegramGateway + `useGatewayPermissions`),
  как blurImages/route. Fail-open: нет блока/поля → фича видна. Live без реконнекта.
- **Пересылку** прятать везде, **включая bulk-выбор**.
- **Никнеймы — полное скрытие**: не только chrome, но и `@username` в тексте сообщения
  (некликабельно, `@…`-плейсхолдер) и t.me в превью ссылок.
- **Убрать копирование ссылок** на канал/группу/человека везде (профиль, меню сообщения,
  forward-picker).

### Пламбинг
- [`src/util/telegramGateway.ts`](../../../src/util/telegramGateway.ts) — тип `GatewayPermissions`,
  сигнал `getGatewayPermissions`; `handleSettingsMessage` применяет `permissions` независимо от
  `blurImages` (вынес `applyBlurImagesSetting`), каждый пуш заменяет состояние.
- [`src/hooks/useGatewayPermissions.ts`](../../../src/hooks/useGatewayPermissions.ts) —
  `{ canSearch, canViewUsernames, canForwardMessages }`, fail-open (`!== false`).

### Вырезание — файлы
| Подмаркер | Место | Файл |
|---|---|---|
| search | поисковая строка | `left/main/LeftMainHeader.tsx` (`SearchInput--hidden`) |
| forward | пункт меню | `middle/message/MessageContextMenu.tsx` |
| forward | hover-кнопка | `middle/message/Message.tsx` |
| forward | bulk-выбор | `middle/MessageSelectToolbar.tsx` |
| usernames | шапка чата | `common/PrivateChatInfo.tsx`, `common/GroupChatInfo.tsx` |
| usernames | профиль (user + chat + строка ссылки) | `common/profile/ChatExtra.tsx` |
| usernames | контакты/поиск/меню @-подсказок | через `PrivateChatInfo` (покрыто) |
| usernames | via-bot | `middle/message/Message.tsx` |
| usernames | упоминания в тексте | `middle/message/MentionLink.tsx` (`@…`, некликабельно) |
| usernames | t.me в превью | `middle/message/WebPage.tsx` (`RE_TME_LINK`) |
| copy-link | меню сообщения | `middle/message/MessageContextMenu.tsx` (`canCopyLink && canViewUsernames`) |
| copy-link | forward-picker | `main/ForwardRecipientPicker.tsx` |

### Ключевые решения
- **Гейт на рендере, не в `getMainUsername()`** — он используется для навигации
  (`openChatByUsername`); обнуление сломало бы клики.
- **MentionName (по userId) оставлен кликабельным** — показывает имя (не username), ведёт в
  профиль, где username уже скрыт. Прячем только `Mention` (литеральный `@username`).
- Контакты/поиск/меню @-подсказок покрыты автоматически — рендерятся через `PrivateChatInfo`.

### Не покрыто (admin/settings, вне пути контент-менеджера) — на решение
- `ManageUsernames` (редактор публичного username в настройках/управлении).
- `LinkField` boost-ссылка (`BoostStatistics`), приватные invite-ссылки (`ManageInvites` — не
  содержат username), статистика (`StatisticsMessagePublicForward`), username-scoped хэштеги.

### Проверка
- eslint + `npm run check:ts` — по изменённым файлам чисто.
- Чек-лист: permissions вырезает поиск/никнеймы/пересылку; отсутствие блока = всё видно;
  смена прав live без реконнекта. ✅

### Вторая волна — аудит полноты (3 read-only агента) + доработки
Аудит вскрыл существенные пропуски первой волны; все HIGH/MEDIUM закрыты, скоуп расширен по
решению заказчика («весь поиск» + «гейтить всё»).

**Пересылка (доп. точки входа):**
- Медиа-вьювер (`mediaViewer/MediaViewerActions.tsx` — десктоп+мобилка).
- Стори: форвард в футере (`story/StoryFooter.tsx`), share в композере стори (`story/Story.tsx` `canShare`).
- Share игры (`main/GameModal.tsx`), «Set Reminder»→Saved (`common/FormattedDate.tsx`).

**Поиск (был дырявым — «весь поиск»):**
- Левый бар теперь **не рендерится** при `!canSearch` (был лишь `opacity:0`, оставался фокусируемым) — `left/main/LeftMainHeader.tsx`.
- Хоткей Mod+Shift+F (`left/LeftColumn.tsx`).
- **Поиск внутри чата**: иконка, Mod+F, пункт «…»-меню (`middle/HeaderActions.tsx`, `canSearch` × роль).
- Member-search в управлении (`right/management/ManageGroupMembers.tsx`).

**Никнеймы (доп.):**
- `middle/search/MiddleSearchResult.tsx` (`@username` в средней колонке).
- Хэштег/кэштег `#tag@channelusername` в тексте (`common/helpers/renderTextWithEntities.tsx` — чтение сигнала напрямую).
- `common/pickers/PeerPicker.tsx`, `modals/gift/info/GiftInfoModal.tsx`.

**Copy/share (доп.):**
- Copy story link (`story/Story.tsx` `canCopyLink`).
- `common/WebLink.tsx` — «Copy Link» на t.me-ссылках во вкладке «Ссылки» (по `RE_TME_LINK`).
- LOW: `common/ManageUsernames.tsx` (copy), `right/statistics/BoostStatistics.tsx` (boost-ссылка),
  `left/settings/SettingsPrivacyBlockedUsers.tsx` (никнеймы в списке).

**Корректность (вердикт агента):** механизм верный — fail-open ✅, replace-on-push ✅, live ✅,
навигация не сломана ✅. **Флаг платформе:** `blurImages` и `permissions` в одном settings-пуше;
любой пуш **без** блока `permissions` сбросит права в fail-open → платформа **обязана** слать
полный блок `permissions` в каждом settings-сообщении.

### Третья волна — полное ревью (3 read-only агента: форварды/спонсорские, поиск/пикеры, профиль/QR)
Вскрыла **крупную утечку**, пропущенную ранее: плоские `t.me/username`-ссылки (в первой волне
маскировались только `@handle`-упоминания).

**Централизованный фикс:**
- `util/telegramLinks.ts` — `isTelegramUsernameLink` (t.me/&lt;username&gt;, не invite/feature-пути) +
  `maskTelegramUsernameLink` (`t.me/durov/5` → `t.me/…`).
- `common/SafeLink.tsx` — при `!canViewUsernames` t.me/username-ссылка становится **некликабельной,
  без title-хинта**, текст маскируется. Покрывает: `t.me/username` в тексте сообщений и рекламы,
  `StarsTransactionModal` (ссылка на пост), guard-bot в управлении — **одним гейтом**.
- `common/helpers/renderTextWithEntities.tsx` — asPreview-ветка (цитаты/превью минуют
  MentionLink/SafeLink): `@username` → `@…`, t.me-текст маскируется.

**Спонсорские:** `middle/message/SponsoredContextMenu.tsx` — пункт «Sponsor» (free-text
`sponsorInfo`/`additionalInfo` часто с `@username`/t.me) скрыт при `!canViewUsernames`. Тело
рекламы (`SponsoredMessage`) покрыто SafeLink/MentionLink.

**Read-only модалки (закрыты):** `CollectibleInfoModal` (`@…` + copy no-op), `AiTonePreviewModal`
(автор скрыт), `FrozenAccountModal` (bot-username → `@…`, апелляция остаётся рабочей).

**QR-код — проверено, чисто:** профильного QR в форке нет; единственный QR — логин-токен
(`AuthQrCode`), без username.

**Подтверждено чистым (агенты):** «переслано от»/заголовки отправителей (имена, не username),
композер-превью, inline/keyboard-кнопки, action-сообщения, все режимы поиска, share/forward-пикеры,
chat-invite, профиль (ChatExtra гейчен), similar channels, tooltips/aria/title/toast, group-call,
deep-links (chatId, не username).

### Отложено (admin-редакторы username — гейт полей ломает сам инструмент; нужны права админа)
- `right/management/ManageInvites.tsx` (публичная t.me/username в LinkField),
- `right/management/ManageChatPrivacyType.tsx` — публичный username-редактор (`UsernameInput asLink`);
  guard-bot `@username` уже покрыт через SafeLink,
- `left/settings/SettingsEditProfile.tsx` (собственный username менеджера).
