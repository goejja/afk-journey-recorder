// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewPage } from '../../../web/reader/ReviewPage.js';

let requests: { method: string; url: string; body?: unknown; action?: string }[];
let findings: any;
let holdFindings: Promise<void> | null;
let noRun: boolean;
let dismissed: any[];
let explainState: any;
let explanation: any;
const RUN_DATE = '2026-11-11 13:40:00';

const noFindings = { wrong: [], obsolete: [], improve: [], kept: [] };

beforeEach(() => {
  requests = [];
  findings = noFindings;
  holdFindings = null;
  noRun = false;
  dismissed = [];
  explainState = null;
  explanation = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined, action: (init?.headers as Record<string, string> | undefined)?.['x-afk-action'] });
      if (url === '/api/admin/review/thinning' && method === 'GET') {
        return Response.json({
          kinds: [{ kind: 'rank', counts: { looks: 9, looksAfter: 6, wrong: 2, wrongAfter: 2 }, groups: [{ group: 'Supreme+', keep: [1, 2, 3], remove: [4, 5] }, { group: 'R1', keep: [6, 7, 8], remove: [9] }] }],
        });
      }
      if (url === '/api/admin/review/runs/latest') {
        await holdFindings;
        return Response.json(noRun ? null : { id: 1, createdAt: RUN_DATE, findings, dismissed, explanation });
      }
      if (url === '/api/admin/review/runs/1/explain' && method === 'POST') {
        explainState = { runId: 1, state: 'running' };
        return Response.json(explainState, { status: 202 });
      }
      if (url === '/api/admin/review/explain') return Response.json(explainState);
      if (url === '/api/admin/review/dismissals') return Response.json(JSON.parse(String(init!.body)), { status: method === 'POST' ? 201 : 200 });
      if (url === '/api/admin/review/runs' && method === 'POST') {
        noRun = false;
        return Response.json({ id: 2, createdAt: '2026-11-12 09:00:00', findings, dismissed, explanation: null }, { status: 201 });
      }
      if (url === '/api/admin/review/files/delete') return Response.json({ deleted: 1 });
      if (url === '/api/admin/learned/rank/7' && method === 'PATCH') return Response.json({ wrongBefore: 3, wrongAfter: 1 });
      if (url === '/api/admin/learned/rank/7' && method === 'DELETE') return Response.json({ deleted: 1 });
      if (url === '/api/thinning-settings') return Response.json({ rank: method === 'PUT' ? JSON.parse(String(init!.body)).rank : 0.05, defaults: { rank: 0.05 } });
      if (url === '/api/admin/review/thinning/apply') return Response.json({ deleted: 2 });
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(cleanup);

