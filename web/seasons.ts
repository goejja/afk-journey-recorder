import { DEFAULT_CURRENT_SEASON } from '../src/domain/season.js';
import { api } from './backend.js';
import { useLoad } from './hooks/load.js';

/** The season set as current in Admin > General; until it has loaded (or if it cannot), the built-in default. */
export function useCurrentSeason(): number {
  const { data } = useLoad(() => api.seasons(), []);
  return data?.find((s) => s.current)?.number ?? DEFAULT_CURRENT_SEASON;
}
