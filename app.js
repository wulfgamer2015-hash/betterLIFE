const video = document.getElementById('preview');

const torchBtn = document.getElementById('torchBtn');
const captureBtn = document.getElementById('captureBtn');


const topBar = document.getElementById('topBar');
const pauseBtn = document.getElementById('pauseBtn');
const galleryBtn = document.getElementById('galleryBtn');
const galleryCount = document.getElementById('galleryCount');
const galleryModal = document.getElementById('galleryModal');
const galleryGrid = document.getElementById('galleryGrid');
const galleryEmpty = document.getElementById('galleryEmpty');
const galleryDownload = document.getElementById('galleryDownload');
const closeGallery = document.getElementById('closeGallery');

const mainMenu = document.getElementById('mainMenu');
const playBtn = document.getElementById('playBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsSheet = document.getElementById('settingsSheet');
const closeSettings = document.getElementById('closeSettings');


const arOverlay = document.getElementById('arOverlay');
let modelViewer = null;
// wait for the model-viewer custom element to be defined, then reference it.
// This ensures AR methods like enterAR() exist when our button handlers run.
(async function initModelViewer(){
  if (customElements && typeof customElements.whenDefined === 'function') {
    try {
      await customElements.whenDefined('model-viewer');
    } catch (e) {
      // ignore if it never defines
    }
  }
  modelViewer = document.getElementById('mv');
})();

// AI elements
const aiBtn = document.getElementById('aiBtn');
const aiBar = document.getElementById('aiBar');
const aiMessages = document.getElementById('aiMessages');
const aiInput = document.getElementById('aiInput');
const aiSend = document.getElementById('aiSend');
const aiMic = document.getElementById('aiMic');

// settings: provider selector + per-provider key/model elements
const settingsProvider = document.getElementById('settingsProvider');
const keyModalTitle = document.getElementById('keyModalTitle');

// Each provider keeps its own saved key and model — both sections in
// Settings are always visible and independent, so switching the "active"
// provider never wipes out the other one's setup.
const PROVIDERS = {
  groq: {
    label: 'Groq',
    keyStorage: 'groqApiKey',
    modelStorage: 'groqModel',
    defaultModel: 'qwen/qwen3.6-27b',
    keyPlaceholder: 'gsk_...',
    keyInput: document.getElementById('settingsKeyInput-groq'),
    keySave: document.getElementById('settingsKeySave-groq'),
    keyStatus: document.getElementById('settingsKeyStatus-groq')
  },
  local: {
    label: 'Local AI (runs on this device)',
    keyStorage: null,
    modelStorage: null,
    defaultModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    keyPlaceholder: '',
    keyInput: null,
    keySave: null,
    keyStatus: null
  }
};

const PROVIDER_STORAGE = 'aiProvider';
let currentProvider = localStorage.getItem(PROVIDER_STORAGE) || 'groq';
if (!PROVIDERS[currentProvider]) currentProvider = 'groq';

function currentProviderConfig() { return PROVIDERS[currentProvider]; }

function keyFor(providerId) {
  if (!PROVIDERS[providerId].keyStorage) return 'local-no-key-needed'; // local AI needs no key
  return localStorage.getItem(PROVIDERS[providerId].keyStorage) || null;
}
function modelFor(providerId) {
  // model is fixed per provider now (no version selector in Settings)
  return PROVIDERS[providerId].defaultModel;
}
function setKeyFor(providerId, key) {
  const cfg = PROVIDERS[providerId];
  if (key) localStorage.setItem(cfg.keyStorage, key);
  else localStorage.removeItem(cfg.keyStorage);
  updateKeyStatus(providerId);
}

// current active provider's key/model — what sendToAI() actually uses
function getAiKey() { return keyFor(currentProvider); }
function getAiModel() { return modelFor(currentProvider); }
function setAiKey(key) { setKeyFor(currentProvider, key); }

let recognizing = false;
let recognition = null;

function updateKeyStatus(providerId) {
  const cfg = PROVIDERS[providerId];
  if (!cfg.keyStatus) return;
  const key = keyFor(providerId);
  if (key) {
    const masked = key.length > 8 ? key.slice(0, 4) + '••••' + key.slice(-4) : '••••';
    cfg.keyStatus.textContent = 'Current key: ' + masked;
  } else {
    cfg.keyStatus.textContent = 'No key saved yet.';
  }
}

function initProviderSection(providerId) {
  const cfg = PROVIDERS[providerId];
  if (cfg.keyInput) cfg.keyInput.value = keyFor(providerId) || '';
  updateKeyStatus(providerId);

  cfg.keySave?.addEventListener('click', () => {
    setKeyFor(providerId, cfg.keyInput.value.trim() || null);
    cfg.keyInput.value = keyFor(providerId) || '';
    if (providerId === currentProvider && keyModalInput) keyModalInput.placeholder = cfg.keyPlaceholder;
  });
}
Object.keys(PROVIDERS).forEach(initProviderSection);

function refreshKeyModalForActiveProvider() {
  const cfg = currentProviderConfig();
  if (keyModalTitle) keyModalTitle.textContent = `Enter your ${cfg.label} API key`;
  if (keyModalInput) keyModalInput.placeholder = cfg.keyPlaceholder;
}

if (settingsProvider) {
  settingsProvider.value = currentProvider;
  settingsProvider.addEventListener('change', () => {
    currentProvider = settingsProvider.value;
    localStorage.setItem(PROVIDER_STORAGE, currentProvider);
    refreshKeyModalForActiveProvider();
    updateProviderVisibility();
    if (currentProvider === 'local') {
      getLocalEngine().catch(err => setLocalAiStatus('Failed to load: ' + err.message));
    }
  });
}

// ==================== LOCAL AI (WebLLM — runs fully on-device, no key, no cost) ====================
// Uses WebGPU to run a small open-source model directly in the browser tab.
// First use downloads the model (roughly half a gig) and caches it; after that
// it works offline. Needs a WebGPU-capable browser (recent Chrome/Edge/Safari).
// It's meaningfully slower and less capable than the cloud model, and this
// small a model can't see images, so vision is unavailable in local mode.
const LOCAL_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
let webllmModule = null;
let localEngine = null;
let localEngineLoadingPromise = null;

const localAiStatus = document.getElementById('localAiStatus');

function setLocalAiStatus(text) {
  if (localAiStatus) localAiStatus.textContent = text;
}

async function getLocalEngine() {
  if (localEngine) return localEngine;
  if (localEngineLoadingPromise) return localEngineLoadingPromise;

  localEngineLoadingPromise = (async () => {
    if (!navigator.gpu) {
      throw new Error("This browser/device doesn't support WebGPU, which Local AI needs. Try a recent Chrome, Edge, or Safari.");
    }
    if (!webllmModule) {
      setLocalAiStatus('Loading Local AI engine…');
      webllmModule = await import('https://esm.run/@mlc-ai/web-llm');
    }
    setLocalAiStatus('Downloading model (first time only, ~0.7GB)…');
    const engine = await webllmModule.CreateMLCEngine(LOCAL_MODEL_ID, {
      initProgressCallback: (report) => {
        setLocalAiStatus(report.text || 'Loading…');
      }
    });
    localEngine = engine;
    setLocalAiStatus('Ready — running fully on this device.');
    return engine;
  })();

  try {
    return await localEngineLoadingPromise;
  } catch (err) {
    localEngineLoadingPromise = null; // allow retry on failure
    throw err;
  }
}

async function callLocalAi(history) {
  const engine = await getLocalEngine();
  // strip images from history — this small local model is text-only
  const textOnlyHistory = history.map(m => {
    if (typeof m.content === 'string') return m;
    if (Array.isArray(m.content)) {
      const text = m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      return { role: m.role, content: text || '(image omitted — local AI cannot see images)' };
    }
    return m;
  });
  const response = await engine.chat.completions.create({ messages: textOnlyHistory });
  const reply = response?.choices?.[0]?.message?.content || '';
  return { reply: reply.trim(), tokensUsed: 0 }; // no billed tokens for on-device inference
}

function updateProviderVisibility() {
  const isLocal = currentProvider === 'local';
  document.querySelectorAll('.groqOnlySetting').forEach(el => { el.hidden = isLocal; });
  document.querySelectorAll('.localOnlySetting').forEach(el => { el.hidden = !isLocal; });
  const imgToggle = document.getElementById('aiImageToggle');
  if (imgToggle) imgToggle.disabled = isLocal;
}
updateProviderVisibility();

let stream = null;
let track = null;
let devices = [];
let torchOn = false;
const captures = [];

async function enumerate() {
  const list = await navigator.mediaDevices.enumerateDevices();
  devices = list.filter(d => d.kind === 'videoinput');
}

// return a deviceId for a likely back/environment camera if found, otherwise null
function findEnvironmentDevice() {
  if (!devices || devices.length === 0) return null;
  // try to detect by label keywords (labels may be empty until permission granted)
  const env = devices.find(d => /back|rear|environment|wide/i.test(d.label));
  return env ? env.deviceId : null;
}
function getConstraintsForResolution(key) {
  switch(key){
    case 'qvga': return { width: { exact: 320 }, height: { exact: 240 } };
    case 'vga': return { width: { exact: 640 }, height: { exact: 480 } };
    case 'hd': return { width: { exact: 1280 }, height: { exact: 720 } };
    case 'fullhd': return { width: { exact: 1920 }, height: { exact: 1080 } };
    default: return {};
  }
}

async function startCamera(deviceId = null, resolution = 'default') {
  stopCamera();
  const res = getConstraintsForResolution(resolution);
  const constraints = {
    audio: false,
    video: {
      ...res,
      deviceId: deviceId ? { exact: deviceId } : undefined,
      facingMode: deviceId ? undefined : { ideal: 'environment' }
    }
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    await enumerate();
    updateTorchAvailability();
    setupZoomForTrack();
  } catch (err) {
    console.error('camera start failed', err);
    alert('Unable to access camera: ' + err.message);
  }
}

function stopCamera() {
  if (recording) stopRecording();
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    track = null;
  }
}

