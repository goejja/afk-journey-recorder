import { rankLook } from '../src/domain/rank-colour.js';

/**
 * A hero's rank as text in the game's colour for it. A "+" rank keeps its name in its own colour and draws the "+" in the next
 * rank's colour, as the game tints the corners of its tile.
 */
export function RankText({ rank }: { rank: string | null }) {
  const look = rank ? rankLook(rank) : null;
  const content =
    rank === null ? (
      'Not set'
    ) : look ? (
      <>
        <span className={`rank-colour rank-colour-${look.fill}`}>{look.corner ? rank.slice(0, -1) : rank}</span>
        {look.corner && <span className={`rank-colour rank-colour-${look.corner}`}>+</span>}
      </>
    ) : (
      rank
    );
  return <span className="rank-text">{content}</span>;
}
