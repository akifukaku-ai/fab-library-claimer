// ==UserScript==
// @name         Fab Free Library Claimer
// @namespace    https://github.com/akifukaku-ai/fab-library-claimer
// @homepageURL  https://github.com/akifukaku-ai/fab-library-claimer
// @downloadURL  https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js
// @updateURL    https://raw.githubusercontent.com/akifukaku-ai/fab-library-claimer/main/fab-library-claimer.user.js
// @version      1.0.0
// @description  Add every free listing of a Fab seller to your library.
// @match        https://www.fab.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const STORE_KEY = 'fab-claimer-state';
  const CONCURRENCY = 4;
  const PAGE_DELAY = 300;
  const DEFAULT_SELLER_URL = 'https://www.fab.com/sellers/Quixel%20Megascans';

  let running = false;
  let ui = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };

  const sellerFromUrl = () => {
    const m = location.pathname.match(/^\/sellers\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  };

  const loadState = (seller) => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (s && s.seller === seller) return s;
    } catch (e) {}
    return { seller, cursor: null, scanned: 0, owned: 0, added: 0, failed: 0, done: false };
  };

  const saveState = (s) => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  };

  async function request(url, opts = {}, tries = 6) {
    for (let i = 0; i < tries; i++) {
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
        await sleep(2000 * (i + 1));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * (i + 1);
        log(`HTTP ${res.status}, retry in ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      return res;
    }
    throw new Error('Too many retries: ' + url);
  }

  async function fetchPage(seller, cursor) {
    const p = new URLSearchParams({ seller, is_free: '1', sort_by: '-firstPublishedAt' });
    if (cursor) p.set('cursor', cursor);
    const res = await request('/i/listings/search?' + p.toString());
    if (!res.ok) throw new Error('Search failed: HTTP ' + res.status);
    const j = await res.json();
    let next = null;
    if (j.next) next = new URL(j.next, location.origin).searchParams.get('cursor');
    else if (j.cursors && j.cursors.next) next = j.cursors.next;
    return { items: j.results || [], next };
  }

  async function fetchOwned(uids) {
    if (!uids.length) return new Set();
    const q = uids.map((u) => 'listing_ids=' + encodeURIComponent(u)).join('&');
    const res = await request('/i/users/me/listings-states?' + q);
    if (res.status === 401 || res.status === 403) throw new Error('Please sign in to Fab first.');
    if (!res.ok) return new Set();
    const j = await res.json();
    const list = Array.isArray(j) ? j : j.results || [];
    return new Set(list.filter((x) => x.acquired).map((x) => x.uid));
  }

  async function addToLibrary(item) {
    const offerId = (item.startingPrice && item.startingPrice.offerId) || item.offerId;
    if (!offerId) return false;
    const body = new FormData();
    body.append('offer_id', offerId);
    const res = await request(`/i/listings/${item.uid}/add-to-library`, { method: 'POST', body });
    return res.ok;
  }

  async function pool(items, worker) {
    let i = 0;
    const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (running && i < items.length) await worker(items[i++]);
    });
    await Promise.all(runners);
  }

  async function run() {
    const seller = sellerFromUrl();
    if (!seller) return log('Open a seller page, e.g. /sellers/Quixel%20Megascans');
    if (running) return;
    running = true;
    render();
    const s = loadState(seller);
    if (s.done) Object.assign(s, { cursor: null, scanned: 0, owned: 0, added: 0, failed: 0, done: false });
    log(`Start: ${seller}`);
    try {
      while (running) {
        const { items, next } = await fetchPage(seller, s.cursor);
        const free = items.filter((x) => !x.startingPrice || x.startingPrice.price === 0);
        const owned = await fetchOwned(free.map((x) => x.uid));
        const todo = free.filter((x) => !owned.has(x.uid));
        s.scanned += items.length;
        s.owned += free.length - todo.length;
        await pool(todo, async (item) => {
          let ok = false;
          try { ok = await addToLibrary(item); } catch (e) {}
          if (ok) s.added++;
          else { s.failed++; log('Failed: ' + item.title); }
          render(s);
        });
        if (!running) break;
        s.cursor = next;
        saveState(s);
        render(s);
        if (!next) { s.done = true; saveState(s); log('Finished.'); break; }
        await sleep(PAGE_DELAY);
      }
    } catch (e) {
      log(e.message);
    }
    running = false;
    render(s);
  }

  function stop() {
    running = false;
    log('Stopping after current batch...');
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

  function render(s) {
    if (!ui) return;
    const seller = sellerFromUrl();
    s = s || loadState(seller);
    ui.stats.textContent = seller
      ? `Scanned ${s.scanned} · Owned ${s.owned} · Added ${s.added} · Failed ${s.failed}${s.done ? ' · Done' : ''}`
      : 'Open a seller page to start, e.g. Quixel Megascans.';
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
        #fab-claimer .log{max-height:140px;overflow:auto;color:#aaa;font-family:ui-monospace,monospace;font-size:11px}
        #fab-claimer.min .log,#fab-claimer.min .row,#fab-claimer.min .stats{display:none}
        #fab-claimer .x{position:absolute;right:10px;top:8px;cursor:pointer;color:#888}
      </style>
      <span class="x">–</span>
      <b>Fab Free Library Claimer</b>
      <div class="stats"></div>
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
      start: box.querySelector('.start'),
      stop: box.querySelector('.stop'),
      reset: box.querySelector('.reset'),
      log: box.querySelector('.log'),
    };
    ui.box = box;
    box.querySelector('.go').onclick = () => { location.href = DEFAULT_SELLER_URL; };
    ui.start.onclick = run;
    ui.stop.onclick = stop;
    ui.reset.onclick = reset;
    box.querySelector('.x').onclick = () => box.classList.toggle('min');
    render();
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (!document.getElementById('fab-claimer')) mount();
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      if (!running) render();
    }
  }, 1000);
  mount();
})();
