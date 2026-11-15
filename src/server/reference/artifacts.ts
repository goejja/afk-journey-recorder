import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { artifactsContract, type Artifact } from '../../shared/contracts/artifacts.js';
import { renameArtifactInFormationIds } from '../../db/formation-ids.js';
import { fail, serve } from '../contract.js';

interface ArtifactRow {
  name: string;
  group: string;
  source: 'import' | 'manual';
}

/** Routes for the Artifacts menu: list, add, edit (name and group) and delete. */
export function artifactRoutes(db: Database.Database): Hono {
  const app = new Hono();
  const find = (name: string) =>
    db.prepare('SELECT name, grp AS "group", source FROM artifact WHERE name = ?').get(name) as ArtifactRow | undefined;
  const uses = (name: string) =>
    (db.prepare('SELECT (SELECT count(*) FROM formation WHERE artifact = @name) + (SELECT count(*) FROM arena_attempt WHERE opp_artifact = @name)').pluck().get({ name }) as number);
  const toJson = (row: ArtifactRow): Artifact => ({ ...row, uses: uses(row.name) });

  serve(
    app,
    artifactsContract.list,
    () =>
      db
        .prepare(
          `SELECT name, grp AS "group", source,
                  (SELECT count(*) FROM formation WHERE artifact = artifact.name) + (SELECT count(*) FROM arena_attempt WHERE opp_artifact = artifact.name) AS uses
           FROM artifact ORDER BY grp DESC, name`,
        )
        .all() as Artifact[],
  );

  serve(app, artifactsContract.create, ({ body }) => {
    if (find(body.name)) return fail(409, `An artifact named "${body.name}" already exists`);
    db.prepare("INSERT INTO artifact (name, grp, source) VALUES (?, ?, 'manual')").run(body.name, body.group);
    return toJson(find(body.name)!);
  });

  serve(app, artifactsContract.save, ({ params, body }) => {
    const current = find(params.name);
    if (!current) return fail(404, 'Unknown artifact');
    if (body.name !== current.name && find(body.name)) return fail(409, `An artifact named "${body.name}" already exists`);
    if (body.name === current.name && body.group === current.group) return toJson(current);
    // Any edit makes it the player's own, so a re-import never overwrites it.
    db.transaction(() => {
      db.prepare("UPDATE artifact SET name = ?, grp = ?, source = 'manual' WHERE name = ?").run(body.name, body.group, current.name);
      renameArtifactInFormationIds(db, current.name, body.name); // plain text inside JSON, no foreign key to follow
    })();
    return toJson(find(body.name)!);
  });

  serve(app, artifactsContract.remove, ({ params }) => {
    if (!find(params.name)) return fail(404, 'Unknown artifact');
    const count = uses(params.name);
    if (count > 0) return fail(409, `${count} record${count === 1 ? ' uses' : 's use'} ${params.name}`);
    db.prepare('DELETE FROM artifact WHERE name = ?').run(params.name);
  });

  return app;
}
