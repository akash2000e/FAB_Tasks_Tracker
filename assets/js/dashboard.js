const VIEWS = [
  { id: "v-gantt-month", ms: 35000 },
  { id: "v-gantt-week",  ms: 35000 },
  { id: "v-team",        ms: 20000 },
  { id: "v-done",        ms: 15000 },
  { id: "v-alert",       ms: 15000 },
  { id: "v-logo",        ms: 8000  },
];

let allTasks   = [];
let currentIdx = 0;
let cycleTimer = null;
let rafId      = null;
let cycleStart = 0;

// ── Auto-scroll ───────────────────────────────────────────────
const _scrollers = {};

// dir: 'v' = vertical (default), 'h' = horizontal
function startAutoScroll(elementId, speed = 0.45, dir = 'v') {
  stopAutoScroll(elementId);
  const el = document.getElementById(elementId);
  if (!el) return;
  let pauseUntil = 0;
  const sp = dir === 'h' ? 'scrollLeft'  : 'scrollTop';
  const sz = dir === 'h' ? 'scrollWidth' : 'scrollHeight';
  const cl = dir === 'h' ? 'clientWidth' : 'clientHeight';
  const tick = now => {
    _scrollers[elementId] = requestAnimationFrame(tick);
    if (now < pauseUntil) return;
    if (el[sz] <= el[cl] + 4) { el[sp] = 0; return; }
    if (el[sp] + el[cl] >= el[sz] - 4) {
      el[sp] = 0;
      pauseUntil = now + 2200;
      return;
    }
    el[sp] += speed;
  };
  _scrollers[elementId] = requestAnimationFrame(tick);
}

function stopAutoScroll(elementId) {
  if (_scrollers[elementId]) {
    cancelAnimationFrame(_scrollers[elementId]);
    delete _scrollers[elementId];
  }
}

function stopAllAutoScrollers() {
  Object.keys(_scrollers).forEach(id => {
    cancelAnimationFrame(_scrollers[id]);
    delete _scrollers[id];
  });
}

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  document.getElementById("clock-time").textContent =
    now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("clock-date").textContent =
    now.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" });
}

// ── Header stats ──────────────────────────────────────────────
function updateHeaderStats() {
  const active   = allTasks.filter(t => t.status !== "completed").length;
  const inProg   = allTasks.filter(t => t.status === "in_progress").length;
  const delayed  = allTasks.filter(t => computeStatus(t, allTasks) === "delayed").length;
  const weekAgo  = new Date(Date.now() - 7 * 864e5).toISOString();
  const doneWeek = allTasks.filter(t => t.status === "completed" && t.completedAt > weekAgo).length;

  document.getElementById("hdr-stats").innerHTML = [
    { val: active,   lbl: "Active",      color: "var(--tx)" },
    { val: inProg,   lbl: "In Progress", color: "#60a5fa"   },
    { val: delayed,  lbl: "Delayed",     color: "var(--warn)" },
    { val: doneWeek, lbl: "Done / Week", color: "var(--ok)" },
  ].map(s => `
    <div class="hdr-stat">
      <span class="hdr-stat-val" style="color:${s.color}">${s.val}</span>
      <span class="hdr-stat-lbl">${s.lbl}</span>
    </div>`).join('<div class="hdr-stat-divider"></div>');
}

// ── Dim at night — disabled ───────────────────────────────────
function applyDim() {}

