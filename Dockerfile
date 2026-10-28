# syntax=docker/dockerfile:1

# ── AnkiBase (fork of Macro002/AnkiBase, MIT) ──────────────────────────────────
# Multi-stage build:
#   1. frontend  - builds the React/Vite app
#   2. runtime   - FastAPI + pre-installed Anki engine (anki-cli) + Firefox (AnkiWeb sync)
#
# Build:  docker build -t ankibase .
# Run:    docker run -d -p 8000:8000 -v ankibase-data:/app/backend/data ankibase
# The Anki engine ships pre-installed (ANKICLI_PYTHON), so first boot needs no pip.

# ── Stage 1: build the frontend ────────────────────────────────────────────────
FROM node:24-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# vite.config.ts sets a dev port; production build is unaffected.
RUN npm run build

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

# git: pip needs it to install the pinned anki-cli + invisible-playwright from GitHub.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Python dependencies (cached until requirements.txt changes)
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

# Firefox + system libraries for invisible_playwright (AnkiWeb sync, dictionary lookup)
RUN python -m playwright install --with-deps firefox

# Pre-install the Anki engine (anki-cli) in its own venv, pinned to the same commit
# as backend/engine-requirements.txt. ANKICLI_PYTHON (below) makes the backend use
# it and skip its runtime installer. Keep the pin in sync with engine-requirements.txt.
ARG ANKICLI_REF=faa2e6229a9549d857e1d4db1ed0d13557233b69
RUN python -m venv /opt/anki-engine \
    && /opt/anki-engine/bin/pip install "ankicli @ git+https://github.com/Macro002/anki-cli.git@${ANKICLI_REF}"

# Application code + built frontend
COPY backend/ ./
COPY --from=frontend /app/frontend/dist/ ./static/

# All persistent state lives under /app/backend/data:
#   data/*.db (users), data/.secrets (generated on first boot), data/<profile>/ (API keys),
#   data/anki/ (Anki collections, engine key, Anki pages).
ENV ANKI_DATA_DIR=/app/backend/data/anki \
    ANKICLI_PYTHON=/opt/anki-engine/bin/python \
    # The in-app updater would fight the image; upgrade by pulling a new image instead.
    UPDATE_REPO=local/disabled \
    APP_PORT=8000

VOLUME ["/app/backend/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+__import__('os').getenv('APP_PORT','8000')+'/api/setup/status', timeout=4).status==200 else 1)"

CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port ${APP_PORT:-8000}"]
