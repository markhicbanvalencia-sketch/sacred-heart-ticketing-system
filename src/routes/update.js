const express  = require('express');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { exec } = require('child_process');
const { requireRole, setFlash } = require('../middleware/auth');

const router  = express.Router();
const REPO    = 'markhicbanvalencia-sketch/sacred-heart-ticketing-system';
const APP_DIR = path.join(__dirname, '..', '..');
const VERSION_FILE = path.join(APP_DIR, 'data', 'version.json');

// Folders copied from the downloaded ZIP into the app directory
const UPDATE_DIRS = ['src', 'views', 'public', 'installer'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); }
  catch { return { sha: null, version: null, updated_at: null }; }
}

function saveVersion(sha, version) {
  const dir = path.dirname(VERSION_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VERSION_FILE, JSON.stringify({ sha, version, updated_at: new Date().toISOString() }, null, 2));
}

// Follow redirects; returns { statusCode, headers, body }
function httpsGet(url, binary = false) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SacredHeartMIS/1.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpsGet(res.headers.location, binary).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8'),
      }));
    }).on('error', reject);
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /admin/update  — show current vs latest version
router.get('/', requireRole('admin'), async (req, res) => {
  const current = getCurrentVersion();
  let latest    = null;
  let message   = null;
  let error     = null;

  try {
    const r = await httpsGet(`https://api.github.com/repos/${REPO}/commits/main`);
    if (r.statusCode === 200) {
      const data  = JSON.parse(r.body);
      latest      = data.sha;
      message     = (data.commit && data.commit.message) ? data.commit.message.split('\n')[0] : '';
    } else {
      error = `GitHub returned HTTP ${r.statusCode}. Check your internet connection.`;
    }
  } catch (e) {
    error = 'Could not reach GitHub — check internet connection on this PC.';
  }

  const upToDate = !!(current.sha && latest && current.sha === latest);

  res.render('admin/update', {
    title: 'System Update',
    currentSHA:   current.sha   ? current.sha.slice(0, 7)   : 'unknown',
    currentDate:  current.updated_at ? new Date(current.updated_at).toLocaleString() : 'never',
    latestSHA:    latest ? latest.slice(0, 7) : null,
    latestMsg:    message,
    upToDate,
    error,
    flash: res.locals.flash,
  });
});

// POST /admin/update/apply  — download latest ZIP and replace source files
router.post('/apply', requireRole('admin'), async (req, res) => {
  const tmpZip = path.join(os.tmpdir(), `sacred-heart-update-${Date.now()}.zip`);
  const tmpDir = path.join(os.tmpdir(), `sacred-heart-update-${Date.now()}`);

  try {
    // 1. Download ZIP from GitHub
    const r = await httpsGet(`https://api.github.com/repos/${REPO}/zipball/main`, true);
    if (r.statusCode !== 200) throw new Error(`Download failed: HTTP ${r.statusCode}`);
    fs.writeFileSync(tmpZip, r.body);

    // 2. Extract ZIP using PowerShell (built-in on Windows 10+)
    await new Promise((resolve, reject) => {
      exec(
        `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`,
        { timeout: 60000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        }
      );
    });

    // 3. Find the root folder inside the ZIP (GitHub names it owner-repo-sha/)
    const entries = fs.readdirSync(tmpDir);
    if (!entries.length) throw new Error('ZIP was empty or could not be extracted.');
    const zipRoot = path.join(tmpDir, entries[0]);

    // 4. Get latest commit SHA from package.json in extracted ZIP
    let newVersion = '1.x';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(zipRoot, 'package.json'), 'utf8'));
      newVersion = pkg.version || newVersion;
    } catch {}

    // 5. Copy updated dirs over the installed app (overwrite in-place)
    for (const dir of UPDATE_DIRS) {
      const src  = path.join(zipRoot, dir);
      const dest = path.join(APP_DIR, dir);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true, force: true });
      }
    }

    // 6. Copy package.json so we know if deps changed
    const newPkg = path.join(zipRoot, 'package.json');
    if (fs.existsSync(newPkg)) fs.copyFileSync(newPkg, path.join(APP_DIR, 'package.json'));

    // 7. Get the actual SHA from the GitHub API
    let sha = null;
    try {
      const cr = await httpsGet(`https://api.github.com/repos/${REPO}/commits/main`);
      if (cr.statusCode === 200) sha = JSON.parse(cr.body).sha;
    } catch {}

    // 8. Save version record
    saveVersion(sha, newVersion);

    // 9. Schedule restart (give the response time to reach the browser)
    setTimeout(() => process.exit(0), 1500);

    res.render('admin/update-applying', {
      title: 'Applying Update...',
      flash: null,
    });

  } catch (e) {
    // Clean up temp files on error
    try { fs.unlinkSync(tmpZip); }  catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

    setFlash(req, 'error', `Update failed: ${e.message}`);
    res.redirect('/admin/update');
  }
});

module.exports = router;
