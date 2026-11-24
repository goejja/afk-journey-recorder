import type { ArenaMode } from '../domain/arena.js';
// The JSON shapes the HTTP API sends and receives, shared by the server (src/server) and the web app (web/backend.ts).
import type { AdvisorPlan } from './advisor.js';
import type { DefaultMode, DefaultSlot } from '../domain/defaults.js';
import type { EquipmentCap, HeroStateRules } from '../domain/hero-state.js';
import type { LayoutSummary, RuleTimes } from '../domain/dream-hunt.js';
import type { LayoutUnit } from '../domain/layout.js';
import type { FormationJson } from './contracts/formation.js';
import type { Attempt, StageKey } from './contracts/stages.js';
import type { Round } from '../domain/tournament.js';

export interface FormationInput {
  /** rank and equipmentLevel are sent only when editing a saved record, to keep what it stored. */
  heroes: { tile: number; hero: string; part?: string; rank?: string | null; equipmentLevel?: number | null }[];
  phantimal: { tile: number; name: string; partnerTile?: number | null } | null;
  assistHero: string | null;
  assistRank?: string | null;
  assistEquipmentLevel?: number | null;
  artifact: string | null;
  /** The Formation ID the player gave this formation, if any; the server keeps it in the library. */
  formationId?: string | null;
}

export interface DreamHuntAttempt {
  id: number;
  createdAt: string;
  /** The season the record was played in (ADR 0038), set when it was saved. */
  season: number;
  outcome: 'Win' | 'Loss';
  note: string | null;
  boss: string;
  mapName: string;
  timeSeconds: number | null;
  bossRule: string | null;
  tags: string[];
  /** The day's battle this fight is part of and its number in it; null for a fight on its own. */
  battleId: number | null;
  battlePosition: number | null;
  /** The Formation ID of the whole day; null for a fight on its own, which carries its own. */
  battleFormationId: string | null;
  formation: Attempt['formation'];
}

export interface Composition {
  key: string;
  heroes: string[];
  artifact: string | null;
  attempts: number;
  clears: number;
  clearRate: number;
  bestSeconds: number | null;
  medianSeconds: number | null;
  meanSeconds: number | null;
  worstSeconds: number | null;
  lowConfidence: boolean;
  /** The newest fight of this team, whose formation `latest` is. */
  latestAttemptId: number;
  latest: Attempt['formation'];
  layouts: LayoutSummary[];
  /** Under Rule = Any the figures above are those of the fights with no Rule, and these are the fights under a Rule (null when there are none). */
  rule: RuleTimes | null;
}

export interface Leaderboard {
  boss: string;
  include: string[];
  exclude: string[];
  rule: string;
  attempts: number;
  compositions: Composition[];
}

/** The Finder's answer: the compositions holding every included hero and none of the excluded ones, per boss, the boss with the most fights first. */
export interface FinderResult {
  include: string[];
  exclude: string[];
  rule: string;
  attempts: number;
  bosses: { boss: string; attempts: number; compositions: Composition[] }[];
}

export interface Advice {
  bosses: string[];
  /** The day of the latest game update, null when none is set. */
  updateDate: string | null;
  /** The plans over the fights since the Update date alone; null without a date. */
  since: { reliable: AdvisorPlan; fastest: AdvisorPlan } | null;
  /** The plans over all fights, those since the Update date first. */
  reliable: AdvisorPlan;
  fastest: AdvisorPlan;
}

export interface StageAttemptInput {
  stageId: number;
  buffLevel: number | null;
  note: string;
  tags?: string[];
  formation: FormationInput;
}

export interface StageRangeInput extends Omit<StageKey, 'number'> {
  from: number;
  to: number;
  /** The map of the stages in the range that are not stored yet. */
  mapName: string;
  buffLevel: number | null;
  note: string;
  tags?: string[];
  formation: FormationInput;
}

export interface DreamHuntInput {
  boss: string;
  mapName: string;
  outcome: 'Win' | 'Loss';
  timeSeconds: number | null;
  bossRule: string | null;
  note: string;
  tags?: string[];
  /** The fight's number in its day, when saved as part of one. */
  position?: number;
  formation: FormationInput;
}

