import { getActions, getGlobal } from '../../../../global';

import type {
  ApiChat, ApiDocument, ApiMessage, ApiOnProgress, ApiPeer, ApiUser, ApiVideo,
} from '../../../../api/types';
import type { IconName } from '../../../../types/icons';
import type { ClipboardTextFormat, MessageCopyRequest } from '../../../../types/messageCopy';
import type { LangFn } from '../../../../util/localization';
import { ApiMediaFormat } from '../../../../api/types';

import {
  getDocumentMediaHash,
  getMessageDocument,
  getMessageHtmlId,
  getMessagePhoto,
  getMessageText,
  getMessageVideo,
  getPhotoMediaHash,
  getVideoMediaHash,
  getWebPagePhoto,
  getWebPageVideo,
  hasMediaLocalBlobUrl,
  isDocumentPhoto,
  isDocumentVideo,
} from '../../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../../global/helpers/messageSummary';
import {
  selectChat, selectSender, selectUser, selectWebPageFromMessage,
} from '../../../../global/selectors';
import getMessageIdsForSelectedText from '../../../../util/getMessageIdsForSelectedText';
import * as mediaLoader from '../../../../util/mediaLoader';
import {
  blobToBase64,
  convertToBlob,
  sendFormContent,
} from '../../../../util/onlik-bridge';

export type ISendOption = {
  // Localized, doubles as the button's `aria-label`; the inline buttons render `icon`, the
  // context menu shows this text.
  label: string;
  icon: IconName;
  // `requestId` identifies the signal handed to the platform, see `subscribeToFormContentResult`
  handler: (callback?: (isSuccess?: boolean, requestId?: string) => void, onProgress?: SendProgressCallback) => void;
};

type SendProgressCallback = (progress: number) => void;

export type ISendOptions = ISendOption[];

// Platform acceptance limits (see `telegram-fork-video.md`) — checked before sending so the
// manager gets a clear refusal instead of the platform silently dropping the signal.
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const SUPPORTED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const VIDEO_UNSUPPORTED_ERROR = 'video format not accepted by the platform';
const VIDEO_TOO_LARGE_ERROR = 'video larger than the platform accepts';
// The platform takes these images as they are (`POST /file/upload/single`), up to 25 MiB
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_SIZE = 25 * 1024 * 1024;
const IMAGE_UNSUPPORTED_ERROR = 'image format not accepted by the platform';
const IMAGE_TOO_LARGE_ERROR = 'image larger than the platform accepts';

