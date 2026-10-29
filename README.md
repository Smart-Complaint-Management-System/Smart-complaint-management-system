# Smart Complaint Management System (SCMS)

**Course:** Software Engineering (UE24CS341A) — PES University  
**Group:** 8  
**Sprint 1 Delivery:** Full 4-Member Core Functional & Testing Implementation  
**Sprint 2 Documentation:** [Sprint 2 SICD Report](docs/Sprint-2-SICD.md)  
**CI/CD Pipeline:** [SCMS CI/CD Documentation](docs/CI_CD_PIPELINE.md)

---

## 👥 Team Members & Primary Modules

| Team Member | SRN | Primary Module | Requirements Covered |
| :--- | :--- | :--- | :--- |
| **Dhruva Ganesh Hegde** | `PES2UG24CS671` | **User Account & Complaint Submission** | `SCMS-F-001` to `SCMS-F-007`, `SCMS-SR-001`, `SCMS-SR-003`, `SCMS-NF-003`, `SCMS-NF-004`, `SCMS-NF-005` |
| **Raksha** | `PES2UG24CS652` | **Complaint Tracking & User Status** | `SCMS-F-008` to `SCMS-F-011`, `SCMS-SR-004`, `SCMS-NF-001`, `SCMS-NF-003`, `SCMS-NF-005` |
| **Keertana M** | `PES2UG24CS638` | **Admin Complaint Management & QA Lead** | `SCMS-F-012` to `SCMS-F-015`, `SCMS-SR-002`, `SCMS-NF-001`, `SCMS-NF-002`, `SCMS-NF-006` |
| **ShivaSwaroop D S** | `PES2UG24CS679` | **Complaint Resolution & Closure** | `SCMS-F-016` to `SCMS-F-018`, `SCMS-SR-005`, `SCMS-NF-002`, `SCMS-NF-005`, `SCMS-NF-006` |

---

## 🏗️ Architecture & Technology Stack

- **Backend:** Node.js, Express.js (Modular REST API architecture)
- **Database:** MongoDB with Mongoose ODM
- **Authentication & Security:** JWT (JSON Web Tokens), bcryptjs password hashing (salt rounds $\ge 10$), role-based access control (RBAC), cross-user data isolation
- **Frontend:** React 19, Vite, Tailwind CSS (User Portal, Complaint Submission, Status Tracking, Admin Triage Queue, Resolution & Closure, and Audit Logs)
- **Automated Testing:** Node.js native test runner (`node:test`) + `supertest` + `mongodb-memory-server`
- **CI/CD:** GitHub Actions automated matrix testing, linting, production build gating, and packaging

---

## 📋 Requirements & Test Case Coverage

### 1. Dhruva Ganesh Hegde — User Account & Complaint Submission
- **`SCMS-F-001` / `TC-REG-01`**: User registration with full name, email, password; input validation; duplicate email rejection (case-insensitive); password hash verification.
- **`SCMS-F-002` / `TC-AUTH-01`**: User authentication (login) returning signed JWT token and user profile; credential security without detail leakage.
- **`SCMS-F-003` / `TC-AUTH-02`**: User logout with client-side token clearance and endpoint response.
- **`SCMS-F-004` / `TC-CMP-01`**: Authenticated complaint submission; user identity derived strictly from verified token (`req.user._id`).
- **`SCMS-F-005` / `TC-CMP-02`**: Server-side unique complaint identifier generation (`CMP-...`).
- **`SCMS-F-006` / `TC-CMP-03`**: Complaint detail persistence in MongoDB (title, description, category, status, timestamps).
- **`SCMS-F-007` / `TC-CMP-04`**: Mandatory field validation before submission (missing/whitespace title, description, or category rejected).
- **`SCMS-SR-001` / `TC-SEC-01`**: Protected route authentication enforcement.
- **`SCMS-SR-003` / `TC-SEC-03`**: Password hashing via bcrypt; passwords never stored or returned in plaintext (`select: false`).
- **`SCMS-NF-003` / `TC-NF-03`**: Clear validation feedback messages.

