# Continuous integration

The repository has one GitHub Actions workflow at `.github/workflows/ci.yml`. It runs on feature-branch pushes, pull requests to `main`, and manual dispatch.

## Django backend job

The job uses Python 3.12, installs `backend/django/requirements.txt`, checks Django configuration, verifies that model changes have migrations, and runs the Django test suite. It uses Django's local test configuration and does not connect to a production database.

## React frontend job

The job uses Node.js 22, installs `frontend/package-lock.json` reproducibly with `npm ci`, runs Oxlint, and builds the Vite production bundle.

## Deployment

This workflow verifies code; it does not deploy to production. Production hosting, PostgreSQL provisioning and backups, secret storage, HTTPS, allowed hosts, CORS origins, and a reviewed data migration/cutover plan must be configured separately. The MongoDB migration guide remains at [MONGODB_TO_DJANGO_MIGRATION.md](MONGODB_TO_DJANGO_MIGRATION.md).
