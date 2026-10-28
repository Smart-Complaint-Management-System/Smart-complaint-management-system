const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-18: View all submitted complaints as administrator
// Requirement: SCMS-F-013, SCMS-SR-002, SCMS-NF-001
// Test References: TC-ADM-02, TC-SEC-02, TC-NF-01
// ============================================================================

let admin, user1, user2;
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
    email: "keertana@scms.test",
    password: hash,
    role: "admin",
  });

  const uHash = await bcrypt.hash("UserPass123!", 4);
  user1 = await User.create({
    name: "User One",
    email: "user1@scms.test",
    password: uHash,
    role: "user",
  });

  user2 = await User.create({
    name: "User Two",
    email: "user2@scms.test",
    password: uHash,
    role: "user",
  });

  const aRes = await request(app)
    .post("/api/admin/login")
    .send({ email: "keertana@scms.test", password: "AdminPass123!" });
  adminToken = aRes.body.token;

  const uRes = await request(app)
    .post("/api/auth/login")
    .send({ email: "user1@scms.test", password: "UserPass123!" });
  userToken = uRes.body.token;
});

test("SCMS-18 / TC-ADM-02: Returns empty list when no complaints have been lodged", async () => {
  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.complaints, []);
});

test("SCMS-18 / TC-ADM-02: Administrator views complaints across all submitting users", async () => {
  await Complaint.create([
    {
      complaintId: "CMP-USR1",
      submittedBy: user1._id,
      title: "Broken Desk",
      description: "Desk 10 in Room 101",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-USR2",
      submittedBy: user2._id,
      title: "Network Port Dead",
      description: "Port 4 in Lab 2",
      category: "Network / Wi-Fi",
      status: "In Progress",
    },
  ]);

  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.complaints.length, 2);

  const emails = res.body.complaints.map((c) => c.submittedBy.email);
  assert.ok(emails.includes("user1@scms.test"));
  assert.ok(emails.includes("user2@scms.test"));
});

test("SCMS-18 / TC-SEC-02: Ordinary user cannot access admin complaints listing", async () => {
  const res = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", `Bearer ${userToken}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /admin access required/i);
});

test("SCMS-18 / TC-SEC-02: Unauthenticated request to admin complaints listing returns 401", async () => {
  const res = await request(app).get("/api/admin/complaints");
  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});
