const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-13: View complaints submitted by the current user
// Requirement: SCMS-F-008, SCMS-SR-004, SCMS-NF-003
// Test References: TC-TRK-01, TC-SEC-04, TC-NF-03
// ============================================================================

let userA, userB;
let tokenA, tokenB;

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
    email: "alice.scms13@example.com",
    password: hash,
    role: "user",
  });

  userB = await User.create({
    name: "User Bob",
    email: "bob.scms13@example.com",
    password: hash,
    role: "user",
  });

  const resA = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice.scms13@example.com", password: "Password123!" });
  tokenA = resA.body.token;

  const resB = await request(app)
    .post("/api/auth/login")
    .send({ email: "bob.scms13@example.com", password: "Password123!" });
  tokenB = resB.body.token;
});

test("SCMS-13 / TC-TRK-01: Authenticated user with no complaints receives empty list", async () => {
  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.complaints, []);
});

test("SCMS-13 / TC-TRK-01: Authenticated user receives only their own submitted complaints", async () => {
  // Alice lodges 2 complaints
  await Complaint.create([
    {
      complaintId: "CMP-A-1",
      submittedBy: userA._id,
      title: "Broken Bench",
      description: "Classroom 201 bench is damaged.",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-A-2",
      submittedBy: userA._id,
      title: "Projector Audio Issue",
      description: "Audio cable missing in seminar room.",
      category: "Audio / Visual",
      status: "In Progress",
    },
  ]);

  // Bob lodges 1 complaint
  await Complaint.create({
    complaintId: "CMP-B-1",
    submittedBy: userB._id,
    title: "AC Malfunction",
    description: "AC not cooling in lab 3.",
    category: "Electrical",
    status: "Submitted",
  });

  // Alice fetches complaints
  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 2);
  assert.equal(res.body.complaints.length, 2);
  const titles = res.body.complaints.map((c) => c.title);
  assert.ok(titles.includes("Broken Bench"));
  assert.ok(titles.includes("Projector Audio Issue"));
  assert.ok(!titles.includes("AC Malfunction"));
});

test("SCMS-13 / TC-TRK-01: Results are ordered newest first (createdAt descending)", async () => {
  const older = await Complaint.create({
    complaintId: "CMP-OLDER",
    submittedBy: userA._id,
    title: "Older Complaint",
    description: "Logged earlier",
    category: "Infrastructure",
    status: "Submitted",
    createdAt: new Date(Date.now() - 3600000),
  });

  const newer = await Complaint.create({
    complaintId: "CMP-NEWER",
    submittedBy: userA._id,
    title: "Newer Complaint",
    description: "Logged just now",
    category: "Infrastructure",
    status: "Submitted",
    createdAt: new Date(),
  });

  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaints[0].complaintId, "CMP-NEWER");
  assert.equal(res.body.complaints[1].complaintId, "CMP-OLDER");
});

test("SCMS-13 / TC-SEC-04: Rejects unauthenticated request with 401 Unauthorized", async () => {
  const res = await request(app).get("/api/complaints");
  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});

test("SCMS-13 / TC-SEC-04: Server ignores client-supplied userId or query tampering", async () => {
  await Complaint.create({
    complaintId: "CMP-B-SECRET",
    submittedBy: userB._id,
    title: "Bob Confidential",
    description: "Confidential detail",
    category: "Hostel",
    status: "Submitted",
  });

  // Alice passes Bob's user ID in query string
  const res = await request(app)
    .get(`/api/complaints?userId=${userB._id.toString()}&submittedBy=${userB._id.toString()}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0); // Still returns 0 for Alice
});
