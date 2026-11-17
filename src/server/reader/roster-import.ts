import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import sharp from 'sharp';
import { findProfile } from '../../db/profiles.js';
import { ensureStartingHeroes } from '../../db/starting-heroes.js';
import { agentImportCommand, agentReply, canReadImages, validateAgentSettings } from '../../domain/agent.js';
import { validateHeroState, type HeroStateRules } from '../../domain/hero-state.js';
import {
  buildSection,
  parseImportReply,
  type ImportPlayer,
  type ParsedFight,
  type ImportProfile,
  type ImportScreen,
  type ParsedTile,
  type ProposalContext,
  type ProposalSection,
  type Target,
} from '../../domain/roster-import.js';
import { promptFor, type ExtraFiles } from '../../domain/roster-import-prompt.js';
import { readUnit, unitFeatures } from '../../vision/unit-read.js';
import type { TileBox } from '../../vision/tile-image.js';
import { newAgentSlot, type AgentSlot } from '../agent/agent-slot.js';
import { loadAgentSettings } from '../agent/agent-settings.js';
import { ARENA_MODES, type ArenaMode } from '../../domain/arena.js';
import { distance as rankDistance, rankFeatures } from '../../vision/rank-read.js';
import { distance as heroDistance, heroFeatures } from '../../vision/hero-read.js';
import { contactSheets, heroReferences, namedReferences, nameImage, planPicture, stripOf, type PicturePlan } from './import-pictures.js';
import { knownTiles, readPlayers, withKnownTiles } from './roster-import-tiles.js';
import { lookExamples, SAME_TILE_DISTANCE } from './look-examples.js';
import { imageType } from '../image-type.js';
import { removeFiles, saveImage } from './saved-image.js';
import { MAX_PROFILE_NAME_LENGTH } from '../../domain/profile.js';
import { draftOf } from '../records/battle-draft.js';
import type { AgentRunner } from '../agent/scenario-run.js';
import { hasName, heroNames as allHeroNames } from '../db-helpers.js';
import { rosterImportContract } from '../../shared/contracts/roster-import.js';
import { fail, file, serve } from '../contract.js';

const MAX_PICTURE_BYTES = 12 * 1024 * 1024;

const SECTION_MESSAGE = 'Unknown section';
const SCREENS: ImportScreen[] = ['info', 'battle', 'hall', 'recap', 'suggestion', 'report'];
const STRIP_TILE_WIDTH: Record<ImportScreen, number> = { info: 360, battle: 300, hall: 300, recap: 300, suggestion: 360, report: 300 };

/** The file type of a picture, from its first bytes; a GIF is not taken. */
function pictureType(bytes: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  const type = imageType(bytes);
  return type === 'gif' ? null : type;
}

/** How many pictures can wait in the queue at once, and how much memory they may take together: a picture is kept until it is read and reviewed. */
const MAX_JOBS = 300;
const DEFAULT_MAX_QUEUED_BYTES = 512 * 1024 * 1024;

/** How many pictures the Agent reads at the same time. */
const DEFAULT_CONCURRENCY = 3;

/**
 * The screens whose tiles the local readers may name without the Agent: the PvP reports and results, where the same heroes come back every round.
 * The Agent is still asked for everything else on the picture (names, the fight, artifacts and phantimals).
 */
const LOCAL_READING: ImportScreen[] = ['report', 'battle'];

/** How many more times the Agent is asked for a picture whose reply could not be used. */
const MAX_REPLY_RETRIES = 2;

interface ImportJob {
  id: number;
  /** What the player called the picture (its file name), to tell the queue apart. */
  label: string | null;
  state: 'queued' | 'running' | 'done' | 'failed';
  /** The picture and what was found in it, kept while the job waits for its turn. */
  input?: { plan: PicturePlan; bytes: Buffer; type: 'png' | 'jpg' | 'webp' };
  error?: string;
  screen: ImportScreen;
  /** For a `report`: the PvP mode the player said the picture is from, and what the Agent read of the fight. */
  mode?: ArenaMode;
  fight?: ParsedFight | null;
  controller: AbortController;
  /** Where the Agent's reply to this picture is remembered; `fresh` asks the Agent again even when it is. */
  cacheKey: string;
  fresh: boolean;
  /** The picture as it was sent, for a Battle import: the form fetches it before the picture is dismissed, to keep it with the saved fight (ADR 0016). */
  original?: { bytes: Buffer; type: 'png' | 'jpg' | 'webp' };
  /** What was read, with the star readings; set when the job is done. */
  players: ImportPlayer[];
  context: ProposalContext | null;
  /** Where each section's heroes go; a section not listed here goes to the profile its name matches. */
  targets: Map<number, Target>;
  /** The hero the player chose for a tile the Agent could not name. */
  chosen: Map<string, string>;
  /** Each tile as cut from the picture (PNG bytes), by tile key: shown in the review and saved as a Hero Look. */
  tiles: Map<string, Buffer>;
  /** The same tiles with the whole frame, bottom included, for the review screen only. */
  views: Map<string, Buffer>;
}

