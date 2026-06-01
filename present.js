const presentSession = window.LeanCoffeeSession;
const presentationSlides = [...document.querySelectorAll("[data-presentation-slide]")];
const presentationPrev = document.querySelector("[data-presentation-prev]");
const presentationNext = document.querySelector("[data-presentation-next]");
let presentationIndex = 0;

if (presentSession.adminSession()?.role !== "Session Admin") {
  window.location.href = "session-admin.html";
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