export interface CleanupRequest {
  mode?: string;
  olderThanDays: number;
  tag?: string;
}

export interface CleanupPreview {
  count: number;
  oldest: string | null;
  newest: string | null;
}

export interface ScenarioHero {
  tile: number;
  name: string;
  /** '' for a hero alone; see src/domain/units.ts. */
  part: string;
  rank: string | null;
  equipmentLevel: number | null;
}

export interface Scenario {
  id: number;
  name: string;
  mode: ArenaMode;
  note: string | null;
  estimate: string | null;
  estimateAt: string | null;
  createdAt: string;
  updatedAt: string;
  slots: { position: number; mapName: string; rule: string | null; mine: ScenarioHero[]; enemy: ScenarioHero[] }[];
}

export interface GeneratedTeam {
  position: number;
  map: string | null;
  enemy: string[];
  against?: string;
  /** `source` says where the tile came from: pinned, a record on this map, a suggestion, or none. */
  team: { hero: string; tile: number | null; pinned: boolean; source?: 'pinned' | 'recorded' | 'map' | 'engine' | null; reason?: PlacementReason | null; role?: string | null; alternatives?: Swap[] }[] | null;
  /** Every Unit the team fields, both parts of a pair and the summons included (ADR 0028). */
  units?: LayoutUnit[];
  artifact?: string | null;
  phantimal?: { name: string; tile: number | null; partnerTile?: number } | null;
  /** Played as it is, a one-hero swap of a played team, or built from the statistics of an Archetype and never played. */
  origin?: 'recorded' | 'variant' | 'built';
  chance?: number;
  evidence?: 'win-score' | 'guess' | 'pinned';
  score?: { estimate: number; low: number; high: number; interval: string } | null;
  effectiveSample?: number;
  comparableFights?: number;
  recordedGames?: number;
  notes?: string[];
  note?: string;
  /** The Formation groups that beat the group this team's enemy looks like, from the owner's own PvP records (a hint, never part of the Win Score). */
  pastCounters?: PastCounters;
  /** The Placement Rules of the proposed team and whether its tiles satisfy them (ADR 0036). A preference, never part of the Win Score. */
  rules?: PlacementRuleLine[];
  /** What the skills of the known enemy team reach, from the enemy's own back edge. A reading, not a reason to change the proposal. */
  enemyRules?: EnemyRuleLine[];
  /** Rows where a proposed tile lost clearly more than the same hero in alike teams, from the records of all Players (a hint, ADR 0036). */
  layoutHints?: LayoutHint[];
  /** The mix of Role labels (the Prydwen roles of Admin > Units) of the proposed team; null counts the heroes with no role. A description, never a reason to change the heroes (ADR 0036). */
  roleMix?: { role: string | null; count: number }[];
}

interface PlacementRuleLine {
  hero: string;
  relation: 'behind' | 'mirror' | 'rearmost' | 'sameRow' | 'farthest';
  effect: 'protects' | 'boosts' | 'other';
  wantsRole: string | null;
  satisfied: boolean;
  note: string;
  source: string;
}

interface EnemyRuleLine extends Omit<PlacementRuleLine, 'satisfied'> {
  /** The enemy unit the skill reaches, or null when no unit stands there. */
  reaches: { hero: string; part: string; tile: number } | null;
  /** Whether that unit has the role the rule wants; null when the rule wants none or reaches nobody. */
  roleMet: boolean | null;
}

/** Why a hero stands where it does, with the source of the claim (never a skill description). */
interface PlacementReason {
  source: 'recorded' | 'pinned' | 'engine' | 'rule';
  text: string;
}

/** A free roster hero offered in place of another, with the Win Score of the swapped team; `small` below 5 comparable battles. */
interface Swap {
  hero: string;
  chance: number;
  delta: number;
  evidence: 'win-score' | 'guess';
  effectiveSample: number;
  comparableFights: number;
  small: boolean;
  tile: number | null;
}

/** The Counter Advisor's answer: up to three sets of teams, one team each. */
/** A stored record whose Phantimal its own heroes cannot have brought, most likely a misread in a Battle import (ADR 0029). */
export interface FactionMismatch {
  attemptId: number;
  side: 'A' | 'B';
  mode: string;
  mapName: string | null;
  phantimal: string;
  problem: string;
}

