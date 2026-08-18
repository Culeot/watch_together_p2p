/**
 * mqtt.js - MQTT 连接管理和消息收发封装
 * 使用公共 EMQX Broker 进行 WebRTC 信令交换
 */

class MQTTManager {
    constructor() {
        this.client = null;
        this.clientId = this.generateClientId();
        this.connected = false;
        this.topic = '';
        this.messageHandlers = new Map();
        this.onConnectionChange = null;
        this.onDisconnect = null;
    }
    
    /**
     * 生成随机客户端 ID
     */
    generateClientId() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = 'wt_';
        for (let i = 0; i < 12; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result + '_' + Date.now().toString(36);
    }
    
    /**
     * 连接到 MQTT Broker
     * @param {string} roomId - 房间号
     * @returns {Promise<void>}
     */
    connect(roomId) {
        return new Promise((resolve, reject) => {
            this.topic = `${CONFIG.TOPIC_PREFIX}/${roomId}`;
            
            try {
                this.client = mqtt.connect(CONFIG.MQTT_BROKER_URL, {
                    ...CONFIG.MQTT_OPTIONS,
                    clientId: this.clientId,
                    will: {
                        topic: this.topic,
                        payload: JSON.stringify({
                            type: 'disconnect-notify',
                            from: this.clientId,
                            timestamp: Date.now()
                        }),
                        qos: 0,
                        retain: false
                    }
                });
                
                this.client.on('connect', () => {
                    this.connected = true;
                    console.log('[MQTT] Connected, clientId:', this.clientId);
                    
                    // 订阅房间主题
                    this.client.subscribe(this.topic, { qos: 0 }, (err) => {
                        if (err) {
                            console.error('[MQTT] Subscribe error:', err);
                            reject(err);
                            return;
                        }
                        console.log('[MQTT] Subscribed to:', this.topic);
                        this._notifyConnectionChange(true);
                        resolve();
                    });
                });
                
                this.client.on('message', (topic, message) => {
                    this._handleMessage(message.toString());
                });
                
                this.client.on('error', (err) => {
                    console.error('[MQTT] Error:', err);
                    this._notifyConnectionChange(false);
                });
                
                this.client.on('close', () => {
                    console.log('[MQTT] Connection closed');
                    this.connected = false;
                    this._notifyConnectionChange(false);
                    if (this.onDisconnect) {
                        this.onDisconnect();
                    }
                });
                
                this.client.on('reconnect', () => {
                    console.log('[MQTT] Reconnecting...');
                    this._notifyConnectionChange(false, true);
                });
                
                this.client.on('offline', () => {
                    console.log('[MQTT] Offline');
                    this._notifyConnectionChange(false);
                });
                
            } catch (err) {
                console.error('[MQTT] Connect error:', err);
                reject(err);
            }
        });
    }
    
    /**
     * 断开连接
     */
    disconnect() {
        if (this.client) {
            try {
                this.client.end(true);
            } catch (e) {
                console.error('[MQTT] Disconnect error:', e);
            }
            this.client = null;
            this.connected = false;
        }
    }
    
    /**
     * 发送消息到房间主题
     * @param {object} message - 消息对象
     */
    publish(message) {
        if (!this.connected || !this.client) {
            console.warn('[MQTT] Not connected, cannot publish');
            return false;
        }
        
        try {
            const payload = JSON.stringify({
                ...message,
                from: this.clientId,
                timestamp: Date.now()
            });
            this.client.publish(this.topic, payload, { qos: 0 });
            return true;
        } catch (err) {
            console.error('[MQTT] Publish error:', err);
            return false;
        }
    }
    
    /**
     * 注册消息处理器
     * @param {string} type - 消息类型
     * @param {function} handler - 处理函数
     */
    on(type, handler) {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type).push(handler);
    }
    
    /**
     * 移除消息处理器
     * @param {string} type - 消息类型
     * @param {function} handler - 处理函数（可选，不传则移除所有）
     */
    off(type, handler) {
        if (!handler) {
            this.messageHandlers.delete(type);
        } else {
            const handlers = this.messageHandlers.get(type);
            if (handlers) {
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }
    }
    
    /**
     * 处理收到的消息
     * @private
     */
    _handleMessage(rawMessage) {
        try {
            const message = JSON.parse(rawMessage);
            const { type } = message;
            
            console.log('[MQTT] Received:', type, message);
            
            // 忽略自己发送的消息
            if (message.from === this.clientId) {
                return;
            }
            
            // 调用对应类型的处理器
            const handlers = this.messageHandlers.get(type);
            if (handlers) {
                handlers.forEach(handler => {
                    try {
                        handler(message);
                    } catch (err) {
                        console.error('[MQTT] Handler error:', err);
                    }
                });
            }
            
            // 调用通配符处理器
            const allHandlers = this.messageHandlers.get('*');
            if (allHandlers) {
                allHandlers.forEach(handler => {
                    try {
                        handler(message);
                    } catch (err) {
                        console.error('[MQTT] Wildcard handler error:', err);
                    }
                });
            }
        } catch (err) {
            console.error('[MQTT] Parse message error:', err);
        }
    }
    
    /**
     * 通知连接状态变化
     * @private
     */
    _notifyConnectionChange(connected, reconnecting = false) {
        if (this.onConnectionChange) {
            this.onConnectionChange(connected, reconnecting);
        }
    }
    
    /**
     * 获取客户端 ID
     */
    getClientId() {
        return this.clientId;
    }
}

// 全局 MQTT 实例
const mqttManager = new MQTTManager();
