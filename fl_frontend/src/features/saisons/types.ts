/**
 * One entry of the season switcher. Deliberately not `FLSaison`: the switcher is a Client Component,
 * so a season's `rules`, `status` and `spielplan` would otherwise be serialised into the Flight
 * payload of every page that renders the shell.
 */
export type SaisonSelectorOption = {
  id: string;
  start_date: string;
  end_date: string;
};
