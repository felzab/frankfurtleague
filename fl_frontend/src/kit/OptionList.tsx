"use client";

import { Collection } from "react-aria-components/Collection";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";
import { Separator } from "react-aria-components/Separator";

import { textOf } from "@/core/copy";

import { entryMark, menuItem, menuPopover, messageLine } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy, Words } from "@/core/copy";

/**
 * One choice of a select or a combo box. Its label is the catalogue's word, or a record's data such as a team's
 * name; a choice that cannot be made stays in the list, disabled, with a short note why where one says more than the
 * muted entry does.
 */
export type Option = { id: string; label: Words } & ({ isDisabled?: false; note?: never } | { isDisabled: true; note?: Copy });

/**
 * An entry that acts rather than chooses, such as a combo box's „Spielort anlegen“, which creates the record
 * the list lacks: last in the list, under a hairline. Choosing it leaves the field's value as it was. `typed`
 * is the field's text, which the entry's filter text ends with, so a combo box's filter always keeps it.
 */
export type ActEntry = { label: Copy; typed: string; onAction: () => void };

/**
 * The menu of choices under a select or a combo box, the chosen one marked as every list marks it: as wide as its
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
              data-kit-focus="option"
              id={option.id}
              textValue={textOf(option.label)}
              isDisabled={option.isDisabled}
              className={`${menuItem()} ${entryMark({ mark: "chosen" })}`}>
              {({ isSelected }) => (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{textOf(option.label)}</span>
                    {/* The several-line recipe: the one-line one's `contain-inline-size` leaves a note no width inside an entry. */}
                    {option.note !== undefined && <span className={messageLine({ tone: "description", lines: "several" })}>{option.note}</span>}
                  </span>
                  {isSelected && (
                    <Icon
                      glyph="check"
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
              data-kit-focus="option"
              // React Aria's filter reads an entry's text alone; holding what is typed, as React Aria's own create
              // action names it, the entry matches every text while no option of the same name does.
              textValue={`${act.label} ${act.typed}`}
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
