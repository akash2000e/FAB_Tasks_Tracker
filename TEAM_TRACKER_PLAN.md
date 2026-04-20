# Team Progress Tracker — Build Plan

A two-page web app hosted on GitHub Pages that tracks team tasks. One page is a **read-only TV dashboard** (Gantt chart + team member carousel). The other is a **user page** where team members add/update/close tasks from their laptops, with changes auto-pushed to the GitHub repo (no cloning needed).

---

## 1. Core Architecture Decision (read this first)

You said the key constraint is: **updates from the user page must auto-push to the GitHub repo without cloning.** This is the single most important design decision in the whole project, so let's be clear about the trade-offs before writing any code.

### The options

**Option A — GitHub API directly from the browser (simplest, recommended for your use case)**
- The user page calls the GitHub REST API from JavaScript to update a `tasks.json` file in your repo.
- A fine-grained Personal Access Token (PAT) with write access is used to authenticate.
- The TV dashboard reads `tasks.json` from the repo (via raw.githubusercontent.com or the GitHub API) and refreshes every 30–60 seconds.
- **Pros:** No server, no cloning, no build step, works on GitHub Pages free tier, exactly what you asked for.
- **Cons:** The PAT has to live somewhere the browser can read it. If you commit it to the repo, anyone can steal it and wipe your tasks. **This is the issue we have to solve.**

**Option B — GitHub Actions + Issues/Discussions as the database**
- Users submit tasks via a form that creates a GitHub Issue with a structured body.
- A GitHub Action parses the issue and updates `tasks.json`, then commits it.
- **Pros:** No token in the browser at all.
- **Cons:** Every team member needs a GitHub account and must be a collaborator. Slower (Actions take 10–30s to run). More moving parts.

**Option C — Tiny backend (Cloudflare Worker / Vercel function) that holds the token**
- The browser calls your own endpoint, which holds the token server-side and forwards the commit to GitHub.
- **Pros:** Token is safe. Fast. Clean.
- **Cons:** You now have a backend to deploy and maintain (though Cloudflare Workers free tier is generous).

### Recommendation

**Go with Option A, protected by a shared password gate.** Here's the reasoning: your team is small, the site is internal, and you want simplicity. The risk with Option A is a leaked token. We mitigate it like this:

1. The PAT is **not** committed to the repo. It's stored in browser `localStorage` after the user enters it once on their laptop.
2. The user page has a **password gate** (a shared team password, hashed and compared client-side). First time a user visits, they enter the team password AND paste the PAT. Both get stored locally.
3. The PAT is **fine-grained**: scoped to only your tracker repo, with only `contents:write` permission, and expires every 90 days.
4. If a laptop is lost, you regenerate the PAT on GitHub — all existing copies become useless instantly.

This is a pragmatic security posture for an internal team tool. If the team grows past ~10 people or the data becomes sensitive, migrate to Option C later.

> **⚠️ Important:** Do **not** hardcode the PAT in your HTML/JS files. Do **not** commit it to the repo. Anyone who can read your repo (and the repo must be public for free GitHub Pages, unless you have Pro) will steal it within hours — GitHub scans for leaked tokens automatically and will revoke them, but bots scan faster.

---

## 2. File & Repo Structure

```
team-tracker/
├── index.html              # Dashboard page (the TV screen)
├── user.html               # User page (task entry)
├── assets/
│   ├── css/
│   │   └── style.css       # Shared dark-theme styles
│   ├── js/
│   │   ├── dashboard.js    # Gantt rendering + carousel logic
│   │   ├── user.js         # Task form + GitHub API writes
│   │   ├── github-api.js   # Shared module: read/write tasks.json
│   │   └── auth.js         # Password gate + PAT storage
│   └── img/
│       └── team/           # Team member photos (alice.jpg, etc.)
├── data/
│   ├── tasks.json          # The "database" — list of tasks
│   └── team.json           # Team members, colors, photos
├── .github/
│   └── workflows/
│       └── pages.yml       # (Optional) GitHub Pages deploy action
└── README.md
```

### Why JSON files instead of a database

