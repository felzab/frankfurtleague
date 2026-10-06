/** A league season's rules as most suites read one: two groups of four, the top two through. */
const UEBLICH = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
} as const;

/** Each count as a number and each array as a mutable one, as the schema's type declares them, so a fixture assigns to it. */
type Assignable<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends readonly (infer U)[] ? U[] : T[K] };

/** What a call hands back, never inferred from the type it is assigned to, which would answer for a rule this file lacks. */
type Rules<T> = Assignable<Omit<typeof UEBLICH, keyof NoInfer<T>> & NoInfer<T>>;

// Typed by its call site rather than by `FLSaisonRules`: `shared` imports no `features`, and the
// assignment to a fixture's declared type is where a rule the schema adds is missed.
/** A season's rules, `UEBLICH` under the ones a case varies; every call hands out arrays of its own. */
export function saisonRules<const T extends object = Record<never, never>>(varied?: T): Rules<T> {
  return { ...UEBLICH, erlaubte_stufen: [...UEBLICH.erlaubte_stufen], ...varied } as Rules<T>;
}
