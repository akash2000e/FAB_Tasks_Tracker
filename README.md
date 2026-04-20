# FAB LAB Tasks Tracker

A two-page web app for tracking team tasks at FAB LAB. Built with vanilla HTML/CSS/JS and Firebase — no build step, deployable on GitHub Pages.

---

## Pages

| Page | URL | Purpose |
|------|-----|---------|
| `index.html` | `/` | TV dashboard — read-only Gantt chart + team carousel, auto-refreshes |
| `user.html` | `/user.html` | Task management — add, edit, complete, and delete tasks |

---

## Architecture

- **Backend:** Firebase Firestore (database) + Firebase Auth (authentication)
- **Frontend:** Vanilla JS, no frameworks, no build step
- **Hosting:** GitHub Pages (static)
- **Gantt chart:** [Frappe Gantt](https://frappe.io/gantt) via CDN

### Key files

```
FAB_Tasks_Tracker/
├── index.html              # TV dashboard
├── user.html               # User task page
├── assets/
│   ├── css/style.css       # Dark theme styles
│   └── js/
│       ├── config.js       # Firebase project config
│       ├── db.js           # Firestore read/write helpers
│       ├── auth.js         # Firebase Auth logic
│       ├── dashboard.js    # Gantt rendering + view cycling
│       └── user.js         # Task form + CRUD operations
└── README.md
```

---

## Setup

### 1. Firebase project

1. Go to [Firebase Console](https://console.firebase.google.com) and create a project.
2. Enable **Firestore** (production mode).
3. Enable **Authentication** → Email/Password provider.
4. Register a Web app and copy the config values into `assets/js/config.js`:

```js
const FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

### 2. Firestore collections

The app uses these top-level collections:

| Collection | Description |
|------------|-------------|
| `tasks` | All tasks |
| `members` | Team member profiles (name, role, color, photo) |
| `users` | User accounts linked to team members |
| `projects` | Project names for the task form autocomplete |

### 3. First-time login

On first visit to `user.html`, if no accounts exist the app shows a **Create Admin Account** form. Fill in username, display name, and password — this becomes the first admin.

Admins can manage team members, user accounts, and projects from the **Settings** tab.

---

## Features

### Dashboard (`index.html`)
- Gantt chart with dependency arrows (colored by assignee)
- Cycles between views: Timeline → Team → Completed This Week → Needs Attention
- Progress bar showing time until next view rotation
- Live clock + sync status indicator
- Auto-refreshes from Firestore in real time

### User page (`user.html`)
- Sign in with username + password
- **My Tasks** tab — your active tasks with Start / Done / Edit / Delete actions
- **All Tasks** tab — read-only view of the full team's tasks
- **Settings** tab (admins only) — manage members, users, and projects
- Add/edit task modal with: name, project, assignee, dates, priority, dependencies, notes
- Dependency picker with cycle detection
- Photo upload for team member profiles (cropped to square)

### Task statuses
| Status | Meaning |
|--------|---------|
| `not_started` | Created, not yet started |
| `in_progress` | Actively being worked on |
| `completed` | Done |
| `delayed` | Auto-computed: end date passed and not completed |
| `blocked` | Auto-computed: incomplete dependencies exist |

---

## Deploying to GitHub Pages

1. Push the repo to GitHub.
2. Go to **Settings → Pages → Source**: deploy from branch `main`, folder `/ (root)`.
3. Your site will be live at `https://<username>.github.io/<repo-name>/`.
4. Open `index.html` on the TV browser, `user.html` on team laptops.

---

## TV setup (recommended)

- **Raspberry Pi 4** running Chromium in kiosk mode — best option for a permanent display.
- Open `index.html` in fullscreen; the page requests `wakeLock` to prevent sleep.
- The dashboard hides the cursor automatically.

---

## Security notes

- Firebase Auth handles all authentication — no PATs or shared passwords stored in the repo.
- Firestore security rules should restrict writes to authenticated users only.
- The `config.js` Firebase API key is safe to commit — it's a public identifier, access is controlled by Firestore rules and Auth, not the key itself.
- Passwords are managed per-user through **Settings → User Accounts**.
