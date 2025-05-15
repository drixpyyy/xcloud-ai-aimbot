// ==XcloudCheat Main Script v3.0.5 (USES GPU INSTEAD OF CPU)==
// Requires TensorFlow.js and Coco-SSD to be manually loaded BEFORE execution.
// Paste and run this ENTIRE block as a single command/snippet
// AFTER libraries tf and cocoSsd are available in the global scope.
// Fixes GUI initialization error by updating backend status after TF is ready.

const config = {
    version: '3.0.5', // Version increment
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
        recoilLevel: 4, // Lower levels have less or no recoil
        recoilPatterns: {
            1: { vertical: 0, horizontal: 0, recoverySpeed: 0.5 }, // No recoil, fast recovery (not used)
            2: { vertical: 0.2, horizontal: 0.05, recoverySpeed: 0.2 }, // Low recoil
            3: { vertical: 0.4, horizontal: 0.1, recoverySpeed: 0.15 }, // Medium recoil
            4: { vertical: 0.6, horizontal: 0.2, recoverySpeed: 0.1 }, // High recoil
        },
        autoShoot: true,
        autoCrouchShoot: true, // Note: This name is slightly confusing, it triggers auto-shoot on crouch key
        autoReload: true,
        crouchKey: 'KeyQ', // Key to trigger auto-shoot if autoShoot is true
        reloadKey: 'KeyR', // Key for auto-reload check
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
        color: 'rgba(255, 255, 255, 0.4)', // Changed color for better visibility
        lineWidth: 1,
    },
    boundingBoxes: {
        enabled: true,
        color: 'cyan', // Changed color
        lineWidth: 1,
    },
    aim: {
        positionSmoothing: false, // Disabled for continuous, direct aiming
        historySize: 0, // No history used
        targetPriority: "closest", // "closest" or "center"
        aimPoint: "center", // "center" or "top"
    },
    debug: {
        enabled: true,
        showFPS: true,
        logThrottleMs: 100, // Increased log frequency slightly for better debugging
        logMovement: true, // Toggle specific movement logging
    }
};

// --- Globals ---
let gameVideo = null;
let detectionModel = null;
let positionHistory = []; // Not used with smoothing disabled, but kept
let currentTarget = null;
let overlayCanvas = null;
let overlayCtx = null;
let bestTarget = null; // Global to help overlay drawing identify the target
let lastPredictions = []; // Store last predictions for continuous drawing
let processingFrame = false; // Flag to prevent overlapping detection calls

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
    logMovement: config.debug.logMovement, // Use config value
    lastLogTime: 0,
    throttleMs: config.debug.logThrottleMs,
    log(...args) {
        if (this.enabled) {
            const now = Date.now();
            // Only throttle general logs, not errors/warnings
            if (now - this.lastLogTime >= this.throttleMs) {
                let logString = `[XcloudCheat]`;
                if (this.showFPS) { logString += ` FPS: ${utils.fps.get()} |`; }
                console.log(logString, ...args);
                this.lastLogTime = now;
            }
        }
    },
    logMove(...args) { // Separate function for movement logging
         if (this.enabled && this.logMovement) {
             let logString = `[XcloudCheat] MOVE |`;
             if (this.showFPS) { logString += ` FPS: ${utils.fps.get()} |`; }
             console.log(logString, ...args);
         }
    },
    error(...args) { if (this.enabled) { console.error(`[XcloudCheat] ERROR:`, ...args); } },
    warn(...args) { if (this.enabled) { console.warn(`[XcloudCheat] WARN:`, ...args); } }
};

