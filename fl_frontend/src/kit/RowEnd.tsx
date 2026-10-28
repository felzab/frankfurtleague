import { Icon } from "./Icon";

/**
 * What says a row leads on: the chevron at the end of a row in a list, a table or a card, in the muted
 * colour. Hidden from assistive technology with every glyph, since the row's link already says where it goes.
 */
export function RowEnd() {
  return (
    <span className="flex shrink-0 items-center self-stretch text-fg-muted">
      <Icon
        glyph="vor"
        size={16}
      />
    </span>
  );
}
