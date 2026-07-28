// Called by the installer to record the installed version in data/version.json
const fs   = require('fs');
const path = require('path');

// Find the project root by walking up from this script looking for package.json.
// Handles both layouts:
//   installed (flattened by Inno Setup): {app}/scripts/write-version.js -> {app}
//   dev source tree:                     installer/scripts/write-version.js -> project root
function findAppDir(startDir) {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate project root (no package.json found above ' + startDir + ')');
}

const appDir  = findAppDir(__dirname);
const dataDir = path.join(appDir, 'data');
const verFile = path.join(dataDir, 'version.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Try to read SHA from .git if present (won't exist in installed copy, that's fine)
let sha = 'INSTALLER_BUILD';
try {
  const head = fs.readFileSync(path.join(appDir, '.git', 'refs', 'heads', 'main'), 'utf8').trim();
  if (head && head.length === 40) sha = head;
} catch {}

fs.writeFileSync(verFile, JSON.stringify({
  sha,
  version:    '1.0',
  updated_at: new Date().toISOString(),
}, null, 2));

console.log('Version info written:', sha.slice(0, 7));
