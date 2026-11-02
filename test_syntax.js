
const APP_URL = 'https://invocation-du-matin-et-du-soir.netlify.app/';
const APK_URL = 'https://github.com/mouhamed229-glitch/adhkar-app/releases/latest';

// ── DÉTECTION CAPACITOR (APK natif) ────────────────────────────────────────
// Activer le mode arrière-plan (Foreground Service) si on est sur Android
if (window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode) {
  window.cordova.plugins.backgroundMode.enable();
  window.cordova.plugins.backgroundMode.setDefaults({
    title: 'Invocations - Matin & Soir',
    text: 'En cours de lecture...',
    hidden: false,
    silent: true
  });
}
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
let CapacitorHaptics = null;
let CapacitorShare = null;
let CapacitorApp = null;
if (isNative && window.Capacitor.Plugins) {
  CapacitorHaptics = window.Capacitor.Plugins.Haptics || null;
  CapacitorShare   = window.Capacitor.Plugins.Share   || null;
  CapacitorApp     = window.Capacitor.Plugins.App     || null;
  console.log('📱 Capacitor natif détecté', { Haptics: !!CapacitorHaptics, Share: !!CapacitorShare, App: !!CapacitorApp });
}
// ── SERVICE WORKER (fichier réel /sw.js) ───────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
  if (typeof renderStreak === 'function') renderStreak();
    navigator.serviceWorker.register('/sw.js', {scope: '/'})
      .then(reg => {
        // Forcer mise en cache de la page actuelle
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'CACHE_NOW',
            urls: [location.href]
          });
        }
        console.log('✓ SW enregistré');
      })
      .catch(e => console.warn('SW erreur:', e));
  });
}

// ── MANIFEST ────────────────────────────────────────────────────────────────
// Le manifest est servi via /manifest.json (fichier séparé)

// ── THÈME ───────────────────────────────────────────────────────────────────
let currentTheme = localStorage.getItem('adhkar-theme') || 'auto';
const themeIcons = {light:'☀️', dark:'🌙', auto:'⚙️'};

function applyTheme(t) {
  let actual = t;
  if (t === 'auto') actual = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', actual);
  document.getElementById('themeNavIcon').textContent = themeIcons[t];
  document.getElementById('themeColorMeta').content = actual === 'dark' ? '#0D0904' : '#9C7326';
  ['light','dark','auto'].forEach(x => {
    document.getElementById('opt-'+x).classList.toggle('selected', x === t);
  });
}
function setTheme(t) {
  currentTheme = t;
  localStorage.setItem('adhkar-theme', t);
  applyTheme(t);
  setTimeout(() => closeModal('modalTheme'), 300);
}
matchMedia('(prefers-color-scheme:dark)').addEventListener('change', () => {
  if (currentTheme === 'auto') applyTheme('auto');
});
applyTheme(currentTheme);

// ── TABS ────────────────────────────────────────────────────────────────────
let currentMode = 'matin';
function setMode(m) {
  const isMatin = m === 'matin';
  currentMode = m;
  stopAllSpeech();
  document.getElementById('tabMatin').classList.toggle('is-active', isMatin);
  document.getElementById('tabSoir').classList.toggle('is-active', !isMatin);
  document.querySelector('.tab-matin').classList.toggle('is-active', isMatin);
  document.querySelector('.tab-soir').classList.toggle('is-active', !isMatin);
  document.getElementById('blocMatin').classList.toggle('is-active', isMatin);
  document.getElementById('blocSoir').classList.toggle('is-active', !isMatin);
  document.getElementById('navMatin').classList.toggle('active', isMatin);
  document.getElementById('navSoir').classList.toggle('active', !isMatin);
  const fab = document.getElementById('fabPlayAll');
  if (fab) fab.classList.toggle('mode-soir', !isMatin);
  updateGlobalProgress();
  window.scrollTo({top:0, behavior:'smooth'});
}

// ── AUDIO — Fichiers pré-enregistrés (priorité) + voix système (secours) ───
// Convention de nommage : audio/matin/matin-01.mp3, audio/matin/matin-02.mp3…
//                         audio/soir/soir-01.mp3,   audio/soir/soir-02.mp3…
// Numérotation = ordre d'affichage des cartes, de haut en bas.
// Si un fichier n'existe pas encore (404), l'app bascule automatiquement,
// sans rien casser, sur la voix du téléphone (silencieusement).
const AUDIO_BASE = 'audio/';
let audioEl = null;
function getAudioEl() {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.preload = 'none';
  }
  audioEl.playbackRate = playbackSpeed;
  return audioEl;
}

// ── Vitesse de lecture (fichiers audio + voix de secours) ──────────────────
let playbackSpeed = parseFloat(localStorage.getItem('adhkar-speed') || '1');
function setPlaybackSpeed(speed) {
  playbackSpeed = speed;
  localStorage.setItem('adhkar-speed', String(speed));
  if (audioEl) audioEl.playbackRate = speed;
  renderSpeedChips();
}
function renderSpeedChips() {
  document.querySelectorAll('#speedChips .opt-chip').forEach(c => {
    c.classList.toggle('selected', parseFloat(c.dataset.speed) === playbackSpeed);
  });
}
// Correspondance position de carte (1-based, après découpage des 3 Qul) → fichier audio.
// Carte 1 (invocation d'ouverture) : pas d'audio.
// Cartes 3-4-5 (Al-Ikhlas / Al-Falaq / An-Nas) : fichiers -03-1 / -03-2 / -03-3.
// Toutes les autres cartes : numérotées normalement (position - 2), inchangé sinon.
function audioFileFor(mode, position) {
  if (position === 1) return null;
  if (position === 3) return AUDIO_BASE + mode + '/' + mode + '-03-1.mp3';
  if (position === 4) return AUDIO_BASE + mode + '/' + mode + '-03-2.mp3';
  if (position === 5) return AUDIO_BASE + mode + '/' + mode + '-03-3.mp3';
  const fileNum = position <= 2 ? position : position - 2;
  const n = String(fileNum).padStart(2, '0');
  return AUDIO_BASE + mode + '/' + mode + '-' + n + '.mp3';
}

let arabicVoices = [];
let selectedVoiceURI = localStorage.getItem('adhkar-voice') || null;
let activeBtn = null;         // bouton 🔊 actuellement en lecture
let readAllQueue = [];        // file d'attente pour "Écouter tout" : [{text, audioSrc}]
let readAllIndex = 0;
let isReadingAll = false;
let currentUtterance = null;  // référence gardée en vie pour éviter le garbage collector (voix de secours)
let keepAliveTimer = null;    // anti-coupure Chrome Android (~15s) pour la voix de secours
let speakWatchdog = null;

// Par défaut, l'app joue UNIQUEMENT les fichiers audio fournis. La voix du
// téléphone (Web Speech API) reste disponible mais désactivée par défaut ;
// on ne l'active que si l'utilisateur le demande explicitement en Réglages.
let fallbackEnabled = localStorage.getItem('adhkar-fallback-enabled') === 'true';
function setFallbackEnabled(v) {
  fallbackEnabled = v;
  localStorage.setItem('adhkar-fallback-enabled', String(v));
  renderFallbackToggle();
  renderVoiceOptions();
}
function renderFallbackToggle() {
  document.querySelectorAll('#fallbackToggleChips .opt-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === String(fallbackEnabled));
  });
  const wrap = document.getElementById('voiceOptionsWrap');
  if (wrap) wrap.style.display = fallbackEnabled ? '' : 'none';
}

