const express  = require('express');
const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const zlib     = require('zlib');
const { requireRole, setFlash } = require('../middleware/auth');

const router  = express.Router();
const REPO    = 'markhicbanvalencia-sketch/sacred-heart-ticketing-system';
const APP_DIR = path.join(__dirname, '..', '..');
const VERSION_FILE = path.join(APP_DIR, 'data', 'version.json');
const BRANCH_ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/main.zip`;
// GitHub names a branch-archive download "{repo}-{branch}.zip" — this is what
// a plain browser click on BRANCH_ZIP_URL saves into the Downloads folder.
const DOWNLOADED_ZIP_PATTERN = /^sacred-heart-ticketing-system-main(\s*\(\d+\))?\.zip$/i;

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
// timeoutMs is an IDLE timeout (resets on every chunk received), not a total
// duration cap — a slow-but-still-moving download won't get killed early.
// Uses a plain JS timer (not req.setTimeout/socket timeout) because Node only
// arms a socket-level timeout AFTER the socket connects — a request that never
// connects at all (DNS never resolving, or a firewall silently dropping the
// outbound TCP handshake instead of rejecting it) would never trip that timer
// and would hang forever with no error. A plain timer starts counting the
// instant the request is issued, so it catches a stall in any phase.
function httpsGet(url, binary = false, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let timer;
    const fail = (err) => { clearTimeout(timer); reject(err); };

    const req = https.get(url, { headers: { 'User-Agent': 'SacredHeartMIS/1.0' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        clearTimeout(timer);
        return httpsGet(res.headers.location, binary, timeoutMs).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => { chunks.push(c); timer.refresh(); });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: binary ? Buffer.concat(chunks) : Buffer.concat(chunks).toString('utf8'),
        });
      });
      res.on('error', fail);
    });

    timer = setTimeout(() => {
      req.destroy(new Error(
        `Connection to GitHub stalled for ${Math.round(timeoutMs / 1000)}s with no response — ` +
        `this usually means a firewall or antivirus is silently blocking outbound HTTPS from node.exe ` +
        `(even if your browser can reach github.com fine, browsers and Node use separate network paths/proxy ` +
        `settings). Check firewall/antivirus rules for node.exe, or any proxy settings this network requires.`
      ));
    }, timeoutMs);

    req.on('error', fail);
  });
}

// Find the most recently downloaded update ZIP in the current user's Downloads
// folder (Chrome/Edge append " (1)", " (2)", etc. on repeat downloads).
function findDownloadedZip() {
  const dir = path.join(os.homedir(), 'Downloads');
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir)
    .filter(f => DOWNLOADED_ZIP_PATTERN.test(f))
    .map(f => {
      const full = path.join(dir, f);
      return { full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0] ? matches[0].full : null;
}

// Best-effort: strip Windows' "Mark of the Web" (the Zone.Identifier
// alternate data stream a browser tags downloaded files with). Some
// antivirus/EDR products do a slow, blocking scan the first time anything
// reads the *contents* of a MOTW-tagged file — harmless for a browser (which
// waits on it natively) but capable of stalling a plain fs.readFile for a
// long time. Removing the tag before we touch the file avoids triggering it.
async function unblockFile(filePath) {
  try { await fs.promises.unlink(filePath + ':Zone.Identifier'); } catch {}
}

// Extract a ZIP file entirely in-process using Node's built-in zlib — no
// external process (PowerShell, tar, etc.) is spawned. That matters here:
// spawning powershell.exe depends on it being resolvable on whatever PATH the
// Node process inherited (which can differ for a process launched silently at
// boot vs. an interactive terminal), and on some locked-down machines
// spawning powershell.exe is itself intercepted/delayed by security software.
// Doing the extraction as plain buffer math sidesteps all of that.
//
// Uses async fs calls throughout (not *Sync). This isn't about speed — it's
// so a wrapping timeout can actually fire: a *Sync call blocks the entire
// Node event loop, including any setTimeout, until it returns, so if the
// underlying disk read itself stalls (e.g. antivirus holding the file open
// mid-scan) a Sync version would freeze the whole process with no way out.
async function extractZip(zipPath, destDir) {
  await unblockFile(zipPath);
  const buf = await fs.promises.readFile(zipPath);

  // Locate the End Of Central Directory record by scanning backward for its
  // signature (a trailing comment of arbitrary length can follow it).
  const EOCD_SIG = 0x06054b50;
  const maxCommentLen = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLen);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file (no End Of Central Directory record found).');

  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let offset        = buf.readUInt32LE(eocdOffset + 16); // central directory offset

  const CD_SIG  = 0x02014b50;
  const LFH_SIG = 0x04034b50;
  const destRoot = path.normalize(destDir + path.sep);

  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(offset) !== CD_SIG) throw new Error('Corrupt ZIP central directory.');

    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize    = buf.readUInt32LE(offset + 20);
    const filenameLength    = buf.readUInt16LE(offset + 28);
    const extraFieldLength  = buf.readUInt16LE(offset + 30);
    const commentLength     = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const filename = buf.toString('utf8', offset + 46, offset + 46 + filenameLength);

    offset += 46 + filenameLength + extraFieldLength + commentLength;

    const destPath = path.join(destDir, filename);
    if (!destPath.startsWith(destRoot)) throw new Error(`Unsafe path in ZIP entry: ${filename}`);

    if (filename.endsWith('/')) {
      await fs.promises.mkdir(destPath, { recursive: true });
      continue;
    }

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    if (buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) throw new Error(`Corrupt ZIP local header for ${filename}.`);
    const lfhNameLen  = buf.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart   = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

    let fileData;
    if (compressionMethod === 0) fileData = compressedData;               // stored
    else if (compressionMethod === 8) fileData = zlib.inflateRawSync(compressedData); // deflate (pure CPU, no I/O — fine sync)
    else throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${filename}.`);

    await fs.promises.writeFile(destPath, fileData);
  }
}