GitHub Pages is static. You can't run a database on it. `tasks.json` in the repo IS your database — every add/update/close is a commit that modifies this file. Git history gives you a free audit log of every change, which is actually a nice side-effect.

---

## 3. Data Schema

### `data/team.json`
```json
{
  "members": [
    {
      "id": "alice",
      "name": "Alice Kumar",
      "photo": "assets/img/team/alice.jpg",
      "color": "#e63946",
      "role": "Frontend Developer"
    },
    {
      "id": "bob",
      "name": "Bob Menon",
      "photo": "assets/img/team/bob.jpg",
      "color": "#2a9d8f",
      "role": "Embedded Engineer"
    }
  ]
}
```

Each member gets a fixed color. This color is used for their bars in the Gantt chart and their card border in the carousel. Pick distinct colors — I'd recommend picking from a palette like `#e63946`, `#f4a261`, `#e9c46a`, `#2a9d8f`, `#264653`, `#9b5de5`, `#00bbf9`, `#fb6f92`.

### `data/tasks.json`
```json
{
  "tasks": [
    {
      "id": "t_1736000000000",
      "name": "Design landing page mockup",
      "project": "Prompt Packs website",
      "assignee": "alice",
      "startDate": "2026-04-18",
      "endDate": "2026-04-22",
      "status": "in_progress",
      "priority": "medium",
      "dependsOn": ["t_1735900000000"],
      "createdAt": "2026-04-17T09:30:00Z",
      "updatedAt": "2026-04-17T09:30:00Z",
      "completedAt": null,
      "notes": ""
    }
  ],
  "version": 1,
  "lastModified": "2026-04-17T09:30:00Z"
}
```

`status` can be: `not_started`, `in_progress`, `completed`, `delayed`, `blocked`.

**Delayed** is computed automatically: if `endDate < today` and `status !== 'completed'`, treat as delayed. You don't need a user to mark it.

**Blocked** is also computed automatically: if any task in `dependsOn` is not yet `completed`, this task is blocked and can't be started. The UI should prevent clicking "Start" on it and show a tooltip like "Waiting on: Design landing page mockup."

`dependsOn` is an array of task IDs this task depends on. An empty array means no dependencies. Keep it a simple list of IDs — don't try to store dependency *type* (finish-to-start, start-to-start, etc.) like real project management tools do. For a small team, plain "this must finish before that can start" covers 95% of cases and keeps the UI sane.

The `version` field is important — it's used for optimistic concurrency control (see section 6).

---

## 4. Page 1 — Dashboard (index.html)

This is the TV screen. No user interaction. Auto-refreshes data every 60 seconds.

### Cycling views
The dashboard rotates between views every ~20 seconds (configurable). Suggested cycle:

1. **Gantt chart view** (30s) — horizontal timeline of all active tasks, colored by assignee.
2. **Team members view** (15s) — grid of cards, each showing member photo, name, and their current in-progress task(s).
3. **Recently completed view** (10s) — tasks completed in the last 7 days, with a green checkmark.
4. **Delayed / at-risk view** (10s, only shown if there are delayed tasks) — red-flagged tasks past deadline.

A subtle progress bar at the bottom shows how long until the next view.

### Gantt chart implementation
Use **Frappe Gantt** (`frappe-gantt.min.js` from a CDN, ~25KB, MIT licensed). It's a tiny standalone Gantt library — no React, no dependencies, fits your "no-build-step" requirement. Key features you'll use:
- Group/color bars by assignee (custom CSS).
- **Dependency arrows** — Frappe Gantt supports drawing arrows between dependent tasks natively. Pass `dependencies: "t_1735900000000"` on each task and it draws the arrow for you. This is where the dependency feature really pays off visually.
- Today marker line.
- View modes: Day / Week / Month — cycle between these too for variety.

Alternative if you want to hand-roll it: SVG + `<rect>` elements with D3 for scales. More work, more control, but you'll have to draw the dependency arrows yourself — that's non-trivial (routing arrows cleanly around other bars is the annoying part).

### Refresh strategy
Every 60 seconds, fetch `data/tasks.json` via `https://raw.githubusercontent.com/USERNAME/REPO/main/data/tasks.json?t=TIMESTAMP` (the timestamp busts the CDN cache — raw.githubusercontent.com caches for ~5 min otherwise).

