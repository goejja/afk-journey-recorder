// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamOverview } from '../../../web/stats/TeamOverview.js';

afterEach(cleanup);

const hero = (name: string, part = '') => ({ name, part, rank: 'Mythic+', equipmentLevel: null });

describe('TeamOverview', () => {
  it('lists the phantimal, then the artifact, then the heroes', () => {
    render(<TeamOverview label="Side A" heroes={[hero('Evie'), hero('Fay')]} phantimal={{ name: 'Gervan' }} artifact="Bladestorm" />);
    const team = screen.getByLabelText('Side A');
    expect([...team.querySelectorAll('.unit')].map((u) => u.querySelector('.unit-meta')?.textContent)).toEqual(['phantimal', 'Bladestorm', 'Evie', 'Fay']);
    expect(team.querySelector('.artifact-level')).toBeNull();
  });

  it('shows a pair and a hero with summons once', () => {
    render(
      <TeamOverview
        label="Side B"
        heroes={[hero('Elijah & Lailah', 'Elijah'), hero('Elijah & Lailah', 'Lailah'), hero('Zanie'), hero('Zanie', 'Laser Turret'), hero('Zanie', 'Laser Turret')]}
      />,
    );
    expect([...screen.getByLabelText('Side B').querySelectorAll('.unit-meta')].map((m) => m.textContent)).toEqual(['Elijah & Lailah', 'Zanie']);
  });

  it('keeps Zanie and Phraesto whichever of their rows comes first', () => {
    render(
      <TeamOverview
        label="Side A"
        heroes={[hero('Zanie', 'Laser Turret'), hero('Phraesto', 'Phraesto clone'), hero('Zanie', 'Laser Turret'), hero('Zanie'), hero('Phraesto'), hero('Evie')]}
      />,
    );
    expect([...screen.getByLabelText('Side A').querySelectorAll('.unit-meta')].map((m) => m.textContent)).toEqual(['Zanie', 'Phraesto', 'Evie']);
  });

  it('puts the assist hero after the units and can show ranks instead of names', () => {
    render(<TeamOverview label="Team" heroes={[hero('Evie')]} assist={{ name: 'Fay' }} meta="state" />);
    expect([...screen.getByLabelText('Team').querySelectorAll('.unit-meta')].map((m) => m.textContent)).toEqual(['Mythic+', 'assist']);
  });

  it('draws a box round the team and says whether it won', () => {
    render(<TeamOverview label="Side A" heroes={[hero('Evie')]} outcome="won" />);
    const team = screen.getByLabelText('Side A (won)');
    expect(team.className).toContain('team-won');
  });

  it('keeps a place for what is missing, so teams line up row after row', () => {
    const slots = (label: string) => [...screen.getByLabelText(label).children].map((c) => (c.classList.contains('unit-blank') ? '' : c.querySelector('.unit-meta')?.textContent));
    render(
      <>
        <TeamOverview label="Bare" heroes={[hero('Evie'), hero('Fay')]} />
        <TeamOverview label="Full" heroes={['A', 'B', 'C', 'D', 'E'].map((n) => hero(n))} phantimal={{ name: 'Gervan' }} artifact="Bladestorm" assist={{ name: 'Zed' }} />
        <TeamOverview label="No assist" heroes={[hero('Evie')]} assist={null} />
      </>,
    );
    expect(slots('Bare')).toEqual(['', '', 'Evie', 'Fay', '', '', '']); // no phantimal, no artifact, three heroes missing, and no assist slot
    expect(slots('Full')).toEqual(['phantimal', 'Bladestorm', 'A', 'B', 'C', 'D', 'E', 'assist']);
    expect(slots('No assist')).toEqual(['', '', 'Evie', '', '', '', '', '']);
  });
});
