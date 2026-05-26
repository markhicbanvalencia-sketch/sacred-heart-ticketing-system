/**
 * seed.js — optional: load demo tickets and a sample project
 * Run with: npm run seed
 */
const db = require('../src/db/database');

async function main() {
  await db.init();

  const userId   = db.prepare("SELECT id FROM users WHERE username = ?").get('user').id;
  const itId     = db.prepare("SELECT id FROM users WHERE username = ?").get('itstaff').id;
  const adminId  = db.prepare("SELECT id FROM users WHERE username = ?").get('admin').id;
  const opsDept  = db.prepare("SELECT id FROM departments WHERE name = ?").get('Operations').id;
  const misDept  = db.prepare("SELECT id FROM departments WHERE name = ?").get('MIS / IT').id;
  const catHW    = db.prepare("SELECT id FROM ticket_categories WHERE name = ?").get('Hardware').id;
  const catSW    = db.prepare("SELECT id FROM ticket_categories WHERE name = ?").get('Software').id;
  const catNet   = db.prepare("SELECT id FROM ticket_categories WHERE name = ?").get('Network / Internet').id;

  const padNum   = (n) => String(n).padStart(5, '0');
  const tktNum   = (n) => `TKT-${new Date().getFullYear()}-${padNum(n)}`;

  const ins = db.prepare(`INSERT INTO tickets
    (ticket_number,title,description,category_id,department_id,requester_id,assigned_to,priority,status)
    VALUES (?,?,?,?,?,?,?,?,?)`);

  const samples = [
    [tktNum(1001), 'Printer not printing', 'The HP printer in Operations stopped responding this morning.', catHW, opsDept, userId, itId, 'High', 'In Progress'],
    [tktNum(1002), 'Cannot login to ERP',   'Getting "invalid credentials" but my password is correct.',     catSW, opsDept, userId, itId, 'Urgent', 'Open'],
    [tktNum(1003), 'Slow internet',         'Internet has been crawling since 9 AM in our area.',             catNet, opsDept, userId, null, 'Medium', 'New'],
    [tktNum(1004), 'Outlook crashing',      'Outlook freezes whenever I open large emails.',                  catSW, opsDept, userId, itId, 'Medium', 'Resolved'],
    [tktNum(1005), 'New monitor request',   'Requesting a second monitor for productivity.',                  catHW, opsDept, userId, null, 'Low', 'Pending'],
  ];

  const tx = db.transaction(() => {
    for (const t of samples) ins.run(...t);
  });
  tx();

  // Add a sample project
  const proj = db.prepare(`INSERT INTO projects
    (name,description,department_id,owner_id,start_date,target_date,status,priority,progress,remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    'Office Network Upgrade',
    'Upgrade switches, replace aging access points, and implement VLAN segmentation.',
    misDept, adminId, '2026-05-01', '2026-07-15', 'Ongoing', 'High', 35,
    'Waiting on switch delivery.'
  );

  const insTask = db.prepare(`INSERT INTO project_tasks
    (project_id,title,description,assigned_to,status,due_date)
    VALUES (?,?,?,?,?,?)`);
  insTask.run(proj.lastInsertRowid, 'Site survey',          'Walk every floor, document drops',  itId,    'Completed',  '2026-05-10');
  insTask.run(proj.lastInsertRowid, 'Order switches',       'Procurement to issue PO',           adminId, 'Completed',  '2026-05-15');
  insTask.run(proj.lastInsertRowid, 'Configure VLANs',      'Lab test config before rollout',    itId,    'In Progress','2026-06-05');
  insTask.run(proj.lastInsertRowid, 'Rollout & cutover',    'Phased per floor on weekends',      itId,    'Pending',    '2026-07-05');
  insTask.run(proj.lastInsertRowid, 'Post-rollout review',  'Document, train, hand off',         adminId, 'Pending',    '2026-07-15');

  db.prepare('INSERT OR IGNORE INTO project_members (project_id,user_id,role_in_project) VALUES (?,?,?)')
    .run(proj.lastInsertRowid, itId, 'Lead Engineer');

  console.log('Demo data inserted.');
  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
