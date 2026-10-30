# MongoDB to Django data migration plan

This document records a controlled migration plan. It does not connect to MongoDB, import data, alter production records, or remove the Express backend. No production credentials are stored in this repository.

## Source inventory

The Mongoose schemas in `backend/models/` currently contain:

- `User`: Mongo `_id`, name, normalized email, bcrypt password hash, `user` or `admin` role, and Mongoose timestamps.
- `Complaint`: Mongo `_id`, optional unique `complaintId`, `submittedBy` user reference, title, description, category, legacy status (`Submitted`, `In Progress`, `Resolved`, `Closed`), resolution, and timestamps.
- `AuditLog`: Mongo `_id`, administrator and complaint references, action, mixed `details`, and creation timestamp.

Before a real import, inspect the deployed MongoDB collection counts, indexes, references, actual status/action values, and representative documents using read-only queries. The schemas do not show attachment records or assignment history; inspect any separate collections or stored files before migration.

## Mapping

| Mongo source | Django destination | Migration rule |
|---|---|---|
| User `_id` | User legacy identifier field (add before import if absent) | Keep an explicit Mongo ID-to-Django PK map; never use the Mongo ID as a numeric Django PK |
| User name/email | `accounts.User` | Normalize email; map `user` → `USER`, `admin` → `SUPER_ADMIN` pending administrator review |
| User bcrypt hash | No direct password migration | Django cannot verify the existing bcrypt format safely by assumption; set imported accounts to unusable passwords and require a password reset |
| Complaint `_id` | `complaints.Complaint.legacy_mongo_id` | Preserve as a string for reconciliation |
| Complaint `complaintId` | `complaints.Complaint.complaint_id` | Preserve when present and unique; deterministically generate an ID only for records with no legacy ID |
| Complaint `submittedBy` | `submitted_by` foreign key | Resolve only through the imported user ID map; reject/record orphans for manual review |
| Complaint category/status/resolution | Complaint fields | Preserve category; map existing statuses directly; derive department only from reviewed category mappings |
| Complaint timestamps | `created_at`, `updated_at` | Parse UTC timestamps and restore after row creation |
| AuditLog `_id` | `audit.AuditEvent.legacy_mongo_id` | Preserve source identity |
| AuditLog administrator/complaint/details/timestamp | Audit event actor, complaint, action, metadata, created time | Resolve through ID maps; preserve original details and action string in metadata when normalization is needed |

The old system's `admin` role is organization-wide, so mapping to `SUPER_ADMIN` best preserves current access. Confirm each administrator's intended scope before production cutover, then create department-admin profiles and employee profiles using verified organization data. Do not infer department membership from email or complaint category.

## Safe execution sequence

1. Agree on a maintenance window and named database owner. Take a verified MongoDB backup and a PostgreSQL backup; record restore test results.
2. Export users, complaints, and audit logs to a secured, access-controlled staging location. Keep exports outside Git and remove them according to the data-retention policy after validation.
3. Run read-only source checks: record counts, duplicate emails/complaint IDs, invalid statuses, missing references, timestamp ranges, and audit orphan counts.
4. Import to an empty, isolated staging PostgreSQL database through an idempotent import job using `legacy_mongo_id` keys and explicit user/complaint maps. Use a single transaction or restartable batches with a durable checkpoint; never clear destination tables automatically.
5. Reconcile imported counts and foreign-key relationships. Verify complaint ID uniqueness, owner links, timestamps, status distributions, category mappings, audit links, and sampled records against Mongo. Compare aggregate counts and hashes for fields that can be canonicalized.
6. Test representative accounts, user tracking, admin queues, login resets, and the complaint lifecycle against the staging import. Existing password hashes require a password reset unless a separately reviewed compatible password hasher is implemented and tested.
7. Keep MongoDB read-only and Express available during verification. Capture a final delta export or schedule a brief write freeze, repeat reconciliation, and only then plan a reversible traffic cutover to Django.
8. Monitor errors and counts after cutover. Retain the MongoDB backup and rollback path for the agreed recovery period. Do not delete MongoDB or Express until the owner signs off on verified behavior and retention requirements.

## Cutover gates

Cutover requires verified source and destination counts, no unresolved ownership or audit orphans, acceptable sampled record comparisons, passing Django and frontend checks, tested account recovery, a rehearsed rollback, and explicit database-owner approval. This repository currently has not met those production-specific gates because no MongoDB credentials, dump, or PostgreSQL production configuration were provided. The Express backend remains intact.
