import { useReference } from '../hooks/load.js';
import { api } from '../backend.js';
import { type PatchReference } from './draft.js';
import { Battles } from './FightList.js';
import { Notice } from '../ui/Notice.js';

export function ArenaPage() {
  const loaded = useReference({
    maps: api.maps,
    heroes: api.heroes,
    artifacts: api.artifacts,
    rules: api.bossRules,
    heroRules: api.rules,
    phantimals: api.phantimals,
    defaults: api.defaults,
    profiles: api.profiles,
  });
  const patchReference: PatchReference = loaded.patch;

  return (
    <div>
      {loaded.error && (
        <Notice kind="error">
          {loaded.error}
        </Notice>
      )}
      {loaded.data && <Battles reference={loaded.data} patchReference={patchReference} />}
    </div>
  );
}
