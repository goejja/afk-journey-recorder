import { api, type GameMap } from './backend.js';
import { useLoad } from './useLoad.js';

const NO_MAPS: GameMap[] = [];

/** The maps, empty until they load (a failed load just leaves them empty: the boards then show no map). */
export function useMaps(): GameMap[] {
  return useLoad(() => api.maps(), []).data ?? NO_MAPS;
}
