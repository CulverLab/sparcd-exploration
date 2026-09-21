import { describe, expect, it } from 'vitest';
import { changedRecordCount, discardBlankDraft, retireItem, setRetired, updateItem } from '../src/RegistryEditor';
import { changedRecordsValidationError, normalizeNumbers, numberFieldError, validationError } from '../src/validation';
import { assignmentDiscrepancies, collectionHasChanges, collectionValidationError, makeAppliedAuditRetry } from '../src/CollectionEditor';
import { activeCount, checklistRows, matchShared, sharedHasId } from '../src/AssignmentChecklist';
import { settingsBucketCandidates } from '../src/settingsBucket';

describe('registry mutation', () => {
  it('replaces only the selected species record', () => {
    const before = [{ scientificName: 'Canis latrans', name: 'Coyote' }, { scientificName: 'Puma concolor', name: 'Mountain Lion' }];
    expect(updateItem(before, 1, { scientificName: 'Puma concolor', name: 'Puma' })).toEqual([
      before[0], { scientificName: 'Puma concolor', name: 'Puma' },
    ]);
  });
});

it('retires a species without removing its historical identity', () => {
  expect(retireItem([{ scientificName: 'Canis latrans', name: 'Coyote' }], 0)).toEqual([
    { scientificName: 'Canis latrans', name: 'Coyote', retired: true },
  ]);
});

it('brings a retired record back into use', () => {
  expect(setRetired([{ nameProperty: 'North gate', retired: true }], 0, false)).toEqual([
    { nameProperty: 'North gate', retired: false },
  ]);
});

it('rejects duplicate official location IDs', () => {
  const locations = [
    { idProperty: 'A', nameProperty: 'One', latProperty: 1, lngProperty: 1, elevationProperty: 1 },
    { idProperty: 'A', nameProperty: 'Two', latProperty: 2, lngProperty: 2, elevationProperty: 2 },
  ];
  expect(validationError('Locations', locations, 1)).toMatch(/already used/);
});

it('discards an empty added record when an existing record is selected', () => {
  const existing = [{ name: 'Coyote' }, { name: 'Puma' }];
  expect(discardBlankDraft([...existing, {}], 2)).toEqual(existing);
});

it('keeps a newly added record once it contains a value', () => {
  const records = [{ name: 'Coyote' }, { name: 'Puma' }, { name: 'Jaguar' }];
  expect(discardBlankDraft(records, 2)).toEqual(records);
});

it('counts added and changed registry records for the save label', () => {
  const before = [{ name: 'Coyote' }, { name: 'Puma' }];
  expect(changedRecordCount([{ name: 'Coyote' }, { name: 'Mountain lion' }, { name: 'Jaguar' }], before)).toBe(2);
});

it('validates every changed record before saving a registry', () => {
  const before = [
    { scientificName: 'Canis latrans', name: 'Coyote', keyBinding: 'C' },
    { scientificName: 'Puma concolor', name: 'Puma', keyBinding: 'P' },
  ];
  const changed = [
    { scientificName: 'Canis latrans', name: 'Coyote updated', keyBinding: 'C' },
    { scientificName: 'Puma concolor', name: '', keyBinding: 'P' },
  ];
  expect(changedRecordsValidationError('Species', changed, before)).toBe(
    'Species “Puma concolor”: Common name and scientific name are required.',
  );
});

it('names an invalid location in a multi-record validation error', () => {
  const before = [{ idProperty: 'A', nameProperty: 'Alpha' }];
  const changed = [{ idProperty: '', nameProperty: 'North gate' }];
  expect(changedRecordsValidationError('Locations', changed, before)).toBe(
    'Location “North gate”: Name and location ID are required.',
  );
});

it('does not reject an unchanged legacy record while validating changes', () => {
  const before = [{ scientificName: '', name: '' }, { scientificName: 'Puma concolor', name: 'Puma', keyBinding: 'P' }];
  const changed = [{ scientificName: '', name: '' }, { scientificName: 'Puma concolor', name: 'Mountain lion', keyBinding: 'P' }];
  expect(changedRecordsValidationError('Species', changed, before)).toBeNull();
});

describe('number boxes (bug 2)', () => {
  it('refuses text that Number() would turn into nothing', () => {
    expect(numberFieldError('latProperty', '31.2q')).toBe('Latitude must be a number, like 32.158.');
  });

  it('refuses a box holding only spaces, which Number() reads as zero', () => {
    expect(numberFieldError('lngProperty', ' ')).toBe('Longitude needs a number.');
  });

  it('holds latitude and longitude to their ranges', () => {
    expect(numberFieldError('latProperty', '91')).toBe('Latitude must be between -90 and 90.');
    expect(numberFieldError('lngProperty', '-181')).toBe('Longitude must be between -180 and 180.');
    expect(numberFieldError('latProperty', '32.158')).toBeNull();
  });

  it('blocks a save that would store junk or zero in a number field', () => {
    const before = [{ nameProperty: 'North gate', idProperty: 'A', latProperty: 32.1, lngProperty: -109.4, elevationProperty: 1415 }];
    const typed = [{ nameProperty: 'North gate', idProperty: 'A', latProperty: '31.2q', lngProperty: ' ', elevationProperty: 1415 }];
    expect(changedRecordsValidationError('Locations', typed, before)).toBe(
      'Location “North gate”: Latitude must be a number, like 32.158.',
    );
  });

  it('stores typed numbers as numbers', () => {
    expect(normalizeNumbers('Locations', [{ latProperty: '32.158', lngProperty: '-109.4478', elevationProperty: '1415' }])).toEqual([
      { latProperty: 32.158, lngProperty: -109.4478, elevationProperty: 1415 },
    ]);
  });
});

