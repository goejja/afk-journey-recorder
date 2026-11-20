import { describe, expect, it } from 'vitest';
import { recordLink, recordOfHash, recordPage } from '../../src/domain/record-link.js';

describe('the page of a record', () => {
  it('sends Stage to Stages, Dream Hunt to Dream Hunt and every other mode to PvP', () => {
    expect(recordPage('Stage')).toBe('stages');
    expect(recordPage('Dream Hunt')).toBe('dreamHunt');
    for (const mode of ['Arena', 'Supreme Arena', 'Super League', 'Guild Duel', 'Treasure Rush']) expect(recordPage(mode)).toBe('arena');
  });

  it('names no page for a record without a mode', () => {
    expect(recordPage('')).toBeNull();
    expect(recordLink('', 4)).toBeNull();
  });

  it('writes the address that opens the record', () => {
    expect(recordLink('Stage', 7)).toBe('#stages?record=7');
    expect(recordLink('Dream Hunt', 8)).toBe('#dreamHunt?record=8');
    expect(recordLink('Guild Duel', 9)).toBe('#arena?record=9');
  });
});

describe('the record an address names', () => {
  it('reads it, among other state of the page', () => {
    expect(recordOfHash('#arena?record=12')).toBe(12);
    expect(recordOfHash('#stages?phase=2&record=3&open=2%3Aapex-normal')).toBe(3);
  });

  it('names none for an address without it or with one that is no id', () => {
    for (const hash of ['', '#arena', '#arena?phase=2', '#arena?record=', '#arena?record=abc', '#arena?record=0', '#arena?record=1.5', '#arena?record=-2']) expect(recordOfHash(hash)).toBeNull();
  });
});
