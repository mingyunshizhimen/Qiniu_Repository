import logging

from fastapi import FastAPI

from backend.app.api.health import router as health_router
from backend.app.api.realtime import router as realtime_router
from backend.app.core.config import get_settings

backend_logger = logging.getLogger("backend")
backend_logger.setLevel(logging.INFO)
backend_logger.propagate = False

if not backend_logger.handlers:
    backend_handler = logging.StreamHandler()
    backend_handler.setLevel(logging.INFO)
    backend_handler.setFormatter(
        logging.Formatter(
            "%(levelname)s:     [%(name)s] %(message)s"
        )
    )
    backend_logger.addHandler(backend_handler)

settings = get_settings()

app = FastAPI(
    title="Qiniu AI Interpreter API",
    version=settings.app_version,
)
app.include_router(health_router, prefix="/api/v1")
app.include_router(realtime_router, prefix="/api/v1")
