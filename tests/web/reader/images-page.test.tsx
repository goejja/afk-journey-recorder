// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImagesPage } from '../../../web/reader/ImagesPage.js';
import { Portrait } from '../../../web/Portrait.js';
import { fireEvent } from '@testing-library/react';

let units: { name: string; source: string }[];
let requests: { method: string; url: string; type?: string }[];

beforeEach(() => {
  requests = [];
  units = [
    { name: 'Evie', source: 'imported' },
    { name: 'Fay', source: 'none' },
    { name: 'Lucca', source: 'custom' },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ method, url, type: (init?.headers as Record<string, string> | undefined)?.['content-type'] });
      if (method === 'GET') return Response.json(units);
      if (method === 'PUT') {
        units = units.map((u) => (u.name === 'Fay' ? { ...u, source: 'custom' } : u));
        return Response.json({});
      }
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(cleanup);

describe('ImagesPage', () => {
  it('lists units with their image source and filters to the missing ones', async () => {
    const user = userEvent.setup();
    render(<ImagesPage />);
    expect(await screen.findByText('Fay')).toBeTruthy();
    expect(screen.getByText('1 of 3 have none')).toBeTruthy();
    expect(screen.getByText('imported')).toBeTruthy();
    expect(screen.getByText('your image')).toBeTruthy();

    await user.click(screen.getByLabelText('Missing only'));
    expect(screen.queryByText('Evie')).toBeNull();
    expect(screen.getByText('Fay')).toBeTruthy();
  });

  it('uploads an image for a unit and refreshes the list', async () => {
    const user = userEvent.setup();
    render(<ImagesPage />);
    await screen.findByText('Fay');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'fay.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Upload image for Fay'), file);

    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url).toBe('/api/images/hero/Fay');
    expect(put.type).toBe('image/png');
    await waitFor(() => expect(screen.getAllByText('your image')).toHaveLength(2));
  });

  it('removes a custom image', async () => {
    const user = userEvent.setup();
    render(<ImagesPage />);
    await screen.findByText('Lucca');
    await user.click(screen.getByRole('button', { name: 'Remove mine' }));
    await waitFor(() => expect(requests.some((r) => r.method === 'DELETE' && r.url === '/api/images/hero/Lucca')).toBe(true));
  });
});

describe('Portrait', () => {
  it('asks the server for the portrait of the unit', () => {
    render(<Portrait kind="enemy" name="Alpha Bear" />);
    expect((document.querySelector('img') as HTMLImageElement).getAttribute('src')).toMatch(/^\/api\/portrait\/enemy\/Alpha%20Bear\?v=/);
  });

  it('falls back to a generic silhouette when the image is missing', () => {
    render(<Portrait kind="boss" name="King Croaker" />);
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByRole('img', { name: 'King Croaker (no image)' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
  });

  it('uploads several files at once to the units their names match', async () => {
    render(<ImagesPage />);
    await screen.findByText('Fay');
    const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload several images'), { target: { files: [png('Fay.png'), png('Nobody.png')] } });
    expect(await screen.findByText(/Uploaded 1 image\./)).toBeTruthy();
    expect(screen.getByText(/No unit matches: Nobody\.png/)).toBeTruthy();
    expect(requests.filter((r) => r.method === 'PUT').map((r) => r.url)).toEqual(['/api/images/hero/Fay']);
  });

  it('crops and frames a picture, then uploads it as a PNG', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 400, height: 400 }));
    const noop = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { clearRect: noop, save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, clip: noop, fillRect: noop, stroke: noop, drawImage: noop, createLinearGradient: () => ({ addColorStop: noop }) } as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })));
    render(<ImagesPage />);
    await screen.findByText('Fay');
    fireEvent.change(screen.getByLabelText('Crop and frame image for Fay'), { target: { files: [new File([new Uint8Array([1])], 'face.jpg', { type: 'image/jpeg' })] } });
    const save = await screen.findByRole('button', { name: 'Save image' });
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(requests.some((r) => r.method === 'PUT')).toBe(true));
    expect(requests.find((r) => r.method === 'PUT')).toMatchObject({ url: '/api/images/hero/Fay', type: 'image/png' });
    expect(screen.queryByRole('dialog')).toBeNull();
    vi.restoreAllMocks();
  });
});
