const participantLoginForm = document.querySelector("[data-participant-login-form]");
const participantLoginError = document.querySelector("[data-participant-login-error]");

const participantStorageKey = "leanCoffeeParticipants";
const participantSessionKey = "leanCoffeeParticipantSession";
const sessionCommandStorageKey = "leanCoffeeSessionCommand";

function readItems(key) {
  return LeanCoffeeSession.readItems(key);
}

function participantMatches(email, password) {
  let totalParticipants = 0;
  for (const session of LeanCoffeeSession.sessions()) {
    LeanCoffeeSession.setActiveSession(session);
    const participants = readItems(participantStorageKey).filter((participant) => !participant.archived);
    totalParticipants += participants.length;
    const participant = participants.find((entry) => entry.email === email && entry.password === password);
    if (participant) return { participant, participants, session };
  }

  return { participant: null, participants: Array.from({ length: totalParticipants }), session: null };
}

async function apiParticipantLogin(email, password) {
  const response = await fetch("/api/participant-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (response.status === 503 || response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Invalid email address or password.");
  return data;
}

async function latestSessionCommand(sessionId) {
  try {
    const response = await fetch(`/api/session-command?sessionId=${encodeURIComponent(sessionId)}`);
    if (response.ok) {
      const data = await response.json();
      if (data?.command) return data.command;
    }
  } catch {
    // Fall through to local storage fallback.
  }

  try {
    return JSON.parse(localStorage.getItem(`${sessionCommandStorageKey}:${sessionId}`) || "null");
  } catch {
    return null;
  }
}

async function saveParticipantSession(participant, session) {
  LeanCoffeeSession.setActiveSession(session);
  sessionStorage.setItem(
    participantSessionKey,
    JSON.stringify({
      id: participant.id,
      sessionId: session.id,
      sessionName: session.name,
      sessionTeam: session.team,
      participant,
    })
  );
  participantLoginForm.reset();
  const command = await latestSessionCommand(session.id);
  if (command?.command === "navigate" && command.target === "present.html") {
    window.location.href = "present.html";
    return;
  }
  window.location.href = "event.html";
}

participantLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(participantLoginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  try {
    const apiLogin = await apiParticipantLogin(email, password);
    if (apiLogin?.participant && apiLogin?.session) {
      await saveParticipantSession(apiLogin.participant, apiLogin.session);
      return;
    }
  } catch (error) {
    participantLoginError.textContent = error.message;
    return;
  }

  const { participant, participants, session } = participantMatches(email, password);

  if (!participant) {
    participantLoginError.textContent = participants.length
      ? "Invalid email address or password."
      : "No participant registration found.";
    return;
  }

  if (participant.eventStatus === "Completed") {
    participantLoginError.textContent = "This participant has already completed the event.";
    return;
  }

  await saveParticipantSession(participant, session);
});
