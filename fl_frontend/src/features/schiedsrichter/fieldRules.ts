import "server-only";

import { requires } from "@/core/action";
import {
  SchiedsrichterPatchSchiedsrichterBody,
  schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax,
  schiedsrichterPatchSchiedsrichterBodyKontaktPhoneOneRegExp,
  schiedsrichterPatchSchiedsrichterBodyNameMax,
  schiedsrichterPatchSchiedsrichterBodyNameRegExp,
  schiedsrichterPatchSchiedsrichterBodySchuleOneMax,
  SchiedsrichterPostSchiedsrichterBody,
  schiedsrichterPostSchiedsrichterBodyKontaktEmailMax,
  schiedsrichterPostSchiedsrichterBodyKontaktPhoneOneRegExp,
  schiedsrichterPostSchiedsrichterBodyNameMax,
  schiedsrichterPostSchiedsrichterBodyNameRegExp,
  schiedsrichterPostSchiedsrichterBodySchuleOneMax,
} from "@/core/generated/zod/inputs";

type SchiedsrichterField = "name" | "email" | "phone" | "schule" | "default_payment";

export type SchiedsrichterRules = {
  required: Readonly<Record<SchiedsrichterField, boolean>>;
  max: Readonly<Record<"name" | "email" | "schule", number>>;
  /**
   * Each a source, the one form of a pattern a server page can hand a client field (`kit/TextField.tsx :: judgeOf`):
   * the phone's is the number's own, which an empty box never meets.
   */
  pattern: Readonly<Record<"name" | "phone", string>>;
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

export const CREATE_RULES: SchiedsrichterRules = {
  required: requiredOf(SchiedsrichterPostSchiedsrichterBody),
  max: {
    name: schiedsrichterPostSchiedsrichterBodyNameMax,
    email: schiedsrichterPostSchiedsrichterBodyKontaktEmailMax,
    schule: schiedsrichterPostSchiedsrichterBodySchuleOneMax,
  },
  pattern: {
    name: schiedsrichterPostSchiedsrichterBodyNameRegExp.source,
    phone: schiedsrichterPostSchiedsrichterBodyKontaktPhoneOneRegExp.source,
  },
};

export const SAVE_RULES: SchiedsrichterRules = {
  required: requiredOf(SchiedsrichterPatchSchiedsrichterBody),
  max: {
    name: schiedsrichterPatchSchiedsrichterBodyNameMax,
    email: schiedsrichterPatchSchiedsrichterBodyKontaktEmailMax,
    schule: schiedsrichterPatchSchiedsrichterBodySchuleOneMax,
  },
  pattern: {
    name: schiedsrichterPatchSchiedsrichterBodyNameRegExp.source,
    phone: schiedsrichterPatchSchiedsrichterBodyKontaktPhoneOneRegExp.source,
  },
};
