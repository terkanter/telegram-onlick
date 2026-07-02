import { getGlobal } from '../global';

import type { ApiChat, ApiUser, ApiUsername } from '../api/types';
import type { FormContentChat, FormContentUser, FormContentUsername } from './telegramGateway';

import { selectUser } from '../global/selectors';
import { postFormContentToParent } from './telegramGateway';

type SendFormContentParams = {
  image?: string;
  text?: string;
  chat?: ApiChat;
  user?: ApiUser;
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
export function sendFormContent({ image, text, chat, user }: SendFormContentParams) {
  if (!chat) return;

  postFormContentToParent({
    image,
    text,
    chat: buildFormContentChat(chat),
    user: buildFormContentUser(user),
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
