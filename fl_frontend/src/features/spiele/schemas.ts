// Redesign: goes with its last importer.
import z from "zod";

// The old match form's own judgement of its draft, in words an administrator reads, before its action sends the
// write through the generated client, which types the body against the write's published contract.

/**
 * Kept out of `ergebnis`: both ends parse that string for win/draw/loss and a third number reads as
 * malformed. The counts are not goals — the bracket takes a winner from them, the table the draw.
 * The winner is derived, never stored.
 */
export const FLSpielElfmeterschiessenSchema = z
  .object({
    // On the TYPE check: an emptied box arrives as `null`, failing `z.int()` first.
    team1: z.int({ error: "Bitte gib die Treffer von Team 1 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
    team2: z.int({ error: "Bitte gib die Treffer von Team 2 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
  })
  // Mirrors the model validator: a level shoot-out names nobody, leaving a filled-in record that
  // implies a winner the fixture does not have.
  .refine((schiessen) => schiessen.team1 !== schiessen.team2, {
    error: "Ein Elfmeterschießen kann nicht unentschieden enden.",
    path: ["team2"],
  });
