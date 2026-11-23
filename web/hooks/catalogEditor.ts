import { useCallback, useRef, useState } from 'react';
import { useAction } from './action.js';
import { useConfirmActions } from './confirm.js';

interface Options<Item, Draft> {
  /** The catalog as last read. */
  items: readonly Item[];
  /** Reads the catalog again (a page's `useLoad(...).reload`); the items it answers with, or undefined when the read failed. */
  reloadItems: () => Promise<readonly Item[] | undefined>;
  keyOf: (item: Item) => string;
  toDraft: (item: Item) => Draft;
  /** The draft of a new item. */
  blank: () => Draft;
  /** Whether two drafts are the same to save; by default, whether they hold the same values. */
  same?: (a: Draft, b: Draft) => boolean;
  /** What a page keeps beside the draft (the Heroes page's PVP hint and attributes): whether it is unsaved, and how it follows the selected item. */
  extra?: { dirty: (current: Item | null) => boolean; show: (item: Item | undefined) => void };
}

/**
 * What the Admin catalog pages (Artifacts, Phantimals, Heroes) share: the selected item, the draft being typed, whether it is unsaved,
 * opening another item after a discard confirmation, saving and deleting through `useAction`, and reading the catalog again and opening
 * the saved item. A page supplies its fields and what it saves; `CatalogAdmin` draws the list and the detail frame.
 */
export function useCatalogEditor<Item, Draft>(options: Options<Item, Draft>) {
  const { items, keyOf, toDraft, blank, extra, same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b) } = options;
  // the page's functions are rebuilt on every render; `show` and `reload` read the latest ones and stay the same function
  const latest = useRef(options);
  latest.current = options;
  const [selected, setSelected] = useState<string | null>(null); // null while creating
  const [draft, setDraft] = useState<Draft>(blank);
  const { error, busy, setError, run: act } = useAction();
  const { confirmDelete, confirmDiscard, dialog } = useConfirmActions(act);

  const current = items.find((item) => keyOf(item) === selected) ?? null;
  const dirty = (current ? !same(draft, toDraft(current)) : !same(draft, blank())) || (extra?.dirty(current) ?? false);

  const show = useCallback((key: string | null, list: readonly Item[]) => {
    const o = latest.current;
    setSelected(key);
    const item = list.find((i) => o.keyOf(i) === key);
    setDraft(item ? o.toDraft(item) : o.blank());
    o.extra?.show(item);
  }, []);

  /** Reads the catalog again; with `select` (a saved item's key, or null for a new one) the page then opens it. */
  const reload = useCallback(
    async (select?: string | null) => {
      const list = await latest.current.reloadItems();
      if (list && select !== undefined) show(select, list);
    },
    [show],
  );

  /** Does an action that answers the key of the item to open next (null for none), then reads the catalog again. */
  const run = (action: () => Promise<string | null | undefined>) => act(action, reload);

  /** Opens an item, or a new one for null, asking first when the draft is unsaved. Says whether it opened. */
  async function open(key: string | null): Promise<boolean> {
    if (dirty && !(await confirmDiscard())) return false;
    setError(null);
    show(key, items);
    return true;
  }

  /** Saves the draft: the page's call answers the saved item, which is then opened. */
  const save = (call: () => Promise<Item>) => run(async () => keyOf(await call()));

  /** Deletes the open item after asking. */
  const remove = async (question: string, call: () => Promise<unknown>) => {
    if (await confirmDelete(question)) {
      void run(async () => {
        await call();
        return null;
      });
    }
  };

  return { selected, current, draft, setDraft, dirty, error, setError, busy, open, save, remove, reload, run, dialog };
}
