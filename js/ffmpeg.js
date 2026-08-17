window.VideoMind = window.VideoMind || {};

VideoMind.FFmpeg = (function () {
  const baseURLFFMPEG = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd';
  const baseURLCore = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';

  let ffmpegInstance = null;
  let loadingPromise = null;

  async function toBlobURL(url, mimeType, patcher) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
    if (patcher) {
      let body = await resp.text();
      body = patcher(body);
      const blob = new Blob([body], { type: mimeType });
      return URL.createObjectURL(blob);
    }
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  }

  function loadScript(blobURL) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = blobURL;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load FFmpeg script'));
      document.head.appendChild(script);
    });
  }

  async function load(onLog) {
    if (ffmpegInstance && ffmpegInstance.loaded) return ffmpegInstance;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      if (!window.FFmpegWASM) {
        if (onLog) onLog('正在下载音频处理引擎...');
        const ffmpegBlobURL = await toBlobURL(
          `${baseURLFFMPEG}/ffmpeg.js`,
          'text/javascript',
          (js) => {
            const patched = js.replace(
              'new URL(e.p+e.u(814),e.b)',
              'r.workerLoadURL'
            );
            if (patched === js) {
              console.warn('[FFmpeg] Worker patch did not match — worker loading may fail on CDN.');
            }
            return patched;
          }
        );
        await loadScript(ffmpegBlobURL);
      }

      if (onLog) onLog('正在初始化 WASM 核心...');
      const ffmpeg = new FFmpegWASM.FFmpeg();

      if (onLog) {
        ffmpeg.on('log', ({ message }) => onLog(message));
      }

      await ffmpeg.load({
        workerLoadURL: await toBlobURL(
          `${baseURLFFMPEG}/814.ffmpeg.js`,
          'text/javascript'
        ),
        coreURL: await toBlobURL(
          `${baseURLCore}/ffmpeg-core.js`,
          'text/javascript'
        ),
        wasmURL: await toBlobURL(
          `${baseURLCore}/ffmpeg-core.wasm`,
          'application/wasm'
        ),
      });

      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();

    try {
      return await loadingPromise;
    } catch (e) {
      loadingPromise = null;
      throw e;
    }
  }

  function extFromName(name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : 'mp4';
  }

  async function extractAudio(videoData, filename, { onProgress, onLog } = {}) {
    const ffmpeg = await load(onLog);
    const ext = extFromName(filename);
    const inputName = `input.${ext}`;

    if (onProgress) {
      const handler = ({ progress }) => {
        if (typeof progress === 'number' && isFinite(progress)) {
          onProgress(Math.min(1, Math.max(0, progress)));
        }
      };
      ffmpeg.on('progress', handler);
    }

    try {
      await ffmpeg.writeFile(inputName, videoData);
    } catch (e) {
      throw new Error('写入视频文件失败: ' + e.message);
    }

    let audioBlob = null;
    let audioFormat = 'mp3';

    try {
      await ffmpeg.exec([
        '-i', inputName,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-b:a', '32k',
        '-f', 'mp3',
        'output.mp3',
      ]);
      const data = await ffmpeg.readFile('output.mp3');
      audioBlob = new Blob([data.buffer], { type: 'audio/mp3' });
      audioFormat = 'mp3';
    } catch (e) {
      if (onLog) onLog('MP3 编码不可用，回退到 WAV...');
      try {
        await ffmpeg.exec([
          '-i', inputName,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-f', 'wav',
          'output.wav',
        ]);
        const data = await ffmpeg.readFile('output.wav');
        audioBlob = new Blob([data.buffer], { type: 'audio/wav' });
        audioFormat = 'wav';
      } catch (e2) {
        throw new Error('音频提取失败: ' + e2.message);
      }
    }

    try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    try { await ffmpeg.deleteFile('output.mp3'); } catch (e) {}
    try { await ffmpeg.deleteFile('output.wav'); } catch (e) {}

    return { blob: audioBlob, format: audioFormat };
  }

  async function splitIntoChunks(audioData, format, segmentSeconds, { onLog } = {}) {
    const ffmpeg = await load(onLog);
    const inputName = `full.${format}`;
    const chunkPattern = `chunk_%03d.${format}`;

    await ffmpeg.writeFile(inputName, audioData);

    await ffmpeg.exec([
      '-i', inputName,
      '-f', 'segment',
      '-segment_time', String(segmentSeconds),
      '-c', 'copy',
      chunkPattern,
    ]);

    const chunks = [];
    let i = 0;
    while (true) {
      const chunkName = `chunk_${String(i).padStart(3, '0')}.${format}`;
      try {
        const data = await ffmpeg.readFile(chunkName);
        if (data.length === 0) break;
        chunks.push(new Blob([data.buffer], { type: `audio/${format}` }));
        i++;
      } catch (e) {
        break;
      }
    }

    try { await ffmpeg.deleteFile(inputName); } catch (e) {}
    for (let j = 0; j < i; j++) {
      const chunkName = `chunk_${String(j).padStart(3, '0')}.${format}`;
      try { await ffmpeg.deleteFile(chunkName); } catch (e) {}
    }

    return chunks;
  }

  return { load, extractAudio, splitIntoChunks };
})();