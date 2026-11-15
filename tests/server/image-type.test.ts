import { describe, expect, it } from 'vitest';
import { imageType } from '../../src/server/image-type.js';

const bytes = (...values: number[]) => Uint8Array.from([...values, ...Array(12).fill(0)]);

describe('imageType', () => {
  it('names a PNG, JPEG, GIF and WebP picture from its first bytes', () => {
    expect(imageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe('png');
    expect(imageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpg');
    expect(imageType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('gif');
    expect(imageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('webp');
  });

  it('is null for anything else, a RIFF file that is not WebP and an empty file included', () => {
    expect(imageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
    expect(imageType(new Uint8Array())).toBeNull();
    expect(imageType(bytes(0x25, 0x50, 0x44, 0x46))).toBeNull();
  });
});
