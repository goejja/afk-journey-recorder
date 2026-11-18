import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_STANDARD_HEROES } from '../../src/domain/formation.js';
import { heroCount, isSummon } from '../../src/domain/units.js';
import { playerOnTop, TILE } from '../../src/domain/map.js';
import { useCurrentSeason } from '../seasons.js';
import type { Artifact, GameMap, Hero, Phantimal, Profile, Rules } from '../backend.js';
import { heroState, placeOnFormation, whenPlaced, withHeroState, withRosterStates, type FormationState } from '../FormationEditor.js';
import { heldIcons, type Borrow } from './borrow.js';
import { canDropOnTile, placePhantimalPart } from '../placement.js';
import { HeroGrid } from '../HeroGrid.js';
import { HexMap } from '../HexMap.js';
import { RECORD_ARTIFACT_SIZE, RECORD_PORTRAIT_SIZE, RECORD_TILE_WIDTH } from '../map-size.js';
import { placeWholeOpponent, withRosterOpponent, type OpponentState } from './OpponentEditor.js';
import { PlacedUnits } from '../PlacedUnits.js';
import { Portrait } from '../Portrait.js';
import { HeroStatePopover, StateTag, stateText } from '../HeroStatePopover.js';
import { ArtifactSlot } from '../ArtifactSlot.js';
import { derivePhantimal, type PhantimalOption } from '../phantimal.js';
import { PhantimalField } from '../PhantimalField.js';
import { firstFreeTile, phantimalAt, phantimalTileOf, missingPhantimalPart, swapPhantimal, swapTiles, rowName, selectorHeroes, unitsUnavailable } from '../units.js';
import { useConfirm } from '../ui/Dialog.js';

type Side = 'A' | 'B';
type Picked = { type: 'hero' | 'phantimal'; name: string };

interface Props {
  map: GameMap;
  heroes: Hero[];
  artifacts: Artifact[];
  rules: Rules;
  /** Side A: the player tiles. */
  formation: FormationState;
  onFormation: (value: FormationState) => void;
  /** Side B: the enemy tiles. */
  opponent: OpponentState;
  onOpponent: (value: OpponentState) => void;
  /** Changes both sides in one update: two separate updates in a row would overwrite each other. */
  onBoth: (formation: FormationState, opponent: OpponentState) => void;
  /** Heroes Side A may not use, mapped to why (they are in another team of the same session). */
  unavailable?: Map<string, string>;
  /** Lets Side A take heroes that other teams of the same session hold from them, once the player agrees. */
  borrow?: Borrow;
  /** Side A from your roster (a plan using your own heroes) or from every hero (recording any player's match). */
  sideAHeroes?: 'roster' | 'all';
  /** Let each Side A hero's stored rank and equipment be corrected. */
  editSideAStates?: boolean;
  /** Hide the artifacts, for planning where only the heroes matter. */
  heroesOnly?: boolean;
  /** Every phantimal, to offer one per side, newest season first. Omit where a battle has none. */
  phantimals?: Phantimal[];
  labels?: { a: string; b: string };
  /** Edit one side only: the other side's tab and placed units are hidden. */
  onlySide?: Side;
  /** The roster of the profile whose ranks and equipment a side's heroes take on placement (null: leave them be). */
  sideRosters?: Record<Side, Hero[] | null>;
}

