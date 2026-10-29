
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

// Set the test secret before loading the application.
process.env.JWT_SECRET = "scms-automated-test-secret";

const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const AuditLog = require("../models/AuditLog");
// this test case i have written to test my part of the code
let mongoServer;
let admin;
let regularUser;
let complaint;

const adminPassword = "AdminTestPassword123!";
const userPassword = "RegularTestPassword123!";

before(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
  });
  await mongoose.connect(mongoServer.getUri());
});

after(async () => {
  await mongoose.disconnect();

  if (mongoServer) {
    await mongoServer.stop();
  }
});

beforeEach(async () => {
  await Complaint.deleteMany({});
  await AuditLog.deleteMany({});
  await User.deleteMany({});

  const adminHash = await bcrypt.hash(adminPassword, 4);
  const userHash = await bcrypt.hash(userPassword, 4);

  admin = await User.create({
    name: "Test Admin",
    email: "admin.test@example.com",
    password: adminHash,
    role: "admin",
  });

  regularUser = await User.create({
    name: "Test User",
    email: "user.test@example.com",
    password: userHash,
    role: "user",
  });

  complaint = await Complaint.create({
    submittedBy: regularUser._id,
    title: "Water leakage in laboratory",
    description: "Water is leaking near the laboratory entrance.",
    category: "Infrastructure",
    status: "Submitted",
    resolution: "",
  });
});

async function getAdminToken() {
  const response = await request(app)
    .post("/api/admin/login")
    .send({
      email: admin.email,
      password: adminPassword,
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.token);

  return response.body.token;
}

function withToken(token) {
  return { Authorization: `Bearer ${token}` };
}

function getUserToken(user = regularUser) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
}

// F-012: Admin login

test("F-012: admin can log in with valid credentials", async () => {
  const response = await request(app)
    .post("/api/admin/login")
    .send({
      email: admin.email,
      password: adminPassword,
    });

  assert.equal(response.status, 200);
  assert.ok(response.body.token);
});

test("F-012: incorrect password is rejected", async () => {
  const response = await request(app)
    .post("/api/admin/login")
    .send({
      email: admin.email,
      password: "WrongPassword123!",
    });

  assert.equal(response.status, 401);
});

test("F-012: a regular user cannot log in as admin", async () => {
  const response = await request(app)
    .post("/api/admin/login")
    .send({
      email: regularUser.email,
      password: userPassword,
    });

  assert.equal(response.status, 401);
});

// F-013: View submitted complaints

test("F-013: admin can view submitted complaints", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .get("/api/admin/complaints")
    .set(withToken(token));

  assert.equal(response.status, 200);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.complaints.length, 1);
  assert.equal(
    response.body.complaints[0].title,
    "Water leakage in laboratory"
  );
});

test("F-013: complaint listing rejects unauthenticated access", async () => {
  const response = await request(app)
    .get("/api/admin/complaints");

  assert.equal(response.status, 401);
});

test("F-013: complaint listing rejects a regular user", async () => {
  const regularToken = jwt.sign(
    { userId: regularUser._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );

  const response = await request(app)
    .get("/api/admin/complaints")
    .set(withToken(regularToken));

  assert.equal(response.status, 403);
});

// F-014: View selected complaint details

test("F-014: admin can view complaint details", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .get(`/api/admin/complaints/${complaint._id}`)
    .set(withToken(token));

  assert.equal(response.status, 200);
  assert.equal(
    response.body.complaint.title,
    "Water leakage in laboratory"
  );
  assert.equal(response.body.complaint.status, "Submitted");
});

test("F-014: invalid complaint ID is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .get("/api/admin/complaints/invalid-id")
    .set(withToken(token));

  assert.equal(response.status, 400);
});

test("F-014: nonexistent complaint returns 404", async () => {
  const token = await getAdminToken();
  const missingId = new mongoose.Types.ObjectId();

  const response = await request(app)
    .get(`/api/admin/complaints/${missingId}`)
    .set(withToken(token));

  assert.equal(response.status, 404);
});

// F-015: Update complaint status

test("F-015: admin can update complaint status", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "In Progress" });

  assert.equal(response.status, 200);
  assert.equal(response.body.complaint.status, "In Progress");

  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "In Progress");
});

test("F-015: invalid status value is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Pending Approval" });

  assert.equal(response.status, 400);
});

test("F-015: invalid complaint ID is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch("/api/admin/complaints/invalid-id/status")
    .set(withToken(token))
    .send({ status: "Resolved" });

  assert.equal(response.status, 400);
});

test("F-015: status update rejects unauthenticated access", async () => {
  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .send({ status: "Resolved" });

  assert.equal(response.status, 401);
});

// Additional security tests

test("Security: missing authorization header is rejected", async () => {
  const response = await request(app)
    .get("/api/admin/complaints");

  assert.equal(response.status, 401);
});

