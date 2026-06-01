const express = require('express');
const fs      = require('fs');
const path    = require('path');
const db      = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router     = express.Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: stat.size, created: stat.mtime };
    })
    .sort((a, b) => b.created - a.created); // newest first
}

function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// GET /admin/backup — backup management page
router.get('/', requireRole('admin'), (req, res) => {
  res.render('admin/backup', {
    title: 'Database Backup',
    backups: listBackups(),
    fmtBytes,
    flash: res.locals.flash,
  });
});

// GET /admin/backup/download — download live DB snapshot
router.get('/download', requireRole('admin'), (req, res) => {
  const buf = db.exportBuffer();
  if (!buf) return res.status(500).send('Database not ready.');
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="sacred-heart-${date}.db"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

// POST /admin/backup/create — save a timestamped backup to data/backups/
router.post('/create', requireRole('admin'), (req, res) => {
  const buf = db.exportBuffer();
  if (!buf) {
    req.session.flash = { type: 'error', message: 'Database not ready.' };
    return res.redirect('/admin/backup');
  }
  ensureBackupDir();
  const date     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${date}.db`;
  fs.writeFileSync(path.join(BACKUP_DIR, filename), buf);

  // Keep only the 20 most recent backups
  const all = listBackups();
  if (all.length > 20) {
    all.slice(20).forEach(b => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch {}
    });
  }

  req.session.flash = { type: 'success', message: `Backup saved: ${filename}` };
  res.redirect('/admin/backup');
});

// GET /admin/backup/:filename — download a saved backup file
router.get('/:filename', requireRole('admin'), (req, res) => {
  const safe = path.basename(req.params.filename); // prevent path traversal
  const file = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(file) || !safe.endsWith('.db')) {
    return res.status(404).send('Backup not found.');
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.sendFile(file);
});

// POST /admin/backup/:filename/delete — delete a saved backup
router.post('/:filename/delete', requireRole('admin'), (req, res) => {
  const safe = path.basename(req.params.filename);
  const file = path.join(BACKUP_DIR, safe);
  if (fs.existsSync(file) && safe.endsWith('.db')) {
    try { fs.unlinkSync(file); } catch {}
  }
  req.session.flash = { type: 'success', message: 'Backup deleted.' };
  res.redirect('/admin/backup');
});

module.exports = router;
