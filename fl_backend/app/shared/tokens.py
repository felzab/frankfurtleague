import hashlib
import secrets


def hash_token(raw: str) -> str:
    """The form the database holds a token in.

    UNKEYED: 256 random bits have no dictionary to search, and a pepper would cost a backend
    environment name reaching the server, CI and the local stack.
    """

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def mint_token() -> tuple[str, str]:
    """A raw token and its hash. The raw one goes to the response and the inbox, and nowhere else."""

    raw = secrets.token_urlsafe(32)

    return raw, hash_token(raw)
