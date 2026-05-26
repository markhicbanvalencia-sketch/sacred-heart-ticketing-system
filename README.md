# MIS Ticketing System

A fully local IT ticketing and project monitoring system for MIS / IT departments.
Runs on a single Windows PC or office server, no internet required, no cloud dependencies.

## What's inside

- Role-based access: **Admin**, **IT Staff**, and **Regular User**
- Ticketing with categories, priorities, statuses, comments, attachments, and activity log
- Project monitoring with tasks, members, progress, and timeline
- Dashboards tailored per role, with Chart.js visualizations
- CSV export and printable ticket reports
- Audit log of every meaningful action
- Light + dark theme, mobile-friendly

## Tech stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 18+ |
| Web framework | Express 4 |
| Templating | EJS (server-rendered, no build step) |
| Database | SQLite via `better-sqlite3` (single file: `data/app.db`) |
| Sessions | `express-session` + `connect-sqlite3` (also a single file) |
| Auth | Local accounts, bcrypt password hashing |
| Charts | Chart.js loaded from CDN |

Everything runs in one Node process. No external services needed.

---

## Installation (Windows)

### 1. Install Node.js

Download and install **Node.js 18 LTS or newer** from <https://nodejs.org>.
After install, open Command Prompt and verify:

```
node -v
npm -v
```

### 2. Get the application files

Place this `Ticketing System MIS` folder on the PC that will act as your server (could be your own PC).

### 3. Install dependencies

Open Command Prompt in this folder and run:

```
npm install
```

(This may take 1–3 minutes the first time. It downloads packages into `node_modules/`.)

### 4. Initialize the database

```
npm run init-db
```

This creates `data/app.db` and the three default accounts:

| Username | Password | Role |
|---|---|---|
| `admin`   | `admin123` | Administrator |
| `itstaff` | `it123`    | IT Staff |
| `user`    | `user123`  | Regular User |

**⚠ Change these passwords immediately after first login** (My Account → Change Password).

### 5. (Optional) Load demo data

```
npm run seed
```

Loads 5 sample tickets and 1 sample project so dashboards aren't empty.

### 6. Start the server

```
npm start
```

You'll see something like:

```
==================================================
  MIS Ticketing System started
==================================================
  Local:    http://localhost:3000
  Network:  http://192.168.1.42:3000

  Default logins:
    admin   / admin123
    itstaff / it123
    user    / user123
==================================================
```

Open the **Network** URL on any PC on the same office LAN to log in.

---

## Letting other office PCs access the system

1. Find the server PC's local IPv4 address — the **start command prints it**, or run `ipconfig` and look for `IPv4 Address` under your active adapter (usually `192.168.x.x`).
2. From any other PC on the same office network, open a browser to:

   ```
   http://<server-ip>:3000
   ```

3. **Allow inbound traffic through Windows Firewall** (only needs to be done once on the server PC):
   - Open *Windows Defender Firewall with Advanced Security*
   - **Inbound Rules → New Rule…**
   - Rule type: **Port** → TCP → **Specific local ports: 3000** → Allow → Apply to *Private* (office network) → Name it "MIS Ticketing"

That's it — other PCs can now reach the app.

---

## Run it on boot (production)

Two easy options on Windows:

### Option A — `start.bat` shortcut in Startup folder

Use the included `start.bat` (double-click to launch). Put a shortcut to it in:
`C:\Users\<your-user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`

### Option B — install as a Windows service (recommended for shared server)

