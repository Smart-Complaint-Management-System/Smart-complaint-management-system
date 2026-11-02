const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

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

  const hash = await bcrypt.hash("UserPassword123!", 4);
  userA = await User.create({
    name: "User Alice",
    email: "alice@example.com",
    password: hash,
    role: "user",
  });

  userB = await User.create({
    name: "User Bob",
    email: "bob@example.com",
    password: hash,
    role: "user",
  });

  const resA = await request(app)
    .post("/api/auth/login")
    .send({ email: "alice@example.com", password: "UserPassword123!" });
  tokenA = resA.body.token;

  const resB = await request(app)
    .post("/api/auth/login")
    .send({ email: "bob@example.com", password: "UserPassword123!" });
  tokenB = resB.body.token;
});

test("TC-TRK-01: SCMS-F-008 - Authenticated user with no complaints receives an empty list", async () => {
  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 0);
  assert.deepEqual(res.body.complaints, []);
});

test("TC-TRK-01: SCMS-F-008 - User receives their own submitted complaints only", async () => {
  // Alice submits two complaints
  await Complaint.create([
    {
      complaintId: "CMP-A1-001",
      submittedBy: userA._id,
      title: "Broken Bench",
      description: "Bench broken in classroom 201",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-A1-002",
      submittedBy: userA._id,
      title: "Projector not working",
      description: "HDMI port loose in lab 1",
      category: "AV",
      status: "In Progress",
    },
  ]);

  // Bob submits one complaint
  await Complaint.create({
    complaintId: "CMP-B1-001",
    submittedBy: userB._id,
    title: "AC not cooling",
    description: "AC 2 in seminar hall",
    category: "HVAC",
    status: "Submitted",
  });

  // Alice queries her complaints
  const resAlice = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(resAlice.status, 200);
  assert.equal(resAlice.body.count, 2);
  assert.equal(resAlice.body.complaints.length, 2);
  const titles = resAlice.body.complaints.map((c) => c.title);
  assert.ok(titles.includes("Broken Bench"));
  assert.ok(titles.includes("Projector not working"));
  assert.ok(!titles.includes("AC not cooling"));
});

test("TC-TRK-02: SCMS-F-009 - Track current complaint status read from database", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-STATUS-01",
    submittedBy: userA._id,
    title: "Water Filter Leak",
    description: "Near 3rd floor water dispenser",
    category: "Plumbing",
    status: "In Progress",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.status, "In Progress");
  assert.equal(res.body.complaint.complaintId, "CMP-STATUS-01");
});

test("TC-TRK-03: SCMS-F-010 - Display complaint status and details clearly", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-CLEAR-01",
    submittedBy: userA._id,
    title: "Library WiFi dropping",
    description: "Frequent disconnects in the reading hall",
    category: "Network",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.complaint.title, "Library WiFi dropping");
  assert.equal(res.body.complaint.category, "Network");
  assert.equal(res.body.complaint.status, "Submitted");
  assert.ok(res.body.complaint.createdAt);
  assert.ok(res.body.complaint.updatedAt);
});

test("TC-TRK-04: SCMS-F-011 - View updates and responses for a complaint", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-RESP-01",
    submittedBy: userA._id,
    title: "Elevator Sound",
    description: "Unusual noise in Block B elevator",
    category: "Maintenance",
    status: "Resolved",
    resolution: "Technician inspected and lubricated the motor pulleys.",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(res.status, 200);
  assert.equal(
    res.body.complaint.resolution,
    "Technician inspected and lubricated the motor pulleys."
  );
  assert.equal(res.body.complaint.status, "Resolved");
});

test("TC-SEC-04: SCMS-SR-004 - Prevent cross-user complaint access", async () => {
  // Alice owns this complaint
  const complaint = await Complaint.create({
    complaintId: "CMP-ALICE-PRIVATE",
    submittedBy: userA._id,
    title: "Alice Private Issue",
    description: "Confidential detail",
    category: "Hostel",
    status: "Submitted",
  });

  // Bob attempts to access Alice's complaint by ID
  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(res.status, 403);
  assert.match(res.body.message, /access denied/i);
});

test("TC-NF-01: SCMS-NF-001 - Response time completes promptly under normal load (< 3s)", async () => {
  const start = Date.now();
  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${tokenA}`);
  const duration = Date.now() - start;

  assert.equal(res.status, 200);
  assert.ok(duration < 3000, `Expected duration < 3000ms, took ${duration}ms`);
});

