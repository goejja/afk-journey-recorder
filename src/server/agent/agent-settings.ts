import type Database from 'better-sqlite3';
import { Hono } from 'hono';
import { agentTool, AGENT_PRESETS, DEFAULT_AGENT_SETTINGS, parseModelList, type AgentSettings } from '../../domain/agent.js';
import type { AgentProbe } from './agent-probe.js';
import { agentContract } from '../../shared/contracts/agent.js';
import { serve } from '../contract.js';

/** The saved agent choice, or the defaults when none is saved. */
export function loadAgentSettings(db: Database.Database): AgentSettings {
  const row = db.prepare('SELECT preset, model, timeout_minutes AS timeoutMinutes FROM agent_setting WHERE id = 1').get() as AgentSettings | undefined;
  return row ?? DEFAULT_AGENT_SETTINGS;
}

interface ToolInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
  models: string[] | null;
  modelsError?: string;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Routes for choosing which agent answers scenarios, and for finding which are installed and what models they offer. */
export function agentSettingsRoutes(db: Database.Database, probe: AgentProbe): Hono {
  const app = new Hono();
  // What the last look found. Kept in memory: looking runs programs, so it only happens when asked.
  let tools: Record<string, ToolInfo> = {};
  const view = () => ({ ...loadAgentSettings(db), presets: [...AGENT_PRESETS], tools });

  async function look(preset: string): Promise<ToolInfo> {
    const tool = agentTool(preset)!;
    const path = await probe.find(tool.binary);
    if (!path) return { installed: false, path: null, version: null, models: null };
    const version = await probe.run(path, ['--version']).then((out) => out.trim().split('\n')[0] || null, () => null);
    if (tool.models) return { installed: true, path, version, models: tool.models };
    try {
      return { installed: true, path, version, models: parseModelList(await probe.run(path, tool.listModels!)) };
    } catch (error) {
      return { installed: true, path, version, models: null, modelsError: reasonOf(error) };
    }
  }

  serve(app, agentContract.settings, view);

  serve(app, agentContract.refresh, async () => {
    const found: Record<string, ToolInfo> = {};
    for (const preset of AGENT_PRESETS) found[preset] = await look(preset);
    tools = found;
    return view();
  });

  serve(app, agentContract.save, ({ body }) => {
    db.prepare(
      `INSERT INTO agent_setting (id, preset, model, timeout_minutes) VALUES (1, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET preset = excluded.preset, model = excluded.model, timeout_minutes = excluded.timeout_minutes`,
    ).run(body.preset, body.model, body.timeoutMinutes);
    return view();
  });

  return app;
}
