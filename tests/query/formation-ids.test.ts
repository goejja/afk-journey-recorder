import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/open.js';
import { rotateDeployment, type Deployment, type DeploymentTeam, type Layout } from '../../src/domain/layout.js';
import { addFormationId, checkFormationId, declareFormationId, deleteFormationId, findFormationIds, listFormationIds, renameArtifactInFormationIds } from '../../src/db/formation-ids.js';

let db: Database.Database;
beforeEach(() => {
  db = openDb(':memory:');
});

const layout: Layout = {
  units: [
    { kind: 'hero', hero: 'Alna', part: '', tile: 31 },
    { kind: 'hero', hero: 'Rolan', part: '', tile: 27 },
    { kind: 'phantimal', hero: 'Orson', part: '', tile: 30 },
  ],
};
const second: Layout = { units: [{ kind: 'hero', hero: 'Mira', part: '', tile: 32 }] };
const third: Layout = { units: [{ kind: 'hero', hero: 'Zanie', part: '', tile: 28 }] };
const team = (l: Layout, artifact: string | null = null): DeploymentTeam => ({ ...l, artifact });
const one: Deployment = { teams: [team(layout, 'Candlestick')] };
const three: Deployment = { teams: [team(layout, 'Candlestick'), team(second, 'Tidesurge'), team(third)] };

describe('declaring a formation id', () => {
  it('stores a new code with its teams, their artifacts and the maps it was seen on', () => {
    declareFormationId(db, 'A1B2C3D4', three, { mapNames: ['Arena I', 'Open', 'Arena I'] });
    expect(listFormationIds(db)).toEqual([{ code: 'A1B2C3D4', deployment: three, maps: ['Arena I', 'Open'], records: 0 }]);
  });
  it('adds the maps when the same code is declared again, and never repeats them', () => {
    declareFormationId(db, 'A1B2C3D4', one, { mapNames: ['Arena I'] });
    declareFormationId(db, 'A1B2C3D4', one, { mapNames: ['Arena I', 'Open'] });
    expect(listFormationIds(db)[0]!.maps).toEqual(['Arena I', 'Open']);
  });
  it('accepts the same deployment seen from the other half, and keeps it as first declared', () => {
    declareFormationId(db, 'A1B2C3D4', three, {});
    expect(checkFormationId(db, 'A1B2C3D4', rotateDeployment(three))).toBeNull();
    declareFormationId(db, 'A1B2C3D4', rotateDeployment(three), { mapNames: ['Open'] });
    expect(listFormationIds(db)[0]!.deployment).toEqual(three);
  });
  it('refuses a known code with other units or tiles in a team both have, and leaves the stored teams alone', () => {
    declareFormationId(db, 'A1B2C3D4', three, {});
    const other: Deployment = { teams: [team(layout), team({ ...second, units: [{ kind: 'hero', hero: 'Mira', part: '', tile: 33 }] })] };
    expect(checkFormationId(db, 'A1B2C3D4', other)).toMatch(/A1B2C3D4 is stored with other units or tiles/);
    expect(() => declareFormationId(db, 'A1B2C3D4', other, {})).toThrow(/other units or tiles/);
    expect(listFormationIds(db)[0]!.deployment).toEqual(three);
  });
  it('refuses teams that are turned differently from each other', () => {
    declareFormationId(db, 'A1B2C3D4', three, {});
    const mixed: Deployment = { teams: [team(layout), rotateDeployment({ teams: [null, team(second)] }).teams[1]!] };
    expect(checkFormationId(db, 'A1B2C3D4', mixed)).toMatch(/other units or tiles/);
  });
  it('refuses another artifact on a team both have, but not a team recorded without one', () => {
    declareFormationId(db, 'A1B2C3D4', three, {});
    expect(checkFormationId(db, 'A1B2C3D4', { teams: [team(layout, 'Tidesurge')] })).toMatch(/Candlestick on team 1, not Tidesurge/);
    expect(checkFormationId(db, 'A1B2C3D4', { teams: [team(layout, null)] })).toBeNull();
  });
  it('extends a stored code with the teams and artifacts it lacked, keeping what it had', () => {
    declareFormationId(db, 'A1B2C3D4', { teams: [team(layout, null)] }, {});
    declareFormationId(db, 'A1B2C3D4', three, {});
    expect(listFormationIds(db)[0]!.deployment).toEqual(three);
    declareFormationId(db, 'A1B2C3D4', { teams: [team(layout, 'Candlestick')] }, {});
    expect(listFormationIds(db)[0]!.deployment).toEqual(three);
  });
  it('extends a code with a team that was seen turned, stored the way the code was first declared', () => {
    declareFormationId(db, 'A1B2C3D4', { teams: [team(layout)] }, {});
    declareFormationId(db, 'A1B2C3D4', rotateDeployment({ teams: [team(layout), team(second)] }), {});
    expect(listFormationIds(db)[0]!.deployment).toEqual({ teams: [team(layout), team(second)] });
  });
  it('keeps the numbers of the teams when a battle is recorded with some of them only', () => {
    declareFormationId(db, 'A1B2C3D4', { teams: [team(layout), null, team(third)] }, {});
    expect(listFormationIds(db)[0]!.deployment.teams.map((t) => t?.units[0]?.hero ?? null)).toEqual(['Alna', null, 'Zanie']);
  });
  it('refuses a code that is not eight digits or capital letters', () => {
    expect(checkFormationId(db, 'a1b2c3d4', one)).toMatch(/8 characters/);
    expect(() => declareFormationId(db, 'short', one, {})).toThrow(/8 characters/);
  });
  it('allows several codes for one deployment', () => {
    declareFormationId(db, 'A1B2C3D4', one, {});
    declareFormationId(db, 'ZZZZ9999', one, {});
    expect(listFormationIds(db).map((e) => e.code)).toEqual(['A1B2C3D4', 'ZZZZ9999']);
  });
});

