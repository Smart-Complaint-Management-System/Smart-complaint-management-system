# Smart-complaint-management-system

## Complaint resolution and closure

Administrators use `PATCH /api/admin/complaints/:id/resolution` with a bearer
token and a JSON body containing `resolution`. The value must be a nonblank
string of at most 2,000 characters; the API trims it before saving. Closed
complaints cannot be changed. Successful responses include the updated
complaint, and audit records store resolution length rather than its text.

Status changes use the existing
`PATCH /api/admin/complaints/:id/status` endpoint and follow this sequence:
`Submitted` -> `In Progress` -> `Resolved` -> `Closed`. A saved resolution is
required before moving to `Resolved` or `Closed`. Repeating the current status
is idempotent, while any other invalid transition and reopening a closed
complaint are rejected.

Complaint changes and their administrator audit records are written in one
MongoDB transaction. The configured MongoDB deployment must support
transactions (for example, a replica set).