describe('ReviewPage', () => {
  it('offers the pictures Thinning removes, all ticked, with the counts before and after, and removes only the ones left ticked', async () => {
    render(<ReviewPage />);
    expect(await screen.findByText('Supreme+')).toBeTruthy();
    expect(screen.getByText('R1')).toBeTruthy();
    expect(screen.getByText(/9 Rank Looks now, 6 after/)).toBeTruthy();
    expect(screen.getByText(/2 read wrong now, 2 after/)).toBeTruthy();
    for (const id of [4, 5, 9]) expect((screen.getByRole('checkbox', { name: `Remove Rank Look ${id}` }) as HTMLInputElement).checked).toBe(true);
    // the pictures that stay are shown, but cannot be ticked
    expect(screen.queryByRole('checkbox', { name: 'Remove Rank Look 1' })).toBeNull();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Remove Rank Look 5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove 2 ticked' }));

    await waitFor(() => expect(requests.some((r) => r.url === '/api/admin/review/thinning/apply')).toBe(true));
    const apply = requests.find((r) => r.url === '/api/admin/review/thinning/apply')!;
    expect(apply.method).toBe('POST');
    expect(apply.action).toBe('app');
    expect(apply.body).toEqual({ kind: 'rank', ids: [4, 9] });
  });

  it('shows the distance that makes two Rank Looks alike, saves a new one and proposes again', async () => {
    render(<ReviewPage />);
    // the field is looked up each time: the page draws it again once the findings arrive
    const field = () => screen.getByLabelText('Rank Looks are alike closer than') as HTMLInputElement;
    await screen.findByLabelText('Rank Looks are alike closer than');
    await waitFor(() => expect(field().value).toBe('0.05'));
    const proposals = () => requests.filter((r) => r.url === '/api/admin/review/thinning' && r.method === 'GET').length;
    const before = proposals();

    await userEvent.clear(field());
    await userEvent.type(field(), '0.03');
    await userEvent.click(screen.getByRole('button', { name: 'Save distance' }));

    await waitFor(() => expect(requests.find((r) => r.url === '/api/thinning-settings' && r.method === 'PUT')?.body).toEqual({ rank: 0.03 }));
    expect(requests.find((r) => r.method === 'PUT')?.action).toBe('app');
    await waitFor(() => expect(proposals()).toBe(before + 1));
  });

  it('keeps the distance field in place when the slow findings arrive after the player started typing', async () => {
    let release!: () => void;
    holdFindings = new Promise((resolve) => (release = resolve));
    render(<ReviewPage />);
    const field = await screen.findByLabelText('Rank Looks are alike closer than');
    await userEvent.click(field);
    expect(document.activeElement).toBe(field);
    release();
    await waitFor(() => expect(requests.filter((r) => r.url === '/api/admin/review/runs/latest').length).toBe(1));
    await screen.findByRole('heading', { name: 'Wrong' });
    expect(screen.getByLabelText('Rank Looks are alike closer than')).toBe(field);
    expect(document.activeElement).toBe(field);
  });

  describe('the findings', () => {
    beforeEach(() => {
      findings = {
        wrong: [
          { code: 'rank-look-misread', subject: '7', filedUnder: 'R1', readAs: 'R2', message: 'Rank Look 7, filed under R1, is read as R2 by the others: check which rank it shows.' },
          { code: 'record-phantimal-faction', subject: '12', message: 'Record 12 (Supreme Arena, side A): Gervan needs 3 Lightbearer heroes; this team has 1. Check the Phantimal in the record.' },
          { code: 'roster-below-record', subject: 'Evie', recordId: 30, message: 'The roster has Evie at Epic, but its latest record (30) shows Legend: check which is current.' },
        ],
        obsolete: [
          { code: 'unreferenced-file', subject: 'rank-look/stray.png', message: 'rank-look/stray.png is used by no row: nothing reads it.' },
          { code: 'unreferenced-file', subject: 'look/old.png', message: 'look/old.png is used by no row: nothing reads it.' },
        ],
        improve: [
          { code: 'rank-few-looks', subject: 'Paragon 3', message: 'Paragon 3 has 2 Rank Looks: the rank reader names a rank only after 3.' },
          { code: 'hero-no-example', subject: 'Anya', message: 'Anya has no picture the hero reader can compare a tile with.' },
          { code: 'hero-no-example', subject: 'Zed', message: 'Zed has no picture the hero reader can compare a tile with.' },
        ],
        kept: [{ category: 'Kept pictures', files: 2, bytes: 2048, oldest: '2026-01-02' }],
      };
    });
    const runsStarted = () => requests.filter((r) => r.url === '/api/admin/review/runs' && r.method === 'POST').length;

    it('lists the three groups, and offers to move or delete a Rank Look the others read as another rank', async () => {
      render(<ReviewPage />);
      for (const name of ['Wrong', 'Obsolete', 'Improve']) expect(await screen.findByRole('heading', { name })).toBeTruthy();
      for (const f of findings.wrong) expect(screen.getByText(f.message)).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: 'Move Rank Look 7 to R2' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/admin/learned/rank/7' && r.method === 'PATCH')?.body).toEqual({ rank: 'R2' }));
      await waitFor(() => expect(runsStarted()).toBe(1)); // a fix starts a new run

      await userEvent.click(screen.getByRole('button', { name: 'Delete Rank Look 7' }));
      await waitFor(() => expect(requests.some((r) => r.url === '/api/admin/learned/rank/7' && r.method === 'DELETE')).toBe(true));
    });

    it('offers no change for a record: the finding only names it', async () => {
      render(<ReviewPage />);
      await screen.findByText(findings.wrong[1].message);
      // the only button on a record finding is Dismiss, which hides the finding and changes no record
      expect(screen.queryByRole('button', { name: /^(?!Dismiss).*record/i })).toBeNull();
      expect(screen.getAllByRole('button').map((b) => b.textContent)).not.toContain('Fix');
    });

    it('deletes the unreferenced files left ticked, and shows the size and age of the kept pictures', async () => {
      render(<ReviewPage />);
      await userEvent.click(await screen.findByRole('checkbox', { name: 'Delete look/old.png' }));
      expect((screen.getByRole('checkbox', { name: 'Delete rank-look/stray.png' }) as HTMLInputElement).checked).toBe(true);
      await userEvent.click(screen.getByRole('button', { name: 'Delete 1 ticked file' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/admin/review/files/delete')?.body).toEqual({ files: ['rank-look/stray.png'] }));
      const row = screen.getByRole('row', { name: /Kept pictures/ });
      expect(row.textContent).toContain('2 files');
      expect(row.textContent).toContain('2.0 KB');
      expect(row.textContent).toContain('2026-01-02');
    });

    it('counts the heroes without an example and lists them apart from the other Improve findings', async () => {
      render(<ReviewPage />);
      expect(await screen.findByText('Paragon 3 has 2 Rank Looks: the rank reader names a rank only after 3.')).toBeTruthy();
      expect(screen.getByText('2 heroes have no example')).toBeTruthy();
      expect(screen.getByText('Anya')).toBeTruthy();
      expect(screen.getByText('Zed')).toBeTruthy();
    });

    it('shows the date of the run it shows, marks the new findings, and starts a run on the button', async () => {
      findings = { ...findings, wrong: findings.wrong.map((f: any, i: number) => ({ ...f, new: i === 1 })) };
      render(<ReviewPage />);
      expect(await screen.findByText(/Last run: 2026-11-11 13:40/)).toBeTruthy();
      expect(screen.getAllByText('New')).toHaveLength(1);
      expect(runsStarted()).toBe(0); // opening the tab shows the run, it does not look again

      await userEvent.click(screen.getByRole('button', { name: 'Run review' }));
      await waitFor(() => expect(runsStarted()).toBe(1));
      expect(await screen.findByText(/Last run: 2026-11-12 09:00/)).toBeTruthy();
    });

    it('says no review was run yet, and does not look until the player asks', async () => {
      noRun = true;
      render(<ReviewPage />);
      expect(await screen.findByText('No review has been run yet.')).toBeTruthy();
      expect(runsStarted()).toBe(0);
      await userEvent.click(screen.getByRole('button', { name: 'Run review' }));
      await waitFor(() => expect(runsStarted()).toBe(1));
      expect(await screen.findByRole('heading', { name: 'Wrong' })).toBeTruthy();
    });

    it('dismisses a finding the player judges fine, and offers no dismissal for Thinning or the kept pictures', async () => {
      render(<ReviewPage />);
      await screen.findByRole('heading', { name: 'Wrong' });
      // 3 Wrong, 2 files, 1 Improve finding and 2 heroes: Thinning groups and the Kept table have none
      expect(screen.getAllByRole('button', { name: /^Dismiss finding about / })).toHaveLength(8);
      const reads = requests.filter((r) => r.url === '/api/admin/review/runs/latest').length;

      await userEvent.click(screen.getByRole('button', { name: 'Dismiss finding about Evie' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/admin/review/dismissals')?.body).toEqual({ code: 'roster-below-record', subject: 'Evie', message: findings.wrong[2].message }));
      expect(requests.find((r) => r.url === '/api/admin/review/dismissals')?.method).toBe('POST');
      expect(requests.find((r) => r.url === '/api/admin/review/dismissals')?.action).toBe('app');
      await waitFor(() => expect(requests.filter((r) => r.url === '/api/admin/review/runs/latest').length).toBe(reads + 1));
      expect(runsStarted()).toBe(0); // dismissing is not a fix: it does not look again
    });

    it('lists the dismissed findings apart and shows one again', async () => {
      const anya = { code: 'hero-no-example', subject: 'Anya', message: 'Anya has no picture the hero reader can compare a tile with.' };
      dismissed = [anya];
      findings = { ...findings, improve: findings.improve.filter((f: any) => f.subject !== 'Anya') };
      render(<ReviewPage />);
      await userEvent.click(await screen.findByText('Dismissed (1)'));
      expect(screen.getByText(anya.message)).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Show again finding about Anya' }));
      await waitFor(() => expect(requests.find((r) => r.url === '/api/admin/review/dismissals' && r.method === 'DELETE')?.body).toEqual(anya));
    });

    describe('asking the Agent', () => {
      afterEach(() => vi.useRealTimers());

      it('starts the Agent on the last run, shows that it is working, and shows its explanation with the date when it finishes', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<ReviewPage />);
        await user.click(await screen.findByRole('button', { name: 'Ask the Agent' }));
        const start = requests.find((r) => r.method === 'POST' && r.url === '/api/admin/review/runs/1/explain')!;
        expect(start.action).toBe('app');
        expect((await screen.findByRole('button', { name: 'Asking…' }) as HTMLButtonElement).disabled).toBe(true);

        // the server finishes: it has kept the explanation on the run
        explainState = { runId: 1, state: 'done' };
        explanation = { text: '1. Rank Look 7 first: the reader names R2 for it.', at: '2026-11-11 14:05:00' };
        await act(() => vi.advanceTimersByTimeAsync(2100));

        expect(await screen.findByText('1. Rank Look 7 first: the reader names R2 for it.')).toBeTruthy();
        expect(screen.getByText(/Written 2026-11-11 14:05/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ask the Agent' })).toBeTruthy();
      });

      it('says why the Agent could not explain the run', async () => {
        explainState = { runId: 1, state: 'failed', error: 'claude: not logged in' };
        render(<ReviewPage />);
        expect(await screen.findByText(/Could not explain the run: claude: not logged in/)).toBeTruthy();
      });

      it('shows no explanation on a run the Agent did not explain, such as a new one', async () => {
        explanation = { text: 'An old explanation.', at: '2026-11-10 10:00:00' };
        render(<ReviewPage />);
        expect(await screen.findByText('An old explanation.')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: 'Run review' }));
        await waitFor(() => expect(screen.queryByText('An old explanation.')).toBeNull());
      });
    });
  });
});
