/** Same as the app's capitalize(): trims, collapses spaces and upper-cases each word's first letter. */
export function capitalize(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Trims every entry, drops empty ones and removes case-insensitive duplicates (first one wins). */
export function cleanReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of reasons) {
    const value = raw.trim().replace(/\s+/g, ' ');
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
