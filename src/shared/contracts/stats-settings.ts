import { z } from 'zod';
import { CounterRuleSchema, StatsModesSchema } from '../../domain/stats.js';
import { endpoint } from '../contract.js';

/** The modes the Statistics page starts with, the defaults it falls back to and every mode that can be chosen. */
export const StatsSettingsView = z.object({ modes: z.array(z.string()), defaults: z.array(z.string()), available: z.array(z.string()) });
export type StatsSettingsView = z.infer<typeof StatsSettingsView>;

export const statsSettingsContract = {
  get: endpoint({ method: 'GET', path: '/api/stats-settings', response: StatsSettingsView }),
  save: endpoint({ method: 'PUT', path: '/api/stats-settings', body: z.object({ modes: StatsModesSchema }, { error: 'Give the modes as a list' }), response: StatsSettingsView }),
  reset: endpoint({ method: 'DELETE', path: '/api/stats-settings', response: StatsSettingsView }),
};

/** The rule that makes a Formation group a counter of another: the saved one, the defaults it falls back to. */
export const CounterRuleView = z.object({ winRate: z.number(), minGames: z.number(), defaults: z.object({ winRate: z.number(), minGames: z.number() }) });
export type CounterRuleView = z.infer<typeof CounterRuleView>;

export const counterRuleContract = {
  get: endpoint({ method: 'GET', path: '/api/counter-rule', response: CounterRuleView }),
  save: endpoint({ method: 'PUT', path: '/api/counter-rule', body: CounterRuleSchema, response: CounterRuleView }),
  reset: endpoint({ method: 'DELETE', path: '/api/counter-rule', response: CounterRuleView }),
};
