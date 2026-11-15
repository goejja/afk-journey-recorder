import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { createApp } from '../../src/server/app.js';
import { DEFAULT_UNIT_RULES, PAIR_HEROES, PAIR_PHANTIMALS, PARTNER_PHANTIMALS, SUMMONS, UNIT_OWNERS, applyUnitRules, checkUnits, isSummon } from '../../src/domain/units.js';

afterEach(() => applyUnitRules(DEFAULT_UNIT_RULES));

describe('unit rules', () => {
  it('start as what the code used to know', () => {
    expect(PAIR_HEROES).toEqual({ 'Elijah & Lailah': ['Elijah', 'Lailah'] });
    expect(SUMMONS.Zanie).toEqual({ part: 'Laser Turret', count: 2 });
    expect(PAIR_PHANTIMALS).toEqual({ 'Wedge of Matter': 'Wedge of Power' });
    expect(PARTNER_PHANTIMALS.has('Wedge of Power')).toBe(true);
    expect(UNIT_OWNERS).toMatchObject({ Elijah: 'Elijah & Lailah', 'Laser Turret': 'Zanie', 'Phraesto clone': 'Phraesto' });
  });

  it('are replaced, not added to, when applied', () => {
    applyUnitRules({ pairs: { 'Ann & Bo': ['Ann', 'Bo'] }, summons: { Cy: { part: 'Drone', count: 3 } }, phantimalParts: {} });
    expect(PAIR_HEROES).toEqual({ 'Ann & Bo': ['Ann', 'Bo'] });
    expect(SUMMONS).toEqual({ Cy: { part: 'Drone', count: 3 } });
    expect(PAIR_PHANTIMALS).toEqual({});
    expect(PARTNER_PHANTIMALS.size).toBe(0);
    expect(UNIT_OWNERS).toEqual({ Ann: 'Ann & Bo', Bo: 'Ann & Bo', Drone: 'Cy' });
    expect(isSummon({ hero: 'Cy', part: 'Drone' })).toBe(true);
    expect(isSummon({ hero: 'Zanie', part: 'Laser Turret' })).toBe(false);
    expect(checkUnits([{ hero: 'Cy', part: '' }, { hero: 'Cy', part: 'Drone' }])).toMatch(/brings 3 Drone/);
  });

  it('are those of the database that was opened, and the server serves them', async () => {
    const db = openDb(':memory:');
    db.prepare("INSERT INTO hero_summon (hero, part, count) VALUES ('Cy', 'Drone', 3)").run();
    const response = await createApp(db).request('/api/unit-rules');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ summons: { Cy: { part: 'Drone', count: 3 }, Zanie: { part: 'Laser Turret', count: 2 } }, phantimalParts: { 'Wedge of Matter': 'Wedge of Power' } });
    openDb(':memory:');
    expect(SUMMONS.Cy).toBeUndefined();
  });
});
