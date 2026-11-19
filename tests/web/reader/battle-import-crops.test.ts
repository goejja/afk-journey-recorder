// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCrops } from '../../../web/reader/battle-import.js';

afterEach(() => vi.unstubAllGlobals());

const side = (over: object = {}) => ({ name: null, profile: null, heroes: [], artifact: null, phantimal: null, crops: null, unread: [], ...over });

describe('fetchCrops', () => {
  it('cuts a tile for each hero and each unread tile, and carries what the Agent was unsure of and its guesses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) })));
    const picture = {
      id: 1,
      draft: {
        sideA: side({
          heroes: [{ tile: 'a', hero: 'Evie', rank: null, equipmentLevel: null }, { tile: 'b', hero: 'Zed', rank: null, equipmentLevel: null, unsure: true, candidates: [] }],
          unread: ['c', 'd'],
          unreadCandidates: { c: ['Fay', 'Nara'] },
        }),
        sideB: side(),
      },
    };
    const crops = await fetchCrops(picture as never);
    const tiles = crops.A.tiles!;
    expect(tiles.map((t) => t.hero)).toEqual(['Evie', 'Zed', null, null]);
    expect(tiles.map((t) => t.unsure)).toEqual([undefined, true, undefined, undefined]);
    expect(tiles.map((t) => t.candidates)).toEqual([undefined, [], ['Fay', 'Nara'], undefined]);
    expect(tiles.every((t) => t.png.startsWith('data:image/png;base64,'))).toBe(true);
    expect(crops.B.tiles).toEqual([]);
  });
});
