# Smart Complaint Management System

SCMS provides complaint submission and tracking, department-scoped administration, employee assignment workflows, audit history, and notifications.

## Architecture

- **Frontend:** React 19, Vite, Tailwind CSS, and Axios in `frontend/`.
- **Backend:** Django REST Framework in `backend/django/`.
- **Database:** PostgreSQL for the target deployment. SQLite remains available for isolated local tests when `DATABASE_URL` is unset.
- **Authentication:** JWT with role and department permissions enforced by Django.

The original Express/Mongoose backend has been removed from the working tree after Django API and permission verification. Existing MongoDB data is not imported or modified by this repository cleanup. The migration plan remains at [docs/MONGODB_TO_DJANGO_MIGRATION.md](docs/MONGODB_TO_DJANGO_MIGRATION.md).

## Requirements

- Python 3.10+
- Node.js 22 LTS and npm
- PostgreSQL for PostgreSQL-backed development or deployment

## Start locally

### 1. Configure and run Django

In PowerShell:

```powershell
cd backend/django
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/django/.env`: set `DJANGO_DEBUG=true` for local development and configure `DATABASE_URL` for your local PostgreSQL database. The example uses placeholders, not real database credentials. To use SQLite for local checks, leave `DATABASE_URL` unset. Do not use the development setting or a placeholder secret in production.

```powershell
python manage.py migrate
python manage.py check
python manage.py createsuperuser
python manage.py runserver 8000
```

The API runs at `http://localhost:8000`; its health endpoint is `http://localhost:8000/api/health/`.

### 2. Configure and run React

In another terminal:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Vite runs at `http://localhost:5173`. `VITE_API_URL` defaults to `http://localhost:8000`. Django's local CORS defaults include the Vite development origins; set `CORS_ALLOWED_ORIGINS` for any different browser origin.

## Verify locally

```powershell
# From backend/django
python manage.py check
python manage.py test

# From frontend
npm run lint
npm run build
```

The Django backend guide documents authentication, departments, assignments, complaint APIs, permissions, and environment configuration: [backend/django/README.md](backend/django/README.md).

## Repository documents

- [MongoDB to Django migration plan](docs/MONGODB_TO_DJANGO_MIGRATION.md) - preserved migration and reconciliation guidance; no production data migration is run automatically.
- [CI pipeline](docs/CI_CD_PIPELINE.md) - current Django and React quality checks.
- [Sprint 2 implementation record](docs/Sprint-2-SICD.md) - historical document from the original Express implementation.
- The root PDF files contain the project requirements, architecture/design specification, and test plan.
