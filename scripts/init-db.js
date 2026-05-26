/**
 * init-db.js
 * Creates the SQLite database and all tables, then seeds default data.
 * Run with: npm run init-db
 *
 * Safe to re-run: uses CREATE TABLE IF NOT EXISTS. It will NOT overwrite
 * existing data. To wipe and rebuild, delete data/app.db first.
 */

const bcrypt = require('bcryptjs');
const db = require('../src/db/database');

async function main() {
  await db.init();

  console.log('Creating tables...');

  db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  role_id INTEGER NOT NULL,
  department_id INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS ticket_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id INTEGER,
  department_id INTEGER,
  requester_id INTEGER NOT NULL,
  assigned_to INTEGER,
  priority TEXT NOT NULL DEFAULT 'Medium',
  status TEXT NOT NULL DEFAULT 'New',
  due_date TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  resolved_at TEXT,
  closed_at TEXT,
  FOREIGN KEY (category_id) REFERENCES ticket_categories(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (requester_id) REFERENCES users(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned ON tickets(assigned_to);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ticket_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  department_id INTEGER,
  owner_id INTEGER NOT NULL,
  start_date TEXT,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'Planned',
  priority TEXT NOT NULL DEFAULT 'Medium',
  progress INTEGER NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to INTEGER,
  status TEXT NOT NULL DEFAULT 'Pending',
  due_date TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role_in_project TEXT,
  UNIQUE (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT,
  created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
`);

  console.log('Tables created.');

  // ---------- Seed roles ----------
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  insertRole.run('admin', 'System administrator');
  insertRole.run('it_staff', 'MIS/IT department staff');
  insertRole.run('user', 'Regular end-user / client');

  const roleId = (name) => db.prepare('SELECT id FROM roles WHERE name = ?').get(name).id;

  // ---------- Seed departments ----------
  const insertDept = db.prepare('INSERT OR IGNORE INTO departments (name, description) VALUES (?, ?)');
  [
    ['MIS / IT', 'Management Information Systems / IT'],
    ['Human Resources', 'HR Department'],
    ['Finance', 'Finance and Accounting'],
    ['Operations', 'Operations Department'],
    ['Sales', 'Sales Department'],
    ['Administration', 'Administration / Executive'],
  ].forEach(([n, d]) => insertDept.run(n, d));

  const deptId = (name) => db.prepare('SELECT id FROM departments WHERE name = ?').get(name).id;

  // ---------- Seed ticket categories ----------
  const insertCat = db.prepare('INSERT OR IGNORE INTO ticket_categories (name, description) VALUES (?, ?)');
  [
    ['Hardware', 'PC, laptop, printer, peripherals'],
    ['Software', 'Application install, errors, updates'],
    ['Network / Internet', 'WiFi, LAN, slow internet'],
    ['Email / Account', 'Account access, password resets, email issues'],
    ['Printer', 'Printer setup, ink, paper jams'],
    ['System / ERP', 'Internal systems, ERP, line-of-business apps'],
    ['Security', 'Antivirus, suspicious activity, access control'],
    ['Other', 'Anything not covered above'],
  ].forEach(([n, d]) => insertCat.run(n, d));

  // ---------- Seed users ----------
  const hash = (pw) => bcrypt.hashSync(pw, 10);
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, full_name, email, role_id, department_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run('admin', hash('admin123'), 'System Administrator', 'admin@local', roleId('admin'), deptId('MIS / IT'));
  insertUser.run('itstaff', hash('it123'), 'IT Staff (Demo)', 'it@local', roleId('it_staff'), deptId('MIS / IT'));
  insertUser.run('user', hash('user123'), 'Regular User (Demo)', 'user@local', roleId('user'), deptId('Operations'));

  // ---------- Seed settings ----------
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('site_name', 'MIS Ticketing System');
  insertSetting.run('organization_name', 'Your Organization');
  insertSetting.run('ticket_prefix', 'TKT');
  insertSetting.run('default_sla_hours', '48');

  console.log('Seed data inserted.');
  console.log('');
  console.log('Default accounts:');
  console.log('  admin   / admin123   (Administrator)');
  console.log('  itstaff / it123      (IT Staff)');
  console.log('  user    / user123    (Regular User)');
  console.log('');
  console.log('Database ready at: data/app.db');

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
