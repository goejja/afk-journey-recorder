/** The agent runs one scenario estimate at a time, or a few picture readings at once, never both. Held in memory, so a restart begins idle. */
export interface AgentSlot {
  busy: boolean;
  /** How many picture readings are running. Pictures are read side by side, but never beside a scenario estimate. */
  importing: number;
}

export const newAgentSlot = (): AgentSlot => ({ busy: false, importing: 0 });