const InputSimulator = {
    gameContainer: null,
    // mousePos tracks the script's *intended* screen position, updated after calculating movement
    mousePos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    // kbm.lastClientX/Y also tracks the script's intended screen position
    kbm: {
        lastClientX: window.innerWidth / 2,
        lastClientY: window.innerHeight / 2,
        leftButtonDown: false,
        inventoryActive: [false,false,false,false,false,false,false], // Tracks if user is holding inventory keys
    },
    isShooting: false, // Tracks if the script/user has initiated shooting (left mouse down)
    recoilOffset: { x: 0, y: 0 }, // Tracks accumulated recoil compensation needed

    _simulatePointerEvent(options) {
        const {
            type,
            clientX, // Absolute position - Xcloud might ignore or use this differently
            clientY, // Absolute position - Xcloud might ignore or use this differently
            movementX = 0, // Relative movement - This is usually what games use for aim
            movementY = 0, // Relative movement - This is usually what games use for aim
            button = 0,
            buttons = 0,
            delay = 0
        } = options;

        let eventType;
        let eventProps = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: Math.round(clientX), // Still send the calculated absolute position
            clientY: Math.round(clientY),
            movementX: Math.round(movementX), // Send the calculated pixel delta
            movementY: Math.round(movementY),
            pointerType: 'mouse',
            // Add button/buttons for down/up events
            button: button,
            buttons: buttons,
        };

        if (type === 'pointermove') {
            eventType = 'pointermove';
            // Ensure buttons state is correct during move if mouse is held down
             eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0;
        } else if (type === 'pointerdown') {
            eventType = 'pointerdown';
             if (button === 0) this.kbm.leftButtonDown = true;
             eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0; // Ensure buttons reflects the state *after* this event
        } else if (type === 'pointerup') {
            eventType = 'pointerup';
             if (button === 0) this.kbm.leftButtonDown = false;
             eventProps.buttons = this.kbm.leftButtonDown ? 1 : 0; // Ensure buttons reflects the state *after* this event
        } else {
            debug.error("[InputSim] Invalid pointer event type:", type);
            return;
        }

        if (!eventType) return;

        setTimeout(() => {
            const event = new PointerEvent(eventType, eventProps);
            // Dispatch to the window
            window.dispatchEvent(event);
        }, delay);
    },

    init() {
        this.gameContainer = document.querySelector(config.game.containerSelector);
        // Initialize position to the center of the screen
        this.kbm.lastClientX = window.innerWidth / 2;
        this.kbm.lastClientY = window.innerHeight / 2;
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };

        // Send an initial pointermove to "center" the virtual cursor
        this._simulatePointerEvent({
            type: 'pointermove',
            clientX: this.kbm.lastClientX,
            clientY: this.kbm.lastClientY,
            movementX: 0, // Initial move has 0 movement
            movementY: 0,
            delay: 100 // Small delay to ensure page is ready
        });
        debug.log('Input simulator (KBM) initialized. Initial pointermove sent.');
        this.listenKeyboard();
        return true; // Indicate successful initialization
    },

    listenKeyboard() {
        // Use capture phase (true) to intercept events before they reach potentially nested game elements
        document.addEventListener('keydown', (e) => {
            // Prevent default actions for trigger/reload keys if aimbot/autoreload is active
            if (config.detection.enabled || config.game.autoReload) {
                 if (e.code === config.game.crouchKey || e.code === config.game.reloadKey) {
                     e.preventDefault(); // Prevent game/browser default action
                 }
            }

            // Track user pressing inventory keys
             if (config.game.inventoryKeys.includes(e.code)) {
                 const idx = config.game.inventoryKeys.indexOf(e.code);
                 if (idx !== -1 && !this.kbm.inventoryActive[idx]) {
                      this.kbm.inventoryActive[idx] = true;
                      debug.log(`KBM: User pressed Inventory Slot ${idx+1} ('${e.code}')`);
                  }
                  // Don't trigger auto-shoot for inventory keys
                  return;
             }

            // Trigger auto-shoot if autoShoot is enabled AND the trigger key is pressed
            if (config.game.autoShoot && e.code === config.game.crouchKey) {
                // Check if the user is *already* holding an inventory key.
                // If so, they are likely trying to switch weapons while aiming, not start shooting.
                const isHoldingInventory = this.kbm.inventoryActive.some(held => held);
                if (!isHoldingInventory) {
                    debug.log(`KBM: '${config.game.crouchKey}' (auto-shoot trigger) pressed`);
                    this.startShooting(); // Start shooting via script simulation
                } else {
                     debug.log(`KBM: '${config.game.crouchKey}' pressed, but user holding inventory key. Not triggering auto-shoot.`);
                }
            }

             // Auto-reload logging (the actual reload happens in-game because the user pressed the key)
             if (config.game.autoReload && e.code === config.game.reloadKey && !e.repeat) {
                  debug.log(`KBM: User pressed '${config.game.reloadKey}' (reload key). Auto-reload feature active.`);
                  // No simulation needed here, rely on game handling the key press
             }

        }, true); // Use capture phase

        document.addEventListener('keyup', (e) => {
             // Track user releasing inventory keys
             if (config.game.inventoryKeys.includes(e.code)) {
                 const idx = config.game.inventoryKeys.indexOf(e.code);
                 if (idx !== -1) {
                     this.kbm.inventoryActive[idx] = false;
                 }
                 return;
             }

            // Stop auto-shoot if autoShoot is enabled AND the trigger key is released
            if (config.game.autoShoot && e.code === config.game.crouchKey) {
                debug.log(`KBM: '${config.game.crouchKey}' (auto-shoot trigger) released`);
                this.stopShooting(); // Stop shooting via script simulation
            }
        }, true); // Use capture phase
    },


    // --- Core Mouse Movement Logic ---
    moveMouseTo(targetScreenX, targetScreenY) {
        // Calculate the raw pixel difference needed to move from the script's *current* tracked position
        // to the target position (aim point on the detected person).
        let movementX_to_target = targetScreenX - this.kbm.lastClientX;
        let movementY_to_target = targetScreenY - this.kbm.lastClientY;

        let movementX_total = movementX_to_target;
        let movementY_total = movementY_to_target;

        // --- Recoil Compensation Logic ---
        if (config.game.recoilCompensation && config.game.recoilPatterns[config.game.recoilLevel]) {
            const recoil = config.game.recoilPatterns[config.game.recoilLevel];
             const recoilMultiplier = 5; // Scales the config recoil values to estimated screen pixels per shot. TUNE THIS.

            if (this.isShooting) {
                // While shooting, we need to add compensation for the recoil kick.
                // Assume recoil accumulates roughly per frame/aim update.
                // Recoil pushes crosshair UP (-Y in screen). We need to move mouse DOWN (+Y).
                // Recoil pushes crosshair LEFT/RIGHT (-/+X in screen). We need to move mouse RIGHT/LEFT (+/-X).

                 // The recoil values in config should represent the magnitude of kick in some abstract unit.
                 // We scale them by recoilMultiplier to get estimated pixel movement *per frame/shot*.
                 // Accumulate the *compensation movement* needed.
                 // Kick UP (-Y) requires +Y movement.
                 // Kick RIGHT (+X) requires -X movement.
                 // Kick LEFT (-X) requires +X movement.

                 // Let's simplify: vertical is always positive kick amount (up). Horizontal is random +/-.
                 // Compensation needed per frame:
                const frameCompY = recoil.vertical * recoilMultiplier;
                const frameCompX = (Math.random() - 0.5) * 2 * (recoil.horizontal * recoilMultiplier);

                // Add this frame's compensation needed to the total accumulated offset
                this.recoilOffset.x += frameCompX;
                this.recoilOffset.y += frameCompY;

                // Decay the accumulated offset slightly (simulating recovery during shooting)
                const recovery = recoil.recoverySpeed;
                this.recoilOffset.x *= (1 - recovery);
                this.recoilOffset.y *= (1 - recovery);

                // Reset small offsets to zero
                 if (Math.abs(this.recoilOffset.x) < 0.1) this.recoilOffset.x = 0;
                 if (Math.abs(this.recoilOffset.y) < 0.1) this.recoilOffset.y = 0;

                // The total movement to send is the movement needed to get to the target,
                // PLUS the movement needed to counteract the accumulated recoil offset.
                // If recoilOffset.x is +5 (meaning game kicked right by 5), we need to move Left (-5).
                // If recoilOffset.y is +10 (meaning game kicked up by 10), we need to move Down (+10).
                movementX_total = movementX_to_target - this.recoilOffset.x; // Subtract offset for horizontal
                movementY_total = movementY_to_target + this.recoilOffset.y; // Add offset for vertical

            } else {
                // If not shooting, decay the accumulated recoil offset faster
                 const recovery = recoil.recoverySpeed * 3; // Faster recovery when idle
                this.recoilOffset.x *= (1 - recovery);
                this.recoilOffset.y *= (1 - recovery);
                if (Math.abs(this.recoilOffset.x) < 0.05) this.recoilOffset.x = 0;
                if (Math.abs(this.recoilOffset.y) < 0.05) this.recoilOffset.y = 0;
                 // When not shooting, movement_total is just movement_to_target (no recoil compensation needed)
                 // But we still need to update the internal position based on target, even if no event is sent.
            }
        }
        // --- End Recoil Compensation Logic ---


        // Only send a pointermove event if the total calculated movement is large enough
        // This prevents tiny jittering movements from being sent.
        const sendThreshold = 0.5; // Pixels threshold

        if (Math.abs(movementX_total) > sendThreshold || Math.abs(movementY_total) > sendThreshold) {

            // Calculate the *new* screen position after applying the total movement
            const newClientX = this.kbm.lastClientX + movementX_total;
            const newClientY = this.kbm.lastClientY + movementY_total;

             // Log the movement being sent if debug movement is enabled
             debug.logMove(`Aiming | Target(${targetScreenX.toFixed(1)}, ${targetScreenY.toFixed(1)}) | Current(${this.kbm.lastClientX.toFixed(1)}, ${this.kbm.lastClientY.toFixed(1)}) | Move(${movementX_total.toFixed(1)}, ${movementY_total.toFixed(1)}) | Recoil(${this.recoilOffset.x.toFixed(1)}, ${this.recoilOffset.y.toFixed(1)})`);


            // Simulate the pointermove event
            this._simulatePointerEvent({
                type: 'pointermove',
                clientX: newClientX, // Send the resulting absolute position
                clientY: newClientY,
                movementX: movementX_total, // Send the pixel delta
                movementY: movementY_total,
                button: this.kbm.leftButtonDown ? 0 : -1, // Indicate if left mouse button is down
                buttons: this.kbm.leftButtonDown ? 1 : 0, // Indicate button state
                delay: 0
            });

            // Update the script's internal tracking of the mouse position to the *new* position after the movement
            this.kbm.lastClientX = newClientX;
            this.kbm.lastClientY = newClientY;


        } else {
            // If movement is below threshold, an event isn't sent.
            // However, the script's internal position tracking should still converge towards the target.
            // We could either:
            // 1. Just do nothing (internal position lags behind slightly)
            // 2. Snap internal position to target (might feel jumpy in logs/debug)
            // 3. Gradually move internal position towards target (smoother internal tracking)

            // Let's try gradually moving the internal position even if event isn't sent.
            // This keeps the `movementX_to_target` calculation on the next frame more accurate.
            // A small fraction of the movement needed.
             const smoothingFactor = 0.1; // Move internal position 10% of the way
             this.kbm.lastClientX += movementX_to_target * smoothingFactor;
             this.kbm.lastClientY += movementY_to_target * smoothingFactor;

             // Still decay recoil offset even if no event sent
             if (!this.isShooting && (this.recoilOffset.x !== 0 || this.recoilOffset.y !== 0)) {
                  const recoil = config.game.recoilPatterns[config.game.recoilLevel];
                  const recovery = recoil?.recoverySpeed * 3 || 0.3; // Faster recovery
                 this.recoilOffset.x *= (1 - recovery);
                 this.recoilOffset.y *= (1 - recovery);
                 if (Math.abs(this.recoilOffset.x) < 0.05) this.recoilOffset.x = 0;
                 if (Math.abs(this.recoilOffset.y) < 0.05) this.recoilOffset.y = 0;
             }

             // Log if internal position is updated but no event sent
             // debug.logMove(`Aiming | Movement below threshold. Internal pos updating: Current(${this.kbm.lastClientX.toFixed(1)}, ${this.kbm.lastClientY.toFixed(1)})`);
        }

        // Always update mousePos to the latest internal tracking position
        this.mousePos = { x: this.kbm.lastClientX, y: this.kbm.lastClientY };
    },

    startShooting() {
        // Only start shooting if autoShoot is enabled in config AND the script isn't already shooting
        if (!config.game.autoShoot || this.isShooting) return;

        this.isShooting = true;
        debug.log("Shooting START (KBM Simulation)");
         // Reset recoil offset when starting a new shooting sequence
         this.recoilOffset = { x: 0, y: 0 };

        // Simulate left mouse button down
        this._simulatePointerEvent({
            type: 'pointerdown',
            clientX: this.kbm.lastClientX, // Use current script-tracked position
            clientY: this.kbm.lastClientY,
            button: 0, // Left mouse button
            buttons: 1, // Left button is down
            delay: 0
        });
    },

    stopShooting() {
        // Only stop shooting if the script is currently simulating shooting
        if (!this.isShooting) return;

        this.isShooting = false;
        debug.log("Shooting STOP (KBM Simulation)");
         // Recoil offset will start recovering faster because isShooting is false

        // Simulate left mouse button up
        this._simulatePointerEvent({
            type: 'pointerup',
            clientX: this.kbm.lastClientX, // Use current script-tracked position
            clientY: this.kbm.lastClientY,
            button: 0, // Left mouse button
            buttons: 0, // No buttons down
            delay: 0
        });
    },

    // simulateInventory and pressKey are available but not actively used by the AI in this version
    // They rely on the game correctly interpreting dispatched KeyboardEvents.
    pressKey(code, duration = 50) {
        debug.log("[InputSim] Simulate KBM key press:", code, `duration: ${duration}ms`);
        // Try dispatching on window as it seems more reliable for game events
        const downEvt = new KeyboardEvent('keydown', { code: code, bubbles: true, cancelable: true, view: window });
        window.dispatchEvent(downEvt);
        if (duration > 0) {
            setTimeout(() => {
                const upEvt = new KeyboardEvent('keyup', { code: code, bubbles: true, cancelable: true, view: window });
                window.dispatchEvent(upEvt);
            }, duration);
        }
    }
};

