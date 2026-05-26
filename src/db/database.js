const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');

let _raw = null;
let _saveTimer = null;

function save() {
  if (!_raw) return;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(_raw.export()));
}

function scheduleSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(save, 100);
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
    const stmt = _raw.prepare(this._sql);
    try {
      if (params !== null) stmt.bind(params);
      stmt.step();
    } finally {
      stmt.free();
    }
    const changes = _raw.getRowsModified();
    const s2 = _raw.prepare('SELECT last_insert_rowid()');
    try {
      s2.step();
      const lastInsertRowid = s2.get()[0] ?? 0;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      s2.free();
    }
  }

  get(...args) {
    const params = toSqlJsParams(args);
    const stmt = _raw.prepare(this._sql);
    try {
      if (params !== null) stmt.bind(params);
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...args) {
    const params = toSqlJsParams(args);
    const stmt = _raw.prepare(this._sql);
    try {
      if (params !== null) stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }
}

const db = {
  prepare(sql) {
    return new Statement(sql);
  },

  exec(sql) {
    _raw.run(sql);
    scheduleSave();
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
        save();
      } catch (e) {
        try { _raw.run('ROLLBACK'); } catch {}
        throw e;
      }
    };
  },

  close() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    save();
    if (_raw) { _raw.close(); _raw = null; }
  },
};

async function init() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const fileData = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _raw = fileData ? new SQL.Database(fileData) : new SQL.Database();
  _raw.run('PRAGMA foreign_keys = ON');
  return db;
}

db.init = init;
module.exports = db;
