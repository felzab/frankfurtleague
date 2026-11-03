/**
 * The season's own address, its Spielplan: no pop-up. The catch-all beside this route matches every address
 * below the season but not the season's own, so a client navigation to the Spielplan, the pop-up's close among
 * them where the tab holds no history, would otherwise keep it showing; Next's recipe closes it here (parallel
 * routes, "Closing the modal").
 */
export default function NoPopupOnSpielplan() {
  return null;
}
