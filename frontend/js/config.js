/**
 * config.js - 全局配置
 * 包含 MQTT Broker 地址、STUN 服务器、视频参数等
 */

const CONFIG = {
    // MQTT over WebSocket 公共 Broker（国内可访问，免费无需注册）
    MQTT_BROKER_URL: 'wss://broker.emqx.io:8084/mqtt',
    
    // MQTT 连接选项
    MQTT_OPTIONS: {
        keepalive: 30,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true,
        rejectUnauthorized: false
    },
    
    // 主题前缀
    TOPIC_PREFIX: 'watchtogether',
    
    // 房间最大人数
    MAX_ROOM_SIZE: 6,
    
    // 房间号长度
    ROOM_ID_LENGTH: 6,
    
    // STUN 服务器（国内可访问）
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ],
    
    // 连麦视频参数
    WEBRTC_VIDEO: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 }
    },
    
    // 连麦码率 (bps)
    WEBRTC_BITRATE: 1000000, // 1Mbps
    
    // 移动端连麦降级参数
    WEBRTC_MOBILE_VIDEO: {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24, max: 30 }
    },
    
    // 屏幕共享画质档位
    SCREEN_SHARE_QUALITY: {
        '2k60': {
            label: '2K 60fps',
            width: 2560,
            height: 1440,
            frameRate: 60,
            targetBitrate: 8000000,  // 8Mbps
            maxBitrate: 15000000     // 15Mbps
        },
        '1080p60': {
            label: '1080p 60fps',
            width: 1920,
            height: 1080,
            frameRate: 60,
            targetBitrate: 4000000,
            maxBitrate: 8000000
        },
        '1080p30': {
            label: '1080p 30fps',
            width: 1920,
            height: 1080,
            frameRate: 30,
            targetBitrate: 2500000,
            maxBitrate: 5000000
        },
        '720p60': {
            label: '720p 60fps',
            width: 1280,
            height: 720,
            frameRate: 60,
            targetBitrate: 2000000,
            maxBitrate: 4000000
        }
    },
    
    // 默认画质
    DEFAULT_QUALITY: '2k60',
    
    // 动态降级阈值
    DYNAMIC_QUALITY: {
        packetLossThreshold: 5,  // 丢包率超过5%触发降级
        checkInterval: 3000,     // 每3秒检查一次
        cooldown: 10000          // 降级后10秒内不再降级
    },
    
    // SDP 编码偏好：VP9 > VP8
    SDP_PREFER_VP9: true,
    
    // 消息类型枚举
    MSG_TYPE: {
        // 客户端 -> 管理员
        JOIN_REQUEST: 'join-request',
        LEAVE: 'leave',
        WEBRTC_OFFER: 'webRTC-offer',
        WEBRTC_ANSWER: 'webRTC-answer',
        WEBRTC_ICE: 'webRTC-ice',
        SCREEN_SHARE_REQUEST: 'screen-share-request',
        SCREEN_SHARE_STOP: 'screen-share-stop',
        QUALITY_CHANGE: 'quality-change',
        
        // 管理员 -> 所有客户端
        ROOM_CREATED: 'room-created',
        JOIN_APPROVED: 'join-approved',
        JOIN_REJECTED: 'join-rejected',
        USER_JOINED: 'user-joined',
        USER_LEFT: 'user-left',
        ROOM_FULL: 'room-full',
        SCREEN_SHARE_REQUESTED: 'screen-share-requested',
        SCREEN_SHARE_APPROVED: 'screen-share-approved',
        SCREEN_SHARE_REJECTED: 'screen-share-rejected',
        SCREEN_SHARE_STARTED: 'screen-share-started',
        SCREEN_SHARE_STOPPED: 'screen-share-stopped',
        SCREEN_SHARE_REVOKED: 'screen-share-revoked',
        KICKED: 'kicked',
        ADMIN_LEFT: 'admin-left',
        ERROR: 'error'
    }
};
