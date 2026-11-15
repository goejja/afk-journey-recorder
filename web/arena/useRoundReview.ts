import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoundDeploymentEntry } from '../backend.js';
import type { RoundTeam } from '../../src/domain/round-deployment.js';
import type { ImportGroup } from '../reader/battle-import.js';
import { coverageNotice, type BatchOptions, type ImportRound } from '../reader/battle-import-edits.js';

/** A team a picture shows differently from the Round Deployment (ADR 0021). */
export interface TeamChange {
  profileId: number;
  slot: number;
  team: RoundTeam;
  who: string;
}

/** What the form says about the groups of a Round. */
export interface RoundReview {
  /** Why each group (by key) cannot be saved without a look. */
  problems: Record<string, string[]>;
  /** What was taken from a Round Deployment although the picture read otherwise, by group. */
  info: Record<string, string[]>;
  /** The Round Deployments of the Tournament and Round, confirmed and as saved Battles show them. */
  deployments: RoundDeploymentEntry[];
  /** Teams a picture shows differently from the Round Deployment, by group. */
  changes: Record<string, TeamChange[]>;
}

/**
 * The batch table of a Super League Round: which battles can be saved as they are (ADR 0020), worked out again when the pictures
 * or choices change (a key of just what the check looks at) or when `recheck` is called after a confirmation or a repair.
 */
export function useRoundReview({ groups, chosen, reuse, onReview }: { groups: ImportGroup[]; chosen: ImportRound | null; reuse: boolean; onReview?: (groups: ImportGroup[], options: BatchOptions) => Promise<RoundReview> }) {
  const [review, setReview] = useState<{ problems: RoundReview['problems'] | null } & Omit<RoundReview, 'problems'>>({ problems: null, info: {}, deployments: [], changes: {} });
  const [version, setVersion] = useState(0);
  const key = useMemo(
    () => JSON.stringify([chosen?.tournamentId, chosen?.round, reuse, groups.map((g) => [g.key, g.pictures.map((p) => [p.id, p.draft.number, p.draft.sideA.profile?.id ?? null, p.draft.sideB.profile?.id ?? null])])]),
    [groups, chosen?.tournamentId, chosen?.round, reuse],
  );
  // the check reads the latest groups and callback, but only a change of `key` or `version` runs it again
  const latest = useRef({ groups, chosen, reuse, onReview });
  latest.current = { groups, chosen, reuse, onReview };
  useEffect(() => {
    const { groups: now, chosen: round, reuse: reusing, onReview: check } = latest.current;
    if (!round || !check) return setReview((old) => ({ ...old, problems: null }));
    let current = true;
    check(now, { reuse: reusing, round, groups: now }).then(
      (found) => current && setReview(found),
      () => current && setReview((old) => ({ ...old, problems: null })),
    );
    return () => {
      current = false;
    };
  }, [key, version]);

  const ready = review.problems ? groups.filter((g) => (review.problems![g.key] ?? ['not checked']).length === 0 && coverageNotice(g) === null) : [];
  return { ...review, ready, recheck: () => setVersion((v) => v + 1) };
}

/**
 * Back from the form after a save, the next battle that needs a look opens by itself, so the Round goes on without the table. Waits for
 * the queue to be read and, in Super League, for the check.
 */
export function useOpenNext({ initial, queueLoaded, busy, reading, groups, superLeague, problems, open }: { initial: boolean; queueLoaded: boolean; busy: boolean; reading: boolean; groups: ImportGroup[]; superLeague: boolean; problems: Record<string, string[]> | null; open: (group: ImportGroup) => void }) {
  const [pending, setPending] = useState(initial);
  const opening = useRef(open);
  opening.current = open;
  useEffect(() => {
    if (!pending || !queueLoaded || busy || reading) return;
    if (groups.length === 0) return setPending(false);
    if (superLeague && !problems) return;
    setPending(false);
    const next = groups.find((g) => coverageNotice(g) === null && (!superLeague || (problems?.[g.key] ?? []).length > 0)) ?? (superLeague ? undefined : groups[0]);
    if (next) opening.current(next);
  }, [pending, queueLoaded, busy, reading, groups, superLeague, problems]);
}
