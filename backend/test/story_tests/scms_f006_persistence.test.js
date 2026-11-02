const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../app");
const Complaint = require("../../models/Complaint");
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

// SCMS-F-006 / SCMS-US-006: Persist complaint details reliably
test("TC-CMP-01 & TC-CMP-02 & TC-CMP-03: SCMS-F-004, F-005, F-006 - Submit complaint while authenticated and persist in database", async () => {
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

