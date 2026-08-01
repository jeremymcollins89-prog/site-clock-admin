const { contextBridge, shell, ipcRenderer } = require("electron");
const Store = require("electron-store");
const fs = require("fs");
const os = require("os");
const path = require("path");
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
  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    // The server returned something that isn't JSON at all -- a plain
    // 404/502 error page rather than our API actually responding. Surfacing
    // the raw parse error ("Unexpected token < in JSON") is meaningless, so
    // give a message that points at the real, actionable cause instead.
    throw new Error(`The server didn't respond as expected (status ${res.status}). If you just deployed an update, give it a minute and try again.`);
  }
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

  getTimezone: () => apiFetch("/api/admin/timezone"),
  updateTimezone: (timezone) => apiFetch("/api/admin/timezone", { method: "PATCH", body: { timezone } }),

  getPayrollEmail: () => apiFetch("/api/admin/payroll-email"),
  updatePayrollEmail: (payrollEmail) =>
    apiFetch("/api/admin/payroll-email", { method: "PATCH", body: { payroll_email: payrollEmail } }),

  getLongShiftAlert: () => apiFetch("/api/admin/long-shift-alert"),
  updateLongShiftAlert: (hours) =>
    apiFetch("/api/admin/long-shift-alert", { method: "PATCH", body: { long_shift_alert_hours: hours } }),

  getShowProfitBubbles: () => apiFetch("/api/admin/show-profit-bubbles"),
  updateShowProfitBubbles: (show) =>
    apiFetch("/api/admin/show-profit-bubbles", { method: "PATCH", body: { show_profit_bubbles: show } }),

  getCompanyName: () => apiFetch("/api/admin/company-name"),
  updateCompanyName: (name) => apiFetch("/api/admin/company-name", { method: "PATCH", body: { name } }),

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

  listTimeOffRequests: (status) => apiFetch(`/api/admin/time-off-requests${status ? `?status=${status}` : ""}`),
  reviewTimeOffRequest: (id, status) => apiFetch(`/api/admin/time-off-requests/${id}`, { method: "PATCH", body: { status } }),

  getRoutingCandidates: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/admin/routing/candidates${qs ? `?${qs}` : ""}`);
  },
  listRoutes: (date) => apiFetch(`/api/admin/routing${date ? `?date=${date}` : ""}`),
  getRoute: (id) => apiFetch(`/api/admin/routing/${id}`),
  buildRoute: (body) => apiFetch("/api/admin/routing", { method: "POST", body }),
  reoptimizeRoute: (id) => apiFetch(`/api/admin/routing/${id}/reoptimize`, { method: "POST" }),
  sendRoute: (id) => apiFetch(`/api/admin/routing/${id}/send`, { method: "POST" }),
  reorderRouteStops: (id, stopIds) => apiFetch(`/api/admin/routing/${id}/reorder`, { method: "PATCH", body: { stop_ids: stopIds } }),
  removeRouteStop: (routeId, stopId) => apiFetch(`/api/admin/routing/${routeId}/stops/${stopId}`, { method: "DELETE" }),
  deleteRoute: (id) => apiFetch(`/api/admin/routing/${id}`, { method: "DELETE" }),
  getOnClockLocations: () => apiFetch("/api/admin/routing/on-clock-locations"),
  geocodeCandidates: (customerIds) =>
    apiFetch("/api/admin/routing/geocode-candidates", { method: "POST", body: { customer_ids: customerIds } }),

  suggestAddress: (query) => apiFetch(`/api/admin/geocode/suggest?q=${encodeURIComponent(query)}`),

  listCustomers: () => apiFetch("/api/admin/customers"),
  addCustomer: (customer) => apiFetch("/api/admin/customers", { method: "POST", body: customer }),
  updateCustomer: (id, patch) => apiFetch(`/api/admin/customers/${id}`, { method: "PATCH", body: patch }),
  deleteCustomer: (id) => apiFetch(`/api/admin/customers/${id}`, { method: "DELETE" }),
  getCustomerEvents: (id) => apiFetch(`/api/admin/customers/${id}/events`),
  importCustomers: (customers) => apiFetch("/api/admin/customers/import", { method: "POST", body: { customers } }),

  listInvoices: () => apiFetch("/api/admin/invoices"),
  getInvoice: (id) => apiFetch(`/api/admin/invoices/${id}`),
  addInvoice: (invoice) => apiFetch("/api/admin/invoices", { method: "POST", body: invoice }),
  updateInvoice: (id, patch) => apiFetch(`/api/admin/invoices/${id}`, { method: "PATCH", body: patch }),
  deleteInvoice: (id) => apiFetch(`/api/admin/invoices/${id}`, { method: "DELETE" }),
  sendInvoice: (id) => apiFetch(`/api/admin/invoices/${id}/send`, { method: "POST" }),
  markInvoicePaid: (id, paymentMethod, checkNumber) =>
    apiFetch(`/api/admin/invoices/${id}/mark-paid`, { method: "PATCH", body: { payment_method: paymentMethod, check_number: checkNumber } }),
  voidInvoice: (id) => apiFetch(`/api/admin/invoices/${id}/void`, { method: "PATCH" }),
  resendInvoiceReceipt: (id, email) =>
    apiFetch(`/api/admin/invoices/${id}/resend-receipt`, { method: "POST", body: { email: email || "" } }),
  // Downloads the invoice PDF to a temp file and opens it in the user's
  // default PDF viewer (Adobe, Edge, whatever they have) -- more reliable
  // across Electron versions than trying to render a PDF inside the app
  // itself.
  viewInvoicePdf: async (id) => {
    const token = store.get("token");
    const res = await fetch(`${API_BASE_URL}/api/admin/invoices/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = "Couldn't load invoice PDF";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (parseErr) {
        // response wasn't JSON -- keep the generic message
      }
      throw new Error(message);
    }
    const arrayBuffer = await res.arrayBuffer();
    const tempPath = path.join(os.tmpdir(), `invoice-${id}.pdf`);
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    await shell.openPath(tempPath);
    return true;
  },

  // File attachments on jobs and invoices -- list/upload/delete go through
  // the normal JSON+base64 apiFetch helper (same pattern as the company
  // logo), but viewing one downloads it to a temp file and opens it in the
  // OS's default viewer, same trick as viewInvoicePdf/viewQuotePdf below,
  // since Electron doesn't have a good way to preview an arbitrary file
  // type (image, PDF, Word doc...) inline.
  listAttachments: (entityType, entityId) =>
    apiFetch(`/api/admin/attachments?entity_type=${entityType}&entity_id=${entityId}`),
  uploadAttachment: (entityType, entityId, fileName, mimeType, base64) =>
    apiFetch("/api/admin/attachments", {
      method: "POST",
      body: { entity_type: entityType, entity_id: entityId, file_name: fileName, mime_type: mimeType, file_base64: base64 },
    }),
  deleteAttachment: (id) => apiFetch(`/api/admin/attachments/${id}`, { method: "DELETE" }),
  viewAttachment: async (id, fileName) => {
    const token = store.get("token");
    const res = await fetch(`${API_BASE_URL}/api/admin/attachments/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = "Couldn't load that file";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (parseErr) {
        // response wasn't JSON -- keep the generic message
      }
      throw new Error(message);
    }
    const arrayBuffer = await res.arrayBuffer();
    const safeName = (fileName || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
    const tempPath = path.join(os.tmpdir(), `attachment-${id}-${safeName}`);
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    await shell.openPath(tempPath);
    return true;
  },

  listQuotes: () => apiFetch("/api/admin/quotes"),
  getQuote: (id) => apiFetch(`/api/admin/quotes/${id}`),
  addQuote: (quote) => apiFetch("/api/admin/quotes", { method: "POST", body: quote }),
  updateQuote: (id, patch) => apiFetch(`/api/admin/quotes/${id}`, { method: "PATCH", body: patch }),
  deleteQuote: (id) => apiFetch(`/api/admin/quotes/${id}`, { method: "DELETE" }),
  sendQuote: (id) => apiFetch(`/api/admin/quotes/${id}/send`, { method: "POST" }),
  markQuoteAccepted: (id) => apiFetch(`/api/admin/quotes/${id}/mark-accepted`, { method: "PATCH" }),
  markQuoteDeclined: (id) => apiFetch(`/api/admin/quotes/${id}/mark-declined`, { method: "PATCH" }),
  convertQuoteToJob: (id, jobPatch) => apiFetch(`/api/admin/quotes/${id}/convert-to-job`, { method: "POST", body: jobPatch }),
  convertQuoteToInvoice: (id, patch) => apiFetch(`/api/admin/quotes/${id}/convert-to-invoice`, { method: "POST", body: patch || {} }),
  // Same temp-file-then-open pattern as viewInvoicePdf.
  viewQuotePdf: async (id) => {
    const token = store.get("token");
    const res = await fetch(`${API_BASE_URL}/api/admin/quotes/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = "Couldn't load quote PDF";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (parseErr) {
        // response wasn't JSON -- keep the generic message
      }
      throw new Error(message);
    }
    const arrayBuffer = await res.arrayBuffer();
    const tempPath = path.join(os.tmpdir(), `quote-${id}.pdf`);
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    await shell.openPath(tempPath);
    return true;
  },

  getReportSummary: (start, end) => apiFetch(`/api/admin/reports/summary?start=${start}&end=${end}`),
  getLaborBreakdown: (start, end) => apiFetch(`/api/admin/reports/labor-breakdown?start=${start}&end=${end}`),
  getMonthlyProfit: (months) => apiFetch(`/api/admin/reports/monthly-profit?months=${months || 6}`),
  listExpenses: () => apiFetch("/api/admin/expenses"),
  addExpense: (expense) => apiFetch("/api/admin/expenses", { method: "POST", body: expense }),
  updateExpense: (id, patch) => apiFetch(`/api/admin/expenses/${id}`, { method: "PATCH", body: patch }),
  deleteExpense: (id) => apiFetch(`/api/admin/expenses/${id}`, { method: "DELETE" }),

  listCatalogItems: () => apiFetch("/api/admin/catalog-items"),
  addCatalogItem: (item) => apiFetch("/api/admin/catalog-items", { method: "POST", body: item }),
  updateCatalogItem: (id, patch) => apiFetch(`/api/admin/catalog-items/${id}`, { method: "PATCH", body: patch }),
  getInventory: () => apiFetch("/api/admin/inventory"),
  getCatalogItemHolds: (id) => apiFetch(`/api/admin/catalog-items/${id}/holds`),
  getPullSheetSources: () => apiFetch("/api/admin/pull-sheets/sources"),
  listPullSheets: () => apiFetch("/api/admin/pull-sheets"),
  getPullSheet: (id) => apiFetch(`/api/admin/pull-sheets/${id}`),
  buildPullSheet: (sourceType, sourceId) =>
    apiFetch("/api/admin/pull-sheets", { method: "POST", body: { source_type: sourceType, source_id: sourceId } }),
  buildManualPullSheet: (items, label) =>
    apiFetch("/api/admin/pull-sheets", { method: "POST", body: { source_type: "manual", items, label } }),
  fulfillPullSheet: (id) => apiFetch(`/api/admin/pull-sheets/${id}/fulfill`, { method: "PATCH" }),
  deletePullSheet: (id) => apiFetch(`/api/admin/pull-sheets/${id}`, { method: "DELETE" }),
  // Same temp-file-then-open pattern as viewInvoicePdf/viewQuotePdf.
  viewPullSheetPdf: async (id) => {
    const token = store.get("token");
    const res = await fetch(`${API_BASE_URL}/api/admin/pull-sheets/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let message = "Couldn't load pull sheet PDF";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (parseErr) {
        // response wasn't JSON -- keep the generic message
      }
      throw new Error(message);
    }
    const arrayBuffer = await res.arrayBuffer();
    const tempPath = path.join(os.tmpdir(), `pull-sheet-${id}.pdf`);
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));
    await shell.openPath(tempPath);
    return true;
  },
  deleteCatalogItem: (id) => apiFetch(`/api/admin/catalog-items/${id}`, { method: "DELETE" }),
  importCatalogItems: (items) => apiFetch("/api/admin/catalog-items/import", { method: "POST", body: { items } }),

  listChatThreads: () => apiFetch("/api/admin/chat/threads"),
  getChatMessages: (employeeId) => apiFetch(`/api/admin/chat/${employeeId}/messages`),
  sendChatMessage: (employeeId, body) =>
    apiFetch(`/api/admin/chat/${employeeId}/messages`, { method: "POST", body: { body } }),

  listTeamChatThreads: () => apiFetch("/api/admin/team-chat/threads"),
  getTeamChatUnreadCount: () => apiFetch("/api/admin/team-chat/unread-count"),
  createTeamChatThread: (employeeIds, name) =>
    apiFetch("/api/admin/team-chat/threads", { method: "POST", body: { employee_ids: employeeIds, name } }),
  getTeamChatMessages: (threadId) => apiFetch(`/api/admin/team-chat/threads/${threadId}/messages`),
  sendTeamChatMessage: (threadId, body) =>
    apiFetch(`/api/admin/team-chat/threads/${threadId}/messages`, { method: "POST", body: { body } }),

  // Stripe Connect: lets this company link its own Stripe account so its
  // customers' invoice payments land in their own bank account instead of
  // Jeremy's. The OAuth form itself has to run in a real browser (Stripe
  // won't allow it inside an embedded Electron webview), so this opens the
  // authorize URL in the user's default browser via shell.openExternal
  // rather than navigating inside the app.
  getStripeConnectStatus: () => apiFetch("/api/connect/status"),
  startStripeConnect: async () => {
    const data = await apiFetch("/api/connect/start");
    await shell.openExternal(data.url);
    return true;
  },

  getCompanyLogo: () => apiFetch("/api/admin/company-logo"),
  updateCompanyLogo: (logoBase64, mimeType) =>
    apiFetch("/api/admin/company-logo", { method: "PUT", body: { logo_base64: logoBase64, mime_type: mimeType } }),
  deleteCompanyLogo: () => apiFetch("/api/admin/company-logo", { method: "DELETE" }),

  // Fires at every step of checking for / downloading an update -- lets the
  // renderer show real progress (a percent bar while downloading, plain
  // text if something goes wrong) instead of updates being an invisible
  // black box. installUpdate() is only called if the person clicks the
  // "Restart & update" button once a download finishes.
  onUpdateEvent: (callback) => ipcRenderer.on("update-event", (event, payload) => callback(payload)),
  installUpdate: () => ipcRenderer.send("install-update"),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  openUpdateLog: () => ipcRenderer.send("open-update-log"),

  // Temporary diagnostic for the quote-notes-field typing bug -- routes a
  // renderer-side console.log-style message into electron-log so it shows
  // up in the same update-log.txt Jeremy already knows how to paste, no
  // DevTools needed. Safe to leave in; harmless if unused.
  debugLog: (msg) => ipcRenderer.send("debug-log", msg),
});