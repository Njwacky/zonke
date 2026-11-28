// For Nandi — Manxumalo
// Edit the date below to your next call / visit (YYYY-MM-DDTHH:MM:SS)
const NEXT_MEET = null; // Set this once your next call or visit is planned.

// Countdown
function tick(){
  const el = (id)=>document.getElementById(id);
  if (!NEXT_MEET || !Number.isFinite(new Date(NEXT_MEET).getTime())) {
    el('countdown').hidden = true;
    el('countdownNote').textContent = "Sisazohlela ukuthi sizobonana nini. Until then, ngicabanga ngawe.";
    return;
  }
  const target = new Date(NEXT_MEET).getTime();
  const now = Date.now();
  let diff = target - now;
  if(diff < 0) diff = 0;
  const d = Math.floor(diff/86400000);
  const h = Math.floor(diff%86400000/3600000);
  const m = Math.floor(diff%3600000/60000);
  const s = Math.floor(diff%60000/1000);
  el('cd-days').textContent = d;
  el('cd-hours').textContent = String(h).padStart(2,'0');
  el('cd-mins').textContent = String(m).padStart(2,'0');
  el('cd-secs').textContent = String(s).padStart(2,'0');
  if(diff===0) el('countdownNote').textContent = "Isikhathi sesifikile! Can't wait, Manxumalo 💗";
}
tick(); setInterval(tick,1000);

// Hugs
let hugs = 0;
try { hugs = Math.max(0, parseInt(localStorage.getItem('nandi_hugs'), 10) || 0); } catch {}
const hugMsgs = [
  "Thinta lapha, Manxumalo. One more hug? 💗",
  "Nansi i-hug yakho. A big one! 🤗",
  "Enye futhi? Ngikhona, Manxumalo. 😊",
  "Ngifisa sengathi bengikugonile ngempela.",
  "Sending a little warmth — usuka kimi uya kuwe. 💗",
  "Ama-hug awapheli lapha. Keep going!",
  "Noma ukude, ngicabanga ngawe.",
  "Okay, hug champion! Eyokugcina? Angikholwa. 😄"
];
function renderHugs(){
  document.getElementById('hugCount').textContent = `Ama-hug: ${hugs}`;
  document.getElementById('hugCountHero').textContent = `Ama-hug: ${hugs}`;
  document.getElementById('hugMsg').textContent = hugMsgs[Math.min(hugs, hugMsgs.length-1)] || hugMsgs[hugMsgs.length-1];
}
function sendHug(event){
  hugs++;
  try { localStorage.setItem('nandi_hugs', String(hugs)); } catch {}
  renderHugs();
  const button = event.currentTarget;
  const rect = button.getBoundingClientRect();
  burstHearts(16, rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (!motionPaused) {
    button.animate?.([
      { transform: 'scale(1)' }, { transform: 'scale(.92)', offset: .25 },
      { transform: 'scale(1.08)', offset: .65 }, { transform: 'scale(1)' }
    ], { duration: 420, easing: 'ease-out' });
    document.querySelectorAll('.hug-count').forEach(count => count.animate?.([
      { transform: 'translateY(0)', opacity: .4 },
      { transform: 'translateY(-5px)', offset: .4 },
      { transform: 'translateY(0)', opacity: 1 }
    ], { duration: 400 }));
  }
}
document.getElementById('hugBtn').addEventListener('click', sendHug);
document.getElementById('hugBtnHero').addEventListener('click', sendHug);
renderHugs();

// Envelopes modal
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
document.querySelectorAll('.envelope').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    modalTitle.textContent = btn.dataset.title;
    modalBody.textContent = btn.dataset.body;
    openDialog(modal, btn);
    btn.classList.add('is-read');
    btn.setAttribute('aria-label', `${btn.dataset.title} — usuwufundile`);
  });
});
document.getElementById('modalClose').addEventListener('click', closeDialogs);
modal.addEventListener('click', (e)=>{ if(e.target===modal) closeDialogs(); });

// Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
document.querySelectorAll('.photo-open').forEach(button=>{
  button.addEventListener('click', ()=>{
    const image = button.querySelector('img');
    lightboxImg.src = image.currentSrc || image.src;
    lightboxImg.alt = image.alt;
    document.getElementById('lightboxOriginal').href = lightboxImg.src;
    lightbox.querySelector('.lightbox-box').classList.toggle('is-chat', image.closest('.chat-gallery') !== null);
    openDialog(lightbox, button);
  });
});
document.getElementById('lightboxClose').addEventListener('click', closeDialogs);
lightbox.addEventListener('click', (e)=>{ if(e.target===lightbox) closeDialogs(); });

// Motion preferences and an explicit pause control.
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let motionPaused = motionPreference.matches;
const motionToggle = document.getElementById('motionToggle');
function updateMotion() {
  document.documentElement.classList.toggle('motion-paused', motionPaused);
  motionToggle.disabled = motionPreference.matches;
  motionToggle.textContent = motionPreference.matches
    ? 'Animations paused • OS setting'
    : motionPaused ? 'Vula animations ♡' : 'Misa animations ♡';
  motionToggle.setAttribute('aria-pressed', String(motionPaused));
  if (motionPaused) {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
    hearts = [];
    document.getAnimations?.().forEach(animation => animation.cancel());
  }
  syncCanvas();
}
motionToggle.addEventListener('click', () => { motionPaused = !motionPaused; updateMotion(); });
motionPreference.addEventListener('change', event => {
  motionPaused = event.matches;
  updateMotion();
});

// Reveal each card once, with a short stagger within each group.
document.querySelectorAll('.grid, .gallery').forEach(group => {
  [...group.children].forEach((el, i) => el.style.setProperty('--reveal-delay', `${i % 3 * 85}ms`));
});
if ('IntersectionObserver' in window && !motionPaused) {
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: .08 });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
  document.documentElement.classList.add('motion-ready');
}

