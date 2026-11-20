// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loading, ListStatus } from '../../web/ui/ListStatus.js';
import { Notice } from '../../web/ui/Notice.js';
import { ShowMore } from '../../web/ui/ShowMore.js';

afterEach(cleanup);

describe('Notice', () => {
  it('is an alert for an error, with the error look', () => {
    render(<Notice kind="error">The map could not be read</Notice>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('The map could not be read');
    expect(alert.className).toBe('error');
    expect(alert.tagName).toBe('P');
  });

  it('is a plain status for a success and a status with the warning look for a warning', () => {
    render(
      <>
        <Notice kind="success">Saved 1 fight.</Notice>
        <Notice kind="warning" title="Why">
          Team 1: Deployment changed?
        </Notice>
      </>,
    );
    const [saved, warning] = screen.getAllByRole('status');
    expect(saved!.className).toBe('');
    expect(warning!.className).toBe('badge few');
    expect(warning!.getAttribute('title')).toBe('Why');
  });

  it('is a span inside a line of text when asked', () => {
    render(
      <p>
        Name <Notice kind="error" as="span">is taken</Notice>
      </p>,
    );
    expect(screen.getByRole('alert').tagName).toBe('SPAN');
  });
});

describe('Loading', () => {
  it('says Loading… as a muted line', () => {
    render(<Loading />);
    expect(screen.getByText('Loading…').className).toBe('muted');
  });

  it('is what a list shows until its first answer, and ListStatus says nothing after a failure', () => {
    const props = { empty: true, filtered: false, none: 'Nothing yet', noMatch: 'No match' };
    const { rerender } = render(<ListStatus loaded={false} failed={false} {...props} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    rerender(<ListStatus loaded failed={false} {...props} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    rerender(<ListStatus loaded failed {...props} />);
    expect(screen.queryByText('Nothing yet')).toBeNull();
  });
});

describe('ShowMore', () => {
  it('says how many rows are left and asks for the next page', () => {
    const onMore = vi.fn();
    render(<ShowMore left={7} onMore={onMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show more (7 left)' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('is disabled while a page is on its way, and draws nothing when no row is left', () => {
    const { rerender, container } = render(<ShowMore left={3} busy onMore={() => undefined} />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    rerender(<ShowMore left={0} onMore={() => undefined} />);
    expect(container.textContent).toBe('');
  });

  it('takes a label, and without a count shows just the label', () => {
    const onMore = vi.fn();
    render(<ShowMore label="Show older fights" onMore={onMore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show older fights' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });
});
