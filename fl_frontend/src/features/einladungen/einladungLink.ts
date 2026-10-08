// The one place the invite link is spelled, and `token` is its parameter name for the reason
// `fl_frontend/src/core/kontaktLink.ts :: kontaktBestaetigungsLink` records.
export function einladungsLink(origin: string, token: string): string {
  return `${origin}/registrierung?token=${encodeURIComponent(token)}`;
}
