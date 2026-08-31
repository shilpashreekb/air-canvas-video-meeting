"""
FastAPI application entrypoint.

Handles:
- Application bootstrap
- CORS
- Database initialization
- Authentication
- Gesture prediction
- Global error handling
- Health-check routes
"""

import logging

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.auth.routes import router as auth_router
from app.config import settings
from app.database.database import init_db
from app.ml.routes import router as gesture_router
from app.websocket.routes import router as websocket_router


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

logger = logging.getLogger("air_canvas")


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Backend for the Air Canvas for Video Meetings using Hand Gestures "
        "final-year BE project. Handles authentication, meeting room "
        "management, WebRTC signaling, real-time canvas synchronization, "
        "and gesture prediction."
    ),
    version="0.1.0",
    debug=settings.DEBUG,
)


# ============================================================
# CORS
# ============================================================

# IMPORTANT:
# The frontend is currently running through VS Code Live Server
# on port 5501.
#
# We explicitly allow both localhost and 127.0.0.1 because
# browsers treat them as different origins.

ALLOWED_ORIGINS = [
    "http://127.0.0.1:5501",
    "http://localhost:5501",

    # Also allow the common Live Server port in case it changes.
    "http://127.0.0.1:5500",
    "http://localhost:5500",

    # Allow local development access.
    "http://127.0.0.1",
    "http://localhost",
]


# Add configured origins from settings as well.
try:
    for origin in settings.cors_origins_list:
        if origin and origin not in ALLOWED_ORIGINS:
            ALLOWED_ORIGINS.append(origin)
except Exception:
    logger.warning(
        "Could not load configured CORS origins from settings."
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


logger.info(
    "CORS allowed origins: %s",
    ALLOWED_ORIGINS,
)


# ============================================================
# ROUTERS
# ============================================================

app.include_router(auth_router)

app.include_router(gesture_router)

app.include_router(websocket_router)


# ============================================================
# STARTUP
# ============================================================

@app.on_event("startup")
def on_startup() -> None:

    logger.info(
        "Starting %s (environment=%s, debug=%s)",
        settings.APP_NAME,
        settings.ENVIRONMENT,
        settings.DEBUG,
    )

    init_db()

    logger.info(
        "Database initialized (tables created if missing)."
    )


# ============================================================
# SHUTDOWN
# ============================================================

@app.on_event("shutdown")
def on_shutdown() -> None:

    logger.info(
        "Shutting down %s",
        settings.APP_NAME,
    )


# ============================================================
# GLOBAL HTTP ERROR HANDLER
# ============================================================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
):

    logger.warning(
        "HTTPException on %s %s -> %s: %s",
        request.method,
        request.url.path,
        exc.status_code,
        exc.detail,
    )

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.status_code,
                "message": exc.detail,
            }
        },
    )


# ============================================================
# VALIDATION ERROR HANDLER
# ============================================================

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
):

    logger.warning(
        "Validation error on %s %s -> %s",
        request.method,
        request.url.path,
        exc.errors(),
    )

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": status.HTTP_422_UNPROCESSABLE_ENTITY,
                "message": "Request validation failed.",
                "details": exc.errors(),
            }
        },
    )


# ============================================================
# GENERAL ERROR HANDLER
# ============================================================

@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request,
    exc: Exception,
):

    logger.exception(
        "Unhandled exception on %s %s",
        request.method,
        request.url.path,
    )

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
                "message": (
                    "An unexpected server error occurred. "
                    "Please try again."
                ),
            }
        },
    )


# ============================================================
# ROOT ROUTE
# ============================================================

@app.get(
    "/",
    tags=["health"],
)
def read_root():

    return {
        "app": settings.APP_NAME,
        "status": "running",
        "environment": settings.ENVIRONMENT,
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get(
    "/health",
    tags=["health"],
)
def health_check():

    return {
        "status": "ok"
    }