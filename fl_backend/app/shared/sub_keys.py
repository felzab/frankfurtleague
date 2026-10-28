import hashlib
import hmac

from pydantic import SecretStr


def derive_sub_key(master: SecretStr, label: str) -> bytes:
    """One purpose's key: an HMAC of the master under that purpose's own label.

    Derived per call rather than memoised: a cache keyed on the master holds the secret in a
    module-level dict for the process's life.
    """

    return hmac.new(master.get_secret_value().encode("utf-8"), label.encode("utf-8"), hashlib.sha256).digest()
