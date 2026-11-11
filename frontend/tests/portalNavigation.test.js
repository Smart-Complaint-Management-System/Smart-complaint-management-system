import test from "node:test";
import assert from "node:assert/strict";
import { getVisibleNavigationItems } from "../src/auth/portalNavigation.js";

const navigationItems = [
  { label: "Dashboard" },
  { label: "Submit Complaint", role: "user" },
  { label: "Track Complaint", role: "user" },
  { label: "All Complaints", role: "admin" },
  { label: "Resolution", role: "admin" },
  { label: "My Work", role: "employee" },
  { label: "Work Management", role: "admin" },
  { label: "Team Management", role: "admin" },
];

test("employees see employee navigation without administrator tabs", () => {
  assert.deepEqual(
    getVisibleNavigationItems(navigationItems, "employee").map((item) => item.label),
    ["Dashboard", "My Work"],
  );
});

test("administrators retain all administrator navigation", () => {
  assert.deepEqual(
    getVisibleNavigationItems(navigationItems, "admin").map((item) => item.label),
    ["Dashboard", "All Complaints", "Resolution", "Work Management", "Team Management"],
  );
});

test("regular users retain their existing navigation", () => {
  assert.deepEqual(
    getVisibleNavigationItems(navigationItems, "user").map((item) => item.label),
    ["Dashboard", "Submit Complaint", "Track Complaint"],
  );
});
