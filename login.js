const loginForm = document.querySelector("[data-login-form]");
const loginPanel = document.querySelector("[data-login-panel]");
const loginError = document.querySelector("[data-login-error]");
const adminStorageKey = "leanCoffeeAdmins";

async function apiLogin(username, password) {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (response.status === 503 || response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Invalid username or password.");
  return data.admin;
}

function saveAdminSession(matchingAdmin) {
  const role = matchingAdmin.role || "Super Admin";
  const session = role === "Session Admin"
    ? LeanCoffeeSession.sessionForTeam(matchingAdmin.team || matchingAdmin.philipsTeam || matchingAdmin.username)
    : LeanCoffeeSession.defaultSession;
  LeanCoffeeSession.setActiveSession(session);
  sessionStorage.setItem(
    "leanCoffeeAdminSession",
    JSON.stringify({
      id: matchingAdmin.id,
      username: matchingAdmin.username,
      firstName: matchingAdmin.firstName,
      lastName: matchingAdmin.lastName,
      role,
      team: matchingAdmin.team || "",
      sessionId: session.id,
      sessionName: session.name,
    })
  );
  loginPanel.classList.add("is-authenticated");
  window.setTimeout(() => {
    window.location.href = role === "Session Admin" ? "session-admin.html" : "admin.html";
  }, 280);
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");

    try {
      const apiAdmin = await apiLogin(username, password);
      if (apiAdmin) {
        saveAdminSession(apiAdmin);
        return;
      }
    } catch (error) {
      loginError.textContent = error.message;
      return;
    }

    const admins = JSON.parse(localStorage.getItem(adminStorageKey) || "[]");
    const activeAdmins = admins.filter((admin) => !admin.archived);
    const matchingAdmin = activeAdmins.find(
      (admin) => admin.username === username && admin.password === password
    );

    if (matchingAdmin) {
      saveAdminSession(matchingAdmin);
      return;
    }

    loginError.textContent = activeAdmins.length
      ? "Invalid username or password."
      : "No admin registration found.";
  });
}
