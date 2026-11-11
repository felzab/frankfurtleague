import type { FLRegistrierungMinAgeYears } from "@/core/generated/client/types";

// For the published notice, which states the floor with no answer to read it off; checked against
// `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_AGE_YEARS`, so the backend moving it
// fails the type check here. The form still takes the served `minimum_age`: a page judging a date
// against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_AGE = 16 satisfies FLRegistrierungMinAgeYears;
