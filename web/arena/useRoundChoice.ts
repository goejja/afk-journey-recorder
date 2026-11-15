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
  const [adding, setAdding] = useState<{ season: string; number: string } | null>(null);

  const pickTournament = useCallback((all: Tournament[], id: number | null, keepRound?: Round | null) => {
    const picked = all.find((t) => t.id === id) ?? all[0] ?? null;
    setTournamentId(picked?.id ?? null);
    if (picked) setRound(keepRound ?? picked.rounds.at(-1) ?? 'Group stage');
  }, []);

  // only when the wizard opens: `restore` is where it stood when it was closed, not a value to follow
  const [before] = useState(() => restore ?? lastChoices());
  useEffect(() => {
    api.tournaments().then((all) => {
      setTournaments(all);
      pickTournament(all, before.tournamentId ?? null, before.round && all.some((t) => t.id === before.tournamentId) ? before.round : null);
    }, () => undefined);
    api.seasons().then((all) => setSeason(all.find((s) => s.current)?.number ?? all[0]?.number ?? null), () => undefined);
  }, [before, pickTournament]);

  useEffect(() => rememberChoices({ mode, tournamentId, round }), [mode, tournamentId, round]);

  const picked = tournaments.find((t) => t.id === tournamentId);
  const chosen: ImportRound | null = mode === 'Super League' && picked ? { tournamentId: picked.id, round, label: nameOf(picked) } : null;
  const warnings = chosen ? roundWarnings({ tournamentId: chosen.tournamentId, round }, tournaments) : [];

  /** Opens the form for a new Tournament, with the current season and the next number. */
  const startAdding = () => setAdding(adding ? null : { season: String(season ?? ''), number: String(Math.max(0, ...tournaments.filter((t) => t.season === season).map((t) => t.number)) + 1) });
  const addTournament = () =>
    attempt(async () => {
      if (!adding) return;
      const all = await api.addTournament({ season: Number(adding.season), number: Number(adding.number) });
      setTournaments(all);
      pickTournament(all, all.find((t) => t.season === Number(adding.season) && t.number === Number(adding.number))?.id ?? null);
      setAdding(null);
    });

  return { tournaments, tournamentId, round, setRound, pickTournament: (id: number) => pickTournament(tournaments, id), adding, setAdding, startAdding, addTournament, chosen, warnings };
}
