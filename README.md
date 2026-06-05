# Qiniu AI Interpreter

面向技术会议的 AI 实时同声传译助手。项目计划通过实时语音识别、术语感知的上下文 Agent 和双语字幕，改善专业术语误识别、译名不一致及翻译过程不可解释的问题。

当前 PR 建立可运行的 Python 后端基线，并提供健康检查接口。没有配置百炼 API Key 时，服务自动使用 Mock Provider，便于评委直接启动和验证。

## 当前功能

- FastAPI 应用入口。
- 版本化健康检查接口：`GET /api/v1/health`。
- 实时会话 WebSocket：`WS /api/v1/ws/sessions/{session_id}`。
- 会话开始、暂停、恢复和结束状态机。
- 文本降级输入生成临时字幕与确认字幕。
- 非法状态、错误消息和重复序号的结构化错误响应。
- DashScope Qwen-ASR Realtime WebSocket Provider。
- 支持 PCM 音频分片发送、临时识别结果和最终识别结果解析。
- 实时会话与 ASR Provider 的完整音频识别管线。
- 会话停止或 WebSocket 断开时自动释放 ASR 资源。
- 基于 `pydantic-settings` 的环境配置。
- 无 API Key 时自动启用 Mock Provider。
- 健康检查与实时协议自动化测试。

健康检查响应示例：

```json
{
  "status": "ok",
  "service": "qiniu-ai-interpreter",
  "version": "0.1.0",
  "ai_provider": "mock"
}
```

## 环境要求

- Python 3.12+
- Node.js 24 LTS（前端）

## 本地启动

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install ".[dev]"
Copy-Item .env.example .env
python -m uvicorn backend.app.main:app --reload
```

启动后可访问：

- 健康检查：<http://127.0.0.1:8000/api/v1/health>
- OpenAPI 文档：<http://127.0.0.1:8000/docs>

需要启用百炼服务时，在本地 `.env` 中填写 `DASHSCOPE_API_KEY`。请勿提交真实密钥。

当前阶段已完成 DashScope 实时 ASR Provider 与实时会话协议的音频管线集成。

## 前端演示

前端使用 React、TypeScript 和 Vite，当前提供产品首页及 Mock 同传工作台。Mock 模式不请求麦克风权限，也不调用后端服务，用于独立演示页面状态和临时/确认字幕效果。

```powershell
cd frontend
npm install
npm run dev
```

启动后访问 <http://127.0.0.1:5173>。页面路由：

- `/`：产品首页与快速同传入口。
- `/interpreter`：Mock 同传工作台。

构建与前端测试：

```powershell
cd frontend
npm run test
npm run build
```

## 实时协议

连接地址：

```text
ws://127.0.0.1:8000/api/v1/ws/sessions/demo-session
```

客户端命令统一包含：

```json
{
  "version": "1.0",
  "type": "session.start",
  "sequence": 1,
  "payload": {}
}
```

当前支持的命令：

- `session.start`
- `session.pause`
- `session.resume`
- `session.stop`
- `audio.append`
- `text.submit`

服务端事件统一包含 `version`、`type`、`session_id`、`trace_id`、`sequence`、`timestamp` 和 `payload`。`text.submit` 在活跃会话中依次产生 `transcript.partial` 与 `transcript.final`，用于模拟未来实时 ASR 的临时和确认结果。

`audio.append` 在活跃会话中接收 Base64 编码的音频分片：

```json
{
  "version": "1.0",
  "type": "audio.append",
  "sequence": 2,
  "payload": {
    "audio": "BASE64_PCM_AUDIO",
    "format": "pcm",
    "sample_rate": 16000
  }
}
```

识别结果转换为 `transcript.partial` 或 `transcript.final` 事件。当前 DashScope Qwen-ASR Realtime 管线要求单声道、16-bit、16kHz PCM 音频。

启动服务后，可在浏览器开发者工具 Console 中运行：

```javascript
const ws = new WebSocket(
  "ws://127.0.0.1:8000/api/v1/ws/sessions/browser-demo"
);

ws.onmessage = (event) => console.log(JSON.parse(event.data));

ws.onopen = () => {
  ws.send(JSON.stringify({
    version: "1.0",
    type: "session.start",
    sequence: 1,
    payload: {
      source_language: "zh-CN",
      target_language: "en-US"
    }
  }));

  ws.send(JSON.stringify({
    version: "1.0",
    type: "text.submit",
    sequence: 2,
    payload: {
      text: "我们使用七牛云对象存储。"
    }
  }));
};
```

## 运行测试

```powershell
python -m pytest
```

## 项目结构

```text
backend/
  app/
    api/        # HTTP API
    core/       # 配置与基础设施
    realtime/   # 会话状态机、ASR 管线与实时事件模型
    main.py     # FastAPI 应用入口
frontend/
  src/          # React 页面、Mock 字幕事件与交互测试
docs/
  superpowers/
    specs/      # 架构设计
tests/          # 自动化测试
```

## 第三方依赖

- [FastAPI](https://fastapi.tiangolo.com/)：Web API 框架。
- [Uvicorn](https://www.uvicorn.org/)：ASGI 开发服务器。
- [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)：环境配置管理。
- [HTTPX](https://www.python-httpx.org/)：FastAPI 测试客户端依赖。
- [websockets](https://websockets.readthedocs.io/)：DashScope 实时 ASR WebSocket 客户端。
- [pytest](https://docs.pytest.org/)：自动化测试框架。
- [React](https://react.dev/)：演示页面组件与交互状态。
- [Vite](https://vite.dev/)：前端开发服务器与构建工具。
- [Vitest](https://vitest.dev/)：前端组件和交互测试。

完整版本约束见 [`pyproject.toml`](pyproject.toml)。

## 原创说明

本仓库中的产品设计、实时事件管线、Provider 扩展边界、健康检查实现与测试均为本次参赛作品原创。当前代码未复用个人历史项目代码。

后续接入的 FastAPI、百炼 DashScope SDK 等第三方库仅作为基础依赖使用，其名称、用途和版本会持续记录在 README 与依赖清单中。

## 设计文档

- [AI 同声传译助手设计](docs/superpowers/specs/2026-06-05-ai-simultaneous-interpreter-design.md)
