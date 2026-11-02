const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../app");
const User = require("../models/User");
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
// SCMS-NFR-003 (SCMS-31): Verify usability of submission and tracking flows
// Requirement: SCMS-NF-003
// Test References: TC-NF-03, TC-REG-01, TC-CMP-04
// ============================================================================

test("SCMS-NFR-003 / TC-NF-03: User registration returns clear, human-friendly validation messages", async () => {
  // 1. Missing name
  const res1 = await request(app)
    .post("/api/auth/register")
    .send({ email: "user@example.com", password: "Password123!" });
  assert.equal(res1.status, 400);
  assert.equal(res1.body.message, "Full name is required.");

  // 2. Whitespace-only name
  const res2 = await request(app)
    .post("/api/auth/register")
    .send({ name: "   ", email: "user@example.com", password: "Password123!" });
  assert.equal(res2.status, 400);
  assert.equal(res2.body.message, "Full name is required.");

  // 3. Missing email
  const res3 = await request(app)
    .post("/api/auth/register")
    .send({ name: "Valid Name", password: "Password123!" });
  assert.equal(res3.status, 400);
  assert.equal(res3.body.message, "Email address is required.");

  // 4. Invalid email format
  const res4 = await request(app)
    .post("/api/auth/register")
    .send({ name: "Valid Name", email: "not-an-email", password: "Password123!" });
  assert.equal(res4.status, 400);
  assert.equal(res4.body.message, "Please provide a valid email address.");

  // 5. Short password (< 6 chars)
  const res5 = await request(app)
    .post("/api/auth/register")
    .send({ name: "Valid Name", email: "user@example.com", password: "123" });
  assert.equal(res5.status, 400);
  assert.equal(res5.body.message, "Password must be at least 6 characters long.");
});

test("SCMS-NFR-003 / TC-NF-03: Complaint submission returns clear, distinct field validation messages", async () => {
  const userRes = await request(app)
    .post("/api/auth/register")
    .send({ name: "Test User", email: "test.usability@example.com", password: "Password123!" });
  const token = userRes.body.token;

  // 1. Missing or whitespace-only title
  const res1 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "   ", description: "Water leaking", category: "Infrastructure" });
  assert.equal(res1.status, 400);
  assert.equal(res1.body.message, "Complaint title is required.");

  // 2. Overly long title (> 200 chars)
  const res2 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "A".repeat(201), description: "Valid description", category: "Infrastructure" });
  assert.equal(res2.status, 400);
  assert.equal(res2.body.message, "Complaint title must not exceed 200 characters.");

  // 3. Missing or whitespace-only description
  const res3 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Valid Title", description: "   ", category: "Infrastructure" });
  assert.equal(res3.status, 400);
  assert.equal(res3.body.message, "Complaint description is required.");

  // 4. Overly long description (> 5000 chars)
  const res4 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Valid Title", description: "B".repeat(5001), category: "Infrastructure" });
  assert.equal(res4.status, 400);
  assert.equal(res4.body.message, "Complaint description must not exceed 5000 characters.");

  // 5. Missing or whitespace-only category
  const res5 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({ title: "Valid Title", description: "Valid description", category: "   " });
  assert.equal(res5.status, 400);
  assert.equal(res5.body.message, "Complaint category is required.");
});

test("SCMS-NFR-003 / TC-NF-03: Successful complaint submission yields clear confirmation and formatted CMP ID", async () => {
  const userRes = await request(app)
    .post("/api/auth/register")
    .send({ name: "Submitting User", email: "submitter.usability@example.com", password: "Password123!" });
  const token = userRes.body.token;

  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Broken Bench",
      description: "Wooden bench in garden quadrangle is cracked.",
      category: "Furniture",
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.message, "Complaint submitted successfully.");
  assert.ok(res.body.complaint);
  assert.ok(res.body.complaint.complaintId.startsWith("CMP-"));
  assert.equal(res.body.complaint.status, "Submitted");
});
