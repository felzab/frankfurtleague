/**
 * An instant as the backend serves it. The grants' read models pass the store's naive UTC through with no
 * offset, which `new Date` would read in the runtime's own zone; one carrying an offset is read as written.
 */
export function servedInstant(stamp: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(stamp) ? stamp : `${stamp}Z`);
}
