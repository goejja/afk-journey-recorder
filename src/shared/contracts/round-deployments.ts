import { z } from 'zod';
import type { RoundDeployment } from '../../domain/round-deployment.js';
import { endpoint } from '../contract.js';

/** What each Profile fields in one Round of a Tournament (ADR 0020). The teams are checked unit by unit by the server. */
export const RoundDeploymentEntry = z.object({
  profileId: z.number(),
  name: z.string(),
  playerId: z.string().nullable(),
  teams: z.custom<RoundDeployment>(),
  /** The team slots (0-based) that come from a saved Battle of the Round, not from a confirmed Deployment. */
  recorded: z.array(z.number()).optional(),
  /** True when a Deployment is confirmed for this Profile; false when every team shown comes from a saved Battle. */
  confirmed: z.boolean().optional(),
});
export type RoundDeploymentEntry = z.infer<typeof RoundDeploymentEntry>;

const ProfileTeams = z.object({ profileId: z.number(), teams: z.custom<RoundDeployment>() });

const TeamsBody = z.object({ teams: z.custom<RoundDeployment>().optional() }, { error: 'The teams must be a list of 5 teams' });
const ENTRIES_MESSAGE = 'The entries must be a non-empty list of Profiles';
// each entry is checked one by one by the server: an unknown Profile is a 404, not a bad request
const EntriesBody = z.object({ entries: z.array(z.custom<{ profileId: number; teams: RoundDeployment }>(), { error: ENTRIES_MESSAGE }).min(1, ENTRIES_MESSAGE) }, { error: ENTRIES_MESSAGE });
const MoveBody = z.object({ to: z.custom<number>().optional() }, { error: 'Unknown Profile to move to' });

const base = '/api/tournaments/:tournament/rounds/:round/deployments';

export const roundDeploymentsContract = {
  list: endpoint({ method: 'GET', path: base, response: z.array(RoundDeploymentEntry) }),
  /** Replaces the Deployment of one Profile in the Round: the teams given are its teams now, all or nothing. */
  save: endpoint({ method: 'PUT', path: `${base}/:profile`, body: TeamsBody, response: ProfileTeams }),
  /** Replaces the Deployments of several Profiles in the Round in one transaction (ADR 0021). */
  saveAll: endpoint({ method: 'PUT', path: base, body: EntriesBody, response: z.object({ entries: z.array(ProfileTeams) }) }),
  remove: endpoint({ method: 'DELETE', path: `${base}/:profile`, response: z.undefined(), status: 204 }),
  /** Moves a Profile's Deployment of the Round to another Profile (a repair, ADR 0021). */
  move: endpoint({ method: 'POST', path: `${base}/:profile/move`, body: MoveBody, response: ProfileTeams, badBody: 404 }),
};
