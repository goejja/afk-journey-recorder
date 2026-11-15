/** The types of picture the server takes, by the file extension they are saved under. */
export type ImageType = 'png' | 'jpg' | 'webp' | 'gif';

/** The type of a picture from its first bytes, or null when they are not those of a PNG, JPEG, WebP or GIF image. */
export function imageType(bytes: Uint8Array): ImageType | null {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (startsWith(0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'jpg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  return null;
}
