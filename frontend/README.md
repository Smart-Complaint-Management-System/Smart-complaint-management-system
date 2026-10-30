# React frontend

The existing React 19/Vite application talks to the Django API by default. It includes regular-user complaint submission and tracking, Super Admin and department-admin views, employee work updates, and organization management.

## Local setup

From the `frontend/` directory:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Vite serves the frontend at `http://localhost:5173`. `VITE_API_URL` defaults to `http://localhost:8000`; set it in `.env.local` only when Django runs at a different address. Django's `CORS_ALLOWED_ORIGINS` must include the browser origin.

## Checks

```powershell
npm run lint
npm run build
```

The package currently has no separate frontend test script. Backend endpoint and permission tests live in the Django applications; use `python manage.py test` from `backend/django/`.
