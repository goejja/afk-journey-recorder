import { z } from 'zod';
import { DREAM_HUNT_FIGHTS } from './dream-hunt.js';
import { problemWith } from './schema.js';

/** The modes whose weekly default (bosses, maps, rules) the player can save as the starting point of new records. */
export const DEFAULT_MODES = ['Supreme Arena', 'Super League', 'Guild Duel', 'Dream Hunt'] as const;
export type DefaultMode = (typeof DEFAULT_MODES)[number];

/** How many teams (or fights) each mode has to set up. */
export const DEFAULT_SLOTS: Record<DefaultMode, number> = { 'Supreme Arena': 3, 'Super League': 5, 'Guild Duel': 3, 'Dream Hunt': DREAM_HUNT_FIGHTS };

/** What new records of a mode start with for one team or fight; anything left out keeps the form's own choice. */
export interface DefaultSlot {
  /** Dream Hunt only. */
  boss: string | null;
  mapName: string | null;
  /** Supreme Arena: any team. Dream Hunt: the last fight only. Super League and Guild Duel: none. */
  rule: string | null;
}

export const emptySlot = (): DefaultSlot => ({ boss: null, mapName: null, rule: null });

/** Whether a rule can be set on this team or fight of the mode. */
export const allowsRule = (mode: DefaultMode, position: number) => mode === 'Supreme Arena' || (mode === 'Dream Hunt' && position === DEFAULT_SLOTS['Dream Hunt']);

/** The setup a mode is saved with: at most as many teams as the mode has, each naming only what that team can have. Names are checked against the database elsewhere. */
export const defaultsSchema = (mode: DefaultMode) => {
  const tooMany = `A ${mode} setup has at most ${DEFAULT_SLOTS[mode]} teams`;
  return z.object(
    {
      slots: z
        .array(z.unknown(), { error: tooMany })
        .max(DEFAULT_SLOTS[mode], tooMany)
        .superRefine((slots, ctx) => {
          for (const [index, raw] of slots.entries()) {
            const slot = raw as Record<string, unknown> | null | undefined;
            const problem = (() => {
              for (const key of ['boss', 'mapName', 'rule'] as const) {
                const value = slot?.[key];
                if (value !== null && value !== undefined && typeof value !== 'string') return `Team ${index + 1}: ${key} must be a name`;
              }
              if (slot?.boss && mode !== 'Dream Hunt') return `Team ${index + 1}: only Dream Hunt has bosses`;
              if (slot?.rule && !allowsRule(mode, index + 1)) return `Team ${index + 1}: this team has no rule`;
              return null;
            })();
            if (problem) return void ctx.addIssue({ code: 'custom', message: problem });
          }
        })
        .transform((slots) => slots as Partial<DefaultSlot>[]),
    },
    { error: tooMany },
  );
};

/** Returns an error message, or null when the slots can be saved for the mode (names are checked against the database elsewhere). */
export function validateDefaults(mode: unknown, slots: unknown): string | null {
  if (!DEFAULT_MODES.includes(mode as DefaultMode)) return `The mode must be one of ${DEFAULT_MODES.join(', ')}`;
  return problemWith(defaultsSchema(mode as DefaultMode), { slots });
}
