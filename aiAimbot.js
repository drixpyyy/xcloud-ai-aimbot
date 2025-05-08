// ==UserScript==
// @name         XcloudCheat v2.9.3 Fortnite KBM+Controller (Instant Aim Speed/Toggle)
// @description  Fortnite aimbot with Coco SSD, controller+KBM emu, instant aim speed, full GUI (toggle controller on/off & set aim interval!)
// @author       Wesd
// @version      2.9.3
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
        confidence: 0.45,
        targetClass: 'person',
        maxDetections: 10,
    },
    game: {
        videoSelector: 'video[aria-label="Game Stream for unknown title"]',
        containerSelector: '#game-stream',
        aimInterval: 350, // Default now 350ms for performance and works decent
        fovRadius: 250,
        aimSpeed: 5,
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
        controller: {
            enabled: true,
            xSensitivity: 0.5,
            ySensitivity: 0.5,
            deadzone: 0.15,
        }
    },
    crosshair: {
        enabled: true,
        size: 15,
        color: 'lime',
        style: 'cross'
    },
    fovCircle: {
        enabled: true,
        color: 'rgba(255, 0, 0, 0.3)',
        lineWidth: 1,
    },
    boundingBoxes: {
        enabled: true,
        color: 'yellow',
        lineWidth: 2,
    },
    aim: {
        positionSmoothing: true,
        historySize: 3,
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
    mousePos: { x: 0, y: 0 },
    isShooting: false,
    recoilOffset: { x: 0, y: 0 },
    controller: {
        leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0,
        buttons: {
            a: false, b: false, x: false, y: false, leftBumper: false, rightBumper: false,
            leftTrigger: 0, rightTrigger: 0,
            back: false, start: false, leftStickPress: false, rightStickPress: false,
            dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false
        }
    },
    kbm: {
        shooting: false,
        inventory: [false,false,false,false,false,false,false],
    },
    init() {
        this.gameContainer = document.querySelector(config.game.containerSelector);
        if (!this.gameContainer) {
            debug.error('Game container NOT found! Input simulation will likely fail.');
            return false;
        }
        const rect = this.gameContainer.getBoundingClientRect();
        this.mousePos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        debug.log('Input simulator initialized targeting:', config.game.containerSelector);
        this.listenKeyboard();
        return true;
    },
    listenKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (e.code === config.game.crouchKey && !this.kbm.shooting) {
                this.kbm.shooting = true;
                debug.log('KBM: Q (shoot) pressed');
                this.startShooting();
            }
            config.game.inventoryKeys.forEach((key, idx) => {
                if (e.code === key && !this.kbm.inventory[idx]) {
                    this.kbm.inventory[idx] = true;
                    debug.log(`KBM: Inventory Slot ${idx+1} down`);
                    this.simulateInventory(idx);
                }
            });
        });
        document.addEventListener('keyup', (e) => {
            if (e.code === config.game.crouchKey) {
                this.kbm.shooting = false;
                debug.log('KBM: Q (shoot) released');
                this.stopShooting();
            }
            config.game.inventoryKeys.forEach((key, idx) => {
                if (e.code === key) {
                    this.kbm.inventory[idx] = false;
                }
            });
        });
    },
    simulateInventory(slotIdx) {
        if (!config.game.controller.enabled) return;
        switch(slotIdx) {
            case 0: this.pressButton('dpadUp'); break;
            case 1: this.pressButton('dpadRight'); break;
            case 2: this.pressButton('dpadDown'); break;
            case 3: this.pressButton('dpadLeft'); break;
            case 4: this.pressButton('rightBumper'); break;
            case 5: this.pressButton('leftBumper'); break;
            case 6: this.pressButton('start'); break;
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
            debug.log(`Recoil kick: x=${this.recoilOffset.x.toFixed(2)}, y=${this.recoilOffset.y.toFixed(2)}`);
        }
        let newTargetX = targetX - this.recoilOffset.x;
        let newTargetY = targetY + this.recoilOffset.y;
        this.recoilOffset.x *= (1 - recoil.recoverySpeed);
        this.recoilOffset.y *= (1 - recoil.recoverySpeed);
        if (Math.abs(this.recoilOffset.x) < 0.01) this.recoilOffset.x = 0;
        if (Math.abs(this.recoilOffset.y) < 0.01) this.recoilOffset.y = 0;
        return { x: newTargetX, y: newTargetY };
    },
    sendControllerInput() {
        if (!config.game.controller.enabled || !this.gameContainer) return;
        try {
            const gamepad = {
                id: "Simulated Xbox Controller (XcloudCheat)",
                index: 0,
                connected: true,
                timestamp: performance.now(),
                mapping: 'standard',
                axes: [
                    this.controller.leftStickX,
                    this.controller.leftStickY,
                    this.controller.rightStickX,
                    this.controller.rightStickY
                ],
                buttons: [
                    { pressed: this.controller.buttons.a, touched: this.controller.buttons.a, value: this.controller.buttons.a ? 1 : 0 },
                    { pressed: this.controller.buttons.b, touched: this.controller.buttons.b, value: this.controller.buttons.b ? 1 : 0 },
                    { pressed: this.controller.buttons.x, touched: this.controller.buttons.x, value: this.controller.buttons.x ? 1 : 0 },
                    { pressed: this.controller.buttons.y, touched: this.controller.buttons.y, value: this.controller.buttons.y ? 1 : 0 },
                    { pressed: this.controller.buttons.leftBumper, touched: this.controller.buttons.leftBumper, value: this.controller.buttons.leftBumper ? 1 : 0 },
                    { pressed: this.controller.buttons.rightBumper, touched: this.controller.buttons.rightBumper, value: this.controller.buttons.rightBumper ? 1 : 0 },
                    { pressed: this.controller.buttons.leftTrigger > 0, touched: this.controller.buttons.leftTrigger > 0, value: this.controller.buttons.leftTrigger },
                    { pressed: this.controller.buttons.rightTrigger > 0, touched: this.controller.buttons.rightTrigger > 0, value: this.controller.buttons.rightTrigger },
                    { pressed: this.controller.buttons.back, touched: this.controller.buttons.back, value: this.controller.buttons.back ? 1 : 0 },
                    { pressed: this.controller.buttons.start, touched: this.controller.buttons.start, value: this.controller.buttons.start ? 1 : 0 },
                    { pressed: this.controller.buttons.leftStickPress, touched: this.controller.buttons.leftStickPress, value: this.controller.buttons.leftStickPress ? 1 : 0 },
                    { pressed: this.controller.buttons.rightStickPress, touched: this.controller.buttons.rightStickPress, value: this.controller.buttons.rightStickPress ? 1 : 0 },
                    { pressed: this.controller.buttons.dpadUp, touched: this.controller.buttons.dpadUp, value: this.controller.buttons.dpadUp ? 1 : 0 },
                    { pressed: this.controller.buttons.dpadDown, touched: this.controller.buttons.dpadDown, value: this.controller.buttons.dpadDown ? 1 : 0 },
                    { pressed: this.controller.buttons.dpadLeft, touched: this.controller.buttons.dpadLeft, value: this.controller.buttons.dpadLeft ? 1 : 0 },
                    { pressed: this.controller.buttons.dpadRight, touched: this.controller.buttons.dpadRight, value: this.controller.buttons.dpadRight ? 1 : 0 }
                ]
            };
            navigator.getGamepads = () => [gamepad, null, null, null];
        } catch (e) {
            debug.error('Error sending controller input:', e);
        }
    },
    moveMouseTo(targetScreenX, targetScreenY) {
        if (!this.gameContainer) return;
        const compensatedTarget = this.applyRecoil(targetScreenX, targetScreenY);
        targetScreenX = compensatedTarget.x;
        targetScreenY = compensatedTarget.y;

        if (config.game.controller.enabled) {
            const rect = this.gameContainer.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const dx = targetScreenX - centerX;
            const dy = targetScreenY - centerY;
            let rawStickX = (dx / (rect.width / 2)) * config.game.controller.xSensitivity;
            let rawStickY = (dy / (rect.height / 2)) * config.game.controller.ySensitivity;
            rawStickX = Math.max(-1, Math.min(1, rawStickX));
            rawStickY = Math.max(-1, Math.min(1, rawStickY));
            let finalStickX = (Math.abs(rawStickX) < config.game.controller.deadzone) ? 0 : rawStickX;
            let finalStickY = (Math.abs(rawStickY) < config.game.controller.deadzone) ? 0 : rawStickY;

            if (config.game.aimSpeed >= 1) {
                this.controller.rightStickX = finalStickX;
                this.controller.rightStickY = finalStickY;
            } else {
                this.controller.rightStickX += (finalStickX - this.controller.rightStickX) * config.game.aimSpeed;
                this.controller.rightStickY += (finalStickY - this.controller.rightStickY) * config.game.aimSpeed;
                if (Math.abs(this.controller.rightStickX) < config.game.controller.deadzone) this.controller.rightStickX = 0;
                if (Math.abs(this.controller.rightStickY) < config.game.controller.deadzone) this.controller.rightStickY = 0;
            }
            this.sendControllerInput();
        } else {
            this.fallbackMoveMouse(targetScreenX, targetScreenY);
        }
    },
    fallbackMoveMouse(targetX, targetY) {
        const event = new MouseEvent('mousemove', {
            bubbles: true, clientX: targetX, clientY: targetY
        });
        if (this.gameContainer) { this.gameContainer.dispatchEvent(event); }
        this.mousePos = { x: targetX, y: targetY };
    },
    startShooting() {
        if (this.isShooting) return;
        this.isShooting = true;
        debug.log("Shooting START (ctrl+kbm)");
        if (config.game.controller.enabled) this.controller.buttons.rightTrigger = 1.0;
        this.sendControllerInput();
        this.pressKey('KeyQ', 25);
    },
    stopShooting() {
        if (!this.isShooting) return;
        this.isShooting = false;
        debug.log("Shooting STOP (ctrl+kbm)");
        if (config.game.controller.enabled) this.controller.buttons.rightTrigger = 0.0;
        this.sendControllerInput();
    },
    pressButton(buttonName, duration = 50) {
        if (!config.game.controller.enabled || !this.controller.buttons.hasOwnProperty(buttonName)) return;
        debug.log(`Pressing button: ${buttonName}`);
        this.controller.buttons[buttonName] = true;
        if (buttonName === 'leftTrigger' || buttonName === 'rightTrigger') {
            this.controller.buttons[buttonName] = 1.0;
        }
        this.sendControllerInput();
        setTimeout(() => {
            debug.log(`Releasing button: ${buttonName}`);
            this.controller.buttons[buttonName] = false;
            if (buttonName === 'leftTrigger' || buttonName === 'rightTrigger') {
                this.controller.buttons[buttonName] = 0.0;
            }
            this.sendControllerInput();
        }, duration);
    },
    pressKey(code, duration = 50) {
        debug.log("Simulate key press:", code);
        const downEvt = new KeyboardEvent('keydown', { code, key: code.replace(/^Key|Digit/, ''), bubbles: true });
        const upEvt = new KeyboardEvent('keyup', { code, key: code.replace(/^Key|Digit/, ''), bubbles: true });
        document.dispatchEvent(downEvt);
        setTimeout(() => document.dispatchEvent(upEvt), duration);
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
    debug.log('Crosshair created');
}

