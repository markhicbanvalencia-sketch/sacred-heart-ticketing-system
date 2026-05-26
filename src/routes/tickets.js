const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { stringify } = require('csv-stringify/sync');

const db = require('../db/database');
const { requireLogin, setFlash } = require('../middleware/auth');
const {
  STATUSES, PRIORITIES, generateTicketNumber, logActivity, audit,
} = require('../utils/helpers');
const { pushToUser, pushToStaff, pushToAll } = require('./events');

const router = express.Router();

// ---- File uploads ----
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});

const allowedTypes = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10 MB per file, max 5
  fileFilter: (req, file, cb) => {
    if (allowedTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error('File type not allowed: ' + file.mimetype));
  },
});

// ---- Helpers ----
function canViewTicket(user, ticket) {
  if (!ticket) return false;
  if (['admin', 'it_staff'].includes(user.role)) return true;
  return ticket.requester_id === user.id;
}

function loadTicket(id) {
  return db.prepare(`
    SELECT t.*, c.name AS category_name, d.name AS department_name,
           ru.full_name AS requester_name, ru.email AS requester_email,
           au.full_name AS assignee_name
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN departments d ON d.id = t.department_id
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE t.id = ?
  `).get(id);
}

// ---- LIST ----
router.get('/', requireLogin, (req, res) => {
  const { status, priority, category, department, assignee, search, mine } = req.query;
  const where = [];
  const params = [];

  if (!['admin', 'it_staff'].includes(req.user.role)) {
    // Regular users only see their own submitted tickets
    where.push('t.requester_id = ?');
    params.push(req.user.id);
  } else if (mine === '1') {
    // IT staff/admin: "My tickets only" = assigned to me
    where.push('t.assigned_to = ?');
    params.push(req.user.id);
  }
  if (status)     { where.push('t.status = ?');        params.push(status); }
  if (priority)   { where.push('t.priority = ?');      params.push(priority); }
  if (category)   { where.push('t.category_id = ?');   params.push(category); }
  if (department) { where.push('t.department_id = ?'); params.push(department); }
  if (assignee)   { where.push('t.assigned_to = ?');   params.push(assignee); }
  if (search) {
    where.push('(t.title LIKE ? OR t.description LIKE ? OR t.ticket_number LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const sql = `
    SELECT t.*, c.name AS category_name, d.name AS department_name,
           ru.full_name AS requester_name, au.full_name AS assignee_name
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN departments d ON d.id = t.department_id
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.created_at DESC
    LIMIT 500
  `;
  const tickets = db.prepare(sql).all(...params);

  const categories  = db.prepare('SELECT * FROM ticket_categories WHERE is_active = 1 ORDER BY name').all();
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  const staff = db.prepare(`
    SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('it_staff','admin') AND u.is_active = 1 ORDER BY u.full_name
  `).all();

  res.render('tickets/list', {
    title: 'Tickets', tickets, categories, departments, staff,
    STATUSES, PRIORITIES, filters: req.query,
  });
});

// ---- NEW ----
router.get('/new', requireLogin, (req, res) => {
  const categories  = db.prepare('SELECT * FROM ticket_categories WHERE is_active = 1 ORDER BY name').all();
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  res.render('tickets/new', {
    title: 'Submit a Ticket', categories, departments, PRIORITIES,
    error: null, values: {},
  });
});

router.post('/', requireLogin, upload.array('attachments', 5), (req, res) => {
  const { title, description, category_id, department_id, priority, due_date } = req.body;
  if (!title || !description) {
    return res.status(400).render('tickets/new', {
      title: 'Submit a Ticket',
      categories: db.prepare('SELECT * FROM ticket_categories WHERE is_active = 1 ORDER BY name').all(),
      departments: db.prepare('SELECT * FROM departments ORDER BY name').all(),
      PRIORITIES,
      error: 'Title and description are required.',
      values: req.body,
    });
  }

  const number = generateTicketNumber();
  const info = db.prepare(`
    INSERT INTO tickets (ticket_number, title, description, category_id, department_id,
                         requester_id, priority, status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'New', ?)
  `).run(
    number, title.trim(), description.trim(),
    category_id || null,
    department_id || req.user.department_id || null,
    req.user.id,
    PRIORITIES.includes(priority) ? priority : 'Medium',
    due_date || null,
  );

  const ticketId = info.lastInsertRowid;

  if (req.files && req.files.length) {
    const ins = db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const f of req.files) {
      ins.run(ticketId, req.user.id, f.originalname, f.filename, f.mimetype, f.size);
    }
  }

  logActivity(ticketId, req.user.id, 'created', `Ticket ${number} submitted`);
  audit(req.user.id, 'ticket_create', number, req.ip);

  // Notify all active IT staff / admins (except the submitter if they are staff)
  try {
    const itStaff = db.prepare(`
      SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.name IN ('it_staff','admin') AND u.is_active = 1 AND u.id != ?
    `).all(req.user.id);
    const notifIns = db.prepare(
      "INSERT INTO notifications (user_id, ticket_id, message) VALUES (?, ?, ?)"
    );
    for (const s of itStaff) {
      notifIns.run(s.id, ticketId, `New ticket #${number}: ${title.trim()}`);
      const count = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0").get(s.id).c;
      pushToUser(s.id, { type: 'notif', notifCount: count, message: `New ticket #${number}: ${title.trim()}`, ticketId });
    }
    pushToStaff({ type: 'ticket_new', ticketId });
  } catch {}

  setFlash(req, 'success', `Ticket ${number} created.`);
  res.redirect(`/tickets/${ticketId}`);
});

