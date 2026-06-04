const presentSession = window.LeanCoffeeSession;
const presentationSlides = [...document.querySelectorAll("[data-presentation-slide]")];
const presentationPrev = document.querySelector("[data-presentation-prev]");
const presentationNext = document.querySelector("[data-presentation-next]");
let presentationIndex = 0;

const presentationClose = document.querySelector(".presentation-close");
const adminSession = presentSession.adminSession();
const participantSession = presentSession.participantSession();

if (!adminSession && !participantSession) {
  window.location.href = "begin.html";
}

if (participantSession) {
  presentationClose.href = "collaboration.html";
}

function showPresentationSlide(nextIndex) {
  presentationIndex = (nextIndex + presentationSlides.length) % presentationSlides.length;
  presentationSlides.forEach((slide, index) => {
    const isActive = index === presentationIndex;
    slide.hidden = !isActive;
    slide.classList.toggle("is-active", isActive);
  });
}

presentationPrev.addEventListener("click", () => showPresentationSlide(presentationIndex - 1));
presentationNext.addEventListener("click", () => showPresentationSlide(presentationIndex + 1));

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") showPresentationSlide(presentationIndex - 1);
  if (event.key === "ArrowRight") showPresentationSlide(presentationIndex + 1);
  if (event.key === "Escape") window.location.href = "session-admin.html";
});
