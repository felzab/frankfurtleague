/**
 * Every other address under the season: no pop-up. A client navigation keeps a parallel slot's last page
 * showing until its address matches another of the slot's routes, so a link inside the pop-up, such as a club's
 * name, would leave it open over the page it opens; this route matches every such address and closes it, Next's
 * documented way to close an intercepted modal (parallel routes, "Closing the modal").
 */
export default function NoPopupHere() {
  return null;
}
