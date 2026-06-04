const board = document.querySelector("[data-collaboration-board]");
const currentAgenda = document.querySelector("[data-current-agenda]");
const detailModal = document.querySelector("[data-topic-detail-modal]");
const detailTitle = document.querySelector("[data-detail-title]");
const detailBody = document.querySelector("[data-detail-body]");
const adminNotes = document.querySelector("[data-admin-notes]");
const closeDetail = document.querySelector("[data-close-detail-modal]");
const saveNotes = document.querySelector("[data-save-topic-notes]");
const isAdmin = new URLSearchParams(window.location.search).get("admin") === "1";
const liveHome = document.querySelector("[data-live-home]");
const topicStorageKey = "leanCoffeeTopics";
const voteStorageKey = "leanCoffeeVotes";
const activeTopicStorageKey = "leanCoffeeActiveTopic";
const collabSession = window.LeanCoffeeSession;
let activeTopicKey = "";
let backendTopics = null;
let backendVotes = null;
let adminTopicDraftDirty = false;

function readItems(key) {
  return collabSession.readItems(key);
}

function writeItems(key, items) {
  collabSession.writeItems(key, items);
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

function voteItems() {
  return backendVotes || readItems(voteStorageKey);
}

async function refreshBackendData() {
  try {
    const sessionId = collabSession.activeSession().id;
    const [topicData, voteData] = await Promise.all([
      apiRequest(`/api/topics?sessionId=${encodeURIComponent(sessionId)}`),
      apiRequest(`/api/votes?sessionId=${encodeURIComponent(sessionId)}`),
    ]);
    if (topicData) backendTopics = topicData.topics;
    if (voteData) backendVotes = voteData.votes;
    renderBoard();
    if (activeTopicKey && !detailModal.hidden) {
      openTopicDetail(activeTopicKey, { preserveAdminFields: isAdmin });
    }
  } catch (error) {
    console.warn(error);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function voteCounts() {
  return voteItems().reduce((counts, vote) => {
    counts[vote.topicKey] = (counts[vote.topicKey] || 0) + 1;
    return counts;
  }, {});
}

function acceptedTopics() {
  const counts = voteCounts();
  const byTeam = {};
  topicEntries().forEach((entry) => {
    const team = `Team ${entry.teamNumber || "Unassigned"}`;
    byTeam[team] = byTeam[team] || [];
    entry.topics.forEach((topic, index) => {
      byTeam[team].push({
        key: `${entry.id}:${index}`,
        entry,
        topic,
        votes: counts[`${entry.id}:${index}`] || 0,
      });
    });
  });

  return Object.fromEntries(
    Object.entries(byTeam).map(([team, topics]) => [
      team,
      topics.sort((a, b) => b.votes - a.votes).slice(0, 2),
    ])
  );
}

function renderBoard() {
  const groups = acceptedTopics();
  board.innerHTML = Object.keys(groups).length
    ? Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(
          ([team, items]) => `
            <section class="kanban-column">
              <h2>${escapeHtml(team)}</h2>
              <div class="kanban-notes">
                ${items
                  .map(
                    ({ key, topic, entry, votes }) => `
                      <button type="button" class="sticky-note sticky-note-button" data-topic-key="${escapeHtml(key)}">
                        <h3>${escapeHtml(topic.title || "Untitled")}</h3>
                        <p>${escapeHtml(topic.details || "No additional details.")}</p>
                        ${topic.notes ? `<p><strong>Notes:</strong> ${escapeHtml(topic.notes)}</p>` : ""}
                        ${topic.status ? `<em>${escapeHtml(topic.status)}</em>` : ""}
                        <small>${escapeHtml(entry.firstName || "")} ${escapeHtml(entry.lastName || "")} | ${votes} votes</small>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </section>
          `
        )
        .join("")
    : `<section class="kanban-empty">Waiting for accepted team topics.</section>`;
}

if (!isAdmin && liveHome) {
  liveHome.remove();
}

if (isAdmin && liveHome && collabSession.adminSession()?.role === "Session Admin") {
  liveHome.href = "session-admin.html";
}

if (!isAdmin) {
  closeDetail.hidden = true;
  saveNotes.hidden = true;
  adminNotes.querySelectorAll("textarea, select").forEach((field) => {
    field.disabled = true;
  });
}

function findTopic(topicKey) {
  const [entryId, index] = topicKey.split(":");
  const entry = topicEntries().find((item) => item.id === entryId);
  if (!entry) return null;
  return { entry, topic: entry.topics[Number(index)], index: Number(index) };
}

board.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic-key]");
  if (!button) return;
  if (!isAdmin) return;

  activeTopicKey = button.dataset.topicKey;
  adminTopicDraftDirty = false;
  collabSession.setItem(activeTopicStorageKey, activeTopicKey);
  openTopicDetail(activeTopicKey);
});

closeDetail.addEventListener("click", () => {
  detailModal.hidden = true;
  adminTopicDraftDirty = false;
  if (isAdmin) collabSession.setItem(activeTopicStorageKey, "");
});

adminNotes.addEventListener("input", () => {
  if (isAdmin) adminTopicDraftDirty = true;
});

saveNotes.addEventListener("click", async () => {
  if (!isAdmin || !activeTopicKey) return;
  const [entryId, index] = activeTopicKey.split(":");
  const entries = topicEntries();
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return;

  entry.topics[Number(index)].notes = adminNotes.querySelector('[name="notes"]').value.trim();
  entry.topics[Number(index)].painPoints = adminNotes.querySelector('[name="painPoints"]').value.trim();
  entry.topics[Number(index)].solutions = adminNotes.querySelector('[name="solutions"]').value.trim();
  entry.topics[Number(index)].status = adminNotes.querySelector('[name="status"]').value;

  if (backendTopics) {
    try {
      await apiRequest("/api/topics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicKey: activeTopicKey,
          notes: entry.topics[Number(index)].notes,
          painPoints: entry.topics[Number(index)].painPoints,
          solutions: entry.topics[Number(index)].solutions,
          status: entry.topics[Number(index)].status,
        }),
      });
    } catch (error) {
      alert(error.message);
      return;
    }
  } else {
    writeItems(topicStorageKey, entries);
  }

  adminTopicDraftDirty = false;
  renderBoard();
  detailModal.hidden = true;
  collabSession.setItem(activeTopicStorageKey, "");
  await refreshBackendData();
});

function openTopicDetail(topicKey, options = {}) {
  const preserveAdminFields =
    options.preserveAdminFields &&
    isAdmin &&
    !detailModal.hidden &&
    activeTopicKey === topicKey &&
    adminTopicDraftDirty;
  activeTopicKey = topicKey;
  const found = findTopic(activeTopicKey);
  if (!found) return;

  detailTitle.textContent = found.topic.title || "Untitled";
  detailBody.innerHTML = `
    ${escapeHtml(found.topic.details || "No additional details.")}
    ${found.topic.notes ? `<br><br><strong>Notes:</strong> ${escapeHtml(found.topic.notes)}` : ""}
    ${found.topic.painPoints ? `<br><br><strong>Pain Points:</strong> ${escapeHtml(found.topic.painPoints)}` : ""}
    ${found.topic.solutions ? `<br><br><strong>Potential Solutions:</strong> ${escapeHtml(found.topic.solutions)}` : ""}
    <br><br><strong>Status:</strong> ${escapeHtml(found.topic.status || "For Further Discussion")}
  `;
  adminNotes.hidden = false;
  if (!preserveAdminFields) {
    adminNotes.querySelector('[name="notes"]').value = found.topic.notes || "";
    adminNotes.querySelector('[name="painPoints"]').value = found.topic.painPoints || "";
    adminNotes.querySelector('[name="solutions"]').value = found.topic.solutions || "";
    adminNotes.querySelector('[name="status"]').value = found.topic.status || "For Further Discussion";
  }
  detailModal.hidden = false;
}

window.addEventListener("storage", (event) => {
  if (event.key === collabSession.key(topicStorageKey) || event.key === collabSession.key(voteStorageKey)) {
    renderBoard();
    if (activeTopicKey && !detailModal.hidden) {
      openTopicDetail(activeTopicKey, { preserveAdminFields: isAdmin });
    }
  }
  if (event.key === collabSession.key(activeTopicStorageKey)) {
    if (event.newValue) {
      openTopicDetail(event.newValue);
    } else {
      detailModal.hidden = true;
      activeTopicKey = "";
    }
  }
});

window.addEventListener("leanCoffeeTimerTick", (event) => {
  currentAgenda.textContent = event.detail.phase.title;
  if (!isAdmin && !event.detail.timer.running && event.detail.remaining === event.detail.timer.duration && !event.detail.timer.concluded) {
    window.location.href = "event.html";
  }
});

renderBoard();
refreshBackendData();
window.setInterval(refreshBackendData, 1000);
