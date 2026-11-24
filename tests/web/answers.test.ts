import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearAnswers, keptAnswer } from '../../web/answers.js';
import { rostersOf, savedOfMode } from '../../web/arena/draft.js';
import { api } from '../../web/backend.js';

afterEach(() => vi.unstubAllGlobals());

describe('the answers kept for the pages', () => {
  it('asks once for the same key, and again for another', async () => {
    const ask = vi.fn(async () => [1]);
    await keptAnswer('/api/maps', ask);
    await keptAnswer('/api/maps', ask);
    await keptAnswer('/api/heroes', ask);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('shares one request between readers that ask while it is on its way', async () => {
    let answer!: (v: number[]) => void;
    const ask = vi.fn(() => new Promise<number[]>((resolve) => (answer = resolve)));
    const first = keptAnswer('/api/maps', ask);
    const second = keptAnswer('/api/maps', ask);
    answer([1]);
    expect(await first).toBe(await second);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure, so the next reader asks again', async () => {
    const ask = vi.fn<() => Promise<number[]>>().mockRejectedValueOnce(new Error('down')).mockResolvedValue([1]);
    await expect(keptAnswer('/api/maps', ask)).rejects.toThrow('down');
    await expect(keptAnswer('/api/maps', ask)).resolves.toEqual([1]);
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('freezes what it hands out, all the way down, so a page cannot change what the next page reads', async () => {
    const rows = await keptAnswer('/api/maps', async () => [{ name: 'A', tags: ['Arena'] }]);
    expect(() => rows.push({ name: 'B', tags: [] })).toThrow(TypeError);
    expect(() => rows[0]!.tags.push('Stage')).toThrow(TypeError);
    const several = await keptAnswer('/api/heroes', async () => [{ n: 2 }, { n: 1 }]);
    expect(() => several.sort((a, b) => a.n - b.n)).toThrow(TypeError);
  });

  it('forgets everything when cleared, and a read that was on its way then is not kept', async () => {
    let answer!: (v: number[]) => void;
    const slow = vi.fn(() => new Promise<number[]>((resolve) => (answer = resolve)));
    const before = keptAnswer('/api/maps', slow);
    clearAnswers();
    answer([1]);
    await before;
    const fresh = vi.fn(async () => [2]);
    expect(await keptAnswer('/api/maps', fresh)).toEqual([2]);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the newer read when an older one, started before a clear, settles later', async () => {
    let settleOld!: (v: string[]) => void;
    const old = keptAnswer('/api/maps', () => new Promise<string[]>((resolve) => (settleOld = resolve)));
    clearAnswers();
    const newer = vi.fn(async () => ['after the change']);
    await keptAnswer('/api/maps', newer);
    settleOld(['before the change']);
    await old;
    const later = vi.fn(async () => ['asked again']);
    expect(await keptAnswer('/api/maps', later)).toEqual(['after the change']);
    expect(later).not.toHaveBeenCalled();
  });

  it('keeps the newer read when an older one fails after a clear', async () => {
    let failOld!: (e: Error) => void;
    const old = keptAnswer('/api/maps', () => new Promise<string[]>((_, reject) => (failOld = reject)));
    old.catch(() => undefined);
    clearAnswers();
    await keptAnswer('/api/maps', async () => ['after the change']);
    failOld(new Error('down'));
    await old.catch(() => undefined);
    expect(await keptAnswer('/api/maps', async () => ['asked again'])).toEqual(['after the change']);
  });
});

describe('the reads of the web app', () => {
  const stub = () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/profiles' && init?.method === 'POST') return Response.json({ error: 'No' }, { status: 500 });
      return Response.json(url === '/api/maps' ? [{ name: 'A' }] : []);
    }));
    return urls;
  };

  it('holds reference data across pages, and keeps one answer for each profile roster', async () => {
    const urls = stub();
    await api.maps();
    await api.maps();
    await api.heroes();
    await api.heroes(2);
    await api.heroes(2);
    expect(urls).toEqual(['GET /api/maps', 'GET /api/heroes', 'GET /api/heroes?profile=2']);
  });

  it('asks again after any change, also one that failed, since it may have changed something', async () => {
    const urls = stub();
    await api.maps();
    await expect(api.createProfile({ name: 'Luna' })).rejects.toThrow('No');
    await api.maps();
    expect(urls.filter((u) => u === 'GET /api/maps')).toHaveLength(2);
  });

  it('never holds a read that is not listed, such as the job status', async () => {
    const urls = stub();
    await api.arenaFights();
    await api.arenaFights();
    expect(urls).toEqual(['GET /api/pvp/fights', 'GET /api/pvp/fights']);
  });

  it('reads the saved fights of a mode once for a batch import and the form, and again after a save', async () => {
    const urls = stub();
    await savedOfMode('Arena');
    await api.savedFights('Arena');
    await savedOfMode('Arena');
    await savedOfMode('Super League');
    expect(urls).toEqual(['GET /api/pvp/fights?mode=Arena&limit=1000', 'GET /api/pvp/fights?mode=Super+League&limit=1000']);
    await expect(api.createProfile({ name: 'Luna' })).rejects.toThrow('No'); // a change, even a failed one, clears what is held
    await savedOfMode('Arena');
    expect(urls.filter((u) => u.includes('mode=Arena'))).toHaveLength(2);
  });

  it('reads the roster of a Profile once however many pictures name it', async () => {
    const urls = stub();
    const side = (id: number) => ({ profile: { id, name: `P${id}` } });
    const group = { pictures: [{ draft: { sideA: side(1), sideB: side(2) } }, { draft: { sideA: side(1), sideB: side(2) } }] } as never;
    await rostersOf([group]);
    await rostersOf([group]);
    expect(urls).toEqual(['GET /api/heroes?profile=1', 'GET /api/heroes?profile=2']);
  });
});
