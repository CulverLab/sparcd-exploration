// Legacy registry retained only as a broad test fixture, never an app fallback.
import { readFileSync } from 'node:fs';
import { parseSpecies } from '../../src/lib/species';
export const DEFAULT_SPECIES = parseSpecies(readFileSync(new URL('./defaultSpecies.json', import.meta.url), 'utf8')).species;
