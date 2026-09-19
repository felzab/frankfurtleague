import { NAME_WRAP } from "@/shared/components/ui/nameWrap";

/**
 * On one line a real name is cut at some width on every card, so a club's name takes a second line
 * first, and past that its popover carries it whole.
 */
export const TEAM_NAME_WRAP = `line-clamp-2 ${NAME_WRAP}`;

/**
 * **Never clamped**: a slot nobody occupies mounts no popover to read the rest in, and
 * `formatQuelle`'s labels are bounded, so at a phone's bracket column a third line is the whole cost.
 */
export const SLOT_LABEL_WRAP = NAME_WRAP;

/**
 * Two line boxes of the name's own size, whether it takes one or two, so a card whose name wraps is
 * the height of one whose name does not and of the placeholder standing in for both.
 */
export const TEAM_NAME_TRACK = "flex min-h-[2lh] max-w-full min-w-0 flex-col justify-center";