let allVoicesCount = 0;
function loadVoices() {
  const all = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  allVoicesCount = all.length;
  arabicVoices = all.filter(v => v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('ar'));
  renderVoiceOptions();
}
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
  [300, 800, 1500, 3000, 6000, 10000].forEach(delay => setTimeout(loadVoices, delay));
}

function guessVoiceIcon(name) {
  const n = name.toLowerCase();
  if (/female|femme|woman|zira|salma|hoda/.test(n)) return '👩';
  if (/male|homme|man|hamed|majed/.test(n)) return '👨';
  return '🎙️';
}
function guessVoiceLabel(name, idx) {
  const n = name.toLowerCase();
  if (/female|femme|woman|zira|salma|hoda/.test(n)) return 'Voix féminine';
  if (/male|homme|man|hamed|majed/.test(n)) return 'Voix masculine';
  return 'Voix ' + (idx + 1);
}
function renderVoiceOptions() {
  const box = document.getElementById('voiceOptions');
  if (!box) return;
  if (!arabicVoices.length) {
    box.innerHTML =
      '<div class="voice-empty">Aucune voix de secours arabe trouvée sur ce téléphone pour l\'instant. ' +
      'Ce n\'est pas grave si vos fichiers audio sont bien en place — ils sont prioritaires et n\'en ont pas besoin.<br><br>' +
      '<div class="voice-retry" onclick="loadVoices()">🔄 Revérifier maintenant</div></div>';
    return;
  }
  const listHtml = arabicVoices.length === 1
    ? '<div class="voice-single">Voix de secours disponible : <strong>' + arabicVoices[0].name + '</strong></div>'
    : arabicVoices.map((v, i) => {
        const sel = v.voiceURI === selectedVoiceURI || (!selectedVoiceURI && i === 0);
        return '<div class="voice-opt' + (sel ? ' selected' : '') + '" onclick="selectVoice(\'' + v.voiceURI.replace(/'/g, "\\'") + '\')">' +
          '<span class="voice-opt-icon">' + guessVoiceIcon(v.name) + '</span>' +
          '<div class="voice-opt-info"><div class="voice-opt-name">' + guessVoiceLabel(v.name, i) + '</div>' +
          '<div class="voice-opt-desc">' + v.name + '</div></div>' +
          '<span class="voice-opt-check">✓</span></div>';
      }).join('');
  if (!selectedVoiceURI) selectedVoiceURI = arabicVoices[0].voiceURI;
  box.innerHTML = listHtml + '<div class="voice-test-btn" onclick="testVoice()">▶️ Tester la voix de secours</div>';
}
function selectVoice(uri) {
  selectedVoiceURI = uri;
  localStorage.setItem('adhkar-voice', uri);
  renderVoiceOptions();
  testVoice();
}
function testVoice() {
  speakRaw('السلام عليكم ورحمة الله وبركاته', {});
}
function getSelectedVoice() {
  if (!arabicVoices.length) return null;
  return arabicVoices.find(v => v.voiceURI === selectedVoiceURI) || arabicVoices[0];
}

// Voix de secours (Web Speech API) — utilisée UNIQUEMENT si le fichier audio est absent.
function speakRaw(text, {onstart, onend, onerror} = {}) {
  if (!('speechSynthesis' in window)) { if (onerror) onerror(); return; }
  clearTimeout(speakWatchdog);
  speechSynthesis.cancel();
  setTimeout(() => {
    try { if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) {}
    const utter = new SpeechSynthesisUtterance(text);
    const v = getSelectedVoice();
    if (v) { utter.voice = v; utter.lang = v.lang; } else { utter.lang = 'ar-SA'; }
    utter.rate = Math.min(3, Math.max(0.3, .85 * playbackSpeed));
    utter.pitch = 1;
    let started = false;
    utter.onstart = () => {
      started = true;
      clearTimeout(speakWatchdog);
      clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(() => {
        if (speechSynthesis.speaking) { speechSynthesis.pause(); speechSynthesis.resume(); }
      }, 4000);
      if (onstart) onstart();
    };
    utter.onend = () => { clearInterval(keepAliveTimer); currentUtterance = null; if (onend) onend(); };
    utter.onerror = () => { clearInterval(keepAliveTimer); currentUtterance = null; if (onerror) onerror(); };
    currentUtterance = utter;
    speechSynthesis.speak(utter);
    speakWatchdog = setTimeout(() => { if (!started && onerror) onerror(); }, 2500);
  }, 80);
}

// Lecture d'une invocation : fichier pré-enregistré en priorité, voix de secours sinon.
function playAudioOrFallback(audioSrc, fallbackText, {onstart, onend, onerror, repeatCount, stopAtFraction} = {}) {
  const total = repeatCount || 1;
  let played = 0;
  let usedFallback = false;
  const a = getAudioEl();
  a.onplay = null; a.onended = null; a.onerror = null;
  a.pause();
  try { a.currentTime = 0; } catch (e) {}
  // Fallback : voix de secours jouée N fois de suite
  const doFallbackRepeat = () => {
    let fbPlayed = 0;
    const nextFb = () => {
      fbPlayed++;
      if (fbPlayed < total) {
        speakRaw(fallbackText, { onend: nextFb });
      } else if (onend) { onend(); }
    };
    speakRaw(fallbackText, { onstart, onend: nextFb, onerror });
  };
  const tryFallback = () => {
    if (usedFallback) return;
    usedFallback = true;
    if (fallbackEnabled) { doFallbackRepeat(); }
    else if (onerror) { onerror(); }
  };
  const onAudioEnded = () => {
    played++;
    if (played < total) {
      try { a.currentTime = 0; a.play(); } catch (e) { tryFallback(); }
    } else if (onend) {
      onend();
    }
  };
  a.src = audioSrc;
  a.playbackRate = playbackSpeed;
  a.onloadedmetadata = () => { a.playbackRate = playbackSpeed; };
  // Si on doit couper le son avant la fin (pour le comptage exact)
  let stopTimeout = null;
  const currentAudio = a;
  a.onplay = () => { 
    a.playbackRate = playbackSpeed; 
    if (onstart) onstart();
    if (stopAtFraction && a.duration) {
      clearTimeout(stopTimeout);
      stopTimeout = setTimeout(() => {
        if (!currentAudio.paused) currentAudio.pause();
      }, (a.duration / stopAtFraction) * 1000);
    }
  };
  a.onended = () => { clearTimeout(stopTimeout); onAudioEnded(); };
  a.onerror = tryFallback;
  a.play().then(() => { a.playbackRate = playbackSpeed; }).catch(tryFallback);
  // Nettoyage de sécurité si on coupe manuellement
  const originalPause = a.pause;
  a.pause = function() {
    clearTimeout(stopTimeout);
    originalPause.apply(a);
  };
}
function stopAudioOrSpeech() {
  clearInterval(keepAliveTimer);
  clearTimeout(speakWatchdog);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const a = getAudioEl();
  a.onplay = null; a.onended = null; a.onerror = null;
  a.pause();
  currentUtterance = null;
}

function resetAudioBtn(btn) {
  if (!btn) return;
  btn.classList.remove('is-playing');
  const lbl = btn.querySelector('.audio-btn-label');
  if (lbl) lbl.textContent = 'Écouter';
}
function stopAllSpeech() {
  stopAudioOrSpeech();
  if (activeBtn) resetAudioBtn(activeBtn);
  activeBtn = null;
  stopReadAll();
}
function toggleSpeakCard(btn, text, audioSrc, repeatCount) {
  stopReadAll();
  if (activeBtn === btn) {
    stopAllSpeech();
    return;
  }
  if (activeBtn) resetAudioBtn(activeBtn);
  stopAudioOrSpeech();
  activeBtn = btn;
  playAudioOrFallback(audioSrc, text, {
    onstart: () => { btn.classList.add('is-playing'); const lbl = btn.querySelector('.audio-btn-label'); if (lbl) lbl.textContent = 'Pause'; },
    onend:   () => { resetAudioBtn(btn); if (activeBtn === btn) activeBtn = null; },
    onerror: () => {
      resetAudioBtn(btn);
      if (activeBtn === btn) activeBtn = null;
      alert(fallbackEnabled
        ? 'Impossible de lire cette invocation : ni le fichier audio, ni la voix du téléphone ne sont disponibles.'
        : 'Le fichier audio de cette invocation est introuvable.\n\nVous pouvez activer la voix de secours dans ⚙️ Réglages, ou ajouter le fichier audio correspondant.');
    },
    repeatCount: repeatCount || 1
  });
}

// Injecte un bouton 🔊 sur chaque carte + calcule le nom de fichier attendu,
// sans toucher au contenu religieux
// ── Compteur de répétitions tactile — toute la carte est la zone de tap ────
// On tape n'importe où sur la carte (sauf le bouton 🔊 dédié) pour décompter
// une répétition : grande cible, utilisable d'une main sans regarder l'écran,
// à la manière d'un tasbih. Vibration courte à chaque tap, vibration longue
// + double bip et petite animation quand une invocation est terminée (✓).
function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function loadProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem('adhkar-progress-v2') || 'null');
    if (raw && raw.date === todayKey()) return raw.counts || {};
  } catch (e) {}
  return {};
}
function saveProgress() {
  try { localStorage.setItem('adhkar-progress-v2', JSON.stringify({ date: todayKey(), counts: progressCounts })); } catch (e) {}
}
// ── Vibration : utilise le plugin natif Haptics sur Android, fallback navigateur sinon
async function vibrateNative(pattern) {
  if (!CapacitorHaptics) return false;
  try {
    if (typeof pattern === 'number') {
      const style = pattern >= 80 ? 'HEAVY' : pattern >= 50 ? 'MEDIUM' : 'LIGHT';
      await CapacitorHaptics.impact({ style });
    } else if (Array.isArray(pattern)) {
      for (let i = 0; i < pattern.length; i++) {
        const d = pattern[i];
        if (d > 0) await CapacitorHaptics.vibrate({ duration: d });
        if (i < pattern.length - 1) {
          const pause = pattern[i + 1] && pattern[i + 1] < 50 ? 80 : 150;
          await new Promise(r => setTimeout(r, pause));
        }
      }
    }
    return true;
  } catch (e) {
    console.warn('Haptics erreur :', e);
    return false;
  }
}
function vibrate(pattern) {
  // 1. On tente le plugin natif Android
  if (CapacitorHaptics) {
    vibrateNative(pattern);
  }
  // 2. En parallèle (ou si le natif échoue), on tente la vibration web classique
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch (e) {}
}

