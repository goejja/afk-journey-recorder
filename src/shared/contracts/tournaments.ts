import { z } from 'zod';
import { ROUNDS } from '../../domain/tournament.js';
import { endpoint } from '../contract.js';

const NUMBER_MESSAGE = 'The Tournament number must be a whole number from 1';
const DATE_MESSAGE = 'The start date must be YYYY-MM-DD';

/** A new Tournament: its number in the current season and, when known, the day it started. Its season is the current season of Admin > General (ADR 0038). */
export const TournamentBody = z.object(
  {
    number: z.number({ error: NUMBER_MESSAGE }).int(NUMBER_MESSAGE).min(1, NUMBER_MESSAGE),
    startDate: z.string({ error: DATE_MESSAGE }).regex(/^\d{4}-\d{2}-\d{2}$/, DATE_MESSAGE).nullish().transform((day) => day ?? null),
  },
  { error: 'A Tournament needs a number' },
);

export const Tournament = z.object({
  id: z.number(),
  season: z.number(),
  number: z.number(),
  startDate: z.string().nullable(),
  battles: z.number(),
  /** The Rounds that have Battles saved, in the order they are played. */
  rounds: z.array(z.enum(ROUNDS)),
});
export type Tournament = z.infer<typeof Tournament>;

export const tournamentsContract = {
  list: endpoint({ method: 'GET', path: '/api/tournaments', response: z.array(Tournament) }),
  /** Answers the whole list, the latest first. */
  create: endpoint({ method: 'POST', path: '/api/tournaments', body: TournamentBody, response: z.array(Tournament), status: 201 }),
};