export function getMessageSendToParentWindowOptions(
  lang: LangFn,
  message: ApiMessage,
  canCopy?: boolean,
  afterEffect?: () => void,
  onCopyMessages?: (request: MessageCopyRequest, textFormat?: ClipboardTextFormat) => void,
): ISendOptions {
  const options: ISendOptions = [];
  const global = getGlobal();
  const text = getMessageText(message);
  const webPage = selectWebPageFromMessage(global, message);
  const photo = getMessagePhoto(message)
    || (!getWebPageVideo(webPage) ? getWebPagePhoto(webPage) : undefined);
  // A photo sent as a file arrives as a document; a clip sent as a file goes the video way below
  const document = getMessageFileImage(message);
  const mediaHash = photo ? getPhotoMediaHash(photo, 'inline') : undefined;
  const documentMediaHash = document ? getDocumentMediaHash(document, 'full') : undefined;
  // Unlike clipboard copy (`copyOptions.ts`), this path serializes the image via
  // `canvas → base64 → postMessage`, which works on Safari — so no `IS_SAFARI` gate here,
  // otherwise the К/ТК buttons never appear on iOS (every iOS browser reports as Safari).
  const canImageBeCopied = canCopy && photo && (mediaHash || hasMediaLocalBlobUrl(photo));
  const selection = window.getSelection();
  const chat = selectChat(global, message.chatId);
  const user = global.currentUserId ? selectUser(global, global.currentUserId) : undefined;
  // The account owner is `user`; `sender` is who authored the picked message (the counterpart,
  // a group member, or the channel itself) — the platform reads them into separate fields.
  const sender = selectSender(global, message);
  const canDocumentBeCopied = canCopy && document && (documentMediaHash || hasMediaLocalBlobUrl(document));

  if ((canDocumentBeCopied || canImageBeCopied) && canCopy && text) {
    // Detect if the user has selection in the current message
    const hasSelection = Boolean((
      selection?.anchorNode?.parentNode
      && (selection.anchorNode.parentNode as HTMLElement).closest('.Message .content-inner')
      && selection.toString().replace(/(?:\r\n|\r|\n)/g, '') !== ''
      && checkMessageHasSelection(message)
    ));

    options.push({
      label: lang('OnlikSendTextAndImage'),
      icon: 'media',
      handler: (afterEffectInternal, onProgress) => {
        // @ts-ignore
        function getText() {
          if (checkHasMultiMessageSelection() && onCopyMessages) {
            return undefined;
          } else if (hasSelection) {
            // @ts-ignore
            return selection.toString();
          } else {
            return getMessageTextWithSpoilers(lang, message, undefined);
          }
        }
        const ntext = getText();
        const hash = documentMediaHash || mediaHash;
        Promise.resolve(hash ? fetchMediaBlobUrl(hash, message, onProgress) : photo!.blobUrl)
          .then(loadPlatformImage)
          .then((image) => sendFormContent({
            image,
            text: ntext,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          }))
          .then((requestId) => {
            afterEffect?.();
            afterEffectInternal?.(true, requestId);
          })
          .catch((err: Error) => {
            getActions().showNotification({ message: lang(getImageErrorKey(err)) });
            afterEffectInternal?.(false);
          });
      },
    });

    return options;
  }

  if (canImageBeCopied || canDocumentBeCopied) {
    options.push({
      label: lang('OnlikSendImage'),
      icon: 'media',
      handler: (afterEffectInternal, onProgress) => {
        const hash = documentMediaHash || mediaHash;
        Promise.resolve(hash ? fetchMediaBlobUrl(hash, message, onProgress) : photo!.blobUrl)
          .then(loadPlatformImage)
          .then((image) => sendFormContent({
            image,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          }))
          .then((requestId) => {
            afterEffect?.();
            afterEffectInternal?.(true, requestId);
          })
          .catch((err: Error) => {
            getActions().showNotification({ message: lang(getImageErrorKey(err)) });
            afterEffectInternal?.(false);
          });
      },
    });
  }

  // Video travels as a `Blob` (never a data-URL — a 100MB clip is a ~133MB string). Mirrors the
  // image buttons: with a caption → combined ТВ (replaces the rest), otherwise video-only В.
  const video = getMessagePostVideo(message);
  const canVideoBeSent = Boolean(canCopy && video);

  if (canVideoBeSent && text) {
    options.push({
      label: lang('OnlikSendTextAndVideo'),
      icon: 'video',
      handler: createVideoSendHandler(
        lang, video!, getMessageTextWithSpoilers(lang, message, undefined), message, chat, user, sender, afterEffect,
      ),
    });

    return options;
  }

  if (canVideoBeSent) {
    options.push({
      label: lang('OnlikSendVideo'),
      icon: 'video',
      handler: createVideoSendHandler(lang, video!, undefined, message, chat, user, sender, afterEffect),
    });
  }

  if (canCopy && text) {
    // Detect if the user has selection in the current message
    const hasSelection = Boolean((
      selection?.anchorNode?.parentNode
      && (selection.anchorNode.parentNode as HTMLElement).closest('.Message .content-inner')
      && selection.toString().replace(/(?:\r\n|\r|\n)/g, '') !== ''
      && checkMessageHasSelection(message)
    ));

    options.push({
      label: getCopyLabel(lang, hasSelection),
      icon: 'article',
      handler: (afterEffectInternal) => {
        let requestId: string | undefined;
        if (checkHasMultiMessageSelection() && onCopyMessages) {
          // Spanning several messages is the copy flow's job, not the posting form's
        } else if (hasSelection) {
          requestId = sendFormContent({
            text: selection?.toString() || '',
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          });
        } else {
          requestId = sendFormContent({
            text: getMessageTextWithSpoilers(lang, message, undefined)!,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          });
        }

        afterEffect?.();
        afterEffectInternal?.(true, requestId);
      },
    });
  }
  return options;
}
// An image sent as a file. Stickers arrive as `content.sticker`, so a WebP document is a picture
export function getMessageFileImage(message: ApiMessage) {
  const document = getMessageDocument(message);
  if (!document) return undefined;

  return isDocumentPhoto(document) || document.mimeType.startsWith('image/') ? document : undefined;
}

// The clip a post would carry: an inline video (not a round one) or a video sent as a file
export function getMessagePostVideo(message: ApiMessage): ApiVideo | ApiDocument | undefined {
  const video = getMessageVideo(message);
  if (video) return video.isRound ? undefined : video;

  const document = getMessageDocument(message);
  return document && (isDocumentVideo(document) || document.mimeType.startsWith('video/')) ? document : undefined;
}

