# Сделано — «Blur images» для видео и файлов-картинок

Расширение платформенного тумблера **Blur images** (введён в `70f75c095`, покрывал только
`Photo.tsx`). Оператор заметил, что не блюрятся **превью видео** и **превью картинок,
отправленных файлом**. Инфраструктура (`settings`-postMessage → `getBlurImagesGeneration`
сигнал → `useGatewayMediaBlur`) уже была — добавлены недостающие точки покрытия.

## Точки покрытия
- [`Video.tsx`](../../../src/components/middle/message/Video.tsx) — превью видео и GIF в сообщениях.
  Добавлен проп `isInSelectMode` (прокидывается `withSelectControl` в альбомах, чтобы в режиме
  выбора клики уходили на выделение сообщения — как у `Photo`).
- [`File.tsx`](../../../src/components/common/File.tsx) — миниатюра картинки/видео, отправленных
  файлом (`CompactMediaPreview`). Блюрим **только принятое** медиа (`previewMedia`); собственное
  вложение оператора в композере (`previewAttachment`) не трогаем.

Через эти два места автоматически покрываются и производные: альбомы (`withSelectControl` →
`Video`), превью ссылок ([`WebPage.tsx`](../../../src/components/middle/message/WebPage.tsx) → `Video`/
`Document`), вкладка «Файлы» в общих медиа и поиск (`Document` → `File`).

## `MediaBlurCover`
- [`MediaBlurCover.tsx`](../../../src/components/gateway/MediaBlurCover.tsx) /
  [`.module.scss`](../../../src/components/gateway/MediaBlurCover.module.scss) — добавлен вариант
  `isCompact`: миниатюра файла всего 3–4.5rem, поэтому штатная кнопка-глаз 2rem не влезает —
  в компактном варианте она центрируется и уменьшается до 1.75rem, а оверлей наследует
  скругление `--border-radius-messages-small` под миниатюру.

## Поведение (как у существующего блюра)
- Оверлей глушит клики → закрытое медиа нельзя открыть; открывает только «глаз».
- Раскрытие локально для одного медиа; повторное включение тумблера (новая generation) снова
  прячет всё.
- Аватарки этим тумблером не затрагиваются (для них отдельный `viewAvatars`, см.
  [`003`](../003-gateway-avatars-delete-permissions/done.md)).

## Не в объёме
- Кружки-видеосообщения ([`RoundVideo.tsx`](../../../src/components/middle/message/RoundVideo.tsx)) —
  оператор просил «превью видео» и «превью файлов»; круглые видеозаметки — отдельная поверхность,
  оставлена как есть (можно добавить по запросу).

## Проверка
- `tsc --noEmit`, eslint, stylelint — по изменённым файлам чисто (у `.root` остаётся штатный
  baseline-warning на `backdrop-filter`, как и в исходной версии).
