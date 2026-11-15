import { describe, expect, it } from 'vitest';
import { reportExtras } from '../../../src/server/reader/import-pictures.js';
import type { FoundRow } from '../../../src/vision/tile-detect.js';

const side = (top: number): FoundRow => ({ score: 1, boxes: Array.from({ length: 5 }, (_, i) => ({ left: 66, top: top + i * 98, width: 64, height: 88 })) }) as FoundRow;

describe('reportExtras', () => {
  it('puts the artifact icon in the header of each side and the phantimal where a sixth hero tile would stand', () => {
    const [ally, enemy] = reportExtras([side(716), side(1418)], 1170, 2532);
    expect(ally!.artifact).toEqual({ left: 180, top: 528, width: 128, height: 76 });
    expect(enemy!.artifact.left).toBe(876);
    expect(ally!.phantimal).toEqual({ left: 54, top: 716 + 5 * 98 + 4, width: 100, height: 70 });
    expect(enemy!.phantimal.top).toBe(1418 + 5 * 98 + 4);
  });

  it('follows the picture width and stays inside the picture', () => {
    const [ally] = reportExtras([side(716)], 585, 1266);
    expect(ally!.artifact.left).toBe(90);
    const [low] = reportExtras([side(1200)], 1170, 2532);
    expect(low!.phantimal.top + low!.phantimal.height).toBeLessThanOrEqual(2532);
  });
});
