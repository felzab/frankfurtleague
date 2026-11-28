import { ADMIN_COPY } from "@/core/copy/admin";
import { actionLogGetActionLogBodyQOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { loadActionLog } from "@/features/action-log/actions";
import { byOf, byOptions, logParams, PERIOD_OPTIONS, TYPE_OPTIONS } from "@/features/action-log/filters";
import { getActionLog, getActionLogByOptions } from "@/features/action-log/queries";
import { rowOf } from "@/features/action-log/rows";
import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Filter } from "@/kit/Filters";
import type { TableHead } from "@/kit/Table";

type Props = PageProps<"/admin/log">;

const WORDS = ADMIN_COPY.actionLog;

export const metadata = pageMetadata(ROUTES.adminActionLog);

/** The address parameter the search stands in, beside the filters'. */
const SEARCH = "q";

/**
 * The search the address names, trimmed, the first where it is repeated; none for one past the bound the read takes,
 * which only a hand-typed address holds, as a filter's hand-typed value narrows nothing.
 */
function searchOf(named: string | string[] | undefined): string {
  const value = (Array.isArray(named) ? named[0] : named)?.trim() ?? "";
  return value.length > actionLogGetActionLogBodyQOneMax ? "" : value;
}

/** The first page inside the address's search and filters, and the filters as the toolbar and every later read take them. */
async function readLog(named: Awaited<Props["searchParams"]>, q: string) {
  const type = filterValue(named.type, TYPE_OPTIONS);
  const time = filterValue(named.time, PERIOD_OPTIONS);
  // The read's own spelling: no search is `null`, never the empty text.
  const searched = { q: q === "" ? null : q };
  // Beside the options where the address names no „Wer“: a chosen one waits on them, as the address holds only the
  // option's digest and the options alone turn it back into the `by` the log is read by.
  const [{ by_options: held }, unfiltered] = await Promise.all([
    getActionLogByOptions(),
    named.by === undefined ? getActionLog({ ...logParams({ type, time }), ...searched }) : null,
  ]);
  const options = byOptions(held);
  const who = filterValue(named.by, options);
  const by = byOf(held, who);
  const page = unfiltered ?? (await getActionLog({ ...logParams({ by, type, time }), ...searched }));
  const filters: readonly Filter[] = [
    { name: "by", label: WORDS.who, all: SERVER_COPY.season.filter.all, options, value: who },
    { name: "type", label: ADMIN_COPY.team.austrittType, all: SERVER_COPY.season.filter.all, options: TYPE_OPTIONS, value: type },
    { name: "time", label: ADMIN_COPY.saison.period, all: SERVER_COPY.season.filter.all, options: PERIOD_OPTIONS, value: time },
  ];
  return { filters, page, by };
}

/** The table's head. Its rows stack on a phone and open nothing. */
const HEAD: TableHead = {
  nameLabel: WORDS.what,
  stack: true,
  columns: [
    { key: "who", label: WORDS.who, width: "line" },
    { key: "when", label: WORDS.when, width: "instant" },
  ],
};

/**
 * The Protokoll: the newest 50 acts, the next 50 read on request, searched on the server over the stored words and
 * narrowed by who, type and time, the search and the filters standing in the address, so a reload and a shared link
 * keep them and each change reads the list anew.
 */
export default async function ActionLogPage({ searchParams }: Props) {
  const named = await searchParams;
  const q = searchOf(named[SEARCH]);
  const log = readLog(named, q);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminActionLog" } }}
      filters={log.then(({ filters }) => filters)}
      list={{
        kind: "table",
        search: { label: WORDS.search, maxLength: actionLogGetActionLogBodyQOneMax, address: { name: SEARCH, value: q } },
        head: HEAD,
        content: log.then(({ filters, page, by }) => {
          const chosen = filters.flatMap(({ name, value }) => (value === null ? [] : [[name, value] as const]));
          return {
            table: {
              label: ROUTES.adminActionLog.title,
              rows: page.action_log.map(rowOf),
              empty: { kind: chosen.length === 0 ? "none" : "filter", plural: WORDS.plural, glyph: "log" } as const,
            },
            // The next page's read posts what the actor's option stands for, in a body no log keeps.
            more: {
              cursor: page.cursor,
              query: q,
              carry: { ...Object.fromEntries(chosen), ...(by === null ? {} : { by }) },
              load: loadActionLog,
            },
          };
        }),
      }}
    />
  );
}
