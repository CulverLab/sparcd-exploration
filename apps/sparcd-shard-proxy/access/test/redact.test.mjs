import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  completeDeploymentsCoordinates,
  coordinateObjectKind,
  isCoordinateFreeDeployments,
  redactCoordinateBody,
  sameUploadCompletePublicFields,
  shouldRedactCoordinates,
} from '../redact.mjs';

describe('coordinate response redaction', () => {
  test('recognizes settings and collection location registries', () => {
    assert.equal(coordinateObjectKind('Settings/locations.json'), 'locations');
    assert.equal(coordinateObjectKind('Collections/abc/locations.json'), 'locations');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/deployments.csv'), 'deployments');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/.sparcd-tagger-snapshots/user/2026-01-01/deployments.csv'), 'deployments');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/.sparcd-uploader-snapshots/user/2026-01-01/deployments.csv'), 'deployments');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/.sparcd-uploader-snapshots/user/2026-01-01/UploadComplete.json'), 'upload-complete');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/media.csv'), null);
  });

  test('redacts settings for members and collection data without exactLocations', () => {
    const member = { admin: false };
    assert.equal(shouldRedactCoordinates({ person: member, isSettings: true, membership: null, key: 'Settings/locations.json' }), true);
    assert.equal(shouldRedactCoordinates({ person: member, isSettings: false, membership: { exactLocations: false }, key: 'Collections/u/locations.json' }), true);
    assert.equal(shouldRedactCoordinates({ person: member, isSettings: false, membership: { exactLocations: true }, key: 'Collections/u/locations.json' }), false);
    assert.equal(shouldRedactCoordinates({ person: { admin: true }, isSettings: false, membership: null, key: 'Collections/u/locations.json' }), false);
  });

  test('keeps location identity and elevation while removing coordinates', () => {
    const body = redactCoordinateBody('Collections/abc/locations.json', JSON.stringify([{
      nameProperty: 'Bear Canyon', idProperty: 'BEAR1', latProperty: 32.4,
      lngProperty: -110.7, elevationProperty: 1200,
    }]));
    assert.deepEqual(JSON.parse(body), [{
      nameProperty: 'Bear Canyon', idProperty: 'BEAR1', latProperty: null,
      lngProperty: null, elevationProperty: 1200,
    }]);
  });

  test('supports the wrapped settings locations shape', () => {
    const output = JSON.parse(redactCoordinateBody(
      'Settings/locations.json',
      JSON.stringify({ locations: [{ idProperty: 'A', latProperty: 1, lngProperty: 2 }] }),
    ));
    assert.equal(output.locations[0].idProperty, 'A');
    assert.equal(output.locations[0].latProperty, null);
    assert.equal(output.locations[0].lngProperty, null);
  });

  test('keeps deployment rows but blanks longitude and latitude', () => {
    const body = '"u:l","l","Bear Canyon","-110.700000","32.400000","0","","","","","","0","1200.000000"\n';
    const redacted = redactCoordinateBody('Collections/u/Uploads/run/deployments.csv', body);
    assert.match(redacted, /^"u:l","l","Bear Canyon","","","0"/);
    assert.doesNotMatch(redacted, /110\.700000|32\.400000/);
  });

  test('rejects malformed deployment rows instead of returning coordinates', () => {
    assert.throws(
      () => redactCoordinateBody('Collections/u/Uploads/run/deployments.csv', '"id","only-two"\n'),
      /too few columns/,
    );
  });

  test('recognizes coordinate-free deployment creates but not exact rows', () => {
    assert.equal(isCoordinateFreeDeployments('"id","l","name","",""\n'), true);
    assert.equal(isCoordinateFreeDeployments('"id","l","name","-110","32"\n'), false);
    assert.equal(isCoordinateFreeDeployments(''), false);
  });

  test('refills coordinate-free deployment rows from one exact registry match', () => {
    const row = Array(13).fill('');
    row[0] = 'uuid:SAN19';
    row[1] = 'SAN19';
    row[2] = 'North site';
    row[12] = '1100.000000';
    const output = completeDeploymentsCoordinates(row.map((cell) => '"' + cell + '"').join(',') + '\n', [
      { idProperty: 'SAN19', nameProperty: 'North site', latProperty: 31.5, lngProperty: -110.2, elevationProperty: 1100 },
      { idProperty: 'SAN19', nameProperty: 'South site', latProperty: 32, lngProperty: -111, elevationProperty: 1300 },
    ]);
    assert.match(output, /"-110\.200000","31\.500000"/);
  });

  test('refuses a missing or ambiguous registry match', () => {
    const row = Array(13).fill('');
    row[0] = 'uuid:SAN19';
    row[1] = 'SAN19';
    row[2] = 'North site';
    row[12] = '1100';
    const body = row.map((cell) => '"' + cell + '"').join(',') + '\n';
    const match = { idProperty: 'SAN19', nameProperty: 'North site', latProperty: 31.5, lngProperty: -110.2, elevationProperty: 1100 };
    assert.throws(() => completeDeploymentsCoordinates(body, []), /not uniquely defined/);
    assert.throws(() => completeDeploymentsCoordinates(body, [match, match]), /not uniquely defined/);
  });

  test('replaces the exact metadata bundle digest for restricted readers', () => {
    const raw = JSON.stringify({ metadataBundleSha256: '1'.repeat(64), files: [] });
    const transformed = JSON.parse(redactCoordinateBody(
      'Collections/u/Uploads/run/UploadComplete.json',
      raw,
      (value) => 'opaque-' + value.length,
    ));
    assert.equal(transformed.metadataBundleSha256, 'opaque-64');
    assert.equal(JSON.parse(raw).metadataBundleSha256, '1'.repeat(64));
  });

  test('UploadComplete retry matching ignores the private digest but checks public fields', () => {
    const completion = {
      schemaVersion: 1,
      uploadPath: 'Collections/u/Uploads/run',
      fileCount: 1,
      metadataBundleSha256: 'a'.repeat(64),
      files: [{ media_path: 'image.jpg', size: 12, sha256: 'b'.repeat(64) }],
      completedAt: '2026-10-26T10:00:00.000Z',
    };
    const samePublicFields = JSON.stringify({
      ...completion,
      metadataBundleSha256: 'c'.repeat(64),
    });
    const differentPublicFields = JSON.stringify({ ...completion, fileCount: 2 });
    assert.equal(sameUploadCompletePublicFields(JSON.stringify(completion), samePublicFields), true);
    assert.equal(sameUploadCompletePublicFields(JSON.stringify(completion), differentPublicFields), false);
    assert.equal(sameUploadCompletePublicFields('{}', '{}'), false);
    assert.equal(sameUploadCompletePublicFields('{', JSON.stringify(completion)), false);
  });
});
