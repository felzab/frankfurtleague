from __future__ import annotations

import ast
import asyncio
import inspect
import textwrap
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from app.api.bewerbungen.services import ZUSTELLUNG_ABGEWIESEN, hash_token, latest_decision_due
from app.api.registrierungen import sweep_router
from app.api.registrierungen.services import (
    REGISTRIERUNG_SWEEP_FELD,
    SWEEP_PAGE,
    bestaetigung_erasure_is_due,
    build_decline_filter,
    build_erinnerung_filter,
    build_stale_stamp_filter,
    build_unconfirmed_filter,
    build_undecided_filter,
    compose_erinnerung_update,
    compose_sweep_stamp,
    decline_erasure_is_due,
    erinnerung_is_due,
    link_is_unreachable,
    undecided_erasure_is_due,
)
from app.api.saisons.crud import pull_current_saison
from app.core.collections import Collection
from app.core.constraints import COLLECTION_VALIDATORS
from app.core.middlewares import REQUEST_DEADLINE_S
from app.core.transactions import drain, refuse_a_stalled_page
from app.shared.schemas.bounds import REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE, REGISTRIERUNG_ERINNERUNG_TAGE

TODAY = "2026-04-01"
YESTERDAY = "2026-03-31"
TOMORROW = "2026-04-02"

# Three days before `TODAY` to the day: the reminder's own mark, pinned so both sides of it are cases.
MAILED_ON_THE_MARK = "2026-03-29"
MAILED_A_DAY_SHORT = "2026-03-30"
MAILED_A_DAY_PAST = "2026-03-28"

FIRST_HASH = hash_token("first")

# The instant the log rows of the one pass driven below are stamped with.
_NOW = datetime(2026, 4, 1, 12, 30, tzinfo=ZoneInfo("Europe/Berlin"))


def einwilligung(*, bestaetigt_am: str | None = TODAY) -> dict[str, Any]:
    return {
        "umfang": "kader_oeffentlich",
        "erteilt_von": "volljaehrig",
        "datum": bestaetigt_am,
        "bestaetigt_am": bestaetigt_am,
        "text_version": "2026-09-spielerseite",
        "medien": False,
    }


def zustellung(stand: str) -> dict[str, Any]:
    return {"nachricht_id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794", "stand": stand, "grund": None, "am": "2026-03-29T10:00:00.000000+00:00"}


def bestaetigung(**overrides: Any) -> dict[str, Any]:
    """One live link mailed at its reminder mark, inside its deadline, that each case moves one thing of."""

    return {
        "token_hash": FIRST_HASH,
        "verschickt_am": MAILED_ON_THE_MARK,
        "erinnert_am": None,
        "frist": "2026-04-05",
        **overrides,
    }


def registrierung(**overrides: Any) -> dict[str, Any]:
    """One submitted registration nobody has confirmed, its link due a reminder today."""

    return {
        "status": "eingereicht",
        "saison_id": "2026",
        "vorname": "Quillhilde",
        "email": "quillhilde@example.com",
        "einwilligung": None,
        "bestaetigung": bestaetigung(),
        "entscheidung": None,
        **overrides,
    }


