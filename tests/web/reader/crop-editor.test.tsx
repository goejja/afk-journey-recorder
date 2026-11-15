// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CropEditor } from '../../../web/reader/CropEditor.js';

let draws: number[][];
let strokes: number;

beforeEach(() => {
  draws = [];
  strokes = 0;
  const context = {
    clearRect: () => {}, save: () => {}, restore: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, closePath: () => {},
    clip: () => {}, fillRect: () => {}, stroke: () => (strokes += 1), createLinearGradient: () => ({ addColorStop: () => {} }),
    drawImage: (_image: unknown, x: number, y: number, w: number, h: number) => draws.push([x, y, w, h]),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const file = new File([new Uint8Array([1])], 'face.jpg', { type: 'image/jpeg' });
const load = async () => ({ width: 720, height: 398 }) as unknown as ImageBitmap;

describe('CropEditor', () => {
  it('draws the picture covering the hexagon, with a frame', async () => {
    render(<CropEditor file={file} name="Fay" load={load} onSave={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(draws.length).toBeGreaterThan(0));
    expect(draws.at(-1)).toEqual([-180, 0, 720, 398]); // 720x398 scaled to the 398-high frame, centred
    expect(strokes).toBeGreaterThan(0);
  });

  it('zooms with the slider', async () => {
    render(<CropEditor file={file} name="Fay" load={load} onSave={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(draws.length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Zoom'), { target: { value: '2' } });
    await waitFor(() => expect(draws.at(-1)![2]).toBe(1440));
  });

  it('zooms with the mouse wheel', async () => {
    render(<CropEditor file={file} name="Fay" load={load} onSave={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(draws.length).toBeGreaterThan(0));
    fireEvent.wheel(screen.getByLabelText('Portrait preview'), { deltaY: -100 });
    await waitFor(() => expect(draws.at(-1)![2]).toBeGreaterThan(720));
  });

  it('saves a PNG named after the unit', async () => {
    const onSave = vi.fn();
    render(<CropEditor file={file} name="Fay" load={load} onSave={onSave} onCancel={() => {}} />);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save image' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]![0] as File;
    expect([saved.name, saved.type]).toEqual(['Fay.png', 'image/png']);
  });

  it('says so when the file is not an image the browser can read', async () => {
    render(<CropEditor file={file} name="Fay" load={() => Promise.reject(new Error('bad'))} onSave={() => {}} onCancel={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/);
    expect((screen.getByRole('button', { name: 'Save image' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
