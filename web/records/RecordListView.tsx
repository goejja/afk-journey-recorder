import type { ReactNode } from 'react';
import type { Loaded } from '../hooks/load.js';
import { ListStatus } from '../ui/ListStatus.js';
import { Notice } from '../ui/Notice.js';
import { ShowMore } from '../ui/ShowMore.js';
import { RecordList, type GroupedList, type Groupable, type ListItem } from './GroupedList.js';

/**
 * What a record list shows under its toolbar: the error and the notice, the cards (dimmed while a new answer loads), the button for older
 * fights when there are some, and what the list says when it has none.
 */
export function RecordListView<F extends Groupable>({
  list,
  loaded,
  error,
  notice,
  label,
  battle,
  fight,
  renderItem,
  older,
  olderLabel,
  onOlder,
  empty,
  filtered,
  none,
  noMatch,
}: {
  list: GroupedList<F>;
  loaded: Loaded<F[]>;
  error: string | null;
  notice: string | null;
  label: string;
  battle: string;
  fight: string;
  renderItem: (item: ListItem<F>) => ReactNode;
  older: boolean;
  olderLabel: string;
  onOlder: () => void;
  empty: boolean;
  filtered: boolean;
  none: string;
  noMatch: string;
}) {
  return (
    <>
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="error">{notice}</Notice>}
      <div className={loaded.loading && loaded.data ? 'refreshing' : undefined} aria-busy={loaded.loading}>
        <RecordList list={list} label={label} battle={battle} fight={fight} renderItem={renderItem} />
      </div>
      {older && <ShowMore label={olderLabel} onMore={onOlder} />}
      <ListStatus loaded={loaded.data !== undefined} failed={loaded.error !== null} empty={empty} filtered={filtered} none={none} noMatch={noMatch} />
    </>
  );
}
