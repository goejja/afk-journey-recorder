import { z } from 'zod';
import type { ArenaBattle, ArenaBattleInput, ArenaMode, BattleFormationIds } from '../api.js';
import type { Round } from '../../domain/tournament.js';
import { endpoint, queryText as text, queryTexts as texts } from '../contract.js';

// The bodies below are typed, not checked by the schema: the handlers check them field by field and keep their own messages.
type BattleRound = { tournamentId?: number | null; round?: Round | null };
const FightBody = z.custom<ArenaBattleInput>();
const NewGroupBody = z.custom<{ mode: ArenaMode; fights: ArenaBattleInput[] } & BattleFormationIds & BattleRound>();
const GroupBody = z.custom<{ fights: ArenaBattleInput[] } & BattleFormationIds & BattleRound>();

const Battle = z.custom<ArenaBattle>();
const Group = z.object({ id: z.number(), fights: z.array(Battle) });


export const arenaContract = {
  /** The fights of the PvP modes, newest first, with every fight of the battles they belong to. */
  list: endpoint({ method: 'GET', path: '/api/pvp/battles', query: z.object({ mode: texts, tag: texts, player: text, tournament: text, round: text, limit: text }), response: z.array(Battle) }),
  /** One fight by its id, for a link to it (the Phantimal check), whatever its age. */
  get: endpoint({ method: 'GET', path: '/api/pvp/battles/:id', response: Battle }),
  create: endpoint({ method: 'POST', path: '/api/pvp/battles', body: FightBody, response: Battle, status: 201 }),
  update: endpoint({ method: 'PUT', path: '/api/pvp/battles/:id', body: FightBody, response: Battle }),
  /** A Battle: the teams of a Supreme Arena, Super League or Guild Duel battle, saved together or not at all. */
  createGroup: endpoint({ method: 'POST', path: '/api/pvp/battle-groups', body: NewGroupBody, response: Group, status: 201 }),
  /** Edits a whole battle: the teams given are the battle's teams now. */
  updateGroup: endpoint({ method: 'PUT', path: '/api/pvp/battle-groups/:id', body: GroupBody, response: Group }),
};
