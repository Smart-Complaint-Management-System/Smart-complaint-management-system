# Smart Complaint Management System

SCMS supports complaint submission and tracking, department-scoped administration, employee assignments, complaint resolution, audit history, and notifications.

## Architecture

- **Frontend:** React 19, Vite, Tailwind CSS, and Axios (`frontend/`).
- **Deployment backend:** Django REST Framework (`backend/django/`).
- **Database:** PostgreSQL for cloud deployment; SQLite is available for local development and tests.
- **Static files:** WhiteNoise with Django's compressed manifest storage.
- **Uploaded files:** private S3-compatible object storage in production; local filesystem in development.
- **Legacy:** Express/Mongoose source is retained in `backend/` for now. React is configured to use Django; Render deploys only Django.

## Requirements

- Python 3.12 recommended (3.10 minimum)
- Node.js 22 LTS and npm
- PostgreSQL for local PostgreSQL development or deployment
- An S3-compatible object storage bucket for durable production attachments

## Local setup

### Django API

In PowerShell:

```powershell
cd backend/django
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

The example uses `DJANGO_DEBUG=true` and SQLite for local startup. To use local PostgreSQL, set `DATABASE_URL` in `backend/django/.env` to your local database connection. The values shown in `.env.example` are placeholders. Then run:

```powershell
python manage.py migrate
python manage.py check
python manage.py createsuperuser
python manage.py runserver 8000
```

The API runs at `http://localhost:8000`; health check: `http://localhost:8000/api/health/`.

### React frontend

In another terminal:

```powershell
cd frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Vite runs at `http://localhost:5173`. `VITE_API_URL` defaults to Django at `http://localhost:8000`.

### Checks

```powershell
# From backend/django
python manage.py check
python manage.py test

# From frontend
npm run lint
npm run build
```

## Cloud deployment

Deployment manifests are prepared but have not been applied. Do not apply them until you are ready to create cloud resources and review the target database. The Render Blueprint creates a **new** PostgreSQL database; it does not connect to or migrate an existing production database.

### 1. Render: Django API and PostgreSQL

The repository-root [`render.yaml`](render.yaml) declares a Singapore PostgreSQL database and Django web service. It uses `backend/django` as the service root, collects WhiteNoise assets during build, runs migrations in Render's pre-deploy command, and starts Gunicorn. Auto-deploy is disabled. The pre-deploy command requires a paid Render web plan.

Before applying the Blueprint:

1. Create a **private** S3 or S3-compatible bucket for complaint attachments. Configure bucket CORS if your provider requires browser downloads from the Vercel domain.
2. In Render's Blueprint prompts, provide a strong `DJANGO_SECRET_KEY`, the exact Vercel production origin for both CORS variables, and the bucket credentials/region listed below. For Cloudflare R2, also set `AWS_S3_ENDPOINT_URL` in the web service environment.
3. Apply the Blueprint from the feature branch only when ready. Review the new Render Postgres resource and backup/retention plan before its first migration.
4. After the API is healthy, create the first Super Admin from the Render Shell with `python manage.py createsuperuser`.

Generate a secret locally without putting it in Git:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Set the output only in the Render dashboard. The service's `RENDER_EXTERNAL_HOSTNAME` is added to Django's allowed hosts automatically. Add any custom API domain to `DJANGO_ALLOWED_HOSTS`.

### 2. Vercel: React SPA

Create a Vercel project connected to this repository and configure:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Production Environment Variable | `VITE_API_URL=https://<your-render-api-host>` |

The [`frontend/vercel.json`](frontend/vercel.json) rewrite supports SPA navigation. Set the exact Vercel production origin in Render's `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` variables (no trailing slash). Add each custom Vercel domain explicitly; do not use a broad wildcard origin.

Optional Vercel CLI commands, to run only when you are ready to deploy:

```powershell
cd frontend
npm install --global vercel
vercel login
vercel link
vercel env add VITE_API_URL production
# Enter https://<your-render-api-host> when prompted.
vercel --prod
```

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DJANGO_SECRET_KEY` | Render secret | Random signing key; generate with the command above. Never commit it. |
| `DJANGO_DEBUG` | Render | `false` in production. |
| `DJANGO_ALLOWED_HOSTS` | Render | Comma-separated hostnames for any custom API domains; Render's assigned hostname is added automatically. |
| `DATABASE_URL` | Render | Supplied by the Blueprint's private Render Postgres resource. Production rejects missing or non-PostgreSQL URLs. |
| `CORS_ALLOWED_ORIGINS` | Render | Exact HTTPS Vercel origins, comma-separated. |
| `CSRF_TRUSTED_ORIGINS` | Render | Exact HTTPS browser origins, comma-separated. |
| `DJANGO_SECURE_SSL_REDIRECT` | Render | `true`; HTTPS is terminated at Render's trusted proxy. |
| `DJANGO_SECURE_HSTS_SECONDS` | Render | `31536000`; subdomain and preload flags remain off intentionally. |
| `AWS_STORAGE_BUCKET_NAME` | Render secret/config | Private bucket for uploaded files. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Render secrets | Storage credentials with only the required bucket permissions. |
| `AWS_S3_REGION_NAME` | Render | Bucket region (use `auto` where required by the provider). |
| `AWS_S3_ENDPOINT_URL` | Render, optional | Endpoint for S3-compatible providers such as R2. |
| `VITE_API_URL` | Vercel | Public Django API base URL; Vite embeds it in the frontend bundle. |

Production uploads are limited by the API to 10 MB and JPG/JPEG/PNG/PDF filename extensions. Django returns short-lived signed object URLs. Do not make the bucket public. Render's filesystem is ephemeral, so local media storage is for development only.

For detailed API behavior and the non-destructive MongoDB data migration plan, see [the Django guide](backend/django/README.md) and [the migration guide](docs/MONGODB_TO_DJANGO_MIGRATION.md). The Express backend remains available as legacy source but is not used by the React frontend or Render configuration.
