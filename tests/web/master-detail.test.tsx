// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MasterDetail } from '../../web/ui/MasterDetail.js';

const makeView = (detailKey: string) => (
  <MasterDetail
    header={<h2>Roster</h2>}
    sidebarLabel="Profiles"
    sidebarHeader={<button>New profile</button>}
    sidebar={<button>Default profile</button>}
    detailLabel="Hero details"
    detailHeader={<h3>Default</h3>}
    detailKey={detailKey}
    detail={<div style={{ height: 2000 }}>Heroes</div>}
  />
);

afterEach(cleanup);

describe('MasterDetail', () => {
  it('keeps the page header, sidebar controls, and detail heading outside their scroll regions', () => {
    const { container } = render(makeView('default'));
    expect(screen.getByRole('heading', { name: 'Roster' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Profiles' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New profile' }).parentElement?.className).toBe('master-detail-sidebar-head');
    expect(screen.getByRole('heading', { name: 'Default' }).parentElement?.className).toBe('master-detail-main-head');
    expect(container.querySelector('.master-detail-sidebar-scroll')?.textContent).toContain('Default profile');
    expect(container.querySelector('.master-detail-main-scroll')?.textContent).toContain('Heroes');
  });

  it('resets the detail scroll position when the selected master changes', () => {
    const view = render(makeView('default'));
    const detailScroll = view.container.querySelector('.master-detail-main-scroll') as HTMLElement;
    detailScroll.scrollTop = 120;
    view.rerender(makeView('friend'));
    expect(detailScroll.scrollTop).toBe(0);
  });
});