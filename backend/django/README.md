# Django backend foundation

This directory contains the Django API foundation and Phase 2 account, role, and department management. It lives beside the existing Express backend under `backend/`; the Express service and React frontend remain unchanged.

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
python manage.py migrate
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

The default department migration adds Electrical, Plumbing, Civil, Networking, and Housekeeping if they do not already exist. It never deletes department rows. `migrate` applies Django migrations to the database selected by `DATABASE_URL`; use a backed-up development database when applying migrations to an existing environment.

## App boundaries

`accounts` contains the custom email-based user, employee and department-admin profiles, JWT authentication, role management, and backend permission classes. `departments` contains configurable department records. The `complaints`, `assignments`, `audit`, and `dashboard` apps remain scaffolds for later phases.

## Authentication and profile APIs

All paths retain the existing frontend's no-trailing-slash auth convention:

| Method | Path | Access |
|---|---|---|
| `POST` | `/api/auth/register` | Public; creates a `USER` account only and returns JWTs |
| `POST` | `/api/auth/login` | Public; email and password, returns access, refresh, user, and legacy `token` alias |
| `POST` | `/api/admin/login` | Public; same token response, limited to super and department admins |
| `POST` | `/api/auth/logout` | Authenticated; revokes outstanding refresh tokens and existing access tokens |
| `GET`, `PATCH` | `/api/auth/me` | Authenticated; own profile only; role and department are read-only |
| `POST` | `/api/auth/password` | Authenticated; verifies the old password and revokes existing tokens |
| `POST` | `/api/auth/token/refresh` | Public; exchanges a valid refresh token |

JWT access tokens expire after 30 minutes and refresh tokens after one day. Logout and password changes increment the account's token version, so existing access tokens stop working immediately. Public registration cannot choose a privileged role.

## Department and employee APIs

The Django REST router uses trailing slashes for management routes:

| Method | Path | Access |
|---|---|---|
| `GET` | `/api/departments/` | Authenticated; super admin sees all, staff see their department, regular users see active departments |
| `POST`, `PATCH`, `DELETE` | `/api/departments/` and `/api/departments/{id}/` | Super admin; `DELETE` deactivates the department |
| `GET` | `/api/users/` and `/api/users/{id}/` | Super admin sees all; department admins see only users linked to their department |
| `POST`, `PATCH`, `DELETE` | `/api/users/` and `/api/users/{id}/` | Super admin only; `DELETE` deactivates the account |
| `GET` | `/api/employees/` and `/api/employees/{id}/` | Super admin sees all; department admins see only their employees |
| `POST`, `PATCH`, `DELETE` | `/api/employees/` and `/api/employees/{id}/` | Super admin or department admin within their department; `DELETE` deactivates the account |
| `GET` | `/api/employees/me/` | Employee's own profile |

Super admins can assign all four roles. Department admins can create employees only in their own active department. Employees and regular users cannot manage accounts. Role changes and deactivation revoke outstanding tokens. The last active super admin cannot be demoted or deactivated. Account and department deletion endpoints preserve rows by deactivating them.

Department admins and employees are linked to a department through their role profile. API querysets are scoped in the backend, and cross-department detail requests return `404`. The authorization rules do not depend on frontend visibility.

The current phase does not add complaint or assigned-work APIs. Those routes and their data models are planned for later phases.
