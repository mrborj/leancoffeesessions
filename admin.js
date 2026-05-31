const participantForm = document.querySelector("[data-participant-form]");
const adminForm = document.querySelector("[data-admin-form]");
const participantList = document.querySelector("[data-participant-list]");
const adminList = document.querySelector("[data-admin-list]");
const archivedParticipants = document.querySelector("[data-archived-participants]");
const archivedAdmins = document.querySelector("[data-archived-admins]");
const teamSelect = document.querySelector("[data-team-select]");
const businessUnitField = document.querySelector("[data-business-unit-field]");
const otherTeamField = document.querySelector("[data-other-team-field]");
const paneLinks = document.querySelectorAll("[data-pane-target]");
const paneContents = document.querySelectorAll("[data-pane]");
const topicList = document.querySelector("[data-topic-list]");
const adminLogout = document.querySelector("[data-admin-logout]");
const topicGroupButtons = document.querySelectorAll("[data-topic-group]");
const archiveSessionSelect = document.querySelector("[data-archive-session]");
const archiveResultsButton = document.querySelector("[data-archive-results]");
const archivedResults = document.querySelector("[data-archived-results]");
const activeArchivePreview = document.querySelector("[data-active-archive-preview]");
const topicSessionFilter = document.querySelector("[data-topic-session-filter]");
const kpiGrid = document.querySelector("[data-kpi-grid]");
const viewSessionSelect = document.querySelector("[data-view-session-select]");
const viewSessionArchive = document.querySelector("[data-view-session-archive]");
const sessionOverview = document.querySelector("[data-session-overview]");
const kpiDateFilter = document.querySelector("[data-kpi-date-filter]");
const kpiAdminFilter = document.querySelector("[data-kpi-admin-filter]");
let topicGroupMode = "all";
const expandedAdmins = new Set();

const storageKeys = {
  participants: "leanCoffeeParticipants",
  admins: "leanCoffeeAdmins",
  topics: "leanCoffeeTopics",
  votes: "leanCoffeeVotes",
  activeTopic: "leanCoffeeActiveTopic",
  archivedResults: "leanCoffeeArchivedResults",
  timer: "leanCoffeeTimer",
};

const adminSession = LeanCoffeeSession.adminSession();
const isSessionAdminPage = document.body.dataset.adminMode === "session";
if (!adminSession) {
  window.location.href = "login.html";
} else if (adminSession.role === "Session Admin" && !isSessionAdminPage) {
  window.location.href = "session-admin.html";
} else if (adminSession.role !== "Session Admin" && isSessionAdminPage) {
  window.location.href = "admin.html";
}
if (adminSession?.sessionId) {
  LeanCoffeeSession.setActiveSession({
    id: adminSession.sessionId,
    name: adminSession.sessionName,
    team: adminSession.team,
  });
}

const readItems = (key) => LeanCoffeeSession.readItems(key);
const writeItems = (key, items) => LeanCoffeeSession.writeItems(key, items);
const id = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const isSuperAdmin = adminSession?.role !== "Session Admin";
let backendAdmins = null;
let backendSessions = null;
let backendParticipants = null;
let backendTopics = null;
let backendVotes = null;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 503 || response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadBackendAdmins() {
  try {
    const [adminData, sessionData, participantData, topicData, voteData] = await Promise.all([
      apiRequest("/api/admins"),
      apiRequest("/api/sessions"),
      apiRequest("/api/participants"),
      apiRequest("/api/topics"),
      apiRequest("/api/votes"),
    ]);
    if (adminData) backendAdmins = adminData.admins;
    if (sessionData) {
      backendSessions = sessionData.sessions;
      backendSessions.forEach((session) => LeanCoffeeSession.saveSession(session));
    }
    if (participantData) backendParticipants = participantData.participants;
    if (topicData) backendTopics = topicData.topics;
    if (voteData) backendVotes = voteData.votes;
    render();
    renderKpis();
    renderSessionOverview();
  } catch (error) {
    console.warn(error);
  }
}

function adminItems() {
  return backendAdmins || readItems(storageKeys.admins);
}

function participantItems() {
  return backendParticipants || null;
}

function sessionItemsSource() {
  return backendSessions || LeanCoffeeSession.sessions();
}

function visibleSessions() {
  const sessions = sessionItemsSource();
  const archivedIds = new Set(JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]").map((entry) => entry.sessionId));
  const activeSessions = sessions.filter((session) => !archivedIds.has(session.id));
  return isSuperAdmin
    ? activeSessions
    : activeSessions.filter((session) => session.id === LeanCoffeeSession.activeSession().id);
}

function selectedTopicSessions() {
  if (!isSuperAdmin || !topicSessionFilter || topicSessionFilter.value === "all") {
    return visibleSessions();
  }
  return visibleSessions().filter((session) => session.id === topicSessionFilter.value);
}

function sessionItems(key, session) {
  if (key === storageKeys.participants && backendParticipants) {
    return backendParticipants
      .filter((participant) => participant.sessionId === session.id)
      .map((participant) => ({
        ...participant,
        sessionId: participant.sessionId || session.id,
        sessionName: participant.sessionName || session.name,
      }));
  }
  if (key === storageKeys.topics && backendTopics) {
    return backendTopics
      .filter((topic) => topic.sessionId === session.id)
      .map((topic) => ({
        ...topic,
        sessionId: topic.sessionId || session.id,
        sessionName: topic.sessionName || session.name,
      }));
  }
  if (key === storageKeys.votes && backendVotes) {
    return backendVotes
      .filter((vote) => vote.sessionId === session.id)
      .map((vote) => ({
        ...vote,
        sessionId: vote.sessionId || session.id,
        sessionName: vote.sessionName || session.name,
      }));
  }
  return LeanCoffeeSession.readItemsForSession(key, session.id).map((item) => ({
    ...item,
    sessionId: item.sessionId || session.id,
    sessionName: item.sessionName || session.name,
  }));
}

