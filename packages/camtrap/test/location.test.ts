import { describe, it, expect } from 'vitest';
import {
  parseDeployments,
  parseMedia,
  parseObservations,
  rewriteMediaDeploymentId,
  rewriteObservationsDeploymentId,
} from '../src/index';
import { fixture } from './fixtures';

describe('parseDeployments reads timestampIssues', () => {
  it('reads true/false from column 15', () => {
    const [d] = parseDeployments(fixture('java-v016', 'deployments.csv'));
    expect(typeof d.timestampIssues).toBe('boolean');
  });
});

describe('rewriteMediaDeploymentId', () => {
  it('rewrites every row to the new deployment id, changing nothing else', () => {
    const before = parseMedia(fixture('java-v016', 'media.csv'));
    const csv = rewriteMediaDeploymentId(fixture('java-v016', 'media.csv'), 'UUID:NEWLOC');
    const after = parseMedia(csv);
    expect(after).toHaveLength(before.length);
    expect(after.every((m) => m.deploymentId === 'UUID:NEWLOC')).toBe(true);
    // Every other field is untouched.
    after.forEach((m, i) => {
      expect(m.mediaId).toBe(before[i].mediaId);
      expect(m.timestamp).toBe(before[i].timestamp);
      expect(m.fileName).toBe(before[i].fileName);
    });
  });
});

describe('rewriteObservationsDeploymentId', () => {
  it('rewrites every row to the new deployment id, changing nothing else', () => {
    const before = parseObservations(fixture('java-v016', 'observations.csv'));
    const csv = rewriteObservationsDeploymentId(fixture('java-v016', 'observations.csv'), 'UUID:NEWLOC');
    const after = parseObservations(csv);
    expect(after).toHaveLength(before.length);
    expect(after.every((o) => o.deploymentId === 'UUID:NEWLOC')).toBe(true);
    after.forEach((o, i) => {
      expect(o.mediaId).toBe(before[i].mediaId);
      expect(o.scientificName).toBe(before[i].scientificName);
      expect(o.count).toBe(before[i].count);
    });
  });
});
