import { useRef, useState } from 'react';
import { isSummon, PARTNER_PHANTIMALS } from '../src/domain/units.js';
import { selectableArtifacts } from '../src/domain/stage.js';
import { useCurrentSeason } from './seasons.js';
import { TILE } from '../src/domain/map.js';
import type { Artifact, Attempt, FormationInput, GameMap, Hero, Phantimal, Rules } from './backend.js';
import { HeroStateFields } from './admin/HeroStateFields.js';
import { HeroGrid } from './HeroGrid.js';
import { IconChoice } from './IconChoice.js';
import { HexMap } from './HexMap.js';
import { PlacedUnits } from './PlacedUnits.js';
import { SelectedHero, stateText } from './SelectedHero.js';
import { Portrait } from './Portrait.js';
import { ArtifactSlot } from './ArtifactSlot.js';
import { heldIcons, type Borrow } from './arena/borrow.js';
import { confirmBorrowedMove, placePhantimalPart } from './placement.js';
import { addHeroUnits, addUnit, firstFreeTile, phantimalAt, phantimalTileOf, missingPhantimalPart, swapPhantimal, swapTiles, resolveUnit, rowName, selectorHeroes, unitsUnavailable, type PlacedRow } from './units.js';
import { derivePhantimal, type PhantimalOption } from './phantimal.js';
import { PhantimalField } from './PhantimalField.js';
import { useConfirm } from './ui/Dialog.js';

export interface FormationState {
  placed: PlacedRow[];
  phantimal: { tile: number; name: string; partnerTile?: number | null } | null;
  /** The Phantimal the player chose; it stands only while the team meets its Faction Requirement (ADR 0029). */
  phantimalChoice?: string;
  assist: string;
  artifact: string;
  /** The Formation ID typed for this formation, or ''. */
  formationId: string;
  /** Rank and equipment a saved record stored per hero; heroes without one take the roster's current state. */
  snapshots: Record<string, { rank: string | null; equipmentLevel: number | null }>;
}

/** A placed hero's rank and equipment in this record: what was set, else the roster now (unless any player's heroes are recorded). */
export function heroState(value: FormationState, heroes: Hero[], name: string, everyone: boolean): { rank: string; equipment: string } {
  const roster = heroes.find((h) => h.name === name);
  const state = value.snapshots[name] ?? { rank: everyone ? null : (roster?.rank ?? null), equipmentLevel: everyone ? null : (roster?.equipmentLevel ?? null) };
  return { rank: state.rank ?? '', equipment: state.equipmentLevel === null ? '' : String(state.equipmentLevel) };
}

export const withHeroState = (value: FormationState, name: string, rank: string, equipment: string): FormationState => ({
  ...value,
  snapshots: { ...value.snapshots, [name]: { rank: rank || null, equipmentLevel: equipment === '' ? null : Number(equipment) } },
});

/**
 * Gives the placed heroes the rank and equipment the roster has for them (heroes the roster does not hold, or has no rank
 * for, are left alone). `overwrite` replaces what was set; otherwise only heroes with nothing set take it.
 * Returns the same object when nothing changes.
 */
export function withRosterStates(value: FormationState, heroes: Hero[], overwrite: boolean): FormationState {
  const snapshots = { ...value.snapshots };
  let changed = false;
  for (const p of value.placed) {
    const roster = isSummon(p) ? undefined : heroes.find((h) => h.name === p.hero && h.owned && h.rank);
    if (!roster || (!overwrite && p.hero in snapshots)) continue;
    const old = snapshots[p.hero];
    if (old && old.rank === roster.rank && old.equipmentLevel === roster.equipmentLevel) continue;
    snapshots[p.hero] = { rank: roster.rank, equipmentLevel: roster.equipmentLevel };
    changed = true;
  }
  return changed ? { ...value, snapshots } : value;
}

export const emptyFormation = (): FormationState => ({ placed: [], phantimal: null, phantimalChoice: '', assist: '', artifact: '', formationId: '', snapshots: {} });

/** The editor state for a formation already saved, so the record can be edited. */
export const formationFromRecord = (f: Attempt['formation']): FormationState => ({
  placed: f.heroes.map((h) => ({ tile: h.tile, hero: h.name, ...(h.part ? { part: h.part } : {}) })),
  phantimal: f.phantimal,
  phantimalChoice: f.phantimal?.name ?? '',
  assist: f.assist?.name ?? '',
  artifact: f.artifact ?? '',
  formationId: f.formationId ?? '',
  snapshots: Object.fromEntries(
    [...f.heroes.filter((h) => !isSummon({ hero: h.name, part: h.part })), ...(f.assist ? [f.assist] : [])].map((h) => [h.name, { rank: h.rank, equipmentLevel: h.equipmentLevel }]),
  ),
});

