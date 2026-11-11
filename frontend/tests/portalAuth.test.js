import test from "node:test";
import assert from "node:assert/strict";
import { establishPortalSession, logoutWithPortalToken, restorePortalSession } from "../src/auth/portalAuth.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
}

test("portal login stores only the matching role and activates its portal", () => {
  const storage = memoryStorage();
  for (const [portal, role, activeRole] of [
    ["user", "USER", "user"],
    ["admin", "DEPARTMENT_ADMIN", "admin"],
    ["employee", "EMPLOYEE", "employee"],
  ]) {
    let active;
    const result = establishPortalSession({ token: `token-${role}`, user: { role } }, portal, storage, (value) => { active = value; });
    assert.equal(active, activeRole);
    assert.equal(result.activeRole, activeRole);
    assert.equal(storage.getItem(`${portal === "user" ? "user" : portal}Token`), `token-${role}`);
  }
});

test("mismatched roles neither persist credentials nor change the active portal", () => {
  for (const [portal, role] of [["user", "EMPLOYEE"], ["admin", "USER"], ["employee", "SUPER_ADMIN"]]) {
    const storage = memoryStorage();
    let changed = false;
    assert.throws(() => establishPortalSession({ token: "wrong-token", user: { role } }, portal, storage, () => { changed = true; }));
    assert.equal(storage.values.size, 0);
    assert.equal(changed, false);
  }
});

test("restoration discards credentials stored under the wrong portal", () => {
  const storage = memoryStorage();
  storage.setItem("adminToken", "old-employee-token");
  storage.setItem("adminData", JSON.stringify({ role: "EMPLOYEE" }));
  assert.deepEqual(restorePortalSession("admin", storage), { token: "", user: null });
  assert.equal(storage.getItem("adminToken"), null);
  assert.equal(storage.getItem("adminData"), null);
});

test("logout binds the intended portal token to its own request", async () => {
  const calls = [];
  const client = { post: (...args) => { calls.push(args); return Promise.resolve({ data: {} }); } };
  await logoutWithPortalToken(client, "user-token");
  await logoutWithPortalToken(client, "admin-token");
  await logoutWithPortalToken(client, "employee-token");
  assert.deepEqual(calls.map((call) => call[2].headers.Authorization), [
    "Bearer user-token", "Bearer admin-token", "Bearer employee-token",
  ]);
});
