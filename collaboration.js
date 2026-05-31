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

function readItems(key) {
  return collabSession.readItems(key);
}

function writeItems(key, items) {
  collabSession.writeItems(key, items);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function voteCounts() {
  return readItems(voteStorageKey).reduce((counts, vote) => {
    counts[vote.topicKey] = (counts[vote.topicKey] || 0) + 1;
    return counts;
  }, {});
}

function acceptedTopics() {
  const counts = voteCounts();
  const byTeam = {};
  readItems(topicStorageKey).forEach((entry) => {
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

if (!isAdmin) {
  closeDetail.hidden = true;
  saveNotes.hidden = true;
  adminNotes.querySelectorAll("textarea, select").forEach((field) => {
    field.disabled = true;
  });
}

function findTopic(topicKey) {
  const [entryId, index] = topicKey.split(":");
  const entry = readItems(topicStorageKey).find((item) => item.id === entryId);
  if (!entry) return null;
  return { entry, topic: entry.topics[Number(index)], index: Number(index) };
}

board.addEventListener("click", (event) => {
  const button = event.target.closest("[data-topic-key]");
  if (!button) return;
  if (!isAdmin) return;

  activeTopicKey = button.dataset.topicKey;
  collabSession.setItem(activeTopicStorageKey, activeTopicKey);
  openTopicDetail(activeTopicKey);
});

closeDetail.addEventListener("click", () => {
  detailModal.hidden = true;
  if (isAdmin) collabSession.setItem(activeTopicStorageKey, "");
});

saveNotes.addEventListener("click", () => {
  if (!isAdmin || !activeTopicKey) return;
  const [entryId, index] = activeTopicKey.split(":");
  const entries = readItems(topicStorageKey);
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return;

  entry.topics[Number(index)].notes = adminNotes.querySelector('[name="notes"]').value.trim();
  entry.topics[Number(index)].painPoints = adminNotes.querySelector('[name="painPoints"]').value.trim();
  entry.topics[Number(index)].solutions = adminNotes.querySelector('[name="solutions"]').value.trim();
  entry.topics[Number(index)].status = adminNotes.querySelector('[name="status"]').value;
  writeItems(topicStorageKey, entries);
  renderBoard();
  detailModal.hidden = true;
  collabSession.setItem(activeTopicStorageKey, "");
});

function openTopicDetail(topicKey) {
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
  adminNotes.querySelector('[name="notes"]').value = found.topic.notes || "";
  adminNotes.querySelector('[name="painPoints"]').value = found.topic.painPoints || "";
  adminNotes.querySelector('[name="solutions"]').value = found.topic.solutions || "";
  adminNotes.querySelector('[name="status"]').value = found.topic.status || "For Further Discussion";
  detailModal.hidden = false;
}

window.addEventListener("storage", (event) => {
  if (event.key === collabSession.key(topicStorageKey) || event.key === collabSession.key(voteStorageKey)) {
    renderBoard();
    if (activeTopicKey && !detailModal.hidden) openTopicDetail(activeTopicKey);
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
window.setInterval(renderBoard, 1000);
