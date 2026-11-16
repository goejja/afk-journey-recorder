import { readRank, type RankExample } from '../vision/rank-read.js';

/** What the rank reader did with a set of looks, each read from all the others: right, wrong, or not sure enough to name a rank. */
export interface ReaderTally {
  probes: number;
  correct: number;
  wrong: number;
  unread: number;
}

/** Which looks a count is about: the ones already saved, or the ones a battle report proposes. */
export type LookGroup = 'known' | 'proposed';

/** For each filed rank, how often the reader named each rank (null when it was not sure). */
export type ReadAs = Map<string, Map<string | null, number>>;

export interface ReaderScore {
  overall: ReaderTally;
  byRank: Map<string, ReaderTally>;
  /** What the looks of each rank were read as, apart for the known and the proposed looks. */
  readAs: Record<LookGroup, ReadAs>;
}

export interface ProposalCheck {
  before: ReaderScore;
  after: ReaderScore;
  /** Looks the reader named right before the proposed looks and names wrong with them, and the rank it names now. */
  confused: { rank: string; index: number; group: LookGroup; readAs: string }[];
  /** Why the proposal must not be applied, or null when it may. */
  refused: string | null;
}

const empty = (): ReaderTally => ({ probes: 0, correct: 0, wrong: 0, unread: 0 });
const emptyScore = (): ReaderScore => ({ overall: empty(), byRank: new Map(), readAs: { known: new Map(), proposed: new Map() } });

/** The rank the reader names for a look among the others: null when it is not sure. */
function answer(probe: RankExample, among: RankExample[]): string | null {
  const reading = readRank(probe.features, among);
  return reading?.confident ? reading.rank : null;
}

const tally = (score: ReaderScore, rank: string, group: LookGroup, answered: string | null) => {
  const answers = score.readAs[group].get(rank) ?? score.readAs[group].set(rank, new Map()).get(rank)!;
  answers.set(answered, (answers.get(answered) ?? 0) + 1);
  for (const t of [score.overall, score.byRank.get(rank) ?? score.byRank.set(rank, empty()).get(rank)!]) {
    t.probes++;
    if (answered === null) t.unread++;
    else if (answered === rank) t.correct++;
    else t.wrong++;
  }
};

/**
 * Reads every look, the known ones and the proposed ones, from all the other looks, once with the known looks alone and once with the proposed
 * looks added (ADR 0012 measured the reader this way). The same looks are read in both, so the two scores compare. A proposal is refused when the
 * reader names a wrong rank more often with it, or when a look it read right is now read wrong.
 */
export function checkProposal(known: RankExample[], proposed: RankExample[]): ProposalCheck {
  const before = emptyScore();
  const after = emptyScore();
  const confused: ProposalCheck['confused'] = [];
  const all = [...known, ...proposed];
  for (const [index, probe] of all.entries()) {
    const others = (list: RankExample[]) => list.filter((e) => e !== probe);
    const was = answer(probe, others(known));
    const now = answer(probe, others(all));
    const group: LookGroup = index < known.length ? 'known' : 'proposed';
    tally(before, probe.rank, group, was);
    tally(after, probe.rank, group, now);
    if (was === probe.rank && now !== null && now !== probe.rank) confused.push({ rank: probe.rank, index, group, readAs: now });
  }
  let refused: string | null = null;
  if (after.overall.wrong > before.overall.wrong) refused = `the reader would name ${after.overall.wrong} wrong ranks instead of ${before.overall.wrong}`;
  else if (confused.length > 0) refused = `${confused.length} looks read right now would be read wrong`;
  return { before, after, confused, refused };
}

export type SkipReason = 'unnamed' | 'not-on-side' | 'named-twice' | 'no-rank' | 'roster';

export interface PairedTile {
  index: number;
  hero: string;
  rank: string;
}

/**
 * Pairs the tiles of a picture's side with the heroes of the saved record's side. `named` is the hero the local reader gave each tile (null when
 * it was not sure). A tile is paired when its hero is on the record's side and no other tile of the picture was given that hero. A hero with no
 * rank in the record, or whose rank is the one a roster holds (`rosterRank`, the form's own rule: choosing a profile may have filled it in), is skipped.
 */
export function pairTiles(named: (string | null)[], side: { hero: string; rank: string | null }[], rosterRank: ReadonlyMap<string, string>): { paired: PairedTile[]; skipped: Map<SkipReason, number> } {
  const skipped = new Map<SkipReason, number>();
  const skip = (reason: SkipReason) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const paired: PairedTile[] = [];
  for (const [index, hero] of named.entries()) {
    if (hero === null) skip('unnamed');
    else if (named.filter((h) => h === hero).length > 1) skip('named-twice');
    else {
      const rows = side.filter((h) => h.hero === hero);
      if (rows.length !== 1) skip('not-on-side');
      else if (rows[0]!.rank === null) skip('no-rank');
      else if (rosterRank.get(hero) === rows[0]!.rank) skip('roster');
      else paired.push({ index, hero, rank: rows[0]!.rank });
    }
  }
  return { paired, skipped };
}
