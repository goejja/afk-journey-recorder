import { z } from 'zod';
import type { StageAttemptInput, StageRangeInput } from '../api.js';
import { endpoint } from '../contract.js';
import { FormationJson } from './formation.js';

export const StageKind = z.enum(['Normal', 'Phantisomal', 'Apex Normal', 'Apex Phantisomal']);
export type StageKind = z.infer<typeof StageKind>;

/** What names a stage: its season and phase, its kind and its number. */
export const StageKey = z.object({ season: z.number(), phase: z.number(), kind: StageKind, number: z.number() });
export type StageKey = z.infer<typeof StageKey>;

/** An enemy or a hero (the other is null) of a stage's enemy formation (ADR 0034), with how many of it stand there. */
export const StageEnemy = z.object({ enemy: z.string().nullable(), hero: z.string().nullable(), count: z.number() });
export type StageEnemy = z.infer<typeof StageEnemy>;

/** A stage as listed: its identity, its map and how many attempts it has. */
const StageSummary = StageKey.extend({ id: z.number(), mapName: z.string(), attemptCount: z.number() });

export const Stage = StageSummary.extend({ enemies: z.array(StageEnemy) });
export type Stage = z.infer<typeof Stage>;

export const Enemy = z.object({
  name: z.string(),
  category: z.enum(['Common', 'Elite', 'Boss']),
  class: z.string().nullable(),
  damageType: z.string().nullable(),
  imagePath: z.string().nullable(),
  /** On how many stages' enemy formations it stands. */
  uses: z.number(),
});
export type Enemy = z.infer<typeof Enemy>;

/** A stage of the Stages grid: the stage rows of one kind, phase and number across seasons, as `stagesContract.grid` lists it. */
const StageGridBox = z.object({
  kind: StageKind,
  /** 0 for Normal and Phantisomal, whose numbers run on across the phases. */
  phase: z.number(),
  number: z.number(),
  /** `cleared`: a stage of the current season has an attempt; `older`: only an earlier season's has. */
  state: z.enum(['cleared', 'older']),
  newestSeason: z.number(),
});

export const Attempt = z.object({
  id: z.number(),
  createdAt: z.string(),
  /** The season the record was played in (ADR 0038), set when it was saved; the stage's own season is `stage.season`. */
  season: z.number(),
  note: z.string().nullable(),
  tags: z.array(z.string()),
  buffLevel: z.number().nullable(),
  stage: StageKey.extend({ id: z.number(), mapName: z.string() }),
  formation: FormationJson,
});
export type Attempt = z.infer<typeof Attempt>;

// The bodies below are typed, not checked by the schema: the handlers check them field by field and keep their own messages.
const StageBody = z.custom<StageKey & { mapName: string }>();
const SaveStageBody = z.custom<{ mapName: string; enemies: StageEnemy[] }>();
const ChangeKindBody = z.custom<{ season: number; phase: number; kind: StageKind; newKind: StageKind; from: number; to: number }>();
const AttemptBody = z.custom<StageAttemptInput>();
const RangeBody = z.custom<StageRangeInput>();

const text = z.string().optional();
const texts = z.union([z.string(), z.array(z.string())]).optional();

export const stagesContract = {
  enemies: endpoint({ method: 'GET', path: '/api/enemies', response: z.array(Enemy) }),
  /** The stages with this identity (any filter left out matches all). */
  list: endpoint({ method: 'GET', path: '/api/stages', query: z.object({ season: text, phase: text, kind: text, number: text }), response: z.array(StageSummary) }),
  /** Every stage with at least one attempt, once per kind, phase and number across seasons, and the current season. */
  grid: endpoint({ method: 'GET', path: '/api/stage-grid', response: z.object({ season: z.number(), boxes: z.array(StageGridBox) }) }),
  get: endpoint({ method: 'GET', path: '/api/stages/:id', response: Stage }),
  /** Finds the stage with this identity, or creates it on the given map. */
  findOrCreate: endpoint({ method: 'POST', path: '/api/stages', body: StageBody, response: Stage }),
  /** Saves the stage's map and Stage Enemies (replacing the previous ones). */
  save: endpoint({ method: 'PUT', path: '/api/stages/:id', body: SaveStageBody, response: Stage }),
  /** Moves a range of stages (and their attempts) to the other kind of the same family. */
  changeKind: endpoint({ method: 'POST', path: '/api/stages/change-kind', body: ChangeKindBody, response: z.object({ stages: z.number(), attempts: z.number() }) }),
  attempts: endpoint({
    method: 'GET',
    path: '/api/attempts',
    query: z.object({ stageId: text, season: text, phase: text, kind: texts, number: text, tag: texts, limit: text }),
    response: z.array(Attempt),
  }),
  createAttempt: endpoint({ method: 'POST', path: '/api/attempts', body: AttemptBody, response: Attempt, status: 201 }),
  /** The same formation cleared the stages `from` to `to` in auto-battle: one attempt per stage, saved together or not at all. */
  createRange: endpoint({ method: 'POST', path: '/api/attempts/range', body: RangeBody, response: z.object({ attempts: z.array(Attempt) }), status: 201 }),
  updateAttempt: endpoint({ method: 'PUT', path: '/api/attempts/:id', body: AttemptBody, response: Attempt }),
  removeAttempt: endpoint({ method: 'DELETE', path: '/api/attempts/:id', response: z.undefined(), status: 204 }),
};

