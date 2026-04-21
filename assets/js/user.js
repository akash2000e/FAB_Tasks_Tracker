let allTasks    = [];
let allProjects = [];
let allUsers    = [];
let editingTaskId   = null;
let editingMemberId = null;
let editingUserId   = null;
let activeTab       = "my";
let currentPhotoB64 = null; // photo being edited in member modal

// ── Image resize helper ───────────────────────────────────────
function resizeImageToBase64(file, size = 160) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width  * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const PRESET_COLORS = [
  "#e63946","#f4a261","#e9c46a","#2a9d8f",
  "#264653","#9b5de5","#3b82f6","#fb6f92",
  "#00bbf9","#10b981","#f59e0b","#a8dadc",
];

// ── Utilities ─────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function today()       { return new Date().toISOString().split("T")[0]; }
function addDays(d, n) { const dt = new Date(d); dt.setDate(dt.getDate()+n); return dt.toISOString().split("T")[0]; }

function showToast(msg, type = "info") {
  let box = document.querySelector(".toast-box");
  if (!box) { box = document.createElement("div"); box.className = "toast-box"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function hasCycle(fromId, toId) {
  const depMap = {};
  allTasks.forEach(t => { depMap[t.id] = t.dependsOn || []; });
  const visited = new Set();
  const dfs = id => { if (id === fromId) return true; if (visited.has(id)) return false; visited.add(id); return (depMap[id]||[]).some(dfs); };
  return dfs(toId);
}

function canEditTask(task) {
  if (isAdminUser()) return true;
  return task.assignee === getCurrentMember();
}

// ── Auth & boot ───────────────────────────────────────────────
async function initAuth() {
  // If valid session, go straight to app
  if (isAuthenticated()) { showApp(); return; }

  document.getElementById("auth-overlay").style.display = "flex";

  // Wait for Firebase anonymous auth, then check if any users exist
  await _authReady;
  const users = await getUsers();

  document.getElementById("auth-loading").classList.add("hidden");

  if (!users.length) {
    showSetupForm();
  } else {
    showLoginForm();
  }
}

function showLoginForm() {
  document.getElementById("login-form").classList.remove("hidden");

  const attempt = async () => {
    document.getElementById("auth-err").classList.add("hidden");
    const username = document.getElementById("auth-username").value;
    const password = document.getElementById("auth-pass").value;
    if (!username || !password) {
      document.getElementById("auth-err").textContent = "Enter your username and password.";
      document.getElementById("auth-err").classList.remove("hidden");
      return;
    }
    const result = await loginUser(username, password);
    if (result.ok) {
      showApp();
    } else {
      document.getElementById("auth-err").textContent = result.error;
      document.getElementById("auth-err").classList.remove("hidden");
    }
  };

  document.getElementById("auth-btn").addEventListener("click", attempt);
  document.getElementById("auth-pass").addEventListener("keydown", e => { if (e.key === "Enter") attempt(); });
}

function showSetupForm() {
  document.getElementById("setup-form").classList.remove("hidden");

  document.getElementById("setup-btn").addEventListener("click", async () => {
    const errEl    = document.getElementById("setup-err");
    errEl.classList.add("hidden");
    const username = document.getElementById("su-username").value.trim().toLowerCase();
    const display  = document.getElementById("su-displayname").value.trim();
    const pass     = document.getElementById("su-pass").value;
    const pass2    = document.getElementById("su-pass2").value;

    if (!username) { errEl.textContent = "Username is required."; errEl.classList.remove("hidden"); return; }
    if (!pass)     { errEl.textContent = "Password is required."; errEl.classList.remove("hidden"); return; }
    if (pass !== pass2) { errEl.textContent = "Passwords don't match."; errEl.classList.remove("hidden"); return; }

    const hash = await hashPasswordForStorage(pass);
    await createUser({ username, displayName: display || username, passwordHash: hash, isAdmin: true, memberId: "" });
    const result = await loginUser(username, pass);
    if (result.ok) showApp();
  });
}

function showApp() {
  document.getElementById("auth-overlay").style.display = "none";
  document.getElementById("app").classList.remove("hidden");

  const user = getCurrentUser();
  const greetEl = document.getElementById("user-greeting");
  greetEl.innerHTML = `Hi, ${esc(user.displayName || user.username)}` +
    (user.isAdmin ? ' <span class="admin-badge">Admin</span>' : "");

  // Show Settings tab only for admins
  if (user.isAdmin) {
    document.querySelector(".admin-tab").classList.remove("hidden");
  }

  // Tabs
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      activeTab = t.dataset.tab;
      const isSettings = activeTab === "settings";
      const isProfile  = activeTab === "profile";
      const isTasks    = !isSettings && !isProfile;
      document.getElementById("tasks-section").classList.toggle("hidden", !isTasks);
      document.getElementById("settings-section").classList.toggle("hidden", !isSettings);
      document.getElementById("profile-section").classList.toggle("hidden", !isProfile);
      document.getElementById("add-task-btn").style.display = isTasks ? "" : "none";
      if (isTasks)   renderTasks();
      if (isProfile) renderProfile();
    })
  );

  document.getElementById("add-task-btn").addEventListener("click", () => openTaskModal());
  document.getElementById("logout-btn").addEventListener("click", logout);

  // Task modal
  document.getElementById("modal-close-btn").addEventListener("click",  closeTaskModal);
  document.getElementById("modal-cancel-btn").addEventListener("click", closeTaskModal);
  document.getElementById("task-modal").addEventListener("click", e => { if (e.target.id === "task-modal") closeTaskModal(); });
  document.getElementById("task-form").addEventListener("submit", handleTaskSubmit);

  // Member modal
  document.getElementById("add-member-btn").addEventListener("click",    () => openMemberModal());
  document.getElementById("member-modal-close").addEventListener("click", closeMemberModal);
  document.getElementById("member-cancel-btn").addEventListener("click",  closeMemberModal);
  document.getElementById("member-modal").addEventListener("click", e => { if (e.target.id === "member-modal") closeMemberModal(); });
  document.getElementById("member-form").addEventListener("submit", handleMemberSubmit);

  // User modal
  document.getElementById("add-user-btn").addEventListener("click",    () => openUserModal());
  document.getElementById("user-modal-close").addEventListener("click", closeUserModal);
  document.getElementById("user-cancel-btn").addEventListener("click",  closeUserModal);
  document.getElementById("user-modal").addEventListener("click", e => { if (e.target.id === "user-modal") closeUserModal(); });
  document.getElementById("user-form").addEventListener("submit", handleUserSubmit);

  // Project modal
  document.getElementById("add-project-btn").addEventListener("click",    () => openProjectModal());
  document.getElementById("project-modal-close").addEventListener("click", closeProjectModal);
  document.getElementById("project-cancel-btn").addEventListener("click",  closeProjectModal);
  document.getElementById("project-modal").addEventListener("click", e => { if (e.target.id === "project-modal") closeProjectModal(); });
  document.getElementById("project-form").addEventListener("submit", handleProjectSubmit);

  // Profile form
  document.getElementById("profile-form").addEventListener("submit", handleProfileSubmit);

  // Subscriptions
  subscribeTeam(() => {
    populateAssigneeDropdown(); renderTasks(); renderMemberList();
    if (activeTab === "profile") renderProfile();
  });
  subscribeTasks(tasks => { allTasks = tasks; renderTasks(); });
  subscribeProjects(projects => { allProjects = projects; populateProjectDatalist(); renderProjectList(); });
  if (user.isAdmin) {
    subscribeUsers(users => { allUsers = users; renderUserList(); });
  }
}

