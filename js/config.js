window.VideoMind = window.VideoMind || {};

VideoMind.Config = {
  STORAGE_KEY: 'videomind_config',

  providers: {
    openai: {
      label: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      whisperModel: 'whisper-1',
      chatModel: 'gpt-4o-mini',
    },
    groq: {
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      whisperModel: 'whisper-large-v3',
      chatModel: 'llama-3.3-70b-versatile',
    },
    custom: {
      label: '自定义',
      baseUrl: '',
      whisperModel: 'whisper-1',
      chatModel: 'gpt-4o-mini',
    },
  },

  defaults: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    whisperModel: 'whisper-1',
    chatModel: 'gpt-4o-mini',
    summaryLang: 'zh',
  },

  load() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        return { ...this.defaults, ...JSON.parse(saved) };
      }
    } catch (e) {}
    return { ...this.defaults };
  },

  save(config) {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
    } catch (e) {}
  },

  validate(config) {
    if (!config.apiKey || config.apiKey.trim().length < 3) {
      return '请先在设置中填写 API Key';
    }
    if (!config.baseUrl) {
      return '请先在设置中填写 API Base URL';
    }
    return null;
  },

  getSummaryLangName(lang) {
    const map = { zh: '中文', en: 'English', ja: '日本語', auto: '原文语言' };
    return map[lang] || '中文';
  },
};