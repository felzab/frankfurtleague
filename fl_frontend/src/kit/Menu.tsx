"use client";

import { useState, useSyncExternalStore } from "react";

import {
  Menu as AriaMenu,
  MenuContext,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover,
  Separator,
  SubmenuTrigger,
} from "react-aria-components/Menu";

import { COPY } from "@/core/copy";

import { useOpenUntilHidden } from "./Dialog";
import { entryMark, menuPopover } from "./fieldStyles";
import { Icon } from "./Icon";
import { menuEntry } from "./Link";
import { SheetFrame } from "./Sheet";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { IconName } from "./Icon";

/**
 * A link in a menu; `isCurrent` marks the one in force as the rail marks the current page, in a list that has
 * one. Its words are catalogue text, or a record's own name such as a season's.
 * @awaitsPage the first page that builds a menu's entries
 */
export type MenuLink = { href: Route; icon?: IconName; isCurrent?: boolean } & (
  { label: Copy; text?: never } | { text: string; label?: never }
) & {
    /** How the router goes there, `replace` for a step Back should skip (React Aria's `routerOptions`). */
    routerOptions?: ComponentProps<typeof MenuItem>["routerOptions"];
  };

/**
 * One entry of a menu: a link, an action, or a second list of links.
 * @awaitsPage the first page that builds a menu's entries
 */
export type MenuEntry =
  | ({ kind: "link" } & MenuLink)
  | { kind: "action"; label: Copy; icon?: IconName; onAction: () => void }
  /** A second list, beside the menu on desktop and as a second sheet with „Zurück“ on a phone. */
  | { kind: "submenu"; label: Copy; icon?: IconName; links: ReadonlyArray<MenuLink> };

export type MenuProps = {
  /** The menu's name. */
  label: Copy;
  /** The kit control that opens it. */
  trigger: ReactElement;
  /** Plain text above the entries, such as a person's name and address: data, not catalogue text. */
  head?: { name: string; detail: string };
  /** The entries, a separator between two groups. */
  groups: ReadonlyArray<ReadonlyArray<MenuEntry>>;
  /** Where the menu opens on desktop: under its trigger, or above it for a trigger at the rail's foot. */
  placement: "below" | "above";
  /** On desktop, as wide as its entries with the menu's floor, or as wide as a full-width trigger such as the rail's. */
  width?: "content" | "trigger";
  /** One row after the entries: its words at the start, a control at the end, such as the theme's glyphs. */
  foot?: { label: Copy; control: ReactNode };
};

type Size = "desktop" | "phone";

/**
 * The rail's breakpoint, `lg`, read from its token on the root as Tailwind's guide reads a theme variable in
 * script: from it the rail stands, below it the phone's bars and sheets.
 */
const desktop = () => window.matchMedia(`(min-width: ${getComputedStyle(document.documentElement).getPropertyValue("--breakpoint-lg")})`);

function subscribe(onChange: () => void) {
  const query = desktop();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the rail stands. The server answers desktop; a menu renders its list only once opened. */
function useDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => desktop().matches,
    () => true,
  );
}

// An entry that acts keeps the arrow; an entry with an address renders an `a`, which shows the pointing hand
// as every link does, so it takes `menuEntry` alone.
const item = tv({ extend: menuEntry, base: "cursor-default" });

// The foot's row under its separator, at the entries' inset and grade.
const foot = tv({
  base: "mt-1 flex items-center justify-between gap-3 border-t border-border px-3",
  variants: {
    size: {
      desktop: "pt-2 pb-1 text-sm",
      phone: "pt-3 pb-2 text-base",
    },
  },
});

// A menu dims nothing and blurs nothing: it stands on the page in the select's menu look.
const surface = (width: "content" | "trigger" = "content") => menuPopover({ fit: width === "trigger" ? "trigger" : "menu" });

