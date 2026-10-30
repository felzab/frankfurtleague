/**
 * One club's season membership as `GET /teams/saisons` serves it, so a field the read gains is added
 * here once. Untyped: a typed suite parses it through its mirror.
 */
export const membershipAnswer = (overrides: Record<string, unknown> = {}) => ({
  saison_id: "2526",
  gruppe: "A",
  austritt: null,
  trikot_farbe: null,
  kontakte: null,
  confirmations: null,
  address_change: null,
  kontakte_stand: "",
  ...overrides,
});
