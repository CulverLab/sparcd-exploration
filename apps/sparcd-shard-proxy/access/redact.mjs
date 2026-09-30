// Coordinate-bearing storage objects are redacted at the access boundary.
// The browser still receives names, identifiers, elevation, and deployment
// relationships, but never the precise latitude/longitude values.

const LOCATION_KEYS = new Set(['Settings/locations.json']);
const COLLECTION_LOCATIONS = /^Collections\/[^/]+\/locations\.json$/;
const DEPLOYMENTS = /^Collections\/[^/]+\/Uploads\/[^/]+\/(?:\.sparcd-tagger-snapshots\/[^/]+\/[^/]+\/)?deployments\.csv$/;

export function coordinateObjectKind(key) {
  if (LOCATION_KEYS.has(key) || COLLECTION_LOCATIONS.test(key)) return 'locations';
  if (DEPLOYMENTS.test(key)) return 'deployments';
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

export function redactCoordinateBody(key, text) {
  const kind = coordinateObjectKind(key);
  if (kind === 'locations') return redactLocationJson(text);
  if (kind === 'deployments') return redactDeploymentsCsv(text);
  return text;
}

export function isCoordinateFreeDeployments(text) {
  try {
    return parseCsv(text).every((row) => row.length >= 5 && row[3] === '' && row[4] === '');
  } catch {
    return false;
  }
}
