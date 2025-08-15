import { getGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import type { IconName } from '../../../../types/icons';
import { ApiMediaFormat } from '../../../../api/types';

import {
  getDocumentMediaHash,
  getMessageDocument,
  getMessageHtmlId,
  getMessagePhoto,
  getMessageText,
  getMessageWebPagePhoto,
  getMessageWebPageVideo,
  getPhotoMediaHash,
  hasMediaLocalBlobUrl,
} from '../../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../../global/helpers/messageSummary';
import { selectChat, selectUser } from '../../../../global/selectors';
import getMessageIdsForSelectedText from '../../../../util/getMessageIdsForSelectedText';
import * as mediaLoader from '../../../../util/mediaLoader';
import {
  blobToBase64,
  convertToBlob,
  sendNewPost,
} from '../../../../util/onlik-bridge';
import { IS_SAFARI } from '../../../../util/browser/windowEnvironment';

export type ISendOption = {
  label: string;
  icon: IconName;
  short: string;
  handler: (callback?: () => void) => void;
};

export type ISendOptions = ISendOption[];

export function getMessageSendToParentWindowOptions(
  message: ApiMessage,
  canCopy?: boolean,
  afterEffect?: () => void,
  onCopyMessages?: (messageIds: number[]) => void,
): ISendOptions {
  const options: ISendOptions = [];
  const text = getMessageText(message);
  const photo = getMessagePhoto(message)
    || (!getMessageWebPageVideo(message) ? getMessageWebPagePhoto(message) : undefined);
  const document = getMessageDocument(message);
  const mediaHash = photo ? getPhotoMediaHash(photo, 'inline') : undefined;
  const documentMediaHash = document ? getDocumentMediaHash(document, 'full') : undefined;
  const canImageBeCopied = canCopy && photo && (mediaHash || hasMediaLocalBlobUrl(photo)) && !IS_SAFARI;
  const selection = window.getSelection();
  const global = getGlobal();
  const chat = selectChat(global, message.chatId);
  const user = global.currentUserId ? selectUser(getGlobal(), global.currentUserId) : undefined;
  // eslint-disable-next-line max-len
  const canDocumentBeCopied = canCopy && document && (documentMediaHash || hasMediaLocalBlobUrl(document)) && !IS_SAFARI;

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
            return getMessageTextWithSpoilers(message);
          }
        }
        const ntext = getText();
        const hash = documentMediaHash || mediaHash;
        Promise.resolve(hash ? mediaLoader.fetch(hash, ApiMediaFormat.BlobUrl) : photo!.blobUrl)
          .then(convertToBlob)
          .then(blobToBase64)
          .then((image) => sendNewPost({
            image,
            text: ntext,
            message,
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
          .then((image) => sendNewPost({
            image,
            message,
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
          sendNewPost({
            // @ts-ignore
            text: selection.toString()!,
            message,
            chat,
            user,
          });
        } else {
          sendNewPost({
            text: getMessageTextWithSpoilers(message)!,
            message,
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
  const selectionParentNode = (selection?.anchorNode?.parentNode as HTMLElement);
  const selectedMessageElement = selectionParentNode?.closest<HTMLDivElement>('.Message.message-list-item');
  return getMessageHtmlId(message.id) === selectedMessageElement?.id;
}
function getCopyLabel(hasSelection: boolean): string {
  if (hasSelection) {
    return 'Отправить выделенный текст';
  }
  return 'Отправить текст';
}
