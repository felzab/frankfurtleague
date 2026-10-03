import { kontaktBestaetigungsLink } from "@/core/kontaktLink";

// The page a season row's seat link opens too, so both are spelled by one function.
export function bestaetigungsLink(origin: string, token: string): string {
  return kontaktBestaetigungsLink(origin, token);
}
