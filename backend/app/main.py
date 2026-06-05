from fastapi import FastAPI

from backend.app.api.health import router as health_router
from backend.app.core.config import get_settings

settings = get_settings()

app = FastAPI(
    title="Qiniu AI Interpreter API",
    version=settings.app_version,
)
app.include_router(health_router, prefix="/api/v1")
