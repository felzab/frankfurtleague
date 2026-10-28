"use client";

import { Collection } from "react-aria-components/Collection";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";
import { Separator } from "react-aria-components/Separator";

import { entryMark, menuItem, menuPopover, messageLine } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";

/**
 * One choice of a select or a combo box. Its label is a record's data, such as a team's name, so it is
 * a plain string; a choice that cannot be made stays in the list, disabled, with a short note why.
 */
export type Option = { id: string; label: string } & ({ isDisabled?: false; note?: never } | { isDisabled: true; note: Copy });

/**
 * An entry that acts rather than chooses, such as a combo box's „Spielort anlegen …“, which creates the record
 * the list lacks: last in the list, under a hairline. Choosing it leaves the field's value as it was.
 */
export type ActEntry = { label: Copy; onAction: () => void };

/**
 * The menu of choices under a select or a combo box, the chosen one marked as a form's value: as wide as its
 * field, or as its longest entry under a field sized to its choices. A combo box filters the options as it is
 * typed into; an act entry stands last, under the hairline a menu draws between its groups, which is not
 * drawn over the entry standing alone.
 */
export function OptionList({ options, fit = "field", act }: { options: readonly Option[]; fit?: "field" | "content"; act?: ActEntry }) {
  return (
    <Popover
      data-kit-focus
      offset={4}
      className={menuPopover({ fit })}>
      <ListBox data-kit-focus>
        <Collection items={options}>
          {(option) => (
            <ListBoxItem
              data-kit-focus="item"
              id={option.id}
              textValue={option.label}
              isDisabled={option.isDisabled}
              className={`${menuItem()} ${entryMark({ mark: "value" })}`}>
              {({ isSelected }) => (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{option.label}</span>
                    {option.note !== undefined && <span className={messageLine({ tone: "description" })}>{option.note}</span>}
                  </span>
                  {isSelected && (
                    <Icon
                      glyph="haken"
                      size={16}
                    />
                  )}
                </>
              )}
            </ListBoxItem>
          )}
        </Collection>
        {act !== undefined && (
          <>
            <Separator className="my-1 border-t border-border first:hidden" />
            <ListBoxItem
              data-kit-focus="item"
              textValue={act.label}
              onAction={act.onAction}
              className={menuItem()}>
              {act.label}
            </ListBoxItem>
          </>
        )}
      </ListBox>
    </Popover>
  );
}
