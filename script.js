/* ============================================
   ADIYOGI ASTRO — Main Script
   ============================================ */

// --- Zodiac sign SVG art (compact constellation style) ---
const SIGN_ART = {
  Aries: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M20 42c0-12 4-20 8-24" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><path d="M36 42c0-12-4-20-8-24" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="42" r="2.5" fill="#E8871E"/><circle cx="36" cy="42" r="2.5" fill="#E8871E"/><circle cx="28" cy="16" r="2" fill="#D4A024"/></svg>`,
  Taurus: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><circle cx="28" cy="34" r="12" stroke="#C4572A" stroke-width="2" fill="none"/><path d="M16 22c-4-6-4-10-2-14" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><path d="M40 22c4-6 4-10 2-14" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="8" r="2" fill="#E8871E"/><circle cx="42" cy="8" r="2" fill="#E8871E"/></svg>`,
  Gemini: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M16 10h24M16 46h24" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><path d="M22 10v36M34 10v36" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="22" cy="24" r="2" fill="#D4A024"/><circle cx="34" cy="24" r="2" fill="#D4A024"/></svg>`,
  Cancer: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M16 28c0-10 5-16 12-16s12 6 12 16" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M40 28c0 10-5 16-12 16s-12-6-12-16" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="22" cy="24" r="4" fill="#D4A024" opacity="0.6"/><circle cx="34" cy="32" r="4" fill="#D4A024" opacity="0.6"/></svg>`,
  Leo: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><circle cx="28" cy="26" r="10" stroke="#C4572A" stroke-width="2" fill="none"/><path d="M24 16c-2-4-1-8 2-12" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><path d="M32 16c2-4 1-8-2-12" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="4" r="2" fill="#D4A024"/></svg>`,
  Virgo: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M16 8v32c0 4 2 6 4 6s4-2 4-6V14" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M24 14v26c0 4 2 6 4 6s4-2 4-6V10" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M32 10v30c0 4 2 6 4 6" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="16" cy="8" r="2" fill="#D4A024"/></svg>`,
  Libra: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M12 40h32M16 32h24" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><path d="M28 32V18" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="28" cy="16" r="4" stroke="#E8871E" stroke-width="1.5" fill="none"/><circle cx="28" cy="16" r="1.5" fill="#D4A024"/></svg>`,
  Scorpio: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M12 10v26c0 4 2 6 4 6s4-2 4-6V16" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 16v20c0 4 2 6 4 6s4-2 4-6V12" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M28 12v24c0 4 2 6 4 6h6" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M38 38l4 4-4 4" stroke="#E8871E" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  Sagittarius: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M14 42L42 14" stroke="#C4572A" stroke-width="2.5" stroke-linecap="round"/><path d="M42 14H30M42 14v12" stroke="#C4572A" stroke-width="2.5" stroke-linecap="round"/><circle cx="42" cy="14" r="2.5" fill="#D4A024"/></svg>`,
  Capricorn: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M14 20c4-6 8-10 12-10 6 0 8 4 8 10v16c0 4 2 6 4 6" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M38 42c4 0 6-4 6-8s-2-8-6-8" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="14" cy="20" r="2" fill="#D4A024"/></svg>`,
  Aquarius: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M10 22c3-3 6-3 9 0s6 3 9 0 6-3 9 0 6 3 9 0" stroke="#C4572A" stroke-width="2.5" fill="none" stroke-linecap="round"/><path d="M10 34c3-3 6-3 9 0s6 3 9 0 6-3 9 0 6 3 9 0" stroke="#C4572A" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>`,
  Pisces: `<svg viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#E8871E" stroke-width="0.5" opacity="0.15"/><path d="M20 10c-8 6-10 14-10 18s2 12 10 18" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M36 10c8 6 10 14 10 18s-2 12-10 18" stroke="#C4572A" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 28h32" stroke="#C4572A" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="22" r="2" fill="#D4A024"/><circle cx="36" cy="34" r="2" fill="#D4A024"/></svg>`,
};

const SIGNS = [
  { western: "Aries", sanskrit: "मेष · Mesha", energy: "Ignition" },
  { western: "Taurus", sanskrit: "वृषभ · Vrishabha", energy: "Accumulation" },
  { western: "Gemini", sanskrit: "मिथुन · Mithuna", energy: "Exchange" },
  { western: "Cancer", sanskrit: "कर्क · Karka", energy: "Protection" },
  { western: "Leo", sanskrit: "सिंह · Simha", energy: "Radiance" },
  { western: "Virgo", sanskrit: "कन्या · Kanya", energy: "Refinement" },
  { western: "Libra", sanskrit: "तुला · Tula", energy: "Balance" },
  { western: "Scorpio", sanskrit: "वृश्चिक · Vrischika", energy: "Depth" },
  { western: "Sagittarius", sanskrit: "धनु · Dhanu", energy: "Aim" },
  { western: "Capricorn", sanskrit: "मकर · Makara", energy: "Structure" },
  { western: "Aquarius", sanskrit: "कुम्भ · Kumbha", energy: "Transmission" },
  { western: "Pisces", sanskrit: "मीन · Meena", energy: "Dissolution" },
];

