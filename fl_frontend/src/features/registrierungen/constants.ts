import type { FLMediaMinAgeYears, FLRegistrierungConfirmationDeadlineDays, FLRegistrierungMinAgeYears } from "@/core/generated/client/types";

// For the published notice, which states the floor with no answer to read it off; checked against
// `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_MIN_AGE_YEARS`, so the backend moving it
// fails the type check here. The form still takes the served `minimum_age`: a page judging a date
// against this copy would refuse where the endpoint accepts.
export const REGISTRIERUNG_MIN_AGE = 16 satisfies FLRegistrierungMinAgeYears;

// For the published notice as well, which states the media floor for pupils and referees alike;
// checked against `fl_backend/app/shared/schemas/bounds.py :: MEDIA_MIN_AGE_YEARS` as the floor above
// is, and the pages take the served `media_minimum_age` for the reason given above.
export const MEDIA_MIN_AGE = 18 satisfies FLMediaMinAgeYears;

// For the published notice too, which states how long a registration waits for its confirmation; checked against
// `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS` as the floors above are.
export const REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS = 14 satisfies FLRegistrierungConfirmationDeadlineDays;
