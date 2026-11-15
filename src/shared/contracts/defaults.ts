import { z } from 'zod';
import { DEFAULT_MODES, type DefaultSlot } from '../../domain/defaults.js';
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
