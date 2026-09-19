import { IM_ELFMETERSCHIESSEN, IM_ELFMETERSCHIESSEN_GESPROCHEN } from "../../utils";

/** Every visible „i. E.“, so no surface reads a shoot-out to a screen reader as two letters. */
export function ImElfmeterschiessen() {
  return (
    <>
      <span aria-hidden="true">{IM_ELFMETERSCHIESSEN}</span>
      <span className="sr-only">{IM_ELFMETERSCHIESSEN_GESPROCHEN}</span>
    </>
  );
}
