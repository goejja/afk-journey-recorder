// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FightRow } from '../../../web/records/FightRow.js';
import { GroupCard } from '../../../web/records/GroupCard.js';

afterEach(cleanup);

const rowProps = { cloneTitle: 'Start from this fight', onEdit: vi.fn(), onClone: vi.fn(), onDelete: vi.fn() };

describe('FightRow', () => {
  it('draws the info on the left, Edit, Clone and Delete on the right, the body and the note', () => {
    const onEdit = vi.fn();
    const onClone = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <FightRow {...rowProps} onEdit={onEdit} onClone={onClone} onDelete={onDelete} info={<strong>Alna</strong>} infoClassName="one-line" note="Hard fight" noteClassName="battle-note">
        <p>Team</p>
      </FightRow>,
    );
    expect(container.querySelector('.attempt-info.one-line')?.textContent).toBe('Alna');
    const actions = container.querySelector('.attempt-actions') as HTMLElement;
    expect([...actions.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Edit', 'Clone', 'Delete']);
    fireEvent.click(within(actions).getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(actions).getByRole('button', { name: 'Clone' }));
    fireEvent.click(within(actions).getByRole('button', { name: 'Delete' }));
    expect([onEdit, onClone, onDelete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
    expect(within(actions).getByRole('button', { name: 'Clone' }).getAttribute('title')).toBe('Start from this fight');
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('Hard fight').className).toBe('muted battle-note');
  });

  it('puts what a list adds before Edit and after Clone, and draws no note when there is none', () => {
    const { container } = render(
      <FightRow {...rowProps} info="x" leading={<button>Show map</button>} cloneVariants={<button>Clone A</button>} note={null} />,
    );
    expect([...container.querySelectorAll('.attempt-actions button')].map((b) => b.textContent)).toEqual(['Show map', 'Edit', 'Clone', 'Clone A', 'Delete']);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('GroupCard', () => {
  const card = (open: boolean, onToggle = vi.fn()) => (
    <ul>
      <GroupCard
        label="Dream Hunt day"
        fightsLabel="Fights of the day"
        header={<div className="attempt-info">Day</div>}
        fights={[{ id: 1 }, { id: 2 }]}
        open={open}
        onToggle={onToggle}
        editTitle="Edit all"
        onEdit={vi.fn()}
        cloneTitle="Start again"
        onClone={vi.fn()}
        cloneVariants={<button>Clone A</button>}
        onDelete={vi.fn()}
        renderFight={(f) => <span>Fight {f.id}</span>}
      />
    </ul>
  );

  it('is a labelled card whose fights show only when it is open, with the toggle saying so', () => {
    const onToggle = vi.fn();
    const { rerender } = render(card(false, onToggle));
    const toggle = screen.getByRole('button', { name: 'Show fights' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('listitem', { name: 'Dream Hunt day' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Fights of the day' })).toBeNull();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(card(true, onToggle));
    expect(screen.getByRole('button', { name: 'Hide fights' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(screen.getByRole('list', { name: 'Fights of the day' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Fight 1', 'Fight 2']);
  });

  it('has Edit, Clone, what the list adds, and Delete, with the titles it is given', () => {
    const { container } = render(card(false));
    expect([...container.querySelectorAll('.attempt-actions button')].map((b) => b.textContent)).toEqual(['Show fights', 'Edit', 'Clone', 'Clone A', 'Delete']);
    expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('title')).toBe('Edit all');
    expect(screen.getByRole('button', { name: 'Clone' }).getAttribute('title')).toBe('Start again');
  });
});
