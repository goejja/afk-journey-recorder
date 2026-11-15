import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  /** Page-level controls that remain visible above both panes. */
  header: ReactNode;
  /** Actions and filters that belong to the left-hand list, kept outside its scroll region. */
  sidebarHeader: ReactNode;
  sidebar: ReactNode;
  /** The selected item's title or other identifying context, kept above the detail scroll region. */
  detailHeader?: ReactNode;
  detail: ReactNode;
  sidebarLabel: string;
  detailLabel: string;
  /** Changing the selection resets the detail pane to its start. */
  detailKey?: string | number | null;
}

/** A master/detail workspace with one pinned header and independent list and detail scrolling on wide screens. */
export function MasterDetail({ header, sidebarHeader, sidebar, detailHeader, detail, sidebarLabel, detailLabel, detailKey }: Props) {
  const detailScroll = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (detailScroll.current) detailScroll.current.scrollTop = 0;
  }, [detailKey]);

  return (
    <section className="master-detail">
      <div className="master-detail-header">{header}</div>
      <div className="master-detail-columns">
        <aside className="master-detail-sidebar" aria-label={sidebarLabel}>
          <div className="master-detail-sidebar-head">{sidebarHeader}</div>
          <div className="master-detail-sidebar-scroll">{sidebar}</div>
        </aside>
        <section className="master-detail-main" aria-label={detailLabel}>
          {detailHeader !== undefined && <div className="master-detail-main-head">{detailHeader}</div>}
          <div className="master-detail-main-scroll" ref={detailScroll}>
            {detail}
          </div>
        </section>
      </div>
    </section>
  );
}