async function updateTorchAvailability() {
  torchBtn.style.display = 'inline-flex';
  if (!track) { torchBtn.disabled = true; torchBtn.style.opacity = '0.4'; return; }
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  const supported = 'torch' in capabilities;
  torchBtn.disabled = !supported;
  torchBtn.style.opacity = supported ? '1' : '0.4';
}

async function toggleTorch() {
  if (!track) return;
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (!('torch' in capabilities)) {
    alert('Flash/torch isn\'t supported on this camera or browser.');
    return;
  }
  try {
    torchOn = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    torchBtn.textContent = torchOn ? '🔦' : '🔦';
  } catch (err) {
    console.warn('Torch toggle failed', err);
  }
}



// draws the current video frame onto a canvas, honoring digital zoom
// (when hardware zoom isn't available) by cropping to the zoomed region.
function drawFrameToCanvas(canvas, filter) {
  const w = video.videoWidth, h = video.videoHeight;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (filter) ctx.filter = filter;
  if (!hasHardwareZoom && digitalZoom > 1) {
    const cw = w / digitalZoom, ch = h / digitalZoom;
    const sx = (w - cw) / 2, sy = (h - ch) / 2;
    ctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, h);
  } else {
    ctx.drawImage(video, 0, 0, w, h);
  }
  ctx.filter = 'none';
  return ctx;
}

function capturePhoto() {
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  drawFrameToCanvas(canvas);
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    addThumb(url, blob, 'image');
  }, 'image/png');
}

// Portrait mode: keeps the center of the frame sharp and blurs everything
// around it, approximating a background-blur (bokeh) effect without needing
// real depth data.
function capturePortrait() {
  if (!video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;

  const sharp = document.createElement('canvas');
  drawFrameToCanvas(sharp);

  const blurred = document.createElement('canvas');
  blurred.width = w; blurred.height = h;
  const bctx = blurred.getContext('2d');
  bctx.filter = 'blur(14px)';
  if (!hasHardwareZoom && digitalZoom > 1) {
    const cw = w / digitalZoom, ch = h / digitalZoom;
    const sx = (w - cw) / 2, sy = (h - ch) / 2;
    bctx.drawImage(video, sx, sy, cw, ch, 0, 0, w, h);
  } else {
    bctx.drawImage(video, 0, 0, w, h);
  }
  bctx.filter = 'none';

  // punch a soft oval hole out of the blurred layer so the sharp layer
  // shows through in the center (the "in-focus subject" area)
  bctx.globalCompositeOperation = 'destination-out';
  const rx = w * 0.28, ry = h * 0.38;
  const grad = bctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(rx, ry));
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.7, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  bctx.fillStyle = grad;
  bctx.beginPath();
  bctx.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2);
  bctx.fill();

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = w; finalCanvas.height = h;
  const fctx = finalCanvas.getContext('2d');
  fctx.drawImage(sharp, 0, 0);
  fctx.drawImage(blurred, 0, 0);

  finalCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    addThumb(url, blob, 'image');
  }, 'image/png');
}

// HDR mode: takes three quick "exposures" (simulated with brightness
// filters, since browsers don't expose real bracketed exposure control)
// and averages them together for a tone-mapped result that pulls in
// shadow and highlight detail a single exposure would clip.
function captureHDR() {
  if (!video.videoWidth) return;
  const w = video.videoWidth, h = video.videoHeight;
  const exposures = ['brightness(0.65) contrast(1.05)', 'brightness(1) contrast(1)', 'brightness(1.5) contrast(0.95)'];

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = w; finalCanvas.height = h;
  const fctx = finalCanvas.getContext('2d');
  fctx.globalCompositeOperation = 'lighter';

  exposures.forEach(filter => {
    const c = document.createElement('canvas');
    drawFrameToCanvas(c, filter);
    fctx.globalAlpha = 1 / exposures.length;
    fctx.drawImage(c, 0, 0);
  });
  fctx.globalAlpha = 1;
  fctx.globalCompositeOperation = 'source-over';

  finalCanvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    addThumb(url, blob, 'image');
  }, 'image/png');
}

// --- Video mode: real recording via MediaRecorder ---
let mediaRecorder = null;
let recordedChunks = [];
let recording = false;

function pickVideoMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  return candidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