Use [NSSM](https://nssm.cc/) (Non-Sucking Service Manager):

```
nssm install MISTicketing "C:\Program Files\nodejs\node.exe" "C:\path\to\Ticketing System MIS\src\server.js"
nssm set MISTicketing AppDirectory "C:\path\to\Ticketing System MIS"
nssm set MISTicketing Start SERVICE_AUTO_START
nssm start MISTicketing
```

The service will now restart automatically if the PC reboots.

---

## Backup & restore

### Backup

Just back up these two things:

- `data/app.db`  ← the entire database (users, tickets, projects, comments)
- `uploads/`     ← uploaded attachments

You can run the included helper:

```
npm run backup
```

This copies both into `backups/<timestamp>/`. Schedule it daily via Windows Task Scheduler:

1. Open Task Scheduler → *Create Basic Task*
2. Trigger: Daily, 11 PM (or whenever)
3. Action: *Start a program* → `npm`, arguments `run backup`, start in: this folder

### Restore

Stop the server, then copy `app.db` and `uploads/` back over the live files. Start the server.

---

## Folder layout

```
Ticketing System MIS/
├── data/                # SQLite database lives here (created on init-db)
│   ├── app.db
│   └── sessions.db
├── uploads/             # Ticket file attachments
├── backups/             # Created by `npm run backup`
├── public/              # Static CSS / JS / images
│   ├── css/app.css
│   └── js/app.js
├── views/               # EJS templates (UI)
│   ├── partials/        # head, sidebar, topbar, flash, badges
│   ├── auth/
│   ├── user/
│   ├── it/
│   ├── admin/
│   ├── tickets/
│   ├── projects/
│   └── error.ejs
├── src/
│   ├── server.js        # Entry point
│   ├── db/database.js   # SQLite connection (singleton)
│   ├── middleware/auth.js
│   ├── utils/helpers.js
│   └── routes/          # auth / dashboard / tickets / projects / admin / reports
├── scripts/
│   ├── init-db.js       # Create tables + default accounts
│   ├── seed.js          # Load demo tickets & project
│   └── backup.js        # Snapshot data/ and uploads/ into backups/
├── start.bat            # Windows: double-click to start the server
├── package.json
└── README.md            # this file
```

---

## Common npm commands

| Command | What it does |
|---|---|
| `npm install`   | Install dependencies (first time, or after pulling updates) |
| `npm run init-db` | Create the database (safe to re-run) |
| `npm run seed`  | Load demo tickets and a sample project |
| `npm start`     | Start the server on port 3000 |
| `npm run dev`   | Same as `npm start`, but restarts on file changes (development) |
| `npm run backup` | Snapshot the database + uploads into `backups/<timestamp>/` |

---

## Security checklist (after install)

- [ ] Change all 3 default passwords
- [ ] Open Admin → Settings, set your organization name and ticket prefix
- [ ] Add real users in Admin → Users, deactivate the demo `user` account
- [ ] Schedule daily `npm run backup` in Task Scheduler
- [ ] In production, replace the default `SESSION_SECRET` by setting an env var before starting:

  ```
  set SESSION_SECRET=any-long-random-string
  npm start
  ```

- [ ] Restrict Windows Firewall rule to Private networks only

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm install` fails on `better-sqlite3` | Install Visual Studio Build Tools (C++) once — `npm install --global windows-build-tools` (run as admin) on older Windows; on Windows 10/11 the prebuilt binary should "just work" |
| "Port 3000 already in use" | Change the port: `set PORT=4000 && npm start` |
| Can't access from another PC | Confirm both PCs are on the same network, then check Windows Firewall inbound rule for port 3000 |
| Forgot admin password | Delete the user row from `data/app.db` (use any SQLite viewer such as DB Browser for SQLite) and re-run `npm run init-db` to recreate the default `admin` account |
| Database is locked | You only ran `init-db` while the server was running — stop the server, then re-run |

---

## Extending the system

This is a clean Express + EJS app — extending it is straightforward:

- **Add a route**: drop a new file in `src/routes/` and `app.use()` it in `src/server.js`
- **Add a page**: create a `.ejs` file in `views/`, include the header/footer partials
- **Add a DB column**: edit `scripts/init-db.js` to add the column, then either delete `data/app.db` and re-run, or write a manual `ALTER TABLE` migration
- **Change branding**: Admin → Settings → Site name / Organization, or edit `views/partials/sidebar.ejs`
- **Email notifications**: add `nodemailer` to `package.json`, configure an SMTP server (an office Exchange relay works fine), then hook into `logActivity()` in `src/utils/helpers.js`

Enjoy! 🎫
