/** Hue (degrees; -1 for a grey, which has none), saturation and value (0 to 1) of an RGB pixel (channels 0 to 255). */
export type Hsv = [number, number, number];

export const hsvOf = (r: number, g: number, b: number): Hsv => {
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = -1;
  if (delta) {
    h = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? delta / max : 0, max / 255];
};