If the `lastModified` field changed, re-render. If not, skip the re-render (saves flicker on the TV).

### TV-specific polish
- Hide the cursor: `* { cursor: none; }` on the dashboard body.
- Prevent sleep: use the `navigator.wakeLock` API (works on Chrome/Edge on the TV device).
- Fullscreen on load: trigger `document.documentElement.requestFullscreen()` after first user tap (browsers require a gesture).
- Clock in the corner. Current date. Nice touch: weather if your TV location is fixed.

### Designing for an "always-on" ambient display
Since the TV will be in everyone's peripheral vision all day, the dashboard has to be designed as an **ambient display**, not a normal dashboard. These are genuinely different things:

- A normal dashboard is something you sit down to read.
- An ambient display is something you glance at while walking past.

The design principles flip accordingly:

**1. Glanceability beats density.** If someone looks for 2 seconds, they should walk away knowing one thing: "are we on track today?" Everything else is secondary. Resist the urge to cram in stats — empty space is a feature on a TV, not a bug.

**2. No motion when idle.** This is the big one. A wall-mounted screen with constant animation becomes visual noise that drains the room. Rules to follow:
- Crossfades between views: yes, but slow (800–1200ms, not 400ms).
- Looping animations, pulses, spinners, marquees: no, unless they signal something actionable (e.g. a high-priority delayed task can pulse — but nothing else should).
- The clock should tick in seconds only if it earns it. Honestly, minute precision is enough. A ticking second hand in peripheral vision is mildly annoying over 8 hours.
- When a view is showing, everything on it should be still. Motion should happen only at view transitions.

**3. Burn-in protection.** TVs (especially OLED, but also some LCDs) can burn in static elements after weeks of the same image. Mitigations:
- Cycle views frequently enough (you already are — good).
- Shift the clock position by a few pixels every few minutes (imperceptible to viewers, enough to prevent burn-in).
- Include a daily "rest view" at ~1 AM that's nearly-black with just a small clock. Or just reduce overall brightness between, say, 10pm–7am.
- Avoid pure white backgrounds anywhere. You're already using dark theme — good.

**4. Day/night adaptation.** If the office is occupied 9-to-6, the TV is mostly wasted from 6pm–9am. You could:
- Dim the display automatically after 7pm (apply `filter: brightness(0.4)` via CSS based on `Date().getHours()`).
- Show a "Good morning" / summary-of-yesterday view in the first hour each weekday.
- Or just accept it's on 24/7 and focus on burn-in protection. This is the pragmatic choice.

**5. The "across the room" test.** Before declaring a view done, walk 4–5 meters away from your monitor and look at it. Can you still read the task names? The assignee names? If not, bump font sizes. People underestimate how big TV text needs to be — for a 50-inch TV viewed from 3 meters, body text should be 24–28px minimum, headings 48px+.

**6. Information hierarchy, TV edition.** On a laptop dashboard, everything important is equally legible. On a TV, layer it:
- **Glance layer** (readable from 5m): status headline, task counts, who's delayed. Huge type.
- **Look layer** (readable from 2m): task names, assignees, dates. Medium type.
- **Approach layer** (readable from 0.5m): notes, task IDs, timestamps. Small type, reserved for the curious.

If someone has to walk up to the screen to understand whether the team is on track, the hierarchy is wrong.

**7. No interactive affordances.** The TV isn't interactive — so don't show hover states, buttons, cursors, or anything that implies you can click. Even visual affordances that look clickable are confusing on a screen no one touches. Make the dashboard feel like a poster, not a webpage.

**8. Good-news moments.** This is the underrated part. If the TV only ever shows delays and deadlines, it becomes a stress object and people avoid looking at it. Bake in positive signals:
- "Completed today" view with team member photos and green checkmarks — celebrates progress.
- A "streak" counter: "12 tasks completed this week" with a subtle spark.
- When a task is marked done, the next dashboard cycle briefly shows a "Just completed by [name]" view for 8 seconds.
- Friday afternoon special view: week's wins summary.

The TV should make the team feel good about their work, not just monitored.

