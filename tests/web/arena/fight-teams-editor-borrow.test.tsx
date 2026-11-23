// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMap, Hero, Rules } from '../../../web/backend.js';
import { FightTeamsEditor } from '../../../web/arena/FightTeamsEditor.js';
import { emptyFormation, FormationEditor, type FormationState } from '../../../web/FormationEditor.js';
import { emptyOpponent, type OpponentState } from '../../../web/arena/OpponentEditor.js';

afterEach(cleanup);

const map = { name: 'Arena I', tags: ['Arena'], rowLengths: [2, 5, 6, 6, 7, 6, 6, 5, 2], cells: Array.from({ length: 45 }, (_, i) => (i < 5 ? -1 : i >= 38 ? 1 : 0)), source: 'import', canRestore: false } as unknown as GameMap;
const hero = (name: string) => ({ name, tier: 'S', class: 'Mage', faction: 'Wilder', owned: true, rank: 'Epic', equipmentLevel: 0 }) as unknown as Hero;
const rules = { ranks: ['Epic'], equipmentLevels: [0], rankEquipmentCaps: [] } as unknown as Rules;

/** The editor with the state of its form; `outside` changes Side A the way another part of the page would. */
function Harness({ release, outside }: { release: (hero: string) => void; outside: { current: ((f: FormationState) => void) | null } }) {
  const [formation, setFormation] = useState<FormationState>(emptyFormation());
  const [opponent, setOpponent] = useState<OpponentState>(emptyOpponent());
  outside.current = setFormation;
  return (
    <>
      <FightTeamsEditor
        map={map}
        heroes={[hero('Evie'), hero('Fay')]}
        artifacts={[]}
        rules={rules}
        formation={formation}
        onFormation={setFormation}
        opponent={opponent}
        onOpponent={setOpponent}
        onBoth={(a, b) => (setFormation(a), setOpponent(b))}
        borrow={{ noun: 'fight', heroHolder: (name) => (name === 'Evie' ? 'fight 2' : null), artifactHolder: () => null, releaseHero: release, releaseArtifact: () => undefined }}
      />
      <p data-testid="placed">{formation.placed.map((p) => `${p.hero}@${p.tile}`).join(',')}</p>
    </>
  );
}

describe('the battle editor', () => {
  it('has no assist hero for either side: a battle on this map has a phantimal instead', () => {
    render(<Harness release={() => undefined} outside={{ current: null }} />);
    expect(screen.queryByRole('button', { name: /assist hero/i })).toBeNull();
  });
});

describe('placing a hero another team holds', () => {
  it('asks first, then takes the hero and places it', async () => {
    const release = vi.fn();
    render(<Harness release={release} outside={{ current: null }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evie' }));
    expect(screen.getByTestId('placed').textContent).toBe('');
    await userEvent.click(await screen.findByRole('button', { name: 'Move' }));
    expect(release).toHaveBeenCalledWith('Evie');
    expect(screen.getByTestId('placed').textContent).toBe('Evie@38');
  });

  it('places it on the side as it is after the question, and not on a tile taken meanwhile', async () => {
    const outside = { current: null as ((f: FormationState) => void) | null };
    render(<Harness release={() => undefined} outside={outside} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evie' }));
    await screen.findByRole('button', { name: 'Move' });
    // another part of the page changes the side while the question is open: the hero already there stays, and the tile chosen is taken
    act(() => outside.current!({ ...emptyFormation(), placed: [{ tile: 38, hero: 'Fay' }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByTestId('placed').textContent).toBe('Fay@38');
    expect(screen.getByText(/taken meanwhile/)).toBeTruthy();
  });

  it('keeps what changed on the side while the question was open when the tile is still free', async () => {
    const outside = { current: null as ((f: FormationState) => void) | null };
    render(<Harness release={() => undefined} outside={outside} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evie' }));
    await screen.findByRole('button', { name: 'Move' });
    act(() => outside.current!({ ...emptyFormation(), placed: [{ tile: 40, hero: 'Fay' }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByTestId('placed').textContent).toBe('Fay@40,Evie@38');
  });
});

/** The single-side editor, with the same borrow and the same way to change its side from outside. */
function SingleHarness({ outside }: { outside: { current: ((f: FormationState) => void) | null } }) {
  const [formation, setFormation] = useState<FormationState>(emptyFormation());
  outside.current = setFormation;
  return (
    <>
      <FormationEditor
        map={map}
        heroes={[hero('Evie'), hero('Fay')]}
        artifacts={[]}
        phantimals={null}
        value={formation}
        onChange={setFormation}
        heroSource="all"
        borrow={{ noun: 'fight', heroHolder: (name) => (name === 'Evie' ? 'fight 2' : null), artifactHolder: () => null, releaseHero: () => undefined, releaseArtifact: () => undefined }}
      />
      <p data-testid="placed">{formation.placed.map((p) => `${p.hero}@${p.tile}`).join(',')}</p>
    </>
  );
}

describe('placing a hero another team holds, on a single side', () => {
  it('places it on the team as it is after the question, and not on a tile taken meanwhile', async () => {
    const outside = { current: null as ((f: FormationState) => void) | null };
    render(<SingleHarness outside={outside} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evie' }));
    await screen.findByRole('button', { name: 'Move' });
    act(() => outside.current!({ ...emptyFormation(), placed: [{ tile: 40, hero: 'Fay' }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByTestId('placed').textContent).toBe('Fay@40,Evie@38');

    cleanup();
    render(<SingleHarness outside={outside} />);
    await userEvent.click(screen.getByRole('button', { name: 'Evie' }));
    await screen.findByRole('button', { name: 'Move' });
    act(() => outside.current!({ ...emptyFormation(), placed: [{ tile: 38, hero: 'Fay' }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByTestId('placed').textContent).toBe('Fay@38');
    expect(screen.getByText(/taken meanwhile/)).toBeTruthy();
  });
});
