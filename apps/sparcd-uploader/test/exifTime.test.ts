// Per-upload timezone proofs. EXIF datetimes are naive wall-clock with no zone;
// interpreting them in a chosen IANA zone must yield the correct UTC instant,
// DST-correct, as a full ISO 8601 UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`) —
// and the result must NOT depend on the machine the uploader runs on.
//
// RED-GREEN: these assertions fail against the naive `new Date(localString)`
// path, which reinterprets the naive string in the *browser*'s zone, making the
// instant machine-dependent — proven independent here via a TZ matrix. The
// conversion below must derive the UTC instant from the explicit `timeZone`
// argument before formatting it, never from the machine's ambient zone.

import { describe, it, expect, afterEach } from 'vitest';
import {
  naiveInZoneToUtcIso,
  formatNaive,
  localTimeZone,
  naiveToInputValue,
  inputValueToNaive,
  type NaiveDateTime,
} from '../src/lib/exifTime';

const at = (over: Partial<NaiveDateTime>): NaiveDateTime => ({
  year: 2024,
  month: 1,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
  ...over,
});

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('naiveInZoneToUtcIso', () => {
  it('interprets a naive wall-clock in a no-DST zone (America/Phoenix, UTC-7)', () => {
    expect(naiveInZoneToUtcIso(at({ month: 7, day: 15, hour: 12 }), 'America/Phoenix')).toBe(
      '2024-07-15T19:00:00.000Z',
    );
    // Phoenix has no DST, so winter is the same offset.
    expect(naiveInZoneToUtcIso(at({ month: 1, day: 15, hour: 12 }), 'America/Phoenix')).toBe(
      '2024-01-15T19:00:00.000Z',
    );
  });

  it('is DST-correct: the same wall-clock maps to different UTC offsets across the boundary', () => {
    // America/Denver: summer MDT (UTC-6), winter MST (UTC-7). Identical 12:00
    // local wall-clock, two different UTC instants.
    expect(naiveInZoneToUtcIso(at({ month: 7, day: 15, hour: 12 }), 'America/Denver')).toBe(
      '2024-07-15T18:00:00.000Z',
    );
    expect(naiveInZoneToUtcIso(at({ month: 1, day: 15, hour: 12 }), 'America/Denver')).toBe(
      '2024-01-15T19:00:00.000Z',
    );
  });

  it('handles an east-of-UTC zone (Asia/Kolkata, UTC+5:30)', () => {
    expect(naiveInZoneToUtcIso(at({ month: 6, day: 1, hour: 3, minute: 30 }), 'Asia/Kolkata')).toBe(
      '2024-05-31T22:00:00.000Z',
    );
  });

  it('UTC is a passthrough', () => {
    expect(naiveInZoneToUtcIso(at({ month: 6, day: 1, hour: 9, minute: 15, second: 45 }), 'UTC')).toBe(
      '2024-06-01T09:15:45.000Z',
    );
  });

  it('always emits a full ISO 8601 UTC shape — millis and Z', () => {
    for (const tz of ['UTC', 'America/Phoenix', 'America/Denver', 'Asia/Kolkata', 'Pacific/Chatham']) {
      expect(naiveInZoneToUtcIso(at({ month: 7, day: 15, hour: 12, minute: 34, second: 56 }), tz)).toMatch(
        ISO_SHAPE,
      );
    }
  });

  it('resolves the spring-forward gap deterministically without throwing', () => {
    // 2024-03-10 02:30 does not exist in America/Denver (clocks jump 02:00→03:00).
    const r = naiveInZoneToUtcIso(at({ month: 3, day: 10, hour: 2, minute: 30 }), 'America/Denver');
    expect(r).toMatch(ISO_SHAPE);
  });

  it('resolves the fall-back fold deterministically without throwing', () => {
    // 2024-11-03 01:30 is ambiguous in America/Denver (occurs twice).
    const r = naiveInZoneToUtcIso(at({ month: 11, day: 3, hour: 1, minute: 30 }), 'America/Denver');
    expect(r).toMatch(ISO_SHAPE);
  });
});

