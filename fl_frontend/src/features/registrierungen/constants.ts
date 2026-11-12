import type { FLRegistrierungMinAgeYears } from "@/core/generated/client/types";

// For the published notice, which states the floor with no answer to read it off. The form still takes the served
// `minimum_age`: a page judging a date against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_AGE = 16 satisfies FLRegistrierungMinAgeYears;