/** A side's profile that has no Player ID: says the record will not remember it and takes the ID. */
function PlayerIdPrompt({ side, onSet }: { side: Side; onSet: (playerId: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="row" role="group" aria-label={`Player ID of Side ${side}`}>
      <span className="muted">This profile has no Player ID, so the record will not remember it:</span>
      <input aria-label={`Player ID of Side ${side}`} placeholder="Player ID" value={value} onChange={(e) => setValue(e.target.value)} />
      <button disabled={value.trim() === ''} onClick={() => onSet(value.trim())}>
        Set Player ID
      </button>
    </div>
  );
}

/** What the profile bar of a battle needs: a profile for each side, the “New profile…” option, the Player ID of a profile that lacks one, and the saved placements. */
export interface SideProfileBarProps {
  profiles: Profile[];
  /** What each select shows (null: none). */
  sideProfiles: Record<Side, number | null>;
  onSideProfile: (side: Side, profile: number | null) => void;
  /** Offers “New profile…” in each side's profile select. */
  onNewProfile?: (side: Side) => void;
  /** Gives the profile of a side its Player ID. Without one, a record cannot remember the side's player (ADR 0006), so a side whose profile has none is offered this. */
  onSetPlayerId?: (side: Side, playerId: string) => void;
  /** Per side, the teams whose heroes a saved side has exactly, standing elsewhere: the button beside the profile places them as the saved side did. */
  placement?: Record<Side, { teams: number[]; canUndo: boolean; onApply: () => void; onUndo: () => void }>;
}

/** The profile of each side of a battle, kept in the bar above the board so it takes no height from the picker. */
export function SideProfileBar({ profiles, sideProfiles, onSideProfile, onNewProfile, onSetPlayerId, placement }: SideProfileBarProps) {
  return (
    <>
      <div className="side-profiles" role="group" aria-label="Profiles of the sides">
        {(['A', 'B'] as Side[]).map((s) => (
          <label key={s} className="field">
            Profile of Side {s}
            <select value={sideProfiles[s] ?? ''} onChange={(e) => (e.target.value === 'new' ? onNewProfile?.(s) : onSideProfile(s, e.target.value === '' ? null : Number(e.target.value)))}>
              <option value="">None</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.playerId ? ` · ID ${p.playerId}` : ''}
                </option>
              ))}
              {onNewProfile && <option value="new">New profile…</option>}
            </select>
          </label>
        ))}
        {placement &&
          (['A', 'B'] as Side[]).map((s) => (
            <span key={s} className="row">
              <button
                type="button"
                disabled={placement[s].teams.length === 0}
                title={placement[s].teams.length === 0 ? 'No saved fight has exactly these heroes standing elsewhere' : `Teams ${placement[s].teams.map((t) => t + 1).join(', ')}: tiles, artifact and phantimal as in the saved fight`}
                onClick={placement[s].onApply}
              >
                Place {placement[s].teams.length} {placement[s].teams.length === 1 ? 'team' : 'teams'} as in saved fights ({s})
              </button>
              {placement[s].canUndo && (
                <button type="button" onClick={placement[s].onUndo}>
                  Undo
                </button>
              )}
            </span>
          ))}
      </div>
      {onSetPlayerId &&
        (['A', 'B'] as Side[]).map((s) => {
          const chosen = profiles.find((p) => p.id === sideProfiles[s]);
          return chosen && !chosen.playerId ? <PlayerIdPrompt key={`${s}-${chosen.id}`} side={s} onSet={(playerId) => onSetPlayerId(s, playerId)} /> : null;
        })}
    </>
  );
}

