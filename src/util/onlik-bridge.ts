import { getGlobal } from '../global';

import type {
  ApiChat, ApiPeer, ApiUser, ApiUsername,
} from '../api/types';
import type {
  FormContentChat, FormContentSender, FormContentUser, FormContentUsername, FormContentVideo,
} from './telegramGateway';

import { getPeerTitle, isApiPeerUser } from '../global/helpers/peers';
import { selectUser } from '../global/selectors';
import { getTranslationFn } from './localization';
import { postFormContentToParent } from './telegramGateway';

type SendFormContentParams = {
  image?: string;
  video?: FormContentVideo;
  text?: string;
  chat?: ApiChat;
  user?: ApiUser;
  sender?: ApiPeer;
  isSenderSelf?: boolean;
};

const CHAT_TYPE_MAP: Record<ApiChat['type'], FormContentChat['type']> = {
  chatTypePrivate: 'private',
  chatTypeSecret: 'private',
  chatTypeBasicGroup: 'group',
  chatTypeSuperGroup: 'group',
  chatTypeChannel: 'channel',
};

// Forwards content selected in a chat (photo and/or text) to the platform's post form.
// The platform joins partial signals and opens the form, so we send whatever is selected.
export function sendFormContent({
  image, video, text, chat, user, sender, isSenderSelf,
}: SendFormContentParams) {
  if (!chat) return;

  postFormContentToParent({
    image,
    video,
    text,
    chat: buildFormContentChat(chat),
    user: buildFormContentUser(user),
    sender: sender ? buildFormContentSender(sender, Boolean(isSenderSelf)) : undefined,
  });
}

function buildFormContentChat(chat: ApiChat): FormContentChat {
  const type = CHAT_TYPE_MAP[chat.type];
  // For a private chat the interlocutor's user id equals the chat id, and their usernames
  // live on the user rather than the chat.
  const usernames = type === 'private'
    ? toFormContentUsernames(selectUser(getGlobal(), chat.id)?.usernames)
    : toFormContentUsernames(chat.usernames);

  return {
    type,
    id: chat.id,
    title: chat.title,
    usernames,
  };
}

function buildFormContentUser(user?: ApiUser): FormContentUser | undefined {
  if (!user) return undefined;

  return { usernames: toFormContentUsernames(user.usernames) };
}

// `selectSender` resolves a channel author to the channel peer itself (broadcast posts have
// no public author), so a non-user peer is reported as `kind: 'channel'`.
function buildFormContentSender(sender: ApiPeer, isSelf: boolean): FormContentSender {
  return {
    kind: isApiPeerUser(sender) ? 'user' : 'channel',
    id: sender.id,
    title: getPeerTitle(getTranslationFn(), sender),
    usernames: toFormContentUsernames(sender.usernames),
    isSelf: isSelf || undefined,
  };
}

function toFormContentUsernames(usernames?: ApiUsername[]): FormContentUsername[] | undefined {
  return usernames?.map(({ username, isActive }) => ({ username, isActive }));
}

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    // @ts-ignore
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

export const convertToBlob = (imageUrl?: string): Promise<Blob> => new Promise((resolve, reject) => {
  if (!imageUrl) {
    reject(new Error('No image URL'));
    return;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const imageEl = new Image();
  imageEl.onload = (e: Event) => {
    if (ctx && e.currentTarget) {
      const img = e.currentTarget as HTMLImageElement;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, img.width, img.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas is empty'))), 'image/png', 1);
    }
  };

  imageEl.src = imageUrl;
});
