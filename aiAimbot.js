// ==UserScript==
// @name         XcloudCheat v2.8.3 (Local Coco SSD - Tidy Fix)
// @description  Aimbot using local Coco SSD model with controller emulation, recoil compensation for Xbox Cloud Gaming. Fixes tf.tidy error.
// @author       Ph0qu3_111 & AI Enhancement & Integration
// @version      2.8.3
// @match        *://*.xbox.com/play/*
// @grant        none
// @run-at       document-end
// @require      https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js
// @require      https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@latest/dist/coco-ssd.min.js
// ==/UserScript==

// --- Configuration ---
const config = {
    // --- Detection Model (Coco SSD) ---
    detection: {
        enabled: true,          // Master switch for detection/aiming
        modelType: 'cocossd',   // Identifier for the model being used
        confidence: 0.50,       // Confidence threshold (0.0 to 1.0) - Adjust as needed
        targetClass: 'person',  // Coco SSD class for players
        maxDetections: 5,      // Max number of detections per frame (performance)
    },

    // --- Game settings ---
    game: {
        videoSelector: 'video[aria-label="Game Stream for unknown title"]',
        containerSelector: '#game-stream',
        aimInterval: 350,        // Min ms between aim processing frames (lower = faster but more CPU)
        fovRadius: 250,         // Field of View radius from screen center (pixels)
        aimSpeed: 1,         // Smoothing factor for aim movement (0.05=slow, 1=instant)
        recoilCompensation: true,
        recoilLevel: 3,         // 1=None, 2=Barely, 3=Slight, 4=ALot
        recoilPatterns: {       // Defines vertical/horizontal kick and recovery speed
            1: { vertical: 0, horizontal: 0, recoverySpeed: 0.1 },
            2: { vertical: 0.2, horizontal: 0.05, recoverySpeed: 0.1 },
            3: { vertical: 0.4, horizontal: 0.1, recoverySpeed: 0.15 },
            4: { vertical: 0.6, horizontal: 0.2, recoverySpeed: 0.2 },
        },
        // jumpPrediction: false, // Currently disabled - complex to implement reliably
        autoShoot: true,        // Automatically shoot when aiming at a valid target
        autoCrouchShoot: true,  // Pressing Crouch key also triggers shooting
        autoReload: true,       // Pressing Reload key triggers simulated reload press
        crouchKey: 'KeyQ',      // Keyboard key for autoCrouchShoot
        reloadKey: 'KeyR',      // Keyboard key for autoReload
        controller: {           // Controller emulation settings
            enabled: true,      // Use controller emulation for aiming/shooting
            xSensitivity: 0.5,  // Multiplier for horizontal stick movement
            ySensitivity: 0.5,  // Multiplier for vertical stick movement
            deadzone: 0.15,     // Stick values below this are ignored (prevents drift)
        }
    },

    // --- Visuals ---
    crosshair: {
        enabled: true,
        size: 15,
        color: 'lime',
        style: 'cross' // 'circle', 'dot', 'cross'
    },
    fovCircle: { // Drawn on overlay canvas
        enabled: true,
        color: 'rgba(255, 0, 0, 0.3)',
        lineWidth: 1,
    },
    boundingBoxes: { // Drawn on overlay canvas
        enabled: true,
        color: 'yellow',
        lineWidth: 2,
    },

    // --- Aiming Logic ---
    aim: {
        positionSmoothing: true, // Average last few target positions for smoother aim
        historySize: 3,         // Number of positions to average for smoothing
        // targetLockTime: 100, // Future features - Not implemented
        // targetLockTimeVariance: 20, // Future features - Not implemented
        targetPriority: "closest", // "closest", "center" (target closest to FOV center, or screen center)
        aimPoint: "center",     // "center" (box center), "top" (box top-center estimate)
    },

    // --- Debugging ---
    debug: {
        enabled: true,
        showFPS: true,
        logThrottleMs: 250, // Minimum ms between console logs
    }
};

// --- Global Variables ---
let gameVideo = null;
let detectionModel = null; // Stores the loaded Coco SSD model instance
let positionHistory = [];  // Stores recent target coordinates for smoothing
let currentTarget = null;  // Stores the prediction object of the current target
let overlayCanvas = null;  // Canvas element for drawing FOV, boxes, etc.
let overlayCtx = null;     // 2D context for the overlay canvas

