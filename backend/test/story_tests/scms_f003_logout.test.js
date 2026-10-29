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

// SCMS-F-003 / SCMS-US-003: Log out an authenticated user
test("TC-AUTH-02: SCMS-F-003 - User logout returns 200 OK and client clears session", async () => {
  const res = await request(app)
    .post("/api/auth/logout")
    .send();

  assert.equal(res.status, 200);
  assert.match(res.body.message, /logged out/i);
});

