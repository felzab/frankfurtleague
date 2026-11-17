from fastapi import FastAPI

from app.core.logging import setup_logging
from app.main import create_app

# Before the factory reads the settings, so their refusal is logged in the service's format. Here
# rather than in the factory, whose every call would replace the root's handlers, a test's log
# capture among them.
setup_logging()

# Held here rather than beside the factory: a module-level `create_app()` reads the environment and the
# secret files as an import side effect, and confining it lets the factory be imported without either.
app: FastAPI = create_app()
