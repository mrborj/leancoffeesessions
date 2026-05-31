const timerStorageBaseKey = "leanCoffeeTimer";
const timerSession = window.LeanCoffeeSession;
const runtimeStorageKey = "leanCoffeeRuntime";
const runtimePresets = {
  demo: {
    id: "demo",
    name: "Demo Runtime",
    totalMinutes: 12,
    agenda: [
      { title: "Meeting the Entire Team", minutes: 1 },
      { title: "Creating a Topic", minutes: 3 },
      { title: "Discussing Which Topic", minutes: 2 },
      { title: "Meet with all the Teams", minutes: 1 },
      { title: "Discussing and Collaborating", minutes: 4 },
      { title: "Closing and Takeaways", minutes: 1 },
    ],
  },
  standard: {
    id: "standard",
    name: "Runtime",
    totalMinutes: 60,
    agenda: [
      { title: "Meeting the Entire Team", minutes: 3 },
      { title: "Creating a Topic", minutes: 10 },
      { title: "Discussing Which Topic", minutes: 12 },
      { title: "Meet with all the Teams", minutes: 2 },
      { title: "Discussing and Collaborating", minutes: 30 },
      { title: "Closing and Takeaways", minutes: 3 },
    ],
  },
  extended: {
    id: "extended",
    name: "Runtime",
    totalMinutes: 90,
    agenda: [
      { title: "Meeting the Entire Team", minutes: 5 },
      { title: "Creating a Topic", minutes: 10 },
      { title: "Discussing Which Topic", minutes: 10 },
      { title: "Meet with all the Teams", minutes: 5 },
      { title: "Discussing and Collaborating", minutes: 50 },
      { title: "Closing and Takeaways", minutes: 5 },
    ],
  },
};
let activeRuntime = runtimePresets.demo;
let timerDurationSeconds = activeRuntime.totalMinutes * 60;
const timerDisplays = document.querySelectorAll("[data-shared-timer]");
const timerStart = document.querySelector("[data-timer-start]");
const timerPause = document.querySelector("[data-timer-pause]");
const timerResume = document.querySelector("[data-timer-resume]");
const timerReset = document.querySelector("[data-timer-reset]");
let lastCountdownValue = null;
let lastFinalCountdownValue = null;
let backendTimer = null;
let timerWriteInFlight = false;
let startableSessionCache = null;

function runtimeAgenda() {
  return activeRuntime.agenda.map((item) => ({ ...item, seconds: item.minutes * 60 }));
}

function applyRuntime(runtime) {
  activeRuntime = runtimePresets[runtime?.id] || runtime || runtimePresets.demo;
  timerDurationSeconds = activeRuntime.totalMinutes * 60;
  localStorage.setItem(runtimeStorageKey, JSON.stringify(activeRuntime));
}

async function loadRuntime() {
  try {
    const stored = JSON.parse(localStorage.getItem(runtimeStorageKey) || "null");
    if (stored) applyRuntime(stored);
  } catch {}

  try {
    const response = await fetch("/api/runtime");
    if (response.status === 503 || response.status === 404) return;
    const data = await response.json();
    if (data?.runtime) applyRuntime(data.runtime);
  } catch {
    // Use local/default runtime.
  }
}

function currentTimerStorageKey() {
  return timerSession?.key(timerStorageBaseKey) || timerStorageBaseKey;
}

function adminConclusionClosedKey() {
  return `leanCoffeeAdminConclusionClosed:${currentTimerStorageKey()}`;
}

function defaultTimer() {
  return {
    duration: timerDurationSeconds,
    remaining: timerDurationSeconds,
    running: false,
    endAt: null,
    countdownEndAt: null,
    concluded: false,
  };
}

function readTimer() {
  const timer = backendTimer || JSON.parse(
    (timerSession?.getItem(timerStorageBaseKey) || localStorage.getItem(currentTimerStorageKey())) ||
      JSON.stringify(defaultTimer())
  );

  if (timer.duration !== timerDurationSeconds) {
    return defaultTimer();
  }

  return timer;
}

