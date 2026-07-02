import { getGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import type { IconName } from '../../../../types/icons';
import type { LangFn } from '../../../../util/localization';
import { ApiMediaFormat } from '../../../../api/types';

import {
  getDocumentMediaHash,
  getMessageDocument,
  getMessageHtmlId,
  getMessagePhoto,
  getMessageText,
  getPhotoMediaHash,
  getWebPagePhoto,
  getWebPageVideo,
  hasMediaLocalBlobUrl,
} from '../../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../../global/helpers/messageSummary';
import { selectChat, selectUser, selectWebPageFromMessage } from '../../../../global/selectors';
import { IS_SAFARI } from '../../../../util/browser/windowEnvironment';
import getMessageIdsForSelectedText from '../../../../util/getMessageIdsForSelectedText';
import * as mediaLoader from '../../../../util/mediaLoader';
import {
  blobToBase64,
  convertToBlob,
  sendFormContent,
} from '../../../../util/onlik-bridge';

export type ISendOption = {
  label: string;
  icon: IconName;
  short: string;
  handler: (callback?: () => void) => void;
};

export type ISendOptions = ISendOption[];

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
  const canImageBeCopied = canCopy && photo && (mediaHash || hasMediaLocalBlobUrl(photo)) && !IS_SAFARI;
  const selection = window.getSelection();
  const chat = selectChat(global, message.chatId);
  const user = global.currentUserId ? selectUser(global, global.currentUserId) : undefined;
  const canDocumentBeCopied = canCopy && document && (documentMediaHash || hasMediaLocalBlobUrl(document))
    && !IS_SAFARI;

  if ((canDocumentBeCopied || canImageBeCopied) && canCopy && text) {
    // Detect if the user has selection in the current message
    const hasSelection = Boolean((
      selection?.anchorNode?.parentNode
      && (selection.anchorNode.parentNode as HTMLElement).closest('.Message .content-inner')
      && selection.toString().replace(/(?:\r\n|\r|\n)/g, '') !== ''
      && checkMessageHasSelection(message)
    ));

    options.push({
      label: `${getCopyLabel(hasSelection)} и картинку`,
      short: 'ТК',
      icon: 'copy',
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
      label: 'Отправить картинку',
      short: 'К',
      icon: 'copy-media',
      handler: (afterEffectInternal?: () => void) => {
        const hash = documentMediaHash || mediaHash;
        Promise.resolve(hash ? mediaLoader.fetch(hash, ApiMediaFormat.BlobUrl) : photo!.blobUrl)
          .then(convertToBlob)
          .then(blobToBase64)
          .then((image) => sendFormContent({
            image,
            chat,
            user,
          }));

        afterEffect?.();
        afterEffectInternal?.();
      },
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
      label: getCopyLabel(hasSelection),
      short: 'Т',
      icon: 'copy',
      handler: (afterEffectInternal?: () => void) => {
        const messageIds = getMessageIdsForSelectedText();
        if (messageIds?.length && onCopyMessages) {
          // onCopyMessages(messageIds);
        } else if (hasSelection) {
          sendFormContent({
            text: selection?.toString() || '',
            chat,
            user,
          });
        } else {
          sendFormContent({
            text: getMessageTextWithSpoilers(lang, message, undefined)!,
            chat,
            user,
          });
        }

        afterEffect?.();
        afterEffectInternal?.();
      },
    });
  }
  return options;
}
function checkMessageHasSelection(message: ApiMessage): boolean {
  const selection = window.getSelection();
  const selectionParentNode = selection?.anchorNode?.parentNode as HTMLElement;
  const selectedMessageElement = selectionParentNode?.closest<HTMLDivElement>('.Message.message-list-item');
  return getMessageHtmlId(message.id) === selectedMessageElement?.id;
}
function getCopyLabel(hasSelection: boolean): string {
  if (hasSelection) {
    return 'Отправить выделенный текст';
  }
  return 'Отправить текст';
}
