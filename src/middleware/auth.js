/**
 * Authentication & RBAC middleware.
 *
 * - requireLogin: blocks anonymous users
 * - requireRole(...roles): blocks users without the given role(s)
 * - loadUser: pulls fresh user info into res.locals on every request
 */
const db = require('../db/database');

function loadUser(req, res, next) {
  res.locals.currentUser = null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  if (req.session && req.session.userId) {
    const user = db.prepare(`
      SELECT u.id, u.username, u.full_name, u.email, u.is_active,
             r.name AS role, d.name AS department, u.department_id
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = ?
    `).get(req.session.userId);

    if (user && user.is_active) {
      res.locals.currentUser = user;
      req.user = user;
    } else {
      req.session.destroy(() => {});
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET' && req.accepts('html')) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    return res.status(401).json({ error: 'Login required' });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login');
    if (!roles.includes(req.user.role)) {
      return res.status(403).render('error', {
        title: 'Forbidden',
        message: "You don't have permission to view this page.",
      });
    }
    next();
  };
}

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { loadUser, requireLogin, requireRole, setFlash };