function Entry({ label, icon, hasMore }: { label: string; icon?: IconName; hasMore?: boolean }) {
  return (
    <>
      {icon !== undefined && (
        <span className="text-fg-muted">
          <Icon
            glyph={icon}
            size={16}
          />
        </span>
      )}
      <span className="min-w-0 truncate">{label}</span>
      {hasMore === true && (
        <span className="ml-auto text-fg-muted">
          <Icon
            glyph="vor"
            size={16}
          />
        </span>
      )}
    </>
  );
}

/** The current link of a list, which its section selects; `null` where the list marks none. */
function current(links: ReadonlyArray<MenuLink>) {
  return links.find((link) => link.isCurrent === true)?.href ?? null;
}

/** A link, marked as the rail marks the current page where its section selects it. */
function LinkItem({ link, size }: { link: MenuLink; size: Size }) {
  return (
    <MenuItem
      id={link.href}
      href={link.href}
      routerOptions={link.routerOptions}
      textValue={link.label ?? link.text}
      data-kit-focus="item"
      className={`${menuEntry({ size })} ${entryMark({ mark: "place" })}`}>
      <Entry
        label={link.label ?? link.text}
        icon={link.icon}
      />
    </MenuItem>
  );
}

/** A list of links in its own menu: the desktop submenu, or the phone's second sheet after „Zurück“. */
function LinkList({ label, links, size, onBack }: { label: Copy; links: ReadonlyArray<MenuLink>; size: Size; onBack?: () => void }) {
  const key = current(links);
  return (
    <AriaMenu
      aria-label={label}
      data-kit-focus
      className="grid gap-1">
      {/* „Zurück“ stands outside the links' section, so it is no choice among them. */}
      {onBack !== undefined && (
        <MenuItem
          textValue={COPY.shared.zurueck}
          shouldCloseOnSelect={false}
          onAction={onBack}
          data-kit-focus="item"
          className={item({ size })}>
          <Entry
            label={COPY.shared.zurueck}
            icon="zurueck"
          />
        </MenuItem>
      )}
      <MenuSection
        aria-label={label}
        className="grid gap-1"
        selectionMode={key === null ? "none" : "single"}
        selectedKeys={key === null ? [] : [key]}>
        {links.map((link) => (
          <LinkItem
            key={link.href}
            link={link}
            size={size}
          />
        ))}
      </MenuSection>
    </AriaMenu>
  );
}

function Group({ entries, size, onOpenSubmenu }: { entries: ReadonlyArray<MenuEntry>; size: Size; onOpenSubmenu: (entry: number) => void }) {
  const key = current(entries.flatMap((entry) => (entry.kind === "link" ? [entry] : [])));

  return (
    <MenuSection
      className="grid gap-1"
      selectionMode={key === null ? "none" : "single"}
      selectedKeys={key === null ? [] : [key]}>
      {entries.map((entry, index) => {
        if (entry.kind === "link") {
          return (
            <LinkItem
              key={entry.href}
              link={entry}
              size={size}
            />
          );
        }
        if (entry.kind === "action") {
          return (
            <MenuItem
              key={entry.label}
              textValue={entry.label}
              onAction={entry.onAction}
              data-kit-focus="item"
              className={item({ size })}>
              <Entry
                label={entry.label}
                icon={entry.icon}
              />
            </MenuItem>
          );
        }
        const opener = (
          <MenuItem
            key={entry.label}
            textValue={entry.label}
            // On a phone the entry opens a second sheet over the first, so the menu stays open.
            shouldCloseOnSelect={size === "desktop"}
            onAction={size === "phone" ? () => onOpenSubmenu(index) : undefined}
            data-kit-focus="item"
            className={item({ size })}>
            <Entry
              label={entry.label}
              icon={entry.icon}
              hasMore
            />
          </MenuItem>
        );
        if (size === "phone") {
          return opener;
        }
        return (
          <SubmenuTrigger key={entry.label}>
            {opener}
            <Popover
              data-kit-focus
              className={surface()}>
              <LinkList
                label={entry.label}
                links={entry.links}
                size={size}
              />
            </Popover>
          </SubmenuTrigger>
        );
      })}
    </MenuSection>
  );
}

