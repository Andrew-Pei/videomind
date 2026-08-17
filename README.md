# 🎬 VideoMind — 视频智能理解

上传视频文件或粘贴视频链接，自动提取语音转为文字，并生成结构化内容摘要。纯浏览器端运行，数据不离开你的设备。

## ✨ 功能

- **视频输入**：支持拖拽上传视频文件，或粘贴视频文件直链
- **音频提取**：使用 FFmpeg.wasm 在浏览器中提取音频（无需后端）
- **语音转文字**：通过 Whisper API 将语音转录为文本
- **智能摘要**：通过 LLM 自动生成结构化内容摘要（概述、要点、关键信息）
- **隐私安全**：API Key 仅保存在浏览器本地，视频文件不上传到任何服务器
- **纯静态部署**：可直接部署到 GitHub Pages

## 🚀 使用方法

1. 打开网站
2. 点击右上角「设置」，填写你的 API Key 和服务商信息
3. 上传视频文件或粘贴视频直链
4. 点击「开始分析」，等待处理完成
5. 查看摘要和完整转录，可复制或下载

## ⚙️ 配置

### 支持的 API 服务商

| 服务商 | Base URL | 语音模型 | 对话模型 | 备注 |
|--------|----------|----------|----------|------|
| OpenAI | `https://api.openai.com/v1` | `whisper-1` | `gpt-4o-mini` | 官方，稳定 |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3` | `llama-3.3-70b-versatile` | 免费额度，速度快 |
| 自定义 | 任意 OpenAI 兼容地址 | 自定义 | 自定义 | 兼容 OpenAI 接口即可 |

在设置页面选择服务商后会自动填充，也可手动修改。

### 获取 API Key

- **OpenAI**：[platform.openai.com](https://platform.openai.com/api-keys)
- **Groq**：[console.groq.com](https://console.groq.com/keys)（推荐，有免费额度）

## 🛠️ 技术架构

```
视频文件/链接
    │
    ▼
FFmpeg.wasm (浏览器端)  ──→  音频提取 (mp3/wav, 16kHz 单声道)
    │
    ▼
Whisper API  ──→  语音转文字
    │               ├── 小于 25MB: 直接转写
    │               └── 大于 25MB: 自动分段转写
    ▼
LLM API  ──→  内容摘要 (概述/要点/关键信息)
    │
    ▼
展示结果 (可复制/下载)
```

### 技术栈

- **音频处理**：[FFmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — 浏览器端音视频处理
- **语音识别**：OpenAI Whisper API（兼容 Groq 等服务商）
- **文本摘要**：OpenAI Chat Completions API
- **前端**：原生 HTML / CSS / JavaScript，无构建步骤，无依赖

## 📁 项目结构

```
.
├── index.html          # 主页面
├── css/
│   └── style.css       # 样式
├── js/
│   ├── config.js       # 配置管理
│   ├── ffmpeg.js       # FFmpeg 加载与音频提取
│   ├── api.js          # API 调用（转写 + 摘要）
│   └── app.js          # 主控制器
├── .nojekyll           # 禁用 GitHub Pages 的 Jekyll 处理
└── README.md
```

## 🔒 隐私说明

- 视频文件在浏览器本地使用 FFmpeg.wasm 处理，不上传到服务器
- API Key 仅存储在浏览器 `localStorage` 中
- 提取的音频会发送到你配置的 API 服务商进行转写
- 不收集任何用户数据

## 📝 限制

- YouTube / B站等平台链接不支持（需要后端下载，与纯静态部署冲突）
- 视频直链需支持 CORS 跨域访问
- 首次加载 FFmpeg.wasm 需下载约 31MB（之后浏览器缓存）
- 超长视频处理时间较长（取决于 API 响应速度）

## 📄 License

MIT