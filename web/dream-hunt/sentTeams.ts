import { useCallback, useEffect, useState } from 'react';
import type { LayoutSummary } from '../../src/domain/dream-hunt.js';
import { api, type Composition } from '../backend.js';
import { formationFromRecord, type FormationState } from '../FormationEditor.js';

/** A team sent to the Simulator from Best teams or the Finder: kept on its shelf until the player pins or removes it. */
export interface SentTeam {
  key: string;
  /** The boss it was fought against, so the shelf can suggest that boss's fight. */
  boss: string;
  mapName: string;
  formation: FormationState;
}

const STORAGE_KEY = 'afk.simulator.sentTeams';

/** A team on a Layout is one entry; a team sent without a Layout is its fastest one. */
const sentKey = (composition: Composition, layout?: LayoutSummary) => `${composition.key}|${(layout ?? composition.layouts[0])?.key ?? ''}`;

function load(): SentTeam[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((t) => t && typeof t.key === 'string' && t.formation?.placed) : [];
  } catch {
    return [];
  }
}

/**
 * The Simulator's shelf of Sent teams. It lives with the Dream Hunt page, so it survives a change of tab, and in `localStorage`, so it
 * survives a reload; it is not stored in the database and a new week does not clear it.
 */
export function useSentTeams() {
  const [sent, setSent] = useState<SentTeam[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sent));
    } catch {
      // private window or blocked storage: the shelf just lasts as long as the page
    }
  }, [sent]);

  /** Sends a team on one of its Layouts, or on its fastest one; sending what is already on the shelf does nothing. */
  const send = useCallback(async (boss: string, composition: Composition, layout?: LayoutSummary) => {
    const key = sentKey(composition, layout);
    const fight = await api.dreamHuntAttempt(layout?.latestAttemptId ?? composition.layouts[0]?.latestAttemptId ?? composition.latestAttemptId);
    setSent((old) => (old.some((t) => t.key === key) ? old : [...old, { key, boss, mapName: fight.mapName, formation: formationFromRecord(fight.formation) }]));
  }, []);

  const remove = useCallback((key: string) => setSent((old) => old.filter((t) => t.key !== key)), []);
  const has = useCallback((composition: Composition, layout?: LayoutSummary) => sent.some((t) => t.key === sentKey(composition, layout)), [sent]);

  return { sent, send, remove, has };
}
