const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../../app");
const User = require("../../models/User");
const { setupTestDb, teardownTestDb, clearTestDb } = require("../testSetup");

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();
});

// SCMS-F-002 / SCMS-US-002: Authenticate a registered user
test("TC-AUTH-01: SCMS-F-002 - Authenticate registered user with valid credentials", async () => {
  const passwordHash = await bcrypt.hash("ValidPassword123!", 4);
  await User.create({
    name: "Valid User",
    email: "valid.user@example.com",
    password: passwordHash,
    role: "user",
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({
      email: "valid.user@example.com",
      password: "ValidPassword123!",
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, "valid.user@example.com");
  assert.equal(res.body.user.password, undefined);
});

test("TC-AUTH-01 / TC-SEC-01: SCMS-F-002 - Rejects invalid credentials with 401 without detail leakage", async () => {
  const res = await request(app)
    .post("/api/auth/login")
    .send({
      email: "nonexistent@example.com",
      password: "AnyPassword123!",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid email or password/i);
});