// ── Cycle bar ─────────────────────────────────────────────────
function animateCycleBar(duration) {
  const fill = document.getElementById("cycle-fill");
  fill.style.transition = "none";
  fill.style.width = "0%";
  cycleStart = performance.now();
  cancelAnimationFrame(rafId);
  const tick = now => {
    const pct = Math.min(((now - cycleStart) / duration) * 100, 100);
    fill.style.width = pct + "%";
    if (pct < 100) rafId = requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── View switching ────────────────────────────────────────────
function hasAlerts() {
  return allTasks.some(t => { const s = computeStatus(t, allTasks); return s === "delayed" || s === "blocked"; });
}

function showView(idx) {
  stopAllAutoScrollers();
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const target = document.getElementById(VIEWS[idx].id);
  if (target) target.classList.add("active");
  animateCycleBar(VIEWS[idx].ms);
  renderView(idx);

  clearTimeout(cycleTimer);
  cycleTimer = setTimeout(() => {
    let next = (idx + 1) % VIEWS.length;
    if (next === 4 && !hasAlerts()) next = 0;
    currentIdx = next;
    showView(next);
  }, VIEWS[idx].ms);
}

function renderView(idx) {
  const id = VIEWS[idx].id;
  if (id === "v-gantt-month") renderGantt("Month", "gantt-legend-month", "gantt-wrap-month");
  if (id === "v-gantt-week")  renderGantt("Week",  "gantt-legend-week",  "gantt-wrap-week");
  if (id === "v-team")        renderTeam();
  if (id === "v-done")        renderCompleted();
  if (id === "v-alert")       renderAlerts();
}

// ── Gantt ─────────────────────────────────────────────────────
function renderGanttLegend(legendId) {
  const el = document.getElementById(legendId);
  if (!el) return;
  if (!TEAM.length) { el.innerHTML = ""; return; }
  el.innerHTML = TEAM.map(m => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${m.color}"></span>
      <span class="legend-name">${m.name}</span>
    </div>`).join("");
}

function renderGantt(mode, legendId, wrapId) {
  renderGanttLegend(legendId);
  const wrap  = document.getElementById(wrapId);
  if (!wrap) return;

  const statusProgress = { completed: 100, in_progress: 60, not_started: 0, blocked: 0, delayed: 30 };

  // Date ranges for filtering
  const now   = new Date();

  // This calendar month: 1st → last day
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString().split("T")[0];
  const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString().split("T")[0];

  // This calendar week: Monday → Sunday
  const dow       = now.getDay(); // 0=Sun
  const diffMon   = dow === 0 ? -6 : 1 - dow;
  const monDate   = new Date(now); monDate.setDate(now.getDate() + diffMon);
  const sunDate   = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
  const weekStart = monDate.toISOString().split("T")[0];
  const weekEnd   = sunDate.toISOString().split("T")[0];

  const tasks = allTasks.filter(t => {
    if (!t.startDate || !t.endDate) return false;
    if (mode === "Week")  return t.startDate <= weekEnd  && t.endDate >= weekStart;
    if (mode === "Month") return t.startDate <= monthEnd && t.endDate >= monthStart;
    return true;
  });

  if (!tasks.length) {
    const msg = mode === "Week"
      ? "No tasks this week"
      : "No tasks this month";
    wrap.innerHTML = `<p class="empty-state" style="padding-top:80px">${msg}</p>`;
    return;
  }

  const ganttTasks = tasks.map(t => {
    const member = TEAM.find(m => m.id === t.assignee);
    const s      = computeStatus(t, allTasks);
    const isDone = t.status === "completed";
    return {
      id:           t.id,
      name:         isDone ? `✓ ${t.name}` : t.name,
      start:        t.startDate,
      end:          t.endDate,
      progress:     statusProgress[s] ?? 0,
      dependencies: (t.dependsOn || []).join(", "),
      custom_class: isDone ? "task-completed" : (member ? `assignee-${member.id}` : "assignee-none"),
    };
  });

  const svgId = `gantt-svg-${mode.toLowerCase()}`;
  wrap.innerHTML = `<svg id="${svgId}"></svg>`;

  try {
    new Gantt(`#${svgId}`, ganttTasks, {
      view_mode:   mode,
      bar_height:  20,
      padding:     8,
      date_format: "YYYY-MM-DD",
      language:    "en",
    });

    injectMemberColors();
    setTimeout(() => startAutoScroll(wrapId, 0.4), 400);
  } catch (e) {
    wrap.innerHTML = '<p class="empty-state" style="padding-top:80px">Could not render chart</p>';
    console.error(e);
  }
}

function injectMemberColors() {
  const existing = document.getElementById("member-color-style");
  if (existing) existing.remove();

  const style = document.createElement("style");
  style.id = "member-color-style";
  style.textContent = TEAM.map(m => `
    .assignee-${m.id} .bar            { fill: ${m.color} !important; opacity: .92; }
    .assignee-${m.id} .bar-progress   { fill: ${m.color} !important; opacity: .55; }
    .assignee-${m.id} .bar-label      { fill: #fff !important; font-weight: 600 !important; }
  `).join("\n") + `
    .assignee-none .bar          { fill: var(--tx3) !important; }
    .assignee-none .bar-label    { fill: #fff !important; }
  `;
  document.head.appendChild(style);
}

