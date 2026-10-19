// The explorer's data layer: plain functions over plain objects, no React.

export { accountKey, readClient, type ReadClient } from './s3';
export { createLimiter, type Limiter } from './limit';
export {
  ExplorerDb,
  UPLOAD_FILES,
  type LoadedUpload,
  type ReadProblem,
  type UploadFile,
} from './cache';
export {
  REQUESTS_IN_FLIGHT,
  discoverCollections,
  openCollections,
  readCachedCollection,
  syncCollection,
  type LoadedCollection,
  type OpenProgress,
  type OpenStep,
  type Source,
} from './open';
export {
  DEFAULT_SPECIES,
  SpeciesShapeError,
  fetchSpecies,
  parseSpecies,
  speciesNamer,
  type Species,
  type SpeciesName,
} from './species';
export { LocationsShapeError, fetchLocations, parseLocations, registryKey, type RegistryLocation } from './locations';
export { NoSettingsBucketError } from './settings';
export {
  NO_LOCATION_KEY,
  NO_LOCATION_NAME,
  buildModel,
  locationKeyOf,
  type CollectionInfo,
  type Detection,
  type Model,
  type Photo,
  type Site,
  type Upload,
} from './model';
export {
  NO_FILTERS,
  activeFilters,
  applyFilters,
  clearFilter,
  isFiltered,
  photosForTag,
  resetFilters,
  type Box,
  type FilterDimension,
  type FilterResult,
  type FilterState,
  type PhotoTag,
} from './filters';
export {
  detectionRows,
  hexBins,
  locationRows,
  photoRows,
  speciesRows,
  summarize,
  type DetectionRow,
  type HexBin,
  type LocationRow,
  type PhotoRow,
  type SpeciesRow,
  type Summary,
} from './views';
export {
  checkBadTimestamps,
  checkHiddenUploads,
  checkMoved,
  checkNearDuplicateIds,
  checkNoCoordinates,
  checkNoLocation,
  checkSharedLocations,
  checkUnreadable,
  dataChecks,
  type DataCheck,
} from './checks';
export {
  DEFAULT_PRECISION,
  EXACT_SITES_HOST,
  canShowExactSites,
  displayPosition,
  elevationIn,
  formatDegrees,
  formatUtm,
  reduceDegrees,
  reduceMetres,
  sitePosition,
  toUtm,
  type ElevationUnit,
  type Position,
  type Precision,
  type Utm,
} from './coords';
export { HEX_SIZE_DEG, hexCenter, hexGrid, hexOf, hexRing, type HexGrid } from './hex';
export { isNoLocation, mountainRange, normalizeLocationId } from './locationIds';
export { dayNumber, formatTimestamp24, parseLocalTimestamp, type LocalTime } from './time';
