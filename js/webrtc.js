/**
 * webrtc.js - 连麦 WebRTC 管理（完全重写）
 * 修复：视频互看不到 - 简化连接流程、详细日志、双向主动连接
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
            if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] getUserMedia error:', err);
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                this.localStream.getAudioTracks().forEach(t => { t.enabled = false; });
                if (this.onLocalStreamReady) this.onLocalStreamReady(this.localStream);
                return this.localStream;
            } catch (audioErr) { throw audioErr; }
        }
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
    
    // 修复：视频互看不到 - 简化 createOffer，确保只添加一次轨道
    async createOffer(targetClientId) {
        console.log(`[WebRTC] 发送 offer 给 ${targetClientId}`);
        
        // 关闭已存在的连接
        const existing = this.peerConnections.get(targetClientId);
        if (existing) {
            existing.close();
            this.peerConnections.delete(targetClientId);
        }
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
        this.peerConnections.set(targetClientId, pc);
        
        // 添加本地轨道
        if (!this.localStream) await this.getLocalStream();
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });
        
        // 设置回调
        this._setupPeerConnectionCallbacks(pc, targetClientId);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        return { sdp: pc.localDescription.sdp, type: pc.localDescription.type };
    }
    
    // 修复：视频互看不到 - 简化 handleOffer
    async handleOffer(fromClientId, sdp) {
        console.log(`[WebRTC] 收到 offer 来自 ${fromClientId}`);
        
        // 关闭已存在的连接
        const existing = this.peerConnections.get(fromClientId);
        if (existing) {
            existing.close();
            this.peerConnections.delete(fromClientId);
        }
        
        const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
        this.peerConnections.set(fromClientId, pc);
        
        // 设置回调（必须在 setRemoteDescription 之前）
        this._setupPeerConnectionCallbacks(pc, fromClientId);
        
        // 设置远端描述
        await pc.setRemoteDescription(new RTCSessionDescription({ sdp, type: 'offer' }));
        
        // 添加本地轨道
        if (!this.localStream) await this.getLocalStream();
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        console.log(`[WebRTC] 发送 answer 给 ${fromClientId}`);
        return { sdp: pc.localDescription.sdp, type: pc.localDescription.type };
    }
    
    async handleAnswer(fromClientId, sdp) {
        console.log(`[WebRTC] 收到 answer 来自 ${fromClientId}`);
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription({ sdp, type: 'answer' }));
        } else {
            console.warn(`[WebRTC] 收到 answer 但找不到 ${fromClientId} 的连接`);
        }
    }
    
    async handleIceCandidate(fromClientId, candidate) {
        console.log(`[WebRTC] 收到 ICE 来自 ${fromClientId}`);
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error(`[WebRTC] 添加 ICE candidate 失败:`, err);
            }
        }
    }
    
    _setupPeerConnectionCallbacks(pc, clientId) {
        pc.onicecandidate = (event) => {
            if (event.candidate && window.app && window.app.sendIceCandidate) {
                console.log(`[WebRTC] 发送 ICE 给 ${clientId}`);
                window.app.sendIceCandidate(clientId, event.candidate);
            }
        };
        
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] 连接状态变化 ${clientId}: ${pc.connectionState}`);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(clientId);
            }
        };
        
        pc.ontrack = (event) => {
            console.log(`[WebRTC] 收到远端轨道来自 ${clientId}: ${event.track.kind}`);
            if (event.streams[0] && this.onRemoteStream) {
                this.onRemoteStream(clientId, event.streams[0]);
            }
        };
    }
    
    closeConnection(clientId) {
        const pc = this.peerConnections.get(clientId);
        if (pc) {
            try { pc.getSenders().forEach(s => { if (s.track) s.track.stop(); }); pc.close(); } catch (e) {}
            this.peerConnections.delete(clientId);
        }
        if (this.onRemoteStreamRemoved) this.onRemoteStreamRemoved(clientId);
    }
    
    closeAllConnections() {
        this.peerConnections.forEach((pc, id) => {
            try { pc.getSenders().forEach(s => { if (s.track) s.track.stop(); }); pc.close(); } catch (e) {}
        });
        this.peerConnections.clear();
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
