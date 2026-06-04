const kanbanBoard = document.querySelector("[data-kanban-board]");
const currentAgenda = document.querySelector("[data-current-agenda]");
const voteActivity = document.querySelector("[data-vote-activity]");
const adminHomeLink = document.querySelector("[data-admin-home-link]");
const topicStorageKey = "leanCoffeeTopics";
const voteStorageKey = "leanCoffeeVotes";
const liveSession = window.LeanCoffeeSession;
let backendTopics = null;
let backendVotes = null;

if (adminHomeLink && liveSession.adminSession()?.role === "Session Admin") {
  adminHomeLink.href = "session-admin.html";
}

function readTopics() {
  return backendTopics || liveSession.readItems(topicStorageKey);
}

async function apiRequest(path) {
  const response = await fetch(path);
  if (response.status === 503 || response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function refreshBackendData() {
  try {
    const sessionId = liveSession.activeSession().id;
    const [topicData, voteData] = await Promise.all([
      apiRequest(`/api/topics?sessionId=${encodeURIComponent(sessionId)}`),
      apiRequest(`/api/votes?sessionId=${encodeURIComponent(sessionId)}`),
    ]);
    if (topicData) backendTopics = topicData.topics;
    if (voteData) backendVotes = voteData.votes;
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

function renderKanban() {
  const topics = readTopics();
  const counts = voteCounts();
  const groups = topics.reduce((collection, entry) => {
    const key = `Team ${entry.teamNumber || "Unassigned"}`;
    collection[key] = collection[key] || [];
    entry.topics.forEach((topic, index) => {
      const topicKey = `${entry.id}:${index}`;
      collection[key].push({ ...topic, topicKey, entry, votes: counts[topicKey] || 0 });
    });
    return collection;
  }, {});

  kanbanBoard.innerHTML = Object.keys(groups).length
    ? Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(
          ([team, items]) => `
            <section class="kanban-column">
              <h2>${escapeHtml(team)}</h2>
              <div class="kanban-notes">
                ${items
                  .map((item) => ({
                    ...item,
                    selected: topTopicKeys(items).includes(item.topicKey),
                    hasVotes: items.some((candidate) => candidate.votes > 0),
                  }))
                  .sort((a, b) => Number(b.selected) - Number(a.selected) || b.votes - a.votes)
                  .map(({ title, details, entry, votes, topicKey, selected, hasVotes }) => {
                    return `
                      <article class="sticky-note ${hasVotes && !selected ? "is-unselected" : ""} ${selected ? "is-selected" : ""}">
                        <h3>${escapeHtml(title || "Untitled")}</h3>
                        <p>${escapeHtml(details || "No additional details.")}</p>
                        <em>${selected ? "Selected Topic" : "Not Selected"}</em>
                        <small>${escapeHtml(entry.firstName || "")} ${escapeHtml(entry.lastName || "")} | ${escapeHtml(entry.teamAssociation || entry.philipsTeam)} | ${votes} votes</small>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
        )
        .join("")
    : `<section class="kanban-empty">Waiting for submitted topics.</section>`;
}

function readVotes() {
  return backendVotes || liveSession.readItems(voteStorageKey);
}

function voteCounts() {
  return readVotes().reduce((counts, vote) => {
    counts[vote.topicKey] = (counts[vote.topicKey] || 0) + 1;
    return counts;
  }, {});
}

function topTopicKeys(items) {
  return items
    .slice()
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 2)
    .map((item) => item.topicKey);
}

function renderVoteActivity() {
  const votes = readVotes();
  const topics = readTopics().flatMap((entry) =>
    entry.topics.map((topic, index) => ({
      key: `${entry.id}:${index}`,
      title: topic.title || "Untitled",
    }))
  );

  voteActivity.innerHTML = votes.length
    ? votes
        .slice()
        .reverse()
        .map((vote) => {
          const topic = topics.find((item) => item.key === vote.topicKey);
          return `
            <div class="archive-item">
              ${escapeHtml(vote.firstName)} ${escapeHtml(vote.lastName)}
              voted for ${escapeHtml(topic?.title || "a topic")}
              - Team ${escapeHtml(vote.teamNumber)}
            </div>
          `;
        })
        .join("")
    : `<div class="archive-item archive-item--empty">No voting activity yet.</div>`;
}

window.addEventListener("storage", (event) => {
  if (event.key === liveSession.key(topicStorageKey)) renderKanban();
  if (event.key === liveSession.key(voteStorageKey)) renderVoteActivity();
});

window.addEventListener("leanCoffeeTimerTick", (event) => {
  currentAgenda.textContent = event.detail.phase.title;
  if (!event.detail.timer.concluded && event.detail.phase.index >= 3) {
    window.location.href = "collaboration.html?admin=1";
  }
});

renderKanban();
renderVoteActivity();
refreshBackendData().then(() => {
  renderKanban();
  renderVoteActivity();
});
window.setInterval(async () => {
  await refreshBackendData();
  renderKanban();
  renderVoteActivity();
}, 1000);
