import { useState } from 'react';
import { urlOf } from '../src/shared/contract.js';
import { imagesContract } from '../src/shared/contracts/images.js';

type IconKind = 'class' | 'faction';

/** The round game icon of a class or faction (kept in images/icons), or a letter chip when the image is missing, as in the public edition. */
function GameIcon({ kind, name }: { kind: IconKind; name: string }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return (
      <span className="game-icon game-icon-letter" title={name}>
        {name.slice(0, 1)}
      </span>
    );
  }
  return <img className="game-icon" src={urlOf(imagesContract.icon, { params: { kind, name } })} alt="" title={name} loading="lazy" onError={() => setMissing(true)} />;
}

/** The strip beside a hero's portrait: its tier as a coloured letter, then its class and faction icons. */
export function HeroIcons({ tier, heroClass, faction }: { tier: string | null; heroClass: string | null; faction: string | null }) {
  return (
    <span className="hero-icons">
      {tier && (
        <span className={`tier-letter tier-${tier}`} title={`Tier ${tier}`}>
          {tier}
        </span>
      )}
      {heroClass && <GameIcon kind="class" name={heroClass} />}
      {faction && <GameIcon kind="faction" name={faction} />}
    </span>
  );
}