export interface CounterAdvice {
  mode: ArenaMode;
  sets: { matchChance: number; teams: GeneratedTeam[] }[];
  notes: string[];
}

/** A formation of the Player behind a Profile, already turned to stand on the enemy half. */
export interface OpponentFormation {
  /** Every Unit of the formation, both parts of a pair and the summons included (ADR 0028). */
  heroes: { hero: string; part?: string; tile: number }[];
  phantimal?: { name: string; tile: number; partnerTile?: number } | null;
  map: string | null;
  artifact: string | null;
  games: number;
  wins: number;
}

export interface GeneratedFormation {
  scenario: { id: number | null; name: string; mode: ArenaMode };
  matchChance: number | null;
  matchChanceFromGuesses: boolean | null;
  teams: GeneratedTeam[];
  /** Up to three sets of teams, best first, each differing from the others by at least two heroes in a team. The first is `teams`. */
  sets: { matchChance: number; teams: GeneratedTeam[] }[];
  notes: string[];
}

export interface ScenarioInput {
  name: string;
  mode: ArenaMode;
  note: string;
  slots: {
    mapName: string;
    rule: string | null;
    mine: { tile: number; hero: string; part?: string }[];
    enemy: { tile: number; hero: string; part?: string; rank: string | null; equipmentLevel: number | null }[];
  }[];
}

interface AgentTool {
  installed: boolean;
  path: string | null;
  version: string | null;
  models: string[] | null;
  modelsError?: string;
}

export interface AgentSettings {
  preset: string;
  model: string;
  timeoutMinutes: number;
  presets: string[];
  /** What the last look found, by preset; empty until Admin has looked. */
  tools: Record<string, AgentTool>;
}

export interface AgentJob {
  state: 'idle' | 'running' | 'done' | 'failed';
  error?: string;
}

export interface HeroStat {
  hero: string;
  games: number;
  wins: number;
  winRate: number;
  /** The share of all sides (in the same filter) that fielded the hero. */
  pickRate: number;
}

export interface ArtifactStat {
  artifact: string;
  games: number;
  wins: number;
  winRate: number;
}

/** Side A's results on a map. */
export interface MapStat {
  map: string;
  games: number;
  wins: number;
  winRate: number;
}

/** A hero's results in one row of the team, counted from the back edge of its own side (1 is the back row). */
export interface RowStat {
  row: number;
  games: number;
  wins: number;
  winRate: number;
}

/** How many Players fielded a hero at each rank and equipment level, from each Player's latest record with a rank. */
export interface HeroDistribution {
  hero: string;
  /** The Players who fielded the hero, including the `unknown` ones whose records name no rank. */
  players: number;
  unknown: number;
  /** Highest rank first. A rank with no equipment has a null level. */
  cells: { rank: string; equipmentLevel: number | null; players: number }[];
}

/** A Player (a Player ID on a side of a PvP record) with their own side's results and the formations they fielded most. */
export interface PlayerStat {
  playerId: string;
  /** The Profile that has this Player ID now; null when none does. */
  name: string | null;
  games: number;
  wins: number;
  winRate: number;
  modes: string[];
  first: string;
  last: string;
  formations: FormationStat[];
}

/** A set of heroes fielded together on one side (positions, artifacts, ranks ignored) with how it did. */
interface FormationStat {
  heroes: string[];
  games: number;
  wins: number;
  winRate: number;
}

/** Formations that differ by one hero: the core they share, and each variant with its other heroes. */
export interface GroupHero {
  hero: string;
  share: number;
}

export interface FormationGroupStat {
  core: GroupHero[];
  flex: GroupHero[];
  games: number;
  wins: number;
  winRate: number;
  players: number;
  variants: (FormationStat & { flex: string[] })[];
}

interface EvidenceLabel {
  name: string;
  detail?: string;
}

export interface RateRecord {
  games: number;
  wins: number;
  winRate: number;
}

/** A Formation group of the report: its record against the average of all sides, its most used artifact and its evidence labels. */
export interface FormationGroupRow extends FormationGroupStat {
  vsAverage: number;
  artifact: { artifact: string; share: number } | null;
  labels: EvidenceLabel[];
}