function sessionDate(session) {
  return session.createdAt ? new Date(session.createdAt).toLocaleDateString() : "No Date";
}

function topicSessions() {
  return visibleSessions().filter((session) => sessionItems(storageKeys.topics, session).length > 0);
}

function sessionAdminSessionId(admin) {
  return sessionIdForName(admin.team || admin.username);
}

function sessionCountForAdmin(admin) {
  if ((admin.role || "Super Admin") !== "Session Admin") return 0;
  const sessionId = sessionAdminSessionId(admin);
  const activeCount = sessionItemsSource().some((session) => session.id === sessionId) ? 1 : 0;
  const archivedCount = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]")
    .filter((entry) => entry.sessionId === sessionId).length;
  return activeCount + archivedCount;
}

function allVisibleItems(key) {
  return visibleSessions().flatMap((session) => sessionItems(key, session));
}

function setConditionalFields() {
  const team = teamSelect.value;
  businessUnitField.hidden = team !== "Comm Sales";
  otherTeamField.hidden = team !== "Other";
  businessUnitField.querySelector("input").required = team === "Comm Sales";
  otherTeamField.querySelector("input").required = team === "Other";
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

async function saveParticipant(event) {
  event.preventDefault();
  const participants = readItems(storageKeys.participants);
  const team = formValue(participantForm, "philipsTeam");

  const participant = {
    id: id(),
    email: formValue(participantForm, "email"),
    firstName: formValue(participantForm, "firstName"),
    lastName: formValue(participantForm, "lastName"),
    philipsTeam: team,
    teamNumber: formValue(participantForm, "teamNumber"),
    password: formValue(participantForm, "password"),
    businessUnit: team === "Comm Sales" ? formValue(participantForm, "businessUnit") : "",
    specificTeam: team === "Other" ? formValue(participantForm, "specificTeam") : "",
    sessionId: LeanCoffeeSession.activeSession().id,
    sessionName: LeanCoffeeSession.activeSession().name,
    eventStatus: formValue(participantForm, "eventStatus") || "Not Started",
    archived: false,
  };

  try {
    const data = await apiRequest("/api/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(participant),
    });
    if (data?.participant) {
      backendParticipants = [data.participant, ...(backendParticipants || [])];
      participantForm.reset();
      setConditionalFields();
      render();
      return;
    }
  } catch (error) {
    alert(error.message);
    return;
  }

  participants.push(participant);

  writeItems(storageKeys.participants, participants);
  participantForm.reset();
  setConditionalFields();
  render();
}

async function saveAdmin(event) {
  event.preventDefault();
  const admins = readItems(storageKeys.admins);
  const role = formValue(adminForm, "role") || "Super Admin";
  const team = formValue(adminForm, "team");
  if (role === "Session Admin") LeanCoffeeSession.sessionForTeam(team || formValue(adminForm, "username"));

  const admin = {
    id: id(),
    username: formValue(adminForm, "username"),
    firstName: formValue(adminForm, "firstName"),
    lastName: formValue(adminForm, "lastName"),
    password: formValue(adminForm, "password"),
    role,
    team,
    archived: false,
  };

  try {
    const data = await apiRequest("/api/admins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(admin),
    });
    if (data?.admin) {
      backendAdmins = [data.admin, ...(backendAdmins || [])];
      if (data.admin.sessionId) {
        const session = LeanCoffeeSession.saveSession({
          id: data.admin.sessionId,
          name: data.admin.sessionName,
          team: data.admin.team,
        });
        backendSessions = [session, ...(backendSessions || []).filter((item) => item.id !== session.id)];
      }
      adminForm.reset();
      render();
      return;
    }
  } catch (error) {
    alert(error.message);
    return;
  }

  admins.push(admin);

  writeItems(storageKeys.admins, admins);
  adminForm.reset();
  render();
}

