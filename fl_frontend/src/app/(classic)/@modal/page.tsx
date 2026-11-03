/**
 * The landing's own address: no pop-up. The catch-all beside this route matches every address below the frame
 * but not `/` itself, so a client navigation back to the landing, the pop-up's close among them where the tab
 * holds no history, would otherwise keep it showing; Next's recipe closes it here (parallel routes, "Closing
 * the modal").
 */
export default function NoPopupOnLanding() {
  return null;
}
