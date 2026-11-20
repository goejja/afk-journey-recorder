import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { JobsSummary } from '../../../web/backend.js';
import { JobsProvider } from '../../../web/jobs/JobsProvider.js';
import { ToastProvider } from '../../../web/ui/Toast.js';

const IDLE_QUEUE = { active: 0, failed: 0, done: 0, signature: '' };

/** What `GET /api/jobs/stream` pushes in a test (see `jobsStream`): nothing runs except what the test gives. */
export const jobsBody = (jobs: Partial<JobsSummary> = {}): JobsSummary => ({ scenarios: {}, review: null, roster: IDLE_QUEUE, battle: IDLE_QUEUE, ...jobs });

/** Renders a page inside the app's job watcher and toasts, as `App` does; `page` is the page of the app the person is on. */
export const renderWithJobs = (ui: ReactElement, page = 'none') =>
  render(
    <ToastProvider>
      <JobsProvider page={page}>{ui}</JobsProvider>
    </ToastProvider>,
  );