// Downloads a post video's bytes, refusing what the platform would not accept
export async function loadPostVideoBlob(
  video: ApiVideo | ApiDocument, message: ApiMessage, onProgress?: SendProgressCallback,
) {
  if (!SUPPORTED_VIDEO_MIME_TYPES.has(video.mimeType)) throw new Error(VIDEO_UNSUPPORTED_ERROR);
  if (video.size > MAX_VIDEO_SIZE) throw new Error(VIDEO_TOO_LARGE_ERROR);

  // Reuse the already-loaded blob if the video was played
  const loadedBlobUrl = 'blobUrl' in video ? video.blobUrl : undefined;
  const blobUrl = loadedBlobUrl ?? await fetchMediaBlobUrl(getVideoMediaHash(video, 'download')!, message, onProgress);
  if (!blobUrl) throw new Error('video download failed');

  return (await fetch(blobUrl)).blob();
}

// Validates the clip against the platform limits, downloads its bytes, then sends one signal.
// `afterEffectInternal(false)` on any failure keeps the button from flashing success.
function createVideoSendHandler(
  lang: LangFn,
  video: ApiVideo | ApiDocument,
  text: string | undefined,
  message: ApiMessage,
  chat?: ApiChat,
  user?: ApiUser,
  sender?: ApiPeer,
  afterEffect?: () => void,
): ISendOption['handler'] {
  return (afterEffectInternal, onProgress) => {
    const { showNotification } = getActions();

    // The full clip must be downloaded before the signal is sent. The button shows a loading
    // state meanwhile.
    loadPostVideoBlob(video, message, onProgress)
      .then((blob) => sendFormContent({
        video: { blob, name: video.fileName },
        text,
        chat,
        user,
        sender,
        isSenderSelf: message.isOutgoing,
      }))
      .then((requestId) => {
        afterEffect?.();
        afterEffectInternal?.(true, requestId);
      })
      .catch((err: Error) => {
        showNotification({ message: lang(getVideoErrorKey(err)) });
        afterEffectInternal?.(false);
      });
  };
}

// The image as the platform takes it: the file itself when its type is accepted — redrawing a JPEG
// into a PNG only made it several times larger, past the upload limit — else drawn into a PNG.
// Rejects with a reason `getImageErrorKey` names.
export async function loadPlatformImage(imageUrl?: string): Promise<string> {
  if (!imageUrl) throw new Error('No image URL');
  const file = await (await fetch(imageUrl)).blob();
  let image = file;
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(file.type)) {
    // HEIC does not draw in Chrome or Firefox
    image = await convertToBlob(imageUrl).catch(() => {
      throw new Error(IMAGE_UNSUPPORTED_ERROR);
    });
  }
  if (image.size > MAX_IMAGE_SIZE) throw new Error(IMAGE_TOO_LARGE_ERROR);
  return blobToBase64(image);
}

export function getImageErrorKey(err: Error) {
  if (err.message === IMAGE_UNSUPPORTED_ERROR) return 'OnlikImageUnsupportedFormat';
  if (err.message === IMAGE_TOO_LARGE_ERROR) return 'OnlikImageTooLarge';
  return 'OnlikImageDownloadFailed';
}

export function getVideoErrorKey(err: Error) {
  if (err.message === VIDEO_UNSUPPORTED_ERROR) return 'OnlikVideoUnsupportedFormat';
  if (err.message === VIDEO_TOO_LARGE_ERROR) return 'OnlikVideoTooLarge';
  return 'OnlikVideoDownloadFailed';
}

export function fetchMediaBlobUrl(hash: string, message: ApiMessage, onProgress?: SendProgressCallback) {
  const handleProgress: ApiOnProgress | undefined = onProgress && ((progress) => onProgress(progress));

  return mediaLoader.fetch(hash, ApiMediaFormat.BlobUrl, false, handleProgress, getMessageHtmlId(message.id));
}

// True when the selection spans message boundaries — evaluated on click, since the user may
// change the selection after the options were built
function checkHasMultiMessageSelection(): boolean {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return false;

  return Boolean(getMessageIdsForSelectedText(selection.getRangeAt(0))?.length);
}

function checkMessageHasSelection(message: ApiMessage): boolean {
  const selection = window.getSelection();
  const selectionParentNode = selection?.anchorNode?.parentNode as HTMLElement;
  const selectedMessageElement = selectionParentNode?.closest<HTMLDivElement>('.Message.message-list-item');
  return getMessageHtmlId(message.id) === selectedMessageElement?.id;
}
function getCopyLabel(lang: LangFn, hasSelection: boolean): string {
  return hasSelection ? lang('OnlikSendSelectedText') : lang('OnlikSendText');
}
