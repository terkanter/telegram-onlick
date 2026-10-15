import type { ApiMessage } from '../../../api/types';
import type { LangFn } from '../../../util/localization';
import type { FormContentBatchItem } from '../../../util/telegramGateway';

import {
  getMessagePhoto,
  getMessageVideo,
  getPhotoMediaHash,
  getVideoMediaHash,
} from '../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../global/helpers/messageSummary';
import { blobToBase64, convertToBlob } from '../../../util/onlik-bridge';
import {
  fetchMediaBlobUrl,
  MAX_VIDEO_SIZE,
  SUPPORTED_VIDEO_MIME_TYPES,
} from '../message/helpers/sendMessageContentOptions';

// One future post: a media message and the text that goes with it, or the text alone
export type SelectionPost = {
  mediaMessage?: ApiMessage;
  text?: string;
};

// Splits the selected messages into posts, in chat order. A media message takes its own
// caption; an album counts as its first photo or video with the album's caption. A text-only
// message joins the neighbouring media that has no text yet — the one right before it, else the
// one right after it — and otherwise becomes a text-only post.
export function buildSelectionPosts(lang: LangFn, messages: ApiMessage[]): SelectionPost[] {
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  const posts: SelectionPost[] = [];
  const albumPosts = new Map<string, SelectionPost>();

  sorted.forEach((message) => {
    const text = getMessageText(lang, message);
    const hasMedia = checkHasPostMedia(message);

    if (message.groupedId) {
      const albumPost = albumPosts.get(message.groupedId);
      if (albumPost) {
        albumPost.mediaMessage ??= hasMedia ? message : undefined;
        albumPost.text ??= text;
        return;
      }
    }

    const previous = posts[posts.length - 1];
    if (!hasMedia) {
      if (!text) return;
      if (previous?.mediaMessage && !previous.text) {
        previous.text = text;
        return;
      }
      posts.push({ text });
      return;
    }

    if (!text && previous && !previous.mediaMessage) {
      // The text right before this media is its caption
      previous.mediaMessage = message;
    } else {
      posts.push({ mediaMessage: message, text });
    }
    if (message.groupedId) albumPosts.set(message.groupedId, posts[posts.length - 1]);
  });

  return posts;
}

// Downloads the post's media into the shape the platform accepts. Rejects when the media cannot
// be loaded or the platform would refuse it.
export async function loadSelectionPost(post: SelectionPost): Promise<FormContentBatchItem> {
  const message = post.mediaMessage;
  if (!message) return { text: post.text };

  const video = getMessageVideo(message);
  if (video && !video.isRound) {
    if (!SUPPORTED_VIDEO_MIME_TYPES.has(video.mimeType) || video.size > MAX_VIDEO_SIZE) {
      throw new Error('video not accepted by the platform');
    }
    const blobUrl = video.blobUrl ?? await fetchMediaBlobUrl(getVideoMediaHash(video, 'download')!, message);
    if (!blobUrl) throw new Error('video download failed');
    const blob = await (await fetch(blobUrl)).blob();
    return { video: { blob, name: video.fileName }, text: post.text };
  }

  const photo = getMessagePhoto(message)!;
  const blobUrl = await fetchMediaBlobUrl(getPhotoMediaHash(photo, 'inline')!, message);
  const image = await blobToBase64(await convertToBlob(blobUrl));
  return { image, text: post.text };
}

function checkHasPostMedia(message: ApiMessage) {
  const video = getMessageVideo(message);
  return Boolean(getMessagePhoto(message) || (video && !video.isRound));
}

function getMessageText(lang: LangFn, message: ApiMessage) {
  return getMessageTextWithSpoilers(lang, message, undefined)?.trim() || undefined;
}
