const LeanCoffeeSession = (() => {
  const adminSessionKey = "leanCoffeeAdminSession";
  const participantSessionKey = "leanCoffeeParticipantSession";
  const activeSessionKey = "leanCoffeeActiveSession";
  const sessionsKey = "leanCoffeeSessions";
  const defaultSession = {
    id: "master-data",
    name: "Master Data Lean Sessions",
    team: "Master Data",
  };
  const scopedBases = new Set([
    "leanCoffeeParticipants",
    "leanCoffeeTopics",
    "leanCoffeeVotes",
    "leanCoffeeActiveTopic",
    "leanCoffeeTimer",
  ]);

  function slug(value) {
    return String(value || "session")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "session";
  }

  function readJson(storage, key, fallback) {
    try {
      return JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    storage.setItem(key, JSON.stringify(value));
  }

  function sessions() {
    const stored = readJson(localStorage, sessionsKey, []);
    const hasDefault = stored.some((session) => session.id === defaultSession.id);
    return hasDefault ? stored : [defaultSession, ...stored];
  }

  function saveSession(session) {
    const normalized = {
      id: session.id || slug(session.team || session.name),
      name: session.name || `${session.team || "Team"} Lean Sessions`,
      team: session.team || session.name || "Team",
      adminId: session.adminId || "",
      status: session.status || "Not Started",
      archived: Boolean(session.archived),
      createdAt: session.createdAt || new Date().toISOString(),
    };
    const existing = sessions().filter((item) => item.id !== normalized.id);
    writeJson(localStorage, sessionsKey, [normalized, ...existing]);
    return normalized;
  }

  function sessionForTeam(team) {
    return saveSession({
      id: `session-${slug(team)}`,
      name: `${team || "Team"} Lean Sessions`,
      team: team || "Team",
    });
  }

  function adminSession() {
    return readJson(sessionStorage, adminSessionKey, null);
  }

  function participantSession() {
    return readJson(sessionStorage, participantSessionKey, null);
  }

  function activeSession() {
    const active = readJson(sessionStorage, activeSessionKey, null);
    if (active?.id) return active;

    const admin = adminSession();
    if (admin?.sessionId) {
      return saveSession({
        id: admin.sessionId,
        name: admin.sessionName,
        team: admin.team,
      });
    }

    const participant = participantSession();
    if (participant?.sessionId) {
      return saveSession({
        id: participant.sessionId,
        name: participant.sessionName,
        team: participant.sessionTeam,
      });
    }

    return defaultSession;
  }

  function setActiveSession(session) {
    const saved = saveSession(session);
    writeJson(sessionStorage, activeSessionKey, saved);
    return saved;
  }

  function clearActiveSession() {
    sessionStorage.removeItem(activeSessionKey);
  }

  function isDefaultSession() {
    return activeSession().id === defaultSession.id;
  }

  function key(base) {
    if (!scopedBases.has(base)) return base;
    return `${base}:${activeSession().id}`;
  }

  function keyForSession(base, sessionId) {
    if (!scopedBases.has(base)) return base;
    return `${base}:${sessionId}`;
  }

  function getItem(base) {
    const scoped = key(base);
    const value = localStorage.getItem(scoped);
    if (value !== null) return value;
    return isDefaultSession() ? localStorage.getItem(base) : null;
  }

  function setItem(base, value) {
    localStorage.setItem(key(base), value);
  }

  function setItemForSession(base, sessionId, value) {
    localStorage.setItem(keyForSession(base, sessionId), value);
  }

  function removeItem(base) {
    localStorage.removeItem(key(base));
    if (isDefaultSession()) localStorage.removeItem(base);
  }

  function readItems(base) {
    return JSON.parse(getItem(base) || "[]");
  }

  function readItemsForSession(base, sessionId) {
    const value = localStorage.getItem(keyForSession(base, sessionId));
    if (value !== null) return JSON.parse(value);
    return sessionId === defaultSession.id ? JSON.parse(localStorage.getItem(base) || "[]") : [];
  }

  function removeItemForSession(base, sessionId) {
    localStorage.removeItem(keyForSession(base, sessionId));
    if (sessionId === defaultSession.id) localStorage.removeItem(base);
  }

  function writeItems(base, items) {
    setItem(base, JSON.stringify(items));
  }

  return {
    adminSession,
    activeSession,
    clearActiveSession,
    defaultSession,
    key,
    keyForSession,
    getItem,
    readItems,
    readItemsForSession,
    removeItem,
    removeItemForSession,
    participantSession,
    saveSession,
    sessionForTeam,
    sessions,
    setActiveSession,
    setItem,
    setItemForSession,
    writeItems,
  };
})();

window.LeanCoffeeSession = LeanCoffeeSession;
