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

// SCMS-F-007 / SCMS-US-007: Validate mandatory complaint details
test("TC-CMP-04 / TC-NF-03: SCMS-F-007 & SCMS-NF-003 - Rejects missing or whitespace-only mandatory fields", async () => {
  const regRes = await request(app)
    .post("/api/auth/register")
    .send({
      name: "Dhruva Hegde",
      email: "dhruva.valid@example.com",
      password: "Password123!",
    });
  const token = regRes.body.token;

  // Missing title
  const res1 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "   ",
      description: "Valid description",
      category: "Infrastructure",
    });
  assert.equal(res1.status, 400);
  assert.match(res1.body.message, /title is required/i);

  // Missing description
  const res2 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Valid Title",
      description: "   ",
      category: "Infrastructure",
    });
  assert.equal(res2.status, 400);
  assert.match(res2.body.message, /description is required/i);

  // Missing category
  const res3 = await request(app)
    .post("/api/complaints")
    .set("Authorization", `Bearer ${token}`)
    .send({
      title: "Valid Title",
      description: "Valid description",
      category: "   ",
    });
  assert.equal(res3.status, 400);
  assert.match(res3.body.message, /category is required/i);
});

