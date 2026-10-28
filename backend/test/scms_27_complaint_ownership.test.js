const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-27: Prevent cross-user complaint access
// Requirement: SCMS-SR-004, SCMS-NF-004
// Test References: TC-SEC-04
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
    email: "alice.sec004@scms.test",
    password: hash,
    role: "user",
  });

  userB = await User.create({
    name: "User Bob",
    email: "bob.sec004@scms.test",
    password: hash,
    role: "user",
  });

  admin = await User.create({
    name: "Admin Staff",
    email: "admin.sec004@scms.test",
    password: hash,
    role: "admin",
  });

  const resA = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice.sec004@scms.test", password: "Password123!" });
  tokenA = resA.body.token;

  const resB = await request(app)
    .post("/api/auth/login")
    .send({ email: "bob.sec004@scms.test", password: "Password123!" });
  tokenB = resB.body.token;

  const resAdmin = await request(app)
    .post("/api/admin/login")
    .send({ email: "admin.sec004@scms.test", password: "Password123!" });
  adminToken = resAdmin.body.token;
});

test("SCMS-27 / TC-SEC-04: User B cannot access User A's complaint by ID (returns 403 Forbidden)", async () => {
  const complaintA = await Complaint.create({
    complaintId: "CMP-ALICE-CONFIDENTIAL",
    submittedBy: userA._id,
    title: "Alice Private Incident",
    description: "Highly sensitive student issue",
    category: "Hostel",
    status: "Submitted",
  });

  // Bob requests Alice's complaint
  const res = await request(app)
    .get(`/api/complaints/${complaintA._id}`)
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /access denied/i);
  // Ensure no sensitive complaint data leaked in body
  assert.equal(res.body.complaint, undefined);
});

test("SCMS-27 / TC-SEC-04: User B cannot access User A's complaint by custom complaintId string", async () => {
  await Complaint.create({
    complaintId: "CMP-ALICE-CUSTOM-ID",
    submittedBy: userA._id,
    title: "Alice Custom ID Incident",
    description: "Sensitive issue",
    category: "Academic",
    status: "Submitted",
  });

  const res = await request(app)
    .get("/api/complaints/CMP-ALICE-CUSTOM-ID")
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /access denied/i);
});

test("SCMS-27 / TC-SEC-04: User B cannot access User A's complaint updates/history (returns 403 Forbidden)", async () => {
  const complaintA = await Complaint.create({
    complaintId: "CMP-ALICE-UPDATES",
    submittedBy: userA._id,
    title: "Alice Updates Check",
    description: "Tracking history",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaintA._id}/updates`)
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /access denied/i);
  assert.equal(res.body.updates, undefined);
});

test("SCMS-27 / TC-SEC-04: User A's complaints list never contains User B's complaints", async () => {
  await Complaint.create([
    {
      complaintId: "CMP-A-ONLY",
      submittedBy: userA._id,
      title: "Alice Public Issue",
      description: "Desc",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-B-ONLY",
      submittedBy: userB._id,
      title: "Bob Public Issue",
      description: "Desc",
      category: "Furniture",
      status: "Submitted",
    },
  ]);

  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.complaints[0].complaintId, "CMP-A-ONLY");
});

test("SCMS-27 / TC-SEC-04: Authorized administrator can access complaint details across users", async () => {
  const complaintA = await Complaint.create({
    complaintId: "CMP-ALICE-ADMIN-READ",
    submittedBy: userA._id,
    title: "Alice Complaint for Admin",
    description: "Desc",
    category: "Infrastructure",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaintA._id}`)
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.complaintId, "CMP-ALICE-ADMIN-READ");
});