describe('machine-zone independence', () => {
  const RealDTF = Intl.DateTimeFormat;
  afterEach(() => {
    Intl.DateTimeFormat = RealDTF;
  });

  // Stub the machine's *default* zone (what `Intl.DateTimeFormat().resolvedOptions().timeZone`
  // would pick up) to a series of unrelated zones. The conversion takes its zone
  // as an explicit argument, so the result must not move — a browser-zone-derived
  // implementation would.
  function withMachineZone(machineZone: string): void {
    const Stub = function (
      this: unknown,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ) {
      // No explicit timeZone → impersonate the machine default; otherwise honor
      // the caller's choice exactly (this is the code path under test).
      const opts = options?.timeZone ? options : { ...options, timeZone: machineZone };
      return new RealDTF(locales, opts);
    } as unknown as typeof Intl.DateTimeFormat;
    Stub.supportedLocalesOf = RealDTF.supportedLocalesOf;
    Intl.DateTimeFormat = Stub;
  }

  it('yields an identical instant regardless of the machine default zone', () => {
    const n = at({ month: 7, day: 15, hour: 12 });
    const results: string[] = [];
    for (const machineZone of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']) {
      withMachineZone(machineZone);
      results.push(naiveInZoneToUtcIso(n, 'America/Phoenix'));
    }
    for (const r of results) expect(r).toBe('2024-07-15T19:00:00.000Z');
  });

  it('the machine default never leaks an offset into the result', () => {
    // Even when the machine pretends to be a +13:45 zone, a UTC interpretation
    // is a pure passthrough — proving no ambient offset contaminates the math.
    withMachineZone('Pacific/Chatham');
    expect(naiveInZoneToUtcIso(at({ month: 7, day: 15, hour: 12 }), 'UTC')).toBe(
      '2024-07-15T12:00:00.000Z',
    );
  });
});

const NAIVE_BYTE_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

describe('helpers', () => {
  it('formatNaive renders the canonical zero-padded shape', () => {
    expect(formatNaive(at({ month: 3, day: 9, hour: 7, minute: 5, second: 1 }))).toBe(
      '2024-03-09T07:05:01',
    );
    expect(formatNaive(at({ month: 3, day: 9, hour: 7, minute: 5, second: 1 }))).toMatch(NAIVE_BYTE_SHAPE);
  });

  it('localTimeZone returns a non-empty IANA zone', () => {
    const tz = localTimeZone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });
});

describe('datetime-local <-> naive (manual capture-time entry)', () => {
  it('round-trips a naive value through the input string', () => {
    const n = at({ month: 3, day: 9, hour: 7, minute: 5, second: 1 });
    expect(naiveToInputValue(n)).toBe('2024-03-09T07:05:01');
    expect(inputValueToNaive(naiveToInputValue(n))).toEqual(n);
  });

  it('defaults missing seconds to 0 (browsers may omit at step=1)', () => {
    expect(inputValueToNaive('2024-03-09T07:05')).toEqual(at({ month: 3, day: 9, hour: 7, minute: 5 }));
  });

  it('returns null for empty or malformed input', () => {
    expect(inputValueToNaive('')).toBeNull();
    expect(inputValueToNaive('not a date')).toBeNull();
    expect(inputValueToNaive('2024-13-09T07:05:00')).toBeNull(); // month 13
    expect(inputValueToNaive('2024-03-09')).toBeNull(); // no time
  });

  it('rejects calendar-impossible dates instead of silently normalizing them', () => {
    expect(inputValueToNaive('2024-02-31T08:00:00')).toBeNull(); // Feb 31
    expect(inputValueToNaive('2024-04-31T08:00:00')).toBeNull(); // Apr has 30
    expect(inputValueToNaive('2023-02-29T08:00:00')).toBeNull(); // not a leap year
    expect(inputValueToNaive('2024-00-09T08:00:00')).toBeNull(); // month 0
    expect(inputValueToNaive('2024-03-00T08:00:00')).toBeNull(); // day 0
  });

  it('accepts a real leap day', () => {
    expect(inputValueToNaive('2024-02-29T08:00:00')).toEqual(
      at({ month: 2, day: 29, hour: 8 }),
    );
  });
});
