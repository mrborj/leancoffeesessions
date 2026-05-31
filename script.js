const expandWords = document.querySelector("[data-expand-words]");
const stepSections = document.querySelectorAll("[data-step-section]");

if (expandWords) {
  const observer = new IntersectionObserver(
    ([entry]) => {
      expandWords.classList.toggle("is-visible", entry.isIntersecting);
    },
    {
      rootMargin: "-25% 0px -25% 0px",
      threshold: 0.35,
    }
  );

  observer.observe(expandWords);
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function updateStepProgress() {
  stepSections.forEach((section) => {
    const rect = section.getBoundingClientRect();
    const travel = rect.height - window.innerHeight;
    const rawProgress = travel > 0 ? -rect.top / travel : 0;
    const progress = clamp(rawProgress, 0, 1);
    const copyProgress = clamp((progress - 0.22) / 0.58, 0, 1);

    section.style.setProperty("--step-progress", progress.toFixed(3));
    section.style.setProperty("--step-number-opacity", (0.35 + progress * 0.65).toFixed(3));
    section.style.setProperty("--step-number-y", `${((1 - progress) * 2.4).toFixed(3)}rem`);
    section.style.setProperty("--step-number-scale", (0.82 + progress * 0.18).toFixed(3));
    section.style.setProperty("--step-copy-opacity", copyProgress.toFixed(3));
    section.style.setProperty("--step-copy-y", `${((1 - copyProgress) * 3.2).toFixed(3)}rem`);
    section.style.setProperty("--step-copy-scale", (0.76 + copyProgress * 0.24).toFixed(3));
  });
}

if (stepSections.length > 0) {
  updateStepProgress();
  window.addEventListener("scroll", updateStepProgress, { passive: true });
  window.addEventListener("resize", updateStepProgress);
}
