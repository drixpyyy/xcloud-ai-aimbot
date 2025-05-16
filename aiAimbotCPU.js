// ==UserScript==
// @name         THIS USES CPU TO RUN THE AI SO PERFORMANCE IS DEPENDENT ON YOUR CPU, fun fact: CPUs are way slower than GPUS
// @description  Fortnite aimbot for xCloud using KBM simulation with Coco SSD. Features: Continuous AI targeting to ESP center, recoil control, auto-shoot, and GUI.
// @author       wesd
// @version      3.0.1
// @match        *://*.xbox.com/play/*
// @grant        none
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js
// @require      https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.2
// ==/UserScript==

const config = {
    detection: {
        enabled: true,
        modelType: 'cocossd',
        confidence: 0.30,
        targetClass: 'person',
        maxDetections: 5,
    },
    game: {
        videoSelector: 'video[aria-label="Game Stream for unknown title"]',
        containerSelector: '#game-stream',
        aimInterval: 30, // Fixed interval, no dynamic adjustments
        fovRadius: 150,
        recoilCompensation: true,
        recoilLevel: 4,
        recoilPatterns: {
            1: { vertical: 0, horizontal: 0, recoverySpeed: 0.1 },
            2: { vertical: 0.2, horizontal: 0.05, recoverySpeed: 0.1 },
            3: { vertical: 0.4, horizontal: 0.1, recoverySpeed: 0.15 },
            4: { vertical: 0.6, horizontal: 0.2, recoverySpeed: 0.2 },
        },
        autoShoot: true,
        autoCrouchShoot: true,
        autoReload: true,
        crouchKey: 'KeyQ',
        reloadKey: 'KeyR',
        inventoryKeys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'],
    },
    crosshair: {
        enabled: true,
        size: 15,
        color: 'lime',
        style: 'cross'
    },
    fovCircle: {
        enabled: true,
        color: 'rgba(0, 0, 0, 0.8)',
        lineWidth: 1,
    },
    boundingBoxes: {
        enabled: true,
        color: 'black',
        lineWidth: 1,
    },
    aim: {
        positionSmoothing: false, // Disabled for continuous, direct aiming
        historySize: 0, // No history used
        targetPriority: "closest",
        aimPoint: "center",
    },
    debug: {
        enabled: true,
        showFPS: true,
        logThrottleMs: 250,
    }
};

// --- Globals ---
let gameVideo = null;
let detectionModel = null;
let positionHistory = [];
let currentTarget = null;
let overlayCanvas = null;
let overlayCtx = null;

// --- Utility functions ---
const utils = {
    fps: (function() {
        let fps = 0, lastUpdate = Date.now(), frames = 0;
        return {
            get: () => fps,
            update: () => {
                frames++;
                const now = Date.now();
                const diff = now - lastUpdate;
                if (diff >= 1000) {
                    fps = Math.round((frames * 1000) / diff);
                    lastUpdate = now;
                    frames = 0;
                }
            }
        };
    })()
};

const debug = {
    enabled: config.debug.enabled,
    showFPS: config.debug.showFPS,
    lastLogTime: 0,
    throttleMs: config.debug.logThrottleMs,
    log(...args) {
        if (this.enabled) {
            const now = Date.now();
            if (now - this.lastLogTime >= this.throttleMs) {
                let logString = `[XcloudCheat]`;
                if (this.showFPS) { logString += ` FPS: ${utils.fps.get()} |`; }
                console.log(logString, ...args);
                this.lastLogTime = now;
            }
        }
    },
    error(...args) { if (this.enabled) { console.error(`[XcloudCheat] ERROR:`, ...args); } },
    warn(...args) { if (this.enabled) { console.warn(`[XcloudCheat] WARN:`, ...args); } }
};