// --- Overlay and Drawing ---
function createOverlayCanvas() {
    if (overlayCanvas) return;
    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'xcloud-cheat-overlay';
    // Use visualViewport for potentially more accurate sizing within browser UI
    const vvp = window.visualViewport;
    overlayCanvas.width = vvp ? vvp.width : window.innerWidth;
    overlayCanvas.height = vvp ? vvp.height : window.innerHeight;
    // Position relative to visual viewport top-left for correct alignment
    overlayCanvas.style.cssText = `position: fixed; top: ${vvp ? vvp.offsetTop : 0}px; left: ${vvp ? vvp.offsetLeft : 0}px; width: ${vvp ? vvp.width : window.innerWidth}px; height: ${vvp ? vvp.height : window.innerHeight}px; pointer-events: none; z-index: 99998;`;
    overlayCtx = overlayCanvas.getContext('2d');
    document.body.appendChild(overlayCanvas);

    // Listen to visualViewport.resize and scroll for better handling
    const updateCanvasSizeAndPosition = () => {
        const currentVvp = window.visualViewport;
        if (currentVvp) {
             overlayCanvas.width = currentVvp.width;
             overlayCanvas.height = currentVvp.height;
             overlayCanvas.style.width = currentVvp.width + 'px';
             overlayCanvas.style.height = currentVvp.height + 'px';
             overlayCanvas.style.top = currentVvp.offsetTop + 'px';
             overlayCanvas.style.left = currentVvp.offsetLeft + 'px';
        } else {
             overlayCanvas.width = window.innerWidth;
             overlayCanvas.height = window.innerHeight;
             overlayCanvas.style.width = window.innerWidth + 'px';
             overlayCanvas.style.height = window.innerHeight + 'px';
             overlayCanvas.style.top = '0px';
             overlayCanvas.style.left = '0px';
        }
        // Redraw immediately after resize
        drawOverlay(lastPredictions || []);
    };

    if (vvp) {
         vvp.addEventListener('resize', updateCanvasSizeAndPosition);
         vvp.addEventListener('scroll', updateCanvasSizeAndPosition); // Scroll can also change visual viewport position
    } else {
        window.addEventListener('resize', updateCanvasSizeAndPosition);
    }

    debug.log('Overlay canvas created');
}

