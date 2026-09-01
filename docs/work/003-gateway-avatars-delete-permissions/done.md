# Сделано — viewAvatars (сокрытие удаления откатано)

Исходное ТЗ — [`input.md`](./input.md). Продолжение блока 1 из
[`001`](../001-gateway-roles-error-codes-revoked/done.md): блок `permissions` вырос с 3 до 4
полей (`viewAvatars`). Инфраструктура (сигнал/хук + обработка `errorCode`) уже была — добавлено
вырезание UI аватарок.

> **Изменение плана:** запрет удаления убран с фронта целиком. Удаление теперь **полностью на
> бэке** — фронт ведёт себя как обычный Telegram (кнопки удаления на месте, попытка удалить летит
> на сервер, гвард ловит её там). Соответственно откатаны все правки `deleteMessages` и убрано
> поле `deleteMessages` из `GatewayPermissions`/`useGatewayPermissions`. Ниже — только `viewAvatars`.

## Пламбинг
- [`src/util/telegramGateway.ts`](../../../src/util/telegramGateway.ts) — `GatewayPermissions`
  получил `viewAvatars`.
- [`src/hooks/useGatewayPermissions.ts`](../../../src/hooks/useGatewayPermissions.ts) —
  `canViewAvatars`. **Fail-open по умолчанию** (`!== false`): расхождение версий или отсутствие
  поля → функционал виден, скрытие только при явном `false`.

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

## Удаление — на бэке
Никаких вырезаний в UI: меню сообщения, bulk-тулбар, «удалить чат»/«очистить историю» и delete в
шапке чата работают штатно. Попытка удаления уходит на сервер; блокировка и её последствия —
ответственность бэка. Если сервер вернёт tagged `errorCode`, диалог из блока 2 покажет его текст
(общий механизм, не специфичный для удаления).

## Отложено (admin/self — вне пути «собеседник»)
- `ManageBot/ManageChannel/ManageGroup` — редактирование аватара своей группы/канала (admin-тул;
  гейт ломает сам редактор).
- `SettingsEditProfile`, `UiLoader` — своя анкета / загрузка (self, скрывать не надо).

## Проверка
- eslint + `npm run check:ts` — по изменённым файлам чисто.
- Чек-лист: аватарки собеседников скрыты везде, своя цела, плейсхолдер с инициалами; нет блока =
  всё видно; смена live без реконнекта; удаление — обычное, как в оригинале. ✅