export const toPayload = (state: FormationState): FormationInput => {
  const assistState = state.assist ? state.snapshots[state.assist] : undefined;
  return {
    heroes: state.placed.map((p) => ({ ...p, ...state.snapshots[p.hero] })),
    phantimal: state.phantimal,
    assistHero: state.assist || null,
    ...(assistState ? { assistRank: assistState.rank, assistEquipmentLevel: assistState.equipmentLevel } : {}),
    artifact: state.artifact || null,
    formationId: state.formationId || null,
  };
};

interface Picked {
  type: 'hero' | 'phantimal';
  name: string;
}

interface Props {
  map: GameMap;
  heroes: Hero[];
  artifacts: Artifact[];
  /** The phantimals that may join, or null when this kind of battle does not allow one. */
  phantimals: Phantimal[] | null;
  season?: number;
  value: FormationState;
  onChange: (value: FormationState) => void;
  /** Heroes that may not be used here, mapped to why (for example the earlier battle of the match using them). */
  unavailable?: Map<string, string>;
  /** Which heroes can be placed: your roster (your own records) or every hero (Arena, which may record other players' matches). */
  heroSource?: 'roster' | 'all';
  /** Hide the assist hero and artifact, for planning where only the heroes matter. */
  heroesOnly?: boolean;
  /** Accessible name of the map; Arena calls its sides A and B. */
  mapLabel?: string;
  /** When given (editing a saved record, or always for Arena), each hero's stored rank and equipment can be corrected. */
  rules?: Rules;
  /** Offer an assist hero; Dream Hunt has none. */
  withAssist?: boolean;
  /** Lets heroes and artifacts that other teams of the contest hold be taken from them, once the player agrees. */
  borrow?: Borrow;
}

