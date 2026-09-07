// The one place a link is spelled. `token` is the parameter name because
// `nginx/prod.conf :: $credential_free_uri` matches that name; a second spelling reaches the access
// line and the referer unredacted, and one module keeps a rename one edit.
export function bestaetigungsLink(origin: string, token: string): string {
  return `${origin}/bestaetigung?token=${encodeURIComponent(token)}`;
}
