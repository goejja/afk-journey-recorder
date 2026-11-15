import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/open.js';
import { storeReferenceData } from '../../src/import/store-reference.js';
import { createApp } from '../../src/server/app.js';

let app: Hono;

beforeEach(() => {
  const db = openDb(':memory:');
  storeReferenceData(db, {
    ranks: [
      { name: 'Rare', position: 0 },
      { name: 'Mythic+', position: 1 },
    ],
    equipmentLevels: [0, 5, 10, 15],
    rankEquipmentCaps: [{ rank: 'Mythic+', minLevel: null, maxLevel: 10 }],
    artifacts: [],
    phantimals: [],
  });
  db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Evie', 'A', 'Support', 'Lightbearer', 'Magic')").run();
  db.prepare("INSERT INTO hero (name, tier, class, faction, damage_type) VALUES ('Smokey & Meerky', 'S', 'Support', 'Mauler', 'Magic')").run();
  app = createApp(db);
});

const put = (name: string, body: unknown) =>
  app.request(`/api/roster/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const heroes = async () => (await app.request('/api/heroes')).json() as Promise<any[]>;

describe('roster API', () => {
  it('lists every hero as not owned at first', async () => {
    const list = await heroes();
    expect(list).toHaveLength(2);
    expect(list.every((h) => h.owned === false && h.rank === null)).toBe(true);
  });

  it('marks a hero owned with rank and equipment', async () => {
    expect((await put('Evie', { rank: 'Mythic+', equipmentLevel: 10 })).status).toBe(200);
    expect((await heroes()).find((h) => h.name === 'Evie')).toMatchObject({ owned: true, rank: 'Mythic+', equipmentLevel: 10 });
  });

  it('updates an owned hero in place', async () => {
    await put('Evie', { rank: 'Rare', equipmentLevel: null });
    await put('Evie', { rank: 'Mythic+', equipmentLevel: 5 });
    const evie = (await heroes()).find((h) => h.name === 'Evie');
    expect(evie).toMatchObject({ rank: 'Mythic+', equipmentLevel: 5 });
  });

  it('handles names containing special characters', async () => {
    expect((await put('Smokey & Meerky', { rank: null, equipmentLevel: null })).status).toBe(200);
    expect((await heroes()).find((h) => h.name === 'Smokey & Meerky')?.owned).toBe(true);
  });

  it('rejects equipment above the rank cap', async () => {
    const response = await put('Evie', { rank: 'Mythic+', equipmentLevel: 15 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not allowed/);
    expect((await heroes()).find((h) => h.name === 'Evie')?.owned).toBe(false);
  });

  it('rejects equipment on a rank below Mythic+', async () => {
    const response = await put('Evie', { rank: 'Rare', equipmentLevel: 5 });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not allowed at rank Rare/);
  });

  it('rejects unknown heroes and malformed bodies', async () => {
    expect((await put('Nobody', { rank: null, equipmentLevel: null })).status).toBe(404);
    expect((await put('Evie', { rank: 5 })).status).toBe(400);
  });

  it('removes a hero from the roster', async () => {
    await put('Evie', { rank: null, equipmentLevel: null });
    expect((await app.request('/api/roster/Evie', { method: 'DELETE', headers: { 'x-afk-action': 'app' } })).status).toBe(204);
    expect((await heroes()).find((h) => h.name === 'Evie')?.owned).toBe(false);
  });

  it('resets the whole roster', async () => {
    await put('Evie', { rank: null, equipmentLevel: null });
    await put('Smokey & Meerky', { rank: null, equipmentLevel: null });
    expect((await app.request('/api/roster/reset', { method: 'POST', headers: { 'x-afk-action': 'app' } })).status).toBe(204);
    expect((await heroes()).some((h) => h.owned)).toBe(false);
  });

  it('serves the reference rules', async () => {
    const rules = await (await app.request('/api/reference')).json();
    expect(rules.ranks).toEqual(['Rare', 'Mythic+']);
    expect(rules.caps).toEqual([{ rank: 'Mythic+', minLevel: null, maxLevel: 10 }]);
  });
});