// ---- COMMENTS JSON (for live polling) ----
router.get('/:id/comments.json', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) return res.status(404).json({});
  const afterId = parseInt(req.query.after) || 0;
  const comments = db.prepare(`
    SELECT cm.id, cm.body, cm.is_internal, cm.created_at, u.full_name AS user_name, r.name AS role
    FROM ticket_comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE cm.ticket_id = ? AND cm.id > ?
    ${['admin', 'it_staff'].includes(req.user.role) ? '' : 'AND cm.is_internal = 0'}
    ORDER BY cm.created_at ASC
  `).all(ticket.id, afterId);
  res.json({ comments });
});

// ---- TAKE (self-assign, first-come-first-serve) ----
router.post('/:id/take', requireLogin, (req, res) => {
  if (!['admin', 'it_staff'].includes(req.user.role)) return res.status(403).end();
  // Atomic: only succeeds if no one has claimed it yet
  const result = db.prepare(`
    UPDATE tickets
    SET assigned_to = ?, status = 'In Progress', updated_at = datetime('now','localtime')
    WHERE id = ? AND assigned_to IS NULL
  `).run(req.user.id, req.params.id);

  if (result.changes > 0) {
    logActivity(req.params.id, req.user.id, 'assigned', `Self-assigned by ${req.user.full_name}`);
    try {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND ticket_id = ?")
        .run(req.user.id, req.params.id);
    } catch {}
    setFlash(req, 'success', 'Ticket assigned to you.');
  } else {
    setFlash(req, 'error', 'This ticket was already taken by someone else.');
  }
  res.redirect(`/tickets/${req.params.id}`);
});

// ---- VIEW ----
router.get('/:id', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) {
    return res.status(404).render('error', { title: 'Not Found', message: 'Ticket not found.' });
  }
  const comments = db.prepare(`
    SELECT cm.*, u.full_name AS user_name, r.name AS role
    FROM ticket_comments cm
    JOIN users u ON u.id = cm.user_id
    JOIN roles r ON r.id = u.role_id
    WHERE cm.ticket_id = ?
      ${['admin', 'it_staff'].includes(req.user.role) ? '' : 'AND cm.is_internal = 0'}
    ORDER BY cm.created_at ASC
  `).all(ticket.id);
  const attachments = db.prepare('SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY id').all(ticket.id);
  const activity = db.prepare(`
    SELECT a.*, u.full_name AS user_name
    FROM ticket_activity_log a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.ticket_id = ? ORDER BY a.created_at DESC
  `).all(ticket.id);
  const staff = db.prepare(`
    SELECT u.id, u.full_name FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('it_staff','admin') AND u.is_active = 1 ORDER BY u.full_name
  `).all();

  // Mark this ticket's notification as read for the current IT staff user
  if (['admin', 'it_staff'].includes(req.user.role)) {
    try {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND ticket_id = ?")
        .run(req.user.id, ticket.id);
    } catch {}
  }

  res.render('tickets/view', {
    title: `Ticket ${ticket.ticket_number}`,
    ticket, comments, attachments, activity, staff, STATUSES, PRIORITIES,
  });
});

// ---- COMMENT ----
router.post('/:id/comments', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) return res.status(404).end();

  const body = (req.body.body || '').trim();
  if (!body) return res.redirect(`/tickets/${ticket.id}`);

  const isInternal = (req.body.is_internal === '1') && ['admin', 'it_staff'].includes(req.user.role);
  db.prepare('INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal) VALUES (?, ?, ?, ?)')
    .run(ticket.id, req.user.id, body, isInternal ? 1 : 0);
  logActivity(ticket.id, req.user.id, 'comment', isInternal ? 'Internal note added' : 'Comment added');
  db.prepare("UPDATE tickets SET updated_at = datetime('now','localtime') WHERE id = ?").run(ticket.id);
  pushToAll({ type: 'comment', ticketId: ticket.id });
  res.redirect(`/tickets/${ticket.id}#comments`);
});

