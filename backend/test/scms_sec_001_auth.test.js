const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
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

// ============================================================================
// SCMS-SEC-001 (SCMS-24): Verify authentication on all protected user functions
// Requirement: SCMS-SR-001
// Test References: TC-SEC-01, TC-CMP-01, TC-AUTH-01
// ============================================================================

test("SCMS-SEC-001 / TC-SEC-01: Rejects unauthenticated complaint submission with 401", async () => {
  const res = await request(app)
    .post("/api/complaints")
    .send({
      title: "Broken Chair",
      description: "Chair in room 101 has broken armrest.",
      category: "Furniture",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});

test("SCMS-SEC-001 / TC-SEC-01: Rejects complaint submission with invalid Bearer token with 401", async () => {
  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", "Bearer invalid.fake.token.12345")
    .send({
      title: "Broken Projector",
      description: "Projector not turning on in seminar hall.",
      category: "Audio / Visual",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid or expired/i);
});

test("SCMS-SEC-001 / TC-SEC-01: Rejects complaint submission with expired JWT token with 401", async () => {
  const user = await User.create({
    name: "Expired User",
    email: "expired@example.com",
    password: "Password123!",
    role: "user",
  });

  // Token created with negative expiration (already expired)
  const expiredToken = jwt.sign(
    { userId: user._id.toString(), role: user.role },
    process.env.JWT_SECRET || "super-secret-jwt-key-for-scms-pes",
    { expiresIn: "-1s" }
  );

  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${expiredToken}`)
    .send({
      title: "Network Issue",
      description: "Wi-Fi disconnected in library.",
      category: "Network / Wi-Fi",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /invalid or expired/i);
});

test("SCMS-SEC-001 / TC-SEC-01: Rejects token referencing deleted or non-existent user with 401", async () => {
  const nonExistentUserId = new mongoose.Types.ObjectId();
  const token = jwt.sign(
    { userId: nonExistentUserId.toString(), role: "user" },
    process.env.JWT_SECRET || "super-secret-jwt-key-for-scms-pes",
    { expiresIn: "1h" }
  );

  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Ghost Complaint",
      description: "Complaint from non-existent user account.",
      category: "Other",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /session no longer valid/i);
});

test("SCMS-SEC-001 / TC-SEC-01: Identity binding derives submittedBy strictly from token and ignores body spoofing", async () => {
  const legitUser = await User.create({
    name: "Legit User",
    email: "legit@example.com",
    password: "Password123!",
    role: "user",
  });

  const spoofedTargetId = new mongoose.Types.ObjectId();
  const token = jwt.sign(
    { userId: legitUser._id.toString(), role: legitUser.role },
    process.env.JWT_SECRET || "super-secret-jwt-key-for-scms-pes",
    { expiresIn: "1h" }
  );

  const res = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Legit Complaint",
      description: "Air conditioner leaking water in lab.",
      category: "Electrical",
      submittedBy: spoofedTargetId.toString(), // Attacker attempts to spoof submitter
      userId: spoofedTargetId.toString(),
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.complaint);
  // Verify submittedBy matches verified token user, NOT the spoofed ID
  assert.equal(res.body.complaint.submittedBy.toString(), legitUser._id.toString());
  assert.notEqual(res.body.complaint.submittedBy.toString(), spoofedTargetId.toString());

  const persisted = await Complaint.findById(res.body.complaint._id);
  assert.equal(persisted.submittedBy.toString(), legitUser._id.toString());
});

test("SCMS-SEC-001 / TC-SEC-01: Protected user profile /api/auth/me requires authentication", async () => {
  // Without token
  const unauthRes = await request(app).get("/api/auth/me");
  assert.equal(unauthRes.status, 401);
  assert.match(unauthRes.body.message, /authentication required/i);

  // With valid token
  const user = await User.create({
    name: "Profile User",
    email: "profile@example.com",
    password: "Password123!",
    role: "user",
  });
  const token = jwt.sign(
    { userId: user._id.toString(), role: user.role },
    process.env.JWT_SECRET || "super-secret-jwt-key-for-scms-pes",
    { expiresIn: "1h" }
  );

  const authRes = await request(app)
    .get("/api/auth/me")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(authRes.status, 200);
  assert.equal(authRes.body.user.email, "profile@example.com");
  assert.equal(authRes.body.user.name, "Profile User");
  assert.equal(authRes.body.user.password, undefined);
});