test("Security: malformed bearer token is rejected", async () => {
  const response = await request(app)
    .get("/api/admin/complaints")
    .set("Authorization", "Bearer not-a-valid-jwt");

  assert.equal(response.status, 401);
});
// Set the test secret before loading the application.
test("Security: expired admin token is rejected", async () => {
  const expiredToken = jwt.sign(
    { userId: admin._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: -1 }
  );

  const response = await request(app)
    .get("/api/admin/complaints")
    .set(withToken(expiredToken));

  assert.equal(response.status, 401);
});

test("Security: token signed with another secret is rejected", async () => {
  const invalidToken = jwt.sign(
    { userId: admin._id.toString() },
    "a-completely-different-test-secret",
    { expiresIn: "2h" }
  );

  const response = await request(app)
    .get("/api/admin/complaints")
    .set(withToken(invalidToken));

  assert.equal(response.status, 401);
});

test("Security: login rejects missing email", async () => {
  const response = await request(app)
    .post("/api/admin/login")
    .send({ password: adminPassword });

  assert.equal(response.status, 400);
});

test("Security: login rejects missing password", async () => {
  const response = await request(app)
    .post("/api/admin/login")
    .send({ email: admin.email });

  assert.equal(response.status, 400);
});

test("Security: empty status update is rejected without changing status", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({});

  assert.equal(response.status, 400);

  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Submitted");
});

test("Security: malformed status request body is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .set("Content-Type", "application/json")
    .send("{invalid json");

  assert.equal(response.status, 400);

  assert.equal(
    response.body.message,
    "Invalid JSON request body."
  );

  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Submitted");
});

test("F-016: audit failure does not persist a resolution", async () => {
  const token = await getAdminToken();
  const originalCreate = AuditLog.create;
  AuditLog.create = async () => {
    throw new Error("simulated audit storage failure");
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/complaints/${complaint._id}/resolution`)
      .set(withToken(token))
      .send({ resolution: "Leak repaired and inspected." });

    assert.equal(response.status, 500);
    const savedComplaint = await Complaint.findById(complaint._id);
    assert.equal(savedComplaint.resolution, "");
  } finally {
    AuditLog.create = originalCreate;
  }
});

test("F-016: admin saves a trimmed resolution without changing other complaint data", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "  Leak repaired and inspected.  " });

  assert.equal(response.status, 200);
  assert.equal(response.body.complaint.resolution, "Leak repaired and inspected.");

  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.resolution, "Leak repaired and inspected.");
  assert.equal(savedComplaint.title, complaint.title);
  assert.equal(savedComplaint.description, complaint.description);
  assert.equal(savedComplaint.category, complaint.category);
  assert.equal(savedComplaint.submittedBy.toString(), regularUser._id.toString());
  assert.equal(savedComplaint.status, "Submitted");
});

test("F-016: missing resolution is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({});

  assert.equal(response.status, 400);
});

test("F-016: null resolution is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: null });

  assert.equal(response.status, 400);
});

test("F-016: non-string resolution is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: 42 });

  assert.equal(response.status, 400);
});

test("F-016: whitespace-only resolution is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "  \n\t " });

  assert.equal(response.status, 400);
});

test("F-016: resolution over 2000 characters is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "x".repeat(2001) });

  assert.equal(response.status, 400);
});

test("F-016: unauthenticated resolution submission is rejected", async () => {
  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .send({ resolution: "Leak repaired." });

  assert.equal(response.status, 401);
});

test("F-016: regular users cannot submit a resolution", async () => {
  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(getUserToken()))
    .send({ resolution: "Leak repaired." });

  assert.equal(response.status, 403);
});

test("F-016: malformed complaint ID is rejected", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch("/api/admin/complaints/not-an-id/resolution")
    .set(withToken(token))
    .send({ resolution: "Leak repaired." });

  assert.equal(response.status, 400);
});

test("F-016: nonexistent complaint returns 404", async () => {
  const token = await getAdminToken();
  const missingId = new mongoose.Types.ObjectId();

  const response = await request(app)
    .patch(`/api/admin/complaints/${missingId}/resolution`)
    .set(withToken(token))
    .send({ resolution: "Leak repaired." });

  assert.equal(response.status, 404);
});

test("F-016: closed complaints cannot have their resolution modified", async () => {
  const token = await getAdminToken();
  complaint.status = "Closed";
  complaint.resolution = "Original resolution.";
  await complaint.save();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "Changed resolution." });

  assert.equal(response.status, 409);
  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.resolution, "Original resolution.");
});

test("F-016: first resolution audit records action and identities without resolution text", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "Leak repaired." });

  assert.equal(response.status, 200);
  const audit = await AuditLog.findOne({ complaint: complaint._id });
  assert.ok(audit);
  assert.equal(audit.administrator.toString(), admin._id.toString());
  assert.equal(audit.complaint.toString(), complaint._id.toString());
  assert.equal(audit.action, "RESOLUTION_ADDED");
  assert.deepEqual(audit.details, { resolutionLength: "Leak repaired.".length });
  assert.equal(JSON.stringify(audit.details).includes("Leak repaired."), false);
});

test("F-016: updating a resolution creates an update audit action", async () => {
  const token = await getAdminToken();

  for (const resolution of ["Initial response.", "Updated response."]) {
    const response = await request(app)
      .patch(`/api/admin/complaints/${complaint._id}/resolution`)
      .set(withToken(token))
      .send({ resolution });

    assert.equal(response.status, 200);
  }

  const audits = await AuditLog.find({ complaint: complaint._id });
  assert.deepEqual(
    audits.map((audit) => audit.action).sort(),
    ["RESOLUTION_ADDED", "RESOLUTION_UPDATED"]
  );
});

test("F-017: complaint closes after sequential resolution workflow", async () => {
  const token = await getAdminToken();

  let response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "In Progress" });
  assert.equal(response.status, 200);

  response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/resolution`)
    .set(withToken(token))
    .send({ resolution: "Leak repaired and inspected." });
  assert.equal(response.status, 200);

  response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Resolved" });
  assert.equal(response.status, 200);

  response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Closed" });

  assert.equal(response.status, 200);
  assert.equal(response.body.complaint.status, "Closed");
  assert.equal(
    response.body.complaint.resolution,
    "Leak repaired and inspected."
  );

  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Closed");
  assert.equal(savedComplaint.resolution, "Leak repaired and inspected.");
  assert.equal(savedComplaint.title, complaint.title);
  assert.equal(savedComplaint.description, complaint.description);

  const closeAudit = await AuditLog.findOne({
    complaint: complaint._id,
    action: "COMPLAINT_CLOSED",
  });
  assert.ok(closeAudit);
  assert.equal(closeAudit.administrator.toString(), admin._id.toString());
  assert.deepEqual(closeAudit.details, {
    previousStatus: "Resolved",
    newStatus: "Closed",
  });
});