### 2. Raksha — Complaint Tracking & User Status
- **`SCMS-F-008` / `TC-TRK-01`**: User views complaints submitted through their account; empty list `[]` for accounts with no complaints.
- **`SCMS-F-009` / `TC-TRK-02`**: User tracks live status read directly from database.
- **`SCMS-F-010` / `TC-TRK-03`**: Clear complaint status and metadata display (title, description, category, timestamps, timeline).
- **`SCMS-F-011` / `TC-TRK-04`**: User views updates and administrative responses.
- **`SCMS-SR-004` / `TC-SEC-04`**: Strict cross-user data isolation (User A cannot view or access User B's complaint; returns 403 Forbidden).
- **`SCMS-NF-001` / `TC-NF-01`**: Request response time within performance target (< 3 seconds).

### 3. Keertana M — Admin Complaint Management & QA Lead
- **`SCMS-F-012` / `TC-ADM-01`**: Administrator authentication; ordinary users denied admin access.
- **`SCMS-F-013` / `TC-ADM-02`**: Admin views all submitted complaints across all users, with populated user names and emails.
- **`SCMS-F-014` / `TC-ADM-03`**: Admin views details of any selected complaint; returns 404 for unknown IDs, 400 for malformed IDs.
- **`SCMS-F-015` / `TC-ADM-04`**: Admin updates complaint status (`Submitted` $\rightarrow$ `In Progress`); invalid jumps or reopening closed complaints rejected.
- **`SCMS-SR-002` / `TC-SEC-02`**: Server-side role checks on all admin routes; client role parameter cannot elevate privileges.
- **`SCMS-NF-002` / `TC-NF-02`**: Health and system availability check endpoint (`/health`).
- **`SCMS-NF-006` / `TC-NF-06`**: Modular maintainability and error isolation.

### 4. ShivaSwaroop D S — Complaint Resolution & Closure
- **`SCMS-F-016` / `TC-RES-01` (`TC-ADM-05`)**: Admin provides resolution/response text. String must be non-blank, max 2000 characters, trimmed before saving.
- **`SCMS-F-017` / `TC-RES-02` (`TC-ADM-06`)**: Status changes follow sequence `Submitted` $\rightarrow$ `In Progress` $\rightarrow$ `Resolved` $\rightarrow$ `Closed`. A saved resolution is required before transitioning to `Resolved` or `Closed`. Closed complaints cannot be modified.
- **`SCMS-F-018` / `TC-RES-03` (`TC-ADM-07`)**: Concerned user views final resolution and `Closed` status.
- **`SCMS-SR-005` / `TC-SEC-05`**: Admin action recording: status transitions and resolutions create immutable `AuditLog` records.
- **`SCMS-NF-005` / `TC-NF-05`**: Reliability and persistence: saved records remain consistent across refreshes and queries.

### 5. Multi-Module Integration
- **`SCMS-INT-001` / `AT-01` to `AT-05`**: Complete end-to-end multi-role lifecycle connecting user registration, complaint lodging, user tracking, admin triage, status advance, resolution recording, closure, audit trail, and user final visibility.

---

## 🚀 Getting Started

### 1. Backend Setup

```bash
cd backend

# Copy sample environment configuration
cp .env.example .env

# Install dependencies
npm ci

# Start development server
npm run dev

# Or start standard server
npm start
```

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm ci

# Start Vite dev server
npm run dev

# Or build production bundle
npm run build
```

### 3. Create Admin Account (Optional Seeding)

```bash
cd backend
npm run seed:admin
# Or using createAdmin script:
node createAdmin.js
```

---

## 🧪 Running Automated Tests

All test cases are fully automated with in-memory MongoDB:

```bash
cd backend

# Run ALL tests across all modules, story suites, and end-to-end lifecycle
npm test

# Run tests by team member module:
npm run test:dhruva        # User Account & Complaint Submission
npm run test:raksha        # Complaint Tracking & User Status
npm run test:keertana      # Admin Complaint Management
npm run test:shivaswaroop  # Complaint Resolution & Closure
npm run test:e2e           # End-to-end integration lifecycle
```

---

## 🔌 API Reference Summary

### Authentication (`/api/auth`)
- `POST /api/auth/register` — Register new user
- `POST /api/auth/login` — Login user
- `POST /api/auth/logout` — Logout user
- `GET /api/auth/me` — Current authenticated user profile

### Complaints (`/api/complaints`)
- `POST /api/complaints` — Submit a complaint (requires Auth)
- `GET /api/complaints` — List current user's complaints (requires Auth)
- `GET /api/complaints/:id` — View complaint status & details (requires Auth & ownership)
- `GET /api/complaints/:id/updates` — View updates and responses for a complaint (requires Auth & ownership)

### Admin Management (`/api/admin`)
- `POST /api/admin/login` — Administrator authentication
- `GET /api/admin/complaints` — View all submitted complaints (requires Admin)
- `GET /api/admin/complaints/:id` — View specific complaint details (requires Admin)
- `PATCH /api/admin/complaints/:id/status` — Advance complaint status (`Submitted` $\rightarrow$ `In Progress` $\rightarrow$ `Resolved` $\rightarrow$ `Closed`)
- `PATCH /api/admin/complaints/:id/resolution` — Enter resolution response (requires Admin)
- `GET /api/admin/complaints/:id/audit-logs` — View complaint audit trail (requires Admin)

### System Health
- `GET /health` or `GET /api/health` — System and database health status
