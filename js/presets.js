/**
 * Preset Manager
 * Handles preset discovery, loading, and activation
 */

class PresetManager {
    constructor(cameraController, languageManager) {
        this.camera = cameraController;
        this.lang = languageManager;
        this.presetKeyBindings = {};
    }

    getSaveIconSvg(state) {
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
            case 'save':
            default:
                // Solid floppy disk with shutter and label cut out
                return '<svg viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M3 1h8.5L15 4.5V13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm1 2v3h6V3zm0 7v3h8v-3z"/></svg>';
        }
    }

    setSaveButtonState(btn, state, forceVisible = false) {
        const t = (key, fallback) => {
            if (!this.lang) return fallback;
            const value = this.lang.get(key);
            return value === key ? fallback : value;
        };

        const titles = {
            save: t('presets.saveTooltip', 'save'),
            loading: t('presets.savingTooltip', 'saving...'),
            success: t('presets.savedTooltip', 'saved'),
            error: t('presets.saveFailedTooltip', 'save failed'),
        };

        btn.dataset.state = state;
        btn.innerHTML = this.getSaveIconSvg(state);
        btn.title = titles[state] || titles.save;
        btn.setAttribute('aria-label', btn.title);
        btn.classList.toggle('state-visible', forceVisible);
    }

    async loadPresets() {
        const presetsGrid = document.getElementById('presetsGrid');
        if (!presetsGrid) return;

        // Clear existing presets and key bindings
        presetsGrid.innerHTML = '';
        this.presetKeyBindings = {};

        // Show loading message
        const loadingMsg = this.lang ? this.lang.get('presets.loading') : 'Loading presets...';
        presetsGrid.innerHTML = `<div class="preset-message"><p>${loadingMsg}</p></div>`;

        // Try to get list of files in presets directory
        const foundPresets = await this.discoverPresetFiles();

        console.log('Found presets:', foundPresets);

        // If no presets found, show a message
        if (foundPresets.length === 0) {
            const notFoundMsg = this.lang ? this.lang.get('presets.notFound') : 'No preset images found.';
            const helpMsg = this.lang
                ? this.lang.get('presets.helpText')
                : 'Add images like 1-5.jpg (key=1, preset=5), d-23.png (key=d, preset=23), or 7.jpg (preset=7, no key) to the imgs/presets/ folder.';
            presetsGrid.innerHTML = `
                <div class="preset-message">
                    <p>${notFoundMsg}</p>
                    <p>${helpMsg}</p>
                </div>
            `;
            return;
        }

        // Sort presets by key (sortOrder) to organize by key rather than preset number
        foundPresets.sort((a, b) => {
            if (a.sortOrder < b.sortOrder) return -1;
            if (a.sortOrder > b.sortOrder) return 1;
            return a.number - b.number;
        });

        // Clear loading message and prepare to add presets
        presetsGrid.innerHTML = '';

        // Create preset items
        foundPresets.forEach(({ number, fileName, key }) => {
            const presetItem = document.createElement('div');
            presetItem.className = 'preset-item';
            presetItem.dataset.preset = number;

            const img = document.createElement('img');
            img.src = `imgs/presets/${fileName}`;
            img.alt = `Preset ${number}`;

            const numberBadge = document.createElement('div');
            numberBadge.className = 'preset-number';
            numberBadge.textContent = key || number;

            const saveBtn = document.createElement('button');
            saveBtn.className = 'preset-save-btn';
            saveBtn.type = 'button';
            this.setSaveButtonState(saveBtn, 'save');
            saveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.confirmAndSavePreset(number, saveBtn);
            });

            presetItem.appendChild(img);
            presetItem.appendChild(numberBadge);
            presetItem.appendChild(saveBtn);

            // Add click handler
            presetItem.addEventListener('click', () => {
                this.callPreset(number);
            });

            // Set up key binding if specified
            if (key) {
                this.presetKeyBindings[key] = number;
            }

            presetsGrid.appendChild(presetItem);
        });
    }

    async discoverPresetFiles() {
        const foundPresets = [];

        console.log('Starting preset discovery...');

        try {
            // Try to fetch directory listing from server
            const response = await fetch('imgs/presets/');

            if (!response.ok) {
                throw new Error('Could not fetch directory listing');
            }

            const text = await response.text();

            // Parse HTML directory listing to find image files
            // Look for links in the response
            const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
            let match;

            while ((match = linkRegex.exec(text)) !== null) {
                const href = match[1];
                const linkText = match[2].trim();

                // Use the link text (filename) not the href
                const fileName = linkText || href;

                // Check if it's an image file
                if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) {
                    console.log(`Found preset image: ${fileName}`);

                    // Parse filename to extract key and preset number
                    const parsed = this.parsePresetFileName(fileName);
                    if (parsed) {
                        foundPresets.push(parsed);
                    }
                }
            }

            if (foundPresets.length === 0) {
                console.log('No images found in directory listing, trying fallback...');
                throw new Error('No images in listing');
            }

            console.log(`Discovery complete. Found ${foundPresets.length} presets.`);
        } catch (error) {
            console.warn('Could not use directory listing, using fallback:', error.message);
            // Fallback to checking a limited set of common presets
            return await this.discoverPresetFilesFallback();
        }

        return foundPresets;
    }

    parsePresetFileName(fileName) {
        // Extract key and preset number from filename
        // Formats: "1.jpg", "1-5.jpg", "a-3.png", etc.

        const match = fileName.match(/^([a-z0-9])-(\d+)\./i);
        if (match) {
            // Format: key-preset.ext (e.g., "1-5.jpg", "a-3.png")
            return {
                number: parseInt(match[2]),
                fileName: fileName,
                key: match[1].toLowerCase(),
                sortOrder: match[1].toLowerCase(),
            };
        }

        const simpleMatch = fileName.match(/^(\d+)\./);
        if (simpleMatch) {
            // Format: preset.ext (e.g., "5.jpg")
            const num = parseInt(simpleMatch[1]);
            return {
                number: num,
                fileName: fileName,
                key: null,
                sortOrder: num.toString().padStart(3, '0'),
            };
        }

        return null;
    }

    async discoverPresetFilesFallback() {
        // Fallback method - check only common preset numbers (1-10)
        const presetExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        const foundPresets = [];

        console.log('Using fallback discovery (checking 1-10)...');

        // Test simple number patterns (1.jpg, 2.jpg, etc.)
        for (let num = 1; num <= 10; num++) {
            for (const ext of presetExtensions) {
                const fileName = `${num}.${ext}`;
                const exists = await this.checkImageExists(`imgs/presets/${fileName}`);
                if (exists) {
                    foundPresets.push({
                        number: num,
                        fileName: fileName,
                        key: null,
                        sortOrder: `${num.toString().padStart(3, '0')}`,
                    });
                    break;
                }
            }
        }

        console.log(`Fallback discovery complete. Found ${foundPresets.length} presets.`);
        return foundPresets;
    }

    checkImageExists(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                console.log(`✓ Found image: ${src}`);
                resolve(true);
            };
            img.onerror = () => {
                console.log(`✗ Missing image: ${src}`);
                resolve(false);
            };
            img.src = src;

            setTimeout(() => {
                console.log(`⏱ Timeout checking: ${src}`);
                resolve(false);
            }, 2000);
        });
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
        const dialog = document.getElementById('confirmDialog');
        const msgEl = document.getElementById('confirmMessage');
        const yesBtn = document.getElementById('confirmYes');
        const noBtn = document.getElementById('confirmNo');
        if (!dialog) {
            this.savePreset(presetNumber, btn);
            return;
        }

        const template = this.lang
            ? this.lang.get('presets.confirmSave')
            : 'Save current camera position to preset {preset}?';
        const fallback = 'Save current camera position to preset {preset}?';
        const messageTemplate = template === 'presets.confirmSave' ? fallback : template;
        msgEl.textContent = messageTemplate.replace('{preset}', String(presetNumber));
        dialog.style.display = 'flex';

        const cleanup = () => {
            dialog.style.display = 'none';
            yesBtn.replaceWith(yesBtn.cloneNode(true));
            noBtn.replaceWith(noBtn.cloneNode(true));
        };

        document.getElementById('confirmYes').addEventListener('click', () => {
            cleanup();
            this.savePreset(presetNumber, btn);
        });
        document.getElementById('confirmNo').addEventListener('click', () => {
            cleanup();
        });
    }

    highlightPresetByKey(key) {
        const presetItems = document.querySelectorAll('.preset-item');
        presetItems.forEach((item) => {
            const badge = item.querySelector('.preset-number');
            if (badge && badge.textContent === key) {
                item.classList.add('keyboard-active');
                setTimeout(() => item.classList.remove('keyboard-active'), 200);
            }
        });
    }

    highlightPresetByNumber(number) {
        const presetItems = document.querySelectorAll('.preset-item');
        presetItems.forEach((item) => {
            if (parseInt(item.dataset.preset) === number) {
                item.classList.add('keyboard-active');
                setTimeout(() => item.classList.remove('keyboard-active'), 200);
            }
        });
    }
}

window.PresetManager = PresetManager;
