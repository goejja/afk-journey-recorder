/** The size of a framed portrait; the imported hero portraits are half this, the bosses the same. */
export const FRAME_WIDTH = 360;
export const FRAME_HEIGHT = 398;

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

/** Where the picture sits in the frame: a zoom (1 just covers the frame) and an offset of its centre, in frame pixels. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const initialView = (): View => ({ zoom: 1, panX: 0, panY: 0 });

/** The size at which the picture just covers the whole frame. */
const coverScale = (image: Size) => Math.max(FRAME_WIDTH / image.width, FRAME_HEIGHT / image.height);

/** Where the picture is drawn, in frame pixels. */
export function imageRect(view: View, image: Size): Rect {
  const scale = coverScale(image) * view.zoom;
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: FRAME_WIDTH / 2 - width / 2 + view.panX, y: FRAME_HEIGHT / 2 - height / 2 + view.panY, width, height };
}

/** Keeps the zoom in range and the picture from being dragged away from the frame, so no gap opens at an edge. */
export function clampView(view: View, image: Size): View {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.zoom));
  const { width, height } = imageRect({ zoom, panX: 0, panY: 0 }, image);
  const limitX = Math.max(0, (width - FRAME_WIDTH) / 2);
  const limitY = Math.max(0, (height - FRAME_HEIGHT) / 2);
  return { zoom, panX: Math.min(limitX, Math.max(-limitX, view.panX)), panY: Math.min(limitY, Math.max(-limitY, view.panY)) };
}

/** The corners of the pointy-top hexagon that fills the frame, pulled in by `inset` pixels on every side. */
export function hexPoints(inset = 0): [number, number][] {
  const w = FRAME_WIDTH;
  const h = FRAME_HEIGHT;
  const sx = (w - 2 * inset) / w;
  const sy = (h - 2 * inset) / h;
  const corners: [number, number][] = [
    [w / 2, 0],
    [w, h / 4],
    [w, (3 * h) / 4],
    [w / 2, h],
    [0, (3 * h) / 4],
    [0, h / 4],
  ];
  return corners.map(([x, y]) => [w / 2 + (x - w / 2) * sx, h / 2 + (y - h / 2) * sy]);
}

/** Zooms about a point of the frame, so what is under the pointer stays under it. */
export function zoomAt(view: View, image: Size, zoom: number, focus: { x: number; y: number }): View {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const ratio = next / view.zoom;
  // The picture's centre moves away from (or towards) the focus by the same ratio as the zoom.
  const centreX = FRAME_WIDTH / 2 + view.panX;
  const centreY = FRAME_HEIGHT / 2 + view.panY;
  return clampView({ zoom: next, panX: focus.x - (focus.x - centreX) * ratio - FRAME_WIDTH / 2, panY: focus.y - (focus.y - centreY) * ratio - FRAME_HEIGHT / 2 }, image);
}
