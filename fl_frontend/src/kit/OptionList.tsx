"use client";

import { ListBox, ListBoxItem } from "react-aria-components/ListBox";
import { Popover } from "react-aria-components/Popover";

import { menuItem, menuPopover, messageLine } from "./fieldStyles";
import { Icon } from "./Icon";

import type { Copy } from "@/core/copy";

/**
 * One choice of a select or a combo box. Its label is a record's data, such as a team's name, so it is
 * a plain string; a choice that cannot be made stays in the list, disabled, with a short note why.
 */
export type Option = { id: string; label: string } & ({ isDisabled?: false; note?: never } | { isDisabled: true; note: Copy });

/**
 * The menu of choices under a select or a combo box, as wide as its field. A select hands it the
 * options; a combo box hands them to itself, which filters them as it is typed into.
 */
export function OptionList({ options }: { options?: readonly Option[] }) {
  return (
    <Popover
      data-kit-focus
      offset={4}
      className={menuPopover({ fit: "field" })}>
      <ListBox<Option>
        data-kit-focus
        items={options}>
        {(option) => (
          <ListBoxItem
            data-kit-focus="item"
            id={option.id}
            textValue={option.label}
            isDisabled={option.isDisabled}
            className={menuItem()}>
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
      </ListBox>
    </Popover>
  );
}
