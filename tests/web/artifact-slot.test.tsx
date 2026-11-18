// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactSlot } from '../../web/ArtifactSlot.js';
import { RECORD_ARTIFACT_SIZE, RECORD_PORTRAIT_SIZE } from '../../web/map-size.js';

afterEach(cleanup);

const drawn = (container: HTMLElement) => (container.querySelector('.hex-slot-inner img') as HTMLImageElement).style.width;
const slot = (props: { size?: number; readOnly?: boolean }) => (
  <ArtifactSlot side="a" label="artifact" artifacts={[]} value="Bladestorm" onChange={() => undefined} {...props} />
);

describe('ArtifactSlot', () => {
  it('draws the artifact at 36px by default, for the 52px tile', () => {
    expect(drawn(render(slot({})).container)).toBe('36px');
  });

  it('draws it at the size it is given, on the slot button and on the read-only slot', () => {
    expect(drawn(render(slot({ size: 48 })).container)).toBe('48px');
    cleanup();
    expect(drawn(render(slot({ size: 48, readOnly: true })).container)).toBe('48px');
  });
});

describe('the record artifact size', () => {
  it('is about as big as a hero portrait on the same map, so the artifact fills its hexagon', () => {
    expect(RECORD_ARTIFACT_SIZE).toBe(48);
    expect(Math.abs(RECORD_ARTIFACT_SIZE - RECORD_PORTRAIT_SIZE)).toBeLessThanOrEqual(2);
  });
});