// ── Team ──────────────────────────────────────────────────────
function renderTeam() {
  if (!TEAM.length) {
    document.getElementById("team-grid").innerHTML = '<p class="empty-state">No team members yet</p>';
    return;
  }
  const teamGrid = document.getElementById("team-grid");
  teamGrid.innerHTML = TEAM.map(m => {
    const active  = allTasks.filter(t => t.assignee === m.id && computeStatus(t, allTasks) === "in_progress");
    const blocked = allTasks.filter(t => t.assignee === m.id && computeStatus(t, allTasks) === "blocked").length;
    const done    = allTasks.filter(t => t.assignee === m.id && t.status === "completed" &&
                      t.completedAt > new Date(Date.now()-7*864e5).toISOString()).length;
    const avatarHtml = m.photo
      ? `<img src="${m.photo}" class="tc-avatar-img" alt="${m.name}">`
      : `<div class="tc-avatar-initials">${m.name.charAt(0).toUpperCase()}</div>`;

    return `
      <div class="team-card" style="--member-color:${m.color}">
        <div class="team-card-accent"></div>
        <div class="team-card-body">
          <div class="tc-avatar-wrap">
            <div class="tc-avatar" style="border-color:${m.color}">${avatarHtml}</div>
          </div>
          <div class="team-card-name">${m.name}</div>
          <div class="team-card-role">${m.role || ""}</div>
          <div class="team-card-pills">
            <span class="tc-pill tc-pill-blue">${active.length} active</span>
            ${blocked ? `<span class="tc-pill tc-pill-red">${blocked} blocked</span>` : ""}
            ${done    ? `<span class="tc-pill tc-pill-green">${done} done</span>` : ""}
          </div>
        </div>
      </div>`;
  }).join("");
  setTimeout(() => startAutoScroll("team-grid", 0.5), 300);
}

// ── Completed ─────────────────────────────────────────────────
function renderCompleted() {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const done  = allTasks
    .filter(t => t.status === "completed" && t.completedAt > since)
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  const el = document.getElementById("done-list");
  if (!done.length) {
    el.innerHTML = '<p class="empty-state">No completions this week yet — keep going!</p>';
    return;
  }
  el.innerHTML = done.map(t => {
    const m    = TEAM.find(x => x.id === t.assignee);
    const date = new Date(t.completedAt).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
    return dashCard(t, "✓", m?.color || "var(--ok)", `Completed ${date}`);
  }).join("");
  setTimeout(() => startAutoScroll("done-list", 0.5), 300);
}

// ── Alerts ────────────────────────────────────────────────────
function renderAlerts() {
  const alerts = allTasks.filter(t => {
    const s = computeStatus(t, allTasks);
    return s === "delayed" || s === "blocked";
  }).sort((a, b) => {
    const order = { blocked: 0, delayed: 1 };
    return (order[computeStatus(a, allTasks)] ?? 2) - (order[computeStatus(b, allTasks)] ?? 2);
  });

  const el = document.getElementById("alert-list");
  if (!alerts.length) {
    el.innerHTML = '<p class="empty-state">✓ All clear — no delays or blocks right now</p>';
    return;
  }
  el.innerHTML = alerts.map(t => {
    const s     = computeStatus(t, allTasks);
    const color = s === "blocked" ? "var(--danger)" : "var(--warn)";
    const icon  = s === "blocked" ? "⊘" : "⚠";
    const extra = s === "blocked" ? "Blocked by dependency" : `Overdue · was due ${t.endDate}`;
    return dashCard(t, icon, color, extra);
  }).join("");
  setTimeout(() => startAutoScroll("alert-list", 0.5), 300);
}

function dashCard(t, icon, color, extraMeta) {
  const m    = TEAM.find(x => x.id === t.assignee);
  const meta = [m?.name, t.project, extraMeta].filter(Boolean).join("  ·  ");
  return `
    <div class="dash-card" style="--card-color:${color}">
      <div class="dash-card-icon">${icon}</div>
      <div class="dash-card-body">
        <div class="dash-card-name">${t.name}</div>
        <div class="dash-card-meta">${meta}</div>
      </div>
      <span class="priority-badge priority-${t.priority || "medium"}">${t.priority || "medium"}</span>
    </div>`;
}

// ── Wake lock ─────────────────────────────────────────────────
async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try { await navigator.wakeLock.request("screen"); } catch (_) {}
  }
}

// ── Loading overlay ───────────────────────────────────────────
let _loaderHidden = false;
function hideDashLoader() {
  if (_loaderHidden) return;
  _loaderHidden = true;
  const el = document.getElementById("dash-loader");
  if (!el) return;
  el.classList.add("loaded");
  setTimeout(() => el.remove(), 850);
}

// ── Boot ──────────────────────────────────────────────────────
updateClock();
setInterval(updateClock, 30000);
applyDim();
setInterval(applyDim, 60000);
requestWakeLock();

subscribeTeam(() => { updateHeaderStats(); renderView(currentIdx); });

subscribeTasks(tasks => {
  allTasks = tasks.filter(t => t.status !== "backlog");
  document.getElementById("sync-dot").className = "dot dot-ok";
  updateHeaderStats();
  renderView(currentIdx);
  hideDashLoader();
});

showView(0);
