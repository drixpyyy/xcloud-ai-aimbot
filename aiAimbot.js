// ==UserScript==
// @name         XcloudCheat v3.0 KBM Aimbot (Fortnite)
// @description  Fortnite aimbot for xCloud using KBM simulation with Coco SSD. Features: AI targeting, recoil control, auto-shoot, and GUI.
// @author       Wesd (KBM integration by AI)
// @version      3.0.0
// @match        *://*.xbox.com/play/*
// @grant        none
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js
// @require      https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@latest/dist/coco-ssd.min.js
// ==/UserScript==

const config = {
    detection: {
        enabled: true,
        modelType: 'cocossd',
        confidence: 0.50,
        targetClass: 'person',
        maxDetections: 10,
    },
    game: {
        videoSelector: 'video[aria-label="Game Stream for unknown title"]',
        containerSelector: '#game-stream', // May not be strictly needed for window events
        aimInterval: 200, // Adjusted for potentially faster KBM response
        fovRadius: 150,
        // aimSpeed: 5, // Removed, KBM uses positionSmoothing primarily
        recoilCompensation: true,
        recoilLevel: 4,
        recoilPatterns: {
            1: { vertical: 0, horizontal: 0, recoverySpeed: 0.1 },
            2: { vertical: 0.2, horizontal: 0.05, recoverySpeed: 0.1 },
            3: { vertical: 0.4, horizontal: 0.1, recoverySpeed: 0.15 },
            4: { vertical: 0.6, horizontal: 0.2, recoverySpeed: 0.2 },
        },
        autoShoot: true,
        autoCrouchShoot: true, // If true, pressing crouchKey will also shoot
        autoReload: true,
        crouchKey: 'KeyQ', // Key that triggers auto-shoot; can also be bound to crouch in-game
        reloadKey: 'KeyR',
        inventoryKeys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'],
        // controller: { // Controller specific config removed
        //     enabled: true,
        //     xSensitivity: 0.5,
        //     ySensitivity: 0.5,
        //     deadzone: 0.15,
        // }
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
        positionSmoothing: true,
        historySize: 3,
        targetPriority: "closest", // "closest" or "center"
        aimPoint: "center", // "center" or "top"
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
    gameContainer: null, // For reference, though KBM events are on window
    mousePos: { x: window.innerWidth / 2, y: window.innerHeight / 2 }, // Tracks last aim coordinate
    isShooting: false,
    recoilOffset: { x: 0, y: 0 },
    kbm: {
        lastClientX: window.innerWidth / 2,
        lastClientY: window.innerHeight / 2,
        leftButtonDown: false,
        // State for locally pressed inventory keys (from original script)
        inventoryActive: [false,false,false,false,false,false,false],
    },

    _simulatePointerEvent(options) {
        const {
            type, // 'pointermove', 'pointerdown', 'pointerup'
            clientX,
            clientY,
            movementX = 0,
            movementY = 0,
            button = 0, // 0 for left, 1 for middle, 2 for right
            buttons = 0, // bitmask: 1 for left, 2 for right, 4 for middle
            delay = 0 // Minimal delay, often 0 is fine for KBM
        } = options;

        let eventType;
        let eventProps = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: Math.round(clientX),
            clientY: Math.round(clientY),
            pointerType: 'mouse', // CRITICAL for xCloud
        };

        if (type === 'pointermove') {
            eventType = 'pointermove';
            eventProps.movementX = Math.round(movementX);
            eventProps.movementY = Math.round(movementY);
            eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0; // Reflect current button state
        } else if (type === 'pointerdown') {
            eventType = 'pointerdown';
            eventProps.button = button;
            eventProps.buttons = buttons;
            if (button === 0) this.kbm.leftButtonDown = true;
        } else if (type === 'pointerup') {
            eventType = 'pointerup';
            eventProps.button = button;
            eventProps.buttons = buttons; // Should be 0 if releasing the only button
            if (button === 0) this.kbm.leftButtonDown = false;
        } else {
            debug.error("[InputSim] Invalid pointer event type:", type);
            return;
        }

        if (!eventType) return;

        setTimeout(() => { // Small timeout ensures event processing order if needed
            const event = new PointerEvent(eventType, eventProps);
            window.dispatchEvent(event);
            // debug.log(`[InputSim] Dispatched '${eventType}' to (${eventProps.clientX}, ${eventProps.clientY})`);
        }, delay);
    },

    init() {
        this.gameContainer = document.querySelector(config.game.containerSelector);
        // Initialize KBM position to center of screen
        this.kbm.lastClientX = window.innerWidth / 2;
        this.kbm.lastClientY = window.innerHeight / 2;
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };

        // Dispatch an initial move event to establish KBM presence with xCloud
        this._simulatePointerEvent({
            type: 'pointermove',
            clientX: this.kbm.lastClientX,
            clientY: this.kbm.lastClientY,
            movementX: 0,
            movementY: 0,
            delay: 100 // Give it a moment to register, as per original finding
        });
        debug.log('Input simulator (KBM) initialized. Initial pointermove sent.');
        this.listenKeyboard();
        return true;
    },

    listenKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.code === config.game.crouchKey && !this.isShooting) { // Use this.isShooting to prevent re-trigger
                // This key now primarily triggers shooting.
                // If config.game.autoCrouchShoot is true, user should bind 'Q' to crouch in-game.
                debug.log(`KBM: '${config.game.crouchKey}' (shoot trigger) pressed`);
                this.startShooting();
            }
            config.game.inventoryKeys.forEach((key, idx) => {
                if (e.code === key && !this.kbm.inventoryActive[idx]) {
                    this.kbm.inventoryActive[idx] = true;
                    debug.log(`KBM: User pressed Inventory Slot ${idx+1} ('${key}')`);
                    // If the AI needs to *force* an inventory switch, it would call simulateInventory.
                    // User pressing the key should be handled natively by the game.
                    // this.simulateInventory(idx); // Only if we want to re-dispatch the key press
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
        // For AI to programmatically select an inventory slot
        if (slotIdx >= 0 && slotIdx < config.game.inventoryKeys.length) {
            const keyToPress = config.game.inventoryKeys[slotIdx];
            debug.log(`KBM: AI simulating inventory key press: ${keyToPress} (Slot ${slotIdx+1})`);
            this.pressKey(keyToPress, 50);
        }
    },

    applyRecoil(targetX, targetY) {
        // Logic unchanged, works well with KBM target coordinates
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
        if (Math.abs(this.recoilOffset.x) < 0.1 && Math.abs(this.recoilOffset.y) < 0.1) { // Apply kick
            const kickMultiplier = 5; // This might need tuning for KBM
            this.recoilOffset.y = recoil.vertical * kickMultiplier;
            this.recoilOffset.x = (Math.random() - 0.5) * 2 * recoil.horizontal * kickMultiplier;
        }
        let newTargetX = targetX - this.recoilOffset.x;
        let newTargetY = targetY + this.recoilOffset.y; // Recoil typically kicks UP, so add to Y
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
            delay: 0 // Moves should be quick
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
            clientX: this.kbm.lastClientX, // Shoot at current/last aim point
            clientY: this.kbm.lastClientY,
            button: 0, // Left mouse button
            buttons: 1, // Left mouse button pressed bitmask
            delay: 0
        });
    },

    stopShooting() {
        if (!this.isShooting) return;
        this.isShooting = false;
        debug.log("Shooting STOP (KBM)");

        this._simulatePointerEvent({
            type: 'pointerup',
            clientX: this.kbm.lastClientX, // Release at current/last aim point
            clientY: this.kbm.lastClientY,
            button: 0, // Left mouse button
            buttons: 0, // No buttons pressed
            delay: 0
        });
    },

    pressKey(code, duration = 50) {
        // This function remains useful for simulating any discrete key press
        debug.log("[InputSim] Simulate KBM key press:", code, `duration: ${duration}ms`);
        const key = code.replace(/^(Key|Digit)/, ''); // Attempt to get the character value
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

function createOverlayCanvas() { /* ... Unchanged ... */
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
function drawOverlay(predictions = []) { /* ... Unchanged ... */
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
function createCrosshair() { /* ... Unchanged ... */
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
    debug.log('Crosshair created');
}

// Modified: autoCrouchShoot implies pressing crouchKey triggers shooting.
// User should bind crouchKey to crouch in-game if they want that effect too.
function setupAutoCrouchShoot() {
    if (!config.game.autoCrouchShoot) return;
    // The main logic for this is now in InputSimulator.listenKeyboard
    // which calls start/stopShooting when config.game.crouchKey is pressed/released.
    debug.log(`Auto-shoot enabled, triggered by key: ${config.game.crouchKey}`);
}

function setupAutoReload() {
    if (!config.game.autoReload) return;
    debug.log('Auto-reload keybind active for:', config.game.reloadKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.reloadKey && !e.repeat) {
            debug.log(`'${config.game.reloadKey}' (reload key) pressed by user.`);
            // The game should pick up the user's 'R' press.
            // If we want the script to *force* a reload action on top of user's press:
            // InputSimulator.pressKey(config.game.reloadKey, 75);
            // For now, assume user's key press is sufficient. If not, uncomment above.
        }
    });
}

function createGUI() {
    if (document.getElementById('xcloudcheat-gui')) return;
    const gui = document.createElement('div');
    gui.id = 'xcloudcheat-gui';
    // Styles largely unchanged
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
          <h2 style="margin:0;color:#6df;">Wesd Ai Aimbot <span style="font-size:15px;font-weight:400;opacity:.6;">v3.0 (KBM Fortnite)</span></h2>
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
        <!-- Aim Speed slider removed as KBM uses positionSmoothing primarily -->
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
        <!-- Controller specific settings removed -->
        <div style="margin-top: 11px; margin-bottom: 2px; color:#5df;">KBM Mappings (Fortnite)</div>
        <div style="font-size:14px;line-height:1.6;background:#171b2c;border-radius:8px;padding:8px 12px;margin-bottom:8px;">
          <b>Auto-Shoot Trigger:</b> <span style="color:#fff;background:#2e4;padding:1px 6px;border-radius:4px;">${config.game.crouchKey.replace('Key','')}</span> <br>
          <b>Reload:</b> <span style="color:#fff;background:#f73;padding:1px 6px;border-radius:4px;">${config.game.reloadKey.replace('Key','')}</span> <br>
          <b>Inventory Slots (Game Default):</b>
          <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;">1-7</span>
        </div>
        <div style="margin-top:10px;text-align:right;">
          <span style="font-size:12px;color:#bbb;">KBM INJECTION</span>
        </div>
    `;
    document.body.appendChild(gui);
    document.getElementById('xcloudcheat-close').onclick = () => gui.remove();

    // Event listeners for GUI elements
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

    debug.log("GUI Created (KBM Mode)");
}

async function findGameVideoAndInit() {
    gameVideo = document.querySelector(config.game.videoSelector);
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);
        try {
            if (!detectionModel) {
                debug.log("Loading Coco SSD model for Fortnite...");
                // Ensure tf and cocoSsd are available (either from @require or loader)
                if (typeof tf === 'undefined' || typeof cocoSsd === 'undefined') {
                    console.error("TensorFlow.js (tf) or CocoSSD (cocoSsd) not loaded. Ensure loader script ran successfully OR @require directives worked.");
                    alert("Critical libraries not found. Aimbot cannot start. Check console.");
                    return;
                }
                try { await tf.setBackend('webgl'); } catch { debug.warn("WebGL backend failed, using default."); }
                await tf.ready();
                // --- THIS IS THE KEY CHANGE TO MATCH THE LOADER'S INSTRUCTION FOR FORTNITE ---
                detectionModel = await cocoSsd.load({ base: 'mobilenet_v2' });
                // --- END OF KEY CHANGE ---
                debug.log("Coco SSD model (mobilenet_v2) loaded successfully using backend:", tf.getBackend());
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
            if (err.message.toLowerCase().includes('coco') || err.message.toLowerCase().includes('model')) {
                alert("Failed to load AI Model. Aimbot cannot function. Check console (F12) for errors. You may need to refresh.");
            }
            config.detection.enabled = false;
        }
    } else {
        const status = gameVideo ? `readyState=${gameVideo.readyState}, dims=${gameVideo.videoWidth}x${gameVideo.videoHeight}` : 'not found';
        debug.log(`Game video not ready (${status}), retrying...`);
        setTimeout(findGameVideoAndInit, 1500);
    }
}
function startAimLoop() { /* ... Unchanged (controller stick reset removed) ... */
    debug.log('Starting main aim loop (KBM)...');
    let lastFrameTime = 0;
    function loop(currentTime) {
        requestAnimationFrame(loop);
        const deltaTime = currentTime - lastFrameTime;
        if (deltaTime < config.game.aimInterval) return;
        lastFrameTime = currentTime;
        utils.fps.update();
        if (!config.detection.enabled || !detectionModel || !gameVideo || gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
            if (InputSimulator.isShooting) InputSimulator.stopShooting();
            // No controller stick reset needed
            drawOverlay([]);
            currentTarget = null;
            positionHistory = [];
            return;
        }
        aimLoop();
    }
    loop(performance.now());
}
async function aimLoop() { /* ... Unchanged (controller stick reset removed) ... */
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
        if (e.message.includes("tensor") || e.message.includes("disposed") || e.message.includes("WebGL") || e.message.includes("backend")) {
            debug.warn("TensorFlow/WebGL/Backend error during detection (may recover):", e.message);
        } else {
            debug.error('Aimbot loop error:', e);
        }
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        // No controller stick reset needed
        currentTarget = null;
        positionHistory = [];
        drawOverlay([]);
    }
}

function processPredictions(targets) { // Logic for target selection unchanged, output is KBM
    const videoRect = gameVideo.getBoundingClientRect();
    if (!targets.length || !videoRect || videoRect.width === 0) {
        if (currentTarget) debug.log("Target lost.");
        currentTarget = null;
        positionHistory = [];
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        // No controller stick reset
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
        if (config.aim.targetPriority === "center") { // Closest to actual screen center
            evalCenterX = screenCenterX;
            evalCenterY = screenCenterY;
        } else { // Closest to KBM virtual crosshair (last aimed position)
            evalCenterX = InputSimulator.mousePos.x; // Use the KBM's current aiming point
            evalCenterY = InputSimulator.mousePos.y;
        }

        const dx = targetCenterX_screen - evalCenterX;
        const dy = targetCenterY_screen - evalCenterY;
        const distance = Math.hypot(dx, dy);

        if (distance > config.game.fovRadius) return; // Target out of FOV

        let score = distance; // Default score is distance
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
        // No controller stick reset
        return;
    }

    if (!currentTarget || currentTarget.bbox[0] !== bestTarget.bbox[0]) { // Basic check if target changed
        debug.log(`New target acquired: ${bestTarget.class} (${(bestTarget.score*100).toFixed(1)}%), Dist: ${minScore.toFixed(0)}px`);
    }
    currentTarget = bestTarget;

    let aimScreenX, aimScreenY;
    const bboxX_screen = videoRect.left + (bestTarget.bbox[0] / gameVideo.videoWidth) * videoRect.width;
    const bboxY_screen = videoRect.top + (bestTarget.bbox[1] / gameVideo.videoHeight) * videoRect.height;
    const bboxW_screen = (bestTarget.bbox[2] / gameVideo.videoWidth) * videoRect.width;
    const bboxH_screen = (bestTarget.bbox[3] / gameVideo.videoHeight) * videoRect.height;

    if (config.aim.aimPoint === "top") { // Aim for the top part of the bounding box (headshot attempt)
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen * 0.15; // Adjust 0.15 as needed
    } else { // Aim for the center of the bounding box
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen / 2;
    }

    if (config.aim.positionSmoothing && config.aim.historySize > 0) {
        positionHistory.push({ x: aimScreenX, y: aimScreenY });
        if (positionHistory.length > config.aim.historySize) {
            positionHistory.shift();
        }
        let sumX = 0, sumY = 0;
        positionHistory.forEach(pos => { sumX += pos.x; sumY += pos.y; });
        aimScreenX = sumX / positionHistory.length;
        aimScreenY = sumY / positionHistory.length;
    } else {
        positionHistory = []; // Clear history if smoothing disabled
    }

    InputSimulator.moveMouseTo(aimScreenX, aimScreenY); // This now uses KBM

    if (config.game.autoShoot) {
        if (!InputSimulator.isShooting) {
            InputSimulator.startShooting(); // This now uses KBM
        }
    } else { // If auto-shoot is disabled, ensure we stop shooting if we were
        if (InputSimulator.isShooting) {
            InputSimulator.stopShooting(); // This now uses KBM
        }
    }
}


(function init() {
    console.log(`[XcloudCheat v3.0 KBM Aimbot] Initializing...`);
    // Delay initialization to ensure xCloud page is mostly loaded
    setTimeout(findGameVideoAndInit, 3000);
})();
