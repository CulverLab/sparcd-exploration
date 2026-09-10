import { describe, expect, it } from 'vitest';
import { MediaRequestScheduler } from '../src/lib/mediaRequestScheduler';

describe('MediaRequestScheduler', () => {
  it('admits a Focus request before queued thumbnail requests', async () => {
    const scheduler = new MediaRequestScheduler(1);
    const starts: string[] = [];
    const firstThumb = scheduler.acquire('low');
    const queuedThumb = scheduler.acquire('low');
    const focus = scheduler.acquire('high');

    await firstThumb.admitted;
    starts.push('first thumbnail');
    firstThumb.release();
    await focus.admitted;
    starts.push('focus');
    expect(starts).toEqual(['first thumbnail', 'focus']);

    focus.release();
    await queuedThumb.admitted;
    starts.push('queued thumbnail');
    expect(starts).toEqual(['first thumbnail', 'focus', 'queued thumbnail']);
    queuedThumb.release();
  });

  it('starts Focus immediately when thumbnail capacity is saturated', async () => {
    const scheduler = new MediaRequestScheduler(4);
    const starts: string[] = [];
    const thumbnails = ['one', 'two', 'three'].map((name) => {
      const lease = scheduler.acquire('low');
      void lease.admitted.then(() => starts.push(`thumbnail ${name}`));
      return lease;
    });
    const queuedThumbnail = scheduler.acquire('low');
    let queuedThumbnailStarted = false;
    void queuedThumbnail.admitted.then(() => {
      queuedThumbnailStarted = true;
    });

    await Promise.all(thumbnails.map((thumbnail) => thumbnail.admitted));
    await Promise.resolve();
    expect(starts).toEqual(['thumbnail one', 'thumbnail two', 'thumbnail three']);
    expect(queuedThumbnailStarted).toBe(false);

    const focus = scheduler.acquire('high');
    await focus.admitted;
    starts.push('focus');
    expect(starts).toEqual(['thumbnail one', 'thumbnail two', 'thumbnail three', 'focus']);

    focus.release();
    thumbnails[0].release();
    await queuedThumbnail.admitted;
    expect(queuedThumbnailStarted).toBe(true);

    thumbnails[1].release();
    thumbnails[2].release();
    queuedThumbnail.release();
  });
});