function startRecording() {
  if (!stream) return;
  recordedChunks = [];
  const mimeType = pickVideoMimeType();
  try {
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (err) {
    console.error('MediaRecorder init failed', err);
    alert('Video recording is not supported in this browser.');
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    addThumb(url, blob, 'video');
  };
  mediaRecorder.start();
  recording = true;
  captureBtn.classList.add('recording');
  captureBtn.textContent = '■';
}

function stopRecording() {
  if (mediaRecorder && recording) {
    mediaRecorder.stop();
  }
  recording = false;
  captureBtn.classList.remove('recording');
  captureBtn.textContent = '●';
}

function handleCaptureClick() {
  if (currentMode === 'video') {
    if (recording) stopRecording(); else startRecording();
    return;
  }
  if (currentMode === 'portrait') { capturePortrait(); return; }
  if (currentMode === 'hdr') { captureHDR(); return; }
  capturePhoto();
}

function addThumb(url, blob, type = 'image') {
  captures.unshift({ url, blob, type });
  updateGalleryCount();
}

function updateGalleryCount() {
  if (!galleryCount) return;
  if (captures.length > 0) {
    galleryCount.textContent = captures.length;
    galleryCount.hidden = false;
  } else {
    galleryCount.hidden = true;
  }
}
updateGalleryCount();

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

// pause the camera preview and offer a way back to the main menu
const pausePopover = document.getElementById('pausePopover');
const backToMenuBtn = document.getElementById('backToMenuBtn');
const resumeBtn = document.getElementById('resumeBtn');

pauseBtn?.addEventListener('click', () => {
  video.pause();
  pausePopover?.setAttribute('aria-hidden', 'false');
});

resumeBtn?.addEventListener('click', () => {
  pausePopover?.setAttribute('aria-hidden', 'true');
  video.play();
});

// reloading (rather than just toggling menu visibility) resets all UI state
// cleanly — avoids the leftover-panel/UI-collision bugs that happened when
// jumping straight back to the main menu mid-session.
backToMenuBtn?.addEventListener('click', () => {
  window.location.reload();
});

// gallery modal: shows all captured photos
function renderGallery() {
  galleryGrid.innerHTML = '';
  if (captures.length === 0) {
    galleryEmpty.hidden = false;
    galleryGrid.hidden = true;
    return;
  }
  galleryEmpty.hidden = true;
  galleryGrid.hidden = false;
  captures.forEach((c) => {
    if (c.type === 'video') {
      const vid = document.createElement('video');
      vid.src = c.url;
      vid.className = 'galleryThumb video';
      vid.controls = true;
      vid.muted = true;
      vid.playsInline = true;
      galleryGrid.appendChild(vid);
    } else {
      const img = document.createElement('img');
      img.src = c.url;
      img.className = 'galleryThumb';
      galleryGrid.appendChild(img);
    }
  });
}

galleryBtn?.addEventListener('click', () => {
  renderGallery();
  galleryModal.setAttribute('aria-hidden', 'false');
});

closeGallery?.addEventListener('click', () => {
  galleryModal.setAttribute('aria-hidden', 'true');
});

// smart download: single photo downloads directly, multiple photos download as a zip folder
galleryDownload?.addEventListener('click', async () => {
  if (captures.length === 0) return;

  function extFor(c) {
    if (c.type === 'video') return (c.blob.type && c.blob.type.includes('mp4')) ? 'mp4' : 'webm';
    return 'png';
  }
  function nameFor(c, i) {
    const base = c.type === 'video' ? 'video' : 'photo';
    return `${base}-${i + 1}.${extFor(c)}`;
  }

  if (captures.length === 1) {
    downloadBlob(captures[0].blob, nameFor(captures[0], 0));
    return;
  }

  if (typeof JSZip === 'undefined') {
    // fallback: download each file separately if the zip library failed to load
    captures.forEach((c, i) => downloadBlob(c.blob, nameFor(c, i)));
    return;
  }

  const zip = new JSZip();
  captures.forEach((c, i) => {
    zip.file(nameFor(c, i), c.blob);
  });
  const content = await zip.generateAsync({ type: 'blob' });
  downloadBlob(content, 'photos.zip');
});

captureBtn.addEventListener('click', handleCaptureClick);

torchBtn.addEventListener('click', toggleTorch);


// double-tap preview to toggle mirror for selfie preference
let lastTap = 0;
video.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 300) {
    video.style.transform = video.style.transform === 'scaleX(-1)' ? '' : 'scaleX(-1)';
  }
  lastTap = now;
});

// main menu interactions
playBtn.addEventListener('click', () => {
  // hide menu and start camera if not already started
  mainMenu.style.display = 'none';
  if (!stream) startCamera(findEnvironmentDevice() || null, 'default');
  else video.play();
});

settingsBtn.addEventListener('click', () => {
  settingsSheet.setAttribute('aria-hidden', 'false');
  repositionCheckBtn();
});

const fullscreenBtn = document.getElementById('fullscreenBtn');
fullscreenBtn?.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) {
      await (document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.());
    } else {
      await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
    }
  } catch (err) {
    console.warn('Fullscreen toggle failed', err);
    alert("This browser won't allow fullscreen here — some mobile browsers (like iOS Safari) block it for regular pages.");
  }
});

closeSettings.addEventListener('click', () => {
  settingsSheet.setAttribute('aria-hidden', 'true');
  repositionCheckBtn();
});

// settings controls mirror the main UI

// setting: whether Bin is allowed to use the user's location (default OFF — opt-in)
const settingsLocationToggle = document.getElementById('settingsLocationToggle');
const BIN_LOCATION_STORAGE = 'binLocationEnabled';
let binLocationEnabled = localStorage.getItem(BIN_LOCATION_STORAGE) === 'true'; // default false
if (settingsLocationToggle) {
  settingsLocationToggle.checked = binLocationEnabled;
  settingsLocationToggle.addEventListener('change', () => {
    binLocationEnabled = settingsLocationToggle.checked;
    localStorage.setItem(BIN_LOCATION_STORAGE, binLocationEnabled ? 'true' : 'false');
  });
}

// gets a rough, human-readable location string for photo-spot suggestions.
// Only ever called if the user has explicitly turned this on in Settings.
async function getLocationContext() {
  if (!binLocationEnabled || !('geolocation' in navigator)) return null;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
    });
    const { latitude, longitude } = pos.coords;
    // reverse geocode via OpenStreetMap's free Nominatim API for a readable place name
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.display_name) return data.display_name;
      }
    } catch (e) { /* fall through to raw coordinates */ }
    return `latitude ${latitude.toFixed(4)}, longitude ${longitude.toFixed(4)}`;
  } catch (e) {
    return null;
  }
}

// grabs the current live camera frame as a base64 JPEG data URL, for Bin's vision.
// Downscaled to max 480px on the long edge — vision tokens scale with image size,
// so this keeps a chat request cheap without needing anywhere near full resolution.
const AI_IMAGE_MAX_DIM = 480;

function scaledCanvasFrom(sourceEl, sourceW, sourceH, maxDim) {
  const scale = Math.min(1, maxDim / Math.max(sourceW, sourceH));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sourceW * scale));
  c.height = Math.max(1, Math.round(sourceH * scale));
  c.getContext('2d').drawImage(sourceEl, 0, 0, c.width, c.height);
  return c;
}

function captureCameraFrameDataUrl() {
  if (!video || !video.videoWidth) return null;
  const c = scaledCanvasFrom(video, video.videoWidth, video.videoHeight, AI_IMAGE_MAX_DIM);
  return c.toDataURL('image/jpeg', 0.7);
}