describe('finding the codes of some teams', () => {
  beforeEach(() => {
    declareFormationId(db, 'A1B2C3D4', three, { mapNames: ['Arena I'] });
  });
  it('finds a code whose teams are the same, and says so', () => {
    expect(findFormationIds(db, three).map((m) => [m.code, m.match])).toEqual([['A1B2C3D4', 'same']]);
  });
  it('finds it when only the first teams are placed, or only a later one', () => {
    expect(findFormationIds(db, { teams: [team(layout)] }).map((m) => m.code)).toEqual(['A1B2C3D4']);
    expect(findFormationIds(db, { teams: [null, team(second)] }).map((m) => m.code)).toEqual(['A1B2C3D4']);
  });
  it('finds it when all the teams stand on the other half, and says it is rotated', () => {
    expect(findFormationIds(db, rotateDeployment(three)).map((m) => [m.code, m.match])).toEqual([['A1B2C3D4', 'rotated']]);
  });
  it('finds nothing for another deployment, for a team the code lacks, or for nothing placed', () => {
    expect(findFormationIds(db, { teams: [team({ ...layout, units: layout.units.slice(1) })] })).toEqual([]);
    expect(findFormationIds(db, { teams: [team(layout), team(second), team(third), team(second)] })).toEqual([]);
    expect(findFormationIds(db, { teams: [] })).toEqual([]);
  });
  it('does not mind which artifact the placed teams carry', () => {
    expect(findFormationIds(db, { teams: [team(layout, 'Tidesurge')] }).map((m) => m.code)).toEqual(['A1B2C3D4']);
  });
});

describe('adding, renaming an artifact and deleting', () => {
  it('adds a code by hand, with no map', () => {
    addFormationId(db, 'A1B2C3D4', one);
    expect(listFormationIds(db)[0]).toMatchObject({ code: 'A1B2C3D4', maps: [] });
    expect(() => addFormationId(db, 'A1B2C3D4', one)).toThrow(/already/);
  });
  it('follows an artifact that is renamed', () => {
    declareFormationId(db, 'A1B2C3D4', three, {});
    renameArtifactInFormationIds(db, 'Candlestick', 'Brass Candlestick');
    expect(listFormationIds(db)[0]!.deployment.teams.map((t) => t?.artifact)).toEqual(['Brass Candlestick', 'Tidesurge', null]);
  });
  it('deletes a code and the records that named it forget it', () => {
    declareFormationId(db, 'A1B2C3D4', one, {});
    db.prepare("INSERT INTO attempt (mode, outcome) VALUES ('Arena', 'Win')").run();
    db.prepare("INSERT INTO formation (attempt_id, formation_id) VALUES (1, 'A1B2C3D4')").run();
    db.prepare("INSERT INTO battle (mode, formation_id) VALUES ('Supreme Arena', 'A1B2C3D4')").run();
    expect(listFormationIds(db)[0]!.records).toBe(2);
    expect(deleteFormationId(db, 'A1B2C3D4')).toBe(1);
    expect(db.prepare('SELECT formation_id FROM formation').pluck().get()).toBeNull();
    expect(db.prepare('SELECT formation_id FROM battle').pluck().get()).toBeNull();
    expect(listFormationIds(db)).toEqual([]);
  });
  it('reports that a code is unknown', () => {
    expect(deleteFormationId(db, 'A1B2C3D4')).toBe(0);
  });
});

describe('the query command', () => {
  it('reads a layout from the command line, a pair part, a summon and a phantimal on two tiles', async () => {
    const { parseLayout } = await import('../../src/query/index.js');
    expect(parseLayout('Alna@31, Elijah & Lailah/Elijah@30,Zanie/Laser Turret@12', 'Wedge of Matter@30+31')).toEqual({
      units: [
        { kind: 'hero', hero: 'Alna', part: '', tile: 31 },
        { kind: 'hero', hero: 'Elijah & Lailah', part: 'Elijah', tile: 30 },
        { kind: 'hero', hero: 'Zanie', part: 'Laser Turret', tile: 12 },
        { kind: 'phantimal', hero: 'Wedge of Matter', part: '', tile: 30 },
        { kind: 'phantimal', hero: 'Wedge of Matter', part: 'Wedge of Power', tile: 31 },
      ],
    });
    expect(() => parseLayout('Alna')).toThrow(/name@tile/);
  });
  it('lists the library, or only the codes covering the teams given', async () => {
    const { formationIds, parseDeployment } = await import('../../src/query/index.js');
    declareFormationId(db, 'A1B2C3D4', three, { mapNames: ['Arena I'] });
    const matches = (units: string, phantimal?: string) => formationIds(db, parseDeployment(units, phantimal)).map((e) => [e.code, 'match' in e ? e.match : null]);
    expect(formationIds(db).map((e) => e.code)).toEqual(['A1B2C3D4']);
    expect(matches('Alna@31,Rolan@27', 'Orson@30')).toEqual([['A1B2C3D4', 'same']]);
    expect(matches('Alna@31,Rolan@27|Mira@32', 'Orson@30|')).toEqual([['A1B2C3D4', 'same']]);
    expect(matches('Alna@13,Rolan@17|Mira@12', 'Orson@14')).toEqual([['A1B2C3D4', 'rotated']]);
    expect(matches('Alna@31')).toEqual([]);
  });
});
