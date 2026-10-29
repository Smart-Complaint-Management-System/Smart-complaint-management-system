const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

async function setupTestDb() {
  process.env.JWT_SECRET = "scms-automated-test-secret-pes-group-8";
  process.env.NODE_ENV = "test";

  if (!mongoServer) {
    mongoServer = await MongoMemoryServer.create();
  }
  const uri = mongoServer.getUri();
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
}

async function teardownTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
  }
}

async function clearTestDb() {
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}

// Universal test framework adapter (supports both native `node:test` and `jest`)
const isJest = typeof global.beforeAll === "function";

let testRunner, beforeHook, afterHook, beforeEachHook;

if (isJest) {
  testRunner = global.test;
  beforeHook = global.beforeAll;
  afterHook = global.afterAll;
  beforeEachHook = global.beforeEach;
} else {
  const nodeTest = require("node:test");
  testRunner = nodeTest.test;
  beforeHook = nodeTest.before;
  afterHook = nodeTest.after;
  beforeEachHook = nodeTest.beforeEach;
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  clearTestDb,
  test: testRunner,
  before: beforeHook,
  after: afterHook,
  beforeEach: beforeEachHook,
  isJest,
};
