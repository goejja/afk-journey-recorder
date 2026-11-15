-- Reference data. `source` is 'import' for scraped rows and 'manual' for rows
-- added or edited by the player; importers never overwrite 'manual' rows.

CREATE TABLE IF NOT EXISTS hero (
  name        TEXT PRIMARY KEY,
  tier        TEXT CHECK (tier IN ('R', 'A', 'S')),
  class       TEXT,
  faction     TEXT,
  damage_type TEXT CHECK (damage_type IN ('Physical', 'Magic')),
  image_path  TEXT,
  source      TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS boss (
  name        TEXT PRIMARY KEY,
  class       TEXT,
  damage_type TEXT CHECK (damage_type IN ('Physical', 'Magic')),
  image_path  TEXT,
  source      TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS artifact (
  name       TEXT PRIMARY KEY,
  grp        TEXT NOT NULL,            -- 'Pre-Season', 'Season 7', ...
  image_path TEXT,                     -- NULL until artifact images are imported or uploaded
  source     TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS rank (
  name       TEXT PRIMARY KEY,
  position   INTEGER NOT NULL UNIQUE,  -- 0 is the lowest rank
  source     TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS equipment_level (
  level      INTEGER PRIMARY KEY,      -- 0, 5, ..., 45
  source     TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

-- Missing row = no cap. min_level/max_level NULL = unbounded on that side.
CREATE TABLE IF NOT EXISTS rank_equipment_cap (
  rank       TEXT PRIMARY KEY REFERENCES rank (name),
  min_level  INTEGER,
  max_level  INTEGER,
  source     TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

-- A hex battlefield shared by every mode. `cells` lists tile types row by row; `row_lengths`
-- gives the tiles per row. Tile types (from the editor's own palette): 0 open, 1 player
-- deployment, -1 enemy deployment, -2 wood wall (breakable), -3 stone wall (unbreakable).
-- `original_cells` keeps the imported version so an edited import can be restored.
CREATE TABLE IF NOT EXISTS map (
  name           TEXT PRIMARY KEY,
  tags           TEXT NOT NULL DEFAULT '[]',  -- JSON array of 'Arena' / 'Stage'
  row_lengths    TEXT NOT NULL,               -- JSON array, for example [2,5,6,6,7,6,6,5,2]
  cells          TEXT NOT NULL,               -- JSON array of tile types
  original_cells TEXT,                        -- JSON array, NULL for maps the player created
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS enemy (
  name       TEXT PRIMARY KEY,
  category   TEXT NOT NULL CHECK (category IN ('Common', 'Elite', 'Boss')),
  class       TEXT,
  faction     TEXT,
  damage_type TEXT CHECK (damage_type IN ('Physical', 'Magic')),
  image_path  TEXT,
  source      TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual'))
);

-- A named roster belonging to one player: the owner, or someone whose matches are recorded. Exactly one profile is
-- the default, which the app reads wherever it needs "the roster". A side of a PvP record given a profile stores the
-- profile's player_id, never a link to the profile (ADR 0006).
-- player_id is the player's id in the game, which stays when the player's name changes: optional, and unique among
-- profiles when set.
CREATE TABLE IF NOT EXISTS profile (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  player_id  TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_default_profile ON profile (is_default) WHERE is_default = 1;
CREATE UNIQUE INDEX IF NOT EXISTS profile_one_per_player_id ON profile (player_id COLLATE NOCASE) WHERE player_id IS NOT NULL;

-- A player name as a picture spells it, remembered against the Profile it was resolved to (ADR 0021). `folded` is the spelling with case
-- and look-alike letters ignored, so one spelling resolves to one Profile and a name matched once is not asked about again.
CREATE TABLE IF NOT EXISTS profile_name (
  folded     TEXT PRIMARY KEY,
  profile_id INTEGER NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A profile's current heroes. A row means the hero is owned; NULL rank or equipment_level means not set.
-- Editable current state, not history. profile_id 1 is the profile every database starts with ("Me").
CREATE TABLE IF NOT EXISTS roster (
  hero_name       TEXT NOT NULL REFERENCES hero (name),
  rank            TEXT REFERENCES rank (name),
  equipment_level INTEGER REFERENCES equipment_level (level),
  profile_id      INTEGER NOT NULL DEFAULT 1 REFERENCES profile (id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, hero_name)
);

-- Seasonal special heroes that join the five standard heroes in Phantisomal stages.
-- A phantimal can be available in several seasons (see phantimal_season).
CREATE TABLE IF NOT EXISTS phantimal (
  name    TEXT PRIMARY KEY,
  faction TEXT,
  class   TEXT,
  source  TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('import', 'manual'))
);

CREATE TABLE IF NOT EXISTS phantimal_season (
  phantimal_name TEXT NOT NULL REFERENCES phantimal (name) ON UPDATE CASCADE ON DELETE CASCADE,
  season         INTEGER NOT NULL CHECK (season >= 1),
  PRIMARY KEY (phantimal_name, season)
);

-- Stages. Normal and Phantisomal numbers run on across phases (phase = 0, not applicable);
-- Apex numbers restart in each phase (phase 1 to 3).
CREATE TABLE IF NOT EXISTS stage (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  season    INTEGER NOT NULL CHECK (season >= 1),
  phase     INTEGER NOT NULL CHECK (phase BETWEEN 0 AND 3),
  kind      TEXT NOT NULL CHECK (kind IN ('Normal', 'Phantisomal', 'Apex Normal', 'Apex Phantisomal')),
  number    INTEGER NOT NULL CHECK (number >= 1),
  map_name  TEXT NOT NULL REFERENCES map (name) ON UPDATE CASCADE,
  UNIQUE (season, phase, kind, number)
);

-- The enemy formation of a stage: one unit per tile of the stage's map, either an enemy or a hero.
-- The same enemy or hero may stand on several tiles. `part` (migration 5, ADR 0028) names a Pair Hero's part or a
-- Summon, as in formation_hero; it is '' for a hero standing alone.
CREATE TABLE IF NOT EXISTS stage_enemy (
  stage_id   INTEGER NOT NULL REFERENCES stage (id) ON DELETE CASCADE,
  tile       INTEGER NOT NULL,
  enemy_name TEXT REFERENCES enemy (name) ON UPDATE CASCADE,
  hero_name  TEXT REFERENCES hero (name) ON UPDATE CASCADE,
  PRIMARY KEY (stage_id, tile),
  CHECK ((enemy_name IS NULL) <> (hero_name IS NULL))
);

-- One battle in any mode; mode-specific details live in their own tables.
-- The weekly default of Supreme Arena, Super League, Guild Duel and Dream Hunt: for each team (or fight) the boss, map and rule new
-- records start with. Anything the player has not set is null and keeps the form's own choice.
CREATE TABLE IF NOT EXISTS weekly_default (
  mode       TEXT NOT NULL CHECK (mode IN ('Supreme Arena', 'Super League', 'Guild Duel', 'Dream Hunt')),
  position   INTEGER NOT NULL CHECK (position >= 1),
  boss       TEXT REFERENCES boss (name) ON UPDATE CASCADE ON DELETE SET NULL,
  map_name   TEXT REFERENCES map (name) ON UPDATE CASCADE ON DELETE SET NULL,
  rule       TEXT REFERENCES boss_rule (name) ON UPDATE CASCADE ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mode, position)
);

-- A Battle groups the fights played together, for example the three teams of a Supreme Arena battle. Each fight stays
-- its own attempt; the battle only links them (battle_position is the team's number in it). `formation_id` and
-- `opp_formation_id` name the Formation ID of Side A and of Side B for the teams of the whole battle (ADR 0007); the fights
-- of a battle carry none of their own. Deleting the code clears them.
-- One run of Super League within a Season (Super League is held several times in a Season): the Season, its number
-- within the Season and an optional start date. The Battles of a Tournament carry its Round (ADR 0020).
CREATE TABLE IF NOT EXISTS tournament (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  season     INTEGER NOT NULL CHECK (season >= 1),
  number     INTEGER NOT NULL CHECK (number >= 1),
  start_date TEXT,
  UNIQUE (season, number)
);

-- The teams one Profile fields for a whole Round of a Tournament, confirmed by the player before a mass Battle import (ADR 0020).
-- `team` is the team number (1 to 5); `content` is JSON: `heroes` (tile, hero, part, rank, equipmentLevel), `phantimal`, `artifact`, with
-- tiles as Side A stands. Not a record and not a Formation ID: never counted in statistics.
CREATE TABLE IF NOT EXISTS round_deployment (
  tournament_id INTEGER NOT NULL REFERENCES tournament (id) ON DELETE CASCADE,
  round         TEXT NOT NULL CHECK (round IN ('Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Finals')),
  profile_id    INTEGER NOT NULL REFERENCES profile (id) ON DELETE CASCADE,
  team          INTEGER NOT NULL CHECK (team BETWEEN 1 AND 5),
  content       TEXT NOT NULL,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tournament_id, round, profile_id, team)
);

CREATE TABLE IF NOT EXISTS battle (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mode            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  formation_id    TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE,
  opp_formation_id TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE,
  tournament_id   INTEGER REFERENCES tournament (id) ON DELETE RESTRICT,
  round           TEXT CHECK (round IN ('Group stage', 'Swiss stage', 'Top 48', 'Top 16', 'Finals'))
);

CREATE TABLE IF NOT EXISTS attempt (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  mode            TEXT NOT NULL CHECK (mode IN ('Stage', 'Dream Hunt', 'Arena')),
  outcome         TEXT NOT NULL CHECK (outcome IN ('Win', 'Loss')),
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  battle_id       INTEGER REFERENCES battle (id) ON DELETE SET NULL,
  battle_position INTEGER CHECK (battle_position >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS attempt_one_per_battle_position ON attempt (battle_id, battle_position) WHERE battle_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stage_attempt (
  attempt_id INTEGER PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
  stage_id   INTEGER NOT NULL REFERENCES stage (id),
  buff_level INTEGER CHECK (buff_level >= 0)  -- Apex stages only
);

-- The player's library of Formation IDs: the game's 8-character codes for a Deployment, kept apart from the attempts
-- (ADR 0005, ADR 0007). `deployment` is JSON: `teams`, team 1 first, each null or a Layout (`units`, `phantimal`) with the
-- `artifact` of that team. The maps a code was seen on are context only: plain names, kept even if the map is later removed,
-- and never decide whether a Deployment matches.
CREATE TABLE IF NOT EXISTS formation_id (
  code       TEXT PRIMARY KEY CHECK (length(code) = 8 AND code NOT GLOB '*[^0-9A-Z]*'),
  deployment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS formation_id_map (
  code     TEXT NOT NULL REFERENCES formation_id (code) ON DELETE CASCADE ON UPDATE CASCADE,
  map_name TEXT NOT NULL,
  PRIMARY KEY (code, map_name)
);

-- The player's side of an attempt. Hero rank and equipment are snapshots (see ADR 0001).
-- `formation_id` names the Formation ID the player gave a fight on its own; a fight in a battle has none (see battle).
CREATE TABLE IF NOT EXISTS formation (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id             INTEGER NOT NULL REFERENCES attempt (id) ON DELETE CASCADE,
  artifact               TEXT REFERENCES artifact (name) ON UPDATE CASCADE,
  phantimal_name         TEXT REFERENCES phantimal (name) ON UPDATE CASCADE,
  phantimal_tile         INTEGER,
  phantimal_partner_tile INTEGER,
  assist_hero            TEXT REFERENCES hero (name),
  assist_rank            TEXT,
  assist_equipment_level INTEGER,
  formation_id           TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE
);

-- One row per placed unit. `part` (created as `unit`; migration 3 renames the column, ADR 0028) is '' for a hero standing
-- alone, a part name ('Elijah', 'Lailah') for a hero that stands on two tiles, or a summon's name ('Laser Turret') for a
-- unit a hero brings; hero_name is then the owning hero. A summon has no rank or equipment. Several rows may share a hero
-- (see src/domain/units.ts).
CREATE TABLE IF NOT EXISTS formation_hero (
  formation_id    INTEGER NOT NULL REFERENCES formation (id) ON DELETE CASCADE,
  tile            INTEGER NOT NULL,
  hero_name       TEXT NOT NULL REFERENCES hero (name),
  unit            TEXT NOT NULL DEFAULT '',
  rank            TEXT,
  equipment_level INTEGER,
  PRIMARY KEY (formation_id, tile)
);

-- Editable list of the weekly rules that boost the player in the fifth Dream Hunt fight.
CREATE TABLE IF NOT EXISTS boss_rule (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT ''
);

-- One fight against one Dream Hunt boss. Win means cleared, and then time_seconds is the clear time.
CREATE TABLE IF NOT EXISTS dream_hunt_attempt (
  attempt_id   INTEGER PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
  boss_name    TEXT NOT NULL REFERENCES boss (name) ON UPDATE CASCADE,
  map_name     TEXT NOT NULL REFERENCES map (name) ON UPDATE CASCADE,
  time_seconds REAL CHECK (time_seconds > 0),
  boss_rule    TEXT REFERENCES boss_rule (name) ON UPDATE CASCADE
);

-- One PvP battle, recorded on its own. mode is Arena (1 team), Supreme Arena (3), Super League (5), Guild Duel (3) or Treasure Rush (1, on Arena I only);
-- attempt.outcome is the result and formation is the player's side. The rule (shared with Dream Hunt)
-- only applies in Supreme Arena. union_level and opp_union_level are the two sides' Union Level (Guild Duel only,
-- optional). The opponent's side is stored here and in arena_opponent_hero,
-- where rank, equipment and artifact are optional.
CREATE TABLE IF NOT EXISTS arena_attempt (
  attempt_id             INTEGER PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
  mode                   TEXT NOT NULL CHECK (mode IN ('Arena', 'Supreme Arena', 'Super League', 'Guild Duel', 'Treasure Rush')),
  map_name               TEXT NOT NULL REFERENCES map (name) ON UPDATE CASCADE,
  rule                   TEXT REFERENCES boss_rule (name) ON UPDATE CASCADE,
  opp_artifact           TEXT REFERENCES artifact (name) ON UPDATE CASCADE,
  opp_assist_hero        TEXT REFERENCES hero (name),
  opp_assist_rank        TEXT,
  opp_assist_equipment   INTEGER,
  opp_phantimal          TEXT REFERENCES phantimal (name) ON UPDATE CASCADE,
  opp_phantimal_tile     INTEGER,
  opp_phantimal_partner_tile INTEGER,
  union_level            INTEGER CHECK (union_level >= 0),
  opp_union_level        INTEGER CHECK (opp_union_level >= 0),
  opp_formation_id       TEXT REFERENCES formation_id (code) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Side B's placed units; `part` works as in formation_hero.
CREATE TABLE IF NOT EXISTS arena_opponent_hero (
  attempt_id      INTEGER NOT NULL REFERENCES arena_attempt (attempt_id) ON DELETE CASCADE,
  tile            INTEGER NOT NULL,
  hero_name       TEXT NOT NULL REFERENCES hero (name),
  unit            TEXT NOT NULL DEFAULT '',
  rank            TEXT,
  equipment_level INTEGER,
  PRIMARY KEY (attempt_id, tile)
);

-- The seasons the player works with, and which one is the current one (at most one). Arena and Dream Hunt
-- records have no season of their own and open on the current one.
CREATE TABLE IF NOT EXISTS season (
  number     INTEGER PRIMARY KEY CHECK (number >= 1),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS season_one_current ON season (is_current) WHERE is_current = 1;

-- Free-text labels on an attempt, for example the player a record belongs to. Case-insensitive.
-- side '' labels the whole record; 'A' or 'B' labels one side of an Arena-type battle (the player on that side).
CREATE TABLE IF NOT EXISTS attempt_tag (
  attempt_id INTEGER NOT NULL REFERENCES attempt (id) ON DELETE CASCADE,
  side       TEXT NOT NULL DEFAULT '' CHECK (side IN ('', 'A', 'B')),
  tag        TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (attempt_id, side, tag)
);
CREATE INDEX IF NOT EXISTS attempt_tag_by_tag ON attempt_tag (tag);

-- The Player behind one side of a PvP battle, by the game's own Player ID (ADR 0006). A side with no row has no
-- Player. The ID is kept as typed on the Profile the side was given; the profile table is not referenced, so a
-- deleted Profile leaves the ID on its records.
CREATE TABLE IF NOT EXISTS attempt_player (
  attempt_id INTEGER NOT NULL REFERENCES attempt (id) ON DELETE CASCADE,
  side       TEXT NOT NULL CHECK (side IN ('A', 'B')),
  player_id  TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (attempt_id, side)
);
CREATE INDEX IF NOT EXISTS attempt_player_by_player ON attempt_player (player_id);

-- A planning scenario for the formation-suggestion agent: the enemy teams and the player's candidate
-- teams placed on maps, one slot per team of the mode (1, 3 or 5). Not a record of a fight. The
-- player's heroes are optional; placed ones are the player's choices, and the agent fills the rest.
-- `estimate` is written back by the agent from the recorded history (see AGENTS.md).
CREATE TABLE IF NOT EXISTS scenario (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('Arena', 'Supreme Arena', 'Super League', 'Guild Duel', 'Treasure Rush')),
  note        TEXT,
  estimate    TEXT,
  estimate_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenario_slot (
  scenario_id INTEGER NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
  position    INTEGER NOT NULL CHECK (position >= 1),
  map_name    TEXT NOT NULL REFERENCES map (name) ON UPDATE CASCADE,
  rule        TEXT REFERENCES boss_rule (name) ON UPDATE CASCADE,
  PRIMARY KEY (scenario_id, position)
);

-- side is 'mine' (rank and equipment come from the roster when read) or 'enemy' (rank and equipment optional).
CREATE TABLE IF NOT EXISTS scenario_hero (
  scenario_id     INTEGER NOT NULL,
  position        INTEGER NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('mine', 'enemy')),
  tile            INTEGER NOT NULL,
  hero_name       TEXT NOT NULL REFERENCES hero (name),
  unit            TEXT NOT NULL DEFAULT '',  -- `part`; see formation_hero (migration 3 renames it)
  rank            TEXT,
  equipment_level INTEGER,
  PRIMARY KEY (scenario_id, position, side, tile),
  FOREIGN KEY (scenario_id, position) REFERENCES scenario_slot (scenario_id, position) ON DELETE CASCADE
);

-- How the Win Score is tuned: one row at most (id = 1); with no row the defaults of src/domain/score.ts apply.
CREATE TABLE IF NOT EXISTS score_setting (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  min_effective_sample     REAL NOT NULL,
  stronger_snapshot_weight REAL NOT NULL,
  prior_strength           REAL NOT NULL,
  min_similarity           REAL NOT NULL
);

-- The modes the Statistics page starts with: one row at most, a JSON array of mode names. No row means the player-versus-player
-- modes; an empty array means every mode. It is a starting choice of the page's Mode filter, not a restriction, and the query CLI
-- ignores it.
CREATE TABLE IF NOT EXISTS stats_setting (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  default_modes TEXT NOT NULL
);

-- The day of the latest game update, set by hand: one row at most. Dream Hunt's Advisor treats the fights from that day on as the
-- fresh evidence, since an update may boost a boss. No row means no date. It is configuration, not a record.
CREATE TABLE IF NOT EXISTS update_setting (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  updated_on TEXT NOT NULL CHECK (updated_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);

-- Which agent answers scenarios from the app: one row at most. Only a preset name and a model are kept;
-- what is run for them is fixed in code, and the values are checked again before every run.
CREATE TABLE IF NOT EXISTS agent_setting (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  preset          TEXT NOT NULL,
  model           TEXT NOT NULL,
  timeout_minutes INTEGER NOT NULL
);

-- A Hero Look: a picture of a hero tile (an alternate skin the portrait does not show) that the player confirmed in a roster
-- import. The picture is the file images/custom/look/<file>; it is given to the Agent as an extra reference for the hero later.
CREATE TABLE IF NOT EXISTS hero_look (
  id         INTEGER PRIMARY KEY,
  hero_name  TEXT NOT NULL REFERENCES hero (name),
  file       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the Agent replied for a picture (by the hash of the picture, its screen and mode) once the reply was usable, so that the same
-- picture is not read twice. It is dropped when the player discards the reading or corrects a hero in it.
CREATE TABLE IF NOT EXISTS import_reply (
  key        TEXT PRIMARY KEY,
  reply      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A Hero Example: the picture of a hero tile whose hero the player applied in a roster import. The picture is the file
-- images/custom/hero-example/<file>; the hero reader compares the art of new tiles with it (and with the Hero Looks). Unlike a
-- Hero Look it is not shown to the Agent.
CREATE TABLE IF NOT EXISTS hero_example (
  id         INTEGER PRIMARY KEY,
  hero_name  TEXT NOT NULL REFERENCES hero (name),
  file       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A Rank Look: the picture of a hero tile, with the frame top that tells the ranks above Supreme apart, whose rank the player
-- confirmed in a roster import. The picture is the file images/custom/rank-look/<file>; the rank reader compares tiles with it.
CREATE TABLE IF NOT EXISTS rank_look (
  id         INTEGER PRIMARY KEY,
  rank       TEXT NOT NULL,
  file       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What the Agent and the readers said of a picture next to what the player kept, one row per thing read. It is how the readings are
-- measured (v_import_accuracy): a row whose two values differ is a mistake that was corrected. 'roster-apply' rows come from applying a
-- roster import, 'battle-form' rows from saving the records of a Battle import. `subject` is the hero a rank or equipment row is about.
CREATE TABLE IF NOT EXISTS import_reading (
  id          INTEGER PRIMARY KEY,
  source      TEXT NOT NULL CHECK (source IN ('roster-apply', 'battle-form')),
  screen      TEXT NOT NULL,
  mode        TEXT,
  field       TEXT NOT NULL CHECK (field IN ('hero', 'rank', 'equipment', 'artifact', 'phantimal')),
  subject     TEXT NOT NULL DEFAULT '',
  read_value  TEXT,
  final_value TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- How much of a picture was read without the Agent, one row per picture read (ADR 0015): the strips and tiles the local readers named,
-- the tiles sent to the Agent, and whether the Agent was asked at all (a Remembered reading is not asking). `fresh` is a "Read again".
CREATE TABLE IF NOT EXISTS import_run (
  id           INTEGER PRIMARY KEY,
  screen       TEXT NOT NULL,
  mode         TEXT,
  fresh        INTEGER NOT NULL CHECK (fresh IN (0, 1)),
  strips_total INTEGER NOT NULL,
  strips_known INTEGER NOT NULL,
  tiles_total  INTEGER NOT NULL,
  tiles_sent   INTEGER NOT NULL,
  agent_called INTEGER NOT NULL CHECK (agent_called IN (0, 1)),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The original picture of a saved Battle import (ADR 0016), kept as images/imports/report/<file> and named by the hash of its bytes.
-- One picture shows one fight: the row goes with the record and is dropped with it, the file stays. Not a record.
CREATE TABLE IF NOT EXISTS import_picture (
  attempt_id INTEGER PRIMARY KEY REFERENCES attempt (id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  screen     TEXT NOT NULL,
  label      TEXT,
  file       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS import_picture_hash ON import_picture (hash);

-- A Unit Look: the crop of an artifact or phantimal as a Battle report shows it, whose name the player confirmed by saving the records.
-- The picture is the file images/custom/unit-look/<file>; it joins the Agent's reference sheets for that kind, labelled "(seen)".
CREATE TABLE IF NOT EXISTS unit_look (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('artifact', 'phantimal')),
  name       TEXT NOT NULL,
  file       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

