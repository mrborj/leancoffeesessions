const loginForm = document.querySelector("[data-login-form]");
const loginPanel = document.querySelector("[data-login-panel]");
const loginError = document.querySelector("[data-login-error]");
const adminStorageKey = "leanCoffeeAdmins";

if (loginForm) {
  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const admins = JSON.parse(localStorage.getItem(adminStorageKey) || "[]");
    const activeAdmins = admins.filter((admin) => !admin.archived);
    const matchingAdmin = activeAdmins.find(
      (admin) => admin.username === username && admin.password === password
    );

    if (matchingAdmin) {
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
      return;
    }

    loginError.textContent = activeAdmins.length
      ? "Invalid username or password."
      : "No admin registration found.";
  });
}
