/**
 * screenshare.js - 屏幕共享 WebRTC 管理
 * 管理屏幕共享的 P2P 连接，独立于连麦
 */

class ScreenShareManager {
    constructor() {
        this.peerConnections = new Map(); // targetClientId -> RTCPeerConnection
        this.screenStream = null;
        this.isSharing = false;
        this.currentQuality = CONFIG.DEFAULT_QUALITY;
        this.onShareStarted = null; // 共享开始回调
        this.onShareStopped = null; // 共享停止回调
        this.onRemoteScreenStream = null; // 远程屏幕流回调 (stream, quality)
        this.onRemoteScreenStopped = null; // 远程屏幕停止回调
        this.statsInterval = null;
        this.lastQualityDowngrade = 0;
    }
    
    /**
     * 获取屏幕共享流
     * @param {string} quality - 画质档位
     * @returns {Promise<MediaStream>}
     */
    async getScreenStream(quality = CONFIG.DEFAULT_QUALITY) {
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        if (!settings) {
            throw new Error(`Unknown quality: ${quality}`);
        }
        
        this.currentQuality = quality;
        
        // 尝试用指定约束获取屏幕流，失败则降级
        const constraintsList = [
            // 首选：精确约束 + 表面类型提示 + 音频
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
            // 降级 1：不限表面类型，带音频
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
            // 降级 2：仅 ideal + 音频
            {
                video: {
                    width: { ideal: settings.width },
                    height: { ideal: settings.height },
                    frameRate: { ideal: settings.frameRate }
                },
                audio: true
            },
            // 降级 3：仅分辨率 + 音频
            {
                video: {
                    width: { ideal: settings.width },
                    height: { ideal: settings.height }
                },
                audio: true
            },
            // 降级 4：仅视频 + 音频
            {
                video: true,
                audio: true
            },
            // 降级 5：仅视频（最宽松）
            {
                video: true,
                audio: false
            }
        ];
        
        let lastErr = null;
        for (const constraints of constraintsList) {
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
                
                // 获取流后，尝试用 applyConstraints 强制应用目标参数
                const videoTrack = this.screenStream.getVideoTracks()[0];
                if (videoTrack) {
                    try {
                        await videoTrack.applyConstraints({
                            width: { ideal: settings.width },
                            height: { ideal: settings.height },
                            frameRate: { ideal: settings.frameRate, max: settings.frameRate }
                        });
                    } catch (e) {
                        // applyConstraints 失败不影响共享，忽略
                        console.warn('[ScreenShare] applyConstraints failed:', e.message);
                    }
                }
                
                // 监听共享停止（用户点击浏览器停止共享按钮）
                this.screenStream.getVideoTracks()[0].onended = () => {
                    this.stopSharing();
                };
                
                return this.screenStream;
            } catch (err) {
                lastErr = err;
                console.warn('[ScreenShare] getDisplayMedia failed with constraints:', JSON.stringify(constraints), err.message);
                // 继续尝试下一个约束
            }
        }
        
