const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const u = req.user;
  if (u.role === 'admin')    return res.redirect('/dashboard/admin');
  if (u.role === 'it_staff') return res.redirect('/dashboard/it');
  return res.redirect('/dashboard/me');
});

// -------- Regular user dashboard --------
router.get('/dashboard/me', requireLogin, (req, res) => {
  const uid = req.user.id;
  const counts = {
    total:    db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE requester_id = ?").get(uid).c,
    open:     db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE requester_id = ? AND status IN ('New','Open','In Progress')").get(uid).c,
    pending:  db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE requester_id = ? AND status IN ('Pending','Waiting for User')").get(uid).c,
    resolved: db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE requester_id = ? AND status IN ('Resolved','Closed')").get(uid).c,
  };
  const myTickets = db.prepare(`
    SELECT t.*, c.name AS category_name
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    WHERE t.requester_id = ?
    ORDER BY t.updated_at DESC
    LIMIT 10
  `).all(uid);
  res.render('user/dashboard', { title: 'My Dashboard', counts, myTickets });
});

// -------- IT staff dashboard --------
router.get('/dashboard/it', requireLogin, (req, res) => {
  if (!['it_staff', 'admin'].includes(req.user.role)) return res.redirect('/');
  const counts = {
    total:       db.prepare("SELECT COUNT(*) AS c FROM tickets").get().c,
    new:         db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'New'").get().c,
    in_progress: db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'In Progress'").get().c,
    pending:     db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status IN ('Pending','Waiting for User')").get().c,
    resolved:    db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status = 'Resolved'").get().c,
    urgent:      db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE priority = 'Urgent' AND status NOT IN ('Closed','Cancelled')").get().c,
  };
  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS name, COUNT(*) AS c
    FROM tickets t LEFT JOIN ticket_categories c ON c.id = t.category_id
    GROUP BY c.name ORDER BY c DESC
  `).all();
  const byDepartment = db.prepare(`
    SELECT COALESCE(d.name, 'Unknown') AS name, COUNT(*) AS c
    FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
    GROUP BY d.name ORDER BY c DESC
  `).all();
  const workload = db.prepare(`
    SELECT u.full_name AS name, COUNT(t.id) AS c
    FROM users u
    LEFT JOIN tickets t ON t.assigned_to = u.id AND t.status NOT IN ('Closed','Cancelled','Resolved')
    JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('it_staff','admin')
    GROUP BY u.id ORDER BY c DESC
  `).all();
  const queue = db.prepare(`
    SELECT t.*, c.name AS category_name, d.name AS department_name,
           ru.full_name AS requester_name, au.full_name AS assignee_name
    FROM tickets t
    LEFT JOIN ticket_categories c ON c.id = t.category_id
    LEFT JOIN departments d ON d.id = t.department_id
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE t.status NOT IN ('Closed','Cancelled')
    ORDER BY
      CASE t.priority WHEN 'Urgent' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 END,
      t.created_at DESC
    LIMIT 15
  `).all();
  const recentActivity = db.prepare(`
    SELECT a.*, u.full_name AS user_name, t.ticket_number, t.title AS ticket_title
    FROM ticket_activity_log a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN tickets t ON t.id = a.ticket_id
    ORDER BY a.created_at DESC LIMIT 12
  `).all();
  const projectsSummary = db.prepare(`
    SELECT status, COUNT(*) AS c FROM projects GROUP BY status
  `).all();

  res.render('it/dashboard', {
    title: 'IT Dashboard',
    counts, byCategory, byDepartment, workload, queue, recentActivity, projectsSummary,
  });
});

// -------- Admin dashboard --------
router.get('/dashboard/admin', requireLogin, (req, res) => {
  if (req.user.role !== 'admin') return res.redirect('/');
  const stats = {
    users:       db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1').get().c,
    departments: db.prepare('SELECT COUNT(*) AS c FROM departments').get().c,
    tickets:     db.prepare('SELECT COUNT(*) AS c FROM tickets').get().c,
    open:        db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status NOT IN ('Closed','Cancelled')").get().c,
    urgent:      db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE priority = 'Urgent' AND status NOT IN ('Closed','Cancelled')").get().c,
    projects:    db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
    ongoing:     db.prepare("SELECT COUNT(*) AS c FROM projects WHERE status = 'Ongoing'").get().c,
  };
  const ticketsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS c FROM tickets GROUP BY status
  `).all();
  const projectsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS c FROM projects GROUP BY status
  `).all();

  // 14-day ticket volume trend (created vs resolved)
  const trendDays = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    trendDays.push(d.toISOString().slice(0, 10));
  }
  const createdRows = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS c FROM tickets
    WHERE date(created_at) >= date('now','-13 days') GROUP BY day
  `).all();
  const resolvedRows = db.prepare(`
    SELECT date(resolved_at) AS day, COUNT(*) AS c FROM tickets
    WHERE resolved_at IS NOT NULL AND date(resolved_at) >= date('now','-13 days') GROUP BY day
  `).all();
  const createdMap = Object.fromEntries(createdRows.map(r => [r.day, r.c]));
  const resolvedMap = Object.fromEntries(resolvedRows.map(r => [r.day, r.c]));
  const ticketTrend = {
    labels:   trendDays.map(d => d.slice(5)),
    created:  trendDays.map(d => createdMap[d] || 0),
    resolved: trendDays.map(d => resolvedMap[d] || 0),
  };

  // Open tickets by priority (fixed order)
  const priorityRows = db.prepare(`
    SELECT priority, COUNT(*) AS c FROM tickets
    WHERE status NOT IN ('Closed','Cancelled') GROUP BY priority
  `).all();
  const priorityMap = Object.fromEntries(priorityRows.map(r => [r.priority, r.c]));
  const priorityBreakdown = ['Urgent', 'High', 'Medium', 'Low'].map(p => ({ priority: p, c: priorityMap[p] || 0 }));

  // Department workload (open tickets)
  const deptWorkload = db.prepare(`
    SELECT COALESCE(d.name, 'Unassigned') AS name, COUNT(*) AS c
    FROM tickets t LEFT JOIN departments d ON d.id = t.department_id
    WHERE t.status NOT IN ('Closed','Cancelled')
    GROUP BY d.name ORDER BY c DESC LIMIT 8
  `).all();
  const aging = db.prepare(`
    SELECT t.*, ru.full_name AS requester_name, au.full_name AS assignee_name,
           CAST((julianday('now') - julianday(t.created_at)) AS INTEGER) AS age_days
    FROM tickets t
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE t.status NOT IN ('Closed','Cancelled','Resolved')
    ORDER BY t.created_at ASC LIMIT 10
  `).all();
  const avgResolution = db.prepare(`
    SELECT ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 24), 1) AS avg_hours
    FROM tickets WHERE resolved_at IS NOT NULL
  `).get();

  const staffPerformance = db.prepare(`
    SELECT
      u.id,
      u.full_name,
      (SELECT COUNT(*) FROM tickets WHERE assigned_to = u.id) AS tickets_assigned,
      (SELECT COUNT(*) FROM tickets WHERE assigned_to = u.id AND status IN ('Resolved','Closed')) AS tickets_resolved,
      (SELECT ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 24), 1)
       FROM tickets WHERE assigned_to = u.id AND resolved_at IS NOT NULL) AS avg_hours,
      (SELECT COUNT(*) FROM project_tasks WHERE assigned_to = u.id) AS tasks_assigned,
      (SELECT COUNT(*) FROM project_tasks WHERE assigned_to = u.id AND status = 'Completed') AS tasks_done
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('it_staff','admin') AND u.is_active = 1
    ORDER BY tickets_resolved DESC, tasks_done DESC
  `).all();

  res.render('admin/dashboard', {
    title: 'Admin Dashboard',
    stats, ticketsByStatus, projectsByStatus, aging,
    avgHours: avgResolution.avg_hours || 0,
    staffPerformance, ticketTrend, priorityBreakdown, deptWorkload,
  });
});

module.exports = router;
