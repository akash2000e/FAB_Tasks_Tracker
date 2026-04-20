if (FIREBASE_CONFIG.apiKey === "YOUR_API_KEY") {
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#fff;background:#0a0a0b;font-size:1.2rem;text-align:center;padding:24px">' +
    '⚙️ Firebase not configured.<br>Open <code>assets/js/config.js</code> and fill in your Firebase project values.' +
    '</div>';
  throw new Error("Firebase not configured");
}

firebase.initializeApp(FIREBASE_CONFIG);
const db          = firebase.firestore();
const tasksRef    = db.collection("tasks");
const teamRef     = db.collection("team");
const projectsRef = db.collection("projects");

let TEAM = [];

// Sign in anonymously — must happen after tasksRef is declared
const _authReady = firebase.auth()
  .signInAnonymously()
  .catch(err => console.error("Anonymous auth failed:", err));

function subscribeTasks(callback) {
  return tasksRef
    .where("deleted", "==", false)
    .onSnapshot(
      snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err  => console.error("Firestore error:", err)
    );
}

async function addTask(task) {
  await _authReady;
  const now = new Date().toISOString();
  const doc = { ...task, createdAt: now, updatedAt: now, completedAt: null, deleted: false };
  const ref = await tasksRef.add(doc);
  return { id: ref.id, ...doc };
}

async function updateTask(id, changes) {
  await _authReady;
  await tasksRef.doc(id).update({ ...changes, updatedAt: new Date().toISOString() });
}

async function deleteTask(id) {
  await _authReady;
  await tasksRef.doc(id).update({ deleted: true, updatedAt: new Date().toISOString() });
}

// ── Users ─────────────────────────────────────────────────────
const usersRef = db.collection("users");

async function getUsers() {
  await _authReady;
  const snap = await usersRef.get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function getUserByUsername(username) {
  await _authReady;
  const snap = await usersRef.where("username", "==", username).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

function subscribeUsers(callback) {
  return usersRef.onSnapshot(snap =>
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

async function createUser(data) {
  await _authReady;
  return usersRef.add(data);
}

async function updateUser(id, data) {
  await _authReady;
  return usersRef.doc(id).update(data);
}

async function deleteUser(id) {
  await _authReady;
  return usersRef.doc(id).delete();
}

// ── Team ──────────────────────────────────────────────────────
function subscribeTeam(callback) {
  return teamRef.onSnapshot(snap => {
    TEAM = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (callback) callback(TEAM);
  });
}

async function addMember(data) {
  await _authReady;
  return teamRef.add(data);
}

async function updateMember(id, data) {
  await _authReady;
  return teamRef.doc(id).update(data);
}

async function deleteMember(id) {
  await _authReady;
  return teamRef.doc(id).delete();
}

// ── Projects ──────────────────────────────────────────────────
function subscribeProjects(callback) {
  return projectsRef.onSnapshot(snap => {
    const projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (callback) callback(projects);
  });
}

async function addProject(name) {
  await _authReady;
  return projectsRef.add({ name, createdAt: new Date().toISOString() });
}

async function deleteProject(id) {
  await _authReady;
  return projectsRef.doc(id).delete();
}

// ── Derive effective status (delayed / blocked override stored status)
function computeStatus(task, allTasks) {
  if (task.status === "completed") return "completed";

  if ((task.dependsOn || []).length > 0) {
    const anyBlocking = task.dependsOn.some(depId => {
      const dep = allTasks.find(t => t.id === depId);
      return dep && dep.status !== "completed";
    });
    if (anyBlocking) return "blocked";
  }

  const todayStr = new Date().toISOString().split("T")[0];
  if (task.endDate < todayStr) return "delayed";

  return task.status || "not_started";
}
