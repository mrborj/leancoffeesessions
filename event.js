const participantBadge = document.querySelector("[data-participant-badge]");
const participantLogout = document.querySelector("[data-participant-logout]");
const roadmap = document.querySelector("[data-roadmap]");
const eventTotal = document.querySelector("[data-event-total]");
const topicModal = document.querySelector("[data-topic-modal]");
const topicForm = document.querySelector("[data-topic-form]");
const openTopicModal = document.querySelector("[data-open-topic-modal]");
const closeTopicModalButtons = document.querySelectorAll("[data-close-topic-modal]");
const openMyTopics = document.querySelector("[data-open-my-topics]");
const myTopicsModal = document.querySelector("[data-my-topics-modal]");
const closeMyTopics = document.querySelector("[data-close-my-topics]");
const myTopicsList = document.querySelector("[data-my-topics-list]");
const agendaNotice = document.querySelector("[data-agenda-notice]");
const sessionWelcome = document.querySelector("[data-session-welcome]");
const currentAgenda = document.querySelector("[data-current-agenda]");
const maxParticipantTopics = 3;
let timerIsRunning = false;
let lastPhaseIndex = null;
let currentPhaseIndex = 0;
const eventSession = window.LeanCoffeeSession;
let backendTopics = null;

const participantStorageKey = "leanCoffeeParticipants";
const topicStorageKey = "leanCoffeeTopics";
const participantSessionKey = "leanCoffeeParticipantSession";
const runtimeStorageKey = "leanCoffeeRuntime";

const agendaDetails = [
  "Round robin quick introduction",
  "Build team-level topics",
  "Decide what reaches final round",
  "Regroup across teams",
  "Work through overall topics",
  "Last-minute takeaways",
];
let activeRuntime = {
  totalMinutes: 12,
  agenda: [
    { title: "Meeting the Entire Team", minutes: 1 },
    { title: "Creating a Topic", minutes: 3 },
    { title: "Discussing Which Topic", minutes: 2 },
    { title: "Meet with all the Teams", minutes: 1 },
    { title: "Discussing and Collaborating", minutes: 4 },
    { title: "Closing and Takeaways", minutes: 1 },
  ],
};

function readItems(key) {
  return eventSession.readItems(key);
}

function writeItems(key, items) {
  eventSession.writeItems(key, items);
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 503 || response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function topicEntries() {
  return backendTopics || readItems(topicStorageKey);
}

async function loadBackendTopics() {
  try {
    const sessionId = eventSession.activeSession().id;
    const data = await apiRequest(`/api/topics?sessionId=${encodeURIComponent(sessionId)}`);
    if (!data) return;
    backendTopics = data.topics;
    const participant = currentParticipant();
    if (participant) updateSubmitTopicVisibility(participant);
    renderMyTopics();
  } catch (error) {
    console.warn(error);
  }
}

async function loadRuntime() {
  try {
    const stored = JSON.parse(localStorage.getItem(runtimeStorageKey) || "null");
    if (stored?.agenda) activeRuntime = stored;
  } catch {}

  try {
    const data = await apiRequest("/api/runtime");
    if (data?.runtime) {
      activeRuntime = data.runtime;
      localStorage.setItem(runtimeStorageKey, JSON.stringify(activeRuntime));
    }
  } catch {
    // Keep local/default runtime.
  }
}

function updateBackendTopicEntry(savedEntry) {
  if (!backendTopics || !savedEntry) return;
  backendTopics = [savedEntry, ...backendTopics.filter((entry) => entry.id !== savedEntry.id)];
}

async function saveTopicEntry(entry) {
  try {
    const data = await apiRequest("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (data?.topic) {
      if (!backendTopics) backendTopics = [];
      updateBackendTopicEntry(data.topic);
      return true;
    }
  } catch (error) {
    alert(error.message);
    return true;
  }

  const entries = readItems(topicStorageKey);
  entries.push(entry);
  writeItems(topicStorageKey, entries);
  return false;
}

async function patchTopic(topicKey, changes) {
  if (!backendTopics) return false;
  try {
    await apiRequest("/api/topics", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicKey, ...changes }),
    });
    return true;
  } catch (error) {
    alert(error.message);
    return true;
  }
}

function participantTopicCount(participantId) {
  return topicEntries()
    .filter((entry) => entry.participantId === participantId)
    .reduce((count, entry) => count + entry.topics.length, 0);
}

