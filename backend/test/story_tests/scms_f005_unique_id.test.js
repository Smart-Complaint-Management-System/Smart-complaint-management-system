const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../app");
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

// SCMS-F-005 / SCMS-US-005: Generate a unique complaint identifier
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
  assert.ok(res1.body.complaint.complaintId.startsWith("CMP-"));
  assert.ok(res2.body.complaint.complaintId.startsWith("CMP-"));
  assert.notEqual(res1.body.complaint.complaintId, res2.body.complaint.complaintId);
});

