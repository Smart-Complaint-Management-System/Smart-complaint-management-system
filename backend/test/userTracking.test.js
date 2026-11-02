const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

process.env.JWT_SECRET = "test-secret-for-user-tracking";

const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");

let mongo;
let userA;
let userB;
let admin;
let complaintA;
let complaintB;
let tokenA;
let tokenB;
let adminToken;

function createToken(user) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });

  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Complaint.deleteMany({}),
  ]);

  userA = await User.create({
    name: "User A",
    email: "usera@example.com",
    password: "password123",
    role: "user",
  });

  userB = await User.create({
    name: "User B",
    email: "userb@example.com",
    password: "password123",
    role: "user",
  });

  admin = await User.create({
    name: "Admin",
    email: "admin@example.com",
    password: "password123",
    role: "admin",
  });

  tokenA = createToken(userA);
  tokenB = createToken(userB);
  adminToken = createToken(admin);

  complaintA = await Complaint.create({
    submittedBy: userA._id,
    title: "Water leakage",
    description: "Water leaking near the entrance",
    category: "Maintenance",
    status: "In Progress",
  });

  complaintB = await Complaint.create({
    submittedBy: userB._id,
    title: "Streetlight issue",
    description: "Streetlight is not working",
    category: "Electrical",
    status: "Resolved",
    resolution: "The streetlight bulb was replaced",
  });
});

after(async () => {
  await mongoose.disconnect();

  if (mongo) {
    await mongo.stop();
  }
});

test("rejects requests without an authentication token", async () => {
  const response = await request(app).get("/api/user/complaints");

  assert.equal(response.status, 401);
});

test("rejects invalid authentication tokens", async () => {
  const response = await request(app)
    .get("/api/user/complaints")
    .set("Authorization", "Bearer invalid-token");

  assert.equal(response.status, 401);
});

test("rejects admin tokens on user endpoints", async () => {
  const response = await request(app)
    .get("/api/user/complaints")
    .set("Authorization", `Bearer ${adminToken}`);

  assert.equal(response.status, 403);
});

test("returns only complaints belonging to the logged-in user", async () => {
  const response = await request(app)
    .get("/api/user/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.complaints.length, 1);
  assert.equal(
    response.body.complaints[0]._id,
    complaintA._id.toString()
  );
  assert.equal(
    response.body.complaints.some(
      (complaint) => complaint._id === complaintB._id.toString()
    ),
    false
  );
});

test("returns a user's own complaint details and status", async () => {
  const response = await request(app)
    .get(`/api/user/complaints/${complaintA._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.complaint.title, "Water leakage");
  assert.equal(response.body.complaint.status, "In Progress");
});

test("returns resolution details for a resolved complaint", async () => {
  const response = await request(app)
    .get(`/api/user/complaints/${complaintB._id}`)
    .set("Authorization", `Bearer ${tokenB}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.complaint.status, "Resolved");
  assert.equal(
    response.body.complaint.resolution,
    "The streetlight bulb was replaced"
  );
});

test("does not allow a user to view another user's complaint", async () => {
  const response = await request(app)
    .get(`/api/user/complaints/${complaintB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(response.status, 404);
});

test("rejects malformed complaint IDs", async () => {
  const response = await request(app)
    .get("/api/user/complaints/not-a-valid-id")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(response.status, 400);
});

test("returns an empty list when the user has no complaints", async () => {
  await Complaint.deleteMany({ submittedBy: userA._id });

  const response = await request(app)
    .get("/api/user/complaints")
    .set("Authorization", `Bearer ${tokenA}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.complaints, []);
});