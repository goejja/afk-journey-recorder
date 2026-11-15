import { useState, useSyncExternalStore } from 'react';
import { urlOf } from '../src/shared/contract.js';
import { imagesContract } from '../src/shared/contracts/images.js';

export type ImageKind = 'hero' | 'enemy' | 'phantimal' | 'boss' | 'artifact';

// Bumped after an upload or removal so every portrait on screen asks the server again.
let version = 0;
const listeners = new Set<() => void>();
export function bumpImageVersion() {
  version += 1;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const useImageVersion = () => useSyncExternalStore(subscribe, () => version);

const portraitUrl = (kind: ImageKind, name: string, v = version) => urlOf(imagesContract.portrait, { params: { kind, name }, query: { v: String(v) } });

const PLACEHOLDERS: Record<ImageKind, { color: string; glyph: string }> = {
  // head and shoulders
  hero: { color: '#4b6fd1', glyph: 'M24 10a7 7 0 1 1 0 14 7 7 0 0 1 0-14ZM10 40c0-8 6-13 14-13s14 5 14 13Z' },
  // horned head
  enemy: { color: '#b4503f', glyph: 'M12 10l6 8h12l6-8v14c0 8-5 14-12 14S12 32 12 24Zm8 14a2 2 0 1 0 0 .1ZM28 24a2 2 0 1 0 0 .1Z' },
  // wisp
  phantimal: { color: '#7d5fc4', glyph: 'M24 8c-8 0-13 6-13 14v18l5-4 4 4 4-4 4 4 4-4 5 4V22c0-8-5-14-13-14Z' },
  // gem
  artifact: { color: '#2f9e8f', glyph: 'M24 6l14 12-14 24L10 18Z' },
  // crown
  boss: { color: '#b8892e', glyph: 'M8 34V14l8 8 8-12 8 12 8-8v20Z' },
};

/** Up to two letters that tell generic icons apart: "Crystal Beetle" gives CB, "Grunt" gives GR. */
export function initials(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

/** A unit's portrait, or a generic silhouette for its kind when no image exists. `title` is the tooltip on hover, the name by default. */
export function Portrait({ kind, name, size = 48, title = name }: { kind: ImageKind; name: string; size?: number; title?: string }) {
  const v = useImageVersion();
  const key = `${kind}/${name}/${v}`;
  const [failedKey, setFailedKey] = useState('');
  if (failedKey !== key) {
    return (
      <img
        className="portrait"
        style={{ width: size, height: size }}
        src={portraitUrl(kind, name, v)}
        alt=""
        title={title}
        loading="lazy"
        onError={() => setFailedKey(key)}
      />
    );
  }
  const { color, glyph } = PLACEHOLDERS[kind];
  return (
    <svg className="portrait" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={`${name} (no image)`}>
      <title>{title}</title>
      <circle cx="24" cy="24" r="24" fill={color} opacity="0.35" />
      {kind === 'enemy' ? (
        <text x="24" y="31" textAnchor="middle" fontSize="20" fontWeight="700" fill={color}>
          {initials(name)}
        </text>
      ) : (
        <path d={glyph} fill={color} />
      )}
    </svg>
  );
}
