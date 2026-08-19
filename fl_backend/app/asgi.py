from fastapi import FastAPI

from app.main import create_app

# Held here rather than in `app/main.py`: a module-level `create_app()` reads the environment as an
# import side effect, and confining it is what lets the factory be imported without a `.env`.
app: FastAPI = create_app()
