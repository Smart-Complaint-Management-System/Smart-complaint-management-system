const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
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

test("SCMS-INT-001 / AT-01 to AT-05: Complete full-lifecycle end-to-end multi-role integration across all 4 modules", async () => {
  // Step 0: Seed Admin Account (Module 3 - Keertana M)
  const adminHash = await bcrypt.hash("AdminSecretPassword123!", 4);
  await User.create({
    name: "Admin Officer",
    email: "admin.officer@scms.pes.edu",
    password: adminHash,
    role: "admin",
  });

  // ==========================================
  // MODULE 1: DHRUVA GANESH HEGDE (User Account & Complaint Submission)
  // ==========================================
  // Step 1: User Registration (SCMS-F-001 / TC-REG-01)
  const registerRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Student Priya",
      email: "priya.student@pes.edu",
      password: "PriyaPassword123!",
    });
  assert.equal(registerRes.status, 201);
  const priyaToken = registerRes.body.token;
  assert.ok(priyaToken);
  assert.equal(registerRes.body.user.role, "user");

  // Step 2: User Login (SCMS-F-002 / TC-AUTH-01)
  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({
      email: "priya.student@pes.edu",
      password: "PriyaPassword123!",
    });
  assert.equal(loginRes.status, 200);
  assert.ok(loginRes.body.token);

  // Step 3: User submits complaint (SCMS-F-004 to F-007 / TC-CMP-01 to 04)
  const submitRes = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${priyaToken}`)
    .send({
      title: "Broken Bench in Room 304",
      description: "Third row bench has a cracked wooden support and is unsafe to sit on.",
      category: "Furniture",
    });
  assert.equal(submitRes.status, 201);
  const createdComplaint = submitRes.body.complaint;
  assert.ok(createdComplaint);
  assert.ok(createdComplaint.complaintId);
  assert.equal(createdComplaint.status, "Submitted");
  assert.equal(createdComplaint.resolution, "");

  // ==========================================
  // MODULE 2: RAKSHA (Complaint Tracking & User Status)
  // ==========================================
  // Step 4: User views her complaints list (SCMS-F-008 / TC-TRK-01)
  const myComplaintsRes = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${priyaToken}`);
  assert.equal(myComplaintsRes.status, 200);
  assert.equal(myComplaintsRes.body.count, 1);
  assert.equal(myComplaintsRes.body.complaints[0].complaintId, createdComplaint.complaintId);

  // Step 5: User tracks current status of the complaint (SCMS-F-009, F-010 / TC-TRK-02, 03)
  const trackRes1 = await request(app)
    .get(`/api/complaints/${createdComplaint._id}`)
    .set("Authorization", `Bearer ${priyaToken}`);
  assert.equal(trackRes1.status, 200);
  assert.equal(trackRes1.body.complaint.status, "Submitted");

  // Step 6: Verify second user cannot access Priya's complaint (SCMS-SR-004 / TC-SEC-04)
  const user2Reg = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Student Rahul",
      email: "rahul.student@pes.edu",
      password: "RahulPassword123!",
    });
  const rahulToken = user2Reg.body.token;

  const unauthorizedAccessRes = await request(app)
    .get(`/api/complaints/${createdComplaint._id}`)
    .set("Authorization", `Bearer ${rahulToken}`);
  assert.equal(unauthorizedAccessRes.status, 403);

  // ==========================================
  // MODULE 3: KEERTANA M (Admin Complaint Management)
  // ==========================================
  // Step 7: Admin Login (SCMS-F-012 / TC-ADM-01)
  const adminLoginRes = await request(app)
    .post("/api/admin/login")
    .send({
      email: "admin.officer@scms.pes.edu",
      password: "AdminSecretPassword123!",
    });
  assert.equal(adminLoginRes.status, 200);
  const adminToken = adminLoginRes.body.token;

  // Step 8: Admin views all submitted complaints (SCMS-F-013 / TC-ADM-02)
  const adminAllRes = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(adminAllRes.status, 200);
  assert.equal(adminAllRes.body.count, 1);
  assert.equal(adminAllRes.body.complaints[0].submittedBy.email, "priya.student@pes.edu");

  // Step 9: Admin views complaint details (SCMS-F-014 / TC-ADM-03)
  const adminDetailRes = await request(app)
    .get(`/api/admin/complaints/${createdComplaint._id}`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(adminDetailRes.status, 200);
  assert.equal(adminDetailRes.body.complaint.title, "Broken Bench in Room 304");

  // Step 10: Admin updates status to In Progress (SCMS-F-015 / TC-ADM-04)
  const statusUpdateRes = await request(app)
    .patch(`/api/admin/complaints/${createdComplaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "In Progress" });
  assert.equal(statusUpdateRes.status, 200);
  assert.equal(statusUpdateRes.body.complaint.status, "In Progress");

  // ==========================================
  // MODULE 4: SHIVASWAROOP D S (Complaint Resolution & Closure)
  // ==========================================
  // Step 11: Admin provides resolution response (SCMS-F-016 / TC-RES-01)
  const resolutionRes = await request(app)
    .patch(`/api/admin/complaints/${createdComplaint._id}/resolution`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      resolution: "Campus carpentry crew replaced the cracked wooden bench support with a reinforced steel bracket on 27 Oct.",
    });
  assert.equal(resolutionRes.status, 200);
  assert.ok(resolutionRes.body.complaint.resolution.includes("steel bracket"));

  // Step 12: Admin advances status to Resolved (SCMS-F-015 / TC-ADM-04)
  const resolvedRes = await request(app)
    .patch(`/api/admin/complaints/${createdComplaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Resolved" });
  assert.equal(resolvedRes.status, 200);
  assert.equal(resolvedRes.body.complaint.status, "Resolved");

  // Step 13: Admin closes complaint after resolution (SCMS-F-017 / TC-RES-02)
  const closeRes = await request(app)
    .patch(`/api/admin/complaints/${createdComplaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Closed" });
  assert.equal(closeRes.status, 200);
  assert.equal(closeRes.body.complaint.status, "Closed");

  // Step 14: Verify AuditLog entries created (SCMS-SR-005 / TC-SEC-05)
  const auditRes = await request(app)
    .get(`/api/admin/complaints/${createdComplaint._id}/audit-logs`)
    .set("Authorization", `Bearer ${adminToken}`);
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.body.count >= 3);

  // ==========================================
  // FINAL USER VISIBILITY (Raksha & ShivaSwaroop Integration)
  // ==========================================
  // Step 15: Student Priya retrieves the complaint and sees final resolution & Closed status (SCMS-F-018 / TC-RES-03)
  const finalUserView = await request(app)
    .get(`/api/complaints/${createdComplaint._id}`)
    .set("Authorization", `Bearer ${priyaToken}`);
  assert.equal(finalUserView.status, 200);
  assert.equal(finalUserView.body.complaint.status, "Closed");
  assert.equal(
    finalUserView.body.complaint.resolution,
    "Campus carpentry crew replaced the cracked wooden bench support with a reinforced steel bracket on 27 Oct."
  );
});