// Races a promise against a hard timeout. Doesn't cancel the underlying work
// (Node can't forcibly abort an in-flight fs call) — it just guarantees the
// *caller* gets a response either way, instead of hanging indefinitely.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Shared by both update paths: extract an already-downloaded ZIP (local disk,
// no network) and copy the updated folders over the installed app in-place.
// Resolves with the version string written to the version record.
async function extractAndApplyZip(zipPath, { sha = null } = {}) {
  const tmpDir = path.join(os.tmpdir(), `sacred-heart-update-${Date.now()}`);
  await fs.promises.mkdir(tmpDir, { recursive: true });
  await extractZip(zipPath, tmpDir);

  try {
    // Find the root folder inside the ZIP (GitHub names it owner-repo-sha/
    // or repo-branch/ depending on which endpoint produced it)
    const entries = await fs.promises.readdir(tmpDir);
    if (!entries.length) throw new Error('ZIP was empty or could not be extracted.');
    const zipRoot = path.join(tmpDir, entries[0]);

    // Get version from package.json in extracted ZIP
    let newVersion = '1.x';
    try {
      const pkg = JSON.parse(await fs.promises.readFile(path.join(zipRoot, 'package.json'), 'utf8'));
      newVersion = pkg.version || newVersion;
    } catch {}

    // Copy updated dirs over the installed app (overwrite in-place)
    for (const dir of UPDATE_DIRS) {
      const src  = path.join(zipRoot, dir);
      const dest = path.join(APP_DIR, dir);
      if (fs.existsSync(src)) {
        await fs.promises.cp(src, dest, { recursive: true, force: true });
      }
    }

    // Copy package.json so we know if deps changed
    const newPkg = path.join(zipRoot, 'package.json');
    if (fs.existsSync(newPkg)) await fs.promises.copyFile(newPkg, path.join(APP_DIR, 'package.json'));

    // Save version record
    saveVersion(sha, newVersion);
    return newVersion;
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
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

// POST /admin/update/apply  — download latest ZIP over the network and apply it
// (requires Node's own outbound HTTPS to reach GitHub — see /apply-local for a
// fallback that only needs the browser to have downloaded the ZIP already)
router.post('/apply', requireRole('admin'), async (req, res) => {
  const tmpZip = path.join(os.tmpdir(), `sacred-heart-update-${Date.now()}.zip`);

  try {
    // Download ZIP from GitHub (larger idle timeout — it's a bigger transfer)
    const r = await httpsGet(`https://api.github.com/repos/${REPO}/zipball/main`, true, 45000);
    if (r.statusCode !== 200) throw new Error(`Download failed: HTTP ${r.statusCode}`);
    fs.writeFileSync(tmpZip, r.body);

    // Best-effort: resolve the real commit SHA (cosmetic only — never blocks the update)
    let sha = null;
    try {
      const cr = await httpsGet(`https://api.github.com/repos/${REPO}/commits/main`, false, 10000);
      if (cr.statusCode === 200) sha = JSON.parse(cr.body).sha;
    } catch {}

    await withTimeout(
      extractAndApplyZip(tmpZip, { sha }),
      90000,
      'Applying the update timed out after 90s — this can happen if antivirus/security software ' +
      'is scanning the file very slowly. Wait a minute and try again; if it keeps happening, try ' +
      'the Manual Update option below instead.'
    );

    // Schedule restart (give the response time to reach the browser)
    setTimeout(() => process.exit(0), 1500);
    res.render('admin/update-applying', { title: 'Applying Update...', flash: null });

  } catch (e) {
    console.error('[update/apply] failed:', e);
    setFlash(req, 'error', `Update failed: ${e.message}`);
    res.redirect('/admin/update');
  } finally {
    try { fs.unlinkSync(tmpZip); } catch {}
  }
});

// POST /admin/update/apply-local  — apply a ZIP the browser already downloaded
// to this PC's Downloads folder. No network call from Node at all: the browser
// did the download (via GET /admin/update/download-link), so this only touches
// local disk — a fallback for networks where Node's own outbound HTTPS to
// GitHub doesn't work even though the browser can reach it fine.
router.post('/apply-local', requireRole('admin'), async (req, res) => {
  const zipPath = findDownloadedZip();

  if (!zipPath) {
    setFlash(req, 'error',
      `No downloaded update ZIP found in your Downloads folder. Click "1. Download Update ZIP" ` +
      `below first, wait for it to finish, then click Apply.`);
    return res.redirect('/admin/update');
  }

  try {
    await withTimeout(
      extractAndApplyZip(zipPath, { sha: null }),
      90000,
      'Applying the update timed out after 90s — this can happen if antivirus/security software ' +
      'is scanning the downloaded file very slowly. Try right-clicking the ZIP in your Downloads ' +
      'folder → Properties → check "Unblock" → OK, then click Apply again.'
    );

    // Mark the ZIP as used so re-clicking Apply doesn't silently reapply a stale file
    try { fs.renameSync(zipPath, zipPath + '.applied'); } catch {}

    setTimeout(() => process.exit(0), 1500);
    res.render('admin/update-applying', { title: 'Applying Update...', flash: null });

  } catch (e) {
    console.error('[update/apply-local] failed:', e);
    setFlash(req, 'error', `Update failed: ${e.message}`);
    res.redirect('/admin/update');
  }
});

// GET /admin/update/download-link  — redirects to the GitHub branch ZIP so the
// browser downloads it directly (bypasses Node's outbound HTTPS entirely)
router.get('/download-link', requireRole('admin'), (req, res) => {
  res.redirect(BRANCH_ZIP_URL);
});

module.exports = router;
