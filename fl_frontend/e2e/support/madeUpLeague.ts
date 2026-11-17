/**
 * E2E · the made-up league's seasons, people, clubs, fixtures and links, read from the file the seed writes them from,
 * so a value moved in the seed moves here with it.
 */
import PEOPLE from "../../../fl_backend/tests/made_up_people.json";

export { PEOPLE };

export const { finished: FINISHED, running: RUNNING, planned: PLANNED } = PEOPLE.seasons;

/** A person's name as the site writes it whole. */
export function nameOf(person: { first_name: string; last_name: string }): string {
  return `${person.first_name} ${person.last_name}`;
}