function inputCell(value, name, type = "text") {
  return `<input class="table-input" name="${name}" type="${type}" value="${escapeHtml(value)}" />`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderParticipants() {
  const participants = backendParticipants
    ? (isSuperAdmin ? backendParticipants : backendParticipants.filter((participant) => participant.sessionId === LeanCoffeeSession.activeSession().id))
    : (isSuperAdmin ? allVisibleItems(storageKeys.participants) : readItems(storageKeys.participants));
  const active = participants.filter((participant) => !participant.archived);

  participantList.innerHTML = active.length
    ? active
        .map((participant) => {
          const extra = participant.businessUnit || participant.specificTeam || "";
          return `
            <tr data-id="${participant.id}" data-session-id="${escapeHtml(participant.sessionId || LeanCoffeeSession.activeSession().id)}" data-type="participant">
              <td data-field="email">${escapeHtml(participant.email)}</td>
              <td data-field="name">${escapeHtml(`${participant.firstName} ${participant.lastName}`)}</td>
              <td data-field="philipsTeam">${escapeHtml(participant.philipsTeam)}</td>
              <td data-field="teamNumber">${escapeHtml(participant.teamNumber)}</td>
              <td data-field="extra">${escapeHtml(extra)}</td>
              <td data-field="sessionName">${escapeHtml(participant.sessionName || LeanCoffeeSession.activeSession().name)}</td>
              <td data-field="eventStatus">${escapeHtml(participant.eventStatus || "Not Started")}</td>
              <td class="row-actions">
                <button type="button" data-action="edit">Edit</button>
                <button type="button" data-action="save" hidden>Save</button>
                <button type="button" data-action="archive">Archive</button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-cell">No participants registered yet.</td></tr>`;

  archivedParticipants.innerHTML = renderArchive(
    participants.filter((participant) => participant.archived),
    (participant) => {
      const extra = participant.businessUnit || participant.specificTeam || "No extra detail";
      return `${participant.email} - ${participant.firstName} ${participant.lastName} - ${participant.philipsTeam} - Team ${participant.teamNumber} - ${extra} - ${participant.sessionName || LeanCoffeeSession.activeSession().name} - ${participant.eventStatus || "Not Started"}`;
    },
    storageKeys.participants
  );
}

function renderAdmins() {
  if (!adminList || !archivedAdmins) return;
  const admins = adminItems();
  const active = admins.filter((admin) => !admin.archived);

  adminList.innerHTML = active.length
    ? active
        .map((admin) => {
          const sessionCount = sessionCountForAdmin(admin);
          const isExpanded = expandedAdmins.has(admin.id);
          return `
            <tr data-id="${admin.id}" data-type="admin">
              <td data-field="username">${escapeHtml(admin.username)}</td>
              <td data-field="firstName">${escapeHtml(admin.firstName)}</td>
              <td data-field="lastName">${escapeHtml(admin.lastName)}</td>
              <td data-field="password">${escapeHtml(admin.password)}</td>
              <td data-field="role">${escapeHtml(admin.role || "Super Admin")}</td>
              <td data-field="team">${escapeHtml(admin.team || "")}</td>
              <td>${escapeHtml(sessionCount)}</td>
              <td>
                ${escapeHtml(adminEventStatus(admin))}
                ${(admin.role || "Super Admin") === "Session Admin" ? `<button type="button" class="inline-expand" data-toggle-admin-sessions="${escapeHtml(admin.id)}">${isExpanded ? "-" : "+"}</button>` : ""}
              </td>
              <td class="row-actions">
                <button type="button" data-action="edit">Edit</button>
                <button type="button" data-action="save" hidden>Save</button>
                <button type="button" data-action="archive">Archive</button>
              </td>
            </tr>
            ${isExpanded ? renderAdminSessionDetails(admin) : ""}
          `
        })
        .join("")
    : `<tr><td colspan="9" class="empty-cell">No admins registered yet.</td></tr>`;

  archivedAdmins.innerHTML = renderArchive(
    admins.filter((admin) => admin.archived),
    (admin) => `${admin.username} - ${admin.firstName} ${admin.lastName} - Password: ${admin.password} - ${admin.role || "Super Admin"} - ${admin.team || "No team"}`,
    storageKeys.admins
  );
}

function renderAdminSessionDetails(admin) {
  const sessionId = sessionAdminSessionId(admin);
  const activeSessions = sessionItemsSource().filter((session) => session.id === sessionId);
  const archives = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]")
    .filter((entry) => entry.sessionId === sessionId)
    .map((entry) => ({
      id: entry.sessionId,
      name: entry.sessionName,
      status: "Concluded",
      createdAt: entry.archivedAt,
    }));
  const sessions = [
    ...activeSessions.map((session) => ({ ...session, status: sessionStatus(session), createdAt: sessionDate(session) })),
    ...archives,
  ];

  return `
    <tr class="admin-session-detail">
      <td colspan="9">
        ${
          sessions.length
            ? sessions
                .map(
                  (session) => `
                    <div class="archive-item">
                      ${escapeHtml(session.name)} - ${escapeHtml(session.status)} - ${escapeHtml(session.createdAt || "No Date")}
                    </div>
                  `
                )
                .join("")
            : `<div class="archive-item archive-item--empty">No sessions created yet.</div>`
        }
      </td>
    </tr>
  `;
}

function sessionIdForName(name) {
  return LeanCoffeeSession.sessionForTeam(name || "Master Data").id;
}

function adminEventStatus(admin) {
  if ((admin.role || "Super Admin") !== "Session Admin") return "Super Admin";
  const sessionId = sessionIdForName(admin.team || admin.username);
  const backendSession = backendSessions?.find((session) => session.id === sessionId);
  if (backendSession?.status === "Concluded") return "Concluded";
  if (backendSession?.status === "Ongoing") return "Ongoing";
  const archived = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]");
  if (archived.some((entry) => entry.sessionId === sessionId)) return "Concluded";

  const timer = JSON.parse(localStorage.getItem(LeanCoffeeSession.keyForSession(storageKeys.timer, sessionId)) || "null");
  if (!timer) return "Not Started";
  if (timer.concluded) return "Concluded";
  if (timer.running || timer.countdownEndAt || timer.remaining < timer.duration) return "Ongoing";
  return "Not Started";
}

function sessionStatus(session) {
  if (session.status === "Concluded") return "Concluded";
  if (session.status === "Ongoing") return "Active";
  const archived = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]");
  if (archived.some((entry) => entry.sessionId === session.id)) return "Concluded";

  const timer = JSON.parse(localStorage.getItem(LeanCoffeeSession.keyForSession(storageKeys.timer, session.id)) || "null");
  if (!timer) return "Not Started";
  if (timer.concluded) return "Concluded";
  if (timer.running || timer.countdownEndAt || timer.remaining < timer.duration) return "Active";
  return "Not Started";
}