/** Groups that share two or more core heroes, under one row. A row with one group is that group alone. */
export interface ArchetypeStat {
  core: GroupHero[];
  flex: GroupHero[];
  games: number;
  wins: number;
  winRate: number;
  players: number;
  groups: FormationGroupRow[];
}

export interface FormationReport {
  /** The win rate of all sides under the filters. */
  baseline: number;
  rows: ArchetypeStat[];
}

interface PlacedHero {
  hero: string;
  tile: number | null;
  share: number;
  games: number;
  secondChoice: boolean;
}

export interface PlacementMap extends RateRecord {
  map: string;
  heroes: PlacedHero[];
}

export interface FormationProfileStat extends FormationGroupRow {
  artifacts: (RateRecord & { artifact: string; share: number })[];
  variations: (RateRecord & { flex: string[] })[];
  otherFormations: (RateRecord & { heroes: string[] })[];
  heroImpact: { hero: string; with: RateRecord; without: RateRecord }[];
  strongAgainst: (RateRecord & { enemy: string[] })[];
  weakAgainst: (RateRecord & { enemy: string[] })[];
  gapRecords: Record<'ahead' | 'near' | 'behind' | 'unknown', { games: number; wins: number }>;
  gapAdjustment: { games: number; shift: number } | null;
  placement: PlacementMap[];
}

/** A hero fielded on the same side as another, with the games of those sides and its share of the other hero's games. */
export interface PartnerStat {
  hero: string;
  games: number;
  wins: number;
  winRate: number;
  share: number;
}

/** One hero's own record and the heroes fielded with it: team membership only, not the target of a skill. */
export interface PartnerReport {
  hero: string;
  games: number;
  wins: number;
  winRate: number;
  partners: PartnerStat[];
}

/** An ally that stood in a relation to a hero at the start of the fight, with the games and the evidence behind it. */
export interface PositionalPartnerStat extends PartnerStat {
  /** Distinct Players and distinct exact layouts of the sides behind these games. */
  players: number;
  layouts: number;
  /** At least 5 games and half or more of them in one exact layout: one repeated formation, not several. */
  oneLayout: boolean;
}

/** Who stood where in relation to one hero: team positions, not the target of a skill. */
export interface PositionalPartnerReport {
  hero: string;
  relation: string;
  /** The sides that held the hero, and how many of them had nobody in that place. */
  games: number;
  wins: number;
  winRate: number;
  empty: number;
  partners: PositionalPartnerStat[];
}

/** A mechanic tag of the unit info with the heroes that carry it. */
export interface PartnerTag {
  tag: string;
  heroes: string[];
}

/** A list of rows cut to the best ones, with how many there were before the cut. */
export interface StatRows<T> {
  rows: T[];
  total: number;
}

