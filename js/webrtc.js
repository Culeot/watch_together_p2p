/**
 * webrtc.js - 连麦 WebRTC 管理
 * 修复：轨道不重复添加、H264 编码、ontrack 正确处理、回声消除
 */

class WebRTCManager {
    constructor() {
        this.peerConnections = new Map();
        this.localStream = null;
        this.onRemoteStream = null;
        this.onRemoteStreamRemoved = null;
        this.onLocalStreamReady = null;
        this.isMicOn = false;
        this.isCameraOn = false;
        this.isMobile = this.detectMobile();
        this.audioContext = null;
        this.analyser = null;
        this._volumeCheckInterval = null;
    }
    
    detectMobile() {
        return !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    }
    
    async getLocalStream() {
        if (this.localStream) return this.localStream;
        
        const constraints = this.isMobile
            ? { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: CONFIG.WEBRTC_MOBILE_VIDEO }
            : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: CONFIG.WEBRTC_VIDEO };
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
            this.localStream.getVideoTracks().forEach(t => { t.enabled = false; });
            this._initAudioAnalysis();
            if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] getUserMedia error:', err);
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
                this._initAudioAnalysis();
                if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
                return this.localStream;
            } catch (audioErr) { throw audioErr; }
        }
    }
    
    _initAudioAnalysis() {
        if (!this.localStream) return;
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            source.connect(this.analyser);
            this._startVolumeCheck();
        } catch (e) {}
    }
    
    _startVolumeCheck() {
        if (this._volumeCheckInterval) clearInterval(this._volumeCheckInterval);
        if (!this.analyser) return;
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        let highCount = 0, lowCount = 0;
        this._volumeCheckInterval = setInterval(() => {
            if (!this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            if (avg > 30) { highCount++; lowCount = 0; if (highCount > 10 && window.app) window.app._suppressSpeaker(); }
            else { lowCount++; highCount = 0; if (lowCount > 15 && window.app) window.app._restoreSpeaker(); }
        }, 100);
    }
    
    async toggleMic() {
        if (!this.localStream) await this.getLocalStream();
        if (this.localStream.getAudioTracks().length === 0) await this.enableAudio();
        this.isMicOn = !this.isMicOn;
        this.localStream.getAudioTracks().forEach(t => { t.enabled = this.isMicOn; });
        return this.isMicOn;
    }
    
    async toggleCamera() {
        if (!this.localStream) await this.getLocalStream();
        if (this.localStream.getVideoTracks().length === 0) await this.enableVideo();
        this.isCameraOn = !this.isCameraOn;
        this.localStream.getVideoTracks().forEach(t => { t.enabled = this.isCameraOn; });
        return this.isCameraOn;
    }
    
    // 修复：createOffer 不重复添加轨道
    async createOffer(targetClientId) {
        // 如果已存在连接，先关闭
        const existing = this.peerConnections.get(targetClientId);
        if (existing) existing.close();
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS, iceCandidatePoolSize: 10 });
        this.peerConnections.set(targetClientId, pc);
        
        // 修复：只在这里添加轨道，_createPeerConnection 不再添加
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        } else {
            await this.getLocalStream();
            this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        }
        
        this._setupPeerConnection(pc, targetClientId);
        this._setCodecPreference(pc);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return offer;
    }
    
    async handleOffer(fromClientId, sdp) {
        const existing = this.peerConnections.get(fromClientId);
        if (existing) existing.close();
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS, iceCandidatePoolSize: 10 });
        this.peerConnections.set(fromClientId, pc);
        
        // 修复：只在这里添加轨道
        if (!this.localStream) await this.getLocalStream();
        this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        
        this._setupPeerConnection(pc, fromClientId);
        this._setCodecPreference(pc);
        
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return answer;
    }
    
    async handleAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
    
    async handleIceCandidate(fromClientId, candidate) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) { try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (err) {} }
    }
    
    closeConnection(targetClientId) {
        const pc = this.peerConnections.get(targetClientId);
        if (pc) {
            try { pc.getSenders().forEach(s => { if (s.track) s.track.stop(); }); pc.close(); } catch (e) {}
            this.peerConnections.delete(targetClientId);
        }
        if (this.onRemoteStreamRemoved) this.onRemoteStreamRemoved(targetClientId);
    }
    
    closeAllConnections() {
        this.peerConnections.forEach((pc) => {
            try { pc.getSenders().forEach(s => { if (s.track) s.track.stop(); }); pc.close(); } catch (e) {}
        });
        this.peerConnections.clear();
    }
    
    _setupPeerConnection(pc, targetClientId) {
        pc.onicecandidate = (event) => {
            if (event.candidate && window.app && window.app.sendIceCandidate) {
                window.app.sendIceCandidate(targetClientId, event.candidate);
            }
        };
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection with ${targetClientId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(targetClientId);
            }
        };
        // 修复：ontrack 正确处理远端流
        pc.ontrack = (event) => {
            console.log(`[WebRTC] ontrack from ${targetClientId}:`, event.track.kind, 'streams:', event.streams.length);
            if (event.streams[0] && this.onRemoteStream) {
                const stream = event.streams[0];
                // 延迟确保所有轨道都添加
                setTimeout(() => { if (this.onRemoteStream) this.onRemoteStream(targetClientId, stream); }, 200);
            }
        };
    }
    
    _setCodecPreference(pc) {
        try {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => t.sender.track && t.sender.track.kind === 'video');
            if (!videoTransceiver) return;
            const caps = RTCRtpSender.getCapabilities('video');
            if (!caps) return;
            
            if (this.isMobile) {
                const h264 = caps.codecs.find(c => c.mimeType === 'video/H264');
                if (h264) videoTransceiver.setCodecPreferences([h264]);
            } else {
                const h264 = caps.codecs.find(c => c.mimeType === 'video/H264');
                const vp9 = caps.codecs.find(c => c.mimeType === 'video/VP9');
                const vp8 = caps.codecs.find(c => c.mimeType === 'video/VP8');
                videoTransceiver.setCodecPreferences([h264, vp9, vp8].filter(Boolean));
            }
        } catch (err) {}
    }
    
    async enumerateDevices() {
        try { await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop())); } catch (e) {}
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                audioInputs: devices.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label || `麦克风 ${d.deviceId.slice(0,8)}` })),
                videoInputs: devices.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label || `摄像头 ${d.deviceId.slice(0,8)}` })),
                audioOutputs: devices.filter(d => d.kind === 'audiooutput').map(d => ({ id: d.deviceId, label: d.label || `扬声器 ${d.deviceId.slice(0,8)}` }))
            };
        } catch (e) { return { audioInputs: [], videoInputs: [], audioOutputs: [] }; }
    }
    
    async setAudioOutput(deviceId) {
        try { document.querySelectorAll('video, audio').forEach(el => { if (el.setSinkId) el.setSinkId(deviceId); }); }
        catch (err) { throw err; }
    }
    
    disableAudio() {
        if (this.localStream) { this.localStream.getAudioTracks().forEach(t => { t.stop(); this.localStream.removeTrack(t); }); }
        this.isMicOn = false;
    }
    
    disableVideo() {
        if (this.localStream) { this.localStream.getVideoTracks().forEach(t => { t.stop(); this.localStream.removeTrack(t); }); }
        this.isCameraOn = false;
    }
    
    async enableAudio() {
        if (!this.localStream) { await this.getLocalStream(); return; }
        if (this.localStream.getAudioTracks().length === 0) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
            const track = stream.getAudioTracks()[0];
            track.enabled = this.isMicOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) sender.replaceTrack(track); else pc.addTrack(track, this.localStream);
            });
        }
    }
    
    async enableVideo() {
        if (!this.localStream) { await this.getLocalStream(); return; }
        if (this.localStream.getVideoTracks().length === 0) {
            const constraints = this.isMobile ? { video: CONFIG.WEBRTC_MOBILE_VIDEO } : { video: CONFIG.WEBRTC_VIDEO };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];
            track.enabled = this.isCameraOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(track); else pc.addTrack(track, this.localStream);
            });
            if (this.onLocalStreamReady) requestAnimationFrame(() => this.onLocalStreamReady(this.localStream));
        }
    }
    
    async setAudioDevice(deviceId) {
        if (!this.localStream) return;
        try {
            this.localStream.getAudioTracks().forEach(t => t.stop());
            this.localStream.removeTrack(this.localStream.getAudioTracks()[0]);
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
            const track = stream.getAudioTracks()[0];
            track.enabled = this.isMicOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => { const s = pc.getSenders().find(s => s.track && s.track.kind === 'audio'); if (s) s.replaceTrack(track); });
        } catch (err) { throw err; }
    }
    
    async setVideoDevice(deviceId) {
        if (!this.localStream) return;
        try {
            this.localStream.getVideoTracks().forEach(t => t.stop());
            this.localStream.getVideoTracks().forEach(t => this.localStream.removeTrack(t));
            const constraints = { video: { deviceId: { exact: deviceId } } };
            if (this.isMobile) { constraints.video.width = CONFIG.WEBRTC_MOBILE_VIDEO.width; constraints.video.height = CONFIG.WEBRTC_MOBILE_VIDEO.height; }
            else { constraints.video.width = CONFIG.WEBRTC_VIDEO.width; constraints.video.height = CONFIG.WEBRTC_VIDEO.height; constraints.video.frameRate = CONFIG.WEBRTC_VIDEO.frameRate; }
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];
            track.enabled = this.isCameraOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => { const s = pc.getSenders().find(s => s.track && s.track.kind === 'video'); if (s) s.replaceTrack(track); });
            if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
        } catch (err) { throw err; }
    }
}

const webrtcManager = new WebRTCManager();
