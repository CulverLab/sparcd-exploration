import { describe, expect, it } from 'vitest';
import { sourceFolderCopy, summarizeSourceFolders } from '../src/lib/sourceFolders';

describe('selected source folder names', () => {
  it('uses one selected top-level folder instead of a nested directory', () => {
    const summary = summarizeSourceFolders([
      'WHE19_09.28.26_119.images/camera-1/IMG_001.JPG',
      'WHE19_09.28.26_119.images/camera-2/IMG_002.JPG',
    ]);
    expect(summary).toEqual({ names: ['WHE19_09.28.26_119.images'], unknownCount: 0 });
    expect(sourceFolderCopy(summary)).toEqual({
      beforeNames: 'Original files remain in your folder named: ',
      names: ['WHE19_09.28.26_119.images'],
      afterNames: '.',
    });
  });

  it('lists distinct selected top-level folders in stable order', () => {
    const summary = summarizeSourceFolders([
      'WHE20/camera/IMG_001.JPG',
      'WHE19/IMG_002.JPG',
      'WHE20/IMG_003.JPG',
    ]);
    expect(summary).toEqual({ names: ['WHE19', 'WHE20'], unknownCount: 0 });
    expect(sourceFolderCopy(summary)).toEqual({
      beforeNames: 'Original files remain in the folders named: ',
      names: ['WHE19', 'WHE20'],
      afterNames: '.',
    });
  });

  it('does not mistake a loose filename for a folder name', () => {
    const summary = summarizeSourceFolders(['IMG_001.JPG', 'IMG_002.JPG']);
    expect(summary).toEqual({ names: [], unknownCount: 1 });
    expect(sourceFolderCopy(summary)).toEqual({
      beforeNames: 'Original files remain in your folder. Could not determine the source folder name.',
      names: [],
      afterNames: '',
    });
  });

  it('counts unknown roots once when combining them with known folder names', () => {
    const summary = summarizeSourceFolders([
      'WHE19/IMG_001.JPG',
      'IMG_002.JPG',
      'IMG_003.JPG',
    ]);
    expect(summary).toEqual({ names: ['WHE19'], unknownCount: 1 });
    expect(sourceFolderCopy(summary)).toEqual({
      beforeNames: 'Original files remain in the folders named: ',
      names: ['WHE19'],
      afterNames: ', and the name of 1 other folder could not be determined.',
    });
  });

  it('uses plural wording when more than one selected root name is unknown', () => {
    expect(sourceFolderCopy({ names: ['WHE19'], unknownCount: 2 })).toEqual({
      beforeNames: 'Original files remain in the folders named: ',
      names: ['WHE19'],
      afterNames: ', and the names of 2 other folders could not be determined.',
    });
  });

  it('uses plural count-aware fallback when all selected folder names are unknown', () => {
    expect(sourceFolderCopy({ names: [], unknownCount: 3 })).toEqual({
      beforeNames: 'Original files remain in the selected folders; the names of 3 folders could not be determined.',
      names: [],
      afterNames: '',
    });
  });
});
