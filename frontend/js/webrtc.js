/**
 * webrtc.js - ?? WebRTC ??
 * ????????????? P2P ??(Mesh ??)
 */

class WebRTCManager {
    constructor() {
        this.peerConnections = new Map(); // targetClientId -> RTCPeerConnection
        this.localStream = null;
        this.onRemoteStream = null; // ????? (clientId, stream, name)
        this.onRemoteStreamRemoved = null; // ??????? (clientId)
        this.onLocalStreamReady = null; // ??????? (stream)
        this.isMicOn = false;
        this.isCameraOn = false;
        this.isMobile = this.detectMobile();
    }
    
    /**
     * ????????(?? getDisplayMedia API ??????)
     */
    detectMobile() {
        return !(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    }
    
    /**
     * ???????(??+??)
     * @returns {Promise<MediaStream>}
     */
    async getLocalStream() {
        if (this.localStream) {
            return this.localStream;
        }
        
        const constraints = this.isMobile
            ? { audio: true, video: CONFIG.WEBRTC_MOBILE_VIDEO }
            : { audio: true, video: CONFIG.WEBRTC_VIDEO };
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // ???????
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
            // ??????
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
     * ??/?????
     * @returns {boolean} ??????
     */
    async toggleMic() {
        if (!this.localStream) {
            await this.getLocalStream();
        }
        
        const audioTracks = this.localStream.getAudioTracks();
        this.isMicOn = !this.isMicOn;
        audioTracks.forEach(track => {
            track.enabled = this.isMicOn;
        });
        
        return this.isMicOn;
    }
    
    /**
     * ??/?????
     * @returns {boolean} ??????
     */
    async toggleCamera() {
        if (!this.localStream) {
            await this.getLocalStream();
        }
        
        const videoTracks = this.localStream.getVideoTracks();
        if (videoTracks.length === 0) {
            // ?????????
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: this.isMobile ? CONFIG.WEBRTC_MOBILE_VIDEO : CONFIG.WEBRTC_VIDEO
                });
                const newVideoTrack = newStream.getVideoTracks()[0];
                
                // ?????????
                videoTracks.forEach(track => {
                    this.localStream.removeTrack(track);
                    track.stop();
                });
                this.localStream.addTrack(newVideoTrack);
                newVideoTrack.enabled = true;
                this.isCameraOn = true;
                
                // ???????
                if (this.onLocalStreamReady) {
                    this.onLocalStreamReady(this.localStream);
                }
                
                // ?? app.js ???? peer connection ?????
                return this.isCameraOn;
            } catch (err) {
                console.error('[WebRTC] Toggle camera error:', err);
                return this.isCameraOn;
            }
        }
        
        this.isCameraOn = !this.isCameraOn;
        videoTracks.forEach(track => {
            track.enabled = this.isCameraOn;
        });
        
        return this.isCameraOn;
    }
    
    /**
     * ????????? PeerConnection ??? offer(???)
     * @param {string} targetClientId - ????? ID
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createOffer(targetClientId) {
        const pc = this._createPeerConnection(targetClientId);
        
        // ??????
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
        
        // ?? VP9 ??
        this._setCodecPreference(pc, 'video');
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        return offer;
    }
    
    /**
     * ????? offer,?? answer
     * @param {string} fromClientId - ?? offer ???? ID
     * @param {object} sdp - SDP offer
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async handleOffer(fromClientId, sdp) {
        const pc = this._createPeerConnection(fromClientId);
        
        // ??????
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
     * ????? answer
     * @param {string} fromClientId - ?? answer ???? ID
     * @param {object} sdp - SDP answer
     */
    async handleAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    }
    
    /**
     * ????? ICE candidate
     * @param {string} fromClientId - ?? candidate ???? ID
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
     * ??????
     * @param {string} targetClientId - ????? ID
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
     * ??????
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
     * ?? RTCPeerConnection
     * @private
     */
    _createPeerConnection(targetClientId) {
        // ?????,???
        const existing = this.peerConnections.get(targetClientId);
        if (existing) {
            existing.close();
        }
        
        const pc = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS,
            iceCandidatePoolSize: 10
        });
        
        this.peerConnections.set(targetClientId, pc);
        
        // ICE candidate ??
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                if (window.app && window.app.sendIceCandidate) {
                    window.app.sendIceCandidate(targetClientId, event.candidate);
                }
            }
        };
        
        // ??????
        pc.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection state with ${targetClientId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(targetClientId);
            }
        };
        
        // ?????
        pc.ontrack = (event) => {
            console.log(`[WebRTC] Remote track from ${targetClientId}:`, event.track.kind);
            if (this.onRemoteStream && event.streams[0]) {
                // ????,????????????
                setTimeout(() => {
                    if (this.onRemoteStream && event.streams[0]) {
                        this.onRemoteStream(targetClientId, event.streams[0]);
                    }
                }, 100);
            }
        };
        
        // ??????
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        return pc;
    }
    
    /**
     * ??????(VP9 > VP8)
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
     * ???????????
     * @returns {Promise<{audioInputs: Array, videoInputs: Array}>}
     */
    async enumerateDevices() {
        try {
            // ?????,???? label ??
            await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).then(s => s.getTracks().forEach(t => t.stop()));
        } catch (e) {
            // ?????,??????
        }
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput').map(d => ({
                id: d.deviceId,
                label: d.label || `??? ${d.deviceId.slice(0, 8)}`
            }));
            const videoInputs = devices.filter(d => d.kind === 'videoinput').map(d => ({
                id: d.deviceId,
                label: d.label || `??? ${d.deviceId.slice(0, 8)}`
            }));
            return { audioInputs, videoInputs };
        } catch (err) {
            console.error('[WebRTC] enumerateDevices error:', err);
            return { audioInputs: [], videoInputs: [] };
        }
    }
    
    /**
     * ????????
     * @param {string} deviceId - ???? ID
     */
    async setAudioDevice(deviceId) {
        if (!this.localStream) return;
        
        try {
            // ????????
            this.localStream.getAudioTracks().forEach(t => t.stop());
            this.localStream.removeTrack(this.localStream.getAudioTracks()[0]);
            
            // ?????????
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: { deviceId: { exact: deviceId } }
            });
            const newTrack = newStream.getAudioTracks()[0];
            newTrack.enabled = this.isMicOn;
            
            // ??????
            this.localStream.addTrack(newTrack);
            
            // ???? PeerConnection ?????
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
     * ????????
     * @param {string} deviceId - ???? ID
     */
    async setVideoDevice(deviceId) {
        if (!this.localStream) return;
        
        try {
            // ????????
            const oldVideoTracks = this.localStream.getVideoTracks();
            oldVideoTracks.forEach(t => t.stop());
            oldVideoTracks.forEach(t => this.localStream.removeTrack(t));
            
            // ?????????
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
            
            // ??????
            this.localStream.addTrack(newTrack);
            
            // ???? PeerConnection ?????
            this.peerConnections.forEach(pc => {
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    sender.replaceTrack(newTrack);
                }
            });
            
            // ?? UI ??????
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
     * ??????
     */
    getStatus() {
        return {
            micOn: this.isMicOn,
            cameraOn: this.isCameraOn,
            peerCount: this.peerConnections.size
        };
    }
}

// ????
const webrtcManager = new WebRTCManager();
