const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const { generateToken } = require("../utils/helpers");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();
});

// ============================================================================
// SCMS-SEC-003 (SCMS-26): Verify password hashing and secret handling
// Requirement: SCMS-SR-003
// Test References: TC-SEC-03
// ============================================================================

test("SCMS-SEC-003 / TC-SEC-03: Passwords must be hashed using bcrypt and never stored in plaintext", async () => {
  const rawPassword = "UltraSecurePassword#2026!";
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Security User",
      email: "security@example.com",
      password: rawPassword,
    });

  assert.equal(res.status, 201);

  // Directly inspect database document
  const userInDb = await User.findOne({ email: "security@example.com" }).select("+password");
  assert.ok(userInDb);
  assert.notEqual(userInDb.password, rawPassword);
  assert.ok(userInDb.password.startsWith("$2")); // Standard bcrypt salt & hash prefix
  assert.ok(await bcrypt.compare(rawPassword, userInDb.password));
});

test("SCMS-SEC-003 / TC-SEC-03: User schema omits password hash by default in normal queries (select: false)", async () => {
  const rawPassword = "ConfidentialPassword@123";
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "Hidden Password User",
      email: "hidden@example.com",
      password: rawPassword,
    });

  // Query without explicit .select("+password")
  const defaultQueryUser = await User.findOne({ email: "hidden@example.com" });
  assert.ok(defaultQueryUser);
  assert.equal(defaultQueryUser.password, undefined);

  const defaultFindById = await User.findById(defaultQueryUser._id);
  assert.ok(defaultFindById);
  assert.equal(defaultFindById.password, undefined);
});

test("SCMS-SEC-003 / TC-SEC-03: Registration response NEVER includes password or password hash", async () => {
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      name: "No Leak Register",
      email: "noleak.reg@example.com",
      password: "TestPassword#123",
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.password, undefined);
  assert.equal(res.body.user.password, undefined);
  assert.equal(JSON.stringify(res.body).includes("TestPassword#123"), false);
});

test("SCMS-SEC-003 / TC-SEC-03: Login response NEVER includes password or password hash", async () => {
  const rawPassword = "LoginSecretPass#2026";
  await request(app)
    .post("/api/auth/register")
    .send({
      name: "No Leak Login",
      email: "noleak.login@example.com",
      password: rawPassword,
    });

  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({
      email: "noleak.login@example.com",
      password: rawPassword,
    });

  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.body.password, undefined);
  assert.equal(loginRes.body.user.password, undefined);
  assert.equal(JSON.stringify(loginRes.body).includes(rawPassword), false);
});

test("SCMS-SEC-003 / TC-SEC-03: Profile /api/auth/me response NEVER includes password or password hash", async () => {
  const rawPassword = "ProfileSecretPass#2026";
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "No Leak Profile",
      email: "noleak.profile@example.com",
      password: rawPassword,
    });

  const meRes = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${regRes.body.token}`);

  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.password, undefined);
  assert.equal(JSON.stringify(meRes.body).includes(rawPassword), false);
});

test("SCMS-SEC-003 / TC-SEC-03: Secret handling requires configured JWT_SECRET for token creation", () => {
  const originalSecret = process.env.JWT_SECRET;
  try {
    delete process.env.JWT_SECRET;
    const dummyUser = { _id: "60c72b2f9b1d8b2bad000001", role: "user" };
    assert.throws(
      () => generateToken(dummyUser),
      /JWT_SECRET is not configured/i
    );
  } finally {
    process.env.JWT_SECRET = originalSecret;
  }
});
