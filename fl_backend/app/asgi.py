"""
APP · the process entry point

The one module that builds an application at import time, which is what `fastapi run app/asgi.py` in
the Dockerfile loads.

Separate from `app/main.py` on purpose. A module-level `app = create_app()` reads the environment as an
import side effect, so putting it in `main.py` would mean that importing the factory -- or anything
that imports it -- required a fully populated `.env`. The test suite hit exactly that: it failed during
COLLECTION, naming eight missing settings, on a test that would then have been deselected.

Splitting the composition root out is the fix. `app/main.py` exports `create_app()` and touches no
environment; this file is the single place where "build the real app from the real environment" is
stated, and nothing imports it but the server.
"""

from fastapi import FastAPI

from app.main import create_app

app: FastAPI = create_app()
