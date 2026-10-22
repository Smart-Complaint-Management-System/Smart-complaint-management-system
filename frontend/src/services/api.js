
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  headers: {
    "Content-Type": "application/json",
  },
});

export function setAuthToken(token) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

export async function adminLogin(email, password) {
  const response = await api.post("/api/admin/login", {
    email,
    password,
  });
  return response.data;
}

export async function getComplaints() {
  const response = await api.get("/api/admin/complaints");
  return response.data;
}

export async function getComplaintById(id) {
  const response = await api.get(`/api/admin/complaints/${id}`);
  return response.data;
}

export async function updateComplaintStatus(id, status) {
  const response = await api.patch(
    `/api/admin/complaints/${id}/status`,
    { status }
  );
  return response.data;
}

export default api;