describe('location ID conflicts (bug 4)', () => {
  const legacy = [
    { idProperty: 'DOS09', nameProperty: 'Apache Pass', latProperty: 32.1, lngProperty: -109.4, elevationProperty: 1415 },
    { idProperty: 'DOS09', nameProperty: 'Apache Pass south', latProperty: 32.2, lngProperty: -109.5, elevationProperty: 1420 },
  ];

  it('lets an untouched record that shares an ID be edited', () => {
    const changed = [{ ...legacy[0], nameProperty: 'Apache Pass north' }, legacy[1]];
    expect(changedRecordsValidationError('Locations', changed, legacy)).toBeNull();
  });

  it('still blocks a record whose ID was changed onto another, whatever the case or spacing', () => {
    const apart = [legacy[0], { ...legacy[1], idProperty: 'SAN15' }];
    const changed = [apart[0], { ...apart[1], idProperty: ' dos09 ' }];
    expect(changedRecordsValidationError('Locations', changed, apart)).toMatch(/already used/);
  });

  it('ignores retired records when looking for a conflict', () => {
    const apart = [{ ...legacy[0], retired: true }, { ...legacy[1], idProperty: 'SAN15' }];
    const changed = [apart[0], { ...apart[1], idProperty: 'DOS09' }];
    expect(changedRecordsValidationError('Locations', changed, apart)).toBeNull();
  });
});

it('requires collection name, organization, and description while allowing contact blank', () => {
  expect(collectionValidationError({ nameProperty: 'Field site', organizationProperty: 'Lab', contactInfoProperty: '', descriptionProperty: '' })).toBe('Description is required.');
  expect(collectionValidationError({ nameProperty: 'Field site', organizationProperty: 'Lab', contactInfoProperty: '', descriptionProperty: 'Study' })).toBeNull();
});

it('enables collection save only when metadata changed', () => {
  const original = { nameProperty: 'Field site', organizationProperty: 'Lab', descriptionProperty: 'Study' };
  expect(collectionHasChanges({ ...original }, original)).toBe(false);
  expect(collectionHasChanges({ ...original, descriptionProperty: 'Updated study' }, original)).toBe(true);
});

it('prioritizes named settings buckets and uses sparcd as legacy fallback', () => {
  expect(settingsBucketCandidates(['unrelated', 'sparcd', 'sparcd-settings-z', 'sparcd-settings-a'])).toEqual([
    'sparcd-settings-a', 'sparcd-settings-z', 'sparcd',
  ]);
});

it('matches collection assignments case-insensitively and detects non-key changes', () => {
  const assigned = [{ scientificName: ' Puma concolor ', name: 'Old name' }];
  const registry = [{ scientificName: 'puma concolor', name: 'Mountain lion' }];
  expect(assignmentDiscrepancies('species', assigned, registry)).toHaveLength(1);
  expect(sharedHasId('species', assigned[0], registry)).toBe(true);
  expect(sharedHasId('locations', { idProperty: 'old' }, [{ idProperty: 'new' }])).toBe(false);
});

it('exposes an applied-audit retry that succeeds after a transient failure', async () => {
  let attempts = 0;
  const client = { writeImmutable: async () => { attempts += 1; if (attempts === 1) throw new Error('temporary failure') } } as any;
  const retry = makeAppliedAuditRetry(client, 'sparcd-test', 'audit.applied.json', { eventId: 'event-1' }, 'etag-1');
  await expect(retry()).rejects.toThrow('temporary failure');
  await expect(retry()).resolves.toBeUndefined();
  expect(attempts).toBe(2);
});

describe('repeated location IDs in the shared list (bug 3)', () => {
  const shared = [
    { idProperty: 'A', nameProperty: 'North gate', latProperty: 1 },
    { idProperty: 'A', nameProperty: 'South gate', latProperty: 2 },
  ];

  it('offers no update when the ID alone cannot say which site is meant', () => {
    expect(assignmentDiscrepancies('locations', [{ idProperty: 'A', nameProperty: 'Old ridge' }], shared)).toEqual([]);
    expect(matchShared('locations', { idProperty: 'A', nameProperty: 'Old ridge' }, shared)).toBeNull();
  });

  it('updates from the site whose name also matches', () => {
    const found = assignmentDiscrepancies('locations', [{ idProperty: 'A', nameProperty: 'South gate' }], shared);
    expect(found).toHaveLength(1);
    expect(found[0].truth).toBe(shared[1]);
  });
});

describe('collection checklist', () => {
  const shared = [
    { scientificName: 'Canis latrans', name: 'Coyote' },
    { scientificName: 'Puma concolor', name: 'Puma' },
    { scientificName: 'Lynx rufus', name: 'Bobcat', retired: true },
  ];

  it('ticks the shared entries this collection uses and counts the active ones', () => {
    const rows = checklistRows('species', [shared[1]], shared);
    expect(rows.map((row) => [row.label, row.usedIndex >= 0, row.status])).toEqual([
      ['Coyote', false, 'active'],
      ['Puma', true, 'active'],
    ]);
    expect(activeCount(shared)).toBe(2);
  });

  it('keeps retired and unlisted entries visible while they are still in use', () => {
    const rows = checklistRows('species', [shared[2], { scientificName: 'Gone away', name: 'Ghost' }], shared);
    expect(rows.filter((row) => row.status !== 'active').map((row) => [row.label, row.status])).toEqual([
      ['Bobcat', 'retired'],
      ['Ghost', 'unlisted'],
    ]);
  });
});