class TestTheReminderMark:
    """The three-day mark, on the one link a registration has: the day before, the day, the day after.

    The bound is `fl_backend/app/shared/schemas/bounds.py :: REGISTRIERUNG_ERINNERUNG_TAGE`.
    """

    @pytest.mark.parametrize(
        ("verschickt_am", "due"),
        [
            pytest.param(MAILED_A_DAY_SHORT, False, id="two days ago"),
            pytest.param(MAILED_ON_THE_MARK, True, id="three days ago, to the day"),
            pytest.param(MAILED_A_DAY_PAST, True, id="four days ago"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, verschickt_am: str, due: bool):
        stored = registrierung(bestaetigung=bestaetigung(verschickt_am=verschickt_am))

        assert erinnerung_is_due(registrierung_raw=stored, today=TODAY) == due
        assert (REGISTRIERUNG_ERINNERUNG_TAGE, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE) == (3, 7)

    @pytest.mark.parametrize(
        ("stored", "why"),
        [
            pytest.param(registrierung(einwilligung=einwilligung()), "confirmed", id="confirmed"),
            pytest.param(registrierung(bestaetigung=bestaetigung(erinnert_am=YESTERDAY)), "reminded once", id="reminded once"),
            pytest.param(registrierung(status="abgelehnt"), "declined", id="declined"),
            pytest.param(registrierung(bestaetigung=None), "no bookkeeping", id="no bookkeeping"),
            pytest.param(registrierung(bestaetigung=bestaetigung(verschickt_am=None)), "no send recorded", id="no send recorded"),
        ],
    )
    def test_a_registration_that_has_answered_been_chased_or_lost_its_link_is_not_reminded(self, stored: Mapping[str, Any], why: str):
        assert not erinnerung_is_due(registrierung_raw=stored, today=TODAY), why

    @pytest.mark.parametrize(
        ("frist", "due"),
        [
            pytest.param(TOMORROW, True, id="the day before the deadline"),
            pytest.param(TODAY, True, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, False, id="the day after, when the erasure clock has it"),
        ],
    )
    def test_nothing_past_its_deadline_is_chased(self, frist: str, due: bool):
        """A link minted on the way out is one nobody can spend: the erasure below takes the row the same day."""

        stored = registrierung(bestaetigung=bestaetigung(frist=frist))

        assert erinnerung_is_due(registrierung_raw=stored, today=TODAY) == due

    @pytest.mark.parametrize("stand", sorted(ZUSTELLUNG_ABGEWIESEN))
    def test_an_address_the_provider_refuses_is_not_chased(self, stand: str):
        """The one chase a registration gets is spent on nobody where the address is already known to reject it."""

        stored = registrierung(bestaetigung=bestaetigung(zustellung=zustellung(stand)))

        assert link_is_unreachable(bestaetigung=stored["bestaetigung"])
        assert not erinnerung_is_due(registrierung_raw=stored, today=TODAY)

    @pytest.mark.parametrize("stand", ["angenommen", "zugestellt", "verzoegert"])
    def test_an_address_a_later_message_may_still_reach_is_chased(self, stand: str):
        """A delayed message still arrives, and a delivered one arrived: neither is a reason to skip the chase."""

        stored = registrierung(bestaetigung=bestaetigung(zustellung=zustellung(stand)))

        assert not link_is_unreachable(bestaetigung=stored["bestaetigung"])
        assert erinnerung_is_due(registrierung_raw=stored, today=TODAY)


class TestTheDeadlineClock:
    @pytest.mark.parametrize(
        ("frist", "due"),
        [
            pytest.param(TOMORROW, False, id="the day before the deadline"),
            pytest.param(TODAY, False, id="the deadline's own day, when the link still answers"),
            pytest.param(YESTERDAY, True, id="the day after"),
            pytest.param(None, False, id="no deadline recorded"),
        ],
    )
    def test_each_boundary_falls_where_the_bound_says(self, frist: str | None, due: bool):
        stored = registrierung(bestaetigung=bestaetigung(frist=frist))

        assert bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY) == due

    def test_a_confirmed_registration_waits_for_the_seasons_end_instead(self):
        """The clock's whole reach: a row nobody confirmed leaves at its deadline, and a confirmed one leaves with its season."""

        stored = registrierung(bestaetigung=bestaetigung(frist=YESTERDAY), einwilligung=einwilligung())

        assert not bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_declined_registration_is_the_one_month_clocks(self):
        stored = registrierung(status="abgelehnt", bestaetigung=bestaetigung(frist=YESTERDAY))

        assert not bestaetigung_erasure_is_due(registrierung_raw=stored, today=TODAY)

    def test_a_registration_stored_without_a_block_is_never_taken_by_this_clock(self):
        """A row with no readable deadline is held rather than destroyed: the date this clock counts from is the one thing it needs."""

        assert not bestaetigung_erasure_is_due(registrierung_raw=registrierung(bestaetigung=None), today=TODAY)


class TestTheSeasonsOwnEnd:
    @pytest.mark.parametrize(
        ("status", "saison_status", "due"),
        [
            pytest.param("eingereicht", "past", True, id="submitted, the season over"),
            pytest.param("eingereicht", "active", False, id="submitted, the season running"),
            pytest.param("eingereicht", "future", False, id="submitted, the season ahead"),
            pytest.param("abgelehnt", "past", False, id="declined, the season over"),
        ],
    )
    def test_only_a_submitted_row_of_a_past_season_is_taken(self, status: str, saison_status: str, due: bool):
        stored = registrierung(status=status)

        assert undecided_erasure_is_due(registrierung_raw=stored, saison_status=saison_status) == due

    @pytest.mark.parametrize("stored", [registrierung(), registrierung(einwilligung=einwilligung())], ids=("unconfirmed", "confirmed"))
    def test_it_asks_nothing_about_the_answer_the_pupil_gave(self, stored: Mapping[str, Any]):
        """Both go: no admission can be taken for a season that is over, and the note afterwards is what parts the two."""

        assert undecided_erasure_is_due(registrierung_raw=stored, saison_status="past")


class TestTheOneMonthClock:
    @pytest.mark.parametrize(
        ("getroffen_am", "due"),
        [
            pytest.param("2026-03-02", False, id="a day short of the month"),
            pytest.param("2026-03-01", True, id="the month, to the day"),
            pytest.param("2026-02-15", True, id="past the month"),
            pytest.param("2026-01-31", True, id="clamped to February, and past it"),
        ],
    )
    def test_each_boundary_falls_a_calendar_month_after_the_decision(self, getroffen_am: str, due: bool):
        declined = registrierung(status="abgelehnt", entscheidung={"getroffen_am": getroffen_am, "von": "admin", "grund": "kein Platz"})

        assert decline_erasure_is_due(registrierung_raw=declined, today=TODAY) == due

    @pytest.mark.parametrize("status", ["eingereicht", "abgelehnt"])
    def test_a_decision_with_no_day_and_a_row_nobody_decided_are_both_left_standing(self, status: str):
        stored = registrierung(status=status, entscheidung=None)

        assert not decline_erasure_is_due(registrierung_raw=stored, today=TODAY)


class TestWhatAReminderWrites:
    def test_the_stamp_the_fresh_hash_and_the_kept_hash_and_nothing_else(self):
        """The deadline and the send day are untouched: a reminder is not a re-send (`docs/backend/spec.md :: I152`)."""

        update = compose_erinnerung_update(token_hash="fresh", bestaetigung=bestaetigung(), today=TODAY)

        assert update == {
            "$set": {
                "bestaetigung.token_hash": "fresh",
                "bestaetigung.token_hash_zuvor": FIRST_HASH,
                "bestaetigung.erinnert_am": TODAY,
            }
        }

    def test_a_row_carrying_no_block_keeps_a_null_where_the_first_hash_would_stand(self):
        """The validator declares the field nullable, so the reminder writes a null rather than aborting a pass on a row stored without one."""

        update = compose_erinnerung_update(token_hash="fresh", bestaetigung=None, today=TODAY)

        assert update["$set"]["bestaetigung.token_hash_zuvor"] is None


class TestWhatThePassStamps:
    def test_the_filter_and_the_update_name_one_key(self):
        """A rename reaching one of the two alone leaves the pass stamping a key nothing reads, with every clock still green."""

        assert build_stale_stamp_filter(today=TODAY) == {REGISTRIERUNG_SWEEP_FELD: {"$ne": TODAY}}
        assert compose_sweep_stamp(today=TODAY) == {"$set": {REGISTRIERUNG_SWEEP_FELD: TODAY}}

    def test_the_key_is_not_the_application_passs_own(self):
        """One key over both passes would answer `it ran` for a registration sweep that stopped a week ago."""

        assert REGISTRIERUNG_SWEEP_FELD == "registrierung_sweep_gelaufen_am"
        assert "sweep_gelaufen_am" in COLLECTION_VALIDATORS[Collection.SAISONS]["$jsonSchema"]["properties"]
        assert "sweep_gelaufen_am" not in build_stale_stamp_filter(today=TODAY)


SAISON_ID = "2026"

# Three days before `TODAY`, which is the mark the reminder's filter counts BACKWARDS to where the
# predicate counts forwards from the send.
THE_MARK = MAILED_ON_THE_MARK

CLOCK_FILTERS: Mapping[str, Mapping[str, Any]] = {
    "season's end": build_undecided_filter(saison_id=SAISON_ID),
    "deadline": build_unconfirmed_filter(saison_id=SAISON_ID, today=TODAY),
    "reminder": build_erinnerung_filter(saison_id=SAISON_ID, today=TODAY),
    "decline": build_decline_filter(saison_id=SAISON_ID, today=TODAY),
}


class TestWhatEachClockReads:
    """One page per clock, so a row the clock can never take holds no slot in it.

    A read taking every submitted row fills its page with rows nothing is owed on, and the rows
    behind them are never judged.
    """

    def test_the_seasons_end_takes_every_submitted_row(self):
        """Nothing narrower is right here: once the season is `past` this clock takes every one of them, confirmed or not."""

        assert CLOCK_FILTERS["season's end"] == {"saison_id": SAISON_ID, "status": "eingereicht"}

    def test_the_deadline_reads_the_unconfirmed_whose_day_has_passed(self):
        """The consent term matches a null record and a null stamp alike, which is what covers both stored shapes with one key."""

        assert CLOCK_FILTERS["deadline"] == {
            "saison_id": SAISON_ID,
            "status": "eingereicht",
            "einwilligung.bestaetigt_am": None,
            "bestaetigung.frist": {"$lt": TODAY},
        }

    def test_the_reminder_reads_the_unchased_at_their_mark_whose_address_was_not_refused(self):
        assert CLOCK_FILTERS["reminder"] == {
            "saison_id": SAISON_ID,
            "status": "eingereicht",
            "einwilligung.bestaetigt_am": None,
            "bestaetigung.erinnert_am": None,
            "bestaetigung.frist": {"$gte": TODAY},
            "bestaetigung.verschickt_am": {"$lte": THE_MARK},
            "bestaetigung.zustellung.stand": {"$nin": sorted(ZUSTELLUNG_ABGEWIESEN)},
        }

    def test_the_decline_clock_reads_the_decisions_whose_month_is_behind_them(self):
        """Narrowed to the due ones, so a page of decisions still inside their month cannot fill the read ahead of one that is due."""

        assert CLOCK_FILTERS["decline"] == {
            "saison_id": SAISON_ID,
            "status": "abgelehnt",
            "entscheidung.getroffen_am": {"$lte": "2026-03-01"},
        }

    @pytest.mark.parametrize(
        ("today", "latest"),
        [
            pytest.param("2026-04-01", "2026-03-01", id="a plain month"),
            # The clamp a month counted back from today gets wrong: the 29th to the 31st of January are
            # due on the 28th of February, which counting back lands on the 28th of January.
            pytest.param("2026-02-28", "2026-01-31", id="the end of a short month"),
            pytest.param("2028-02-29", "2028-01-31", id="the end of a leap February"),
            pytest.param("2026-03-30", "2026-02-28", id="past a short month's end"),
        ],
    )
    def test_the_last_decision_due_agrees_with_the_clock_at_every_month_end(self, today: str, latest: str):
        """Both sides of the cutoff, judged by the clock's own predicate: the query and the predicate must take the same rows."""

        def due(getroffen_am: str) -> bool:
            declined = {"status": "abgelehnt", "entscheidung": {"getroffen_am": getroffen_am}}
            return decline_erasure_is_due(registrierung_raw=declined, today=today)

        day_after = (date.fromisoformat(latest) + timedelta(days=1)).isoformat()

        assert latest_decision_due(today=today) == latest
        assert (due(latest), due(day_after)) == (True, False)

    @pytest.mark.parametrize("clock", sorted(CLOCK_FILTERS))
    def test_every_clock_reads_one_season(self, clock: str):
        """`fl_backend/tests/core/test_write_shapes.py :: TestWhatARemovalFilterMayName` holds the removals; the READS answer to this."""

        assert CLOCK_FILTERS[clock]["saison_id"] == SAISON_ID


PASS_BODY = ast.parse(textwrap.dedent(inspect.getsource(sweep_router.sweep_registrierungen)))

# Each clock's transaction callback, by name, read off the handler's own source.
PASS_CALLBACKS = {node.name: node for node in ast.walk(PASS_BODY) if isinstance(node, ast.AsyncFunctionDef)}

# The three that ERASE, which is the progress a page is drained by. The reminder's own progress is
# the stamp, which takes a row out of its filter, so its page is drained by the passes that follow.
ERASING_CLOCKS = ("erase_the_undecided", "erase_the_unconfirmed", "erase_declined")

# The four clocks' callbacks, named rather than derived: a callback the reader stopped seeing would
# drop out of a derived set instead of failing, and the stamp's own read is over SEASONS rather than
# over a season's registrations.
CLOCK_CALLBACKS = ("erase_the_undecided", "erase_the_unconfirmed", "remind", "erase_declined")


class TestThePageIsNeverTruncated:
    @pytest.mark.parametrize(
        ("read", "moved", "raises"),
        [
            pytest.param(SWEEP_PAGE, 0, False, id="a page that is whole, and empty of due rows"),
            pytest.param(SWEEP_PAGE + 1, 1, False, id="a full page that moved a row"),
            pytest.param(SWEEP_PAGE + 1, 0, True, id="a full page that moved nothing"),
        ],
    )
    def test_only_a_full_page_that_moved_nothing_raises(self, read: int, moved: int, raises: bool):
        """A full page is drained rather than refused: the erasure or the stamp is what shrinks the population that filled it."""

        if not raises:
            assert refuse_a_stalled_page(read=read, moved=moved, page=SWEEP_PAGE, clock="deadline", saison_id=SAISON_ID) is None
            return

        with pytest.raises(ValueError, match=SAISON_ID):
            refuse_a_stalled_page(read=read, moved=moved, page=SWEEP_PAGE, clock="deadline", saison_id=SAISON_ID)

    @pytest.mark.parametrize("callback", CLOCK_CALLBACKS)
    def test_each_clock_reads_one_row_past_the_page(self, callback: str):
        """A source sweep, because the truncation leaves no trace on the wire: only a season of more than one page would show it."""

        limits = [
            ast.unparse(keyword.value)
            for node in ast.walk(PASS_CALLBACKS[callback])
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "pull_many_from_db"
            for keyword in node.keywords
            if keyword.arg == "limit"
        ]

        assert limits == ["SWEEP_PAGE + 1"], f"{callback} reads {limits}, where a page it cannot tell from a truncation is {SWEEP_PAGE}"

    @pytest.mark.parametrize("callback", CLOCK_CALLBACKS)
    def test_each_clock_asks_whether_its_page_moved_anything(self, callback: str):
        called = {node.func.id for node in ast.walk(PASS_CALLBACKS[callback]) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}

        assert refuse_a_stalled_page.__name__ in called, f"{callback} weighs a page it read without asking whether the pass can make progress"

    @pytest.mark.parametrize("clock", ERASING_CLOCKS)
    def test_each_erasing_clock_is_run_again_until_its_page_is_short(self, clock: str):
        """The drain, read off the pass's own body: a clock that stopped at one page would stop at the same page every hour.

        A loop of its own, or `drain`, whose loop `fl_backend/tests/core/test_transactions.py` holds.
        """

        drains = [
            node
            for node in ast.walk(PASS_BODY)
            if isinstance(node, ast.While)
            or (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == drain.__name__)
            for call in ast.walk(node)
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and call.func.attr == "with_transaction"
            for named in call.args
            if isinstance(named, ast.Name) and named.id == clock
        ]

        assert len(drains) == 1, f"{clock} is not run inside a loop, so a page it fills is where that season's retention stops"


class _Cursor:
    """`pull_many_from_db`'s own chain -- `find(...).limit(n).to_list(length=n)` -- over a list this test holds."""

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def limit(self, limit: int) -> _Cursor:
        return _Cursor(self.rows[:limit])

    def sort(self, keys: list[tuple[str, int]]) -> _Cursor:
        """Ascending keys alone, which is every order the pass asks for; a missing path sorts first, as the server's does."""

        def value(row: Mapping[str, Any], path: str) -> tuple[bool, str]:
            found: Any = row
            for part in path.split("."):
                found = found.get(part) if isinstance(found, Mapping) else None
            return (found is not None, str(found))

        assert all(direction == 1 for _, direction in keys)
        return _Cursor(sorted(self.rows, key=lambda row: [value(row, path) for path, _ in keys]))

    async def to_list(self, length: int) -> list[dict[str, Any]]:
        return self.rows[:length]


class _Result:
    def __init__(self, modified_count: int) -> None:
        self.modified_count = modified_count


class _Deleted:
    def __init__(self, deleted_count: int) -> None:
        self.deleted_count = deleted_count


def _matches(row: Mapping[str, Any], filter: Mapping[str, Any]) -> bool:
    """A filter's PLAIN equality terms only.

    A dotted path and an operator are passed over: the predicate decides every row here, and a
    matcher guessing at `$nin` would be a second database nobody wrote.
    """

    for key, value in filter.items():
        if key == "_id" and isinstance(value, Mapping):
            if row["_id"] not in value.get("$in", []):
                return False
        elif "." not in key and not isinstance(value, Mapping) and row.get(key) != value:
            return False

    return True


class _Collection:
    """One collection of the pass, over documents this test holds: `session` is accepted and ignored everywhere."""

    def __init__(self, name: str, rows: list[dict[str, Any]], database: Mapping[str, Any], *, answers_reads: bool = True) -> None:
        self.name = name
        self.rows = rows
        self.database = database
        self.answers_reads = answers_reads

    async def find_one(self, filter: Mapping[str, Any], projection: Any = None, session: Any = None) -> dict[str, Any] | None:
        for row in self.rows:
            if _matches(row, filter):
                return dict(row)
        return None

    def find(self, filter: Mapping[str, Any], projection: Any = None, collation: Any = None, session: Any = None) -> _Cursor:
        if not self.answers_reads:
            return _Cursor([])

        return _Cursor([dict(row) for row in self.rows if _matches(row, filter)])

    async def update_many(self, filter: Mapping[str, Any], update: Mapping[str, Any], session: Any = None) -> _Result:
        written = update["$set"]
        touched = [row for row in self.rows if _matches(row, filter)]
        for row in touched:
            row.update(written)
        return _Result(len(touched))

    async def delete_many(self, filter: Mapping[str, Any], session: Any = None) -> _Deleted:
        taken = [row for row in self.rows if _matches(row, filter)]
        for row in taken:
            self.rows.remove(row)
        return _Deleted(len(taken))

    async def insert_one(self, document: Mapping[str, Any], session: Any = None) -> None:
        self.rows.append(dict(document))


class _Session:
    async def with_transaction(self, callback: Any) -> Any:
        return await callback(self)


class _Db:
    def start_session(self) -> _Db:
        return self

    async def __aenter__(self) -> _Session:
        return _Session()

    async def __aexit__(self, *_: Any) -> None:
        return None


class TestTheStampDropsTheCachedSeason:
    def test_a_cached_season_read_after_the_pass_carries_the_day(self):
        """A season write that leaves the cache standing serves the old document for a whole TTL.

        Driven over doubles: the drop leaves no trace on the wire.
        """

        stored = [{"_id": SAISON_ID, "status": "active", "rules": {}}]
        aktionen = _Collection("aktionen", [], {})
        database: dict[str, Any] = {"aktionen": aktionen}
        saisons = _Collection("saisons", stored, database)
        registrierungen = _Collection("registrierungen", [], database)

        async def drive() -> tuple[Mapping[str, Any], Mapping[str, Any]]:
            before = await pull_current_saison(saisons_collection=saisons)  # pyright: ignore[reportArgumentType]
            await sweep_router.sweep_registrierungen(
                saison_id=SAISON_ID,
                registrierungen_collection=registrierungen,  # pyright: ignore[reportArgumentType]
                saisons_collection=saisons,  # pyright: ignore[reportArgumentType]
                teams_collection=_Collection("teams", [], database),  # pyright: ignore[reportArgumentType]
                aktionen_collection=aktionen,  # pyright: ignore[reportArgumentType]
                db=_Db(),  # pyright: ignore[reportArgumentType]
                today=TODAY,
                germany_now=_NOW,
            )

            return before, await pull_current_saison(saisons_collection=saisons)  # pyright: ignore[reportArgumentType]

        before, after = asyncio.run(drive())

        assert before.get(REGISTRIERUNG_SWEEP_FELD) is None
        assert after[REGISTRIERUNG_SWEEP_FELD] == TODAY, "the second read was answered from the cache, which the stamp should have dropped"


# A page and a short one after it: at a page plus ONE the first read would take every row, so a
# clock that stopped after its first erasure would still leave nothing behind and pass.
OVERFLOW = SWEEP_PAGE + 5


def _overflowing(**overrides: Any) -> list[dict[str, Any]]:
    """More due rows than one page, which is the population a clock that stopped could never shrink."""

    return [{**registrierung(**overrides), "_id": position, "team_id": None} for position in range(OVERFLOW)]


class TestTheClocksDrain:
    """A page a clock fills is erased and read again, until a short page comes back.

    Only the erasure shrinks the population that fills it, so a pass stopping first stops for ever.
    """

    @pytest.mark.parametrize(
        ("clock", "rows", "status", "counted"),
        [
            pytest.param(
                "the deadline",
                _overflowing(bestaetigung=bestaetigung(frist=YESTERDAY)),
                "active",
                "geloescht_unbestaetigt",
                id="the deadline clock",
            ),
            pytest.param("the season's end", _overflowing(), "past", "geloescht_ohne_entscheidung", id="the season's end"),
            pytest.param(
                "the one-month",
                _overflowing(status="abgelehnt", entscheidung={"getroffen_am": "2026-02-15", "von": "admin", "grund": None}),
                "active",
                "geloescht_abgelehnt",
                id="the one-month clock",
            ),
        ],
    )
    def test_a_page_and_one_more_is_erased_whole(self, clock: str, rows: list[dict[str, Any]], status: str, counted: str):
        aktionen = _Collection("aktionen", [], {})
        database: dict[str, Any] = {"aktionen": aktionen}
        saisons = _Collection("saisons", [{"_id": SAISON_ID, "status": status, "rules": {}}], database)
        registrierungen = _Collection("registrierungen", rows, database)

        response = asyncio.run(
            sweep_router.sweep_registrierungen(
                saison_id=SAISON_ID,
                registrierungen_collection=registrierungen,  # pyright: ignore[reportArgumentType]
                saisons_collection=saisons,  # pyright: ignore[reportArgumentType]
                teams_collection=_Collection("teams", [], database, answers_reads=False),  # pyright: ignore[reportArgumentType]
                aktionen_collection=aktionen,  # pyright: ignore[reportArgumentType]
                db=_Db(),  # pyright: ignore[reportArgumentType]
                today=TODAY,
                germany_now=_NOW,
            )
        )

        assert registrierungen.rows == [], f"{clock} clock left rows a later pass would read into the same full page"
        assert getattr(response, counted) == OVERFLOW


# The reminder's two commands a row, pinned on the wire by
# `fl_backend/tests/api/test_registrierung_sweep_execution.py :: TestTheReminderClockTakesAShareEachCall`.
ROUND_TRIPS_A_ROW = 2

# The pass's other commands and the per-command cost, from whole passes timed locally, 2026-09-23.
OTHER_COMMANDS = 12
PER_COMMAND_S = 0.00107

# The round trip `sweep_router.REMINDERS_PER_PASS`'s comment sizes the share for.
ROUND_TRIP_S = 0.037


def test_a_full_share_finishes_inside_the_deadline_at_the_round_trip_its_comment_names():
    """A share raised past its budget passes every case that counts its own rows, and times out a whole pass in production."""

    assert (sweep_router.REMINDERS_PER_PASS * ROUND_TRIPS_A_ROW + OTHER_COMMANDS) * (ROUND_TRIP_S + PER_COMMAND_S) < REQUEST_DEADLINE_S