// --- Utility functions ---
const utils = {
    fps: (function() { // Self-contained FPS counter
        let fps = 0;
        let lastUpdate = Date.now();
        let frames = 0;
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

// --- Debug system ---
const debug = { // Simple console logging wrapper with throttling
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
    error(...args) { // Always log errors if debugging is enabled
        if (this.enabled) { console.error(`[XcloudCheat] ERROR:`, ...args); }
    },
    warn(...args) { // Log warnings if debugging is enabled
        if (this.enabled) { console.warn(`[XcloudCheat] WARN:`, ...args); }
    }
};


// --- Input Simulator (Handles Controller Emulation) ---
const InputSimulator = {
    gameContainer: null,
    mousePos: { x: 0, y: 0 }, // Used for fallback or potential future mouse mode
    isShooting: false,      // Tracks if the shoot button (trigger) is currently held
    recoilOffset: { x: 0, y: 0 }, // Current recoil adjustment being applied
    controller: { // State of the virtual controller
        leftStickX: 0, leftStickY: 0, rightStickX: 0, rightStickY: 0,
        buttons: { // Standard gamepad button layout
            a: false, b: false, x: false, y: false, leftBumper: false, rightBumper: false,
            leftTrigger: 0, rightTrigger: 0, // Triggers are analog (0.0 to 1.0)
            back: false, start: false, leftStickPress: false, rightStickPress: false, // Added stick presses
            dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false
        }
    },

    init() { // Get the game container element
        this.gameContainer = document.querySelector(config.game.containerSelector);
        if (!this.gameContainer) {
            debug.error('Game container NOT found! Input simulation will likely fail.');
            return false;
        }
        // Store initial center (not strictly needed for controller but useful for reference)
        const rect = this.gameContainer.getBoundingClientRect();
        this.mousePos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        debug.log('Input simulator initialized targeting:', config.game.containerSelector);
        return true;
    },

    applyRecoil(targetX, targetY) { // Adjusts target coordinates based on recoil settings
        if (!config.game.recoilCompensation || !config.game.recoilPatterns[config.game.recoilLevel] || !this.isShooting) {
            // Don't apply recoil if disabled, level invalid, or not currently shooting
            // Ensure recoil decays even if not shooting
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
        // Apply initial kick only once when shooting starts (offset is near zero)
        if (Math.abs(this.recoilOffset.x) < 0.1 && Math.abs(this.recoilOffset.y) < 0.1) {
             const kickMultiplier = 5; // Adjust this to control initial kick intensity
             this.recoilOffset.y = recoil.vertical * kickMultiplier;
             this.recoilOffset.x = (Math.random() - 0.5) * 2 * recoil.horizontal * kickMultiplier;
             debug.log(`Recoil kick: x=${this.recoilOffset.x.toFixed(2)}, y=${this.recoilOffset.y.toFixed(2)}`);
        }

        // Apply the current recoil offset to the target
        // Subtract X offset, Add Y offset (recoil pushes aim UP and sideways)
        let newTargetX = targetX - this.recoilOffset.x;
        let newTargetY = targetY + this.recoilOffset.y;

        // Gradually reduce recoil offset (recovery towards center)
        this.recoilOffset.x *= (1 - recoil.recoverySpeed);
        this.recoilOffset.y *= (1 - recoil.recoverySpeed);

        // Prevent drift when offset is very small
        if (Math.abs(this.recoilOffset.x) < 0.01) this.recoilOffset.x = 0;
        if (Math.abs(this.recoilOffset.y) < 0.01) this.recoilOffset.y = 0;

        return { x: newTargetX, y: newTargetY };
    },

    sendControllerInput() { // Creates and dispatches simulated gamepad data
        if (!config.game.controller.enabled || !this.gameContainer) return;
        try {
            // Construct the Gamepad object state based on current values
            const gamepad = {
                id: "Simulated Xbox Controller (XcloudCheat)", // Add an ID
                index: 0, // Typically the first controller
                connected: true,
                timestamp: performance.now(), // Use high-resolution timer
                mapping: 'standard',
                axes: [ // Standard mapping: LS horizontal, LS vertical, RS horizontal, RS vertical
                    this.controller.leftStickX,
                    this.controller.leftStickY,
                    this.controller.rightStickX,
                    this.controller.rightStickY
                ],
                buttons: [ // Standard mapping button order
                    { pressed: this.controller.buttons.a, touched: this.controller.buttons.a, value: this.controller.buttons.a ? 1 : 0 }, // 0: A
                    { pressed: this.controller.buttons.b, touched: this.controller.buttons.b, value: this.controller.buttons.b ? 1 : 0 }, // 1: B
                    { pressed: this.controller.buttons.x, touched: this.controller.buttons.x, value: this.controller.buttons.x ? 1 : 0 }, // 2: X
                    { pressed: this.controller.buttons.y, touched: this.controller.buttons.y, value: this.controller.buttons.y ? 1 : 0 }, // 3: Y
                    { pressed: this.controller.buttons.leftBumper, touched: this.controller.buttons.leftBumper, value: this.controller.buttons.leftBumper ? 1 : 0 }, // 4: LB
                    { pressed: this.controller.buttons.rightBumper, touched: this.controller.buttons.rightBumper, value: this.controller.buttons.rightBumper ? 1 : 0 }, // 5: RB
                    { pressed: this.controller.buttons.leftTrigger > 0, touched: this.controller.buttons.leftTrigger > 0, value: this.controller.buttons.leftTrigger }, // 6: LT
                    { pressed: this.controller.buttons.rightTrigger > 0, touched: this.controller.buttons.rightTrigger > 0, value: this.controller.buttons.rightTrigger }, // 7: RT
                    { pressed: this.controller.buttons.back, touched: this.controller.buttons.back, value: this.controller.buttons.back ? 1 : 0 }, // 8: Back/Select
                    { pressed: this.controller.buttons.start, touched: this.controller.buttons.start, value: this.controller.buttons.start ? 1 : 0 }, // 9: Start
                    { pressed: this.controller.buttons.leftStickPress, touched: this.controller.buttons.leftStickPress, value: this.controller.buttons.leftStickPress ? 1 : 0 }, // 10: LS Press
                    { pressed: this.controller.buttons.rightStickPress, touched: this.controller.buttons.rightStickPress, value: this.controller.buttons.rightStickPress ? 1 : 0 }, // 11: RS Press
                    { pressed: this.controller.buttons.dpadUp, touched: this.controller.buttons.dpadUp, value: this.controller.buttons.dpadUp ? 1 : 0 }, // 12: Dpad Up
                    { pressed: this.controller.buttons.dpadDown, touched: this.controller.buttons.dpadDown, value: this.controller.buttons.dpadDown ? 1 : 0 }, // 13: Dpad Down
                    { pressed: this.controller.buttons.dpadLeft, touched: this.controller.buttons.dpadLeft, value: this.controller.buttons.dpadLeft ? 1 : 0 }, // 14: Dpad Left
                    { pressed: this.controller.buttons.dpadRight, touched: this.controller.buttons.dpadRight, value: this.controller.buttons.dpadRight ? 1 : 0 }, // 15: Dpad Right
                    // 16: Home/Guide (Optional, often not mappable)
                ]
            };

            // --- Event Dispatching ---
            // Method 1: Overwrite navigator.getGamepads (More likely to work if game checks this directly)
            // This is somewhat hacky and might be blocked by browser security in some contexts.
            navigator.getGamepads = () => [gamepad, null, null, null]; // Present it as the first controller

            // Method 2: Dispatch custom events (Less reliable, depends on game listening for non-standard events)
            // const connectEvent = new GamepadEvent('gamepadconnected', { gamepad: gamepad });
            // window.dispatchEvent(connectEvent);
            // If the game specifically polls getGamepads, events might be ignored.

        } catch (e) {
            debug.error('Error sending controller input:', e);
            // Disable controller input if it fails repeatedly?
        }
    },

    moveMouseTo(targetScreenX, targetScreenY) { // Calculates stick deflection based on target coords
        if (!this.gameContainer) return;

        // Apply recoil adjustment *before* calculating stick deflection
        const compensatedTarget = this.applyRecoil(targetScreenX, targetScreenY);
        targetScreenX = compensatedTarget.x;
        targetScreenY = compensatedTarget.y;

        if (config.game.controller.enabled) {
            const rect = this.gameContainer.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Calculate delta (difference) between target and screen center
            const dx = targetScreenX - centerX;
            const dy = targetScreenY - centerY;

            // Normalize delta based on half the container size and apply sensitivity
            // This gives a value roughly proportional to how far the stick should be pushed
            let rawStickX = (dx / (rect.width / 2)) * config.game.controller.xSensitivity;
            let rawStickY = (dy / (rect.height / 2)) * config.game.controller.ySensitivity;

            // Clamp values to the [-1, 1] range expected for gamepad axes
            rawStickX = Math.max(-1, Math.min(1, rawStickX));
            rawStickY = Math.max(-1, Math.min(1, rawStickY));

            // Apply Deadzone: If the calculated value is too small, treat it as zero
            let finalStickX = (Math.abs(rawStickX) < config.game.controller.deadzone) ? 0 : rawStickX;
            let finalStickY = (Math.abs(rawStickY) < config.game.controller.deadzone) ? 0 : rawStickY;

            // Smooth the transition towards the target stick value using aimSpeed (interpolation)
            // CurrentStick = CurrentStick + (TargetStick - CurrentStick) * SpeedFactor
            this.controller.rightStickX += (finalStickX - this.controller.rightStickX) * config.game.aimSpeed;
            this.controller.rightStickY += (finalStickY - this.controller.rightStickY) * config.game.aimSpeed;

            // Apply deadzone again AFTER smoothing to prevent drifting when near zero
            if (Math.abs(this.controller.rightStickX) < config.game.controller.deadzone) this.controller.rightStickX = 0;
            if (Math.abs(this.controller.rightStickY) < config.game.controller.deadzone) this.controller.rightStickY = 0;

            this.sendControllerInput(); // Send the updated stick values

        } else {
            // Fallback: If controller emulation is off, use basic mouse move (less likely to work well)
            this.fallbackMoveMouse(targetScreenX, targetScreenY);
        }
    },

    fallbackMoveMouse(targetX, targetY) { // Basic mouse event dispatch (backup)
        const event = new MouseEvent('mousemove', {
            bubbles: true, clientX: targetX, clientY: targetY
        });
        if (this.gameContainer) { this.gameContainer.dispatchEvent(event); }
        this.mousePos = { x: targetX, y: targetY };
    },

    // Simulates pressing and holding the shoot trigger
    startShooting() {
        if (this.isShooting || !config.game.controller.enabled) return;
        this.isShooting = true;
        debug.log("Shooting START");
        this.controller.buttons.rightTrigger = 1.0; // Full trigger press
        // Reset recoil immediately when shooting starts
        this.recoilOffset = { x: 0, y: 0 };
        this.sendControllerInput();
    },

    // Simulates releasing the shoot trigger
    stopShooting() {
        if (!this.isShooting || !config.game.controller.enabled) return;
        this.isShooting = false;
        debug.log("Shooting STOP");
        this.controller.buttons.rightTrigger = 0.0; // Release trigger
        // Recoil recovery happens passively in applyRecoil over subsequent frames
        this.sendControllerInput();
    },

    // Simulates a brief button press (e.g., for reload)
    pressButton(buttonName, duration = 50) {
        if (!config.game.controller.enabled || !this.controller.buttons.hasOwnProperty(buttonName)) return;

        debug.log(`Pressing button: ${buttonName}`);
        this.controller.buttons[buttonName] = true; // Press
        // Handle trigger differently (set value to 1)
        if (buttonName === 'leftTrigger' || buttonName === 'rightTrigger') {
             this.controller.buttons[buttonName] = 1.0;
        }
        this.sendControllerInput();

        setTimeout(() => {
            debug.log(`Releasing button: ${buttonName}`);
            this.controller.buttons[buttonName] = false; // Release
            if (buttonName === 'leftTrigger' || buttonName === 'rightTrigger') {
                 this.controller.buttons[buttonName] = 0.0;
            }
            this.sendControllerInput();
        }, duration);
    },

    // Fallback for keyboard key press simulation (might not work in cloud stream)
    pressKey(key, duration = 50) {
        debug.warn("Attempting keyboard press simulation (may not work reliably):", key);
        const eventInit = { bubbles: true, cancelable: true, view: window, key: key, code: key };
        try {
             // Try dispatching to document or game container
             const targetElement = this.gameContainer || document;
             targetElement.dispatchEvent(new KeyboardEvent('keydown', eventInit));
             setTimeout(() => {
                 targetElement.dispatchEvent(new KeyboardEvent('keyup', eventInit));
             }, duration);
        } catch(e) {
             debug.error("Failed to simulate key press:", e);
        }
    }
};

// --- Drawing Functions ---
function createOverlayCanvas() { // Creates a canvas covering the screen for visuals
    if (overlayCanvas) return;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'xcloud-cheat-overlay';
    overlayCanvas.width = window.innerWidth;
    overlayCanvas.height = window.innerHeight;
    overlayCanvas.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 99998;`;
    overlayCtx = overlayCanvas.getContext('2d');
    document.body.appendChild(overlayCanvas);
    window.addEventListener('resize', () => { // Adjust canvas size on window resize
        overlayCanvas.width = window.innerWidth;
        overlayCanvas.height = window.innerHeight;
    });
    debug.log('Overlay canvas created');
}

function drawOverlay(predictions = []) { // Draws FOV circle and bounding boxes
    if (!overlayCtx || !gameVideo) return; // Need context and video element

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height); // Clear previous frame
    const videoRect = gameVideo.getBoundingClientRect();
    if (!videoRect || videoRect.width === 0 || videoRect.height === 0) return; // Need valid video dimensions

    // Draw FOV Circle (centered on video element)
    if (config.fovCircle.enabled) {
        overlayCtx.strokeStyle = config.fovCircle.color;
        overlayCtx.lineWidth = config.fovCircle.lineWidth;
        overlayCtx.beginPath();
        const centerX = videoRect.left + videoRect.width / 2;
        const centerY = videoRect.top + videoRect.height / 2;
        overlayCtx.arc(centerX, centerY, config.game.fovRadius, 0, Math.PI * 2);
        overlayCtx.stroke();
    }

    // Draw Bounding Boxes for detected persons
    if (config.boundingBoxes.enabled && predictions.length > 0) {
        overlayCtx.strokeStyle = config.boundingBoxes.color;
        overlayCtx.lineWidth = config.boundingBoxes.lineWidth;
        overlayCtx.fillStyle = config.boundingBoxes.color; // For text
        overlayCtx.font = '12px sans-serif';
        overlayCtx.textBaseline = 'bottom';

        predictions.forEach(p => {
            if (p.class === config.detection.targetClass) { // Only draw boxes for target class
                // Scale prediction bbox (relative to video) to screen coordinates
                const drawX = videoRect.left + (p.bbox[0] / gameVideo.videoWidth) * videoRect.width;
                const drawY = videoRect.top + (p.bbox[1] / gameVideo.videoHeight) * videoRect.height;
                const drawWidth = (p.bbox[2] / gameVideo.videoWidth) * videoRect.width;
                const drawHeight = (p.bbox[3] / gameVideo.videoHeight) * videoRect.height;

                overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight);
                // Draw class and confidence score above the box
                const scoreText = `${p.class} (${Math.round(p.score * 100)}%)`;
                overlayCtx.fillText(scoreText, drawX, drawY - 2);
            }
        });
    }
}

// --- Crosshair ---
function createCrosshair() { // Creates a simple crosshair canvas centered on screen
    if (!config.crosshair.enabled) return;
    const c = document.createElement('canvas');
    c.id = 'xcloud-crosshair';
    c.width = window.innerWidth; c.height = window.innerHeight;
    c.style.cssText = `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 99999;`; // Highest z-index
    const ctx = c.getContext('2d');
    document.body.appendChild(c);

    function draw() { // Draws the configured crosshair style
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

// --- Auto-actions ---
function setupAutoCrouch() { // Binds crouch key to also trigger shooting
    if (!config.game.autoCrouchShoot) return;
    debug.log('Auto-crouch+shoot keybind active for:', config.game.crouchKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.crouchKey && !e.repeat) {
            debug.log('Crouch key pressed, attempting shoot');
            InputSimulator.startShooting(); // Use controller simulation
            // Optionally simulate crouch button press (e.g., B button)
            // InputSimulator.pressButton('b', 50);
        }
    });
     document.addEventListener('keyup', (e) => { // Stop shooting when crouch is released
         if (e.code === config.game.crouchKey) {
             InputSimulator.stopShooting();
         }
     });
}

function setupAutoReload() { // Binds reload key to simulate controller reload press
    if (!config.game.autoReload) return;
    debug.log('Auto-reload keybind active for:', config.game.reloadKey);
    document.addEventListener('keydown', (e) => {
        if (e.code === config.game.reloadKey && !e.repeat) {
            debug.log('Reload key pressed, simulating X button press');
            InputSimulator.pressButton('x', 75); // Simulate X button press (adjust duration if needed)
            // InputSimulator.pressKey(config.game.reloadKey); // Keep keyboard fallback? Less reliable.
        }
    });
}


// --- GUI Controls ---
function createGUI() { // Creates the settings panel
    const gui = document.createElement('div');
    gui.style.cssText = `position: fixed; top: 10px; left: 10px; background: rgba(0,0,0,0.8); color: white; padding: 10px; border-radius: 8px; z-index: 100000; font-family: sans-serif; max-width: 300px; font-size: 13px; max-height: 90vh; overflow-y: auto;`; // Added scroll

    // Check if GM_info is available, otherwise use a default string for the version
    const displayVersion = (typeof GM_info !== 'undefined' && GM_info.script)
                           ? GM_info.script.version
                           : '2.8.3 (Console)'; // Provide a fallback version

    // HTML structure for the GUI elements, using displayVersion
    gui.innerHTML = `
        <h3 style="margin:0 0 10px; text-align:center; color:lightblue;">XcloudCheat v${displayVersion}</h3>
        <div style="border-bottom: 1px solid #444; padding-bottom: 5px; margin-bottom: 5px;">
            <label><input type="checkbox" id="detection-enabled" ${config.detection.enabled ? 'checked' : ''}> <b>Enable Aimbot</b></label><br>
            <label><input type="checkbox" id="auto-shoot" ${config.game.autoShoot ? 'checked' : ''}> Auto Shoot</label><br>
            <label><input type="checkbox" id="recoil-comp" ${config.game.recoilCompensation ? 'checked' : ''}> Recoil Comp</label><br>
            <label><input type="checkbox" id="auto-reload" ${config.game.autoReload ? 'checked' : ''}> Auto Reload (${config.game.reloadKey})</label><br>
            <label><input type="checkbox" id="draw-boxes" ${config.boundingBoxes.enabled ? 'checked' : ''}> Show Boxes</label><br>
            <label><input type="checkbox" id="draw-fov" ${config.fovCircle.enabled ? 'checked' : ''}> Show FOV</label>
        </div>
        <div style="border-bottom: 1px solid #444; padding-bottom: 5px; margin-bottom: 5px;">
            <label>Confidence: <span id="conf-val">${config.detection.confidence.toFixed(2)}</span></label>
            <input type="range" style="width: 95%;" id="confidence" min="0.1" max="0.9" step="0.05" value="${config.detection.confidence}">
        </div>
        <div>
            <label>Aim Speed: <span id="speed-val">${config.game.aimSpeed.toFixed(2)}</span></label>
            <input type="range" style="width: 95%;" id="aim-speed" min="0.05" max="1" step="0.05" value="${config.game.aimSpeed}">
        </div>
         <div>
            <label>FOV Radius: <span id="fov-val">${config.game.fovRadius}</span>px</label>
            <input type="range" style="width: 95%;" id="fov-radius" min="50" max="600" step="10" value="${config.game.fovRadius}">
        </div>
        <div>
            <label>Target Priority:
                <select id="target-priority" style="float: right;">
                    <option value="closest" ${config.aim.targetPriority === "closest" ? 'selected' : ''}>Closest</option>
                    <option value="center" ${config.aim.targetPriority === "center" ? 'selected' : ''}>Center</option>
                </select>
            </label>
        </div>
         <div>
            <label>Aim Point:
                <select id="aim-point" style="float: right;">
                    <option value="center" ${config.aim.aimPoint === "center" ? 'selected' : ''}>Box Center</option>
                    <option value="top" ${config.aim.aimPoint === "top" ? 'selected' : ''}>Box Top</option>
                </select>
            </label>
        </div>
        <div>
            <label>Recoil Level:
                <select id="recoil-level" style="float: right;">
                    <option value="1" ${config.game.recoilLevel === 1 ? 'selected' : ''}>1 (None)</option>
                    <option value="2" ${config.game.recoilLevel === 2 ? 'selected' : ''}>2 (Barely)</option>
                    <option value="3" ${config.game.recoilLevel === 3 ? 'selected' : ''}>3 (Slight)</option>
                    <option value="4" ${config.game.recoilLevel === 4 ? 'selected' : ''}>4 (A Lot)</option>
                </select>
            </label>
        </div>

        <h4 style="margin:15px 0 5px; color:lightblue; border-top: 1px solid #444; padding-top: 10px;">Controller Emulation</h4>
        <label><input type="checkbox" id="controller-enabled" ${config.game.controller.enabled ? 'checked' : ''}> Enable Controller</label>
         <div>
            <label>X Sens: <span id="x-sens-val">${config.game.controller.xSensitivity.toFixed(2)}</span></label>
            <input type="range" style="width: 95%;" id="x-sensitivity" min="0.1" max="2" step="0.05" value="${config.game.controller.xSensitivity}">
        </div>
        <div>
            <label>Y Sens: <span id="y-sens-val">${config.game.controller.ySensitivity.toFixed(2)}</span></label>
            <input type="range" style="width: 95%;" id="y-sensitivity" min="0.1" max="2" step="0.05" value="${config.game.controller.ySensitivity}">
        </div>
        <div>
            <label>Deadzone: <span id="deadzone-val">${config.game.controller.deadzone.toFixed(2)}</span></label>
            <input type="range" style="width: 95%;" id="deadzone" min="0.01" max="0.5" step="0.01" value="${config.game.controller.deadzone}">
        </div>
    `;
    document.body.appendChild(gui);

    // --- Bind GUI elements to config changes ---
    document.getElementById('detection-enabled').onchange = (e) => config.detection.enabled = e.target.checked;
    document.getElementById('auto-shoot').onchange = (e) => config.game.autoShoot = e.target.checked;
    document.getElementById('recoil-comp').onchange = (e) => config.game.recoilCompensation = e.target.checked;
    document.getElementById('auto-reload').onchange = (e) => config.game.autoReload = e.target.checked; // Setup happens once at start
    document.getElementById('draw-boxes').onchange = (e) => config.boundingBoxes.enabled = e.target.checked;
    document.getElementById('draw-fov').onchange = (e) => config.fovCircle.enabled = e.target.checked;

    document.getElementById('confidence').oninput = (e) => {
        config.detection.confidence = parseFloat(e.target.value);
        document.getElementById('conf-val').textContent = config.detection.confidence.toFixed(2);
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
    debug.log("GUI Created");
}


// --- Main Aimbot Logic ---

async function findGameVideoAndInit() { // Locates the game video element and initializes the AI model
    gameVideo = document.querySelector(config.game.videoSelector);
    // Wait for video to have metadata loaded (readyState >= 2) and positive dimensions
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);

        // Initialize Coco SSD Model
        try {
            if (!detectionModel) { // Load model only if it hasn't been loaded yet
                debug.log("Loading Coco SSD model...");
                 // Try to force WebGL backend for performance, fall back if needed
                 try { await tf.setBackend('webgl'); } catch { debug.warn("WebGL backend failed, using default."); }
                 await tf.ready(); // Wait for backend to be ready
                detectionModel = await cocoSsd.load(); // Load the model
                debug.log("Coco SSD model loaded successfully using backend:", tf.getBackend());
            } else {
                 debug.log("Coco SSD model already loaded.");
             }

            // Proceed with initializing other components
            if (InputSimulator.init()) {
                createOverlayCanvas();
                createCrosshair();
                createGUI(); // Will now use the fallback version if needed
                setupAutoCrouch();
                setupAutoReload();
                startAimLoop(); // Start the main detection and aiming loop
            } else {
                debug.error("InputSimulator initialization failed. Cannot proceed.");
            }
        } catch (err) {
            debug.error("Fatal Error during initialization (likely model loading):", err);
             // Use alert specifically for model loading errors, as it's critical
             if (err.message.toLowerCase().includes('coco') || err.message.toLowerCase().includes('model')) {
                 alert("Failed to load AI Model. Aimbot cannot function. Check console (F12) for errors. You may need to refresh.");
             }
            // Optionally disable detection if loading fails
            config.detection.enabled = false;
        }
    } else {
        // If video not found or not ready, retry
        const status = gameVideo ? `readyState=${gameVideo.readyState}, dims=${gameVideo.videoWidth}x${gameVideo.videoHeight}` : 'not found';
        debug.log(`Game video not ready (${status}), retrying...`);
        setTimeout(findGameVideoAndInit, 1500); // Retry after 1.5 seconds
    }
}

function startAimLoop() { // Starts the main loop using requestAnimationFrame
    debug.log('Starting main aim loop...');
    let lastFrameTime = 0;
    let animationFrameId = null; // To potentially cancel the loop

    function loop(currentTime) {
        animationFrameId = requestAnimationFrame(loop); // Schedule next frame

        // Calculate time since last frame for potential throttling/timing
        const deltaTime = currentTime - lastFrameTime;

        // Enforce minimum interval between processing frames
        if (deltaTime < config.game.aimInterval) {
            return; // Skip this frame if too soon
        }
        lastFrameTime = currentTime;

        utils.fps.update(); // Update FPS counter

        // Core checks before running the aim logic
        if (!config.detection.enabled || !detectionModel || !gameVideo || gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
            // If disabled, model not loaded, or video problematic, stop aiming/shooting and clear visuals
             if (InputSimulator.isShooting) InputSimulator.stopShooting();
             // Reset stick input only if controller enabled
             if(config.game.controller.enabled) {
                 InputSimulator.controller.rightStickX = 0;
                 InputSimulator.controller.rightStickY = 0;
                 InputSimulator.sendControllerInput(); // Send zeroed input
             }
             drawOverlay([]); // Clear drawings
             currentTarget = null; // Reset target
             positionHistory = []; // Clear history
            return; // Skip aim logic
        }

        aimLoop(); // Run the main detection and aiming logic for this frame
    }
    loop(performance.now()); // Start the loop immediately
}


async function aimLoop() { // Single frame of detection and aiming
    if (!detectionModel || !gameVideo || gameVideo.videoWidth === 0) return; // Should be caught by startAimLoop, but double-check

    let predictions = []; // Initialize predictions array
    try {
        // --- Perform Detection using Coco SSD ---
        // Check if video is ready before detection
        if (gameVideo.readyState < 2 || gameVideo.videoWidth === 0 || gameVideo.videoHeight === 0) {
            debug.warn("Video not ready for detection in aimLoop.");
            // predictions remains empty
        } else {
            // --- FIX: Removed tf.tidy() wrapper ---
            // Perform detection directly (detect handles its tensors)
            predictions = await detectionModel.detect(gameVideo, config.detection.maxDetections, config.detection.confidence);
            // --- End FIX ---
        }

        // Filter predictions for the target class ('person')
        const persons = predictions.filter(p => p.class === config.detection.targetClass);

        // --- Update Visual Overlay ---
         drawOverlay(persons); // Draw boxes/FOV based on current detections

        // --- Process Targets and Aim ---
        processPredictions(persons);

    } catch (e) {
        // Log specific TensorFlow errors differently
        if (e.message.includes("tensor") || e.message.includes("disposed") || e.message.includes("WebGL") || e.message.includes("backend")) { // Added 'backend'
            debug.warn("TensorFlow/WebGL/Backend error during detection (may recover):", e.message);
        } else {
            debug.error('Aimbot loop error:', e);
        }
        // Attempt to recover by stopping actions and clearing state
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
         if(config.game.controller.enabled) {
             InputSimulator.controller.rightStickX = 0;
             InputSimulator.controller.rightStickY = 0;
             InputSimulator.sendControllerInput();
         }
        currentTarget = null;
        positionHistory = [];
        drawOverlay([]); // Clear overlay on error
    }
}


function processPredictions(targets) { // Finds the best target and triggers aiming/shooting
    const videoRect = gameVideo.getBoundingClientRect();
    // Need video position and size on screen to translate coordinates
    if (!targets.length || !videoRect || videoRect.width === 0) {
        // No valid targets found or video element not ready
        if (currentTarget) { // Only log if we *had* a target previously
            debug.log("Target lost.");
        }
        currentTarget = null;
        positionHistory = []; // Clear smoothing history
        if (InputSimulator.isShooting) InputSimulator.stopShooting();
         // Reset stick input
         if(config.game.controller.enabled) {
             InputSimulator.controller.rightStickX = 0;
             InputSimulator.controller.rightStickY = 0;
             InputSimulator.sendControllerInput();
         }
        return; // Exit if no targets
    }

    // Screen center coordinates (relative to viewport)
    const screenCenterX = videoRect.left + videoRect.width / 2;
    const screenCenterY = videoRect.top + videoRect.height / 2;

    let bestTarget = null;
    let minScore = Infinity; // Lower score is better (closer or higher priority)

    // --- Find Best Target ---
    targets.forEach(target => {
        // Calculate the center of the detected bounding box (in video coordinates)
        const targetCenterX_video = target.bbox[0] + target.bbox[2] / 2;
        const targetCenterY_video = target.bbox[1] + target.bbox[3] / 2;

        // Convert video coordinates to screen coordinates
        const targetCenterX_screen = videoRect.left + (targetCenterX_video / gameVideo.videoWidth) * videoRect.width;
        const targetCenterY_screen = videoRect.top + (targetCenterY_video / gameVideo.videoHeight) * videoRect.height;

        // Calculate distance from the screen center (crosshair)
        const dx = targetCenterX_screen - screenCenterX;
        const dy = targetCenterY_screen - screenCenterY;
        const distance = Math.hypot(dx, dy);

        // Check if target is within the defined Field of View radius
        if (distance > config.game.fovRadius) {
            return; // Skip this target, it's outside the FOV
        }

        // Calculate score based on priority setting
        let score = Infinity;
        if (config.aim.targetPriority === "closest") {
            score = distance; // Prioritize purely by distance
        } else if (config.aim.targetPriority === "center") {
            // Alternative: Could slightly prioritize targets closer to exact center even within FOV
            score = distance; // Currently same as 'closest'
            // Example: score = distance + target.score * -10; // Factor in confidence?
        }

        // Update best target if this one has a better score
        if (score < minScore) {
            minScore = score;
            bestTarget = target;
            // Store screen coords directly on bestTarget temporarily for convenience
            // bestTarget.screenCoords = { x: targetCenterX_screen, y: targetCenterY_screen }; // Might not be needed
        }
    });

    // --- Aim at Best Target ---
    if (!bestTarget) {
        // No target within FOV met criteria
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

    // Log if a new target is acquired
    // Simple check: if currentTarget is null or different bbox[0]
    if (!currentTarget || currentTarget.bbox[0] !== bestTarget.bbox[0]) {
        debug.log(`New target acquired: ${bestTarget.class} (${(bestTarget.score*100).toFixed(1)}%), Dist: ${minScore.toFixed(0)}px`);
    }
    currentTarget = bestTarget; // Update the currently tracked target

    // Calculate the specific point on the target to aim for (e.g., center or top)
    let aimScreenX, aimScreenY;
    const bboxX_screen = videoRect.left + (bestTarget.bbox[0] / gameVideo.videoWidth) * videoRect.width;
    const bboxY_screen = videoRect.top + (bestTarget.bbox[1] / gameVideo.videoHeight) * videoRect.height;
    const bboxW_screen = (bestTarget.bbox[2] / gameVideo.videoWidth) * videoRect.width;
    const bboxH_screen = (bestTarget.bbox[3] / gameVideo.videoHeight) * videoRect.height;

    if (config.aim.aimPoint === "top") {
        // Aim near top-center of the bounding box
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen * 0.15; // Adjust multiplier for desired head height
    } else { // Default to exact center
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen / 2;
    }

    // Apply Position Smoothing
    if (config.aim.positionSmoothing && config.aim.historySize > 0) {
        positionHistory.push({ x: aimScreenX, y: aimScreenY });
        if (positionHistory.length > config.aim.historySize) {
            positionHistory.shift(); // Remove oldest entry
        }
        // Calculate average position from history
        let sumX = 0, sumY = 0;
        positionHistory.forEach(pos => { sumX += pos.x; sumY += pos.y; });
        aimScreenX = sumX / positionHistory.length;
        aimScreenY = sumY / positionHistory.length;
    } else {
        positionHistory = []; // Clear history if smoothing disabled
    }

    // --- Move Aim and Shoot ---
    InputSimulator.moveMouseTo(aimScreenX, aimScreenY); // Execute aim movement via controller sim

    // Auto Shoot Logic
    if (config.game.autoShoot) {
         if (!InputSimulator.isShooting) { // Only start shooting if not already doing so
            InputSimulator.startShooting();
         }
    } else {
        if (InputSimulator.isShooting) { // If auto-shoot is off, make sure we stop shooting
            InputSimulator.stopShooting();
        }
    }
}


// --- Script Initialization ---
(function init() {
    // Use a default name/version if GM_info is not available (console execution)
    const scriptName = typeof GM_info !== 'undefined' ? GM_info.script.name : "XcloudCheat (Console)";
    const scriptVersion = typeof GM_info !== 'undefined' ? GM_info.script.version : "2.8.3";
    console.log(`[${scriptName} v${scriptVersion}] Initializing...`);

    // Delay initialization slightly to give the page and video element time to load fully
    setTimeout(findGameVideoAndInit, 2000); // Wait 2 seconds before starting setup
})();
