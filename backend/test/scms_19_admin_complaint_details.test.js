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
// SCMS-19: View details of a selected complaint (as Administrator)
// Requirement: SCMS-F-014, SCMS-SR-002, SCMS-NF-004
// Test References: TC-ADM-03, TC-SEC-02
// ============================================================================

let admin, user;
let adminToken, userToken;

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
    email: "keertana.details@scms.test",
    password: hash,
    role: "admin",
  });

  const uHash = await bcrypt.hash("UserPass123!", 4);
  user = await User.create({
    name: "Student Submitter",
    email: "student.details@scms.test",
    password: uHash,
    role: "user",
  });

  const aRes = await request(app)
    .post("/api/admin/login")
    .send({ email: "keertana.details@scms.test", password: "AdminPass123!" });
  adminToken = aRes.body.token;

  const uRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "student.details@scms.test", password: "UserPass123!" });
  userToken = uRes.body.token;
});

test("SCMS-19 / TC-ADM-03: Administrator views complete complaint details and submitter profile", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-ADM-INSPECT",
    submittedBy: user._id,
    title: "Air Conditioner Leaking",
    description: "Water leaking onto computer equipment in Lab 4",
    category: "Electrical",
    status: "In Progress",
    resolution: "HVAC technician dispatched.",
  });

  const res = await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.complaintId, "CMP-ADM-INSPECT");
  assert.equal(res.body.complaint.title, "Air Conditioner Leaking");
  assert.equal(res.body.complaint.category, "Electrical");
  assert.equal(res.body.complaint.status, "In Progress");
  assert.equal(res.body.complaint.resolution, "HVAC technician dispatched.");
  assert.equal(res.body.complaint.submittedBy.name, "Student Submitter");
  assert.equal(res.body.complaint.submittedBy.email, "student.details@scms.test");
});

test("SCMS-19 / TC-ADM-03: Opening complaint detail is strictly read-only and does not mutate state", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-IMMUTABLE-READ",
    submittedBy: user._id,
    title: "Unmodified Check",
    description: "Read test",
    category: "Infrastructure",
    status: "Submitted",
  });

  const initialUpdatedAt = complaint.updatedAt;

  await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${adminToken}`);

  const postRead = await Complaint.findById(complaint._id);
  assert.equal(postRead.status, "Submitted");
  assert.equal(postRead.updatedAt.getTime(), initialUpdatedAt.getTime());
});

test("SCMS-19 / TC-ADM-03: Returns 404 Not Found for non-existent complaint ID", async () => {
  const fakeId = new mongoose.Types.ObjectId();
  const res = await request(app)
    .get(`/api/admin/complaints/${fakeId}`)
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 404);
  assert.match(res.body.message, /complaint not found/i);
});

test("SCMS-19 / TC-SEC-02: Non-admin user cannot access admin complaint detail route", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-ADMIN-GUARD",
    submittedBy: user._id,
    title: "Protected Detail",
    description: "Guarded from user access",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${userToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});
