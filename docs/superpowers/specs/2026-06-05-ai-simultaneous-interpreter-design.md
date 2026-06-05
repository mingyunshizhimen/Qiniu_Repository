# AI 同声传译助手设计

## 1. 产品定位

面向技术会议的 AI 实时同声传译助手。产品提供可靠的实时双语字幕与会后记录，并通过术语感知、上下文修正和质量可观测能力，解决通用同传工具对技术专有名词识别不准、译名不一致、错误不可解释的问题。

首版只支持中文与英文，优先保证中译英链路稳定。产品参考成熟同传工具的低门槛交互，但不复制预约服务、人工同传和复杂会议平台能力。

## 2. 成功标准

1. 用户可在浏览器开始、暂停、恢复和结束一场同传会话。
2. 麦克风音频经实时 ASR 转为临时或确认原文，并生成对应译文。
3. 用户可维护会议术语，系统能展示术语命中及 Agent 修正结果。
4. 页面展示 ASR、翻译和端到端延迟，失败时给出明确状态并允许恢复。
5. 结束后可查看双语时间轴、会议摘要和行动项，并导出 Markdown。
6. 未配置云端密钥时，项目仍可通过模拟 Provider 完整演示。

## 3. 功能范围

### 3.1 本次必须完成

- 首页：快速同传、同传记录两个真实入口。
- 同传工作台：语言方向、麦克风状态、会话控制、双语字幕流。
- 字幕状态：临时字幕低延迟刷新，确认字幕持久化且不再抖动。
- 术语管理：会前输入或批量粘贴术语、标准译名和可选说明。
- 上下文 Agent：结合术语表及最近确认片段修正原文并保持译名一致。
- 质量面板：ASR 延迟、翻译延迟、端到端延迟、术语命中数和修正数。
- 同传记录：双语时间轴、会后摘要、行动项和 Markdown 导出。
- 可靠性：连接状态、超时、有限重试、文本输入降级和仅转写降级。
- 工程交付：测试、Docker、README、架构图、API 说明和 Demo 视频脚本。

### 3.2 有余力再做

1. TTS 译文播报。
2. 中英双向自动切换。
3. 系统级或浏览器画中画悬浮字幕。
4. 更多语言 Provider 配置。

### 3.3 明确不做

- 预约同传：该能力涉及用户、日程、房间、分享权限及通知，与首版核心创新无关。
- 多人会议、说话人分离、人工译员市场、支付、声音克隆和数字人。

## 4. 核心创新

### 4.1 术语感知的上下文同传 Agent

Agent 不直接修改不可追溯的结果，而是产生结构化决策：

- `raw_text`：ASR 原始结果。
- `corrected_text`：结合术语和上下文后的原文。
- `translation`：统一术语后的译文。
- `term_hits`：命中的术语及标准译名。
- `corrections`：修改前后内容及原因。
- `confidence`：用于界面提示的质量等级，不宣称为统计概率。

最近若干条确认字幕构成短期上下文。只有确认字幕进入历史和摘要，临时字幕只用于低延迟显示。

### 4.2 自适应字幕稳定策略

短且语义完整的片段立即翻译；明显未完成的片段显示临时结果并等待确认。该策略通过可替换的 `StabilizationPolicy` 实现，首版采用基于 ASR final 标记、标点和长度的规则，后续可升级为模型判断。

### 4.3 可解释质量面板

每个字幕片段使用统一 `trace_id` 串联音频接收、ASR、Agent、翻译和持久化事件。界面既展示延迟，也允许查看术语命中和修正原因，体现系统质量控制而非简单 API 串联。

## 5. 系统架构

```text
Browser
  ├─ Audio Capture
  ├─ Subtitle Timeline
  ├─ Session Controls
  └─ Quality Dashboard
          │ WebSocket + REST
          ▼
FastAPI Application
  ├─ Session Service
  ├─ Realtime Pipeline
  │    Audio → ASR Provider → Stabilization Policy
  │          → Context Agent → Translation Provider
  │          → Event Store → Client Events
  ├─ Glossary Service
  ├─ Record/Summary Service
  └─ Metrics Collector
          │
          ├─ Qwen ASR / Translation / optional TTS
          └─ SQLite
```

