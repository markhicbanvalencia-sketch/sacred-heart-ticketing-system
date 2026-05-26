# System Architecture

## 1. High-level diagram

```
┌──────────────────────────────────────────────────┐
│           Office LAN (no internet needed)        │
│                                                  │
│   ┌────────┐    HTTP     ┌────────────────────┐  │
│   │ User PC├────────────►│  Server PC         │  │
│   └────────┘   :3000     │                    │  │
│   ┌────────┐             │  ┌──────────────┐  │  │
│   │ IT PC  ├────────────►│  │ Node/Express │  │  │
│   └────────┘             │  │   + EJS      │  │  │
│   ┌────────┐             │  └──────┬───────┘  │  │
│   │Admin PC├────────────►│         │          │  │
│   └────────┘             │  ┌──────▼───────┐  │  │
│                          │  │  SQLite      │  │  │
│                          │  │  data/app.db │  │  │
│                          │  └──────────────┘  │  │
│                          │  ┌──────────────┐  │  │
│                          │  │  uploads/    │  │  │
│                          │  └──────────────┘  │  │
│                          └────────────────────┘  │
└──────────────────────────────────────────────────┘
```

A single Node.js process serves the entire app. All data (database + sessions + uploaded files) lives on disk in the project folder. Backup is just copying two paths.

## 2. Request lifecycle

```
Browser
  │
  ▼
Express
  │  1. session middleware (express-session, SQLite-backed)
  │  2. loadUser (looks up req.session.userId, attaches req.user)
  │  3. route handler:
  │       requireLogin → requireRole(...) → business logic → render EJS
  ▼
EJS view → HTML → Browser
```

## 3. Database schema

```
roles (id, name, description)
  └─◇ users (id, username, password_hash, full_name, email, role_id*, department_id, is_active)
                          │
                          ├─◇ tickets (requester_id, assigned_to)
                          ├─◇ ticket_comments (user_id)
                          ├─◇ ticket_attachments (uploaded_by)
                          ├─◇ ticket_activity_log (user_id)
                          ├─◇ projects (owner_id)
                          ├─◇ project_tasks (assigned_to)
                          ├─◇ project_members (user_id)
                          └─◇ audit_log (user_id)

departments (id, name, description)
  └─◇ users, tickets, projects

ticket_categories (id, name, description, is_active)
  └─◇ tickets

tickets (id, ticket_number, title, description, category_id, department_id,
         requester_id, assigned_to, priority, status, due_date,
         created_at, updated_at, resolved_at, closed_at)
  ├─◇ ticket_comments (ticket_id, user_id, body, is_internal, created_at)
  ├─◇ ticket_attachments (ticket_id, uploaded_by, original_name, stored_name, mime_type, size_bytes)
  └─◇ ticket_activity_log (ticket_id, user_id, action, detail, created_at)

projects (id, name, description, department_id, owner_id, start_date, target_date,
          status, priority, progress, remarks, created_at, updated_at)
  ├─◇ project_tasks (project_id, title, description, assigned_to, status, due_date, completed_at)
  └─◇ project_members (project_id, user_id, role_in_project)

settings (key, value)
audit_log (id, user_id, action, detail, ip, created_at)
```

All foreign keys enforced (`PRAGMA foreign_keys = ON`). Indexes on `tickets.status`, `tickets.requester_id`, `tickets.assigned_to`.

## 4. Routes (URL → handler → view)

### Public
| Method | Path | View | Purpose |
|---|---|---|---|
| GET   | `/login`              | `auth/login`     | Login page |
| POST  | `/login`              | redirect         | Authenticate |
| POST  | `/logout`             | redirect         | Sign out |

### Authenticated (all roles)
| Method | Path | View | Purpose |
|---|---|---|---|
| GET   | `/`                   | redirect         | Role-aware: → /dashboard/me, /dashboard/it, or /dashboard/admin |
| GET   | `/dashboard/me`       | `user/dashboard` | Regular-user dashboard |
| GET   | `/account`            | `auth/account`   | Profile + change password |
| POST  | `/account/password`   | re-render        | Change password |
| GET   | `/tickets`            | `tickets/list`   | List (filtered for role) |
| GET   | `/tickets/new`        | `tickets/new`    | Submit form |
| POST  | `/tickets`            | redirect         | Create ticket + upload attachments |
| GET   | `/tickets/:id`        | `tickets/view`   | Ticket detail |
| POST  | `/tickets/:id/comments`     | redirect    | Add comment / internal note |
| POST  | `/tickets/:id/update`       | redirect    | Update status / priority / assignment |
| POST  | `/tickets/:id/attachments`  | redirect    | Add more files |
| GET   | `/tickets/:id/attachments/:aid` | download | Download an attachment |
| GET   | `/tickets/:id/print`        | `tickets/print` | Printable view |
| GET   | `/projects`           | `projects/list`  | List (role-scoped) |
| GET   | `/projects/:id`       | `projects/view`  | Project detail |

