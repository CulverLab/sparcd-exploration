import { describe, it, expect } from 'vitest';
import { restampDeployment } from '../src/lib/publishedEdit';
import {
  serializeCsvRows, parseCsvRows, serializeDeployments, parseDeployments,
  MEDIA_COL, MEDIA_COLUMN_COUNT, type Deployment,
} from '@sparcd/camtrap';

const PHX: Deployment = { deploymentId: 'u:SAN15', locationId: 'SAN15', locationName: 'San Pedro 15', latitude: 31.5, longitude: -110.2, elevation: 1200 };
const NYC: Deployment = { deploymentId: 'u:NYC1', locationId: 'NYC1', locationName: 'New York 1', latitude: 40.7, longitude: -74.0, elevation: 10 };
function mediaRow(id: string, dep: string, ts: string): string[] {
  const r = new Array<string>(MEDIA_COLUMN_COUNT).fill('');
  r[MEDIA_COL.mediaId] = id; r[MEDIA_COL.deploymentId] = dep; r[MEDIA_COL.timestamp] = ts;
  return r;
}

describe('uploader restampDeployment', () => {
  it('second correction back to the upload zone still rebases (stale UploadMeta.captureTimeZone)', () => {
    // Uploaded in New York, corrected once to Phoenix (file now on -07:00), now corrected back to New York.
    const out = restampDeployment(
      {
        deployments: serializeDeployments([PHX]),
        media: serializeCsvRows([mediaRow('a', PHX.deploymentId, '2024-07-10T08:00:00.000-07:00')]),
        observations: '',
      },
      {
        fromDeploymentId: PHX.deploymentId, toDeploymentId: NYC.deploymentId, location: NYC,
        fromTimeZone: 'America/Phoenix', legacyTimeZone: 'America/New_York', toTimeZone: 'America/New_York',
      },
    );
    expect(parseCsvRows(out.media)[0][MEDIA_COL.timestamp]).toBe('2024-07-10T08:00:00.000-04:00');
  });

  it('same deployment id with corrected coordinates updates deployments.csv (main behaviour)', () => {
    const fixed: Deployment = { ...PHX, locationName: 'San Pedro 15 (moved)', latitude: 31.6 };
    const out = restampDeployment(
      { deployments: serializeDeployments([PHX]), media: '', observations: '' },
      { fromDeploymentId: PHX.deploymentId, toDeploymentId: fixed.deploymentId, location: fixed,
        fromTimeZone: 'America/Phoenix', toTimeZone: 'America/Phoenix' },
    );
    expect(parseDeployments(out.deployments)[0].latitude).toBe(31.6);
  });

  it('re-picking the recorded location is a no-op', () => {
    const csv = {
      deployments: serializeDeployments([PHX]),
      media: serializeCsvRows([mediaRow('a', PHX.deploymentId, '2024-07-10T08:00:00.000-07:00')]),
      observations: '',
    };
    const out = restampDeployment(csv, {
      fromDeploymentId: PHX.deploymentId, toDeploymentId: PHX.deploymentId, location: { ...PHX },
      fromTimeZone: 'America/Phoenix', toTimeZone: 'America/Phoenix',
    });
    expect(out).toBe(csv);
  });
});
