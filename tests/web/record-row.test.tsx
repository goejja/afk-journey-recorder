// @vitest-environment jsdom
import { cleanup, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RecordRow } from '../../web/ui/RecordRow.js';

afterEach(cleanup);

describe('RecordRow', () => {
  it('keeps row facts and actions in their shared regions', () => {
    render(
      <RecordRow actions={<><button>Make current</button><button>Remove</button></>}>
        <strong>Season 8</strong>
        <span className="badge">current</span>
        <span className="muted">3 stages · 2 phantimals</span>
      </RecordRow>,
    );

    const row = document.querySelector('.attempt-top') as HTMLElement;
    const info = within(row).getByText('Season 8').parentElement as HTMLElement;
    const actions = within(row).getByRole('button', { name: 'Make current' }).parentElement as HTMLElement;
    expect(info.classList.contains('attempt-info')).toBe(true);
    expect(within(info).getByText('current')).toBeTruthy();
    expect(actions.classList.contains('attempt-actions')).toBe(true);
    expect(within(actions).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('supports dense inline editing in the information region', () => {
    render(
      <RecordRow infoClassName="record-row-edit" actions={<><button className="primary">Save</button><button>Cancel</button></>}>
        <input className="small" aria-label="New tag name" value="Luna" readOnly />
      </RecordRow>,
    );

    const info = document.querySelector('.attempt-info') as HTMLElement;
    expect(info.classList.contains('record-row-edit')).toBe(true);
    expect(within(info).getByLabelText('New tag name')).toBeTruthy();
    expect(document.querySelector('.attempt-actions')?.textContent).toBe('SaveCancel');
  });
});