import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from .config import get_settings
from .routers import agent, conversations, evidence, ideas, notes, projects, runs, research_ideas

logger = logging.getLogger("research_os")

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(ideas.router)
app.include_router(runs.router)
app.include_router(evidence.router)
app.include_router(notes.router)
app.include_router(conversations.router)
app.include_router(agent.router)
app.include_router(research_ideas.router)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    # Constraints the service layer does not pre-check (e.g. concurrent inserts).
    return JSONResponse(
        status_code=409,
        content={"detail": f"Database constraint violated: {exc.orig}"},
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    # Never swallow: unexpected errors are logged with traceback and surfaced as 500.
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health", tags=["system"])
def health():
    return {"status": "ok", "app": settings.app_name, "version": app.version}
