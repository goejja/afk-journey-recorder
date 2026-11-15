import { applyUnitRules } from '../src/domain/units.js';
import { api } from './backend.js';

/** Brings the web app's pairs, summons and second parts up to date with the server's, after an edit that may have changed them. */
export const refreshUnitRules = async (): Promise<void> => applyUnitRules(await api.unitRules());
