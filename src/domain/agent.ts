import { z } from 'zod';
import { integerFrom, problemWith } from './schema.js';

/** A model name goes onto a command line, so it is kept to a plain word that cannot read as a flag. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const MODEL_NAME_MESSAGE = 'The model name may only use letters, digits and . _ : / - , and cannot start with a dash';

const MAX_TIMEOUT_MINUTES = 120;

/** What the Agent is asked: to answer a scenario, or to explain a Review run (ADR 0032). */
export type AgentRequest = { id: number } | { reviewRun: number };

export interface AgentCommand {
  command: string;
  args: string[];
  /** Extra environment variables for the process. */
  env?: Record<string, string>;
}

export interface AgentSettings {
  preset: string;
  model: string;
  timeoutMinutes: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = { preset: 'claude', model: 'opus', timeoutMinutes: 10 };

const scenarioPrompt = (id: number) =>
  `Read AGENTS.md in this directory first and follow it. Answer scenario ${id}: run \`npm run query -- scenario --id ${id}\`, use the recorded history as AGENTS.md describes, and reply with the estimate as plain text. You cannot write files or the database; the app will save your reply as the estimate, so do not try to save it.`;

const promptFor = (s: AgentRequest) =>
  'reviewRun' in s
    ? `Read AGENTS.md in this directory first and follow it. Explain Reader review run ${s.reviewRun}: run \`npm run query -- review --run ${s.reviewRun}\`, and reply with the explanation text alone, as AGENTS.md describes. Do not change anything.`
    : scenarioPrompt(s.id);

/**
 * Every agent the app can start. Each is read-only in its own way, checked against the real tool:
 * - claude: `--allowedTools` limits it to the query CLI.
 * - opencode: only `run --standalone` honours the permissions given in OPENCODE_CONFIG_CONTENT (without it a
 *   background service is used and the config is ignored), and they allow nothing but the query CLI.
 * codex is left out until its read-only mode has been checked here.
 */
interface Preset {
  binary: string;
  command(model: string, scenario: AgentRequest): AgentCommand;
  /** What to run to read pictures (roster import); absent when the tool has not been checked to read images with nothing else allowed. */
  importCommand?(model: string, prompt: string): AgentCommand;
  /** The agent's answer, out of what the process printed. */
  reply(stdout: string): string;
  /** Models to choose from when the tool cannot list them itself. */
  models?: string[];
  /** Arguments that make the tool print its models, one per line. */
  listModels?: string[];
}

const OPENCODE_PERMISSIONS = {
  permission: { edit: 'deny', write: 'deny', webfetch: 'deny', bash: { '*': 'deny', 'npm run query*': 'allow' } },
};

/** opencode prints one JSON event per line; the answer is the text of the last message that has any. */
function opencodeReply(stdout: string): string {
  const texts: { message: string; text: string }[] = [];
  for (const line of stdout.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'text' && typeof event.part?.text === 'string') texts.push({ message: event.part.messageID, text: event.part.text });
    } catch {
      // not an event line
    }
  }
  const last = texts.at(-1)?.message;
  return texts.filter((t) => t.message === last).map((t) => t.text).join('');
}

const PRESETS: Record<string, Preset> = {
  claude: {
    binary: 'claude',
    command: (model, scenario) => ({
      command: 'claude',
      // the prompt comes right after -p: --allowedTools takes every argument after it as a tool name, so a prompt put last is swallowed
      args: ['-p', promptFor(scenario), '--model', model, '--allowedTools', 'Bash(npm run query:*)'],
    }),
    importCommand: (model, prompt) => ({ command: 'claude', args: ['-p', prompt, '--model', model, '--allowedTools', 'Read'] }),
    reply: (stdout) => stdout,
    models: ['opus', 'sonnet', 'haiku', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  },
  opencode: {
    binary: 'opencode',
    command: (model, scenario) => ({
      command: 'opencode',
      args: ['run', '--standalone', '--format', 'json', '-m', model, promptFor(scenario)],
      env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(OPENCODE_PERMISSIONS) },
    }),
    reply: opencodeReply,
    listModels: ['models'],
  },
};

export const AGENT_PRESETS = Object.keys(PRESETS);

/** What Admin needs to find a preset's tool and its models. */
export function agentTool(preset: string): { binary: string; models: string[] | null; listModels: string[] | null } | null {
  const found = PRESETS[preset];
  return found ? { binary: found.binary, models: found.models ?? null, listModels: found.listModels ?? null } : null;
}

/** The agent settings that can be saved: a known preset, a model name that is safe on a command line, and a time limit. */
export const AgentSettingsSchema = z.object(
  {
    preset: z.string({ error: `The agent must be one of ${AGENT_PRESETS.join(', ')}` }).refine((preset) => AGENT_PRESETS.includes(preset), `The agent must be one of ${AGENT_PRESETS.join(', ')}`),
    model: z.string({ error: MODEL_NAME_MESSAGE }).regex(MODEL_NAME, MODEL_NAME_MESSAGE),
    timeoutMinutes: integerFrom(1, MAX_TIMEOUT_MINUTES, `The time limit must be a whole number of minutes from 1 to ${MAX_TIMEOUT_MINUTES}`),
  },
  { error: 'Send the agent settings' },
);

/** Returns an error message, or null when the settings can be saved. */
export const validateAgentSettings = (input: unknown): string | null => problemWith(AgentSettingsSchema, input);

/** Returns what to run for an agent preset, or an error message. */
export function agentCommand(preset: string, model: string, scenario: AgentRequest): AgentCommand | { error: string } {
  const found = PRESETS[preset];
  if (!found) return { error: `Unknown agent preset "${preset}"` };
  if (!MODEL_NAME.test(model)) return { error: MODEL_NAME_MESSAGE };
  return found.command(model, scenario);
}

/** Whether the preset can read pictures: roster import needs it. */
export const canReadImages = (preset: string): boolean => PRESETS[preset]?.importCommand !== undefined;

/** Returns what to run for an agent preset to read pictures with the given prompt, or an error message. The agent may only read files. */
export function agentImportCommand(preset: string, model: string, prompt: string): AgentCommand | { error: string } {
  const found = PRESETS[preset];
  if (!found) return { error: `Unknown agent preset "${preset}"` };
  if (!found.importCommand) return { error: `The ${preset} agent has not been checked for reading pictures` };
  if (!MODEL_NAME.test(model)) return { error: MODEL_NAME_MESSAGE };
  return found.importCommand(model, prompt);
}

/** The agent's answer out of the text its process printed, or an empty string when there is none. */
export function agentReply(preset: string, stdout: string): string {
  return (PRESETS[preset]?.reply(stdout) ?? '').trim();
}

/** The models a tool printed (one per line), keeping only names that are safe to pass back as `--model`. */
export function parseModelList(stdout: string): string[] {
  return [...new Set(stdout.split('\n').map((line) => line.trim()).filter((line) => MODEL_NAME.test(line)))];
}
