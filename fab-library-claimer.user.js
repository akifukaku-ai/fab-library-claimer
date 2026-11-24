// ==UserScript==
// @name         Fab Free Library Claimer
// @namespace    https://github.com/akifukaku-ai/fab-library-claimer
// @homepageURL  https://github.com/akifukaku-ai/fab-library-claimer
// @downloadURL  https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js
// @updateURL    https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js
// @version      1.2.0
// @description  Add every free listing of a Fab seller to your library.
// @match        https://www.fab.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'fab-claimer-state';
  const DEFAULT_SELLER_URL = 'https://www.fab.com/sellers/Quixel%20Megascans';
  // Measured 2026-11-25: Fab allows about 100 adds per minute. Going over answers 429 with a
  // Retry-After of a few seconds; going over again soon after answers Retry-After 600 (10-minute lock).
  // Scanning (search, listings-states) is not limited. So: add at a steady pace just under
  // 100/min and never trip the limit. Each 429 still slows the pace by 10% for the rest of the run.
  const PACE_START_MS = 700; // ~86 adds per minute
  const PACE_MAX_MS = 30000;
  const LONG_LOCK_SEC = 60;

  let running = false;
  let ui = null;
  let cooldownUntil = 0;
  let pace = PACE_START_MS;
  let run = null; // live numbers for the current run

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };

  const sellerFromUrl = () => {
    const m = location.pathname.match(/^\/sellers\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  const freshState = (seller) => ({ seller, cursor: null, scanned: 0, owned: 0, added: 0, failed: 0, done: false });

  const loadState = (seller) => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.seller === seller) return Object.assign(freshState(seller), s);
    } catch (e) {}
    return freshState(seller);
  };

  const saveState = (s) => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  };

  const retryAfter = (res, fallback) => {
    const v = parseInt(res.headers.get('retry-after'), 10);
    return !isNaN(v) && v >= 0 ? v : fallback;
  };

  async function sleepWhileRunning(ms) {
    const end = Date.now() + ms;
    while (running && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
  }

  async function request(url, opts = {}) {
    while (running) {
      let res;
      try {
        res = await fetch(url, {
          credentials: 'include',
          ...opts,
          headers: {
            accept: 'application/json',
            'x-csrftoken': getCookie('fab_csrftoken'),
            'x-requested-with': 'XMLHttpRequest',
            ...(opts.headers || {}),
          },
        });
      } catch (e) {
        log(`Network error: ${e.message}, retry in 5s`);
        await sleepWhileRunning(5000);
        continue;
      }
      if (res.status >= 500) {
        log(`HTTP ${res.status}, retry in 10s`);
        await sleepWhileRunning(10000);
        continue;
      }
      return res;
    }
    throw new Error('Stopped');
  }

  // ---------- scanning: walks every page as fast as Fab answers (not rate-limited) ----------

  async function fetchPage(seller, cursor) {
    const p = new URLSearchParams({ seller, is_free: '1', sort_by: '-firstPublishedAt' });
    if (cursor) p.set('cursor', cursor);
    for (;;) {
      const res = await request('/i/listings/search?' + p.toString());
      if (res.status === 429) { await sleepWhileRunning(retryAfter(res, 10) * 1000 + 500); continue; }
      if (!res.ok) throw new Error('Search failed: HTTP ' + res.status);
      const j = await res.json();
      let next = null;
      if (j.next) next = new URL(j.next, location.origin).searchParams.get('cursor');
      else if (j.cursors && j.cursors.next) next = j.cursors.next;
      return { items: j.results || [], next };
    }
  }

  async function fetchOwned(uids) {
    if (!uids.length) return new Set();
    const q = uids.map((u) => 'listing_ids=' + encodeURIComponent(u)).join('&');
    for (;;) {
      const res = await request('/i/users/me/listings-states?' + q);
      if (res.status === 429) { await sleepWhileRunning(retryAfter(res, 10) * 1000 + 500); continue; }
      if (res.status === 401 || res.status === 403) throw new Error('Please sign in to Fab first.');
      if (!res.ok) return new Set();
      const j = await res.json();
      const list = Array.isArray(j) ? j : j.results || [];
      return new Set(list.filter((x) => x.acquired).map((x) => x.uid));
    }
  }

  async function scanner(seller, startCursor) {
    let cursor = startCursor;
    while (running) {
      const { items, next } = await fetchPage(seller, cursor);
      const free = items.filter((x) => !x.startingPrice || x.startingPrice.price === 0);
      const owned = await fetchOwned(free.map((x) => x.uid));
      const todo = free.filter((x) => !owned.has(x.uid));
      run.pages.push({ scanned: items.length, owned: free.length - todo.length, todo, next });
      run.queued += todo.length;
      run.scanned += items.length;
      run.wake();
      if (!next) break;
      cursor = next;
    }
    run.scanDone = true;
    run.wake();
  }

  // ---------- adding: steady pace, tuned by Fab's own Retry-After ----------

  async function addToLibrary(item, s) {
    const offerId = (item.startingPrice && item.startingPrice.offerId) || item.offerId;
    if (!offerId) return false;
    for (;;) {
      const wait = run.nextAt - Date.now();
      if (wait > 0) await sleepWhileRunning(wait);
      if (!running) throw new Error('Stopped');
      run.nextAt = Date.now() + pace;
      const body = new FormData();
      body.append('offer_id', offerId);
      const res = await request(`/i/listings/${item.uid}/add-to-library`, { method: 'POST', body });
      if (res.status === 401 || res.status === 403) throw new Error('Please sign in to Fab first.');
      if (res.status === 429) {
        const sec = retryAfter(res, 60);
        pace = Math.min(PACE_MAX_MS, Math.round(pace * (sec >= LONG_LOCK_SEC ? 1.25 : 1.1)));
        log(`Fab rate limit: waiting ${fmtDur(sec)}, then ${(60000 / pace).toFixed(0)}/min.`);
        cooldownUntil = Date.now() + sec * 1000 + 1000 + Math.floor(Math.random() * 1000);
        await sleepWhileRunning(cooldownUntil - Date.now());
        cooldownUntil = 0;
        continue;
      }
      if (res.ok) return true;
      return false;
    }
  }

  async function start() {
    const seller = sellerFromUrl();
    if (!seller) return log('Open a seller page, e.g. /sellers/Quixel%20Megascans');
    if (running) return;
    running = true;
    cooldownUntil = 0;
    const s = loadState(seller);
    if (s.done) Object.assign(s, freshState(seller));
    pace = PACE_START_MS;
    let wakeUp = null;
    run = {
      startedAt: Date.now(), addsAtStart: s.added, pages: [], queued: 0, processed: 0, scanned: 0, scanDone: false,
      nextAt: 0,
      wake: () => { if (wakeUp) { wakeUp(); wakeUp = null; } },
    };
    render(s);
    log(`Start: ${seller}`);
    const scan = scanner(seller, s.cursor).catch((e) => { if (running) { log(e.message); running = false; } run.scanDone = true; run.wake(); });
    try {
      while (running) {
        if (!run.pages.length) {
          if (run.scanDone) break;
          await new Promise((r) => { wakeUp = r; setTimeout(r, 1000); });
          continue;
        }
        const page = run.pages[0];
        while (running && page.todo.length) {
          const item = page.todo[0];
          let ok;
          try { ok = await addToLibrary(item, s); } catch (e) { if (!running) break; throw e; }
          page.todo.shift();
          run.processed++;
          if (ok) { s.added++; log('Added: ' + item.title); }
          else { s.failed++; log('Failed: ' + item.title); }
          saveState(s);
          render(s);
        }
        if (!running) break;
        run.pages.shift();
        s.scanned += page.scanned;
        s.owned += page.owned;
        s.cursor = page.next;
        if (!page.next) { s.done = true; log('Finished.'); }
        saveState(s);
        render(s);
      }
    } catch (e) {
      log(e.message);
    }
    running = false;
    cooldownUntil = 0;
    run.wake();
    await scan;
    render(s);
  }

  function stop() {
    running = false;
    cooldownUntil = 0;
    if (run) run.wake();
    log('Stopping...');
    render();
  }

  function reset() {
    if (running) return;
    localStorage.removeItem(STORE_KEY);
    log('Progress cleared.');
    render();
  }

  function log(msg) {
    if (!ui) return;
    const line = document.createElement('div');
    line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    ui.log.prepend(line);
    while (ui.log.childNodes.length > 200) ui.log.lastChild.remove();
  }

  function fmtDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
    return `${sec}s`;
  }

  function progressLine(s) {
    if (!running || !run) return '';
    const left = run.queued - run.processed;
    const elapsed = (Date.now() - run.startedAt) / 1000;
    const done = s.added - run.addsAtStart;
    // Measured speed once there is enough data, the planned pace before that.
    const perMin = done >= 20 && elapsed > 60 ? (done / elapsed) * 60 : 60000 / pace;
    let text = run.scanDone ? `${left} left` : `${left}+ left (scanning, ${run.scanned} checked)`;
    text += ` · ${perMin.toFixed(0)}/min`;
    if (left > 0) text += ` · ETA ${run.scanDone ? '' : '≥ '}${fmtDur((left / perMin) * 60)}`;
    const now = Date.now();
    if (cooldownUntil > now) text += ` · Fab pause ${fmtDur((cooldownUntil - now) / 1000)}`;
    return text;
  }

  function render(s) {
    if (!ui) return;
    const seller = sellerFromUrl();
    s = s || loadState(seller);
    if (!seller) {
      ui.stats.textContent = 'Open a seller page to start, e.g. Quixel Megascans.';
      ui.progress.textContent = '';
    } else {
      let text = `Scanned ${s.scanned} · Owned ${s.owned} · Added ${s.added} · Failed ${s.failed}`;
      if (s.done) text += ' · Done';
      ui.stats.textContent = text;
      ui.progress.textContent = progressLine(s);
    }
    ui.box.classList.toggle('off', !seller);
    ui.start.textContent = s.cursor && !s.done ? 'Resume' : 'Start';
    ui.start.disabled = running || !seller;
    ui.stop.disabled = !running;
    ui.reset.disabled = running;
  }

  function mount() {
    if (document.getElementById('fab-claimer')) return;
    const box = document.createElement('div');
    box.id = 'fab-claimer';
    box.innerHTML = `
      <style>
        #fab-claimer{position:fixed;right:16px;bottom:16px;z-index:99999;width:320px;font:12px/1.5 system-ui,sans-serif;color:#eee;background:#1c1c1f;border:1px solid #333;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.4);padding:12px}
        #fab-claimer b{display:block;font-size:13px;margin-bottom:6px}
        #fab-claimer .row{display:flex;gap:6px;margin:8px 0}
        #fab-claimer button{all:unset;box-sizing:border-box;flex:1 1 0;min-width:0;height:32px;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:8px;background:#2f6feb;color:#fff;cursor:pointer;font:600 12px/1 system-ui,sans-serif}
        #fab-claimer button:hover:not(:disabled){filter:brightness(1.15)}
        #fab-claimer button:disabled{opacity:.4;cursor:default}
        #fab-claimer button.alt{background:#3a3a40}
        #fab-claimer .gorow{display:none}
        #fab-claimer.off .gorow{display:flex}
        #fab-claimer.off .ctl{display:none}
        #fab-claimer .progress{color:#8fb8ff}
        #fab-claimer .progress:empty{display:none}
        #fab-claimer .log{max-height:140px;overflow:auto;color:#aaa;font-family:ui-monospace,monospace;font-size:11px}
        #fab-claimer.min .log,#fab-claimer.min .row,#fab-claimer.min .stats{display:none}
        #fab-claimer .x{position:absolute;right:10px;top:8px;cursor:pointer;color:#888}
      </style>
      <span class="x">–</span>
      <b>Fab Free Library Claimer</b>
      <div class="stats"></div>
      <div class="progress"></div>
      <div class="row ctl">
        <button class="start">Start</button>
        <button class="stop alt">Stop</button>
        <button class="reset alt">Reset</button>
      </div>
      <div class="row gorow">
        <button class="go">Open Quixel Megascans</button>
      </div>
      <div class="log"></div>`;
    document.body.appendChild(box);
    ui = {
      stats: box.querySelector('.stats'),
      progress: box.querySelector('.progress'),
      start: box.querySelector('.start'),
      stop: box.querySelector('.stop'),
      reset: box.querySelector('.reset'),
      log: box.querySelector('.log'),
    };
    ui.box = box;
    box.querySelector('.go').onclick = () => { location.href = DEFAULT_SELLER_URL; };
    ui.start.onclick = start;
    ui.stop.onclick = stop;
    ui.reset.onclick = reset;
    box.querySelector('.x').onclick = () => box.classList.toggle('min');
    render();
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (!document.getElementById('fab-claimer')) mount();
    if (running) render();
    else if (location.pathname !== lastPath) render();
    lastPath = location.pathname;
  }, 1000);
  mount();
})();
