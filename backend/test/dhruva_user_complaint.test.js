const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
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

test("TC-AUTH-02: SCMS-F-003 - User logout returns 200 OK and client clears session", async () => {
  const res = await request(app)
    .post("/api/auth/logout")
    .send();

  assert.equal(res.status, 200);
  assert.match(res.body.message, /logged out/i);
});

test("TC-CMP-01 / TC-SEC-01: SCMS-F-004 & SCMS-SR-001 - Complaint submission requires authentication", async () => {
  const res = await request(app)
    .post("/api/complaints")
    .send({
      title: "Broken Fan",
      description: "Fan in lab 302 is not rotating properly.",
      category: "Electrical",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});

test("TC-CMP-01 & TC-CMP-02 & TC-CMP-03: SCMS-F-004, F-005, F-006 - Submit complaint while authenticated", async () => {
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva.test@example.com",
      password: "Password123!",
    });
  const token = regRes.body.token;

  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Water leakage",
      description: "Water is leaking near the computer science lab entrance.",
      category: "Infrastructure",
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.complaint);
  assert.ok(res.body.complaint._id);
  assert.ok(res.body.complaint.complaintId);
  assert.ok(res.body.complaint.complaintId.startsWith("CMP-"));
  assert.equal(res.body.complaint.title, "Water leakage");
  assert.equal(res.body.complaint.status, "Submitted");
  assert.equal(res.body.complaint.category, "Infrastructure");
  assert.equal(res.body.complaint.resolution, "");

  // Verify persistence in DB (SCMS-F-006)
  const saved = await Complaint.findById(res.body.complaint._id);
  assert.ok(saved);
  assert.equal(saved.title, "Water leakage");
  assert.equal(saved.submittedBy.toString(), regRes.body.user.id);
});

test("TC-CMP-02: SCMS-F-005 - Generates unique complaint IDs for multiple submissions", async () => {
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva.multi@example.com",
      password: "Password123!",
    });
  const token = regRes.body.token;

  const res1 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Complaint One",
      description: "First description here.",
      category: "Hostel",
    });

  const res2 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Complaint Two",
      description: "Second description here.",
      category: "Academic",
    });

  assert.equal(res1.status, 201);
  assert.equal(res2.status, 201);
  assert.notEqual(res1.body.complaint.complaintId, res2.body.complaint.complaintId);
});

test("TC-CMP-04 / TC-NF-03: SCMS-F-007 & SCMS-NF-003 - Rejects missing or whitespace-only mandatory fields", async () => {
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva.valid@example.com",
      password: "Password123!",
    });
  const token = regRes.body.token;

  // Missing title
  const res1 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "   ",
      description: "Valid description",
      category: "Infrastructure",
    });
  assert.equal(res1.status, 400);
  assert.match(res1.body.message, /title is required/i);

  // Missing description
  const res2 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Valid Title",
      description: "   ",
      category: "Infrastructure",
    });
  assert.equal(res2.status, 400);
  assert.match(res2.body.message, /description is required/i);

  // Missing category
  const res3 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Valid Title",
      description: "Valid description",
      category: "   ",
    });
  assert.equal(res3.status, 400);
  assert.match(res3.body.message, /category is required/i);
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

