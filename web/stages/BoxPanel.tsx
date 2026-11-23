import { useState } from 'react';
import { AFK_RANGE_TAG } from '../../src/domain/tags.js';
import type { BoxState } from '../../src/domain/stage-grid.js';
import { isApex, type StageKind } from '../../src/domain/stage.js';
import { api, type Attempt, type GameMap } from '../backend.js';
import { FormationIdBadge } from '../FormationIdField.js';
import { TagBadges } from '../Tags.js';
import { UnitsOnMap, type MapUnit } from '../admin/UnitsOnMap.js';
import { mapColumns } from '../../src/domain/map.js';
import { useFitWidth } from '../hooks/fit-width.js';
import { useLoad } from '../hooks/load.js';
import { Notice } from '../ui/Notice.js';
import { Loading } from '../ui/ListStatus.js';

/** How many records of a box the panel lists before `Show N older records`. */
const NEWEST = 5;

/** The map of an auto-battle copy is not known, so it is drawn on this one. */
const COPY_MAP = 'Open';

/** The tiles of a record's map are as wide as its card allows, between these widths in pixels; the portrait on a tile fills this share of it. */
const MIN_TILE_WIDTH = 18;
const MAX_TILE_WIDTH = 40;
const PORTRAIT_SHARE = 0.77;

export interface BoxRef {
  kind: StageKind;
  /** The phase of an Apex box; 0 for the standard kinds. */
  phase: number;
  number: number;
}

interface Props {
  box: BoxRef;
  state: BoxState;
  newestSeason: number | null;
  maps: GameMap[];
  /** Changes when something was saved or deleted, to read the records again. */
  version: number;
  onEdit: (attempt: Attempt) => void;
  onClone: (attempt: Attempt) => void;
  onDelete: (attempt: Attempt) => void;
  /** Starts a new clear on this stage; the map of its newest record, when it has one, is offered. */
  onAdd: (mapName: string | undefined) => void;
  onClose: () => void;
}

const stateText = (state: BoxState, season: number | null) =>
  state === 'cleared' ? 'Cleared this season' : state === 'older' ? `Cleared in season ${season}` : 'No record';

/** The formation of a record on its stage's map, with a portrait on each tile, drawn as wide as the card it is in. */
function RecordMap({ attempt, maps }: { attempt: Attempt; maps: GameMap[] }) {
  const { ref, width } = useFitWidth<HTMLDivElement>(MIN_TILE_WIDTH * 8);
  const copy = attempt.tags.includes(AFK_RANGE_TAG);
  const map = maps.find((m) => m.name === (copy ? COPY_MAP : attempt.stage.mapName));
  if (!map) return null;
  const tileWidth = Math.min(MAX_TILE_WIDTH, Math.max(MIN_TILE_WIDTH, Math.floor(width / mapColumns(map.rowLengths))));
  const { heroes, phantimal } = attempt.formation;
  const unitAt = (tile: number): MapUnit | undefined => {
    const hero = heroes.find((h) => h.tile === tile);
    if (hero) return { kind: 'hero', name: hero.part || hero.name, title: hero.part ? `${hero.name} (${hero.part})` : hero.name };
    return phantimal?.tile === tile ? { kind: 'phantimal', name: phantimal.name } : undefined;
  };
  return (
    <div className="record-map" ref={ref}>
      <UnitsOnMap rowLengths={map.rowLengths} cells={map.cells} label={`Formation on ${map.name}`} tileWidth={tileWidth} portraitSize={Math.round(tileWidth * PORTRAIT_SHARE)} unitAt={unitAt} />
    </div>
  );
}

/** The records of one box, across seasons, under the row of boxes it is in. */
export function BoxPanel({ box, state, newestSeason, maps, version, onEdit, onClone, onDelete, onAdd, onClose }: Props) {
  const records = useLoad(
    () => api.attempts({ kind: box.kind, number: String(box.number), ...(isApex(box.kind) ? { phase: String(box.phase) } : {}) }),
    [box.kind, box.phase, box.number, version],
  );
  const [all, setAll] = useState(false);
  const list = records.data ?? [];
  const shown = all ? list : list.slice(0, NEWEST);
  const heading = `${box.kind} · stage ${box.number}${isApex(box.kind) ? ` · phase ${box.phase}` : ''}`;

  return (
    <section className="stage-panel panel" aria-label={heading}>
      <div className="stage-panel-head">
        <h3>{heading}</h3>
        <span className="muted">{stateText(state, newestSeason)}</span>
        <div className="attempt-actions">
          <button className="primary small" onClick={() => onAdd(list[0]?.stage.mapName)}>
            {list.length === 0 && !records.loading ? 'Record a clear' : 'Add a clear'}
          </button>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {records.error && (
        <Notice kind="error">
          {records.error}
        </Notice>
      )}
      {records.data === undefined && !records.error && <Loading />}
      {records.data && list.length === 0 && <p className="muted">Nothing recorded for this stage yet.</p>}
      <ul className="attempts stage-records" aria-label={`Records of ${heading}`}>
        {shown.map((a) => (
          <li key={a.id} className="attempt stage-card">
            <div className="stage-record">
              <span className="badge" title="The season of the stage">
                S{a.stage.season}
              </span>
              <span className="muted">{a.createdAt}</span>
              {a.buffLevel !== null && <span className="muted">buff {a.buffLevel}</span>}
            </div>
            <RecordMap attempt={a} maps={maps} />
            <div className="tags-cell">
              <TagBadges tags={a.tags} />
              <FormationIdBadge code={a.formation.formationId} />
            </div>
            {a.note && (
              <span className="muted stage-note" title={a.note}>
                {a.note}
              </span>
            )}
            <div className="attempt-actions">
              <button className="small" onClick={() => onEdit(a)}>
                Edit
              </button>
              <button className="small" title="Start a new record from this one, on this season's stage" onClick={() => onClone(a)}>
                Clone
              </button>
              <button className="danger small" onClick={() => onDelete(a)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!all && list.length > NEWEST && (
        <button className="small" onClick={() => setAll(true)}>
          Show {list.length - NEWEST} older records
        </button>
      )}
    </section>
  );
}