function Head({ head, size }: { head: NonNullable<MenuProps["head"]>; size: Size }) {
  return (
    <div className={size === "desktop" ? "grid px-3 py-2 text-sm" : "grid px-3 pt-3 pb-2 text-base"}>
      <span className="truncate font-semibold">{head.name}</span>
      <span className="truncate font-numeric text-xs text-fg-muted">{head.detail}</span>
    </div>
  );
}

function Entries({
  label,
  groups,
  size,
  onOpenSubmenu,
}: {
  label: Copy;
  groups: MenuProps["groups"];
  size: Size;
  onOpenSubmenu: (group: number, entry: number) => void;
}) {
  return (
    <AriaMenu
      aria-label={label}
      data-kit-focus
      className="grid gap-1">
      {groups.flatMap((entries, group) => [
        ...(group > 0
          ? [
              <Separator
                key={`separator-${group}`}
                className="my-1 border-t border-border"
              />,
            ]
          : []),
        <Group
          key={`group-${group}`}
          entries={entries}
          size={size}
          onOpenSubmenu={(entry) => onOpenSubmenu(group, entry)}
        />,
      ])}
    </AriaMenu>
  );
}

/**
 * The row at the menu's foot, under a hairline and outside React Aria's menu, whose keyboard model it leaves
 * whole: the words at the start name what the control at the end sets.
 */
function Foot({ foot: row, size }: { foot: NonNullable<MenuProps["foot"]>; size: Size }) {
  return (
    <div className={foot({ size })}>
      <span className="font-medium text-fg">{row.label}</span>
      {row.control}
    </div>
  );
}

/**
 * Choosing among actions: entries at 6-px corners, a separator between groups. On desktop it opens on the
 * page, a submenu beside it; on a phone, below the rail's breakpoint, as a bottom sheet, a submenu as a
 * second sheet led by „Zurück“.
 */
export function Menu({ label, trigger, head, groups, placement, width = "content", foot: row }: MenuProps) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  // The submenu last opened stays mounted while its sheet leaves, so its exit can run.
  const [submenu, setSubmenu] = useState<{ group: number; entry: number } | null>(null);
  const [isSubmenuOpen, setSubmenuOpen] = useState(false);
  const isDesktop = useDesktop();
  const shown = submenu === null ? undefined : groups[submenu.group]?.[submenu.entry];

  return (
    <MenuTrigger
      isOpen={isOpen}
      onOpenChange={(next) => {
        setOpen(next);
        setSubmenuOpen(false);
      }}>
      {trigger}
      {isDesktop ? (
        <Popover
          placement={placement === "above" ? "top start" : "bottom start"}
          offset={4}
          data-kit-focus
          className={surface(width)}>
          {head !== undefined && (
            <Head
              head={head}
              size="desktop"
            />
          )}
          <Entries
            label={label}
            groups={groups}
            size="desktop"
            onOpenSubmenu={() => undefined}
          />
          {row !== undefined && (
            <Foot
              foot={row}
              size="desktop"
            />
          )}
        </Popover>
      ) : (
        <SheetFrame label={label}>
          {head !== undefined && (
            <Head
              head={head}
              size="phone"
            />
          )}
          <Entries
            label={label}
            groups={groups}
            size="phone"
            onOpenSubmenu={(group, entry) => {
              setSubmenu({ group, entry });
              setSubmenuOpen(true);
            }}
          />
          {row !== undefined && (
            <Foot
              foot={row}
              size="phone"
            />
          )}
          {shown?.kind === "submenu" && (
            <SheetFrame
              label={shown.label}
              isOpen={isSubmenuOpen}
              onOpenChange={setSubmenuOpen}>
              {/* The trigger's menu props belong to the first sheet's list; a chosen link here still
                  closes the whole menu through the root trigger's state. */}
              <MenuContext.Provider value={null}>
                <LinkList
                  label={shown.label}
                  links={shown.links}
                  size="phone"
                  onBack={() => setSubmenuOpen(false)}
                />
              </MenuContext.Provider>
            </SheetFrame>
          )}
        </SheetFrame>
      )}
    </MenuTrigger>
  );
}
