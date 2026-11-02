const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const app = require("../../app");
const { setupTestDb, teardownTestDb, clearTestDb } = require("../testSetup");

before(async () => {
  await setupTestDb();
});

after(async () => {
  await teardownTestDb();
});

beforeEach(async () => {
  await clearTestDb();
});

// SCMS-F-004 / SCMS-US-004: Submit a complaint while authenticated
test("TC-CMP-01 / TC-SEC-01: SCMS-F-004 & SCMS-SR-001 - Complaint submission requires authentication", async () => {
  const res = await request(app)
    .post("/api/complaints")
    .send({
      title: "Broken Fan",
      description: "Fan in lab 302 is not rotating properly.",
      category: "Electrical",
    });

  assert.equal(res.status, 401);
  assert.match(res.body.message, /authentication required/i);
});