// ── Task list ─────────────────────────────────────────────────
function renderTasks() {
  if (activeTab === "settings") return;
  const list    = document.getElementById("task-list");
  const me    = getCurrentMember();
  const order = { blocked:0, delayed:1, in_progress:2, not_started:3, completed:4 };

  const tasks = allTasks
    .map(t => ({ ...t, _s: computeStatus(t, allTasks) }))
    .filter(t => activeTab === "my" ? t.assignee === me : true)
    .sort((a,b) => (order[a._s]??5) - (order[b._s]??5));

  if (!tasks.length) {
    list.innerHTML = `<div class="empty-state">${
      activeTab === "my" ? "No active tasks. Hit + New Task to add one." : "No tasks found."
    }</div>`;
    return;
  }

  list.innerHTML = tasks.map(t => renderTaskItem(t)).join("");
  list.querySelectorAll("[data-action]").forEach(btn =>
    btn.addEventListener("click", () => dispatchTask(btn.dataset.action, btn.dataset.id))
  );
}

function renderTaskItem(t) {
  const m     = TEAM.find(x => x.id === t.assignee);
  const color = m?.color || "var(--accent)";
  const s     = t._s;
  const editable = canEditTask(t);

  const blockingNames = (t.dependsOn||[])
    .map(id => allTasks.find(x => x.id === id))
    .filter(d => d && d.status !== "completed")
    .map(d => d.name);

  const noEditTip = 'title="Not your task"';
  const meta = [m?.name, t.project, `${t.startDate} → ${t.endDate}`].filter(Boolean).join("  ·  ");

  return `
    <div class="task-item${s === "completed" ? " task-done" : ""}" style="border-color:${color}">
      <div class="task-item-body">
        <div class="task-item-top">
          <span class="task-item-name">${esc(t.name)}</span>
          <span class="status-badge s-${s}">${s.replace("_"," ")}</span>
          <span class="priority-badge priority-${t.priority||"medium"}">${t.priority||"medium"}</span>
        </div>
        <div class="task-item-meta">${meta}</div>
        ${blockingNames.length ? `<div class="task-item-meta warn">Waiting on: ${blockingNames.map(esc).join(", ")}</div>` : ""}
        ${t.notes ? `<div class="task-item-meta muted">${esc(t.notes)}</div>` : ""}
      </div>
      <div class="task-item-actions">
        <button class="act-btn act-start" data-action="start" data-id="${t.id}"
          ${s==="not_started" && !blockingNames.length && editable ? "" : "disabled"}
          ${blockingNames.length ? `title="Waiting on: ${blockingNames.map(esc).join(', ')}"` : (!editable ? noEditTip : "")}>
          ▶ Start
        </button>
        <button class="act-btn act-done" data-action="done" data-id="${t.id}"
          ${s==="in_progress" && editable ? "" : "disabled"}
          ${!editable ? noEditTip : ""}>
          ✓ Done
        </button>
        <button class="act-btn act-undo" data-action="undo" data-id="${t.id}"
          ${s==="completed" && editable ? "" : "disabled"}
          ${!editable ? noEditTip : ""}>
          ↩ Undo
        </button>
        <button class="act-btn" data-action="edit" data-id="${t.id}"
          ${editable && s !== "completed" ? "" : `disabled ${noEditTip}`}>
          ✎ Edit
        </button>
        <button class="act-btn act-del" data-action="delete" data-id="${t.id}"
          ${editable ? "" : `disabled ${noEditTip}`}>
          ✕
        </button>
      </div>
    </div>`;
}

