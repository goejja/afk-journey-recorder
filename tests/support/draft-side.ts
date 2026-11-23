import type { FightDraftSide } from '../../web/backend.js';

/** A side of a battle draft: the name, profile and heroes given, with nothing read beside the heroes. */
export const draftSide = (given: Pick<FightDraftSide, 'name' | 'profile' | 'heroes'> & Partial<FightDraftSide>): FightDraftSide => ({ artifact: null, phantimal: null, crops: null, unread: [], ...given });
