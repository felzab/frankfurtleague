/**
 * One declaration's source, up to the one named after it — `to === null` reaches the module's end.
 *
 * Empty when either boundary is missing, so a boundary that stopped matching fails the test
 * pinning the cut, not every assertion reading the slice.
 */
export function sliceBetween(source: string, from: string, to: string | null): string {
  const start = source.indexOf(from);
  if (start === -1) return "";
  const end = to === null ? source.length : source.indexOf(to, start + from.length);

  return end === -1 ? "" : source.slice(start, end);
}
