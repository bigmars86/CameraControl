/**
 * Camera Controller
 * Handles camera connection, PTZ controls, and streaming
 */

// Preview live-edge tuning, in seconds of video buffered ahead of the playhead
const LIVE_TARGET = 0.3; // catching up stops here; a jump lands here
const CATCH_UP_START = 0.5; // above this the preview plays slightly faster
const CATCH_UP_RATE = 1.2;

class Camera {
    constructor(languageManager, settings) {
        this.lang = languageManager;
        this.settings = settings;
        this.cameraIP = '';
        this.username = '';
        this.connectionState = null;
        this.isConnected = false;

        // Camera control speeds
        this.panSpeed = 5;
        this.tiltSpeed = 5;
        this.zoomSpeed = 5;

        // Seconds between connection attempts / max. preview delay before jumping to live
        this.retryInterval = 10;
        this.maxDelay = 1;

        this._configGen = 0;
        this._monitorRunning = false;
    }

    static clamp(value, fallback, min, max) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
    }

    loadConfig() {
        const s = this.settings;
        this.cameraIP = s.get('ip');
        this.username = s.get('username');
        this.panSpeed = Camera.clamp(s.get('panSpeed'), 5, 1, 10);
        this.tiltSpeed = Camera.clamp(s.get('tiltSpeed'), 5, 1, 10);
        this.zoomSpeed = Camera.clamp(s.get('zoomSpeed'), 5, 1, 10);
        this.retryInterval = Camera.clamp(s.get('retryInterval'), 10, 2, 3600);
        this.maxDelay = Camera.clamp(s.get('maxDelay'), 1, 0.5, 10);

        this.updateConfigFields();
    }

    updateConfigFields() {
        const fields = {
            cameraIP: this.cameraIP,
            username: this.username,
            password: '',
            panSpeed: this.panSpeed,
            tiltSpeed: this.tiltSpeed,
            zoomSpeed: this.zoomSpeed,
            retryInterval: this.retryInterval,
            maxDelay: this.maxDelay,
        };

        for (const [id, value] of Object.entries(fields)) {
            const element = document.getElementById(id);
            if (element) {
                element.value = value;
                // Update speed value display
                if (id.includes('Speed')) {
                    const valueElement = document.getElementById(`${id}Value`);
                    if (valueElement) valueElement.textContent = value;
                }
            }
        }
    }

    async updateConfig(formData) {
        this.cameraIP = formData.cameraIP || this.cameraIP;
        this.username = formData.username || this.username;
        this.retryInterval = Camera.clamp(formData.retryInterval, this.retryInterval, 2, 3600);
        this.maxDelay = Camera.clamp(formData.maxDelay, this.maxDelay, 0.5, 10);

        const changes = {
            ip: this.cameraIP,
            username: this.username,
            retryInterval: this.retryInterval,
            maxDelay: this.maxDelay,
            browser: formData.browser,
            port: Number(formData.port),
        };
        if (formData.password) {
            changes.password = formData.password;
        }

        this.updateConfigFields();
        const configModal = document.getElementById('configModal');
        if (configModal) configModal.style.display = 'none';

        const result = await this.settings.save(changes);
        if (!result || result.reconnect) {
            this.connectToCamera();
        }
    }

    // Called at startup and after the camera address or credentials changed
    connectToCamera() {
        this._configGen++;
        this.setConnectionState(this.cameraIP ? 'connecting' : 'unconfigured');
        this.startMonitor();
    }

    // Polls the proxy, which re-checks the camera every retryInterval seconds in the background
    startMonitor() {
        if (this._monitorRunning) return;
        this._monitorRunning = true;

        const tick = async () => {
            const pending = await this.checkHealth();
            setTimeout(tick, pending ? 500 : 2000);
        };
        tick();
    }

    // Returns true while the first check after a (re)configuration is still running
    async checkHealth() {
        const gen = this._configGen;
        let health = null;
        try {
            const response = await fetch('api/health', { cache: 'no-store' });
            if (response.ok) {
                health = await response.json();
            }
        } catch {
            // Proxy not reachable - treated as offline below
        }

        if (gen !== this._configGen) {
            return true; // configuration changed while waiting, answer is stale
        }
        if (!health) {
            this.setConnectionState('disconnected');
            return false;
        }
        if (health.configured === false) {
            this.setConnectionState('unconfigured');
            return false;
        }
        if (health.connected) {
            this.setConnectionState('connected');
        } else if (!health.pending) {
            this.setConnectionState('disconnected');
        }
        return Boolean(health.pending);
    }

    // Everything that needs the camera is only available while connected
    setConnectionState(state) {
        if (state === this.connectionState) return;

        const wasConnected = this.isConnected;
        this.connectionState = state;
        this.isConnected = state === 'connected';

        if (this.lang) {
            this.lang.updateConnectionStatus(state);
        }
        document.body.classList.toggle('camera-offline', !this.isConnected);
        document.querySelectorAll('.ptz-btn, .zoom-btn').forEach((button) => {
            button.disabled = !this.isConnected;
        });
        const offlineMessage = document.getElementById('streamOffline');
        if (offlineMessage) {
            offlineMessage.hidden = state !== 'disconnected' && state !== 'unconfigured';
            offlineMessage.classList.toggle('unconfigured', state === 'unconfigured');
        }

        if (this.isConnected && !wasConnected) {
            this.startStream();
        } else if (!this.isConnected && wasConnected) {
            this.stopStream();
        }
    }

    // The proxy answers 503 when the camera stopped responding
    checkCommandResponse(response) {
        if (response.status === 503) {
            this.setConnectionState('disconnected');
        }
        return response.ok;
    }

    startStream() {
        if (!this.cameraIP) {
            console.warn('No camera IP configured');
            return;
        }

        const videoEl = this.stopStream();
        if (!videoEl) return;

        // The camera's WebSocket server is on port 4567 of the same host, whatever port its web UI uses
        const host = this.cameraIP.replace(/:\d+$/, '');
        const wsUrl = `ws://${host}:4567/ws/`;
        // Use 127.0.0.1 as RTSP host — the camera's WebSocket server connects to its local RTSP daemon
        videoEl.src = 'rtsp://127.0.0.1/1';
        videoEl.muted = true;
        videoEl.disablePictureInPicture = true;

        try {
            this._player = Streamedian.player('cameraStream', {
                socket: wsUrl,
                redirectNativeMediaErrors: true,
                bufferDuration: 10,
                errorHandler: (err) => {
                    // Suppress default alert; keepLive() restarts a stream that stops delivering video
                    console.warn('Streamedian error (suppressed):', err && err.message);
                },
            });
            console.log('Streamedian player started:', wsUrl);
        } catch (err) {
            console.error('Failed to start Streamedian player:', err);
        }

        this._video = videoEl;
        this._lastLiveEdge = 0;
        this._lastDataAt = performance.now();
        this._lastJumpAt = 0;
        this._liveTimer = setInterval(() => this.keepLive(), 250);
    }

    // Stops the preview and puts a fresh, empty <video> in place of the old one
    // (no frozen last frame, no event listeners of the old player left behind).
    stopStream() {
        clearInterval(this._liveTimer);
        this._liveTimer = null;
        this._video = null;

        if (this._player) {
            this._player.destroy().catch((e) => console.warn('Player cleanup failed:', e));
            this._player = null;
        }

        const oldVideo = document.getElementById('cameraStream');
        if (!oldVideo) return null;
        const freshVideo = oldVideo.cloneNode(false);
        freshVideo.removeAttribute('src');
        oldVideo.replaceWith(freshVideo);
        return freshVideo;
    }

    // MSE playback never catches up by itself, so every network or CPU hiccup used to add delay for good.
    keepLive() {
        const video = this._video;
        if (!video || video.seeking) return;

        const now = performance.now();
        const ranges = video.buffered;
        if (ranges.length) {
            const last = ranges.length - 1;
            const liveEdge = ranges.end(last);
            if (liveEdge !== this._lastLiveEdge) {
                this._lastLiveEdge = liveEdge;
                this._lastDataAt = now;
            }

            const lag = liveEdge - video.currentTime;
            if (lag > this.maxDelay && now - this._lastJumpAt > 2000) {
                video.currentTime = Math.max(ranges.start(last), liveEdge - LIVE_TARGET);
                video.playbackRate = 1;
                this._lastJumpAt = now;
            } else if (lag > CATCH_UP_START) {
                video.playbackRate = CATCH_UP_RATE;
            } else if (lag <= LIVE_TARGET) {
                video.playbackRate = 1;
            }
        }

        // Hidden windows get throttled timers, so only judge the stream while visible
        if (document.hidden) {
            this._lastDataAt = now;
        } else if (now - this._lastDataAt > Math.max(10, this.retryInterval) * 1000) {
            console.warn('No video data received, restarting stream');
            this.startStream();
        }
    }

    // Current preview picture as a JPEG blob (for preset images), or null while there is no video
    captureFrame(maxWidth = 640) {
        const video = this._video;
        if (!video || !video.videoWidth) return Promise.resolve(null);

        const scale = Math.min(1, maxWidth / video.videoWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    }

    async handleCameraAction(action, isStart) {
        if (!this.isConnected) {
            return;
        }

        try {
            const ptzCommands = {
                'pan-left': { code: 'Left', arg1: this.panSpeed, arg2: this.panSpeed },
                'pan-right': { code: 'Right', arg1: this.panSpeed, arg2: this.panSpeed },
                'tilt-up': { code: 'Up', arg1: this.tiltSpeed, arg2: this.tiltSpeed },
                'tilt-down': { code: 'Down', arg1: this.tiltSpeed, arg2: this.tiltSpeed },
                'pan-up-left': { code: 'LeftUp', arg1: this.panSpeed, arg2: this.tiltSpeed },
                'pan-up-right': { code: 'RightUp', arg1: this.panSpeed, arg2: this.tiltSpeed },
                'pan-down-left': { code: 'LeftDown', arg1: this.panSpeed, arg2: this.tiltSpeed },
                'pan-down-right': { code: 'RightDown', arg1: this.panSpeed, arg2: this.tiltSpeed },
                'zoom-in': { code: 'ZoomTele', arg1: this.zoomSpeed, arg2: this.zoomSpeed },
                'zoom-out': { code: 'ZoomWide', arg1: this.zoomSpeed, arg2: this.zoomSpeed },
                stop: { code: 'Up', arg1: 0, arg2: 0 },
            };

            const command = ptzCommands[action];
            if (!command) {
                console.warn(`Unknown action: ${action}`);
                return;
            }

            const ptzAction = action === 'stop' || !isStart ? 'stop' : 'start';

            const payload = {
                action: ptzAction,
                code: command.code,
                arg1: ptzAction === 'stop' ? 0 : command.arg1,
                arg2: ptzAction === 'stop' ? 0 : command.arg2,
            };

            const sendPTZ = async () => {
                return fetch('api/ptz', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
            };

            // Some firmwares queue zoom commands differently than pan/tilt.
            // Retry zoom-stop a few times so a delayed zoom-start cannot "win".
            const isZoomStop = ptzAction === 'stop' && (command.code === 'ZoomTele' || command.code === 'ZoomWide');
            const attempts = isZoomStop ? 3 : 1;

            let lastResponse = null;
            for (let i = 0; i < attempts; i++) {
                lastResponse = await sendPTZ();
                if (i < attempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 70));
                }
            }

            if (lastResponse && this.checkCommandResponse(lastResponse)) {
                console.log(`PTZ Command: ${action} (${isStart ? 'start' : 'stop'})`);
            } else {
                console.error('PTZ command failed');
            }
        } catch (error) {
            console.error('PTZ control error:', error);
        }
    }

    // Stores the camera's current position in preset slot n
    async savePreset(presetNumber) {
        if (!this.isConnected) {
            return false;
        }

        try {
            const response = await fetch(`api/presets/${presetNumber}/save`, { method: 'POST' });
            if (this.checkCommandResponse(response)) {
                console.log(`Saved preset ${presetNumber}`);
                return true;
            } else {
                console.error('Preset save failed');
                return false;
            }
        } catch (err) {
            console.error('Failed to save preset:', err);
            return false;
        }
    }

    async callPreset(presetNumber) {
        if (!this.isConnected) {
            return;
        }

        try {
            const response = await fetch(`api/presets/${presetNumber}/call`, { method: 'POST' });

            if (this.checkCommandResponse(response)) {
                console.log(`Called preset ${presetNumber}`);
            } else {
                console.error('Preset call failed');
            }
        } catch (error) {
            console.error('Preset call error:', error);
        }
    }
}

window.Camera = Camera;
