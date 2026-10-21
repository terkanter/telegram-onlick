import type { ApiMessage } from '../../../api/types';
import type { LangFn } from '../../../util/localization';
import type { FormContentBatchItem } from '../../../util/telegramGateway';

import {
  getDocumentMediaHash,
  getMessagePhoto,
  getPhotoMediaHash,
} from '../../../global/helpers';
import { getMessageTextWithSpoilers } from '../../../global/helpers/messageSummary';
import {
  fetchMediaBlobUrl,
  getMessageFileImage,
  getMessagePostVideo,
  loadPlatformImage,
  loadPostVideoBlob,
} from '../message/helpers/sendMessageContentOptions';

// One future post: a media message and the text that goes with it, or the text alone. A
// `resetTime` one is no post: the platform starts the schedule over from the next post
export type SelectionPost = {
  mediaMessage?: ApiMessage;
  text?: string;
  resetTime?: true;
  // Every selected message the post was built from — they all show how it went
  messageIds: number[];
};

// Text that is the "Reset time" command and nothing else: case, spaces, emoji, punctuation and
// styled letters (𝐑𝐞𝐬𝐞𝐭 𝐓𝐢𝐦𝐞 — NFKC folds them to plain ones) do not matter. Only the whole
// text counts, so a caption that merely mentions the words is still a post
export function checkIsResetTimeText(text?: string) {
  return text?.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === 'resettime';
}

// Splits the selected messages into posts, in chat order. A media message takes its own
// caption; an album counts as its first photo or video with the album's caption. A text-only
// message joins the neighbouring media that has no text yet — the one right before it, else the
// one right after it — and otherwise becomes a text-only post. A message whose text is the
// "Reset time" command — with its media, if any, and its whole album — is a reset marker instead
export function buildSelectionPosts(lang: LangFn, messages: ApiMessage[]): SelectionPost[] {
  const sorted = [...messages].sort((a, b) => a.id - b.id);
  const posts: SelectionPost[] = [];
  const albumPosts = new Map<string, SelectionPost>();

  sorted.forEach((message) => {
    const text = getMessageText(lang, message);
    const hasMedia = checkHasPostMedia(message);

    if (checkIsResetTimeText(text)) {
      const albumPost = message.groupedId ? albumPosts.get(message.groupedId) : undefined;
      if (albumPost) {
        // The album's command arrived after its first items: the album is the marker
        albumPost.messageIds.push(message.id);
        albumPost.mediaMessage = undefined;
        albumPost.text = undefined;
        albumPost.resetTime = true;
        return;
      }
      const marker: SelectionPost = { resetTime: true, messageIds: [message.id] };
      posts.push(marker);
      if (message.groupedId) albumPosts.set(message.groupedId, marker);
      return;
    }

    if (message.groupedId) {
      const albumPost = albumPosts.get(message.groupedId);
      if (albumPost) {
        if (albumPost.resetTime) {
          albumPost.messageIds.push(message.id);
          return;
        }
        albumPost.mediaMessage ??= hasMedia ? message : undefined;
        albumPost.text ??= text;
        albumPost.messageIds.push(message.id);
        return;
      }
    }

    // Nothing joins across a reset
    const previous = posts[posts.length - 1]?.resetTime ? undefined : posts[posts.length - 1];
    if (!hasMedia) {
      if (!text) return;
      if (previous?.mediaMessage && !previous.text) {
        previous.text = text;
        previous.messageIds.push(message.id);
        return;
      }
      posts.push({ text, messageIds: [message.id] });
      return;
    }

    if (!text && previous && !previous.mediaMessage) {
      // The text right before this media is its caption
      previous.mediaMessage = message;
      previous.messageIds.push(message.id);
    } else {
      posts.push({ mediaMessage: message, text, messageIds: [message.id] });
    }
    if (message.groupedId) albumPosts.set(message.groupedId, posts[posts.length - 1]);
  });

  return posts;
}

// Downloads the post's media into the shape the platform accepts. Rejects when the media cannot
// be loaded or the platform would refuse it.
export async function loadSelectionPost(
  post: SelectionPost, onProgress?: (progress: number) => void,
): Promise<FormContentBatchItem> {
  if (post.resetTime) return { resetTime: true };
  const message = post.mediaMessage;
  if (!message) return { text: post.text };

  const video = getMessagePostVideo(message);
  if (video) {
    const blob = await loadPostVideoBlob(video, message, onProgress);
    return { video: { blob, name: video.fileName }, text: post.text };
  }

  // A photo, or an image sent as a file. Media still held locally (just sent) has no remote hash
  // and is read from its local blob, the way the single send buttons do
  const fileImage = getMessageFileImage(message);
  const photo = getMessagePhoto(message);
  const hash = fileImage ? getDocumentMediaHash(fileImage, 'full') : getPhotoMediaHash(photo!, 'inline');
  const blobUrl = hash ? await fetchMediaBlobUrl(hash, message, onProgress) : photo?.blobUrl;
  const image = await loadPlatformImage(blobUrl);
  return { image, text: post.text };
}

function checkHasPostMedia(message: ApiMessage) {
  return Boolean(getMessagePhoto(message) || getMessageFileImage(message) || getMessagePostVideo(message));
}

function getMessageText(lang: LangFn, message: ApiMessage) {
  return getMessageTextWithSpoilers(lang, message, undefined)?.trim() || undefined;
}
