const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../app");
const User = require("../models/User");
const Complaint = require("../models/Complaint");
const { setupTestDb, teardownTestDb, clearTestDb } = require("./testSetup");

// ============================================================================
// SCMS-15: Display complaint status clearly
// Requirement: SCMS-F-010, SCMS-NF-003
// Test References: TC-TRK-03, TC-NF-03
// ============================================================================

let user, token;
const VALID_STATUSES = ["Submitted", "In Progress", "Resolved", "Closed"];

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();

  const hash = await bcrypt.hash("Password123!", 4);
  user = await User.create({
    name: "Display User",
    email: "display@example.com",
    password: hash,
    role: "user",
  });

  const res = await request(app)
    .post("/api/auth/login")
    .send({ email: "display@example.com", password: "Password123!" });
  token = res.body.token;
});

test("SCMS-15 / TC-TRK-03: Displays all 4 valid lifecycle statuses accurately across queries", async () => {
  for (const status of VALID_STATUSES) {
    const complaint = await Complaint.create({
      complaintId: `CMP-${status.toUpperCase().replace(/\s+/g, "_")}`,
      submittedBy: user._id,
      title: `Complaint in ${status}`,
      description: `Testing status display for ${status}`,
      category: "Infrastructure",
      status: status,
      resolution: (status === "Resolved" || status === "Closed") ? "Fixed problem" : "",
    });

    const res = await request(app)
      .get(`/api/complaints/${complaint._id}`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.complaint.status, status);
  }
});

test("SCMS-15 / TC-TRK-03: Returned complaint payload contains complete metadata for UI rendering", async () => {
  const complaint = await Complaint.create({
    complaintId: "CMP-METADATA-CHECK",
    submittedBy: user._id,
    title: "Projector Bulb Dead",
    description: "Seminar room 2 projector requires replacement bulb.",
    category: "Audio / Visual",
    status: "Submitted",
  });

  const res = await request(app)
    .get(`/api/complaints/${complaint._id}`)
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  const c = res.body.complaint;
  assert.equal(c.complaintId, "CMP-METADATA-CHECK");
  assert.equal(c.title, "Projector Bulb Dead");
  assert.equal(c.description, "Seminar room 2 projector requires replacement bulb.");
  assert.equal(c.category, "Audio / Visual");
  assert.equal(c.status, "Submitted");
  assert.ok(c.createdAt);
  assert.ok(c.updatedAt);
  assert.equal(c.submittedBy.name, "Display User");
  assert.equal(c.submittedBy.email, "display@example.com");
});

test("SCMS-15 / TC-NF-03: Status list filter provides accurate counts per status category", async () => {
  await Complaint.create([
    {
      complaintId: "CMP-S1",
      submittedBy: user._id,
      title: "Sub 1",
      description: "Desc",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-S2",
      submittedBy: user._id,
      title: "Sub 2",
      description: "Desc",
      category: "Furniture",
      status: "Submitted",
    },
    {
      complaintId: "CMP-IP1",
      submittedBy: user._id,
      title: "IP 1",
      description: "Desc",
      category: "Plumbing",
      status: "In Progress",
    },
  ]);

  const res = await request(app)
    .get("/api/complaints")
    .set("Authorization", `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.count, 3);
  const submittedCount = res.body.complaints.filter((c) => c.status === "Submitted").length;
  const inProgressCount = res.body.complaints.filter((c) => c.status === "In Progress").length;
  assert.equal(submittedCount, 2);
  assert.equal(inProgressCount, 1);
});
