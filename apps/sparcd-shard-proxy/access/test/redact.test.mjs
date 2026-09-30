import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { coordinateObjectKind, isCoordinateFreeDeployments, redactCoordinateBody, shouldRedactCoordinates } from '../redact.mjs';

describe('coordinate response redaction', () => {
  test('recognizes settings and collection location registries', () => {
    assert.equal(coordinateObjectKind('Settings/locations.json'), 'locations');
    assert.equal(coordinateObjectKind('Collections/abc/locations.json'), 'locations');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/deployments.csv'), 'deployments');
    assert.equal(coordinateObjectKind('Collections/abc/Uploads/run/.sparcd-tagger-snapshots/user/2026-01-01/deployments.csv'), 'deployments');
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
  });
});
