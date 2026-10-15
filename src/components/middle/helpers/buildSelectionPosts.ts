import type { ApiMessage } from '../../../api/types';
import type { LangFn } from '../../../util/localization';
import type { FormContentBatchItem } from '../../../util/telegramGateway';

import {
  getDocumentMediaHash,
  getMessagePhoto,
  getPhotoMediaHash,
} from '../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../global/helpers/messageSummary';
import { blobToBase64, convertToBlob } from '../../../util/onlik-bridge';
import {
  fetchMediaBlobUrl,
  getMessageFileImage,
  getMessagePostVideo,
  loadPostVideoBlob,
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

  const video = getMessagePostVideo(message);
  if (video) {
    const blob = await loadPostVideoBlob(video, message);
    return { video: { blob, name: video.fileName }, text: post.text };
  }

  // A photo, or an image sent as a file. Media still held locally (just sent) has no remote hash
  // and is read from its local blob, the way the single send buttons do
  const fileImage = getMessageFileImage(message);
  const photo = getMessagePhoto(message);
  const hash = fileImage ? getDocumentMediaHash(fileImage, 'full') : getPhotoMediaHash(photo!, 'inline');
  const blobUrl = hash ? await fetchMediaBlobUrl(hash, message) : photo?.blobUrl;
  const image = await blobToBase64(await convertToBlob(blobUrl));
  return { image, text: post.text };
}

function checkHasPostMedia(message: ApiMessage) {
  return Boolean(getMessagePhoto(message) || getMessageFileImage(message) || getMessagePostVideo(message));
}

function getMessageText(lang: LangFn, message: ApiMessage) {
  return getMessageTextWithSpoilers(lang, message, undefined)?.trim() || undefined;
}
