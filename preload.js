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

  listCrews: () => apiFetch("/api/admin/crews"),
  addCrew: (crew) => apiFetch("/api/admin/crews", { method: "POST", body: crew }),
  updateCrew: (id, patch) => apiFetch(`/api/admin/crews/${id}`, { method: "PATCH", body: patch }),
  deleteCrew: (id) => apiFetch(`/api/admin/crews/${id}`, { method: "DELETE" }),

  listJobs: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/jobs${qs ? `?${qs}` : ""}`);
  },
  addJob: (job) => apiFetch("/api/admin/jobs", { method: "POST", body: job }),
  updateJob: (id, patch) => apiFetch(`/api/admin/jobs/${id}`, { method: "PATCH", body: patch }),
  deleteJob: (id) => apiFetch(`/api/admin/jobs/${id}`, { method: "DELETE" }),

  listCustomers: () => apiFetch("/api/admin/customers"),
  addCustomer: (customer) => apiFetch("/api/admin/customers", { method: "POST", body: customer }),
  updateCustomer: (id, patch) => apiFetch(`/api/admin/customers/${id}`, { method: "PATCH", body: patch }),
  deleteCustomer: (id) => apiFetch(`/api/admin/customers/${id}`, { method: "DELETE" }),
  getCustomerEvents: (id) => apiFetch(`/api/admin/customers/${id}/events`),

  listInvoices: () => apiFetch("/api/admin/invoices"),
  getInvoice: (id) => apiFetch(`/api/admin/invoices/${id}`),
  addInvoice: (invoice) => apiFetch("/api/admin/invoices", { method: "POST", body: invoice }),
  updateInvoice: (id, patch) => apiFetch(`/api/admin/invoices/${id}`, { method: "PATCH", body: patch }),
  deleteInvoice: (id) => apiFetch(`/api/admin/invoices/${id}`, { method: "DELETE" }),
  sendInvoice: (id) => apiFetch(`/api/admin/invoices/${id}/send`, { method: "POST" }),
  markInvoicePaid: (id, paymentMethod) =>
    apiFetch(`/api/admin/invoices/${id}/mark-paid`, { method: "PATCH", body: { payment_method: paymentMethod } }),
  voidInvoice: (id) => apiFetch(`/api/admin/invoices/${id}/void`, { method: "PATCH" }),

  listCatalogItems: () => apiFetch("/api/admin/catalog-items"),
  addCatalogItem: (item) => apiFetch("/api/admin/catalog-items", { method: "POST", body: item }),
  updateCatalogItem: (id, patch) => apiFetch(`/api/admin/catalog-items/${id}`, { method: "PATCH", body: patch }),
  deleteCatalogItem: (id) => apiFetch(`/api/admin/catalog-items/${id}`, { method: "DELETE" }),
});