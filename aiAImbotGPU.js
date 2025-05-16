// ==XcloudCheat Main Script v3.1.3 (GPU, Hard Flick, Perf. Considerations)==
// Requires TensorFlow.js and Coco-SSD to be manually loaded BEFORE execution.
// Focuses on hard, flicky aiming.
// Performance on integrated GPUs is challenging. `aimInterval` and `confidence` are key.

const config = {
    version: '3.1.3',
    detection: {
        enabled: true,
        modelType: 'cocossd',
        modelBase: 'mobilenet_v2', 
        confidence: 0.35, // KEY PERF: Higher = fewer detections to process = faster JS, but might miss targets.
        targetClass: 'person',
        maxDetections: 3, // Slightly reduced. Minimal impact, but fewer boxes if many people.
    },
    game: {
        videoSelector: 'video[aria-label="Game Stream for unknown title"]',
        containerSelector: '#game-stream',
        aimInterval: 30,   // KEY PERF: Target interval. Actual interval depends on processing time. Higher = less lag if system can't keep up.
        fovRadius: 150,
        recoilCompensation: true,
        recoilLevel: 4,
        recoilPatterns: {
            1: { vertical: 0, horizontal: 0, recoverySpeed: 0.5 },
            2: { vertical: 0.2, horizontal: 0.05, recoverySpeed: 0.2 },
            3: { vertical: 0.4, horizontal: 0.1, recoverySpeed: 0.15 },
            4: { vertical: 0.6, horizontal: 0.2, recoverySpeed: 0.1 },
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
        color: 'rgba(255, 255, 255, 0.4)',
        lineWidth: 1,
    },
    boundingBoxes: {
        enabled: true,
        color: 'cyan',
        lineWidth: 1,
    },
    aim: {
        targetPriority: "closest", 
        aimPoint: "center", 
    },
    debug: {
        enabled: true,
        showFPS: true,
        logThrottleMs: 100,
        logMovement: true, // Set to false to reduce console spam slightly
    }
};

// --- Globals ---
let gameVideo = null;
let detectionModel = null;
let currentTarget = null;
let overlayCanvas = null;
let overlayCtx = null;
let bestTarget = null;
let lastPredictions = [];
let processingFrame = false; // Prevents overlapping detection calls
let lastDetectionTimestamp = 0; // For monitoring actual detection frequency

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
    logMovement: config.debug.logMovement,
    lastLogTime: 0,
    throttleMs: config.debug.logThrottleMs,
    log(...args) {
        if (this.enabled) {
            const now = Date.now();
            const isErrorOrWarn = typeof args[0] === 'string' && (args[0].includes("ERROR:") || args[0].includes("WARN:"));
            if (isErrorOrWarn || now - this.lastLogTime >= this.throttleMs) {
                let logString = `[XcloudCheat]`;
                if (this.showFPS) { 
                    const actualInterval = lastDetectionTimestamp ? (now - lastDetectionTimestamp) : 0;
                    logString += ` FPS: ${utils.fps.get()} | LastDet: ${actualInterval}ms |`; 
                }
                console.log(logString, ...args);
                if (!isErrorOrWarn) this.lastLogTime = now;
            }
        }
    },
    logMove(...args) { /* ... (unchanged) ... */ 
         if (this.enabled && this.logMovement) {
             let logString = `[XcloudCheat] MOVE |`;
             if (this.showFPS) { logString += ` FPS: ${utils.fps.get()} |`; }
             console.log(logString, ...args);
         }
    },
    error(...args) { if (this.enabled) { console.error(`[XcloudCheat] ERROR:`, ...args); } },
    warn(...args) { if (this.enabled) { console.warn(`[XcloudCheat] WARN:`, ...args); } }
};

