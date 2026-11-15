import { useEffect, useState } from 'react';
import { api, type Hero } from '../backend.js';

type Side = 'A' | 'B';

/**
 * The roster of the profile chosen for each side of a battle, so heroes placed later take that profile's rank and equipment. The
 * rosters of the profiles a form opens with (found from the Player IDs of a cloned or edited battle) are loaded once; choosing another
 * profile later sets its roster with the setter. A roster already set is kept: the answer to the first load never replaces it.
 */
export function useProfileRosters(opening: Record<Side, number | null>) {
  const [rosters, setRosters] = useState<Record<Side, Hero[] | null>>({ A: null, B: null });
  const [first] = useState(opening);
  useEffect(() => {
    let current = true;
    for (const side of ['A', 'B'] as const) {
      const id = first[side];
      if (id !== null) api.heroes(id).then((roster) => current && setRosters((old) => ({ ...old, [side]: old[side] ?? roster })), () => undefined);
    }
    return () => {
      current = false;
    };
  }, [first]);
  return [rosters, setRosters] as const;
}
