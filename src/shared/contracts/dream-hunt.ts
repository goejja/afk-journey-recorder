import { z } from 'zod';
import type { BattleFormationIds, DreamHuntAttempt, DreamHuntInput, FinderResult, Leaderboard } from '../api.js';
import { endpoint } from '../contract.js';

export const Boss = z.object({ name: z.string(), class: z.string().nullable(), damageType: z.string().nullable(), attempts: z.number() });
export type Boss = z.infer<typeof Boss>;

export const BossRule = z.object({ name: z.string(), description: z.string() });
export type BossRule = z.infer<typeof BossRule>;

// The bodies below are typed, not checked by the schema: the handlers check them field by field and keep their own messages.
const RuleBody = z.custom<BossRule>();
const FightBody = z.custom<DreamHuntInput>();
const DayBody = z.custom<{ fights: DreamHuntInput[] } & BattleFormationIds>();

const Fight = z.custom<DreamHuntAttempt>();
const Day = z.object({ id: z.number(), fights: z.array(Fight) });

const text = z.string().optional();
const texts = z.union([z.string(), z.array(z.string())]).optional();

export const dreamHuntContract = {
  bosses: endpoint({ method: 'GET', path: '/api/bosses', response: z.array(Boss) }),
  rules: endpoint({ method: 'GET', path: '/api/boss-rules', response: z.array(BossRule) }),
  createRule: endpoint({ method: 'POST', path: '/api/boss-rules', body: RuleBody, response: BossRule, status: 201 }),
  saveRule: endpoint({ method: 'PUT', path: '/api/boss-rules/:name', body: RuleBody, response: BossRule }),
  removeRule: endpoint({ method: 'DELETE', path: '/api/boss-rules/:name', response: z.undefined(), status: 204 }),
  attempts: endpoint({ method: 'GET', path: '/api/dream-hunt/attempts', query: z.object({ boss: texts, rule: text, tag: texts, limit: text }), response: z.array(Fight) }),
  attempt: endpoint({ method: 'GET', path: '/api/dream-hunt/attempts/:id', response: Fight }),
  create: endpoint({ method: 'POST', path: '/api/dream-hunt/attempts', body: FightBody, response: Fight, status: 201 }),
  update: endpoint({ method: 'PUT', path: '/api/dream-hunt/attempts/:id', body: FightBody, response: Fight }),
  /** A day of Dream Hunt: its fights saved together as one battle, or not at all. */
  createDay: endpoint({ method: 'POST', path: '/api/dream-hunt/battle-groups', body: DayBody, response: Day, status: 201 }),
  /** Edits a whole day: the fights given are the day's fights now. */
  updateDay: endpoint({ method: 'PUT', path: '/api/dream-hunt/battle-groups/:id', body: DayBody, response: Day }),
  leaderboard: endpoint({ method: 'GET', path: '/api/dream-hunt/leaderboard', query: z.object({ boss: text, rule: text, tag: texts, since: text, include: texts, exclude: texts }), response: z.custom<Leaderboard>() }),
  /** The compositions that hold every included hero and none of the excluded ones, whatever the boss. */
  finder: endpoint({ method: 'GET', path: '/api/dream-hunt/finder', query: z.object({ include: texts, exclude: texts, rule: text, tag: texts }), response: z.custom<FinderResult>() }),
  /** The heroes with a recorded Dream Hunt fight, against one boss or any, for the hero filters. */
  fightHeroes: endpoint({ method: 'GET', path: '/api/dream-hunt/heroes', query: z.object({ boss: text }), response: z.array(z.string()) }),
};
