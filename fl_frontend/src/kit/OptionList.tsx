"use client";

import { Collection } from "react-aria-components/Collection";
import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";
import { Separator } from "react-aria-components/Separator";

import { textOf } from "@/core/copy";

import { menuItem, messageLine } from "./fieldStyles";
import { Icon } from "./Icon";
import { entryMark, menuPopover } from "./menuStyles";

import type { Copy, Words } from "@/core/copy";

/**
 * One choice of a select or a combo box. Its label is the catalogue's word, or a record's data such as a team's
 * name; a choice that cannot be made stays in the list, disabled, with a short note why where one says more than the
 * muted entry does. A choice that is a colour, such as a shirt's, shows its `swatch` before its label, the label kept
 * so the colour never carries the meaning alone.
 */
export type Option = { id: string; label: Words; swatch?: `#${string}` } & (
  { isDisabled?: false; note?: never } | { isDisabled: true; note?: Copy }
);

/**
 * An entry that acts rather than chooses, such as a combo box's „Spielort anlegen“, which creates the record
 * the list lacks: last in the list, under a hairline. Choosing it leaves the field's value as it was. `typed`
 * is the field's text, which the entry's filter text ends with, so a combo box's filter always keeps it.
 */
export type ActEntry = { label: Copy; typed: string; onAction: () => void };

/**
 * The menu of choices under a select or a combo box, the chosen one marked as every list marks it: as wide as its
 * longest choice and never narrower than its field, a choice too long for the screen cut short. A combo box filters the
 * options as it is typed into, and `empty` is the muted row standing where its text matches none; an act entry stands
 * last, under the hairline a menu draws between its groups, which is not drawn over the entry standing alone.
 */
export function OptionList({ options, empty, act }: { options: readonly Option[]; empty?: Copy; act?: ActEntry }) {
  return (
    <Popover
      data-kit-focus
      offset={4}
      className={menuPopover({ fit: "content" })}>
      <ListBox
        data-kit-focus
        // React Aria's own empty row, outside the collection, so no press or key can choose it and it posts nothing.
        renderEmptyState={
          empty === undefined
            ? undefined
            : () => (
                <span className="flex min-h-8 items-center px-3 text-sm text-fg-muted pointer-coarse:min-h-10 pointer-coarse:text-base">
                  {empty}
                </span>
              )
        }>
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
                  <span className="flex min-w-0 items-center gap-2">
                    {option.swatch !== undefined && (
                      <span
                        aria-hidden
                        // The colour is the record's data, one of many, so it is painted inline rather than named as a
                        // class; the ring gives a white swatch its edge on the light ground and a black one on the dark.
                        className="size-4 shrink-0 rounded-full inset-ring inset-ring-border-control"
                        style={{ backgroundColor: option.swatch }}
                      />
                    )}
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{textOf(option.label)}</span>
                      {option.note !== undefined && <span className={messageLine({ tone: "description", width: "words" })}>{option.note}</span>}
                    </span>
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
