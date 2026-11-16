// ==UserScript==
// @name         Free Image to Video: turn selected text into an AI video
// @namespace    https://freeimagetovideo.ai
// @version      0.1.0
// @description  Free image to video AI with no daily cap: start with no sign-up, keep going on a free account. Every video comes with sound and no watermark.
// @author       Free Image to Video
// @homepageURL  https://freeimagetovideo.ai/?utm_source=greasyfork&utm_medium=userscript
// @supportURL   https://github.com/hanshs474/fitv-userscript/issues
// @license      MIT
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      freeimagetovideo.ai
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const BASE = 'https://freeimagetovideo.ai';
  const UTM = '?utm_source=greasyfork&utm_medium=userscript';
  const KEYS = BASE + '/settings/apikeys';

  const apiKey = () => String(GM_getValue('apiKey', '') || '').trim();
  function askKey() {
    const v = prompt('Paste your Free Image to Video API key (create one at ' + KEYS + '). Leave empty to remove it.', apiKey());
    if (v !== null) GM_setValue('apiKey', v.trim());
    return apiKey();
  }

  function call(path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: BASE + path,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
        data: JSON.stringify(body || {}),
        timeout: 60000,
        onload: (r) => {
          let json = {};
          try { json = JSON.parse(r.responseText); } catch (e) {}
          resolve({ status: r.status, json });
        },
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timed out')),
      });
    });
  }

  function explain(status, body) {
    const reason = body && body.data && body.data.reason;
    if (status === 401 || /no auth/i.test((body && body.message) || '')) {
      return 'Free Image to Video rejected the API key. Set it again from the userscript menu.';
    }
    if (reason === 'insufficient_credits') return 'Not enough credits on your account for this clip.';
    if (reason === 'plan_required') return 'API runs require a paid plan (freeimagetovideo.ai/pricing).';
    if (reason === 'concurrency') return 'Another clip is still generating. Try again when it finishes.';
    if (body && (body.code === -2 || body.code === -3)) return body.message || 'Prompt rejected by content filter.';
    return (body && body.message) || ('Free Image to Video answered HTTP ' + status);
  }

  async function generate(prompt, duration, onStatus) {
    const r = await call('/api/ai/generate', {
      provider: 'auto',
      mediaType: 'video',
      model: 'minimax-h3',
      scene: 'text-to-video',
      prompt,
      options: { duration, resolution: '480p', aspect_ratio: '16:9', sound: true },
    });
    const id = r.json && r.json.data && r.json.data.id;
    if (r.status >= 400 || !r.json || r.json.code !== 0 || !id) throw new Error(explain(r.status, r.json));
    const t0 = Date.now();
    while (Date.now() - t0 < 30 * 60 * 1000) {
      await new Promise((res) => setTimeout(res, 10000));
      onStatus('Rendering… ' + Math.round((Date.now() - t0) / 1000) + 's');
      let s;
      try { s = await call('/api/ai/query', { taskId: id }); } catch (e) { continue; }
      if (s.status >= 500) continue;
      if (s.status >= 400 || !s.json || s.json.code !== 0) throw new Error(explain(s.status, s.json));
      const d = s.json.data || {};
      if (d.status === 'success' && Array.isArray(d.videos) && d.videos[0]) return d.videos[0];
      if (d.status === 'failed' || d.status === 'canceled') {
        throw new Error('The clip ' + d.status + ' (' + (d.errorMessage || 'unknown error') + ').');
      }
    }
    throw new Error('Still rendering. Check your history on freeimagetovideo.ai.');
  }

  let panel;
  const link = (href, text) => {
    const a = document.createElement('a');
    a.href = href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text;
    a.style.cssText = 'color:#f0b56a;margin-right:12px';
    return a;
  };
  function showPanel(text) {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:320px;padding:12px;' +
      'background:#141210;color:#eee;font:13px/1.45 system-ui,sans-serif;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45)';
    const close = document.createElement('button');
    close.textContent = '×';
    close.style.cssText = 'float:right;background:none;border:0;color:#aaa;font-size:18px;cursor:pointer';
    close.onclick = () => panel.remove();
    const quote = document.createElement('div');
    quote.textContent = '“' + text.slice(0, 160) + (text.length > 160 ? '…' : '') + '”';
    quote.style.cssText = 'color:#bbb;margin:0 0 8px';
    const status = document.createElement('div');
    panel.append(close, quote, status);
    document.body.appendChild(panel);

    if (!apiKey()) {
      status.textContent = 'Add your Free Image to Video API key first. ';
      const set = document.createElement('a');
      set.href = '#'; set.textContent = 'Set API key'; set.style.cssText = 'color:#f0b56a;margin-right:12px';
      set.onclick = (e) => { e.preventDefault(); if (askKey()) showPanel(text); };
      status.append(set, link(KEYS, 'Get a key'));
      return;
    }
    status.textContent = 'Make a clip with sound: ';
    [5, 8].forEach((sec) => {
      const b = document.createElement('button');
      b.textContent = sec + 's clip';
      b.style.cssText = 'margin:6px 6px 0 0;padding:4px 8px;border:1px solid #555;border-radius:6px;background:#221f1b;color:#fff;cursor:pointer';
      b.onclick = () => run(text, sec, status);
      status.appendChild(b);
    });
  }

  function run(text, duration, status) {
    status.textContent = 'Sending to Free Image to Video…';
    generate(text, duration, (s) => { status.textContent = s; })
      .then((url) => {
        status.textContent = '';
        const v = document.createElement('video');
        v.src = url; v.controls = true; v.autoplay = true; v.loop = true; v.playsInline = true;
        v.style.cssText = 'display:block;width:100%;border-radius:6px;margin:6px 0';
        const links = document.createElement('div');
        links.append(link(url, 'Open clip'), link(BASE + '/video/image-to-video-ai-with-sound' + UTM, 'Image to video'));
        status.append(v, links);
      })
      .catch((e) => {
        status.textContent = e.message + ' ';
        status.append(link(BASE + '/' + UTM, 'Open Free Image to Video'));
      });
  }

  function selected() {
    return String(window.getSelection() || '').trim().slice(0, 2000);
  }

  let button;
  document.addEventListener('mouseup', (e) => {
    if (button && e.target === button) return;
    if (button) { button.remove(); button = null; }
    const text = selected();
    if (text.length < 3) return;
    button = document.createElement('button');
    button.textContent = '🎬 Video';
    button.title = 'Turn selected text into an AI video with Free Image to Video';
    button.style.cssText = 'position:fixed;z-index:2147483647;padding:4px 8px;border:0;border-radius:6px;' +
      'background:#141210;color:#fff;font:12px system-ui,sans-serif;cursor:pointer;' +
      'left:' + Math.min(e.clientX + 8, window.innerWidth - 90) + 'px;top:' + Math.max(e.clientY - 34, 4) + 'px';
    button.addEventListener('mousedown', (ev) => ev.preventDefault());
    button.addEventListener('click', () => { const t = selected(); button.remove(); button = null; if (t) showPanel(t); });
    document.body.appendChild(button);
  });

  GM_registerMenuCommand('Make a video from a prompt…', () => {
    const t = prompt('Describe the shot:', selected());
    if (t && t.trim()) showPanel(t.trim());
  });
  GM_registerMenuCommand('Set Free Image to Video API key…', askKey);
})();