// ── Task actions ──────────────────────────────────────────────
function dispatchTask(action, id) {
  if (action === "start")  handleStart(id);
  if (action === "done")   handleDone(id);
  if (action === "undo")   handleUndo(id);
  if (action === "edit")   openTaskModal(id);
  if (action === "delete") handleDelete(id);
}

async function handleStart(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t || !canEditTask(t) || computeStatus(t, allTasks) !== "not_started") return;
  await updateTask(id, { status: "in_progress" });
  showToast(`Started: ${t.name}`, "info");
}

async function handleDone(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t || !canEditTask(t)) return;
  await updateTask(id, { status: "completed", completedAt: new Date().toISOString() });
  showToast(`✓ Completed: ${t.name}`, "success");
  setTimeout(() => {
    allTasks.filter(x => (x.dependsOn||[]).includes(id) && x.status === "not_started").forEach(x => {
      const allDone = (x.dependsOn||[]).every(dep => dep === id || allTasks.find(d => d.id === dep)?.status === "completed");
      if (allDone) showToast(`Unblocked: "${x.name}" can now be started`, "info");
    });
  }, 600);
}

async function handleUndo(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t || !canEditTask(t)) return;
  await updateTask(id, { status: "not_started", completedAt: null });
  showToast(`Reopened: ${t.name}`, "info");
}

async function handleDelete(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t || !canEditTask(t)) return;
  const deps = allTasks.filter(x => x.id !== id && (x.dependsOn||[]).includes(id));
  if (deps.length) { showToast(`Can't delete — ${deps.length} task(s) depend on this`, "error"); return; }
  if (!confirm(`Delete "${t.name}"? This can't be undone.`)) return;
  await deleteTask(id);
  showToast("Task deleted", "info");
}

