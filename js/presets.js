/**
 * Preset Manager
 * A preset is a camera position slot (1-255) with a picture in the data folder. The picture's file name holds
 * the slot and an optional hotkey: "5.jpg" (slot 5) or "1-5.jpg" (key 1 calls slot 5).
 */

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

class PresetManager {
    constructor(cameraController, languageManager) {
        this.camera = cameraController;
        this.lang = languageManager;
        this.presets = [];
        this.folder = '';
        this.presetKeyBindings = {};
    }

    t(key, fallback) {
        return this.lang ? this.lang.get(key, fallback) : fallback;
    }

    init() {
        const dialog = document.getElementById('presetDialog');
        dialog.querySelectorAll('[data-close]').forEach((element) => {
            element.addEventListener('click', () => this.closeAddDialog());
        });
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) this.closeAddDialog();
        });
        document.getElementById('presetForm').addEventListener('submit', (event) => {
            event.preventDefault();
            this.submitAddDialog();
        });
    }

    getIconSvg(state) {
        // Drawn on a 16px grid and rendered at 16px, so straight edges land on whole pixels (crisp)
        const strokeAttrs =
            'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

        switch (state) {
            case 'loading':
                return `<svg ${strokeAttrs}><path d="M14 8a6 6 0 1 1-6-6"/></svg>`;
            case 'success':
                return `<svg ${strokeAttrs}><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>`;
            case 'error':
                return `<svg ${strokeAttrs}><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
            case 'delete':
                return `<svg ${strokeAttrs}><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4"/></svg>`;
            case 'add':
                return `<svg ${strokeAttrs}><path d="M8 3v10M3 8h10"/></svg>`;
            case 'save':
            default:
                // Solid floppy disk with shutter and label cut out
                return '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3 1h8.5L15 4.5V13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm1 2v3h6V3zm0 7v3h8v-3z"/></svg>';
        }
    }

    setSaveButtonState(btn, state, forceVisible = false) {
        const titles = {
            save: this.t('presets.saveTooltip', 'Store the current position'),
            loading: this.t('presets.savingTooltip', 'Saving...'),
            success: this.t('presets.savedTooltip', 'Saved'),
            error: this.t('presets.saveFailedTooltip', 'Saving failed'),
        };

        btn.dataset.state = state;
        btn.innerHTML = this.getIconSvg(state);
        btn.title = titles[state] || titles.save;
        btn.setAttribute('aria-label', btn.title);
        btn.classList.toggle('state-visible', forceVisible);
    }

    async loadPresets() {
        try {
            const response = await fetch('api/presets', { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            this.folder = data.folder || '';
            this.presets = data.presets || [];
        } catch (error) {
            console.error('Loading presets failed:', error);
            this.presets = [];
        }
        this.render();
    }

    // Presets with a hotkey first (ordered by key), then the others (ordered by slot)
    render() {
        const grid = document.getElementById('presetsGrid');
        if (!grid) return;

        const sortKey = (preset) => (preset.key ? `0${preset.key}` : `1${String(preset.slot).padStart(3, '0')}`);
        const presets = [...this.presets].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

        grid.innerHTML = '';
        this.presetKeyBindings = {};
        if (!presets.length) {
            const message = document.createElement('p');
            message.className = 'preset-message';
            message.textContent = this.t(
                'presets.empty',
                'No presets yet. Point the camera at a position, then click + to save it with a picture.',
            );
            grid.appendChild(message);
        }
        for (const preset of presets) {
            grid.appendChild(this.createPresetItem(preset));
            if (preset.key) {
                this.presetKeyBindings[preset.key] = preset.slot;
            }
        }
        grid.appendChild(this.createAddButton());
    }

    createPresetItem(preset) {
        const item = document.createElement('div');
        item.className = 'preset-item';
        item.dataset.preset = preset.slot;
        item.addEventListener('click', () => this.callPreset(preset.slot));

        const img = document.createElement('img');
        img.src = `presets/${encodeURIComponent(preset.file)}`;
        img.alt = `${this.t('presets.title', 'Presets')} ${preset.slot}`;

        const badge = document.createElement('div');
        badge.className = 'preset-number';
        badge.textContent = preset.key || preset.slot;

        const deleteBtn = this.createButton(
            'preset-delete-btn',
            'delete',
            this.t('presets.deleteTooltip', 'Remove preset'),
        );
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.confirmAndDeletePreset(preset.slot);
        });

        const saveBtn = this.createButton('preset-save-btn', 'save', '');
        this.setSaveButtonState(saveBtn, 'save');
        saveBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this.confirmAndSavePreset(preset.slot, saveBtn);
        });

        item.append(img, badge, deleteBtn, saveBtn);
        return item;
    }

    createAddButton() {
        const button = this.createButton('preset-add', 'add', this.t('presets.addTooltip', 'Add preset'));
        button.addEventListener('click', () => this.openAddDialog());
        return button;
    }

    createButton(className, icon, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.innerHTML = this.getIconSvg(icon);
        button.title = title;
        button.setAttribute('aria-label', title);
        return button;
    }

    openAddDialog() {
        document.getElementById('presetForm').reset();
        document.getElementById('presetSlot').value = this.nextFreeSlot();
        const storePosition = document.getElementById('presetStorePosition');
        storePosition.checked = this.camera.isConnected;
        storePosition.disabled = !this.camera.isConnected;
        this.showDialogError('');
        document.getElementById('presetDialog').style.display = 'block';
        document.getElementById('presetSlot').focus();
    }

    closeAddDialog() {
        document.getElementById('presetDialog').style.display = 'none';
    }

    nextFreeSlot() {
        const used = new Set(this.presets.map((preset) => preset.slot));
        for (let slot = 1; slot <= 255; slot++) {
            if (!used.has(slot)) return slot;
        }
        return 1;
    }

    showDialogError(message) {
        const error = document.getElementById('presetError');
        error.textContent = message;
        error.hidden = !message;
    }

    async submitAddDialog() {
        const slot = Number(document.getElementById('presetSlot').value);
        const key = document.getElementById('presetKey').value.trim().toLowerCase();
        const file = document.getElementById('presetImage').files[0];
        const storePosition = document.getElementById('presetStorePosition').checked;

        if (!Number.isInteger(slot) || slot < 1 || slot > 255) {
            this.showDialogError(this.t('presets.errorSlot', 'Enter a preset number from 1 to 255.'));
            return;
        }
        if (!/^[0-9a-z]?$/.test(key)) {
            this.showDialogError(this.t('presets.errorKey', 'The hotkey must be a single letter or digit.'));
            return;
        }
        const owner = this.presets.find((preset) => key && preset.key === key && preset.slot !== slot);
        if (owner) {
            const message = this.t('presets.errorKeyInUse', 'Key {key} is already used by preset {preset}.');
            this.showDialogError(message.replace('{key}', key).replace('{preset}', owner.slot));
            return;
        }
        if (file && file.size > MAX_IMAGE_BYTES) {
            this.showDialogError(this.t('presets.errorFileSize', 'The picture must be smaller than 5 MB.'));
            return;
        }

        // Taken first, while the preview still shows the position to store
        const image = file || (await this.camera.captureFrame());
        if (!image) {
            this.showDialogError(
                this.t('presets.errorNoImage', 'No preview picture available. Choose a picture file.'),
            );
            return;
        }
        if (this.presets.some((preset) => preset.slot === slot)) {
            const message = this.t('presets.confirmReplace', 'Preset {preset} already exists. Replace it?');
            if (!(await this.confirm(message.replace('{preset}', slot), this.t('presets.replaceButton', 'Replace')))) {
                return;
            }
        }

        const submit = document.querySelector('#presetForm button[type="submit"]');
        submit.disabled = true;
        try {
            if (storePosition && !(await this.camera.savePreset(slot))) {
                this.showDialogError(this.t('presets.errorPosition', 'The camera position could not be stored.'));
                return;
            }
            const response = await fetch(`api/presets/${slot}/image?key=${encodeURIComponent(key)}`, {
                method: 'PUT',
                headers: { 'Content-Type': image.type || 'application/octet-stream' },
                body: image,
            });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                const message = this.t('presets.errorUpload', 'The picture could not be saved.');
                this.showDialogError(`${message} ${detail.message || ''}`.trim());
                return;
            }
            this.closeAddDialog();
            await this.loadPresets();
        } finally {
            submit.disabled = false;
        }
    }

    async confirmAndDeletePreset(slot) {
        const message = this.t(
            'presets.confirmDelete',
            'Remove preset {preset} from the list? The position stays stored in the camera.',
        );
        if (!(await this.confirm(message.replace('{preset}', slot), this.t('presets.deleteButton', 'Remove')))) {
            return;
        }
        try {
            const response = await fetch(`api/presets/${slot}/image`, { method: 'DELETE' });
            if (!response.ok) {
                console.error('Removing the preset failed:', response.status);
            }
        } catch (error) {
            console.error('Removing the preset failed:', error);
        }
        await this.loadPresets();
    }

    callPreset(presetNumber) {
        if (this.camera) {
            this.camera.callPreset(presetNumber);
        }
    }

    async savePreset(presetNumber, btn) {
        if (!this.camera) return;

        if (btn._resetTimer) {
            clearTimeout(btn._resetTimer);
            btn._resetTimer = null;
        }

        this.setSaveButtonState(btn, 'loading', true);
        btn.disabled = true;

        const ok = await this.camera.savePreset(presetNumber);

        this.setSaveButtonState(btn, ok ? 'success' : 'error', true);
        btn._resetTimer = setTimeout(() => {
            this.setSaveButtonState(btn, 'save', false);
            btn.disabled = false;
            btn._resetTimer = null;
        }, 1500);
    }

    confirmAndSavePreset(presetNumber, btn) {
        const message = this.t('presets.confirmSave', 'Store the current camera position in preset {preset}?');
        this.confirm(message.replace('{preset}', presetNumber), this.t('presets.saveButton', 'Save')).then((ok) => {
            if (ok) this.savePreset(presetNumber, btn);
        });
    }

    // Resolves to true when the user confirms
    confirm(message, confirmLabel) {
        const dialog = document.getElementById('confirmDialog');
        const yes = document.getElementById('confirmYes');
        const no = document.getElementById('confirmNo');
        document.getElementById('confirmMessage').textContent = message;
        yes.textContent = confirmLabel;
        no.textContent = this.t('dialog.cancel', 'Cancel');
        dialog.style.display = 'flex';
        yes.focus();

        return new Promise((resolve) => {
            const close = (result) => {
                dialog.style.display = 'none';
                yes.onclick = null;
                no.onclick = null;
                resolve(result);
            };
            yes.onclick = () => close(true);
            no.onclick = () => close(false);
        });
    }

    highlightPreset(slot) {
        const item = document.querySelector(`.preset-item[data-preset="${slot}"]`);
        if (!item) return;
        item.classList.add('keyboard-active');
        setTimeout(() => item.classList.remove('keyboard-active'), 200);
    }
}

window.PresetManager = PresetManager;
