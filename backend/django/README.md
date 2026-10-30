# Django backend foundation

This directory contains the Django REST API for account, department, complaint, assignment, priority, audit, notification, and dashboard workflows. The original Express backend remains in `backend/` for rollback and migration validation. The React frontend uses Django by default and can be pointed elsewhere with `VITE_API_URL`.

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
Copy-Item .env.example .env
# macOS/Linux: cp .env.example .env
python manage.py migrate
```

Replace the example `DJANGO_SECRET_KEY` with a private random value before running Django with `DJANGO_DEBUG=false`; Django refuses to start in that mode with the placeholder or a missing key. `manage.py test` and `DJANGO_DEBUG=true` may use a development-only key. Without `DATABASE_URL`, Django uses a local SQLite database, so development does not require PostgreSQL credentials. To use PostgreSQL, set a connection URL such as:

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

## Django app responsibilities

`accounts` contains the custom email-based user, employee and department-admin profiles, JWT authentication, role management, and backend permission classes. `departments` contains configurable department records. `complaints` owns complaint lifecycle, routing, attachments, and priority. `assignments` owns employee work history and evidence. `audit` owns append-only activity records. `notifications` owns recipient-scoped in-app notices. `dashboard` provides role-scoped summaries.

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

## Complaint and department routing APIs

| Method | Path | Access |
|---|---|---|
| `GET`, `POST` | `/api/complaints` | Authenticated; users list own complaints and can submit; staff see scoped records |
| `GET`, `PATCH` | `/api/complaints/{id-or-complaint-id}` | Owner, assigned employee, matching department admin, or super admin |
| `GET` | `/api/complaints/{id}/updates` | Same visibility as complaint details |
| `GET`, `POST` | `/api/complaints/{id}/attachments` | Visible user; file validation and role checks apply |
| `GET` | `/api/admin/complaints` | Super admin organization-wide; department admin own department |
| `GET` | `/api/admin/complaints/unassigned` | Super admin only |
| `PATCH` | `/api/admin/complaints/{id}/status` | Complaint managers; lifecycle validation applies |
| `PATCH` | `/api/admin/complaints/{id}/resolution` | Complaint managers |
| `PATCH` | `/api/admin/complaints/{id}/priority` | Complaint managers; reason required and safety protections apply |
| `PATCH` | `/api/admin/complaints/{id}/department` | Super admin only; reason required |
| `POST` | `/api/admin/complaints/{id}/reopen` | Super admin only; reason required |
| `GET`, `POST`, `PATCH`, `DELETE` | `/api/categories/` | Authenticated read; super admin manages mappings (delete deactivates) |
| `GET`, `PATCH` | `/api/priority-policy` | Manager read; super admin configures |

Category mappings route incoming categories on the server. Unmapped categories enter the super-admin review queue. Department data from client submissions is ignored. Legacy response aliases (`_id`, `complaintId`, `submittedBy`) remain available to existing React components.

## Work, dashboards, audit, and notifications

| Method | Path | Access |
|---|---|---|
| `GET`, `POST` | `/api/assignments` | Managers view scoped assignments and assign employees |
| `GET` | `/api/assignments/me` | Employee's own work history |
| `POST` | `/api/assignments/{id}/accept`, `/progress`, `/complete` | Assigned employee only |
| `POST` | `/api/assignments/{id}/verify`, `/reassign` | Matching department admin or super admin |
| `POST` | `/api/assignments/{id}/evidence` | Assigned employee |
| `GET` | `/api/assignments/workload` | Manager; department scoped |
| `GET` | `/api/dashboard/summary` | Role-specific, database-backed data |
| `GET` | `/api/dashboard/employees/{id}` | Super admin, same department admin, or that employee |
| `GET` | `/api/audit-events` | Role-scoped immutable activity records |
| `GET` | `/api/notifications` | Authenticated recipient only |
| `POST` | `/api/notifications/read-all`, `/api/notifications/{id}/read` | Recipient only |

Priority uses configurable transparent rule-based scores; it does not use machine learning. Complaint lifecycle is `Submitted` → `Assigned` → `Accepted` → `In Progress` → `Work Completed` → `Resolved` → `Closed`, with the legacy manager status endpoint retained. Resolution is required before resolve or close. Assignment history, status history, audit events, and notifications are stored in Django.

## MongoDB migration (separate, not run)

No MongoDB credentials are required for local development, and no production database migration has been executed. The original Express backend and MongoDB remain available. See [`../../docs/MONGODB_TO_DJANGO_MIGRATION.md`](../../docs/MONGODB_TO_DJANGO_MIGRATION.md) for source schema inventory, export/import sequencing, reconciliation checks, rollback, and cutover gates. Run migrations only against an explicitly selected and backed-up Django database.