const InputSimulator = { /* ... (unchanged from v3.1.2) ... */ 
    gameContainer: null,
    mousePos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    kbm: {
        lastClientX: window.innerWidth / 2,
        lastClientY: window.innerHeight / 2,
        leftButtonDown: false,
        inventoryActive: [false,false,false,false,false,false,false],
    },
    isShooting: false,
    recoilOffset: { x: 0, y: 0 },

    _simulatePointerEvent(options) {
        const { type, clientX, clientY, movementX = 0, movementY = 0, button = 0, buttons = 0, delay = 0 } = options;
        let eventType;
        let eventProps = {
            bubbles: true, cancelable: true, view: window,
            clientX: Math.round(clientX), clientY: Math.round(clientY),
            movementX: Math.round(movementX), movementY: Math.round(movementY),
            pointerType: 'mouse', button: button, buttons: buttons,
        };

        if (type === 'pointermove') {
            eventType = 'pointermove';
            eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0;
        } else if (type === 'pointerdown') {
            eventType = 'pointerdown';
            if (button === 0) this.kbm.leftButtonDown = true;
            eventProps.buttons = 1; 
        } else if (type === 'pointerup') {
            eventType = 'pointerup';
            if (button === 0) this.kbm.leftButtonDown = false;
            eventProps.buttons = 0; 
        } else {
            debug.error("Invalid pointer event type:", type); return;
        }
        if (!eventType) return;
        setTimeout(() => {
            const event = new PointerEvent(eventType, eventProps);
            window.dispatchEvent(event); // Dispatch to window
        }, delay);
    },

    init() {
        this.gameContainer = document.querySelector(config.game.containerSelector);
        this.kbm.lastClientX = window.innerWidth / 2;
        this.kbm.lastClientY = window.innerHeight / 2;
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };
        this._simulatePointerEvent({
            type: 'pointermove', clientX: this.kbm.lastClientX, clientY: this.kbm.lastClientY,
            movementX: 0, movementY: 0, delay: 100
        });
        debug.log('Input simulator (KBM) initialized.');
        this.listenKeyboard();
        return true;
    },

    listenKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (config.detection.enabled || config.game.autoReload) {
                 if (e.code === config.game.crouchKey || e.code === config.game.reloadKey) e.preventDefault();
            }
            if (config.game.inventoryKeys.includes(e.code)) {
                 const idx = config.game.inventoryKeys.indexOf(e.code);
                 if (idx !== -1 && !this.kbm.inventoryActive[idx]) this.kbm.inventoryActive[idx] = true;
                 return;
            }
            if (config.game.autoShoot && e.code === config.game.crouchKey) {
                const isHoldingInventory = this.kbm.inventoryActive.some(held => held);
                if (!isHoldingInventory && !this.isShooting) { 
                    debug.log(`KBM: '${config.game.crouchKey}' (auto-shoot) pressed`);
                    this.startShooting();
                }
            }
            if (config.game.autoReload && e.code === config.game.reloadKey && !e.repeat) {
                  debug.log(`KBM: User pressed '${config.game.reloadKey}' (reload).`);
            }
        }, true);
        document.addEventListener('keyup', (e) => {
             if (config.game.inventoryKeys.includes(e.code)) {
                 const idx = config.game.inventoryKeys.indexOf(e.code);
                 if (idx !== -1) this.kbm.inventoryActive[idx] = false;
                 return;
             }
            if (config.game.autoShoot && e.code === config.game.crouchKey) {
                if (this.isShooting) { 
                    debug.log(`KBM: '${config.game.crouchKey}' (auto-shoot) released`);
                    this.stopShooting();
                }
            }
        }, true);
    },

    moveMouseTo(targetScreenX, targetScreenY) {
        let deltaX_to_visual_target = targetScreenX - this.kbm.lastClientX;
        let deltaY_to_visual_target = targetScreenY - this.kbm.lastClientY;
        
        let movementX_for_event = deltaX_to_visual_target;
        let movementY_for_event = deltaY_to_visual_target;

        if (config.game.recoilCompensation && config.game.recoilPatterns[config.game.recoilLevel]) {
            const recoilPattern = config.game.recoilPatterns[config.game.recoilLevel];
            const recoilMultiplier = 5; 
            if (this.isShooting) {
                const kickY_thisFrame = recoilPattern.vertical * recoilMultiplier;
                const kickX_thisFrame = (Math.random() - 0.5) * 2 * (recoilPattern.horizontal * recoilMultiplier);
                this.recoilOffset.x += kickX_thisFrame;
                this.recoilOffset.y += kickY_thisFrame;
                const recovery = recoilPattern.recoverySpeed;
                this.recoilOffset.x *= (1 - recovery);
                this.recoilOffset.y *= (1 - recovery);
            } else {
                const recovery = recoilPattern.recoverySpeed * 3;
                this.recoilOffset.x *= (1 - recovery);
                this.recoilOffset.y *= (1 - recovery);
            }
            if (Math.abs(this.recoilOffset.x) < 0.05) this.recoilOffset.x = 0;
            if (Math.abs(this.recoilOffset.y) < 0.05) this.recoilOffset.y = 0;
            
            movementX_for_event = deltaX_to_visual_target - this.recoilOffset.x;
            movementY_for_event = deltaY_to_visual_target + this.recoilOffset.y;
        }

        const sendThreshold = 0.1; 
        if (Math.abs(movementX_for_event) > sendThreshold || Math.abs(movementY_for_event) > sendThreshold) {
            const newClientX = this.kbm.lastClientX + movementX_for_event;
            const newClientY = this.kbm.lastClientY + movementY_for_event;
            debug.logMove(`Aim | Target(${targetScreenX.toFixed(1)},${targetScreenY.toFixed(1)}) | Flick(${movementX_for_event.toFixed(1)},${movementY_for_event.toFixed(1)})`);
            this._simulatePointerEvent({
                type: 'pointermove',
                clientX: newClientX, clientY: newClientY,
                movementX: movementX_for_event, movementY: movementY_for_event,
                button: this.kbm.leftButtonDown ? 0 : -1,
                buttons: this.kbm.leftButtonDown ? 1 : 0,
                delay: 0 
            });
            this.kbm.lastClientX = newClientX; 
            this.kbm.lastClientY = newClientY;
        } else {
            this.kbm.lastClientX = targetScreenX - this.recoilOffset.x; 
            this.kbm.lastClientY = targetScreenY + this.recoilOffset.y;
        }
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };
    },

    startShooting() {
        if (!config.game.autoShoot || this.isShooting) return;
        this.isShooting = true;
        debug.log("Shooting START");
        this.recoilOffset = { x: 0, y: 0 }; 
        this._simulatePointerEvent({
            type: 'pointerdown', clientX: this.kbm.lastClientX, clientY: this.kbm.lastClientY,
            button: 0, buttons: 1, delay: 0
        });
    },

    stopShooting() {
        if (!this.isShooting) return;
        this.isShooting = false;
        debug.log("Shooting STOP");
        this._simulatePointerEvent({
            type: 'pointerup', clientX: this.kbm.lastClientX, clientY: this.kbm.lastClientY,
            button: 0, buttons: 0, delay: 0
        });
    },
}


