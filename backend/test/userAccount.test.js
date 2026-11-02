const { test, before, after, beforeEach, setupTestDb, teardownTestDb } = require("./testSetup");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const request = require("supertest");

const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");

let regularUser;
const testPassword = "RegularTestPassword123!";

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await Complaint.deleteMany({});
  await User.deleteMany({});

  const passwordHash = await bcrypt.hash(testPassword, 4);

  regularUser = await User.create({
    name: "Test User",
    email: "user.test@example.com",
    password: passwordHash,
    role: "user",
  });
});

test("User Account - registration rejects an existing email", async () => {
  const response = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Duplicate User",
      email: "user.test@example.com",
      password: testPassword,
    });

  assert.ok(
    [400, 409].includes(response.status),
    `Expected 400 or 409, received ${response.status}`
  );
});

test("User Account - authentication rejects invalid credentials", async () => {
  const response = await request(app)
    .post("/api/auth/login")
    .send({
      email: "user.test@example.com",
      password: "WrongPassword123!",
    });

  assert.ok(
    [400, 401].includes(response.status),
    `Expected 400 or 401, received ${response.status}`
  );
});

test("User Account - complaint submission requires authentication", async () => {
  const response = await request(app)
    .post("/api/complaints")
    .send({
      title: "Test complaint",
      description: "Testing complaint submission",
      category: "Infrastructure",
    });

  assert.ok(
    [401, 403].includes(response.status),
    `Expected 401 or 403, received ${response.status}`
  );
});

test("User Account - a registered user can be stored with the user role", async () => {
  const savedUser = await User.findOne({
    email: "user.test@example.com",
  });

  assert.ok(savedUser);
  assert.equal(savedUser.role, "user");
  assert.equal(savedUser.name, "Test User");
});

test("User Account - complaint model stores a submitted complaint", async () => {
  const complaint = await Complaint.create({
    submittedBy: regularUser._id,
    title: "Water leakage",
    description: "Water is leaking near the laboratory entrance.",
    category: "Infrastructure",
    status: "Submitted",
    resolution: "",
  });

  const savedComplaint = await Complaint.findById(complaint._id);

  assert.ok(savedComplaint);
  assert.equal(savedComplaint.title, "Water leakage");
  assert.equal(savedComplaint.status, "Submitted");
  assert.equal(
    savedComplaint.submittedBy.toString(),
    regularUser._id.toString()
  );
});
