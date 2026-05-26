const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireLogin, requireRole, setFlash } = require('../middleware/auth');
const { setSetting, getSetting, audit } = require('../utils/helpers');

const router = express.Router();
router.use(requireLogin, requireRole('admin'));

// ---- USERS ----
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.*, r.name AS role_name, d.name AS department_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = u.department_id
    ORDER BY u.is_active DESC, u.full_name
  `).all();
  const roles = db.prepare('SELECT * FROM roles').all();
  const departments = db.prepare('SELECT * FROM departments ORDER BY name').all();
  res.render('admin/users', { title: 'Users', users, roles, departments });
});

router.post('/users', (req, res) => {
  const { username, full_name, email, password, role_id, department_id } = req.body;
  if (!username || !password || !full_name || !role_id) {
    setFlash(req, 'error', 'Username, full name, password, and role are required.');
    return res.redirect('/admin/users');
  }
  try {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, email, role_id, department_id)
                VALUES (?, ?, ?, ?, ?, ?)`).run(
      username.trim(), bcrypt.hashSync(password, 10), full_name.trim(),
      email || null, role_id, department_id || null,
    );
    audit(req.user.id, 'user_create', username, req.ip);
    setFlash(req, 'success', `User ${username} created.`);
  } catch (e) {
    setFlash(req, 'error', e.message);
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/update', (req, res) => {
  const { full_name, email, role_id, department_id, is_active, password } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).end();

  db.prepare(`UPDATE users SET full_name = ?, email = ?, role_id = ?, department_id = ?, is_active = ?
              WHERE id = ?`).run(
    full_name || u.full_name, email || null, role_id || u.role_id,
    department_id || null, is_active ? 1 : 0, u.id,
  );
  if (password && password.length >= 6) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), u.id);
  }
  audit(req.user.id, 'user_update', u.username, req.ip);
  setFlash(req, 'success', 'User updated.');
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).end();
  if (u.id === req.user.id) {
    setFlash(req, 'error', "You can't delete your own account.");
    return res.redirect('/admin/users');
  }
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(u.id);
  audit(req.user.id, 'user_deactivate', u.username, req.ip);
  setFlash(req, 'success', `User ${u.username} deactivated.`);
  res.redirect('/admin/users');
});

// ---- DEPARTMENTS ----
router.get('/departments', (req, res) => {
  const departments = db.prepare(`
    SELECT d.*, (SELECT COUNT(*) FROM users WHERE department_id = d.id) AS user_count
    FROM departments d ORDER BY d.name
  `).all();
  res.render('admin/departments', { title: 'Departments', departments });
});

router.post('/departments', (req, res) => {
  const { name, description } = req.body;
  if (!name) { setFlash(req, 'error', 'Name required.'); return res.redirect('/admin/departments'); }
  try {
    db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)').run(name.trim(), description || null);
    setFlash(req, 'success', 'Department created.');
  } catch (e) { setFlash(req, 'error', e.message); }
  res.redirect('/admin/departments');
});

router.post('/departments/:id/update', (req, res) => {
  db.prepare('UPDATE departments SET name = ?, description = ? WHERE id = ?')
    .run(req.body.name, req.body.description || null, req.params.id);
  res.redirect('/admin/departments');
});

router.post('/departments/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM departments WHERE id = ?').run(req.params.id);
    setFlash(req, 'success', 'Department deleted.');
  } catch (e) {
    setFlash(req, 'error', 'Cannot delete: department is in use.');
  }
  res.redirect('/admin/departments');
});

// ---- CATEGORIES ----
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM ticket_categories ORDER BY is_active DESC, name').all();
  res.render('admin/categories', { title: 'Ticket Categories', categories });
});

router.post('/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) { setFlash(req, 'error', 'Name required.'); return res.redirect('/admin/categories'); }
  try {
    db.prepare('INSERT INTO ticket_categories (name, description) VALUES (?, ?)').run(name.trim(), description || null);
    setFlash(req, 'success', 'Category created.');
  } catch (e) { setFlash(req, 'error', e.message); }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/update', (req, res) => {
  db.prepare('UPDATE ticket_categories SET name = ?, description = ?, is_active = ? WHERE id = ?')
    .run(req.body.name, req.body.description || null, req.body.is_active ? 1 : 0, req.params.id);
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', (req, res) => {
  try {
    db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(req.params.id);
    setFlash(req, 'success', 'Category deleted.');
  } catch (e) {
    setFlash(req, 'error', 'Cannot delete: category is in use.');
  }
  res.redirect('/admin/categories');
});

// ---- SETTINGS ----
router.get('/settings', (req, res) => {
  const settings = {
    site_name:         getSetting('site_name') || '',
    organization_name: getSetting('organization_name') || '',
    ticket_prefix:     getSetting('ticket_prefix') || 'TKT',
    default_sla_hours: getSetting('default_sla_hours') || '48',
  };
  res.render('admin/settings', { title: 'System Settings', settings });
});

router.post('/settings', (req, res) => {
  for (const k of ['site_name', 'organization_name', 'ticket_prefix', 'default_sla_hours']) {
    setSetting(k, req.body[k] ?? '');
  }
  setFlash(req, 'success', 'Settings saved.');
  res.redirect('/admin/settings');
});

// ---- AUDIT LOG ----
router.get('/audit', (req, res) => {
  const logs = db.prepare(`
    SELECT a.*, u.full_name AS user_name, u.username
    FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT 500
  `).all();
  res.render('admin/audit', { title: 'Audit Log', logs });
});

module.exports = router;