// --- Overlay and Drawing ---
function createOverlayCanvas() { /* ... (unchanged from v3.1.2) ... */ 
    if (overlayCanvas) return;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'xcloud-cheat-overlay';
    const vvp = window.visualViewport;
    overlayCanvas.width = vvp ? vvp.width : window.innerWidth;
    overlayCanvas.height = vvp ? vvp.height : window.innerHeight;
    overlayCanvas.style.cssText = `position: fixed; top: ${vvp ? vvp.offsetTop : 0}px; left: ${vvp ? vvp.offsetLeft : 0}px; width: ${vvp ? vvp.width : window.innerWidth}px; height: ${vvp ? vvp.height : window.innerHeight}px; pointer-events: none; z-index: 99998;`;
    overlayCtx = overlayCanvas.getContext('2d');
    document.body.appendChild(overlayCanvas);

    const updateCanvasSizeAndPosition = () => {
        const currentVvp = window.visualViewport;
        if (currentVvp) {
             overlayCanvas.width = currentVvp.width; overlayCanvas.height = currentVvp.height;
             overlayCanvas.style.width = currentVvp.width + 'px'; overlayCanvas.style.height = currentVvp.height + 'px';
             overlayCanvas.style.top = currentVvp.offsetTop + 'px'; overlayCanvas.style.left = currentVvp.offsetLeft + 'px';
        } else {
             overlayCanvas.width = window.innerWidth; overlayCanvas.height = window.innerHeight;
             overlayCanvas.style.width = window.innerWidth + 'px'; overlayCanvas.style.height = window.innerHeight + 'px';
             overlayCanvas.style.top = '0px'; overlayCanvas.style.left = '0px';
        }
        drawOverlay(lastPredictions || []);
    };
    if (vvp) { vvp.addEventListener('resize', updateCanvasSizeAndPosition); vvp.addEventListener('scroll', updateCanvasSizeAndPosition); }
    else { window.addEventListener('resize', updateCanvasSizeAndPosition); }
    debug.log('Overlay canvas created');
}

function drawOverlay(predictions = []) { /* ... (unchanged from v3.1.2) ... */ 
    if (!overlayCtx || !gameVideo) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const videoRect = gameVideo.getBoundingClientRect();
    if (!videoRect || videoRect.width === 0 || videoRect.height === 0) return;

    const videoAspectRatio = gameVideo.videoWidth / gameVideo.videoHeight;
    const displayAspectRatio = videoRect.width / videoRect.height;
    let videoDisplayWidth = videoRect.width, videoDisplayHeight = videoRect.height;
    let videoDisplayLeft = videoRect.left, videoDisplayTop = videoRect.top;
    if (videoAspectRatio > displayAspectRatio) {
        videoDisplayHeight = videoRect.width / videoAspectRatio;
        videoDisplayTop = videoRect.top + (videoRect.height - videoDisplayHeight) / 2;
    } else {
        videoDisplayWidth = videoRect.height * videoAspectRatio;
        videoDisplayLeft = videoRect.left + (videoRect.width - videoDisplayWidth) / 2;
    }

    if (config.fovCircle.enabled) {
        overlayCtx.strokeStyle = config.fovCircle.color; overlayCtx.lineWidth = config.fovCircle.lineWidth;
        overlayCtx.beginPath();
        overlayCtx.arc(overlayCanvas.width / 2, overlayCanvas.height / 2, config.game.fovRadius, 0, Math.PI * 2);
        overlayCtx.stroke();
    }

    if (config.boundingBoxes.enabled && predictions.length > 0) {
        overlayCtx.strokeStyle = config.boundingBoxes.color; overlayCtx.lineWidth = config.boundingBoxes.lineWidth;
        overlayCtx.fillStyle = config.boundingBoxes.color; overlayCtx.font = '12px sans-serif';
        overlayCtx.textBaseline = 'bottom';
        predictions.forEach(p => {
            if (p.class === config.detection.targetClass) { // Only draw boxes for the target class
                const drawX = videoDisplayLeft + (p.bbox[0] / gameVideo.videoWidth) * videoDisplayWidth;
                const drawY = videoDisplayTop + (p.bbox[1] / gameVideo.videoHeight) * videoDisplayHeight;
                const drawWidth = (p.bbox[2] / gameVideo.videoWidth) * videoDisplayWidth;
                const drawHeight = (p.bbox[3] / gameVideo.videoHeight) * videoDisplayHeight;
                overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight);
                
                const scoreText = `${p.class} (${Math.round(p.score * 100)}%)`;
                const clampedTextY = Math.max(drawY - 2, 14); // Ensure text is visible
                overlayCtx.fillText(scoreText, drawX, clampedTextY);

                if (bestTarget && p === bestTarget) { // Highlight current best target
                    overlayCtx.strokeStyle = 'red'; // Different color for the locked target's box
                    overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight); // Redraw box
                    overlayCtx.strokeStyle = config.boundingBoxes.color; // Reset for others

                    const aimX_video = bestTarget.bbox[0] + bestTarget.bbox[2] / 2;
                    let aimY_video = (config.aim.aimPoint === "top") ?
                        bestTarget.bbox[1] + bestTarget.bbox[3] * 0.15 :
                        bestTarget.bbox[1] + bestTarget.bbox[3] / 2;
                    const aimScreenX = videoDisplayLeft + (aimX_video / gameVideo.videoWidth) * videoDisplayWidth;
                    const aimScreenY = videoDisplayTop + (aimY_video / gameVideo.videoHeight) * videoDisplayHeight;
                    
                    overlayCtx.beginPath(); 
                    overlayCtx.moveTo(InputSimulator.mousePos.x, InputSimulator.mousePos.y);
                    overlayCtx.lineTo(aimScreenX, aimScreenY); 
                    overlayCtx.strokeStyle = 'red'; 
                    overlayCtx.lineWidth = 2;
                    overlayCtx.stroke();
                    
                    overlayCtx.fillStyle = 'red'; 
                    overlayCtx.beginPath();
                    overlayCtx.arc(aimScreenX, aimScreenY, 4, 0, Math.PI * 2); 
                    overlayCtx.fill();
                }
            }
        });
    }
 }

