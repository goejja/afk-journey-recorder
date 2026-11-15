import { describe, expect, it } from 'vitest';
import { promptFor } from '../../src/domain/roster-import-prompt.js';

const files = { sheets: ['sheet-1.png'], name: null, strips: [{ id: 'p1', file: 'strip-1.png', count: 5, player: 0 }], players: 1, skipped: 0, ranks: ['Elite', 'Epic', 'Supreme'] };

describe('promptFor', () => {
  it('says which screen it is, lists the strips and the ranks, and asks for JSON only', () => {
    const text = promptFor('info', files);
    expect(text).toContain('Player Info');
    expect(text).toContain('- player 1, "p1" (5 tiles): strip-1.png');
    expect(text).toContain('Elite, Epic, Supreme');
    expect(text).toContain('Reply with one JSON object only');
    expect(promptFor('hall', files)).toContain('Resonating Hall');
    expect(promptFor('report', files)).toContain('with "fight"');
  });

  it('names the players image, the strips left out and the likely heroes only when there are some', () => {
    const plain = promptFor('battle', files);
    expect(plain).not.toContain('most likely heroes');
    expect(plain).not.toContain('The player names are on this image');
    const text = promptFor('battle', { ...files, name: 'names.png', skipped: 1, likely: { strips: ['p1'], heroes: ['Evie', 'Zed'] } });
    expect(text).toContain('The player names are on this image: names.png');
    expect(text).toContain('already read');
    expect(text).toContain('"p1" are most likely heroes the viewer owns: Evie, Zed');
  });

  it('asks for the artifact only when a side leaves it to the Agent', () => {
    const extras = { artifactSheets: ['art.png'], phantimalSheets: [], phantimalNames: ['Orson'], sides: [{ player: 0, artifact: null, phantimal: 'ph-1.png' }], artifacts: true };
    const withArtifact = promptFor('report', { ...files, extras });
    expect(withArtifact).toContain('"artifact": {"name"');
    expect(withArtifact).toContain('Reference artifacts, with their names under them, are on these contact sheets: art.png');
    expect(withArtifact).toContain('There are no phantimal pictures');
    const phantimalOnly = promptFor('report', { ...files, extras: { ...extras, artifacts: false, sides: [{ player: 0, artifact: 'a.png', phantimal: 'ph-1.png' }] } });
    expect(phantimalOnly).not.toContain('"artifact": {"name"');
    expect(phantimalOnly).toContain('Phantimal crops, per player:');
  });
});
