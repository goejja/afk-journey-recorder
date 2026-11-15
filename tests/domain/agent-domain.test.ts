import { describe, expect, it } from 'vitest';
import { agentCommand, agentReply, AGENT_PRESETS, parseModelList } from '../../src/domain/agent.js';

const scenario = { id: 7, name: 'Week 3 league' };

describe('agentCommand', () => {
  it('runs claude headless, limited to the read-only query CLI, with the chosen model', () => {
    const result = agentCommand('claude', 'opus', scenario);
    if ('error' in result) throw new Error(result.error);
    expect(result.command).toBe('claude');
    expect(result.args).toEqual(expect.arrayContaining(['-p', '--model', 'opus']));
    const allowed = result.args[result.args.indexOf('--allowedTools') + 1];
    expect(allowed).toBe('Bash(npm run query:*)');
  });

  it('has a prompt, right after -p, that names the scenario, points at AGENTS.md and says the app saves the answer', () => {
    const result = agentCommand('claude', 'opus', scenario);
    if ('error' in result) throw new Error(result.error);
    const prompt = result.args[result.args.indexOf('-p') + 1]!;
    expect(prompt).toContain('scenario 7');
    expect(prompt).toContain('npm run query -- scenario --id 7');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).toMatch(/do not save|will save/i);
    expect(prompt).not.toContain('scenario:estimate');
  });

  it.each(['', 'opus; rm -rf /', '--dangerously-skip-permissions', 'a b', '$(whoami)'])('rejects the model name %j', (model) => {
    expect(agentCommand('claude', model, scenario)).toEqual({ error: expect.stringMatching(/model/i) });
  });

  it('accepts the usual model name shapes', () => {
    for (const model of ['opus', 'claude-opus-5-5', 'sonnet','openai/gpt-5', 'llama3.1:8b']) {
      expect(agentCommand('claude', model, scenario)).not.toHaveProperty('error');
    }
  });

  it('rejects a preset that is not in the list', () => {
    expect(agentCommand('rm -rf /', 'opus', scenario)).toEqual({ error: expect.stringMatching(/preset/i) });
  });
});

describe('the opencode preset', () => {
  it('runs a private server so that its read-only permissions apply, and only allows the query CLI', () => {
    const result = agentCommand('opencode', 'ollama-cloud/gemma4:31b', scenario);
    if ('error' in result) throw new Error(result.error);
    expect(result.command).toBe('opencode');
    expect(result.args.slice(0, 2)).toEqual(['run', '--standalone']);
    expect(result.args).toEqual(expect.arrayContaining(['--format', 'json', '-m', 'ollama-cloud/gemma4:31b']));
    expect(result.args.at(-1)).toContain('npm run query -- scenario --id 7');

    const permission = JSON.parse(result.env!['OPENCODE_CONFIG_CONTENT']!).permission;
    expect(permission).toMatchObject({ edit: 'deny', write: 'deny', webfetch: 'deny' });
    expect(permission.bash).toEqual({ '*': 'deny', 'npm run query*': 'allow' });
  });

  it('shares the model name checks', () => {
    expect(agentCommand('opencode', '-m evil', scenario)).toEqual({ error: expect.stringMatching(/model/i) });
  });

  it('is listed as a preset, while codex is not until its read-only mode can be checked', () => {
    expect(AGENT_PRESETS).toEqual(['claude', 'opencode']);
    expect(agentCommand('codex', 'gpt-6', scenario)).toEqual({ error: expect.stringMatching(/preset/i) });
  });
});

describe('agentReply', () => {
  it('takes what claude printed as the answer', () => {
    expect(agentReply('claude', '\n  Put A in front.\n')).toBe('Put A in front.');
  });

  it('takes the text of the last message from opencode events, not its tool calls or earlier thoughts', () => {
    const events = [
      '{"type":"step_start","part":{"messageID":"m1","type":"step-start"}}',
      '{"type":"text","part":{"messageID":"m1","type":"text","text":"Let me look."}}',
      '{"type":"tool_use","part":{"messageID":"m1","type":"tool","tool":"shell","state":{"output":"{ \\"records\\": [] }"}}}',
      'not json at all',
      '{"type":"step_start","part":{"messageID":"m2","type":"step-start"}}',
      '{"type":"text","part":{"messageID":"m2","type":"text","text":"Team 1: A, B."}}',
      '{"type":"text","part":{"messageID":"m2","type":"text","text":" Confidence low."}}',
    ].join('\n');
    expect(agentReply('opencode', events)).toBe('Team 1: A, B. Confidence low.');
  });

  it('is empty when opencode said nothing, and for a preset it does not know', () => {
    expect(agentReply('opencode', '{"type":"tool_use","part":{"messageID":"m1","type":"tool"}}\n')).toBe('');
    expect(agentReply('codex', 'something')).toBe('');
  });
});

describe('parseModelList', () => {
  it('keeps one usable model name per line, once, and drops anything else', () => {
    const printed = ['github-copilot/claude-haiku-5.5', '', 'ollama-cloud/gemma4:31b', 'github-copilot/claude-haiku-5.5', 'Error: not logged in', '--help', '  opencode-go/glm-5.2  '].join('\n');
    expect(parseModelList(printed)).toEqual(['github-copilot/claude-haiku-5.5', 'ollama-cloud/gemma4:31b', 'opencode-go/glm-5.2']);
  });
});

describe('agentCommand for explaining a Review run', () => {
  const review = { reviewRun: 7 };

  it('names the run and the read-only command, and points at AGENTS.md for how to answer', () => {
    const result = agentCommand('claude', 'opus', review);
    if ('error' in result) throw new Error(result.error);
    const prompt = result.args[result.args.indexOf('-p') + 1]!;
    expect(prompt).toContain('review run 7');
    expect(prompt).toContain('npm run query -- review --run 7');
    expect(prompt).toContain('AGENTS.md');
    expect(prompt).not.toMatch(/scenario/i);
  });

  it('is as read-only as an answer to a scenario: claude is limited to the query CLI', () => {
    const result = agentCommand('claude', 'opus', review);
    if ('error' in result) throw new Error(result.error);
    expect(result.args[result.args.indexOf('--allowedTools') + 1]).toBe('Bash(npm run query:*)');
  });

  it('is as read-only as an answer to a scenario: opencode only allows the query CLI', () => {
    const result = agentCommand('opencode', 'ollama-cloud/gemma4:31b', review);
    if ('error' in result) throw new Error(result.error);
    expect(result.args.at(-1)).toContain('npm run query -- review --run 7');
    expect(JSON.parse(result.env!.OPENCODE_CONFIG_CONTENT!).permission.bash).toEqual({ '*': 'deny', 'npm run query*': 'allow' });
  });

  it('still rejects a model name that could read as a flag', () => {
    expect(agentCommand('claude', '--dangerously-skip-permissions', review)).toEqual({ error: expect.stringMatching(/model/i) });
  });
});
