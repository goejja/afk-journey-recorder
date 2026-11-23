import { api, type GameMap } from '../backend.js';
import { useLoad } from './load.js';

const NO_MAPS: GameMap[] = [];

/** The maps, empty until they load. `error` says why they did not (the editors then show no map), for the page to show with its other errors. */
export function useMaps(): { maps: GameMap[]; error: string | null } {
  const loaded = useLoad(() => api.maps(), []);
  return { maps: loaded.data ?? NO_MAPS, error: loaded.error && `The maps could not be read: ${loaded.error}` };
}