function renderTopics() {
  const topics = selectedTopicSessions().flatMap((session) => sessionItems(storageKeys.topics, session));

  if (!topics.length) {
    topicList.innerHTML = `<div class="archive-item archive-item--empty">No topics submitted yet.</div>`;
    return;
  }

  if (topicGroupMode === "all") {
    topicList.innerHTML = topics
        .map(
          (entry) => `
            <article class="topic-entry">
              <div class="topic-entry__meta">
                ${escapeHtml(entry.firstName || entry.participantName?.split(" ")[0] || "")}
                ${escapeHtml(entry.lastName || entry.participantName?.split(" ").slice(1).join(" ") || "")}
                - Session ${escapeHtml(entry.sessionName || LeanCoffeeSession.activeSession().name)}
                - Team ${escapeHtml(entry.teamNumber)}
                - ${escapeHtml(entry.teamAssociation || entry.philipsTeam)}
              </div>
              <div class="topic-entry__grid">
                ${entry.topics
                  .map(
                    (topic, index) => `
                      <section class="topic-entry__item">
                        <h3>Topic ${index + 1}: ${escapeHtml(topic.title || "Untitled")}</h3>
                        <p>${escapeHtml(topic.details || "No additional details.")}</p>
                        <small>
                          ${escapeHtml(entry.firstName || "")}
                          ${escapeHtml(entry.lastName || "")}
                          | Session ${escapeHtml(entry.sessionName || LeanCoffeeSession.activeSession().name)}
                          | Team ${escapeHtml(entry.teamNumber)}
                          | ${escapeHtml(entry.teamAssociation || entry.philipsTeam)}
                        </small>
                      </section>
                    `
                  )
                  .join("")}
              </div>
            </article>
          `
        )
        .join("");
    return;
  }

  const label = topicGroupMode === "teamNumber" ? "Team Number" : "Team Associated";
  const groupedTopics = topics.reduce((groups, entry) => {
    const key = topicGroupMode === "teamNumber"
      ? `Team ${entry.teamNumber || "Unassigned"}`
      : entry.teamAssociation || entry.philipsTeam || "Unassigned";
    groups[key] = groups[key] || [];
    groups[key].push(entry);
    return groups;
  }, {});

  topicList.innerHTML = Object.entries(groupedTopics)
    .map(
      ([group, entries]) => `
        <article class="topic-entry topic-entry--group">
          <div class="topic-entry__meta">${escapeHtml(label)}: ${escapeHtml(group)}</div>
          <div class="topic-list">
            ${entries
              .map(
                (entry) => `
                  <section class="topic-entry__item">
                    <h3>${escapeHtml(entry.firstName || "")} ${escapeHtml(entry.lastName || "")}</h3>
                    <p>Session ${escapeHtml(entry.sessionName || LeanCoffeeSession.activeSession().name)} | Team ${escapeHtml(entry.teamNumber)} | ${escapeHtml(entry.teamAssociation || entry.philipsTeam)}</p>
                    <small>${entry.topics.map((topic) => escapeHtml(topic.title || topic.details || "Untitled")).join(" | ") || "No topic text provided"}</small>
                  </section>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function availableArchiveSessions() {
  return visibleSessions();
}

function renderTopicFilterOptions() {
  if (!topicSessionFilter) return;
  const sessions = topicSessions();
  if (!sessions.length) {
    topicSessionFilter.innerHTML = `<option value="">No Topics Available</option>`;
    topicSessionFilter.disabled = true;
    return;
  }
  topicSessionFilter.disabled = false;
  topicSessionFilter.innerHTML = [
    isSuperAdmin ? `<option value="all">All Sessions</option>` : "",
    ...sessions.map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(session.name)}</option>`),
  ].join("");
}

function renderArchiveOptions() {
  if (!archiveSessionSelect) return;
  const sessions = availableArchiveSessions();
  archiveSessionSelect.innerHTML = sessions
    .map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(session.name)}</option>`)
    .join("");
}

function renderActiveArchivePreview() {
  if (!activeArchivePreview || !archiveSessionSelect) return;
  const session = sessionItemsSource().find((item) => item.id === archiveSessionSelect.value);
  if (!session) {
    activeArchivePreview.innerHTML = "";
    return;
  }
  const topics = sessionItems(storageKeys.topics, session);
  const votes = sessionItems(storageKeys.votes, session);
  activeArchivePreview.innerHTML = `
    <article class="topic-entry">
      <div class="topic-entry__meta">
        Current Results - ${escapeHtml(session.name)}
        - ${escapeHtml(topics.length)} topic submissions
        - ${escapeHtml(votes.length)} votes
      </div>
      <div class="topic-entry__grid">
        ${
          topics
            .flatMap((submission) =>
              submission.topics.map(
                (topic) => `
                  <section class="topic-entry__item">
                    <h3>${escapeHtml(topic.title || "Untitled")}</h3>
                    <p>${escapeHtml(topic.details || topic.notes || "No additional details.")}</p>
                    <small>${escapeHtml(submission.firstName || "")} ${escapeHtml(submission.lastName || "")} | Team ${escapeHtml(submission.teamNumber || "")}</small>
                  </section>
                `
              )
            )
            .join("") || `<section class="topic-entry__item"><h3>No active topics</h3><p>This session has no current topics to archive.</p></section>`
        }
      </div>
    </article>
  `;
}

function renderArchivedResults() {
  if (!archivedResults) return;
  const archives = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]");
  const visibleArchives = adminSession?.role === "Session Admin"
    ? archives.filter((entry) => entry.sessionId === LeanCoffeeSession.activeSession().id)
    : archives;

  archivedResults.innerHTML = visibleArchives.length
    ? visibleArchives
        .map(
          (entry) => `
            <article class="topic-entry">
              <div class="topic-entry__meta">
                <span>
                  ${escapeHtml(entry.sessionName)} - archived ${escapeHtml(entry.archivedAt)}
                  - ${escapeHtml(entry.topics.length)} topic submissions
                  - ${escapeHtml(entry.votes.length)} votes
                </span>
                <button type="button" class="button-secondary archive-delete" data-delete-archive-record="${escapeHtml(entry.id)}">Delete</button>
              </div>
              <div class="topic-entry__grid">
                ${entry.topics
                  .flatMap((submission) =>
                    submission.topics.map(
                      (topic) => `
                        <section class="topic-entry__item">
                          <h3>${escapeHtml(topic.title || "Untitled")}</h3>
                          <p>${escapeHtml(topic.details || topic.notes || "No additional details.")}</p>
                          <small>${escapeHtml(submission.firstName || "")} ${escapeHtml(submission.lastName || "")} | Team ${escapeHtml(submission.teamNumber || "")}</small>
                        </section>
                      `
                    )
                  )
                  .join("") || `<section class="topic-entry__item"><h3>No topics archived</h3><p>This session had no submitted topics.</p></section>`}
              </div>
            </article>
          `
        )
        .join("")
    : `<div class="archive-item archive-item--empty">No archived topics or votes yet.</div>`;
}