function drawOverlay(predictions = []) {
    if (!overlayCtx || !gameVideo) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    const videoRect = gameVideo.getBoundingClientRect();
    if (!videoRect || videoRect.width === 0 || videoRect.height === 0) return;

    // Calculate the visible/displayed area of the video within its bounding box
     const videoAspectRatio = gameVideo.videoWidth / gameVideo.videoHeight;
     const displayAspectRatio = videoRect.width / videoRect.height;

     let videoDisplayWidth = videoRect.width;
     let videoDisplayHeight = videoRect.height;
     let videoDisplayLeft = videoRect.left;
     let videoDisplayTop = videoRect.top;

     if (videoAspectRatio > displayAspectRatio) {
         // Video is wider than container, it's letterboxed vertically
         videoDisplayHeight = videoRect.width / videoAspectRatio;
         videoDisplayTop = videoRect.top + (videoRect.height - videoDisplayHeight) / 2;
     } else {
         // Video is taller than container, it's letterboxed horizontally
         videoDisplayWidth = videoRect.height * videoAspectRatio;
         videoDisplayLeft = videoRect.left + (videoRect.width - videoDisplayWidth) / 2;
     }

    // FOV Circle centered on the overlay canvas (which is sized to visual viewport)
    if (config.fovCircle.enabled) {
        overlayCtx.strokeStyle = config.fovCircle.color;
        overlayCtx.lineWidth = config.fovCircle.lineWidth;
        overlayCtx.beginPath();
        // Center relative to the overlay canvas
        const centerX = overlayCanvas.width / 2;
        const centerY = overlayCanvas.height / 2;
        overlayCtx.arc(centerX, centerY, config.game.fovRadius, 0, Math.PI * 2);
        overlayCtx.stroke();
    }

    // Bounding Boxes
    if (config.boundingBoxes.enabled && predictions.length > 0) {
        overlayCtx.strokeStyle = config.boundingBoxes.color;
        overlayCtx.lineWidth = config.boundingBoxes.lineWidth;
        overlayCtx.fillStyle = config.boundingBoxes.color;
        overlayCtx.font = '12px sans-serif';
        overlayCtx.textBaseline = 'bottom';

        predictions.forEach(p => {
            if (p.class === config.detection.targetClass) {
                // Map detection bbox (relative to video source) to screen coordinates (relative to overlay canvas)
                const drawX = videoDisplayLeft + (p.bbox[0] / gameVideo.videoWidth) * videoDisplayWidth;
                const drawY = videoDisplayTop + (p.bbox[1] / gameVideo.videoHeight) * videoDisplayHeight;
                const drawWidth = (p.bbox[2] / gameVideo.videoWidth) * videoDisplayWidth;
                const drawHeight = (p.bbox[3] / gameVideo.videoHeight) * videoDisplayHeight;

                overlayCtx.strokeRect(drawX, drawY, drawWidth, drawHeight);

                // Draw detection score text
                const scoreText = `${p.class} (${Math.round(p.score * 100)}%)`;
                 // Position text slightly above box, ensuring it's not clipped by top of screen
                 const textX = drawX;
                 const textY = drawY - 2; // Position text above the box
                 // Clamp text Y to avoid drawing off-screen (relative to overlay canvas top)
                 const clampedTextY = Math.max(textY, 14); // Assuming 12px font + 2px margin

                overlayCtx.fillText(scoreText, textX, clampedTextY);

                // Draw line to the calculated aim point for the *currently selected* target
                 if (bestTarget && p === bestTarget) { // Check if this prediction is the best target
                     const aimX_video = bestTarget.bbox[0] + bestTarget.bbox[2] / 2;
                     let aimY_video;
                     if (config.aim.aimPoint === "top") {
                        aimY_video = bestTarget.bbox[1] + bestTarget.bbox[3] * 0.15; // 15% from top
                    } else {
                        aimY_video = bestTarget.bbox[1] + bestTarget.bbox[3] / 2; // Center
                    }

                     // Map aim point from video source to screen coordinates
                     const aimScreenX = videoDisplayLeft + (aimX_video / gameVideo.videoWidth) * videoDisplayWidth;
                     const aimScreenY = videoDisplayTop + (aimY_video / gameVideo.videoHeight) * videoDisplayHeight;


                     overlayCtx.beginPath();
                     overlayCtx.strokeStyle = 'red'; // Highlight the line to the target
                     overlayCtx.lineWidth = 2;

                     // Draw line from the script's *current tracked mouse position* to the aim point
                     overlayCtx.moveTo(InputSimulator.mousePos.x, InputSimulator.mousePos.y);
                     overlayCtx.lineTo(aimScreenX, aimScreenY);
                     overlayCtx.stroke();

                     // Draw a dot at the target aim point
                     overlayCtx.fillStyle = 'red';
                     overlayCtx.beginPath();
                     overlayCtx.arc(aimScreenX, aimScreenY, 4, 0, Math.PI * 2);
                     overlayCtx.fill();
                 }
            }
        });
    }
}

