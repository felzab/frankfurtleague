/** The parameter the season selector writes and every season-scoped admin read resolves. */
export const SAISON_PARAM = "saison_id";

/**
 * Keeps the shell on the season the reader chose: the sidemenu and `SaisonSelector` both read the
 * CURRENT url, so a link dropping the parameter returns the whole shell to the default season.
 */
export function withSaisonId(path: string, saisonId: string | null | undefined): string {
  if (!saisonId) return path;

  const separatorAt = path.indexOf("?");
  const base = separatorAt === -1 ? path : path.slice(0, separatorAt);
  const params = new URLSearchParams(separatorAt === -1 ? "" : path.slice(separatorAt + 1));

  // A season the path already names is the subject's own, and outranks the shell's.
  if (params.has(SAISON_PARAM)) return path;
  params.set(SAISON_PARAM, saisonId);

  return `${base}?${params.toString()}`;
}
