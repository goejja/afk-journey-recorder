import { canonicalHeroName } from '../db/hero-renames.js';

export interface Card {
  name: string;
  imagePath: string;
  /** Where to download the portrait: the image host the page uses, without its resizing steps. Null when the page uses a path on the site itself. */
  imageUrl: string | null;
  tier: 'R' | 'A' | 'S' | null;
  class: string | null;
  faction: string | null;
  damageType: 'Physical' | 'Magic' | null;
}

const CARD = /<a [^>]*href="\/(?:heroes|bosses)\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const ICON = /\/assets\/images\/(tier|class|factions|damage)\/([\w-]+)\.png/g;
// The site serves portraits from its own path or, as now, from an image host with the same path after its prefix.
const PORTRAIT = /src="([^"]*?)(\/assets\/images\/hexes\/(?:unit|boss)\/[^"]+\.png)"/;

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (whole, hex, dec, named) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENTITIES[named] ?? whole),
  );
}

/** Names the site writes short: Yaphalla lists Galahad as "Gala", which is not another hero. */
const SITE_NAMES: Record<string, string> = { Gala: 'Galahad' };

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The host part of a portrait src, without the image host's transformation steps (Cloudinary's `f_webp`, `q_auto:low`), which would
 * turn the original PNG into a low-quality WebP. Null for a src that is only a path on the site.
 */
function imageHost(prefix: string): string | null {
  if (!/^https?:\/\//.test(prefix)) return null;
  const steps = prefix.split('/').filter((step) => step !== '');
  while (steps.length > 2 && /^[a-z]{1,3}_[^/]+$/.test(steps[steps.length - 1]!)) steps.pop();
  return steps.join('/').replace(':/', '://');
}

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
    const match = PORTRAIT.exec(body!);
    if (!match) continue;
    const portrait = decodeEntities(match[2]!);
    const host = imageHost(decodeEntities(match[1]!));
    const icons: Record<string, string> = {};
    for (const [, kind, value] of body!.matchAll(ICON)) icons[kind!] = value!;
    const name = decodeSlug(decodeEntities(slug!));
    const tier = icons['tier']?.toUpperCase();
    cards.push({
      name: canonicalHeroName(SITE_NAMES[name] ?? name),
      imagePath: portrait,
      imageUrl: host ? host + portrait : null,
      tier: tier === 'R' || tier === 'A' || tier === 'S' ? tier : null,
      class: icons['class'] ? capitalize(icons['class']) : null,
      faction: icons['factions'] ? capitalize(icons['factions']) : null,
      damageType: icons['damage'] === 'physical' ? 'Physical' : icons['damage'] === 'magic' ? 'Magic' : null,
    });
  }
  return cards;
}
