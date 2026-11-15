import { z } from 'zod';
import type { BattleDraft } from '../api.js';
import { Binary, endpoint, Upload } from '../contract.js';

// The Roster and Battle import: pictures of the game's screens that an agent reads, queued and reviewed before anything is saved.

/** The screens a roster import can read. */
export type ImportScreen = 'info' | 'battle' | 'hall' | 'recap' | 'suggestion' | 'report';

export interface ImportHeroState {
  rank: string | null;
  equipmentLevel: number | null;
}

export interface ImportRow {
  /** The tile's key: its picture is at `rosterImportTileUrl`. */
  tile: string;
  hero: string;
  direction: 'new' | 'upgrade' | 'downgrade';
  from: ImportHeroState;
  to: ImportHeroState;
  selected: boolean;
  /** What the rank reader said, when it was sure. */
  reader: { rank: string; support: number; agrees: boolean } | null;
  /** The hero came from a saved look. */
  look: { agrees: boolean } | null;
  check: ('hero' | 'rank' | 'stars' | 'not-owned')[];
}

export interface ImportSection {
  index: number;
  playerName: string | null;
  profile: { id: number; name: string } | null;
  rename: string | null;
  create: string | null;
  rows: ImportRow[];
  unknown: { tile: string; candidates: string[]; rank: string | null }[];
  withoutRank: { tile: string; hero: string }[];
}

export interface ImportJob {
  id: number;
  state: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  screen: ImportScreen;
  label?: string | null;
  sections?: ImportSection[];
  /** Tile key to the hero the player chose for it. */
  chosen?: Record<string, string>;
}

export interface RosterImportState {
  canRead: boolean;
  reason: string | null;
  busy: boolean;
  /** The picture under review (the first of the queue). */
  job: ImportJob | null;
  /** Every picture given, in order, the first being `job`. */
  queue: { id: number; label: string | null; state: ImportJob['state']; screen: ImportScreen; error?: string }[];
}

/** A picture given to the Battle import, and what was read of it once done. */
export interface BattleImportPicture {
  id: number;
  /** What identifies the picture across restarts (a hash of it), to keep the player's edits with it. */
  key?: string;
  label: string | null;
  state: 'queued' | 'running' | 'done' | 'failed';
  error?: string;
  draft?: BattleDraft;
  /** The artifact and phantimal crops of each side as PNG data URLs, fetched when the picture is opened in the form (the server forgets the picture then). */
  cropData?: Record<'A' | 'B', ImportFeedbackSide['crops']>;
  /** The picture itself as a data URL, fetched with the crops, to keep with the saved fight (ADR 0016); null when it could not be fetched. */
  original?: string | null;
}

/** One side of a battle read from a picture: what the Agent said, what the player kept, and the crops. */
export interface ImportFeedbackSide {
  read: ImportReading;
  final: ImportReading;
  crops: {
    artifact: string | null;
    phantimal: string | null;
    /** The tile of each hero the reading named, and of each hero tile it did not name (hero null), as PNG data URLs: what a correction teaches the hero and rank readers. */
    tiles?: { hero: string | null; png: string }[];
  };
  /** Heroes whose rank in the form may only be what a profile's roster filled in: not taken as a correction. */
  skipRank?: string[];
}

export interface ImportReading {
  heroes: { hero: string; rank: string | null; equipmentLevel: number | null }[];
  artifact: { name: string | null; level: number | null } | null;
  phantimal: string | null;
}

export interface BattleImportState {
  canRead: boolean;
  reason: string | null;
  busy: boolean;
  queue: BattleImportPicture[];
}

export interface ImportApplySection {
  profileId?: number | null;
  create?: string | null;
  rename?: string | null;
  changes: { hero: string; rank: string; equipmentLevel: number | null; tile?: string }[];
  looks: string[];
}

const State = z.custom<RosterImportState | BattleImportState>();
const Job = z.custom<ImportJob>();

const SECTION_MESSAGE = 'Unknown section';
const TARGET_MESSAGE = 'Choose a profile, a new profile or the match';
/** Where one player's heroes go; whether the section and the profile exist is checked against the import. */
export const TargetBody = z.object(
  {
    section: z.number({ error: SECTION_MESSAGE }).int(SECTION_MESSAGE),
    target: z.discriminatedUnion(
      'kind',
      [z.object({ kind: z.literal('profile'), id: z.number().catch(-1) }), z.object({ kind: z.literal('new') }), z.object({ kind: z.literal('match') })],
      { error: TARGET_MESSAGE },
    ),
  },
  { error: SECTION_MESSAGE },
);
/** The hero picked for a tile, or null to go back to the Agent's reading. */
export const ChooseBody = z.object({ tile: z.string({ error: 'Unknown tile' }), hero: z.string({ error: 'Unknown hero' }).nullable() }, { error: 'Unknown tile' });
/** The sections to apply; each is checked one by one against the import, the profiles and the rules. */
export const ApplyBody = z.object({ sections: z.array(z.unknown(), { error: 'Send the sections to apply' }) }, { error: 'Send the sections to apply' });

const text = z.string().optional();

export const rosterImportContract = {
  /** The pictures of one kind of import: a Roster import's, or with `kind=report` a Battle import's (they share the queue but not the review). */
  state: endpoint({ method: 'GET', path: '/api/roster-import', query: z.object({ kind: text }), response: State }),
  /** Queues a picture (its raw bytes are the body) and answers at once with the job. */
  start: endpoint({
    method: 'POST',
    path: '/api/roster-import',
    query: z.object({ screen: text, profile: text, mode: text, name: text, fresh: text }),
    body: Upload,
    response: Job,
    status: 202,
  }),
  /** Throws the proposal under review away, or the pictures not read yet (`waiting`), or the ones named (`ids`). */
  dismiss: endpoint({ method: 'DELETE', path: '/api/roster-import', query: z.object({ kind: text, waiting: text, ids: text, keep: text }), response: z.undefined(), status: 204 }),
  retry: endpoint({ method: 'POST', path: '/api/roster-import/:id/retry', response: Job, status: 202 }),
  cancel: endpoint({ method: 'POST', path: '/api/roster-import/:id/cancel', response: z.object({ state: z.string() }) }),
  picture: endpoint({ method: 'GET', path: '/api/roster-import/:id/picture', response: Binary }),
  /** One tile of a finished import; `frame=top` is the tile as the readers learn it. */
  tile: endpoint({ method: 'GET', path: '/api/roster-import/:id/tile/:key', query: z.object({ frame: text }), response: Binary }),
  target: endpoint({ method: 'POST', path: '/api/roster-import/:id/target', body: TargetBody, response: z.custom<ImportSection>() }),
  choose: endpoint({ method: 'POST', path: '/api/roster-import/:id/choose', body: ChooseBody, response: z.object({ sections: z.array(z.custom<ImportSection>()), chosen: z.record(z.string(), z.string()) }) }),
  apply: endpoint({
    method: 'POST',
    path: '/api/roster-import/:id/apply',
    body: ApplyBody,
    response: z.object({ applied: z.array(z.object({ profileId: z.number(), created: z.boolean(), changed: z.number(), looks: z.number(), rankLooks: z.number() })) }),
  }),
};