function createCrosshair() { /* ... (unchanged from v3.1.2) ... */ 
    if (!config.crosshair.enabled || document.getElementById('xcloud-crosshair')) return;
    const c = document.createElement('canvas'); c.id = 'xcloud-crosshair';
    const vvp = window.visualViewport;
    c.width = vvp ? vvp.width : window.innerWidth; c.height = vvp ? vvp.height : window.innerHeight;
    c.style.cssText = `position: fixed; top: ${vvp ? vvp.offsetTop : 0}px; left: ${vvp ? vvp.offsetLeft : 0}px; width: ${vvp ? vvp.width : window.innerWidth}px; height: ${vvp ? vvp.height : window.innerHeight}px; pointer-events: none; z-index: 100000;`;
    const ctx = c.getContext('2d'); document.body.appendChild(c);
    function draw() {
        ctx.clearRect(0, 0, c.width, c.height); ctx.strokeStyle = config.crosshair.color;
        ctx.fillStyle = config.crosshair.color; ctx.lineWidth = 2;
        const centerX = c.width / 2, centerY = c.height / 2, size = config.crosshair.size;
        switch (config.crosshair.style) {
            case 'circle': ctx.beginPath(); ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2); ctx.stroke(); break;
            case 'dot': ctx.beginPath(); ctx.arc(centerX, centerY, size / 4, 0, Math.PI * 2); ctx.fill(); break;
            default: ctx.beginPath(); ctx.moveTo(centerX - size / 2, centerY); ctx.lineTo(centerX + size / 2, centerY);
                     ctx.moveTo(centerX, centerY - size / 2); ctx.lineTo(centerX, centerY + size / 2); ctx.stroke(); break;
        }
    }
    const updateCanvasSizeAndPosition = () => {
        const currentVvp = window.visualViewport;
        if (currentVvp) {
             c.width = currentVvp.width; c.height = currentVvp.height;
             c.style.width = currentVvp.width + 'px'; c.style.height = currentVvp.height + 'px';
             c.style.top = currentVvp.offsetTop + 'px'; c.style.left = currentVvp.offsetLeft + 'px';
        } else {
             c.width = window.innerWidth; c.height = window.innerHeight;
             c.style.width = window.innerWidth + 'px'; c.style.height = window.innerHeight + 'px';
             c.style.top = '0px'; c.style.left = '0px';
        }
        draw();
    };
    if (vvp) { vvp.addEventListener('resize', updateCanvasSizeAndPosition); vvp.addEventListener('scroll', updateCanvasSizeAndPosition); }
    else { window.addEventListener('resize', updateCanvasSizeAndPosition); }
    draw(); debug.log('Crosshair created');
}

