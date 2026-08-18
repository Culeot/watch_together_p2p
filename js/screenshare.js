/**
 * screenshare.js - ???? WebRTC ??
 * ??????? P2P ??,?????
 */

class ScreenShareManager {
    constructor() {
        this.peerConnections = new Map(); // targetClientId -> RTCPeerConnection
        this.screenStream = null;
        this.isSharing = false;
        this.currentQuality = CONFIG.DEFAULT_QUALITY;
        this.onShareStarted = null; // ??????
        this.onShareStopped = null; // ??????
        this.onRemoteScreenStream = null; // ??????? (stream, quality)
        this.onRemoteScreenStopped = null; // ????????
        this.statsInterval = null;
        this.lastQualityDowngrade = 0;
    }
    
    /**
     * ???????
     * @param {string} quality - ????
     * @returns {Promise<MediaStream>}
     */
    async getScreenStream(quality = CONFIG.DEFAULT_QUALITY) {
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        if (!settings) {
            throw new Error(`Unknown quality: ${quality}`);
        }
        
        this.currentQuality = quality;
        
        // ????????????,?????
        const constraintsList = [
            // ??:???? + ?????? + ??
            {
                video: {
                    width: { ideal: settings.width, max: settings.width },
                    height: { ideal: settings.height, max: settings.height },
                    frameRate: { ideal: settings.frameRate, max: settings.frameRate },
                    displaySurface: 'monitor'
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 48000
                }
            },
            // ?? 1:??????,???
            {
                video: {
                    width: { ideal: settings.width, max: settings.width },
                    height: { ideal: settings.height, max: settings.height },
                    frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            },
            // ?? 2:? ideal + ??
            {
                video: {
                    width: { ideal: settings.width },
                    height: { ideal: settings.height },
                    frameRate: { ideal: settings.frameRate }
                },
                audio: true
            },
            // ?? 3:???? + ??
            {
                video: {
                    width: { ideal: settings.width },
                    height: { ideal: settings.height }
                },
                audio: true
            },
            // ?? 4:??? + ??
            {
                video: true,
                audio: true
            },
            // ?? 5:???(???)
            {
                video: true,
                audio: false
            }
        ];
        
        let lastErr = null;
        for (const constraints of constraintsList) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
                
                // ????,??? applyConstraints ????????
                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (videoTrack) {
                    try {
                        await videoTrack.applyConstraints({
                            width: { ideal: settings.width },
                            height: { ideal: settings.height },
                            frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                        });
                    } catch (e) {
                        // applyConstraints ???????,??
                        console.warn('[ScreenShare] applyConstraints failed:', e.message);
                    }
                }
                
                // ??????(?????????????)
                this.screenStream.getVideoTracks()[0].onended = () => {
                    this.stopSharing();
                };
                
                return this.screenStream;
            } catch (err) {
                lastErr = err;
                console.warn('[ScreenShare] getDisplayMedia failed with constraints:', JSON.stringify(constraints), err.message);
                // ?????????
            }
        }
        
