import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const useMediaUrl = vi.hoisted(() => vi.fn(() => ({
  url: undefined,
  isError: false,
  markLoaded: vi.fn(),
})));

vi.mock('../src/lib/useMediaUrl', () => ({ useMediaUrl }));

import { Thumb, THUMB_MEDIA_PRIORITY, thumbnailLoadState } from '../src/components/Thumb';

describe('thumbnail media priority', () => {
  it('passes low priority into the scheduler hook', () => {
    renderToStaticMarkup(<Thumb objectKey="Collections/c/media.jpg" alt="media.jpg" />);

    expect(THUMB_MEDIA_PRIORITY).toBe('low');
    expect(useMediaUrl).toHaveBeenCalledWith('Collections/c/media.jpg', 'low');
  });

  it('keeps a failed media response separate from a loaded thumbnail', () => {
    const mediaKey = 'Collections/c/media.jpg\u0000https://signed/media.jpg';

    expect(thumbnailLoadState(mediaKey, undefined, undefined)).toBe('loading');
    expect(thumbnailLoadState(mediaKey, undefined, mediaKey)).toBe('failed');
    expect(thumbnailLoadState(mediaKey, mediaKey, undefined)).toBe('loaded');
  });

  it('renders the signing failure marker when URL production fails', () => {
    useMediaUrl.mockReturnValueOnce({
      url: undefined,
      isError: true,
      markLoaded: vi.fn(),
    });

    const html = renderToStaticMarkup(
      <Thumb objectKey="Collections/c/unavailable.jpg" alt="unavailable.jpg" />,
    );

    expect(html).toContain('thumbnail-failure');
  });
});