// ---- UPDATE STATUS / ASSIGN / PRIORITY (IT/Admin only) ----
router.post('/:id/update', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket) return res.status(404).end();
  const u = req.user;

  // Regular users can only confirm resolved -> close, or reopen if they wish.
  if (!['admin', 'it_staff'].includes(u.role)) {
    if (ticket.requester_id !== u.id) return res.status(403).end();
    const newStatus = req.body.status;
    if (!['Closed', 'Open'].includes(newStatus)) return res.status(400).end();
    const updates = { status: newStatus };
    if (newStatus === 'Closed') updates.closed_at = "datetime('now','localtime')";
    applyTicketUpdate(ticket.id, updates);
    logActivity(ticket.id, u.id, 'status_change', `Status -> ${newStatus} (by requester)`);
    return res.redirect(`/tickets/${ticket.id}`);
  }

  // IT / admin
  const { status, priority, assigned_to, due_date, category_id, department_id, resolution_notes } = req.body;
  const updates = {};
  if (status && STATUSES.includes(status) && status !== ticket.status) {
    if (status === 'Resolved') {
      const notes = (resolution_notes || '').trim();
      if (!notes) {
        setFlash(req, 'error', 'Please describe what was done to resolve this ticket.');
        return res.redirect(`/tickets/${ticket.id}`);
      }
      updates.resolution_notes = notes;
    }
    updates.status = status;
    if (status === 'Resolved' && !ticket.resolved_at) updates.resolved_at = "datetime('now','localtime')";
    if (status === 'Closed' && !ticket.closed_at) updates.closed_at = "datetime('now','localtime')";
    logActivity(ticket.id, u.id, 'status_change', `${ticket.status} -> ${status}`);
  }
  // Allow updating resolution notes on already-resolved tickets
  if (resolution_notes !== undefined && ticket.status === 'Resolved' && !updates.resolution_notes) {
    const notes = (resolution_notes || '').trim();
    if (notes) updates.resolution_notes = notes;
  }
  if (priority && PRIORITIES.includes(priority) && priority !== ticket.priority) {
    updates.priority = priority;
    logActivity(ticket.id, u.id, 'priority_change', `${ticket.priority} -> ${priority}`);
  }
  if (assigned_to !== undefined) {
    const a = assigned_to ? Number(assigned_to) : null;
    if (a !== ticket.assigned_to) {
      updates.assigned_to = a;
      const name = a ? db.prepare('SELECT full_name FROM users WHERE id = ?').get(a)?.full_name : 'Unassigned';
      logActivity(ticket.id, u.id, 'assignment', `Assigned to ${name}`);
    }
  }
  if (due_date !== undefined && (due_date || null) !== (ticket.due_date || null)) {
    updates.due_date = due_date || null;
    logActivity(ticket.id, u.id, 'due_date', `Due date set to ${due_date || 'none'}`);
  }
  if (category_id !== undefined) updates.category_id = category_id || null;
  if (department_id !== undefined) updates.department_id = department_id || null;

  if (Object.keys(updates).length) {
    applyTicketUpdate(ticket.id, updates);
    pushToAll({ type: 'ticket_update', ticketId: ticket.id });
  }
  audit(u.id, 'ticket_update', ticket.ticket_number, req.ip);
  res.redirect(`/tickets/${ticket.id}`);
});

function applyTicketUpdate(id, updates) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'string' && v.startsWith("datetime(")) {
      sets.push(`${k} = ${v}`); // raw SQL fragment
    } else {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  sets.push("updated_at = datetime('now','localtime')");
  vals.push(id);
  db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

// ---- ATTACHMENT (add later) ----
router.post('/:id/attachments', requireLogin, upload.array('attachments', 5), (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) return res.status(404).end();
  if (req.files && req.files.length) {
    const ins = db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const f of req.files) ins.run(ticket.id, req.user.id, f.originalname, f.filename, f.mimetype, f.size);
    logActivity(ticket.id, req.user.id, 'attachment', `${req.files.length} file(s) uploaded`);
  }
  res.redirect(`/tickets/${ticket.id}`);
});

router.get('/:id/attachments/:aid', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) return res.status(404).end();
  const a = db.prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?')
    .get(req.params.aid, ticket.id);
  if (!a) return res.status(404).end();
  res.download(path.join(UPLOAD_DIR, a.stored_name), a.original_name);
});

// ---- PRINT ----
router.get('/:id/print', requireLogin, (req, res) => {
  const ticket = loadTicket(req.params.id);
  if (!ticket || !canViewTicket(req.user, ticket)) return res.status(404).end();
  const comments = db.prepare(`
    SELECT cm.*, u.full_name AS user_name FROM ticket_comments cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.ticket_id = ? AND cm.is_internal = 0
    ORDER BY cm.created_at ASC
  `).all(ticket.id);
  res.render('tickets/print', { title: ticket.ticket_number, ticket, comments, layout: false });
});

// ---- EXPORT CSV ----
router.get('/export/csv', requireLogin, (req, res) => {
  if (!['admin', 'it_staff'].includes(req.user.role)) return res.status(403).end();
  const rows = db.prepare(`
    SELECT t.ticket_number, t.title, t.status, t.priority,
           c.name AS category, d.name AS department,
           ru.full_name AS requester, au.full_name AS assignee,
           t.created_at, t.updated_at, t.resolved_at, t.due_date
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN departments d ON d.id = t.department_id
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    ORDER BY t.created_at DESC
  `).all();
  const csv = stringify(rows, { header: true });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="tickets-${Date.now()}.csv"`);
  res.send(csv);
});

module.exports = router;