function createGUI() {
    if (document.getElementById('xcloudcheat-gui')) return;
    const gui = document.createElement('div');
    gui.id = 'xcloudcheat-gui';
    gui.style.cssText = ` /* ... (same as v3.1.2) ... */ 
        position: fixed; top: 60px; right: 30px; width: 400px; min-width: 320px; max-width: 460px;
        background: linear-gradient(120deg,#17171d 60%,#232340 100%);
        color: #fafaff; padding: 22px 20px 16px 20px; border-radius: 18px;
        z-index: 100002; font-family: Inter,Segoe UI,sans-serif; font-size: 16px;
        box-shadow: 0 12px 32px 0 #0009,0 2px 8px #0005;
        transition: box-shadow .3s; user-select: none;
        max-height: calc(100vh - 120px); overflow-y: auto;
        scrollbar-width: thin; scrollbar-color: #555 #222;
    `;
     gui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h2 style="margin:0;color:#6df;font-size:1.3em;">Xcloud Aimbot <span style="font-size:0.8em;font-weight:400;opacity:.6;">v${config.version} (Perf. Focus)</span></h2>
          <button id="xcloudcheat-close" style="background:none;border:none;color:#faa;font-size:24px;font-weight:bold;cursor:pointer;padding:0 8px;line-height:1;margin-top:-5px;">×</button>
        </div>
        <div style="margin-bottom: 10px;">
            <span style="color:#68f;font-size:1em;">Status:</span>
            <span id="xcloudcheat-status" style="color:#fa5;font-weight:600;">Initializing...</span>
        </div>
        <hr style="border:1px solid #334; margin: 10px 0;">
        <div style="margin-bottom: 12px;">
            <label><input type="checkbox" id="detection-enabled" ${config.detection.enabled ? 'checked' : ''}> <b>Aimbot Active</b></label>
            <label style="margin-left:18px;"><input type="checkbox" id="auto-shoot" ${config.game.autoShoot ? 'checked' : ''}> Auto Shoot ('${config.game.crouchKey.replace('Key','')} press')</label>
        </div>
         <div style="margin-bottom: 12px;">
            <label><input type="checkbox" id="recoil-comp" ${config.game.recoilCompensation ? 'checked' : ''}> Recoil Comp</label>
            <label style="margin-left:18px;"><input type="checkbox" id="auto-reload" ${config.game.autoReload ? 'checked' : ''}> Auto Reload ('${config.game.reloadKey.replace('Key','')} press')</label>
        </div>

        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;" title="Higher = fewer detections = faster JS, but might miss targets.">Confidence: <span id="conf-val">${config.detection.confidence.toFixed(2)}</span></label>
          <input type="range" id="confidence" min="0.1" max="0.9" step="0.01" style="width:60%;" value="${config.detection.confidence}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;" title="Target interval. Actual may be higher if system is slow.">Aim Interval (ms): <span id="interval-val">${config.game.aimInterval}</span></label>
          <input type="range" id="aim-interval" min="15" max="200" step="5" style="width:60%;" value="${config.game.aimInterval}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">FOV Radius (px): <span id="fov-val">${config.game.fovRadius}</span></label>
          <input type="range" id="fov-radius" min="50" max="800" step="10" style="width:60%;" value="${config.game.fovRadius}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Target Priority:</label>
          <select id="target-priority" style="width:60%; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee;">
            <option value="closest" ${config.aim.targetPriority === "closest" ? 'selected' : ''}>Closest to Crosshair</option>
            <option value="center" ${config.aim.targetPriority === "center" ? 'selected' : ''}>Closest to Center</option>
          </select>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Aim Point:</label>
          <select id="aim-point" style="width:60%; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee;">
            <option value="center" ${config.aim.aimPoint === "center" ? 'selected' : ''}>Box Center</option>
            <option value="top" ${config.aim.aimPoint === "top" ? 'selected' : ''}>Box Top (Head)</option>
          </select>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Recoil Level:</label>
          <select id="recoil-level" style="width:60%; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee;">
            <option value="1" ${config.game.recoilLevel === 1 ? 'selected' : ''}>1 (None)</option>
            <option value="2" ${config.game.recoilLevel === 2 ? 'selected' : ''}>2 (Low)</option>
            <option value="3" ${config.game.recoilLevel === 3 ? 'selected' : ''}>3 (Medium)</option>
            <option value="4" ${config.game.recoilLevel === 4 ? 'selected' : ''}>4 (High)</option>
          </select>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 12px;">
          <label><input type="checkbox" id="draw-boxes" ${config.boundingBoxes.enabled ? 'checked' : ''}> BBoxes</label>
          <label style="margin-left:10px;"><input type="checkbox" id="draw-fov" ${config.fovCircle.enabled ? 'checked' : ''}> FOV Circle</label>
          <label style="margin-left:10px;" title="Can slightly reduce lag if disabled"><input type="checkbox" id="log-movement" ${config.debug.logMovement ? 'checked' : ''}> Log Movement</label>
        </div>
        <div style="margin-top: 12px; margin-bottom: 6px; color:#5df; font-size: 1.1em;">Info & Perf Tips</div>
        <div style="font-size:1em;line-height:1.6;background:#171b2c;border-radius:8px;padding:8px 12px;margin-bottom:10px; word-break: break-word;">
             <b>AI Backend:</b> <span id="backend-status" style="color:#ff0;">Checking...</span> <br>
             <b>Model:</b> <span id="model-status" style="color:#ff0;">CocoSSD (MobileNetV2)</span> <br>
             <b>Mouse Pos:</b> <span id="script-mouse-pos" style="color:#fff;">N/A</span><br>
             <b style="color:#fa5">Tips for Less Lag:</b><br>
               - Increase 'Aim Interval'.<br>
               - Increase 'Confidence'.<br>
               - Disable 'Log Movement' or all debug logs.
        </div>
        <div style="margin-top:10px;text-align:right; font-size:12px;color:#bbb;">TFJS/CocoSSD. Educational.</div>
    `;
    document.body.appendChild(gui);
    document.getElementById('xcloudcheat-close').onclick = () => gui.remove();

    const statusSpan = document.getElementById('xcloudcheat-status');
    const backendSpan = document.getElementById('backend-status');
    const modelInfoSpan = document.getElementById('model-status');
    const mousePosSpan = document.getElementById('script-mouse-pos');
    const updateMousePosDisplay = () => { if (mousePosSpan) mousePosSpan.textContent = `${InputSimulator.mousePos.x.toFixed(0)}, ${InputSimulator.mousePos.y.toFixed(0)}`; };

    document.getElementById('detection-enabled').onchange = (e) => {
        config.detection.enabled = e.target.checked;
        statusSpan.textContent = config.detection.enabled ? 'Active' : 'Inactive';
        statusSpan.style.color = config.detection.enabled ? '#5f5' : '#fa5';
        if (!config.detection.enabled && InputSimulator.isShooting) InputSimulator.stopShooting();
        debug.log(`Aimbot ${config.detection.enabled ? 'Enabled' : 'Disabled'}`);
    };
    // ... (other event handlers mostly same as v3.1.2)
    document.getElementById('auto-shoot').onchange = (e) => {
        config.game.autoShoot = e.target.checked;
        if (!config.game.autoShoot && InputSimulator.isShooting) InputSimulator.stopShooting();
    };
    document.getElementById('recoil-comp').onchange = (e) => config.game.recoilCompensation = e.target.checked;
    document.getElementById('auto-reload').onchange = (e) => config.game.autoReload = e.target.checked;
    document.getElementById('draw-boxes').onchange = (e) => config.boundingBoxes.enabled = e.target.checked;
    document.getElementById('draw-fov').onchange = (e) => config.fovCircle.enabled = e.target.checked;
    document.getElementById('log-movement').onchange = (e) => {
        debug.logMovement = config.debug.logMovement = e.target.checked;
        debug.log(`Movement logging ${e.target.checked ? 'enabled' : 'disabled'}.`);
    };

    document.getElementById('confidence').oninput = (e) => {
        config.detection.confidence = parseFloat(e.target.value);
        document.getElementById('conf-val').textContent = config.detection.confidence.toFixed(2);
        debug.log(`Confidence set to ${config.detection.confidence.toFixed(2)}`);
    };
    document.getElementById('aim-interval').oninput = (e) => {
        config.game.aimInterval = parseInt(e.target.value, 10);
        document.getElementById('interval-val').textContent = config.game.aimInterval;
        debug.log(`Aim Interval set to ${config.game.aimInterval}ms`);
    };
    document.getElementById('fov-radius').oninput = (e) => {
        config.game.fovRadius = parseInt(e.target.value, 10);
        document.getElementById('fov-val').textContent = config.game.fovRadius;
        drawOverlay(lastPredictions || []); // Redraw FOV immediately
    };
    document.getElementById('target-priority').onchange = (e) => config.aim.targetPriority = e.target.value;
    document.getElementById('aim-point').onchange = (e) => config.aim.aimPoint = e.target.value;
    document.getElementById('recoil-level').onchange = (e) => config.game.recoilLevel = parseInt(e.target.value, 10);
    
    statusSpan.textContent = config.detection.enabled ? 'Active' : 'Inactive';
    statusSpan.style.color = config.detection.enabled ? '#5f5' : '#fa5';
    backendSpan.textContent = 'Checking...'; backendSpan.style.color = '#ff0';
    if (modelInfoSpan) modelInfoSpan.textContent = `CocoSSD (${config.detection.modelBase})`;
    updateMousePosDisplay();
    setInterval(updateMousePosDisplay, 100);
    debug.log("GUI Created");
}


async function loadDetectionModel() { /* ... (unchanged from v3.1.2) ... */ 
    const modelInfoSpan = document.getElementById('model-status');
    const backendSpan = document.getElementById('backend-status');
    if (!detectionModel) {
        debug.log(`Loading Coco SSD model with base: '${config.detection.modelBase}'...`);
        if (modelInfoSpan) { modelInfoSpan.textContent = `Loading ${config.detection.modelBase}...`; modelInfoSpan.style.color = '#ff0'; }

        try {
            debug.log(`Attempting to set TF.js backend to 'webgl'... Current: ${tf.getBackend()}`);
            await tf.setBackend('webgl');
            debug.log(`TF.js backend successfully set to: ${tf.getBackend()}`);
            if (backendSpan) {
                backendSpan.textContent = tf.getBackend().toUpperCase();
                backendSpan.style.color = tf.getBackend() === 'webgl' ? '#5f5' : '#ff0';
            }
        } catch (err) {
            debug.warn(`Failed to set TF.js backend to 'webgl'. Falling back to '${tf.getBackend()}'. Error:`, err);
            if (backendSpan) {
                backendSpan.textContent = tf.getBackend().toUpperCase() + " (Fallback)";
                backendSpan.style.color = '#fa5';
            }
        }
        detectionModel = await cocoSsd.load({ base: config.detection.modelBase });
        debug.log(`Coco SSD model ('${config.detection.modelBase}') loaded successfully.`);
        if (modelInfoSpan) { modelInfoSpan.textContent = `CocoSSD (${config.detection.modelBase}) Loaded`; modelInfoSpan.style.color = '#5f5'; }
        return true;
    } else {
        debug.log("Coco SSD model already loaded.");
        if (modelInfoSpan) { modelInfoSpan.textContent = `CocoSSD (${config.detection.modelBase}) Ready`; modelInfoSpan.style.color = '#5f5'; }
        if (backendSpan && typeof tf !== 'undefined') { 
             backendSpan.textContent = tf.getBackend().toUpperCase();
             backendSpan.style.color = tf.getBackend() === 'webgl' ? '#5f5' : '#ff0';
        }
        return true;
    }
}

async function findGameVideoAndInit() { /* ... (unchanged from v3.1.2) ... */
    const statusSpan = document.getElementById('xcloudcheat-status');
    const backendSpan = document.getElementById('backend-status');
    const modelInfoSpan = document.getElementById('model-status');

    if (typeof tf === 'undefined' || typeof cocoSsd === 'undefined' || typeof cocoSsd.load === 'undefined') {
        debug.error("TF.js or CocoSSD libraries not found!");
        alert("Critical libraries not found. Aimbot cannot start.");
        if (statusSpan) { statusSpan.textContent = 'Lib Error'; statusSpan.style.color = '#faa'; }
        if (backendSpan) { backendSpan.textContent = 'TF.js Missing!'; backendSpan.style.color = '#faa'; }
        return;
    }

    gameVideo = document.querySelector(config.game.videoSelector);
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);
        try {
            if (!await loadDetectionModel()) { 
                 throw new Error("Model loading failed during initial setup.");
            }

            if (InputSimulator.init()) {
                createOverlayCanvas();
                createCrosshair();
                startAimLoop();
                if (statusSpan) {
                    statusSpan.textContent = config.detection.enabled ? 'Active' : 'Inactive';
                    statusSpan.style.color = config.detection.enabled ? '#5f5' : '#fa5';
                }
            } else {
                debug.error("InputSimulator init failed.");
                if (statusSpan) { statusSpan.textContent = 'Input Error'; statusSpan.style.color = '#faa'; }
            }
        } catch (err) {
            debug.error("Fatal Error during initialization:", err);
            config.detection.enabled = false; // Disable on error
            if (statusSpan) { statusSpan.textContent = 'Init Error'; statusSpan.style.color = '#faa'; }
            if (modelInfoSpan) { modelInfoSpan.textContent = 'Load Failed!'; modelInfoSpan.style.color = '#faa'; }
            if (backendSpan && typeof tf !== 'undefined') {
                 backendSpan.textContent = (tf.getBackend() ? tf.getBackend().toUpperCase() : 'UNKNOWN') + " (Error)";
                 backendSpan.style.color = '#faa';
            }
        }
    } else {
        const videoStatus = gameVideo ? `readyState=${gameVideo.readyState}, dims=${gameVideo.videoWidth}x${gameVideo.videoHeight}` : 'not found';
        debug.log(`Game video not ready (${videoStatus}), retrying...`);
        setTimeout(findGameVideoAndInit, 1500);
    }
 }

function startAimLoop() {
    debug.log(`Starting main aim loop. Target interval: ${config.game.aimInterval}ms.`);
    let lastProcessingFinishedTime = 0; // Tracks when the previous processing cycle *finished*

    function loop() { // Renamed from loop(currentTime) as currentTime wasn't used
        requestAnimationFrame(loop);
        const now = performance.now();
        utils.fps.update();

        if (gameVideo && !gameVideo.paused && !gameVideo.ended) {
            drawOverlay(lastPredictions || []);
        }

        if (processingFrame || !config.detection.enabled || !detectionModel || !gameVideo || 
            gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
            if ((!config.detection.enabled || (gameVideo && (gameVideo.paused || gameVideo.ended))) && InputSimulator.isShooting) {
                InputSimulator.stopShooting();
                currentTarget = null; bestTarget = null;
            }
            return;
        }

        // Check if enough time has passed since the *end* of the last processing cycle
        if (now - lastProcessingFinishedTime >= config.game.aimInterval) {
            // No need to update lastProcessingFinishedTime here, do it after async operation
            (async () => {
                 processingFrame = true;
                 const detectionStartTime = performance.now();
                 lastDetectionTimestamp = detectionStartTime; // For logging actual interval
                 let predictions = [];
                 try {
                     if (gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
                         predictions = await detectionModel.detect(gameVideo, config.detection.maxDetections, config.detection.confidence);
                         lastPredictions = predictions; 
                     } else {
                         predictions = lastPredictions || []; 
                     }
                     processPredictions(predictions.filter(p => p.class === config.detection.targetClass));
                 } catch (e) {
                     debug.error('Detection/Processing Error:', e);
                     if (InputSimulator.isShooting) InputSimulator.stopShooting();
                     currentTarget = null; bestTarget = null; lastPredictions = [];
                 } finally {
                     lastProcessingFinishedTime = performance.now(); // Update after processing finishes
                     processingFrame = false;
                    //  const cycleTime = lastProcessingFinishedTime - detectionStartTime;
                    //  if(cycleTime > config.game.aimInterval + 10) { // Log if cycle significantly exceeds target
                    //      debug.warn(`Detection cycle took ${cycleTime.toFixed(0)}ms (Target: ${config.game.aimInterval}ms)`);
                    //  }
                 }
            })();
        }
        // Recoil decay for when not shooting and no target
        if (!currentTarget && (InputSimulator.recoilOffset.x !== 0 || InputSimulator.recoilOffset.y !== 0) && !InputSimulator.isShooting) {
             const recoilPattern = config.game.recoilPatterns[config.game.recoilLevel];
             if (recoilPattern) {
                 const recovery = recoilPattern.recoverySpeed * 3; 
                 InputSimulator.recoilOffset.x *= (1 - recovery);
                 InputSimulator.recoilOffset.y *= (1 - recovery);
                 if (Math.abs(InputSimulator.recoilOffset.x) < 0.05) InputSimulator.recoilOffset.x = 0;
                 if (Math.abs(InputSimulator.recoilOffset.y) < 0.05) InputSimulator.recoilOffset.y = 0;
             }
        }
    }
    loop(); // Start the requestAnimationFrame loop
}

function processPredictions(targets) { /* ... (unchanged from v3.1.2) ... */
    const videoRect = gameVideo.getBoundingClientRect();
    const vvp = window.visualViewport;
    const screenCenterX = vvp ? vvp.width / 2 + vvp.pageLeft : window.innerWidth / 2;
    const screenCenterY = vvp ? (vvp.height / 2 + vvp.offsetTop) : (window.innerHeight / 2);

    if (!targets || targets.length === 0) {
        if (currentTarget) { /* debug.log("Target lost (No detections)."); */ }
        currentTarget = null; bestTarget = null;
        if (InputSimulator.isShooting && config.game.autoShoot) InputSimulator.stopShooting();
        return;
    }

    const videoAspectRatio = gameVideo.videoWidth / gameVideo.videoHeight;
    const displayAspectRatio = videoRect.width / videoRect.height;
    let videoDisplayWidth = videoRect.width, videoDisplayHeight = videoRect.height;
    let videoDisplayLeft = videoRect.left, videoDisplayTop = videoRect.top;
    if (videoAspectRatio > displayAspectRatio) {
        videoDisplayHeight = videoRect.width / videoAspectRatio;
        videoDisplayTop = videoRect.top + (videoRect.height - videoDisplayHeight) / 2;
    } else {
        videoDisplayWidth = videoRect.height * videoAspectRatio;
        videoDisplayLeft = videoRect.left + (videoRect.width - videoDisplayWidth) / 2;
    }

    let minScore = Infinity;
    let potentialTarget = null;
    targets.forEach(target => {
        const targetCenterX_video = target.bbox[0] + target.bbox[2] / 2;
        const targetCenterY_video = target.bbox[1] + target.bbox[3] / 2;
        const targetCenterX_screen = videoDisplayLeft + (targetCenterX_video / gameVideo.videoWidth) * videoDisplayWidth;
        const targetCenterY_screen = videoDisplayTop + (targetCenterY_video / gameVideo.videoHeight) * videoDisplayHeight;

        let evalCenterX = (config.aim.targetPriority === "center") ? screenCenterX : InputSimulator.mousePos.x;
        let evalCenterY = (config.aim.targetPriority === "center") ? screenCenterY : InputSimulator.mousePos.y;
        const distanceToPriorityPoint = Math.hypot(targetCenterX_screen - evalCenterX, targetCenterY_screen - evalCenterY);
        const distToScreenCenter = Math.hypot(targetCenterX_screen - screenCenterX, targetCenterY_screen - screenCenterY);

        if (distToScreenCenter > config.game.fovRadius) return;

        if (distanceToPriorityPoint < minScore) {
            minScore = distanceToPriorityPoint;
            potentialTarget = target;
        }
    });

    if (!potentialTarget) {
        if (currentTarget){ /* debug.log("Target lost (Out of FOV/priority)."); */ }
        currentTarget = null; bestTarget = null;
        if (InputSimulator.isShooting && config.game.autoShoot) InputSimulator.stopShooting();
        return;
    }
    
    // if (!currentTarget || currentTarget.bbox[0] !== potentialTarget.bbox[0] || currentTarget.bbox[1] !== potentialTarget.bbox[1]) {
    //     const targetCenterX_s = videoDisplayLeft + ((potentialTarget.bbox[0] + potentialTarget.bbox[2]/2) / gameVideo.videoWidth) * videoDisplayWidth;
    //     const targetCenterY_s = videoDisplayTop + ((potentialTarget.bbox[1] + potentialTarget.bbox[3]/2) / gameVideo.videoHeight) * videoDisplayHeight;
    //     const distToSCLog = Math.hypot(targetCenterX_s - screenCenterX, targetCenterY_s - screenCenterY);
    //     debug.log(`Updating lock: ${potentialTarget.class} (${(potentialTarget.score*100).toFixed(1)}%), PriorityDist: ${minScore.toFixed(0)}px`);
    // }
    currentTarget = potentialTarget; bestTarget = currentTarget;

    const bboxX_screen = videoDisplayLeft + (currentTarget.bbox[0] / gameVideo.videoWidth) * videoDisplayWidth;
    const bboxY_screen = videoDisplayTop + (currentTarget.bbox[1] / gameVideo.videoHeight) * videoDisplayHeight;
    const bboxW_screen = (currentTarget.bbox[2] / gameVideo.videoWidth) * videoDisplayWidth;
    const bboxH_screen = (currentTarget.bbox[3] / gameVideo.videoHeight) * videoDisplayHeight;

    let aimScreenX = bboxX_screen + bboxW_screen / 2;
    let aimScreenY = (config.aim.aimPoint === "top") ?
        bboxY_screen + bboxH_screen * 0.15 : 
        bboxY_screen + bboxH_screen / 2;    

    InputSimulator.moveMouseTo(aimScreenX, aimScreenY);

    if (!config.game.autoShoot && InputSimulator.isShooting) {
        InputSimulator.stopShooting();
    }
}

// --- Initialization ---
(function init() {
    console.log(`[XcloudCheat v${config.version} (Perf. Focus Mode)] Initializing...`);
    createGUI(); 
    setTimeout(findGameVideoAndInit, 1000); 
})();
