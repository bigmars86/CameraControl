/**
 * Settings
 * Provided by the proxy (api/settings.js) and saved back to camera_config.json next to the EXE.
 * The camera password is write-only: it is never sent to the browser.
 */

class Settings {
    constructor() {
        this.values = { ...Settings.DEFAULTS, ...(window.CAMERA_SETTINGS || {}) };
        this.onSaveFailed = null;
        this._saveFailedReported = false;
    }

    get(key) {
        return this.values[key];
    }

    // Returns the proxy's answer ({ reconnect, saved, file }) or null if the proxy was not reachable
    async save(changes) {
        const values = { ...changes };
        delete values.password;
        Object.assign(this.values, values);

        try {
            const response = await fetch('api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changes),
            });
            if (!response.ok) {
                console.error('Saving settings failed:', response.status, await response.text());
                return null;
            }
            const result = await response.json();
            if (!result.saved && !this._saveFailedReported && this.onSaveFailed) {
                this._saveFailedReported = true;
                this.onSaveFailed(result.file);
            }
            return result;
        } catch (error) {
            console.error('Saving settings failed:', error);
            return null;
        }
    }
}

// Used when the page is opened without the proxy
Settings.DEFAULTS = {
    ip: '192.168.178.19',
    username: 'admin',
    retryInterval: 10,
    maxDelay: 1,
    panSpeed: 5,
    tiltSpeed: 5,
    zoomSpeed: 5,
    language: 'en',
    theme: 'dark',
};

window.Settings = Settings;
