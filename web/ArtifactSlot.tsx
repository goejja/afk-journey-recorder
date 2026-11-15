import { useState } from 'react';
import { PRE_SEASON_GROUP } from '../src/domain/stage.js';
import type { Artifact } from './backend.js';
import { moveQuestion, type Borrow } from './arena/borrow.js';
import { Portrait } from './Portrait.js';
import { UnitGrid } from './UnitGrid.js';
import { Dialog, useConfirm } from './ui/Dialog.js';

interface Props {
  /** Which side's slot this is: it sets the colour of the outline. */
  side: 'a' | 'b';
  /** Names the button and the overlay, for example "artifact" or "Side B artifact". */
  label: string;
  artifacts: Artifact[];
  value: string;
  /** When given, the grid opens on this season's and the pre-season artifacts, with "All" listing every one. */
  currentSeason?: number;
  onChange: (artifact: string) => void;
  /** Called when the overlay opens, for example to show this side in the selector. */
  onOpen?: () => void;
  /** Only shows the artifact, with no overlay to change it (a preview of a saved record). */
  readOnly?: boolean;
  /** Lets an artifact another team holds be taken from it, once the player agrees. */
  borrow?: Borrow;
}

/** The artifact slot of a map: a hex tile that shows the chosen artifact, and opens an overlay to choose or clear it. */
export function ArtifactSlot({ side, label, artifacts, value, currentSeason, onChange, onOpen, readOnly = false, borrow }: Props) {
  const [open, setOpen] = useState(false);
  const { confirm, dialog } = useConfirm();

  const held = new Map(
    artifacts.flatMap((a) => {
      const holder = borrow?.artifactHolder(a.name);
      return holder ? [[a.name, holder] as const] : [];
    }),
  );
  async function choose(name: string) {
    const holder = held.get(name);
    if (holder && borrow) {
      if (
        !(await confirm({
          title: `Move this ${borrow.noun}?`,
          message: moveQuestion(name, holder, borrow.noun),
          confirmLabel: 'Move',
        }))
      )
        return;
      borrow.releaseArtifact(name);
    }
    onChange(name);
  }
  const views =
    currentSeason === undefined
      ? undefined
      : [
          { label: `Season ${currentSeason} and pre-season`, show: (u: { group?: string | null }) => u.group === PRE_SEASON_GROUP || u.group === `Season ${currentSeason}` },
          { label: 'All', show: () => true },
        ];

  if (readOnly) {
    return (
      <span className={`hex-slot hex-slot-${side}${value ? '' : ' hex-slot-empty'}`} title={value || undefined}>
        <span className="hex-slot-inner">
          {value && <Portrait kind="artifact" name={value} size={36} />}
        </span>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`hex-slot hex-slot-${side}${value ? '' : ' hex-slot-empty'}`}
        aria-label={`Choose ${label}`}
        title={value || `Choose ${label}`}
        onClick={() => (setOpen(true), onOpen?.())}
      >
        <span className="hex-slot-inner">
          {value ? <Portrait kind="artifact" name={value} size={36} /> : '+'}
        </span>
      </button>
      {open && (
        <Dialog
          title={label[0]!.toUpperCase() + label.slice(1)}
          onCancel={() => setOpen(false)}
          initialFocus="input"
          closeOnBackdrop
          actions={
            <div className="actions">
              {value && (
                <button aria-label={`Clear ${label}`} onClick={() => (onChange(''), setOpen(false))}>
                  None
                </button>
              )}
              <button onClick={() => setOpen(false)}>Done</button>
            </div>
          }
        >
          <div className="choice-head">
            {value && <Portrait kind="artifact" name={value} size={36} />}
            <strong>{value || 'None'}</strong>
          </div>
          <UnitGrid
            kind="artifact"
            units={artifacts.map((a) => ({ name: a.name, group: a.group }))}
            selected={value || null}
            onPick={choose}
            label="Artifacts"
            groupLabel="Group"
            views={views}
            held={held}
          />
        </Dialog>
      )}
      {dialog}
    </>
  );
}