// ── Task modal ────────────────────────────────────────────────
function populateAssigneeDropdown() {
  const sel = document.getElementById("f-assignee");
  const cur = sel.value;
  sel.innerHTML = TEAM.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
  if (cur) sel.value = cur;
}

function populateProjectDatalist() {
  document.getElementById("project-list").innerHTML =
    allProjects.map(p => `<option value="${esc(p.name)}">`).join("");
}

function openTaskModal(taskId = null) {
  editingTaskId = taskId;
  const todayStr = today();
  document.getElementById("modal-title").textContent = taskId ? "Edit Task" : "New Task";
  document.getElementById("task-form").reset();
  document.getElementById("form-err").classList.add("hidden");
  populateAssigneeDropdown();
  const me = getCurrentMember();
  if (me) document.getElementById("f-assignee").value = me;
  document.getElementById("f-start").value = todayStr;
  document.getElementById("f-end").value   = addDays(todayStr, 3);
  populateProjectDatalist();
  buildDepsPicker(taskId);

  if (taskId) {
    const t = allTasks.find(x => x.id === taskId);
    if (t) {
      document.getElementById("f-name").value     = t.name;
      document.getElementById("f-project").value  = t.project || "";
      document.getElementById("f-assignee").value = t.assignee;
      document.getElementById("f-start").value    = t.startDate;
      document.getElementById("f-end").value      = t.endDate;
      document.getElementById("f-notes").value    = t.notes || "";
      const pr = document.querySelector(`input[name="priority"][value="${t.priority}"]`);
      if (pr) pr.checked = true;
      (t.dependsOn||[]).forEach(depId => {
        const cb = document.querySelector(`#deps-picker input[value="${depId}"]`);
        if (cb) cb.checked = true;
      });
    }
  }

  document.getElementById("task-modal").classList.remove("hidden");
  document.getElementById("f-name").focus();
}

function buildDepsPicker(excludeId) {
  const picker   = document.getElementById("deps-picker");
  const eligible = allTasks.filter(t => t.id !== excludeId && t.status !== "completed");
  if (!eligible.length) { picker.innerHTML = '<div class="deps-empty">No other tasks available</div>'; return; }
  picker.innerHTML = eligible.map(t => {
    const m = TEAM.find(x => x.id === t.assignee);
    const c = excludeId ? hasCycle(excludeId, t.id) : false;
    return `<div class="dep-item">
      <input type="checkbox" id="dep-${t.id}" value="${t.id}" ${c ? "disabled title='Would create a cycle'" : ""}>
      <label for="dep-${t.id}">${esc(t.name)}<span class="dep-meta">${t.project||""} · ${m?.name||t.assignee} · ends ${t.endDate}</span></label>
    </div>`;
  }).join("");
}

function closeTaskModal() { document.getElementById("task-modal").classList.add("hidden"); editingTaskId = null; }

async function handleTaskSubmit(e) {
  e.preventDefault();
  const errEl     = document.getElementById("form-err");
  errEl.classList.add("hidden");
  const name      = document.getElementById("f-name").value.trim();
  const project   = document.getElementById("f-project").value.trim();
  const assignee  = document.getElementById("f-assignee").value;
  const startDate = document.getElementById("f-start").value;
  const endDate   = document.getElementById("f-end").value;
  const priority  = document.querySelector('input[name="priority"]:checked')?.value || "medium";
  const notes     = document.getElementById("f-notes").value.trim();
  const dependsOn = [...document.querySelectorAll("#deps-picker input:checked")].map(cb => cb.value);

  if (!name || !project) { errEl.textContent = "Task name and project are required."; errEl.classList.remove("hidden"); return; }
  if (endDate < startDate) { errEl.textContent = "End date must be on or after start date."; errEl.classList.remove("hidden"); return; }

  try {
    if (editingTaskId) {
      await updateTask(editingTaskId, { name, project, assignee, startDate, endDate, priority, notes, dependsOn });
      showToast("Task updated", "success");
    } else {
      await addTask({ name, project, assignee, startDate, endDate, priority, notes, dependsOn, status: "not_started" });
      showToast("Task added", "success");
    }
    closeTaskModal();
  } catch (err) {
    errEl.textContent = "Save failed: " + err.message;
    errEl.classList.remove("hidden");
  }
}

