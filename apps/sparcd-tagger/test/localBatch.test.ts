// A batch handed over by the uploader has to look, to the rest of the
// workspace, exactly like one loaded from a collection — the projection into
// TagImage is where that promise is kept or broken.

import { describe, it, expect } from 'vitest';
import type { FlipRecord } from '@sparcd/flip';
import { localTagImages, tagsFromDrafts } from '../src/lib/localWorkspace';
import { isVideoImage } from '../src/lib/workspace';
import { safeReturnUrl, uploaderPath } from '../src/lib/siblings';
import { DEFAULT_SPECIES } from '../src/lib/defaultSpecies';
import { GHOST, blankDraft } from '../src/lib/drafts';
import type { DraftObservation, DraftRecord } from '../src/lib/db';

const coyote: DraftObservation = {
  scientificName: 'Canis latrans',
  commonName: 'Coyote',
  count: 2,
  requestedSpecies: '',
  freeTags: '',
};

const record = (over: Partial<FlipRecord> = {}): FlipRecord => ({
  id: 'batch-1',
  v: 1,
  createdAt: '2026-08-25T10:00:00.000Z',
  returnUrl: '/sparcd-exploration/uploader/?flip=batch-1',
  files: [
    {
      relPath: 'SD/IMG_0001.JPG',
      fileName: 'IMG_0001.JPG',
      size: 100,
      sha256: 'aa',
      exifTimestamp: '2026-08-01T06:30:00',
      mimeType: 'image/jpeg',
      mediaKind: 'image',
    },
    { relPath: 'SD/CLIP.MP4', fileName: 'CLIP.MP4', size: 200, sha256: 'bb', mediaKind: 'video' },
  ],
  tags: {},
  ...over,
});

describe('the record as the workspace sees it', () => {
  it('keys every image by its path within the chosen folder', () => {
    const images = localTagImages(record());
    expect(images.map((i) => i.key)).toEqual(['SD/IMG_0001.JPG', 'SD/CLIP.MP4']);
    expect(images.map((i) => i.fileName)).toEqual(['IMG_0001.JPG', 'CLIP.MP4']);
  });

  it('carries the camera capture time, and an empty one where there is none', () => {
    const [image, clip] = localTagImages(record());
    expect(image.baseTimestamp).toBe('2026-08-01T06:30:00');
    expect(clip.baseTimestamp).toBe('');
  });

  it('shows a time entered by hand for a file the camera left blank', () => {
    const src = record();
    src.files[1] = { ...src.files[1], manualTimestamp: '2026-08-01T07:00:00' };
    expect(localTagImages(src)[1].baseTimestamp).toBe('2026-08-01T07:00:00');
  });

  it('has no deployment — the uploader assigns one after tagging', () => {
    expect(localTagImages(record()).every((i) => i.deploymentId === '')).toBe(true);
  });

  // The uploader's worker already sniffed the bytes; re-guessing from the file
  // name would be a worse answer than the one we were handed.
  it('carries the media kind the uploader established', () => {
    const [image, clip] = localTagImages(record());
    expect(isVideoImage(image)).toBe(false);
    expect(isVideoImage(clip)).toBe(true);
  });

  it('falls back to the extension for a canonical record, which has no kind', () => {
    const canonical = { ...localTagImages(record())[1], mediaKind: undefined };
    expect(isVideoImage(canonical)).toBe(true);
  });

  it('seeds each image from the tags already in the record, so re-entry resumes', () => {
    const images = localTagImages(record({ tags: { 'SD/IMG_0001.JPG': [coyote] } }));
    expect(images[0].baseObservations).toEqual([coyote]);
    expect(images[1].baseObservations).toEqual([]);
  });

  it('copies the observations, never aliasing the arrays inside the record', () => {
    const src = record({ tags: { 'SD/IMG_0001.JPG': [coyote] } });
    const [image] = localTagImages(src);
    image.baseObservations[0].count = 99;
    expect(src.tags['SD/IMG_0001.JPG'][0].count).toBe(2);
  });
});

describe('drafts on the way back into the record', () => {
  const ctx = { bucket: 'local', uploadPrefix: 'batch-1' };

  it('writes each image its full intended species set', () => {
    const drafts: Record<string, DraftRecord> = {
      'SD/IMG_0001.JPG': { ...blankDraft(ctx, 'SD/IMG_0001.JPG', ''), observations: [coyote] },
      'SD/CLIP.MP4': blankDraft(ctx, 'SD/CLIP.MP4', ''),
    };
    expect(tagsFromDrafts(drafts)).toEqual({
      'SD/IMG_0001.JPG': [coyote],
      'SD/CLIP.MP4': [],
    });
  });
});

describe('the offline species vocabulary', () => {
  it('parses the registry the desktop app ships', () => {
    expect(DEFAULT_SPECIES.length).toBeGreaterThan(40);
    const coyoteEntry = DEFAULT_SPECIES.find((s) => s.scientificName === 'Canis latrans');
    expect(coyoteEntry?.commonName).toBe('Coyote');
  });

  it('leaves Ghost out — the species panel has its own built-in row', () => {
    expect(DEFAULT_SPECIES.some((s) => s.scientificName === GHOST.label)).toBe(false);
  });

  it('carries the key bindings the desktop app uses', () => {
    expect(DEFAULT_SPECIES.find((s) => s.commonName === 'Bear')?.keyBinding).toBe('B');
  });
});

// The record is read out of a database every page on this origin can write, so
// the Done button's destination is not trusted input.
describe('where Done is allowed to go', () => {
  const ORIGIN = 'https://culverlab.github.io';
  const OURS = `${ORIGIN}${uploaderPath()}`;

  it('derives the uploader sibling from this tool own base path', () => {
    expect(uploaderPath()).toMatch(/^\/.*uploader\/$/);
  });

  it('honours the uploader URL the Uploader itself wrote', () => {
    const back = `${uploaderPath()}?flip=batch-1`;
    expect(safeReturnUrl(back, ORIGIN)).toBe(`${ORIGIN}${back}`);
  });

  it('sends an off-origin destination to our own uploader instead', () => {
    expect(safeReturnUrl('https://elsewhere.example/landing', ORIGIN)).toBe(OURS);
  });

  it('treats a protocol-relative URL as the off-origin destination it is', () => {
    expect(safeReturnUrl('//elsewhere.example/landing', ORIGIN)).toBe(OURS);
  });

  it('refuses a same-origin path that is not the uploader', () => {
    expect(safeReturnUrl('/somewhere/else', ORIGIN)).toBe(OURS);
  });

  it('refuses a script URL', () => {
    expect(safeReturnUrl('javascript:void 0', ORIGIN)).toBe(OURS);
  });

  it('refuses nonsense rather than throwing', () => {
    expect(safeReturnUrl('', ORIGIN)).toBe(OURS);
  });
});
