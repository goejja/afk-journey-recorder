import { vi } from 'vitest';
import type { JobsSummary } from '../../../web/backend.js';

/** The browser's `EventSource`, as far as the job watcher uses it. */
class FakeEventSource {
  static open = new Set<FakeEventSource>();
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.open.add(this);
    // like the server, a new stream starts with where the jobs stand
    queueMicrotask(() => latest && this.onmessage?.({ data: JSON.stringify(latest) }));
  }
  close() {
    FakeEventSource.open.delete(this);
  }
}

let latest: JobsSummary | null = null;

/** Stands in for `GET /api/jobs/stream` in a test: `send` is what the server pushes, `drop` is the connection failing. */
export const jobsStream = {
  install() {
    latest = null;
    FakeEventSource.open.clear();
    vi.stubGlobal('EventSource', FakeEventSource);
  },
  send(summary: JobsSummary) {
    latest = summary;
    FakeEventSource.open.forEach((source) => source.onmessage?.({ data: JSON.stringify(summary) }));
  },
  drop() {
    FakeEventSource.open.forEach((source) => source.onerror?.());
  },
  get opened() {
    return FakeEventSource.open.size;
  },
};