// Crosshair is assumed to be on a separate canvas and handled internally there.
function createCrosshair() {
    if (!config.crosshair.enabled) return;
    if (document.getElementById('xcloud-crosshair')) return; // Prevent creating multiple
    const c = document.createElement('canvas');
    c.id = 'xcloud-crosshair';
    const vvp = window.visualViewport;
    c.width = vvp ? vvp.width : window.innerWidth;
    c.height = vvp ? vvp.height : window.innerHeight;
     c.style.cssText = `position: fixed; top: ${vvp ? vvp.offsetTop : 0}px; left: ${vvp ? vvp.offsetLeft : 0}px; width: ${vvp ? vvp.width : window.innerWidth}px; height: ${vvp ? vvp.height : window.innerHeight}px; pointer-events: none; z-index: 100000;`;
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

    const updateCanvasSizeAndPosition = () => {
         const currentVvp = window.visualViewport;
        if (currentVvp) {
             c.width = currentVvp.width;
             c.height = currentVvp.height;
             c.style.width = currentVvp.width + 'px';
             c.style.height = currentVvp.height + 'px';
             c.style.top = currentVvp.offsetTop + 'px';
             c.style.left = currentVvp.offsetLeft + 'px';
        } else {
             c.width = window.innerWidth;
             c.height = window.innerHeight;
             c.style.width = window.innerWidth + 'px';
             c.style.height = window.innerHeight + 'px';
             c.style.top = '0px';
             c.style.left = '0px';
        }
        draw(); // Redraw immediately after resize/scroll
    };


     if (vvp) {
         vvp.addEventListener('resize', updateCanvasSizeAndPosition);
         vvp.addEventListener('scroll', updateCanvasSizeAndPosition); // Scroll can also change visual viewport position
     } else {
         window.addEventListener('resize', updateCanvasSizeAndPosition);
     }

    draw(); // Initial draw
    debug.log('Crosshair created (lime)');
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
        max-height: calc(100vh - 120px); /* Limit height to prevent overflow */
        overflow-y: auto; /* Add scroll if needed */
         scrollbar-width: thin; /* For Firefox */
         scrollbar-color: #555 #222; /* For Firefox */
    `;
     // Add basic scrollbar styling for webkit browsers
     gui.style.setProperty('&::-webkit-scrollbar', 'width: 8px;');
     gui.style.setProperty('&::-webkit-scrollbar-track', 'background: #222;');
     gui.style.setProperty('&::-webkit-scrollbar-thumb', 'background-color: #555; border-radius: 4px;');


    gui.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h2 style="margin:0;color:#6df;font-size:1.3em;">Wesd Ai Aimbot <span style="font-size:0.8em;font-weight:400;opacity:.6;">v${config.version} (KBM Fortnite)</span></h2>
          <button id="xcloudcheat-close" style="background:none;border:none;color:#faa;font-size:24px;font-weight:bold;cursor:pointer;padding:0 8px;line-height:1;margin-top:-5px;">×</button>
        </div>
        <div style="margin-bottom: 10px;">
            <span style="color:#68f;font-size:1em;">Status:</span>
            <span id="xcloudcheat-status" style="color:#fa5;font-weight:600;">Initializing...</span>
            <span style="float:right;color:#aaa;font-size:0.9em;font-style:italic;">Fortnite KBM Mode</span>
        </div>
        <hr style="border:1px solid #334; margin: 10px 0;">
        <div style="margin-bottom: 12px;">
            <label><input type="checkbox" id="detection-enabled" ${config.detection.enabled ? 'checked' : ''}> <b>Aimbot Active</b></label>
            <label style="margin-left:18px;"><input type="checkbox" id="auto-shoot" ${config.game.autoShoot ? 'checked' : ''}> Auto Shoot (on '${config.game.crouchKey.replace('Key','')} press')</label>
        </div>
         <div style="margin-bottom: 12px;">
            <label><input type="checkbox" id="recoil-comp" ${config.game.recoilCompensation ? 'checked' : ''}> Recoil Compensation</label>
             <label style="margin-left:18px;"><input type="checkbox" id="auto-reload" ${config.game.autoReload ? 'checked' : ''}> Auto Reload (on '${config.game.reloadKey.replace('Key','')} press')</label>
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Confidence: <span id="conf-val">${config.detection.confidence.toFixed(2)}</span></label>
          <input type="range" id="confidence" min="0.1" max="0.9" step="0.01" style="width:60%;" value="${config.detection.confidence}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Aim Interval: <span id="interval-val">${config.game.aimInterval}</span>ms</label>
          <input type="range" id="aim-interval" min="30" max="200" step="5" style="width:60%;" value="${config.game.aimInterval}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">FOV Radius: <span id="fov-val">${config.game.fovRadius}</span>px</label>
          <input type="range" id="fov-radius" min="50" max="800" step="10" style="width:60%;" value="${config.game.fovRadius}">
        </div>
        <div class="xcloudcheat-row" style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
          <label style="flex-grow: 1;">Target Priority:</label>
            <select id="target-priority" style="width:60%; padding: 4px; border-radius: 4px; border: 1px solid #555; background: #333; color: #eee;">
              <option value="closest" ${config.aim.targetPriority === "closest" ? 'selected' : ''}>Closest to Crosshair</option>
              <option value="center" ${config.aim.targetPriority === "center" ? 'selected' : ''}>Closest to Screen Center</option>
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
          <label><input type="checkbox" id="draw-boxes" ${config.boundingBoxes.enabled ? 'checked' : ''}> Bounding Boxes</label>
          <label style="margin-left:18px;"><input type="checkbox" id="draw-fov" ${config.fovCircle.enabled ? 'checked' : ''}> FOV Circle</label>
           <label style="margin-left:18px;"><input type="checkbox" id="log-movement" ${config.debug.logMovement ? 'checked' : ''}> Log Movement</label>
        </div>
        <div style="margin-top: 12px; margin-bottom: 6px; color:#5df; font-size: 1.1em;">Info</div>
         <div style="font-size:1em;line-height:1.6;background:#171b2c;border-radius:8px;padding:8px 12px;margin-bottom:10px; word-break: break-word;">
             <b>AI Backend:</b> <span id="backend-status" style="color:#ff0;">Checking...</span> <br> <!-- Initial state -->
             <b>Script Mouse Pos:</b> <span id="script-mouse-pos" style="color:#fff;">N/A</span><br>
             <b>KBM Mappings (Fortnite):</b> <br>
                <b>Auto-Shoot Trigger:</b> <span style="color:#fff;background:#2e4;padding:1px 6px;border-radius:4px;font-family:monospace;">${config.game.crouchKey.replace('Key','')}</span> <br>
                <b>Reload Trigger:</b> <span style="color:#fff;background:#f73;padding:1px 6px;border-radius:4px;font-family:monospace;">${config.game.reloadKey.replace('Key','')}</span> <br>
                <b>Inventory Slots (Game Default):</b> <span style="color:#fff;background:#39f;padding:1px 5px;border-radius:3px;font-family:monospace;">1-7</span>
         </div>
        <div style="margin-top:10px;text-align:right;">
          <span style="font-size:12px;color:#bbb;">TensorFlow.js / Coco SSD</span>
        </div>
    `;
    document.body.appendChild(gui);
    document.getElementById('xcloudcheat-close').onclick = () => gui.remove();

    const statusSpan = document.getElementById('xcloudcheat-status');
    const backendSpan = document.getElementById('backend-status');
     const mousePosSpan = document.getElementById('script-mouse-pos');

     // Function to update mouse position display
     const updateMousePosDisplay = () => {
         if (mousePosSpan) {
             mousePosSpan.textContent = `${InputSimulator.mousePos.x.toFixed(0)}, ${InputSimulator.mousePos.y.toFixed(0)}`;
         }
     };

    document.getElementById('detection-enabled').onchange = (e) => {
        config.detection.enabled = e.target.checked;
        statusSpan.textContent = config.detection.enabled ? 'Active' : 'Inactive';
        statusSpan.style.color = config.detection.enabled ? '#5f5' : '#fa5';
        if (!config.detection.enabled && InputSimulator.isShooting) {
            InputSimulator.stopShooting(); // Stop shooting if aimbot is disabled while shooting
        }
         // If enabling detection, give feedback
         if(config.detection.enabled) debug.log("Aimbot Enabled"); else debug.log("Aimbot Disabled");
    };
    document.getElementById('auto-shoot').onchange = (e) => {
        config.game.autoShoot = e.target.checked;
        if (!config.game.autoShoot && InputSimulator.isShooting) {
            InputSimulator.stopShooting(); // Stop shooting if auto-shoot is disabled while shooting
        }
    };
    document.getElementById('recoil-comp').onchange = (e) => config.game.recoilCompensation = e.target.checked;
    document.getElementById('auto-reload').onchange = (e) => config.game.autoReload = e.target.checked;
    document.getElementById('draw-boxes').onchange = (e) => config.boundingBoxes.enabled = e.target.checked;
    document.getElementById('draw-fov').onchange = (e) => config.fovCircle.enabled = e.target.checked;
    document.getElementById('log-movement').onchange = (e) => debug.logMovement = config.debug.logMovement = e.target.checked; // Update both config and debug object

    document.getElementById('confidence').oninput = (e) => {
        config.detection.confidence = parseFloat(e.target.value);
        document.getElementById('conf-val').textContent = config.detection.confidence.toFixed(2);
    };
    document.getElementById('aim-interval').oninput = (e) => {
        config.game.aimInterval = parseInt(e.target.value, 10);
        document.getElementById('interval-val').textContent = config.game.aimInterval;
        debug.log(`Aim Interval set to ${config.game.aimInterval}ms`);
    };
    document.getElementById('fov-radius').oninput = (e) => {
        config.game.fovRadius = parseInt(e.target.value, 10);
        document.getElementById('fov-val').textContent = config.game.fovRadius;
        debug.log(`FOV Radius set to ${config.game.fovRadius}px`);
         // Redraw overlay immediately to show updated FOV circle
         drawOverlay(lastPredictions || []);
    };
    document.getElementById('target-priority').onchange = (e) => config.aim.targetPriority = e.target.value;
    document.getElementById('aim-point').onchange = (e) => config.aim.aimPoint = e.target.value;
    document.getElementById('recoil-level').onchange = (e) => config.game.recoilLevel = parseInt(e.target.value, 10);


    // Initial status messages
     statusSpan.textContent = config.detection.enabled ? 'Active' : 'Inactive';
     statusSpan.style.color = config.detection.enabled ? '#5f5' : '#fa5';
     backendSpan.textContent = 'Checking...'; // Initial state
     backendSpan.style.color = '#ff0'; // Initial state color
     updateMousePosDisplay(); // Initial mouse pos display

     // Keep mouse position display updated periodically
     setInterval(updateMousePosDisplay, 100);


    debug.log("GUI Created (KBM Mode, Coco SSD)");
}

