// The one place the invite link is spelled, and `token` is its parameter name for the reason
// `fl_frontend/src/features/bewerbungen/bestaetigungLink.ts` records.
export function einladungsLink(origin: string, token: string): string {
  return `${origin}/registrierung?token=${encodeURIComponent(token)}`;
}
