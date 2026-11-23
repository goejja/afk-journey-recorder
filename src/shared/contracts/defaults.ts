import { z } from 'zod';
import { DEFAULT_MODES, type DefaultSlot } from '../../domain/defaults.js';
import { titanReaverSetupSchema } from '../../domain/titan-reaver.js';
import { endpoint } from '../contract.js';

/** The weekly setup of each mode: for each team or fight, what new records start with. */
export const WeeklySetups = z.record(z.enum(DEFAULT_MODES), z.object({ slots: z.array(z.custom<DefaultSlot>()), updatedAt: z.string().nullable() }));
export type WeeklySetups = z.infer<typeof WeeklySetups>;

export const defaultsContract = {
  list: endpoint({ method: 'GET', path: '/api/defaults', response: WeeklySetups }),
  /** Replaces the whole setup of a mode. The slots are checked against the mode (`defaultsSchema`), which the path names. */
  save: endpoint({ method: 'PUT', path: '/api/defaults/:mode', body: z.object({ slots: z.array(z.custom<DefaultSlot>()) }), response: WeeklySetups }),
  clear: endpoint({ method: 'DELETE', path: '/api/defaults/:mode', response: WeeklySetups }),
};

/** The Titan Reaver setup of Admin > Weekly default: the 6 boss slots of the current event, null where none is set, and when it was last saved. */
export const TitanReaverView = titanReaverSetupSchema.extend({ updatedAt: z.string().nullable() });
export type TitanReaverView = z.infer<typeof TitanReaverView>;

export const titanReaverContract = {
  get: endpoint({ method: 'GET', path: '/api/titan-reaver/setup', response: TitanReaverView }),
  /** Replaces the setup whole. The body is checked with `titanReaverSetupSchema`. */
  save: endpoint({ method: 'PUT', path: '/api/titan-reaver/setup', body: z.custom<z.infer<typeof titanReaverSetupSchema>>(), response: TitanReaverView }),
  clear: endpoint({ method: 'DELETE', path: '/api/titan-reaver/setup', response: TitanReaverView }),
};
