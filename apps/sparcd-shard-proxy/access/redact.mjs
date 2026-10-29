// Coordinate-bearing storage objects are redacted at the access boundary.
// The browser still receives names, identifiers, elevation, and deployment
// relationships, but never the precise latitude/longitude values.

const LOCATION_KEYS = new Set(['Settings/locations.json']);

export function coordinateObjectKind(key) {
  if (LOCATION_KEYS.has(key)) return 'locations';
  if (!key?.startsWith('Collections/')) return null;
  const name = key.split('/').at(-1);
  if (name === 'locations.json') return 'locations';
  if (name === 'deployments.csv') return 'deployments';
  if (name === 'UploadComplete.json') return 'upload-complete';
  return null;
}

export function shouldRedactCoordinates({ person, isSettings, membership, key }) {
  return !person?.admin
    && (isSettings || !membership?.exactLocations)
    && coordinateObjectKind(key) !== null;
}

export function redactLocationJson(text) {
  const value = JSON.parse(text);
  const entries = Array.isArray(value) ? value : value && Array.isArray(value.locations) ? value.locations : null;
  if (!entries) throw new Error('locations.json is not an array');
  const redacted = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    return { ...entry, latProperty: null, lngProperty: null };
  });
  return JSON.stringify(Array.isArray(value) ? redacted : { ...value, locations: redacted });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (quoted) throw new Error('deployments.csv has an unterminated quoted field');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell !== ''));
}

const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function redactDeploymentsCsv(text) {
  return parseCsv(text).map((row) => {
    if (row.length < 5) throw new Error('deployments.csv row has too few columns');
    const redacted = [...row];
    redacted[3] = '';
    redacted[4] = '';
    return redacted.map(quote).join(',');
  }).join('\n') + (text.length > 0 ? '\n' : '');
}

export function redactUploadComplete(text, opaqueValue) {
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('UploadComplete.json is not an object');
  }
  if (typeof value.metadataBundleSha256 === 'string') {
    value.metadataBundleSha256 = opaqueValue(value.metadataBundleSha256);
  }
  return JSON.stringify(value);
}

/** Compare the fields a coordinate-restricted reader can see on UploadComplete.
 * The private metadata digest must never decide a response status because that
 * would turn a create retry into an oracle for guessed digest values.
 */
export function sameUploadCompletePublicFields(leftText, rightText) {
  const comparable = (text) => {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.metadataBundleSha256 !== 'string') return null;
    delete value.metadataBundleSha256;
    const sortKeys = (item) => {
      if (Array.isArray(item)) return item.map(sortKeys);
      if (item && typeof item === 'object') {
        return Object.fromEntries(Object.keys(item).sort().map((name) => [name, sortKeys(item[name])]));
      }
      return item;
    };
    return JSON.stringify(sortKeys(value));
  };

  try {
    const left = comparable(leftText);
    return left !== null && left === comparable(rightText);
  } catch {
    return false;
  }
}

/** Refill a restricted member's coordinate-free deployments write from the
 * exact shared location registry. A row must resolve to exactly one current
 * entry by ID, name, and elevation; ambiguous or stale assignments fail shut.
 */
export function completeDeploymentsCoordinates(text, locations) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('deployments.csv has no rows');
  return rows.map((row) => {
    if (row.length < 13 || row[3] !== '' || row[4] !== '') {
      throw new Error('deployments.csv must omit both coordinates');
    }
    const locationId = row[1]?.trim();
    const locationName = row[2]?.trim();
    const elevation = Number(row[12]);
    if (!locationId || !locationName || !Number.isFinite(elevation)) {
      throw new Error('deployment does not identify a location');
    }
    const matches = locations.filter((entry) =>
      entry?.idProperty === locationId
      && entry?.nameProperty === locationName
      && Number(entry?.elevationProperty) === elevation
      && Number.isFinite(entry?.lngProperty)
      && Number.isFinite(entry?.latProperty));
    if (matches.length !== 1) throw new Error('deployment location is not uniquely defined');
    const complete = [...row];
    complete[3] = Number(matches[0].lngProperty).toFixed(6);
    complete[4] = Number(matches[0].latProperty).toFixed(6);
    return complete.map(quote).join(',');
  }).join('\n') + '\n';
}

export function redactCoordinateBody(key, text, opaqueValue = () => null) {
  const kind = coordinateObjectKind(key);
  if (kind === 'locations') return redactLocationJson(text);
  if (kind === 'deployments') return redactDeploymentsCsv(text);
  if (kind === 'upload-complete') return redactUploadComplete(text, opaqueValue);
  return text;
}

export function isCoordinateFreeDeployments(text) {
  try {
    const rows = parseCsv(text);
    return rows.length > 0 && rows.every((row) => row.length >= 5 && row[3] === '' && row[4] === '');
  } catch {
    return false;
  }
}