// ── Team member management ────────────────────────────────────
function renderMemberList() {
  const list = document.getElementById("member-list");
  if (!TEAM.length) { list.innerHTML = '<div class="empty-state" style="padding:20px 0">No team members yet.</div>'; return; }
  list.innerHTML = TEAM.map(m => `
    <div class="settings-item">
      <div class="settings-item-dot" style="background:${m.color}"></div>
      <div class="settings-item-info">
        <div class="settings-item-name">${esc(m.name)}</div>
        <div class="settings-item-sub">${esc(m.role||"")}</div>
      </div>
      <div class="settings-item-actions">
        <button class="act-btn" data-action="edit-member" data-id="${m.id}">✎ Edit</button>
        <button class="act-btn act-del" data-action="delete-member" data-id="${m.id}">✕</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => {
    if (btn.dataset.action === "edit-member")   openMemberModal(btn.dataset.id);
    if (btn.dataset.action === "delete-member") handleDeleteMember(btn.dataset.id);
  }));
}

function buildColorSwatches(selected) {
  const c = document.getElementById("color-swatches");
  c.innerHTML = PRESET_COLORS.map(col => `
    <div class="color-swatch ${col===selected?"selected":""}" style="background:${col}" data-color="${col}"></div>
  `).join("");
  c.querySelectorAll(".color-swatch").forEach(sw => sw.addEventListener("click", () => {
    c.querySelectorAll(".color-swatch").forEach(x => x.classList.remove("selected"));
    sw.classList.add("selected");
    document.getElementById("m-color").value = sw.dataset.color;
  }));
}

function setPhotoPreview(src, color) {
  const img     = document.getElementById("photo-preview-img");
  const initial = document.getElementById("photo-initial");
  const circle  = document.getElementById("photo-circle");
  const removeBtn = document.getElementById("photo-remove-btn");

  if (src) {
    img.src = src;
    img.classList.remove("hidden");
    initial.classList.add("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    img.src = "";
    img.classList.add("hidden");
    initial.textContent = document.getElementById("m-name").value.charAt(0).toUpperCase() || "?";
    initial.classList.remove("hidden");
    removeBtn.classList.add("hidden");
  }
  circle.style.borderColor = color || document.getElementById("m-color").value || "#555";
}

function openMemberModal(memberId = null) {
  editingMemberId = memberId;
  currentPhotoB64 = null;
  document.getElementById("member-modal-title").textContent = memberId ? "Edit Member" : "Add Team Member";
  document.getElementById("member-form").reset();
  document.getElementById("member-form-err").classList.add("hidden");
  document.getElementById("m-photo").value = "";

  const m = memberId ? TEAM.find(x => x.id === memberId) : null;
  const color = m?.color || PRESET_COLORS.find(c => !TEAM.some(x => x.color === c)) || PRESET_COLORS[0];

  if (m) {
    document.getElementById("m-name").value  = m.name;
    document.getElementById("m-role").value  = m.role || "";
    document.getElementById("m-color").value = m.color;
    currentPhotoB64 = m.photo || null;
    buildColorSwatches(m.color);
    setPhotoPreview(m.photo || null, m.color);
  } else {
    document.getElementById("m-color").value = color;
    buildColorSwatches(color);
    setPhotoPreview(null, color);
  }

  // File input handler
  const fileInput = document.getElementById("m-photo");
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      currentPhotoB64 = await resizeImageToBase64(file);
      setPhotoPreview(currentPhotoB64, document.getElementById("m-color").value);
    } catch (e) {
      showToast("Could not process image", "error");
    }
  };

  // Remove photo button
  document.getElementById("photo-remove-btn").onclick = () => {
    currentPhotoB64 = null;
    document.getElementById("m-photo").value = "";
    setPhotoPreview(null, document.getElementById("m-color").value);
  };

  // Update circle border color when color changes
  document.getElementById("color-swatches").addEventListener("click", () => {
    setTimeout(() => {
      const c = document.getElementById("m-color").value;
      document.getElementById("photo-circle").style.borderColor = c;
    }, 10);
  });

  // Update initial letter as name is typed
  document.getElementById("m-name").oninput = e => {
    if (!currentPhotoB64) {
      document.getElementById("photo-initial").textContent = e.target.value.charAt(0).toUpperCase() || "?";
    }
  };

  document.getElementById("member-modal").classList.remove("hidden");
  document.getElementById("m-name").focus();
}

function closeMemberModal() { document.getElementById("member-modal").classList.add("hidden"); editingMemberId = null; }

async function handleMemberSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("member-form-err");
  errEl.classList.add("hidden");
  const name  = document.getElementById("m-name").value.trim();
  const role  = document.getElementById("m-role").value.trim();
  const color = document.getElementById("m-color").value;
  if (!name) { errEl.textContent = "Name is required."; errEl.classList.remove("hidden"); return; }
  try {
    const data = { name, role, color, photo: currentPhotoB64 || "" };
    if (editingMemberId) {
      await updateMember(editingMemberId, data);
      showToast("Member updated", "success");
    } else {
      await addMember(data);
      showToast(`${name} added to team`, "success");
    }
    closeMemberModal();
  } catch (err) {
    errEl.textContent = "Save failed: " + err.message;
    errEl.classList.remove("hidden");
  }
}

async function handleDeleteMember(id) {
  const m = TEAM.find(x => x.id === id);
  if (!m) return;
  if (allTasks.some(t => t.assignee === id && t.status !== "completed")) {
    showToast(`Can't delete — ${m.name} has active tasks`, "error"); return;
  }
  if (allUsers.some(u => u.memberId === id)) {
    showToast(`Can't delete — ${m.name} is linked to a user account. Remove the link first.`, "error"); return;
  }
  if (!confirm(`Remove ${m.name} from the team?`)) return;
  await deleteMember(id);
  showToast(`${m.name} removed`, "info");
}

