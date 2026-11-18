import hashlib
from collections.abc import Iterable
from typing import Final

from app.core.crud import literal_pattern

# The form's unanswered links of one season a mailbox may hold before a press naming it mails that mailbox nothing. What a
# stranger can do through a public form is make the league mail an address, and each link owes a reminder and a notice
# after it, so this bounds the mail and refuses nobody: a refusal would be a lock a stranger can aim at a real school. An
# answer frees its link, and two schools sharing a person stay under it. A real person's seat can still stand past it behind a
# stranger's presses, unmailed until an administrator sends its link, which is why both lists say so. The application form
# and the registration form each count their own and each season its own, so two forms or two running seasons double it.
# The count is exact: a press it leaves room writes that mailbox's document (`mailbox_anchor_ids`), so a rival committed
# since the transaction's snapshot, which the count read, is a write conflict and the retry reads its row. After the count
# and never before it, the snapshot keeping that order exact: a press finding the mailbox full mails nothing and so writes
# nothing, and a flood contends only until the bound, where a write ahead of the count serves one mailbox one press a second
# at production's round trip and fails the rest, a real school's among them, at the request's deadline. One document a
# mailbox, because one on the season stalls every school's press and every season write the same way.
OPEN_LINKS_PER_MAILBOX: Final = 3


def mailbox_of(address: str) -> str:
    """The mailbox a stored address reaches, its plus-tag off. A provider's own aliases, such as Gmail's dots, stay out of reach."""

    local, _, domain = address.rpartition("@")

    return f"{local.partition('+')[0]}@{domain}"


def mailbox_anchor_ids(*, addresses: Iterable[str]) -> list[str]:
    """Each of these addresses' mailbox as its document's `_id`, one hashed document, sorted so two presses meet in one order.

    Unkeyed: the id is a write-conflict key that lapses in an hour, for a press whose row holds the address plain.
    """

    return sorted({hashlib.sha256(mailbox_of(address).encode("utf-8")).hexdigest() for address in addresses})


def mailbox_pattern(address: str) -> str:
    """A `$regex` matching this address's mailbox and each plus-tagged form of it, on the stored fold; its fixed prefix keeps it on an index."""

    local, _, domain = mailbox_of(address).rpartition("@")

    return f"^{literal_pattern(local)}(\\+[^@]*)?@{literal_pattern(domain)}$"