async function findGameVideoAndInit() {
     // Double-check libraries are present before proceeding with AI/TF.js
     if (typeof tf === 'undefined' || typeof cocoSsd === 'undefined' || typeof cocoSsd.load === 'undefined') {
         console.error("[XcloudCheat] ERROR: TensorFlow.js (tf) or CocoSSD (cocoSsd) libraries not found in global scope when trying to init!");
         alert("Critical libraries not found. Aimbot cannot start. Ensure libraries were loaded manually before running the main script.");
         if (document.getElementById('xcloudcheat-status')) {
              document.getElementById('xcloudcheat-status').textContent = 'Lib Error';
              document.getElementById('xcloudcheat-status').style.color = '#faa';
         }
          // Update backend status in GUI to reflect the error
          const backendSpan = document.getElementById('backend-status');
          if (backendSpan) {
               backendSpan.textContent = 'TF.js Missing!';
               backendSpan.style.color = '#faa';
          }
         return; // Stop initialization process
     }


    gameVideo = document.querySelector(config.game.videoSelector);
    // Check for video readiness and positive dimensions
    if (gameVideo && gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
        debug.log(`Game video found and ready: ${gameVideo.videoWidth}x${gameVideo.videoHeight}`);
        try {
            if (!detectionModel) {
                debug.log("Loading Coco SSD model for Fortnite...");

                // --- Explicitly set backend to WebGL (GPU) ---
                debug.log(`Attempting to set TF.js backend to 'webgl'... Current: ${tf.getBackend()}`);
                await tf.setBackend('webgl').then(() => {
                    debug.log(`TF.js backend successfully set to: ${tf.getBackend()}`);
                    // Update GUI backend status if GUI exists *after* setting backend
                    const backendSpan = document.getElementById('backend-status');
                    if (backendSpan) {
                        backendSpan.textContent = tf.getBackend().toUpperCase();
                        backendSpan.style.color = tf.getBackend() === 'webgl' ? '#5f5' : '#ff0';
                    }
                }).catch((err) => {
                    debug.warn(`Failed to set TF.js backend to 'webgl'. Falling back to '${tf.getBackend()}'. Error:`, err);
                    // Update GUI backend status on failure *after* attempting backend set
                    const backendSpan = document.getElementById('backend-status');
                    if (backendSpan) {
                        backendSpan.textContent = tf.getBackend().toUpperCase() + " (Fallback)";
                        backendSpan.style.color = '#fa5'; // Indicate a warning state
                    }
                });
                // ---------------------------------------------

                detectionModel = await cocoSsd.load({ base: 'mobilenet_v2' });
                debug.log("Coco SSD model (mobilenet_v2) loaded successfully.");
            } else {
                debug.log("Coco SSD model already loaded.");
                 // If model was already loaded, update backend status in GUI anyway
                 const backendSpan = document.getElementById('backend-status');
                 if (backendSpan && typeof tf !== 'undefined') {
                      backendSpan.textContent = tf.getBackend().toUpperCase();
                      backendSpan.style.color = tf.getBackend() === 'webgl' ? '#5f5' : '#ff0';
                 }
            }

            // Initialize input simulator, create canvases *after* video is found and model loaded
            // GUI is created by the init function itself at the very end of the script block
            if (InputSimulator.init()) {
                createOverlayCanvas();
                createCrosshair(); // createCrosshair is defined globally by the main script block
                startAimLoop(); // Start the main aim processing loop
                // Update GUI status to Active
                if (document.getElementById('xcloudcheat-status')) {
                    document.getElementById('xcloudcheat-status').textContent = config.detection.enabled ? 'Active' : 'Inactive';
                    document.getElementById('xcloudcheat-status').style.color = config.detection.enabled ? '#5f5' : '#fa5';
                }
            } else {
                debug.error("InputSimulator initialization failed. Cannot proceed.");
                if (document.getElementById('xcloudcheat-status')) {
                    document.getElementById('xcloudcheat-status').textContent = 'Input Error';
                    document.getElementById('xcloudcheat-status').style.color = '#faa';
                }
            }
        } catch (err) {
            debug.error("Fatal Error during initialization (likely model loading):", err);
            alert("Failed to load Coco SSD model or initialize. Aimbot cannot function. Check console (F12) for errors.");
            config.detection.enabled = false; // Disable aimbot on fatal error
            if (document.getElementById('xcloudcheat-status')) {
                document.getElementById('xcloudcheat-status').textContent = 'Init Error';
                document.getElementById('xcloudcheat-status').style.color = '#faa';
            }
             // Update backend status in GUI to reflect the error
             const backendSpan = document.getElementById('backend-status');
             if (backendSpan && typeof tf !== 'undefined') { // Check tf again just in case
                  backendSpan.textContent = tf.getBackend().toUpperCase() + " (Load Failed)";
                  backendSpan.style.color = '#faa'; // Error state color
             } else if (backendSpan) {
                   backendSpan.textContent = 'Model Load Failed!';
                   backendSpan.style.color = '#faa';
             }
        }
    } else {
        // Video not found or not ready, retry
        const status = gameVideo ? `readyState=${gameVideo.readyState}, dims=${gameVideo.videoWidth}x${gameVideo.videoHeight}` : 'not found';
        debug.log(`Game video not ready (${status}), retrying in 1.5s...`);
        setTimeout(findGameVideoAndInit, 1500);
    }
}

