import { z } from 'zod';
import { CleanupDeleteSchema, CleanupSelectionSchema } from '../../domain/cleanup.js';
import { ThinningApplySchema } from '../../domain/thinning.js';
import type { ReviewExplainJob, ReviewRun, ThinningProposal } from '../api.js';
import { endpoint } from '../contract.js';

const DISMISSAL_MESSAGE = 'Give the code, subject and message of the finding';
/** A finding named by what makes it the same finding in two runs (ADR 0032). */
export const FindingIdentitySchema = z.object(
  { code: z.string({ error: DISMISSAL_MESSAGE }), subject: z.string({ error: DISMISSAL_MESSAGE }), message: z.string({ error: DISMISSAL_MESSAGE }) },
  { error: DISMISSAL_MESSAGE },
);

const FILES_MESSAGE = 'Give the files to delete as a list of names like rank-look/12.png, at least one';
/** The unreferenced files the player ticked, as the findings name them (folder and file). */
export const DeleteFilesSchema = z.object({ files: z.array(z.string({ error: FILES_MESSAGE }), { error: FILES_MESSAGE }).min(1, FILES_MESSAGE) }, { error: FILES_MESSAGE });

const DISTANCE_MESSAGE = 'rank must be a number above 0 and at most 0.2';
export const ThinningSettingsSchema = z.object({ rank: z.number({ error: DISTANCE_MESSAGE }).gt(0, DISTANCE_MESSAGE).max(0.2, DISTANCE_MESSAGE) }, { error: DISTANCE_MESSAGE });

const Run = z.custom<ReviewRun>();
const ThinningSettingsView = z.object({ rank: z.number(), defaults: z.object({ rank: z.number() }) });
const Deleted = z.object({ deleted: z.number() });
const ExplainJob = z.custom<ReviewExplainJob>();

export const reviewContract = {
  /** Removes the unreferenced files the player ticked, when the scan still offers them. */
  deleteFiles: endpoint({ method: 'POST', path: '/api/admin/review/files/delete', body: DeleteFilesSchema, response: Deleted }),
  findings: endpoint({ method: 'GET', path: '/api/admin/review/findings', response: z.custom<ReviewRun['findings']>() }),
  dismiss: endpoint({ method: 'POST', path: '/api/admin/review/dismissals', body: FindingIdentitySchema, response: FindingIdentitySchema, status: 201 }),
  restore: endpoint({ method: 'DELETE', path: '/api/admin/review/dismissals', body: FindingIdentitySchema, response: FindingIdentitySchema }),
  /** Looks again at everything and keeps the result as a Review run (ADR 0032). */
  startRun: endpoint({ method: 'POST', path: '/api/admin/review/runs', response: Run, status: 201 }),
  runs: endpoint({ method: 'GET', path: '/api/admin/review/runs', response: z.array(z.object({ id: z.number(), createdAt: z.string() })) }),
  latestRun: endpoint({ method: 'GET', path: '/api/admin/review/runs/latest', response: Run.nullable() }),
  thinning: endpoint({ method: 'GET', path: '/api/admin/review/thinning', response: z.custom<ThinningProposal>() }),
  applyThinning: endpoint({ method: 'POST', path: '/api/admin/review/thinning/apply', body: ThinningApplySchema, response: Deleted }),
  thinningSettings: endpoint({ method: 'GET', path: '/api/thinning-settings', response: ThinningSettingsView }),
  saveThinningSettings: endpoint({ method: 'PUT', path: '/api/thinning-settings', body: ThinningSettingsSchema, response: ThinningSettingsView }),
  resetThinningSettings: endpoint({ method: 'DELETE', path: '/api/thinning-settings', response: ThinningSettingsView }),
  /** Asks the Agent to explain a Review run in the background; answers at once with the running job. */
  explain: endpoint({ method: 'POST', path: '/api/admin/review/runs/:id/explain', response: ExplainJob, status: 202 }),
  explainJob: endpoint({ method: 'GET', path: '/api/admin/review/explain', response: ExplainJob.nullable() }),
};

export const cleanupContract = {
  preview: endpoint({ method: 'POST', path: '/api/cleanup/preview', body: CleanupSelectionSchema, response: z.object({ count: z.number(), oldest: z.string().nullable(), newest: z.string().nullable() }) }),
  /** `expectedCount` is the count the person saw in the preview; if the selection has changed since, nothing is removed. */
  delete: endpoint({ method: 'POST', path: '/api/cleanup/delete', body: CleanupDeleteSchema, response: Deleted, badBody: 400 }),
  optimize: endpoint({ method: 'POST', path: '/api/cleanup/optimize', response: z.object({ bytesBefore: z.number(), bytesAfter: z.number() }) }),
};