/** Placing your heroes on the map's player tiles, plus the assist hero and artifact. */
export function FormationEditor({ map, heroes, artifacts, phantimals, season, value, onChange, unavailable, rules, heroSource = 'roster', mapLabel = 'Your formation map', heroesOnly = false, withAssist = true, borrow }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Picked | null>(null);
  const [moving, setMoving] = useState<number | null>(null); // the tile of a placed unit being dragged to another tile
  const [selected, setSelected] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const latestValue = useRef(value);
  latestValue.current = value;

  // Dream Hunt has no season of its own, so it offers every artifact and opens on the current season's; a stage's season limits the list.
  const currentSeason = useCurrentSeason();
  const usableArtifacts = season === undefined ? artifacts : selectableArtifacts(artifacts, season, [value.artifact]);
  const everyone = heroSource === 'all';
  const owned = everyone ? heroes : heroes.filter((h) => h.owned);
  const playerTileCount = map.cells.filter((c) => c === TILE.PLAYER).length;
  const isPlayerTile = (tile: number) => map.cells[tile] === TILE.PLAYER;
  // The Phantimal is a property of the team, not a Unit placed by hand: it stands while the heroes bring it (ADR 0029).
  const phantimalOptions: PhantimalOption[] = (phantimals ?? []).filter((p) => !PARTNER_PHANTIMALS.has(p.name)).map((p) => ({ name: p.name, faction: p.faction }));
  const heroFactions = new Map(heroes.map((h) => [h.name, h.faction]));
  /** Every change to the team re-derives the Phantimal, so it appears and disappears with the heroes. */
  const change = (next: FormationState) => onChange(derivePhantimal(next, map.cells, TILE.PLAYER, phantimalOptions, heroFactions));
  const choosePhantimal = (name: string) => change({ ...value, phantimalChoice: name, phantimal: null });
  // A selection only counts while its hero is still placed.
  const isSelectedTile = (tile: number) => selected !== null && value.placed.some((p) => p.tile === tile && p.hero === selected && !isSummon(p));
  const selectedTile = selected ? value.placed.find((p) => p.hero === selected)?.tile : undefined;
  const selectedState = heroState(value, heroes, selected ?? '', everyone);
  // What another team holds can be taken, so only the rest of the unavailable heroes stays disabled.
  const stuck = borrow ? new Map([...(unavailable ?? [])].filter(([name]) => !borrow.heroHolder(name))) : unavailable;
  const disabledIcons = unitsUnavailable(value.placed, stuck);
  const heroIcons = selectorHeroes(owned);

  function clickTile(index: number) {
    // Clicking a placed hero selects it for editing its rank and equipment (clicking it again lets go); the list below has the remove buttons.
    const placedHero = value.placed.find((p) => p.tile === index);
    if (placedHero) return isSummon(placedHero) ? undefined : setSelected((old) => (old === placedHero.hero ? null : placedHero.hero)); // a summon has no rank or equipment
    if (phantimalAt(value.phantimal, index) !== undefined) return;
    if (picked) place(picked, index);
  }

  /** Clicking an icon puts its unit on the first free player tile (a phantimal already placed keeps its tile). */
  function placeFirst(unit: Picked) {
    setPicked(null);
    const tile = (unit.type === 'phantimal' ? phantimalTileOf(value.phantimal, unit.name) : undefined) ?? firstFreeTile(map.cells, TILE.PLAYER, (t) => value.placed.some((p) => p.tile === t) || phantimalAt(value.phantimal, t) !== undefined);
    if (tile === null) return setMessage('No free player tile left');
    place(unit, tile);
  }

  /** Puts the unit on a tile; shared by clicking and dropping. */
  function place(unit: Picked, index: number) {
    const placement = placeOnFormation({
      unit,
      index,
      cells: map.cells,
      formation: value,
      occupied: (t) => value.placed.some((p) => p.tile === t) || phantimalAt(value.phantimal, t) !== undefined,
      unavailable,
      borrowing: borrow && {
        borrow,
        confirm,
        current: () => latestValue.current,
        takenNow: (t) => latestValue.current.placed.some((p) => p.tile === t) || phantimalAt(latestValue.current.phantimal, t) !== undefined,
      },
    });
    whenPlaced(placement, (result) => {
      if (result === null) return;
      if ('message' in result) return setMessage(result.message);
      change(result.value);
      if (result.next) setPicked(result.next); // a pair stands together: offer the other part next
      setMessage(null);
    });
  }

  const canDropOn = (index: number) =>
    isPlayerTile(index) && (moving !== null || (dragging !== null && !value.placed.some((p) => p.tile === index) && phantimalAt(value.phantimal, index) === undefined)); // a placed unit may swap with another
  function dropOnTile(index: number) {
    const unit = dragging;
    const from = moving;
    setDragging(null);
    setMoving(null);
    if (from !== null) {
      if (isPlayerTile(index) && canDropOn(index)) change({ ...value, placed: swapTiles(value.placed, from, index), phantimal: swapPhantimal(value.phantimal, from, index) });
      return;
    }
    if (unit && isPlayerTile(index)) place(unit, index);
  }

  return (
    <div>
      {playerTileCount === 0 ? (
        <p className="error">This map has no player deployment tiles. Paint some in Admin → Maps first.</p>
      ) : (
        <div className="two-col">
          <div>
            <HexMap
              rowLengths={map.rowLengths}
              cells={map.cells}
              label={mapLabel}
              onTileClick={clickTile}
              isClickable={(index, tile) => tile === TILE.PLAYER || value.placed.some((p) => p.tile === index)}
              tileTitle={(index) => {
                const hero = value.placed.find((p) => p.tile === index);
                if (hero) {
                  const state = heroState(value, heroes, hero.hero, everyone);
                  return [rowName(hero), isSummon(hero) ? '' : stateText(state.rank, state.equipment)].filter(Boolean).join(' · ');
                }
                return phantimalAt(value.phantimal, index);
              }}
              tileClassName={(index) => [(dragging || moving !== null) && canDropOn(index) ? 'tile-droppable' : '', isSelectedTile(index) ? 'tile-selected' : ''].filter(Boolean).join(' ') || undefined}
              slotA={heroesOnly ? undefined : (
                <ArtifactSlot side="a" label="artifact" artifacts={usableArtifacts} value={value.artifact} currentSeason={season === undefined ? currentSeason : undefined}
                  onChange={(artifact) => change({ ...value, artifact })} borrow={borrow} />
              )}
              canDrop={(index) => canDropOn(index)}
              onTileDrop={dropOnTile}
              canDrag={(index) => value.placed.some((p) => p.tile === index) || phantimalAt(value.phantimal, index) !== undefined}
              onTileDragStart={setMoving}
              onTileDragEnd={() => setMoving(null)}
              renderTile={(index) => {
                const hero = value.placed.find((p) => p.tile === index);
                if (hero) return <span className={`map-unit map-unit-a${isSelectedTile(index) ? ' map-unit-selected' : ''}`}><Portrait kind="hero" name={rowName(hero)} size={30} /></span>;
                const part = phantimalAt(value.phantimal, index);
                if (part) return <span className="map-unit map-unit-a"><Portrait kind="phantimal" name={part} size={30} /></span>;
                return undefined;
              }}
            />
            {missingPhantimalPart(value.phantimal) && <p className="error">{missingPhantimalPart(value.phantimal)} still has to be placed: the wedges always stand together.</p>}
            {message && <p className="error">{message}</p>}
          </div>
          <div className="picker">
            <div className="picker-fixed">
            <PlacedUnits
              label="Your formation"
              units={[
                ...[...new Set(value.placed.map((p) => p.hero))].map((hero) => ({
                  key: `hero-${hero}`,
                  name: hero,
                  kind: 'hero' as const,
                  onRemove: () => change({ ...value, placed: value.placed.filter((p) => p.hero !== hero) }),
                })),
                ...(value.phantimal ? [{ key: 'phantimal', name: value.phantimal.name, kind: 'phantimal' as const, onRemove: () => change({ ...value, phantimal: null, phantimalChoice: '' }) }] : []),
              ]}
            />
            {rules && selected && selectedTile !== undefined && (
              <SelectedHero
                name={selected}
                tier={heroes.find((h) => h.name === selected)?.tier}
                rank={selectedState.rank}
                equipment={selectedState.equipment}
                rules={rules}
                onChange={(rank, equipment) => change(withHeroState(value, selected, rank, equipment))}
                onClose={() => setSelected(null)}
              />
            )}
            </div>
            <div className="picker-scroll">
            <HeroGrid
              heroes={heroIcons}
              selected={picked?.type === 'hero' ? picked.name : null}
              onPick={(name) => placeFirst({ type: 'hero', name })}
              onDragHero={(name) => setDragging(name ? { type: 'hero', name } : null)}
              disabled={disabledIcons}
              held={borrow ? heldIcons(heroIcons, disabledIcons, borrow) : undefined}
              label="Heroes"
              hint={everyone ? undefined : (h) => h.rank ?? 'no rank'}
            />
            {owned.length === 0 && <p className="muted">{everyone ? 'No heroes imported yet.' : 'Your roster is empty. Add heroes in the Roster tab.'}</p>}
            {phantimals && (
              <>
                <h4>Phantimal</h4>
                <PhantimalField phantimals={phantimals} placed={value.placed} heroes={heroes} choice={value.phantimalChoice ?? ''} shown={value.phantimal} onChoose={choosePhantimal} />
              </>
            )}
            {withAssist && !heroesOnly && (
              <details className="details-panel" open>
                <summary>Assist hero</summary>
                <FormationDetails value={value} onChange={onChange} heroes={heroes} owned={owned} unavailable={unavailable} rules={rules} everyone={everyone} heroesOnly={heroesOnly} withAssist={withAssist} />
              </details>
            )}
            </div>
          </div>
        </div>
      )}

      {dialog}
    </div>
  );
}