const SAPTARISHIS = [
  { name: "Vasishtha", sanskrit: "वसिष्ठ", icon: "व", role: "Life Path", desc: "Guides your dharmic path and life purpose through planetary alignment." },
  { name: "Vishwamitra", sanskrit: "विश्वामित्र", icon: "वि", role: "Career", desc: "Decodes career timing windows and professional transitions." },
  { name: "Atri", sanskrit: "अत्रि", icon: "अ", role: "Relationships", desc: "Analyzes rashi compatibility and relationship timing." },
  { name: "Bharadvaja", sanskrit: "भरद्वाज", icon: "भ", role: "Knowledge", desc: "Maps learning cycles and ideal education windows." },
  { name: "Gautama", sanskrit: "गौतम", icon: "गौ", role: "Health", desc: "Tracks planetary influences on vitality and dosha balance." },
  { name: "Jamadagni", sanskrit: "जमदग्नि", icon: "ज", role: "Wealth", desc: "Identifies financial timing signals and wealth-building windows." },
  { name: "Kashyapa", sanskrit: "कश्यप", icon: "क", role: "Spiritual Growth", desc: "Guides meditation timing and spiritual practice windows." },
];

/* --- DOM --- */
const yearEl = document.getElementById("year");
const signGrid = document.getElementById("sign-grid");
const agentsGrid = document.getElementById("agents-grid");
const waitlistForm = document.getElementById("waitlist-form");
const emailInput = document.getElementById("email");
const formStatus = document.getElementById("form-status");

if (yearEl) yearEl.textContent = new Date().getFullYear();

/* --- Scroll reveal --- */
function initReveals() {
  const els = document.querySelectorAll(
    ".section-header, .feature-card, .quote-card, .moment-showcase, .inline-quote, " +
    ".convergence-content, .agents-visual-band, .agents-grid, .surya-content, " +
    ".sign-grid, .cta-content, .hero-content, .hero-showcase"
  );
  if (!("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("reveal", "is-visible"));
    return;
  }
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          obs.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );
  els.forEach((el) => {
    el.classList.add("reveal");
    obs.observe(el);
  });
}

/* --- Build agents grid --- */
function buildAgentsGrid() {
  if (!agentsGrid) return;
  agentsGrid.innerHTML = SAPTARISHIS.map(
    (r) => `
      <article class="agent-card">
        <div class="agent-icon">${r.icon}</div>
        <div class="agent-info">
          <span class="agent-sanskrit">${r.sanskrit}</span>
          <h3>${r.name}</h3>
          <span class="agent-role">${r.role}</span>
          <p>${r.desc}</p>
        </div>
      </article>`
  ).join("");
}

/* --- Build sign grid --- */
function buildSignGrid() {
  if (!signGrid) return;
  signGrid.innerHTML = SIGNS.map(
    (s) => `
      <article class="sign-card">
        <span>${s.sanskrit}</span>
        <div class="sign-art">${SIGN_ART[s.western] || ""}</div>
        <strong>${s.western}</strong>
        <em>${s.energy}</em>
      </article>`
  ).join("");
}

/* --- Waitlist form --- */
if (waitlistForm instanceof HTMLFormElement && emailInput && formStatus) {
  waitlistForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    formStatus.classList.remove("is-success", "is-error");
    if (!email) {
      formStatus.textContent = "Enter an email first.";
      formStatus.classList.add("is-error");
      return;
    }
    window.localStorage.setItem("adiyogi-waitlist-email", email);
    formStatus.textContent = "You're on the list. The rishis will reach you. ✨";
    formStatus.classList.add("is-success");
    waitlistForm.reset();
  });
}

/* --- Init --- */
buildAgentsGrid();
buildSignGrid();
initReveals();

/* --- Galaxy WebGL backgrounds --- */
import("./galaxy-effect.js")
  .then(({ createGalaxy }) => {
    const heroEl = document.getElementById("galaxy-hero");
    if (heroEl) {
      createGalaxy(heroEl, {
        density: 0.7, glowIntensity: 0.3, saturation: 0.15, hueShift: 30,
        twinkleIntensity: 0.4, rotationSpeed: 0.03, speed: 0.5,
        mouseRepulsion: true, repulsionStrength: 2, transparent: true,
      });
    }

    const convEl = document.getElementById("galaxy-convergence");
    if (convEl) {
      createGalaxy(convEl, {
        density: 1.0, glowIntensity: 0.35, saturation: 0.1, hueShift: 35,
        twinkleIntensity: 0.5, rotationSpeed: 0.02, speed: 0.4,
        mouseRepulsion: false, autoCenterRepulsion: 0.4, transparent: true,
      });
    }

    const ctaEl = document.getElementById("galaxy-cta");
    if (ctaEl) {
      createGalaxy(ctaEl, {
        density: 0.5, glowIntensity: 0.25, saturation: 0.1, hueShift: 25,
        twinkleIntensity: 0.5, rotationSpeed: 0.02, speed: 0.4,
        mouseRepulsion: true, repulsionStrength: 1.5, transparent: true,
      });
    }
  })
  .catch((err) => console.warn("Galaxy effect unavailable:", err.message));