**9. Dashboard silent failure mode.** If the GitHub fetch fails (network down, rate limit, repo deleted), the dashboard should show the last-successful data with a small "⚠ Offline — last updated 4 min ago" indicator in a corner. It should NOT show a big error screen or a loading spinner — those look broken on a TV and draw the eye to the wrong thing. Stale data silently is better than broken-looking data loudly.

**10. The TV device choice matters more than you'd think.** A few options ranked:
- **Raspberry Pi 4 in Chromium kiosk mode** — best for you given your maker background. Full control, cheap, reliable. ~15 min of config.
- **Fire TV Stick 4K** — works, Silk browser is okay, but Amazon will occasionally push updates/ads that interrupt the display. Annoying.
- **Chromecast with Google TV** — similar story to Fire TV.
- **An old laptop** — works fine but has a fan, takes desk space, and Windows Update will ambush you.
- **LG/Samsung smart TV's built-in browser** — usually too limited. Skip unless you've verified it supports the APIs you need.

I'd pick the Pi. You've already got the stack (VS Code, you know embedded). An hour of setup, done forever.

---

## 5. Page 2 — User Page (user.html)

### Auth flow (first visit)
1. User sees a password prompt: "Enter team password."
2. On submit, the password is hashed (SHA-256) and compared against a hash stored in a config file. If it matches, show step 2.
3. "Paste your GitHub Personal Access Token." Input is `type="password"`. On submit, store in `localStorage`.
4. From now on, they land directly on the task list.

A "Log out" button clears `localStorage`.

### Main UI
- Header: user picker (dropdown: "I am... Alice / Bob / ..."). This is saved in localStorage so they don't have to re-pick.
- Big **"+ Add New Task"** button (top right).
- Below: a list of **their active tasks**, each with a "Mark Complete" button and an edit pencil.
- Tab/toggle to switch to "All team tasks" (read-only view of everyone's tasks).

### Add Task modal
Fields:
- **Task name** (required, text)
- **Project name** (required, dropdown with autocomplete from existing projects in tasks.json — this is a nice touch that prevents typos like "Prompt Packs" vs "promptpacks")
- **Assignee** (dropdown from team.json, defaults to the logged-in user)
- **Start date** (date picker, defaults to today)
- **End date** (date picker, defaults to start + 3 days)
- **Priority** (high / medium / low — small colored dot shown on the task card)
- **Dependencies** (multi-select dropdown of existing tasks — "This task can't start until these are done")
- **Notes / description** (optional textarea)
- **Save / Cancel** buttons

Client-side validation:
- End date must be ≥ start date
- Task name not empty
- **Dependency validation:** start date must be ≥ the latest end date among selected dependencies (warn the user if not, let them override — real projects sometimes start before a dep finishes)
- **No circular dependencies:** if task A depends on B, B can't depend on A (directly or transitively). Do a quick depth-first check before saving.

### Dependencies picker — UI detail
The multi-select should show task name + project + assignee + end date, so the user can actually find what they're looking for. Example row:
```
☐ Design landing page mockup  · Prompt Packs · Alice · ends Apr 22
```
Group by project or sort by end date — both work. Exclude: the task itself (if editing), completed tasks older than 30 days (reduce noise), and any task that would create a cycle.

### Task card action buttons
Each task in the user's list has these buttons visible:

- **▶ Start** — flips `not_started` → `in_progress`. Only visible if status is `not_started` AND no incomplete dependencies.
- **✓ Done** — marks complete. Sets `status = "completed"`, `completedAt = now`. Visible when status is `in_progress`.
- **✎ Edit** — opens the Add Task modal pre-filled with this task's data. All fields editable except `id` and `createdAt`.
- **🗑 Delete** — removes the task. Shows confirm dialog: "Delete 'Task name'? This can't be undone." If any other task depends on this one, block the delete and show: "Can't delete — 2 other tasks depend on this. Remove those dependencies first."

For tasks not assigned to the current user, show the buttons grayed/disabled with a tooltip "Not your task" — or hide them entirely, your call. I'd lean toward showing-but-disabled so the UI doesn't feel inconsistent when you switch users.

### What happens when a task is marked Done
1. Set `status = "completed"`, `completedAt = now`.
2. Check if any task has this task in its `dependsOn` AND all of *that* task's deps are now complete. If so, that task is now unblocked — show a toast: "Unblocked: [task name] can now be started." Nice little reward loop for the team.
3. Commit to GitHub.
4. Show confetti / subtle celebration (a single green checkmark animation is plenty — don't go overboard).

---

## 6. GitHub API — The Write Flow

This is the core of the "auto-push without cloning" magic. Here's the exact sequence when a user clicks "Add Task":

```
1. Read current tasks.json from GitHub API
   GET /repos/{owner}/{repo}/contents/data/tasks.json
   → Returns { content: base64, sha: "abc123..." }

2. Decode base64, parse JSON, add/modify the task, bump `version`.

3. Write back with the SHA we just got
   PUT /repos/{owner}/{repo}/contents/data/tasks.json
   Body: {
     message: "Add task: Design landing page (by alice)",
     content: base64(new JSON),
     sha: "abc123...",
     branch: "main"
   }

4. If response is 200: success. Show toast. Refresh local list.
5. If response is 409 (SHA mismatch): someone else committed between our read and write.
   Re-fetch, re-apply our change, try again. Max 3 retries.
```

The SHA check is **critical** — without it, if two people add tasks at the same time, one of them gets silently overwritten. GitHub's API uses the SHA as an optimistic lock; you include the SHA of the file version you read, and the write fails if it's stale. This is what the `version` field in the JSON is for as a secondary check.

### Sample JS sketch

```js
// assets/js/github-api.js
const REPO_OWNER = "your-username";
const REPO_NAME = "team-tracker";
const FILE_PATH = "data/tasks.json";
const BRANCH = "main";

async function getToken() {
  const token = localStorage.getItem("gh_pat");
  if (!token) throw new Error("Not authenticated");
  return token;
}

async function readTasks() {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await getToken()}` }
  });
  if (!res.ok) throw new Error(`Read failed: ${res.status}`);
  const data = await res.json();
  const json = JSON.parse(atob(data.content));
  return { json, sha: data.sha };
}

