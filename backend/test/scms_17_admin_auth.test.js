const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-17: Authenticate an authorised administrator
// Requirement: SCMS-F-012, SCMS-SR-002, SCMS-NF-004
// Test References: TC-ADM-01, TC-SEC-02
// ============================================================================

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("AdminPass123!", 4);
  await User.create({
    name: "System Admin",
    email: "admin@scms.test",
    password: hash,
    role: "admin",
  });

  const userHash = await bcrypt.hash("StudentPass123!", 4);
  await User.create({
    name: "Regular Student",
    email: "student@scms.test",
    password: userHash,
    role: "user",
  });
});

test("SCMS-17 / TC-ADM-01: Authorized administrator can log in successfully", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin@scms.test",
      password: "AdminPass123!",
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.admin.role, "admin");
  assert.equal(res.body.admin.email, "admin@scms.test");
  assert.equal(res.body.admin.password, undefined);
  assert.equal(res.body.password, undefined);
});

test("SCMS-17 / TC-ADM-01 / TC-SEC-02: Non-admin user is rejected from admin portal", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "student@scms.test",
      password: "StudentPass123!",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid email or password/i);
});

test("SCMS-17 / TC-ADM-01: Admin login rejects invalid password", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin@scms.test",
      password: "WrongPassword!",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid email or password/i);
});

test("SCMS-17 / TC-ADM-01: Admin login rejects missing email or password", async () => {
  const res1 = await request(app)
    .post("/api/admin/login")
    .send({ password: "AdminPass123!" });
  assert.equal(res1.status, 400);

  const res2 = await request(app)
    .post("/api/admin/login")
    .send({ email: "admin@scms.test" });
  assert.equal(res2.status, 400);
});

test("SCMS-17 / TC-ADM-01: Admin login email is case-insensitive", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "ADMIN@SCMS.TEST",
      password: "AdminPass123!",
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
});
