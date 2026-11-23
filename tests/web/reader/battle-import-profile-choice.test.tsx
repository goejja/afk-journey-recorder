// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FightDraft, FightImportPicture } from '../../../web/backend.js';
import { BattleImport } from '../../../web/reader/BattleImport.js';
import type { ImportGroup } from '../../../web/reader/battle-import.js';
import { draftSide } from '../../support/draft-side.js';

const hero = (name: string) => ({ tile: `${name}-0`, hero: name, rank: 'Mythic+' as string | null, equipmentLevel: 10 as number | null });
const draft = (over: Partial<FightDraft> = {}): FightDraft => ({
  mode: 'Guild Duel', number: 1, outcome: 'Win', unionLevelA: 57, unionLevelB: 37,
  sideA: draftSide({ name: 'Luna', profile: { id: 2, name: 'Luna', playerId: '2222' }, heroes: [hero('Evie')] }),
  sideB: draftSide({ name: 'Rovr', profile: null, heroes: [hero('Zed')] }),
  duplicateOf: null,
  ...over,
});
const picture = (id: number): FightImportPicture => ({ id, label: `IMG_${id}.jpeg`, state: 'done', draft: draft() });

let requests: { method: string; url: string }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url });
      if (url === '/api/profiles' && method === 'POST') return Response.json({ id: 9, name: 'Rovr', playerId: null, isDefault: false, heroCount: 0 });
      if (/^\/api\/profiles\/\d+\/names$/.test(url) && method === 'POST') return Response.json(['seen'], { status: 201 });
      if (url === '/api/profiles') return Response.json([{ id: 1, name: 'Me', playerId: '1111', isDefault: true, heroCount: 3 }, { id: 2, name: 'Luna', playerId: '2222', isDefault: false, heroCount: 2 }, { id: 3, name: 'Rover', playerId: null, isDefault: false, heroCount: 0 }]);
      if (url === '/api/roster-import?kind=report') return Response.json({ canRead: true, reason: null, busy: false, queue: [picture(1)] });
      if (url.startsWith('/api/roster-import?ids=') && method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({}, { status: 404 });
    }),
  );
});
afterEach(cleanup);

async function renderImport() {
  const user = userEvent.setup();
  const onOpen = vi.fn(async (_group: ImportGroup) => undefined);
  render(<BattleImport onClose={() => undefined} onOpen={onOpen} />);
  const battle = await screen.findByRole('group', { name: 'Battle 1' });
  return { user, onOpen, battle };
}

describe('a name the agent matched to the wrong profile', () => {
  it('can be given another profile, and the spelling is remembered (ADR 0021)', async () => {
    const { user, onOpen, battle } = await renderImport();
    // Luna is matched to profile 2 by the picture; the player says it is Rover.
    expect(within(battle).getByText(/Side A “Luna” uses profile “Luna”/)).toBeTruthy();
    const choice = within(battle).getByLabelText('Use an existing profile for “Luna”');
    await user.selectOptions(choice, 'Rover');
    expect(within(screen.getByRole('group', { name: 'Battle 1' })).getByText(/Side A “Luna” uses profile “Rover”/)).toBeTruthy();
    // the spelling is remembered against the chosen Profile, for the next import
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles/3/names')).toBe(true));

    await user.click(screen.getByRole('button', { name: 'Open in the form' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect(onOpen.mock.calls[0]![0].pictures[0]!.draft.sideA.profile).toMatchObject({ id: 3, name: 'Rover' });
  });
});

describe('a side whose name matches no profile', () => {
  it('can take an existing profile instead of a new one, when the agent misread the name', async () => {
    const { user, onOpen, battle } = await renderImport();
    expect(within(battle).getByText(/Side B “Rovr” has no profile/)).toBeTruthy();
    const choice = await within(battle).findByLabelText('Use an existing profile for “Rovr”');
    expect([...(choice as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['No profile', 'Me · ID 1111', 'Luna · ID 2222', 'Rover']);

    await user.selectOptions(choice, 'Rover');
    expect(within(screen.getByRole('group', { name: 'Battle 1' })).getByText(/Side B “Rovr” uses profile “Rover”/)).toBeTruthy();
    expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles')).toBe(false); // nothing was created

    await user.click(screen.getByRole('button', { name: 'Open in the form' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalled());
    expect(onOpen.mock.calls[0]![0].pictures[0]!.draft.sideB.profile).toMatchObject({ id: 3, name: 'Rover' });
  });

  it('lets the player undo the choice, and offers a profile made here to the other names', async () => {
    const { user, battle } = await renderImport();
    const choice = await within(battle).findByLabelText('Use an existing profile for “Rovr”');
    await user.selectOptions(choice, 'Rover');
    await user.selectOptions(within(screen.getByRole('group', { name: 'Battle 1' })).getByLabelText('Use an existing profile for “Rovr”'), 'No profile');
    expect(within(screen.getByRole('group', { name: 'Battle 1' })).getByText(/Side B “Rovr” has no profile/)).toBeTruthy();

    await user.click(within(screen.getByRole('group', { name: 'Battle 1' })).getByRole('button', { name: 'Create profile “Rovr”' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'POST' && r.url === '/api/profiles')).toBe(true));
    expect(await within(screen.getByRole('group', { name: 'Battle 1' })).findByText(/Side B “Rovr” uses profile “Rovr”/)).toBeTruthy();
  });
});