/** Adds a hero to a formation unless it is already there, unavailable or the formation is full. */
export function placeHero(value: FormationState, name: string, tile: number, unavailable?: Map<string, string>): { value: FormationState; message: string | null } {
  const { hero } = resolveUnit(name); // the icon may be a part of a pair or a summon
  if (unavailable?.has(hero)) return { value, message: null };
  const result = addUnit(value.placed, name, tile, (row) => row);
  if (result.message || result.placed === value.placed) return { value, message: result.message };
  return { value: { ...value, placed: result.placed, assist: value.assist === hero ? '' : value.assist }, message: null };
}

/**
 * Adds every Unit of a hero at once, the first on `tile` and the rest on the first free tiles of the zone (ADR 0028). A hero
 * whose Units do not all fit is refused whole. `occupied` says which tiles are taken, the Phantimal's included.
 */
export function placeWholeHero(
  value: FormationState,
  hero: string,
  tile: number,
  cells: number[],
  zone: number,
  occupied: (tile: number) => boolean,
  unavailable?: Map<string, string>,
): { value: FormationState; message: string | null } {
  if (unavailable?.has(hero)) return { value, message: null };
  const result = addHeroUnits(value.placed, hero, tile, cells, zone, occupied, (row) => row);
  if (result.message || result.placed === value.placed) return { value, message: result.message };
  return { value: { ...value, placed: result.placed, assist: value.assist === hero ? '' : value.assist }, message: null };
}

/** What placing a unit on a formation came to: the formation with the unit on it and the part still to be placed (a pair stands together), or why it was refused; null when the player declined to take a hero from another team. */
export type FormationPlacement = { value: FormationState; next: { type: 'hero' | 'phantimal'; name: string } | null } | { message: string } | null;

