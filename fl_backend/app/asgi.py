"""
APP · the process entry point

The one module that builds an application at import time, which is what `uvicorn app.asgi:app` in
the Dockerfile loads.

Separate from `app/main.py` on purpose: a module-level `app = create_app()` reads the environment as
an import side effect, so holding it here is what lets the factory -- and everything that imports it
-- be imported without a fully populated `.env`, a requirement that surfaces at test COLLECTION,
naming missing settings rather than anything to do with the test. `app/main.py` exports `create_app()`
and touches no environment, and nothing imports this file but the server.
"""

from fastapi import FastAPI

from app.main import create_app

app: FastAPI = create_app()
