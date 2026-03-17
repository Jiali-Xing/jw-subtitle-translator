# JW Player 字幕翻譯器

自動翻譯 JW Player 影片字幕，支援所有使用 JW Player 的網站。

## 功能

- 🌐 自動檢測 JW Player，無需手動配置網站
- 🚀 支援 Google Gemini API（快速）或免費 Google Translate（備用）
- 💾 翻譯緩存，重複字幕即時顯示
- 🔇 不閃爍，直接覆蓋原生字幕區域

## 安裝

1. 安裝 [Violentmonkey](https://violentmonkey.github.io/) 或 [Tampermonkey](https://www.tampermonkey.net/)
2. [點此安裝腳本](../../raw/main/jw-subtitle-translator.user.js)

## 配置

打開腳本，修改 `CONFIG` 區塊：

```javascript
const CONFIG = {
    // Gemini API Key（從 https://aistudio.google.com/apikey 取得）
    GEMINI_API_KEY: '你的API金鑰',
    
    // 目標語言
    TARGET_LANG: 'zh-TW',  // 'zh-TW' 繁體 / 'zh-CN' 簡體
};
```
`GEMINI_API_KEY` 要填寫三次，搜索 `your` 可以發現。

> 不填 API Key 也能用，會自動使用免費 Google Translate（較慢）。

## 支援網站

任何使用 JW Player 播放器的網站
