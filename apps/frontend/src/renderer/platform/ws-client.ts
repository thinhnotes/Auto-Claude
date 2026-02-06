/**
 * WebSocket Client for Real-Time Communication
 * ===========================================
 *
 * Manages WebSocket connection to the backend with:
 * - Auto-reconnection with exponential backoff
 * - Channel-based subscriptions
 * - Message routing to handlers
 * - Heartbeat / health checks
 */

type MessageType = 'hello' | 'subscribe' | 'unsubscribe' | 'event' | 'ack' | 'error' | 'ping' | 'pong' | 'request' | 'response';

type Channel = 'task.status' | 'task.progress' | 'task.logs' | 'roadmap.status' | 'project.updated';

interface Scope {
  projectId?: string;
  taskId?: string;
  specId?: string;
}

interface WSMessage {
  v: number;
  type: MessageType;
  id?: string;
  ts: string;
  channel?: string;
  scope?: Scope;
  data?: any;
  cursor?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  method?: string;
  params?: any;
}

type EventHandler = (data: any, cursor?: string) => void;
type ErrorHandler = (error: string) => void;

interface Subscription {
  channel: Channel;
  scope: Scope;
  handlers: Set<EventHandler>;
}

interface WSClientOptions {
  url: string;
  autoReconnect?: boolean;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: ErrorHandler;
}

/**
 * WebSocket client with subscription management and auto-reconnect
 */