### IT staff + Admin
| Method | Path | View | Purpose |
|---|---|---|---|
| GET   | `/dashboard/it`       | `it/dashboard`   | IT operations dashboard |
| GET   | `/projects/new`       | `projects/new`   | New project form |
| POST  | `/projects`           | redirect         | Create project |
| POST  | `/projects/:id/update`      | redirect    | Edit project |
| POST  | `/projects/:id/tasks`       | redirect    | Add task |
| POST  | `/projects/:id/tasks/:taskId/update` | redirect | Edit task |
| POST  | `/projects/:id/tasks/:taskId/delete` | redirect | Delete task |
| POST  | `/projects/:id/members`     | redirect    | Add member |
| POST  | `/projects/:id/members/:mid/delete` | redirect | Remove member |
| GET   | `/reports`            | `admin/reports`  | Full reports + charts |
| GET   | `/tickets/export/csv` | CSV download     | Export all tickets |

### Admin only
| Method | Path | View | Purpose |
|---|---|---|---|
| GET   | `/dashboard/admin`    | `admin/dashboard`   | Admin overview |
| GET   | `/admin/users`        | `admin/users`       | Manage users |
| POST  | `/admin/users`        | redirect            | Create user |
| POST  | `/admin/users/:id/update` | redirect        | Edit user / reset password |
| POST  | `/admin/users/:id/delete` | redirect        | Deactivate user |
| GET   | `/admin/departments`  | `admin/departments` | Manage depts |
| POST  | `/admin/departments` and `/admin/departments/:id/*` | redirect | CRUD |
| GET   | `/admin/categories`   | `admin/categories`  | Manage ticket categories |
| POST  | `/admin/categories` and `/admin/categories/:id/*` | redirect | CRUD |
| GET   | `/admin/settings`     | `admin/settings`    | Site name, org name, ticket prefix, SLA |
| POST  | `/admin/settings`     | redirect            | Save settings |
| GET   | `/admin/audit`        | `admin/audit`       | Audit log (last 500) |
| POST  | `/projects/:id/delete`| redirect            | Delete project |

## 5. User flow

**New ticket (regular user)**
1. User logs in → lands on `/dashboard/me`
2. Clicks "＋ New Ticket" → fills form → submits with optional attachments
3. Sees confirmation toast and is redirected to ticket detail page
4. Receives status updates by checking dashboard or ticket page
5. When status becomes "Resolved", a "Confirm Resolved & Close" button appears
6. User can also reopen if not satisfied

**Handling tickets (IT staff)**
1. Logs in → lands on `/dashboard/it` showing queue + workload + charts
2. Clicks a ticket from the active queue → ticket detail page
3. In sidebar: updates status / priority / assignment → saves
4. Adds public comment to communicate with user, or internal note for team
5. Marks resolved when fixed; activity log captures every change

**Admin daily ops**
1. `/dashboard/admin` for stats + aging tickets
2. `/admin/users` to add a new hire / reset a password
3. `/reports` for charts and CSV export
4. `/admin/audit` to see who did what

## 6. Security model

| Concern | Mitigation |
|---|---|
| Password storage | bcrypt with salt rounds = 10 |
| Sessions | HTTP-only cookie, server-side session in SQLite, 8-hour expiry |
| RBAC | `requireRole('admin')` / `requireRole('admin','it_staff')` middlewares on every protected route |
| Ticket visibility | Regular users can only see their own tickets (enforced in SQL `WHERE` clause AND `canViewTicket()` guard) |
| File uploads | 10 MB per file, max 5 files, MIME-type allowlist (images, PDF, Office docs, ZIP) |
| Input sanitation | EJS auto-escapes `<%= %>`; SQL uses prepared statements throughout |
| CSRF | LAN-only deployment + session cookie; can be hardened with `csurf` if exposed wider |
| Audit | Every login, password change, user/ticket CUD and admin action logged with IP |

## 7. Configuration

Environment variables (set in shell or systemd/nssm service file):

| Var | Default | Purpose |
|---|---|---|
| `PORT`            | `3000`        | TCP port to listen on |
| `HOST`            | `0.0.0.0`     | Bind address (`0.0.0.0` = all interfaces) |
| `SESSION_SECRET`  | placeholder   | **Change in production** to a long random string |
| `NODE_ENV`        | unset         | Set to `production` to hide stack traces in error pages |

Admin-managed settings (in DB, via `/admin/settings`):
`site_name`, `organization_name`, `ticket_prefix`, `default_sla_hours`.

## 8. Why this stack

- **Single Node process** — easy to start, monitor, and back up; one log to read.
- **SQLite** — no separate DB server; the entire dataset is one file you can copy. Handles thousands of tickets and dozens of concurrent users on cheap hardware. If you outgrow it, the schema ports directly to PostgreSQL.
- **EJS server-rendering** — no webpack, no build step, no `npm run build` to worry about. Source view = what runs.
- **better-sqlite3 (synchronous API)** — fewer footguns than async drivers; transactions are trivial; performance is excellent for this workload.
- **Sessions in SQLite** — survives restarts, no need for Redis.
- **Chart.js via CDN** — interactive dashboards with zero local dependencies (you can swap to a local copy in `public/js/` if you want fully offline).

## 9. Migration path if the team grows

When/if you outgrow this:

| Pain point | Upgrade |
|---|---|
| Many concurrent writers | Migrate `data/app.db` → PostgreSQL (schema is portable; replace `better-sqlite3` with `pg`) |
| Need email/SMS notifications | Add `nodemailer`; trigger from `logActivity()` |
| Need an API for mobile apps | The current routes already use clean params — add `Accept: application/json` branches |
| Want real-time updates | Add `socket.io` and broadcast on ticket changes |
| Multi-office deployment | Front the server with nginx + HTTPS, keep Node + SQLite as-is initially |
