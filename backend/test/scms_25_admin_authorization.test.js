const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-25: Enforce administrator-only authorisation
// Requirement: SCMS-SR-002, SCMS-NF-004
// Test References: TC-SEC-02, TC-ADM-01, TC-ADM-02, TC-ADM-03, TC-ADM-04
// ============================================================================

let admin, regularUser;
let adminToken, regularUserToken;

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("AdminPass123!", 4);
  admin = await User.create({
    name: "Admin Keertana",
    email: "admin.sec002@scms.test",
    password: hash,
    role: "admin",
  });

  const uHash = await bcrypt.hash("UserPass123!", 4);
  regularUser = await User.create({
    name: "Regular Student",
    email: "student.sec002@scms.test",
    password: uHash,
    role: "user",
  });

  const aRes = await request(app)
    .post("/api/admin/login")
    .send({ email: "admin.sec002@scms.test", password: "AdminPass123!" });
  adminToken = aRes.body.token;

  const uRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "student.sec002@scms.test", password: "UserPass123!" });
  regularUserToken = uRes.body.token;
});

test("SCMS-25 / TC-SEC-02: Regular user is rejected from GET /api/admin/complaints with 403", async () => {
  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${regularUserToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-25 / TC-SEC-02: Regular user is rejected from GET /api/admin/complaints/:id with 403", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUTH-01",
    submittedBy: regularUser._id,
    title: "Test Complaint",
    description: "Testing admin auth",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${regularUserToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-25 / TC-SEC-02: Regular user is rejected from PATCH /api/admin/complaints/:id/status with 403", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUTH-02",
    submittedBy: regularUser._id,
    title: "Status Test",
    description: "Testing admin auth",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${regularUserToken}`)
    .send({ status: "In Progress" });

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-25 / TC-SEC-02: Regular user is rejected from PATCH /api/admin/complaints/:id/resolution with 403", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUTH-03",
    submittedBy: regularUser._id,
    title: "Resolution Test",
    description: "Testing admin auth",
    category: "Infrastructure",
    status: "In Progress",
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${regularUserToken}`)
    .send({ resolution: "Unauthorized attempt" });

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-25 / TC-SEC-02: Regular user is rejected from GET /api/admin/complaints/:id/audit-logs with 403", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUTH-04",
    submittedBy: regularUser._id,
    title: "Audit Test",
    description: "Testing admin auth",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/admin/complaints/${complaint._id}/audit-logs`)
    .set("Authorization", `Bearer ${regularUserToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-25 / TC-SEC-02: Unauthenticated requests to all admin endpoints return 401", async () => {
  const endpoints = [
    { method: "get", path: "/api/admin/complaints" },
    { method: "get", path: "/api/admin/complaints/fakeId" },
    { method: "patch", path: "/api/admin/complaints/fakeId/status" },
    { method: "patch", path: "/api/admin/complaints/fakeId/resolution" },
    { method: "get", path: "/api/admin/complaints/fakeId/audit-logs" },
  ];

  for (const ep of endpoints) {
    const res = await request(app)[ep.method](ep.path);
    assert.equal(res.status, 401);
    assert.match(res.body.message, /authentication required/i);
  }
});
