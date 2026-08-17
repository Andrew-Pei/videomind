window.VideoMind = window.VideoMind || {};

VideoMind.App = (function () {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const state = {
    config: null,
    source: null,
    processing: false,
    cancelled: false,
  };

  function init() {
    state.config = VideoMind.Config.load();
    bindEvents();
    if (!state.config.apiKey) {
      setTimeout(() => {
        showToast('请先点击右上角「设置」配置 API Key', 'info', 5000);
      }, 800);
    }
  }

  function bindEvents() {
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-close-settings').addEventListener('click', closeSettings);
    $('#btn-cancel-settings').addEventListener('click', closeSettings);
    $('#btn-save-settings').addEventListener('click', saveSettings);
    $('#setting-provider').addEventListener('change', onProviderChange);

    $('#settings-modal').addEventListener('click', (e) => {
      if (e.target === $('#settings-modal')) closeSettings();
    });

    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    const dropzone = $('#dropzone');
    const fileInput = $('#file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    $('#btn-clear-file').addEventListener('click', clearFile);

    $('#btn-load-url').addEventListener('click', handleUrlLoad);
    $('#url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleUrlLoad();
    });

    $('#btn-start').addEventListener('click', startProcessing);
    $('#btn-reset').addEventListener('click', resetAll);
    $('#btn-cancel').addEventListener('click', () => {
      state.cancelled = true;
    });

    $('#btn-copy-summary').addEventListener('click', () => copyText($('#summary-content').textContent, '摘要已复制'));
    $('#btn-copy-transcript').addEventListener('click', () => copyText($('#transcript-content').textContent, '转录已复制'));
    $('#btn-download-summary').addEventListener('click', () => downloadText('summary.md', $('#summary-content').textContent));
    $('#btn-download-transcript').addEventListener('click', () => downloadText('transcript.txt', $('#transcript-content').textContent));
  }

  function switchTab(tab) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $$('.tab-content').forEach((c) => c.classList.remove('active'));
    $(`#tab-${tab}`).classList.add('active');
  }

  function handleFile(file) {
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|avi|mkv|flv|wmv|m4v|mpg|mpeg|ts|3gp)$/i.test(file.name)) {
      showToast('请选择视频文件', 'error');
      return;
    }
    state.source = { type: 'file', file, name: file.name };
    $('#file-info-name').textContent = file.name;
    $('#file-info-size').textContent = formatSize(file.size);
    $('#file-info').hidden = false;
    $('#action-bar').hidden = false;
  }

  function clearFile() {
    state.source = null;
    $('#file-input').value = '';
    $('#file-info').hidden = true;
    $('#action-bar').hidden = true;
  }

  async function handleUrlLoad() {
    const url = $('#url-input').value.trim();
    if (!url) {
      showToast('请输入视频链接', 'error');
      return;
    }
    if (/youtube\.com|youtu\.be|bilibili\.com|b23\.tv/i.test(url)) {
      showToast('暂不支持 YouTube / B站 等平台链接，请使用视频文件直链', 'error', 4000);
      return;
    }

    showLoading('正在下载视频...');
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);

      const blob = await resp.blob();
      const name = url.split('/').pop()?.split('?')[0] || 'video.mp4';

      state.source = { type: 'url', blob, name, url };
      $('#file-info-name').textContent = name;
      $('#file-info-size').textContent = formatSize(blob.size);
      $('#file-info').hidden = false;
      $('#action-bar').hidden = false;
      showToast('视频加载成功', 'success');
    } catch (e) {
      showToast('下载视频失败: ' + e.message + '（可能受 CORS 限制）', 'error', 5000);
    } finally {
      hideLoading();
    }
  }

  async function startProcessing() {
    const err = VideoMind.Config.validate(state.config);
    if (err) {
      showToast(err, 'error', 3000);
      openSettings();
      return;
    }

    if (!state.source) {
      showToast('请先选择视频文件或输入链接', 'error');
      return;
    }

    state.processing = true;
    state.cancelled = false;

    $('#input-section').hidden = true;
    $('#process-section').hidden = false;
    $('#results-section').hidden = true;
    $('#btn-cancel').hidden = false;
    $('#btn-reset').hidden = true;

    resetSteps();

    try {
      const videoData = await getVideoData();
      if (state.cancelled) return;

      const audioResult = await runStep(1, '正在提取音频...', async (onProgress, onLog) => {
        return await VideoMind.FFmpeg.extractAudio(videoData, state.source.name, { onProgress, onLog });
      });

      if (state.cancelled) return;

      const transcriptResult = await runStep(2, '正在转写语音...', async (onProgress, onLog) => {
        const result = await VideoMind.API.transcribeLarge(
          audioResult.blob,
          state.config,
          audioResult.format,
          { onProgress, onLog }
        );
        return result;
      });

      if (state.cancelled) return;

      const summary = await runStep(3, '正在生成摘要...', async (onProgress, onLog) => {
        return await VideoMind.API.summarize(transcriptResult.text, state.config, { onLog });
      });

      if (state.cancelled) return;

      showResults(transcriptResult.text, summary, transcriptResult.chunks);
    } catch (e) {
      console.error(e);
      const activeStep = document.querySelector('.step[data-status="active"]');
      if (activeStep) {
        activeStep.dataset.status = 'error';
      }
      showToast(e.message || '处理失败', 'error', 5000);
    } finally {
      state.processing = false;
      $('#btn-cancel').hidden = true;
      $('#btn-reset').hidden = false;
    }
  }

  async function getVideoData() {
    if (state.source.type === 'file') {
      return new Uint8Array(await state.source.file.arrayBuffer());
    } else {
      return new Uint8Array(await state.source.blob.arrayBuffer());
    }
  }

  async function runStep(stepNum, desc, fn) {
    const step = $(`#step-${stepNum}`);
    const stepDesc = $(`#step-${stepNum}-desc`);
    const stepBar = $(`#step-${stepNum}-bar`);

    step.dataset.status = 'active';
    stepDesc.textContent = desc;
    stepBar.style.width = '0%';

    const logLines = [];
    const onLog = (msg) => {
      logLines.push(msg);
      const logEl = $('#log-output');
      logEl.hidden = false;
      logEl.textContent = logLines.slice(-20).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    };

    const onProgress = (ratio) => {
      stepBar.style.width = `${Math.round(ratio * 100)}%`;
    };

    const result = await fn(onProgress, onLog);

    step.dataset.status = 'done';
    stepDesc.textContent = '已完成';
    stepBar.style.width = '100%';

    return result;
  }

  function resetSteps() {
    for (let i = 1; i <= 3; i++) {
      const step = $(`#step-${i}`);
      step.dataset.status = 'pending';
      $(`#step-${i}-desc`).textContent = '等待开始...';
      $(`#step-${i}-bar`).style.width = '0%';
    }
    $('#log-output').hidden = true;
    $('#log-output').textContent = '';
  }

  function showResults(transcript, summary, chunks) {
    $('#process-section').hidden = true;
    $('#results-section').hidden = false;

    $('#summary-content').innerHTML = renderMarkdown(summary);
    $('#transcript-content').textContent = transcript;

    const wordCount = transcript.replace(/\s+/g, ' ').trim().length;
    const charCount = transcript.length;
    $('#transcript-meta').textContent = `${charCount} 字 · ${chunks > 1 ? chunks + ' 段' : '1 段'}`;

    $('#results-section').scrollIntoView({ behavior: 'smooth' });
  }

  function resetAll() {
    state.source = null;
    $('#file-input').value = '';
    $('#url-input').value = '';
    $('#file-info').hidden = true;
    $('#action-bar').hidden = true;
    $('#process-section').hidden = true;
    $('#results-section').hidden = true;
    $('#input-section').hidden = false;
    resetSteps();
  }

  function openSettings() {
    const c = state.config;
    $('#setting-provider').value = c.provider;
    $('#setting-base-url').value = c.baseUrl;
    $('#setting-api-key').value = c.apiKey;
    $('#setting-whisper-model').value = c.whisperModel;
    $('#setting-chat-model').value = c.chatModel;
    $('#setting-summary-lang').value = c.summaryLang;
    $('#settings-modal').hidden = false;
  }

  function closeSettings() {
    $('#settings-modal').hidden = true;
  }

  function onProviderChange() {
    const provider = $('#setting-provider').value;
    const p = VideoMind.Config.providers[provider];
    if (p) {
      $('#setting-base-url').value = p.baseUrl;
      $('#setting-whisper-model').value = p.whisperModel;
      $('#setting-chat-model').value = p.chatModel;
    }
  }

  function saveSettings() {
    const config = {
      provider: $('#setting-provider').value,
      baseUrl: $('#setting-base-url').value.trim().replace(/\/+$/, ''),
      apiKey: $('#setting-api-key').value.trim(),
      whisperModel: $('#setting-whisper-model').value.trim(),
      chatModel: $('#setting-chat-model').value.trim(),
      summaryLang: $('#setting-summary-lang').value,
    };
    state.config = config;
    VideoMind.Config.save(config);
    closeSettings();
    showToast('设置已保存', 'success');
  }

  function showLoading(text) {
    $('#loading-text').textContent = text || '加载中...';
    $('#loading-overlay').hidden = false;
  }

  function hideLoading() {
    $('#loading-overlay').hidden = true;
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span style="font-weight:700">${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fadeout');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function copyText(text, message) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(message || '已复制到剪贴板', 'success');
    }).catch(() => {
      showToast('复制失败', 'error');
    });
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderMarkdown(md) {
    let html = escapeHtml(md);
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>(<h[1-3]>)/g, '$1');
    html = html.replace(/(<\/h[1-3]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');
    html = html.replace(/<p>(<blockquote>)/g, '$1');
    html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
    html = html.replace(/<p>\s*<\/p>/g, '');
    return html;
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => VideoMind.App.init());