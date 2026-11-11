const PORTALS = {
  user: { roles: ["USER"], tokenKey: "userToken", dataKey: "userData", activeRole: "user" },
  admin: { roles: ["SUPER_ADMIN", "DEPARTMENT_ADMIN"], tokenKey: "adminToken", dataKey: "adminData", activeRole: "admin" },
  employee: { roles: ["EMPLOYEE"], tokenKey: "employeeToken", dataKey: "employeeData", activeRole: "employee" },
};

export function establishPortalSession(data, portal, storage, setActiveRole) {
  const config = PORTALS[portal];
  const token = data?.token || data?.access;
  if (!config || !token || !config.roles.includes(data?.user?.role)) {
    throw new Error("This account cannot sign in to this portal.");
  }

  storage.setItem(config.tokenKey, token);
  storage.setItem(config.dataKey, JSON.stringify(data.user));
  const session = { token, user: data.user, activeRole: config.activeRole };
  setActiveRole?.(session.activeRole);
  return session;
}

export function restorePortalSession(portal, storage) {
  const config = PORTALS[portal];
  if (!config) return { token: "", user: null };
  const token = storage.getItem(config.tokenKey) || "";
  let user = null;
  try {
    user = JSON.parse(storage.getItem(config.dataKey) || "null");
  } catch {
    user = null;
  }
  if (!token || !config.roles.includes(user?.role)) {
    storage.removeItem(config.tokenKey);
    storage.removeItem(config.dataKey);
    return { token: "", user: null };
  }
  return { token, user };
}

export async function logoutWithPortalToken(client, token) {
  if (!token) return null;
  return client.post("/api/auth/logout", {}, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

