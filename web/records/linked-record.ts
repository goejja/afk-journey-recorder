import { useEffect, useRef, useState } from 'react';
import { recordOfHash } from '../../src/domain/record-link.js';
import { useLoad } from '../hooks/load.js';

/** Takes `record` out of the page address, and leaves the rest of it (the Stages page keeps its state there) as it was. */
export function dropRecordFromAddress(): void {
  const hash = window.location.hash;
  if (!hash.includes('?')) return;
  const query = new URLSearchParams(hash.slice(hash.indexOf('?') + 1));
  if (!query.has('record')) return;
  query.delete('record');
  const text = query.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash.slice(0, hash.indexOf('?'))}${text ? `?${text}` : ''}`);
}

/**
 * The record a link names (`#arena?record=12`), read once when the page opens: it is asked for by its id, whatever its age, and `open`
 * gets it once, to show its edit form. `record` leaves the address when the form closes or the record is gone, so a reload does not
 * open the form again. Answers the message of a record that could not be read, or null.
 */
export function useLinkedRecord<T>(read: (id: number) => Promise<T>, open: (record: T) => void, formOpen: boolean): string | null {
  const [id] = useState(() => recordOfHash(window.location.hash));
  const loaded = useLoad(() => read(id!), [id], id !== null);
  const opened = useRef(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (loaded.data === undefined || opened.current) return;
    opened.current = true;
    open(loaded.data);
  }, [loaded.data, open]);

  useEffect(() => {
    if (wasOpen.current && !formOpen) dropRecordFromAddress();
    wasOpen.current = formOpen;
  }, [formOpen]);

  useEffect(() => {
    if (loaded.error !== null) dropRecordFromAddress();
  }, [loaded.error]);

  return loaded.error;
}