// ── User account management ───────────────────────────────────
function renderUserList() {
  const list = document.getElementById("user-list");
  if (!allUsers.length) { list.innerHTML = '<div class="empty-state" style="padding:20px 0">No user accounts yet.</div>'; return; }

  const me = getCurrentUser()?.userId;
  list.innerHTML = allUsers.map(u => {
    const linked = TEAM.find(m => m.id === u.memberId);
    return `
      <div class="settings-item">
        <div class="settings-item-info">
          <div class="settings-item-name">
            ${esc(u.displayName || u.username)}
            <span class="user-tag">@${esc(u.username)}</span>
            ${u.isAdmin ? '<span class="admin-badge">Admin</span>' : ""}
          </div>
          <div class="settings-item-sub">${linked ? `Linked to ${esc(linked.name)}` : "No team member linked"}</div>
        </div>
        <div class="settings-item-actions">
          <button class="act-btn" data-action="edit-user" data-id="${u.id}">✎ Edit</button>
          <button class="act-btn act-del" data-action="delete-user" data-id="${u.id}" ${u.id === me ? "disabled title='Cannot delete your own account'" : ""}>✕</button>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => {
    if (btn.dataset.action === "edit-user")   openUserModal(btn.dataset.id);
    if (btn.dataset.action === "delete-user") handleDeleteUser(btn.dataset.id);
  }));
}

function populateUserMemberDropdown(excludeUserId = null) {
  const sel = document.getElementById("u-member");
  const takenMemberIds = allUsers
    .filter(u => u.id !== excludeUserId && u.memberId)
    .map(u => u.memberId);

  sel.innerHTML = '<option value="">— None —</option>' +
    TEAM.map(m => `<option value="${m.id}" ${takenMemberIds.includes(m.id) ? "disabled" : ""}>${esc(m.name)}</option>`).join("");
}

function openUserModal(userId = null) {
  editingUserId = userId;
  document.getElementById("user-modal-title").textContent = userId ? "Edit User" : "Add User";
  document.getElementById("user-form").reset();
  document.getElementById("user-form-err").classList.add("hidden");
  document.getElementById("u-username").disabled = !!userId;

  // Password hint
  document.getElementById("u-pass-req").classList.toggle("hidden", !!userId);
  document.getElementById("u-pass-hint").classList.toggle("hidden", !userId);
  document.getElementById("u-password").required = !userId;

  populateUserMemberDropdown(userId);

  if (userId) {
    const u = allUsers.find(x => x.id === userId);
    if (u) {
      document.getElementById("u-username").value    = u.username;
      document.getElementById("u-displayname").value = u.displayName || "";
      document.getElementById("u-member").value      = u.memberId || "";
      document.getElementById("u-admin").checked     = u.isAdmin === true;
    }
  }

  document.getElementById("user-modal").classList.remove("hidden");
  if (!userId) document.getElementById("u-username").focus();
  else document.getElementById("u-displayname").focus();
}

function closeUserModal() { document.getElementById("user-modal").classList.add("hidden"); editingUserId = null; }

async function handleUserSubmit(e) {
  e.preventDefault();
  const errEl      = document.getElementById("user-form-err");
  errEl.classList.add("hidden");
  const username   = document.getElementById("u-username").value.trim().toLowerCase();
  const displayName = document.getElementById("u-displayname").value.trim();
  const password   = document.getElementById("u-password").value;
  const memberId   = document.getElementById("u-member").value;
  const isAdmin    = document.getElementById("u-admin").checked;

  if (!username) { errEl.textContent = "Username is required."; errEl.classList.remove("hidden"); return; }
  if (!editingUserId && !password) { errEl.textContent = "Password is required."; errEl.classList.remove("hidden"); return; }

  // Check username uniqueness for new users
  if (!editingUserId) {
    const existing = await getUserByUsername(username);
    if (existing) { errEl.textContent = "Username already taken."; errEl.classList.remove("hidden"); return; }
  }

  try {
    const data = { displayName: displayName || username, memberId, isAdmin };
    if (password) data.passwordHash = await hashPasswordForStorage(password);

    if (editingUserId) {
      await updateUser(editingUserId, data);
      showToast("User updated", "success");

      // If editing own account, refresh session
      if (editingUserId === getCurrentUser()?.userId) {
        const s = getSession();
        s.displayName = data.displayName;
        s.memberId    = data.memberId;
        s.isAdmin     = data.isAdmin;
        localStorage.setItem("fablab_session", JSON.stringify(s));
      }
    } else {
      await createUser({ username, ...data });
      showToast(`User @${username} created`, "success");
    }
    closeUserModal();
  } catch (err) {
    errEl.textContent = "Save failed: " + err.message;
    errEl.classList.remove("hidden");
  }
}

async function handleDeleteUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Delete account @${u.username}? They will no longer be able to log in.`)) return;
  await deleteUser(id);
  showToast(`@${u.username} deleted`, "info");
}

