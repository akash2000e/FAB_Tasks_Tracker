const _SESSION_KEY = "fablab_session";

async function _sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashPasswordForStorage(password) {
  return _sha256(password);
}

async function loginUser(username, password) {
  const user = await getUserByUsername(username.trim().toLowerCase());
  if (!user) return { ok: false, error: "Username not found" };
  const hash = await _sha256(password);
  if (hash !== user.passwordHash) return { ok: false, error: "Incorrect password" };
  const session = {
    userId:      user.id,
    memberId:    user.memberId || "",
    username:    user.username,
    displayName: user.displayName || user.username,
    isAdmin:     user.isAdmin === true,
  };
  localStorage.setItem(_SESSION_KEY, JSON.stringify(session));
  return { ok: true };
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(_SESSION_KEY)); } catch { return null; }
}

function isAuthenticated()  { return !!getSession(); }
function getCurrentUser()   { return getSession(); }
function getCurrentMember() { return getSession()?.memberId || ""; }
function isAdminUser()      { return getSession()?.isAdmin === true; }

function logout() {
  localStorage.removeItem(_SESSION_KEY);
  location.reload();
}
