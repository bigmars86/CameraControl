/**
 * UI Controller
 * Handles user interface interactions, keyboard controls, and event listeners
 */

class UIController {
    constructor(camera, presetManager, languageManager, settings) {
        this.camera = camera;
        this.presets = presetManager;
        this.lang = languageManager;
        this.settings = settings;
        this.pressedKeys = new Set();
        this._activePTZAction = null;
    }

    init() {
        this.setupEventListeners();
        this.setupKeyboardControls();
        this.setupPTZControls();
        this.setupSpeedControls();
    }

    setupEventListeners() {
        // Configuration modal
        const configBtn = document.getElementById('configBtn');
        const configModal = document.getElementById('configModal');
        const closeBtn = document.querySelector('.close');
        const configForm = document.getElementById('configForm');

        configBtn?.addEventListener('click', () => {
            this.camera.updateConfigFields();
            configModal.style.display = 'block';
        });

        closeBtn?.addEventListener('click', () => {
            configModal.style.display = 'none';
        });

        window.addEventListener('click', (event) => {
            if (event.target === configModal) {
                configModal.style.display = 'none';
            }
        });

        configForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            const formData = {
                cameraIP: document.getElementById('cameraIP')?.value,
                username: document.getElementById('username')?.value,
                password: document.getElementById('password')?.value,
                retryInterval: document.getElementById('retryInterval')?.value,
                maxDelay: document.getElementById('maxDelay')?.value,
            };
            this.camera.updateConfig(formData);
        });
    }

    stopActivePTZ(sendFallback = false) {
        if (this._activePTZAction && this._activePTZAction !== 'stop') {
            this.camera.handleCameraAction(this._activePTZAction, false);
        } else if (sendFallback) {
            this.camera.handleCameraAction('stop', false);
        }

        this._activePTZAction = null;
        document.querySelectorAll('.btn-pressed').forEach((button) => {
            button.classList.remove('btn-pressed');
        });
    }

    setupPTZControls() {
        const ptzButtons = document.querySelectorAll('[data-action]');

        ptzButtons.forEach((button) => {
            const action = button.getAttribute('data-action');

            // Mouse events
            button.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this._activePTZAction = action;
                this.camera.handleCameraAction(action, true);
                button.classList.add('btn-pressed');
            });

            button.addEventListener('mouseup', () => {
                this.stopActivePTZ();
            });

            button.addEventListener('mouseleave', () => {
                button.classList.remove('btn-pressed');
            });

            // Touch events for mobile
            button.addEventListener('touchstart', (e) => {
                e.preventDefault();
                this._activePTZAction = action;
                this.camera.handleCameraAction(action, true);
                button.classList.add('btn-pressed');
            });

            button.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.stopActivePTZ();
            });

            button.addEventListener('touchcancel', () => {
                this.stopActivePTZ(true);
            });

            button.addEventListener('contextmenu', (event) => {
                event.preventDefault();
            });
        });

        // Global mouseup to catch missed releases
        document.addEventListener('mouseup', () => {
            this.stopActivePTZ();
        });

        document.addEventListener(
            'touchend',
            () => {
                this.stopActivePTZ();
            },
            { passive: true },
        );

        document.addEventListener(
            'touchcancel',
            () => {
                this.stopActivePTZ(true);
            },
            { passive: true },
        );
    }

    setupSpeedControls() {
        // 'input' applies while dragging, 'change' (on release) saves
        for (const name of ['panSpeed', 'tiltSpeed', 'zoomSpeed']) {
            const slider = document.getElementById(name);
            slider?.addEventListener('input', (event) => {
                this.camera[name] = parseInt(event.target.value);
                document.getElementById(`${name}Value`).textContent = this.camera[name];
            });
            slider?.addEventListener('change', () => {
                this.settings.save({ [name]: this.camera[name] });
            });
        }
    }

    setupKeyboardControls() {
        document.addEventListener('keydown', (event) => {
            if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
                return;
            }
            // All shortcuts drive the camera
            if (!this.camera.isConnected) {
                return;
            }

            const key = event.key.toLowerCase();
            const code = event.code;

            const numpadControlKeys = [
                'Numpad1',
                'Numpad2',
                'Numpad3',
                'Numpad4',
                'Numpad5',
                'Numpad6',
                'Numpad7',
                'Numpad8',
                'Numpad9',
                'NumpadAdd',
                'NumpadSubtract',
            ];

            if (numpadControlKeys.includes(code)) {
                event.preventDefault();
                if (this.pressedKeys.has(code)) return;
                this.pressedKeys.add(code);
            }

            this.handleKeyboardInput(key, code, true);
            this.updateKeyboardVisualFeedback(code, true);
        });

        document.addEventListener('keyup', (event) => {
            const code = event.code;
            this.pressedKeys.delete(code);

            const numpadControlKeys = [
                'Numpad1',
                'Numpad2',
                'Numpad3',
                'Numpad4',
                'Numpad5',
                'Numpad6',
                'Numpad7',
                'Numpad8',
                'Numpad9',
                'NumpadAdd',
                'NumpadSubtract',
            ];
            if (numpadControlKeys.includes(code)) {
                this.handleKeyboardInput('', code, false);
            }

            this.updateKeyboardVisualFeedback(code, false);
        });

        window.addEventListener('blur', () => {
            this.pressedKeys.clear();
            this.stopActivePTZ(true);
            this.clearAllKeyboardVisualFeedback();
        });
    }

    updateKeyboardVisualFeedback(code, isPressed) {
        const codeMappings = {
            Numpad7: '[data-action="pan-up-left"]',
            Numpad8: '[data-action="tilt-up"]',
            Numpad9: '[data-action="pan-up-right"]',
            Numpad4: '[data-action="pan-left"]',
            Numpad5: '[data-action="stop"]',
            Numpad6: '[data-action="pan-right"]',
            Numpad1: '[data-action="pan-down-left"]',
            Numpad2: '[data-action="tilt-down"]',
            Numpad3: '[data-action="pan-down-right"]',
            NumpadAdd: '[data-action="zoom-in"]',
            NumpadSubtract: '[data-action="zoom-out"]',
        };

        const selector = codeMappings[code];
        if (selector) {
            const button = document.querySelector(selector);
            if (button) {
                if (isPressed) {
                    button.classList.add('keyboard-active');
                } else {
                    button.classList.remove('keyboard-active');
                }
            }
        }
    }

    clearAllKeyboardVisualFeedback() {
        document.querySelectorAll('.keyboard-active').forEach((button) => {
            button.classList.remove('keyboard-active');
        });
    }

    handleKeyboardInput(key, code, isKeyDown) {
        const numpadMappings = {
            Numpad7: 'pan-up-left',
            Numpad8: 'tilt-up',
            Numpad9: 'pan-up-right',
            Numpad4: 'pan-left',
            Numpad5: 'stop',
            Numpad6: 'pan-right',
            Numpad1: 'pan-down-left',
            Numpad2: 'tilt-down',
            Numpad3: 'pan-down-right',
            NumpadAdd: 'zoom-in',
            NumpadSubtract: 'zoom-out',
        };

        if (numpadMappings[code]) {
            this.camera.handleCameraAction(numpadMappings[code], isKeyDown);
            return;
        }

        if (isKeyDown) {
            if (this.presets.presetKeyBindings[key]) {
                this.camera.callPreset(this.presets.presetKeyBindings[key]);
                this.presets.highlightPresetByKey(key);
                return;
            }

            if (key >= '0' && key <= '9') {
                if (this.presets.presetKeyBindings[key]) {
                    this.camera.callPreset(this.presets.presetKeyBindings[key]);
                    this.presets.highlightPresetByKey(key);
                } else {
                    const presetNumber = key === '0' ? 10 : parseInt(key);
                    this.camera.callPreset(presetNumber);
                    this.presets.highlightPresetByNumber(presetNumber);
                }
            }
        }
    }
}

window.UIController = UIController;
