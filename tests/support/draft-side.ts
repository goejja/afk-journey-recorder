import type { BattleDraftSide } from '../../web/backend.js';

/** A side of a battle draft: the name, profile and heroes given, with nothing read beside the heroes. */
export const draftSide = (given: Pick<BattleDraftSide, 'name' | 'profile' | 'heroes'> & Partial<BattleDraftSide>): BattleDraftSide => ({ artifact: null, phantimal: null, crops: null, unread: [], ...given });
