/**
 * A pop-up whose match is not there, its id malformed or its season withheld, which only a crafted client
 * navigation reaches, since every link the site writes carries ids read off the backend: no pop-up, as the slot's
 * other routes close it. A segment's not-found boundary wraps its `children` alone, so the root's not-found page
 * never catches a throw inside this slot; this file is the slot's own boundary, and a reload of the address renders
 * the season route, whose own not-found page answers.
 */
export default function NoPopupFound() {
  return null;
}