function setupAutoCrouch() {
    if (!config.game.autoCrouchShoot) return;
    debug.log('Auto-crouch+shoot keybind active for:', config.game.crouchKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.crouchKey && !e.repeat) {
            debug.log('Crouch key pressed, attempting shoot');
            InputSimulator.startShooting();
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === config.game.crouchKey) {
            InputSimulator.stopShooting();
        }
    });
}

function setupAutoReload() {
    if (!config.game.autoReload) return;
    debug.log('Auto-reload keybind active for:', config.game.reloadKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.reloadKey && !e.repeat) {
            debug.log('Reload key pressed, simulating X button press');
            InputSimulator.pressButton('x', 75);
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
          <h2 style="margin:0;color:#6df;">Wesd Ai Aimbot <span style="font-size:15px;font-weight:400;opacity:.6;">v2.9.3 (Fortnite)</span></h2>
          <button id="xcloudcheat-close" style="background:none;border:none;color:#faa;font-size:22px;font-weight:bold;cursor:pointer;padding:0 8px;">&times;</button>
        </div>
        <div style="margin:14px 0 10px 0;">
            <span style="color:#68f;font-size:15px;">Status:</span>
            <span id="xcloudcheat-status" style="color:#5f5;font-weight:600;">Active</span>
            <span style="float:right;color:#aaa;font-size:13px;font-style:italic;">Fortnite KBM+Controller</span>
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
          <input type="range" id="aim-interval" min="50" max="1000" step="10" style="width:65%;" value="${config.game.aimInterval}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Aim Speed: <span id="speed-val">${config.game.aimSpeed.toFixed(2)}</span></label>
          <input type="range" id="aim-speed" min="0.05" max="5" step="0.01" style="width:65%;" value="${config.game.aimSpeed}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>FOV Radius: <span id="fov-val">${config.game.fovRadius}</span>px</label>
          <input type="range" id="fov-radius" min="50" max="600" step="10" style="width:65%;" value="${config.game.fovRadius}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Priority:
            <select id="target-priority">
              <option value="closest" ${config.aim.targetPriority === "closest" ? 'selected' : ''}>Closest</option>
              <option value="center" ${config.aim.targetPriority === "center" ? 'selected' : ''}>Center</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Aim Point:
            <select id="aim-point">
              <option value="center" ${config.aim.aimPoint === "center" ? 'selected' : ''}>Box Center</option>
              <option value="top" ${config.aim.aimPoint === "top" ? 'selected' : ''}>Box Top</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label>Recoil Level:
            <select id="recoil-level">
              <option value="1" ${config.game.recoilLevel === 1 ? 'selected' : ''}>1 (None)</option>
              <option value="2" ${config.game.recoilLevel === 2 ? 'selected' : ''}>2 (Barely)</option>
              <option value="3" ${config.game.recoilLevel === 3 ? 'selected' : ''}>3 (Slight)</option>
              <option value="4" ${config.game.recoilLevel === 4 ? 'selected' : ''}>4 (A Lot)</option>
            </select>
          </label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label><input type="checkbox" id="draw-boxes" ${config.boundingBoxes.enabled ? 'checked' : ''}> Bounding Boxes</label>
          <label style="margin-left:18px;"><input type="checkbox" id="draw-fov" ${config.fovCircle.enabled ? 'checked' : ''}> FOV Circle</label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 8px;">
          <label><input type="checkbox" id="controller-enabled" ${config.game.controller.enabled ? 'checked' : ''}> <b>Enable Controller</b></label>
          <label style="margin-left:18px;">X Sens: <span id="x-sens-val">${config.game.controller.xSensitivity.toFixed(2)}</span></label>
          <input type="range" id="x-sensitivity" min="0.1" max="2" step="0.01" style="width:25%;" value="${config.game.controller.xSensitivity}">
          <label style="margin-left:18px;">Y Sens: <span id="y-sens-val">${config.game.controller.ySensitivity.toFixed(2)}</span></label>
          <input type="range" id="y-sensitivity" min="0.1" max="2" step="0.01" style="width:25%;" value="${config.game.controller.ySensitivity}">
          <label style="margin-left:18px;">Deadzone: <span id="deadzone-val">${config.game.controller.deadzone.toFixed(2)}</span></label>
          <input type="range" id="deadzone" min="0.01" max="0.5" step="0.01" style="width:25%;" value="${config.game.controller.deadzone}">
        </div>
        <div style="margin-top: 11px; margin-bottom: 2px; color:#5df;">Controller/KBM Mapping (Fortnite)</div>
        <div style="font-size:14px;line-height:1.6;background:#171b2c;border-radius:8px;padding:8px 12px;margin-bottom:8px;">
          <b>Shoot:</b> <span style="color:#fff;background:#2e4;padding:1px 6px;border-radius:4px;">Q</span> <br>
          <b>Inventory Slots:</b>
          <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;">1-4</span> (DPad Up/Right/Down/Left),
          <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;">5/6</span> (RB/LB),
          <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;">7</span> (Start)
        </div>
        <div style="margin-top:10px;text-align:right;">
          <span style="font-size:12px;color:#bbb;">UD INJECTION</span>
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
    document.getElementById('aim-speed').oninput = (e) => {
        config.game.aimSpeed = parseFloat(e.target.value);
        document.getElementById('speed-val').textContent = config.game.aimSpeed.toFixed(2);
    };
    document.getElementById('fov-radius').oninput = (e) => {
        config.game.fovRadius = parseInt(e.target.value, 10);
        document.getElementById('fov-val').textContent = config.game.fovRadius;
    };
    document.getElementById('target-priority').onchange = (e) => config.aim.targetPriority = e.target.value;
    document.getElementById('aim-point').onchange = (e) => config.aim.aimPoint = e.target.value;
    document.getElementById('recoil-level').onchange = (e) => config.game.recoilLevel = parseInt(e.target.value, 10);
    document.getElementById('controller-enabled').onchange = (e) => config.game.controller.enabled = e.target.checked;
    document.getElementById('x-sensitivity').oninput = (e) => {
        config.game.controller.xSensitivity = parseFloat(e.target.value);
        document.getElementById('x-sens-val').textContent = config.game.controller.xSensitivity.toFixed(2);
    };
    document.getElementById('y-sensitivity').oninput = (e) => {
        config.game.controller.ySensitivity = parseFloat(e.target.value);
        document.getElementById('y-sens-val').textContent = config.game.controller.ySensitivity.toFixed(2);
    };
    document.getElementById('deadzone').oninput = (e) => {
        config.game.controller.deadzone = parseFloat(e.target.value);
        document.getElementById('deadzone-val').textContent = config.game.controller.deadzone.toFixed(2);
    };
    debug.log("GUI Created (now with aim interval slider!)");
}

async function findGameVideoAndInit() {
    gameVideo = document.querySelector(config.game.videoSelector);
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);
        try {
            if (!detectionModel) {
                debug.log("Loading Coco SSD model...");
                try { await tf.setBackend('webgl'); } catch { debug.warn("WebGL backend failed, using default."); }
                await tf.ready();
                detectionModel = await cocoSsd.load();
                debug.log("Coco SSD model loaded successfully using backend:", tf.getBackend());
            } else {
                debug.log("Coco SSD model already loaded.");
            }
            if (InputSimulator.init()) {
                createOverlayCanvas();
                createCrosshair();
                createGUI();
                setupAutoCrouch();
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

function startAimLoop() {
    debug.log('Starting main aim loop...');
    let lastFrameTime = 0;
    function loop(currentTime) {
        requestAnimationFrame(loop);
        const deltaTime = currentTime - lastFrameTime;
        if (deltaTime < config.game.aimInterval) return;
        lastFrameTime = currentTime;
        utils.fps.update();
        if (!config.detection.enabled || !detectionModel || !gameVideo || gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
            if (InputSimulator.isShooting) InputSimulator.stopShooting();
            if (config.game.controller.enabled) {
                InputSimulator.controller.rightStickX = 0;
                InputSimulator.controller.rightStickY = 0;
                InputSimulator.sendControllerInput();
            }
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
        if (e.message.includes("tensor") || e.message.includes("disposed") || e.message.includes("WebGL") || e.message.includes("backend")) {
            debug.warn("TensorFlow/WebGL/Backend error during detection (may recover):", e.message);
        } else {
            debug.error('Aimbot loop error:', e);
        }
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
        if(config.game.controller.enabled) {
            InputSimulator.controller.rightStickX = 0;
            InputSimulator.controller.rightStickY = 0;
            InputSimulator.sendControllerInput();
        }
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
        if(config.game.controller.enabled) {
            InputSimulator.controller.rightStickX = 0;
            InputSimulator.controller.rightStickY = 0;
            InputSimulator.sendControllerInput();
        }
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
        const dx = targetCenterX_screen - screenCenterX;
        const dy = targetCenterY_screen - screenCenterY;
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
        if(config.game.controller.enabled) {
            InputSimulator.controller.rightStickX = 0;
            InputSimulator.controller.rightStickY = 0;
            InputSimulator.sendControllerInput();
        }
        return;
    }
    if (!currentTarget || currentTarget.bbox[0] !== bestTarget.bbox[0]) {
        debug.log(`New target acquired: ${bestTarget.class} (${(bestTarget.score*100).toFixed(1)}%), Dist: ${minScore.toFixed(0)}px`);
    }
    currentTarget = bestTarget;
    let aimScreenX, aimScreenY;
    const bboxX_screen = videoRect.left + (bestTarget.bbox[0] / gameVideo.videoWidth) * videoRect.width;
    const bboxY_screen = videoRect.top + (bestTarget.bbox[1] / gameVideo.videoHeight) * videoRect.height;
    const bboxW_screen = (bestTarget.bbox[2] / gameVideo.videoWidth) * videoRect.width;
    const bboxH_screen = (bestTarget.bbox[3] / gameVideo.videoHeight) * videoRect.height;
    if (config.aim.aimPoint === "top") {
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen * 0.15;
    } else {
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
        positionHistory = [];
    }
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
    console.log(`[XcloudCheat v2.9.3 Fortnite KBM+Controller] Initializing...`);
    setTimeout(findGameVideoAndInit, 2000);
})();