function renderSessionOptions() {
  if (!viewSessionSelect) return;
  const sessions = visibleSessions();
  if (!sessions.length) {
    viewSessionSelect.innerHTML = `<option value="">No Active Sessions Available</option>`;
    viewSessionSelect.disabled = true;
    if (viewSessionArchive) viewSessionArchive.disabled = true;
    return;
  }
  viewSessionSelect.disabled = false;
  if (viewSessionArchive) viewSessionArchive.disabled = false;
  viewSessionSelect.innerHTML = sessions
    .map((session) => `<option value="${escapeHtml(session.id)}">${escapeHtml(session.name)} - ${escapeHtml(sessionStatus(session))}</option>`)
    .join("");
}

function renderSessionOverview() {
  if (!sessionOverview || !viewSessionSelect) return;
  if (!viewSessionSelect.value) {
    sessionOverview.innerHTML = `<div class="archive-item archive-item--empty">No active sessions available.</div>`;
    return;
  }
  const session = visibleSessions().find((item) => item.id === viewSessionSelect.value) || visibleSessions()[0];
  if (!session) {
    sessionOverview.innerHTML = `<div class="archive-item archive-item--empty">No sessions available.</div>`;
    return;
  }

  const participants = backendParticipants
    ? backendParticipants.filter((participant) => participant.sessionId === session.id)
    : LeanCoffeeSession.readItemsForSession(storageKeys.participants, session.id);
  const topics = sessionItems(storageKeys.topics, session);
  const votes = sessionItems(storageKeys.votes, session);
  const admins = adminItems().filter((admin) => sessionIdForName(admin.team || admin.username) === session.id);
  const topicTitles = topics.flatMap((entry) =>
    entry.topics.map((topic, index) => ({
      key: `${entry.id}:${index}`,
      title: topic.title || topic.details || "Untitled",
    }))
  );

  sessionOverview.innerHTML = `
    <article class="session-summary">
      <div class="kpi-grid">
        <article class="kpi-card"><span>Status</span><strong>${escapeHtml(sessionStatus(session))}</strong></article>
        <article class="kpi-card"><span>Participants</span><strong>${escapeHtml(participants.filter((participant) => !participant.archived).length)}</strong></article>
        <article class="kpi-card"><span>Topic Submissions</span><strong>${escapeHtml(topics.length)}</strong></article>
        <article class="kpi-card"><span>Votes</span><strong>${escapeHtml(votes.length)}</strong></article>
      </div>
    </article>
    <article class="topic-entry">
      <div class="topic-entry__meta">Session Admins</div>
      <div class="topic-entry__grid">
        ${
          admins.length
            ? admins
                .map(
                  (admin) => `
                    <section class="topic-entry__item">
                      <h3>${escapeHtml(admin.firstName || admin.username)} ${escapeHtml(admin.lastName || "")}</h3>
                      <p>${escapeHtml(admin.username)}</p>
                      <small>${escapeHtml(admin.role || "Session Admin")}</small>
                    </section>
                  `
                )
                .join("")
            : `<section class="topic-entry__item"><h3>No Session Admin</h3><p>No admin is assigned to this session.</p></section>`
        }
      </div>
    </article>
    <article class="topic-entry">
      <div class="topic-entry__meta">Participants</div>
      <div class="topic-entry__grid">
        ${
          participants.length
            ? participants
                .map(
                  (participant) => `
                    <section class="topic-entry__item">
                      <h3>${escapeHtml(participant.firstName || "")} ${escapeHtml(participant.lastName || "")}</h3>
                      <p>${escapeHtml(participant.email || "")}</p>
                      <small>Team ${escapeHtml(participant.teamNumber || "")} | ${escapeHtml(participant.philipsTeam || "")} | ${escapeHtml(participant.eventStatus || "Not Started")}</small>
                    </section>
                  `
                )
                .join("")
            : `<section class="topic-entry__item"><h3>No participants</h3><p>No participants are registered in this session.</p></section>`
        }
      </div>
    </article>
    <article class="topic-entry">
      <div class="topic-entry__meta">Topics</div>
      <div class="topic-entry__grid">
        ${
          topics.length
            ? topics
                .flatMap((entry) =>
                  entry.topics.map(
                    (topic, index) => `
                      <section class="topic-entry__item">
                        <h3>${escapeHtml(topic.title || `Topic ${index + 1}`)}</h3>
                        <p>${escapeHtml(topic.details || topic.notes || "No additional details.")}</p>
                        <small>${escapeHtml(entry.firstName || "")} ${escapeHtml(entry.lastName || "")} | Team ${escapeHtml(entry.teamNumber || "")}</small>
                      </section>
                    `
                  )
                )
                .join("")
            : `<section class="topic-entry__item"><h3>No topics</h3><p>No topics have been submitted for this session.</p></section>`
        }
      </div>
    </article>
    <article class="topic-entry">
      <div class="topic-entry__meta">Votes</div>
      <div class="topic-list">
        ${
          votes.length
            ? votes
                .map((vote) => {
                  const topic = topicTitles.find((item) => item.key === vote.topicKey);
                  return `<div class="archive-item">${escapeHtml(vote.firstName || "")} ${escapeHtml(vote.lastName || "")} voted for ${escapeHtml(topic?.title || "a topic")} - Team ${escapeHtml(vote.teamNumber || "")}</div>`;
                })
                .join("")
            : `<div class="archive-item archive-item--empty">No votes have been submitted for this session.</div>`
        }
      </div>
    </article>
  `;
}

