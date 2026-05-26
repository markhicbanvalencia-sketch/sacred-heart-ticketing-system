const express = require('express');
const db = require('../db/database');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

// userId -> { resSet: Set<res>, role: string }
const clients = new Map();

function pushToUser(userId, data) {
  const client = clients.get(userId);
  if (!client) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of client.resSet) { try { res.write(msg); } catch {} }
}

function pushToStaff(data) {
  for (const [, client] of clients) {
    if (['admin', 'it_staff'].includes(client.role)) {
      const msg = `data: ${JSON.stringify(data)}\n\n`;
      for (const res of client.resSet) { try { res.write(msg); } catch {} }
    }
  }
}

function pushToAll(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of clients) {
    for (const res of client.resSet) { try { res.write(msg); } catch {} }
  }
}

router.get('/', requireLogin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const userId = req.user.id;
  if (!clients.has(userId)) clients.set(userId, { resSet: new Set(), role: req.user.role });
  clients.get(userId).resSet.add(res);

  // Send initial notification count for staff
  if (['admin', 'it_staff'].includes(req.user.role)) {
    try {
      const c = db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND is_read = 0").get(userId).c;
      res.write(`data: ${JSON.stringify({ type: 'init', notifCount: c })}\n\n`);
    } catch {}
  }

  // Heartbeat to keep connection alive through proxies/firewalls
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const client = clients.get(userId);
    if (client) {
      client.resSet.delete(res);
      if (client.resSet.size === 0) clients.delete(userId);
    }
  });
});

module.exports = { router, pushToUser, pushToStaff, pushToAll };
