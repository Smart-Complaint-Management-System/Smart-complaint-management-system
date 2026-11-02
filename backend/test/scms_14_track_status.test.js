const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-14: Track the current complaint status
// Requirement: SCMS-F-009, SCMS-SR-004, SCMS-NF-001, SCMS-NF-005
// Test References: TC-TRK-02, TC-SEC-04, TC-NF-01, TC-NF-05
// ============================================================================

let user, token;

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("Password123!", 4);
  user = await User.create({
    name: "Track User",
    email: "tracker@example.com",
    password: hash,
    role: "user",
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "tracker@example.com", password: "Password123!" });
  token = res.body.token;
});

test("SCMS-14 / TC-TRK-02: Returns live complaint status and details from database", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-STAT-101",
    submittedBy: user._id,
    title: "Leaking Ceiling",
    description: "Water dripping in corridor",
    category: "Plumbing",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.status, "Submitted");
  assert.equal(res.body.complaint.complaintId, "CMP-STAT-101");
  assert.equal(res.body.complaint.title, "Leaking Ceiling");
  assert.ok(res.body.complaint.createdAt);
});

test("SCMS-14 / TC-TRK-02: Reflects updated status after administrative status change", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-STAT-102",
    submittedBy: user._id,
    title: "Loose Wiring",
    description: "Switchboard sparking",
    category: "Electrical",
    status: "Submitted",
  });

  // Admin updates status in database
  complaint.status = "In Progress";
  await complaint.save();

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.status, "In Progress");
});

test("SCMS-14 / TC-TRK-02: Supports lookup by complaintId string (CMP-...) in addition to ObjectId", async () => {
  await Complaint.create({
    complaintId: "CMP-STRING-LOOKUP",
    submittedBy: user._id,
    title: "Broken Fan",
    description: "Ceiling fan making noise",
    category: "Electrical",
    status: "Submitted",
  });

  const res = await request(app)
    .get("/api/complaints/CMP-STRING-LOOKUP")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.complaintId, "CMP-STRING-LOOKUP");
  assert.equal(res.body.complaint.status, "Submitted");
});

test("SCMS-14 / TC-TRK-02: Returns 404 Not Found for non-existent complaint ID", async () => {
  const nonExistentId = new mongoose.Types.ObjectId();
  const res = await request(app)
    .get(`/api/complaints/${nonExistentId}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 404);
  assert.match(res.body.message, /complaint not found/i);
});

test("SCMS-14 / TC-SEC-04: Rejects unauthenticated status tracking requests with 401", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-UNAUTH-CHECK",
    submittedBy: user._id,
    title: "Public Issue",
    description: "Cannot be viewed without auth",
    category: "Other",
    status: "Submitted",
  });

  const res = await request(app).get(`/api/complaints/${complaint._id}`);
  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});
