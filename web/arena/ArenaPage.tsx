import { useCallback, useEffect, useState } from 'react';
import { api } from '../backend.js';
import { type Reference } from './draft.js';
import { Battles } from './BattleList.js';

export function ArenaPage() {
  const [reference, setReference] = useState<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [maps, heroes, artifacts, rules, heroRules, phantimals, defaults, profiles] = await Promise.all([api.maps(), api.heroes(), api.artifacts(), api.bossRules(), api.rules(), api.phantimals(), api.defaults(), api.profiles()]);
      setReference({ maps, heroes, artifacts, rules, heroRules, phantimals, defaults, profiles });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {reference && <Battles reference={reference} />}
    </div>
  );
}
