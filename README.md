# AFK Journey Recorder

A local-only tool for recording attempts in AFK Journey (Stages, Stages Apex, Dream Hunt, Arena, Supreme Arena, Super League, Guild Duel, Treasure Rush) and reading statistics back from them. It runs on `127.0.0.1` and stores everything in a local SQLite file.

This edition has no Advisor: it records, imports and counts. It does not estimate a chance or propose a team. See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the project is laid out and where the Advisor would plug in.

## Development

```
npm install
npm run import:reference   # one-time: heroes, bosses, maps, artifacts, enemies (cached afterwards)
npm run dev                # API on http://127.0.0.1:3000, UI on http://127.0.0.1:5173
npm test
```

For a single-process run, `npm run build` then `npm start` and open http://127.0.0.1:3000.

Ask questions of your history with the read-only query CLI: `npm run query -- help`. The database layout is `src/db/schema.sql` plus the numbered migrations in `src/db/migrations/`. [AGENTS.md](./AGENTS.md) tells a coding agent how to read the history safely.

The Run estimate button on a scenario starts the agent chosen in Admin (Agent tab) in the background, as a read-only process in this directory (`claude -p` or `opencode run --standalone`), and saves its reply. The tool must be installed and logged in; Admin finds it on the PATH, shows its version, and lists the models you can pick. The agent follows the instructions in `AGENTS.md`, which in this edition cover only the read-only commands.

`npm run import:artifact-images` downloads the artifact icons from [AFK Global](https://www.afk.global/afk-journey/artifacts) (30 files, rate limited and cached). The wiki's image server and some other sites refuse downloads, so any icon that is still missing can be uploaded in Admin → Images, one by one or with "Upload several images", which matches files to units by file name (for example `Bladestorm.png`).

In Admin → Images, "Crop and frame" turns any picture into a hexagonal, framed portrait like the imported ones: drag to move it, scroll or use the slider to zoom, and it is saved as a PNG.

## Credits and legal

AFK Journey, its heroes, bosses, enemies, artifacts and all related art belong to Lilith Games. This is an unofficial, personal, non-commercial tool and is not affiliated with or endorsed by Lilith Games.

Reference data (names, classes, factions, maps, ranks, artifacts) is imported for personal use from fan resources: [Yaphalla](https://www.yaphalla.com) and the [AFK Journey Fandom wiki](https://afk-journey.fandom.com); artifact icons come from [AFK Global](https://www.afk.global).

If you want to see what shared game data across many players can show, [Stargazer](https://github.com/tmdict/stargazer) by tmdict is an interesting open project and worth a look. This repository does not use or contain its data.

Downloaded images and the generated database are git-ignored and are not distributed with this repository.