/** Both sides on one map, with a Side A / Side B switch beside it choosing whose heroes the icons place. */
export function BattleEditor({ map, heroes, artifacts, rules, formation, onFormation, opponent, onOpponent, onBoth, unavailable, borrow, sideAHeroes = 'all', editSideAStates = false, heroesOnly = false, phantimals, labels = { a: 'Side A', b: 'Side B' }, onlySide, sideRosters }: Props) {
  const [side, setSide] = useState<Side>(onlySide ?? 'A');
  const [picked, setPicked] = useState<Picked | null>(null);
  const currentSeason = useCurrentSeason();
  const [chosenSeason, setChosenSeason] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Picked | null>(null);
  const [moving, setMoving] = useState<number | null>(null); // the tile of a placed unit being dragged to another tile
  const [selected, setSelected] = useState<{ side: Side; name: string } | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null); // the tile of the selected hero, which its Popover hangs under
  const closeState = useCallback(() => setSelected(null), []);
  const { confirm, dialog } = useConfirm();

  const everyone = sideAHeroes === 'all';
  const ownHeroes = everyone ? heroes : heroes.filter((h) => h.owned);
  const zoneOf = (tile: number): Side | null => (map.cells[tile] === TILE.PLAYER ? 'A' : map.cells[tile] === TILE.ENEMY ? 'B' : null);
  const hasZone = (zone: Side) => map.cells.some((c) => c === (zone === 'A' ? TILE.PLAYER : TILE.ENEMY));

  const seasons = [...new Set((phantimals ?? []).flatMap((p) => p.seasons))].sort((a, b) => b - a);
  const season = chosenSeason ?? seasons[0] ?? null;
  const seasonPhantimals = (phantimals ?? []).filter((p) => season !== null && p.seasons.includes(season));

  // The Phantimal stands while the heroes of its side bring it (ADR 0029). The season is only the filter of the picker: a record may hold a
  // Phantimal of an earlier season, and editing it must not drop it.
  const phantimalOptions: PhantimalOption[] = (phantimals ?? []).map((p) => ({ name: p.name, faction: p.faction }));
  const heroFactions = new Map(heroes.map((h) => [h.name, h.faction]));
  const changeFormation = (next: FormationState) => onFormation(derivePhantimal(next, map.cells, TILE.PLAYER, phantimalOptions, heroFactions));
  const changeOpponent = (next: OpponentState) => onOpponent(derivePhantimal(next, map.cells, TILE.ENEMY, phantimalOptions, heroFactions));

  // A side given a profile gives each hero placed on it that profile's rank and equipment, unless it was set by hand. This stays an effect
  // because the formations come from many places (placing, cloning, an import, a new profile): whatever the source, a hero without its
  // roster state gets it. It settles at once, since `withRosterStates` and `withRosterOpponent` return the same object when nothing changes.
  const latestOnBoth = useRef(onBoth);
  latestOnBoth.current = onBoth;
  const latestSides = useRef({ formation, opponent });
  latestSides.current = { formation, opponent };
  useEffect(() => {
    if (!sideRosters) return;
    const nextA = sideRosters.A ? withRosterStates(formation, sideRosters.A, false) : formation;
    const nextB = sideRosters.B ? withRosterOpponent(opponent, sideRosters.B, false) : opponent;
    if (nextA !== formation || nextB !== opponent) latestOnBoth.current(nextA, nextB);
  }, [sideRosters, formation, opponent]);

  function chooseSide(next: Side) {
    setSide(next);
    setPicked(null);
    setMessage(null);
  }

  /** Clicking an icon puts its unit on the first free tile of the side being edited (a phantimal already placed keeps its tile). */
  function placeFirst(unit: Picked) {
    setPicked(null);
    const zone = side;
    const existing = unit.type === 'phantimal' ? phantimalTileOf(zone === 'A' ? formation.phantimal : opponent.phantimal, unit.name) : undefined;
    const tile = existing ?? firstFreeTile(map.cells, zone === 'A' ? TILE.PLAYER : TILE.ENEMY, occupiedTile);
    if (tile === null) return setMessage(`No free tile left for ${zone === 'A' ? labels.a : labels.b}`);
    place(unit, tile, zone);
  }

  /** Puts a unit on a tile of the side being edited; shared by clicking and dropping. */
  function place(unit: Picked, index: number, zone: Side) {
    setMessage(null);
    if (zone === 'A') {
      const placement = placeOnFormation({
        unit,
        index,
        cells: map.cells,
        formation,
        occupied: (t) => occupiedTile(t),
        unavailable,
        borrowing: borrow && { borrow, confirm, current: () => latestSides.current.formation, takenNow: (t) => occupiedTile(t, latestSides.current) },
      });
      whenPlaced(placement, (result) => {
        if (result === null) return;
        if ('message' in result) return setMessage(result.message);
        changeFormation(result.value);
        if (result.next) setPicked(result.next); // a pair stands together: offer the other part next
      });
      return;
    }
    if (unit.type === 'phantimal') {
      const { phantimal, next } = placePhantimalPart(map.cells, TILE.ENEMY, opponent.phantimal, unit.name, index, occupiedTile);
      onOpponent({ ...opponent, phantimal });
      if (next) setPicked({ type: 'phantimal', name: next }); // a pair stands together: offer the other part next
      return;
    }
    const placed = placeWholeOpponent(opponent, unit.name, index, map.cells, TILE.ENEMY, occupiedTile);
    if (placed.message) return setMessage(placed.message);
    changeOpponent(placed.value);
    return;
  }

  const occupiedTile = (index: number, from = { formation, opponent }) =>
    from.formation.placed.some((p) => p.tile === index) || phantimalAt(from.formation.phantimal, index) !== undefined || from.opponent.placed.some((p) => p.tile === index) || phantimalAt(from.opponent.phantimal, index) !== undefined;
  // A placed unit stays on its own side's tiles; an icon from the picker goes on the side being edited.
  const sideOfTile = (tile: number): Side | null =>
    formation.placed.some((p) => p.tile === tile) || phantimalAt(formation.phantimal, tile) !== undefined ? 'A' : opponent.placed.some((p) => p.tile === tile) || phantimalAt(opponent.phantimal, tile) !== undefined ? 'B' : null;
  const movingSide = moving === null ? null : sideOfTile(moving);
  // An icon goes on a free tile; a placed unit goes on a free tile of its own side or swaps places with a unit of its own side.
  const canDropOn = (index: number) => canDropOnTile({ zone: zoneOf(index), moving, movingSide, sideOfTile: sideOfTile(index), dragging: dragging !== null, occupied: occupiedTile(index) });

  function moveTo(from: number, index: number) {
    if (sideOfTile(from) === 'A') {
      changeFormation({ ...formation, placed: swapTiles(formation.placed, from, index), phantimal: swapPhantimal(formation.phantimal, from, index) });
    } else {
      changeOpponent({ ...opponent, placed: swapTiles(opponent.placed, from, index), phantimal: swapPhantimal(opponent.phantimal, from, index) });
    }
  }

  /** Picking up a placed unit shows the side it belongs to in the selector. */
  function startMoving(tile: number) {
    setSelected(null);
    setMoving(tile);
    const owner = sideOfTile(tile);
    if (owner && owner !== side) chooseSide(owner);
  }

  function dropOnTile(index: number) {
    const unit = dragging;
    const from = moving;
    setDragging(null);
    setMoving(null);
    if (from !== null) return canDropOn(index) ? moveTo(from, index) : undefined;
    const zone = zoneOf(index);
    if (!unit || !zone) return;
    // The icons on show belong to the side being edited, so they only go on that side's tiles.
    if (zone !== side) return setMessage(`${unit.name} belongs to ${side === 'A' ? labels.a : labels.b}: drop it on the ${side === 'A' ? 'player (A)' : 'enemy (B)'} tiles`);
    place(unit, index, zone);
  }

  function clickTile(index: number, button: HTMLElement) {
    // Clicking a placed hero never removes it (it may still need its rank set): it only switches to that hero's side.
    const occupied = formation.placed.some((p) => p.tile === index) || phantimalAt(formation.phantimal, index) !== undefined ? 'A' : opponent.placed.some((p) => p.tile === index) || phantimalAt(opponent.phantimal, index) !== undefined ? 'B' : null;
    if (occupied) {
      // Clicking a placed hero opens its rank and equipment; clicking it again closes them.
      const row = (occupied === 'A' ? formation.placed : opponent.placed).find((p) => p.tile === index);
      const name = row && !isSummon(row) ? row.hero : undefined; // a summon has no rank or equipment
      if (occupied !== side) chooseSide(occupied);
      if (name) {
        setAnchor(button);
        setSelected((old) => (old?.side === occupied && old.name === name ? null : { side: occupied, name }));
      }
      return;
    }
    const zone = zoneOf(index);
    if (!zone) return;
    if (zone !== side) return chooseSide(zone);
    if (!picked) return;
    place(picked, index, zone);
  }

  const removeA = (hero: string) => {
    chooseSide('A');
    changeFormation({ ...formation, placed: formation.placed.filter((p) => p.hero !== hero) });
  };
  const removeB = (hero: string) => {
    chooseSide('B');
    changeOpponent({ ...opponent, placed: opponent.placed.filter((p) => p.hero !== hero) });
  };

  // Which side's tiles are at the top of the map, so each side is named on its own edge.
  const aOnTop = playerOnTop(map.rowLengths, map.cells);
  const bannerOrder: [Side, Side] | null = aOnTop === null ? null : aOnTop ? ['A', 'B'] : ['B', 'A'];

  // A selection only counts while its hero is still placed on that side.
  const selectedTile = selected ? (selected.side === 'A' ? formation.placed : opponent.placed).find((p) => p.hero === selected.name)?.tile : undefined;
  const selectedEditable = selected !== undefined && selected !== null && selectedTile !== undefined && (selected.side === 'B' || editSideAStates);

  const selectedState =
    selected?.side === 'B'
      ? (opponent.placed.find((p) => p.hero === selected.name) ?? { rank: '', equipment: '' })
      : heroState(formation, heroes, selected?.name ?? '', everyone);

  // What another team holds can be taken, so only the rest of the unavailable heroes stays disabled.
  const stuck = borrow ? new Map([...(unavailable ?? [])].filter(([name]) => !borrow.heroHolder(name))) : unavailable;
  const disabled = side === 'A' ? unitsUnavailable(formation.placed, stuck) : unitsUnavailable(opponent.placed);
  const heroIcons = selectorHeroes(side === 'A' ? ownHeroes : heroes);
  const missingPhantimals = [formation.phantimal, opponent.phantimal].map((p) => missingPhantimalPart(p)).filter((part): part is string => Boolean(part));
  const isSelectedTile = (index: number) =>
    selected !== null && (selected.side === 'A' ? formation.placed : opponent.placed).some((p) => p.tile === index && p.hero === selected.name && !isSummon(p));

  return (
    <div>
      <div className="two-col">
        <div>
          {!!bannerOrder && <SideBanner side={bannerOrder[0]} labels={labels} active={side} />}
          <HexMap
            rowLengths={map.rowLengths}
            cells={map.cells}
            label="Battle map"
            tileWidth={RECORD_TILE_WIDTH}
            onTileClick={clickTile}
            isClickable={(index, tile) => tile === TILE.PLAYER || tile === TILE.ENEMY || occupiedTile(index)}
            tileTitle={(index) => {
              const a = formation.placed.find((p) => p.tile === index);
              if (a) {
                const state = heroState(formation, heroes, a.hero, everyone);
                return [rowName(a), isSummon(a) ? '' : stateText(state.rank, state.equipment)].filter(Boolean).join(' · ');
              }
              const b = opponent.placed.find((p) => p.tile === index);
              if (b) return [rowName(b), isSummon(b) ? '' : stateText(b.rank, b.equipment)].filter(Boolean).join(' · ');
              return phantimalAt(formation.phantimal, index) ?? phantimalAt(opponent.phantimal, index);
            }}
            tileClassName={(index) => {
              const zone = zoneOf(index);
              const classes = [zone && zone !== side ? 'tile-dim' : '', zone && isSelectedTile(index) ? 'tile-selected' : '', (dragging || moving !== null) && canDropOn(index) && zone === (movingSide ?? side) ? 'tile-droppable' : ''];
              return classes.filter(Boolean).join(' ') || undefined;
            }}
            canDrop={(index) => canDropOn(index)}
            canDrag={(index) => sideOfTile(index) !== null}
            onTileDragStart={startMoving}
            onTileDragEnd={() => setMoving(null)}
            onTileDrop={dropOnTile}
            slotA={heroesOnly ? undefined : (
              <ArtifactSlot side="a" size={RECORD_ARTIFACT_SIZE} label={`${labels.a} artifact`} artifacts={artifacts} value={formation.artifact} currentSeason={currentSeason} onOpen={() => chooseSide('A')}
                onChange={(artifact) => changeFormation({ ...formation, artifact })} borrow={borrow} />
            )}
            slotB={heroesOnly ? undefined : (
              <ArtifactSlot side="b" size={RECORD_ARTIFACT_SIZE} label={`${labels.b} artifact`} artifacts={artifacts} value={opponent.artifact} currentSeason={currentSeason} onOpen={() => chooseSide('B')}
                onChange={(artifact) => changeOpponent({ ...opponent, artifact })} />
            )}
            tileTag={(index) => {
              const a = formation.placed.find((p) => p.tile === index);
              const b = a ? undefined : opponent.placed.find((p) => p.tile === index);
              const row = a ?? b;
              if (!row || isSummon(row)) return null;
              const state = a ? heroState(formation, heroes, a.hero, everyone) : { rank: b?.rank ?? '', equipment: b?.equipment ?? '' };
              return <StateTag rank={state.rank || null} equipment={state.equipment === '' ? null : Number(state.equipment)} />;
            }}
            renderTile={(index, tile) => {
              const a = formation.placed.find((p) => p.tile === index);
              if (a) return <span className={`map-unit map-unit-a${isSelectedTile(index) ? ' map-unit-selected' : ''}`}><Portrait kind="hero" name={rowName(a)} size={RECORD_PORTRAIT_SIZE} /></span>;
              const partA = phantimalAt(formation.phantimal, index);
              if (partA) return <span className="map-unit map-unit-a"><Portrait kind="phantimal" name={partA} size={RECORD_PORTRAIT_SIZE} /></span>;
              const b = opponent.placed.find((p) => p.tile === index);
              if (b) return <span className={`map-unit map-unit-b${isSelectedTile(index) ? ' map-unit-selected' : ''}`}><Portrait kind="hero" name={rowName(b)} size={RECORD_PORTRAIT_SIZE} /></span>;
              const partB = phantimalAt(opponent.phantimal, index);
              if (partB) return <span className="map-unit map-unit-b"><Portrait kind="phantimal" name={partB} size={RECORD_PORTRAIT_SIZE} /></span>;
              return tile === TILE.PLAYER ? 'A' : tile === TILE.ENEMY ? 'B' : undefined;
            }}
          />
          {!!bannerOrder && <SideBanner side={bannerOrder[1]} labels={labels} active={side} />}
          {!hasZone('A') && <p className="error">This map has no player deployment tiles. Paint some in Admin → Maps first.</p>}
          {!hasZone('B') && <p className="error">This map has no enemy deployment tiles. Paint some in Admin → Maps first.</p>}
          {message && <p className="error">{message}</p>}
          {missingPhantimals.map((part) => <p key={part} className="error">{part} still has to be placed: the wedges always stand together.</p>)}
        </div>
        <div className="picker">
          <div className="picker-fixed">
          <div className="tabs" role="tablist" aria-label="Side">
            {(['A', 'B'] as Side[]).filter((s) => !onlySide || s === onlySide).map((s) => {
              const count = heroCount(s === 'A' ? formation.placed : opponent.placed);
              return (
                <button key={s} role="tab" aria-selected={side === s} className={side === s ? 'active' : undefined} onClick={() => chooseSide(s)}>
                  {s === 'A' ? labels.a : labels.b} ({count}/{MAX_STANDARD_HEROES})
                </button>
              );
            })}
          </div>
          {onlySide !== 'B' && <PlacedUnits
            label={labels.a}
            units={[
              ...[...new Set(formation.placed.map((p) => p.hero))].map((hero) => ({ key: `a-${hero}`, name: hero, kind: 'hero' as const, onRemove: () => removeA(hero) })),
              ...(formation.phantimal ? [{ key: 'phantimal', name: formation.phantimal.name, kind: 'phantimal' as const, onRemove: () => (chooseSide('A'), changeFormation({ ...formation, phantimal: null, phantimalChoice: '' })) }] : []),
            ]}
          />}
          <PlacedUnits
            label={labels.b}
            units={[
              ...[...new Set(opponent.placed.map((p) => p.hero))].map((hero) => ({ key: `b-${hero}`, name: hero, kind: 'hero' as const, onRemove: () => removeB(hero) })),
              ...(opponent.phantimal ? [{ key: 'phantimal', name: opponent.phantimal.name, kind: 'phantimal' as const, onRemove: () => (chooseSide('B'), changeOpponent({ ...opponent, phantimal: null, phantimalChoice: '' })) }] : []),
            ]}
          />
          {selectedEditable && selected && anchor && (
            <HeroStatePopover
              anchor={anchor}
              name={selected.name}
              tier={heroes.find((h) => h.name === selected.name)?.tier}
              rank={selectedState.rank}
              equipment={selectedState.equipment}
              rules={rules}
              onChange={(rank, equipment) =>
                selected.side === 'A'
                  ? changeFormation(withHeroState(formation, selected.name, rank, equipment))
                  : changeOpponent({ ...opponent, placed: opponent.placed.map((p) => (p.hero === selected.name ? { ...p, rank, equipment } : p)) })
              }
              onClose={closeState}
            />
          )}
          </div>
          <div className="picker-scroll">
          <HeroGrid
            key={side}
            heroes={heroIcons}
            selected={picked?.type === 'hero' ? picked.name : null}
            onPick={(name) => placeFirst({ type: 'hero', name })}
            onDragHero={(name) => setDragging(name ? { type: 'hero', name } : null)}
            disabled={disabled}
            held={side === 'A' && borrow ? heldIcons(heroIcons, disabled, borrow) : undefined}
            label={`${side === 'A' ? labels.a : labels.b} heroes`}
            hint={side === 'A' && !everyone ? (h) => h.rank ?? 'no rank' : undefined}
          />
          {side === 'A' && ownHeroes.length === 0 && <p className="muted">{everyone ? 'No heroes imported yet.' : 'Your roster is empty. Add heroes in the Roster tab.'}</p>}
          {phantimals && (
            <>
              <h4>Phantimal</h4>
              <label className="field">
                Season
                <select aria-label="Phantimal season" value={season ?? ''} onChange={(e) => setChosenSeason(Number(e.target.value))}>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      Season {s}
                    </option>
                  ))}
                </select>
              </label>
              <PhantimalField
                key={`${side}-${season}`}
                phantimals={seasonPhantimals}
                placed={side === 'A' ? formation.placed : opponent.placed}
                heroes={heroes}
                choice={(side === 'A' ? formation.phantimalChoice : opponent.phantimalChoice) ?? ''}
                shown={side === 'A' ? formation.phantimal : opponent.phantimal}
                onChoose={(name) =>
                  side === 'A'
                    ? changeFormation({ ...formation, phantimalChoice: name, phantimal: null })
                    : changeOpponent({ ...opponent, phantimalChoice: name, phantimal: null })
                }
              />
            </>
          )}
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}

function SideBanner({ side, labels, active }: { side: Side; labels: { a: string; b: string }; active: Side }) {
  const label = side === 'A' ? labels.a : labels.b;
  const text = label === `Side ${side}` ? label : `Side ${side} · ${label}`;
  return (
    <div className={`side-banner side-banner-${side.toLowerCase()}${active === side ? ' active' : ''}`}>
      {text}
    </div>
  );
}
