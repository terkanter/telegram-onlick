# Сделано — viewAvatars + deleteMessages

Исходное ТЗ — [`input.md`](./input.md). Продолжение блока 1 из
[`001`](../001-gateway-roles-error-codes-revoked/done.md): блок `permissions` вырос с 3 до 5
полей. Инфраструктура (сигнал/хук + обработка `errorCode`) уже была — добавлено вырезание UI.

## Пламбинг
- [`src/util/telegramGateway.ts`](../../../src/util/telegramGateway.ts) — `GatewayPermissions`
  получил `viewAvatars`, `deleteMessages`.
- [`src/hooks/useGatewayPermissions.ts`](../../../src/hooks/useGatewayPermissions.ts) —
  `canViewAvatars`, `canDeleteMessages`. **Fail-open по умолчанию** (`!== false`): расхождение
  версий или отсутствие поля → функционал виден, скрытие только при явном `false`.

## `viewAvatars` — скрытие аватарок собеседников
Скрываем фото → показывается штатный плейсхолдер с инициалами на цветной плашке. **Свою анкету
не трогаем** (`user.id === currentUserId`), Saved Messages и спец-иконки (deleted/replies/anon) —
тоже.
- [`src/components/common/Avatar.tsx`](../../../src/components/common/Avatar.tsx) — центральный
  компонент: гасим `imageHash`/`videoHash` и `previewUrl` при `shouldHidePhoto`. Покрывает список
  чатов, шапку, сообщения в группах, контакты, поиск, звонки, форварды/реплаи — всё, что рендерит
  аватар через `Avatar`.
- [`src/components/common/profile/ProfilePhoto.tsx`](../../../src/components/common/profile/ProfilePhoto.tsx)
  — большая аватарка в шапке профиля (рендерит фото мимо `Avatar`) — отдельный гейт.

## `deleteMessages` — скрытие пунктов удаления
Сервер сам блокирует 5 команд; форк прячет входы (чтобы не сыпать в журнал попыток).
- [`MessageContextMenu.tsx`](../../../src/components/middle/message/MessageContextMenu.tsx) — пункт
  «Удалить» у сообщения (покрывает и отложенные — то же меню).
- [`MessageSelectToolbar.tsx`](../../../src/components/middle/MessageSelectToolbar.tsx) — bulk-удаление.
- [`useChatContextActions.ts`](../../../src/hooks/useChatContextActions.ts) — «удалить чат» /
  «очистить историю» в контекст-меню чат-листа (обе за одной модалкой).
- [`HeaderMenuContainer.tsx`](../../../src/components/middle/HeaderMenuContainer.tsx) — delete в
  «…»-меню шапки чата.

**Тонкость:** этот пункт для каналов/групп, которые нельзя удалить, — это «покинуть» (leave), а
не одна из 5 delete-команд. Гейт уточнён: прячем только **удаление** (`isUserId` /
`getCanDeleteChat` / savedDialog), **leave оставляем видимым**.

## `TELEGRAM_MESSAGE_DELETION_NOT_ALLOWED` — без правок
Все 5 delete-путей идут через `invokeRequest` без `shouldThrow` → `dispatchErrorUpdate` →
глобальный `'error'`-хендлер из блока 2. Он показывает `message` от сервера при **любом** tagged
`errorCode` (решение «признак errorCode, не хардкод»), поэтому новый код показывает свой текст
автоматически. Сообщение не удаляется (`if (!result) return`), спиннера в delete-флоу нет.
Незнакомый код по-прежнему → общий текст.

## Отложено (admin/self — вне пути «собеседник»)
- `ManageBot/ManageChannel/ManageGroup` — редактирование аватара своей группы/канала (admin-тул;
  гейт ломает сам редактор).
- `SettingsEditProfile`, `UiLoader` — своя анкета / загрузка (self, скрывать не надо).

## Проверка
- eslint + `npm run check:ts` — по изменённым файлам чисто.
- Чек-лист ТЗ: аватарки собеседников скрыты везде, своя цела, плейсхолдер с инициалами; delete/clear/scheduled/bulk скрыты, leave цел; нет блока = всё видно; смена live без реконнекта; `TELEGRAM_MESSAGE_DELETION_NOT_ALLOWED` показывает текст, сообщение цело. ✅
