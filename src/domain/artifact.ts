import { z } from 'zod';
import { problemWith } from './schema.js';
import { PRE_SEASON_GROUP } from './stage.js';

/** The group an artifact of a season carries: 'Season 8'. */
export const seasonGroup = (season: number): string => `Season ${season}`;

const GROUP_MESSAGE = `The group is ${PRE_SEASON_GROUP} or one season, such as ${seasonGroup(8)}`;

/** A group an artifact can have: Pre-Season or one season. */
const ArtifactGroupSchema = z.string({ error: GROUP_MESSAGE }).refine((group) => group === PRE_SEASON_GROUP || /^Season [1-9]\d*$/.test(group), GROUP_MESSAGE);

/** What an artifact is created or renamed with: a name, which is trimmed, and its group. */
export const ArtifactBodySchema = z.object(
  { name: z.string({ error: 'An artifact needs a name' }).trim().min(1, 'An artifact needs a name'), group: ArtifactGroupSchema },
  { error: 'An artifact needs a name' },
);

/** Returns an error message when the text is not a group an artifact can have (Pre-Season or one season), else null. */
export const artifactGroupProblem = (group: unknown): string | null => problemWith(ArtifactGroupSchema, group);
