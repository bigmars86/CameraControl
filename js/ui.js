/**
 * UI Controller
 * Settings dialog, PTZ buttons and keyboard shortcuts
 */

// Keyboard shortcuts (KeyboardEvent.code) -> camera action; the numpad works like a phone keypad
const KEY_ACTIONS = {
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
    ArrowUp: 'tilt-up',
    ArrowDown: 'tilt-down',
    ArrowLeft: 'pan-left',
    ArrowRight: 'pan-right',
    PageUp: 'zoom-in',
    PageDown: 'zoom-out',
    Space: 'stop',
};

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
        this.setupSettingsDialog();
        this.setupKeyboardControls();
        this.setupPTZControls();
        this.setupSpeedControls();
    }

    openSettings() {
        this.camera.updateConfigFields();
        document.getElementById('browser').value = this.settings.get('browser');
        document.getElementById('port').value = this.settings.get('port');
        document.getElementById('presetFolderPath').textContent = this.presets.folder;
        document.getElementById('configModal').style.display = 'block';
    }

    setupSettingsDialog() {
        const configModal = document.getElementById('configModal');
        const close = () => {
            configModal.style.display = 'none';
        };

        document.getElementById('configBtn')?.addEventListener('click', () => this.openSettings());
        configModal.querySelector('.close')?.addEventListener('click', close);
        configModal.addEventListener('click', (event) => {
            if (event.target === configModal) close();
        });
        document.getElementById('openPresetFolder')?.addEventListener('click', () => {
            fetch('api/presets/folder', { method: 'POST' }).catch((error) => console.error(error));
        });

        document.getElementById('configForm')?.addEventListener('submit', (event) => {
            event.preventDefault();
            const formData = {
                cameraIP: document.getElementById('cameraIP')?.value,
                username: document.getElementById('username')?.value,
                password: document.getElementById('password')?.value,
                retryInterval: document.getElementById('retryInterval')?.value,
                maxDelay: document.getElementById('maxDelay')?.value,
                browser: document.getElementById('browser')?.value,
                port: document.getElementById('port')?.value,
            };
            this.camera.updateConfig(formData);
        });
    }

    // Escape closes the topmost dialog; a pending confirmation counts as cancelled
    closeDialogs() {
        if (document.getElementById('confirmDialog').style.display !== 'none') {
            document.getElementById('confirmNo').click();
            return;
        }
        for (const id of ['presetDialog', 'configModal']) {
            document.getElementById(id).style.display = 'none';
        }
    }

    isDialogOpen() {
        return ['configModal', 'presetDialog', 'confirmDialog'].some((id) => {
            const display = document.getElementById(id).style.display;
            return display !== '' && display !== 'none';
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
            if (event.key === 'Escape') {
                this.closeDialogs();
                return;
            }
            if (this.isDialogOpen() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
                return;
            }
            // All shortcuts drive the camera
            if (!this.camera.isConnected || event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }

            const action = KEY_ACTIONS[event.code];
            if (action) {
                event.preventDefault();
                if (this.pressedKeys.has(event.code)) return; // key repeat
                this.pressedKeys.add(event.code);
                this.camera.handleCameraAction(action, true);
                this.setKeyFeedback(action, true);
                return;
            }

            // Preset hotkeys; digits without a hotkey call slot 1-9 (0 = slot 10)
            const key = event.key.toLowerCase();
            const slot = this.presets.presetKeyBindings[key] || (/^[0-9]$/.test(key) ? Number(key) || 10 : 0);
            if (slot && !event.repeat) {
                this.camera.callPreset(slot);
                this.presets.highlightPreset(slot);
            }
        });

        document.addEventListener('keyup', (event) => {
            if (!this.pressedKeys.delete(event.code)) return;
            event.preventDefault();
            const action = KEY_ACTIONS[event.code];
            this.camera.handleCameraAction(action, false);
            this.setKeyFeedback(action, false);
        });

        window.addEventListener('blur', () => {
            this.pressedKeys.clear();
            this.stopActivePTZ(true);
            document.querySelectorAll('.keyboard-active').forEach((element) => {
                element.classList.remove('keyboard-active');
            });
        });
    }

    setKeyFeedback(action, active) {
        document.querySelector(`[data-action="${action}"]`)?.classList.toggle('keyboard-active', active);
    }
}

window.UIController = UIController;