async function writeTasks(newJson, sha, commitMessage) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  const body = {
    message: commitMessage,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(newJson, null, 2)))),
    sha: sha,
    branch: BRANCH
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await getToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (res.status === 409) throw new Error("CONFLICT");
  if (!res.ok) throw new Error(`Write failed: ${res.status}`);
  return res.json();
}

async function addTask(task) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { json, sha } = await readTasks();
      json.tasks.push(task);
      json.version = (json.version || 0) + 1;
      json.lastModified = new Date().toISOString();
      await writeTasks(json, sha, `Add task: ${task.name} (by ${task.assignee})`);
      return;
    } catch (e) {
      if (e.message !== "CONFLICT" || attempt === 2) throw e;
      // Retry on conflict
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
  }
}
```

### Rate limits
Authenticated GitHub API: **5000 requests/hour**. For a team of 10 people making a few updates each, you'll use maybe 200/hour. Completely fine.

---

## 7. Generating the GitHub PAT (team lead does this once, then shares)

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
2. Name: `team-tracker-write`
3. Expiration: 90 days (set a calendar reminder to rotate).
4. Repository access: **Only select repositories** → pick `team-tracker`.
5. Permissions → Repository permissions → **Contents: Read and write**. Leave everything else at "No access".
6. Generate. Copy the token (starts with `github_pat_...`).
7. Share with the team via a secure channel (password manager, not Slack/WhatsApp).

**Do not** use a classic PAT — they grant access to all your repos. Fine-grained is the right call here.

---

## 8. Design / UI direction (dark, minimal, modern)

Since you mentioned dark + minimal + modern, here's a concrete palette and type system rather than vague adjectives:

**Colors**
- Background: `#0a0a0b` (near-black, not pure black — pure black looks dead on TVs)
- Surface / cards: `#161618`
- Surface hover: `#1f1f22`
- Border: `#27272a`
- Text primary: `#fafafa`
- Text secondary: `#a1a1aa`
- Text muted: `#52525b`
- Accent (interactive): `#3b82f6` (or pick one — purple `#8b5cf6` works too)
- Success: `#10b981`
- Warning: `#f59e0b`
- Danger: `#ef4444`

