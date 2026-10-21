import { describe, expect, it, vi } from 'vitest';

import type { ApiMessage } from '../../../api/types';
import type { LangFn } from '../../../util/localization';

import { buildSelectionPosts, checkIsResetTimeText } from './buildSelectionPosts';

type TestMessage = { id: number; text?: string; photo?: true; video?: true; groupedId?: string };

// Only what the split reads: the text and whether there is a photo or a video
vi.mock('../../../global/helpers', () => ({
  getDocumentMediaHash: vi.fn(),
  getPhotoMediaHash: vi.fn(),
  getMessagePhoto: (message: TestMessage) => message.photo,
}));
vi.mock('../../../global/helpers/messageSummary', () => ({
  getMessageTextWithSpoilers: (_lang: LangFn, message: TestMessage) => message.text,
}));
vi.mock('../message/helpers/sendMessageContentOptions', () => ({
  fetchMediaBlobUrl: vi.fn(),
  getMessageFileImage: () => undefined,
  getMessagePostVideo: (message: TestMessage) => message.video,
  loadPlatformImage: vi.fn(),
  loadPostVideoBlob: vi.fn(),
}));

const lang = (() => '') as unknown as LangFn;
const split = (messages: TestMessage[]) => buildSelectionPosts(lang, messages as unknown as ApiMessage[])
  .map((post) => (post.resetTime ? 'reset' : `${post.mediaMessage ? 'media' : 'text'}:${post.messageIds.join(',')}`));

describe('checkIsResetTimeText', () => {
  it('takes the command in any case, spacing and decoration', () => {
    ['Reset time', 'RESET TIME', 'reset   time', ' 🔄 Reset time! ', '*Reset Time*', '𝐑𝐞𝐬𝐞𝐭 𝐭𝐢𝐦𝐞', 'Reset\ntime']
      .forEach((text) => expect(checkIsResetTimeText(text)).toBe(true));
  });

  it('leaves a text that merely mentions it', () => {
    ['Reset time for the gym', 'reset', 'time reset', '', undefined]
      .forEach((text) => expect(checkIsResetTimeText(text)).toBe(false));
  });
});

describe('buildSelectionPosts', () => {
  it('turns the command into a marker in place, whatever the message carries', () => {
    expect(split([
      { id: 1, text: 'One', photo: true },
      { id: 2, text: 'RESET TIME' },
      { id: 3, photo: true, text: 'Reset time' },
      { id: 4, video: true },
      { id: 5, text: 'reset time', video: true },
      { id: 6, text: 'Two' },
    ])).toEqual(['media:1', 'reset', 'reset', 'media:4', 'reset', 'text:6']);
  });

  it('joins no text or media across a marker', () => {
    // Without the marker "Caption" would caption photo 1; after it, it captions photo 4
    expect(split([
      { id: 1, photo: true },
      { id: 2, text: 'Reset time' },
      { id: 3, text: 'Caption' },
      { id: 4, photo: true },
    ])).toEqual(['media:1', 'reset', 'media:3,4']);
  });

  it('makes the whole album the marker', () => {
    expect(split([
      { id: 1, photo: true, groupedId: 'a' },
      { id: 2, photo: true, groupedId: 'a', text: 'Reset time' },
      { id: 3, photo: true, groupedId: 'a' },
      { id: 4, text: 'Next', photo: true },
    ])).toEqual(['reset', 'media:4']);
  });
});