function updateSubmitTopicVisibility(participant) {
  const topicLimitReached = participantTopicCount(participant.id) >= maxParticipantTopics;
  openTopicModal.hidden = topicLimitReached;
  openTopicModal.disabled = !timerIsRunning || currentPhaseIndex !== 1 || topicLimitReached;
  openTopicModal.textContent = topicLimitReached ? "Topic Limit Reached" : "Submit a Topic";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function currentParticipant() {
  const session = JSON.parse(sessionStorage.getItem(participantSessionKey) || "null");
  if (!session) return null;
  if (session.sessionId) {
    eventSession.setActiveSession({
      id: session.sessionId,
      name: session.sessionName,
      team: session.sessionTeam,
    });
  }
  if (session.participant) return session.participant;
  return readItems(participantStorageKey).find((participant) => participant.id === session.id && !participant.archived);
}

function renderParticipant(participant) {
  const sessionName = participant.sessionName || eventSession.activeSession().name;
  participantBadge.innerHTML = `
    <strong>${escapeHtml(`${participant.firstName} ${participant.lastName}`)}</strong>
    <span>Team ${escapeHtml(participant.teamNumber)} - ${escapeHtml(participant.philipsTeam)}</span>
  `;
  sessionWelcome.textContent = `Welcome to the Lean Sessions - ${sessionName}`;
}

function renderRoadmap() {
  const agenda = activeRuntime.agenda.map((item, index) => ({
    title: item.title,
    detail: agendaDetails[index] || "",
    label: `${item.minutes} ${item.minutes === 1 ? "min" : "mins"}`,
    icon: String(index + 1).padStart(2, "0"),
  }));
  roadmap.innerHTML = agenda
    .map(
      (item, index) => `
        <article class="roadmap-item ${index % 2 === 0 ? "is-top" : "is-bottom"}">
          <div class="roadmap-copy">
            <div class="roadmap-icon">${escapeHtml(item.icon)}</div>
            <h2>${escapeHtml(item.title)}</h2>
            <p>${escapeHtml(item.detail)}</p>
            <strong>${escapeHtml(item.label)}</strong>
          </div>
          <div class="roadmap-node" aria-hidden="true"></div>
        </article>
      `
    )
    .join("");
  eventTotal.textContent = `Overall event time: ${activeRuntime.totalMinutes} minutes`;
}

participantLogout.addEventListener("click", () => {
  sessionStorage.removeItem(participantSessionKey);
  eventSession.clearActiveSession();
  window.location.href = "index.html";
});

openTopicModal.addEventListener("click", () => {
  if (openTopicModal.disabled) return;
  topicModal.hidden = false;
});

closeTopicModalButtons.forEach((button) => {
  button.addEventListener("click", () => {
    topicModal.hidden = true;
    topicForm.reset();
  });
});

openMyTopics.addEventListener("click", () => {
  renderMyTopics();
  myTopicsModal.hidden = false;
});

closeMyTopics.addEventListener("click", () => {
  myTopicsModal.hidden = true;
});

topicForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const participant = currentParticipant();
  if (!participant) {
    window.location.href = "begin.html";
    return;
  }

  const formData = new FormData(topicForm);
  const topics = [1, 2, 3]
    .map((number) => ({
      title: String(formData.get(`topic${number}`) || "").trim(),
      details: String(formData.get(`details${number}`) || "").trim(),
    }))
    .filter((topic) => topic.title || topic.details);
  const remainingSlots = maxParticipantTopics - participantTopicCount(participant.id);
  const acceptedTopics = topics.slice(0, Math.max(remainingSlots, 0));

  if (!acceptedTopics.length) {
    topicForm.reset();
    topicModal.hidden = true;
    updateSubmitTopicVisibility(participant);
    renderMyTopics();
    return;
  }

  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    participantId: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    participantName: `${participant.firstName} ${participant.lastName}`,
    teamNumber: participant.teamNumber,
    teamAssociation: participant.businessUnit || participant.specificTeam || participant.philipsTeam,
    philipsTeam: participant.philipsTeam,
    sessionId: eventSession.activeSession().id,
    sessionName: eventSession.activeSession().name,
    topics: acceptedTopics,
  };
  await saveTopicEntry(entry);

  topicForm.reset();
  topicModal.hidden = true;
  updateSubmitTopicVisibility(participant);
  renderMyTopics();
});

