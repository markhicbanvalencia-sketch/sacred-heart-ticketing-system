const express = require('express');
const db = require('../db/database');
const { requireLogin, requireRole, setFlash } = require('../middleware/auth');
const { PROJECT_STATUSES, PRIORITIES } = require('../utils/helpers');

const router = express.Router();

// ---- LIST ----
router.get('/', requireLogin, requireRole('admin', 'it_staff'), (req, res) => {
  const { status, search } = req.query;
  const where = [];
  const params = [];

  if (status) { where.push('p.status = ?'); params.push(status); }
  if (search) { where.push('(p.name LIKE ? OR p.description LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const projects = db.prepare(`
    SELECT p.*, d.name AS department_name, u.full_name AS owner_name,
      (SELECT COUNT(*) FROM project_tasks WHERE project_id = p.id) AS tasks_total,
      (SELECT COUNT(*) FROM project_tasks WHERE project_id = p.id AND status = 'Completed') AS tasks_done
    FROM projects p
    LEFT JOIN departments d ON d.id = p.department_id
    LEFT JOIN users u ON u.id = p.owner_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE p.status WHEN 'Ongoing' THEN 1 WHEN 'Planned' THEN 2 WHEN 'On Hold' THEN 3 WHEN 'Completed' THEN 4 ELSE 5 END,
      p.updated_at DESC
  `).all(...params);

  // Summary cards
  const summary = {
    total:      db.prepare('SELECT COUNT(*) AS c FROM projects').get().c,
    ongoing:    db.prepare("SELECT COUNT(*) AS c FROM projects WHERE status = 'Ongoing'").get().c,
    completed:  db.prepare("SELECT COUNT(*) AS c FROM projects WHERE status = 'Completed'").get().c,
    delayed:    db.prepare("SELECT COUNT(*) AS c FROM projects WHERE status != 'Completed' AND target_date IS NOT NULL AND date(target_date) < date('now')").get().c,
  };

  res.render('projects/list', {
    title: 'Projects', projects, summary, PROJECT_STATUSES, filters: req.query,
  });
});

// ---- NEW ----
router.get('/new', requireLogin, requireRole('admin', 'it_staff'), (req, res) => {
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  const users = db.prepare('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name').all();
  res.render('projects/new', {
    title: 'New Project', departments, users, PROJECT_STATUSES, PRIORITIES,
    values: {}, error: null,
  });
});

router.post('/', requireLogin, requireRole('admin', 'it_staff'), (req, res) => {
  const { name, description, department_id, owner_id, start_date, target_date,
          status, priority, progress, remarks } = req.body;

  if (!name) {
    const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
    const users = db.prepare('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name').all();
    return res.status(400).render('projects/new', {
      title: 'New Project', departments, users, PROJECT_STATUSES, PRIORITIES,
      values: req.body, error: 'Project name is required.',
    });
  }

  const info = db.prepare(`
    INSERT INTO projects (name, description, department_id, owner_id, start_date, target_date,
                          status, priority, progress, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    description || null,
    department_id || null,
    owner_id || req.user.id,
    start_date || null,
    target_date || null,
    PROJECT_STATUSES.includes(status) ? status : 'Planned',
    PRIORITIES.includes(priority) ? priority : 'Medium',
    Math.max(0, Math.min(100, parseInt(progress || '0', 10) || 0)),
    remarks || null,
  );
  setFlash(req, 'success', 'Project created.');
  res.redirect(`/projects/${info.lastInsertRowid}`);
});

// ---- VIEW ----
router.get('/:id', requireLogin, requireRole('admin', 'it_staff'), (req, res) => {
  const project = db.prepare(`
    SELECT p.*, d.name AS department_name, u.full_name AS owner_name
    FROM projects p
    LEFT JOIN departments d ON d.id = p.department_id
    LEFT JOIN users u ON u.id = p.owner_id
    WHERE p.id = ?
  `).get(req.params.id);
  if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.' });

  const tasks = db.prepare(`
    SELECT t.*, u.full_name AS assignee_name
    FROM project_tasks t
    LEFT JOIN users u ON u.id = t.assigned_to
    WHERE t.project_id = ?
    ORDER BY
      CASE t.status WHEN 'In Progress' THEN 1 WHEN 'Pending' THEN 2 WHEN 'Completed' THEN 3 ELSE 4 END,
      t.due_date IS NULL, t.due_date
  `).all(project.id);
  const members = db.prepare(`
    SELECT m.*, u.full_name, u.username FROM project_members m
    JOIN users u ON u.id = m.user_id WHERE m.project_id = ?
  `).all(project.id);
  const users = db.prepare('SELECT id, full_name FROM users WHERE is_active = 1 ORDER BY full_name').all();

  res.render('projects/view', {
    title: project.name, project, tasks, members, users,
    PROJECT_STATUSES, PRIORITIES,
    canEdit: req.user.role === 'admin' || project.owner_id === req.user.id,
  });
});

function requireOwnerOrAdmin(req, res, next) {
  const project = db.prepare('SELECT owner_id FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).render('error', { title: 'Not Found', message: 'Project not found.' });
  if (req.user.role === 'admin' || project.owner_id === req.user.id) return next();
  return res.status(403).render('error', { title: 'Forbidden', message: 'Only the project owner or an admin can do that.' });
}

// ---- UPDATE PROJECT ----
router.post('/:id/update', requireLogin, requireOwnerOrAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).end();
  const { name, description, status, priority, start_date, target_date, remarks, owner_id, department_id } = req.body;
  db.prepare(`
    UPDATE projects
    SET name = ?, description = ?, status = ?, priority = ?,
        start_date = ?, target_date = ?, remarks = ?, owner_id = ?, department_id = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    name || p.name,
    description ?? p.description,
    PROJECT_STATUSES.includes(status) ? status : p.status,
    PRIORITIES.includes(priority) ? priority : p.priority,
    start_date || null,
    target_date || null,
    remarks || null,
    owner_id || p.owner_id,
    department_id || p.department_id,
    p.id,
  );
  recalcProgress(p.id);
  res.redirect(`/projects/${p.id}`);
});

// ---- TASKS ----
router.post('/:id/tasks', requireLogin, requireOwnerOrAdmin, (req, res) => {
  const { title, description, assigned_to, due_date, status } = req.body;
  if (!title) return res.redirect(`/projects/${req.params.id}`);
  db.prepare(`
    INSERT INTO project_tasks (project_id, title, description, assigned_to, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, title.trim(), description || null, assigned_to || null, due_date || null, status || 'Pending');
  recalcProgress(req.params.id);
  res.redirect(`/projects/${req.params.id}`);
});

router.post('/:id/tasks/:taskId/update', requireLogin, requireOwnerOrAdmin, (req, res) => {
  const { status, assigned_to, due_date, title, description } = req.body;
  const completed_at = status === 'Completed' ? "datetime('now','localtime')" : 'NULL';
  // dynamic build to allow raw completed_at fragment
  db.prepare(`
    UPDATE project_tasks
    SET title = COALESCE(?, title),
        description = ?,
        status = ?,
        assigned_to = ?,
        due_date = ?,
        completed_at = ${completed_at}
    WHERE id = ? AND project_id = ?
  `).run(
    title || null, description || null, status || 'Pending',
    assigned_to || null, due_date || null,
    req.params.taskId, req.params.id,
  );
  recalcProgress(req.params.id);
  res.redirect(`/projects/${req.params.id}`);
});

router.post('/:id/tasks/:taskId/status', requireLogin, requireOwnerOrAdmin, (req, res) => {
  const { status } = req.body;
  const valid = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
  if (!valid.includes(status)) return res.redirect(`/projects/${req.params.id}`);
  const completed_at = status === 'Completed' ? "datetime('now','localtime')" : 'NULL';
  db.prepare(`UPDATE project_tasks SET status = ?, completed_at = ${completed_at} WHERE id = ? AND project_id = ?`)
    .run(status, req.params.taskId, req.params.id);
  recalcProgress(req.params.id);
  res.redirect(`/projects/${req.params.id}`);
});

router.post('/:id/tasks/:taskId/delete', requireLogin, requireOwnerOrAdmin, (req, res) => {
  db.prepare('DELETE FROM project_tasks WHERE id = ? AND project_id = ?').run(req.params.taskId, req.params.id);
  recalcProgress(req.params.id);
  res.redirect(`/projects/${req.params.id}`);
});

// ---- MEMBERS ----
router.post('/:id/members', requireLogin, requireOwnerOrAdmin, (req, res) => {
  const { user_id, role_in_project } = req.body;
  if (user_id) {
    db.prepare(`INSERT OR IGNORE INTO project_members (project_id, user_id, role_in_project)
                VALUES (?, ?, ?)`).run(req.params.id, user_id, role_in_project || null);
  }
  res.redirect(`/projects/${req.params.id}`);
});

router.post('/:id/members/:memberId/delete', requireLogin, requireOwnerOrAdmin, (req, res) => {
  db.prepare('DELETE FROM project_members WHERE id = ? AND project_id = ?').run(req.params.memberId, req.params.id);
  res.redirect(`/projects/${req.params.id}`);
});

// ---- DELETE PROJECT (admin only) ----
router.post('/:id/delete', requireLogin, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  setFlash(req, 'success', 'Project deleted.');
  res.redirect('/projects');
});

function recalcProgress(projectId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS done
    FROM project_tasks WHERE project_id = ?
  `).get(projectId);
  const pct = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
  db.prepare("UPDATE projects SET progress = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(pct, projectId);
}

module.exports = router;
