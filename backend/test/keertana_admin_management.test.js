const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

let adminUser, regularUser;
let adminToken, regularUserToken;

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("TestPass123!", 4);

  adminUser = await User.create({
    name: "Admin Keertana",
    email: "keertana.admin@example.com",
    password: hash,
    role: "admin",
  });

  regularUser = await User.create({
    name: "Student User",
    email: "student@example.com",
    password: hash,
    role: "user",
  });

  const adminLoginRes = await request(app)
    .post("/api/admin/login")
    .send({ email: "keertana.admin@example.com", password: "TestPass123!" });
  adminToken = adminLoginRes.body.token;

  const userLoginRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "student@example.com", password: "TestPass123!" });
  regularUserToken = userLoginRes.body.token;
});

test("TC-ADM-01: SCMS-F-012 - Authorised administrator can log in successfully", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "keertana.admin@example.com",
      password: "TestPass123!",
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal(res.body.admin.role, "admin");
  assert.equal(res.body.admin.email, "keertana.admin@example.com");
});

test("TC-ADM-01 / TC-SEC-02: SCMS-F-012 & SCMS-SR-002 - Non-admin user cannot log in through admin portal", async () => {
  const res = await request(app)
    .post("/api/admin/login")
    .send({
      email: "student@example.com",
      password: "TestPass123!",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid email or password/i);
});

test("TC-ADM-02: SCMS-F-013 - Admin can view all complaints across users", async () => {
  await Complaint.create([
    {
      complaintId: "CMP-001",
      submittedBy: regularUser._id,
      title: "Broken Chair",
      description: "Room 101",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-002",
      submittedBy: regularUser._id,
      title: "Projector Flashing",
      description: "Lab 3",
      category: "Hardware",
      status: "In Progress",
    },
  ]);

  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.complaints.length, 2);
  // Verify user details populated
  assert.equal(res.body.complaints[0].submittedBy.email, "student@example.com");
});

test("TC-ADM-02 / TC-SEC-02: SCMS-F-013 & SCMS-SR-002 - Non-admin user cannot access admin complaints list", async () => {
  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${regularUserToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("TC-ADM-03: SCMS-F-014 - Admin can view details of a selected complaint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-DETAIL-01",
    submittedBy: regularUser._id,
    title: "Air Conditioner Not Cooling",
    description: "Auditorium unit 3",
    category: "HVAC",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.title, "Air Conditioner Not Cooling");
  assert.equal(res.body.complaint.submittedBy.name, "Student User");
});

test("TC-ADM-03: SCMS-F-014 - Returns 404 for nonexistent complaint ID", async () => {
  const fakeId = new User()._id; // valid ObjectId format
  const res = await request(app)
    .get(`/api/admin/complaints/${fakeId}`)
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 404);
  assert.match(res.body.message, /complaint not found/i);
});

test("TC-ADM-04: SCMS-F-015 - Admin can update complaint status to In Progress", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-STATUS-TRANSITION",
    submittedBy: regularUser._id,
    title: "Power Socket Broken",
    description: "Desk 12 in reading room",
    category: "Electrical",
    status: "Submitted",
  });

  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "In Progress" });

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.status, "In Progress");

  // Verify DB updated
  const updated = await Complaint.findById(complaint._id);
  assert.equal(updated.status, "In Progress");
});

test("TC-ADM-04: SCMS-F-015 - Invalid status transition is rejected with 400", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-INVALID-TRANS",
    submittedBy: regularUser._id,
    title: "Loose Cable",
    description: "Server room",
    category: "Network",
    status: "Submitted",
  });

  // Cannot jump from Submitted straight to Closed
  const res = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "Closed" });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /invalid status transition/i);
});

test("TC-NF-02: SCMS-NF-002 - Health check endpoint verifies system and DB availability", async () => {
  const res = await request(app).get("/health");

  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
  assert.equal(res.body.server, "running");
  assert.equal(res.body.database, "connected");
});

