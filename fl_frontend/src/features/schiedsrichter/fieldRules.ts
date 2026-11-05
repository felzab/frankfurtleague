import "server-only";

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
type SchiedsrichterField = "name" | "email" | "telefon" | "schule" | "honorar";

/** What a referee write asks of each field, read on the server so its schema never reaches the browser. */
export type SchiedsrichterRules = {
  required: Readonly<Record<SchiedsrichterField, boolean>>;
  max: Readonly<Record<"name" | "email" | "schule", number>>;
};

type Body = typeof SchiedsrichterPostSchiedsrichterBody | typeof SchiedsrichterPatchSchiedsrichterBody;

/** A field is required where the write takes no `null` for it, as its generated type says. */
const takesNull = (field: { safeParse: (value: unknown) => { success: boolean } }) => field.safeParse(null).success;

const requiredOf = ({ shape }: Body): SchiedsrichterRules["required"] => ({
  name: !takesNull(shape.name),
  email: !takesNull(shape.kontakt.shape.email),
  telefon: !takesNull(shape.kontakt.shape.telefon),
  schule: !takesNull(shape.schule),
  honorar: !takesNull(shape.default_payment),
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
