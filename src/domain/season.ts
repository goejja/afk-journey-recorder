import { integerFrom } from './schema.js';

/** The season a new database starts on; from then on the player sets it in Admin > General. */
export const DEFAULT_CURRENT_SEASON = 8;

/** A season number the app can hold. */
export const SeasonNumberSchema = integerFrom(1, 999, 'A season is a whole number from 1 to 999');
