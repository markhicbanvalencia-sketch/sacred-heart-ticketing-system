const express = require('express');
const db = require('../db/database');
const { requireLogin, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, requireRole('admin', 'it_staff'), (req, res) => {
  const notifs = db.prepare(`
    SELECT n.*, t.ticket_number, t.title AS ticket_title, t.status AS ticket_status,
           t.assigned_to, au.full_name AS assignee_name
    FROM notifications n
    JOIN tickets t ON t.id = n.ticket_id
    LEFT JOIN users au ON au.id = t.assigned_to
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 60
  `).all(req.user.id);

  // Mark all as read when the page is opened
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);

  res.render('notifications/list', { title: 'Notifications', notifs });
});

module.exports = router;
