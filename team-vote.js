const participantStorageKey = "leanCoffeeParticipants";
const participantSessionKey = "leanCoffeeParticipantSession";
const topicStorageKey = "leanCoffeeTopics";
const voteStorageKey = "leanCoffeeVotes";
const voteGrid = document.querySelector("[data-vote-grid]");
const votesRemaining = document.querySelector("[data-votes-remaining]");
const teamLabel = document.querySelector("[data-team-label]");
const maxVotes = 2;
const voteSession = window.LeanCoffeeSession;
let backendTopics = null;
let backendVotes = null;

function readItems(key) {
  return voteSession.readItems(key);
}

function writeItems(key, items) {
  voteSession.writeItems(key, items);
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

async function loadBackendData() {
  try {
    const sessionId = voteSession.activeSession().id;
    const [topicData, voteData] = await Promise.all([
      apiRequest(`/api/topics?sessionId=${encodeURIComponent(sessionId)}`),
      apiRequest(`/api/votes?sessionId=${encodeURIComponent(sessionId)}`),
    ]);
    if (topicData) backendTopics = topicData.topics;
    if (voteData) backendVotes = voteData.votes;
    render();
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

function currentParticipant() {
  const session = JSON.parse(sessionStorage.getItem(participantSessionKey) || "null");
  if (!session) return null;
  if (session.sessionId) {
    voteSession.setActiveSession({
      id: session.sessionId,
      name: session.sessionName,
      team: session.sessionTeam,
    });
  }
  if (session.participant) return session.participant;
  return readItems(participantStorageKey).find((participant) => participant.id === session.id && !participant.archived);
}

function teamTopics(participant) {
  return topicEntries()
    .filter((entry) => String(entry.teamNumber) === String(participant.teamNumber))
    .flatMap((entry) =>
      entry.topics.map((topic, index) => ({
        key: `${entry.id}:${index}`,
        entry,
        title: topic.title || "Untitled",
        details: topic.details || "No additional details.",
      }))
    );
}

function voteCounts() {
  return voteItems().reduce((counts, vote) => {
    counts[vote.topicKey] = (counts[vote.topicKey] || 0) + 1;
    return counts;
  }, {});
}

function participantVotes(participant) {
  return voteItems().filter((vote) => vote.participantId === participant.id);
}

function topTopicKeys(topics) {
  const counts = voteCounts();
  return topics
    .map((topic) => ({ key: topic.key, count: counts[topic.key] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((topic) => topic.key);
}

function render() {
  const participant = currentParticipant();
  if (!participant) {
    window.location.href = "begin.html";
    return;
  }

  const topics = teamTopics(participant);
  const votes = participantVotes(participant);
  const counts = voteCounts();
  const winners = topTopicKeys(topics);
  const remaining = Math.max(0, maxVotes - votes.length);
  votesRemaining.textContent = `${remaining} ${remaining === 1 ? "vote" : "votes"}`;
  teamLabel.textContent = `Team ${participant.teamNumber} - ${participant.philipsTeam}`;

  voteGrid.innerHTML = topics.length
    ? topics
        .map((topic) => {
          const selected = votes.some((vote) => vote.topicKey === topic.key);
          const accepted = winners.includes(topic.key);
          const greyed = votes.length >= maxVotes && !accepted;
          return `
            <article class="vote-card ${greyed ? "is-greyed" : ""} ${accepted ? "is-accepted" : ""}">
              <h2>${escapeHtml(topic.title)}</h2>
              <p>${escapeHtml(topic.details)}</p>
              <small>${escapeHtml(topic.entry.firstName || "")} ${escapeHtml(topic.entry.lastName || "")}</small>
              <strong>${counts[topic.key] || 0} votes</strong>
              <button type="button" data-topic-key="${escapeHtml(topic.key)}" ${selected || remaining === 0 ? "disabled" : ""}>
                ${selected ? "Voted" : "Vote"}
              </button>
            </article>
          `;
        })
        .join("")
    : `<div class="kanban-empty">No team topics submitted yet.</div>`;
}

voteGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-topic-key]");
  if (!button) return;

  const participant = currentParticipant();
  const votes = participantVotes(participant);
  if (votes.length >= maxVotes) return;

  const vote = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    topicKey: button.dataset.topicKey,
    participantId: participant.id,
    firstName: participant.firstName,
    lastName: participant.lastName,
    teamNumber: participant.teamNumber,
    teamAssociation: participant.businessUnit || participant.specificTeam || participant.philipsTeam,
    sessionId: voteSession.activeSession().id,
  };

  try {
    const data = await apiRequest("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vote),
    });
    if (data?.vote) {
      if (!backendVotes) backendVotes = [];
      backendVotes = [data.vote, ...backendVotes];
      render();
      return;
    }
  } catch (error) {
    alert(error.message);
    return;
  }

  const allVotes = readItems(voteStorageKey);
  allVotes.push(vote);
  writeItems(voteStorageKey, allVotes);
  render();
});

window.addEventListener("storage", (event) => {
  if (event.key === voteSession.key(topicStorageKey) || event.key === voteSession.key(voteStorageKey)) render();
});

window.addEventListener("leanCoffeeTimerTick", (event) => {
  if (!event.detail.timer.running && event.detail.remaining === event.detail.timer.duration && !event.detail.timer.concluded) {
    window.location.href = "event.html";
    return;
  }
  if (event.detail.phase.index >= 3) {
    window.location.href = "collaboration.html";
  }
});

render();
loadBackendData();
window.setInterval(() => {
  loadBackendData();
  render();
}, 1000);
