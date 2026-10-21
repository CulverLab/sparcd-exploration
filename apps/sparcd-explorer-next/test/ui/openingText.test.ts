import { describe, expect, it } from 'vitest';
import { S3ReadError, translateReadError } from '@sparcd/s3-safe';
import { SKEW_REASON, clockNote, failureLines, openFailure } from '../../src/lib/openingText';

const sdkError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('why a collection could not open', () => {
  it('says the computer clock is off, and what to do, when the server refused the time', () => {
    expect(openFailure(translateReadError(sdkError('RequestTimeTooSkewed', 403), 'the uploads of "Alpha"'))).toBe(SKEW_REASON);
    expect(SKEW_REASON).toBe(
      "The server refused the request because your computer's clock is off. Check your date and time settings, then retry.",
    );
  });

  it('keeps the plain message of any other read error', () => {
    const denied = translateReadError(sdkError('AccessDenied', 403), 'the uploads of "Alpha"');
    expect(denied).toBeInstanceOf(S3ReadError);
    expect(openFailure(denied)).toBe(denied.message);
    expect(openFailure('offline')).toBe('offline');
  });

  it('gathers collections that failed for the same reason into one line, in the order they failed', () => {
    const lines = failureLines(
      [
        { name: 'Bravo', reason: SKEW_REASON },
        { name: 'Delta', reason: 'Access denied.' },
        { name: 'Alpha', reason: SKEW_REASON },
        { name: 'Echo', reason: SKEW_REASON },
      ],
      true,
    );
    expect(lines).toEqual([
      { names: 'Bravo, Alpha and Echo', reason: SKEW_REASON },
      { names: 'Delta', reason: 'Access denied.' },
    ]);
  });

  it('leaves the name out while one collection opens alone', () => {
    expect(failureLines([{ name: 'Alpha', reason: 'Access denied.' }], false)).toEqual([{ names: null, reason: 'Access denied.' }]);
  });
});

describe('the note once the explorer adjusted for the clock', () => {
  it('says nothing while no adjustment was needed', () => {
    expect(clockNote(0)).toBeNull();
    expect(clockNote(20_000)).toBeNull();
  });

  it('says about how far off the clock is, either way, in minutes and then hours', () => {
    expect(clockNote(17 * 60_000 + 20_000)).toBe("Your computer's clock is about 17 minutes off. The explorer adjusted for it.");
    expect(clockNote(-20 * 60_000)).toBe("Your computer's clock is about 20 minutes off. The explorer adjusted for it.");
    expect(clockNote(60_000)).toBe("Your computer's clock is about 1 minute off. The explorer adjusted for it.");
    expect(clockNote(3 * 3_600_000)).toBe("Your computer's clock is about 3 hours off. The explorer adjusted for it.");
  });
});