        // ???????
        console.error('[ScreenShare] All getDisplayMedia attempts failed:', lastErr);
        throw lastErr || new Error('?????????');
    }
    
    /**
     * ??????
     * @param {string} quality - ????
     * @param {string[]} memberIds - ???????? ID ??
     */
    async startSharing(quality, memberIds) {
        if (this.isSharing) {
            await this.stopSharing();
        }
        
        try {
            await this.getScreenStream(quality);
            this.isSharing = true;
            
            // ????
            this._applyBitrate(quality);
            
            // ????????
            this._startQualityMonitor();
            
            if (this.onShareStarted) {
                this.onShareStarted(this.screenStream, quality);
            }
            
            return true;
        } catch (err) {
            console.error('[ScreenShare] Start sharing error:', err);
            this.isSharing = false;
            throw err;
        }
    }
    
    /**
     * ??????
     */
    async stopSharing() {
        this.isSharing = false;
        
        // ??????
        this._stopQualityMonitor();
        
        // ????????
        this.peerConnections.forEach((pc, clientId) => {
            try {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        sender.track.stop();
                    }
                });
                pc.close();
            } catch (e) {
                console.error('[ScreenShare] Close share connection error:', e);
            }
        });
        this.peerConnections.clear();
        
        // ?????
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        if (this.onShareStopped) {
            this.onShareStopped();
        }
    }
    
    /**
     * ????
     * @param {string} newQuality - ?????
     */
    async changeQuality(newQuality) {
        if (!this.isSharing || !this.screenStream) {
            console.warn('[ScreenShare] Not sharing, cannot change quality');
            return;
        }
        
        this.currentQuality = newQuality;
        const settings = CONFIG.SCREEN_SHARE_QUALITY[newQuality];
        
        try {
            // ?? applyConstraints ??????/??
            const videoTrack = this.screenStream.getVideoTracks()[0];
            if (videoTrack) {
                try {
                    await videoTrack.applyConstraints({
                        width: { ideal: settings.width, max: settings.width },
                        height: { ideal: settings.height, max: settings.height },
                        frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                    });
                } catch (e) {
                    console.warn('[ScreenShare] applyConstraints failed:', e.message);
                }
            }
            
            // ????
            this._applyBitrate(newQuality);
            
            console.log('[ScreenShare] Quality changed to:', newQuality);
        } catch (err) {
            console.error('[ScreenShare] Change quality error:', err);
        }
    }
    
    /**
     * ??????? offer
     * @param {string} fromClientId - ???
     * @param {object} sdp - SDP offer
     * @param {string} quality - ????
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async handleShareOffer(fromClientId, sdp, quality) {
        const pc = this._createSharePeerConnection(fromClientId);
        
        if (quality) {
            this.currentQuality = quality;
        }
        
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        return answer;
    }
    
    /**
     * ??????? answer
     * @param {string} fromClientId - ???
     * @param {object} sdp - SDP answer
     */
    async handleShareAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    }
    
    /**
     * ???? ICE candidate
     * @param {string} fromClientId - ???
     * @param {object} candidate - ICE candidate
     */
    async handleShareIceCandidate(fromClientId, candidate) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
                console.error('[ScreenShare] Add ICE candidate error:', err);
            }
        }
    }
    
    /**
     * ???????
     * @param {string} fromClientId - ??? ID
     * @param {MediaStream} stream - ???
     * @param {string} quality - ????
     */
    onRemoteScreenReceived(fromClientId, stream, quality) {
        if (this.onRemoteScreenStream) {
            this.onRemoteScreenStream(stream, quality);
        }
    }
    
    /**
     * ??????
     * @param {string} clientId - ??? ID
     */
    closeConnection(clientId) {
        const pc = this.peerConnections.get(clientId);
        if (pc) {
            try {
                pc.getSenders().forEach(sender => {
                    if (sender.track) {
                        sender.track.stop();
                    }
                });
                pc.close();
            } catch (e) {
                console.error('[ScreenShare] Close connection error:', e);
            }
            this.peerConnections.delete(clientId);
        }
    }
    
    /**
     * ???? PeerConnection(????)
     * @private
     */
    async _createShareConnection(targetClientId, quality) {
        const pc = this._createSharePeerConnection(targetClientId);
        
        // ????????
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => {
                pc.addTrack(track, this.screenStream);
            });
        }
        
        // ?? VP9 ??
        this._setShareCodecPreference(pc);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        return offer;
    }
    
    /**
     * ???? offer(? app.js ??)
     * @param {string} targetClientId - ????? ID
     * @param {string} quality - ????
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createShareOffer(targetClientId, quality) {
        return await this._createShareConnection(targetClientId, quality);
    }
    
    /**
     * ???? PeerConnection(???)
     * @private
     */
    _createSharePeerConnection(targetClientId) {
        const existing = this.peerConnections.get(targetClientId);
        if (existing) {
            existing.close();
        }
        
        const pc = new RTCPeerConnection({
            iceServers: CONFIG.ICE_SERVERS,
            iceCandidatePoolSize: 10
        });
        
        this.peerConnections.set(targetClientId, pc);
        
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                if (window.app && window.app.sendShareIceCandidate) {
                    window.app.sendShareIceCandidate(targetClientId, event.candidate);
                }
            }
        };
        
        pc.onconnectionstatechange = () => {
            console.log(`[ScreenShare] Connection state with ${targetClientId}:`, pc.connectionState);
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.closeConnection(targetClientId);
            }
        };
        
        pc.ontrack = (event) => {
            console.log(`[ScreenShare] Remote track from ${targetClientId}`);
            if (this.onRemoteScreenStream && event.streams[0]) {
                this.onRemoteScreenStream(event.streams[0], this.currentQuality || CONFIG.DEFAULT_QUALITY);
            }
        };
        
        return pc;
    }
    
    /**
     * ????????
     * @private
     */
    _setShareCodecPreference(pc) {
        try {
            const transceivers = pc.getTransceivers();
            const videoTransceiver = transceivers.find(t => 
                t.sender.track && t.sender.track.kind === 'video'
            );
            
            if (videoTransceiver) {
                const capabilities = RTCRtpSender.getCapabilities('video');
                if (capabilities) {
                    const vp9Codec = capabilities.codecs.find(c => c.mimeType === 'video/VP9');
                    if (vp9Codec) {
                        videoTransceiver.setCodecPreferences([vp9Codec]);
                    }
                }
            }
        } catch (err) {
            console.warn('[ScreenShare] Set codec preference error:', err);
        }
    }
    
    /**
     * ??????
     * @private
     */
    _applyBitrate(quality) {
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        if (!settings || !this.screenStream) return;
        
        this.peerConnections.forEach(pc => {
            pc.getSenders().forEach(sender => {
                if (sender.track && sender.track.kind === 'video') {
                    const params = sender.getParameters();
                    if (!params.encodings) {
                        params.encodings = [{}];
                    }
                    params.encodings[0].maxBitrate = settings.maxBitrate;
                    params.encodings[0].maxFramerate = settings.frameRate;
                    sender.setParameters(params).catch(err => {
                        console.warn('[ScreenShare] Set parameters error:', err);
                    });
                }
            });
        });
    }
    
    /**
     * ????????
     * @private
     */
    _startQualityMonitor() {
        this._stopQualityMonitor();
        
        this.statsInterval = setInterval(async () => {
            if (!this.isSharing) return;
            
            this.peerConnections.forEach(async (pc, clientId) => {
                try {
                    const stats = await pc.getStats();
                    let packetsLost = 0;
                    let packetsSent = 0;
                    
                    stats.forEach(report => {
                        if (report.type === 'outbound-rtp' && report.kind === 'video') {
                            packetsSent = report.packetsSent || 0;
                        }
                        if (report.type === 'remote-inbound-rtp' && report.kind === 'video') {
                            packetsLost = report.packetsLost || 0;
                        }
                    });
                    
                    const totalPackets = packetsSent + packetsLost;
                    const lossRate = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;
                    
                    // ?????,????
                    if (lossRate > CONFIG.DYNAMIC_QUALITY.packetLossThreshold && packetsSent > 100) {
                        this._downgradeQuality();
                    }
                } catch (err) {
                    // ??????
                }
            });
        }, CONFIG.DYNAMIC_QUALITY.checkInterval);
    }
    
    /**
     * ??????
     * @private
     */
    _stopQualityMonitor() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }
    
    /**
     * ????
     * @private
     */
    async _downgradeQuality() {
        const now = Date.now();
        if (now - this.lastQualityDowngrade < CONFIG.DYNAMIC_QUALITY.cooldown) {
            return;
        }
        
        const qualityOrder = ['2k60', '1080p60', '1080p30', '720p60'];
        const currentIndex = qualityOrder.indexOf(this.currentQuality);
        
        if (currentIndex < qualityOrder.length - 1) {
            const newQuality = qualityOrder[currentIndex + 1];
            this.lastQualityDowngrade = now;
            await this.changeQuality(newQuality);
            
            // ?? app.js ??????
            if (window.app && window.app.onQualityDowngraded) {
                window.app.onQualityDowngraded(newQuality);
            }
            
            console.log('[ScreenShare] Auto-downgraded to:', newQuality);
        }
    }
    
    /**
     * ????????
     */
    getStatus() {
        return {
            isSharing: this.isSharing,
            quality: this.currentQuality,
            peerCount: this.peerConnections.size
        };
    }
}

// ????
const screenShareManager = new ScreenShareManager();