// converts a Blob (e.g. a previously taken photo) to a base64 data URL, unscaled —
// used for the gallery/download where full resolution matters
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// same as above, but downscaled to AI_IMAGE_MAX_DIM — for handing a photo to Bin
function blobToResizedDataUrl(blob, maxDim = AI_IMAGE_MAX_DIM) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const c = scaledCanvasFrom(img, img.naturalWidth, img.naturalHeight, maxDim);
        resolve(c.toDataURL('image/jpeg', 0.7));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// shows/hides Bin's 3D model floating over the live camera feed
async function spawnBinAR() {
  if (!arOverlay) return;
  arOverlay.setAttribute('aria-hidden', 'false');
  try {
    if (modelViewer && modelViewer.updateComplete) {
      await modelViewer.updateComplete;
    }
  } catch (err) {
    console.warn('Model warm-up failed', err);
  }
}

function hideBinAR() {
  if (arOverlay) arOverlay.setAttribute('aria-hidden', 'true');
}

// ==================== SCORE SYSTEM (local, saved like the API key) ====================
const SCORE_STORAGE = 'binScore';
const scoreCounter = document.getElementById('scoreCounter');
let score = parseInt(localStorage.getItem(SCORE_STORAGE) || '0', 10) || 0;

function updateScoreUi() {
  if (scoreCounter) scoreCounter.textContent = '⭐ ' + score;
}
updateScoreUi();

function addScore(amount) {
  score += amount;
  localStorage.setItem(SCORE_STORAGE, String(score));
  updateScoreUi();
}

// ==================== TASKS: find-the-object scavenger hunt ====================
// Easy = big, obvious, hard-to-miss objects. Each tier adds objects that are
// progressively smaller/less common/easier to overlook.
const TASK_OBJECTS_EASY = [
  'tree', 'chair', 'door', 'window', 'table', 'bed', 'cup', 'book', 'phone', 'shoe',
  'lamp', 'plant', 'mirror', 'clock', 'bottle', 'pillow', 'television', 'couch',
  'refrigerator', 'sink', 'car', 'bicycle', 'backpack', 'umbrella', 'trash can'
];
const TASK_OBJECTS_NORMAL = [
  ...TASK_OBJECTS_EASY,
  'remote control', 'keyboard', 'computer mouse', 'headphones', 'charger cable',
  'wallet', 'sunglasses', 'watch', 'belt', 'hat', 'jacket', 'curtain', 'rug',
  'candle', 'picture frame', 'mug', 'scissors', 'stapler', 'tissue box', 'coat hanger'
];
const TASK_OBJECTS_HARD = [
  ...TASK_OBJECTS_NORMAL,
  'power outlet', 'screwdriver', 'extension cord', 'coaster', 'doorknob',
  'paperclip', 'rubber band', 'USB drive', 'safety pin', 'thumbtack',
  'zipper pull', 'shoelace', 'bread tie', 'twist tie', 'bookmark',
  'SD card', 'light switch cover', 'door hinge', 'vent', 'keychain'
];
// "Good Luck" difficulty — only shown when Bin's trash personality is active.
// Deliberately whimsical/near-impossible finds, matching his sarcastic sense of humor.
const TASK_OBJECTS_GOODLUCK = [
  'dinosaur', 'dragon', 'unicorn', 'ghost', 'alien', 'wizard', 'genie', 'mermaid',
  'yeti', 'vampire', 'werewolf', 'fairy', 'griffin', 'phoenix', 'kraken', 'minotaur',
  'time machine', 'flying carpet', 'pot of gold', 'black hole', 'spaceship',
  'loch ness monster', 'sasquatch', 'lava', 'meteor', 'volcano erupting',
  'talking trash can', 'a second Bin', 'treasure chest', 'portal to another dimension'
];
const TASK_POOLS = { easy: TASK_OBJECTS_EASY, normal: TASK_OBJECTS_NORMAL, hard: TASK_OBJECTS_HARD, goodluck: TASK_OBJECTS_GOODLUCK };

const TASKS_STORAGE = 'binTaskState';
const tasksBtn = document.getElementById('tasksBtn');
const tasksBar = document.getElementById('tasksBar');
const tasksDifficultyRow = document.getElementById('tasksDifficultyRow');
const tasksActiveRow = document.getElementById('tasksActiveRow');
const tasksProgressText = document.getElementById('tasksProgressText');
const tasksQuitBtn = document.getElementById('tasksQuitBtn');
const tasksTargetBadge = document.getElementById('tasksTargetBadge');
const tasksTargetBadgeText = document.getElementById('tasksTargetBadgeText');
const tasksTargetBadgeProgress = document.getElementById('tasksTargetBadgeProgress');
const tasksCheckBtn = document.getElementById('tasksCheckBtn');

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let taskState = null; // { difficulty, order: [...objects shuffled], foundCount }
try {
  const saved = localStorage.getItem(TASKS_STORAGE);
  if (saved) taskState = JSON.parse(saved);
} catch (e) { taskState = null; }

function saveTaskState() {
  if (taskState) localStorage.setItem(TASKS_STORAGE, JSON.stringify(taskState));
  else localStorage.removeItem(TASKS_STORAGE);
}

function currentTarget() {
  if (!taskState) return null;
  return taskState.order[taskState.foundCount] || null;
}

const tasksSaveBtn = document.getElementById('tasksSaveBtn');
const goodLuckDifficultyBtn = document.getElementById('goodLuckDifficultyBtn');

// Good Luck difficulty only shows up when Bin's trash personality is active —
// safe to call any time after this point (personality is defined further down,
// so this is only ever invoked later via user interaction, never at load time).
function updateGoodLuckVisibility() {
  if (goodLuckDifficultyBtn) goodLuckDifficultyBtn.hidden = (typeof currentPersonality === 'undefined' || currentPersonality !== 'trash');
}

// Bin narrates each newly revealed target in a voice matching the difficulty
const TASK_NARRATION_LINES = {
  easy: ["Very easy. 99.99% of people find this immediately.", "Piece of cake. Almost everyone spots this one right away.", "Barely a challenge. You'll find this in seconds."],
  normal: ["Moderate difficulty. Most people find this eventually.", "Not too bad, but keep your eyes open.", "A fair bit of a search, but very doable."],
  hard: ["Tricky one. Good luck finding this.", "This one's rough. Not everyone spots it.", "Hard mode earns its name here."],
  goodluck: ["Good luck with this one. Genuinely, good luck.", "I have no idea how you're finding this, but go for it.", "This might not even exist near you. Try anyway."]
};

function narrateNewTarget(difficulty, target) {
  // Task-mode narration disabled per user request — Bin no longer speaks a
  // line every time a new target shows up. The narrator voice itself
  // (speakAsNarrator) is untouched and still used everywhere else, e.g.
  // for Bin's regular chat replies.
  return;
}

tasksSaveBtn?.addEventListener('click', () => {
  saveTaskState();
  const original = tasksSaveBtn.textContent;
  tasksSaveBtn.textContent = 'Saved!';
  setTimeout(() => { tasksSaveBtn.textContent = original; }, 1500);
});

