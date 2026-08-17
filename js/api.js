window.VideoMind = window.VideoMind || {};

VideoMind.API = (function () {
  const MAX_FILE_SIZE = 24 * 1024 * 1024;

  async function transcribe(audioBlob, config, { onProgress } = {}) {
    const formData = new FormData();
    const ext = audioBlob.type.includes('wav') ? 'wav' : 'mp3';
    formData.append('file', audioBlob, `audio.${ext}`);
    formData.append('model', config.whisperModel);
    formData.append('response_format', 'json');

    const url = config.baseUrl.replace(/\/+$/, '') + '/audio/transcriptions';

    const resp = await fetchWithProgress(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    }, onProgress);

    if (!resp.ok) {
      const errText = await safeErrorText(resp);
      throw new Error(`语音转文字失败 (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    return data.text || '';
  }

  async function transcribeLarge(audioBlob, config, format, { onProgress, onLog } = {}) {
    if (audioBlob.size <= MAX_FILE_SIZE) {
      const text = await transcribe(audioBlob, config, { onProgress });
      return { text, chunks: 1 };
    }

    if (onLog) onLog(`音频较大 (${(audioBlob.size / 1024 / 1024).toFixed(1)}MB)，分段处理...`);

    const audioData = new Uint8Array(await audioBlob.arrayBuffer());
    const chunks = await VideoMind.FFmpeg.splitIntoChunks(audioData, format, 600, { onLog });

    if (chunks.length === 0) {
      throw new Error('音频分段失败');
    }

    if (onLog) onLog(`已分为 ${chunks.length} 段，逐段转写中...`);

    let fullText = '';
    for (let i = 0; i < chunks.length; i++) {
      if (onLog) onLog(`正在转写第 ${i + 1}/${chunks.length} 段...`);
      if (onProgress) onProgress(i / chunks.length);
      const chunkText = await transcribe(chunks[i], config);
      fullText += chunkText + '\n\n';
    }

    if (onProgress) onProgress(1);

    return { text: fullText.trim(), chunks: chunks.length };
  }

  async function summarize(text, config, { onLog } = {}) {
    if (!text || text.trim().length === 0) {
      throw new Error('转录文本为空，无法生成摘要');
    }

    const langName = VideoMind.Config.getSummaryLangName(config.summaryLang);
    const langInstruction = config.summaryLang === 'auto'
      ? '请使用与转录文本相同的语言进行总结。'
      : `请使用${langName}进行总结。`;

    const systemPrompt = `你是一个专业的视频内容分析助手。你的任务是分析视频的语音转录文本，生成结构化的内容摘要。${langInstruction}

请按以下格式输出摘要：

## 一句话概述
用一句话概括视频的核心内容。

## 主要内容
用 3-5 个要点列出视频讨论的主要内容，每个要点简洁明了。

## 关键信息
提取视频中的关键数据、名称、日期、结论等重要信息（如有）。

## 适合人群
简要说明这个视频适合什么人观看。`;

    const userPrompt = `请分析以下视频转录文本并生成摘要：

---
${text.slice(0, 12000)}
---

注意：如果文本较长，以上可能是截取的部分。请基于提供的内容生成摘要。`;

    if (onLog) onLog('正在生成内容摘要...');

    const url = config.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.chatModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!resp.ok) {
      const errText = await safeErrorText(resp);
      throw new Error(`摘要生成失败 (${resp.status}): ${errText}`);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('摘要生成失败: 返回内容为空');
    }
    return content;
  }

  async function fetchWithProgress(url, options, onProgress) {
    if (!onProgress) return fetch(url, options);

    try {
      const resp = await fetch(url, options);
      if (resp.ok && resp.body) {
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;
        const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) {
            onProgress(received / contentLength);
          }
        }

        const blob = new Blob(chunks);
        return new Response(blob, {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
      }
      return resp;
    } catch (e) {
      throw e;
    }
  }

  async function safeErrorText(resp) {
    try {
      const text = await resp.text();
      try {
        const json = JSON.parse(text);
        return json.error?.message || json.message || text;
      } catch {
        return text.slice(0, 200);
      }
    } catch {
      return resp.statusText || 'Unknown error';
    }
  }

  return { transcribe, transcribeLarge, summarize, MAX_FILE_SIZE };
})();