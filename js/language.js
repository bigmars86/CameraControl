/**
 * Language Manager
 * Loads lang/<code>.json and translates elements with data-i18n (text, or placeholder of inputs) and
 * data-i18n-title (tooltip). If a file cannot be loaded, the English texts in index.html stay.
 */

const LANGUAGES = { en: 'English', de: 'Deutsch', el: 'Ελληνικά' };

class LanguageManager {
    constructor(settings) {
        this.settings = settings;
        this.currentLanguage = 'en';
        this.translations = {};
        this.connectionStatus = 'connecting';
    }

    async init() {
        await this.loadLanguage(this.settings.get('language') || 'en');
        this.populateLanguageSelector();
    }

    async loadLanguage(languageCode) {
        const code = languageCode in LANGUAGES ? languageCode : 'en';
        try {
            const response = await fetch(`lang/${code}.json`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.translations = await response.json();
            this.currentLanguage = code;
        } catch (error) {
            console.error(`Loading lang/${code}.json failed:`, error);
            if (code !== 'en') {
                return this.loadLanguage('en');
            }
        }
        this.updateUI();
    }

    async setLanguage(languageCode) {
        await this.loadLanguage(languageCode);
        this.settings.save({ language: this.currentLanguage });
    }

    // Translation for a dot path such as 'config.title'; the fallback (default: the path) if it is missing
    get(path, fallback = path) {
        const value = path
            .split('.')
            .reduce((node, key) => (node && typeof node === 'object' ? node[key] : undefined), this.translations);
        return typeof value === 'string' ? value : fallback;
    }

    populateLanguageSelector() {
        const select = document.getElementById('language');
        if (!select) return;

        select.innerHTML = '';
        for (const [code, name] of Object.entries(LANGUAGES)) {
            select.add(new Option(name, code, false, code === this.currentLanguage));
        }
        select.onchange = (event) => this.setLanguage(event.target.value);
    }

    updateUI() {
        document.documentElement.lang = this.currentLanguage;
        document.querySelectorAll('[data-i18n]').forEach((element) => {
            const text = this.get(element.dataset.i18n, null);
            if (text === null) return;
            if (element.tagName === 'INPUT') {
                element.placeholder = text;
            } else {
                element.textContent = text;
            }
        });
        document.querySelectorAll('[data-i18n-title]').forEach((element) => {
            const text = this.get(element.dataset.i18nTitle, null);
            if (text === null) return;
            element.title = text;
            element.setAttribute('aria-label', text);
        });
        this.updateConnectionStatus(this.connectionStatus);
    }

    updateConnectionStatus(status) {
        this.connectionStatus = status;
        const statusElement = document.getElementById('connectionStatus');
        if (!statusElement) return;

        statusElement.className = `status ${status}`;
        statusElement.textContent = this.get(`cameraPreview.${status}`, status);
    }
}

window.LanguageManager = LanguageManager;
