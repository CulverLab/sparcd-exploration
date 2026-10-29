export function settingsBucketCandidates(visibleBuckets: string[]) {
  return visibleBuckets
    .filter((bucket) => bucket.startsWith('sparcd-settings-') || bucket === 'sparcd')
    .sort((a, b) => {
      const rank = (bucket: string) => bucket.startsWith('sparcd-settings-') ? 0 : 1
      return rank(a) - rank(b) || a.localeCompare(b)
    })
}