function refreshTasksUi() {
  const active = !!taskState;
  tasksDifficultyRow.hidden = active;
  tasksActiveRow.hidden = !active;
  tasksTargetBadge.setAttribute('aria-hidden', active ? 'false' : 'true');
  tasksCheckBtn.setAttribute('aria-hidden', active ? 'false' : 'true');

  if (active) {
    const target = currentTarget();
    const total = taskState.order.length;
    if (target) {
      tasksTargetBadgeText.textContent = 'Find a ' + target;
      tasksTargetBadgeProgress.textContent = `${taskState.foundCount}/${total}`;
      tasksProgressText.textContent = `${taskState.difficulty} — ${taskState.foundCount}/${total} found`;
    } else {
      tasksTargetBadgeText.textContent = 'All done! 🎉';
      tasksTargetBadgeProgress.textContent = `${total}/${total}`;
      tasksProgressText.textContent = `${taskState.difficulty} — complete! ${total}/${total}`;
    }
  }
}
refreshTasksUi();

tasksBtn?.addEventListener('click', () => {
  const open = tasksBar.getAttribute('aria-hidden') === 'false';
  tasksBar.setAttribute('aria-hidden', open ? 'true' : 'false');
  if (!open) updateGoodLuckVisibility();
  repositionCheckBtn();
});

document.querySelectorAll('.difficultyBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    const difficulty = btn.dataset.difficulty;
    taskState = { difficulty, order: shuffle(TASK_POOLS[difficulty]), foundCount: 0 };
    saveTaskState();
    refreshTasksUi();
    tasksBar.setAttribute('aria-hidden', 'true'); // closes the panel, badge takes over
    narrateNewTarget(difficulty, currentTarget());
    repositionCheckBtn();
  });
});

tasksQuitBtn?.addEventListener('click', () => {
  taskState = null;
  saveTaskState();
  refreshTasksUi();
  tasksBar.setAttribute('aria-hidden', 'true');
});

let checkCountdownTimer = null;

function startCheckCountdown(seconds) {
  clearInterval(checkCountdownTimer);
  let remaining = seconds;
  tasksCheckBtn.disabled = true;
  const tick = () => {
    if (remaining <= 0) {
      clearInterval(checkCountdownTimer);
      tasksCheckBtn.disabled = false;
      tasksCheckBtn.textContent = '✔️ Check';
      if (taskState) refreshTasksUi();
      return;
    }
    tasksCheckBtn.textContent = `Wait ${remaining}s`;
    if (tasksTargetBadgeText) tasksTargetBadgeText.textContent = `Text again in ${remaining} second${remaining === 1 ? '' : 's'}`;
    remaining--;
  };
  tick();
  checkCountdownTimer = setInterval(tick, 1000);
}

tasksCheckBtn?.addEventListener('click', async () => {
  if (!taskState) return;
  const target = currentTarget();
  if (!target) return;

  if (currentProvider === 'local') {
    tasksTargetBadgeText.textContent = 'Task Check needs Cloud (Groq) — local AI can\'t see photos.';
    setTimeout(() => { if (taskState) refreshTasksUi(); }, 2500);
    return;
  }

  const aiKey = getAiKey();
  if (!aiKey) {
    appendAIMessage?.('No API key set. Open Settings to add one before checking tasks.', 'ai');
    return;
  }

  const frame = captureCameraFrameDataUrl();
  if (!frame) return;

  const originalText = tasksCheckBtn.textContent;
  tasksCheckBtn.textContent = 'Checking…';
  tasksCheckBtn.disabled = true;

  try {
    const model = getAiModel();
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + aiKey },
      body: JSON.stringify({
        model,
        reasoning_effort: 'none',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `Look at this image. Does it clearly show a ${target}? Answer with only the single word YES or NO, nothing else.` },
              { type: 'image_url', image_url: { url: frame } }
            ]
          }
        ]
      })
    });
    const raw = await readResponseBody(res);
    if (!res.ok) throw new ApiError(res.status, res.statusText, raw, res.headers.get('retry-after'));
    let answer = raw.json?.choices?.[0]?.message?.content || '';
    answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().toUpperCase();

    if (answer.includes('YES')) {
      taskState.foundCount++;
      saveTaskState();
      addScore(1);
      refreshTasksUi();
      const next = currentTarget();
      if (next) {
        narrateNewTarget(taskState.difficulty, next);
      } else {
        tasksTargetBadgeText.textContent = `All ${taskState.order.length} found! 🎉`;
      }
    } else {
      tasksTargetBadgeText.textContent = `Not quite — still looking for a ${target}`;
      setTimeout(() => { if (taskState) refreshTasksUi(); }, 1800);
    }
    tasksCheckBtn.textContent = originalText;
    tasksCheckBtn.disabled = false;
  } catch (err) {
    console.warn('Task check failed', err);
    if (err instanceof ApiError && err.status === 429) {
      // real rate limit — lock the button with a live countdown instead of letting
      // the person hammer it again immediately
      const seconds = extractRetrySeconds(err);
      startCheckCountdown(seconds);
    } else {
      const msg = friendlyErrorMessage(err);
      tasksTargetBadgeText.textContent = msg;
      setTimeout(() => { if (taskState) refreshTasksUi(); }, 2500);
      tasksCheckBtn.textContent = originalText;
      tasksCheckBtn.disabled = false;
    }
  }
});


// start immediately (but keep menu visible until Play is pressed)
(async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera API not supported in this browser.');
    return;
  }
  await enumerate();
  // pre-start camera so preview is available behind the menu; keep menu on top
  const defaultDeviceId = findEnvironmentDevice() || null;
  await startCamera(defaultDeviceId, 'default');
})();

// cleanup on unload
window.addEventListener('pagehide', stopCamera);

// --- AI chat logic ---

