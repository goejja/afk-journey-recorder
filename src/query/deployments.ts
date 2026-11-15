import type Database from 'better-sqlite3';
import { findFormationIds, listFormationIds } from '../db/formation-ids.js';
import type { Deployment, Layout, LayoutUnit } from '../domain/layout.js';
import { PAIR_PHANTIMALS } from '../domain/units.js';

/**
 * Reads a layout from the text of the command line: units as `Hero@tile`, a part of a pair or a summon as `Hero/Part@tile`
 * (`Elijah & Lailah/Elijah@30`), separated by commas; the phantimal as `Name@tile` or, standing on two tiles, `Name@tile+tile`.
 */
export function parseLayout(units: string, phantimal?: string): Layout {
  const place = (text: string) => {
    const at = text.lastIndexOf('@');
    const tile = Number(text.slice(at + 1));
    if (at < 1 || !Number.isInteger(tile) || tile < 0) throw new Error(`"${text}" is not "name@tile"`);
    return { name: text.slice(0, at).trim(), tile };
  };
  const placed: LayoutUnit[] = units.split(',').map((t) => t.trim()).filter(Boolean).map((text) => {
    const { name, tile } = place(text);
    const [hero, part = ''] = name.split('/').map((x) => x.trim());
    return { kind: 'hero' as const, hero: hero!, part, tile };
  });
  if (phantimal) {
    const [first, partner] = phantimal.split('+');
    const main = place(first!);
    placed.push({ kind: 'phantimal', hero: main.name, part: '', tile: main.tile });
    if (partner !== undefined) {
      const part = PAIR_PHANTIMALS[main.name];
      if (!part) throw new Error(`${main.name} has no second part`);
      placed.push({ kind: 'phantimal', hero: main.name, part, tile: Number(partner) });
    }
  }
  return { units: placed };
}

/**
 * Reads the teams of a Deployment from the command line: the teams of `--units` separated by `|`, team 1 first, and the
 * phantimals of `--phantimal` the same way, one per team (leave one empty for a team without). Each team is read by parseLayout.
 */
export function parseDeployment(units: string, phantimal?: string): Deployment {
  const unitsOf = units.split('|');
  const phantimals = (phantimal ?? '').split('|');
  const count = Math.max(unitsOf.length, phantimals.length);
  return {
    teams: Array.from({ length: count }, (_, k) => {
      const layout = parseLayout(unitsOf[k] ?? '', phantimals[k]?.trim() || undefined);
      return layout.units.length === 0 ? null : { ...layout, artifact: null };
    }),
  };
}

/** The player's Formation IDs; given the teams placed, only the codes that cover them with the same units on the same tiles, as placed or turned upside down. */
export function formationIds(db: Database.Database, placed?: Deployment) {
  return placed ? findFormationIds(db, placed) : listFormationIds(db);
}
