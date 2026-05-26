/**
 * Main server entry point.
 *
 * Run: npm start
 * Access locally:           http://localhost:3000
 * Access from network:      http://<server-ip>:3000
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const methodOverride = require('method-override');

const db = require('./db/database');
const { loadUser } = require('./middleware/auth');
const helpers = require('./utils/helpers');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();

// --- View engine ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// --- Static & uploads ---
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// --- Parsers ---
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(methodOverride('_method'));

// --- Sessions (file-backed) ---
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(session({
  store: new FileStore({
    path: path.join(dataDir, 'sessions'),
    ttl: 60 * 60 * 8,
    retries: 0,
    rewrite: false,   // avoids temp-file rename which fails on Windows (EPERM)
    logFn: () => {},
  }),
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 },
}));

// --- Globals available in every view ---
app.use(loadUser);
app.use((req, res, next) => {
  res.locals.helpers = helpers;
  res.locals.siteName = helpers.getSetting('site_name') || 'MIS Ticketing System';
  res.locals.orgName = helpers.getSetting('organization_name') || '';
  res.locals.path = req.path;
  res.locals.notifCount = 0;
  if (req.user && ['admin', 'it_staff'].includes(req.user.role)) {
    try {
      res.locals.notifCount = db.prepare(
        "SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0"
      ).get(req.user.id).c;
    } catch {}
  }
  next();
});

// --- Routes ---
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/tickets', require('./routes/tickets'));
app.use('/projects', require('./routes/projects'));
app.use('/admin', require('./routes/admin'));
app.use('/reports', require('./routes/reports'));
app.use('/notifications', require('./routes/notifications'));
app.use('/events', require('./routes/events').router);

// --- 404 ---
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

// --- Error handler ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server Error',
    message: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : (err.stack || err.message),
  });
});

async function start() {
  await db.init();

  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    ticket_id  INTEGER NOT NULL,
    message    TEXT    NOT NULL,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  // Add resolution_notes column if it doesn't exist yet
  try { db.exec("ALTER TABLE tickets ADD COLUMN resolution_notes TEXT"); } catch {}

  // Performance indexes — safe to re-run (IF NOT EXISTS)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tickets_created_at     ON tickets(created_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_updated_at     ON tickets(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_ticket        ON ticket_comments(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_activity_ticket        ON ticket_activity_log(ticket_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created       ON ticket_activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created          ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_notif_user_read        ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_project_tasks_project  ON project_tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned ON project_tasks(assigned_to);
  `);

  app.listen(PORT, HOST, () => {
    console.log('');
    console.log('==================================================');
    console.log('  MIS Ticketing System started');
    console.log('==================================================');
    console.log(`  Local:    http://localhost:${PORT}`);

    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  Network:  http://${net.address}:${PORT}`);
        }
      }
    }
    console.log('');
    console.log('  Default logins:');
    console.log('    admin   / admin123');
    console.log('    itstaff / it123');
    console.log('    user    / user123');
    console.log('==================================================');
  });
}

start().catch(err => { console.error('Failed to start:', err); process.exit(1); });
