import type { PartnerRelation } from '../src/domain/partner-relation.js';
import type { z } from 'zod';
import { pathOf, queryStringOf, Upload, urlOf, type ClientInput, type Endpoint } from '../src/shared/contract.js';
import { artifactsContract } from '../src/shared/contracts/artifacts.js';
import type { BossInput } from '../src/domain/boss.js';
import { bossesContract } from '../src/shared/contracts/bosses.js';
import { defaultsContract, titanReaverContract } from '../src/shared/contracts/defaults.js';
import { titanReaverBattlesContract } from '../src/shared/contracts/titan-reaver.js';
import { mapsContract } from '../src/shared/contracts/maps.js';
import { heroesContract, type BackMarkBody, type HeroAttributesBody } from '../src/shared/contracts/heroes.js';
import { unitRulesContract } from '../src/shared/contracts/unit-rules.js';
import { updateDateContract } from '../src/shared/contracts/update-date.js';
import { recordStatesContract } from '../src/shared/contracts/record-states.js';
import { tournamentsContract } from '../src/shared/contracts/tournaments.js';
import { formationIdsContract } from '../src/shared/contracts/formation-ids.js';
import { roundDeploymentsContract } from '../src/shared/contracts/round-deployments.js';
import { phantimalsContract } from '../src/shared/contracts/phantimals.js';
import { profilesContract } from '../src/shared/contracts/profiles.js';
import { seasonsContract } from '../src/shared/contracts/seasons.js';
import { battlesContract } from '../src/shared/contracts/battles.js';
import { scenariosContract } from '../src/shared/contracts/scenarios.js';
import { statsContract } from '../src/shared/contracts/stats.js';
import { syncContract } from '../src/shared/contracts/sync.js';
import { counterRuleContract, statsSettingsContract } from '../src/shared/contracts/stats-settings.js';
import { importFeedbackContract, keptPicturesContract, learnedContract, learnedPicturesContract, parkedReadingsContract, readerExamplesContract } from '../src/shared/contracts/reader.js';
import { rosterImportContract } from '../src/shared/contracts/roster-import.js';
import { adminContract } from '../src/shared/contracts/admin.js';
import { imagesContract } from '../src/shared/contracts/images.js';
import { rosterContract } from '../src/shared/contracts/roster.js';
import { agentContract } from '../src/shared/contracts/agent.js';
import { cleanupContract, reviewContract } from '../src/shared/contracts/review.js';
import { arenaContract } from '../src/shared/contracts/arena.js';
import { dreamHuntContract } from '../src/shared/contracts/dream-hunt.js';
import { stagesContract } from '../src/shared/contracts/stages.js';
import { tagsContract } from '../src/shared/contracts/tags.js';
import type { DefaultMode, DefaultSlot } from '../src/domain/defaults.js';
import type { TitanReaverSetup } from '../src/domain/titan-reaver.js';
import type { Deployment } from '../src/domain/layout.js';
import type { RoundDeployment } from '../src/domain/round-deployment.js';
import type { Round } from '../src/domain/tournament.js';
import type { GameMap, Phantimal, StageKind, StageKey, Stage, BossRule, StageAttemptInput, StageRangeInput, DreamHuntInput, BattleImportState, ImportApplySection, ImportFeedbackSide, ImportScreen, RosterImportState, ReaderExample, CleanupRequest, ScenarioInput, AgentSettings, ArenaMode, BattleFormationIds, BattleRound, ArenaFightInput, HeroAdminBody, PlacementRuleBody, PvpHintBody, TitanReaverBattleInput, SyncSourceId } from '../src/shared/api.js';

import { clearAnswers, keptAnswer } from './answers.js';

