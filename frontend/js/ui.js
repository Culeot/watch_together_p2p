/**
 * ui.js - UI 渲染和控制
 * 管理页面元素渲染、事件绑定、状态更新
 */

class UIManager {
    constructor() {
        this.elements = {};
        this.toastQueue = [];
        this.currentModal = null;
        this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    
    /**
     * 初始化 UI 元素引用
     */
    init() {
        // 首页
        this.elements.homePage = document.getElementById('home-page');
        this.elements.createNickname = document.getElementById('create-nickname');
        this.elements.btnCreateRoom = document.getElementById('btn-create-room');
        this.elements.inviteBox = document.getElementById('invite-box');
        this.elements.inviteLink = document.getElementById('invite-link');
        this.elements.btnCopyLink = document.getElementById('btn-copy-link');
        this.elements.joinRoomId = document.getElementById('join-room-id');
        this.elements.joinNickname = document.getElementById('join-nickname');
        this.elements.btnJoinRoom = document.getElementById('btn-join-room');
        
        // 会议室
        this.elements.roomPage = document.getElementById('room-page');
        this.elements.roomIdBadge = document.getElementById('room-id-badge');
        this.elements.roomIdDisplay = document.getElementById('room-id-display');
        this.elements.memberCount = document.getElementById('member-count');
        this.elements.connDot = document.getElementById('conn-dot');
        this.elements.connText = document.getElementById('conn-text');
        this.elements.btnTogglePanel = document.getElementById('btn-toggle-panel');
        this.elements.btnLeaveRoom = document.getElementById('btn-leave-room');
        this.elements.sidePanel = document.getElementById('side-panel');
        
        // 主画面
        this.elements.mainVideoContainer = document.getElementById('main-video-container');
        this.elements.waitingScreen = document.getElementById('waiting-screen');
        this.elements.mainVideo = document.getElementById('main-video');
        this.elements.mainOverlay = document.getElementById('main-overlay');
        this.elements.qualityBadge = document.getElementById('quality-badge');
        this.elements.pipGrid = document.getElementById('pip-grid');
        
        // 面板
        this.elements.memberList = document.getElementById('member-list');
        this.elements.tabMembers = document.getElementById('tab-members');
        this.elements.tabSettings = document.getElementById('tab-settings');
        this.elements.shareRequestsContainer = document.getElementById('share-requests-container');
        this.elements.qualityControlContainer = document.getElementById('quality-control-container');
        
        // 控制栏
        this.elements.btnToggleMic = document.getElementById('btn-toggle-mic');
        this.elements.btnToggleCamera = document.getElementById('btn-toggle-camera');
        this.elements.btnShareScreen = document.getElementById('btn-share-screen');
        this.elements.btnStopShare = document.getElementById('btn-stop-share');
        this.elements.btnRevokeShare = document.getElementById('btn-revoke-share');
        
        // 弹窗
        this.elements.modalOverlay = document.getElementById('modal-overlay');
        this.elements.modalTitle = document.getElementById('modal-title');
        this.elements.modalBody = document.getElementById('modal-body');
        this.elements.modalActions = document.getElementById('modal-actions');
        
        // Toast
        this.elements.toastContainer = document.getElementById('toast-container');
        
        // 加载
        this.elements.loadingOverlay = document.getElementById('loading-overlay');
        this.elements.loadingText = document.getElementById('loading-text');
        
        // 房间解散
        this.elements.roomClosedOverlay = document.getElementById('room-closed-overlay');
        this.elements.roomClosedReason = document.getElementById('room-closed-reason');
        this.elements.btnBackHome = document.getElementById('btn-back-home');
        
        // 移动端检测
        if (this.isMobile) {
            document.body.classList.add('mobile');
        }
        
        // 绑定事件
        this._bindEvents();
        
        // 解析 URL 参数
        this._parseUrlParams();
    }
    
    /**
     * 绑定事件
     * @private
     */
    _bindEvents() {
        // 创建房间
        this.elements.btnCreateRoom.addEventListener('click', () => {
            const name = this.elements.createNickname.value.trim();
            if (!name) {
                this.showToast('请输入昵称', 'warning');
                return;
            }
            if (window.app && window.app.createRoom) {
                window.app.createRoom(name);
            }
        });
        
        // 加入房间
        this.elements.btnJoinRoom.addEventListener('click', () => {
            const roomId = this.elements.joinRoomId.value.trim().toUpperCase();
            const name = this.elements.joinNickname.value.trim();
            if (!roomId || roomId.length !== 6) {
                this.showToast('请输入有效的6位房间号', 'warning');
                return;
            }
            if (!name) {
                this.showToast('请输入昵称', 'warning');
                return;
            }
            if (window.app && window.app.joinRoom) {
                window.app.joinRoom(roomId, name);
            }
        });
        
        // 复制链接
        this.elements.btnCopyLink.addEventListener('click', () => {
            const link = this.elements.inviteLink.textContent;
            this.copyToClipboard(link);
        });
        
        // 房间号 badge 点击复制
        this.elements.roomIdBadge.addEventListener('click', () => {
            const roomId = this.elements.roomIdDisplay.textContent;
            const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
            this.copyToClipboard(link);
        });
        
        // 面板标签切换
        document.querySelectorAll('.panel-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const tabName = tab.dataset.tab;
                this.elements.tabMembers.style.display = tabName === 'members' ? 'block' : 'none';
                this.elements.tabSettings.style.display = tabName === 'settings' ? 'block' : 'none';
            });
        });
        
        // 移动端面板切换
        this.elements.btnTogglePanel.addEventListener('click', () => {
            this.elements.sidePanel.classList.toggle('mobile-show');
        });
        
        // 离开房间
        this.elements.btnLeaveRoom.addEventListener('click', () => {
            if (window.app && window.app.leaveRoom) {
                window.app.leaveRoom();
            }
        });
        
        // 麦克风
        this.elements.btnToggleMic.addEventListener('click', async () => {
            if (window.app && window.app.toggleMic) {
                await window.app.toggleMic();
            }
        });
        
        // 摄像头
        this.elements.btnToggleCamera.addEventListener('click', async () => {
            if (window.app && window.app.toggleCamera) {
                await window.app.toggleCamera();
            }
        });
        
        // 共享屏幕
        this.elements.btnShareScreen.addEventListener('click', () => {
            if (window.app && window.app.requestScreenShare) {
                window.app.requestScreenShare();
            }
        });
        
        // 停止共享
        this.elements.btnStopShare.addEventListener('click', () => {
            if (window.app && window.app.stopScreenShare) {
                window.app.stopScreenShare();
            }
        });
        
        // 撤销共享
        this.elements.btnRevokeShare.addEventListener('click', () => {
            if (window.app && window.app.revokeScreenShare) {
                window.app.revokeScreenShare();
            }
        });
        
        // 返回首页
        this.elements.btnBackHome.addEventListener('click', () => {
            window.location.href = window.location.pathname;
        });
    }
    
    /**
     * 解析 URL 参数
     * @private
     */
    _parseUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room');
        if (roomId && roomId.length === 6) {
            this.elements.joinRoomId.value = roomId.toUpperCase();
            this.elements.joinNickname.focus();
        }
    }
    
    /**
     * 显示首页
     */
    showHome() {
        this.elements.homePage.style.display = 'flex';
        this.elements.roomPage.classList.remove('show');
    }
    
    /**
     * 显示会议室
     */
    showRoom() {
        this.elements.homePage.style.display = 'none';
        this.elements.roomPage.classList.add('show');
    }
    
    /**
     * 显示邀请链接
     * @param {string} roomId - 房间号
     */
    showInviteLink(roomId) {
        const link = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
        this.elements.inviteLink.textContent = link;
        this.elements.inviteBox.classList.add('show');
    }
    
    /**
     * 隐藏邀请链接
     */
    hideInviteLink() {
        this.elements.inviteBox.classList.remove('show');
    }
    
    /**
     * 更新连接状态
     * @param {boolean} connected - 是否已连接
     * @param {boolean} reconnecting - 是否正在重连
     */
    updateConnectionStatus(connected, reconnecting = false) {
        const dot = this.elements.connDot;
        const text = this.elements.connText;
        
        dot.className = 'connection-dot';
        if (connected) {
            dot.classList.add('connected');
            text.textContent = '已连接';
        } else if (reconnecting) {
            dot.classList.add('connecting');
            text.textContent = '重连中...';
        } else {
            dot.classList.add('disconnected');
            text.textContent = '已断开';
        }
    }
    
    /**
     * 更新房间信息
     * @param {string} roomId - 房间号
     * @param {number} memberCount - 成员数量
     */
    updateRoomInfo(roomId, memberCount) {
        this.elements.roomIdDisplay.textContent = roomId;
        this.elements.memberCount.textContent = `${memberCount}/${CONFIG.MAX_ROOM_SIZE} 人`;
    }
    
    /**
     * 更新成员列表
     * @param {Array} members - 成员列表 [{id, name, isAdmin, isPC}]
     * @param {string} myId - 当前用户 ID
     * @param {boolean} isAdmin - 当前用户是否为管理员
     */
    updateMemberList(members, myId, isAdmin) {
        this.elements.memberList.innerHTML = '';
        
        members.forEach(member => {
            const isMe = member.id === myId;
            const div = document.createElement('div');
            div.className = 'member-item';
            
            const avatar = document.createElement('div');
            avatar.className = 'member-avatar';
            avatar.textContent = member.name.charAt(0).toUpperCase();
            
            const info = document.createElement('div');
            info.className = 'member-info';
            
            const nameDiv = document.createElement('div');
            nameDiv.className = 'member-name';
            nameDiv.textContent = member.name + (isMe ? ' (我)' : '');
            
            const roleDiv = document.createElement('div');
            roleDiv.className = 'member-role';
            roleDiv.textContent = member.isAdmin ? '👑 管理员' : (member.isPC ? '💻 电脑' : '📱 移动');
            
            info.appendChild(nameDiv);
            info.appendChild(roleDiv);
            
            div.appendChild(avatar);
            div.appendChild(info);
            
            // 管理员可以踢人（不能踢自己）
            if (isAdmin && !isMe) {
                const actions = document.createElement('div');
                actions.className = 'member-actions';
                const kickBtn = document.createElement('button');
                kickBtn.className = 'btn btn-danger btn-sm';
                kickBtn.textContent = '踢出';
                kickBtn.addEventListener('click', () => {
                    if (window.app && window.app.kickUser) {
                        window.app.kickUser(member.id);
                    }
                });
                actions.appendChild(kickBtn);
                div.appendChild(actions);
            }
            
            this.elements.memberList.appendChild(div);
        });
    }
    
    /**
     * 添加画中画视频
     * @param {string} clientId - 客户端 ID
     * @param {MediaStream} stream - 媒体流
     * @param {string} name - 用户昵称
     * @param {boolean} isLocal - 是否为本地流
     * @param {boolean} muted - 是否静音
     */
    addPipVideo(clientId, stream, name, isLocal = false, muted = false) {
        let pip = document.querySelector(`.pip-video[data-client-id="${clientId}"]`);
        
        if (!pip) {
            pip = document.createElement('div');
            pip.className = 'pip-video';
            if (isLocal) pip.classList.add('local');
            pip.dataset.clientId = clientId;
            
            const video = document.createElement('video');
            video.autoplay = true;
            video.playsInline = true;
            if (isLocal) video.muted = true;
            
            const label = document.createElement('div');
            label.className = 'name-label';
            label.textContent = name;
            
            pip.appendChild(video);
            pip.appendChild(label);
            this.elements.pipGrid.appendChild(pip);
        }
        
        const video = pip.querySelector('video');
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        
        // 更新静音状态
        if (muted) {
            pip.classList.add('muted');
        } else {
            pip.classList.remove('muted');
        }
    }
    
    /**
     * 移除画中画视频
     * @param {string} clientId - 客户端 ID
     */
    removePipVideo(clientId) {
        const pip = document.querySelector(`.pip-video[data-client-id="${clientId}"]`);
        if (pip) {
            pip.remove();
        }
    }
    
    /**
     * 清除所有画中画
     */
    clearAllPips() {
        this.elements.pipGrid.innerHTML = '';
    }
    
    /**
     * 显示共享屏幕
     * @param {MediaStream} stream - 屏幕流
     * @param {string} quality - 画质档位
     */
    showSharedScreen(stream, quality) {
        this.elements.waitingScreen.style.display = 'none';
        this.elements.mainVideo.style.display = 'block';
        this.elements.mainVideo.srcObject = stream;
        this.elements.mainOverlay.style.display = 'flex';
        
        const settings = CONFIG.SCREEN_SHARE_QUALITY[quality];
        this.elements.qualityBadge.textContent = settings ? settings.label : quality;
    }
    
    /**
     * 清除共享屏幕
     */
    clearSharedScreen() {
        this.elements.mainVideo.srcObject = null;
        this.elements.mainVideo.style.display = 'none';
        this.elements.waitingScreen.style.display = 'flex';
        this.elements.mainOverlay.style.display = 'none';
    }
    
    /**
     * 更新共享控制 UI
     * @param {boolean} isAdmin - 是否为管理员
     * @param {boolean} isSharing - 是否正在共享
     * @param {boolean} canShare - 是否可以共享（PC端且不在共享中）
     * @param {Array} requests - 共享请求列表
     * @param {string} currentQuality - 当前画质
     */
    updateShareControls(isAdmin, isSharing, canShare, requests, currentQuality) {
        // 共享屏幕按钮
        this.elements.btnShareScreen.style.display = (canShare && !isSharing) ? 'flex' : 'none';
        
        // 停止共享按钮
        this.elements.btnStopShare.style.display = isSharing ? 'flex' : 'none';
        
        // 撤销共享按钮（仅管理员且有人共享时）
        this.elements.btnRevokeShare.style.display = (isAdmin && isSharing) ? 'flex' : 'none';
        
        // 共享请求列表
        this._renderShareRequests(requests, isAdmin);
        
        // 画质控制
        this._renderQualityControl(currentQuality, isSharing || isAdmin);
    }
    
    /**
     * 渲染共享请求列表
     * @private
     */
    _renderShareRequests(requests, isAdmin) {
        const container = this.elements.shareRequestsContainer;
        
        if (!isAdmin || requests.length === 0) {
            container.innerHTML = '<div style="font-size:13px;color:var(--text-secondary);">暂无共享请求</div>';
            return;
        }
        
        container.innerHTML = '';
        requests.forEach(req => {
            const div = document.createElement('div');
            div.className = 'share-request-item';
            
            const requester = document.createElement('div');
            requester.className = 'requester';
            requester.textContent = `${req.name} 申请共享`;
            
            const actions = document.createElement('div');
            actions.className = 'actions';
            
            const approveBtn = document.createElement('button');
            approveBtn.className = 'btn btn-success btn-sm';
            approveBtn.textContent = '批准';
            approveBtn.addEventListener('click', () => {
                if (window.app && window.app.approveShareRequest) {
                    window.app.approveShareRequest(req.from);
                }
            });
            
            const rejectBtn = document.createElement('button');
            rejectBtn.className = 'btn btn-danger btn-sm';
            rejectBtn.textContent = '拒绝';
            rejectBtn.addEventListener('click', () => {
                if (window.app && window.app.rejectShareRequest) {
                    window.app.rejectShareRequest(req.from);
                }
            });
            
            actions.appendChild(approveBtn);
            actions.appendChild(rejectBtn);
            div.appendChild(requester);
            div.appendChild(actions);
            container.appendChild(div);
        });
    }
    
    /**
     * 渲染设备选择器
     * @param {Object} devices - {audioInputs, videoInputs}
     */
    renderDeviceSelectors(devices) {
        const container = this.elements.qualityControlContainer.parentElement;
        let deviceSection = container.querySelector('.device-section');
        if (!deviceSection) {
            deviceSection = document.createElement('div');
            deviceSection.className = 'device-section';
            container.appendChild(deviceSection);
        }
        
        deviceSection.innerHTML = '';
        
        // 摄像头选择
        const videoSection = document.createElement('div');
        videoSection.className = 'device-group';
        videoSection.innerHTML = `
            <div class="panel-section-title">摄像头</div>
            <select class="device-select" id="video-device-select">
                ${devices.videoInputs.length > 0 
                    ? devices.videoInputs.map(d => `<option value="${d.id}">${d.label}</option>`).join('')
                    : '<option value="">未检测到摄像头</option>'
                }
            </select>
        `;
        deviceSection.appendChild(videoSection);
        
        // 麦克风选择
        const audioSection = document.createElement('div');
        audioSection.className = 'device-group';
        audioSection.innerHTML = `
            <div class="panel-section-title">麦克风</div>
            <select class="device-select" id="audio-device-select">
                ${devices.audioInputs.length > 0 
                    ? devices.audioInputs.map(d => `<option value="${d.id}">${d.label}</option>`).join('')
                    : '<option value="">未检测到麦克风</option>'
                }
            </select>
        `;
        deviceSection.appendChild(audioSection);
        
        // 绑定选择事件
        const videoSelect = document.getElementById('video-device-select');
        const audioSelect = document.getElementById('audio-device-select');
        
        if (videoSelect) {
            videoSelect.addEventListener('change', async (e) => {
                if (!e.target.value) return;
                try {
                    await webrtcManager.setVideoDevice(e.target.value);
                    this.showToast('摄像头已切换', 'success');
                } catch (err) {
                    this.showToast('切换摄像头失败: ' + err.message, 'error');
                }
            });
        }
        
        if (audioSelect) {
            audioSelect.addEventListener('change', async (e) => {
                if (!e.target.value) return;
                try {
                    await webrtcManager.setAudioDevice(e.target.value);
                    this.showToast('麦克风已切换', 'success');
                } catch (err) {
                    this.showToast('切换麦克风失败: ' + err.message, 'error');
                }
            });
        }
    }
    
    /**
     * 渲染画质控制（原有方法，修改标题）
     * @private
     */
    _renderQualityControl(currentQuality, show) {
        const container = this.elements.qualityControlContainer;
        
        if (!show) {
            container.innerHTML = '<div style="font-size:13px;color:var(--text-secondary);">共享后可调整画质</div>';
            return;
        }
        
        container.innerHTML = '';
        const options = document.createElement('div');
        options.className = 'quality-options';
        
        Object.entries(CONFIG.SCREEN_SHARE_QUALITY).forEach(([key, settings]) => {
            const option = document.createElement('label');
            option.className = 'quality-option' + (key === currentQuality ? ' selected' : '');
            
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'quality';
            input.value = key;
            if (key === currentQuality) input.checked = true;
            input.addEventListener('change', () => {
                if (window.app && window.app.changeShareQuality) {
                    window.app.changeShareQuality(key);
                }
            });
            
            const radio = document.createElement('div');
            radio.className = 'radio';
            
            const info = document.createElement('div');
            info.className = 'info';
            
            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = settings.label;
            
            const desc = document.createElement('div');
            desc.className = 'desc';
            desc.textContent = `${settings.width}×${settings.height} · 目标 ${(settings.targetBitrate / 1000000).toFixed(1)}Mbps`;
            
            info.appendChild(label);
            info.appendChild(desc);
            option.appendChild(input);
            option.appendChild(radio);
            option.appendChild(info);
            options.appendChild(option);
        });
        
        container.appendChild(options);
    }
    
    /**
     * 更新麦克风按钮状态
     * @param {boolean} isOn - 是否开启
     */
    updateMicButton(isOn) {
        this.elements.btnToggleMic.classList.toggle('active', isOn);
        this.elements.btnToggleMic.querySelector('.tooltip').textContent = isOn ? '关闭麦克风' : '开启麦克风';
        this.elements.btnToggleMic.querySelector('.btn-icon').textContent = isOn ? '🎤' : '🎙️';
    }
    
    /**
     * 更新摄像头按钮状态
     * @param {boolean} isOn - 是否开启
     */
    updateCameraButton(isOn) {
        this.elements.btnToggleCamera.classList.toggle('active', isOn);
        this.elements.btnToggleCamera.querySelector('.tooltip').textContent = isOn ? '关闭摄像头' : '开启摄像头';
        this.elements.btnToggleCamera.querySelector('.btn-icon').textContent = isOn ? '📹' : '📷';
    }
    
    /**
     * 显示弹窗
     * @param {string} title - 标题
     * @param {string|HTMLElement} body - 内容
     * @param {Array} actions - 按钮配置 [{text, class, onClick}]
     */
    showModal(title, body, actions = []) {
        this.elements.modalTitle.textContent = title;
        
        if (typeof body === 'string') {
            this.elements.modalBody.innerHTML = body;
        } else {
            this.elements.modalBody.innerHTML = '';
            this.elements.modalBody.appendChild(body);
        }
        
        this.elements.modalActions.innerHTML = '';
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = `btn ${action.class || 'btn-ghost'}`;
            btn.textContent = action.text;
            btn.addEventListener('click', () => {
                if (action.onClick) action.onClick();
                if (action.close !== false) this.hideModal();
            });
            this.elements.modalActions.appendChild(btn);
        });
        
        this.elements.modalOverlay.classList.add('show');
        this.currentModal = { title, body, actions };
    }
    
    /**
     * 隐藏弹窗
     */
    hideModal() {
        this.elements.modalOverlay.classList.remove('show');
        this.currentModal = null;
    }
    
    /**
     * 显示加载
     * @param {string} text - 加载文本
     */
    showLoading(text = '处理中...') {
        this.elements.loadingText.textContent = text;
        this.elements.loadingOverlay.style.display = 'flex';
    }
    
    /**
     * 隐藏加载
     */
    hideLoading() {
        this.elements.loadingOverlay.style.display = 'none';
    }
    
    /**
     * 显示房间解散提示
     * @param {string} reason - 解散原因
     */
    showRoomClosed(reason) {
        this.elements.roomClosedReason.textContent = reason;
        this.elements.roomClosedOverlay.style.display = 'flex';
    }
    
    /**
     * 隐藏房间解散提示
     */
    hideRoomClosed() {
        this.elements.roomClosedOverlay.style.display = 'none';
    }
    
    /**
     * 显示 Toast 提示
     * @param {string} message - 消息内容
     * @param {string} type - 类型: success, error, warning, info
     * @param {number} duration - 显示时长（毫秒）
     */
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
        
        this.elements.toastContainer.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('hiding');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    /**
     * 复制到剪贴板
     * @param {string} text - 要复制的文本
     */
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast('已复制到剪贴板', 'success');
        } catch (err) {
            // 降级方案
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                this.showToast('已复制到剪贴板', 'success');
            } catch (e) {
                this.showToast('复制失败，请手动选择复制', 'error');
            }
            document.body.removeChild(textarea);
        }
    }
}

// 全局实例
const uiManager = new UIManager();
