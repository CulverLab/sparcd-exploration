export { Connection } from './Connection';
export type { ConnectionProps } from './Connection';
export { BrandSwitcher } from './BrandSwitcher';
export type { BrandSwitcherProps } from './BrandSwitcher';
export { ConnectionChip } from './ConnectionChip';
export type { ConnectionChipProps } from './ConnectionChip';
export { OfflineBanner } from './OfflineBanner';
export type { OfflineBannerProps } from './OfflineBanner';
export { useOnline } from './useOnline';
export {
  loadPersistedConnection,
  loadSessionConnection,
  saveSharedConnection,
  clearSharedConnection,
  subscribeSharedConnection,
} from './session';
export type { PersistedConnection } from './session';
export { loadSharedTheme, saveSharedTheme } from './theme';
export type { Theme } from './theme';
export {
  loginIdentityPreferenceKey,
  loadLoginIdentity,
  loadLoginIdentityPreference,
  saveLoginIdentity,
  saveLoginIdentityDefault,
  subscribeLoginIdentityChanges,
} from './loginIdentity';
export type { LoginIdentityChange, LoginIdentityPreference } from './loginIdentity';
export {
  KEYBINDING_STORAGE_KEY,
  MAX_SPECIES_SOURCES,
  emptyRevisionedProfile,
  keyProfileId,
  mergeAndWriteRevisionedProfiles,
  mergeRevisionedProfiles,
  nextKeyProfileRevision,
  readRevisionedProfiles,
} from './speciesKeyProfiles';
export type {
  RevisionedKeyProfile,
  RevisionedKeyProfiles,
  SpeciesDiff,
  SpeciesKeyConfig,
  SpeciesListState,
} from './speciesKeyProfiles';

export { fetchWhoAmI, WhoAmIError, type WhoAmIResult } from './whoami';
