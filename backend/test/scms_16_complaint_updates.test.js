const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-16: View updates and responses for a complaint
// Requirement: SCMS-F-011, SCMS-NF-003, SCMS-NF-005
// Test References: TC-TRK-04, TC-NF-03, TC-NF-05
// ============================================================================

let userA, userB, admin;
let tokenA, tokenB, adminToken;

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("Password123!", 4);

  userA = await User.create({
    name: "User Alice",
    email: "alice.updates@example.com",
    password: hash,
    role: "user",
  });

  userB = await User.create({
    name: "User Bob",
    email: "bob.updates@example.com",
    password: hash,
    role: "user",
  });

  admin = await User.create({
    name: "Admin Staff",
    email: "admin.updates@example.com",
    password: hash,
    role: "admin",
  });

  const resA = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice.updates@example.com", password: "Password123!" });
  tokenA = resA.body.token;

  const resB = await request(app)
    .post("/api/auth/login")
    .send({ email: "bob.updates@example.com", password: "Password123!" });
  tokenB = resB.body.token;

  const resAdmin = await request(app)
    .post("/api/admin/login")
    .send({ email: "admin.updates@example.com", password: "Password123!" });
  adminToken = resAdmin.body.token;
});

test("SCMS-16 / TC-TRK-04: Returns empty updates list for freshly submitted complaint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-FRESH-01",
    submittedBy: userA._id,
    title: "New Issue",
    description: "Just submitted",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}/updates`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.updates, []);
  assert.equal(res.body.currentStatus, "Submitted");
});

test("SCMS-16 / TC-TRK-04: Displays chronological status updates and admin responses", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUDIT-CHRONO",
    submittedBy: userA._id,
    title: "Projector Issue",
    description: "Flickering HDMI port",
    category: "Audio / Visual",
    status: "Submitted",
  });

  // Admin advances to In Progress
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "In Progress" });

  // Admin provides resolution
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ resolution: "Technician replaced HDMI transmitter module." });

  // Admin marks Resolved
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Resolved" });

  // User Alice queries complaint updates
  const res = await request(app)
    .get(`/api/complaints/${complaint._id}/updates`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 3);
  assert.equal(res.body.updates[0].action, "COMPLAINT_STATUS_CHANGED");
  assert.equal(res.body.updates[0].details.newStatus, "In Progress");
  assert.equal(res.body.updates[1].action, "RESOLUTION_ADDED");
  assert.equal(res.body.updates[2].action, "COMPLAINT_STATUS_CHANGED");
  assert.equal(res.body.updates[2].details.newStatus, "Resolved");

  // Verify chronological ordering
  const t0 = new Date(res.body.updates[0].createdAt).getTime();
  const t1 = new Date(res.body.updates[1].createdAt).getTime();
  const t2 = new Date(res.body.updates[2].createdAt).getTime();
  assert.ok(t0 <= t1 && t1 <= t2);
});

test("SCMS-16 / TC-TRK-04: Persisted resolution is retrievable via detail endpoint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-RES-PERSIST",
    submittedBy: userA._id,
    title: "Broken Lock",
    description: "Door cannot lock",
    category: "Infrastructure",
    status: "Resolved",
    resolution: "Replaced cylinder lock with master key set.",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.resolution, "Replaced cylinder lock with master key set.");
});

test("SCMS-16 / TC-SEC-04: Non-owner cannot view updates/history of another user's complaint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-ALICE-PRIVATE",
    submittedBy: userA._id,
    title: "Confidential Complaint",
    description: "Private issue",
    category: "Hostel",
    status: "Submitted",
  });

  // Bob requests updates for Alice's complaint
  const res = await request(app)
    .get(`/api/complaints/${complaint._id}/updates`)
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /access denied/i);
});

test("SCMS-16 / TC-TRK-04: Returns 404 for updates on non-existent complaint ID", async () => {
  const fakeId = new mongoose.Types.ObjectId();
  const res = await request(app)
    .get(`/api/complaints/${fakeId}/updates`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 404);
  assert.match(res.body.message, /complaint not found/i);
});
