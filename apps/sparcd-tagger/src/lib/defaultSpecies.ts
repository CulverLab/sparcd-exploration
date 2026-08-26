// The species vocabulary for a local batch. `useSpecies` reads
// `Settings/species.json` out of the settings bucket, which a batch being tagged
// before it has ever been uploaded cannot reach — requirement A1's whole point
// is that Anita has no connection yet. So SPARC'd's own registry travels with
// the app: this is a verbatim copy of `Settings/species.json` from the upstream
// CulverLab/sparcd repository, parsed through the same validator as the live one.

import raw from '../assets/defaultSpecies.json?raw';
import { parseSpecies, type Species } from './species';

export const DEFAULT_SPECIES: Species[] = parseSpecies(raw).species;