// ── Réglages de vibration ────────────────────────────────────────────────
// Tap : petit à-coup à chaque répétition.
// Fin d'invocation : vibration LONGUE (1 à 2s) qui se termine par un double
// bip net — pour bien sentir la différence entre "encore en cours" et
// "c'est fini", sans avoir à regarder l'écran.
const VIBE_TAP_MS = { off: 0, light: 30, normal: 55, strong: 90 };
const VIBE_DONE_PATTERN = {
  off: [],
  light:  [1000, 200, 70, 110, 70],
  normal: [1500, 220, 90, 110, 90],
  strong: [2000, 250, 110, 120, 110]
};
let vibeTapLevel = localStorage.getItem('adhkar-vibe-tap') || 'normal';
let vibeDoneLevel = localStorage.getItem('adhkar-vibe-done') || 'normal';
let tapAudioCtx = null;
function playBeep() {
  try {
    if (!tapAudioCtx) tapAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (tapAudioCtx.state === 'suspended') tapAudioCtx.resume();
    const osc = tapAudioCtx.createOscillator();
    const gain = tapAudioCtx.createGain();
    osc.connect(gain);
    gain.connect(tapAudioCtx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, tapAudioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, tapAudioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, tapAudioCtx.currentTime + 0.05);
    osc.start();
    osc.stop(tapAudioCtx.currentTime + 0.05);
  } catch (e) {}
}
function vibrateTap() {
  const ms = VIBE_TAP_MS[vibeTapLevel] || 0;
  if (ms > 0) vibrate(ms);
}
function playChime() {
  try {
    if (!tapAudioCtx) tapAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (tapAudioCtx.state === 'suspended') tapAudioCtx.resume();
    // Un accord parfait majeur (Do - Mi - Sol) très doux
    const freqs = [523.25, 659.25, 783.99]; 
    freqs.forEach((freq, index) => {
      const osc = tapAudioCtx.createOscillator();
      const gain = tapAudioCtx.createGain();
      osc.connect(gain);
      gain.connect(tapAudioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, tapAudioCtx.currentTime);
      // Enveloppe douce (attaque rapide, déclin long)
      const startTime = tapAudioCtx.currentTime + (index * 0.1); // Arpège
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);
      osc.start(startTime);
      osc.stop(startTime + 1.2);
    });
  } catch (e) {}
}
function vibrateDone() {
  const pattern = VIBE_DONE_PATTERN[vibeDoneLevel];
  if (pattern && pattern.length) vibrate(pattern);
}
function setVibeTap(level) { vibeTapLevel = level; localStorage.setItem('adhkar-vibe-tap', level); renderVibeChips(); }
function setVibeDone(level) { vibeDoneLevel = level; localStorage.setItem('adhkar-vibe-done', level); renderVibeChips(); }
function testVibe() { vibrateTap(); setTimeout(vibrateDone, 550); }
function renderVibeChips() {
  document.querySelectorAll('#vibeTapChips .opt-chip').forEach(c => c.classList.toggle('selected', c.dataset.level === vibeTapLevel));
  document.querySelectorAll('#vibeDoneChips .opt-chip').forEach(c => c.classList.toggle('selected', c.dataset.level === vibeDoneLevel));
}

// ── Célébration de fin de session (tout le tasbih du matin/soir terminé) ──
// Vibration distincte, différente des deux précédentes, + message tiré au
// sort parmi plusieurs variantes pour ne pas être répétitif.
const SESSION_DONE_VIBRATION = [70, 90, 70, 90, 160];
const SESSION_MESSAGES = {
  matin: [
    "Tu as terminé tous tes adhkar du matin. Qu'Allah illumine ta journée et te préserve de tout mal — آمين.",
    "Alhamdulillah, tous les adhkar du matin sont accomplis. Que cette journée soit pleine de baraka pour toi.",
    "C'est fait ! Tes adhkar du matin sont terminés. Qu'Allah te couvre de Sa protection jusqu'au soir.",
    "Tous les adhkar du matin récités avec constance. Qu'Allah accepte cet effort et t'accorde une journée sereine, in shâ Allah.",
    "Beau moment de dhikr achevé. Que le Miséricordieux garde ton cœur apaisé tout au long de la journée."
  ],
  soir: [
    "Tu as terminé tous tes adhkar du soir. Qu'Allah t'accorde une nuit paisible et une protection totale.",
    "Alhamdulillah, tous les adhkar du soir sont accomplis. Que cette nuit soit douce et bénie pour toi.",
    "C'est fait ! Que le sommeil qui vient soit un repos béni, à l'abri de tout mal, in shâ Allah.",
    "Tous les adhkar du soir récités avec constance. Qu'Allah t'accorde le meilleur en cette vie et dans l'au-delà — آمين.",
    "Beau moment de dhikr achevé. Que cette nuit t'apporte paix, protection, et de beaux rêves."
  ]
};
let sessionCelebrated = { matin: false, soir: false };
let lastMessageIndex = { matin: -1, soir: -1 };

