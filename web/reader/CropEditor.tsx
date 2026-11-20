import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampView,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  hexPoints,
  imageRect,
  initialView,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
  type View,
} from '../../src/domain/image-frame.js';
import { Notice } from '../ui/Notice.js';

type Source = CanvasImageSource & { width: number; height: number };

/** Decodes the picked file; replaced in tests. */
const loadImage = (file: File): Promise<Source> => createImageBitmap(file);

const FRAME_COLORS = { top: '#9aa0a8', middle: '#9aa0a8', bottom: '#d9a93a', background: '#1c1f2a' };

/** Draws the picture inside the hexagon with its frame: grey all round, gold along the lower edge. */
function drawFramed(ctx: CanvasRenderingContext2D, image: Source, view: View) {
  const path = (inset: number) => {
    ctx.beginPath();
    hexPoints(inset).forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  };
  ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  ctx.save();
  path(0);
  ctx.clip();
  ctx.fillStyle = FRAME_COLORS.background;
  ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
  const rect = imageRect(view, image);
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();

  const gradient = ctx.createLinearGradient(0, 0, 0, FRAME_HEIGHT);
  gradient.addColorStop(0, FRAME_COLORS.top);
  gradient.addColorStop(0.7, FRAME_COLORS.middle);
  gradient.addColorStop(1, FRAME_COLORS.bottom);
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = gradient;
  path(5);
  ctx.stroke();
}

interface Props {
  file: File;
  /** The unit the picture is for, which names the saved file. */
  name: string;
  onSave: (file: File) => void;
  onCancel: () => void;
  /** Decodes the file into an image; the browser's by default. */
  load?: (file: File) => Promise<Source>;
}

/** Crops a picked picture into the hexagonal, framed style of the imported portraits: drag to move, scroll or slide to zoom. */
export function CropEditor({ file, name, onSave, onCancel, load = loadImage }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [image, setImage] = useState<Source | null>(null);
  const [view, setView] = useState<View>(initialView());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load(file).then(
      (loaded) => !cancelled && (setImage(loaded), setView(initialView())),
      () => !cancelled && setError('This file could not be read as an image'),
    );
    return () => {
      cancelled = true;
    };
  }, [file, load]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx && image) drawFramed(ctx, image, view);
  }, [image, view]);

  /** A pointer position in frame pixels, whatever size the canvas is shown at. */
  const toFrame = useCallback((clientX: number, clientY: number) => {
    const box = canvas.current!.getBoundingClientRect();
    const sx = box.width ? FRAME_WIDTH / box.width : 1;
    const sy = box.height ? FRAME_HEIGHT / box.height : 1;
    return { x: (clientX - box.left) * sx, y: (clientY - box.top) * sy };
  }, []);

  // The wheel listener is added by hand because React's is passive and could not stop the page scrolling.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !image) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const focus = toFrame(event.clientX, event.clientY);
      setView((v) => zoomAt(v, image, v.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), focus));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [image, toFrame]);

  function save() {
    canvas.current?.toBlob((blob) => {
      if (!blob) return setError('The picture could not be saved');
      onSave(new File([blob], `${name}.png`, { type: 'image/png' }));
    }, 'image/png');
  }

  return (
    <div className="crop-editor" role="dialog" aria-label={`Crop and frame image for ${name}`}>
      <h3>Crop and frame: {name}</h3>
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <canvas
        ref={canvas}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        className="crop-canvas"
        aria-label="Portrait preview"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = toFrame(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!drag.current || !image) return;
          const at = toFrame(e.clientX, e.clientY);
          const dx = at.x - drag.current.x;
          const dy = at.y - drag.current.y;
          drag.current = at;
          setView((v) => clampView({ ...v, panX: v.panX + dx, panY: v.panY + dy }, image));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      />
      <label className="field">
        Zoom
        <input
          type="range"
          aria-label="Zoom"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={0.05}
          value={view.zoom}
          disabled={!image}
          onChange={(e) => image && setView((v) => zoomAt(v, image, Number(e.target.value), { x: FRAME_WIDTH / 2, y: FRAME_HEIGHT / 2 }))}
        />
      </label>
      <p className="muted">Drag to move the picture, scroll or use the slider to zoom. The hexagon and its frame are added for you.</p>
      <div className="actions">
        <button className="primary" onClick={save} disabled={!image}>
          Save image
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
