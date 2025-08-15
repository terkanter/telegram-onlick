import type { ApiUser } from '../api/types';

const textCopyEl = document.createElement('textarea');
textCopyEl.setAttribute('readonly', '');
textCopyEl.tabIndex = -1;
textCopyEl.className = 'visually-hidden';

type ISendMessageProps = { user?: ApiUser; image?: any; text?: string; message?: any; chat: any };

export function sendNewPost(message: ISendMessageProps) {
  window.parent?.postMessage(
    {
      type: 'form-content',
      message: {
        ...message,
      },
    },
    '*',
  );
  window.postMessage(
    {
      type: 'form-content-extension',
      message: {
        ...message,
      },
    },
    '*',
  );
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
  if (!imageUrl) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const imageEl = new Image();
  imageEl.onload = (e: Event) => {
    if (ctx && e.currentTarget) {
      const img = e.currentTarget as HTMLImageElement;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, img.width, img.height);
      canvas.toBlob(resolve, 'image/png', 1);
    }
  };

  imageEl.src = imageUrl;
});
