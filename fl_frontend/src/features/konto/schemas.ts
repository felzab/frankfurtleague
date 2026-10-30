import z from "zod";

import { CustomObjectIdStringSchema, KontaktEmailSchema } from "@/shared/schemas";

/** The account page's start: the new address alone; the signed-in address names the change. */
export const FLKontoAdresswechselPayloadSchema = z.object({
  email: KontaktEmailSchema,
});

/** The address on file's approval: the change the page showed, which a later start replaces. */
export const FLKontoAdresswechselFreigabePayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
