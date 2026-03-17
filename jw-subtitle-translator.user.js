// ==UserScript==
// @name         JW Player Subtitle Translator (Gemini)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Translates JW Player subtitles using Google Gemini API - works on all sites
// @author       Claude
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      translate.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    CONFIGURATION                                ║
    // ╚════════════════════════════════════════════════════════════════╝

    const CONFIG = {
        // 在這裡填入你的 Gemini API Key
        GEMINI_API_KEY: 'YOUR_API_KEY_HERE',

        // 目標語言
        TARGET_LANG: 'zh-TW',  // 'zh-TW' = 繁體, 'zh-CN' = 簡體

        // Gemini 模型 (會自動嘗試多個)
        GEMINI_MODELS: [
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash',
            'gemini-pro',
        ],

        // 如果 Gemini 失敗，fallback 到免費 Google Translate
        FALLBACK_TO_GOOGLE_FREE: true,
        
        // Debug mode
        DEBUG: false,
    };

    // Track working model
    let workingModel = null;

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    STYLES                                       ║
    // ╚════════════════════════════════════════════════════════════════╝

    let stylesInjected = false;
    
    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        
        const style = document.createElement('style');
        style.textContent = `
            .jw-text-track-cue .immersive-translate-target-wrapper,
            .jw-text-track-cue [data-immersive-translate-translation-element-mark] {
                display: none !important;
            }
            .custom-subtitle-translation {
                display: block;
                margin-top: 0.1em;
                color: inherit;
                font: inherit;
            }
            .jw-text-track-cue {
                contain: layout style;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    TRANSLATION CACHE                            ║
    // ╚════════════════════════════════════════════════════════════════╝

    const cache = new Map();
    const pendingRequests = new Map();
    const MAX_CACHE = 500;

    function getCacheKey(text) {
        return text.trim().toLowerCase();
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    GEMINI API                                   ║
    // ╚════════════════════════════════════════════════════════════════╝

    function tryGeminiModel(text, model) {
        return new Promise((resolve, reject) => {
            const langName = CONFIG.TARGET_LANG === 'zh-TW' ? '繁體中文' : '簡體中文';
            // Try v1 API first (more stable)
            const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `將以下英文翻譯成${langName}，只輸出翻譯結果，不要任何解釋：\n${text}`
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 200
                    }
                }),
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        
                        if (data.error) {
                            reject(new Error(data.error.message));
                            return;
                        }
                        
                        if (data.promptFeedback?.blockReason) {
                            reject(new Error('Content blocked: ' + data.promptFeedback.blockReason));
                            return;
                        }
                        
                        const candidate = data.candidates?.[0];
                        if (candidate?.finishReason === 'SAFETY') {
                            reject(new Error('Safety filter triggered'));
                            return;
                        }
                        
                        const result = candidate?.content?.parts?.[0]?.text?.trim();
                        
                        if (result) {
                            resolve(result);
                        } else {
                            reject(new Error('Empty response'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject
            });
        });
    }

    async function translateGemini(text) {
        // If we found a working model, use it
        if (workingModel) {
            return tryGeminiModel(text, workingModel);
        }

        // Try each model until one works
        for (const model of CONFIG.GEMINI_MODELS) {
            try {
                if (CONFIG.DEBUG) {
                    console.log('[Subtitle] Trying model:', model);
                }
                const result = await tryGeminiModel(text, model);
                workingModel = model;
                console.log('[Subtitle] Using Gemini model:', model);
                return result;
            } catch (e) {
                if (CONFIG.DEBUG) {
                    console.log('[Subtitle] Model failed:', model, e.message);
                }
                // Continue to next model
            }
        }
        
        throw new Error('All Gemini models failed');
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    GOOGLE FREE (FALLBACK)                       ║
    // ╚════════════════════════════════════════════════════════════════╝

    function translateGoogleFree(text) {
        return new Promise((resolve, reject) => {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${CONFIG.TARGET_LANG}&dt=t&q=${encodeURIComponent(text)}`;
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: (response) => {
                    try {
                        const data = JSON.parse(response.responseText);
                        let result = '';
                        if (data?.[0]) {
                            for (const part of data[0]) {
                                if (part[0]) result += part[0];
                            }
                        }
                        resolve(result || text);
                    } catch (e) { reject(e); }
                },
                onerror: reject
            });
        });
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    MAIN TRANSLATE FUNCTION                      ║
    // ╚════════════════════════════════════════════════════════════════╝

    async function translateText(text) {
        const key = getCacheKey(text);

        if (cache.has(key)) {
            return cache.get(key);
        }

        if (pendingRequests.has(key)) {
            return new Promise((resolve, reject) => {
                pendingRequests.get(key).push({ resolve, reject });
            });
        }

        pendingRequests.set(key, []);

        try {
            let result;
            
            if (CONFIG.GEMINI_API_KEY && CONFIG.GEMINI_API_KEY !== 'YOUR_API_KEY_HERE') {
                try {
                    result = await translateGemini(text);
                } catch (e) {
                    console.warn('[Subtitle] Gemini failed, trying fallback:', e.message);
                    if (CONFIG.FALLBACK_TO_GOOGLE_FREE) {
                        result = await translateGoogleFree(text);
                    } else {
                        throw e;
                    }
                }
            } else {
                result = await translateGoogleFree(text);
            }

            if (cache.size >= MAX_CACHE) {
                cache.delete(cache.keys().next().value);
            }
            cache.set(key, result);

            const pending = pendingRequests.get(key) || [];
            pendingRequests.delete(key);
            pending.forEach(p => p.resolve(result));

            return result;

        } catch (err) {
            const pending = pendingRequests.get(key) || [];
            pendingRequests.delete(key);
            pending.forEach(p => p.reject(err));
            throw err;
        }
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    SUBTITLE PROCESSING                          ║
    // ╚════════════════════════════════════════════════════════════════╝

    const processedCues = new Map();
    let cueIdCounter = 0;

    async function processSubtitleCue(cue) {
        if (!cue.dataset.subtitleId) {
            cue.dataset.subtitleId = String(++cueIdCounter);
        }

        let originalText = '';
        for (const node of cue.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                originalText += node.textContent;
            }
        }
        originalText = originalText.trim();
        if (!originalText) return;

        const cueId = cue.dataset.subtitleId;
        if (processedCues.get(cueId) === originalText) {
            return;
        }

        const existingTranslation = cue.querySelector('.custom-subtitle-translation');
        if (existingTranslation) {
            existingTranslation.remove();
            const br = cue.querySelector('br:last-of-type');
            if (br) br.remove();
        }

        processedCues.set(cueId, originalText);

        const translationEl = document.createElement('span');
        translationEl.className = 'custom-subtitle-translation';

        const cached = cache.get(getCacheKey(originalText));
        if (cached) {
            translationEl.textContent = cached;
        } else {
            translationEl.textContent = '...';
            try {
                const translated = await translateText(originalText);
                if (translationEl.parentNode || cue.parentNode) {
                    translationEl.textContent = translated;
                }
            } catch (e) {
                console.error('[Subtitle] Translation error:', e);
                translationEl.textContent = '';
            }
        }

        if (cue.parentNode && !cue.querySelector('.custom-subtitle-translation')) {
            cue.appendChild(document.createElement('br'));
            cue.appendChild(translationEl);
        }
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    JW PLAYER DETECTION & OBSERVER               ║
    // ╚════════════════════════════════════════════════════════════════╝

    let observerStarted = false;
    let detectionObserver = null;

    function startSubtitleObserver() {
        if (observerStarted) return;
        observerStarted = true;
        
        // Inject styles only when JW Player is detected
        injectStyles();
        
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.classList?.contains('jw-text-track-cue')) {
                        processSubtitleCue(node);
                    }
                    if (node.querySelectorAll) {
                        node.querySelectorAll('.jw-text-track-cue').forEach(processSubtitleCue);
                    }
                }
                
                if (mutation.type === 'characterData') {
                    const cue = mutation.target.parentElement?.closest('.jw-text-track-cue');
                    if (cue) processSubtitleCue(cue);
                }
            }
        });

        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            characterData: true 
        });
        
        // Process any existing cues
        document.querySelectorAll('.jw-text-track-cue').forEach(processSubtitleCue);
        
        const usingGemini = CONFIG.GEMINI_API_KEY && CONFIG.GEMINI_API_KEY !== 'YOUR_API_KEY_HERE';
        console.log(`[Subtitle Translator] v6.0 activated on ${window.location.hostname} | ${usingGemini ? 'Gemini' : 'Google Free'}`);
    }

    function checkForJWPlayer() {
        // Check for JW Player elements
        const hasJWPlayer = document.querySelector('.jwplayer, .jw-captions, .jw-text-track-cue, [class*="jw-"]');
        
        if (hasJWPlayer) {
            if (CONFIG.DEBUG) {
                console.log('[Subtitle] JW Player detected');
            }
            startSubtitleObserver();
            
            // Stop detection observer once JW Player is found
            if (detectionObserver) {
                detectionObserver.disconnect();
                detectionObserver = null;
            }
            return true;
        }
        return false;
    }

    function startDetection() {
        if (!document.body) return;
        
        // Check immediately
        if (checkForJWPlayer()) return;
        
        // Set up observer to detect JW Player when it loads
        detectionObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    
                    // Check if the added node is or contains JW Player
                    if (node.classList?.contains('jwplayer') || 
                        node.classList?.contains('jw-captions') ||
                        node.querySelector?.('.jwplayer, .jw-captions')) {
                        checkForJWPlayer();
                        return;
                    }
                }
            }
        });

        detectionObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also check periodically for a short time (for lazy-loaded players)
        let checks = 0;
        const maxChecks = 10;
        const checkInterval = setInterval(() => {
            checks++;
            if (checkForJWPlayer() || checks >= maxChecks) {
                clearInterval(checkInterval);
            }
        }, 2000);
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║                    INIT                                         ║
    // ╚════════════════════════════════════════════════════════════════╝

    if (document.body) {
        startDetection();
    } else {
        document.addEventListener('DOMContentLoaded', startDetection);
    }

})();
