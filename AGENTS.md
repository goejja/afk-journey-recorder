# AFK Journey Recorder

A local tool that records the owner's AFK Journey battles (Stages, Stages Apex, Dream Hunt, Arena, Supreme Arena, Super League, Guild Duel, Treasure Rush) in SQLite, so that past results can be read back as statistics.

This build has no Advisor: the Win Score, the Generated formation, the Counter Advisor and the Dream Hunt plans are not part of it. The statistics and the recording tools are.

## Reading the data

Use the read-only query CLI, never raw writes:

```
npm run query -- help                          # every command with its options
npm run query -- summary                       # what history exists, per mode and tag
npm run query -- roster [--profile NAME]       # the heroes a profile can field
npm run query -- profiles
npm run query -- hero-stats --mode Arena --min 5
npm run query -- pair-stats --min 3
npm run query -- trio-stats --min 3
npm run query -- artifact-stats --min 3
npm run query -- formation-stats --min 2
npm run query -- formation-groups --min 3
npm run query -- formation-report [--hero H ...]
npm run query -- formation-profile --core "A,B,C"
npm run query -- hero-rows --name HERO
npm run query -- hero-distribution --name HERO [--mode M]
npm run query -- player-stats [--mode M] [--min N]
npm run query -- stage --season 8 --kind Normal --number 1
npm run query -- dream-hunt --boss "King Croaker"
npm run query -- scenarios
npm run query -- scenario --id N
npm run query -- sql "SELECT ..."              # one read-only SELECT
```

- A count of past records is not a simulation. Say how many records support a number, and call a small sample small: fewer than about 5 comparable battles is anecdote.
- Tags belong to the whole record, so `--tag` keeps the records that carry it and counts both sides; to count one player's sides use `--player`.

## Working on the code

- TypeScript throughout: Hono API in `src/server`, SQLite via `better-sqlite3` in `src/db`, React + Vite in `web`, pure rules in `src/domain`, read-only questions in `src/query`.
- `src/server` and `web` are grouped by feature. Tests sit in the folder of what they test.
- A new API route is described first in `src/shared/contracts/` with `endpoint()` and registered with `serve()` (see ARCHITECTURE.md, "The API contract"); the web app calls it with `call()` in `web/backend.ts`. Do not add a bare `app.get('/api/...')`.
- `npm run typecheck`, `npm run lint` and `npm test` must pass. Tests build an in-memory database with `openDb(':memory:')` and exercise the API with `app.request()`.
- Paths are relative to the folder the server is started from (`npm run` in the project folder): `data/afk.db` (`AFK_DB` to change), `images`, and the import work folder `tmp/roster-import` (`AFK_IMPORT_DIR` to change).
- The server binds to `127.0.0.1` only; keep it that way.
- Never run code downloaded by the importers; they parse it statically.
- Images and the database are git-ignored. Do not commit them.