/**
 * Routes for importing heroes from a picture of the game. The Agent only reads the picture and prints a proposal; the proposal is shown
 * for review and nothing reaches a profile until the player applies it. Pictures are kept only while the Agent reads them.
 */
export function rosterImportRoutes(
  db: Database.Database,
  runner: AgentRunner,
  rules: () => HeroStateRules,
  options: { imagesDir?: string; workDir?: string; slot?: AgentSlot; /** How many pictures are read at once. */ concurrency?: number; /** The most bytes of pictures that may wait at once. */ maxQueuedBytes?: number; /** Keep the pictures of a Battle import on disk while they wait, so that a restart does not lose them. */ persistQueue?: boolean } = {},
): Hono {
  const app = new Hono();
  const imagesDir = options.imagesDir ?? 'images';
  const workDir = resolve(options.workDir ?? 'tmp/roster-import');
  const slot = options.slot ?? newAgentSlot();
  /** The pictures in the order they were given: the first is the one under review. They are read one after another. */
  let jobs: ImportJob[] = [];
  let counter = 0;
  const maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
  /** The bytes the pictures in the queue take in memory; the picture of a report is kept once for the reading and the form. */
  const queuedBytes = () => {
    const held = new Set<Buffer>();
    for (const job of jobs) for (const bytes of [job.input?.bytes, job.original?.bytes]) if (bytes) held.add(bytes);
    return [...held].reduce((sum, bytes) => sum + bytes.length, 0);
  };
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  let reading = 0;
  let retry: NodeJS.Timeout | null = null;

  const contextFor = (screen: ImportScreen): ProposalContext => {
    const seenNames = db.prepare('SELECT folded, profile_id AS profileId FROM profile_name').all() as { folded: string; profileId: number }[];
    const profiles: ImportProfile[] = (db.prepare('SELECT id, name FROM profile ORDER BY name').all() as { id: number; name: string }[]).map((p) => ({
      ...p,
      heroes: new Map(
        (db.prepare('SELECT hero_name AS hero, rank, equipment_level AS equipmentLevel FROM roster WHERE profile_id = ?').all(p.id) as { hero: string; rank: string | null; equipmentLevel: number | null }[]).map((r) => [
          r.hero,
          { rank: r.rank, equipmentLevel: r.equipmentLevel },
        ]),
      ),
    }));
    const tiers = new Map((db.prepare('SELECT name, tier FROM hero').all() as { name: string; tier: string | null }[]).map((h) => [h.name, h.tier]));
    return { screen, profiles, seenNames, rules: rules(), tiers };
  };

  /** The players with the heroes the player chose for tiles the Agent could not name. */
  const withChoices = (current: ImportJob): ImportPlayer[] =>
    current.players.map((player) => ({
      ...player,
      tiles: player.tiles.map((tile) => {
        const hero = current.chosen.get(tile.key);
        return hero ? { ...tile, hero, candidates: [], confident: true } : tile;
      }),
    }));

  const sectionsOf = (current: ImportJob): (ProposalSection & { index: number })[] => {
    // Read the profiles now, not when the picture was read: one made by a picture applied meanwhile must be matched, not made again.
    const context = contextFor(current.screen);
    const players = withChoices(current);
    return players.map((player, index) => ({ index, ...buildSection(player, context, current.targets.get(index) ?? { kind: 'match' }) }));
  };

  const view = (current: ImportJob | null) =>
    current === null
      ? null
      : {
          id: current.id,
          state: current.state,
          ...(current.error === undefined ? {} : { error: current.error }),
          screen: current.screen,
          label: current.label,
          ...(current.state === 'done' && current.screen !== 'report' ? { sections: sectionsOf(current), chosen: Object.fromEntries(current.chosen) } : {}),
        };

  const capability = () => {
    const settings = loadAgentSettings(db);
    const invalid = validateAgentSettings(settings);
    if (invalid) return { canRead: false, reason: `The saved agent settings are not usable: ${invalid}` };
    if (!canReadImages(settings.preset)) return { canRead: false, reason: `The ${settings.preset} agent has not been checked for reading pictures: choose another in Admin` };
    return { canRead: true, reason: null };
  };

  /** The pictures of one kind of import: a Roster import's, or with `?kind=report` a Battle import's (they share the queue but not the review). */
  const ofKind = (kind: string | undefined) => jobs.filter((j) => (kind === 'report') === (j.screen === 'report'));

  serve(app, rosterImportContract.state, async (_, c) => {
    const kind = c.req.query('kind');
    if (kind === 'report') await restore();
    const list = ofKind(kind);
    return {
      ...capability(),
      busy: slot.busy || slot.importing > 0,
      job: kind === 'report' ? null : view(list[0] ?? null),
      queue: list.map((j) => ({
        id: j.id,
        label: j.label,
        state: j.state,
        screen: j.screen,
        ...(kind === 'report' ? { key: j.cacheKey } : {}),
        ...(j.error === undefined ? {} : { error: j.error }),
        ...(kind === 'report' && j.state === 'done' && j.mode ? { draft: draftOf(db, rules(), j.mode, withChoices(j), j.fight ?? null) } : {}),
      })),
    };
  });

  serve(app, rosterImportContract.start, async (_, c) => {
    const screen = c.req.query('screen') as ImportScreen;
    if (!SCREENS.includes(screen)) return fail(400, `Say which screen the picture shows: ${SCREENS.join(', ')}`);
    const can = capability();
    if (!can.canRead) return fail(400, can.reason ?? 'The reader is not available');
    if (jobs.length >= MAX_JOBS) return fail(409, `At most ${MAX_JOBS} pictures can wait: review or discard some first`);
    const mode = c.req.query('mode') as ArenaMode | undefined;
    if (screen === 'report' && (!mode || !ARENA_MODES.includes(mode))) return fail(400, `Say which mode the report is from: ${ARENA_MODES.join(', ')}`);
    // Resonating Hall is always for one profile; Player Info (one player) may name one instead of being matched by the player's name.
    const asked = c.req.query('profile');
    const hallProfile = screen === 'hall' || (screen === 'info' && asked) ? findProfile(db, asked) : undefined;
    if ((screen === 'hall' || (screen === 'info' && asked)) && !hallProfile) return fail(404, 'Unknown profile');
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length === 0) return fail(400, 'The file is empty');
    if (bytes.length > MAX_PICTURE_BYTES) return fail(413, 'The picture can be at most 12 MB');
    const waiting = queuedBytes();
    if (waiting + bytes.length > maxQueuedBytes) return fail(409, `The pictures waiting take ${Math.round(waiting / 1048576)} MB of the ${Math.round(maxQueuedBytes / 1048576)} MB allowed: review, save or discard some first`);
    const type = pictureType(bytes);
    if (!type) return fail(415, 'Upload a PNG, JPEG or WebP picture');

    await restore();
    let current: ImportJob;
    try {
      current = await enqueue({ bytes, type, screen, mode, label: c.req.query('name')?.slice(0, 100) || null, fresh: c.req.query('fresh') === '1', hallProfile: hallProfile?.id });
    } catch (error) {
      return fail(422, error instanceof Error ? error.message : String(error));
    }
    return view(current)!;
  });

  interface Intake {
    bytes: Buffer;
    type: 'png' | 'jpg' | 'webp';
    screen: ImportScreen;
    mode?: ArenaMode;
    label: string | null;
    fresh: boolean;
    hallProfile?: number;
  }

  /** Plans the picture and puts it in the queue; throws when the picture cannot be used. */
  async function enqueue(intake: Intake): Promise<ImportJob> {
    const { bytes, type, screen, mode } = intake;
    const plan = await planPicture(bytes, screen);
    const current: ImportJob = {
      id: ++counter,
      label: intake.label,
      state: 'queued',
      input: { plan, bytes, type },
      screen,
      ...(screen === 'report' ? { mode, original: { bytes, type } } : {}),
      controller: new AbortController(),
      cacheKey: createHash('sha256').update(bytes).update(`|${screen}|${screen === 'report' ? `${mode}|extras` : ''}`).digest('hex'),
      fresh: intake.fresh,
      players: [],
      context: null,
      targets: new Map(intake.hallProfile === undefined ? [] : [[0, { kind: 'profile', id: intake.hallProfile } as Target]]),
      chosen: new Map(),
      tiles: new Map(),
      views: new Map(),
    };
    jobs.push(current);
    persist(current);
    pump();
    return current;
  }

  // The pictures of a Battle import wait on disk (queue/<hash>.<type> with queue/<hash>.json) until they are saved or discarded, so that
  // a restart of the server does not lose them; what the Agent read of them is kept by the reply cache.
  const queueDir = join(workDir, 'queue');
  function persist(job: ImportJob): void {
    if (!options.persistQueue || job.screen !== 'report' || !job.original) return;
    mkdirSync(queueDir, { recursive: true });
    writeFileSync(join(queueDir, `${job.cacheKey}.${job.original.type}`), job.original.bytes);
    writeFileSync(join(queueDir, `${job.cacheKey}.json`), JSON.stringify({ screen: job.screen, mode: job.mode, label: job.label }));
  }
  /** Removes the files of the pictures that left the queue. */
  function unpersist(): void {
    if (!options.persistQueue || !existsSync(queueDir)) return;
    const live = new Set(jobs.filter((j) => j.screen === 'report').map((j) => j.cacheKey));
    for (const file of readdirSync(queueDir)) if (!live.has(file.split('.')[0]!)) rmSync(join(queueDir, file), { force: true });
  }
  let restored: Promise<void> | null = null;
  /** Puts the pictures left on disk by an earlier run back in the queue, once, oldest first. */
  function restore(): Promise<void> {
    return (restored ??= (async () => {
      if (!options.persistQueue || !existsSync(queueDir)) return;
      const metas = readdirSync(queueDir).filter((f) => f.endsWith('.json')).sort((a, b) => statSync(join(queueDir, a)).mtimeMs - statSync(join(queueDir, b)).mtimeMs);
      for (const meta of metas) {
        const key = meta.slice(0, -'.json'.length);
        const file = readdirSync(queueDir).find((f) => f.startsWith(`${key}.`) && !f.endsWith('.json'));
        try {
          const saved = JSON.parse(readFileSync(join(queueDir, meta), 'utf8')) as { screen: ImportScreen; mode?: ArenaMode; label: string | null };
          const bytes = readFileSync(join(queueDir, file!));
          const type = pictureType(bytes);
          if (!type || jobs.some((j) => j.cacheKey === key)) throw new Error('unusable');
          await enqueue({ bytes, type, screen: saved.screen, mode: saved.mode, label: saved.label, fresh: false });
        } catch {
          rmSync(join(queueDir, meta), { force: true });
          if (file) rmSync(join(queueDir, file), { force: true });
        }
      }
    })());
  }

  const forget = (job: ImportJob) => void db.prepare("DELETE FROM import_reply WHERE key = ? OR key LIKE ? || '|%'").run(job.cacheKey, job.cacheKey);

  /** Starts the waiting pictures, in order, up to `concurrency` at a time; a scenario estimate using the agent makes them wait. */
  function pump(): void {
    for (let next = jobs.find((j) => j.state === 'queued'); next && reading < concurrency; next = jobs.find((j) => j.state === 'queued')) {
      if (slot.busy) {
        retry ??= setTimeout(() => ((retry = null), pump()), 200);
        return;
      }
      const { plan, bytes, type } = next.input!;
      delete next.input;
      next.state = 'running';
      reading++;
      slot.importing++;
      void run(next, plan, bytes, type, loadAgentSettings(db)).finally(() => {
        reading--;
        slot.importing--;
        pump();
      });
    }
  }

  const { rankExamples, heroExamples, artifactExamples } = lookExamples(db, imagesDir);

  /**
   * The heroes a picture's own-side tiles are most likely to be: the roster of the profile the Resonating Hall picture is for, and for the
   * screens that show the viewer's own team first (the ally of a battle, a report or a recap) the default profile's roster. A hint, not a limit:
   * the ally of a report is not always the owner.
   */
  function likelyHeroes(current: ImportJob, strips: { id: string }[]): { strips: string[]; heroes: string[] } | null {
    const target = current.targets.get(0);
    const profileId = current.screen === 'hall' ? (target?.kind === 'profile' ? target.id : null) : ['battle', 'report', 'recap'].includes(current.screen) ? (db.prepare('SELECT id FROM profile WHERE is_default = 1').pluck().get() as number | undefined) ?? null : null;
    if (profileId === null) return null;
    const ids = current.screen === 'hall' ? strips.map((s) => s.id) : strips.filter((s) => s.id === 'ally').map((s) => s.id);
    const heroes = db.prepare('SELECT hero_name FROM roster WHERE profile_id = ? ORDER BY hero_name').pluck().all(profileId) as string[];
    return ids.length > 0 && heroes.length > 0 ? { strips: ids, heroes } : null;
  }


  async function run(current: ImportJob, plan: PicturePlan, picture: Buffer, type: string, settings: ReturnType<typeof loadAgentSettings>): Promise<void> {
    const dir = join(workDir, String(current.id));
    try {
      mkdirSync(dir, { recursive: true });
      const write = (name: string, bytes: Buffer) => {
        const file = join(dir, name);
        writeFileSync(file, bytes);
        return file;
      };
      write(`picture.${type}`, picture);
      const examples = await rankExamples();
      const heroSamples = await heroExamples();
      const context = contextFor(current.screen);
      // Tiles the local readers are sure of are not sent: the Agent only reads the rest, and a strip with none left is not sent at all.
      // "Read again" asks the Agent for all of it.
      const knownBy = LOCAL_READING.includes(current.screen) && !current.fresh ? await knownTiles(plan, picture, examples, heroSamples, context.rules.ranks) : new Map<string, Map<number, ParsedTile>>();
      // the artifact a side shows, named by the local reader when it is sure of it: that side's artifact crop and the artifact sheets are not sent
      const artifactNames = db.prepare('SELECT name FROM artifact ORDER BY name').pluck().all() as string[];
      const artifactBy = new Map<number, string>();
      if (plan.extras && LOCAL_READING.includes(current.screen) && !current.fresh) {
        const looks = await artifactExamples();
        for (const [player, side] of plan.extras.entries()) {
          const seen = looks.length > 0 ? readUnit(await unitFeatures(await sharp(picture).extract(side.artifact).png().toBuffer()), looks) : null;
          if (seen?.confident && artifactNames.includes(seen.name)) artifactBy.set(player, seen.name);
        }
      }
      /** The positions in a strip of the tiles the Agent is asked about. */
      const toRead = (crop: { id: string; boxes: TileBox[] }) => crop.boxes.map((_, i) => i).filter((i) => !knownBy.get(crop.id)?.has(i));
      const known = new Set(plan.players.flat().filter((c) => toRead(c).length === 0).map((c) => c.id));
      // the same picture asked about other tiles (the readers learnt since) must not reuse a reply made for another set
      const shape = knownBy.size === 0 && artifactBy.size === 0 ? '' : `${plan.players.flat().map((c) => `${c.id}:${toRead(c).join('.')}`).join(',')}|artifact:${[...artifactBy.keys()].join('.')}`;
      const replyKey = shape === '' ? current.cacheKey : `${current.cacheKey}|${shape}`;
      const strips: { id: string; file: string; count: number; player: number }[] = [];
      for (const [player, crops] of plan.players.entries()) {
        for (const crop of crops) {
          const unread = toRead(crop);
          if (unread.length > 0) strips.push({ id: crop.id, file: write(`${crop.id}.jpg`, await stripOf(picture, unread.map((i) => crop.boxes[i]!), STRIP_TILE_WIDTH[current.screen])), count: unread.length, player });
        }
      }
      const name = plan.nameRegions.length > 0 ? write('names.jpg', await nameImage(picture, plan.nameRegions)) : null;
      const sheets = strips.length > 0 ? (await contactSheets(heroReferences(db, imagesDir))).map((sheet, i) => write(`heroes-${i + 1}.jpg`, sheet)) : [];
      const phantimalNames = db.prepare('SELECT name FROM phantimal ORDER BY name').pluck().all() as string[];
      let extras: ExtraFiles | undefined;
      if (plan.extras) {
        const enlarge = (box: TileBox) => sharp(picture).extract(box).resize({ width: 360, kernel: 'lanczos3' }).png().toBuffer();
        const artifacts = artifactBy.size < plan.extras.length;
        extras = {
          artifactSheets: artifacts ? (await contactSheets(namedReferences(db, imagesDir, 'artifact'))).map((sheet, i) => write(`artifacts-${i + 1}.jpg`, sheet)) : [],
          phantimalSheets: (await contactSheets(namedReferences(db, imagesDir, 'phantimal'))).map((sheet, i) => write(`phantimals-${i + 1}.jpg`, sheet)),
          phantimalNames,
          artifacts,
          sides: await Promise.all(plan.extras.map(async (side, player) => ({ player, artifact: artifactBy.has(player) ? null : write(`artifact-${player + 1}.png`, await enlarge(side.artifact)), phantimal: write(`phantimal-${player + 1}.png`, await enlarge(side.phantimal)) }))),
        };
      }
      const likely = likelyHeroes(current, strips);
      const command = agentImportCommand(settings.preset, settings.model, promptFor(current.screen, { sheets, name, strips, players: plan.players.length, skipped: known.size, partial: knownBy.size > known.size, ranks: context.rules.ranks, ...(extras ? { extras } : {}), ...(likely ? { likely } : {}) }));
      if ('error' in command) throw new Error(command.error);
      if (current.controller.signal.aborted) throw new Error('Cancelled');
      const heroNames = allHeroNames(db);
      const parse = (reply: string) => {
        const result = parseImportReply(reply, plan.players.map((crops) => crops.filter((c) => !known.has(c.id)).map((c) => c.id)), heroNames, context.rules.ranks, plan.extras ? { artifacts: artifactNames, phantimals: phantimalNames } : undefined);
        return 'error' in result || knownBy.size === 0 ? result : withKnownTiles(result, plan, knownBy, known, toRead);
      };
      const invoke = () => runner(command, { timeoutMs: settings.timeoutMinutes * 60 * 1000, signal: current.controller.signal });
      let asked = 0;
      const ask = async () => {
        asked++;
        // an agent that fails to start or exits at once (a rate limit, a busy service) gets one more try; a cancel or a timeout does not
        const printed = await invoke().catch((error: unknown) => {
          if (current.controller.signal.aborted || /^(Cancelled|Timed out)/.test(error instanceof Error ? error.message : '')) throw error;
          return invoke();
        });
        const reply = agentReply(settings.preset, printed);
        const result = parse(reply);
        if (!('error' in result)) db.prepare('INSERT INTO import_reply (key, reply) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET reply = excluded.reply, created_at = datetime(\'now\')').run(replyKey, reply);
        return result;
      };
      const remembered = current.fresh ? undefined : (db.prepare('SELECT reply FROM import_reply WHERE key = ?').pluck().get(replyKey) as string | undefined);
      let parsed = remembered === undefined ? await ask() : parse(remembered);
      if ('error' in parsed && remembered !== undefined) parsed = await ask();
      // the agent now and then leaves a strip out of its reply, or answers with no JSON: up to two more tries cost time only when that happens
      for (let again = 0; again < MAX_REPLY_RETRIES && 'error' in parsed && /did not reply/.test(parsed.error) && !current.controller.signal.aborted; again++) parsed = await ask();
      if ('error' in parsed) throw new Error(parsed.error);

      const players = await readPlayers({ plan, picture, parsed: parsed.players, artifactBy, rankSamples: examples, heroSamples, tiles: current.tiles, views: current.views });
      // how much the local readers spared the Agent (ADR 0015); a Remembered reading asks nothing
      const crops = plan.players.flat();
      db.prepare('INSERT INTO import_run (screen, mode, fresh, strips_total, strips_known, tiles_total, tiles_sent, agent_called) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        current.screen,
        current.mode ?? null,
        current.fresh ? 1 : 0,
        crops.length,
        known.size,
        crops.reduce((sum, c) => sum + c.boxes.length, 0),
        crops.reduce((sum, c) => sum + toRead(c).length, 0),
        asked > 0 ? 1 : 0,
      );
      current.players = players;
      current.fight = parsed.fight;
      current.context = context;
      current.state = 'done';
    } catch (error) {
      current.state = 'failed';
      current.error = error instanceof Error ? error.message : String(error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // Reads a failed picture of a Battle import again, from the copy kept with the job.
  serve(app, rosterImportContract.retry, async ({ params }) => {
    const found = jobs.find((j) => j.id === Number(params.id));
    if (!found || found.state !== 'failed' || !found.original || found.screen !== 'report') return fail(409, 'Only a picture that failed to be read can be read again');
    const can = capability();
    if (!can.canRead) return fail(400, can.reason ?? 'The reader is not available');
    jobs = jobs.filter((j) => j !== found);
    forget(found);
    let again: ImportJob;
    try {
      again = await enqueue({ ...found.original, screen: found.screen, mode: found.mode, label: found.label, fresh: true });
    } catch (error) {
      jobs.push(found);
      return fail(422, error instanceof Error ? error.message : String(error));
    }
    return view(again)!;
  });

  serve(app, rosterImportContract.cancel, ({ params }) => {
    const found = jobs.find((j) => j.id === Number(params.id));
    if (found?.state === 'queued') {
      jobs = jobs.filter((j) => j !== found);
      unpersist();
      return { state: 'cancelled' };
    }
    if (!found || found.state !== 'running') return fail(409, 'Nothing is running');
    found.controller.abort();
    return { state: 'running' };
  });

  /** The job a request is about, when it is finished and still waiting for review. */
  const finished = (id: string) => jobs.find((j) => j.id === Number(id) && j.state === 'done') ?? null;

  serve(app, rosterImportContract.picture, ({ params }) => {
    const found = jobs.find((j) => j.id === Number(params.id));
    if (!found?.original) return fail(404, 'No picture');
    const types = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
    return file(new Uint8Array(found.original.bytes), types[found.original.type], { 'cache-control': 'no-cache' });
  });

  serve(app, rosterImportContract.tile, ({ params }, c) => {
    const found = finished(params.id);
    // `?frame=top` is the tile as the readers learn it (only the top of the frame), not as the review shows it
    const tile = c.req.query('frame') === 'top' ? found?.tiles.get(params.key) : (found?.views.get(params.key) ?? found?.tiles.get(params.key));
    return tile ? file(new Uint8Array(tile), 'image/png', { 'cache-control': 'no-cache' }) : fail(404, 'No picture');
  });

  // Changes where one player's heroes go: the profile the name matches, another profile, or a new one.
  serve(app, rosterImportContract.target, ({ params, body: { section: index, target } }) => {
    const found = finished(params.id);
    if (!found) return fail(404, 'Unknown import');
    if (index < 0 || index >= found.players.length) return fail(400, SECTION_MESSAGE);
    if (target.kind === 'profile') {
      if (!contextFor(found.screen).profiles.some((p) => p.id === target.id)) return fail(404, 'Unknown profile');
      found.targets.set(index, { kind: 'profile', id: target.id });
    } else {
      found.targets.set(index, { kind: target.kind });
    }
    return sectionsOf(found)[index]!;
  });

  // The hero the player picked for a tile, whether the Agent could not name it or named it wrongly (null to go back to the Agent's reading).
  serve(app, rosterImportContract.choose, ({ params, body: { tile: key, hero } }) => {
    const found = finished(params.id);
    if (!found) return fail(404, 'Unknown import');
    if (!found.players.some((p) => p.tiles.some((t) => t.key === key))) return fail(400, 'Unknown tile');
    if (hero === null) found.chosen.delete(key);
    else if (hasName(db, 'hero', hero)) found.chosen.set(key, hero);
    else return fail(400, 'Unknown hero');
    return { sections: sectionsOf(found), chosen: Object.fromEntries(found.chosen) };
  });

  // Applies the sections the player ticked. Everything is checked first, so either all of it is saved or none.
  serve(app, rosterImportContract.apply, async ({ params, body }) => {
    const found = finished(params.id);
    if (!found) return fail(404, 'Unknown import');
    const ruleset = rules();
    const heroTier = new Map((db.prepare('SELECT name, tier FROM hero').all() as { name: string; tier: string | null }[]).map((h) => [h.name, h.tier]));
    const plan: { profileId: number | null; create: string | null; rename: string | null; changes: { hero: string; rank: string; equipmentLevel: number | null; tile: string | null }[]; looks: { key: string; hero: string }[] }[] = [];
    const taken = new Set<string>();
    for (const raw of body.sections) {
      const given = raw as Record<string, any> | null | undefined; // checked field by field below
      const profile = given?.profileId === undefined || given.profileId === null ? null : findProfile(db, Number(given.profileId));
      if (given?.profileId !== undefined && given.profileId !== null && !profile) return fail(404, 'Unknown profile');
      const clean = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
      const create = given?.create === undefined || given.create === null ? null : clean(given.create);
      const rename = given?.rename === undefined || given.rename === null ? null : clean(given.rename);
      if (profile === null && create === null) return fail(400, 'Choose a profile or a name for a new one');
      for (const name of [create, rename]) {
        if (name === null) continue;
        if (name === '' || name.length > MAX_PROFILE_NAME_LENGTH) return fail(400, `A profile name is 1 to ${MAX_PROFILE_NAME_LENGTH} characters`);
        const other = db.prepare('SELECT id FROM profile WHERE name = ?').pluck().get(name) as number | undefined;
        if ((other !== undefined && other !== profile?.id) || taken.has(name.toLowerCase())) return fail(409, `A profile named "${name}" exists already`);
        taken.add(name.toLowerCase());
      }
      const changes: (typeof plan)[number]['changes'] = [];
      for (const change of Array.isArray(given?.changes) ? given.changes : []) {
        if (typeof change?.hero !== 'string' || !heroTier.has(change.hero)) return fail(400, `Unknown hero "${change?.hero}"`);
        if (typeof change.rank !== 'string') return fail(400, `Give ${change.hero} a rank`);
        const equipmentLevel = change.equipmentLevel ?? null;
        if (equipmentLevel !== null && typeof equipmentLevel !== 'number') return fail(400, 'equipmentLevel must be a number or null');
        const error = validateHeroState({ rank: change.rank, equipmentLevel }, ruleset, heroTier.get(change.hero) ?? null);
        if (error) return fail(400, `${change.hero}: ${error}`);
        changes.push({ hero: change.hero, rank: change.rank, equipmentLevel, tile: typeof change.tile === 'string' ? change.tile : null });
      }
      const looks: { key: string; hero: string }[] = [];
      for (const key of Array.isArray(given?.looks) ? given.looks : []) {
        const hero = found.chosen.get(key);
        if (!hero || !found.tiles.has(key)) return fail(400, 'A tile to save as a look was not chosen');
        looks.push({ key, hero });
      }
      plan.push({ profileId: profile?.id ?? null, create, rename, changes, looks });
    }

    // The tiles whose rank the player confirmed become Rank Looks for the rank reader, unless it has one just like them already.
    const notOwned = new Set(found.players.flatMap((p) => p.tiles.filter((t) => t.notOwned).map((t) => t.key)));
    const known = await rankExamples();
    const rankLooks: { rank: string; tile: string }[] = [];
    for (const item of plan) {
      for (const change of item.changes) {
        const crop = change.tile === null || notOwned.has(change.tile) ? undefined : found.tiles.get(change.tile);
        if (!crop) continue;
        const features = await rankFeatures(crop);
        if (known.some((example) => example.rank === change.rank && rankDistance(example.features, features) < SAME_TILE_DISTANCE)) continue;
        known.push({ rank: change.rank, features });
        rankLooks.push({ rank: change.rank, tile: change.tile! });
      }
    }
    // The same for heroes: a tile whose hero the player applied is kept as an example for the hero reader, unless it has one just like it.
    const knownHeroes = await heroExamples();
    const heroSaves: { hero: string; tile: string }[] = [];
    for (const item of plan) {
      for (const change of item.changes) {
        const crop = change.tile === null || notOwned.has(change.tile) ? undefined : found.tiles.get(change.tile);
        if (!crop) continue;
        const features = await heroFeatures(crop);
        if (knownHeroes.some((example) => example.hero === change.hero && heroDistance(example.features, features) < SAME_TILE_DISTANCE)) continue;
        knownHeroes.push({ hero: change.hero, features });
        heroSaves.push({ hero: change.hero, tile: change.tile! });
      }
    }
    const heroExampleDir = join(resolve(imagesDir), 'custom', 'hero-example');
    const rankLookDir = join(resolve(imagesDir), 'custom', 'rank-look');
    const lookDir = join(resolve(imagesDir), 'custom', 'look');
    /** What the Agent and the readers said of the tile, next to what the player applied: rows for `import_reading`. */
    const logReading = (job: ImportJob, change: { hero: string; rank: string; equipmentLevel: number | null; tile: string | null }) => {
      const tile = change.tile === null ? undefined : job.players.flatMap((p) => p.tiles).find((t) => t.key === change.tile);
      if (!tile || tile.notOwned) return;
      const insert = db.prepare("INSERT INTO import_reading (source, screen, field, subject, read_value, final_value) VALUES ('roster-apply', ?, ?, ?, ?, ?)");
      const rank = tile.rankRead?.confident ? tile.rankRead.rank : tile.rank;
      insert.run(job.screen, 'hero', '', tile.hero, change.hero);
      if (rank !== null) insert.run(job.screen, 'rank', change.hero, rank, change.rank);
      if (tile.stars?.state === 'present' && tile.stars.level !== null) insert.run(job.screen, 'equipment', change.hero, String(tile.stars.level), change.equipmentLevel === null ? null : String(change.equipmentLevel));
    };
    /** The pictures written so far: a failed apply takes them back with the rows. */
    const written: string[] = [];
    const apply = db.transaction(() => {
      const results: { profileId: number; created: boolean; changed: number; looks: number; rankLooks: number }[] = [];
      for (const item of plan) {
        let profileId = item.profileId;
        const created = profileId === null;
        if (profileId === null) {
          profileId = Number(db.prepare('INSERT INTO profile (name, player_id) VALUES (?, NULL)').run(item.create).lastInsertRowid);
          ensureStartingHeroes(db, profileId);
        } else if (item.rename !== null) db.prepare('UPDATE profile SET name = ? WHERE id = ?').run(item.rename, profileId);
        for (const change of item.changes) {
          db.prepare(
            `INSERT INTO roster (profile_id, hero_name, rank, equipment_level) VALUES (?, ?, ?, ?)
             ON CONFLICT (profile_id, hero_name) DO UPDATE SET rank = excluded.rank, equipment_level = excluded.equipment_level`,
          ).run(profileId, change.hero, change.rank, change.equipmentLevel);
          logReading(found, change);
        }
        for (const look of item.looks) {
          saveImage(db, 'hero_look', { hero_name: look.hero }, lookDir, found.tiles.get(look.key)!, written, 'roster');
        }
        for (const change of item.changes) {
          const index = heroSaves.findIndex((h) => h.tile === change.tile && h.hero === change.hero);
          if (index < 0) continue;
          const [save] = heroSaves.splice(index, 1);
          saveImage(db, 'hero_example', { hero_name: save!.hero }, heroExampleDir, found.tiles.get(save!.tile)!, written, 'roster');
        }
        let savedRankLooks = 0;
        for (const change of item.changes) {
          const index = rankLooks.findIndex((r) => r.tile === change.tile && r.rank === change.rank);
          if (index < 0) continue;
          const [look] = rankLooks.splice(index, 1);
          saveImage(db, 'rank_look', { rank: look!.rank }, rankLookDir, found.tiles.get(look!.tile)!, written, 'roster');
          savedRankLooks++;
        }
        results.push({ profileId, created, changed: item.changes.length, looks: item.looks.length, rankLooks: savedRankLooks });
      }
      return results;
    });
    let done: ReturnType<typeof apply>;
    try {
      done = apply();
    } catch (e) {
      removeFiles(written);
      throw e;
    }
    // a reading the player had to correct is not worth remembering
    if (found.chosen.size > 0) forget(found);
    jobs = jobs.filter((j) => j !== found);
    unpersist();
    return { applied: done };
  });

  // Throws the proposal under review away without saving anything, or with `?waiting=1` the pictures that have not been read yet.
  serve(app, rosterImportContract.dismiss, (_, c) => {
    const kind = c.req.query('kind');
    if (c.req.query('waiting') === '1') {
      jobs = jobs.filter((j) => j.state !== 'queued' || (kind === 'report') !== (j.screen === 'report'));
      unpersist();
      return;
    }
    // pictures that were opened in the Battle import's form, by id
    const ids = c.req.query('ids');
    if (ids !== undefined) {
      const wanted = new Set(ids.split(',').map(Number));
      jobs = jobs.filter((j) => !(wanted.has(j.id) && j.state !== 'running'));
      unpersist();
      return;
    }
    const head = ofKind(kind)[0];
    if (head?.state === 'running') return fail(409, 'The agent is still reading: cancel it first');
    // `keep`: the picture needed nothing, so what the Agent read of it can serve again
    if (head && c.req.query('keep') !== '1') forget(head);
    jobs = jobs.filter((j) => j !== head);
    unpersist();
  });

  return app;
}
