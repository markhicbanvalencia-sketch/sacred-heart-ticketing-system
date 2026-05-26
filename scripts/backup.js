/**
 * backup.js — copies data/app.db and uploads/ to backups/<timestamp>/
 * Run with: npm run backup
 *
 * For Windows Task Scheduler: schedule `node scripts\backup.js` daily.
 */
const fs = require('fs');
const path = require('path');

const ROOT     = path.join(__dirname, '..');
const DB_PATH  = path.join(ROOT, 'data', 'app.db');
const UPLOADS  = path.join(ROOT, 'uploads');
const BACKUPS  = path.join(ROOT, 'backups');

if (!fs.existsSync(BACKUPS)) fs.mkdirSync(BACKUPS, { recursive: true });

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(BACKUPS, ts);
fs.mkdirSync(dest);

if (fs.existsSync(DB_PATH)) {
  fs.copyFileSync(DB_PATH, path.join(dest, 'app.db'));
  console.log('Backed up database -> app.db');
}

if (fs.existsSync(UPLOADS)) {
  const copyDir = (src, dst) => {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      const s = path.join(src, item);
      const d = path.join(dst, item);
      if (fs.statSync(s).isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  copyDir(UPLOADS, path.join(dest, 'uploads'));
  console.log('Backed up uploads/');
}

console.log('Backup complete:', dest);
