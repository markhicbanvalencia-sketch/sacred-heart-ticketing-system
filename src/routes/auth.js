const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { requireLogin, setFlash } = require('../middleware/auth');
const { audit } = require('../utils/helpers');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { title: 'Sign in', next: req.query.next || '/', error: null });
});

router.post('/login', (req, res) => {
  const { username, password, next: nextUrl } = req.body;
  const u = db.prepare(`
    SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.username = ? AND u.is_active = 1
  `).get((username || '').trim());

  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.render('auth/login', {
      title: 'Sign in',
      next: nextUrl || '/',
      error: 'Invalid username or password.',
    });
  }

  req.session.userId = u.id;
  audit(u.id, 'login', `User ${u.username} signed in`, req.ip);
  res.redirect(nextUrl && nextUrl.startsWith('/') ? nextUrl : '/');
});

router.post('/logout', requireLogin, (req, res) => {
  const uid = req.user.id;
  req.session.destroy(() => {
    audit(uid, 'logout', null, req.ip);
    res.redirect('/login');
  });
});

router.get('/account', requireLogin, (req, res) => {
  res.render('auth/account', { title: 'My Account', error: null, success: null });
});

router.post('/account/password', requireLogin, (req, res) => {
  const { current, next, confirm } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current || '', u.password_hash)) {
    return res.render('auth/account', { title: 'My Account', error: 'Current password is incorrect.', success: null });
  }
  if (!next || next.length < 6) {
    return res.render('auth/account', { title: 'My Account', error: 'New password must be at least 6 characters.', success: null });
  }
  if (next !== confirm) {
    return res.render('auth/account', { title: 'My Account', error: 'New passwords do not match.', success: null });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
  audit(req.user.id, 'change_password', null, req.ip);
  res.render('auth/account', { title: 'My Account', error: null, success: 'Password changed successfully.' });
});

module.exports = router;