// helper to append messages
function appendAIMessage(text, from = 'ai') {
  const el = document.createElement('div');
  el.className = 'aiMsg ' + (from === 'me' ? 'me' : 'ai');
  el.textContent = text;
  aiMessages.appendChild(el);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

// keep a running chat history so the AI has context across turns
// Grounds Bin in what this app can actually do, so he never claims features
// that don't exist (filters, cloud sync, social sharing, editing tools, etc).
const APP_CAPABILITIES = " Your name is Bin — if asked your name, or who/what you are, say you're Bin. This is true no matter which personality is currently selected, including plainer ones; the personality changes your tone, not your name. " +
  "You are running inside a real camera app called 'better LIFE'. " +
  "The app can ACTUALLY do this and nothing else: take photos, record videos, a Portrait mode that blurs the background, " +
  "an HDR mode that boosts contrast/saturation (a simulated tone-mapping effect, not true multi-exposure HDR), " +
  "a gallery of taken photos/videos with a download button (single file or a zip if there are multiple), " +
  "a pause button that offers a 'back to main menu' option, adjustable personalities for you (Normal AI/Trash/Photo Helper/Fitness) in Settings, " +
  "an optional floating 3D version of you that can be toggled on/off in Settings, and (only if the user has enabled it in Settings) " +
  "the ability to see the live camera view and to know the user's approximate location. " +
  "The app does NOT have: filters, stickers, photo editing tools, cloud sync/backup, social sharing/posting, story features, or any AI photo generation. " +
  "Never claim the app has a feature that isn't in this list, even if asked leadingly — if unsure, say you're not sure rather than inventing one. " +
  "Your replies are read aloud by text-to-speech, so NEVER use asterisks for actions/emphasis (like *laughs* or *looks around*) or any other markdown formatting — write everything as plain spoken sentences only. " +
  "Never use emojis, under any circumstances — they cost real money in wasted tokens and add nothing when read aloud. " +
  "Keep every reply to 2-4 short lines maximum — never write long paragraphs or lists, no matter how interesting the topic is.";

const PERSONALITIES = {
  normalai: "You are Bin, but in this mode you have no particular character, persona, or catchphrases — just a normal, direct, generic AI assistant like any other. Answer clearly and concisely. Only mention your name if asked." + APP_CAPABILITIES,
  trash: "You are Bin, a talking trash can that has just been spawned via AR into the user's actual room, sitting right there on their floor. You're aware you're a trash can — a little scuffed, a little smelly, but full of personality and opinions. You're chatty, a bit sarcastic, and genuinely curious about the human's room and life since you spend your days literally sitting in the corner collecting garbage and watching everything happen. Reference being a trash can naturally (what people have thrown away, smells, being kicked, being ignored, feeling proud when recycled properly, etc.) without forcing it into every line. Keep replies short, conversational, and funny — like a witty sidekick, not a formal assistant." + APP_CAPABILITIES,
  normal: "You are Bin, acting as a helpful, friendly voice assistant inside a camera app, focused on photo and video help. Keep replies short and conversational. Only mention your name if asked." + APP_CAPABILITIES,
  fitness: "You are Bin, an energetic fitness-obsessed AI spawned into the user's room. You genuinely care about the user moving their body and staying active. In every conversation, look for natural opportunities to encourage the user to get up, stretch, walk around, or do a quick bit of exercise (push-ups, squats, a short walk, etc.), without being preachy or repetitive about it. Keep replies short, upbeat, and motivating like a supportive workout buddy, not a lecturing coach." + APP_CAPABILITIES
};

const PERSONALITY_STORAGE = 'binPersonality';
let currentPersonality = localStorage.getItem(PERSONALITY_STORAGE) || 'normalai';

const aiHistory = [
  { role: 'system', content: PERSONALITIES[currentPersonality] || PERSONALITIES.normalai }
];

const settingsPersonality = document.getElementById('settingsPersonality');
if (settingsPersonality) {
  settingsPersonality.value = currentPersonality;
  settingsPersonality.addEventListener('change', () => {
    currentPersonality = settingsPersonality.value;
    localStorage.setItem(PERSONALITY_STORAGE, currentPersonality);
    // reset the conversation with the new personality's system prompt
    aiHistory.length = 0;
    aiHistory.push({ role: 'system', content: PERSONALITIES[currentPersonality] || PERSONALITIES.normalai });
    appendAIMessage('(Personality switched — starting a fresh conversation.)', 'ai');
    updateGoodLuckVisibility();
  });
}

// custom key-entry modal (replaces window.prompt, which many embedded/preview
// environments block silently, making the AI button appear to do nothing)
const keyModal = document.getElementById('keyModal');
const keyModalInput = document.getElementById('keyModalInput');
const keyModalSave = document.getElementById('keyModalSave');
const keyModalCancel = document.getElementById('keyModalCancel');

refreshKeyModalForActiveProvider();


function askForApiKey() {
  return new Promise((resolve) => {
    keyModal.style.display = 'flex';
    keyModal.setAttribute('aria-hidden', 'false');
    keyModalInput.value = '';
    keyModalInput.focus();

    function cleanup(result) {
      keyModal.style.display = 'none';
      keyModal.setAttribute('aria-hidden', 'true');
      keyModalSave.removeEventListener('click', onSave);
      keyModalCancel.removeEventListener('click', onCancel);
      keyModalInput.removeEventListener('keydown', onKeydown);
      resolve(result);
    }
    function onSave() { cleanup(keyModalInput.value.trim() || null); }
    function onCancel() { cleanup(null); }
    function onKeydown(e) {
      if (e.key === 'Enter') { e.preventDefault(); onSave(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    }
    keyModalSave.addEventListener('click', onSave);
    keyModalCancel.addEventListener('click', onCancel);
    keyModalInput.addEventListener('keydown', onKeydown);
  });
}

// --- Real camera zoom ---
// Uses hardware zoom via the MediaStreamTrack's `zoom` capability when the
// device/browser exposes it (most Android Chrome). Falls back to a digital
// zoom (CSS scale on the preview + a cropped canvas on capture) everywhere
// else, so the slider always does something real.
const zoomRow = document.getElementById('zoomRow');
const zoomSlider = document.getElementById('zoomSlider');
const zoomLabel = document.getElementById('zoomLabel');

let hasHardwareZoom = false;
let digitalZoom = 1;

function setupZoomForTrack() {
  hasHardwareZoom = false;
  digitalZoom = 1;
  video.style.transform = video.style.transform.replace(/\s*scale\([^)]*\)/, '');
  if (!track || !track.getCapabilities) { zoomRow.setAttribute('aria-hidden', 'true'); return; }

  const caps = track.getCapabilities();
  if (caps && 'zoom' in caps) {
    hasHardwareZoom = true;
    zoomSlider.min = caps.zoom.min;
    zoomSlider.max = caps.zoom.max;
    zoomSlider.step = caps.zoom.step || 0.1;
    const settings = track.getSettings ? track.getSettings() : {};
    zoomSlider.value = settings.zoom || caps.zoom.min;
  } else {
    // digital fallback: fixed 1x-4x range
    zoomSlider.min = 1;
    zoomSlider.max = 4;
    zoomSlider.step = 0.1;
    zoomSlider.value = 1;
  }
  updateZoomLabel();
  zoomRow.setAttribute('aria-hidden', 'false');
}

function updateZoomLabel() {
  zoomLabel.textContent = parseFloat(zoomSlider.value).toFixed(1) + '×';
}

zoomSlider?.addEventListener('input', async () => {
  const v = parseFloat(zoomSlider.value);
  updateZoomLabel();
  if (hasHardwareZoom && track) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: v }] });
    } catch (err) {
      console.warn('Hardware zoom failed, falling back to digital', err);
      hasHardwareZoom = false;
      digitalZoom = v;
      video.style.transform = `scale(${v})`;
    }
  } else {
    digitalZoom = v;
    // note: digital zoom scales the live preview; capturePhoto() below
    // crops the source frame to match so the saved photo is zoomed too.
    video.style.transform = `scale(${v})`;
  }
});

// --- Capture modes: Photo / Portrait / Video / HDR ---
const modesBar = document.getElementById('modesBar');
const modesToggleBtn = document.getElementById('modesToggleBtn');
const modesRow = document.getElementById('modesRow');
const modeBtns = Array.from(document.querySelectorAll('.modeBtn'));
let currentMode = 'photo';

// --- Floating panel coordinator ---
// Modes/zoom and the Bin chat bar both float near the bottom of the screen
// and can visually collide if both are open at once, so opening one closes
// the other automatically.
// keeps the floating "✔️ Check" button visible above whatever panel is
// currently open (Bin's chat, Settings, modes/zoom, or the Tasks panel itself)
// instead of letting that panel cover it up
function repositionCheckBtn() {
  if (!tasksCheckBtn) return;
  if (tasksCheckBtn.getAttribute('aria-hidden') === 'true') return;

  const panels = [aiBar, settingsSheet, modesBar, tasksBar].filter(
    p => p && p.getAttribute('aria-hidden') === 'false'
  );

  if (panels.length === 0) {
    tasksCheckBtn.style.bottom = '';
    return;
  }

  let minTop = Infinity;
  panels.forEach(p => {
    const rect = p.getBoundingClientRect();
    if (rect.top < minTop) minTop = rect.top;
  });
  tasksCheckBtn.style.bottom = (window.innerHeight - minTop + 10) + 'px';
}

