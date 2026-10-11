/**
 * Main Application Controller
 * Initializes and coordinates all modules
 */

class App {
    constructor(settings) {
        this.settings = settings;
        this.lang = null;
        this.camera = null;
        this.presets = null;
        this.ui = null;
    }

    async init() {
        try {
            // Initialize language manager first
            this.lang = new LanguageManager(this.settings);
            await this.lang.init();

            this.settings.onSaveFailed = (file) => {
                alert(this.lang.get('config.saveFailed').replace('{file}', file));
            };

            // Initialize camera controller
            this.camera = new Camera(this.lang, this.settings);
            this.camera.loadConfig();

            // Initialize preset manager
            this.presets = new PresetManager(this.camera, this.lang);
            this.presets.init();

            // Initialize UI controller
            this.ui = new UIController(this.camera, this.presets, this.lang, this.settings);
            this.ui.init();

            // Load presets and connect to camera
            await this.presets.loadPresets();
            this.camera.connectToCamera();

            // First start: ask for the camera address right away
            if (!this.settings.get('ip')) {
                this.ui.openSettings();
            }

            console.log('Camera Control Interface initialized successfully');
        } catch (error) {
            console.error('Failed to initialize application:', error);
        }
    }
}

// Theme toggle runs immediately on DOM load (before async app init)
document.addEventListener('DOMContentLoaded', () => {
    const MIN_PAGE_WIDTH = 200;

    // Enforce minimum content width for app windows where CSS min-width can be ignored.
    const enforceMinimumWidth = () => {
        const container = document.querySelector('.container');
        const tooNarrow = window.innerWidth < MIN_PAGE_WIDTH;

        if (container) {
            container.style.width = tooNarrow ? `${MIN_PAGE_WIDTH}px` : 'max(100%, 200px)';
        }

        document.documentElement.style.overflowX = tooNarrow ? 'auto' : '';
        document.body.style.overflowX = tooNarrow ? 'auto' : '';

        // In --app windows Chrome often allows programmatic resize; try to clamp window width too.
        if (tooNarrow && typeof window.resizeTo === 'function') {
            const frameWidth = Math.max(0, window.outerWidth - window.innerWidth);
            const targetOuterWidth = MIN_PAGE_WIDTH + frameWidth;
            if (window.outerWidth < targetOuterWidth) {
                try {
                    window.resizeTo(targetOuterWidth, window.outerHeight);
                } catch {
                    // Ignore if browser blocks scripted resize.
                }
            }
        }
    };

    enforceMinimumWidth();
    window.addEventListener('resize', enforceMinimumWidth);

    const settings = new Settings();

    const toggle = document.getElementById('themeToggle');
    toggle?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        settings.save({ theme: next });
    });

    // Initialize application
    const app = new App(settings);
    app.init();
});