// ── Project management ────────────────────────────────────────
function renderProjectList() {
  const list = document.getElementById("project-settings-list");
  if (!allProjects.length) { list.innerHTML = '<div class="empty-state" style="padding:20px 0">No projects yet.</div>'; return; }
  list.innerHTML = allProjects.map(p => `
    <div class="settings-item">
      <div class="settings-item-info"><div class="settings-item-name">${esc(p.name)}</div></div>
      <div class="settings-item-actions">
        <button class="act-btn act-del" data-action="delete-project" data-id="${p.id}">✕ Delete</button>
      </div>
    </div>`).join("");
  list.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => handleDeleteProject(btn.dataset.id)));
}

function openProjectModal()  { document.getElementById("project-form").reset(); document.getElementById("project-form-err").classList.add("hidden"); document.getElementById("project-modal").classList.remove("hidden"); document.getElementById("p-name").focus(); }
function closeProjectModal() { document.getElementById("project-modal").classList.add("hidden"); }

async function handleProjectSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("project-form-err");
  errEl.classList.add("hidden");
  const name = document.getElementById("p-name").value.trim();
  if (!name) { errEl.textContent = "Project name is required."; errEl.classList.remove("hidden"); return; }
  if (allProjects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    errEl.textContent = "A project with this name already exists."; errEl.classList.remove("hidden"); return;
  }
  try { await addProject(name); showToast(`"${name}" added`, "success"); closeProjectModal(); }
  catch (err) { errEl.textContent = "Save failed: " + err.message; errEl.classList.remove("hidden"); }
}

async function handleDeleteProject(id) {
  const p = allProjects.find(x => x.id === id);
  if (!p) return;
  if (allTasks.some(t => t.project === p.name && t.status !== "completed")) {
    showToast(`Can't delete — "${p.name}" has active tasks`, "error"); return;
  }
  if (!confirm(`Delete project "${p.name}"?`)) return;
  await deleteProject(id);
  showToast(`"${p.name}" deleted`, "info");
}

// ── Profile ───────────────────────────────────────────────────
let profilePhotoB64 = null;

