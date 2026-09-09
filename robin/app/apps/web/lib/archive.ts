const ARCHIVE_SEGMENTS = new Set(['archive', 'archives', 'archived']);

/** Whether a vault-relative path belongs to an archive segment. */
export function isArchivePath(relPath: string): boolean {
  return relPath.split(/[\\/]/).some((part) => ARCHIVE_SEGMENTS.has(part.toLowerCase()));
}

/** Whether a directory entry is one of the reserved archive directories. */
export function isArchiveDirectoryName(name: string): boolean {
  return ARCHIVE_SEGMENTS.has(name.toLowerCase());
}