const InputSimulator = {
    gameContainer: null,
    mousePos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    isShooting: false,
    recoilOffset: { x: 0, y: 0 },
    kbm: {
        lastClientX: window.innerWidth / 2,
        lastClientY: window.innerHeight / 2,
        leftButtonDown: false,
        inventoryActive: [false,false,false,false,false,false,false],
    },

    _simulatePointerEvent(options) {
        const {
            type,
            clientX,
            clientY,
            movementX = 0,
            movementY = 0,
            button = 0,
            buttons = 0,
            delay = 0
        } = options;

        let eventType;
        let eventProps = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: Math.round(clientX),
            clientY: Math.round(clientY),
            pointerType: 'mouse',
        };

        if (type === 'pointermove') {
            eventType = 'pointermove';
            eventProps.movementX = Math.round(movementX);
            eventProps.movementY = Math.round(movementY);
            eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0;
        } else if (type === 'pointerdown') {
            eventType = 'pointerdown';
            eventProps.button = button;
            eventProps.buttons = buttons;
            if (button === 0) this.kbm.leftButtonDown = true;
        } else if (type === 'pointerup') {
            eventType = 'pointerup';
            eventProps.button = button;
            eventProps.buttons = buttons;
            if (button === 0) this.kbm.leftButtonDown = false;
        } else {
            debug.error("[InputSim] Invalid pointer event type:", type);
            return;
        }

        if (!eventType) return;

        setTimeout(() => {
            const event = new PointerEvent(eventType, eventProps);
            window.dispatchEvent(event);
        }, delay);
    },

    init() {
        this.gameContainer = document.querySelector(config.game.containerSelector);
        this.kbm.lastClientX = window.innerWidth / 2;
        this.kbm.lastClientY = window.innerHeight / 2;
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };

        this._simulatePointerEvent({
            type: 'pointermove',
            clientX: this.kbm.lastClientX,
            clientY: this.kbm.lastClientY,
            movementX: 0,
            movementY: 0,
            delay: 100
        });
        debug.log('Input simulator (KBM) initialized. Initial pointermove sent.');
        this.listenKeyboard();
        return true;
    },

    listenKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.code === config.game.crouchKey && !this.isShooting) {
                debug.log(`KBM: '${config.game.crouchKey}' (shoot trigger) pressed`);
                this.startShooting();
            }
            config.game.inventoryKeys.forEach((key, idx) => {
                if (e.code === key && !this.kbm.inventoryActive[idx]) {
                    this.kbm.inventoryActive[idx] = true;
                    debug.log(`KBM: User pressed Inventory Slot ${idx+1} ('${key}')`);
                }
            });
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === config.game.crouchKey) {
                debug.log(`KBM: '${config.game.crouchKey}' (shoot trigger) released`);
                this.stopShooting();
            }
            config.game.inventoryKeys.forEach((key, idx) => {
                if (e.code === key) {
                    this.kbm.inventoryActive[idx] = false;
                }
            });
        });
    },

    simulateInventory(slotIdx) {
        if (slotIdx >= 0 && slotIdx < config.game.inventoryKeys.length) {
            const keyToPress = config.game.inventoryKeys[slotIdx];
            debug.log(`KBM: AI simulating inventory key press: ${keyToPress} (Slot ${slotIdx+1})`);
            this.pressKey(keyToPress, 50);
        }
    },

    applyRecoil(targetX, targetY) {
        if (!config.game.recoilCompensation || !config.game.recoilPatterns[config.game.recoilLevel] || !this.isShooting) {
            if (this.recoilOffset.x !== 0 || this.recoilOffset.y !== 0) {
                const recoverySpeed = config.game.recoilPatterns[config.game.recoilLevel]?.recoverySpeed || 0.1;
                this.recoilOffset.x *= (1 - recoverySpeed);
                this.recoilOffset.y *= (1 - recoverySpeed);
                if (Math.abs(this.recoilOffset.x) < 0.01) this.recoilOffset.x = 0;
                if (Math.abs(this.recoilOffset.y) < 0.01) this.recoilOffset.y = 0;
            }
            return { x: targetX, y: targetY };
        }
        const recoil = config.game.recoilPatterns[config.game.recoilLevel];
        if (Math.abs(this.recoilOffset.x) < 0.1 && Math.abs(this.recoilOffset.y) < 0.1) {
            const kickMultiplier = 5;
            this.recoilOffset.y = recoil.vertical * kickMultiplier;
            this.recoilOffset.x = (Math.random() - 0.5) * 2 * recoil.horizontal * kickMultiplier;
        }
        let newTargetX = targetX - this.recoilOffset.x;
        let newTargetY = targetY + this.recoilOffset.y;
        this.recoilOffset.x *= (1 - recoil.recoverySpeed);
        this.recoilOffset.y *= (1 - recoil.recoverySpeed);
        if (Math.abs(this.recoilOffset.x) < 0.01) this.recoilOffset.x = 0;
        if (Math.abs(this.recoilOffset.y) < 0.01) this.recoilOffset.y = 0;
        return { x: newTargetX, y: newTargetY };
    },

    moveMouseTo(targetScreenX, targetScreenY) {
        const compensatedTarget = this.applyRecoil(targetScreenX, targetScreenY);
        let finalTargetX = compensatedTarget.x;
        let finalTargetY = compensatedTarget.y;

        const movementX = finalTargetX - this.kbm.lastClientX;
        const movementY = finalTargetY - this.kbm.lastClientY;

        this._simulatePointerEvent({
            type: 'pointermove',
            clientX: finalTargetX,
            clientY: finalTargetY,
            movementX: movementX,
            movementY: movementY,
            delay: 0
        });

        this.kbm.lastClientX = finalTargetX;
        this.kbm.lastClientY = finalTargetY;
        this.mousePos = { x: finalTargetX, y: finalTargetY };
    },

    startShooting() {
        if (this.isShooting) return;
        this.isShooting = true;
        debug.log("Shooting START (KBM)");

        this._simulatePointerEvent({
            type: 'pointerdown',
            clientX: this.kbm.lastClientX,
            clientY: this.kbm.lastClientY,
            button: 0,
            buttons: 1,
            delay: 0
        });
    },

    stopShooting() {
        if (!this.isShooting) return;
        this.isShooting = false;
        debug.log("Shooting STOP (KBM)");

        this._simulatePointerEvent({
            type: 'pointerup',
            clientX: this.kbm.lastClientX,
            clientY: this.kbm.lastClientY,
            button: 0,
            buttons: 0,
            delay: 0
        });
    },

    pressKey(code, duration = 50) {
        debug.log("[InputSim] Simulate KBM key press:", code, `duration: ${duration}ms`);
        const key = code.replace(/^(Key|Digit)/, '');
        const downEvt = new KeyboardEvent('keydown', { code: code, key: key, bubbles: true, cancelable: true, view: window });
        document.dispatchEvent(downEvt);
        if (duration > 0) {
            setTimeout(() => {
                const upEvt = new KeyboardEvent('keyup', { code: code, key: key, bubbles: true, cancelable: true, view: window });
                document.dispatchEvent(upEvt);
            }, duration);
        }
    }
};

