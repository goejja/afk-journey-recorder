import { describe, expect, it } from 'vitest';
import { clampView, FRAME_HEIGHT, FRAME_WIDTH, hexPoints, imageRect, initialView, ZOOM_MAX, ZOOM_MIN, zoomAt } from '../../src/domain/image-frame.js';

describe('imageRect', () => {
  it('just covers the frame at zoom 1, centred', () => {
    // A wide picture is scaled to the frame's height and overhangs left and right.
    expect(imageRect(initialView(), { width: 796, height: 398 })).toEqual({ x: (FRAME_WIDTH - 796) / 2, y: 0, width: 796, height: FRAME_HEIGHT });
    // A tall one is scaled to the frame's width.
    const tall = imageRect(initialView(), { width: 180, height: 500 });
    expect(tall.width).toBe(FRAME_WIDTH);
    expect(tall.height).toBeGreaterThanOrEqual(FRAME_HEIGHT);
  });

  it('moves with the pan and grows with the zoom', () => {
    const base = imageRect(initialView(), { width: 360, height: 398 });
    expect(imageRect({ zoom: 2, panX: 10, panY: -20 }, { width: 360, height: 398 })).toEqual({ x: base.x - 180 + 10, y: base.y - 199 - 20, width: 720, height: 796 });
  });
});

describe('clampView', () => {
  const image = { width: 360, height: 398 };

  it('keeps the zoom in range', () => {
    expect(clampView({ zoom: 99, panX: 0, panY: 0 }, image).zoom).toBe(ZOOM_MAX);
    expect(clampView({ zoom: 0.01, panX: 0, panY: 0 }, image).zoom).toBe(ZOOM_MIN);
  });

  it('stops the picture being dragged off the frame, and allows no drag at all when it does not cover it', () => {
    expect(clampView({ zoom: 2, panX: 9999, panY: -9999 }, image)).toEqual({ zoom: 2, panX: 180, panY: -199 });
    expect(clampView({ zoom: 1, panX: 50, panY: 50 }, image)).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(clampView({ zoom: 0.5, panX: 50, panY: 50 }, image)).toEqual({ zoom: 0.5, panX: 0, panY: 0 });
  });
});

describe('hexPoints', () => {
  it('is a pointy-top hexagon filling the frame, and shrinks with the inset', () => {
    expect(hexPoints()).toEqual([
      [180, 0],
      [360, FRAME_HEIGHT / 4],
      [360, (3 * FRAME_HEIGHT) / 4],
      [180, FRAME_HEIGHT],
      [0, (3 * FRAME_HEIGHT) / 4],
      [0, FRAME_HEIGHT / 4],
    ]);
    const inner = hexPoints(10);
    expect(inner[0]![1]).toBeCloseTo(10);
    expect(inner[3]![1]).toBeCloseTo(FRAME_HEIGHT - 10);
    expect(inner[1]![0]).toBeCloseTo(FRAME_WIDTH - 10);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the pointer where it was', () => {
    const image = { width: 1000, height: 1000 };
    const start = { zoom: 2, panX: 30, panY: -40 };
    const focus = { x: 100, y: 250 };
    const under = (view: typeof start) => {
      const rect = imageRect(view, image);
      return { u: (focus.x - rect.x) / rect.width, v: (focus.y - rect.y) / rect.height };
    };
    const next = zoomAt(start, image, 3, focus);
    expect(next.zoom).toBe(3);
    expect(under(next).u).toBeCloseTo(under(start).u);
    expect(under(next).v).toBeCloseTo(under(start).v);
  });
});
