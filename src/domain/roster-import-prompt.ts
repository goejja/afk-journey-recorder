import type { ImportScreen } from './roster-import.js';

/** The text the Agent is given to read a picture of the game: what the screen is, which files hold what, and the JSON to answer with. Pure text, so it can be tested without a server. */

/** The crops of the artifact and phantimal of one side of a report, and the sheets of what they may show. */
export interface ExtraFiles {
  artifactSheets: string[];
  phantimalSheets: string[];
  phantimalNames: string[];
  /** `artifact` is null for a side whose artifact the local reader named. */
  sides: { player: number; artifact: string | null; phantimal: string }[];
  /** Whether any side's artifact is left to the Agent. */
  artifacts: boolean;
}

const extrasPrompt = (extras: ExtraFiles) => `Each side of the report also ${extras.artifacts ? "has an artifact, shown as a round icon, beside the player's name, and also " : ''}may have a phantimal, a round tile (not a hero) under the side's five heroes, cut off by the end of the panel. ${extras.artifacts ? `Reference artifacts, with their names under them, are on these contact sheets: ${extras.artifactSheets.join(', ') || '(none)'}. ` : ''}${extras.phantimalSheets.length > 0 ? `Reference phantimals are on these contact sheets: ${extras.phantimalSheets.join(', ')}.` : 'There are no phantimal pictures: name a phantimal only when you are sure of it from its shape and colours.'} The phantimals are: ${extras.phantimalNames.join(', ')}. For each side give ${extras.artifacts ? `"artifact": {"name": the artifact's name from the sheets or null, "level": the number after the "+" or null} (only for a side whose artifact crop is given) and ` : ''}"phantimal": the phantimal's name from that list, or null when there is none under the heroes or you cannot tell. Never guess a name you are not sure of.
${extras.artifacts ? 'Artifact and phantimal' : 'Phantimal'} crops, per player:
${extras.sides.map((s) => `- player ${s.player + 1}: ${s.artifact ? `artifact ${s.artifact}, ` : ''}phantimal ${s.phantimal}`).join('\n')}`;

const likelyPrompt = (likely: { strips: string[]; heroes: string[] }) => `The tiles of ${likely.strips.map((id) => `"${id}"`).join(', ')} are most likely heroes the viewer owns: ${likely.heroes.join(', ')}. When a tile could be one of these and also another hero, name the one on this list; when a tile clearly is another hero, name that one.`;

export const promptFor = (screen: ImportScreen, files: { sheets: string[]; name: string | null; strips: { id: string; file: string; count: number; player: number }[]; /** How many players the picture has, whether or not they have a strip. */ players: number; /** How many strips are not given because they were read locally. */ skipped: number; /** Whether a strip holds only some of its tiles. */ partial?: boolean; ranks: string[]; extras?: ExtraFiles; likely?: { strips: string[]; heroes: string[] } }) => {
  const reading = files.strips.length > 0;
  const layout =
    screen === 'info'
      ? 'The screen is Player Info ("My Formations"): one player, 1 to 5 teams of up to 5 heroes (3 before the first Super League round, 5 after it). A team with fewer than 5 heroes ends with a flat empty slot: say it is empty.'
      : screen === 'battle'
        ? 'The screen is a battle result: two players, the ally (left name, first strip) and the enemy (right name, second strip). Each strip holds one side\'s 5 heroes from top to bottom.'
        : screen === 'report'
          ? 'The screen is the battle report of a PvP game: two players, the ally (left name, first strip) and the enemy (right name, second strip). Each strip holds one side\'s 5 heroes from top to bottom. The names image has two parts: the header (each side\'s title with a number in brackets, its Union Level, and the name), then the row of tabs, one per fight, each with a tick or a cross; the highlighted tab is this fight\'s. A tick or cross in orange is the ally\'s result of that fight (orange tick: the ally won; blue cross: the enemy won). Without tabs, read the big Victory/Defeat banner as the ally\'s result. Reply also with "fight": {"number": the highlighted tab\'s number or null, "ally": "won" | "lost" | null, "unionLevelAlly": the number in brackets by the ally\'s title or null, "unionLevelEnemy": the same for the enemy or null}.'
        : screen === 'recap'
          ? 'The screen is the Treasure Rush Daily Battle Recap: player 1 is the ally, whose team is the same in every battle and is given once ("ally"); each other player is the opponent of one battle ("enemy1" is the first battle from the top, and so on). The names image has one header per battle from the top, the ally\'s name on its left and the opponent\'s on its right: player 1\'s name is the left name of the first header, and player N+1\'s is the right name of header N.'
          : screen === 'suggestion'
            ? 'The screen is the Treasure Rush Other Players\' Suggestion list: each player is another player who shared teams of 5 heroes ("team1", "team2", ...). The names image has one header per player, top to bottom, in the order of the players below. A tile with "Not Owned" written above it is still a hero of that player: name it as any other and set "notOwned" to true.'
            : 'The screen is the Resonating Hall list of the player\'s own heroes: the Hands of Resonance first, then rows of 6; the name of the player is not shown (use null).';
  return `You read enlarged crops of hero tiles from a screenshot of the game AFK Journey. ${layout}
${reading ? `Each strip image holds tiles side by side (left to right is the order of the tiles). Reference portraits of every known hero, with their names under them, are on these contact sheets: ${files.sheets.join(', ')}. Read every sheet first. The tile art is the same artwork as the portrait, cropped to a rectangle. Some sheet cells are labelled "Name (skin)": they are alternate skins already seen. A hero can have an alternate skin that is not on a sheet: then set hero to null and give your best 1 to 3 candidates (names from the sheets).
Give each hero's rank, which the tile's frame and background colour show: one of ${files.ranks.join(', ')}. Heroes without stars on the tile are below Supreme; tiles with stars are Supreme or above. Do not count stars: the app does that itself. When you cannot tell a tile's exact rank, give your best guess and set "rankSure" to false. When you are not sure of the hero, set "confident" to false. The top of each tile's frame is in the strip.
Below Supreme the frame is rectangular with right angles and the background colour is the rank: purple Elite, yellow Epic, red Legendary, white Mythic. A "+" rank keeps the colour of its rank and has a small tint of the next rank's colour in the bottom left and top right corners (Epic+ is yellow with red in those corners, before Legendary).
From Supreme up the frame is read from its shape: Supreme has a rectangular frame with a flat top edge; Supreme+ has a small bump at each top corner and nothing standing out at the top centre; Paragon 1 has a purple triangle at the top centre, pointing up and attached to the frame (a shape pointing down belongs to the tile above); Paragon 2 has a yellow fork of three prongs at the top centre and a yellow triangle at the bottom; Paragon 3 has a red fork at the top centre (the player believes four prongs, not confirmed); Paragon 4 has a rainbow fork shaped like a crown at the top centre. A frame with something standing out at the top centre is a Paragon rank, and one with nothing there is Supreme or Supreme+: look at the top centre before the corners.` : 'The hero tiles of this picture are already read: do not reply with any tile.'}
${files.skipped > 0 && reading ? 'Some strips are not given because they are already read: for a player without a strip reply with an empty "crops" object.' : ''}
${files.partial && reading ? 'Some strips hold only some of their tiles, the others being already read: read the tiles in the strip, one entry for each, left to right.' : ''}
${files.likely ? likelyPrompt(files.likely) : ''}
${files.extras ? extrasPrompt(files.extras) : ''}
${files.name ? `The player names are on this image: ${files.name}. Copy each name exactly as written, keeping Cyrillic and other alphabets.` : ''}
${reading ? `Strips:
${files.strips.map((s) => `- player ${s.player + 1}, "${s.id}" (${s.count} ${s.count === 1 ? 'tile' : 'tiles'}): ${s.file}`).join('\n')}
` : ''}Reply with one JSON object only, no prose, ${screen === 'report' ? 'with "fight" as said above and ' : ''}with one entry in "players" for each of the ${files.players} player(s) in the order above${reading ? ", and in each player's \"crops\" one list per strip id with exactly one entry per tile in order, even for a tile you cannot read" : ' (each with an empty "crops" object)'}: {"players": [{"name": "...", ${files.extras?.artifacts ? '"artifact": {"name": "Name" | null}, ' : ''}${files.extras ? '"phantimal": "Name" | null, ' : ''}"crops": ${reading ? `{"${files.strips[0]!.id}": [{"hero": "Name" | null, "candidates": [], "rank": "...", "confident": true, "rankSure": true, "notOwned": false}]}` : '{}'}}]}. Do not use any tool except Read.`;
};