function createOverlayCanvas() {
    if (overlayCanvas) return;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'xcloud-cheat-overlay';
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerHeight;
    overlayCanvas.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 99998;`;
    overlayCtx = overlayCanvas.getContext('2d');
    document.body.appendChild(overlayCanvas);
    window.addEventListener('resize', () => {
        overlayCanvas.width = window.innerWidth;
        overlayCanvas.height = window.innerHeight;
    });
    debug.log('Overlay canvas created');
}

function drawOverlay(predictions = []) {
    if (!overlayCtx || !gameVideo) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const videoRect = gameVideo.getBoundingClientRect();
    if (!videoRect || videoRect.width === 0 || videoRect.height === 0) return;
    if (config.fovCircle.enabled) {
        overlayCtx.strokeStyle = config.fovCircle.color;
        overlayCtx.lineWidth = config.fovCircle.lineWidth;
        overlayCtx.beginPath();
        const centerX = videoRect.left + videoRect.width / 2;
        const centerY = videoRect.top + videoRect.height / 2;
        overlayCtx.arc(centerX, centerY, config.game.fovRadius, 0, Math.PI * 2);
        overlayCtx.stroke();
    }
    if (config.boundingBoxes.enabled && predictions.length > 0) {
        overlayCtx.strokeStyle = config.boundingBoxes.color;
        overlayCtx.lineWidth = config.boundingBoxes.lineWidth;
        overlayCtx.fillStyle = config.boundingBoxes.color;
        overlayCtx.font = '12px sans-serif';
        overlayCtx.textBaseline = 'bottom';
        predictions.forEach(p => {
            if (p.class === config.detection.targetClass) {
                const drawX = videoRect.left + (p.bbox[0] / gameVideo.videoWidth) * videoRect.width;
                const drawY = videoRect.top + (p.bbox[1] / gameVideo.videoHeight) * videoRect.height;
                const drawWidth = (p.bbox[2] / gameVideo.videoWidth) * videoRect.width;
                const drawHeight = (p.bbox[3] / gameVideo.videoHeight) * videoRect.height;
                overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight);
                const scoreText = `${p.class} (${Math.round(p.score * 100)}%)`;
                overlayCtx.fillText(scoreText, drawX, drawY - 2);
            }
        });
    }
}

function createCrosshair() {
    if (!config.crosshair.enabled) return;
    const c = document.createElement('canvas');
    c.id = 'xcloud-crosshair';
    c.width = window.innerWidth; c.height = window.innerHeight;
    c.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 100000;`;
    const ctx = c.getContext('2d');
    document.body.appendChild(c);
    function draw() {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.strokeStyle = config.crosshair.color;
        ctx.fillStyle = config.crosshair.color;
        ctx.lineWidth = 2;
        const centerX = c.width / 2;
        const centerY = c.height / 2;
        const size = config.crosshair.size;
        switch (config.crosshair.style) {
            case 'circle':
                ctx.beginPath(); ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2); ctx.stroke(); break;
            case 'dot':
                ctx.beginPath(); ctx.arc(centerX, centerY, size / 4, 0, Math.PI * 2); ctx.fill(); break;
            case 'cross': default:
                ctx.beginPath(); ctx.moveTo(centerX - size / 2, centerY); ctx.lineTo(centerX + size / 2, centerY);
                ctx.moveTo(centerX, centerY - size / 2); ctx.lineTo(centerX, centerY + size / 2); ctx.stroke(); break;
        }
    }
    window.addEventListener('resize', () => { c.width = window.innerWidth; c.height = window.innerHeight; draw(); });
    draw();
    debug.log('Crosshair created (lime)');
}

