# Architecture

AFK Journey Recorder is a local web app. A Hono API and a SQLite file run on your machine (`127.0.0.1` only), a React app talks to the API, and a read-only command line reads the same database. Nothing leaves the machine except the downloads of the reference-data importers and, when you start it, the agent tool you chose.

```
 pictures, forms ──▶ web (React) ──▶ src/server (Hono API) ──▶ SQLite (data/afk.db)
                                         │   ▲                       ▲
                                         │   └── src/domain (pure rules, no I/O)
                                         ▼                           │
                              agent tool (read-only child)    src/query ◀── scripts/query.ts (CLI)
```

## Layers

| Folder | What it holds | May import |
|---|---|---|
| `src/domain` | Pure rules and types: maps and tiles, layouts and deployments, units (a hero's parts and summons), formation checks, statistics maths, name matching. No database, no HTTP. | itself, `zod` |
| `src/db` | `schema.sql` (the baseline), `views.sql`, one numbered file per migration in `migrations/`, and small queries on the stored data. | `src/domain` |
| `src/import` | Importers of reference data (heroes, bosses, maps, artifacts) and the storing of pictures. | `src/domain`, `src/vision` |
| `src/vision` | Local readers of a picture's tiles: which hero, which rank, how many stars. | `src/domain` |
| `src/query` | Read-only questions of the history, grouped by topic (filters, hero statistics, formations, players, stages, scenarios). | `src/db`, `src/domain`, `src/shared` |
| `src/server` | The HTTP API, grouped by feature: `records` (battles and fights), `reference` (heroes, maps, seasons, profiles), `reader` (picture import and what the readers learnt), `review`, `stats`, `agent`. | all of the above |
| `src/shared` | The types the API and the web app both use. | `src/domain` |
| `web` | The React app, grouped by feature: `arena`, `dream-hunt`, `stages`, `reader`, `stats`, `admin`, `scenarios`. | `src/domain`, `src/shared` |
| `scripts` | Commands run with `npm run`: database setup, importers, the query CLI. | everything |

The rule that keeps this simple: `src/domain` imports nothing from the other folders, so its rules can be tested without a server or a database, and `src/import` never reaches into `src/server`.

## The database

SQLite through `better-sqlite3`, one file (`data/afk.db`, or `AFK_DB`). `schema.sql` is the version 1 baseline and is never edited to change a table. A change is a new numbered file in `src/db/migrations/`, which takes the file from version n to n + 1 inside a transaction. A file of an older version is copied to `<file>.before-v<n>` before it is migrated. The query CLI opens the file read-only and never migrates.

A Dream Hunt or PvP record keeps a snapshot of each hero's rank and equipment on the day, so a record never changes when the roster does. The roster is the current state; recorded ranks are history. A Stage record keeps no hero state (ADR 0041), because it is often entered days after the clear.

## Reading pictures

A screenshot of the game can fill in a form. Two readers take part:

1. The local readers in `src/vision` name the heroes and ranks they are sure of. They learn from pictures the player confirmed.
2. For everything else the agent (a command line tool such as `claude -p` or `opencode run --standalone`, chosen in Admin) is started as a read-only child process, reads the picture and prints a proposal.

An import only fills the form. The player reviews it, and a record is saved only when the player saves it. The agent never writes to the database.

## The API contract

Every route is described once, in `src/shared/contracts/<topic>.ts`, with `endpoint({ method, path, body, response, ... })` (`src/shared/contract.ts`). The description holds the HTTP method, the path with its `:params`, a zod schema for the body and one for the response, and the status.

- The server registers a route with `serve(app, route, handler)` (`src/server/contract.ts`). The handler gets the decoded path parameters and the validated body, and returns the response value, `fail(status, message)` for an error, or `created(value)` to answer 201. A body the schema refuses answers 400 with the schema's message before the handler runs. Outside production the value a handler returns is checked against the response schema too, and a mismatch answers 500, so a test that calls the route fails.
- The web app calls a route with `call(route, { params, query, body })` in `web/backend.ts`, which is typed from the same description, so a change to a body or a response is a compile error on both sides. The types the screens use are exported from `src/shared/api.ts`.
- Some bodies and large responses are described with `z.custom<Type>()`: they are typed but not checked at runtime, and the handler keeps validating a body field by field to keep its messages. Query parameters are typed for the client but the handler reads them itself. Files use `Upload` (a raw body the handler reads) and `Binary` (a response sent with `file(bytes, type)`).
- The Advisor's routes are described in `src/advisor/shared/contracts.ts` and called from `web/advisor/api.ts`, so a build without the Advisor has neither.

## Shared UI and background work

The web app builds its Pages from shared pieces: `web/ui/` (components such as `Tabs`, `Dialog`, `Notice`, `Icon`, `Toast`), `web/hooks/` (`useLoad`, `useAction`, `useConfirmActions`), `web/records/` (the shared record lists of Arena and Dream Hunt) and `web/jobs/` (the job watcher). [docs/ui-conventions.md](./docs/ui-conventions.md) says when to use each and lists them.

The Events page (`web/events/`) has one tab for each game event; its Titan Reaver tab (`web/events/titan-reaver/`) holds the views of the event: This event (`ThisEvent.tsx`, the best runs of each Titan Reaver Phase, grouped in the browser by `groupBattles` in `src/domain/titan-reaver.ts` as Dream Hunt groups its days) Best teams (`BestTeams.tsx`, the teams against each boss at one team level, ranked by `bestTeams` in the same domain file) and Records, built from the same pieces as Dream Hunt (`RecordShell`, `FormationEditor`, `FormationIdField`, `useRecordList`). Its records are separate from the attempts (`src/server/records/titan-reaver.ts`, routes under `/api/titan-reaver/battles`).

A page address can name a record: `#stages?record=12`, `#dreamHunt?record=12` or `#arena?record=12` opens that record's edit form (the Stages page keeps the rest of its state in the same query, `web/stages/page-state.ts`). `recordLink` in `src/domain/record-link.ts` makes the address from a record's mode (Stage to Stages, Dream Hunt to Dream Hunt, every other mode to PvP), and `useLinkedRecord` in `web/records/linked-record.ts` reads it once when the page opens, asks for that one record by its id (`GET /api/attempts/:id`, `/api/dream-hunt/attempts/:id` or `/api/pvp/fights/:id`, so its age does not matter) and takes `record` out of the address when the form closes. The Phantimal check and the Reader review link their records this way.

Background work has one answer: `GET /api/jobs` (`src/server/agent/job-registry.ts`). Each kind of work (scenario runs, the Review explanation, the two picture queues, the syncs of Admin > Sync) registers in a `JobRegistry`, and the Agent is started in the background only through `startAgentJob` (`src/server/agent/agent-job.ts`). The same summary is pushed as Server-Sent Events from `GET /api/jobs/stream` whenever it changes (ADR 0042). The web app listens in one place, `JobsProvider`, and Pages read from it.

## The Advisor

Everything that estimates a chance or proposes a team (the Win Score, the Known formations of the Advisor tab, the Counter Advisor, the Dream Hunt plans and the Titan Reaver plans) is the Advisor. It lives in three directories:

- `src/advisor`: the queries, rules, routes and CLI commands;
- `web/advisor`: the screens;
- `tests/advisor`: its tests.

The rest of the app reaches it only through two entry modules, `src/advisor/index.ts` (routes, CLI commands, tier check) and `web/advisor/index.tsx` (the screens). All its routes are under `/api/advisor`. A build may replace those two files with stand-ins that have the same names and do nothing: the statistics, recording and import tools do not depend on the Advisor, and the app runs without it, showing a note where an Advisor screen would be. Never import a file behind an entry module from outside these directories.

## Running it

- `npm run dev`: the API on port 3000 and the Vite dev server on 5173.
- `npm run build`, then `npm start`: one process on port 3000 that also serves `web/dist` and `images/`.
- `npm run query -- help`: the read-only command line.

## Tests

`npm test` runs Vitest. Server tests build an in-memory database with `openDb(':memory:')` and call the API with `app.request()`. Web tests render the components with Testing Library and a mocked `fetch`. Tests sit in the folder of what they test. `npm run typecheck` and `npm run lint` must pass as well.

## Decisions

Design decisions were recorded as numbered notes (ADRs) in the project this edition comes from; comments in the code cite them as "ADR 0036" and so on. They are not part of this edition, so read such a comment as a pointer, not as something you can look up here.
