const participantLoginForm = document.querySelector("[data-participant-login-form]");
const participantLoginError = document.querySelector("[data-participant-login-error]");

const participantStorageKey = "leanCoffeeParticipants";
const participantSessionKey = "leanCoffeeParticipantSession";

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

participantLoginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(participantLoginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
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

  LeanCoffeeSession.setActiveSession(session);
  sessionStorage.setItem(
    participantSessionKey,
    JSON.stringify({
      id: participant.id,
      sessionId: session.id,
      sessionName: session.name,
      sessionTeam: session.team,
    })
  );
  participantLoginForm.reset();
  window.location.href = "event.html";
});