// Lightweight, time-based hearts. Stop drawing in background tabs or paused mode.
const canvas = document.getElementById('hearts');
const ctx = canvas.getContext('2d');
let W, H, hearts = [], frame = null, previousTime = 0;
function resize() {
  W = innerWidth; H = innerHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * ratio; canvas.height = H * ratio;
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
resize();
addEventListener('resize', resize);
function makeHeart(x, y, burst = false) {
  return {
    x, y, size: burst ? 6 + Math.random() * 9 : 5 + Math.random() * 8,
    vx: (Math.random() - .5) * (burst ? 230 : 15),
    vy: burst ? -70 - Math.random() * 100 : -15 - Math.random() * 18,
    rotation: (Math.random() - .5) * .8,
    age: 0, life: burst ? 1.4 : Infinity, burst
  };
}
function burstHearts(n, x = W / 2, y = H * .7) {
  if (motionPaused || !Element.prototype.animate) return;
  // Ambient hearts stay behind the page. Tap feedback sits above the card.
  const existing = [...document.querySelectorAll('.hug-particle')];
  existing.slice(0, Math.max(0, existing.length + n - 64)).forEach(particle => particle.remove());
  for (let i = 0; i < Math.min(n, 64); i++) {
    const particle = document.createElement('span');
    particle.className = 'hug-particle';
    particle.setAttribute('aria-hidden', 'true');
    particle.textContent = '♥';
    particle.style.left = `${x}px`;
    particle.style.top = `${y}px`;
    particle.style.fontSize = `${12 + Math.random() * 14}px`;
    document.body.appendChild(particle);
    const dx = (Math.random() - .5) * 220;
    const dy = -55 - Math.random() * 110;
    const animation = particle.animate([
      { transform: 'translate(-50%, -50%) scale(.5)', opacity: 0 },
      { opacity: 1, offset: .15 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${dx / 3}deg) scale(1)`, opacity: 0 }
    ], {duration: 1100 + Math.random() * 250, easing: 'cubic-bezier(.15,.65,.35,1)', fill: 'forwards'});
    animation.finished.then(() => particle.remove(), () => particle.remove());
  }
}

function loop(time) {
  const dt = Math.min((time - previousTime) / 1000 || .016, .05);
  previousTime = time;
  ctx.clearRect(0, 0, W, H);
  if (hearts.filter(h => !h.burst).length < 14 && Math.random() < dt * 4) {
    hearts.push(makeHeart(Math.random() * W, H + 20));
  }
  hearts = hearts.filter(h => h.y > -30 && h.age < h.life);
  hearts.forEach(h => {
    h.age += dt; h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.burst) h.vy += 65 * dt;
    ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.rotation);
    ctx.globalAlpha = h.burst ? Math.max(0, 1 - h.age / h.life) : .35;
    ctx.fillStyle = h.burst ? '#d7478b' : '#e879aa';
    const s = h.size;
    ctx.beginPath(); ctx.moveTo(0, s * .45);
    ctx.bezierCurveTo(-s, -s * .2, -s * .4, -s, 0, -s * .35);
    ctx.bezierCurveTo(s * .4, -s, s, -s * .2, 0, s * .45);
    ctx.fill(); ctx.restore();
  });
  frame = requestAnimationFrame(loop);
}
function syncCanvas() {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (ctx) ctx.clearRect(0, 0, W, H);
  if (ctx && !motionPaused && !document.hidden) {
    if (!hearts.length) hearts = Array.from({length: 14}, () => makeHeart(Math.random() * W, Math.random() * H));
    previousTime = 0;
    frame = requestAnimationFrame(loop);
  }
}
document.addEventListener('visibilitychange', syncCanvas);
updateMotion();

// Dialog backgrounds cannot scroll or receive focus while a note/photo is open.
let lastDialogTrigger;
const inertSnapshot = new Map();
function openDialog(dialog, trigger) {
  lastDialogTrigger = trigger;
  [modal, lightbox].forEach(other => { other.hidden = other !== dialog; });
  document.documentElement.classList.add('dialog-open');
  [...document.body.children].forEach(element => {
    if (element.classList.contains('modal') || element.tagName === 'SCRIPT') return;
    if (!inertSnapshot.has(element)) inertSnapshot.set(element, element.inert);
    element.inert = true;
  });
  dialog.querySelectorAll('.modal-content, .lightbox-viewport').forEach(content => { content.scrollTop = 0; });
  dialog.querySelector('.modal-close').focus({preventScroll: true});
}
function closeDialogs() {
  modal.hidden = true;
  lightbox.hidden = true;
  document.documentElement.classList.remove('dialog-open');
  inertSnapshot.forEach((wasInert, element) => { element.inert = wasInert; });
  inertSnapshot.clear();
  lastDialogTrigger?.focus({preventScroll: true});
}
document.addEventListener('keydown', event => {
  const opened = !modal.hidden ? modal : !lightbox.hidden ? lightbox : null;
  if (!opened) return;
  if (event.key === 'Escape') closeDialogs();
  if (event.key === 'Tab') {
    const focusable = [...opened.querySelectorAll('button, a[href], [tabindex="0"]')];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }
});

// Lift the keepsake out of the envelope, then take her to the actual letter.
const openLetter = document.getElementById('openLetter');
let letterOpening = false;
openLetter.addEventListener('click', event => {
  // Keep native browser behaviour for opening the link in a new tab.
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (letterOpening) return;
  letterOpening = true;
  openLetter.classList.add('is-open');
  setTimeout(() => {
    const letter = document.getElementById('letter');
    letter.scrollIntoView({behavior: motionPaused ? 'instant' : 'smooth', block: 'start'});
    letter.setAttribute('tabindex', '-1');
    letter.focus({preventScroll: true});
    history.replaceState(null, '', '#letter');
    letterOpening = false;
  }, motionPaused ? 0 : 650);
});

// Keep unfinished content out of her gift. Set a real HTTPS song/playlist URL here.
const SONG_URL = null;
if (SONG_URL) {
  try {
    const song = new URL(SONG_URL);
    if (song.protocol === 'https:') {
      document.getElementById('songLink').href = song.href;
      document.getElementById('playlistSection').hidden = false;
    }
  } catch { /* Invalid links stay hidden. */ }
}
