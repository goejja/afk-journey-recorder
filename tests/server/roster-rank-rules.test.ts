import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { storeReferenceData } from '../../src/import/store-reference.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;

beforeEach(() => {
  const db = openDb(':memory:');
  storeReferenceData(db, {
    ranks: ['Rare', 'Elite', 'Epic', 'Mythic+'].map((name, position) => ({ name, position })),
    equipmentLevels: [0, 5, 10],
    rankEquipmentCaps: [{ rank: 'Mythic+', minLevel: null, maxLevel: 10 }],
    artifacts: [],
    phantimals: [],
  });
  for (const [name, tier] of [['Sam', 'S'], ['Ann', 'A'], ['Rae', 'R']] as const) {
    db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES (?, ?, 'Mage', 'Wilder', 'Magic')").run(name, tier);
  }
  app = createApp(db);
});

const put = (name: string, body: unknown) =>
  app.request(`/api/roster/${name}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rankOf = async (name: string) => ((await (await app.request('/api/heroes')).json()) as any[]).find((h) => h.name === name).rank;

describe('roster ranks by tier', () => {
  it('starts a hero added without a rank at the lowest rank its tier allows', async () => {
    for (const [name, rank] of [['Sam', 'Epic'], ['Ann', 'Rare'], ['Rae', 'Rare']] as const) {
      expect((await put(name, { rank: null, equipmentLevel: null })).status).toBe(200);
      expect(await rankOf(name)).toBe(rank);
    }
  });

  it('keeps a rank that was asked for when the tier allows it', async () => {
    expect((await put('Sam', { rank: 'Mythic+', equipmentLevel: 5 })).status).toBe(200);
    expect(await rankOf('Sam')).toBe('Mythic+');
    expect((await put('Ann', { rank: 'Elite', equipmentLevel: null })).status).toBe(200);
  });

  it('refuses a rank below an S hero’s Epic, and anything but Rare for an R hero', async () => {
    const sRefusal = await put('Sam', { rank: 'Elite', equipmentLevel: null });
    expect(sRefusal.status).toBe(400);
    expect(((await sRefusal.json()) as any).error).toBe('S heroes start at Epic, not Elite');
    const rRefusal = await put('Rae', { rank: 'Epic', equipmentLevel: null });
    expect(rRefusal.status).toBe(400);
    expect(((await rRefusal.json()) as any).error).toBe('R heroes can only be Rare');
  });
});