function archiveSelectedSession() {
  if (!archiveSessionSelect) return;
  archiveSessionById(archiveSessionSelect.value);
}

function archiveSessionById(sessionId) {
  const session = sessionItemsSource().find((item) => item.id === sessionId);
  if (!session) return;

  const archive = {
    id: id(),
    sessionId,
    sessionName: session.name,
    archivedAt: new Date().toLocaleString(),
    archivedBy: adminSession?.username || "Admin",
    topics: sessionItems(storageKeys.topics, session),
    votes: sessionItems(storageKeys.votes, session),
    participants: backendParticipants
      ? backendParticipants.filter((participant) => participant.sessionId === sessionId)
      : LeanCoffeeSession.readItemsForSession(storageKeys.participants, sessionId),
    admins: adminItems().filter((admin) => sessionIdForName(admin.team || admin.username) === sessionId),
  };
  const archives = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]");
  localStorage.setItem(storageKeys.archivedResults, JSON.stringify([archive, ...archives]));
  if (backendParticipants) {
    backendParticipants = backendParticipants.map((participant) =>
      participant.sessionId === sessionId ? { ...participant, archived: true, eventStatus: "Completed" } : participant
    );
  } else {
    const participants = LeanCoffeeSession.readItemsForSession(storageKeys.participants, sessionId)
      .map((participant) => ({ ...participant, archived: true, eventStatus: "Completed" }));
    LeanCoffeeSession.setItemForSession(storageKeys.participants, sessionId, JSON.stringify(participants));
  }
  if (backendTopics || backendVotes) {
    apiRequest("/api/topics/archive-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    }).catch((error) => console.warn(error));
    backendTopics = backendTopics ? backendTopics.filter((entry) => entry.sessionId !== sessionId) : backendTopics;
    backendVotes = backendVotes ? backendVotes.filter((vote) => vote.sessionId !== sessionId) : backendVotes;
  } else {
    LeanCoffeeSession.removeItemForSession(storageKeys.topics, sessionId);
    LeanCoffeeSession.removeItemForSession(storageKeys.votes, sessionId);
  }
  LeanCoffeeSession.removeItemForSession(storageKeys.activeTopic, sessionId);
  render();
}

function sessionTopicStats(session) {
  const submissions = sessionItems(storageKeys.topics, session);
  const votes = sessionItems(storageKeys.votes, session);
  const topics = submissions.flatMap((entry) =>
    entry.topics.map((topic, index) => ({
      key: `${entry.id}:${index}`,
      teamNumber: entry.teamNumber || "Unassigned",
      topic,
    }))
  );
  const voteCounts = votes.reduce((counts, vote) => {
    counts[vote.topicKey] = (counts[vote.topicKey] || 0) + 1;
    return counts;
  }, {});
  const selected = new Set();
  Object.values(
    topics.reduce((groups, topic) => {
      groups[topic.teamNumber] = groups[topic.teamNumber] || [];
      groups[topic.teamNumber].push(topic);
      return groups;
    }, {})
  ).forEach((teamTopics) => {
    teamTopics
      .slice()
      .sort((a, b) => (voteCounts[b.key] || 0) - (voteCounts[a.key] || 0))
      .slice(0, 2)
      .forEach((topic) => selected.add(topic.key));
  });
  return {
    topics: topics.length,
    unselected: topics.filter((topic) => !selected.has(topic.key)).length,
    votes: votes.length,
  };
}

