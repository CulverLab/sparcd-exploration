export type SourceFolderSummary = {
  /** Distinct selected top-level folder names, in stable alphabetical order. */
  names: string[];
  /** Unidentified source roots represented by the current batch. */
  unknownCount: number;
};

/**
 * Recover selected root folder names from the relative paths produced by the
 * folder picker, File System Access API, and directory drag/drop. A path with
 * no parent component is not a folder name; never mistake its filename for one.
 */
export function summarizeSourceFolders(paths: readonly string[]): SourceFolderSummary {
  const names = new Set<string>();
  let hasUnidentifiedRoot = false;

  for (const path of paths) {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    if (parts.length > 1) names.add(parts[0]);
    else hasUnidentifiedRoot = true;
  }

  return {
    names: [...names].sort((a, b) => a.localeCompare(b)),
    // Flat paths cannot tell us which folder they came from. Treat the
    // unidentified portion as one source group instead of counting files.
    unknownCount: hasUnidentifiedRoot ? 1 : names.size === 0 && paths.length > 0 ? 1 : 0,
  };
}

export type SourceFolderCopy = {
  beforeNames: string;
  names: string[];
  afterNames: string;
};

/** Return the status-line copy and emphasized names for a saved preparation. */
export function sourceFolderCopy(summary: SourceFolderSummary): SourceFolderCopy {
  const { names, unknownCount } = summary;
  if (names.length === 1 && unknownCount === 0) {
    return {
      beforeNames: 'Original files remain in your folder named: ',
      names,
      afterNames: '.',
    };
  }
  if (names.length > 1 && unknownCount === 0) {
    return {
      beforeNames: 'Original files remain in the folders named: ',
      names,
      afterNames: '.',
    };
  }
  if (names.length === 0 && unknownCount <= 1) {
    return {
      beforeNames: 'Original files remain in your folder. Could not determine the source folder name.',
      names: [],
      afterNames: '',
    };
  }
  if (names.length === 0) {
    return {
      beforeNames: `Original files remain in the selected folders; the names of ${unknownCount} folders could not be determined.`,
      names: [],
      afterNames: '',
    };
  }

  const unknownCopy = unknownCount === 1
    ? 'the name of 1 other folder could not be determined.'
    : `the names of ${unknownCount} other folders could not be determined.`;
  return {
    beforeNames: 'Original files remain in the folders named: ',
    names,
    afterNames: `, and ${unknownCopy}`,
  };
}
