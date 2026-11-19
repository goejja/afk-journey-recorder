import { useCallback, useEffect, useRef, useState } from 'react';
import { kindOfLaneId, laneKey } from '../../src/domain/stage-grid.js';
import type { StageKind } from '../../src/domain/stage.js';

/** What the owner changed by hand on the Stages page; it lives in the page address (`#stages?phase=2&open=2:apex-normal`). */
export interface PageState {
  phase: number | null;
  /** Lanes the owner opened or closed, whatever the rules say, as `phase:lane`. */
  open: string[];
  closed: string[];
}

function read(): PageState {
  const hash = window.location.hash.slice(1);
  const query = new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
  const phase = Number(query.get('phase'));
  const lanes = (name: string) => (query.get(name) ?? '').split(',').filter((key) => /^[1-3]:/.test(key) && kindOfLaneId(key.slice(2)) !== undefined);
  return { phase: [1, 2, 3].includes(phase) ? phase : null, open: lanes('open'), closed: lanes('closed') };
}

function write(state: PageState): void {
  const query = new URLSearchParams();
  if (state.phase !== null) query.set('phase', String(state.phase));
  if (state.open.length) query.set('open', state.open.join(','));
  if (state.closed.length) query.set('closed', state.closed.join(','));
  const text = query.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#stages${text ? `?${text}` : ''}`);
}

const without = (list: string[], key: string) => list.filter((k) => k !== key);
const with_ = (list: string[], key: string) => [...without(list, key), key];

/** The page state, read from the address when the page opens and written back whenever the owner changes it. Plain `#stages` is the defaults. */
export function usePageState() {
  const [state, setState] = useState<PageState>(read);
  // Written from an effect, not from the updater, which React may run twice; what was read from the address is not written back.
  const written = useRef(state);
  useEffect(() => {
    if (written.current === state) return;
    written.current = state;
    write(state);
  }, [state]);
  const change = useCallback((next: (old: PageState) => PageState) => setState(next), []);
  const choosePhase = useCallback((phase: number) => change((old) => ({ ...old, phase })), [change]);
  /** Sets a lane open or closed by hand, whatever the rules say. */
  const setLane = useCallback(
    (phase: number, kind: StageKind, open: boolean) =>
      change((old) => {
        const key = laneKey(phase, kind);
        return open ? { ...old, open: with_(old.open, key), closed: without(old.closed, key) } : { ...old, closed: with_(old.closed, key), open: without(old.open, key) };
      }),
    [change],
  );
  return { state, choosePhase, setLane };
}
