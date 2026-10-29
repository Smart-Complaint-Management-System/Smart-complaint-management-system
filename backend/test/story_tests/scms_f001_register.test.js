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

// SCMS-F-001 / SCMS-US-001: Register a new user with required details
test("TC-REG-01: SCMS-F-001 - Register a new user with valid details succeeds", async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva@example.com",
      password: "Password123!",
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.name, "Dhruva Hegde");
  assert.equal(res.body.user.email, "dhruva@example.com");
  assert.equal(res.body.user.role, "user");
  // Ensure password hash is NEVER returned in response
  assert.equal(res.body.user.password, undefined);
  assert.equal(res.body.password, undefined);

  // Verify saved in DB
  const saved = await User.findOne({ email: "dhruva@example.com" }).select("+password");
  assert.ok(saved);
  assert.notEqual(saved.password, "Password123!");
  assert.ok(await bcrypt.compare("Password123!", saved.password));
});

test("TC-REG-01: SCMS-F-001 - Rejects duplicate email registration (case-insensitive)", async () => {
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva@example.com",
      password: "Password123!",
    });

  // Attempt registering with uppercase variant of email
  const duplicateRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Another Dhruva",
      email: "DHRUVA@example.com",
      password: "AnotherPassword123!",
    });

  assert.ok([400, 409].includes(duplicateRes.status));
  assert.match(duplicateRes.body.message, /already exists/i);
});

test("TC-REG-01 / TC-NF-03: SCMS-F-001 & SCMS-NF-003 - Rejects missing required registration fields with clear message", async () => {
  // Missing name
  const res1 = await request(app)
    .post("/api/auth/register")
    .send({ email: "test@example.com", password: "Password123!" });
  assert.equal(res1.status, 400);
  assert.match(res1.body.message, /name/i);

  // Missing email
  const res2 = await request(app)
    .post("/api/auth/register")
    .send({ name: "User", password: "Password123!" });
  assert.equal(res2.status, 400);
  assert.match(res2.body.message, /email/i);

  // Short password (< 6 chars)
  const res3 = await request(app)
    .post("/api/auth/register")
    .send({ name: "User", email: "test@example.com", password: "123" });
  assert.equal(res3.status, 400);
  assert.match(res3.body.message, /at least 6 characters/i);
});

test("TC-SEC-03: SCMS-SR-003 - Passwords must be hashed and never stored or returned in plaintext", async () => {
  const rawPassword = "SuperSecretPassword#2026";
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Secret User",
      email: "secret@example.com",
      password: rawPassword,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.user.password, undefined);

  const doc = await User.findOne({ email: "secret@example.com" }).select("+password");
  assert.ok(doc);
  assert.notEqual(doc.password, rawPassword);
  assert.ok(doc.password.startsWith("$2")); // standard bcrypt hash format
});

