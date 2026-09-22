from datetime import date


def whole_years_between(*, born: str, today: str) -> int:
    """Whole years elapsed, so a birthday later this year has not been reached yet.

    In `shared`: a copy per slice is how three consent flows come to disagree about a leap birthday.
    """

    birth, now = date.fromisoformat(born), date.fromisoformat(today)

    return now.year - birth.year - ((now.month, now.day) < (birth.month, birth.day))
