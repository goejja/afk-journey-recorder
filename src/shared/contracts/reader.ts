import { z } from 'zod';
import type { ArenaMode, LearnedView, ParkedList, ReaderView } from '../api.js';
import { Binary, endpoint } from '../contract.js';

// The learned pictures and reader examples the Admin review looks at (ADR 0012): one view of each, and one set of routes for the pictures
// themselves. The bodies are typed, not checked by the schema: the handlers check them and keep their own messages.
export const learnedContract = {
  view: endpoint({ method: 'GET', path: '/api/admin/learned', response: z.custom<LearnedView>() }),
};

export const readerExamplesContract = {
  view: endpoint({ method: 'GET', path: '/api/admin/reader', response: z.custom<ReaderView>() }),
};

/** What a learned picture is moved to: the hero of an example or look, the rank of a Rank Look, the artifact or phantimal of a Unit Look. */
const MoveBody = z.object({ value: z.string({ error: 'Send the new value as text' }) }, { error: 'Send the new value as text' });

/** The pictures of the four learned tables (`hero_example`, `hero_look`, `rank_look`, `unit_look`), by table name. */
export const learnedPicturesContract = {
  image: endpoint({ method: 'GET', path: '/api/admin/pictures/:table/:id/image', response: Binary }),
  /** Moves a picture to another hero, rank or name; a Rank Look answers how many looks the rank reader names wrong before and after, the others answer null. */
  move: endpoint({ method: 'PATCH', path: '/api/admin/pictures/:table/:id', body: MoveBody, response: z.object({ wrongBefore: z.number(), wrongAfter: z.number() }).nullable() }),
  remove: endpoint({ method: 'DELETE', path: '/api/admin/pictures/:table/:id', response: z.undefined(), status: 204 }),
  removeSource: endpoint({ method: 'DELETE', path: '/api/admin/pictures/by-source/:source', response: z.object({ deleted: z.number() }) }),
};

export const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const PICTURE_MESSAGE = 'Send the fight and its picture as a data URL';
/** The original picture of a saved Battle import, as a data URL, with the fight it showed. */
const KeptPictureBody = z.object(
  {
    attemptId: z.number({ error: PICTURE_MESSAGE }).int(PICTURE_MESSAGE),
    data: z.string({ error: PICTURE_MESSAGE }).regex(DATA_URL, PICTURE_MESSAGE),
    label: z.unknown().optional().transform((label) => (typeof label === 'string' ? label.slice(0, 200) : null)),
  },
  { error: PICTURE_MESSAGE },
);

export const keptPicturesContract = {
  /** Keeps the original picture of a Battle import with the fight it showed. Never changes a record. */
  keep: endpoint({ method: 'POST', path: '/api/kept-pictures', body: KeptPictureBody, response: z.object({ hash: z.string() }), status: 201 }),
  image: endpoint({ method: 'GET', path: '/api/kept-pictures/:attemptId', response: Binary }),
};

export const importFeedbackContract = {
  /** What the player kept of a Battle import, with what was read, to measure the readings and to learn looks. Never changes a record. */
  send: endpoint({
    method: 'POST',
    path: '/api/import-feedback',
    body: z.custom<{ mode: ArenaMode; sides: unknown[] }>(),
    response: z.object({ logged: z.number(), looks: z.number(), heroExamples: z.number(), rankLooks: z.number(), parked: z.number(), full: z.array(z.enum(['difference', 'unsure'])) }),
  }),
};

/** The readings of Battle imports that wait for the player to say which hero a tile shows (ADR 0040). */
export const parkedReadingsContract = {
  /**
   * The parked readings, oldest first, `limit` of them from `offset` (20 by default), of one `kind` or of all. `total` counts the readings of the
   * kind asked for, and `counts` every kind, with the caps.
   */
  list: endpoint({ method: 'GET', path: '/api/admin/parked-readings', query: z.object({ offset: z.string().optional(), limit: z.string().optional(), kind: z.string().optional() }), response: z.custom<ParkedList>() }),
  image: endpoint({ method: 'GET', path: '/api/admin/parked-readings/:id/image', response: Binary }),
  /** The player says which hero the tile shows: it becomes a Hero Example, unless a tile just like it is already one. The reading leaves the list either way. */
  confirm: endpoint({ method: 'POST', path: '/api/admin/parked-readings/:id/confirm', body: z.custom<{ hero: string }>(), response: z.object({ learnt: z.boolean() }) }),
  /** The player puts the reading aside: it and its picture are deleted and nothing is learnt. */
  dismiss: endpoint({ method: 'DELETE', path: '/api/admin/parked-readings/:id', response: z.undefined(), status: 204 }),
};