function renderMyTopics() {
  const participant = currentParticipant();
  if (!participant) return;

  const entries = topicEntries().filter((entry) => entry.participantId === participant.id);
  myTopicsList.innerHTML = entries.length
    ? entries
        .map(
          (entry) => `
            <article class="topic-entry">
              <div class="topic-entry__meta">
                ${escapeHtml(entry.firstName)} ${escapeHtml(entry.lastName)}
                - Team ${escapeHtml(entry.teamNumber)}
                - ${escapeHtml(entry.teamAssociation || entry.philipsTeam)}
              </div>
              <div class="topic-entry__grid">
                ${
                  entry.topics.length
                    ? entry.topics
                        .map(
                          (topic, index) => `
                            <section class="topic-entry__item" data-topic-entry="${entry.id}" data-topic-index="${index}">
                              <h3>Topic ${index + 1}: ${escapeHtml(topic.title || "Untitled")}</h3>
                              <p>${escapeHtml(topic.details || "No additional details.")}</p>
                              <div class="topic-edit-fields" hidden>
                                <label>
                                  Topic
                                  <input name="topicTitle" value="${escapeHtml(topic.title || "")}" />
                                </label>
                                <label>
                                  Details
                                  <textarea name="topicDetails" rows="3">${escapeHtml(topic.details || "")}</textarea>
                                </label>
                              </div>
                              <div class="topic-item-actions">
                                <button type="button" data-my-topic-action="edit">Edit</button>
                                <button type="button" data-my-topic-action="save" hidden>Save</button>
                                <button type="button" data-my-topic-action="delete">Delete</button>
                              </div>
                            </section>
                          `
                        )
                        .join("")
                    : `<section class="topic-entry__item"><h3>No topic text provided</h3><p>This submission was saved without topic details.</p></section>`
                }
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="archive-item archive-item--empty">No submitted topics yet.</div>`;
}

myTopicsList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-my-topic-action]");
  if (!button) return;

  const item = button.closest("[data-topic-entry]");
  const entryId = item.dataset.topicEntry;
  const topicIndex = Number(item.dataset.topicIndex);
  const action = button.dataset.myTopicAction;

  if (action === "edit") {
    item.querySelector(".topic-edit-fields").hidden = false;
    item.querySelector('[data-my-topic-action="edit"]').hidden = true;
    item.querySelector('[data-my-topic-action="save"]').hidden = false;
    return;
  }

  const entries = topicEntries();
  const entry = entries.find((topicEntry) => topicEntry.id === entryId);
  if (!entry) return;
  const topicKey = `${entryId}:${topicIndex}`;

  if (action === "save") {
    const title = item.querySelector('[name="topicTitle"]').value.trim();
    const details = item.querySelector('[name="topicDetails"]').value.trim();
    await patchTopic(topicKey, { title, details });
    entry.topics[topicIndex] = { ...entry.topics[topicIndex], title, details };
  }

  if (action === "delete") {
    await patchTopic(topicKey, { archived: true });
    entry.topics.splice(topicIndex, 1);
  }

  const nextEntries = entries.filter((topicEntry) => topicEntry.topics.length > 0);
  if (backendTopics) {
    backendTopics = nextEntries;
  } else {
    writeItems(topicStorageKey, nextEntries);
  }
  const participant = currentParticipant();
  if (participant) updateSubmitTopicVisibility(participant);
  renderMyTopics();
});

const participant = currentParticipant();
if (!participant) {
  window.location.href = "begin.html";
} else {
  renderParticipant(participant);
  loadRuntime().then(renderRoadmap);
  updateSubmitTopicVisibility(participant);
  renderMyTopics();
  loadBackendTopics();
}

window.addEventListener("leanCoffeeTimerTick", (event) => {
  const participant = currentParticipant();
  if (!participant) return;

  timerIsRunning = event.detail.timer.running;
  currentPhaseIndex = event.detail.phase.index;
  currentAgenda.textContent = event.detail.phase.title;
  updateSubmitTopicVisibility(participant);

  const phaseIndex = event.detail.phase.index;
  if (phaseIndex === 2) {
    window.location.href = "team-vote.html";
    return;
  }

  if (phaseIndex >= 3 && phaseIndex < 6) {
    window.location.href = "collaboration.html";
    return;
  }

  if (lastPhaseIndex === null) {
    lastPhaseIndex = phaseIndex;
    return;
  }

  if (phaseIndex > lastPhaseIndex && event.detail.phase.completedTitle) {
    showAgendaNotice(`${event.detail.phase.completedTitle} is complete. Please move to ${event.detail.phase.title}.`);
  }

  lastPhaseIndex = phaseIndex;
});

function showAgendaNotice(message) {
  agendaNotice.textContent = message;
  agendaNotice.hidden = false;
  agendaNotice.classList.add("is-visible");
  window.setTimeout(() => {
    agendaNotice.classList.remove("is-visible");
    window.setTimeout(() => {
      agendaNotice.hidden = true;
    }, 350);
  }, 5000);
}