**Typography**
- UI: Inter or IBM Plex Sans (Google Fonts, free). Use 'Inter' for the dashboard — its numerics are clean at TV viewing distance.
- Monospace for dates/times: JetBrains Mono or IBM Plex Mono.
- Dashboard uses larger sizes than the user page. Think TV-at-3-meters: body text minimum 20px, headings 40px+.

**Spacing** — stick to an 8px grid: 8, 16, 24, 32, 48, 64.

**Motion** — dashboard transitions between views should be gentle: 400–600ms crossfade + slight scale (0.98 → 1.0). Nothing flashy; it's a TV running all day.

---

## 9. Suggested additions (you asked for these)

The following are already baked into the plan above since we decided on them: priority field, explicit Start button, dependencies, blocked state, dependency-aware unblock notifications. Below are the ones still on the table — v2 candidates:

1. **Project filter on the dashboard** — a small project tab/chip row lets the TV cycle per-project too, if you have multiple clients (Prompt Packs, Bell System, etc.).
2. **Sub-tasks / checklist inside a task** — optional. For small teams, usually overkill. Skip for v1.
3. **Daily digest view on the dashboard** — "Today: 3 tasks due, 1 delayed, 2 starting, 1 unblocked." A stats strip at the top.
4. **Audio alert on major events** (off by default) — a soft chime when a task is completed. Fun for the team; annoying if overused.
5. **Export to CSV** button on the user page — for monthly reporting.
6. **Keyboard shortcuts on user page** — `N` = new task, `Esc` = close modal, `/` = focus search. Power users love this.
7. **Optimistic UI updates** — when a user clicks "Add Task", show it in the list immediately with a pending spinner. If the API call fails, remove it and show an error. Feels 10× faster even though the API time is the same.
8. **Conflict-aware UI** — if a write fails after 3 retries, don't silently drop the change. Show a modal: "Someone else updated the tracker. Here's your change — copy it, then refresh."
9. **Browser notification when a task is assigned to you** — the user page can poll every minute and fire a `Notification` API popup.
10. **Critical path highlighting on the Gantt** — once you have dependencies, you can compute the critical path (the longest dependency chain that determines project completion date). Tasks on the critical path get a subtle outline. Real project-management flex, and genuinely useful for knowing which delays actually matter.

Honest picks for v1 from this list: **7 (optimistic UI)** and **8 (conflict modal)** — these are small changes that make the app feel solid. Everything else is polish.

---

## 9.5 Additional improvements worth considering

These are less "features to add" and more "things I'd do differently or pay attention to" — suggestions that might save you rework:

### Data & structure
- **Archive completed tasks.** After 30 days, move them to `data/archive/tasks-2026-Q2.json` (or similar). Keeps your main `tasks.json` small (fast to fetch, cheap to diff, readable in a PR). The dashboard's "recently completed" view only needs the last 7 days anyway. Without this, after a year you'll have a multi-MB JSON file and slow page loads.
- **Separate `projects.json`.** Right now `project` is a free-text field on each task. That's fine to start, but once you have 5+ projects it's worth having a proper projects list with its own color, client name, status, target-end-date. Then the dashboard can show per-project progress bars, not just per-task.
- **Activity log.** You already get one for free via git history, but consider also writing a structured `activity.json` that gets appended to on every change (task created, completed, etc.). Useful for a "recent activity" feed on the dashboard, and much cheaper to read than walking git history.
- **Soft delete instead of hard delete.** Add a `deleted: true` flag and `deletedAt` timestamp rather than removing tasks from the array. Hides them from UI, keeps them in the data. You'll thank yourself the first time someone accidentally deletes a week's worth of work. Add a hidden "Recently deleted" view on the user page for recovery.

