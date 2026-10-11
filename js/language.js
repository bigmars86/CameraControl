/**
 * Language Manager
 * Handles multilingual support with JSON language files
 */

class LanguageManager {
    constructor(settings) {
        this.settings = settings;
        this.currentLanguage = 'en';
        this.translations = {};
        this.availableLanguages = ['en', 'de', 'el']; // English, German, Greek
        this.languageNames = {
            en: 'English',
            de: 'Deutsch',
            el: 'Ελληνικά',
        };
    }

    async init() {
        // Load saved language preference or default
        const savedLanguage = (this.settings && this.settings.get('language')) || 'en';
        console.log('Initializing language manager with:', savedLanguage);
        await this.loadLanguage(savedLanguage);

        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
            this.populateLanguageSelector();
        }, 100);
    }

    async loadLanguage(languageCode) {
        if (!this.availableLanguages.includes(languageCode)) {
            console.warn(`Language ${languageCode} not available, falling back to English`);
            languageCode = 'en';
        }

        try {
            console.log(`Attempting to load language file: lang/${languageCode}.json`);
            const response = await fetch(`lang/${languageCode}.json`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to load language file`);
            }
            this.translations = await response.json();
            this.currentLanguage = languageCode;
            console.log('Language loaded successfully:', languageCode);
            console.log('Translations:', this.translations);
            this.updateUI();
            return true;
        } catch (error) {
            console.error('Error loading language file:', error);
            console.error('This error often happens when opening the HTML file directly.');
            console.error('Please use a web server (e.g., "python -m http.server" or VS Code Live Server)');

            // Don't try to fallback if we're already trying English
            if (languageCode === 'en') {
                console.error('Cannot load English fallback. Using inline translations.');
                // Provide minimal inline translations as last resort
                this.translations = this.getInlineTranslations(languageCode);
                this.currentLanguage = languageCode;
                this.updateUI();
                return false;
            } else {
                return this.loadLanguage('en');
            }
        }
    }

    async setLanguage(languageCode) {
        console.log('Setting language to:', languageCode);

        // If we're already on this language and have translations, just update UI
        if (this.currentLanguage === languageCode && Object.keys(this.translations).length > 0) {
            console.log('Already using this language, just updating UI');
            this.updateUI();
        } else {
            await this.loadLanguage(languageCode);
        }

        if (this.settings) {
            this.settings.save({ language: languageCode });
        }
    }

    get(path) {
        // Navigate through nested object using dot notation
        // e.g., get('config.title') returns translations.config.title
        const keys = path.split('.');
        let value = this.translations;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                console.warn(`Translation key not found: ${path}`);
                return path; // Return the key itself if not found
            }
        }

        if (typeof value === 'string') {
            return value;
        } else {
            console.warn(`Translation for ${path} is not a string:`, value);
            return path;
        }
    }

    populateLanguageSelector() {
        const languageSelect = document.getElementById('language');
        if (!languageSelect) {
            console.warn('Language selector not found in DOM');
            return;
        }

        // Clear existing options
        languageSelect.innerHTML = '';

        // Add options for each available language
        this.availableLanguages.forEach((langCode) => {
            const option = document.createElement('option');
            option.value = langCode;
            option.textContent = this.languageNames[langCode];
            if (langCode === this.currentLanguage) {
                option.selected = true;
            }
            languageSelect.appendChild(option);
        });

        // Use arrow function to maintain 'this' context
        // Remove old listener by replacing with new one
        languageSelect.onchange = async (e) => {
            console.log('Language changed to:', e.target.value);
            await this.setLanguage(e.target.value);
        };
    }

    updateUI() {
        console.log('Updating UI with language:', this.currentLanguage);

        // Update all elements with data-i18n attribute
        const elements = document.querySelectorAll('[data-i18n]');
        console.log(`Updating ${elements.length} elements`);

        elements.forEach((element) => {
            const key = element.getAttribute('data-i18n');
            const translation = this.get(key);

            // Update text content or placeholder depending on element type
            if (element.tagName === 'INPUT') {
                if (element.hasAttribute('placeholder')) {
                    element.placeholder = translation;
                }
            } else if (element.tagName === 'OPTION') {
                // Don't translate option elements (language names)
                return;
            } else {
                // For other elements, update textContent
                element.textContent = translation;
            }
        });

        // Update specific elements by ID (for backward compatibility)
        this.updateElementById('connectionStatus');

        console.log('UI update complete');
    }

    updateElementById(elementId) {
        const element = document.getElementById(elementId);
        if (!element) return;

        // Special handling for status elements
        if (elementId === 'connectionStatus') {
            const status = element.classList.contains('connected')
                ? 'connected'
                : element.classList.contains('connecting')
                  ? 'connecting'
                  : 'disconnected';
            element.textContent = this.get(`cameraPreview.${status}`);
        }
    }

    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;

        statusElement.className = `status ${status}`;
        statusElement.textContent = this.get(`cameraPreview.${status}`);
    }

    getInlineTranslations(languageCode) {
        // Fallback inline translations if fetch fails (complete translations)
        const translations = {
            en: {
                languageName: 'English',
                header: { title: 'Camera Control Interface' },
                config: {
                    title: 'Camera Configuration',
                    cameraIP: 'Camera IP Address:',
                    username: 'Username:',
                    password: 'Password:',
                    passwordPlaceholder: 'Leave empty to keep the current password',
                    saveFailed:
                        'Settings could not be saved to {file}.\n\nPlace CameraControl.exe in a folder you can write to (not under Program Files).',
                    language: 'Language:',
                    speedSettings: 'Speed Settings',
                    panSpeed: 'Pan Speed:',
                    tiltSpeed: 'Tilt Speed:',
                    zoomSpeed: 'Zoom Speed:',
                    connectionSettings: 'Connection',
                    retryInterval: 'Retry connection every (s):',
                    maxDelay: 'Max. preview delay (s):',
                    saveButton: 'Save Configuration',
                    presetInfoTitle: 'Preset Files',
                    presetInfoLine1: 'Place preset images in imgs/presets/ next to CameraControl.exe.',
                    presetInfoLine2: 'Use names like 1-5.jpg (key 1 calls preset 5) or 7.jpg (preset 7).',
                },
                cameraPreview: {
                    title: 'Camera Preview',
                    disconnected: 'Disconnected',
                    connected: 'Connected',
                    connecting: 'Connecting...',
                    offlineTitle: 'Camera not reachable',
                    offlineHint: 'Check power and network. Reconnecting automatically.',
                },
                cameraControls: {
                    title: 'Camera Controls',
                    ptzTitle: 'Pan/Tilt/Zoom Controls',
                },
                presets: {
                    title: 'Presets',
                    loading: 'Loading presets...',
                    notFound: 'No preset images found.',
                    helpText:
                        'Add images like 1-5.jpg (key=1, preset=5), d-23.png (key=d, preset=23), or 7.jpg (preset=7, no key) to the imgs/presets/ folder.',
                    saveTooltip: 'save',
                    savingTooltip: 'saving...',
                    savedTooltip: 'saved',
                    saveFailedTooltip: 'save failed',
                    confirmSave: 'Save current camera position to preset {preset}?',
                    keyboardControls: 'Keyboard Controls:',
                    numpadHelp: '1-9 for PTZ movement (like phone keypad), + and - for zoom',
                    presetsHelp: 'Click preset images or use assigned keys shown on each preset',
                    fileFormat: 'Use key-preset.jpg (e.g., 1-5.jpg, a-3.jpg) to control display order by key',
                },
                keyboardHelp: {
                    title: 'Keyboard Shortcuts:',
                    arrowKeys: 'Arrow Keys: Pan/Tilt camera',
                    pageKeys: 'Page Up/Down: Zoom in/out',
                    numberKeys: 'Number Keys (0-9): Call presets',
                    space: 'Space: Stop movement',
                },
            },
            de: {
                languageName: 'Deutsch',
                header: { title: 'Kamera-Steuerungsschnittstelle' },
                config: {
                    title: 'Kamera-Konfiguration',
                    cameraIP: 'Kamera-IP-Adresse:',
                    username: 'Benutzername:',
                    password: 'Passwort:',
                    passwordPlaceholder: 'Leer lassen, um das aktuelle Passwort zu behalten',
                    saveFailed:
                        'Die Einstellungen konnten nicht in {file} gespeichert werden.\n\nBitte CameraControl.exe in einen Ordner mit Schreibrechten legen (nicht unter „Programme“).',
                    language: 'Sprache:',
                    speedSettings: 'Geschwindigkeitseinstellungen',
                    panSpeed: 'Schwenkgeschwindigkeit:',
                    tiltSpeed: 'Neigegeschwindigkeit:',
                    zoomSpeed: 'Zoom-Geschwindigkeit:',
                    connectionSettings: 'Verbindung',
                    retryInterval: 'Neuer Verbindungsversuch alle (s):',
                    maxDelay: 'Max. Verzögerung der Vorschau (s):',
                    saveButton: 'Konfiguration speichern',
                    presetInfoTitle: 'Preset-Dateien',
                    presetInfoLine1: 'Legen Sie Preset-Bilder in imgs/presets/ neben CameraControl.exe ab.',
                    presetInfoLine2:
                        'Verwenden Sie Namen wie 1-5.jpg (Taste 1 ruft Preset 5 auf) oder 7.jpg (Preset 7).',
                },
                cameraPreview: {
                    title: 'Kamera-Vorschau',
                    disconnected: 'Getrennt',
                    connected: 'Verbunden',
                    connecting: 'Verbinde...',
                    offlineTitle: 'Kamera nicht erreichbar',
                    offlineHint:
                        'Stromversorgung und Netzwerk prüfen. Die Verbindung wird automatisch erneut versucht.',
                },
                cameraControls: {
                    title: 'Kamerasteuerung',
                    ptzTitle: 'Schwenken/Neigen/Zoom-Steuerung',
                },
                presets: {
                    title: 'Voreinstellungen',
                    loading: 'Lade Voreinstellungen...',
                    notFound: 'Keine Voreinstellungsbilder gefunden.',
                    helpText:
                        'Fügen Sie Bilder wie 1-5.jpg (Taste=1, Voreinstellung=5), d-23.png (Taste=d, Voreinstellung=23) oder 7.jpg (Voreinstellung=7, keine Taste) im imgs/presets/ Ordner hinzu.',
                    saveTooltip: 'speichern',
                    savingTooltip: 'speichere...',
                    savedTooltip: 'gespeichert',
                    saveFailedTooltip: 'speichern fehlgeschlagen',
                    confirmSave: 'Aktuelle Kameraposition in Preset {preset} speichern?',
                    keyboardControls: 'Tastatursteuerung:',
                    numpadHelp: '1-9 für PTZ-Bewegung (wie Telefontastatur), + und - für Zoom',
                    presetsHelp: 'Klicken Sie auf Voreinstellungsbilder oder verwenden Sie die zugewiesenen Tasten',
                    fileFormat:
                        'Verwenden Sie taste-voreinstellung.jpg (z.B. 1-5.jpg, a-3.jpg) um die Anzeigereihenfolge nach Taste zu steuern',
                },
                keyboardHelp: {
                    title: 'Tastaturkürzel:',
                    arrowKeys: 'Pfeiltasten: Kamera schwenken/neigen',
                    pageKeys: 'Bild auf/ab: Hinein-/Herauszoomen',
                    numberKeys: 'Zahlentasten (0-9): Voreinstellungen aufrufen',
                    space: 'Leertaste: Bewegung stoppen',
                },
            },
            el: {
                languageName: 'Ελληνικά',
                header: { title: 'Διεπαφή Ελέγχου Κάμερας' },
                config: {
                    title: 'Ρυθμίσεις Κάμερας',
                    cameraIP: 'Διεύθυνση IP Κάμερας:',
                    username: 'Όνομα χρήστη:',
                    password: 'Κωδικός πρόσβασης:',
                    passwordPlaceholder: 'Αφήστε κενό για να διατηρηθεί ο τρέχων κωδικός',
                    saveFailed:
                        'Οι ρυθμίσεις δεν ήταν δυνατό να αποθηκευτούν στο {file}.\n\nΤοποθετήστε το CameraControl.exe σε φάκελο με δικαίωμα εγγραφής (όχι στα Program Files).',
                    language: 'Γλώσσα:',
                    speedSettings: 'Ρυθμίσεις Ταχύτητας',
                    panSpeed: 'Ταχύτητα Περιστροφής:',
                    tiltSpeed: 'Ταχύτητα Κλίσης:',
                    zoomSpeed: 'Ταχύτητα Ζουμ:',
                    connectionSettings: 'Σύνδεση',
                    retryInterval: 'Νέα προσπάθεια σύνδεσης κάθε (δευτ.):',
                    maxDelay: 'Μέγ. καθυστέρηση προεπισκόπησης (δευτ.):',
                    saveButton: 'Αποθήκευση Ρυθμίσεων',
                    presetInfoTitle: 'Αρχεία Προεπιλογών',
                    presetInfoLine1: 'Τοποθετήστε εικόνες προεπιλογών στο imgs/presets/ δίπλα στο CameraControl.exe.',
                    presetInfoLine2:
                        'Χρησιμοποιήστε ονόματα όπως 1-5.jpg (το πλήκτρο 1 καλεί την προεπιλογή 5) ή 7.jpg (προεπιλογή 7).',
                },
                cameraPreview: {
                    title: 'Προεπισκόπηση Κάμερας',
                    disconnected: 'Αποσυνδεδεμένο',
                    connected: 'Συνδεδεμένο',
                    connecting: 'Σύνδεση...',
                    offlineTitle: 'Η κάμερα δεν είναι προσβάσιμη',
                    offlineHint: 'Ελέγξτε την τροφοδοσία και το δίκτυο. Η σύνδεση επαναλαμβάνεται αυτόματα.',
                },
                cameraControls: {
                    title: 'Έλεγχοι Κάμερας',
                    ptzTitle: 'Έλεγχοι Περιστροφής/Κλίσης/Ζουμ',
                },
                presets: {
                    title: 'Προεπιλογές',
                    loading: 'Φόρτωση προεπιλογών...',
                    notFound: 'Δεν βρέθηκαν εικόνες προεπιλογών.',
                    helpText:
                        'Προσθέστε εικόνες όπως 1-5.jpg (πλήκτρο=1, προεπιλογή=5), d-23.png (πλήκτρο=d, προεπιλογή=23), ή 7.jpg (προεπιλογή=7, χωρίς πλήκτρο) στον φάκελο imgs/presets/.',
                    saveTooltip: 'αποθήκευση',
                    savingTooltip: 'αποθήκευση...',
                    savedTooltip: 'αποθηκεύτηκε',
                    saveFailedTooltip: 'η αποθήκευση απέτυχε',
                    confirmSave: 'Αποθήκευση της τρέχουσας θέσης κάμερας στην προεπιλογή {preset};',
                    keyboardControls: 'Έλεγχοι Πληκτρολογίου:',
                    numpadHelp: '1-9 για κίνηση PTZ (όπως πληκτρολόγιο τηλεφώνου), + και - για ζουμ',
                    presetsHelp: 'Κάντε κλικ στις εικόνες προεπιλογών ή χρησιμοποιήστε τα πλήκτρα που εμφανίζονται',
                    fileFormat:
                        'Χρησιμοποιήστε πληκτρο-προεπιλογη.jpg (π.χ. 1-5.jpg, a-3.jpg) για να ελέγξετε τη σειρά εμφάνισης',
                },
                keyboardHelp: {
                    title: 'Συντομεύσεις Πληκτρολογίου:',
                    arrowKeys: 'Πλήκτρα βελών: Περιστροφή/Κλίση κάμερας',
                    pageKeys: 'Page Up/Down: Μεγέθυνση/Σμίκρυνση',
                    numberKeys: 'Αριθμητικά πλήκτρα (0-9): Κλήση προεπιλογών',
                    space: 'Διάστημα: Διακοπή κίνησης',
                },
            },
        };

        return translations[languageCode] || translations['en'];
    }
}

// Export for use in other modules
window.LanguageManager = LanguageManager;
