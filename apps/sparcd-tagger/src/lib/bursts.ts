// Sequence/burst grouping. The plan's heuristic: same deployment + capture
// times within a configurable window (default 60s, slider 5–600s) → one burst.
// Bursts render as visual bands in the image strip and are the unit of
// whole-burst selection and the "apply to whole burst" keystroke.
//
// The grouping walks `media.csv` order (the authoritative image order the Tag
// workspace grounds on) and starts a new burst whenever the deployment changes
// or the gap to the previous image exceeds the threshold. It groups on the
// base capture timestamp; a uniform upload offset shifts every image equally
// and so never changes a gap, and per-image overrides are rare — when the time
// correction UI lands it can pass corrected timestamps here without changing
// the contract.

import type { TagImage } from './workspace';

export type Burst = {
  id: number; // 0-based, in strip order
  start: number; // first image index (inclusive)
  end: number; // last image index (inclusive)
  size: number;
  deploymentId: string;
  startTs: string; // first image timestamp, '' when unknown
  endTs: string; // last image timestamp, '' when unknown
};

export type BurstGrouping = {
  bursts: Burst[];
  burstOf: number[]; // image index → burst id (same length as the image list)
  banded: boolean; // false when grouping is off — the Overview renders rows with no burst bands
};

// Naive `YYYY-MM-DDTHH:mm:ss` → epoch seconds. Parsed as UTC so the value is
// deterministic regardless of the machine's zone; only the gap matters, and a
// constant zone offset cancels out. Returns null when the field is unparseable.
const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

function epoch(iso: string): number | null {
  const m = TS_RE.exec(iso);
  if (!m) return null;
  return (
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) /
    1000
  );
}

export function groupBursts(
  images: TagImage[],
  thresholdSec: number,
  enabled = true,
  // Timestamp accessor — defaults to the canonical capture time. The Tag
  // workspace passes the *corrected* time (upload offset + per-image override)
  // so a per-image correction can move an image across a burst boundary. A
  // uniform upload offset shifts every image equally and never changes a gap.
  tsOf: (img: TagImage) => string = (img) => img.baseTimestamp,
): BurstGrouping {
  // Grouping off (the default — our cameras shoot no bursts): collapse the whole
  // upload into one flat group so whole-burst select / nav helpers stay valid,
  // but flag it unbanded so the Overview shows plain rows with no burst headers.
  if (!enabled) {
    const bursts: Burst[] = images.length
      ? [
          {
            id: 0,
            start: 0,
            end: images.length - 1,
            size: images.length,
            deploymentId: images[0].deploymentId,
            startTs: tsOf(images[0]),
            endTs: tsOf(images[images.length - 1]),
          },
        ]
      : [];
    return { bursts, burstOf: new Array<number>(images.length).fill(0), banded: false };
  }

  const bursts: Burst[] = [];
  const burstOf = new Array<number>(images.length);

  let cur: Burst | null = null;
  let prevEpoch: number | null = null;

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const ts = epoch(tsOf(img));
    const sameDeployment = cur !== null && cur.deploymentId === img.deploymentId;
    // A missing timestamp can't be proven within the window, so it always breaks
    // the run — an unknown gap is treated as "not the same burst".
    const withinWindow =
      sameDeployment && ts !== null && prevEpoch !== null && Math.abs(ts - prevEpoch) <= thresholdSec;

    if (cur && withinWindow) {
      cur.end = i;
      cur.size++;
      cur.endTs = tsOf(img);
    } else {
      cur = {
        id: bursts.length,
        start: i,
        end: i,
        size: 1,
        deploymentId: img.deploymentId,
        startTs: tsOf(img),
        endTs: tsOf(img),
      };
      bursts.push(cur);
    }
    burstOf[i] = cur.id;
    prevEpoch = ts;
  }

  return { bursts, burstOf, banded: true };
}
