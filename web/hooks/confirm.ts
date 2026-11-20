import { useConfirm } from '../ui/Dialog.js';
import type { useAction } from './action.js';

/** The questions a page asks before it changes or drops something, over `run` of its `useAction`; `dialog` is the element to render. */
export function useConfirmActions(run: ReturnType<typeof useAction>['run']) {
  const { confirm, dialog } = useConfirm();

  const confirmDelete = (title: string) => confirm({ title, confirmLabel: 'Delete', danger: true });
  const confirmDiscard = () => confirm({ title: 'Discard your unsaved changes?', confirmLabel: 'Discard', danger: true });

  /** Asks the question as a danger dialog and, when it is confirmed, does the action as `run` does; says whether it ran and worked. */
  const confirmRun = async <T,>(question: { title: string; message?: string; confirmLabel: string }, action: () => Promise<T>, after?: (result: T) => unknown, done?: string | ((result: T) => string)): Promise<boolean> =>
    (await confirm({ ...question, danger: true })) ? run(action, after, done) : false;

  return { confirm, confirmDelete, confirmDiscard, confirmRun, dialog };
}