function setupAutoCrouchShoot() {
    if (!config.game.autoCrouchShoot) return;
    debug.log(`Auto-shoot enabled, triggered by key: ${config.game.crouchKey}`);
}

function setupAutoReload() {
    if (!config.game.autoReload) return;
    debug.log('Auto-reload keybind active for:', config.game.reloadKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.reloadKey && !e.repeat) {
            debug.log(`'${config.game.reloadKey}' (reload key) pressed by user.`);
        }
    });
}

function createGUI() {
    if (document.getElementById('xcloudcheat-gui')) return;
    const gui = document.createElement('div');
    gui.id = 'xcloudcheat-gui';
    gui.style.cssText = `
        position: fixed; top: 60px; right: 30px; width: 400px; min-width: 320px; max-width: 460px;
        background: linear-gradient(120deg,#17171d 60%,#232340 100%);
        color: #fafaff; padding: 22px 20px 16px 20px; border-radius: 18px;
        z-index: 100002; font-family: Inter,Segoe UI,sans-serif; font-size: 16px;
        box-shadow: 0 12px 32px 0 #0009,0 2px 8px #0005;
        transition: box-shadow .3s;
        user-select: none;
    `;
    gui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;color:#6df;">Wesd Ai Aimbot <span style="font-size:15px;font-weight:400;opacity:.6;">v3.0.1 (KBM Fortnite)</span></h2>
          <button id="xcloudcheat-close" style="background:none;border:none;color:#faa;font-size:22px;font-weight:bold;cursor:pointer;padding:0 8px;">×</button>
        </div>
        <div style="margin:14px 0 10px 0;">
            <span style="color:#68f;font-size:15px;">Status:</span>
            <span id="xcloudcheat-status" style="color:#5f5;font-weight:600;">Active</span>
            <span style="float:right;color:#aaa;font-size:13px;font-style:italic;">Fortnite KBM Mode</span>
        </div>
        <hr style="border:1px solid #334;">
        <div style="margin-bottom: 10px;">
            <label><input type="checkbox" id="detection-enabled" ${config.detection.enabled ? 'checked' : ''}> <b>Aimbot</b></label>
            <label style="margin-left:18px;"><input type="checkbox" id="auto-shoot" ${config.game.autoShoot ? 'checked' : ''}> Auto Shoot</label>
            <label style="margin-left:18px;"><input type="checkbox" id="recoil-comp" ${config.game.recoilCompensation ? 'checked' : ''}> Recoil</label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Confidence: <span id="conf-val">${config.detection.confidence.toFixed(2)}</span></label>
          <input type="range" id="confidence" min="0.1" max="0.9" step="0.01" style="width:65%;" value="${config.detection.confidence}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Aim Interval: <span id="interval-val">${config.game.aimInterval}</span>ms</label>
          <input type="range" id="aim-interval" min="30" max="500" step="10" style="width:65%;" value="${config.game.aimInterval}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>FOV Radius: <span id="fov-val">${config.game.fovRadius}</span>px</label>
          <input type="range" id="fov-radius" min="50" max="600" step="10" style="width:65%;" value="${config.game.fovRadius}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Target Priority:
            <select id="target-priority">
              <option value="closest" ${config.aim.targetPriority === "closest" ? 'selected' : ''}>Closest to Crosshair</option>
              <option value="center" ${config.aim.targetPriority === "center" ? 'selected' : ''}>Closest to Screen Center</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Aim Point:
            <select id="aim-point">
              <option value="center" ${config.aim.aimPoint === "center" ? 'selected' : ''}>Box Center</option>
              <option value="top" ${config.aim.aimPoint === "top" ? 'selected' : ''}>Box Top (Head)</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Recoil Level:
            <select id="recoil-level">
              <option value="1" ${config.game.recoilLevel === 1 ? 'selected' : ''}>1 (None)</option>
              <option value="2" ${config.game.recoilLevel === 2 ? 'selected' : ''}>2 (Low)</option>
              <option value="3" ${config.game.recoilLevel === 3 ? 'selected' : ''}>3 (Medium)</option>
              <option value="4" ${config.game.recoilLevel === 4 ? 'selected' : ''}>4 (High)</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label><input type="checkbox" id="draw-boxes" ${config.boundingBoxes.enabled ? 'checked' : ''}> Bounding Boxes</label>
          <label style="margin-left:18px;"><input type="checkbox" id="draw-fov" ${config.fovCircle.enabled ? 'checked' : ''}> FOV Circle</label>
        </div>
        <div style="margin-top: 11px; margin-bottom: 2px; color:#5df;">KBM Mappings (Fortnite)</div>
        <div style="font-size:14px;line-height:1.6;background:#171b2c;border-radius:8px;padding:8px 12px;margin-bottom:8px;">
          <b>Auto-Shoot Trigger:</b> <span style="color:#fff;background:#2e4;padding:1px 6px;border-radius:4px;">${config.game.crouchKey.replace('Key','')}</span> <br>
          <b>Reload:</b> <span style="color:#fff;background:#f73;padding:1px 6px;border-radius:4px;">${config.game.reloadKey.replace('Key','')}</span> <br>
          <b>Inventory Slots (Game Default):</b>
          <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;">1-7</span>
        </div>
        <div style="margin-top:10px;text-align:right;">
          <span style="font-size:12px;color:#bbb;">KBM INJECTION (Coco SSD)</span>
        </div>
    `;
    document.body.appendChild(gui);
    document.getElementById('xcloudcheat-close').onclick = () => gui.remove();

    document.getElementById('detection-enabled').onchange = (e) => config.detection.enabled = e.target.checked;
    document.getElementById('auto-shoot').onchange = (e) => config.game.autoShoot = e.target.checked;
    document.getElementById('recoil-comp').onchange = (e) => config.game.recoilCompensation = e.target.checked;
    document.getElementById('draw-boxes').onchange = (e) => config.boundingBoxes.enabled = e.target.checked;
    document.getElementById('draw-fov').onchange = (e) => config.fovCircle.enabled = e.target.checked;
    document.getElementById('confidence').oninput = (e) => {
        config.detection.confidence = parseFloat(e.target.value);
        document.getElementById('conf-val').textContent = config.detection.confidence.toFixed(2);
    };
    document.getElementById('aim-interval').oninput = (e) => {
        config.game.aimInterval = parseInt(e.target.value, 10);
        document.getElementById('interval-val').textContent = config.game.aimInterval;
    };
    document.getElementById('fov-radius').oninput = (e) => {
        config.game.fovRadius = parseInt(e.target.value, 10);
        document.getElementById('fov-val').textContent = config.game.fovRadius;
    };
    document.getElementById('target-priority').onchange = (e) => config.aim.targetPriority = e.target.value;
    document.getElementById('aim-point').onchange = (e) => config.aim.aimPoint = e.target.value;
    document.getElementById('recoil-level').onchange = (e) => config.game.recoilLevel = parseInt(e.target.value, 10);

    debug.log("GUI Created (KBM Mode, Coco SSD)");
}

async function findGameVideoAndInit() {
    gameVideo = document.querySelector(config.game.videoSelector);
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);
        try {
            if (!detectionModel) {
                debug.log("Loading Coco SSD model for Fortnite...");
                if (typeof tf === 'undefined' || typeof cocoSsd === 'undefined') {
                    console.error("TensorFlow.js (tf) or CocoSSD (cocoSsd) not loaded. Ensure @require directives worked.");
                    alert("Critical libraries not found. Aimbot cannot start. Check console.");
                    return;
                }
                detectionModel = await cocoSsd.load({ base: 'mobilenet_v2' });
                debug.log("Coco SSD model (mobilenet_v2) loaded successfully.");
            } else {
                debug.log("Coco SSD model already loaded.");
            }
            if (InputSimulator.init()) {
                createOverlayCanvas();
                createCrosshair();
                createGUI();
                setupAutoCrouchShoot();
                setupAutoReload();
                startAimLoop();
            } else {
                debug.error("InputSimulator initialization failed. Cannot proceed.");
            }
        } catch (err) {
            debug.error("Fatal Error during initialization (likely model loading):", err);
            alert("Failed to load Coco SSD model. Aimbot cannot function. Check console (F12) for errors.");
            config.detection.enabled = false;
        }
    } else {
        const status = gameVideo ? `readyState=${gameVideo.readyState}, dims=${gameVideo.videoWidth}x${gameVideo.videoHeight}` : 'not found';
        debug.log(`Game video not ready (${status}), retrying...`);
        setTimeout(findGameVideoAndInit, 1500);
    }
}

function startAimLoop() {
    debug.log('Starting main aim loop (KBM, Coco SSD)...');
    let lastFrameTime = 0;
    function loop(currentTime) {
        requestAnimationFrame(loop);
        const deltaTime = currentTime - lastFrameTime;
        if (deltaTime < config.game.aimInterval) return;
        lastFrameTime = currentTime;
        utils.fps.update();
        if (!config.detection.enabled || !detectionModel || !gameVideo || gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
            if (InputSimulator.isShooting) InputSimulator.stopShooting();
            drawOverlay([]);
            currentTarget = null;
            positionHistory = [];
            return;
        }
        aimLoop();
    }
    loop(performance.now());
}

async function aimLoop() {
    if (!detectionModel || !gameVideo || gameVideo.videoWidth === 0) return;
    let predictions = [];
    try {
        if (gameVideo.readyState < 2 || gameVideo.videoWidth === 0 || gameVideo.videoHeight === 0) {
            debug.warn("Video not ready for detection in aimLoop.");
        } else {
            predictions = await detectionModel.detect(gameVideo, config.detection.maxDetections, config.detection.confidence);
        }
        const persons = predictions.filter(p => p.class === config.detection.targetClass);
        drawOverlay(persons);
        processPredictions(persons);
    } catch (e) {
        debug.error('Aimbot loop error:', e);
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        currentTarget = null;
        positionHistory = [];
        drawOverlay([]);
    }
}

function processPredictions(targets) {
    const videoRect = gameVideo.getBoundingClientRect();
    if (!targets.length || !videoRect || videoRect.width === 0) {
        if (currentTarget) debug.log("Target lost.");
        currentTarget = null;
        positionHistory = [];
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        return;
    }
    const screenCenterX = videoRect.left + videoRect.width / 2;
    const screenCenterY = videoRect.top + videoRect.height / 2;
    let bestTarget = null;
    let minScore = Infinity;

    targets.forEach(target => {
        const targetCenterX_video = target.bbox[0] + target.bbox[2] / 2;
        const targetCenterY_video = target.bbox[1] + target.bbox[3] / 2;
        const targetCenterX_screen = videoRect.left + (targetCenterX_video / gameVideo.videoWidth) * videoRect.width;
        const targetCenterY_screen = videoRect.top + (targetCenterY_video / gameVideo.videoHeight) * videoRect.height;

        let evalCenterX, evalCenterY;
        if (config.aim.targetPriority === "center") {
            evalCenterX = screenCenterX;
            evalCenterY = screenCenterY;
        } else {
            evalCenterX = InputSimulator.mousePos.x;
            evalCenterY = InputSimulator.mousePos.y;
        }

        const dx = targetCenterX_screen - evalCenterX;
        const dy = targetCenterY_screen - evalCenterY;
        const distance = Math.hypot(dx, dy);

        if (distance > config.game.fovRadius) return;

        let score = distance;
        if (score < minScore) {
            minScore = score;
            bestTarget = target;
        }
    });

    if (!bestTarget) {
        if (currentTarget) debug.log("Target lost (Out of FOV or no priority match).");
        currentTarget = null;
        positionHistory = [];
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        return;
    }

    if (!currentTarget || currentTarget.bbox[0] !== bestTarget.bbox[0]) {
        debug.log(`New target acquired: ${bestTarget.class} (${(bestTarget.score*100).toFixed(1)}%), Dist: ${minScore.toFixed(0)}px`);
    }
    currentTarget = bestTarget;

    const bboxX_screen = videoRect.left + (bestTarget.bbox[0] / gameVideo.videoWidth) * videoRect.width;
    const bboxY_screen = videoRect.top + (bestTarget.bbox[1] / gameVideo.videoHeight) * videoRect.height;
    const bboxW_screen = (bestTarget.bbox[2] / gameVideo.videoWidth) * videoRect.width;
    const bboxH_screen = (bestTarget.bbox[3] / gameVideo.videoHeight) * videoRect.height;

    let aimScreenX, aimScreenY;
    if (config.aim.aimPoint === "top") {
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen * 0.15;
    } else {
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen / 2;
    }

    // Continuously move to the target position every frame, no smoothing
    InputSimulator.moveMouseTo(aimScreenX, aimScreenY);

    if (config.game.autoShoot) {
        if (!InputSimulator.isShooting) {
            InputSimulator.startShooting();
        }
    } else {
        if (InputSimulator.isShooting) {
            InputSimulator.stopShooting();
        }
    }
}

(function init() {
    console.log(`[XcloudCheat v3.0.1 KBM Aimbot with Coco SSD] Initializing...`);
    setTimeout(findGameVideoAndInit, 3000);
})();
