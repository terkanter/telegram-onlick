import { getActions, getGlobal } from '../../../../global';

import type {
  ApiChat, ApiMessage, ApiPeer, ApiUser, ApiVideo,
} from '../../../../api/types';
import type { IconName } from '../../../../types/icons';
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
  handler: (callback?: (isSuccess?: boolean) => void) => void;
};

export type ISendOptions = ISendOption[];

// Platform acceptance limits (see `telegram-fork-video.md`) — checked before sending so the
// manager gets a clear refusal instead of the platform silently dropping the signal.
const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const SUPPORTED_VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function getMessageSendToParentWindowOptions(
  lang: LangFn,
  message: ApiMessage,
  canCopy?: boolean,
  afterEffect?: () => void,
  onCopyMessages?: (messageIds: number[]) => void,
): ISendOptions {
  const options: ISendOptions = [];
  const global = getGlobal();
  const text = getMessageText(message);
  const webPage = selectWebPageFromMessage(global, message);
  const photo = getMessagePhoto(message)
    || (!getWebPageVideo(webPage) ? getWebPagePhoto(webPage) : undefined);
  const document = getMessageDocument(message);
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
      icon: 'photo',
      handler: (afterEffectInternal?: () => void) => {
        // @ts-ignore
        function getText() {
          const messageIds = getMessageIdsForSelectedText();
          if (messageIds?.length && onCopyMessages) {
            // onCopyMessages(messageIds);
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
        Promise.resolve(hash ? mediaLoader.fetch(hash, ApiMediaFormat.BlobUrl) : photo!.blobUrl)
          .then(convertToBlob)
          .then(blobToBase64)
          .then((image) => sendFormContent({
            image,
            text: ntext,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          }))
          .then(() => {
            afterEffect?.();
            afterEffectInternal?.();
          });
      },
    });

    return options;
  }

  if (canImageBeCopied || canDocumentBeCopied) {
    options.push({
      label: lang('OnlikSendImage'),
      icon: 'photo',
      handler: (afterEffectInternal?: () => void) => {
        const hash = documentMediaHash || mediaHash;
        Promise.resolve(hash ? mediaLoader.fetch(hash, ApiMediaFormat.BlobUrl) : photo!.blobUrl)
          .then(convertToBlob)
          .then(blobToBase64)
          .then((image) => sendFormContent({
            image,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          }));

        afterEffect?.();
        afterEffectInternal?.();
      },
    });
  }

  // Video travels as a `Blob` (never a data-URL — a 100MB clip is a ~133MB string). Mirrors the
  // image buttons: with a caption → combined ТВ (replaces the rest), otherwise video-only В.
  const video = getMessageVideo(message);
  const canVideoBeSent = Boolean(canCopy && video && !video.isRound);

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
      icon: 'quote-text',
      handler: (afterEffectInternal?: () => void) => {
        const messageIds = getMessageIdsForSelectedText();
        if (messageIds?.length && onCopyMessages) {
          // onCopyMessages(messageIds);
        } else if (hasSelection) {
          sendFormContent({
            text: selection?.toString() || '',
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          });
        } else {
          sendFormContent({
            text: getMessageTextWithSpoilers(lang, message, undefined)!,
            chat,
            user,
            sender,
            isSenderSelf: message.isOutgoing,
          });
        }

        afterEffect?.();
        afterEffectInternal?.();
      },
    });
  }
  return options;
}
// Validates the clip against the platform limits, downloads its bytes, then sends one signal.
// `afterEffectInternal(false)` on any failure keeps the button from flashing success.
function createVideoSendHandler(
  lang: LangFn,
  video: ApiVideo,
  text: string | undefined,
  message: ApiMessage,
  chat?: ApiChat,
  user?: ApiUser,
  sender?: ApiPeer,
  afterEffect?: () => void,
): ISendOption['handler'] {
  return (afterEffectInternal) => {
    const { showNotification } = getActions();

    if (!SUPPORTED_VIDEO_MIME_TYPES.has(video.mimeType)) {
      showNotification({ message: lang('OnlikVideoUnsupportedFormat') });
      afterEffectInternal?.(false);
      return;
    }
    if (video.size > MAX_VIDEO_SIZE) {
      showNotification({ message: lang('OnlikVideoTooLarge') });
      afterEffectInternal?.(false);
      return;
    }

    // The full clip must be downloaded before the signal is sent (reuse the already-loaded
    // blob if the video was played). The button shows a loading state meanwhile.
    const blobUrlPromise: Promise<string | undefined> = video.blobUrl
      ? Promise.resolve(video.blobUrl)
      : mediaLoader.fetch(getVideoMediaHash(video, 'download')!, ApiMediaFormat.BlobUrl);

    blobUrlPromise
      .then((blobUrl) => {
        if (!blobUrl) throw new Error('video download failed');
        return fetch(blobUrl).then((response) => response.blob());
      })
      .then((blob) => sendFormContent({
        video: { blob, name: video.fileName },
        text,
        chat,
        user,
        sender,
        isSenderSelf: message.isOutgoing,
      }))
      .then(() => {
        afterEffect?.();
        afterEffectInternal?.(true);
      })
      .catch(() => {
        showNotification({ message: lang('OnlikVideoDownloadFailed') });
        afterEffectInternal?.(false);
      });
  };
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
