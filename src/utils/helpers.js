/**
 * Small shared utilities.
 */
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
dayjs.extend(relativeTime);

const db = require('../db/database');

const STATUSES = ['New', 'Open', 'Pending', 'In Progress', 'Waiting for User', 'Resolved', 'Closed', 'Cancelled'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const PROJECT_STATUSES = ['Planned', 'Ongoing', 'On Hold', 'Completed', 'Cancelled'];

function generateTicketNumber() {
  const prefix = (getSetting('ticket_prefix') || 'TKT');
  const year = new Date().getFullYear();
  const row = db.prepare(
    "SELECT COUNT(*) AS c FROM tickets WHERE ticket_number LIKE ?"
  ).get(`${prefix}-${year}-%`);
  const next = (row.c || 0) + 1;
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

function getSetting(key) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : null;
}

function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value ?? ''));
}

function fmtDate(d) {
  if (!d) return '';
  return dayjs(d).format('YYYY-MM-DD HH:mm');
}

function fmtDateShort(d) {
  if (!d) return '';
  return dayjs(d).format('YYYY-MM-DD');
}

function timeAgo(d) {
  if (!d) return '';
  return dayjs(d).fromNow();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function logActivity(ticketId, userId, action, detail) {
  db.prepare(
    'INSERT INTO ticket_activity_log (ticket_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(ticketId, userId, action, detail || null);
}

function audit(userId, action, detail, ip) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, detail, ip) VALUES (?, ?, ?, ?)'
  ).run(userId, action, detail || null, ip || null);
}

module.exports = {
  STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  generateTicketNumber,
  getSetting,
  setSetting,
  fmtDate,
  fmtDateShort,
  timeAgo,
  escapeHtml,
  logActivity,
  audit,
};