function renderProfile() {
  const user   = getCurrentUser();
  const member = TEAM.find(m => m.id === user.memberId);

  document.getElementById("prof-displayname").value = user.displayName || "";
  document.getElementById("prof-current-pass").value = "";
  document.getElementById("prof-new-pass").value = "";
  document.getElementById("prof-confirm-pass").value = "";
  document.getElementById("profile-form-err").classList.add("hidden");
  document.getElementById("profile-form-ok").classList.add("hidden");

  const photoRow = document.getElementById("profile-photo-row");
  if (member) {
    photoRow.classList.remove("hidden");
    profilePhotoB64 = member.photo || null;
    _setProfilePhotoPreview(member.photo || null, member.color, member.name);

    const fileInput = document.getElementById("profile-photo-input");
    fileInput.onchange = async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        profilePhotoB64 = await resizeImageToBase64(file);
        _setProfilePhotoPreview(profilePhotoB64, member.color, member.name);
      } catch { showToast("Could not process image", "error"); }
    };

    document.getElementById("profile-photo-remove").onclick = () => {
      profilePhotoB64 = null;
      fileInput.value = "";
      _setProfilePhotoPreview(null, member.color, member.name);
    };
  } else {
    photoRow.classList.add("hidden");
    profilePhotoB64 = null;
  }
}

function _setProfilePhotoPreview(src, color, name) {
  const img     = document.getElementById("profile-photo-preview");
  const initial = document.getElementById("profile-photo-initial");
  const circle  = document.getElementById("profile-photo-circle");
  const remove  = document.getElementById("profile-photo-remove");
  circle.style.borderColor = color || "var(--bd)";
  if (src) {
    img.src = src; img.classList.remove("hidden");
    initial.classList.add("hidden"); remove.classList.remove("hidden");
  } else {
    img.src = ""; img.classList.add("hidden");
    initial.textContent = (name || "?").charAt(0).toUpperCase();
    initial.classList.remove("hidden"); remove.classList.add("hidden");
  }
}

async function handleProfileSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById("profile-form-err");
  const okEl  = document.getElementById("profile-form-ok");
  errEl.classList.add("hidden"); okEl.classList.add("hidden");

  const user        = getCurrentUser();
  const displayName = document.getElementById("prof-displayname").value.trim();
  const currentPass = document.getElementById("prof-current-pass").value;
  const newPass     = document.getElementById("prof-new-pass").value;
  const confirmPass = document.getElementById("prof-confirm-pass").value;

  const updates = {};
  if (displayName) updates.displayName = displayName;

  if (newPass || currentPass) {
    if (!currentPass) { errEl.textContent = "Enter your current password to change it."; errEl.classList.remove("hidden"); return; }
    const userDoc = await getUserByUsername(user.username);
    const hash    = await hashPasswordForStorage(currentPass);
    if (hash !== userDoc.passwordHash) { errEl.textContent = "Current password is incorrect."; errEl.classList.remove("hidden"); return; }
    if (!newPass) { errEl.textContent = "Enter a new password."; errEl.classList.remove("hidden"); return; }
    if (newPass !== confirmPass) { errEl.textContent = "New passwords don't match."; errEl.classList.remove("hidden"); return; }
    updates.passwordHash = await hashPasswordForStorage(newPass);
  }

  try {
    if (Object.keys(updates).length) {
      await updateUser(user.userId, updates);
      const s = getSession();
      if (updates.displayName) s.displayName = updates.displayName;
      localStorage.setItem("fablab_session", JSON.stringify(s));
      document.getElementById("user-greeting").innerHTML =
        `Hi, ${esc(s.displayName || s.username)}` +
        (s.isAdmin ? ' <span class="admin-badge">Admin</span>' : "");
    }

    const member = TEAM.find(m => m.id === getCurrentUser().memberId);
    if (member && profilePhotoB64 !== member.photo) {
      await updateMember(member.id, { ...member, photo: profilePhotoB64 || "" });
    }

    document.getElementById("prof-current-pass").value = "";
    document.getElementById("prof-new-pass").value = "";
    document.getElementById("prof-confirm-pass").value = "";
    okEl.textContent = "Profile saved successfully.";
    okEl.classList.remove("hidden");
  } catch (err) {
    errEl.textContent = "Save failed: " + err.message;
    errEl.classList.remove("hidden");
  }
}

// ── Boot ──────────────────────────────────────────────────────
initAuth();
