import { useCallback, useEffect, useState } from 'react';
import { roundWarnings, type Round } from '../../src/domain/tournament.js';
import { api, type ArenaMode, type Tournament } from '../backend.js';
import { lastChoices, nameOf, rememberChoices, type ImportRound, type ImportStart } from '../reader/battle-import-edits.js';

/**
 * The Tournament and Round a batch of Super League pictures is for (ADR 0020): the Tournaments, the one chosen (the latest to start
 * with, or where the wizard stood when it was closed), and what is remembered in the browser. `chosen` is null unless the mode is Super League.
 */
export function useRoundChoice(mode: ArenaMode, restore: ImportStart | undefined, attempt: (action: () => Promise<unknown>) => Promise<void>) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [tournamentId, setTournamentId] = useState<number | null>(null);
  const [round, setRound] = useState<Round>('Group stage');
  const [season, setSeason] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ number: string } | null>(null);

  const pickTournament = useCallback((all: Tournament[], id: number | null, keepRound?: Round | null) => {
    const picked = all.find((t) => t.id === id) ?? all[0] ?? null;
    setTournamentId(picked?.id ?? null);
    if (picked) setRound(keepRound ?? picked.rounds.at(-1) ?? 'Group stage');
  }, []);

  // only when the wizard opens: `restore` is where it stood when it was closed, not a value to follow
  const [before] = useState(() => restore ?? lastChoices());
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([api.tournaments(), api.seasons()]).then(
      ([all, seasons]) => {
        if (!live) return;
        setTournaments(all);
        pickTournament(all, before.tournamentId ?? null, before.round && all.some((t) => t.id === before.tournamentId) ? before.round : null);
        setSeason(seasons.find((s) => s.current)?.number ?? seasons[0]?.number ?? null);
      },
      (e: Error) => live && setProblem(`The Tournaments and Seasons could not be read: ${e.message}`),
    );
    return () => void (live = false);
  }, [before, pickTournament]);

  useEffect(() => rememberChoices({ mode, tournamentId, round }), [mode, tournamentId, round]);

  const picked = tournaments.find((t) => t.id === tournamentId);
  const chosen: ImportRound | null = mode === 'Super League' && picked ? { tournamentId: picked.id, round, label: nameOf(picked) } : null;
  const warnings = chosen ? roundWarnings({ tournamentId: chosen.tournamentId, round }, tournaments) : [];

  /** Opens the form for a new Tournament, with the next number of the current season (the season itself is not asked for). */
  const startAdding = () => setAdding(adding ? null : { number: String(Math.max(0, ...tournaments.filter((t) => t.season === season).map((t) => t.number)) + 1) });
  const addTournament = () =>
    attempt(async () => {
      if (!adding) return;
      const all = await api.addTournament({ number: Number(adding.number) });
      setTournaments(all);
      pickTournament(all, all.find((t) => t.season === season && t.number === Number(adding.number))?.id ?? null);
      setAdding(null);
    });

  // Told only for Super League: the other modes have no Tournament to be missing. Without them a Super League batch has none to be saved in.
  return { problem: mode === 'Super League' ? problem : null, tournaments, tournamentId, round, setRound, pickTournament: (id: number) => pickTournament(tournaments, id), adding, setAdding, startAdding, addTournament, chosen, warnings };
}