### UX additions
- **Task duration estimate vs actual.** When creating a task, the difference between startDate and endDate is the estimate. When it's completed, you know the actual time taken. Over time, this becomes a calibration tool — "Alice tends to underestimate by 20%." Surface this subtly (e.g., a small ✓ or ⚠ icon next to their name in the members view).
- **"What I worked on" auto-summary.** At the end of each day, a small view on the dashboard shows each team member's completed tasks from today. Social accountability and celebration in one.
- **Personal filter / "my tasks only" view** on the user page. Add a tab switcher.
- **Saved filters / views** on the user page. "Show me everything due this week" / "Show me blocked tasks" etc.

### Resilience
- **Rate limit awareness.** Show a small "API calls remaining: 4821/5000" somewhere in the user page footer — it's in every GitHub API response header. If it drops below, say, 500, show a warning. You're very unlikely to hit the limit with a small team, but if a bug causes an infinite-retry loop, you'll want to know fast.
- **PAT expiration warning.** Fine-grained PATs expire. The user page should check the PAT's expiry on load (the API tells you) and show a banner when it's 14 days from expiring. Saves the "why is everything broken?" panic on rotation day.
- **"Last synced" indicator on the user page too.** Not just the dashboard. Builds trust.

### Embedded-maker-specific suggestions (since that's your world)
- **ESP32 physical notifier.** Since you work with ESP32s anyway — mount a small ESP32 with an RGB LED and a buzzer in a corner of the office. It polls the same `tasks.json`, flashes red if anything becomes delayed, green when something's completed. A 2-hour weekend project that makes the tracker tangibly present even when the TV is off. This is the kind of thing your team will actually remember the app by.
- **Hardware "I'm done" button.** A physical button on everyone's desk that marks their current in-progress task as done. Much more satisfying than clicking. ESP32 + button + HTTP POST to the GitHub API = a few hours' work. Not suggesting you build it for v1, but it's a natural v2 if the app sticks.

### Things I'd deliberately NOT do
A few things that feel like they'd improve the app but usually make it worse:

- **Don't add real-time updates via WebSocket/SSE.** You'd need a backend. The 60-second poll is genuinely enough — nobody's staring at the screen waiting for an update to appear, and on the user page, the writer sees their own update instantly (optimistic UI).
- **Don't add user-level permissions** until you actually need them. A trusted team doesn't need "Alice can only edit Alice's tasks." It adds UI complexity and the first time someone reassigns a task they'll curse the permission system.
- **Don't build a mobile version.** You already have PWA-capable HTML; on mobile it'll work fine if someone opens the URL. A dedicated mobile app or even a custom mobile layout is way more work than it returns. The people who need to update tasks are on laptops.
- **Don't add comments/chat on tasks.** This is the feature that seems like a no-brainer and then turns into Slack-but-worse. Your team already has a chat tool. Link to it in the notes field if needed.
- **Don't integrate with anything external in v1** (Slack, email, calendar). Every integration is a new thing that can break. Master the core loop first.

### Process suggestions (not code)
- **Have one person be the "tracker owner"** for the first month. They notice the bugs, collect feedback, and decide what to prioritize. Without an owner, collective ownership = no ownership.
- **Require a weekly review ritual** — e.g., Monday morning, everyone looks at the dashboard for 5 minutes together. Without this, the tool becomes invisible and stops getting updated. The tool works only if the team actually uses it.
- **Delete ruthlessly.** The strongest version of this app in 6 months will be simpler than v1, not more complex. When adding features, ask "what do we remove to make room for this?"

---

## 10. Deploying to GitHub Pages

1. Create the repo on GitHub. Decide public vs private. **Public is free for GitHub Pages; private requires GitHub Pro or using GitHub Enterprise.** Since your `tasks.json` will contain internal project info, this matters — if the info is sensitive, you need Pro.
2. Push all the files.
3. Repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder: `/ (root)`.
4. Wait 1–2 minutes. Your site is live at `https://USERNAME.github.io/team-tracker/`.
5. Open `index.html` on the TV browser, `user.html` on laptops. Bookmark both.

For the TV, I'd suggest getting an Amazon Fire Stick or a cheap Chromecast with Google TV, install a browser (Silk on Fire, or a kiosk browser), bookmark the dashboard URL, done. A Raspberry Pi running Chromium in kiosk mode is the more "maker" answer — given your embedded background, you'd probably enjoy that route.

