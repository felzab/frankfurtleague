import { COPY } from "@/core/copy";
import { formatList } from "@/core/format";

import type { CalendarDay } from "@/core/format";
import type { FLAustrittRecipients } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

/**
 * The exit dialog's „E-Mail an“ fact for the day typed: everyone the read names for a day on or after it, or for no
 * day, each once, in their names' order as every question lists them; none where the exit mails nobody, or where no
 * whole day is typed, so the question names no mail that is never sent.
 */
export function exitFactsOf(entries: readonly FLAustrittRecipients[], day: CalendarDay | null): Fact[] {
  if (day === null) return [];

  const named = new Map<string, string>();
  for (const { date, recipients } of entries) {
    if (date !== null && date < day) continue;
    for (const recipient of recipients) {
      named.set(recipient.kind === "team" ? `team/${recipient.team_id}` : `schiedsrichter/${recipient.schiedsrichter_id}`, recipient.name);
    }
  }

  const names = [...named.values()].toSorted((one, other) => one.localeCompare(other, "de"));
  return names.length === 0 ? [] : [{ label: COPY.admin.facts.mailTo, value: { record: formatList(names) } }];
}