// Main aim processing loop
function startAimLoop() {
    debug.log(`Starting main aim loop (KBM, Coco SSD) with ${config.game.aimInterval}ms minimum interval...`);
    let lastProcessingTime = 0; // Tracks time when last detection/processing finished

    function loop(currentTime) {
        requestAnimationFrame(loop);

        const now = performance.now();
        utils.fps.update(); // Update FPS every frame

        // Draw overlay using the last available predictions every frame
        if (gameVideo && !gameVideo.paused && !gameVideo.ended) {
            drawOverlay(lastPredictions || []);
        }

        // Check if detection/processing is currently running or if aimbot is disabled
        if (processingFrame || !config.detection.enabled || !detectionModel || !gameVideo || gameVideo.paused || gameVideo.ended || gameVideo.videoWidth === 0) {
             // If aimbot disabled or video paused/ended, stop shooting
             if (!config.detection.enabled || gameVideo.paused || gameVideo.ended) {
                 if (InputSimulator.isShooting) InputSimulator.stopShooting();
                 currentTarget = null;
                 bestTarget = null;
                 // Keep lastPredictions for drawing potentially stale boxes? Or clear? Let's keep for now.
             }
            return; // Skip processing this frame
        }

        const timeSinceLastProcessing = now - lastProcessingTime;

        // Run detection/processing only if enough time has passed based on aimInterval
        if (timeSinceLastProcessing >= config.game.aimInterval) {
            lastProcessingTime = now; // Update the time marker
            // Use an immediately invoked async function to run the detection without blocking the main loop
            (async () => {
                 processingFrame = true;
                 let predictions = [];
                 try {
                     // Ensure video is ready for detection
                     if (gameVideo.readyState >= 2 && gameVideo.videoWidth > 0 && gameVideo.videoHeight > 0) {
                         predictions = await detectionModel.detect(gameVideo, config.detection.maxDetections, config.detection.confidence);
                         lastPredictions = predictions; // Store fresh predictions
                     } else {
                         debug.warn("Video not ready for detection this frame.");
                         // Use lastPredictions for logic if video isn't ready
                         predictions = lastPredictions || [];
                     }
                     // Process detections regardless of whether new detections were made (allows target locking)
                     processPredictions(predictions.filter(p => p.class === config.detection.targetClass));

                 } catch (e) {
                     debug.error('Detection or Processing Error in aimLoop:', e);
                     // On error, stop shooting and clear target state
                     if (InputSimulator.isShooting) InputSimulator.stopShooting();
                     currentTarget = null;
                     bestTarget = null;
                     lastPredictions = []; // Clear predictions on error? Or keep stale? Let's clear.
                     // Optionally disable detection to prevent continuous errors
                     // config.detection.enabled = false;
                     // if (document.getElementById('xcloudcheat-status')) {
                     //      document.getElementById('xcloudcheat-status').textContent = 'Runtime Error';
                     //      document.getElementById('xcloudcheat-status').style.color = '#faa';
                     // }
                 } finally {
                     processingFrame = false; // Allow the next processing cycle
                 }
            })(); // Execute the async detection function immediately
        }
         // Even if detection didn't run, the recoil offset decay needs to happen
         // and the script's internal mouse position needs to converge if not shooting.
         // This is handled within moveMouseTo, but moveMouseTo is only called if there's a target.
         // Let's add recoil decay when no target is present or not shooting but target exists.
         if (!currentTarget && (InputSimulator.recoilOffset.x !== 0 || InputSimulator.recoilOffset.y !== 0)) {
              const recoil = config.game.recoilPatterns[config.game.recoilLevel];
              const recovery = recoil?.recoverySpeed * 3 || 0.3; // Faster recovery
              InputSimulator.recoilOffset.x *= (1 - recovery);
              InputSimulator.recoilOffset.y *= (1 - recovery);
              if (Math.abs(InputSimulator.recoilOffset.x) < 0.05) InputSimulator.recoilOffset.x = 0;
              if (Math.abs(InputSimulator.recoilOffset.y) < 0.05) InputSimulator.recoilOffset.y = 0;
         }
          // If there is a target but autoShoot is off, recoil compensation part of moveMouseTo still runs, handling decay.
    }
    loop(performance.now()); // Start the requestAnimationFrame loop
}


