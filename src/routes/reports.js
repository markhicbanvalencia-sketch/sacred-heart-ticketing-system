const express = require('express');
const db = require('../db/database');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireLogin, requireRole('admin', 'it_staff'));

router.get('/', (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS c FROM tickets GROUP BY status').all();
  const byPriority = db.prepare('SELECT priority, COUNT(*) AS c FROM tickets GROUP BY priority').all();
  const byDepartment = db.prepare(`
    SELECT COALESCE(d.name, 'Unknown') AS name, COUNT(*) AS c
    FROM tickets t LEFT JOIN departments d ON d.id = t.department_id GROUP BY d.name
  `).all();
  const byCategory = db.prepare(`
    SELECT COALESCE(c.name, 'Uncategorized') AS name, COUNT(*) AS c
    FROM tickets t LEFT JOIN ticket_categories c ON c.id = t.category_id GROUP BY c.name
  `).all();
  const byStaff = db.prepare(`
    SELECT u.full_name AS name,
           COUNT(t.id) AS total,
           SUM(CASE WHEN t.status IN ('Resolved','Closed') THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN t.status NOT IN ('Resolved','Closed','Cancelled') THEN 1 ELSE 0 END) AS open
    FROM users u
    LEFT JOIN tickets t ON t.assigned_to = u.id
    JOIN roles r ON r.id = u.role_id
    WHERE r.name IN ('it_staff','admin')
    GROUP BY u.id ORDER BY total DESC
  `).all();
  const avgResolution = db.prepare(`
    SELECT ROUND(AVG((julianday(resolved_at) - julianday(created_at)) * 24), 1) AS avg_hours
    FROM tickets WHERE resolved_at IS NOT NULL
  `).get();
  const aging = db.prepare(`
    SELECT t.*, ru.full_name AS requester_name, au.full_name AS assignee_name,
           CAST((julianday('now') - julianday(t.created_at)) AS INTEGER) AS age_days
    FROM tickets t
    LEFT JOIN users ru ON ru.id = t.requester_id
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE t.status NOT IN ('Closed','Cancelled','Resolved')
    ORDER BY t.created_at ASC LIMIT 50
  `).all();
  const projects = db.prepare('SELECT status, COUNT(*) AS c FROM projects GROUP BY status').all();

  res.render('admin/reports', {
    title: 'Reports',
    byStatus, byPriority, byDepartment, byCategory, byStaff,
    avgHours: avgResolution.avg_hours || 0,
    aging, projects,
  });
});

module.exports = router;
