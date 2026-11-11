"use client";

import { ToggleButton } from "react-aria-components/ToggleButton";
import { ToggleButtonGroup } from "react-aria-components/ToggleButtonGroup";

import { choiceButton, choiceGroup } from "./fieldStyles";
import { Icon } from "./Icon";
import { placeholderBar } from "./Skeleton";
import { Tooltip } from "./Tooltip";

import type { Copy } from "@/core/copy";
import type { IconName } from "./Icon";

/** An answer drawn as a glyph alone, such as a theme's: `label` names it for assistive technology and in its tooltip. */
export type GlyphChoice = { id: string; glyph: IconName; label: Copy };

/**
 * A setting acting at once, each answer a glyph alone named by its tooltip, in a row the caller writes, such as the
 * account menu's theme row: the segments of `Segmented`'s frame (`ChoiceButtons`), named by `label` for assistive
 * technology. React Aria's `ToggleButtonGroup` in single selection, its segments buttons, since a tooltip opens from a
 * button's own hover and focus, which a radio's visually hidden input never takes under a pointer: no form posts it,
 * so nothing here is required or refused. `null` chooses none while the answer is not known, as a theme is not before
 * the page hydrates. A module of its own, so the rail's menu, its one caller, brings no radio or checkbox group.
 */
export function GlyphChoices({
  label,
  choices,
  value,
  onChange,
}: {
  label: Copy;
  choices: readonly GlyphChoice[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={value === null ? [] : [value]}
      // Every choice's id is a string, and a single choice never goes empty, so one string comes back.
      onSelectionChange={(keys) => onChange(String([...keys][0]))}
      className={choiceGroup({ kind: "segmented" })}>
      {choices.map((choice) => (
        <Tooltip
          key={choice.id}
          label={choice.label}>
          <ToggleButton
            id={choice.id}
            aria-label={choice.label}
            data-kit-focus="ring"
            className={choiceButton({ kind: "segmented", content: "glyph" })}>
            <Icon
              glyph={choice.glyph}
              size={16}
            />
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}

/** `GlyphChoices` while it waits: the frame, and each segment's glyph as a bar in its place. */
export function GlyphChoicesPlaceholder({ count }: { count: number }) {
  return (
    <span className={choiceGroup({ kind: "segmented" })}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={choiceButton({ kind: "segmented", content: "glyph" })}>
          <span className={placeholderBar("size-4")} />
        </span>
      ))}
    </span>
  );
}
