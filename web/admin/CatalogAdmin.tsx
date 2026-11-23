import { useEffect, useRef, type ReactNode } from 'react';
import { MasterDetail } from '../ui/MasterDetail.js';
import { Notice } from '../ui/Notice.js';

interface Props<Item> {
  /** The catalog's name in the plural: "Artifacts". */
  label: string;
  /** One of them: "artifact". */
  noun: string;
  /** How many the catalog has, filters aside. */
  total: number;
  /** The items the filters let through, in the order of the list. */
  items: readonly Item[];
  keyOf: (item: Item) => string;
  /** The key of the open item; null while a new one is being made. */
  selected: string | null;
  /** Opens an item, or a new one for null; says whether it did (a discard confirmation may refuse). */
  open: (key: string | null) => Promise<boolean>;
  /** What a row of the list shows beside its button's frame. */
  row: (item: Item) => ReactNode;
  search?: { value: string; onChange: (value: string) => void };
  /** The filters under the search box; always shown. */
  filters?: ReactNode;
  /** The heading of the detail pane. */
  title: string;
  error: string | null;
  /** The fields and buttons of the open item. */
  children: ReactNode;
}

/**
 * The frame of an Admin catalog page: a toolbar with a New button, a searchable and filterable list, and a detail pane with Previous and
 * Next buttons that walk the filtered list (the arrow keys do the same while the list has focus). The page supplies the rows, the
 * filters and the fields.
 */
export function CatalogAdmin<Item>({ label, noun, total, items, keyOf, selected, open, row, search, filters, title, error, children }: Props<Item>) {
  const list = useRef<HTMLUListElement>(null);
  const focusOpen = useRef(false);
  const index = items.findIndex((item) => keyOf(item) === selected);

  // after a key moved the selection, the list keeps the focus on the open row
  useEffect(() => {
    if (!focusOpen.current) return;
    focusOpen.current = false;
    list.current?.querySelector<HTMLElement>('.map-item.active')?.focus();
  }, [selected]);

  const step = async (delta: -1 | 1, fromKey = false) => {
    const next = items[index + delta];
    if (!next) return;
    focusOpen.current = fromKey;
    if (!(await open(keyOf(next)))) focusOpen.current = false;
  };

  const detailHeader = (
    <div className="catalog-title">
      <h3>{title}</h3>
      {index >= 0 && (
        <span className="actions" role="group" aria-label={`Step through the ${label.toLowerCase()}`}>
          <button disabled={index === 0} onClick={() => void step(-1)}>
            Previous
          </button>
          <button disabled={index === items.length - 1} onClick={() => void step(1)}>
            Next
          </button>
        </span>
      )}
    </div>
  );

  return (
    <MasterDetail
      wide
      header={
        <div className="toolbar">
          <span className="muted">{`${total} ${label.toLowerCase()}`}</span>
          <button onClick={() => void open(null)}>{`New ${noun}`}</button>
        </div>
      }
      sidebarLabel={label}
      sidebarHeader={
        (search || filters) && (
          <div className="filters">
            {search && <input type="search" placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`} value={search.value} onChange={(e) => search.onChange(e.target.value)} />}
            {filters}
          </div>
        )
      }
      sidebar={
        <ul
          className="master-detail-list"
          aria-label={label}
          ref={list}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            void step(e.key === 'ArrowDown' ? 1 : -1, true);
          }}
        >
          {items.map((item) => (
            <li key={keyOf(item)}>
              <button className={keyOf(item) === selected ? 'map-item active' : 'map-item'} onClick={() => void open(keyOf(item))}>
                {row(item)}
              </button>
            </li>
          ))}
        </ul>
      }
      detailLabel={selected !== null ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} details for ${selected}` : `New ${noun} details`}
      detailHeader={detailHeader}
      detailKey={selected}
      detail={
        <div className="map-editor">
          {error && <Notice kind="error">{error}</Notice>}
          {children}
        </div>
      }
    />
  );
}