function isModeComplete(mode) {
  const bloc = document.getElementById(mode === 'matin' ? 'blocMatin' : 'blocSoir');
  if (!bloc) return false;
  const cards = Array.from(bloc.querySelectorAll('.card'));
  const trackable = cards.filter(c => parseInt(c.dataset.totalCount || '0', 10) > 0);
  if (!trackable.length) return false;
  return trackable.every(c => {
    const total = parseInt(c.dataset.totalCount, 10);
    const current = progressCounts[c.dataset.cardId] !== undefined ? progressCounts[c.dataset.cardId] : 0;
    return current >= total;
  });
}

function checkSessionCompletion(mode) {
  const complete = isModeComplete(mode);
  if (complete && !sessionCelebrated[mode]) {
    sessionCelebrated[mode] = true;
    celebrateSessionComplete(mode);
  } else if (!complete) {
    sessionCelebrated[mode] = false;
  }
}

function pickSessionMessage(mode) {
  const list = SESSION_MESSAGES[mode] || SESSION_MESSAGES.matin;
  if (list.length === 1) return list[0];
  let idx = Math.floor(Math.random() * list.length);
  if (idx === lastMessageIndex[mode]) idx = (idx + 1) % list.length;
  lastMessageIndex[mode] = idx;
  return list[idx];
}

function celebrateSessionComplete(mode) {
  vibrate(SESSION_DONE_VIBRATION);
  updateStreak(); // Incrémente le compteur de jours consécutifs
  const msgEl = document.getElementById('celebrationMessage');
  const titleEl = document.getElementById('celebrationTitle');
  if (titleEl) titleEl.textContent = mode === 'matin' ? 'Adhkar du matin terminés' : 'Adhkar du soir terminés';
  if (msgEl) msgEl.textContent = pickSessionMessage(mode);
  openModal('modalCelebration');
}

let progressCounts = loadProgress();
const lastCompletedAt = {}; // Empêche un reset accidentel pendant 6 secondes après la fin

async function copyDhikrText(text, btn) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback pour anciens WebView
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    // Feedback visuel
    if (btn) {
      btn.classList.add('copied');
      btn.innerHTML = '✓';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = '📋';
      }, 1500);
    }
    vibrateTap();
  } catch (e) {
    console.warn('Copie échec', e);
    alert('Impossible de copier le texte.');
  }
}
function updateHijriDate() {
  const el = document.getElementById('hijriDate');
  if (!el) return;
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('fr-FR-u-ca-islamic', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    let txt = fmt.format(now);
    txt = txt.replace(/\s*(ap\.?\s*J\.?-?C\.?|ère de l.?Hégire|AH|H)$/i, '').trim();
    el.textContent = txt + ' H.';
  } catch (e) {
    el.style.display = 'none';
  }
}
function resetAllProgress() {
  if (!confirm('Réinitialiser tous les compteurs du jour ?\n\nLes adhkar du matin et du soir seront remis à zéro.')) return;
  progressCounts = {};
  Object.keys(lastCompletedAt).forEach(k => delete lastCompletedAt[k]);
  saveProgress();
  // Mettre à jour l'affichage de toutes les cartes
  document.querySelectorAll('.card').forEach(card => {
    if (typeof card._tapCounterRender === 'function') card._tapCounterRender();
  });
  updateGlobalProgress();
  // Feedback visuel
  vibrateTap();
}
function updateGlobalProgress() {
  const el = document.querySelector('.global-progress');
  if (!el) return;
  const bloc = document.getElementById(currentMode === 'matin' ? 'blocMatin' : 'blocSoir');
  if (!bloc) return;
  // Adapter la couleur selon le mode
  el.classList.toggle('mode-soir', currentMode === 'soir');
  // Compter les cartes terminées
  const cards = Array.from(bloc.querySelectorAll('.card'));
  const trackable = cards.filter(c => parseInt(c.dataset.totalCount || '0', 10) > 0);
  const total = trackable.length;
  let done = 0;
  trackable.forEach(c => {
    const id = c.dataset.cardId;
    const tot = parseInt(c.dataset.totalCount, 10);
    const cur = progressCounts[id] !== undefined ? progressCounts[id] : 0;
    if (cur >= tot) done++;
  });
  const countEl = document.getElementById('progressCount');
  const totalEl = document.getElementById('progressTotal');
  const fillEl = document.getElementById('progressFill');
  if (countEl) countEl.textContent = done;
  if (totalEl) totalEl.textContent = total;
  if (fillEl) fillEl.style.width = total > 0 ? (done / total * 100) + '%' : '0%';
  // Quand tout est terminé : petit message ✓
  const textEl = el.querySelector('.global-progress-text');
  if (textEl) {
    if (total > 0 && done === total) {
      textEl.innerHTML = '✓ Toutes les invocations terminées — Alhamdulillah';
      textEl.style.color = 'var(--green)';
      textEl.style.fontWeight = '700';
    } else {
      textEl.innerHTML = '<span id="progressCount">' + done + '</span> / <span id="progressTotal">' + total + '</span> invocations terminées';
      textEl.style.color = '';
      textEl.style.fontWeight = '';
    }
  }
}
function scrollToNextCard(currentCard) {
  // Trouver la carte suivante dans le même bloc
  let next = currentCard.nextElementSibling;
  while (next && !next.classList.contains('card')) {
    next = next.nextElementSibling;
  }
  if (!next) return; // Pas de carte suivante, on ne fait rien
  // Vérifier qu'elle n'est pas déjà terminée
  const nextId = next.dataset.cardId;
  const nextTotal = parseInt(next.dataset.totalCount || '0', 10);
  const nextCurrent = progressCounts[nextId] !== undefined ? progressCounts[nextId] : 0;
  if (nextTotal > 0 && nextCurrent >= nextTotal) return; // Déjà terminée, on ne scrolle pas
  // Scroll smooth vers la carte suivante
  next.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function setupCounter(card, cardId, total) {
  const countEl = card.querySelector('.card-count');
  if (!countEl || !total) return;
  countEl.setAttribute('aria-hidden', 'true'); // la carte entière porte l'interaction (voir plus bas)
  card.dataset.cardId = cardId;
  card.dataset.totalCount = String(total);
  const mode = cardId.split('-')[0];

  // On affiche la PROGRESSION (nombre déjà récité → total), pas ce qu'il reste.
  const render = () => {
    const current = progressCounts[cardId] !== undefined ? progressCounts[cardId] : 0;
    if (current >= total) {
      countEl.textContent = '✓';
      countEl.classList.add('is-done');
    } else {
      countEl.innerHTML = '<span class="cnt-num">' + current + '</span><span class="cnt-arrow">➜</span><span class="cnt-total">/' + total + '</span>';
      countEl.classList.remove('is-done');
    }
  };

  const replay = cls => {
    countEl.classList.remove(cls);
    void countEl.offsetWidth; // force le redémarrage de l'animation
    countEl.classList.add(cls);
  };

  const tap = () => {
    const now = Date.now();
    const current = progressCounts[cardId] !== undefined ? progressCounts[cardId] : 0;
    if (current >= total) {
      // Protection anti-reset accidentel : on ignore les taps pendant 6 secondes
      // après la fin, pour ne pas relancer le comptage par erreur.
      if (lastCompletedAt[cardId] && (now - lastCompletedAt[cardId]) < 12000) {
        return;
      }
      // Après 6 secondes : un appui de plus recommence à zéro.
      progressCounts[cardId] = 0;
      delete lastCompletedAt[cardId];
      saveProgress();
      render();
      vibrateTap();
      checkSessionCompletion(mode);
      updateGlobalProgress();
    if (typeof applyFontSize === 'function') applyFontSize();
    if (typeof renderFontSizeChips === 'function') renderFontSizeChips();
      return;
    }
    progressCounts[cardId] = current + 1;
    saveProgress();
    render();
    if (progressCounts[cardId] >= total) {
      lastCompletedAt[cardId] = now;
      vibrateDone();
      playChime();
      replay('just-completed');
      checkSessionCompletion(mode);
      updateGlobalProgress();
    if (typeof applyFontSize === 'function') applyFontSize();
    if (typeof renderFontSizeChips === 'function') renderFontSizeChips();
      // Auto-scroll vers la carte suivante après un court délai
      setTimeout(() => scrollToNextCard(card), 900);
    } else {
      vibrateTap();
      playBeep();
      replay('just-tapped');
    }
  };

  render();
  card._tapCounterFn = tap;
  card._tapCounterRender = render;
}

// Zone de tap unique : toute la carte, sauf le bouton 🔊 (dans son propre
// pied de carte) qui gère son propre clic.
function attachCardTapZone(card) {
  let pressTimer = null;
  let isLongPress = false;
  card.addEventListener('pointerdown', e => {
    if (e.target.closest('.card-footer-actions')) return;
    isLongPress = false;
    pressTimer = setTimeout(() => {
      isLongPress = true;
      toggleFocusMode(card); // Déclenche le mode focus
      vibrateDone(); // Petite vibration pour confirmer
    }, 600); // 600 ms d'appui
  });
  const cancelPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  };
  card.addEventListener('pointerup', e => {
    cancelPress();
    if (isLongPress) {
      // On annule le clic qui allait s'exécuter pour ne pas compter
      e.preventDefault();
      e.stopPropagation();
    } else {
      if (e.target.closest('.card-footer-actions')) return;
      if (typeof card._tapCounterFn === 'function') card._tapCounterFn();
    }
  });
  card.addEventListener('pointerleave', cancelPress);
  card.addEventListener('pointercancel', cancelPress);
  card.addEventListener('contextmenu', e => e.preventDefault()); // Empêche le menu "copier/coller" sur appui long
}