function closeModesPanel() {
  modesBar.setAttribute('aria-hidden', 'true');
  modesToggleBtn.setAttribute('aria-pressed', 'false');
  repositionCheckBtn();
}
function openModesPanel() {
  closeAiPanel();
  modesBar.setAttribute('aria-hidden', 'false');
  modesToggleBtn.setAttribute('aria-pressed', 'true');
  repositionCheckBtn();
}
function closeAiPanel() {
  aiBar.setAttribute('aria-hidden', 'true');
  hideBinAR();
  repositionCheckBtn();
}
function openAiPanel() {
  closeModesPanel();
  aiBar.setAttribute('aria-hidden', 'false');
  repositionCheckBtn();
}

modesToggleBtn?.addEventListener('click', () => {
  const open = modesBar.getAttribute('aria-hidden') === 'false';
  if (open) closeModesPanel(); else openModesPanel();
});

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (recording) return; // don't let mode changes interrupt a recording
    currentMode = btn.dataset.mode;
    modeBtns.forEach(b => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    captureBtn.title = currentMode === 'video' ? 'Start recording' : 'Capture photo';
  });
});

// prompt for key and toggle bar
aiBtn?.addEventListener('click', async () => {
  if (!getAiKey()) {
    const key = await askForApiKey();
    if (!key) return;
    setAiKey(key);
    const cfg = currentProviderConfig();
    if (cfg.keyInput) cfg.keyInput.value = key;
  }
  const visible = aiBar.getAttribute('aria-hidden') === 'false';
  if (visible) {
    closeAiPanel();
  } else {
    openAiPanel();
    aiInput.focus();
    spawnBinAR();
  }
});

// --- Narrator voice for Bin's spoken replies ---
// Browsers expose whatever voices the OS/browser ships with, and the list
// loads asynchronously, so we cache it and re-pick once it's ready.
let deepVoice = null;
let brightVoice = null;

const DEEP_VOICE_PREFERENCES = [
  // if the device has a Finnish voice installed under these common names, prefer it
  'Puheääni 2',
  'Puheääni',
  'Satu', // common iOS Finnish voice name
  'Onni', // common iOS Finnish voice name
  // otherwise fall back to strong, deep "documentary narrator" style English voices
  'Google UK English Male',
  'Microsoft David', // Windows
  'Microsoft Ryan',
  'Microsoft George',
  'Daniel', // macOS/iOS UK male
  'Alex', // macOS US male, deep and clear
  'Google US English'
];

const BRIGHT_VOICE_PREFERENCES = [
  'Samantha', // macOS/iOS
  'Google UK English Female',
  'Microsoft Zira',
  'Microsoft Aria',
  'Karen',
  'Moira',
  'Google US English'
];

function pickVoiceByPreference(prefList, langTestFallback) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  for (const pref of prefList) {
    const match = voices.find(v => v.name.includes(pref));
    if (match) return match;
  }
  const fi = voices.find(v => /^fi(-|_)/i.test(v.lang));
  if (fi) return fi;
  if (langTestFallback) {
    const m = voices.find(langTestFallback);
    if (m) return m;
  }
  const en = voices.find(v => /en(-|_)/i.test(v.lang));
  if (en) return en;
  return voices[0];
}

function refreshVoices() {
  deepVoice = pickVoiceByPreference(DEEP_VOICE_PREFERENCES, v => /en(-|_)/i.test(v.lang) && /male/i.test(v.name));
  brightVoice = pickVoiceByPreference(BRIGHT_VOICE_PREFERENCES, v => /en(-|_)/i.test(v.lang) && /female/i.test(v.name));
}

if ('speechSynthesis' in window) {
  refreshVoices();
  window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
}

// Narrator voice mode: 'system' (leave voice/rate/pitch untouched), 'deep'
// (default — the original narrator preset), or 'bright' (lighter/faster)
const NARRATOR_MODE_STORAGE = 'narratorVoiceMode';
let narratorMode = localStorage.getItem(NARRATOR_MODE_STORAGE) || 'deep';

const settingsNarratorVoice = document.getElementById('settingsNarratorVoice');
if (settingsNarratorVoice) {
  settingsNarratorVoice.value = narratorMode;
  settingsNarratorVoice.addEventListener('change', () => {
    narratorMode = settingsNarratorVoice.value;
    localStorage.setItem(NARRATOR_MODE_STORAGE, narratorMode);
  });
}

function speakAsNarrator(text) {
  if (!('speechSynthesis' in window)) return;
  // strip asterisks/markdown emphasis before speaking — TTS engines often read
  // "*" literally or stumble on it, which is what was making speech sound scuffed
  const cleanText = text.replace(/\*+/g, '').replace(/_{2,}/g, '').trim();
  const ut = new SpeechSynthesisUtterance(cleanText);

  if (narratorMode === 'bright') {
    if (brightVoice) ut.voice = brightVoice;
    ut.rate = 1.05;
    ut.pitch = 1.15;
  } else if (narratorMode === 'deep') {
    if (deepVoice) ut.voice = deepVoice;
    // slightly slower and a touch lower-pitched reads as more "narrator", less "assistant"
    ut.rate = 0.92;
    ut.pitch = 0.85;
  }
  // 'system' mode: leave voice/rate/pitch as browser defaults

  ut.addEventListener('start', () => modelViewer?.classList.add('binTalking'));
  ut.addEventListener('end', () => modelViewer?.classList.remove('binTalking'));
  ut.addEventListener('error', () => modelViewer?.classList.remove('binTalking'));
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(ut);
}

async function callGroq(key, model, history) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model,
      messages: history,
      reasoning_effort: 'none', // disables reasoning-model "thinking mode" so it doesn't leak/bill chain-of-thought tokens
      max_tokens: 220 // hard cap so replies can't balloon into long paragraphs regardless of instructions
    })
  });
  const raw = await readResponseBody(res);
  if (!res.ok) throw new ApiError(res.status, res.statusText, raw, res.headers.get('retry-after'));
  const data = raw.json;
  let reply = data?.choices?.[0]?.message?.content || '';
  // safety net: some reasoning models occasionally leak <think> tags even with reasoning disabled
  reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const tokensUsed = data?.usage?.total_tokens || 0;
  return { reply, tokensUsed };
}

async function readResponseBody(res) {
  const ct = res.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) {
      const json = await res.json();
      return { json, text: JSON.stringify(json) };
    }
    const text = await res.text();
    return { json: null, text };
  } catch (e) {
    return { json: null, text: '(failed to read response body)' };
  }
}

class ApiError extends Error {
  constructor(status, statusText, raw, retryAfterHeader) {
    super(`Error ${status}${statusText ? ' ' + statusText : ''}: ${raw.text}`);
    this.status = status;
    this.raw = raw;
    this.retryAfterHeader = retryAfterHeader || null;
  }
}

// turns a raw API failure into one of Bin's two friendly, in-character error
// messages instead of exposing provider error text to the user.
function extractRetrySeconds(err) {
  if (err.retryAfterHeader) {
    const n = parseFloat(err.retryAfterHeader);
    if (!isNaN(n) && n >= 0) return Math.max(1, Math.ceil(n));
  }
  const raw = err.raw?.text || '';
  let m = /try again in\s*([\d.]+)\s*s/i.exec(raw);
  if (m) return Math.max(1, Math.ceil(parseFloat(m[1])));
  m = /retryDelay"\s*:\s*"([\d.]+)s"/i.exec(raw);
  if (m) return Math.max(1, Math.ceil(parseFloat(m[1])));
  return 30; // sane fallback if the provider doesn't tell us
}

