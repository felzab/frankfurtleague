// Session 6: goes with the old team editor, the group swap's last old caller.
import { SERVER_COPY } from "@/core/serverCopy";
import { isRefusal } from "@/shared/utils/actionError";

/**
 * The group swap's refusals, or `null`. The first three mean the picture moved under a stale page, so
 * each says to reload; `swap_sides_taken_place` has no client counterpart and arrives on a current page, so it names a
 * repair.
 */
export function mapSwapRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // One club named on both sides is among them, which the picker offers only on a page gone stale: the
    // same sentence and the same reload serve it.
    case "swap_not_a_swap":
      return "Die beiden Teams stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.";
    case "saison_past":
      return "Diese Saison ist inzwischen abgeschlossen. Lade die Seite neu.";
    case "swap_saison_started":
      return "Diese Saison hat inzwischen begonnen. Lade die Seite neu.";
    // Before the start, so a result entered early: the swap moves no goals and would hand it to the other club.
    case "swap_sides_taken_place":
      return SERVER_COPY.admin.swapSidesTakenPlace;
    default:
      return null;
  }
}
