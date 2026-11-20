/** The page of the app that lists and edits the records of a mode: Stages, Dream Hunt, or PvP for every other mode. */
export type RecordPage = 'stages' | 'dreamHunt' | 'arena';

/** A stored record's `attempt.mode`, as the Stages and Dream Hunt pages keep it; every other mode is a PvP one. */
export const recordPage = (mode: string): RecordPage | null => {
  if (mode === '') return null;
  if (mode === 'Stage') return 'stages';
  if (mode === 'Dream Hunt') return 'dreamHunt';
  return 'arena';
};

/** The address that opens a record's edit form on its page (`#arena?record=12`), or null when its mode names no page. */
export const recordLink = (mode: string, id: number): string | null => {
  const page = recordPage(mode);
  return page === null ? null : `#${page}?record=${id}`;
};

/** The record a page address names (`#arena?record=12`), or null when it names none. */
export const recordOfHash = (hash: string): number | null => {
  if (!hash.includes('?')) return null;
  const id = Number(new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('record'));
  return Number.isInteger(id) && id > 0 ? id : null;
};
