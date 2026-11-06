import "server-only";

import { requires } from "@/core/action";
import {
  SchiedsrichterPatchSchiedsrichterBody,
  schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax,
  schiedsrichterPatchSchiedsrichterBodyNameMax,
  schiedsrichterPatchSchiedsrichterBodySchuleOneMax,
  SchiedsrichterPostSchiedsrichterBody,
  schiedsrichterPostSchiedsrichterBodyKontaktEmailMax,
  schiedsrichterPostSchiedsrichterBodyNameMax,
  schiedsrichterPostSchiedsrichterBodySchuleOneMax,
} from "@/core/generated/zod/inputs";

/** A referee's fields, by the names the create dialog and the editor post. */
type SchiedsrichterField = "name" | "email" | "phone" | "schule" | "default_payment";

/** What a referee write asks of each field, read on the server so its schema never reaches the browser. */
export type SchiedsrichterRules = {
  required: Readonly<Record<SchiedsrichterField, boolean>>;
  max: Readonly<Record<"name" | "email" | "schule", number>>;
};

type Body = typeof SchiedsrichterPostSchiedsrichterBody | typeof SchiedsrichterPatchSchiedsrichterBody;

/**
 * The name's box posts "" while empty; every other box is read as no value then (`blankIsNull`, `numberBox`), an
 * address left empty being no address.
 */
const requiredOf = ({ shape }: Body): SchiedsrichterRules["required"] => ({
  name: requires(shape.name, ""),
  email: requires(shape.kontakt.shape.email, null),
  phone: requires(shape.kontakt.shape.phone, null),
  schule: requires(shape.schule, null),
  default_payment: requires(shape.default_payment, null),
});

/** The create's rules, which the dialog over the list holds its boxes to. */
export const CREATE_RULES: SchiedsrichterRules = {
  required: requiredOf(SchiedsrichterPostSchiedsrichterBody),
  max: {
    name: schiedsrichterPostSchiedsrichterBodyNameMax,
    email: schiedsrichterPostSchiedsrichterBodyKontaktEmailMax,
    schule: schiedsrichterPostSchiedsrichterBodySchuleOneMax,
  },
};

/** The save's rules, which the editor holds its boxes to. */
export const SAVE_RULES: SchiedsrichterRules = {
  required: requiredOf(SchiedsrichterPatchSchiedsrichterBody),
  max: {
    name: schiedsrichterPatchSchiedsrichterBodyNameMax,
    email: schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax,
    schule: schiedsrichterPatchSchiedsrichterBodySchuleOneMax,
  },
};
