import type { ReactNode } from 'react';
import { Portrait } from './Portrait.js';

/**
 * A team as its artifact then its heroes (then its Phantimal) in small portraits (a hero on several tiles shows once), with what is known about it under them.
 * `artifactReplaced` is the sentence that says why the artifact is not the usual one: it frames the artifact in the warning colour and is the tooltip and the
 * accessible name of the frame. Without an artifact, the frame holds an empty slot.
 */
export function TeamCell({ artifact, heroes, phantimal = null, artifactReplaced, children }: { artifact: string | null; heroes: string[]; phantimal?: string | null; artifactReplaced?: string; children?: ReactNode }) {
  return (
    <div className="week-team">
      <span className="week-team-units">
        {artifactReplaced ? (
          <span className="artifact-replaced" role="img" aria-label={artifactReplaced} title={artifactReplaced}>
            {artifact ? <Portrait kind="artifact" name={artifact} size={28} title={artifactReplaced} /> : <span className="artifact-empty" />}
          </span>
        ) : (
          artifact && (
            <span title={artifact}>
              <Portrait kind="artifact" name={artifact} size={28} />
            </span>
          )
        )}
        {[...new Set(heroes)].map((hero) => (
          <span key={hero} title={hero}>
            <Portrait kind="hero" name={hero} size={28} />
          </span>
        ))}
        {phantimal && (
          <span title={phantimal}>
            <Portrait kind="phantimal" name={phantimal} size={28} />
          </span>
        )}
      </span>
      {children}
    </div>
  );
}
