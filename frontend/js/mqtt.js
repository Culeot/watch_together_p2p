/**
 * mqtt.js - MQTT ???????????
 * ???? EMQX Broker ?? WebRTC ????
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
     * ??????? ID
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
     * ??? MQTT Broker
     * @param {string} roomId - ???
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
                    
                    // ??????
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
     * ????
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
     * ?????????
     * @param {object} message - ????
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
     * ???????
     * @param {string} type - ????
     * @param {function} handler - ????
     */
    on(type, handler) {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, []);
        }
        this.messageHandlers.get(type).push(handler);
    }
    
    /**
     * ???????
     * @param {string} type - ????
     * @param {function} handler - ????(??,???????)
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
     * ???????
     * @private
     */
    _handleMessage(rawMessage) {
        try {
            const message = JSON.parse(rawMessage);
            const { type } = message;
            
            console.log('[MQTT] Received:', type, message);
            
            // ?????????
            if (message.from === this.clientId) {
                return;
            }
            
            // ??????????
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
            
            // ????????
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
     * ????????
     * @private
     */
    _notifyConnectionChange(connected, reconnecting = false) {
        if (this.onConnectionChange) {
            this.onConnectionChange(connected, reconnecting);
        }
    }
    
    /**
     * ????? ID
     */
    getClientId() {
        return this.clientId;
    }
}

// ?? MQTT ??
const mqttManager = new MQTTManager();
