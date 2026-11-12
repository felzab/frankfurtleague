from fastapi import FastAPI

from app.main import create_app

# Held here rather than beside the factory: a module-level `create_app()` reads the environment and the
# secret files as an import side effect, and confining it lets the factory be imported without either.
app: FastAPI = create_app()
