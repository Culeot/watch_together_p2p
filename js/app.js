/**
 * app.js - 主入口，协调各模块
 * 管理房间状态、消息协议处理、管理员逻辑
 */

class App {
    constructor() {
        this.roomId = '';
        this.nickname = '';
        this.clientId = '';
        this.isAdmin = false;
        this.isPC = !webrtcManager.isMobile;
        this.members = new Map();
        this.memberHeartbeats = new Map();
        this.shareRequests = [];
        this.currentSharer = null;
        this.isInRoom = false;
        this.hasInitMedia = false;
        this._heartbeatCheckInterval = null;
        this._reconnecting = false;
    }
    
    /**
     * 保存房间状态到 localStorage
     */
    _saveState() {
        const state = {
            roomId: this.roomId,
            nickname: this.nickname,
            clientId: this.clientId,
            isAdmin: this.isAdmin,
            isPC: this.isPC
        };
        localStorage.setItem('watchtogether_room', JSON.stringify(state));
    }
    
    /**
     * 从 localStorage 恢复房间状态
     */
    _loadState() {
        try {
            const saved = localStorage.getItem('watchtogether_room');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {}
        return null;
    }
    
    /**
     * 清除保存的状态
     */
    _clearState() {
        localStorage.removeItem('watchtogether_room');
    }
    
    /**
     * 初始化应用
     */
    init() {
        uiManager.init();
        this.clientId = mqttManager.getClientId();
        
        // 设置 MQTT 消息处理器
        this._setupMessageHandlers();
        
        // 设置 WebRTC 远程流回调（在连接前设置好）
        webrtcManager.onRemoteStream = (clientId, stream) => {
            const member = this.members.get(clientId);
            const name = member ? member.name : '未知';
            const audioTracks = stream.getAudioTracks();
            const isMuted = audioTracks.length === 0 || !audioTracks[0].enabled;
            uiManager.addPipVideo(clientId, stream, name, false, isMuted);
            uiManager.updateMemberVideo(clientId, stream, name, isMuted);
            console.log('[App] Remote stream from', clientId, 'tracks:', stream.getTracks().map(t => t.kind));
        };
        
        webrtcManager.onRemoteStreamRemoved = (clientId) => {
            uiManager.removePipVideo(clientId);
            uiManager.removeMemberVideo(clientId);
        };
        
        // 设置屏幕共享远程流回调
        screenShareManager.onRemoteScreenStream = (stream, quality) => {
            uiManager.showSharedScreen(stream, quality);
        };
        
        // 设置 MQTT 连接状态回调
        mqttManager.onConnectionChange = (connected, reconnecting) => {
            uiManager.updateConnectionStatus(connected, reconnecting);
        };
        
        mqttManager.onDisconnect = () => {
            // 不要立即标记为离开，等待重连
            console.log('[App] MQTT disconnected, waiting for reconnect...');
        };
        
        // 检查是否有保存的房间状态，有则自动重连
        this._tryReconnect();
        
        console.log('[App] Initialized, clientId:', this.clientId);
    }
    
    /**
     * 尝试从 localStorage 恢复房间状态并重新连接
     */
    async _tryReconnect() {
        const saved = this._loadState();
        if (!saved || !saved.roomId) return;
        
        console.log('[App] Found saved room, reconnecting...', saved);
        this._reconnecting = true;
        
        // 恢复状态
        this.roomId = saved.roomId;
        this.nickname = saved.nickname;
        this.isAdmin = saved.isAdmin;
        this.isPC = saved.isPC;
        
        try {
            uiManager.showLoading('正在重新连接房间...');
            
            // 连接 MQTT
            await mqttManager.connect(this.roomId);
            
            // 初始化媒体
            await this._initLocalMedia();
            
            // 重新注册自己
            this.members.set(this.clientId, {
                id: this.clientId,
                name: this.nickname,
                isAdmin: this.isAdmin,
                isPC: this.isPC,
                joinedAt: Date.now()
            });
            this.memberHeartbeats.set(this.clientId, Date.now());
            this.isInRoom = true;
            
            // 切换到房间页面
            uiManager.showRoom();
            uiManager.updateRoomInfo(this.roomId, this.members.size);
            uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
            uiManager.hideLoading();
            uiManager.showToast('已重新连接房间', 'success');
            
            // 加载设备列表
            this._loadDevices();
            
        } catch (err) {
            console.error('[App] Reconnect failed:', err);
            uiManager.hideLoading();
            uiManager.showToast('重新连接失败: ' + err.message, 'error');
            this._clearState();
        } finally {
            this._reconnecting = false;
        }
    }
    
    /**
     * 创建房间
     * @param {string} nickname - 用户昵称
     */
    async createRoom(nickname) {
        this.nickname = nickname;
        this.roomId = this._generateRoomId();
        this.isAdmin = true;
        this.isInRoom = true;
        
        uiManager.showLoading('正在创建房间...');
        
        try {
            // 连接 MQTT
            await mqttManager.connect(this.roomId);
            
            // 注册自己为成员
            this.members.set(this.clientId, {
                id: this.clientId,
                name: this.nickname,
                isAdmin: true,
                isPC: this.isPC,
                joinedAt: Date.now()
            });
            this.memberHeartbeats.set(this.clientId, Date.now());
            
            // 保存状态，刷新后恢复
            this._saveState();
            
            // 广播房间创建消息
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.ROOM_CREATED,
                roomId: this.roomId,
                adminName: this.nickname
            });
            
            // 初始化本地媒体
            await this._initLocalMedia();
            
            // 切换到会议室页面
            uiManager.showRoom();
            uiManager.updateRoomInfo(this.roomId, this.members.size);
            uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
            uiManager.showInviteLink(this.roomId);
            uiManager.updateShareControls(this.isAdmin, false, this.isPC, this.shareRequests, null);
            
            uiManager.showToast('房间创建成功！', 'success');
            
            // 加载音视频设备列表
            this._loadDevices();
            
        } catch (err) {
            console.error('[App] Create room error:', err);
            uiManager.showToast('创建房间失败: ' + err.message, 'error');
            this._resetState();
        } finally {
            uiManager.hideLoading();
        }
    }
    
    /**
     * 加入房间
     * @param {string} roomId - 房间号
     * @param {string} nickname - 用户昵称
     */
    async joinRoom(roomId, nickname) {
        this.nickname = nickname;
        this.roomId = roomId.toUpperCase();
        this.isAdmin = false;
        
        uiManager.showLoading('正在加入房间...');
        
        try {
            // 连接 MQTT
            await mqttManager.connect(this.roomId);
            
            // 初始化本地媒体（在等待审批时就获取摄像头/麦克风权限）
            await this._initLocalMedia();
            
            // 发送加入请求
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.JOIN_REQUEST,
                name: this.nickname,
                isPC: this.isPC
            });
            
            uiManager.showRoom();
            uiManager.showToast('已发送加入请求，等待管理员批准...', 'info');
            
        } catch (err) {
            console.error('[App] Join room error:', err);
            uiManager.showToast('加入房间失败: ' + err.message, 'error');
            uiManager.hideLoading();
        }
    }
    
    /**
     * 离开房间
     */
    async leaveRoom() {
        if (!this.isInRoom) return;
        
        // 清除保存的状态
        this._clearState();
        
        // 发送离开消息
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.LEAVE
        });
        
        // 如果是管理员，广播房间解散
        if (this.isAdmin) {
            this._broadcastAdminLeft();
        }
        
        // 清理
        this._cleanup();
        
        // 返回首页
        uiManager.hideRoomClosed();
        uiManager.showHome();
        uiManager.hideInviteLink();
        uiManager.clearAllPips();
        uiManager.clearSharedScreen();
    }
    
    /**
     * 设置 MQTT 消息处理器
     * @private
     */
    _setupMessageHandlers() {
        // 心跳处理：更新成员在线状态
        mqttManager.on('heartbeat', (msg) => {
            if (msg.from && this.members.has(msg.from)) {
                this.memberHeartbeats.set(msg.from, Date.now());
            }
        });
        
        // 启动心跳超时检测
        this._startHeartbeatCheck();
        
        // 自己成为管理员后收到的消息
        
        // 加入请求（仅管理员处理）
        mqttManager.on(CONFIG.MSG_TYPE.JOIN_REQUEST, (msg) => {
            if (!this.isAdmin) return;
            this._handleJoinRequest(msg);
        });
        
        // 离开消息
        mqttManager.on(CONFIG.MSG_TYPE.LEAVE, (msg) => {
            this._handleUserLeave(msg.from);
        });
        
        // WebRTC 信令
        mqttManager.on(CONFIG.MSG_TYPE.WEBRTC_OFFER, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleWebRTCOffer(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.WEBRTC_ANSWER, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleWebRTCAnswer(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.WEBRTC_ICE, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleWebRTCIce(msg);
        });
        
        // 屏幕共享 ICE candidate
        mqttManager.on('webRTC-ice-screen', (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleScreenShareIce(msg);
        });
        
        // 屏幕共享 WebRTC 信令
        mqttManager.on('webRTC-offer-screen', (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleScreenShareOffer(msg);
        });
        
        mqttManager.on('webRTC-answer-screen', (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleScreenShareAnswer(msg);
        });
        
        // 屏幕共享信令
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_REQUEST, (msg) => {
            if (!this.isAdmin) return;
            this._handleScreenShareRequest(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_APPROVED, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleScreenShareApproved(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_REJECTED, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleScreenShareRejected(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_STARTED, (msg) => {
            this._handleScreenShareStarted(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_STOP, (msg) => {
            this._handleScreenShareStop(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.SCREEN_SHARE_REVOKED, (msg) => {
            this._handleScreenShareRevoked(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.QUALITY_CHANGE, (msg) => {
            this._handleQualityChange(msg);
        });
        
        // 房间管理消息
        
        mqttManager.on(CONFIG.MSG_TYPE.ROOM_CREATED, (msg) => {
            // 非管理员收到房间创建消息（通常忽略，因为已经通过 join-request 流程）
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.JOIN_APPROVED, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleJoinApproved(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.JOIN_REJECTED, (msg) => {
            if (msg.target !== this.clientId) return;
            this._handleJoinRejected(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.USER_JOINED, (msg) => {
            this._handleUserJoined(msg);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.USER_LEFT, (msg) => {
            this._handleUserLeft(msg.userId);
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.ROOM_FULL, (msg) => {
            if (msg.target !== this.clientId) return;
            uiManager.showToast('房间已满', 'error');
            this._cleanup();
            uiManager.showHome();
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.KICKED, (msg) => {
            if (msg.target !== this.clientId) return;
            uiManager.showToast('你已被管理员移出房间', 'error');
            this._cleanup();
            uiManager.showHome();
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.ADMIN_LEFT, (msg) => {
            if (this.isAdmin) return; // 自己发的，忽略
            uiManager.showRoomClosed('管理员已离开，房间解散');
            this._cleanup();
        });
        
        mqttManager.on(CONFIG.MSG_TYPE.ERROR, (msg) => {
            if (msg.target !== this.clientId) return;
            uiManager.showToast(msg.message || '发生错误', 'error');
        });
        
        // 断线通知
        mqttManager.on('disconnect-notify', (msg) => {
            this._handleUserLeave(msg.from);
        });
    }
    
    /**
     * 初始化本地媒体
     * @private
     */
    async _initLocalMedia() {
        if (this.hasInitMedia) return;
        
        try {
            const stream = await webrtcManager.getLocalStream();
            // 本地流不显示在画中画（因为默认关闭）
            this.hasInitMedia = true;
        } catch (err) {
            console.warn('[App] Init local media failed:', err);
            // 媒体初始化失败不阻止进入房间
        }
    }
    
    /**
     * 加载音视频设备列表并渲染选择器
     * @private
     */
    async _loadDevices() {
        try {
            const devices = await webrtcManager.enumerateDevices();
            uiManager.renderDeviceSelectors(devices);
            console.log('[App] Devices loaded:', devices.videoInputs.length, 'cameras,', devices.audioInputs.length, 'mics');
        } catch (err) {
            console.warn('[App] Load devices failed:', err);
        }
    }
    
    /**
     * 生成随机房间号
     * @private
     */
    _generateRoomId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 排除易混淆字符
        let result = '';
        for (let i = 0; i < CONFIG.ROOM_ID_LENGTH; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    // ========== 消息处理 ==========
    
    /**
     * 处理加入请求（管理员端）
     * @private
     */
    async _handleJoinRequest(msg) {
        // 检查房间是否已满
        if (this.members.size >= CONFIG.MAX_ROOM_SIZE) {
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.ROOM_FULL,
                target: msg.from
            });
            return;
        }
        
        // 添加新成员
        this.members.set(msg.from, {
            id: msg.from,
            name: msg.name,
            isAdmin: false,
            isPC: msg.isPC,
            joinedAt: Date.now()
        });
        
        // 发送批准消息给新成员
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.JOIN_APPROVED,
            target: msg.from,
            userId: msg.from,
            name: msg.name,
            members: Array.from(this.members.values())
        });
        
        // 广播用户加入消息
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.USER_JOINED,
            userId: msg.from,
            name: msg.name,
            isPC: msg.isPC
        });
        
        // 更新 UI
        uiManager.updateRoomInfo(this.roomId, this.members.size);
        uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
        
        // 为新成员创建 WebRTC offer
        try {
            const offer = await webrtcManager.createOffer(msg.from);
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.WEBRTC_OFFER,
                target: msg.from,
                sdp: offer.sdp
            });
        } catch (err) {
            console.error('[App] Create offer for new member error:', err);
        }
    }
    
    /**
     * 处理加入批准
     * @private
     */
    _handleJoinApproved(msg) {
        this.isInRoom = true;
        
        // 注册自己为成员
        this.members.set(this.clientId, {
            id: this.clientId,
            name: this.nickname,
            isAdmin: false,
            isPC: this.isPC,
            joinedAt: Date.now()
        });
        this.memberHeartbeats.set(this.clientId, Date.now());
        
        // 注册已有成员
        if (msg.members) {
            msg.members.forEach(m => {
                if (m.id !== this.clientId) {
                    this.members.set(m.id, m);
                    this.memberHeartbeats.set(m.id, Date.now());
                }
            });
        }
        
        // 更新 UI
        uiManager.updateRoomInfo(this.roomId, this.members.size);
        uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
        uiManager.hideLoading();
        uiManager.showToast('已加入房间！', 'success');
        
        // 保存状态，刷新后恢复
        this._saveState();
        
        // 加载音视频设备列表
        this._loadDevices();
        
        // Mesh 拓扑：新成员加入后，主动为所有已有成员创建 offer
        if (this.hasInitMedia && webrtcManager.localStream) {
            for (const member of this.members.values()) {
                if (member.id !== this.clientId) {
                    this._createOfferForUser(member.id);
                }
            }
        }
    }
    
    /**
     * 处理加入拒绝
     * @private
     */
    _handleJoinRejected(msg) {
        uiManager.hideLoading();
        uiManager.showToast(msg.reason || '加入请求被拒绝', 'error');
        this._cleanup();
        uiManager.showHome();
    }
    
    /**
     * 处理用户加入
     * @private
     */
    _handleUserJoined(msg) {
        if (msg.userId === this.clientId) return; // 自己
        
        this.members.set(msg.userId, {
            id: msg.userId,
            name: msg.name,
            isAdmin: false,
            isPC: msg.isPC,
            joinedAt: Date.now()
        });
        this.memberHeartbeats.set(msg.userId, Date.now());
        
        uiManager.updateRoomInfo(this.roomId, this.members.size);
        uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
        uiManager.showToast(`${msg.name} 加入了房间`, 'info');
        
        // Mesh 拓扑：为新成员创建 WebRTC offer（双向连接）
        // 管理员已经在 _handleRequest 中创建过 offer，跳过避免重复
        if (this.isAdmin) return;
        
        if (this.isInRoom && this.hasInitMedia && webrtcManager.localStream) {
            this._createOfferForUser(msg.userId);
        }
    }
    
    /**
     * 为指定用户创建 WebRTC offer
     * @private
     */
    async _createOfferForUser(userId) {
        try {
            const offer = await webrtcManager.createOffer(userId);
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.WEBRTC_OFFER,
                target: userId,
                sdp: offer.sdp
            });
        } catch (err) {
            console.error('[App] Create offer for user error:', err);
        }
    }
    
    /**
     * 处理用户离开
     * @private
     */
    _handleUserLeave(clientId) {
        const member = this.members.get(clientId);
        if (!member) return;
        
        this.members.delete(clientId);
        this.memberHeartbeats.delete(clientId);
        
        // 关闭与该用户的连接
        webrtcManager.closeConnection(clientId);
        screenShareManager.closeConnection(clientId);
        uiManager.removePipVideo(clientId);
        
        // 如果是当前共享者离开
        if (this.currentSharer && this.currentSharer.id === clientId) {
            this.currentSharer = null;
            uiManager.clearSharedScreen();
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.SCREEN_SHARE_STOPPED,
                reason: '共享者离开'
            });
        }
        
        if (this.isAdmin) {
            // 广播用户离开
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.USER_LEFT,
                userId: clientId
            });
            
            // 更新 UI
            uiManager.updateRoomInfo(this.roomId, this.members.size);
            uiManager.updateMemberList(Array.from(this.members.values()), this.clientId, this.isAdmin);
        }
    }
    
    /**
     * 处理 WebRTC offer
     * @private
     */
    async _handleWebRTCOffer(msg) {
        try {
            const answer = await webrtcManager.handleOffer(msg.from, msg.sdp);
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.WEBRTC_ANSWER,
                target: msg.from,
                sdp: answer.sdp
            });
        } catch (err) {
            console.error('[App] Handle offer error:', err);
        }
    }
    
    /**
     * 处理 WebRTC answer
     * @private
     */
    async _handleWebRTCAnswer(msg) {
        try {
            await webrtcManager.handleAnswer(msg.from, msg.sdp);
        } catch (err) {
            console.error('[App] Handle answer error:', err);
        }
    }
    
    /**
     * 处理 WebRTC ICE
     * @private
     */
    async _handleWebRTCIce(msg) {
        try {
            await webrtcManager.handleIceCandidate(msg.from, msg.candidate);
        } catch (err) {
            console.error('[App] Handle ICE error:', err);
        }
    }
    
    /**
     * 处理屏幕共享 ICE
     * @private
     */
    async _handleScreenShareIce(msg) {
        try {
            await screenShareManager.handleShareIceCandidate(msg.from, msg.candidate);
        } catch (err) {
            console.error('[App] Handle screen share ICE error:', err);
        }
    }
    
    // ========== 媒体控制 ==========
    
    /**
     * 发送 ICE candidate
     * @param {string} target - 目标客户端 ID
     * @param {object} candidate - ICE candidate
     */
    sendIceCandidate(target, candidate) {
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.WEBRTC_ICE,
            target: target,
            candidate: candidate
        });
    }
    
    /**
     * 切换麦克风
     */
    async toggleMic() {
        try {
            const isOn = await webrtcManager.toggleMic();
            uiManager.updateMicButton(isOn);
        } catch (err) {
            uiManager.showToast('无法访问麦克风', 'error');
        }
    }
    
    /**
     * 切换摄像头
     */
    async toggleCamera() {
        try {
            const isOn = await webrtcManager.toggleCamera();
            uiManager.updateCameraButton(isOn);
            
            if (isOn) {
                // 显示本地画中画
                const stream = webrtcManager.localStream;
                if (stream) {
                    uiManager.addPipVideo(this.clientId, stream, this.nickname + ' (我)', true, !webrtcManager.isMicOn);
                    // 同时更新成员列表中的本地视频
                    uiManager.updateMemberVideo(this.clientId, stream, this.nickname + ' (我)', !webrtcManager.isMicOn);
                }
            } else {
                uiManager.removePipVideo(this.clientId);
                uiManager.removeMemberVideo(this.clientId);
            }
        } catch (err) {
            uiManager.showToast('无法访问摄像头', 'error');
        }
    }
    
    // ========== 屏幕共享 ==========
    
    /**
     * 请求屏幕共享
     */
    requestScreenShare() {
        if (!this.isPC) {
            uiManager.showToast('屏幕共享仅限 PC 端', 'warning');
            return;
        }
        
        if (this.currentSharer) {
            uiManager.showToast('已有用户正在共享屏幕', 'warning');
            return;
        }
        
        // 弹出画质选择
        this._showQualitySelectModal((quality) => {
            if (this.isAdmin) {
                // 管理员直接开始共享，无需审批
                this._startDirectShare(quality);
            } else {
                // 普通用户发送申请
                this._sendShareRequest(quality);
            }
        });
    }
    
    /**
     * 管理员直接开始共享（无需审批）
     * @private
     */
    async _startDirectShare(quality) {
        try {
            const memberIds = Array.from(this.members.keys()).filter(id => id !== this.clientId);
            await screenShareManager.startSharing(quality, memberIds);
            
            // 屏幕共享时自动静音麦克风，防止回声
            // 如果用户需要说话，可以手动开启（建议使用耳机）
            if (webrtcManager.isMicOn) {
                await this.toggleMic();
                uiManager.showToast('屏幕共享已自动静音麦克风，点击麦克风按钮可开启（建议用耳机）', 'warning', 5000);
            }
            
            // 发送共享 offer 给每个成员
            for (const memberId of memberIds) {
                const offer = await screenShareManager.createShareOffer(memberId, quality);
                mqttManager.publish({
                    type: 'webRTC-offer-screen',
                    target: memberId,
                    sdp: offer.sdp,
                    quality: quality
                });
            }
            
            this.currentSharer = {
                id: this.clientId,
                name: this.nickname,
                quality: quality
            };
            
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.SCREEN_SHARE_STARTED,
                name: this.nickname,
                quality: quality
            });
            
            uiManager.showSharedScreen(screenShareManager.screenStream, quality);
            uiManager.updateShareControls(this.isAdmin, true, this.isPC, this.shareRequests, quality);
            uiManager.showToast('屏幕共享已开始（游戏声音已共享）', 'success');
            
        } catch (err) {
            console.error('[App] Start direct share error:', err);
            uiManager.showToast('开始共享失败: ' + err.message, 'error');
        }
    }
    
    /**
     * 显示画质选择弹窗
     * @private
     */
    _showQualitySelectModal(callback) {
        const qualities = Object.entries(CONFIG.SCREEN_SHARE_QUALITY);
        const body = document.createElement('div');
        body.innerHTML = '<p style="margin-bottom:12px;color:var(--text-secondary);">选择共享画质：</p>';
        const options = document.createElement('div');
        options.className = 'quality-options';
        
        qualities.forEach(([key, settings]) => {
            const option = document.createElement('label');
            option.className = 'quality-option' + (key === CONFIG.DEFAULT_QUALITY ? ' selected' : '');
            option.innerHTML = `
                <input type="radio" name="share-quality" value="${key}" ${key === CONFIG.DEFAULT_QUALITY ? 'checked' : ''}>
                <div class="radio"></div>
                <div class="info">
                    <div class="label">${settings.label}</div>
                    <div class="desc">${settings.width}×${settings.height} · 目标 ${(settings.targetBitrate / 1000000).toFixed(1)}Mbps</div>
                </div>
            `;
            options.appendChild(option);
        });
        
        body.appendChild(options);
        
        uiManager.showModal('选择共享画质', body, [
            {
                text: '取消',
                class: 'btn-ghost',
                onClick: () => {}
            },
            {
                text: '确认',
                class: 'btn-primary',
                onClick: () => {
                    const selected = document.querySelector('input[name="share-quality"]:checked');
                    const quality = selected ? selected.value : CONFIG.DEFAULT_QUALITY;
                    if (callback) callback(quality);
                }
            }
        ]);
    }
    
    /**
     * 发送共享请求（普通用户）
     * @private
     */
    _sendShareRequest(quality) {
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.SCREEN_SHARE_REQUEST,
            name: this.nickname,
            quality: quality
        });
        
        uiManager.showToast('已发送共享申请，等待管理员批准...', 'info');
    }
    
    /**
     * 处理共享请求（管理员端）
     * @private
     */
    _handleScreenShareRequest(msg) {
        // 检查是否已有共享
        if (this.currentSharer) {
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.SCREEN_SHARE_REJECTED,
                target: msg.from
            });
            return;
        }
        
        // 添加到请求列表
        this.shareRequests.push({
            from: msg.from,
            name: msg.name,
            quality: msg.quality
        });
        
        // 更新 UI
        uiManager.updateShareControls(this.isAdmin, !!this.currentSharer, this.isPC, this.shareRequests, this.currentSharer?.quality);
        
        uiManager.showToast(`${msg.name} 申请共享屏幕`, 'info');
    }
    
    /**
     * 批准共享请求
     * @param {string} userId - 申请者 ID
     */
    approveShareRequest(userId) {
        const request = this.shareRequests.find(r => r.from === userId);
        if (!request) return;
        
        this.shareRequests = this.shareRequests.filter(r => r.from !== userId);
        
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.SCREEN_SHARE_APPROVED,
            target: userId,
            quality: request.quality
        });
        
        uiManager.updateShareControls(this.isAdmin, !!this.currentSharer, this.isPC, this.shareRequests, this.currentSharer?.quality);
    }
    
    /**
     * 拒绝共享请求
     * @param {string} userId - 申请者 ID
     */
    rejectShareRequest(userId) {
        this.shareRequests = this.shareRequests.filter(r => r.from !== userId);
        
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.SCREEN_SHARE_REJECTED,
            target: userId
        });
        
        uiManager.updateShareControls(this.isAdmin, !!this.currentSharer, this.isPC, this.shareRequests, this.currentSharer?.quality);
    }
    
    /**
     * 处理共享批准
     * @private
     */
    async _handleScreenShareApproved(msg) {
        try {
            const memberIds = Array.from(this.members.keys()).filter(id => id !== this.clientId);
            await screenShareManager.startSharing(msg.quality, memberIds);
            
            // 屏幕共享时自动静音麦克风，防止回声
            if (webrtcManager.isMicOn) {
                await this.toggleMic();
                uiManager.showToast('屏幕共享已自动静音麦克风，点击麦克风按钮可开启（建议用耳机）', 'warning', 5000);
            }
            
            // 发送共享 offer 给每个成员
            for (const memberId of memberIds) {
                const offer = await screenShareManager.createShareOffer(memberId, msg.quality);
                mqttManager.publish({
                    type: 'webRTC-offer-screen',
                    target: memberId,
                    sdp: offer.sdp,
                    quality: msg.quality
                });
            }
            
            this.currentSharer = {
                id: this.clientId,
                name: this.nickname,
                quality: msg.quality
            };
            
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.SCREEN_SHARE_STARTED,
                name: this.nickname,
                quality: msg.quality
            });
            
            uiManager.showSharedScreen(screenShareManager.screenStream, msg.quality);
            uiManager.updateShareControls(this.isAdmin, true, this.isPC, this.shareRequests, msg.quality);
            uiManager.showToast('屏幕共享已开始', 'success');
            
        } catch (err) {
            console.error('[App] Start sharing error:', err);
            uiManager.showToast('开始共享失败: ' + err.message, 'error');
        }
    }
    
    /**
     * 处理共享拒绝
     * @private
     */
    _handleScreenShareRejected(msg) {
        uiManager.showToast('共享申请被管理员拒绝', 'warning');
    }
    
    /**
     * 处理共享开始
     * @private
     */
    _handleScreenShareStarted(msg) {
        this.currentSharer = {
            id: msg.from,
            name: msg.name,
            quality: msg.quality
        };
        
        uiManager.showToast(`${msg.name} 开始共享屏幕`, 'info');
    }
    
    /**
     * 处理共享停止
     * @private
     */
    _handleScreenShareStop(msg) {
        this.currentSharer = null;
        uiManager.clearSharedScreen();
        uiManager.updateShareControls(this.isAdmin, false, this.isPC, this.shareRequests, null);
    }
    
    /**
     * 处理共享撤销
     * @private
     */
    _handleScreenShareRevoked(msg) {
        screenShareManager.stopSharing();
        this.currentSharer = null;
        uiManager.clearSharedScreen();
        uiManager.updateShareControls(this.isAdmin, false, this.isPC, this.shareRequests, null);
        uiManager.showToast('管理员已撤销屏幕共享', 'warning');
    }
    
    /**
     * 处理画质变化
     * @private
     */
    _handleQualityChange(msg) {
        this.currentSharer.quality = msg.quality;
        const settings = CONFIG.SCREEN_SHARE_QUALITY[msg.quality];
        uiManager.qualityBadge.textContent = settings ? settings.label : msg.quality;
    }
    
    /**
     * 停止屏幕共享
     */
    async stopScreenShare() {
        if (!screenShareManager.isSharing) return;
        
        await screenShareManager.stopSharing();
        
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.SCREEN_SHARE_STOP
        });
        
        if (this.isAdmin) {
            mqttManager.publish({
                type: CONFIG.MSG_TYPE.SCREEN_SHARE_STOPPED,
                reason: '共享者停止'
            });
        }
        
        this.currentSharer = null;
        uiManager.clearSharedScreen();
        uiManager.updateShareControls(this.isAdmin, false, this.isPC, this.shareRequests, null);
    }
    
    /**
     * 撤销屏幕共享（管理员）
     */
    revokeScreenShare() {
        if (!this.currentSharer) return;
        
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.SCREEN_SHARE_REVOKED
        });
        
        this.currentSharer = null;
        uiManager.clearSharedScreen();
        uiManager.updateShareControls(this.isAdmin, false, this.isPC, this.shareRequests, null);
    }
    
    /**
     * 切换共享画质
     * @param {string} quality - 画质档位
     */
    async changeShareQuality(quality) {
        await screenShareManager.changeQuality(quality);
        
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.QUALITY_CHANGE,
            quality: quality
        });
        
        if (this.currentSharer && this.currentSharer.id === this.clientId) {
            this.currentSharer.quality = quality;
        }
        
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        uiManager.qualityBadge.textContent = settings ? settings.label : quality;
    }
    
    /**
     * 画质降级回调
     * @param {string} newQuality - 新画质
     */
    onQualityDowngraded(newQuality) {
        this.currentSharer.quality = newQuality;
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.QUALITY_CHANGE,
            quality: newQuality
        });
        
        const settings = CONFIG.SCREEN_SHARE_QUALITY[newQuality];
        uiManager.qualityBadge.textContent = settings ? settings.label : newQuality;
    }
    
    /**
     * 发送共享 ICE candidate
     * @param {string} target - 目标客户端 ID
     * @param {object} candidate - ICE candidate
     */
    sendShareIceCandidate(target, candidate) {
        mqttManager.publish({
            type: 'webRTC-ice-screen',
            target: target,
            candidate: candidate,
            isScreenShare: true
        });
    }
    
    /**
     * 处理屏幕共享 offer
     * @private
     */
    async _handleScreenShareOffer(msg) {
        try {
            const answer = await screenShareManager.handleShareOffer(msg.from, msg.sdp, msg.quality);
            mqttManager.publish({
                type: 'webRTC-answer-screen',
                target: msg.from,
                sdp: answer.sdp
            });
        } catch (err) {
            console.error('[App] Handle screen share offer error:', err);
        }
    }
    
    /**
     * 处理屏幕共享 answer
     * @private
     */
    async _handleScreenShareAnswer(msg) {
        try {
            await screenShareManager.handleShareAnswer(msg.from, msg.sdp);
        } catch (err) {
            console.error('[App] Handle screen share answer error:', err);
        }
    }
    
    // ========== 管理员功能 ==========
    
    /**
     * 踢出用户
     * @param {string} userId - 用户 ID
     */
    kickUser(userId) {
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.KICKED,
            target: userId
        });
        
        this._handleUserLeave(userId);
    }
    
    /**
     * 广播管理员离开
     * @private
     */
    _broadcastAdminLeft() {
        mqttManager.publish({
            type: CONFIG.MSG_TYPE.ADMIN_LEFT
        });
    }
    
    // ========== 清理 ==========
    
    /**
     * 清理状态
     * @private
     */
    _cleanup() {
        this.isInRoom = false;
        this.isAdmin = false;
        this.members.clear();
        this.memberHeartbeats.clear();
        this.shareRequests = [];
        this.currentSharer = null;
        this.hasInitMedia = false;
        
        this._stopHeartbeatCheck();
        this._clearState();
        
        webrtcManager.closeAllConnections();
        webrtcManager.localStream = null;
        webrtcManager.isMicOn = false;
        webrtcManager.isCameraOn = false;
        
        screenShareManager.stopSharing();
        mqttManager.disconnect();
        
        uiManager.clearAllPips();
        uiManager.clearSharedScreen();
    }
    
    /**
     * 重置状态（创建失败时）
     * @private
     */
    _resetState() {
        this.isInRoom = false;
        this.isAdmin = false;
        this.members.clear();
        this.shareRequests = [];
        this.currentSharer = null;
        mqttManager.disconnect();
    }
    
    /**
     * 启动心跳超时检测
     * @private
     */
    _startHeartbeatCheck() {
        this._stopHeartbeatCheck();
        this._heartbeatCheckInterval = setInterval(() => {
            const now = Date.now();
            const timeout = 30000; // 30秒无心跳视为离线
            for (const [clientId, lastBeat] of this.memberHeartbeats.entries()) {
                if (now - lastBeat > timeout && clientId !== this.clientId) {
                    console.log('[App] Member timeout:', clientId);
                    this._handleUserLeave(clientId);
                    this.memberHeartbeats.delete(clientId);
                }
            }
        }, 5000); // 每5秒检查一次
    }
    
    /**
     * 停止心跳超时检测
     * @private
     */
    _stopHeartbeatCheck() {
        if (this._heartbeatCheckInterval) {
            clearInterval(this._heartbeatCheckInterval);
            this._heartbeatCheckInterval = null;
        }
    }
}

// 全局实例
window.app = new App();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
});
