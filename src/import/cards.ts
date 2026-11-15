export interface Card {
  name: string;
  imagePath: string;
  tier: 'R' | 'A' | 'S' | null;
  class: string | null;
  faction: string | null;
  damageType: 'Physical' | 'Magic' | null;
}

const CARD = /<a [^>]*href="\/(?:heroes|bosses)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const ICON = /\/assets\/images\/(tier|class|factions|damage)\/([\w-]+)\.png/g;
// The site serves portraits from its own path or, as now, from an image host with the same path after its prefix.
const PORTRAIT = /src="[^"]*?(\/assets\/images\/hexes\/(?:unit|boss)\/[^"]+\.png)"/;

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex, dec, named) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[named] ?? whole),
  );
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Parses the hero or boss list page. Names come from the link, which is URL-encoded and entity-free. */
export function parseCards(html: string): Card[] {
  const cards: Card[] = [];
  for (const [, slug, body] of html.matchAll(CARD)) {
    const rawPortrait = PORTRAIT.exec(body!)?.[1];
    if (!rawPortrait) continue;
    const portrait = decodeEntities(rawPortrait);
    const icons: Record<string, string> = {};
    for (const [, kind, value] of body!.matchAll(ICON)) icons[kind!] = value!;
    const tier = icons['tier']?.toUpperCase();
    cards.push({
      name: decodeURIComponent(decodeEntities(slug!)),
      imagePath: portrait,
      tier: tier === 'R' || tier === 'A' || tier === 'S' ? tier : null,
      class: icons['class'] ? capitalize(icons['class']) : null,
      faction: icons['factions'] ? capitalize(icons['factions']) : null,
      damageType: icons['damage'] === 'physical' ? 'Physical' : icons['damage'] === 'magic' ? 'Magic' : null,
    });
  }
  return cards;
}