function renderKpis() {
  if (!kpiGrid) return;
  const sessions = filteredKpiSessions();
  const participants = sessions.flatMap((session) =>
    backendParticipants
      ? backendParticipants.filter((participant) => participant.sessionId === session.id)
      : LeanCoffeeSession.readItemsForSession(storageKeys.participants, session.id)
  );
  const stats = sessions.reduce(
    (totals, session) => {
      const sessionStats = sessionTopicStats(session);
      totals.topics += sessionStats.topics;
      totals.unselected += sessionStats.unselected;
      totals.votes += sessionStats.votes;
      return totals;
    },
    { topics: 0, unselected: 0, votes: 0 }
  );
  const sessionAdmins = adminItems().filter((admin) => (admin.role || "Super Admin") === "Session Admin");
  const managerCounts = sessionAdmins
    .map((admin) => `${admin.firstName || admin.username}: ${admin.team ? 1 : 0}`)
    .join(" | ") || "No Session Admins";

  kpiGrid.innerHTML = [
    ["Number of Sessions", sessions.length],
    ["Registered Participants", participants.filter((participant) => !participant.archived).length],
    ["Number of Topics", stats.topics],
    ["Number of Unselected Topics", stats.unselected],
    ["Number of Votes", stats.votes],
    ["Sessions Per Session Manager", managerCounts],
  ]
    .map(
      ([label, value]) => `
        <article class="kpi-card">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderKpiFilters() {
  if (!kpiDateFilter || !kpiAdminFilter) return;
  const selectedDate = kpiDateFilter.value || "all";
  const selectedAdmin = kpiAdminFilter.value || "all";
  const sessions = visibleSessions();
  const dates = [...new Set(sessions.map(sessionDate))];
  const sessionAdmins = adminItems().filter((admin) => (admin.role || "Super Admin") === "Session Admin" && !admin.archived);

  kpiDateFilter.innerHTML = [
    `<option value="all">All Dates</option>`,
    ...dates.map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(date)}</option>`),
  ].join("");
  kpiDateFilter.value = [...kpiDateFilter.options].some((option) => option.value === selectedDate) ? selectedDate : "all";

  kpiAdminFilter.innerHTML = [
    `<option value="all">All Session Admins</option>`,
    ...sessionAdmins.map((admin) => `<option value="${escapeHtml(admin.id)}">${escapeHtml(admin.firstName || admin.username)} ${escapeHtml(admin.lastName || "")}</option>`),
  ].join("");
  kpiAdminFilter.value = [...kpiAdminFilter.options].some((option) => option.value === selectedAdmin) ? selectedAdmin : "all";
}

function filteredKpiSessions() {
  let sessions = visibleSessions();
  if (kpiDateFilter?.value && kpiDateFilter.value !== "all") {
    sessions = sessions.filter((session) => sessionDate(session) === kpiDateFilter.value);
  }
  if (kpiAdminFilter?.value && kpiAdminFilter.value !== "all") {
    const admin = adminItems().find((entry) => entry.id === kpiAdminFilter.value);
    if (admin) {
      const sessionId = sessionAdminSessionId(admin);
      sessions = sessions.filter((session) => session.id === sessionId);
    }
  }
  return sessions;
}

function renderArchive(items, label, collection) {
  return items.length
    ? items
        .map(
          (item) => `
            <div class="archive-item archive-item--action">
              <span>${escapeHtml(label(item))}</span>
              <button type="button" data-delete-archived-item="${escapeHtml(item.id)}" data-archive-collection="${escapeHtml(collection)}" data-archive-session-id="${escapeHtml(item.sessionId || LeanCoffeeSession.activeSession().id)}">Delete</button>
            </div>
          `
        )
        .join("")
    : `<div class="archive-item archive-item--empty">No archived records.</div>`;
}