---

## 11. Build order (how to actually tackle this with Claude)

Don't ask Claude to "build the whole thing" in one shot — the output will be sprawling and hard to debug. Break it up like this:

1. **Day 1:** Set up repo structure, empty HTML files, CSS reset + dark theme base, the two JSON data files with seed data (2 team members, 3 tasks, one with a dependency).
2. **Day 2:** Dashboard Gantt chart only. Hardcode-read from tasks.json (via `fetch`). Get the timeline looking right with dependency arrows. No cycling yet.
3. **Day 3:** Dashboard view cycling — members carousel, completed, delayed/blocked. Auto-refresh logic.
4. **Day 4:** User page auth (password + PAT). Read-only task list showing current state with Start/Done/Edit/Delete buttons (non-functional for now).
5. **Day 5:** Add Task modal + GitHub API write flow, including dependencies picker with cycle detection. Test conflicts manually (add from two browser tabs at once).
6. **Day 6:** Wire up Edit / Start / Done / Delete. Dependency-aware logic: block Start if deps incomplete, block Delete if something depends on this, unblock-notification toast on Done.
7. **Day 7:** Deploy to Pages. Load on the actual TV. Fix whatever looks bad at TV distance (it's always text size + contrast).

Each step, start a fresh Claude conversation with just the relevant files attached. Claude works much better with scoped context than with "here is the whole project, now change X".

---

## 12. Known gotchas to watch for

- **CORS is not an issue** for `api.github.com` and `raw.githubusercontent.com` — both send permissive CORS headers. You're fine from a static site.
- **`atob` / `btoa` don't handle Unicode natively.** If someone types an emoji or non-ASCII character in a task name, vanilla `btoa` throws. Use the `encodeURIComponent` trick shown in the code sketch, or `TextEncoder`.
- **Raw CDN caching** — `raw.githubusercontent.com` caches for ~5 min. The dashboard won't see fresh data without a cache buster. Append `?t=${Date.now()}` to every fetch, OR use the authenticated API endpoint (`/repos/.../contents/...`) which has no such caching but costs against your rate limit.
- **`localStorage` is per-origin per-browser.** If a team member uses both Chrome and Firefox, they'll be prompted for the PAT twice. Fine, just know it.
- **GitHub commit spam** — every task change is a commit. Your repo history will be noisy. That's the trade-off. You can squash-merge old commits periodically if it bothers you, but don't bother for a year.
- **Token expiry.** The fine-grained PAT expires in 90 days. When it does, every user sees auth failures. Put a calendar reminder on the team lead's calendar to rotate.
- **Timezones.** Store dates as ISO strings in UTC. Display in the user's local time. Your memory notes you're in India (IST = UTC+5:30), so hardcoding IST display is fine for v1 if the whole team is in India.

---

## 13. What this build is NOT

Worth stating plainly so you don't ask Claude for these by accident:

- Not real-time collaborative (no WebSocket). Updates show up in the next 60-second poll. Fine for task tracking; would be bad for a chat app.
- Not multi-tenant. One repo = one team.
- Not access-controlled per-user. Everyone with the PAT can edit any task. If you need "only Alice can complete Alice's tasks," that's a client-side check you can bolt on, but anyone can bypass it by editing JSON directly. For a trusted team this is fine.
- Not offline-capable for writes. Reads can be cached via service worker, writes need the network.

---

## 14. Security checklist before you go live

- [ ] Fine-grained PAT, not classic
- [ ] PAT scoped to only this repo
- [ ] PAT permissions: Contents read/write only
- [ ] PAT expiration set (90 days max)
- [ ] No PAT in any committed file (grep the repo before first push)
- [ ] `.gitignore` includes `.env`, `*.local`, `secrets/`
- [ ] Team password hash (not plaintext) in the auth config
- [ ] Repo set to private if task data is sensitive (requires GitHub Pro for Pages)
- [ ] Calendar reminder set for PAT rotation

---

That's the plan. Start from section 11 and build incrementally. When you're ready for code, bring this doc into a fresh Claude chat and say "build step 1 from this plan" — you'll get much cleaner output than asking for everything at once.
