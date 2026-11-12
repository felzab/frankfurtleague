import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { actionLogGetActionLogBodyQOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { loadActionLog } from "@/features/action-log/actions";
import { byOf, byOptions, logParams, PERIOD_OPTIONS, TYPE_OPTIONS } from "@/features/action-log/filters";
import { getActionLog } from "@/features/action-log/queries";
import { rowOf } from "@/features/action-log/rows";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Filter } from "@/kit/Filters";
import type { TableHead } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/log">;

const WORDS = COPY.admin.actionLog;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.adminActionLog, ROUTES.adminActionLog.path());
}

/** The first page inside the address's filters, and those filters as the toolbar and every later read take them. */
async function readLog(searchParams: Props["searchParams"]) {
  const named = await searchParams;
  const type = filterValue(named.type, TYPE_OPTIONS);
  const time = filterValue(named.time, PERIOD_OPTIONS);
  const first = await getActionLog(logParams({ type, time }));
  const options = byOptions(first.by_options);
  const who = filterValue(named.by, options);
  // Who the address's option stands for is known only once the log is read, which answers every `by` whatever the filters keep.
  const by = byOf(first.by_options, who);
  const page = by === null ? first : await getActionLog(logParams({ by, type, time }));
  const filters: readonly Filter[] = [
    { name: "by", label: WORDS.who, all: SERVER_COPY.season.filter.all, options, value: who },
    { name: "type", label: COPY.admin.team.austrittType, all: SERVER_COPY.season.filter.all, options: TYPE_OPTIONS, value: type },
    { name: "time", label: COPY.admin.saison.period, all: SERVER_COPY.season.filter.all, options: PERIOD_OPTIONS, value: time },
  ];
  return { filters, page, by };
}

/** The table's head, drawn while the rows are read and over them once they are. Its rows stack on a phone and open nothing. */
const HEAD: TableHead = {
  nameLabel: WORDS.what,
  stack: true,
  linked: false,
  columns: [
    { key: "who", label: WORDS.who, width: "line" },
    { key: "when", label: WORDS.when, width: "instant" },
  ],
};

/**
 * The Protokoll: the newest 50 acts, the next 50 read on request, searched on the server over the stored words and
 * narrowed by who, type and time, whose values stand in the address, so a filter's change reads the list anew.
 */
export default function ActionLogPage({ searchParams }: Props) {
  const log = readLog(searchParams);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminActionLog" } }}
      filters={log.then(({ filters }) => filters)}
      filterCount={3}
      list={{
        kind: "table",
        search: { label: WORDS.search, maxLength: actionLogGetActionLogBodyQOneMax },
        head: HEAD,
        // The kit's cap on a list's wait, short of the 50 a page holds.
        wait: 30,
        paged: true,
        content: log.then(({ filters, page, by }) => {
          const chosen = filters.flatMap(({ name, value }) => (value === null ? [] : [[name, value] as const]));
          return {
            table: {
              label: ROUTES.adminActionLog.title,
              rows: page.action_log.map(rowOf),
              empty: { kind: chosen.length === 0 ? "none" : "filter", plural: COPY.account.entries.plural, glyph: "log" } as const,
            },
            // The next page's read posts what the actor's option stands for, in a body no log keeps.
            more: { cursor: page.cursor, carry: { ...Object.fromEntries(chosen), ...(by === null ? {} : { by }) }, load: loadActionLog },
          };
        }),
      }}
    />
  );
}