        // 所有约束都失败
        console.error('[ScreenShare] All getDisplayMedia attempts failed:', lastErr);
        throw lastErr || new Error('无法获取屏幕共享流');
    }
    
    /**
     * 开始屏幕共享
     * @param {string} quality - 画质档位
     * @param {string[]} memberIds - 需要发送的客户端 ID 列表
     */
    async startSharing(quality, memberIds) {
        if (this.isSharing) {
            await this.stopSharing();
        }
        
        try {
            await this.getScreenStream(quality);
            this.isSharing = true;
            
            // 设置码率
            this._applyBitrate(quality);
            
            // 开始监控网络质量
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
     * 停止屏幕共享
     */
    async stopSharing() {
        this.isSharing = false;
        
        // 停止质量监控
        this._stopQualityMonitor();
        
        // 关闭所有共享连接
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
        
        // 停止屏幕流
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => track.stop());
            this.screenStream = null;
        }
        
        if (this.onShareStopped) {
            this.onShareStopped();
        }
    }
    
    /**
     * 切换画质
     * @param {string} newQuality - 新画质档位
     */
    async changeQuality(newQuality) {
        if (!this.isSharing || !this.screenStream) {
            console.warn('[ScreenShare] Not sharing, cannot change quality');
            return;
        }
        
        this.currentQuality = newQuality;
        const settings = CONFIG.SCREEN_SHARE_QUALITY[newQuality];
        
        try {
            // 通过 applyConstraints 应用新分辨率/帧率
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
            
            // 更新码率
            this._applyBitrate(newQuality);
            
            console.log('[ScreenShare] Quality changed to:', newQuality);
        } catch (err) {
            console.error('[ScreenShare] Change quality error:', err);
        }
    }
    
    /**
     * 处理收到的共享 offer
     * @param {string} fromClientId - 发送者
     * @param {object} sdp - SDP offer
     * @param {string} quality - 画质档位
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
     * 处理收到的共享 answer
     * @param {string} fromClientId - 发送者
     * @param {object} sdp - SDP answer
     */
    async handleShareAnswer(fromClientId, sdp) {
        const pc = this.peerConnections.get(fromClientId);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
    }
    
    /**
     * 处理共享 ICE candidate
     * @param {string} fromClientId - 发送者
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
     * 收到远程屏幕流
     * @param {string} fromClientId - 共享者 ID
     * @param {MediaStream} stream - 媒体流
     * @param {string} quality - 画质档位
     */
    onRemoteScreenReceived(fromClientId, stream, quality) {
        if (this.onRemoteScreenStream) {
            this.onRemoteScreenStream(stream, quality);
        }
    }
    
    /**
     * 关闭指定连接
     * @param {string} clientId - 客户端 ID
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
     * 创建共享 PeerConnection（共享者端）
     * @private
     */
    async _createShareConnection(targetClientId, quality) {
        const pc = this._createSharePeerConnection(targetClientId);
        
        // 添加屏幕视频轨道
        if (this.screenStream) {
            this.screenStream.getTracks().forEach(track => {
                pc.addTrack(track, this.screenStream);
            });
        }
        
        // 设置 VP9 优先
        this._setShareCodecPreference(pc);
        
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        return offer;
    }
    
    /**
     * 创建共享 offer（供 app.js 调用）
     * @param {string} targetClientId - 目标客户端 ID
     * @param {string} quality - 画质档位
     * @returns {Promise<RTCSessionDescriptionInit>}
     */
    async createShareOffer(targetClientId, quality) {
        return await this._createShareConnection(targetClientId, quality);
    }
    
    /**
     * 创建共享 PeerConnection（接收端）
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
     * 设置共享编码偏好
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
     * 应用码率限制
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
     * 开始网络质量监控
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
                    
                    // 丢包率过高，触发降级
                    if (lossRate > CONFIG.DYNAMIC_QUALITY.packetLossThreshold && packetsSent > 100) {
                        this._downgradeQuality();
                    }
                } catch (err) {
                    // 忽略统计错误
                }
            });
        }, CONFIG.DYNAMIC_QUALITY.checkInterval);
    }
    
    /**
     * 停止质量监控
     * @private
     */
    _stopQualityMonitor() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
    }
    
    /**
     * 降级画质
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
            
            // 通知 app.js 广播画质变化
            if (window.app && window.app.onQualityDowngraded) {
                window.app.onQualityDowngraded(newQuality);
            }
            
            console.log('[ScreenShare] Auto-downgraded to:', newQuality);
        }
    }
    
    /**
     * 获取当前共享状态
     */
    getStatus() {
        return {
            isSharing: this.isSharing,
            quality: this.currentQuality,
            peerCount: this.peerConnections.size
        };
    }
}

// 全局实例
const screenShareManager = new ScreenShareManager();