function handleTableAction(event) {
  const archivedDelete = event.target.closest("[data-delete-archived-item]");
  if (archivedDelete) {
    deleteArchivedItem(
      archivedDelete.dataset.deleteArchivedItem,
      archivedDelete.dataset.archiveCollection,
      archivedDelete.dataset.archiveSessionId
    );
    return;
  }

  const archiveRecordDelete = event.target.closest("[data-delete-archive-record]");
  if (archiveRecordDelete) {
    deleteArchiveRecord(archiveRecordDelete.dataset.deleteArchiveRecord);
    return;
  }

  const adminToggle = event.target.closest("[data-toggle-admin-sessions]");
  if (adminToggle) {
    toggleAdminSessions(adminToggle.dataset.toggleAdminSessions);
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const row = button.closest("tr");
  const collection = row.dataset.type === "participant" ? storageKeys.participants : storageKeys.admins;
  const sessionId = row.dataset.sessionId || LeanCoffeeSession.activeSession().id;
  const action = button.dataset.action;

  if (action === "edit") {
    startEdit(row);
  }

  if (action === "save") {
    saveRow(row, collection, sessionId);
  }

  if (action === "archive") {
    archiveRow(row.dataset.id, collection, sessionId);
  }
}

function startEdit(row) {
  const type = row.dataset.type;
  const fields = row.querySelectorAll("[data-field]");

  fields.forEach((cell) => {
    const field = cell.dataset.field;
    const text = cell.textContent.trim();

    if (type === "participant" && field === "name") {
      const [firstName = "", ...lastParts] = text.split(" ");
      cell.innerHTML = `
        ${inputCell(firstName, "firstName")}
        ${inputCell(lastParts.join(" "), "lastName")}
      `;
      return;
    }

    if (type === "participant" && field === "extra") {
      cell.innerHTML = inputCell(text, "extra");
      return;
    }

    cell.innerHTML = inputCell(text, field);
  });

  row.querySelector('[data-action="edit"]').hidden = true;
  row.querySelector('[data-action="save"]').hidden = false;
}

function saveRow(row, collection, sessionId) {
  const items = collection === storageKeys.participants
    ? LeanCoffeeSession.readItemsForSession(collection, sessionId)
    : readItems(collection);
  const item = items.find((entry) => entry.id === row.dataset.id);
  if (!item) return;

  row.querySelectorAll("input").forEach((input) => {
    const value = input.value.trim();
    if (input.name === "extra" && item.philipsTeam === "Comm Sales") {
      item.businessUnit = value;
      return;
    }
    if (input.name === "extra" && item.philipsTeam === "Other") {
      item.specificTeam = value;
      return;
    }
    item[input.name] = value;
  });

  if (collection === storageKeys.participants) {
    LeanCoffeeSession.setItemForSession(collection, sessionId, JSON.stringify(items));
  } else {
    writeItems(collection, items);
  }
  render();
}

async function archiveRow(itemId, collection, sessionId) {
  if (collection === storageKeys.admins && backendAdmins) {
    try {
      const data = await apiRequest(`/api/admins/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (data?.admin) {
        backendAdmins = backendAdmins.map((admin) =>
          admin.id === itemId ? { ...admin, archived: true } : admin
        );
        render();
      }
      return;
    } catch (error) {
      alert(error.message);
      return;
    }
  }

  if (collection === storageKeys.participants && backendParticipants) {
    try {
      const data = await apiRequest(`/api/participants/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (data?.participant) {
        backendParticipants = backendParticipants.map((participant) =>
          participant.id === itemId ? data.participant : participant
        );
        render();
      }
      return;
    } catch (error) {
      alert(error.message);
      return;
    }
  }

  const sourceItems = collection === storageKeys.participants
    ? LeanCoffeeSession.readItemsForSession(collection, sessionId)
    : readItems(collection);
  const items = sourceItems.map((item) =>
    item.id === itemId ? { ...item, archived: true } : item
  );
  if (collection === storageKeys.participants) {
    LeanCoffeeSession.setItemForSession(collection, sessionId, JSON.stringify(items));
  } else {
    writeItems(collection, items);
  }
  render();
}

function deleteArchivedItem(itemId, collection, sessionId) {
  const items = LeanCoffeeSession.readItemsForSession(collection, sessionId).filter((item) => item.id !== itemId);
  LeanCoffeeSession.setItemForSession(collection, sessionId, JSON.stringify(items));
  render();
}

function deleteArchiveRecord(archiveId) {
  const archives = JSON.parse(localStorage.getItem(storageKeys.archivedResults) || "[]")
    .filter((entry) => entry.id !== archiveId);
  localStorage.setItem(storageKeys.archivedResults, JSON.stringify(archives));
  render();
}

function toggleAdminSessions(adminId) {
  if (expandedAdmins.has(adminId)) {
    expandedAdmins.delete(adminId);
  } else {
    expandedAdmins.add(adminId);
  }
  renderAdmins();
}

function render() {
  renderParticipants();
  renderAdmins();
  renderTopicFilterOptions();
  renderTopics();
  renderArchiveOptions();
  renderActiveArchivePreview();
  renderArchivedResults();
  renderSessionOptions();
  renderSessionOverview();
  renderKpiFilters();
  renderKpis();
}

function showPane(paneName) {
  paneLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.paneTarget === paneName);
  });

  paneContents.forEach((content) => {
    const isActive = content.dataset.pane === paneName;
    content.hidden = !isActive;
    content.classList.toggle("is-active", isActive);
  });
}

teamSelect.addEventListener("change", setConditionalFields);
participantForm.addEventListener("submit", saveParticipant);
adminForm?.addEventListener("submit", saveAdmin);
document.addEventListener("click", handleTableAction);
paneLinks.forEach((link) => {
  link.addEventListener("click", () => showPane(link.dataset.paneTarget));
});
adminLogout.addEventListener("click", () => {
  sessionStorage.removeItem("leanCoffeeAdminSession");
  LeanCoffeeSession.clearActiveSession();
  window.location.href = "index.html";
});
topicGroupButtons.forEach((button) => {
  button.addEventListener("click", () => {
    topicGroupMode = button.dataset.topicGroup;
    topicGroupButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    renderTopics();
  });
});
topicSessionFilter?.addEventListener("change", renderTopics);
archiveSessionSelect?.addEventListener("change", renderActiveArchivePreview);
archiveResultsButton?.addEventListener("click", archiveSelectedSession);
viewSessionSelect?.addEventListener("change", renderSessionOverview);
viewSessionArchive?.addEventListener("click", () => {
  if (viewSessionSelect?.value) archiveSessionById(viewSessionSelect.value);
});
kpiDateFilter?.addEventListener("change", renderKpis);
kpiAdminFilter?.addEventListener("change", renderKpis);

setConditionalFields();
render();
loadBackendAdmins();
