# WatchTogether P2P

> 免费、无需服务器、国内可直连的多人同步观赛 + 屏幕共享 Web 应用

![banner](https://img.shields.io/badge/WebRTC-P2P-blue) ![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Live-brightgreen) ![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ 特性

- 🎬 **屏幕共享**：2K 60fps 高清共享，支持画质切换
- 🎤 **视频连麦**：最多 6 人同时连麦
- 📱 **跨平台**：PC、手机、平板均可使用
- 🔒 **免注册**：打开即用，无需注册账号
- 🆓 **完全免费**：无需任何费用
- 🌏 **国内可用**：所有资源国内直接访问
- 🔐 **隐私友好**：媒体流 P2P 直连，不经过服务器

## 🚀 在线访问

```
https://你的用户名.github.io/watch_together_p2p/
```

## 📖 快速开始

### 创建房间

1. 打开应用首页
2. 输入昵称
3. 点击「创建房间」
4. 复制邀请链接发送给朋友

### 加入房间

1. 点击邀请链接，或手动输入房间号
2. 输入昵称
3. 等待管理员批准

### 屏幕共享

1. 点击「共享屏幕」按钮（仅 PC 端）
2. 选择画质
3. 等待管理员批准
4. 选择要共享的屏幕/窗口

## 🏗️ 技术架构

```
纯前端 + WebRTC P2P + MQTT 公共信令
```

- **前端**：原生 HTML + CSS + JavaScript，无框架
- **信令**：MQTT over WebSocket（公共 EMQX Broker）
- **媒体**：WebRTC P2P Mesh 拓扑
- **托管**：GitHub Pages + Actions 自动部署

详见 [docs/02-architecture.md](docs/02-architecture.md)

## 🖥️ 部署

### 自动部署（推荐）

1. 将代码推送到 `main` 分支
2. GitHub Actions 自动部署到 `gh-pages` 分支
3. 在仓库设置中启用 GitHub Pages，源选择 `gh-pages` 分支

### 手动部署

```bash
# 克隆仓库
git clone https://github.com/你的用户名/watch_together_p2p.git
cd watch_together_p2p

# 将 frontend/ 目录内容推送到 gh-pages 分支
git subtree push --prefix frontend origin gh-pages
```

## 🪟 创建桌面快捷方式（Windows）

### Chrome 浏览器

1. 打开 Chrome 浏览器
2. 访问 `https://你的域名/?room=房间号`
3. 点击右上角 ⋮（三个点）图标
4. 选择「更多工具」→「创建快捷方式...」
5. 输入快捷方式名称，勾选「在窗口中打开」
6. 点击「创建」

### Edge 浏览器

1. 打开 Edge 浏览器
2. 访问 `https://你的域名/?room=房间号`
3. 点击右上角 ⋯（三个点）图标
4. 选择「应用」→「将此站点作为应用安装」
5. 输入应用名称
6. 点击「安装」

创建后双击桌面快捷方式即可直接打开。

## 📁 项目结构

```
watch_together_p2p/
├── frontend/                  # 前端代码
│   ├── index.html            # 入口页面
│   ├── css/
│   │   └── style.css         # 全局样式
│   ├── js/
│   │   ├── config.js         # 全局配置
│   │   ├── mqtt.js           # MQTT 连接管理
│   │   ├── webrtc.js         # 连麦 WebRTC
│   │   ├── screenshare.js    # 屏幕共享
│   │   ├── ui.js             # UI 渲染
│   │   └── app.js            # 主入口
│   └── _redirects            # SPA 重定向
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions 部署
├── docs/
│   ├── 01-project-intro.md   # 项目介绍与调研
│   ├── 02-architecture.md    # 架构说明
│   ├── 03-user-guide.md      # 用户手册
│   └── 04-troubleshooting.md # 排障手册
└── README.md
```

## 🔧 开发

本地开发无需构建步骤，直接打开 `frontend/index.html` 即可。

或者使用本地服务器：

```bash
cd frontend
python -m http.server 8080
# 访问 http://localhost:8080
```

## ⚠️ 已知限制

- MQTT Broker 消息未加密（媒体流 P2P 加密）
- 房间号可被猜测（6 位随机）
- 无 TURN 服务器（极端 NAT 环境可能连接失败）

## 📄 License

[MIT](LICENSE)

## 🙏 致谢

感谢以下开源项目的启发：
- [Trystero](https://github.com/dmotz/trystero) - 零服务端 WebRTC 信令库
- [Godot WebRTC MQTT](https://github.com/goatchurchprime/godot_webrtc_mqtt) - 纯 MQTT 信令教学项目
- [CoffeeTalk](https://github.com/dcs-team4/coffeetalk) - 双通道信令架构
- [Matchbox](https://github.com/johanhelsing/matchbox) - Full-mesh 信令框架
