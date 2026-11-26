import { describe, expect, it } from 'vitest';
import { parseCards } from '../../src/import/cards.js';

const heroCard = `<a class="x" href="/heroes/Smokey%20%26%20Meerky"><div><img alt="" src="/assets/images/hexes/unit/Smokey &amp; Meerky.png"/>
<h2>Smokey &amp; Meerky</h2><img alt="t" src="/assets/images/tier/s.png"/><img src="/assets/images/class/support.png"/>
<img src="/assets/images/factions/lightbearer.png"/><img src="/assets/images/damage/magic.png"/></div></a>`;
const bossCard = `<a href="/bosses/King%20Croaker"><div><img alt="" src="/assets/images/hexes/boss/King Croaker.png"/>
<h2>King Croaker</h2><img src="/assets/images/class/mage.png"/><img src="/assets/images/damage/magic.png"/></div></a>`;

const apostropheBoss = `<a href="/bosses/Azkarion&#x27;Sol"><img src="/assets/images/hexes/boss/Azkarion&#x27;Sol.png"/>
<img src="/assets/images/class/tank.png"/><img src="/assets/images/damage/physical.png"/></a>`;

const galaCard = `<a href="/heroes/Gala"><img src="/assets/images/hexes/unit/Gala.png"/><img src="/assets/images/tier/s.png"/><img src="/assets/images/class/mage.png"/></a>`;

describe('parseCards', () => {
  it('names Yaphalla\'s "Gala" Galahad but keeps the site\'s image path to download', () => {
    expect(parseCards(galaCard)[0]).toMatchObject({ name: 'Galahad', imagePath: '/assets/images/hexes/unit/Gala.png' });
  });

  it('decodes numeric HTML entities in names and image paths', () => {
    expect(parseCards(apostropheBoss)[0]).toMatchObject({
      name: "Azkarion'Sol",
      imagePath: "/assets/images/hexes/boss/Azkarion'Sol.png",
    });
  });

  it('reads a hero card', () => {
    expect(parseCards(`<main>${heroCard}</main>`)).toEqual([
      {
        name: 'Smokey & Meerky',
        imagePath: '/assets/images/hexes/unit/Smokey & Meerky.png',
        imageUrl: null,
        tier: 'S',
        class: 'Support',
        faction: 'Lightbearer',
        damageType: 'Magic',
      },
    ]);
  });

  it('reads a boss card, which has no tier or faction', () => {
    const [boss] = parseCards(bossCard);
    expect(boss).toMatchObject({ name: 'King Croaker', tier: null, faction: null, class: 'Mage', damageType: 'Magic' });
  });

  it('reads a portrait served from an image host, keeping the site path', () => {
    const card = `<a href="/heroes/Chippy"><img src="https://res.cloudinary.com/x/image/upload//assets/images/hexes/unit/Chippy.png"/>
<img src="/assets/images/tier/r.png"/><img src="/assets/images/class/tank.png"/></a>`;
    expect(parseCards(card)[0]).toMatchObject({ name: 'Chippy', imagePath: '/assets/images/hexes/unit/Chippy.png', tier: 'R', class: 'Tank' });
  });

  it('names a hero the site still spells the old way by its new name', () => {
    const card = `<a href="/heroes/Taichi%26Agumon"><img src="/assets/images/hexes/unit/Taichi&amp;Agumon.png"/><img src="/assets/images/tier/s.png"/></a>`;
    expect(parseCards(card)[0]).toMatchObject({ name: 'Taichi & Agumon', imagePath: '/assets/images/hexes/unit/Taichi&Agumon.png' });
  });

  it('downloads from the image host without its resizing steps, which would give a low-quality WebP', () => {
    const card = `<a href="/heroes/Chippy"><img src="https://res.cloudinary.com/vvib7uec/image/upload/f_webp/q_auto:low/assets/images/hexes/unit/Chippy.png"/>
<img src="/assets/images/tier/r.png"/></a>`;
    expect(parseCards(card)[0]!.imageUrl).toBe('https://res.cloudinary.com/vvib7uec/image/upload/assets/images/hexes/unit/Chippy.png');
  });

  it('has no image URL when the portrait is a path on the site itself', () => {
    expect(parseCards(galaCard)[0]!.imageUrl).toBeNull();
  });

  it('ignores links that are not cards', () => {
    expect(parseCards('<a href="/heroes/Nobody">no portrait</a>')).toEqual([]);
  });

  it('keeps the rest of the list when one link holds a % that is not an escape', () => {
    const broken = `<a href="/heroes/100%25%"><img src="/assets/images/hexes/unit/Broken.png"/><img src="/assets/images/class/mage.png"/></a>`;
    expect(parseCards(broken + heroCard).map((card) => card.name)).toEqual(['100%25%', 'Smokey & Meerky']);
  });
});
