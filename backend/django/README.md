# Django backend foundation

This directory contains the new Django API foundation. It lives beside the existing Express backend under `backend/`; the Express service and React frontend remain unchanged during Phase 1.

## Requirements

- Python 3.10 or newer
- PostgreSQL for a PostgreSQL-backed environment (credentials are not included)

## Local setup

From this directory, create and activate a virtual environment, install dependencies, and copy the example environment file:

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Set a private `DJANGO_SECRET_KEY` in `.env`. Without `DATABASE_URL`, Django uses a local SQLite database, so initial checks do not require PostgreSQL credentials. To use PostgreSQL, set a connection URL such as:

```dotenv
DATABASE_URL=postgres://scms:password@localhost:5432/scms
```

The default CORS origins are the existing Vite development origins on port 5173. Set `CORS_ALLOWED_ORIGINS` to a comma-separated list for another frontend origin.

## Run the API

```bash
python manage.py check
python manage.py test
python manage.py runserver 8000
```

The unauthenticated health endpoints return `{"status":"ok"}` at `/health/` and `/api/health/`. JWT authentication is configured for future protected DRF endpoints; business APIs and data models are intentionally outside Phase 1.

## App boundaries

`accounts`, `departments`, `complaints`, `assignments`, `audit`, and `dashboard` are registered Django apps with initial app configuration only. Domain models, authentication flows, and the existing frontend API compatibility layer are planned for later phases.
