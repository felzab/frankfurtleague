/**
 * Every other address below the landing's: no pop-up. A client navigation keeps a parallel slot's last page
 * showing until its address matches another of the slot's routes, so this route matches every such address and
 * closes it, Next's documented way to close an intercepted modal (parallel routes, "Closing the modal").
 */
export default function NoPopupHere() {
  return null;
}