function writeTimer(timer) {
  backendTimer = timer;
  if (timerSession) {
    timerSession.setItem(timerStorageBaseKey, JSON.stringify(timer));
  } else {
    localStorage.setItem(currentTimerStorageKey(), JSON.stringify(timer));
  }
  persistTimer(timer);
}

async function persistTimer(timer) {
  if (!timerSession || timerWriteInFlight) return;
  timerWriteInFlight = true;
  try {
    await fetch("/api/timer", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: timerSession.activeSession().id,
        ...timer,
      }),
    });
  } catch {
    // Local storage remains the fallback when the backend is unavailable.
  } finally {
    timerWriteInFlight = false;
  }
}

async function refreshBackendTimer() {
  if (!timerSession || timerWriteInFlight) return;
  try {
    const sessionId = timerSession.activeSession().id;
    const response = await fetch(`/api/timer?sessionId=${encodeURIComponent(sessionId)}`);
    if (response.status === 503 || response.status === 404) return;
    const data = await response.json();
    if (data?.timer) {
      backendTimer = data.timer;
      timerSession.setItem(timerStorageBaseKey, JSON.stringify(backendTimer));
    }
  } catch {
    // Quiet fallback to local storage.
  }
}

function timerRemaining(timer) {
  if (!timer.running || !timer.endAt) {
    return timer.remaining;
  }

  return Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function renderTimer() {
  let timer = readTimer();
  if (timer.countdownEndAt) {
    const countdown = Math.max(0, Math.ceil((timer.countdownEndAt - Date.now()) / 1000));
    showCountdown(countdown);

    if (countdown === 0) {
      const remaining = timer.remaining || timer.duration || timerDurationSeconds;
      writeTimer({
        duration: timer.duration || timerDurationSeconds,
        remaining,
        running: true,
        endAt: Date.now() + remaining * 1000,
        countdownEndAt: null,
      });
      timer = readTimer();
      hideCountdown();
    }
  } else {
    hideCountdown();
  }

  const remaining = timerRemaining(timer);

  if (timer.running && remaining === 0) {
    timer = { ...timer, remaining: 0, running: false, endAt: null, concluded: true };
    writeTimer(timer);
  }

  if (timer.concluded && !(isAdminLiveView() && sessionStorage.getItem(adminConclusionClosedKey()))) {
    showConclusion();
  } else if (timer.running && remaining <= 5) {
    showFinalCountdown(remaining);
  } else {
    hideConclusion();
  }

  timerDisplays.forEach((display) => {
    display.textContent = formatTimer(remaining);
  });

  window.dispatchEvent(
    new CustomEvent("leanCoffeeTimerTick", {
      detail: {
        timer,
        remaining,
        phase: currentAgendaPhase(timer, remaining),
      },
    })
  );
}

async function startTimer() {
  await loadRuntime();
  const sessions = await loadStartableSessions();
  if (shouldChooseSessionBeforeStart(sessions)) {
    openSessionPicker(sessions);
    return;
  }
  if (sessions.length === 1) timerSession.setActiveSession(sessions[0]);
  beginTimerForActiveSession();
}

function beginTimerForActiveSession() {
  const timer = readTimer();
  const remaining = timerRemaining(timer) || timer.duration || timerDurationSeconds;
  writeTimer({
    duration: timer.duration || timerDurationSeconds,
    remaining,
    running: false,
    endAt: null,
    countdownEndAt: Date.now() + 6000,
    concluded: false,
  });
  sessionStorage.removeItem(adminConclusionClosedKey());
  renderTimer();

  if (document.body.classList.contains("admin-shell")) {
    window.location.href = "admin-live.html";
  }
}

function pauseTimer() {
  const timer = readTimer();
  const remaining = timerRemaining(timer);
  writeTimer({
    duration: timer.duration || timerDurationSeconds,
    remaining,
    running: false,
    endAt: null,
    countdownEndAt: null,
    concluded: timer.concluded || false,
  });
  renderTimer();
}

function resumeTimer() {
  const timer = readTimer();
  const remaining = timerRemaining(timer);
  if (!remaining || timer.concluded) return;
  writeTimer({
    duration: timer.duration || timerDurationSeconds,
    remaining,
    running: true,
    endAt: Date.now() + remaining * 1000,
    countdownEndAt: null,
    concluded: false,
  });
  renderTimer();
}

function resetTimer() {
  writeTimer(defaultTimer());
  sessionStorage.removeItem(adminConclusionClosedKey());
  renderTimer();
  if (isAdminLiveView() && window.location.pathname.toLowerCase().endsWith("/admin-live.html")) {
    const admin = timerSession.adminSession();
    window.location.href = admin?.role === "Session Admin" ? "session-admin.html" : "admin.html";
  }
}

function shouldChooseSessionBeforeStart(sessions) {
  const admin = timerSession?.adminSession();
  return document.body.dataset.adminMode === "session" &&
    admin?.role === "Session Admin" &&
    sessions.length > 1;
}

async function loadStartableSessions() {
  const admin = timerSession?.adminSession();
  if (!admin) return [];
  try {
    const response = await fetch("/api/sessions");
    if (response.ok) {
      const data = await response.json();
      if (data?.sessions) {
        data.sessions.forEach((session) => timerSession.saveSession(session));
        startableSessionCache = filterStartableSessions(data.sessions);
        return startableSessionCache;
      }
    }
  } catch {
    // Fall back to locally known sessions.
  }
  startableSessionCache = filterStartableSessions(timerSession.sessions());
  return startableSessionCache;
}

function filterStartableSessions(sessions) {
  const admin = timerSession?.adminSession();
  if (!admin) return [];
  const archived = JSON.parse(localStorage.getItem("leanCoffeeArchivedResults") || "[]");
  const archivedIds = new Set(archived.map((entry) => entry.sessionId));
  return sessions.filter((session) => {
    const isOwned = session.adminId ? session.adminId === admin.id : session.id === admin.sessionId;
    const isOpen = !session.archived && !archivedIds.has(session.id) && session.status !== "Concluded";
    return isOwned && isOpen;
  });
}

function openSessionPicker(sessions) {
  const element = sessionPickerElement();
  const list = element.querySelector("[data-session-picker-list]");
  list.innerHTML = sessions
    .map(
      (session) => `
        <button type="button" data-session-picker-choice="${escapeTimerHtml(session.id)}">
          <strong>${escapeTimerHtml(session.name)}</strong>
          <span>${escapeTimerHtml(session.status || "Not Started")}</span>
        </button>
      `
    )
    .join("");
  element.hidden = false;
}

function sessionPickerElement() {
  let element = document.querySelector("[data-session-picker]");
  if (!element) {
    element = document.createElement("div");
    element.className = "topic-modal";
    element.dataset.sessionPicker = "";
    element.hidden = true;
    element.innerHTML = `
      <div class="topic-dialog session-picker-dialog">
        <h2>Select Session to Start</h2>
        <p>Choose which active or not-started session should receive this timer.</p>
        <div class="session-picker-list" data-session-picker-list></div>
        <div class="form-actions">
          <button type="button" class="button-secondary" data-session-picker-cancel>Cancel</button>
        </div>
      </div>
    `;
    document.body.append(element);
    element.addEventListener("click", async (event) => {
      if (event.target.closest("[data-session-picker-cancel]")) {
        element.hidden = true;
        return;
      }
      const choice = event.target.closest("[data-session-picker-choice]");
      if (!choice) return;
      const session = (startableSessionCache || []).find((item) => item.id === choice.dataset.sessionPickerChoice);
      if (!session) return;
      timerSession.setActiveSession(session);
      element.hidden = true;
      backendTimer = null;
      await loadRuntime();
      beginTimerForActiveSession();
    });
  }
  return element;
}

function isAdminLiveView() {
  const path = window.location.pathname.toLowerCase();
  return (
    new URLSearchParams(window.location.search).get("admin") === "1" ||
    path.endsWith("/admin.html") ||
    path.endsWith("/session-admin.html") ||
    path.endsWith("/admin-live.html")
  );
}

function participantSession() {
  try {
    return JSON.parse(sessionStorage.getItem("leanCoffeeParticipantSession") || "null");
  } catch {
    return null;
  }
}

function markParticipantCompleted() {
  const session = participantSession();
  if (!session?.id) return;

  fetch(`/api/participants/${encodeURIComponent(session.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventStatus: "Completed" }),
  }).catch(() => {});

  const participants = timerSession.readItems("leanCoffeeParticipants");
  const updatedParticipants = participants.map((participant) =>
    participant.id === session.id ? { ...participant, eventStatus: "Completed" } : participant
  );
  timerSession.writeItems("leanCoffeeParticipants", updatedParticipants);
}

function closeConcludedEvent() {
  if (isAdminLiveView()) {
    const admin = timerSession.adminSession();
    sessionStorage.setItem(adminConclusionClosedKey(), "true");
    window.location.href = admin?.role === "Session Admin" ? "session-admin.html" : "admin.html";
    return;
  }

  markParticipantCompleted();
  sessionStorage.removeItem("leanCoffeeParticipantSession");
  timerSession.clearActiveSession();
  window.location.href = "index.html";
}

function currentAgendaPhase(timer, remaining) {
  const timerAgenda = runtimeAgenda();
  const duration = timer.duration || timerDurationSeconds;
  const elapsed = Math.max(0, duration - remaining);
  let cumulative = 0;

  for (let index = 0; index < timerAgenda.length; index += 1) {
    cumulative += timerAgenda[index].seconds;
    if (elapsed < cumulative) {
      return {
        index,
        title: timerAgenda[index].title,
        completedTitle: index > 0 ? timerAgenda[index - 1].title : "",
      };
    }
  }

  return {
    index: timerAgenda.length,
    title: "Event Complete",
    completedTitle: timerAgenda.at(-1).title,
  };
}

timerStart?.addEventListener("click", startTimer);
timerPause?.addEventListener("click", pauseTimer);
timerResume?.addEventListener("click", resumeTimer);
timerReset?.addEventListener("click", resetTimer);
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-conclusion-close]")) {
    closeConcludedEvent();
  }
});
window.addEventListener("storage", (event) => {
  if (event.key === currentTimerStorageKey()) {
    renderTimer();
  }
});

function countdownElement() {
  let element = document.querySelector("[data-countdown-overlay]");
  if (!element) {
    element = document.createElement("div");
    element.className = "countdown-overlay";
    element.dataset.countdownOverlay = "";
    element.innerHTML = `<div data-countdown-number>5</div>`;
    document.body.append(element);
  }
  return element;
}

function showCountdown(value) {
  if (value <= 0) return;
  const element = countdownElement();
  const number = element.querySelector("[data-countdown-number]");
  const label = value === 1 ? "BEGIN" : String(value - 1);
  element.hidden = false;

  if (lastCountdownValue !== label) {
    number.textContent = label;
    number.classList.remove("is-pulsing");
    window.requestAnimationFrame(() => number.classList.add("is-pulsing"));
    lastCountdownValue = label;
  }
}

function hideCountdown() {
  const element = document.querySelector("[data-countdown-overlay]");
  if (element) element.hidden = true;
  lastCountdownValue = null;
}

function conclusionElement() {
  let element = document.querySelector("[data-conclusion-overlay]");
  if (!element) {
    element = document.createElement("div");
    element.className = "conclusion-overlay";
    element.dataset.conclusionOverlay = "";
    element.innerHTML = `
      <div class="conclusion-message" data-conclusion-message>5</div>
      <div class="confetti-field" data-confetti-field></div>
      <div class="final-summary" data-final-summary></div>
    `;
    document.body.append(element);
  }
  return element;
}

function showFinalCountdown(value) {
  if (value <= 0) return;
  const element = conclusionElement();
  const message = element.querySelector("[data-conclusion-message]");
  element.hidden = false;
  element.classList.remove("is-concluded");

  if (lastFinalCountdownValue !== value) {
    message.textContent = String(value);
    message.classList.remove("is-pulsing");
    window.requestAnimationFrame(() => message.classList.add("is-pulsing"));
    lastFinalCountdownValue = value;
  }
}

function showConclusion() {
  const element = conclusionElement();
  const message = element.querySelector("[data-conclusion-message]");
  element.hidden = false;
  element.classList.add("is-concluded");
  message.textContent = "Concluded";
  renderFinalSummary(element.querySelector("[data-final-summary]"));

  if (!element.dataset.confettiReady) {
    renderConfetti(element.querySelector("[data-confetti-field]"));
    element.dataset.confettiReady = "true";
  }
}

function hideConclusion() {
  const element = document.querySelector("[data-conclusion-overlay]");
  if (element) {
    element.hidden = true;
    element.classList.remove("is-concluded");
    delete element.dataset.confettiReady;
    const field = element.querySelector("[data-confetti-field]");
    if (field) field.innerHTML = "";
  }
  lastFinalCountdownValue = null;
}

function renderConfetti(field) {
  const colors = ["#0b5ed7", "#fff0ba", "#57cfae", "#d66bb1", "#f5a61a", "#765640"];
  field.innerHTML = Array.from({ length: 90 }, (_, index) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.4;
    const duration = 2.2 + Math.random() * 2.1;
    const color = colors[index % colors.length];
    const size = 0.38 + Math.random() * 0.42;
    return `<span style="--x:${left}vw; --delay:${delay}s; --duration:${duration}s; --confetti:${color}; --size:${size}rem"></span>`;
  }).join("");
}

function renderFinalSummary(summary) {
  if (!summary) return;
  const topics = timerSession.readItems("leanCoffeeTopics")
    .flatMap((entry) =>
      entry.topics.map((topic) => ({
        teamNumber: entry.teamNumber,
        teamAssociation: entry.teamAssociation || entry.philipsTeam,
        title: topic.title || "Untitled",
        status: topic.status || "For Further Discussion",
        notes: topic.notes || "",
      }))
    );
  const closeLabel = isAdminLiveView()
    ? "Close and Go Back to Admin Homepage"
    : "Close";

  summary.innerHTML = `
    <h2>Final Event Topics</h2>
    <div class="final-topic-list">
      ${
        topics.length
          ? topics
              .map(
                (topic) => `
                  <article>
                    <strong>${escapeTimerHtml(topic.title)}</strong>
                    <span>Team ${escapeTimerHtml(topic.teamNumber)} | ${escapeTimerHtml(topic.teamAssociation)}</span>
                    <em>${escapeTimerHtml(topic.status)}</em>
                    ${topic.notes ? `<p>${escapeTimerHtml(topic.notes)}</p>` : ""}
                  </article>
                `
              )
              .join("")
          : `<article><strong>No topics submitted.</strong><span>The event concluded without submitted topics.</span></article>`
      }
    </div>
    <button type="button" class="admin-home conclusion-close" data-conclusion-close>${closeLabel}</button>
  `;
}

function escapeTimerHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

loadRuntime().then(() => refreshBackendTimer()).then(renderTimer);
window.setInterval(async () => {
  await loadRuntime();
  await refreshBackendTimer();
  renderTimer();
}, 1000);
