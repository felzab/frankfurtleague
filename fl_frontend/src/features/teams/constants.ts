/**
 * TEAMS · constants
 *
 * The placeholder team's shorthand. An unresolved playoff opponent is currently a REAL team document
 * with `is_placeholder: true`, not a null reference — which is why a two-character shorthand has to
 * exist for it at all.
 *
 * That modelling is known to be wrong and is tracked as BE-9: the intended fix is a nullable opponent
 * on the Spiel, at which point this constant and the placeholder team both disappear.
 */

// The shorthand the backend assigns to an unresolved playoff participant. It constrains
// FLSpielTeamFieldSchema.shorthand (spiele/schemas.ts), which is z.string().length(2).
export const TBD_TEAM_SHORTHAND = "??";
