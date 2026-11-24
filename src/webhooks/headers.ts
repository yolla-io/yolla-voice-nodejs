/** A Fetch `Headers` object or a plain object such as Node's `IncomingHttpHeaders`. */
export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

/** Reads a header case-insensitively; for a repeated header returns the first value. */
export function getHeader(headers: HeadersLike, name: string): string | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    // Headers joins repeated values with ", "; keep the first one.
    const value = headers.get(name);
    return value === null ? undefined : value.split(",")[0]?.trim();
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== lower) continue;
    const value = record[key];
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}
