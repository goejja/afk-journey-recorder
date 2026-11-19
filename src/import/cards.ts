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

/** Names the site writes short: Yaphalla lists Galahad as "Gala", which is not another hero. */
const SITE_NAMES: Record<string, string> = { Gala: 'Galahad' };

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** A link that holds a % which is not an escape keeps its text, so one odd link cannot abort the whole import. */
function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/** Parses the hero or boss list page. Names come from the link, which is URL-encoded and entity-free. */
export function parseCards(html: string): Card[] {
  const cards: Card[] = [];
  for (const [, slug, body] of html.matchAll(CARD)) {
    const rawPortrait = PORTRAIT.exec(body!)?.[1];
    if (!rawPortrait) continue;
    const portrait = decodeEntities(rawPortrait);
    const icons: Record<string, string> = {};
    for (const [, kind, value] of body!.matchAll(ICON)) icons[kind!] = value!;
    const name = decodeSlug(decodeEntities(slug!));
    const tier = icons['tier']?.toUpperCase();
    cards.push({
      name: SITE_NAMES[name] ?? name,
      imagePath: portrait,
      tier: tier === 'R' || tier === 'A' || tier === 'S' ? tier : null,
      class: icons['class'] ? capitalize(icons['class']) : null,
      faction: icons['factions'] ? capitalize(icons['factions']) : null,
      damageType: icons['damage'] === 'physical' ? 'Physical' : icons['damage'] === 'magic' ? 'Magic' : null,
    });
  }
  return cards;
}
