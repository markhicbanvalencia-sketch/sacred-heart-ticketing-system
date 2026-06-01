const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');

let _raw         = null;
let _saveTimer   = null;
let _saving      = false;
let _lastSaveAt  = 0;
const _stmtCache     = new Map();
let   _lastRowIdStmt = null;

function save() {
  if (!_raw || _saving) return;
  // Skip if we saved less than 4.5 s ago — prevents back-to-back exports
  const now = Date.now();
  if (now - _lastSaveAt < 4500) return;
  _saving     = true;
  _lastSaveAt = now;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // sql.js export() frees ALL open prepared statements — clear cache first
  _stmtCache.clear();
  _lastRowIdStmt = null;
  const data = Buffer.from(_raw.export()); // WASM copy — must be sync
  fs.writeFile(DB_PATH, data, err => {     // disk write is async — never blocks requests
    if (err) console.error('[db] save failed:', err);
    _saving = false;
  });
}

// Synchronous save used only on shutdown
function saveSync() {
  if (!_raw) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _stmtCache.clear();
  _lastRowIdStmt = null;
  try { fs.writeFileSync(DB_PATH, Buffer.from(_raw.export())); } catch {}
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(save, 5000);
}

// Return a cached compiled statement; reset it so it's ready for new params
function _getCached(sql) {
  if (!_stmtCache.has(sql)) {
    _stmtCache.set(sql, _raw.prepare(sql));
  }
  const stmt = _stmtCache.get(sql);
  stmt.reset();
  return stmt;
}

function toSqlJsParams(args) {
  if (args.length === 0) return null;
  if (args.length === 1) {
    if (Array.isArray(args[0])) return args[0];
    if (args[0] === null || args[0] === undefined) return null;
    if (typeof args[0] === 'object') {
      // Convert {key: val} to {$key: val} for sql.js named params
      const out = {};
      for (const [k, v] of Object.entries(args[0])) {
        const key = (k[0] === '$' || k[0] === ':' || k[0] === '@') ? k : `$${k}`;
        out[key] = v;
      }
      return out;
    }
    return [args[0]];
  }
  return args;
}

class Statement {
  constructor(sql) {
    this._sql = sql;
  }

  run(...args) {
    const params = toSqlJsParams(args);
    const stmt = _getCached(this._sql);
    if (params !== null) stmt.bind(params);
    stmt.step();
    const changes = _raw.getRowsModified();
    // Reuse the last_insert_rowid statement too
    if (!_lastRowIdStmt) _lastRowIdStmt = _raw.prepare('SELECT last_insert_rowid()');
    _lastRowIdStmt.reset();
    _lastRowIdStmt.step();
    const lastInsertRowid = _lastRowIdStmt.get()[0] ?? 0;
    scheduleSave();
    return { changes, lastInsertRowid };
  }

  get(...args) {
    const params = toSqlJsParams(args);
    const stmt = _getCached(this._sql);
    if (params !== null) stmt.bind(params);
    if (stmt.step()) return stmt.getAsObject();
    return undefined;
  }

  all(...args) {
    const params = toSqlJsParams(args);
    const stmt = _getCached(this._sql);
    if (params !== null) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  }
}

const db = {
  prepare(sql) {
    return new Statement(sql);
  },

  exec(sql) {
    _raw.run(sql);
    // No scheduleSave here — exec() is only used for startup DDL (CREATE TABLE,
    // ALTER TABLE, CREATE INDEX). Those changes are captured by the first
    // real write that follows, not here.
    return this;
  },

  pragma(str) {
    try { _raw.run(`PRAGMA ${str}`); } catch {}
    return this;
  },

  transaction(fn) {
    return (...args) => {
      _raw.run('BEGIN');
      try {
        fn(...args);
        _raw.run('COMMIT');
        scheduleSave(); // debounced async — never blocks
      } catch (e) {
        try { _raw.run('ROLLBACK'); } catch {}
        throw e;
      }
    };
  },

  close() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    saveSync(); // synchronous only on shutdown
    _stmtCache.clear();
    _lastRowIdStmt = null;
    if (_raw) { _raw.close(); _raw = null; }
  },
};

async function init() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const fileData = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _stmtCache.clear();
  _lastRowIdStmt = null;
  _raw = fileData ? new SQL.Database(fileData) : new SQL.Database();
  _raw.run('PRAGMA foreign_keys = ON');
  return db;
}

db.init         = init;
db.scheduleSave = scheduleSave; // exposed so server.js can trigger the startup DDL save
module.exports  = db;