function enhanceCards() {
  ['matin', 'soir'].forEach(mode => {
    const bloc = document.getElementById(mode === 'matin' ? 'blocMatin' : 'blocSoir');
    if (!bloc) return;
    const cards = bloc.querySelectorAll('.card');
    cards.forEach((card, i) => {
      const position = i + 1;
      const cardId = mode + '-' + position;
      const head = card.querySelector('.card-head');
      const countEl = card.querySelector('.card-count');
      const dhikrEl = card.querySelector('.card-dhikr');
      if (!head || !countEl || !dhikrEl) return;

      const totalMatch = /\d+/.exec(countEl.textContent);
      setupCounter(card, cardId, totalMatch ? parseInt(totalMatch[0], 10) : 0);
      attachCardTapZone(card);
      card.classList.add('is-tappable');

      const audioSrc = audioFileFor(mode, position);
      card.dataset.audioSrc = audioSrc || '';
      // L'invocation d'ouverture (carte 1) n'a pas d'enregistrement : pas de bouton.
      if (!audioSrc) return;

      // Le bouton d'écoute vit dans son propre pied de carte, bien séparé
      // de la zone de comptage (qui couvre le reste de la carte).
      const footer = document.createElement('div');
      footer.className = 'card-footer-actions';
      // Bouton Copier
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-btn';
      copyBtn.setAttribute('aria-label', 'Copier le texte arabe');
      copyBtn.innerHTML = '📋';
      copybtn.onclick = e => {
        e.stopPropagation();
        const total = parseInt(card.dataset.totalCount || '1', 10) || 1;
        let audioRepeats = 1;
        if (dhikrEl.textContent.includes('سبحان الله وبحمده') && total === 100) audioRepeats = 3;
        if (dhikrEl.textContent.includes('أستغفر الله وأتوب إليه') && total === 100) audioRepeats = 6;
        const fullPlays = Math.floor(total / audioRepeats);
        const remainderFraction = (total % audioRepeats) !== 0 ? audioRepeats : null;
        toggleSpeakCard(btn, dhikrEl.textContent.trim(), audioSrc, fullPlays, remainderFraction);
      };
      footer.appendChild(btn);
      card.appendChild(footer);
    });
  });
}
enhanceCards();
renderVibeChips();
renderSpeedChips();
renderFallbackToggle();

