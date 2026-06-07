# Qiniu AI Interpreter

面向真实会议场景的 AI 同声传译助手。

项目围绕一条可本地复现的主链路展开：

```text
麦克风采集
→ 音频预处理
→ WebSocket 传输
→ 流式 ASR
→ 语义断句
→ 实时翻译
→ 连续流字幕
→ 可选语音播报
→ 术语管理与命中展示
→ 术语相似度纠错
```

当前版本已经可以在本地直接运行，默认不依赖 Redis、MySQL 或 Docker；如果不配置 `DASHSCOPE_API_KEY`，系统会自动走 Mock 兜底，仍然可以打开工作台演示。

## 当前能力

- 首页与同传工作台
- 浏览器麦克风采集，输出 16kHz 单声道 PCM16
- FastAPI 健康检查与 WebSocket 会话协议
- DashScope 实时 ASR 接入
- 语义断句与连续流字幕展示
- 实时翻译，支持 `translation.partial` 和 `translation.final`
- 语音播报开关
- 播报引擎选择
  - 浏览器播报（推荐，主链路更轻）
  - 后端高质量播报（音色更自然）
- 独立术语库页面 `/glossary`
- 术语命中展示
- 术语增强翻译
- 术语相似度纠错
  - 发现命中术语的近似错误后，自动推送 `transcript.corrected`
  - 前端会高亮修正后的片段

## Demo 视频

[https://www.bilibili.com/video/BV1RDE86xEJd](https://www.bilibili.com/video/BV1RDE86xEJd)

## 页面路由

- `/`：产品首页
- `/interpreter`：实时同传工作台
- `/glossary`：独立术语库页面

## 本地启动

### 后端

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install ".[dev]"
Copy-Item .env.example .env
python -m uvicorn backend.app.main:app --reload
```

如需真实 ASR、翻译和后端 TTS，请在本地 `.env` 中配置：

```env
DASHSCOPE_API_KEY=你的百炼APIKey
```

### 前端

```powershell
cd frontend
npm install
npm run dev
```

然后访问：

- <http://127.0.0.1:5173>
- <http://127.0.0.1:5173/interpreter>
- <http://127.0.0.1:5173/glossary>

## 实时演示建议

1. 打开 `/interpreter`。
2. 点击 `Start realtime ASR`。
3. 允许麦克风权限。
4. 说一段完整话术，观察原文、译文和连续流字幕。
5. 在语音播报卡片中切换播报引擎，比较浏览器播报和后端播报。
6. 打开 `/glossary` 增加一个术语，再回到工作台验证术语命中。

## 测试与构建

```powershell
cd frontend
npm run test
npm run build

cd ..
python -m pytest
```

## 第三方依赖

- FastAPI
- Uvicorn
- Pydantic Settings
- HTTPX
- websockets
- pytest
- React
- React Router
- Vite
- Vitest
- Testing Library

## 原创说明

本仓库中的产品设计、实时事件协议、工作台交互、连续流字幕呈现、术语库交互、播报引擎选择、术语相似度纠错与测试用例，均为本项目原创实现。

后续接入的 FastAPI、DashScope、React、Vite 等第三方框架仅作为基础依赖使用，具体能力边界、调用方式与降级策略均在项目内进行了重新设计。
## 原创说明