test("F-017: complaint cannot close without a saved resolution", async () => {
  const token = await getAdminToken();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Closed" });

  assert.equal(response.status, 400);
  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Submitted");
});

test("F-017: complaint cannot be marked resolved without a resolution", async () => {
  const token = await getAdminToken();
  complaint.status = "In Progress";
  await complaint.save();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Resolved" });

  assert.equal(response.status, 400);
  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "In Progress");
});

test("F-017: invalid forward status jumps are rejected", async () => {
  const token = await getAdminToken();
  complaint.resolution = "Resolution prepared.";
  await complaint.save();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Resolved" });

  assert.equal(response.status, 409);
  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Submitted");
});

test("F-017: closed complaints cannot be reopened", async () => {
  const token = await getAdminToken();
  complaint.status = "Closed";
  complaint.resolution = "Complaint resolved.";
  await complaint.save();

  const response = await request(app)
    .patch(`/api/admin/complaints/${complaint._id}/status`)
    .set(withToken(token))
    .send({ status: "Resolved" });

  assert.equal(response.status, 409);
  const savedComplaint = await Complaint.findById(complaint._id);
  assert.equal(savedComplaint.status, "Closed");
});

test("F-017: repeating closure is idempotent and does not duplicate its audit", async () => {
  const token = await getAdminToken();
  complaint.status = "Resolved";
  complaint.resolution = "Complaint resolved.";
  await complaint.save();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(app)
      .patch(`/api/admin/complaints/${complaint._id}/status`)
      .set(withToken(token))
      .send({ status: "Closed" });
    assert.equal(response.status, 200);
    assert.equal(response.body.complaint.status, "Closed");
  }

  assert.equal(
    await AuditLog.countDocuments({
      complaint: complaint._id,
      action: "COMPLAINT_CLOSED",
    }),
    1
  );
});

test("F-017: failed status audit rolls back the status change", async () => {
  const token = await getAdminToken();
  complaint.status = "In Progress";
  complaint.resolution = "Resolution prepared.";
  await complaint.save();

  const originalCreate = AuditLog.create;
  AuditLog.create = async () => {
    throw new Error("simulated audit storage failure");
  };

  try {
    const response = await request(app)
      .patch(`/api/admin/complaints/${complaint._id}/status`)
      .set(withToken(token))
      .send({ status: "Resolved" });

    assert.equal(response.status, 500);
    const savedComplaint = await Complaint.findById(complaint._id);
    assert.equal(savedComplaint.status, "In Progress");
  } finally {
    AuditLog.create = originalCreate;
  }
});

test("F-017: status update for nonexistent complaint returns 404", async () => {
  const token = await getAdminToken();
  const missingId = new mongoose.Types.ObjectId();

  const response = await request(app)
    .patch(`/api/admin/complaints/${missingId}/status`)
    .set(withToken(token))
    .send({ status: "In Progress" });

  assert.equal(response.status, 404);
});
