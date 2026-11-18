import { rankAbbreviation, rankLook } from '../src/domain/rank-colour.js';

/**
 * A hero's rank as text in the game's colour for it. A "+" rank keeps its name in its own colour and draws the "+" in the next
 * rank's colour, as the game tints the corners of its tile. `short` writes the rank's two-letter name, for a small label.
 */
export function RankText({ rank, short = false }: { rank: string | null; short?: boolean }) {
  const look = rank ? rankLook(rank) : null;
  const name = rank !== null && look?.corner ? rank.slice(0, -1) : rank;
  const content =
    rank === null ? (
      'Not set'
    ) : look ? (
      <>
        <span className={`rank-colour rank-colour-${look.fill}`}>{short && name ? rankAbbreviation(name) : name}</span>
        {look.corner && <span className={`rank-colour rank-colour-${look.corner}`}>+</span>}
      </>
    ) : (
      rank
    );
  return <span className="rank-text">{content}</span>;
}
