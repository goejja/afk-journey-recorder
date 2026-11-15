import { z } from 'zod';
import { ARENA_MODES } from './arena.js';
import { problemWith } from './schema.js';

/** Fewer comparable records than this is anecdote: a win rate from it says little. */
export const SMALL_SAMPLE = 5;

export const isSmallSample = (games: number): boolean => games < SMALL_SAMPLE;

/** Every mode the statistics can cover, in the order they are listed. */
export const STATS_MODES = ['Stage', 'Dream Hunt', ...ARENA_MODES] as const;

/** The modes the Statistics page starts with until the player chooses others in Admin: the player-versus-player ones except Treasure Rush, whose fights are another game and would shift the hero rates of the others unless asked for. */
export const DEFAULT_STATS_MODES: readonly string[] = ARENA_MODES.filter((m) => m !== 'Treasure Rush');

/** A list of known modes. Empty is allowed: it means every mode. */
export const StatsModesSchema = z
  .array(z.unknown(), { error: 'Give the modes as a list' })
  .superRefine((modes, ctx) => {
    const unknown = modes.find((m) => typeof m !== 'string' || !(STATS_MODES as readonly string[]).includes(m));
    if (unknown !== undefined) ctx.addIssue({ code: 'custom', message: `Unknown mode ${JSON.stringify(unknown)}` });
  })
  .transform((modes) => modes as string[]);

/** An error message when this is not a list of known modes. */
export const validateStatsModes = (modes: unknown): string | null => problemWith(StatsModesSchema, modes);

/** The modes of a valid list, each once, in the order of `STATS_MODES`. */
export const orderedStatsModes = (modes: string[]): string[] => STATS_MODES.filter((m) => modes.includes(m));

/** A value to three decimals, as the query output and the Win Score report it. */
export const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** A value to two decimals. */
export const round2 = (value: number) => Math.round(value * 100) / 100;
