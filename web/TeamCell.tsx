import type { ReactNode } from 'react';
import { Portrait } from './Portrait.js';

/** A team as its artifact then its heroes in small portraits (a hero on several tiles shows once), with what is known about it under them. */
export function TeamCell({ artifact, heroes, children }: { artifact: string | null; heroes: string[]; children?: ReactNode }) {
  return (
    <div className="week-team">
      <span className="week-team-units">
        {artifact && (
          <span title={artifact}>
            <Portrait kind="artifact" name={artifact} size={28} />
          </span>
        )}
        {[...new Set(heroes)].map((hero) => (
          <span key={hero} title={hero}>
            <Portrait kind="hero" name={hero} size={28} />
          </span>
        ))}
      </span>
      {children}
    </div>
  );
}
