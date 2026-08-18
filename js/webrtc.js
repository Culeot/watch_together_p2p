/**
 * webrtc.js - 连麦 WebRTC 管理
 * 管理房间内成员之间的音视频 P2P 连接（Mesh 拓扑）
 * 修复：H264 编码优先、ontrack 正确处理、回声消除
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
        this.micVolume = 0;
        this._volumeCheckInterval = null;
    }
    
    detectMobile() {
        return !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    }
    
    async getLocalStream() {
        if (this.localStream) return this.localStream;
        
        const constraints = this.isMobile
            ? { 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: CONFIG.WEBRTC_MOBILE_VIDEO
              }
            : { 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                video: CONFIG.WEBRTC_VIDEO
              };
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.localStream.getAudioTracks().forEach(track => { track.enabled = false; });
            this.localStream.getVideoTracks().forEach(track => { track.enabled = false; });
            
            // 修复：初始化音频分析器用于回声检测
            this._initAudioAnalysis();
            
            if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] getUserMedia error:', err);
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                this.localStream.getAudioTracks().forEach(track => { track.enabled = false; });
                this._initAudioAnalysis();
                if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
                return this.localStream;
            } catch (audioErr) {
                console.error('[WebRTC] Audio-only fallback failed:', audioErr);
                throw audioErr;
            }
        }
    }
    
    // 修复：初始化 Web Audio API 进行音量检测
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
        } catch (e) {
            console.warn('[WebRTC] Audio analysis init failed:', e);
        }
    }
    
    // 修复：音量检测，用于回声抑制
    _startVolumeCheck() {
        if (this._volumeCheckInterval) clearInterval(this._volumeCheckInterval);
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        let lowVolumeCount = 0;
        let highVolumeCount = 0;
        
        this._volumeCheckInterval = setInterval(() => {
            if (!this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
            this.micVolume = avg;
            
            // 修复：当本地麦克风音量持续高时，自动降低扬声器音量防止回声
            if (avg > 30) {
                highVolumeCount++;
                lowVolumeCount = 0;
                if (highVolumeCount > 10 && window.app) {
                    window.app._suppressSpeaker();
                }
            } else {
                lowVolumeCount++;
                highVolumeCount = 0;
                if (lowVolumeCount > 15 && window.app) {
                    window.app._restoreSpeaker();
                }
            }
        }, 100);
    }
    
    async toggleMic() {
        if (!this.localStream) await this.getLocalStream();
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length === 0) await this.enableAudio();
        const tracks = this.localStream.getAudioTracks();
        this.isMicOn = !this.isMicOn;
        tracks.forEach(track => { track.enabled = this.isMicOn; });
        return this.isMicOn;
    }
    
    async toggleCamera() {
        if (!this.localStream) await this.getLocalStream();
        const videoTracks = this.localStream.getVideoTracks();
        if (videoTracks.length === 0) await this.enableVideo();
        const tracks = this.localStream.getVideoTracks();
        this.isCameraOn = !this.isCameraOn;
        tracks.forEach(track => { track.enabled = this.isCameraOn; });
        return this.isCameraOn;
    }
    
    async createOffer(targetClientId) {
        const pc = this._createPeerConnection(targetClientId);
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        } else {
            await this.getLocalStream();
            this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        }
        this._setCodecPreference(pc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        return offer;
    }
    
    async handleOffer(fromClientId, sdp) {
        const pc = this._createPeerConnection(fromClientId);
        if (!this.localStream) await this.getLocalStream();
        this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
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
        if (pc) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
            catch (err) { console.error('[WebRTC] Add ICE candidate error:', err); }
        }
    }
    
    closeConnection(targetClientId) {
        const pc = this.peerConnections.get(targetClientId);
        if (pc) {
            try {
                pc.getSenders().forEach(sender => { if (sender.track) sender.track.stop(); });
                pc.close();
            } catch (e) { console.error('[WebRTC] Close connection error:', e); }
            this.peerConnections.delete(targetClientId);
        }
        if (this.onRemoteStreamRemoved) this.onRemoteStreamRemoved(targetClientId);
    }
    
    closeAllConnections() {
        this.peerConnections.forEach((pc, clientId) => {
            try { pc.getSenders().forEach(sender => { if (sender.track) sender.track.stop(); }); pc.close(); }
            catch (e) { console.error('[WebRTC] Close all error:', e); }
        });
        this.peerConnections.clear();
    }
    
    _createPeerConnection(targetClientId) {
        const existing = this.peerConnections.get(targetClientId);
        if (existing) existing.close();
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS, iceCandidatePoolSize: 10 });
        this.peerConnections.set(targetClientId, pc);
        
        pc.onicecandidate = (event) => {
            if (event.candidate && window.app && window.app.sendIceCandidate) {
                window.app.sendIceCandidate(targetClientId, event.candidate);
            }
        };
        
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${targetClientId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(targetClientId);
            }
        };
        
        // 修复：ontrack 正确处理远端流，使用 stream 的 oninactive 事件确保流完整
        pc.ontrack = (event) => {
            console.log(`[WebRTC] Remote track from ${targetClientId}:`, event.track.kind, 'streams:', event.streams.length);
            if (event.streams[0]) {
                const stream = event.streams[0];
                // 修复：等待流的所有轨道都添加完毕
                if (stream.getTracks().length >= 2) {
                    this._emitRemoteStream(targetClientId, stream);
                } else {
                    // 等待第二个轨道
                    const checkTracks = setInterval(() => {
                        if (stream.getTracks().length >= 2) {
                            clearInterval(checkTracks);
                            this._emitRemoteStream(targetClientId, stream);
                        }
                    }, 50);
                    // 超时保护
                    setTimeout(() => {
                        clearInterval(checkTracks);
                        if (stream.getTracks().length > 0) this._emitRemoteStream(targetClientId, stream);
                    }, 3000);
                }
            }
        };
        
        // 修复：确保已有轨道被添加
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => { pc.addTrack(track, this.localStream); });
        }
        
        return pc;
    }
    
    _emitRemoteStream(clientId, stream) {
        if (this.onRemoteStream) this.onRemoteStream(clientId, stream);
    }
    
    // 修复：编码偏好 - 移动端使用 H264，桌面端 VP9 优先但保留 H264 回退
    _setCodecPreference(pc) {
        try {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => t.sender.track && t.sender.track.kind === 'video');
            if (!videoTransceiver) return;
            
            const capabilities = RTCRtpSender.getCapabilities('video');
            if (!capabilities) return;
            
            if (this.isMobile) {
                // 移动端：H264 优先
                const h264 = capabilities.codecs.find(c => c.mimeType === 'video/H264');
                if (h264) videoTransceiver.setCodecPreferences([h264]);
            } else {
                // 桌面端：H264 优先（兼容性更好），VP9 次之
                const h264 = capabilities.codecs.find(c => c.mimeType === 'video/H264');
                const vp9 = capabilities.codecs.find(c => c.mimeType === 'video/VP9');
                const vp8 = capabilities.codecs.find(c => c.mimeType === 'video/VP8');
                const prefs = [h264, vp9, vp8].filter(Boolean);
                if (prefs.length > 0) videoTransceiver.setCodecPreferences(prefs);
            }
        } catch (err) { console.warn('[WebRTC] Set codec preference error:', err); }
    }
    
    async enumerateDevices() {
        try { await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop())); } catch (e) {}
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                audioInputs: devices.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}` })),
                videoInputs: devices.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label || `摄像头 ${d.deviceId.slice(0, 8)}` })),
                audioOutputs: devices.filter(d => d.kind === 'audiooutput').map(d => ({ id: d.deviceId, label: d.label || `扬声器 ${d.deviceId.slice(0, 8)}` }))
            };
        } catch (err) { return { audioInputs: [], videoInputs: [], audioOutputs: [] }; }
    }
    
    async setAudioOutput(deviceId) {
        try {
            const audioElements = document.querySelectorAll('video, audio');
            for (const el of audioElements) { if (el.setSinkId) await el.setSinkId(deviceId); }
        } catch (err) { throw err; }
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
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) sender.replaceTrack(track);
            });
        } catch (err) { throw err; }
    }
    
    async setVideoDevice(deviceId) {
        if (!this.localStream) return;
        try {
            const oldTracks = this.localStream.getVideoTracks();
            oldTracks.forEach(t => t.stop());
            oldTracks.forEach(t => this.localStream.removeTrack(t));
            const constraints = { video: { deviceId: { exact: deviceId } } };
            if (this.isMobile) { constraints.video.width = CONFIG.WEBRTC_MOBILE_VIDEO.width; constraints.video.height = CONFIG.WEBRTC_MOBILE_VIDEO.height; }
            else { constraints.video.width = CONFIG.WEBRTC_VIDEO.width; constraints.video.height = CONFIG.WEBRTC_VIDEO.height; constraints.video.frameRate = CONFIG.WEBRTC_VIDEO.frameRate; }
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];
            track.enabled = this.isCameraOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(track);
            });
            if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
        } catch (err) { throw err; }
    }
    
    getStatus() { return { micOn: this.isMicOn, cameraOn: this.isCameraOn, peerCount: this.peerConnections.size }; }
}

const webrtcManager = new WebRTCManager();
