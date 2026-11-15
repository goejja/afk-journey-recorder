const CHUNK_PATH = /\/_next\/static\/chunks\/[^"'\s\\]+?\.js/g;

/** Finds the script chunks a Next.js page references, so no hashed filename is hardcoded. */
export function discoverChunkUrls(html: string, origin: string): string[] {
  const paths = new Set(html.match(CHUNK_PATH) ?? []);
  return [...paths].map((path) => new URL(path, origin).href);
}
