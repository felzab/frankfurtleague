import { z } from "zod";

export const CustomDateStringSchema = z.iso.date({ error: "DateString has to be of the form: YYYY-MM-DD" });

export const CustomTimeStringSchema = z.iso.time({ error: "TimeString has to be of the form: HH:MM:SS" });

export const CustomObjectIdStringSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  message: "ObjectIdString has to be 24 chars long and a combination of letters and numbers",
});

export const FLAddressSchema = z.object({
  strasse: z.string().nonempty(),
  hausnummer: z
    .string()
    .regex(/^[\d\-abcABC]+$/, "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.")
    .or(z.literal("")),
  plz: z.string().regex(/^\d{5}$/, "Die PLZ muss genau 5 Ziffern haben."),
  stadtteil: z.string(),
  stadt: z.string().nonempty(),
});
export type FLAddress = z.infer<typeof FLAddressSchema>;

export const FLKontaktSchema = z.object({
  telefon: z.string().nullable(),
  email: z.email().or(z.string().trim().length(0)).nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
