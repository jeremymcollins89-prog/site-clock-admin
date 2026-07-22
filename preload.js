const { contextBridge } = require("electron");
const Store = require("electron-store");
const store = new Store({ name: "admin-auth" });

const API_BASE_URL = process.env.API_BASE_URL || "https://site-clock-backend-production.up.railway.app";

async function apiFetch(path, { method = "GET", body } = {}) {
  const token = store.get("token");
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

contextBridge.exposeInMainWorld("admin", {
  login: async (email, password) => {
    const data = await apiFetch("/api/admin/login", { method: "POST", body: { email, password } });
    store.set("token", data.token);
    return true;
  },
  hasSession: () => Boolean(store.get("token")),
  logout: () => store.delete("token"),

  forgotPassword: (email) => apiFetch("/api/admin/forgot-password", { method: "POST", body: { email } }),
  changePassword: (currentPassword, newPassword) =>
    apiFetch("/api/admin/change-password", {
      method: "POST",
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  changeEmail: (newEmail, currentPassword) =>
    apiFetch("/api/admin/change-email", {
      method: "POST",
      body: { new_email: newEmail, current_password: currentPassword },
    }),

  listEmployees: () => apiFetch("/api/admin/employees"),
  addEmployee: (employee) => apiFetch("/api/admin/employees", { method: "POST", body: employee }),
  updateEmployee: (id, patch) => apiFetch(`/api/admin/employees/${id}`, { method: "PATCH", body: patch }),

  listTimeEntries: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/time-entries?${qs}`);
  },
  updateTimeEntry: (id, patch) => apiFetch(`/api/admin/time-entries/${id}`, { method: "PATCH", body: patch }),

  getOverview: () => apiFetch("/api/admin/overview"),
  requestPing: (employeeId) => apiFetch(`/api/admin/employees/${employeeId}/request-ping`, { method: "POST" }),

  getShopLocation: () => apiFetch("/api/admin/shop-location"),
  updateShopLocation: (patch) => apiFetch("/api/admin/shop-location", { method: "PATCH", body: patch }),

  getPayrollEmail: () => apiFetch("/api/admin/payroll-email"),
  updatePayrollEmail: (payrollEmail) =>
    apiFetch("/api/admin/payroll-email", { method: "PATCH", body: { payroll_email: payrollEmail } }),

  getPaySchedule: () => apiFetch("/api/admin/pay-schedule"),
  updatePaySchedule: (patch) => apiFetch("/api/admin/pay-schedule", { method: "PATCH", body: patch }),
});