前端使用 React、TypeScript 和 Vite。后端使用 FastAPI、WebSocket、SQLAlchemy 与 SQLite。前后端通过版本化事件协议通信。

## 6. 可扩展边界

云服务均通过窄接口隔离：

- `ASRProvider`：输入音频帧，输出临时或确认转写事件。
- `TranslationProvider`：输入文本、语言方向和上下文，输出译文。
- `TTSProvider`：输入译文，输出音频流；首版可为空实现。
- `TranscriptRepository`：保存会话、片段和指标。
- `SummaryProvider`：根据确认片段生成结构化会后内容。

语言使用 BCP 47 代码配置，不在业务逻辑中写死中英文。悬浮字幕未来只消费现有字幕事件，不进入实时管线。Provider 失败时可以切换模拟实现或降级模式。

## 7. 实时事件协议

客户端事件：

- `session.start`
- `session.pause`
- `session.resume`
- `session.stop`
- `audio.chunk`
- `text.submit`

服务端事件：

- `session.state`
- `transcript.partial`
- `transcript.final`
- `translation.partial`
- `translation.final`
- `quality.updated`
- `pipeline.degraded`
- `error`

所有事件包含 `version`、`session_id`、`trace_id`、`sequence` 和 `timestamp`。服务端按 `sequence` 保证单会话有序，忽略重复音频帧和已完成会话的迟到事件。

## 8. 数据模型

- `Session`：语言方向、状态、开始与结束时间、降级模式。
- `TranscriptSegment`：序号、原始文本、修正文本、译文、是否确认、时间戳。
- `GlossaryTerm`：源术语、标准译名、说明、启用状态。
- `AgentDecision`：术语命中、修正明细、质量等级和模型信息。
- `LatencyMetric`：ASR、Agent、翻译及端到端耗时。

首版使用 SQLite；Repository 边界允许后续迁移 PostgreSQL。

## 9. 错误与降级

- WebSocket 断开：前端保留会话 ID 并尝试有限重连。
- ASR 不可用：切换文本输入，保留翻译、Agent 和记录链路。
- 翻译不可用：继续展示原文并标记“仅转写模式”。
- Agent 超时：使用原始转写直接翻译，不阻塞字幕。
- 持久化失败：向客户端报告错误，内存中保留当前片段供重试。
- 密钥缺失：使用 Mock Provider，确保评委可运行和复现。

## 10. 测试策略

- 单元测试：状态机、术语匹配、稳定策略、延迟计算和降级规则。
- 契约测试：Provider 输入输出及 WebSocket 事件结构。
- 集成测试：模拟 Provider 打通开始、字幕、暂停、恢复、结束和记录查询。
- 前端测试：核心页面状态与事件 reducer。
- 手工验收：真实麦克风、断网恢复、无密钥模式及 Markdown 导出。

## 11. 页面结构

首页采用成熟同传产品的卡片式入口，但不放空功能：

- 快速同传：进入工作台。
- 同传记录：进入历史列表。
- Agent 实验室：查看术语、修正和质量解释，强化作品特色。

悬浮字幕只在实际完成后加入入口，不展示不可用卡片。

## 12. 持续交付与 PR 拆分

1. 工程骨架、首页、健康检查和 Mock Provider。
2. 同传工作台与模拟实时字幕。
3. 会话状态机和 WebSocket 事件协议。
4. Qwen 实时 ASR Provider。
5. 翻译、术语表和上下文 Agent。
6. 同传记录、摘要导出和质量面板。
7. 可靠性、测试、Docker、README 与 Demo 材料。

每个 PR 只实现一个可独立验证的目标，描述功能、实现思路和测试方式；合并后主分支始终可运行。依赖及原创范围在 README 中明确列出。

