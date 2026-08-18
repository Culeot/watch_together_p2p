# 项目介绍与开源调研

## 项目概述

**WatchTogether** 是一个完全免费、无需注册、打开即用的多人同步观赛 + 屏幕共享 Web 应用。

### 核心特点

- **零服务器**：纯前端实现，无需任何后端服务
- **免费**：使用公共 MQTT Broker 进行信令交换
- **免注册**：打开网页即可使用
- **国内可用**：所有资源（CDN、信令服务器）均可在国内直接访问
- **跨平台**：支持 Windows、macOS、Linux、Android、iOS
- **隐私友好**：媒体流 P2P 直连，不经过任何第三方服务器

### 适用场景

- 和朋友一起看比赛、看电影
- 远程教学演示
- 在线会议屏幕共享
- 远程技术支持

---

## 开源调研

在开发本项目前，我们调研了 GitHub 上已有的同类项目，重点研究了使用 MQTT 或 WebSocket 进行 WebRTC 信令交换的实现方案。

### 调研项目

#### 1. Trystero

- **GitHub**: https://github.com/dmotz/trystero
- **Stars**: 2.7k ⭐
- **协议**: MIT
- **语言**: TypeScript

**核心设计思路：**

Trystero 是一个「零服务端」的 WebRTC 信令库，提供统一的 API 支持多种信令策略：BitTorrent、Nostr、**MQTT**、Supabase、Firebase、IPFS 以及自托管 WebSocket 中继。

- **信令交换**：MQTT 策略通过公共/私有 MQTT broker 发布/订阅 SDP offer/answer 和 ICE candidate。每个房间对应一个 MQTT topic（如 `trystero:<appId>:<roomId>`），客户端通过 `publish` 广播自己的 SDP，通过 `subscribe` 接收远端 SDP。信令数据仅在建立连接时经过 broker，媒体流始终 P2P 直连且端到端加密。
- **房间管理**：`joinRoom(config, roomId)` 加入房间，`room.leave()` 离开。房间 ID 即命名空间，无服务端房间状态——完全依赖 MQTT topic 的订阅关系隐式管理。
- **多用户连接**：纯 Mesh 拓扑，每个 peer 与房间内所有其他 peer 建立独立的 `RTCPeerConnection`。提供 `onPeerJoin` / `onPeerLeave` 回调。

**可借鉴点：**
- 策略模式架构——信令层可插拔，切换策略只需改一行 import
- 无需自建信令服务器即可 P2P 通信
- 统一的 API 设计简化了多平台适配

**本项目借鉴：** 采用了类似的「topic 即房间」模式，房间号对应 MQTT topic 后缀，所有客户端通过订阅同一 topic 实现广播通信。

---

#### 2. Godot WebRTC MQTT

- **GitHub**: https://github.com/goatchurchprime/godot_webrtc_mqtt
- **Stars**: 9 ⭐
- **协议**: MIT
- **语言**: GDScript

**核心设计思路：**

一个教学向项目，展示如何用纯 MQTT 协议完成 WebRTC 信令交换，让学习者「看见」信令流程。

- **信令交换**：使用公共 MQTT broker（test.mosquitto.org）。两个客户端约定相同的「MQTT root topic」+ 不同的 local_id（如 `dog111` / `cat222`）。SDP offer/answer 和 ICE candidate 直接作为 MQTT payload 发布到 `{root_topic}/{peer_id}`，对端通过订阅接收。利用 MQTT 的 **retain** 消息保存最后一条 SDP（新订阅者立即收到），**last_will** 自动广播断线状态。
- **房间管理**：无服务端房间概念——房间 = 共享同一个 MQTT root topic 的客户端集合。约定即房间。
- **多用户连接**：设计为 1:1 连接示例，但 topic 机制天然支持多人（每个 peer 发布到自己的 topic，订阅其他所有 peer 的 topic）。

**可借鉴点：**
- **极简信令**：无需任何信令服务器，只需一个 MQTT broker
- 利用 retain + last_will 实现「在线状态」和「断线通知」，无需额外心跳
- 代码极简（~200 行 GDScript），适合理解 WebRTC 信令本质

**本项目借鉴：** 采用了 MQTT 的 **last_will** 特性实现断线通知。当客户端异常断开时，MQTT Broker 会自动向主题发布 will message，其他客户端据此判断用户离线。

---

#### 3. CoffeeTalk（补充参考）

- **GitHub**: https://github.com/dcs-team4/coffeetalk
- **Stars**: 9 ⭐
- **协议**: MIT
- **语言**: Go + JavaScript

**核心设计思路：**

一个完整的视频会议应用，使用 **WebSocket 做实时信令 + MQTT 做控制信令** 的双通道架构。

- **信令交换**：WebRTC 信令走 WebSocket（低延迟），MQTT 承载 Quiz 状态机消息（发布/订阅天然适合广播场景）。
- **房间管理**：服务端维护房间状态，用户通过路由进入。

**可借鉴点：** 信令与控制分离的设计思路——实时信令用 WebSocket，控制信令用 MQTT。

**本项目借鉴：** 本项目的所有信令均通过 MQTT 传输，简化了架构，但保留了消息类型的清晰区分（管理消息 vs WebRTC 信令消息）。

---

#### 4. Matchbox（补充参考）

- **GitHub**: https://github.com/johanhelsing/matchbox
- **Stars**: 1.1k ⭐
- **协议**: MIT/Apache-2.0
- **语言**: Rust

**核心设计思路：**

面向游戏场景的 full-mesh WebRTC 信令框架，目标是提供「UDP 般的」无序不可靠 P2P 连接。

- **房间管理**：`matchbox_server` 内置房间概念——客户端请求加入指定 room ID，服务端将同一 room 内的 peer 互相匹配。
- **多用户连接**：强制 full-mesh（每对 peer 之间都有连接），适合 2-8 人的低延迟游戏。

**可借鉴点：** 清晰的 room 匹配逻辑和连接生命周期管理。

---

### 调研总结

| 项目 | 信令协议 | 拓扑 | 房间机制 | 亮点 |
|------|---------|------|---------|------|
| **Trystero** | MQTT 等 6 种 | Mesh | topic 即房间 | 策略可插拔，无需自建服务 |
| **Godot MQTT** | 纯 MQTT | 1:1（可扩展） | root topic 约定 | 零服务器，retain+last_will |
| **CoffeeTalk** | WebSocket + MQTT | Mesh | 服务端状态管理 | 信令与控制双通道分离 |
| **Matchbox** | WebSocket | Full-mesh | 服务端 room 匹配 | Rust 高性能，游戏场景 |

**关键启示：**

1. **浏览器场景下 MQTT 信令通常走 MQTT over WebSocket**（因为浏览器无法直接 TCP 连 broker）
2. **房间管理可以完全无状态**（靠 topic 约定），也可以服务端维护
3. **Mesh 拓扑适合 ≤10 人的场景**，超过则需 SFU/MCU 方案
4. **MQTT 的 last_will 和 retain 特性** 可以用于实现在线状态和断线通知
5. **消息协议设计** 需要清晰区分管理消息和媒体信令消息

---

## 技术选型

基于以上调研，本项目最终采用：

- **信令**：MQTT over WebSocket（公共 EMQX Broker）
- **拓扑**：Mesh（适合 ≤6 人的小房间）
- **房间机制**：无状态，topic 即房间
- **编码**：VP9 优先，回退 VP8
- **部署**：GitHub Pages + Actions 自动部署