export type * from '../src/shared/api.js';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // The server refuses a change that is not marked as made by this app (see src/server/request-guard.ts).
  const changes = init?.method !== undefined && init.method !== 'GET';
  const response = await fetch(url, changes ? { ...init, headers: { 'x-afk-action': 'app', ...init.headers } } : init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (HTTP ${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

/** The path and query string of a call. */
function urlFor<E extends Endpoint>(route: E, input?: ClientInput<E>): string {
  const { params, query } = (input ?? {}) as { params?: Record<string, string>; query?: Record<string, string | string[]> };
  const search = query ? queryStringOf(query) : '';
  return pathOf(route.path, params) + (search ? `?${search}` : '');
}

type CallArgs<E extends Endpoint> = {} extends ClientInput<E> ? [input?: ClientInput<E>] : [input: ClientInput<E>];

/**
 * Calls a route described in `src/shared/contract.ts`; the path parameters and the body are typed by its schemas, and the answer by its response schema.
 * A request that changes something (not a GET) clears the kept answers, see `web/answers.ts`.
 */
export function call<E extends Endpoint>(route: E, ...[input]: CallArgs<E>): Promise<z.output<E['response']>> {
  const { body } = (input ?? {}) as { body?: unknown };
  const url = urlFor(route, input);
  const send = (): Promise<z.output<E['response']>> => {
    if (route.body === Upload) {
      const file = body as Blob;
      return request(url, { method: route.method, headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
    }
    return route.method === 'GET' || (route.method === 'DELETE' && !route.body) ? request(url, { method: route.method }) : sendJson(url, route.method, body);
  };
  if (route.method === 'GET') return send();
  clearAnswers();
  return send().finally(clearAnswers);
}

/** Like `call` for a GET of reference data: the answer is kept and frozen, and shared by every page that asks (`web/answers.ts`). */
function keep<E extends Endpoint>(route: E, ...args: CallArgs<E>): Promise<z.output<E['response']>> {
  return keptAnswer(urlFor(route, args[0]), () => call(route, ...args));
}

/** The picture of a tile of the current roster import. */
export const rosterImportTileUrl = (job: number, tile: string) => urlOf(rosterImportContract.tile, { params: { id: String(job), key: tile } });

function sendJson<T>(url: string, method: string, body: unknown): Promise<T> {
  return request<T>(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

/** The table of each kind of learned picture the review shows: Rank and Unit Looks, and the two kinds of hero tile. */
const LOOK_TABLE = { rank: 'rank_look', unit: 'unit_look' } as const;
const EXAMPLE_TABLE = { example: 'hero_example', look: 'hero_look' } as const;
export const learnedLookUrl = (kind: 'rank' | 'unit', id: number) => urlOf(learnedPicturesContract.image, { params: { table: LOOK_TABLE[kind], id: String(id) } });
/** The picture of a parked reading (ADR 0040). */
export const parkedReadingUrl = (id: number) => urlOf(parkedReadingsContract.image, { params: { id: String(id) } });
export const readerExampleUrl = (e: Pick<ReaderExample, 'kind' | 'id'>) => urlOf(learnedPicturesContract.image, { params: { table: EXAMPLE_TABLE[e.kind], id: String(e.id) } });

/** A query string where a value may be a list, sent as the same name repeated (`mode=Arena&mode=Guild+Duel`); empty values are left out. */
export type Query = Record<string, string | string[]>;

/** `?profile=ID` for a request about one profile's roster; nothing for the default profile. */
const profileQuery = (profile?: number) => (profile === undefined ? {} : { profile: String(profile) });

export const api = {
  rules: () => keep(rosterContract.rules),
  unitRules: () => call(unitRulesContract.get),
  heroes: (profile?: number) => keep(rosterContract.heroes, { query: profileQuery(profile) }),
  profiles: () => keep(profilesContract.list),
  createProfile: (profile: { name: string; playerId?: string | null; copyFrom?: number }) => call(profilesContract.create, { body: profile }),
  updateProfile: (id: number, change: { name?: string; playerId?: string | null }) => call(profilesContract.update, { params: { id: String(id) }, body: change }),
  /** Remembers a spelling a picture gave this Profile, so the same spelling resolves to it in later imports (ADR 0021). */
  addProfileName: (id: number, name: string) => call(profilesContract.addName, { params: { id: String(id) }, body: { name } }),
  setDefaultProfile: (id: number) => call(profilesContract.setDefault, { params: { id: String(id) } }),
  mergeProfile: (id: number, into: number) => call(profilesContract.merge, { params: { id: String(id) }, body: { into } }),
  deleteProfile: (id: number) => call(profilesContract.remove, { params: { id: String(id) } }),
  /** Sets the rank and equipment a saved record stored for some heroes of one side (to bring a record to the roster's states). */
  correctRecordStates: (attemptIds: number[], side: 'A' | 'B', heroes: { hero: string; rank: string | null; equipmentLevel: number | null }[]) =>
    call(recordStatesContract.setHeroStates, { body: { attemptIds, side, heroes } }),
  saveHero: (name: string, rank: string | null, equipmentLevel: number | null, profile?: number) =>
    call(rosterContract.save, { params: { name }, query: profileQuery(profile), body: { rank, equipmentLevel } }),
  removeHero: (name: string, profile?: number) => call(rosterContract.remove, { params: { name }, query: profileQuery(profile) }),
  resetRoster: (profile?: number) => call(rosterContract.reset, { query: profileQuery(profile) }),

  phantimals: () => keep(phantimalsContract.list),
  phantimalUsage: (name: string) => call(phantimalsContract.usage, { params: { name } }),
  adminHeroes: () => call(heroesContract.list),
  heroUsage: (name: string) => call(heroesContract.usage, { params: { name } }),
  createHero: (hero: HeroAdminBody) => call(heroesContract.create, { body: hero }),
  saveAdminHero: (name: string, hero: HeroAdminBody) => call(heroesContract.save, { params: { name }, body: hero }),
  savePvpHint: (name: string, hint: PvpHintBody) => call(heroesContract.savePvpHint, { params: { name }, body: hint }),
  placementRules: () => call(heroesContract.placementRules),
  saveBackMark: (name: string, mark: BackMarkBody['mark']) => call(heroesContract.saveBackMark, { params: { name }, body: { mark } }),
  tierCheck: () => call(heroesContract.tierCheck),
  createPlacementRule: (hero: string, rule: PlacementRuleBody) => call(heroesContract.createPlacementRule, { params: { name: hero }, body: rule }),
  savePlacementRule: (id: number, rule: PlacementRuleBody) => call(heroesContract.savePlacementRule, { params: { id: String(id) }, body: rule }),
  deletePlacementRule: (id: number) => call(heroesContract.removePlacementRule, { params: { id: String(id) } }),
  saveHeroAttributes: (name: string, attributes: HeroAttributesBody) => call(heroesContract.saveAttributes, { params: { name }, body: attributes }),
  deleteHero: (name: string) => call(heroesContract.remove, { params: { name } }),
  createPhantimal: (p: Omit<Phantimal, 'source'>) => call(phantimalsContract.create, { body: p }),
  savePhantimal: (originalName: string, p: Omit<Phantimal, 'source'>) => call(phantimalsContract.save, { params: { name: originalName }, body: p }),
  deletePhantimal: (name: string) => call(phantimalsContract.remove, { params: { name } }),

  readerExamples: () => call(readerExamplesContract.view),
  parkedReadings: (kind: 'all' | 'difference' | 'unsure', offset: number, limit: number) => call(parkedReadingsContract.list, { query: { ...(kind === 'all' ? {} : { kind }), offset: String(offset), limit: String(limit) } }),
  confirmParkedReading: (id: number, hero: string) => call(parkedReadingsContract.confirm, { params: { id: String(id) }, body: { hero } }),
  dismissParkedReading: (id: number) => call(parkedReadingsContract.dismiss, { params: { id: String(id) } }),
  moveReaderExample: (e: Pick<ReaderExample, 'kind' | 'id'>, hero: string) => call(learnedPicturesContract.move, { params: { table: EXAMPLE_TABLE[e.kind], id: String(e.id) }, body: { value: hero } }),
  learned: () => call(learnedContract.view),
  latestReviewRun: () => call(reviewContract.latestRun),
  askAgentAboutReview: (runId: number) => call(reviewContract.explain, { params: { id: String(runId) } }),
  dismissFinding: async (finding: { code: string; subject: string; message: string }) => void (await call(reviewContract.dismiss, { body: finding })),
  restoreFinding: async (finding: { code: string; subject: string; message: string }) => void (await call(reviewContract.restore, { body: finding })),
  startReviewRun: () => call(reviewContract.startRun),
  deleteReviewFiles: (files: string[]) => call(reviewContract.deleteFiles, { body: { files } }),
  thinningProposal: () => call(reviewContract.thinning),
  thinningSettings: () => call(reviewContract.thinningSettings),
  saveThinningSettings: (rank: number) => call(reviewContract.saveThinningSettings, { body: { rank } }),
  applyThinning: (kind: 'rank', ids: number[]) => call(reviewContract.applyThinning, { body: { kind, ids } }),
  /** Moves a Rank Look to another rank; says how many looks the rank reader names wrong before and after. */
  moveRankLook: async (id: number, rank: string) => {
    const report = await call(learnedPicturesContract.move, { params: { table: LOOK_TABLE.rank, id: String(id) }, body: { value: rank } });
    if (!report) throw new Error('The server did not say how the readings changed');
    return report;
  },
  moveUnitLook: (id: number, name: string) => call(learnedPicturesContract.move, { params: { table: LOOK_TABLE.unit, id: String(id) }, body: { value: name } }),
  deleteLearned: (kind: 'rank' | 'unit', id: number) => call(learnedPicturesContract.remove, { params: { table: LOOK_TABLE[kind], id: String(id) } }),
  deleteLearnedSource: (source: string) => call(learnedPicturesContract.removeSource, { params: { source } }),
  deleteReaderExample: (e: Pick<ReaderExample, 'kind' | 'id'>) => call(learnedPicturesContract.remove, { params: { table: EXAMPLE_TABLE[e.kind], id: String(e.id) } }),
  images: (kind: string) => call(imagesContract.list, { params: { kind } }),
  uploadImage: (kind: string, name: string, file: File) =>
    call(imagesContract.upload, { params: { kind, name }, body: file }).then(() => undefined),
  removeImage: (kind: string, name: string) =>
    call(imagesContract.remove, { params: { kind, name } }),

  formationIds: () => call(formationIdsContract.list),
  addFormationId: (code: string, deployment: Deployment) => call(formationIdsContract.create, { body: { code, deployment } }),
  deleteFormationId: (code: string) => call(formationIdsContract.remove, { params: { code } }),

  artifacts: () => keep(artifactsContract.list),
  createArtifact: (a: { name: string; group: string }) => call(artifactsContract.create, { body: a }),
  saveArtifact: (originalName: string, a: { name: string; group: string }) => call(artifactsContract.save, { params: { name: originalName }, body: a }),
  deleteArtifact: (name: string) => call(artifactsContract.remove, { params: { name } }),
  enemies: () => keep(stagesContract.enemies),
  /** The stages with this identity, without creating one; none while the stage has not been recorded. */
  findStages: (key: StageKey) => call(stagesContract.list, { query: { season: String(key.season), phase: String(key.phase ?? 0), kind: key.kind, number: String(key.number) } }),
  /** Every stage with a record, once per kind, phase and number across seasons, and the current season. */
  stageGrid: () => call(stagesContract.grid),
  stage: (id: number) => call(stagesContract.get, { params: { id: String(id) } }),
  findOrCreateStage: (key: StageKey & { mapName: string }) => call(stagesContract.findOrCreate, { body: key }),
  saveStage: (id: number, mapName: string, enemies: Stage['enemies']) =>
    call(stagesContract.save, { params: { id: String(id) }, body: { mapName, enemies } }),
  changeStageKind: (change: { season: number; phase: number; kind: StageKind; newKind: StageKind; from: number; to: number }) =>
    call(stagesContract.changeKind, { body: change }),
  attempts: (query: Query = {}) =>
    call(stagesContract.attempts, { query }),
  attempt: (id: number) => call(stagesContract.attempt, { params: { id: String(id) } }),
  createAttempt: (attempt: StageAttemptInput) => call(stagesContract.createAttempt, { body: attempt }),
  /** One attempt per stage from `from` to `to`, the same formation having cleared them in auto-battle. */
  createAttemptRange: (range: StageRangeInput) => call(stagesContract.createRange, { body: range }),
  updateAttempt: (id: number, attempt: StageAttemptInput) => call(stagesContract.updateAttempt, { params: { id: String(id) }, body: attempt }),
  deleteAttempt: (id: number) => call(stagesContract.removeAttempt, { params: { id: String(id) } }),

  bosses: () => keep(bossesContract.list),
  createBoss: (b: BossInput) => call(bossesContract.create, { body: b }),
  saveBoss: (name: string, b: BossInput) => call(bossesContract.save, { params: { name }, body: b }),
  deleteBoss: (name: string) => call(bossesContract.remove, { params: { name } }),
  bossRules: () => keep(dreamHuntContract.rules),
  createBossRule: (rule: BossRule) => call(dreamHuntContract.createRule, { body: rule }),
  saveBossRule: (originalName: string, rule: BossRule) =>
    call(dreamHuntContract.saveRule, { params: { name: originalName }, body: rule }),
  deleteBossRule: (name: string) => call(dreamHuntContract.removeRule, { params: { name } }),
  dreamHuntAttempts: (query: Query = {}) =>
    call(dreamHuntContract.attempts, { query }),
  dreamHuntAttempt: (id: number) => call(dreamHuntContract.attempt, { params: { id: String(id) } }),
  createDreamHuntBattle: (fights: DreamHuntInput[], codes: BattleFormationIds) => call(dreamHuntContract.createDay, { body: { fights, ...codes } }),
  updateDreamHuntBattle: (id: number, fights: DreamHuntInput[], codes: BattleFormationIds) => call(dreamHuntContract.updateDay, { params: { id: String(id) }, body: { fights, ...codes } }),
  createDreamHuntAttempt: (attempt: DreamHuntInput) => call(dreamHuntContract.create, { body: attempt }),
  updateDreamHuntAttempt: (id: number, attempt: DreamHuntInput) =>
    call(dreamHuntContract.update, { params: { id: String(id) }, body: attempt }),
  finder: (include: string[], exclude: string[], rule: string, tag: string[] = []) =>
    call(dreamHuntContract.finder, { query: { include, exclude, rule, tag } }),
  leaderboard: (boss: string, rule: string, tag: string[] = [], since = '', include: string[] = [], exclude: string[] = []) =>
    call(dreamHuntContract.leaderboard, { query: { boss, rule, tag, since, include, exclude } }),
  fightHeroes: (boss = '') => call(dreamHuntContract.fightHeroes, { query: { boss } }),
  previewCleanup: (selection: CleanupRequest) => call(cleanupContract.preview, { body: selection }),
  deleteCleanup: (selection: CleanupRequest, expectedCount: number) =>
    call(cleanupContract.delete, { body: { ...selection, expectedCount } }),
  optimizeDatabase: () => call(cleanupContract.optimize),
  scenarios: () => keep(scenariosContract.list),
  createScenario: (scenario: ScenarioInput) => call(scenariosContract.create, { body: scenario }),
  updateScenario: (id: number, scenario: ScenarioInput) => call(scenariosContract.save, { params: { id: String(id) }, body: scenario }),
  deleteScenario: (id: number) => call(scenariosContract.remove, { params: { id: String(id) } }),
  agentSettings: () => call(agentContract.get),
  saveAgentSettings: (settings: Pick<AgentSettings, 'preset' | 'model' | 'timeoutMinutes'>) => call(agentContract.save, { body: settings }),
  refreshAgentTools: () => call(agentContract.refresh),
  rosterImport: () => call(rosterImportContract.state) as Promise<RosterImportState>,
  startRosterImport: (picture: File, screen: ImportScreen, profile?: number) =>
    call(rosterImportContract.start, { query: { screen, ...(profile === undefined ? {} : { profile: String(profile) }), name: picture.name }, body: new Blob([picture], { type: picture.type || 'image/png' }) }),
  battleImport: () => call(rosterImportContract.state, { query: { kind: 'report' } }) as Promise<BattleImportState>,
  startBattleImport: (picture: File, mode: ArenaMode) =>
    call(rosterImportContract.start, { query: { screen: 'report', mode, name: picture.name }, body: new Blob([picture], { type: picture.type || 'image/png' }) }),
  /** Throws away pictures of the Battle import: the ones with these ids, or with no ids the ones not read yet. */
  retryBattleImport: (id: number) => call(rosterImportContract.retry, { params: { id: String(id) } }),
  dismissBattleImport: (ids?: number[]) =>
    call(rosterImportContract.dismiss, { query: ids ? { ids: ids.join(',') } : { waiting: '1', kind: 'report' } }),
  /** What the player kept of a Battle import, with what was read, to measure the readings and to learn artifact and phantimal looks. Never changes a record. */
  sendImportFeedback: (mode: ArenaMode, sides: ImportFeedbackSide[]) =>
    call(importFeedbackContract.send, { body: { mode, sides } }),
  /** Keeps the original picture of a Battle import with the fight it showed. Never changes a record. */
  keepPicture: (attemptId: number, label: string | null, data: string) =>
    call(keptPicturesContract.keep, { body: { attemptId, label, data } }),
  cancelRosterImport: (id: number) => call(rosterImportContract.cancel, { params: { id: String(id) } }),
  dismissRosterImport: (waiting = false, keep = false) => call(rosterImportContract.dismiss, { query: waiting ? { waiting: '1' } : keep ? { keep: '1' } : {} }),
  rosterImportTarget: (id: number, section: number, target: { kind: 'match' | 'new' } | { kind: 'profile'; id: number }) =>
    call(rosterImportContract.target, { params: { id: String(id) }, body: { section, target } }),
  rosterImportChoose: (id: number, tile: string, hero: string | null) =>
    call(rosterImportContract.choose, { params: { id: String(id) }, body: { tile, hero } }),
  applyRosterImport: (id: number, sections: ImportApplySection[]) =>
    call(rosterImportContract.apply, { params: { id: String(id) }, body: { sections } }),
  runScenario: (id: number) => call(agentContract.run, { params: { id: String(id) } }),
  cancelScenarioRun: (id: number) => call(agentContract.cancel, { params: { id: String(id) } }),
  statsSummary: () => call(statsContract.summary),
  statsHeroes: (query: Query) => call(statsContract.heroes, { query }),
  statsHeroDistribution: (hero: string, query: Query) => call(statsContract.heroDistribution, { params: { hero }, query }),
  statsPlayers: (query: Query) => call(statsContract.players, { query }),
  statsArtifacts: (query: Query) => call(statsContract.artifacts, { query }),
  statsMaps: (query: Query) => call(statsContract.maps, { query }),
  statsMapFormations: (query: Query & { map: string }) => call(statsContract.mapFormations, { query }),
  statsHeroRows: (hero: string, query: Query) => call(statsContract.heroRows, { params: { hero }, query }),
  statsTrios: (query: Query) => call(statsContract.trios, { query }),
  statsFormationReport: (query: Query) => call(statsContract.formationReport, { query }),
  statsFormationProfile: (query: Query) => call(statsContract.formationProfile, { query }),
  statsGroupCounters: (query: Query) => call(statsContract.groupCounters, { query }),
  statsPairs: (query: Query) => call(statsContract.pairs, { query }),
  statsPartners: (query: Query & { hero: string }) => call(statsContract.partners, { query }),
  statsPartnerPositions: (query: Query & { hero: string; relation: PartnerRelation }) => call(statsContract.partnerPositions, { query }),
  statsPartnerTags: () => call(statsContract.partnerTags),
  factionMismatches: () => call(statsContract.factionMismatches),
  backCheck: () => call(statsContract.backCheck),
  dunlingrCheck: () => call(statsContract.dunlingrCheck),
  syncState: () => call(syncContract.state),
  startSync: (body: { source: 'all' | SyncSourceId; refresh: boolean; overwrite: boolean }) => call(syncContract.start, { body }),
  statsSettings: () => call(statsSettingsContract.get),
  saveStatsSettings: (modes: string[]) => call(statsSettingsContract.save, { body: { modes } }),
  updateDate: () => call(updateDateContract.get),
  saveUpdateDate: (date: string) => call(updateDateContract.save, { body: { date } }),
  clearUpdateDate: () => call(updateDateContract.reset),
  resetStatsSettings: () => call(statsSettingsContract.reset),
  counterRule: () => call(counterRuleContract.get),
  saveCounterRule: (rule: { winRate: number; minGames: number }) => call(counterRuleContract.save, { body: rule }),
  resetCounterRule: () => call(counterRuleContract.reset),
  defaults: () => keep(defaultsContract.list),
  saveDefaults: (mode: DefaultMode, slots: DefaultSlot[]) => call(defaultsContract.save, { params: { mode }, body: { slots } }),
  clearDefaults: (mode: DefaultMode) => call(defaultsContract.clear, { params: { mode } }),
  titanReaverSetup: () => call(titanReaverContract.get),
  saveTitanReaverSetup: (body: TitanReaverSetup) => call(titanReaverContract.save, { body }),
  clearTitanReaverSetup: () => call(titanReaverContract.clear),
  titanReaverBattles: (query: Query = {}) => call(titanReaverBattlesContract.list, { query }),
  titanReaverBattle: (id: number) => call(titanReaverBattlesContract.get, { params: { id: String(id) } }),
  createTitanReaverBattle: (battle: TitanReaverBattleInput) => call(titanReaverBattlesContract.create, { body: battle }),
  updateTitanReaverBattle: (id: number, battle: TitanReaverBattleInput) => call(titanReaverBattlesContract.update, { params: { id: String(id) }, body: battle }),
  deleteTitanReaverBattle: (id: number) => call(titanReaverBattlesContract.remove, { params: { id: String(id) } }),
  seasons: () => call(seasonsContract.list),
  addSeason: (number: number) => call(seasonsContract.add, { body: { number } }),
  setCurrentSeason: (number: number) => call(seasonsContract.setCurrent, { body: { number } }),
  setSeasonPhase: (phase: number) => call(seasonsContract.setPhase, { body: { phase } }),
  deleteSeason: (number: number) => call(seasonsContract.remove, { params: { number: String(number) } }),
  tags: () => keep(tagsContract.list),
  renameTag: (tag: string, name: string) => call(tagsContract.rename, { params: { tag }, body: { name } }),
  deleteTag: (tag: string) => call(tagsContract.remove, { params: { tag } }),
  restoreBackup: (file: File) =>
    call(adminContract.restore, { body: new Blob([file], { type: 'application/octet-stream' }) }),

  arenaFights: (query: Query = {}) => call(arenaContract.list, { query }),
  /** The 1000 newest saved fights of a mode, which a batch import and the form read to place a team; held, so one import reads them once (web/answers.ts). */
  savedFights: (mode: ArenaMode) => keep(arenaContract.list, { query: { mode: [mode], limit: '1000' } }),
  createArenaBattle: (mode: ArenaMode, fights: ArenaFightInput[], codes: BattleFormationIds, where?: BattleRound) =>
    call(arenaContract.createBattle, { body: { mode, fights, ...codes, ...where } }),
  deleteBattleGroup: (id: number, withFights: boolean) =>
    call(battlesContract.remove, { params: { id: String(id) }, query: withFights ? { fights: 'delete' } : {} }),
  updateArenaBattle: (id: number, fights: ArenaFightInput[], codes: BattleFormationIds, where?: BattleRound) =>
    call(arenaContract.updateBattle, { params: { id: String(id) }, body: { fights, ...codes, ...where } }),
  tournaments: () => call(tournamentsContract.list),
  addTournament: (tournament: { number: number; startDate?: string | null }) => call(tournamentsContract.create, { body: tournament }),
  roundDeployments: (tournamentId: number, round: Round) => call(roundDeploymentsContract.list, { params: { tournament: String(tournamentId), round } }),
  deleteRoundDeployment: (tournamentId: number, round: Round, profileId: number) =>
    call(roundDeploymentsContract.remove, { params: { tournament: String(tournamentId), round, profile: String(profileId) } }),
  /** Repairs a Deployment saved under the wrong Profile (ADR 0021). */
  moveRoundDeployment: (tournamentId: number, round: Round, from: number, to: number) =>
    call(roundDeploymentsContract.move, { params: { tournament: String(tournamentId), round, profile: String(from) }, body: { to } }),
  saveRoundDeployment: (tournamentId: number, round: Round, profileId: number, teams: RoundDeployment) =>
    call(roundDeploymentsContract.save, { params: { tournament: String(tournamentId), round, profile: String(profileId) }, body: { teams } }),
  /** Confirms the Deployments of both Players of a Battle together: one request, one transaction (ADR 0021). */
  saveRoundDeployments: (tournamentId: number, round: Round, entries: { profileId: number; teams: RoundDeployment }[]) =>
    call(roundDeploymentsContract.saveAll, { params: { tournament: String(tournamentId), round }, body: { entries } }),
  createArenaFight: (battle: ArenaFightInput) => call(arenaContract.create, { body: battle }),
  arenaBattle: (id: number) => call(arenaContract.get, { params: { id: String(id) } }),
  updateArenaFight: (id: number, battle: ArenaFightInput) => call(arenaContract.update, { params: { id: String(id) }, body: battle }),
  deleteArenaFight: (id: number) => call(stagesContract.removeAttempt, { params: { id: String(id) } }),

  maps: () => keep(mapsContract.list),
  createMap: (map: Pick<GameMap, 'name' | 'tags' | 'cells'>) => call(mapsContract.create, { body: map }),
  saveMap: (originalName: string, map: Pick<GameMap, 'name' | 'tags' | 'cells'>) => call(mapsContract.save, { params: { name: originalName }, body: map }),
  duplicateMap: (name: string, newName: string) => call(mapsContract.duplicate, { params: { name }, body: { name: newName } }),
  restoreMap: (name: string) => call(mapsContract.restore, { params: { name } }),
  deleteMap: (name: string) => call(mapsContract.remove, { params: { name } }),
  mapUses: (name: string) => call(mapsContract.uses, { params: { name } }),
  moveMapStages: (name: string, to: string) => call(mapsContract.moveStages, { params: { name }, body: { to } }),
};
