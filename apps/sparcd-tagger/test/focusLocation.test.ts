import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeS3Client } from '@sparcd/s3-safe';
import type { Deployment } from '@sparcd/camtrap';
import type { S3Config } from '@sparcd/types';
import { focusLocationLabel } from '../src/lib/focusLocation';
import { clearClientCache, loadCurrentDeployment } from '../src/lib/s3';

const deployment: Deployment = {
  deploymentId: 'collection:SAN15', locationId: 'SAN15', locationName: 'San Pedro 15',
  latitude: 31.5, longitude: -110.2, elevation: 1200,
};
const cfg: S3Config = {
  endpoint: 'https://store.example', region: 'us-east-1', accessKey: 'access', secretKey: 'secret', forcePathStyle: true,
};

afterEach(() => {
  vi.restoreAllMocks();
  clearClientCache();
});

describe('Focus location labels', () => {
  it('formats and trims a complete recorded location', () => {
    expect(focusLocationLabel({ ...deployment, locationName: ' San Pedro 15 ', locationId: ' SAN15 ' })).toBe('San Pedro 15 (SAN15)');
  });

  it.each([
    null,
    undefined,
    { ...deployment, locationName: '' },
    { ...deployment, locationId: '' },
    { ...deployment, locationName: ' \t ' },
    { ...deployment, locationId: '  ' },
    { ...deployment, locationName: '', locationId: '' },
  ])('omits unavailable or incomplete metadata: %j', (recorded) => {
    expect(focusLocationLabel(recorded)).toBeNull();
  });

  it.each(['AccessDenied', 'NetworkError'])('degrades a %s lookup to a blank display', async (name) => {
    const get = vi.spyOn(SafeS3Client.prototype, 'getObject').mockRejectedValue(Object.assign(new Error(name), { name }));
    const recorded = await loadCurrentDeployment(cfg, 'bucket', 'Collections/c/Uploads/u/');
    expect(get).toHaveBeenCalledWith('bucket', 'Collections/c/Uploads/u/deployments.csv');
    expect(focusLocationLabel(recorded)).toBeNull();
  });
});
