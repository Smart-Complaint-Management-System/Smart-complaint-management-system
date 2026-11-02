const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

let adminUser, studentUser;
let adminToken, studentToken;

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("Password123!", 4);

  adminUser = await User.create({
    name: "Admin Shiva",
    email: "shiva.admin@example.com",
    password: hash,
    role: "admin",
  });

  studentUser = await User.create({
    name: "Student User",
    email: "student@example.com",
    password: hash,
    role: "user",
  });

  const adminRes = await request(app)
    .post("/api/admin/login")
    .send({ email: "shiva.admin@example.com", password: "Password123!" });
  adminToken = adminRes.body.token;

  const userRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "student@example.com", password: "Password123!" });
  studentToken = userRes.body.token;
});

test("TC-RES-01: SCMS-F-016 - Admin can provide resolution response for a complaint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-RES-01",
    submittedBy: studentUser._id,
    title: "Broken window handle",
    description: "Handle in Room 102 came off",
    category: "Carpentry",
    status: "In Progress",
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      resolution: "Replacement handle was installed by the maintenance team on 27 Oct.",
    });

  assert.equal(res.status, 200);
  assert.equal(
    res.body.complaint.resolution,
    "Replacement handle was installed by the maintenance team on 27 Oct."
  );

  // Verify DB record
  const saved = await Complaint.findById(complaint._id);
  assert.equal(
    saved.resolution,
    "Replacement handle was installed by the maintenance team on 27 Oct."
  );
});

test("TC-RES-01: SCMS-F-016 - Empty or whitespace-only resolution is rejected", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-RES-EMPTY",
    submittedBy: studentUser._id,
    title: "Network Port Dead",
    description: "Port 4 in classroom",
    category: "Network",
    status: "In Progress",
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ resolution: "   " });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /resolution must be a non-empty string/i);
});

test("TC-RES-02: SCMS-F-017 - Closure without a resolution is rejected", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-NO-RES-CLOSE",
    submittedBy: studentUser._id,
    title: "Water Leakage",
    description: "Floor 2 washroom",
    category: "Plumbing",
    status: "In Progress",
    resolution: "", // No resolution provided
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Resolved" });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /resolution must be provided/i);
});

test("TC-RES-02: SCMS-F-017 - Admin can advance to Resolved and then Closed after resolution", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-FULL-LIFECYCLE",
    submittedBy: studentUser._id,
    title: "Projector Bulb Dead",
    description: "Auditorium main stage projector",
    category: "AV",
    status: "In Progress",
    resolution: "Replaced projector lamp with genuine OEM bulb and tested projection.",
  });

  // Advance to Resolved
  const resResolved = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Resolved" });

  assert.equal(resResolved.status, 200);
  assert.equal(resResolved.body.complaint.status, "Resolved");

  // Advance to Closed
  const resClosed = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Closed" });

  assert.equal(resClosed.status, 200);
  assert.equal(resClosed.body.complaint.status, "Closed");

  // Verify closed complaint cannot be reopened or edited
  const resReopen = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "In Progress" });
  assert.equal(resReopen.status, 400);

  const resEditResolution = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ resolution: "Try to modify closed complaint" });
  assert.equal(resEditResolution.status, 400);
});

test("TC-RES-03: SCMS-F-018 - Final resolution and Closed status are visible to the submitting user", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-FINAL-VISIBILITY",
    submittedBy: studentUser._id,
    title: "Classroom Speaker Broken",
    description: "Audio crackling heavily in room 405",
    category: "Electrical",
    status: "Closed",
    resolution: "Replaced audio amplifier board and verified crystal-clear output.",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${studentToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.status, "Closed");
  assert.equal(
    res.body.complaint.resolution,
    "Replaced audio amplifier board and verified crystal-clear output."
  );
});

test("TC-SEC-05: SCMS-SR-005 - Status changes and resolutions create audit logs", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-AUDIT-TEST",
    submittedBy: studentUser._id,
    title: "Light Switch Flickering",
    description: "Near lab 2 entrance",
    category: "Electrical",
    status: "Submitted",
  });

  // 1. Advance to In Progress
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "In Progress" });

  // 2. Add resolution
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ resolution: "Replaced switch mechanism." });

  // 3. Advance to Resolved
  await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Resolved" });

  // Check audit records
  const logs = await AuditLog.find({ complaint: complaint._id }).sort({ createdAt: 1 });
  assert.equal(logs.length, 3);
  assert.equal(logs[0].action, "COMPLAINT_STATUS_CHANGED");
  assert.equal(logs[0].details.previousStatus, "Submitted");
  assert.equal(logs[0].details.newStatus, "In Progress");

  assert.equal(logs[1].action, "RESOLUTION_ADDED");

  assert.equal(logs[2].action, "COMPLAINT_STATUS_CHANGED");
  assert.equal(logs[2].details.previousStatus, "In Progress");
  assert.equal(logs[2].details.newStatus, "Resolved");

  // Fetch audit logs via API endpoint
  const auditRes = await request(app)
    .get(`/api/admin/complaints/${complaint._id}/audit-logs`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.body.count, 3);
});

test("TC-NF-05: SCMS-NF-005 - Reliability: saved complaint and resolution remain retrievable and consistent", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-RELIABILITY-CHECK",
    submittedBy: studentUser._id,
    title: "Air Conditioning Maintenance",
    description: "Filter replacement needed",
    category: "HVAC",
    status: "Resolved",
    resolution: "Filter replaced with HEPA grade unit.",
  });

  // Multiple sequential reads produce identical consistent results
  for (let i = 0; i < 3; i++) {
    const res = await request(app)
      .get(`/api/complaints/${complaint._id}`)
      .set("Authorization", `Bearer ${studentToken}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.complaint.title, "Air Conditioning Maintenance");
    assert.equal(res.body.complaint.status, "Resolved");
    assert.equal(res.body.complaint.resolution, "Filter replaced with HEPA grade unit.");
  }
});