// ── NOTIFICATIONS QUOTIDIENNES (rappels adhkar) ────────────────────────────
let CapacitorLocalNotifications = null;
if (isNative && window.Capacitor.Plugins) {
  CapacitorLocalNotifications = window.Capacitor.Plugins.LocalNotifications || null;
}
const NOTIF_IDS = { matin: 1000, soir: 2000 };
const NOTIF_DAYS_AHEAD = 7; // Programme 7 notifications (une par jour)
let notifEnabled = localStorage.getItem('adhkar-notif-enabled') === 'true';
let notifTimeMatin = localStorage.getItem('adhkar-notif-matin') || '06:30';
let notifTimeSoir  = localStorage.getItem('adhkar-notif-soir')  || '18:30';
function updateBellBadge() {
  const bell = document.getElementById('bellBtn');
  if (!bell) return;
  bell.classList.toggle('has-notif', notifEnabled);
}
function renderNotifUI() {
  updateBellBadge();
  const toggle = document.getElementById('notifToggleChips');
  if (toggle) {
    toggle.querySelectorAll('.opt-chip').forEach(c => {
      c.classList.toggle('selected', c.dataset.val === String(notifEnabled));
    });
  }
  const wrap = document.getElementById('notifTimeWrap');
  if (wrap) wrap.style.display = notifEnabled ? '' : 'none';
  const tM = document.getElementById('notifTimeMatin');
  const tS = document.getElementById('notifTimeSoir');
  if (tM) tM.value = notifTimeMatin;
  if (tS) tS.value = notifTimeSoir;
}
async function checkExactAlarmSetting() {
  if (!CapacitorLocalNotifications || !CapacitorLocalNotifications.checkExactNotificationSetting) return null;
  try {
    const r = await CapacitorLocalNotifications.checkExactNotificationSetting();
    return r.exact_alarm || null;
  } catch (e) {
    return null;
  }
}
async function openExactAlarmSettings() {
  if (!CapacitorLocalNotifications || !CapacitorLocalNotifications.changeExactNotificationSetting) {
    alert('Impossible d\'ouvrir les paramètres sur cette version d\'Android.');
    return;
  }
  try {
    await CapacitorLocalNotifications.changeExactNotificationSetting();
  } catch (e) {
    alert('Impossible d\'ouvrir les paramètres. Va manuellement dans : Paramètres → Applications → Adhkar → Alarmes et rappels.');
  }
}
// ── Bandeau optimisation batterie (Samsung/Xiaomi/Huawei) ──────────────────
function showBatteryBanner() {
  const banner = document.getElementById('batteryBanner');
  if (!banner) return;
  const dismissed = localStorage.getItem('adhkar-battery-dismissed') === 'true';
  banner.style.display = dismissed ? 'none' : '';
}
function dismissBatteryBanner() {
  localStorage.setItem('adhkar-battery-dismissed', 'true');
  const banner = document.getElementById('batteryBanner');
  if (banner) banner.style.display = 'none';
}
async function openBatterySettings() {
  // Récupérer le plugin AppLauncher (installé via @capacitor/app-launcher)
  const AppLauncher = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLauncher;
  if (!AppLauncher) {
    alert("Impossible d'ouvrir automatiquement les paramètres.\n\nAllez manuellement dans :\nParamètres → Applications → Adhkar → Batterie → Non restreint");
    dismissBatteryBanner();
    return;
  }
  // Tenter plusieurs intents dans l'ordre
  const intents = [
    'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    'android.settings.APPLICATION_DETAILS_SETTINGS:package:com.mouhamedbouraima.adhkar',
    'android.settings.SETTINGS'
  ];
  let opened = false;
  for (const intent of intents) {
    try {
      const url = 'intent:#Intent;action=' + intent + ';end';
      await AppLauncher.openUrl({ url });
      opened = true;
      break;
    } catch (e) {
      console.warn('Intent échec :', intent, e);
    }
  }
  if (!opened) {
    alert("Impossible d'ouvrir automatiquement les paramètres.\n\nAllez manuellement dans :\nParamètres → Applications → Adhkar → Batterie → Non restreint");
  }
  // On marque le bandeau comme "vu" après ouverture
  dismissBatteryBanner();
}
async function updateExactAlarmBanner() {
  const banner = document.getElementById('exactAlarmBanner');
  if (!banner) return;
  if (!notifEnabled) { banner.style.display = 'none'; return; }
  const setting = await checkExactAlarmSetting();
  banner.style.display = (setting === 'denied') ? '' : 'none';
}
async function ensureNotifPermission() {
  if (!CapacitorLocalNotifications) return false;
  try {
    let status = await CapacitorLocalNotifications.checkPermissions();
    if (status.display !== 'granted') {
      status = await CapacitorLocalNotifications.requestPermissions();
    }
    const granted = status.display === 'granted';
    const warn = document.getElementById('notifWarning');
    if (warn) warn.style.display = granted ? 'none' : '';
    return granted;
  } catch (e) {
    console.warn('Notif permission erreur', e);
    return false;
  }
}
async function cancelAllNotifs() {
  if (!CapacitorLocalNotifications) return;
  try {
    const ids = [];
    for (let d = 0; d < NOTIF_DAYS_AHEAD + 1; d++) {
      ids.push({ id: NOTIF_IDS.matin + d });
      ids.push({ id: NOTIF_IDS.soir + d });
    }
    // Nettoyer aussi les anciens IDs hérités
    ids.push({ id: 1001 }, { id: 1002 }, { id: 9999 });
    await CapacitorLocalNotifications.cancel({ notifications: ids });
  } catch (e) { console.warn('cancelAllNotifs erreur', e); }
}
async function scheduleNotif(baseId, hour, minute, title, body, mode) {
  const now = new Date();
  const notifications = [];
  for (let d = 0; d < NOTIF_DAYS_AHEAD; d++) {
    const target = new Date();
    target.setDate(target.getDate() + d);
    target.setHours(hour, minute, 0, 0);
    if (target <= now) continue;
    notifications.push({
      id: baseId + d,
      title: title,
      body: body,
      schedule: { at: target, allowWhileIdle: true },
      smallIcon: 'ic_launcher',
      iconColor: '#9C7326',
      extra: { mode: mode || 'matin' }
    });
  }
  if (!notifications.length) return true;
  try {
    await CapacitorLocalNotifications.schedule({ notifications });
    return true;
  } catch (e) {
    console.warn('Schedule erreur', e);
    return false;
  }
}
async function applyNotifSchedule() {
  if (!CapacitorLocalNotifications) return;
  await cancelAllNotifs();
  if (!notifEnabled) return;
  const granted = await ensureNotifPermission();
  if (!granted) return;
  const [hM, mM] = notifTimeMatin.split(':').map(Number);
  const [hS, mS] = notifTimeSoir.split(':').map(Number);
  await scheduleNotif(NOTIF_IDS.matin, hM, mM,
    '🌅 Adhkar du matin',
    'Il est temps de réciter vos adhkar du matin. Qu\'Allah bénisse votre journée.',
    'matin');
  await scheduleNotif(NOTIF_IDS.soir, hS, mS,
    '🌙 Adhkar du soir',
    'Il est temps de réciter vos adhkar du soir. Qu\'Allah apaise votre nuit.',
    'soir');
}
async function setNotifEnabled(v) {
  notifEnabled = v;
  localStorage.setItem('adhkar-notif-enabled', String(v));
  renderNotifUI();
  if (v) {
    const granted = await ensureNotifPermission();
    if (!granted) {
      notifEnabled = false;
      localStorage.setItem('adhkar-notif-enabled', 'false');
      renderNotifUI();
      return;
    }
  }
  await applyNotifSchedule();
}
async function saveNotifTimes() {
  notifTimeMatin = document.getElementById('notifTimeMatin').value || '06:30';
  notifTimeSoir  = document.getElementById('notifTimeSoir').value  || '18:30';
  localStorage.setItem('adhkar-notif-matin', notifTimeMatin);
  localStorage.setItem('adhkar-notif-soir', notifTimeSoir);
  if (notifEnabled) await applyNotifSchedule();
}
async function testNotification() {
  if (!CapacitorLocalNotifications) {
    alert('Les notifications ne sont pas disponibles sur cette plateforme.');
    return;
  }
  const granted = await ensureNotifPermission();
  if (!granted) return;
  try {
    await CapacitorLocalNotifications.schedule({
      notifications: [{
        id: 9999,
        title: '🔔 Test — Adhkar',
        body: 'Si vous voyez ceci, les rappels fonctionnent !',
        schedule: { at: new Date(Date.now() + 5000) }
      }]
    });
    alert('Notification programmée dans 5 secondes. Verrouillez l\'écran pour la tester.');
  } catch (e) {
    alert('Erreur lors du test : ' + e.message);
  }
}
// Écouter les clics sur les notifications pour ouvrir le bon mode
if (CapacitorLocalNotifications) {
  CapacitorLocalNotifications.addListener('localNotificationActionPerformed', (notif) => {
    try {
      const mode = notif && notif.notification && notif.notification.extra && notif.notification.extra.mode;
      if (mode === 'matin' || mode === 'soir') {
        setMode(mode);
      }
    } catch (e) { console.warn('Notif action erreur', e); }
  });
}
// Initialisation : si des rappels étaient activés, on les reprogramme au lancement
// ── MODE ESSENTIEL ──
let essentialMode = localStorage.getItem('adhkar-essential-mode') === 'true';
function setEssentialMode(val) {
  essentialMode = val;
  localStorage.setItem('adhkar-essential-mode', String(val));
  applyEssentialMode();
  renderEssentialModeChips();
}
function applyEssentialMode() {
  document.body.classList.toggle('essential-mode', essentialMode);
}
function renderEssentialModeChips() {
  document.querySelectorAll('#essentialModeChips .opt-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.val === String(essentialMode));
  });
}
// ── COMPTEUR DE SÉRIE (STREAK) ──
function getTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
let currentStreak = parseInt(localStorage.getItem('adhkar-streak') || '0', 10);
let lastStreakDate = localStorage.getItem('adhkar-streak-date') || '';
function renderStreak() {
  const badge = document.getElementById('streakBadge');
  const count = document.getElementById('streakCount');
  const label = document.getElementById('streakLabel');
  if (!badge || !count) return;
  if (currentStreak > 0) {
    badge.style.display = 'inline-flex';
    count.textContent = currentStreak;
    if (label) label.textContent = currentStreak > 1 ? 'jours' : 'jour';
  } else {
    badge.style.display = 'none';
  }
}
function updateStreak() {
  const today = getTodayStr();
  const yesterday = getYesterdayStr();
  // Si on a déjà compté aujourd'hui, on ne fait rien
  if (lastStreakDate === today) return;
  if (lastStreakDate === yesterday) {
    // La série continue
    currentStreak++;
  } else {
    // Nouvelle série (ou première fois)
    currentStreak = 1;
  }
  lastStreakDate = today;
  localStorage.setItem('adhkar-streak', String(currentStreak));
  localStorage.setItem('adhkar-streak-date', lastStreakDate);
  renderStreak();
}
// ── TAILLE DU TEXTE ARABE ──
let arabicFontSize = localStorage.getItem('adhkar-font-size') || 'normal';
function setFontSize(size) {
  arabicFontSize = size;
  localStorage.setItem('adhkar-font-size', size);
  applyFontSize();
  renderFontSizeChips();
}
function applyFontSize() {
  const html = document.documentElement;
  html.setAttribute('data-font-size', arabicFontSize);
}
function renderFontSizeChips() {
  document.querySelectorAll('#fontSizeChips .opt-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.size === arabicFontSize);
  });
}
// ── TUTORIEL INTERACTIF ──
const tutorialSteps = [
  { icon: '👋', title: 'Bienvenue !', text: "Découvrez comment utiliser l'application en quelques étapes simples." },
  { icon: '🌅', title: 'Matin ou Soir', text: "Basculez entre les invocations du matin et du soir en appuyant sur ces onglets." },
  { icon: '👆', title: 'Compteur de Dhikr', text: "Appuyez n'importe où sur une carte pour compter. Un bip vous confirme chaque appui, et un carillon mélodieux célèbre la fin." },
  { icon: '🔊', title: 'Écouter', text: "Appuyez sur le bouton Écouter pour lire l'audio. Il s'adapte automatiquement au nombre de répétitions." },
  { icon: '🔔', title: 'Rappels', text: "Activez les rappels quotidiens en appuyant sur la cloche en haut à gauche." },
  { icon: '⛶', title: 'Mode Focus', text: "Maintenez votre doigt appuyé sur une carte pour la lire en plein écran." },
  { icon: '⚙️', title: 'Réglages', text: "Personnalisez le thème, la taille du texte, le mode essentiel et la vitesse de lecture ici." }
];
let currentTutorialStep = 0;
function showTutorial() {
  const overlay = document.getElementById('tutorialOverlay');
  if (!overlay) return;
  currentTutorialStep = 0;
  renderTutorialStep();
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}
function renderTutorialStep() {
  const step = tutorialSteps[currentTutorialStep];
  const iconEl = document.getElementById('tutorialIcon');
  const titleEl = document.getElementById('tutorialTitle');
  const textEl = document.getElementById('tutorialText');
  iconEl.textContent = step.icon;
  titleEl.textContent = step.title;
  textEl.textContent = step.text;
  // Relancer l'animation
  [iconEl, titleEl, textEl].forEach(el => {
    el.classList.remove('tutorial-anim');
    void el.offsetWidth; // Force le navigateur à prendre en compte le retrait
    el.classList.add('tutorial-anim');
  });
  const dotsContainer = document.getElementById('tutorialDots');
  if (dotsContainer) {
    dotsContainer.innerHTML = '';
    tutorialSteps.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'tutorial-dot' + (i === currentTutorialStep ? ' active' : '');
      dotsContainer.appendChild(dot);
    });
  }
  const nextBtn = document.getElementById('tutorialNextBtn');
  if (currentTutorialStep === tutorialSteps.length - 1) {
    nextBtn.textContent = 'Terminer';
  } else {
    nextBtn.textContent = 'Suivant';
  }
}
function nextTutorialStep() {
  currentTutorialStep++;
  if (currentTutorialStep >= tutorialSteps.length) {
    closeTutorial();
  } else {
    renderTutorialStep();
  }
}
function closeTutorial() {
  const overlay = document.getElementById('tutorialOverlay');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
  localStorage.setItem('adhkar-tutorial-seen', 'true');
}
window.addEventListener('load', () => {
  if (typeof renderStreak === 'function') renderStreak();
  setTimeout(() => {
    // Vérifier si c'est le premier lancement
    if (!localStorage.getItem('adhkar-tutorial-seen')) {
      showTutorial();
    }
    renderNotifUI();
    updateGlobalProgress();
    if (typeof applyFontSize === 'function') applyFontSize();
    if (typeof renderFontSizeChips === 'function') renderFontSizeChips();

    if (notifEnabled && CapacitorLocalNotifications) {
      applyNotifSchedule();
      updateExactAlarmBanner();
    }
  }, 1000);
});
// Vérifier les alarmes exactes à chaque ouverture du modal
const _origOpenModal = window.openModal;
window.openModal = function(id) {
  _origOpenModal(id);
  if (id === 'modalNotif') {
    setTimeout(updateExactAlarmBanner, 200);
    setTimeout(showBatteryBanner, 250);
  }
  if (id === 'modalShare') {
    // Adapter la boîte URL au contexte (native Android = lien APK, sinon site web)
    const box = document.getElementById('shareUrlBox');
    if (box) {
      box.textContent = isNative
        ? 'github.com/mouhamed229-glitch/adhkar-app/releases/latest'
        : 'invocation-du-matin-et-du-soir.netlify.app';
    }
    // Sur l'APK Android, l'app est déjà installée : on cache les instructions d'installation PWA
    const installBlock = document.getElementById('installStepsBlock');
    if (installBlock) {
      installBlock.style.display = isNative ? 'none' : '';
    }
  }
};
// ── FAB — Écouter tout (lecture séquentielle du bloc actif) ─────────────────
function toggleReadAll() {
  if (isReadingAll) { stopReadAll(); return; }
  if (activeBtn) stopAllSpeech();
  const bloc = document.getElementById(currentMode === 'matin' ? 'blocMatin' : 'blocSoir');
  readAllQueue = Array.from(bloc.querySelectorAll('.card')).map(card => ({
    text: card.querySelector('.card-dhikr').textContent.trim(),
    audioSrc: card.dataset.audioSrc,
    repeatCount: parseInt(card.dataset.totalCount || '1', 10) || 1
  }));
  readAllIndex = 0;
  if (!readAllQueue.length) return;
  isReadingAll = true;
  setFabPlaying(true);
  speakNextInQueue();
}
function speakNextInQueue() {
  if (!isReadingAll || readAllIndex >= readAllQueue.length) { stopReadAll(); return; }
  const item = readAllQueue[readAllIndex];
      playAudioOrFallback(item.audioSrc, item.text, {
        onend: () => { readAllIndex++; speakNextInQueue(); },
        onerror: () => { readAllIndex++; speakNextInQueue(); },
        repeatCount: item.repeatCount || 1,
        stopAtFraction: item.stopAtFraction
      });
}
function stopReadAll() {
  isReadingAll = false;
  readAllQueue = [];
  readAllIndex = 0;
  setFabPlaying(false);
  if (!activeBtn) stopAudioOrSpeech();
}
function setFabPlaying(playing) {
  const fab = document.getElementById('fabPlayAll');
  const icon = document.getElementById('fabIcon');
  const label = document.getElementById('fabLabel');
  if (!fab) return;
  fab.classList.toggle('is-playing', playing);
  if (icon) icon.textContent = playing ? '⏹' : '🔊';
  if (label) label.textContent = playing ? 'Arrêter' : 'Écouter tout';
}