export interface PairStat {
  heroA: string;
  heroB: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface TrioStat {
  heroA: string;
  heroB: string;
  heroC: string;
  games: number;
  wins: number;
  winRate: number;
}

export interface Summary {
  records: { mode: string; records: number; wins: number; first: string; last: string }[];
  tags: { tag: string; records: number }[];
}

export type { ArenaMode };

export interface OpponentInput {
  heroes: { tile: number; hero: string; part?: string; rank: string | null; equipmentLevel: number | null }[];
  assistHero: string | null;
  assistRank: string | null;
  assistEquipmentLevel: number | null;
  phantimal?: { tile: number; name: string; partnerTile?: number | null } | null;
  artifact: string | null;
  formationId?: string | null;
}

export interface ArenaFight {
  id: number;
  mode: ArenaMode;
  createdAt: string;
  /** The season the record was played in (ADR 0038), set when it was saved. */
  season: number;
  outcome: 'Win' | 'Loss';
  note: string | null;
  mapName: string;
  rule: string | null;
  /** Guild Duel only: the Union Level of each side, when known. */
  unionLevel: number | null;
  opponentUnionLevel: number | null;
  tags: string[];
  /** Tags of one side: the player behind it. */
  /** The Player behind each side, by the game's Player ID; null when the side has none. */
  playerIdA: string | null;
  playerIdB: string | null;
  /** The battle this fight is part of and its team number in it; null for a fight on its own. */
  battleId: number | null;
  battlePosition: number | null;
  /** The Formation ID of each side for the teams of the whole battle; null for a fight on its own, which carries its own. */
  battleFormationId: string | null;
  battleOpponentFormationId: string | null;
  /** The Tournament and Round of the battle (Super League only); null for older battles. */
  tournamentId: number | null;
  round: Round | null;
  formation: FormationJson;
  opponent: FormationJson;
}

/** The Formation ID of each side for the teams of a whole battle, as typed (an empty text clears it). */
export interface BattleFormationIds {
  formationId: string;
  /** Side B, in the PvP modes. */
  opponentFormationId?: string;
}

/** How the Win Score is tuned, with the defaults it falls back to. */
export interface ScoreSettingsValues {
  minEffectiveSample: number;
  strongerSnapshotWeight: number;
  priorStrength: number;
  minSimilarity: number;
}
/** The modes the Statistics page starts with; an empty list means every mode. */
export type ScoreSettingsView = ScoreSettingsValues & { defaults: ScoreSettingsValues };

export type { DefaultMode, DefaultSlot };

/** The Tournament and Round a Super League battle is saved in; `null` for both clears them. */
export type BattleRound = { tournamentId: number; round: Round } | { tournamentId: null; round: null };

/** A Battle of a PvP mode: the teams (Fights) of one Supreme Arena, Super League or Guild Duel game, saved together. */
export interface ArenaBattle {
  id: number;
  fights: ArenaFight[];
}

export interface ArenaFightInput {
  mode: ArenaMode;
  mapName: string;
  rule: string | null;
  outcome: 'Win' | 'Loss';
  note: string;
  tags?: string[];
  playerIdA?: string | null;
  playerIdB?: string | null;
  /** The team's number in its battle, when saved as part of one. */
  position?: number;
  formation: FormationInput;
  opponent: OpponentInput;
}

export type Rules = HeroStateRules & { caps: EquipmentCap[] };


/** One hero read from a battle report, with the state the picture shows when it was sure of it. */
export interface DraftHero {
  /** The tile's key in the import: its picture is at `/api/roster-import/:id/tile/:key`. */
  tile: string;
  hero: string;
  rank: string | null;
  equipmentLevel: number | null;
  /** Set when the Agent said it was not sure of this hero, with the heroes it might be instead. */
  unsure?: boolean;
  candidates?: string[];
}

export interface FightDraftSide {
  /** The name as the game shows it. */
  name: string | null;
  /** The Profile with that name, when there is one: its Player ID goes on the side. */
  profile: { id: number; name: string; playerId: string | null } | null;
  heroes: DraftHero[];
  /** The artifact the report shows for this side, with its level; a null name or level is one the Agent could not read. */
  artifact: { name: string | null; level: number | null } | null;
  /** The phantimal under the side's heroes, when the report shows one and the Agent named it. */
  phantimal: string | null;
  /** The keys of the crops of the artifact and the phantimal, served like the tiles, when the report was cut for them. */
  crops: { artifact: string; phantimal: string } | null;
  /** The keys of the tiles that show a hero (not an empty slot) which nobody named: a hero the player adds in the form may be one of them. */
  unread: string[];
  /** For the unread tiles the Agent had guesses for, the heroes it thought they might be, by the tile's key. */
  unreadCandidates?: Record<string, string[]>;
}

/** What one picture of a PvP battle report says, as the start of a record. Nothing here is saved. */
export interface FightDraft {
  mode: ArenaMode;
  /** The fight's number in its battle, or null when the report has none. */
  number: number | null;
  /** The result for Side A (the ally, on the left), or null when the Agent could not tell. */
  outcome: 'Win' | 'Loss' | null;
  unionLevelA: number | null;
  unionLevelB: number | null;
  sideA: FightDraftSide;
  sideB: FightDraftSide;
  /** A saved fight of this mode with the same heroes on both sides and the same result. */
  duplicateOf: { id: number; createdAt: string } | null;
}

/** Where a learned picture came from (ADR 0027). */
export type LookSource = 'roster' | 'battle' | 'offline' | 'review';

export interface ReaderExample {
  kind: 'example' | 'look';
  id: number;
  createdAt: string;
  /** The hero the reader would give this tile if it were not an example, when that is another hero: a hint that it was assigned wrongly. */
  looksLike: string | null;
  /** Where the tile came from; null for one saved before that was kept. */
  source: LookSource | null;
}

export interface ReaderHero {
  hero: string;
  examples: ReaderExample[];
}

export interface ReaderView {
  heroes: ReaderHero[];
  withoutExamples: number;
}

/** A picture the rank reader or the artifact and phantimal readers learnt from, with a hint when it looks misfiled. */
export interface LearnedLook {
  id: number;
  createdAt: string;
  source: LookSource | null;
  /** The rank the other Rank Looks would read this one as, when that is another rank and the reader is sure of it. */
  looksLike: string | null;
}

export interface LearnedRank {
  rank: string;
  looks: LearnedLook[];
  /** The rank reader names a rank only once it has seen it enough times (`MIN_EXAMPLES`). */
  readable: boolean;
}

export interface LearnedUnit {
  kind: 'artifact' | 'phantimal';
  name: string;
  looks: LearnedLook[];
}

export interface LearnedAccuracy {
  source: string;
  screen: string;
  field: string;
  readings: number;
  agreed: number;
  agreedPercent: number;
}

export interface LearnedView {
  ranks: LearnedRank[];
  units: LearnedUnit[];
  accuracy: LearnedAccuracy[];
  /** How many pictures each source added, over the hero, rank and unit tables; the ones saved before the source was kept are not listed. */
  sources: { source: LookSource; count: number }[];
  /** The names a look can be moved to. */
  choices: { heroes: string[]; ranks: string[]; artifacts: string[]; phantimals: string[] };
}

/** What Thinning proposes for one kind of learned picture (the Review tab): per group, the pictures that stay and the ones to remove. */
export interface ThinningKind {
  kind: 'rank';
  /** The pictures now and after the removals offered, and how many the reader names wrongly reading each from the others, now and after. */
  counts: { looks: number; looksAfter: number; wrong: number; wrongAfter: number };
  groups: { group: string; keep: number[]; remove: number[] }[];
}

export interface ThinningProposal {
  kinds: ThinningKind[];
}

/** One thing the Reader review found, by code from the readers' data (ADR 0031). `subject` is what it is about: a rank, a hero, a Rank Look id, a record id or a file. */
export interface ReviewFinding {
  code: string;
  subject: string;
  message: string;
  /** In a stored run: the run before it did not have this finding. */
  new?: boolean;
  /** The record the finding links to; a record is history and never changed by the review. */
  recordId?: number;
  /** The mode of that record, which names the page that opens it. */
  mode?: string;
  /** For a Rank Look: the rank it is filed under and the rank the others read it as. */
  filedUnder?: string;
  readAs?: string;
}

/** What a category of pictures kept for a purpose holds, shown for the player to judge. */
interface ReviewKept {
  category: string;
  files: number;
  bytes: number;
  /** YYYY-MM-DD */
  oldest: string;
}

export interface ReviewFindings {
  wrong: ReviewFinding[];
  obsolete: ReviewFinding[];
  improve: ReviewFinding[];
  kept: ReviewKept[];
}

/** A Review run: the findings of one look at the readers' data, kept with its date (ADR 0032). */
export interface ReviewRun {
  id: number;
  createdAt: string;
  findings: ReviewFindings;
  /** The findings of this run that the player dismissed, left out of `findings`. */
  dismissed: ReviewFinding[];
  /** What the Agent wrote about this run when asked, and when. */
  explanation: { text: string; at: string | null } | null;
}

/** The Agent's job of explaining a Review run: running, done (the explanation is on the run) or failed. */
export interface ReviewExplainJob {
  runId: number;
  state: 'running' | 'done' | 'failed';
  error?: string;
}

/** The pictures of one kind of import (a Roster import or a Battle import) in the queue, in short: how many wait or are read, how many failed, how many are read. */
export interface ImportQueueSummary {
  /** Queued or being read. */
  active: number;
  failed: number;
  done: number;
  /** Changes whenever the id or the state of any picture in the queue does, so a page that shows the queue knows when to ask for it again. */
  signature: string;
}

/** The background work of the app, for one poll: the scenario runs (by scenario id), the Review explanation, and the two picture queues. */
export interface JobsSummary {
  scenarios: Record<string, AgentJob>;
  review: ReviewExplainJob | null;
  roster: ImportQueueSummary;
  battle: ImportQueueSummary;
}

/** A row where a proposed hero's tile fell that lost clearly more than the same hero in alike teams, from the records of all Players. */
export interface LayoutHint {
  hero: string;
  /** The game row of the proposed tile, counted from the back edge. */
  row: number;
  games: number;
  wins: number;
  winRate: number;
  /** The games and win rate of the hero in all alike teams, whatever row it stood in. */
  poolGames: number;
  poolWinRate: number;
  players: number;
  layouts: number;
  /** Rows where the hero did at least as well as in the alike teams, from enough games and Players. */
  betterRows: { row: number; games: number; winRate: number; players: number }[];
  /** The hint as a sentence, with its source and sample, ready to quote. */
  text: string;
}

/** A record where a hero the player expects at the back of its side has a hero behind it that is not expected there (#221). */
export interface BackCheckRow {
  attemptId: number;
  side: 'A' | 'B';
  mode: string;
  mapName: string | null;
  hero: string;
  tile: number;
  /** The game row the hero stands in, counted from the back edge of its side (1 = back). */
  gameRow: number;
  /** The heroes standing behind it that are not expected at the back, rearmost first. */
  behind: string[];
  /** How many sides the hero stood in that game row, and how many of them won: context only. */
  gamesInRow: number;
  winsInRow: number;
}

/** The placement check: the rows, and how many heroes would have been listed but stand on a Boost tile of their map (#220), which puts them there on purpose. */
export interface BackCheck {
  rows: BackCheckRow[];
  onBoostTile: number;
}

/** A record where the hero farthest from Dunlingr is not a Damage dealer or a Support by Prydwen's Role (#222). */
export interface DunlingrCheckRow {
  attemptId: number;
  side: 'A' | 'B';
  mode: string;
  mapName: string | null;
  /** Dunlingr's tile. */
  tile: number;
  /** The hero farthest from him, and its Prydwen Role (null: unknown). */
  farthest: string;
  role: string | null;
  /** The other heroes as far from him as the farthest one: the pick between them is a guess. */
  tiedWith: string[];
}

/** The Dunlingr check: the rows, how many of his PvP sides have a hero farthest from him and how many of those have the right Role (context), and how many rows stand out on a Boost tile (#220). */
export interface DunlingrCheck {
  rows: DunlingrCheckRow[];
  records: number;
  boosted: number;
  onBoostTile: number;
}

/** A hero's own record against its Prydwen tier hint (ADR 0036): the default profile's PvP sides only, a pointer and not a result. */
export interface TierCheck {
  hero: string;
  pvpTier: string;
  games: number;
  wins: number;
  winRate: number;
  ownAverage: number;
  vsAverage: number;
  /** A low tier that wins clearly more than the owner's average, or a high tier that wins clearly less. */
  flag: 'outperforms' | 'underperforms' | null;
  /** Fewer than 5 games. */
  anecdote: boolean;
  text: string;
}

// The routes that are described as contracts (src/shared/contract.ts) own the shapes they send and receive.
export type * from './contracts/tags.js';
export type * from './contracts/seasons.js';
export type * from './contracts/artifacts.js';
export type * from './contracts/bosses.js';
export type * from './contracts/profiles.js';
export type * from './contracts/defaults.js';
export type * from './contracts/maps.js';
export type * from './contracts/phantimals.js';
export type * from './contracts/heroes.js';
export type * from './contracts/update-date.js';
export type * from './contracts/record-states.js';
export type * from './contracts/tournaments.js';
export type * from './contracts/formation-ids.js';
export type * from './contracts/round-deployments.js';
export type * from './contracts/formation.js';
export type * from './contracts/stages.js';
export type * from './contracts/arena.js';
export type * from './contracts/dream-hunt.js';
export type * from './contracts/stats-settings.js';
export type * from './contracts/roster.js';
export type * from './contracts/images.js';
export type * from './contracts/roster-import.js';

// The counters between Formation groups (src/query/formations.ts).
/** One Formation group's head-to-head record against another, from the first group's side. */
export interface Matchup {
  /** The other group's place in the list given to `groupCounters`. */
  vs: number;
  games: number;
  wins: number;
  /** The games the other group won; with a draw, games are not wins plus losses. */
  losses: number;
  winRate: number;
  /** Fewer games than the counter rule asks for: shown, never called a counter. */
  anecdote: boolean;
}

export interface GroupCounters {
  /** The groups this one counters: at least the rule's games and win rate against them, best win rate first. */
  beats: Matchup[];
  /** The groups that counter this one, by the same rule, best win rate first. */
  losesTo: Matchup[];
  /** Every group it met, most games first, whatever the result (the rows of the heat map). */
  matchups: Matchup[];
}

/** A Formation group of the counters report: how it did, with its head-to-head records. */
export interface GroupCounterRow extends GroupCounters {
  core: string[];
  flex: string[];
  games: number;
  wins: number;
  winRate: number;
}

/** The Formation groups with their counters, and the rule that decided which are counters. */
export interface GroupCounterReport {
  rule: { winRate: number; minGames: number };
  groups: GroupCounterRow[];
}

/** A Formation group that beat the enemy's group in the owner's records, with which of its Core heroes the roster has. */
interface PastCounter {
  core: string[];
  flex: string[];
  /** The games it met the enemy's group in, and how many it won and lost. */
  games: number;
  wins: number;
  losses: number;
  /** Its win rate against the enemy's group. */
  winRate: number;
  /** Fewer games than the counter rule asks for: a pointer, not a counter. */
  anecdote: boolean;
  /** Its Core heroes the default roster has, and those it has not. */
  have: string[];
  missing: string[];
}

/** What the owner's records say about the Formation group an enemy team looks like: which groups beat it. */
export interface PastCounters {
  /** The enemy's group: the one with the most games whose Core heroes are all in the enemy team. */
  group: { core: string[]; flex: string[]; games: number; wins: number };
  rule: { winRate: number; minGames: number };
  counteredBy: PastCounter[];
}

/** What a parked reading is: a tile whose heroes differ from the ones kept and could not be paired with one, or one the Agent was not sure of (ADR 0040). */
export type ParkKind = 'difference' | 'unsure';

/** A tile of a saved Battle import that waits for the player to say which hero it shows. Its picture is at `/api/admin/parked-readings/:id/image`. */
export interface ParkedReading {
  id: number;
  kind: ParkKind;
  side: 'A' | 'B';
  mode: string | null;
  /** The hero the Agent named for the tile; null when it named none. */
  readHero: string | null;
  /** For an unsure reading, the hero the player kept. */
  keptHero: string | null;
  /** The heroes it may be: the ones the player added on that side, then the Agent's own alternatives. */
  candidates: string[];
  createdAt: string;
}

export interface ParkedList {
  entries: ParkedReading[];
  /** Every parked reading of the kind asked for, not only the page returned. */
  total: number;
  counts: Record<ParkKind, number>;
  /** The most readings kept of each kind: a full kind parks no more. */
  caps: Record<ParkKind, number>;
}

/** One fight of a Titan Reaver Battle: its team against one boss and the damage dealt in it. */
export interface TitanReaverFight {
  position: 1 | 2;
  boss: string;
  damage: number;
  formation: FormationJson;
}

/** A Titan Reaver record: two fights, one team against each boss of a Titan Reaver Phase; the total damage is what the game ranks. */
export interface TitanReaverBattle {
  id: number;
  createdAt: string;
  /** The season it was played in (ADR 0038), set when it was saved. */
  season: number;
  /** Which Titan Reaver event: the Season Phase it was held in (1 to 3). */
  seasonPhase: number;
  titanPhase: 'Charge' | 'Clash' | 'Conquer';
  level: number;
  note: string | null;
  tags: string[];
  /** The Formation ID of both teams, if any. */
  formationId: string | null;
  fights: TitanReaverFight[];
  total: number;
}

export interface TitanReaverBattleInput {
  seasonPhase: number;
  titanPhase: string;
  level: number;
  note: string;
  tags?: string[];
  formationId?: string | null;
  fights: { boss: string; damage: number; formation: FormationInput }[];
}