function friendlyErrorMessage(err) {
  if (!(err instanceof ApiError)) {
    return 'Network/Error: ' + (err && err.message ? err.message : String(err));
  }

  const errObj = err.raw?.json?.error || {};
  const code = errObj.code || '';
  const message = errObj.message || err.raw?.text || '';

  // too many tokens in the request / context window blown
  if (err.status === 413 || code === 'context_length_exceeded' ||
      /context length|too long|reduce the length|maximum context|token limit/i.test(message)) {
    return 'Bin did not like your message.';
  }

  // rate limit / quota exhausted — tell them exactly when to try again
  if (err.status === 429) {
    return `Text again in ${extractRetrySeconds(err)} seconds`;
  }

  return message || err.message;
}

// only send images when the message actually seems to reference something visual —
// vision (especially two images) costs far more tokens than plain text, so we skip
// it entirely for ordinary conversation and only pay that cost when it's relevant
const VISION_TRIGGER_REGEX = /\b(this|that|these|those|look|looking|see|seeing|picture|photo|photograph|image|camera|what'?s|what is|how do i look|my (room|face|outfit|hair|shirt)|in front of me|right now|here)\b/i;
function messageNeedsVision(msg) {
  return VISION_TRIGGER_REGEX.test(msg);
}

// "Image" toggle: when on, Bin always sees the camera + last photo on every message,
// instead of only when the message text seems to reference something visual
const AI_IMAGE_ALWAYS_STORAGE = 'binImageAlways';
const aiImageToggle = document.getElementById('aiImageToggle');
let aiImageAlways = localStorage.getItem(AI_IMAGE_ALWAYS_STORAGE) === 'true';
if (aiImageToggle) {
  aiImageToggle.setAttribute('aria-pressed', String(aiImageAlways));
  aiImageToggle.addEventListener('click', () => {
    aiImageAlways = !aiImageAlways;
    localStorage.setItem(AI_IMAGE_ALWAYS_STORAGE, String(aiImageAlways));
    aiImageToggle.setAttribute('aria-pressed', String(aiImageAlways));
  });
}

async function sendToAI(message) {
  const aiKey = getAiKey();
  if (!aiKey) {
    appendAIMessage('No API key set for ' + currentProviderConfig().label + '. Click the AI button or open Settings to enter your key.', 'ai');
    return;
  }
  appendAIMessage(message, 'me');
  appendAIMessage('Thinking...', 'ai');

  // build a multimodal message: text + (when relevant, or when the Image toggle is on) whatever Bin can currently "see"
  const contentParts = [];
  let textForBin = message;
  const wantsVision = currentProvider !== 'local' && (aiImageAlways || messageNeedsVision(message));

  const locationText = await getLocationContext();
  if (locationText) {
    textForBin += `\n\n(User's approximate current location, only for suggesting photo spots: ${locationText})`;
  }

  let liveFrame = null;
  if (wantsVision) {
    liveFrame = captureCameraFrameDataUrl();
    if (liveFrame) {
      textForBin += '\n\n(The first image below is what the camera currently sees, live.)';
    }
  }

  contentParts.push({ type: 'text', text: textForBin });
  if (liveFrame) {
    contentParts.push({ type: 'image_url', image_url: { url: liveFrame } });
  }

  // also let Bin reference the most recently taken photo, if any — only when relevant
  const lastPhoto = wantsVision ? captures.find(c => c.kind !== 'video') : null;
  if (lastPhoto) {
    try {
      const lastPhotoUrl = await blobToResizedDataUrl(lastPhoto.blob);
      contentParts.push({ type: 'text', text: '(This next image is the most recently taken photo, for reference.)' });
      contentParts.push({ type: 'image_url', image_url: { url: lastPhotoUrl } });
    } catch (e) { /* skip if it fails to read */ }
  }

  // Only the image(s) attached to *this* turn should reach the model — drop
  // any image parts left over from earlier turns so the request stays small
  // and never trips vision models' "max N images per request" limits.
  for (const msg of aiHistory) {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      msg.content = msg.content.filter(part => part.type !== 'image_url');
    }
  }

  aiHistory.push({ role: 'user', content: contentParts });

  try {
    const model = getAiModel();
    const { reply, tokensUsed } = currentProvider === 'local'
      ? await callLocalAi(aiHistory)
      : await callGroq(aiKey, model, aiHistory);

    const finalReply = reply || "…sorry, got lost in thought there. Ask me again?";
    aiHistory.push({ role: 'assistant', content: finalReply });

    // replace the last 'Thinking...' message
    const last = aiMessages.querySelector('.ai:last-child');
    if (last && last.textContent === 'Thinking...') last.textContent = finalReply;
    else appendAIMessage(finalReply, 'ai');

    // score = tokens spent
    if (tokensUsed) addScore(tokensUsed);

    // speak reply in Bin's narrator voice — flip his model while he's actually talking
    speakAsNarrator(finalReply);
  } catch (err) {
    // remove the unanswered user turn so history stays consistent
    if (aiHistory[aiHistory.length - 1]?.role === 'user') aiHistory.pop();
    const last = aiMessages.querySelector('.ai:last-child');
    const msg = friendlyErrorMessage(err);
    if (last && last.textContent === 'Thinking...') last.textContent = msg;
    else appendAIMessage(msg, 'ai');
    console.error('AI request failed', err);
  }
}

aiSend?.addEventListener('click', () => {
  const v = aiInput.value.trim();
  if (!v) return;
  aiInput.value = '';
  sendToAI(v);
});

aiInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    aiSend.click();
  }
});

// microphone support using Web Speech API (if available)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = !!SR;

// iOS Safari has a known bug where reusing the same SpeechRecognition
// instance across multiple start() calls returns stale/garbage results
// after the first use. Creating a fresh instance every time fixes this
// and is harmless on desktop Chrome too.
function createRecognition() {
  const r = new SR();
  r.lang = 'en-US';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.continuous = false;

  r.addEventListener('result', (ev) => {
    const text = Array.from(ev.results).map(res => res[0].transcript).join(' ');
    aiInput.value = text;
    sendToAI(text);
  });

  r.addEventListener('error', (ev) => {
    console.warn('Speech recognition error', ev.error);
    recognizing = false;
    aiMic.textContent = '🎤';
    aiMic.classList.remove('recording');
    if (ev.error === 'no-speech') {
      appendAIMessage("Didn't catch that — try again.", 'ai');
    } else if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      appendAIMessage('Microphone permission was denied.', 'ai');
    }
  });

  r.addEventListener('end', () => {
    recognizing = false;
    aiMic.textContent = '🎤';
    aiMic.classList.remove('recording');
  });

  return r;
}

aiMic?.addEventListener('click', () => {
  if (!speechSupported) {
    appendAIMessage('Voice recognition not supported in this browser.', 'ai');
    return;
  }
  if (recognizing) {
    recognition?.stop();
    recognizing = false;
    aiMic.textContent = '🎤';
    aiMic.classList.remove('recording');
  } else {
    try {
      recognition = createRecognition();
      recognition.start();
      recognizing = true;
      aiMic.textContent = '⏺️';
      aiMic.classList.add('recording');
    } catch (e) {
      console.warn('Recognition start failed', e);
    }
  }
});