function processPredictions(targets) {
    const videoRect = gameVideo.getBoundingClientRect();

     // Calculate screen center based on visual viewport for consistent FOV checks and screen-relative priority
    const screenCenterX = window.visualViewport ? window.visualViewport.width / 2 + window.visualViewport.pageLeft : window.innerWidth / 2;
    const screenCenterY = window.visualViewport ? window.visualViewport.height / 2 + window.visualViewport.pageTop + (window.visualViewport.height - window.innerHeight) / 2 : window.innerHeight / 2; // Adjust for potential visual viewport offset


    // If no targets are detected this frame
    if (!targets || targets.length === 0) {
        if (currentTarget) debug.log("Target lost (No detections).");
        currentTarget = null;
        bestTarget = null; // Clear best target for drawing
        positionHistory = []; // Clear history
        if (InputSimulator.isShooting && config.game.autoShoot) { // Only stop shooting if auto-shoot is enabled
             InputSimulator.stopShooting();
         }
        return; // No target, no aiming this frame
    }

     // Recalculate displayed video area coordinates for accurate target position mapping
     const videoAspectRatio = gameVideo.videoWidth / gameVideo.videoHeight;
     const displayAspectRatio = videoRect.width / videoRect.height;

     let videoDisplayWidth = videoRect.width;
     let videoDisplayHeight = videoRect.height;
     let videoDisplayLeft = videoRect.left;
     let videoDisplayTop = videoRect.top;

     if (videoAspectRatio > displayAspectRatio) {
         // Video is wider than container, it's letterboxed vertically
         videoDisplayHeight = videoRect.width / videoAspectRatio;
         videoDisplayTop = videoRect.top + (videoRect.height - videoDisplayHeight) / 2;
     } else {
         // Video is taller than container, it's letterboxed horizontally
         videoDisplayWidth = videoRect.height * videoAspectRatio;
         videoDisplayLeft = videoRect.left + (videoRect.width - videoDisplayWidth) / 2;
     }


    let minScore = Infinity; // Lower score is better (closer/higher priority)
    let potentialTarget = null; // Temporary best target found this frame

    targets.forEach(target => {
        // Calculate target center in screen coordinates based on displayed video area
        const targetCenterX_video = target.bbox[0] + target.bbox[2] / 2;
        const targetCenterY_video = target.bbox[1] + target.bbox[3] / 2;

        const targetCenterX_screen = videoDisplayLeft + (targetCenterX_video / gameVideo.videoWidth) * videoDisplayWidth;
        const targetCenterY_screen = videoDisplayTop + (targetCenterY_video / gameVideo.videoHeight) * videoDisplayHeight;


        // Calculate distance based on selected priority
        let evalCenterX, evalCenterY;
        if (config.aim.targetPriority === "center") {
            // Priority is closeness to screen center (based on visual viewport)
            evalCenterX = screenCenterX;
            evalCenterY = screenCenterY;
        } else { // targetPriority === "closest"
            // Priority is closeness to current script-tracked mouse position (crosshair)
            evalCenterX = InputSimulator.mousePos.x;
            evalCenterY = InputSimulator.mousePos.y;
        }

        const dx = targetCenterX_screen - evalCenterX;
        const dy = targetCenterY_screen - evalCenterY;
        const distanceToPriorityPoint = Math.hypot(dx, dy);

        // Check if target center is within the FOV circle on screen (FOV is centered on visual viewport center)
         const distToScreenCenter = Math.hypot(targetCenterX_screen - screenCenterX, targetCenterY_screen - screenCenterY);

        if (distToScreenCenter > config.game.fovRadius) {
             // debug.log(`Target outside FOV: ${distToScreenCenter.toFixed(0)}px > ${config.game.fovRadius}px`);
             return; // Skip targets outside FOV
         }

        // The score is the distance to the priority point (screen center or mouse pos)
        let score = distanceToPriorityPoint;

        if (score < minScore) {
            minScore = score;
            potentialTarget = target;
        }
    });

    // If no target is found within the FOV with the chosen priority after filtering
    if (!potentialTarget) {
        if (currentTarget) debug.log("Target lost (Out of FOV or no priority match).");
        currentTarget = null;
        bestTarget = null; // Clear best target for drawing
        positionHistory = [];
        if (InputSimulator.isShooting && config.game.autoShoot) {
             InputSimulator.stopShooting();
         }
        return; // No valid target found in this frame
    }

    // We found a potential target. Check if it's a new target.
    // Simple identity check based on bbox coordinates.
    if (!currentTarget || currentTarget.bbox[0] !== potentialTarget.bbox[0] || currentTarget.bbox[1] !== potentialTarget.bbox[1]) {
        // Calculate the distance from the target center to the visual viewport center for logging
         const targetCenterX_video_raw = potentialTarget.bbox[0] + potentialTarget.bbox[2] / 2;
         const targetCenterY_video_raw = potentialTarget.bbox[1] + potentialTarget.bbox[3] / 2;
         const targetCenterX_screen_raw = videoDisplayLeft + (targetCenterX_video_raw / gameVideo.videoWidth) * videoDisplayWidth;
         const targetCenterY_screen_raw = videoDisplayTop + (targetCenterY_video_raw / gameVideo.videoHeight) * videoDisplayHeight;
         const distToScreenCenterForLog = Math.hypot(targetCenterX_screen_raw - screenCenterX, targetCenterY_screen_raw - screenCenterY);


        debug.log(`New target acquired: ${potentialTarget.class} (${(potentialTarget.score*100).toFixed(1)}%), Priority Dist: ${minScore.toFixed(0)}px, FOV Dist: ${distToScreenCenterForLog.toFixed(0)}px`);
        // Clear history and potentially recoil offset on new target? Recoil offset reset is handled in startShooting.
        positionHistory = [];
    }
    currentTarget = potentialTarget; // Set the current target being tracked
    bestTarget = currentTarget; // Use for overlay drawing

    // --- Aiming Calculation ---
    // Calculate the specific aim point (center or head) in screen coordinates for the current target
     const bboxX_screen = videoDisplayLeft + (currentTarget.bbox[0] / gameVideo.videoWidth) * videoDisplayWidth;
     const bboxY_screen = videoDisplayTop + (currentTarget.bbox[1] / gameVideo.videoHeight) * videoDisplayHeight;
     const bboxW_screen = (currentTarget.bbox[2] / gameVideo.videoWidth) * videoDisplayWidth;
     const bboxH_screen = (currentTarget.bbox[3] / gameVideo.videoHeight) * videoDisplayHeight;

    let aimScreenX, aimScreenY;
    if (config.aim.aimPoint === "top") {
        // Aim slightly below the top of the box for potential headshot
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen * 0.15; // 15% down from the top
    } else { // aim.aimPoint === "center"
        aimScreenX = bboxX_screen + bboxW_screen / 2;
        aimScreenY = bboxY_screen + bboxH_screen / 2;
    }

    // --- Perform Mouse Movement ---
    // This is the core part to fix continuous aiming.
    InputSimulator.moveMouseTo(aimScreenX, aimScreenY);

    // --- Auto-Shoot Handling ---
     // Auto-shoot start/stop is handled by the keydown/keyup listeners for the crouch key
     // combined with the check for config.game.autoShoot.
     // No extra start/stop calls are needed here based purely on target presence,
     // as the design is "shoot WHEN crouch is held AND IF target exists".
     // The check for target existence is implicit because processPredictions only gets here
     // if a target was found within the FOV.
     // The key listener already checks config.game.autoShoot before calling start/stop.
     // So, if config.game.autoShoot is FALSE, startShooting/stopShooting are never called from the listener.
     // We only need to ensure that if autoShoot is turned OFF via the GUI *while* shooting, it stops.
     if (!config.game.autoShoot && InputSimulator.isShooting) {
          // If autoShoot is turned OFF via GUI while user was holding crouch and shooting, stop shooting.
           InputSimulator.stopShooting();
     }
}

// --- Initialization ---
// This self-executing function starts the entire process.
// It assumes tf and cocoSsd are already available globally when this code block is run.
(function init() {
    console.log(`[XcloudCheat v${config.version} KBM Aimbot with Coco SSD] Initializing... (Manual Load Mode)`);

    // Create GUI first so loading status can be displayed immediately
    createGUI();

    // Start the process of finding the game video and initializing AI
    // This will check for TF/CocoSSD availability again before proceeding
    setTimeout(findGameVideoAndInit, 1000);
})();
