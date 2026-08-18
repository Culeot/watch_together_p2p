/**
 * webrtc.js - 连麦 WebRTC 管理
 * 管理房间内成员之间的音视频 P2P 连接（Mesh 拓扑）
 */

class WebRTCManager {
    constructor() {
        this.peerConnections = new Map(); // targetClientId -> RTCPeerConnection
        this.localStream = null;
        this.onRemoteStream = null; // 远程流回调 (clientId, stream, name)
        this.onRemoteStreamRemoved = null; // 远程流移除回调 (clientId)
        this.onLocalStreamReady = null; // 本地流就绪回调 (stream)
        this.isMicOn = false;
        this.isCameraOn = false;
        this.isMobile = this.detectMobile();
    }
    
    /**
     * 检测是否为移动端（通过 getDisplayMedia API 是否存在判断）
     */
    detectMobile() {
        return !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    }
    
    /**
     * 获取本地媒体流（音频+视频）
     * @returns {Promise<MediaStream>}
     */
    async getLocalStream() {
        if (this.localStream) {
            return this.localStream;
        }
        
        const constraints = this.isMobile
            ? { 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true, 
                    autoGainControl: true 
                }, 
                video: CONFIG.WEBRTC_MOBILE_VIDEO 
              }
            : { 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true, 
                    autoGainControl: true 
                }, 
                video: CONFIG.WEBRTC_VIDEO 
              };
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // 默认关闭音视频
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = false;
            });
            this.localStream.getVideoTracks().forEach(track => {
                track.enabled = false;
            });
            
            if (this.onLocalStreamReady) {
                this.onLocalStreamReady(this.localStream);
            }
            
            return this.localStream;
        } catch (err) {
            console.error('[WebRTC] getUserMedia error:', err);
            // 降级为纯音频
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                this.localStream.getAudioTracks().forEach(track => {
                    track.enabled = false;
                });
                if (this.onLocalStreamReady) {
                    this.onLocalStreamReady(this.localStream);
                }
                return this.localStream;
            } catch (audioErr) {
                console.error('[WebRTC] Audio-only fallback failed:', audioErr);
                throw audioErr;
            }
        }
    }
    
    /**
     * 开启/关闭麦克风
     * @returns {boolean} 切换后的状态
     */
    async toggleMic() {
        if (!this.localStream) {
            await this.getLocalStream();
        }
        
        // 如果当前没有音频轨道，先重新获取
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            await this.enableAudio();
        }
        
        const tracks = this.localStream.getAudioTracks();
        this.isMicOn = !this.isMicOn;
        tracks.forEach(track => {
            track.enabled = this.isMicOn;
        });
        
        return this.isMicOn;
    }
    
    /**
     * 开启/关闭摄像头
     * @returns {boolean} 切换后的状态
     */
    async toggleCamera() {
        if (!this.localStream) {
            await this.getLocalStream();
        }
        
        // 如果当前没有视频轨道，先重新获取
        const videoTracks = this.localStream.getVideoTracks();
        if (videoTracks.length === 0) {
            await this.enableVideo();
        }
        
        const tracks = this.localStream.getVideoTracks();
        this.isCameraOn = !this.isCameraOn;
        tracks.forEach(track => {
            track.enabled = this.isCameraOn;
        });
        
        return this.isCameraOn;
    }
    
    /**
     * 创建到指定客户端的 PeerConnection 并发送 offer（发起方）
     * @param {string} targetClientId - 目标客户端 ID
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createOffer(targetClientId) {
        const pc = this._createPeerConnection(targetClientId);
        
        // 添加本地轨道
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        } else {
            await this.getLocalStream();
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        // 设置 VP9 优先
        this._setCodecPreference(pc, 'video');
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        return offer;
    }
    
    /**
     * 处理收到的 offer，创建 answer
     * @param {string} fromClientId - 发送 offer 的客户端 ID
     * @param {object} sdp - SDP offer
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async handleOffer(fromClientId, sdp) {
        const pc = this._createPeerConnection(fromClientId);
        
        // 添加本地轨道
        if (!this.localStream) {
            await this.getLocalStream();
        }
        this.localStream.getTracks().forEach(track => {
            pc.addTrack(track, this.localStream);
        });
        
        this._setCodecPreference(pc, 'video');
        
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        return answer;
    }
    
    /**
     * 处理收到的 answer
     * @param {string} fromClientId - 发送 answer 的客户端 ID
     * @param {object} sdp - SDP answer
     */
    async handleAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    }
    
    /**
     * 处理收到的 ICE candidate
     * @param {string} fromClientId - 发送 candidate 的客户端 ID
     * @param {object} candidate - ICE candidate
     */
    async handleIceCandidate(fromClientId, candidate) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error('[WebRTC] Add ICE candidate error:', err);
            }
        }
    }
    
    /**
     * 关闭指定连接
     * @param {string} targetClientId - 目标客户端 ID
     */
    closeConnection(targetClientId) {
        const pc = this.peerConnections.get(targetClientId);
        if (pc) {
            try {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        sender.track.stop();
                    }
                });
                pc.close();
            } catch (e) {
                console.error('[WebRTC] Close connection error:', e);
            }
            this.peerConnections.delete(targetClientId);
        }
        
        if (this.onRemoteStreamRemoved) {
            this.onRemoteStreamRemoved(targetClientId);
        }
    }
    
    /**
     * 关闭所有连接
     */
    closeAllConnections() {
        this.peerConnections.forEach((pc, clientId) => {
            try {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        sender.track.stop();
                    }
                });
                pc.close();
            } catch (e) {
                console.error('[WebRTC] Close all error:', e);
            }
        });
        this.peerConnections.clear();
    }
    
    /**
     * 创建 RTCPeerConnection
     * @private
     */
    _createPeerConnection(targetClientId) {
        // 如果已存在，先关闭
        const existing = this.peerConnections.get(targetClientId);
        if (existing) {
            existing.close();
        }
        
        const pc = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS,
            iceCandidatePoolSize: 10
        });
        
        this.peerConnections.set(targetClientId, pc);
        
        // ICE candidate 事件
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                if (window.app && window.app.sendIceCandidate) {
                    window.app.sendIceCandidate(targetClientId, event.candidate);
                }
            }
        };
        
        // 连接状态变化
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${targetClientId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(targetClientId);
            }
        };
        
        // 收到远程流
        pc.ontrack = (event) => {
            console.log(`[WebRTC] Remote track from ${targetClientId}:`, event.track.kind);
            if (this.onRemoteStream && event.streams[0]) {
                // 延迟回调，确保所有轨道都添加到流中
                setTimeout(() => {
                    if (this.onRemoteStream && event.streams[0]) {
                        this.onRemoteStream(targetClientId, event.streams[0]);
                    }
                }, 100);
            }
        };
        
        // 添加已有轨道
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        return pc;
    }
    
    /**
     * 设置编码偏好（VP9 > VP8）
     * @private
     */
    _setCodecPreference(pc, kind) {
        if (!CONFIG.SDP_PREFER_VP9) return;
        
        try {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => 
                t.sender.track && t.sender.track.kind === kind
            );
            
            if (videoTransceiver) {
                const capabilities = RTCRtpSender.getCapabilities(kind);
                if (capabilities) {
                    const vp9Codec = capabilities.codecs.find(c => 
                        c.mimeType === 'video/VP9'
                    );
                    if (vp9Codec) {
                        videoTransceiver.setCodecPreferences([vp9Codec]);
                    }
                }
            }
        } catch (err) {
            console.warn('[WebRTC] Set codec preference error:', err);
        }
    }
    
    /**
     * 枚举所有音视频输入/输出设备
     * @returns {Promise<{audioInputs: Array, videoInputs: Array, audioOutputs: Array}>}
     */
    async enumerateDevices() {
        try {
            // 先请求权限，否则设备 label 为空
            await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop()));
        } catch (e) {
            // 权限被拒绝，继续尝试枚举
        }
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput').map(d => ({
                id: d.deviceId,
                label: d.label || `麦克风 ${d.deviceId.slice(0, 8)}`
            }));
            const videoInputs = devices.filter(d => d.kind === 'videoinput').map(d => ({
                id: d.deviceId,
                label: d.label || `摄像头 ${d.deviceId.slice(0, 8)}`
            }));
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput').map(d => ({
                id: d.deviceId,
                label: d.label || `扬声器 ${d.deviceId.slice(0, 8)}`
            }));
            return { audioInputs, videoInputs, audioOutputs };
        } catch (err) {
            console.error('[WebRTC] enumerateDevices error:', err);
            return { audioInputs: [], videoInputs: [], audioOutputs: [] };
        }
    }
    
    /**
     * 设置音频输出设备（扬声器）
     * @param {string} deviceId - 扬声器设备 ID
     */
    async setAudioOutput(deviceId) {
        try {
            const audioElements = document.querySelectorAll('video, audio');
            for (const el of audioElements) {
                if (el.setSinkId) {
                    await el.setSinkId(deviceId);
                }
            }
            console.log('[WebRTC] Audio output set to:', deviceId);
        } catch (err) {
            console.error('[WebRTC] Set audio output error:', err);
            throw err;
        }
    }
    
    /**
     * 关闭音频输入（麦克风）
     */
    disableAudio() {
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(t => {
                t.stop();
                this.localStream.removeTrack(t);
            });
        }
        this.isMicOn = false;
    }
    
    /**
     * 关闭视频输入（摄像头）
     */
    disableVideo() {
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(t => {
                t.stop();
                this.localStream.removeTrack(t);
            });
        }
        this.isCameraOn = false;
    }
    
    /**
     * 重新启用音频输入
     */
    async enableAudio() {
        if (!this.localStream) {
            await this.getLocalStream();
            return;
        }
        const hasAudio = this.localStream.getAudioTracks().length > 0;
        if (!hasAudio) {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true, 
                    autoGainControl: true 
                } 
            });
            const track = stream.getAudioTracks()[0];
            track.enabled = this.isMicOn;
            this.localStream.addTrack(track);
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) sender.replaceTrack(track);
                else pc.addTrack(track, this.localStream);
            });
        }
    }
    
    /**
     * 重新启用视频输入
     */
    async enableVideo() {
        if (!this.localStream) {
            await this.getLocalStream();
            return;
        }
        const hasVideo = this.localStream.getVideoTracks().length > 0;
        if (!hasVideo) {
            const constraints = this.isMobile
                ? { video: CONFIG.WEBRTC_MOBILE_VIDEO }
                : { video: CONFIG.WEBRTC_VIDEO };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];
            track.enabled = this.isCameraOn;
            this.localStream.addTrack(track);
            
            // 更新所有 PeerConnection 的视频轨道
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) sender.replaceTrack(track);
                else pc.addTrack(track, this.localStream);
            });
            
            // 通知本地流更新（强制刷新视频元素）
            if (this.onLocalStreamReady) {
                // 延迟一帧确保轨道已附加
                requestAnimationFrame(() => {
                    this.onLocalStreamReady(this.localStream);
                });
            }
        }
    }
    
    /**
     * 设置音频输入设备
     * @param {string} deviceId - 音频设备 ID
     */
    async setAudioDevice(deviceId) {
        if (!this.localStream) return;
        
        try {
            // 停止当前音频轨道
            this.localStream.getAudioTracks().forEach(t => t.stop());
            this.localStream.removeTrack(this.localStream.getAudioTracks()[0]);
            
            // 获取新设备的音频流
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } }
            });
            const newTrack = newStream.getAudioTracks()[0];
            newTrack.enabled = this.isMicOn;
            
            // 添加到本地流
            this.localStream.addTrack(newTrack);
            
            // 更新所有 PeerConnection 的音频轨道
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                if (sender) {
                    sender.replaceTrack(newTrack);
                }
            });
            
            console.log('[WebRTC] Audio device set to:', deviceId);
        } catch (err) {
            console.error('[WebRTC] Set audio device error:', err);
            throw err;
        }
    }
    
    /**
     * 设置视频输入设备
     * @param {string} deviceId - 视频设备 ID
     */
    async setVideoDevice(deviceId) {
        if (!this.localStream) return;
        
        try {
            // 停止当前视频轨道
            const oldVideoTracks = this.localStream.getVideoTracks();
            oldVideoTracks.forEach(t => t.stop());
            oldVideoTracks.forEach(t => this.localStream.removeTrack(t));
            
            // 获取新设备的视频流
            const constraints = {
                video: { deviceId: { exact: deviceId } }
            };
            if (this.isMobile) {
                constraints.video.width = CONFIG.WEBRTC_MOBILE_VIDEO.width;
                constraints.video.height = CONFIG.WEBRTC_MOBILE_VIDEO.height;
            } else {
                constraints.video.width = CONFIG.WEBRTC_VIDEO.width;
                constraints.video.height = CONFIG.WEBRTC_VIDEO.height;
                constraints.video.frameRate = CONFIG.WEBRTC_VIDEO.frameRate;
            }
            
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newTrack = newStream.getVideoTracks()[0];
            newTrack.enabled = this.isCameraOn;
            
            // 添加到本地流
            this.localStream.addTrack(newTrack);
            
            // 更新所有 PeerConnection 的视频轨道
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newTrack);
                }
            });
            
            // 通知 UI 更新本地预览
            if (this.onLocalStreamReady) {
                this.onLocalStreamReady(this.localStream);
            }
            
            console.log('[WebRTC] Video device set to:', deviceId);
        } catch (err) {
            console.error('[WebRTC] Set video device error:', err);
            throw err;
        }
    }
    
    /**
     * 获取当前状态
     */
    getStatus() {
        return {
            micOn: this.isMicOn,
            cameraOn: this.isCameraOn,
            peerCount: this.peerConnections.size
        };
    }
}

// 全局实例
const webrtcManager = new WebRTCManager();