// ── RIPPLE — état tactile Material 3 ────────────────────────────────────────
document.addEventListener('click', e => {
  const el = e.target.closest('.audio-btn,.theme-opt,.voice-opt,.sbtn,.nav-item,.fab');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.width = span.style.height = size + 'px';
  span.style.left = (e.clientX - r.left - size / 2) + 'px';
  span.style.top = (e.clientY - r.top - size / 2) + 'px';
  el.appendChild(span);
  setTimeout(() => span.remove(), 500);
});

// ── MODALES (avec gestion du bouton retour Android) ────────────────────────
let modalHistoryPushed = false;
function openModal(id) {
  document.querySelectorAll('.modal-overlay.open').forEach(m => {
    if (m.id !== id) m.classList.remove('open');
  });
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
  if (modalHistoryPushed) {
    history.replaceState({modal:id}, '', '#'+id);
  } else {
    history.pushState({modal:id}, '', '#'+id);
    modalHistoryPushed = true;
  }
}
function closeModal(id, fromPopstate) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
  document.body.style.overflow = '';
  if (!fromPopstate && modalHistoryPushed) {
    modalHistoryPushed = false;
    history.back();
  }
}
function closeOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}
window.addEventListener('popstate', () => {
  modalHistoryPushed = false;
  document.querySelectorAll('.modal-overlay.open').forEach(m => closeModal(m.id, true));
});
// ── Bouton retour Android (natif) ──────────────────────────────────────────
if (CapacitorApp) {
  CapacitorApp.addListener('backButton', () => {
    // 1. Un modal est ouvert ? → le fermer
    const openModalEl = document.querySelector('.modal-overlay.open');
    if (openModalEl) {
      closeModal(openModalEl.id, true);
      return;
    }
    // 2. On est sur "Soir" ? → revenir à "Matin"
    if (currentMode === 'soir') {
      setMode('matin');
      return;
    }
    // 3. Sinon → quitter l'app
    CapacitorApp.exitApp();
  });
}

