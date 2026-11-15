import { z } from 'zod';
import type { ArenaMode, LearnedView, ReaderView } from '../api.js';
import { Binary, endpoint } from '../contract.js';

// The learned pictures and reader examples the Admin review looks at (ADR 0012). The bodies are typed, not checked by the schema: the
// handlers check them and keep their own messages.
export const learnedContract = {
  view: endpoint({ method: 'GET', path: '/api/admin/learned', response: z.custom<LearnedView>() }),
  image: endpoint({ method: 'GET', path: '/api/admin/learned/:kind/:id/image', response: Binary }),
  /** Moves a Rank Look to another rank; answers how many looks the rank reader names wrong before and after. */
  moveRank: endpoint({ method: 'PATCH', path: '/api/admin/learned/rank/:id', body: z.custom<{ rank: string }>(), response: z.object({ wrongBefore: z.number(), wrongAfter: z.number() }) }),
  moveUnit: endpoint({ method: 'PATCH', path: '/api/admin/learned/unit/:id', body: z.custom<{ name: string }>(), response: z.undefined(), status: 204 }),
  remove: endpoint({ method: 'DELETE', path: '/api/admin/learned/:kind/:id', response: z.undefined(), status: 204 }),
  removeSource: endpoint({ method: 'DELETE', path: '/api/admin/learned/source/:source', response: z.object({ deleted: z.number() }) }),
};

export const readerExamplesContract = {
  view: endpoint({ method: 'GET', path: '/api/admin/reader', response: z.custom<ReaderView>() }),
  image: endpoint({ method: 'GET', path: '/api/admin/reader/:kind/:id/image', response: Binary }),
  move: endpoint({ method: 'PATCH', path: '/api/admin/reader/:kind/:id', body: z.custom<{ hero: string }>(), response: z.undefined(), status: 204 }),
  remove: endpoint({ method: 'DELETE', path: '/api/admin/reader/:kind/:id', response: z.undefined(), status: 204 }),
};

export const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const PICTURE_MESSAGE = 'Send the fight and its picture as a data URL';
/** The original picture of a saved Battle import, as a data URL, with the fight it showed. */
export const KeptPictureBody = z.object(
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
    response: z.object({ logged: z.number(), looks: z.number(), heroExamples: z.number(), rankLooks: z.number() }),
  }),
};
