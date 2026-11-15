import { describe, expect, it } from 'vitest';
import type { BattleImportPicture, Profile } from '../../../web/backend.js';
import { groupPictures } from '../../../web/reader/battle-import.js';
import { applyEdits, namesOf, noEdits, pruneEdits } from '../../../web/reader/battle-import-edits.js';

const side = (name: string, profile: { id: number; name: string; playerId: string | null } | null = null) => ({ name, profile, heroes: [], artifact: null, phantimal: null, crops: null, unread: [] });
const picture = (id: number, key: string | undefined, a: string, b: string, number: number | null = null): BattleImportPicture =>
  ({ id, key, label: null, state: 'done', draft: { mode: 'Guild Duel', number, outcome: 'Win', sideA: side(a), sideB: side(b) } }) as unknown as BattleImportPicture;
const profile = (id: number, name: string): Profile => ({ id, name, playerId: null }) as unknown as Profile;

describe('pruneEdits', () => {
  it('forgets numbers and moves of pictures that left the queue, and keeps the rest', () => {
    const edits = { numbers: { a: 1, b: 2 }, moved: { a: 'g', b: 'h' }, made: { luna: 3 } };
    expect(pruneEdits(edits, new Set(['a']))).toEqual({ numbers: { a: 1 }, moved: { a: 'g' }, made: { luna: 3 } });
  });

  it('forgets the profiles given to names once the queue is empty', () => {
    expect(pruneEdits({ numbers: {}, moved: {}, made: { luna: 3 } }, new Set())).toEqual(noEdits());
  });

  it('returns the same object when nothing goes, so state does not change', () => {
    const edits = { numbers: { a: 1 }, moved: {}, made: {} };
    expect(pruneEdits(edits, new Set(['a']))).toBe(edits);
  });
});

describe('applyEdits', () => {
  it('replaces the fight number read, by the picture key', () => {
    const [done] = applyEdits([picture(1, 'k1', 'Luna', 'Rex', 2)], { ...noEdits(), numbers: { k1: 3 } }, []);
    expect(done!.draft!.number).toBe(3);
    const [cleared] = applyEdits([picture(1, 'k1', 'Luna', 'Rex', 2)], { ...noEdits(), numbers: { k1: null } }, []);
    expect(cleared!.draft!.number).toBeNull();
  });

  it('falls back to the id when the picture has no key', () => {
    const [done] = applyEdits([picture(7, undefined, 'Luna', 'Rex', 2)], { ...noEdits(), numbers: { '7': 1 } }, []);
    expect(done!.draft!.number).toBe(1);
  });

  it('gives a name its profile (0 is none) and leaves a profile that no longer exists alone', () => {
    const own = { id: 9, name: 'Old', playerId: null };
    const edits = { ...noEdits(), made: { luna: 4, rex: 0, ghost: 99 } };
    const [done] = applyEdits([picture(1, 'k1', ' Luna ', 'Rex')], edits, [profile(4, 'Luna')]);
    expect(done!.draft!.sideA.profile).toEqual({ id: 4, name: 'Luna', playerId: null });
    expect(done!.draft!.sideB.profile).toBeNull();
    const [kept] = applyEdits([{ ...picture(2, 'k2', 'Ghost', 'Rex'), draft: { ...picture(2, 'k2', 'Ghost', 'Rex').draft!, sideA: side('Ghost', own) } }], edits, []);
    expect(kept!.draft!.sideA.profile).toEqual(own);
  });
});

describe('groups of moved pictures', () => {
  it('follow the picture key, also for a picture put in a battle of its own', () => {
    const pictures = [picture(1, 'k1', 'Luna', 'Rex'), picture(2, 'k2', 'Luna', 'Rex')];
    expect(groupPictures(pictures).map((g) => g.pictures.length)).toEqual([2]);
    const groups = groupPictures(pictures, { k2: 'picture-k2' });
    expect(groups.map((g) => g.key)).toEqual(['Guild Duel|luna|rex', 'picture-k2']);
  });
});

describe('namesOf', () => {
  it('lists each name once, with the profile any of its pictures resolved to', () => {
    const withProfile = picture(2, 'k2', 'luna', 'Rex');
    withProfile.draft!.sideA.profile = { id: 4, name: 'Luna', playerId: null };
    const [group] = groupPictures([picture(1, 'k1', 'Luna', 'Rex'), withProfile]);
    expect(namesOf(group!, 'A')).toEqual([{ name: 'Luna', given: { id: 4, name: 'Luna', playerId: null } }]);
    expect(namesOf(group!, 'B')).toEqual([{ name: 'Rex', given: null }]);
  });
});