// ── INSTALL ─────────────────────────────────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); deferredPrompt = e;
  document.getElementById('installBtn').style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  document.getElementById('installBtn').style.display = 'none';
  deferredPrompt = null;
});
function installApp() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(() => deferredPrompt = null);
}

// ── PARTAGE ─────────────────────────────────────────────────────────────────
async function shareApp() {
  const msg = `أذكار الصباح والمساء — تطبيق مجاني يعمل بدون إنترنت\n\nCette application contient les adhkar du matin et du soir de Hisn al-Muslim, avec traduction française. Elle fonctionne hors ligne.`;
  // Choix intelligent du lien selon la plateforme de l'utilisateur
  const shareUrl = isNative ? APK_URL : APP_URL;
  if (CapacitorShare) {
    try {
      await CapacitorShare.share({
        title: 'أذكار الصباح والمساء',
        text: msg,
        url: shareUrl,
        dialogTitle: 'Partager l\'application'
      });
      return;
    } catch (e) {
      if (e && e.message && e.message.toLowerCase().includes('cancel')) return;
      console.warn('Share natif indisponible, fallback', e);
    }
  }
  if (navigator.share) {
    navigator.share({title:'أذكار الصباح والمساء', text:msg, url:shareUrl})
      .catch(() => copyLink());
    return;
  }
  copyLink();
}
function copyLink() {
  // Utiliser APK_URL si on est sur Android, sinon APP_URL (Netlify pour iOS/PWA)
  const linkToCopy = isNative ? APK_URL : APP_URL;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(linkToCopy)
      .then(() => alert('✓ Lien copié !'));
  } else {
    prompt('Copier ce lien :', linkToCopy);
  }
}
// ── Envoi d'un avis utilisateur (email ou WhatsApp pré-rempli) ─────────────
const FEEDBACK_EMAIL = 'mouhamedbouraima122@gmail.com';
const FEEDBACK_WHATSAPP = '2290156382714';
function buildFeedbackTemplate() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'});
  const timeStr = now.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  return {
    intro: `Bonjour,\n\nJ'utilise l'application "أذكار الصباح والمساء" et je souhaite vous faire part de mon avis.\n\n`,
    info: `\n\n--- Informations techniques ---\nDate : ${dateStr} à ${timeStr}\nPlateforme : ${isNative ? 'Application Android (APK)' : 'Site web'}\nVersion : 1.3.0\n`,
    outro: `\n\nMerci pour cette belle application.\nQu'Allah vous récompense. 🤲`
  };
}
function sendFeedbackEmail() {
  const t = buildFeedbackTemplate();
  const subject = encodeURIComponent('Avis utilisateur — Application Adhkar');
  const body = encodeURIComponent(t.intro + '[Écrivez votre avis ici]\n\n' + t.info + t.outro);
  const url = `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
  window.location.href = url;
}
function sendFeedbackWhatsApp() {
  const t = buildFeedbackTemplate();
  const message = encodeURIComponent(t.intro + '[Écrivez votre avis ici]' + t.info + t.outro);
  const url = `https://wa.me/${FEEDBACK_WHATSAPP}?text=${message}`;
  if (isNative && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    // Sur Android natif, on ouvre via le navigateur système pour que WhatsApp soit détecté
    window.open(url, '_system');
  } else {
    window.open(url, '_blank');
  }
}
async function downloadGuide() {
  const guideText = `📖 Guide d'installation — أذكار الصباح والمساء
━━━━━━━━━━━━━━━━━━━━━━━━━━
📱 ANDROID (téléphone Samsung, Xiaomi, Tecno, etc.)
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Ouvrez ce lien dans votre navigateur :
   ${APK_URL}
2. Téléchargez le fichier app-debug.apk
3. Ouvrez le fichier téléchargé (.apk)
4. Android demandera d'autoriser les "sources inconnues"
   → Autorisez
5. Appuyez sur "Installer"
✓ L'icône apparaît sur votre écran d'accueil !
━━━━━━━━━━━━━━━━━━━━━━━━━━
🍎 iPHONE / iPAD
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Ouvrez Safari (pas Chrome)
2. Allez sur : ${APP_URL}
3. Appuyez sur le bouton Partager ↑
4. Choisissez "Sur l'écran d'accueil"
5. Appuyez sur "Ajouter" en haut à droite
✓ L'icône apparaît sur votre écran d'accueil !
━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Une fois installée, l'application fonctionne
   entièrement hors connexion.`;
  if (CapacitorShare) {
    try {
      await CapacitorShare.share({
        title: "Guide d'installation — Adhkar",
        text: guideText,
        dialogTitle: "Partager le guide d'installation"
      });
      return;
    } catch (e) {
      if (e && e.message && e.message.toLowerCase().includes('cancel')) return;
      console.warn('Share guide erreur', e);
    }
  }
  if (navigator.share) {
    try { await navigator.share({ title: "Guide d'installation — Adhkar", text: guideText }); return; } catch (e) {}
  }
  try {
    await navigator.clipboard.writeText(guideText);
    alert("✓ Guide copié dans le presse-papier !");
  } catch (e) {
    alert(guideText);
  }
}

// ── SPLASH ──────────────────────────────────────────────────────────────────
function hideSplash() {
  const s = document.getElementById('splash');
  if (!s) return;
  s.style.opacity = '0';
  s.style.transform = 'scale(1.03)';
  setTimeout(() => s.remove(), 520);
}
if (document.readyState === 'complete') setTimeout(hideSplash, 800);
else window.addEventListener('load', () => setTimeout(hideSplash, 800));

