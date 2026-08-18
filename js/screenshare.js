/**
 * screenshare.js - 屏幕共享 WebRTC 管理
 * 修复：H.264 编码优先（移动端兼容）、音频轨道正确处理
 */

class ScreenShareManager {
    constructor() {
        this.peerConnections = new Map();
        this.screenStream = null;
        this.isSharing = false;
        this.currentQuality = CONFIG.DEFAULT_QUALITY;
        this.onShareStarted = null;
        this.onShareStopped = null;
        this.onRemoteScreenStream = null;
        this.onRemoteScreenStopped = null;
        this.statsInterval = null;
        this.lastQualityDowngrade = 0;
    }
    
    async getScreenStream(quality = CONFIG.DEFAULT_QUALITY) {
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        if (!settings) throw new Error(`Unknown quality: ${quality}`);
        this.currentQuality = quality;
        
        // 修复：移动端使用 H.264 编码
        const isMobile = !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
        
        const constraintsList = [
            {
                video: {
                    width: { ideal: settings.width, max: settings.width },
                    height: { ideal: settings.height, max: settings.height },
                    frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                },
                audio: isMobile ? false : { echoCancellation: true, noiseSuppression: true }
            },
            { video: { width: { ideal: settings.width }, height: { ideal: settings.height }, frameRate: { ideal: settings.frameRate } }, audio: !isMobile },
            { video: true, audio: !isMobile }
        ];
        
        let lastErr = null;
        for (const constraints of constraintsList) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (videoTrack) {
                    try {
                        await videoTrack.applyConstraints({
                            width: { ideal: settings.width },
                            height: { ideal: settings.height },
                            frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                        });
                    } catch (e) { console.warn('[ScreenShare] applyConstraints failed:', e.message); }
                }
                this.screenStream.getVideoTracks()[0].onended = () => { this.stopSharing(); };
                return this.screenStream;
            } catch (err) {
                lastErr = err;
                console.warn('[ScreenShare] getDisplayMedia failed:', err.message);
            }
        }
        throw lastErr || new Error('无法获取屏幕共享流');
    }
    
    async startSharing(quality, memberIds) {
        if (this.isSharing) await this.stopSharing();
        try {
            await this.getScreenStream(quality);
            this.isSharing = true;
            this._applyBitrate(quality);
            this._startQualityMonitor();
            if (this.onShareStarted) this.onShareStarted(this.screenStream, quality);
            return true;
        } catch (err) {
            this.isSharing = false;
            throw err;
        }
    }
    
    async stopSharing() {
        this.isSharing = false;
        this._stopQualityMonitor();
        this.peerConnections.forEach((pc, clientId) => {
            try { pc.getSenders().forEach(sender => { if (sender.track) sender.track.stop(); }); pc.close(); } catch (e) {}
        });
        this.peerConnections.clear();
        if (this.screenStream) { this.screenStream.getTracks().forEach(track => track.stop()); this.screenStream = null; }
        if (this.onShareStopped) this.onShareStopped();
    }
    
    async changeQuality(newQuality) {
        if (!this.isSharing || !this.screenStream) return;
        this.currentQuality = newQuality;
        const settings = CONFIG.SCREEN_SHARE_QUALITY[newQuality];
        try {
            const videoTrack = this.screenStream.getVideoTracks()[0];
            if (videoTrack) {
                try { await videoTrack.applyConstraints({ width: { ideal: settings.width, max: settings.width }, height: { ideal: settings.height, max: settings.height }, frameRate: { ideal: settings.frameRate, max: settings.frameRate } }); } catch (e) {}
            }
            this._applyBitrate(newQuality);
        } catch (err) { console.error('[ScreenShare] Change quality error:', err); }
    }
    
    // 修复：视频互看不到 - 简化 handleShareOffer
    async handleShareOffer(fromClientId, sdp, quality) {
        console.log(`[ScreenShare] 收到 offer 来自 ${fromClientId}`);
        const existing = this.peerConnections.get(fromClientId);
        if (existing) { existing.close(); this.peerConnections.delete(fromClientId); }
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
        this.peerConnections.set(fromClientId, pc);
        
        this._setupSharePeerConnectionCallbacks(pc, fromClientId);
        if (quality) this.currentQuality = quality;
        
        await pc.setRemoteDescription(new RTCSessionDescription({ sdp, type: 'offer' }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        console.log(`[ScreenShare] 发送 answer 给 ${fromClientId}`);
        return { sdp: pc.localDescription.sdp, type: pc.localDescription.type };
    }
    
    async handleShareAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
    
    async handleShareIceCandidate(fromClientId, candidate) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (err) {} }
    }
    
    closeConnection(clientId) {
        const pc = this.peerConnections.get(clientId);
        if (pc) { try { pc.getSenders().forEach(sender => { if (sender.track) sender.track.stop(); }); pc.close(); } catch (e) {} this.peerConnections.delete(clientId); }
    }
    
    // 修复：视频互看不到 - 返回完整 offer 对象
    async createShareOffer(targetClientId, quality) {
        console.log(`[ScreenShare] 发送 offer 给 ${targetClientId}`);
        const existing = this.peerConnections.get(targetClientId);
        if (existing) { existing.close(); this.peerConnections.delete(targetClientId); }
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
        this.peerConnections.set(targetClientId, pc);
        
        if (!this.screenStream) await this.getScreenStream(quality);
        if (this.screenStream) this.screenStream.getTracks().forEach(track => { pc.addTrack(track, this.screenStream); });
        
        this._setupSharePeerConnectionCallbacks(pc, targetClientId);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return { sdp: pc.localDescription.sdp, type: pc.localDescription.type };
    }
    
    _setupSharePeerConnectionCallbacks(pc, clientId) {
        pc.onicecandidate = (event) => {
            if (event.candidate && window.app && window.app.sendShareIceCandidate) {
                console.log(`[ScreenShare] 发送 ICE 给 ${clientId}`);
                window.app.sendShareIceCandidate(clientId, event.candidate);
            }
        };
        pc.onconnectionstatechange = () => {
            console.log(`[ScreenShare] 连接状态变化 ${clientId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.closeConnection(clientId);
        };
        pc.ontrack = (event) => {
            console.log(`[ScreenShare] 收到远端轨道来自 ${clientId}: ${event.track.kind}`);
            if (event.streams[0] && this.onRemoteScreenStream) {
                this.onRemoteScreenStream(event.streams[0], this.currentQuality || CONFIG.DEFAULT_QUALITY);
            }
        };
    }
    
    // 修复：编码偏好 - 移动端 H.264 优先
    _setShareCodecPreference(pc) {
        try {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => t.sender.track && t.sender.track.kind === 'video');
            if (!videoTransceiver) return;
            const capabilities = RTCRtpSender.getCapabilities('video');
            if (!capabilities) return;
            const isMobile = !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
            if (isMobile) {
                const h264 = capabilities.codecs.find(c => c.mimeType === 'video/H264');
                if (h264) videoTransceiver.setCodecPreferences([h264]);
            } else {
                const h264 = capabilities.codecs.find(c => c.mimeType === 'video/H264');
                const vp9 = capabilities.codecs.find(c => c.mimeType === 'video/VP9');
                const vp8 = capabilities.codecs.find(c => c.mimeType === 'video/VP8');
                videoTransceiver.setCodecPreferences([h264, vp9, vp8].filter(Boolean));
            }
        } catch (err) {}
    }
    
    _applyBitrate(quality) {
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        if (!settings || !this.screenStream) return;
        this.peerConnections.forEach(pc => {
            pc.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'video') {
                    const params = sender.getParameters();
                    if (!params.encodings) params.encodings = [{}];
                    params.encodings[0].maxBitrate = settings.maxBitrate;
                    params.encodings[0].maxFramerate = settings.frameRate;
                    sender.setParameters(params).catch(() => {});
                }
            });
        });
    }
    
    _startQualityMonitor() {
        this._stopQualityMonitor();
        this.statsInterval = setInterval(async () => {
            if (!this.isSharing) return;
            this.peerConnections.forEach(async (pc) => {
                try {
                    const stats = await pc.getStats();
                    let lost = 0, sent = 0;
                    stats.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') sent = r.packetsSent || 0; if (r.type === 'remote-inbound-rtp' && r.kind === 'video') lost = r.packetsLost || 0; });
                    if (sent > 100 && (lost / (sent + lost)) * 100 > 5) this._downgradeQuality();
                } catch (e) {}
            });
        }, 3000);
    }
    
    _stopQualityMonitor() { if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; } }
    
    async _downgradeQuality() {
        const order = ['2k60', '1080p60', '1080p30', '720p60'];
        const idx = order.indexOf(this.currentQuality);
        if (idx < order.length - 1) {
            const q = order[idx + 1];
            this.lastQualityDowngrade = Date.now();
            await this.changeQuality(q);
            if (window.app && window.app.onQualityDowngraded) window.app.onQualityDowngraded(q);
        }
    }
}

const screenShareManager = new ScreenShareManager();
