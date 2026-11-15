/** A name made safe to use as a file name: anything but letters, digits, space and a few marks becomes `_`. */
export const safeFileName = (name: string) => name.replace(/[^\w .&'-]/g, '_');
