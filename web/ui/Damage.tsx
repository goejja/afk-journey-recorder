import { formatDamage, formatDamageShort } from '../../src/domain/titan-reaver.js';

/** Titan Reaver damage in its short form (`1.23B`), with the exact number as its tooltip. */
export function Damage({ value }: { value: number }) {
  return <span title={formatDamage(value)}>{formatDamageShort(value)}</span>;
}
