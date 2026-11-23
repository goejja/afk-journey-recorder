import { z } from 'zod';
import type { ArenaBattle, ArenaFight, ArenaFightInput, ArenaMode, BattleFormationIds } from '../api.js';
import type { Round } from '../../domain/tournament.js';
import { endpoint, queryText as text, queryTexts as texts } from '../contract.js';

// The bodies below are typed, not checked by the schema: the handlers check them field by field and keep their own messages.
type BattleRound = { tournamentId?: number | null; round?: Round | null };
const FightBody = z.custom<ArenaFightInput>();
const NewBattleBody = z.custom<{ mode: ArenaMode; fights: ArenaFightInput[] } & BattleFormationIds & BattleRound>();
const BattleBody = z.custom<{ fights: ArenaFightInput[] } & BattleFormationIds & BattleRound>();

const Fight = z.custom<ArenaFight>();
const Battle = z.custom<ArenaBattle>();


export const arenaContract = {
  /** The fights of the PvP modes, newest first, with every fight of the battles they belong to. */
  list: endpoint({ method: 'GET', path: '/api/pvp/fights', query: z.object({ mode: texts, tag: texts, player: text, tournament: text, round: text, limit: text }), response: z.array(Fight) }),
  /** One fight by its id, for a link to it (the Phantimal check), whatever its age. */
  get: endpoint({ method: 'GET', path: '/api/pvp/fights/:id', response: Fight }),
  create: endpoint({ method: 'POST', path: '/api/pvp/fights', body: FightBody, response: Fight, status: 201 }),
  update: endpoint({ method: 'PUT', path: '/api/pvp/fights/:id', body: FightBody, response: Fight }),
  /** A Battle: the teams of a Supreme Arena, Super League or Guild Duel battle, saved together or not at all. */
  createBattle: endpoint({ method: 'POST', path: '/api/pvp/battles', body: NewBattleBody, response: Battle, status: 201 }),
  /** Edits a whole battle: the teams given are the battle's teams now. */
  updateBattle: endpoint({ method: 'PUT', path: '/api/pvp/battles/:id', body: BattleBody, response: Battle }),
};