export class WSClient {
  private ws: WebSocket | null = null;
  private url: string;
  private autoReconnect: boolean;
  private maxReconnectDelay: number;
  private heartbeatInterval: number;
  private heartbeatTimeout: number;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions = new Map<string, Subscription>();
  private messageIdCounter = 0;
  private pendingAcks = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
  private pendingRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void }>();
  private clientId: string;
  private connected = false;
  private connecting = false;
  private connectCallbacks = new Set<() => void>();

  // Event handlers
  private onConnectHandler?: () => void;
  private onDisconnectHandler?: () => void;
  private onErrorHandler?: ErrorHandler;

  constructor(options: WSClientOptions) {
    this.url = options.url;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 5000;
    this.heartbeatInterval = options.heartbeatInterval ?? 20000;
    this.heartbeatTimeout = options.heartbeatTimeout ?? 10000;
    this.onConnectHandler = options.onConnect;
    this.onDisconnectHandler = options.onDisconnect;
    this.onErrorHandler = options.onError;
    this.clientId = this.generateClientId();
  }

  private generateClientId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateMessageId(): string {
    return `msg-${++this.messageIdCounter}`;
  }

  private getSubscriptionKey(channel: Channel, scope: Scope): string {
    return JSON.stringify({ channel, scope });
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[WSClient] Already connected or connecting');
      return;
    }

    this.connecting = true;
    console.log(`[WSClient] Connecting to ${this.url}...`);

    try {
      console.log('[WSClient] Creating raw WebSocket object', this.url);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[WSClient] Connected');
        this.connecting = false;
        this.connected = true;
        this.reconnectAttempts = 0;
        console.debug('[WSClient] ws readyState onopen =', this.ws?.readyState);
        this.sendHello();
        this.startHeartbeat();
        this.resubscribeAll();
        this.onConnectHandler?.();

        // Call all registered connect callbacks
        this.connectCallbacks.forEach(callback => {
          try {
            callback();
          } catch (error) {
            console.error('[WSClient] Error in connect callback:', error);
          }
        });
        this.connectCallbacks.clear();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event) => {
        console.error('[WSClient] WebSocket error event:', event);
        console.debug('[WSClient] ws readyState onerror =', this.ws?.readyState);
        this.onErrorHandler?.('WebSocket connection error');
      };

      this.ws.onclose = (event) => {
        console.log(`[WSClient] Disconnected (code: ${event.code}, reason: ${event.reason})`);
        console.debug('[WSClient] ws readyState onclose =', this.ws?.readyState);
        this.handleDisconnect();
      };
    } catch (error) {
      console.error('[WSClient] Failed to create WebSocket:', error);
      this.connecting = false;
      this.handleDisconnect();
    }
  }

  /**
   * Close the WebSocket connection
   */
  close(): void {
    console.log('[WSClient] Closing connection');
    this.autoReconnect = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.connecting = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Register a callback to be called when connected
   * If already connected, calls the callback immediately
   * Returns a cleanup function to remove the callback
   */
  onConnect(callback: () => void): () => void {
    if (this.isConnected()) {
      // Already connected, call immediately
      callback();
      return () => {}; // No-op cleanup since already called
    }

    // Register callback for next connection
    this.connectCallbacks.add(callback);

    // Return cleanup function
    return () => {
      this.connectCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to a channel
   *
   * Returns a cleanup function to unsubscribe
   */
  subscribe(channel: Channel, scope: Scope, handler: EventHandler): () => void {
    const key = this.getSubscriptionKey(channel, scope);
    
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = { channel, scope, handlers: new Set() };
      this.subscriptions.set(key, subscription);
      
      // Send subscribe message if connected
      if (this.isConnected()) {
        this.sendSubscribe(channel, scope);
      }
    }
    
    subscription.handlers.add(handler);
    console.log(`[WSClient] Subscribed to ${channel} with scope`, scope);

    // Return cleanup function
    return () => {
      this.unsubscribe(channel, scope, handler);
    };
  }

  /**
   * Unsubscribe from a channel
   */
  private unsubscribe(channel: Channel, scope: Scope, handler: EventHandler): void {
    const key = this.getSubscriptionKey(channel, scope);
    const subscription = this.subscriptions.get(key);
    
    if (subscription) {
      subscription.handlers.delete(handler);
      
      // If no more handlers, remove subscription and notify server
      if (subscription.handlers.size === 0) {
        this.subscriptions.delete(key);
        if (this.isConnected()) {
          this.sendUnsubscribe(channel, scope);
        }
        console.log(`[WSClient] Unsubscribed from ${channel} with scope`, scope);
      }
    }
  }

  /**
   * Send a request and wait for response
   *
   * Returns a promise that resolves with the response data
   */
  async request<T = any>(method: string, params?: any): Promise<T> {
    // Wait for connection if not connected (with 5s timeout)
    if (!this.isConnected()) {
      console.log(`[WSClient] Waiting for connection before sending ${method}...`);
      const connectionTimeout = 5000;
      const start = Date.now();
      
      while (!this.isConnected() && Date.now() - start < connectionTimeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      console.log(`[WSClient] Wait finished for ${method}, connected=${this.isConnected()}, ws.readyState=${this.ws?.readyState}`);
      
      if (!this.isConnected()) {
        throw new Error(`WebSocket not connected - cannot send ${method}`);
      }
    }

    const msgId = this.generateMessageId();
    const message: WSMessage = {
      v: 1,
      type: 'request',
      id: msgId,
      ts: new Date().toISOString(),
      method,
      params: params || {},
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(msgId, {
        resolve: (data: T) => {
          console.log(`[WSClient] Request completed: ${method}`);
          resolve(data);
        },
        reject,
      });

      const sent = this.send(message);
      if (!sent) {
        console.error(`[WSClient] send() returned false for ${method}, ws readyState=`, this.ws?.readyState);
        console.error(new Error('send failed').stack);
        this.pendingRequests.delete(msgId);
        reject(new Error(`Failed to send request: ${method}`));
        return;
      }

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(msgId)) {
          this.pendingRequests.delete(msgId);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /**
   * Send hello message after connection
   */
  private sendHello(): void {
    this.send({
      v: 1,
      type: 'hello',
      id: this.generateMessageId(),
      ts: new Date().toISOString(),
      data: { clientId: this.clientId },
    });
  }

  /**
   * Send subscribe message
   */
  private async sendSubscribe(channel: Channel, scope: Scope): Promise<void> {
    const msgId = this.generateMessageId();
    const message: WSMessage = {
      v: 1,
      type: 'subscribe',
      id: msgId,
      ts: new Date().toISOString(),
      channel,
      scope,
    };

    return new Promise((resolve, reject) => {
      this.pendingAcks.set(msgId, {
        resolve: () => {
          console.log(`[WSClient] Subscription confirmed: ${channel}`);
          resolve();
        },
        reject,
      });
      this.send(message);
      
      // Timeout after 5s
      setTimeout(() => {
        if (this.pendingAcks.has(msgId)) {
          this.pendingAcks.delete(msgId);
          reject(new Error(`Subscription timeout: ${channel}`));
        }
      }, 5000);
    });
  }

  /**
   * Send unsubscribe message
   */
  private sendUnsubscribe(channel: Channel, scope: Scope): void {
    this.send({
      v: 1,
      type: 'unsubscribe',
      id: this.generateMessageId(),
      ts: new Date().toISOString(),
      channel,
      scope,
    });
  }

  /**
   * Send a message to the server
   * @returns true if sent successfully, false otherwise
   */
  private send(message: WSMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    } else {
      console.warn('[WSClient] Cannot send message - not connected');
      return false;
    }
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message: WSMessage = JSON.parse(data);

      switch (message.type) {
        case 'pong':
          this.handlePong();
          break;

        case 'ack':
          this.handleAck(message);
          break;

        case 'event':
          this.handleEvent(message);
          break;

        case 'response':
          this.handleResponse(message);
          break;

        case 'error':
          this.handleError(message);
          break;

        default:
          console.warn('[WSClient] Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('[WSClient] Failed to parse message:', error);
    }
  }

  /**
   * Handle pong response
   */
  private handlePong(): void {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Handle acknowledgment
   */
  private handleAck(message: WSMessage): void {
    if (message.id) {
      const pending = this.pendingAcks.get(message.id);
      if (pending) {
        pending.resolve();
        this.pendingAcks.delete(message.id);
      }
    }
  }

  /**
   * Handle event message
   */
  private handleEvent(message: WSMessage): void {
    if (!message.channel || !message.scope) {
      console.warn('[WSClient] Event missing channel or scope');
      return;
    }

    const key = this.getSubscriptionKey(message.channel as Channel, message.scope);
    const subscription = this.subscriptions.get(key);

    if (subscription) {
      subscription.handlers.forEach((handler) => {
        try {
          handler(message.data, message.cursor);
        } catch (error) {
          console.error('[WSClient] Error in event handler:', error);
        }
      });
    }
  }

  /**
   * Handle response message
   */
  private handleResponse(message: WSMessage): void {
    if (!message.id) {
      console.warn('[WSClient] Response missing ID');
      return;
    }

    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      if (message.code || message.message) {
        // Error response
        pending.reject(new Error(message.message || 'Unknown error'));
      } else {
        // Success response
        pending.resolve(message.data);
      }
      this.pendingRequests.delete(message.id);
    }
  }

  /**
   * Handle error message
   */
  private handleError(message: WSMessage): void {
    console.error(`[WSClient] Server error: ${message.message} (code: ${message.code})`);
    
    // Reject pending ack if ID matches
    if (message.id) {
      const pending = this.pendingAcks.get(message.id);
      if (pending) {
        pending.reject(new Error(message.message || 'Unknown error'));
        this.pendingAcks.delete(message.id);
      }
    }

    this.onErrorHandler?.(message.message || 'Unknown error');
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(): void {
    this.connected = false;
    this.connecting = false;
    this.stopHeartbeat();
    this.onDisconnectHandler?.();

    // Clear pending acks
    this.pendingAcks.forEach((pending) => {
      pending.reject(new Error('Connection closed'));
    });
    this.pendingAcks.clear();

    // Clear pending requests
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();

    // Auto-reconnect if enabled
    if (this.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    // Exponential backoff: 250ms -> 500ms -> 1s -> 2s -> 5s (max)
    const delays = [250, 500, 1000, 2000, 5000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];

    console.log(`[WSClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  /**
   * Resubscribe to all active subscriptions
   */
  private async resubscribeAll(): Promise<void> {
    console.log(`[WSClient] Resubscribing to ${this.subscriptions.size} channel(s)...`);

    const promises: Promise<void>[] = [];
    this.subscriptions.forEach((sub) => {
      promises.push(this.sendSubscribe(sub.channel, sub.scope).catch((err) => {
        console.error(`[WSClient] Failed to resubscribe to ${sub.channel}:`, err);
      }));
    });

    await Promise.all(promises);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      this.sendPing();
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * Send ping and wait for pong
   */
  private sendPing(): void {
    const ts = new Date().toISOString();
    this.send({
      v: 1,
      type: 'ping',
      ts,
    });

    // Set timeout for pong response
    this.heartbeatTimeoutTimer = setTimeout(() => {
      console.warn('[WSClient] Heartbeat timeout - reconnecting');
      this.ws?.close();
    }, this.heartbeatTimeout);
  }
}