/** Hands the placement to `apply` at once, or when the borrow question has been answered: a placement without a question stays synchronous. */
export function whenPlaced(placement: FormationPlacement | Promise<FormationPlacement>, apply: (placement: FormationPlacement) => void): void {
  if (placement instanceof Promise) void placement.then(apply);
  else apply(placement);
}

/**
 * Puts a hero or a phantimal part on a tile of a formation, for the editors that place on one (Formation, Stage, Battle side A). A hero
 * another team holds is taken only after the player agrees (`borrowing`); the question takes time, so the hero is then placed on the
 * formation as `current` gives it, and refused if `takenNow` says the tile was taken meanwhile.
 */
export function placeOnFormation(input: {
  unit: { type: 'hero' | 'phantimal'; name: string };
  index: number;
  cells: number[];
  formation: FormationState;
  /** Whether a tile holds a unit (of either side), for the phantimal's second part. */
  occupied: (tile: number) => boolean;
  unavailable?: Map<string, string>;
  /** Given when heroes of other teams may be taken: the contest's holders, the question, and the formation and tiles as they are after it. */
  borrowing?: { borrow: Borrow; confirm: ReturnType<typeof useConfirm>['confirm']; current: () => FormationState; takenNow: (tile: number) => boolean };
}): FormationPlacement | Promise<FormationPlacement> {
  const { unit, index, formation, borrowing } = input;
  if (unit.type === 'phantimal') {
    const { phantimal, next } = placePhantimalPart(input.cells, TILE.PLAYER, formation.phantimal, unit.name, index, input.occupied);
    return { value: { ...formation, phantimal }, next: next ? { type: 'phantimal', name: next } : null };
  }
  const hero = unit.name;
  const holder = borrowing?.borrow.heroHolder(hero) ?? null;
  let placed = placeWholeHero(formation, hero, index, input.cells, TILE.PLAYER, input.occupied, holder ? undefined : input.unavailable);
  if (placed.message) return { message: placed.message };
  if (holder && borrowing) {
    return confirmBorrowedMove(borrowing.confirm, borrowing.borrow, hero, holder).then((yes): FormationPlacement => {
      if (!yes) return null;
      // the question took time: place on the team as it is now, not as it was when the question was asked
      const now = borrowing.current();
      const occupiedNow = (t: number) => now.placed.some((p) => p.tile === t) || phantimalAt(now.phantimal, t) !== undefined;
      if (occupiedNow(index)) return { message: 'That tile has been taken meanwhile: place the hero again' };
      const after = placeWholeHero(now, hero, index, input.cells, TILE.PLAYER, occupiedNow);
      return after.message ? { message: after.message } : { value: after.value, next: null };
    });
  }
  return { value: placed.value, next: null };
}

interface DetailsProps {
  value: FormationState;
  onChange: (value: FormationState) => void;
  heroes: Hero[];
  /** The heroes that may be chosen as assist. */
  owned: Hero[];
  unavailable?: Map<string, string>;
  /** When given, the assist hero's rank and equipment can be set. */
  rules?: Rules;
  everyone: boolean;
  heroesOnly: boolean;
  /** Offer an assist hero; Arena battles have a phantimal instead. */
  withAssist?: boolean;
}

/** What goes with the placed heroes besides the map: the assist hero (the artifact has its own slot on the map). */
export function FormationDetails({ value, onChange, heroes, owned, unavailable, rules, everyone, heroesOnly, withAssist = true }: DetailsProps) {
  const placedNames = new Set(value.placed.map((p) => p.hero));
  return (
    <>
      {!heroesOnly && (
        <div className="filters">
          {withAssist && <IconChoice label="Assist hero" kind="hero" value={value.assist} none="None" onClear={() => onChange({ ...value, assist: '' })}>
            {(close) => (
              <HeroGrid
                heroes={owned.filter((h) => !placedNames.has(h.name))}
                selected={value.assist || null}
                disabled={unavailable}
                onPick={(name) => (onChange({ ...value, assist: name }), close())}
                label="Assist heroes"
              />
            )}
          </IconChoice>}
          {withAssist && value.assist && rules && (
            <HeroStateFields
              rank={heroState(value, heroes, value.assist, everyone).rank}
              equipment={heroState(value, heroes, value.assist, everyone).equipment}
              rules={rules}
              label="Assist"
              tier={heroes.find((h) => h.name === value.assist)?.tier}
              onChange={(rank, equipment) => onChange(withHeroState(value, value.assist, rank, equipment))}
            />
          )}
        </div>
      )}
    </>
  );
}
