/**
 * A Testing Library text matcher for the element holding `text` whole, where the words stand in parts of their own, as
 * an address standing as a name does (`fl_frontend/src/kit/AddressWords.tsx`): the default matcher reads an element's
 * own text alone and finds none of them.
 */
export function wholeText(text: string) {
  return (_: string, node: Element | null) => node?.textContent === text && ![...node.children].some((part) => part.textContent === text);
}
