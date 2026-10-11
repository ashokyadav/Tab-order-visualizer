/*! Tab Order Visualizer v1.0.0 | MIT License | Ashok Kumar Yadav */
(() => {
  'use strict';

  const NS = '__tabOrderVisualizer__';
  if (window[NS]) { window[NS].destroy(); return; } // second run toggles off

  // ---------------------------------------------------------------- constants
  const COLORS = { ok: '#2547d0', info: '#2547d0', warn: '#a35200', error: '#c0162c', click: '#7a1fa2' };
  const RANK = { ok: 0, info: 1, warn: 2, error: 3 };
  const SKIP_TAGS = new Set(['script', 'style', 'template', 'noscript', 'head', 'link', 'meta', 'title']);
  const NATIVE_INTERACTIVE = 'a[href],area[href],button,input,select,textarea,summary,label,option,iframe,embed,object,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"])';
  const WIDGET_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'treeitem', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'gridcell']);
  const COMPOSITE_CHILD_ROLES = new Set(['tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem', 'radio', 'gridcell']);
  const COMPOSITE_PARENTS = '[role="tablist"],[role="listbox"],[role="menu"],[role="menubar"],[role="tree"],[role="treegrid"],[role="radiogroup"],[role="grid"],[role="toolbar"]';
  const NON_TEXT_INPUTS = /^(button|submit|reset|checkbox|radio|image|color|file|range)$/;

  const WCAG = {
    POSITIVE_TABINDEX: '2.4.3 Focus Order',
    FOCUS_JUMP: '2.4.3 Focus Order',
    HIDDEN_FOCUSABLE: '2.4.7 Focus Visible',
    CLIPPED_FOCUSABLE: '2.4.11 Focus Not Obscured',
    ARIA_HIDDEN_FOCUSABLE: '4.1.2 Name, Role, Value',
    NO_FOCUS_INDICATOR: '2.4.7 Focus Visible',
    UNREACHABLE_CLICKABLE: '2.1.1 Keyboard',
    FOCUS_REDIRECTED: '2.4.3 Focus Order',
  };

  let hostEl = null;
  let state = null;

  // ---------------------------------------------------------------- DOM helpers
  const parentOf = (n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;

  function closestComposed(el, sel) {
    for (let n = el; n; n = parentOf(n)) if (n.nodeType === 1 && n.matches(sel)) return n;
    return null;
  }

  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }

  function isRendered(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
    if (!el.getClientRects().length) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const clip = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function accName(el) {
    let n = clean(el.getAttribute('aria-label'));
    if (!n && el.hasAttribute('aria-labelledby')) {
      const root = el.getRootNode();
      n = clean(el.getAttribute('aria-labelledby').split(/\s+/).map((id) => {
        const x = root.getElementById ? root.getElementById(id) : document.getElementById(id);
        return x ? x.textContent : '';
      }).join(' '));
    }
    if (!n && el.labels && el.labels.length) n = clean([...el.labels].map((l) => l.textContent).join(' '));
    if (!n && el.localName === 'input' && /^(submit|button|reset)$/.test(el.type)) n = clean(el.value);
    if (!n && el.localName !== 'select') n = clean(el.innerText || el.textContent);
    if (!n) n = clean(el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder'));
    if (!n && el.querySelector) { const img = el.querySelector('img[alt]'); if (img) n = clean(img.alt); }
    return clip(n);
  }

  function describe(el) {
    let s = el.localName;
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    if (el.localName === 'input') s += `[type=${el.type}]`;
    const root = el.getRootNode();
    if (root instanceof ShadowRoot) s = `${root.host.localName} ▸ ${s}`;
    return clip(s, 48);
  }

  // A short CSS selector that finds the element, for reports. Stops at the nearest id.
  function cssPath(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n.localName !== 'html' && n.localName !== 'body') {
      if (n.id) { parts.unshift(`#${CSS.escape(n.id)}`); break; }
      let seg = n.localName;
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sibs.length > 1) seg += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(seg);
      if (!n.parentElement) break;
      n = n.parentElement;
    }
    const root = el.getRootNode();
    const path = parts.join(' > ');
    return root instanceof ShadowRoot ? `${cssPath(root.host)} ▸ ${path}` : path;
  }

  // ---------------------------------------------------------------- focusability
  function focusInfo(el) {
    const tag = el.localName;
    const rawTi = el.getAttribute('tabindex');
    const tiAttr = rawTi === null ? NaN : parseInt(rawTi, 10);
    const hasTi = !Number.isNaN(tiAttr);
    let native = false;
    switch (tag) {
      case 'a': case 'area': native = el.hasAttribute('href') || el.hasAttribute('xlink:href'); break;
      case 'input': native = el.type !== 'hidden'; break;
      case 'button': case 'select': case 'textarea': case 'iframe': case 'embed': case 'object': native = true; break;
      case 'summary': native = !!el.parentElement && el.parentElement.localName === 'details' &&
        el.parentElement.querySelector(':scope > summary') === el; break;
      case 'audio': case 'video': native = el.hasAttribute('controls'); break;
    }
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) native = true;
    if (!native && !hasTi) return null;
    if (tag === 'input' && el.type === 'hidden') return null;
    if (el.matches(':disabled')) return null;
    if (closestComposed(el, '[inert]')) return null;
    if (!isRendered(el)) return null;
    const ti = hasTi ? tiAttr : 0;
    return { tabbable: ti >= 0, tabIndex: ti };
  }

  // ---------------------------------------------------------------- tab order
  function collectTabOrder() {
    const radioGroups = new Map();

    function radioIsStop(el) {
      if (!el.name) return true;
      const scope = el.form || el.getRootNode();
      let groups = radioGroups.get(scope);
      if (!groups) radioGroups.set(scope, (groups = new Map()));
      if (!groups.has(el.name)) {
        const all = [...scope.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)]
          .filter((r) => r.form === el.form && !r.disabled);
        groups.set(el.name, all.find((r) => r.checked) || el);
      }
      return groups.get(el.name) === el;
    }

    // Each document / shadow root is its own focus-navigation scope:
    // positive tabindex sorts first within the scope, then DOM order.
    function buildScope(roots) {
      const entries = [];
      const visit = (el) => {
        if (el === hostEl || SKIP_TAGS.has(el.localName)) return;
        const info = focusInfo(el);
        let stop = !!(info && info.tabbable);
        if (stop && el.localName === 'input' && el.type === 'radio') stop = radioIsStop(el);
        if (el.shadowRoot) {
          if (info && !info.tabbable) return; // tabindex="-1" host removes its shadow tree from Tab
          entries.push({ el, stop, ti: info ? info.tabIndex : 0, sub: buildScope([...el.shadowRoot.children]) });
          return;
        }
        if (stop) entries.push({ el, stop: true, ti: info.tabIndex });
        let kids = [...el.children];
        if (el.localName === 'slot') {
          const assigned = el.assignedElements({ flatten: true });
          if (assigned.length) kids = assigned;
        }
        kids.forEach(visit);
      };
      roots.forEach(visit);

      const positive = entries.filter((e) => e.ti > 0).sort((a, b) => a.ti - b.ti);
      const rest = entries.filter((e) => !(e.ti > 0));
      const out = [];
      for (const e of positive.concat(rest)) {
        if (e.stop) out.push({ el: e.el, ti: e.ti });
        if (e.sub) out.push(...e.sub);
      }
      return out;
    }

    return buildScope([document.documentElement]);
  }

  // ---------------------------------------------------------------- visibility & focus checks
  function hiddenReasons(el) {
    const out = [];
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4) out.push({ sev: 'error', text: 'has no visible size (0–1px)' });
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true })) {
      out.push({ sev: 'error', text: 'is transparent (opacity: 0)' });
    }
    const de = document.documentElement;
    const W = Math.max(de.scrollWidth, innerWidth);
    const H = Math.max(de.scrollHeight, innerHeight);
    const fixedish = r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight;
    const docOff = r.right + scrollX <= 0 || r.bottom + scrollY <= 0 || r.left + scrollX >= W || r.top + scrollY >= H;
    if (docOff || (fixedish && isInFixedLayer(el))) {
      out.push({ sev: 'error', text: 'is positioned off-screen' });
    }
    if (out.length) return out;
    const cs = getComputedStyle(el);
    if (/inset\(\s*50%/.test(cs.clipPath) || /rect\(\s*0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\s*\)/.test(cs.clip)) {
      out.push({ sev: 'error', text: 'is clipped away (clip / clip-path)' });
      return out;
    }
    // Clipped out of view by an overflow:hidden ancestor (carousels, collapsed drawers)
    for (let n = parentOf(el), depth = 0; n && n !== document.body && depth < 25; n = parentOf(n), depth++) {
      if (n.nodeType !== 1) continue;
      const ns = getComputedStyle(n);
      if (/(hidden|clip)/.test(ns.overflowX + ns.overflowY)) {
        const a = n.getBoundingClientRect();
        if (r.right <= a.left + 1 || r.left >= a.right - 1 || r.bottom <= a.top + 1 || r.top >= a.bottom - 1) {
          out.push({ sev: 'warn', code: 'CLIPPED_FOCUSABLE', text: `is clipped outside an overflow:hidden container (${describe(n)})` });
          break;
        }
      }
    }
    return out;
  }

  function isInFixedLayer(el) {
    for (let n = el; n && n.nodeType === 1; n = parentOf(n)) {
      if (getComputedStyle(n).position === 'fixed') return true;
    }
    return false;
  }

  // Only properties that can actually paint something count, so an unpainted
  // outline whose offset changes (Chrome's UA link style does this) is ignored.
  function paintSig(cs) {
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      ? `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} ${cs.outlineOffset}` : 'none';
    const borders = ['Top', 'Right', 'Bottom', 'Left'].map((side) =>
      cs[`border${side}Style`] !== 'none' && parseFloat(cs[`border${side}Width`]) > 0
        ? `${cs[`border${side}Width`]} ${cs[`border${side}Color`]}` : '0').join(',');
    const deco = cs.textDecorationLine === 'none' ? 'none'
      : `${cs.textDecorationLine} ${cs.textDecorationColor} ${cs.textDecorationThickness} ${cs.textDecorationStyle}`;
    return [outline, borders, deco, cs.boxShadow, cs.backgroundColor, cs.backgroundImage, cs.color,
      cs.transform, cs.opacity, cs.filter, cs.textShadow].join('|');
  }

  function styleSnap(el) {
    const parts = [paintSig(getComputedStyle(el))];
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      parts.push(ps.content === 'none' || ps.content === 'normal' ? '-' : paintSig(ps) + ps.content);
    }
    const p = parentOf(el);
    if (p && p.nodeType === 1) parts.push(paintSig(getComputedStyle(p))); // :focus-within styles
    return parts.join('§');
  }

  function scrollSnapshot(el) {
    const out = [];
    for (let n = parentOf(el); n && n.nodeType === 1 && n !== document.documentElement; n = parentOf(n)) {
      out.push([n, n.scrollLeft, n.scrollTop]);
    }
    return out;
  }

  function restoreScroll(snap) {
    for (const [n, l, t] of snap) if (n.scrollLeft !== l || n.scrollTop !== t) { n.scrollLeft = l; n.scrollTop = t; }
  }

  function countTransitions(el) {
    if (!el.getAnimations) return 0;
    const isT = (a) => typeof CSSTransition !== 'undefined' && a instanceof CSSTransition;
    let n = el.getAnimations({ subtree: true }).filter(isT).length;
    const p = parentOf(el);
    if (p && p.getAnimations) n += p.getAnimations().filter(isT).length;
    return n;
  }

  function pageMayUseFocusVisible() {
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) if (rule.cssText.includes('focus-visible')) return true; }
      catch (e) { return true; } // cross-origin sheet: can't tell, assume it might
    }
    return false;
  }

  // ---------------------------------------------------------------- scan
  // The scan focuses every element to test it. Pages react to focus events (search panels open,
  // focus traps pull focus back), so the scan hides its focus events from the page. Playback (P)
  // doesn't do this, because there you want to see what the page really does.
  const FOCUS_EVENTS = ['focus', 'blur', 'focusin', 'focusout'];
  const silence = (e) => e.stopImmediatePropagation();

  function scan() {
    FOCUS_EVENTS.forEach((t) => window.addEventListener(t, silence, true));
    try { return scanInner(); }
    finally { FOCUS_EVENTS.forEach((t) => window.removeEventListener(t, silence, true)); }
  }

  function scanInner() {
    const saved = { x: scrollX, y: scrollY, active: deepActive() };
    const list = collectTabOrder();
    let keyboardModality = false;

    const items = list.map(({ el, ti }, idx) => {
      const item = { n: idx + 1, el, ti, issues: [], name: accName(el), desc: describe(el) };
      const hiddenBefore = hiddenReasons(el);
      const before = styleSnap(el);
      const tBefore = countTransitions(el);
      const scrolls = scrollSnapshot(el);
      try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      const focused = deepActive() === el;
      const after = styleSnap(el);
      const changed = before !== after || countTransitions(el) > tBefore;
      const hiddenNow = focused ? hiddenReasons(el) : hiddenBefore;
      const textEntry = el.isContentEditable || el.localName === 'textarea' ||
        (el.localName === 'input' && !NON_TEXT_INPUTS.test(el.type));
      if (focused && !textEntry && el.matches(':focus-visible')) keyboardModality = true;
      const r = el.getBoundingClientRect();
      item.docRect = { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY };
      item.revealedOnFocus = hiddenBefore.length > 0 && hiddenNow.length === 0;
      item.hidden = hiddenNow.filter((h) => h.sev === 'error').length > 0;
      item.focused = focused;
      item.indicatorChanged = changed;
      item.hiddenNow = hiddenNow;
      if (focused) { try { el.blur(); } catch (e) { /* ignore */ } }
      restoreScroll(scrolls);
      return item;
    });

    // restore page state
    if (saved.active && saved.active !== document.body && saved.active.isConnected) {
      try { saved.active.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    } else {
      const a = deepActive(); if (a && a.blur) a.blur();
    }
    window.scrollTo(saved.x, saved.y);

    const fvUnverified = !keyboardModality && pageMayUseFocusVisible();
    const add = (item, sev, code, text) => item.issues.push({ sev, code, text, wcag: WCAG[code] });
    const vh = innerHeight;

    let prev = null;
    for (const it of items) {
      if (it.ti > 0) add(it, 'warn', 'POSITIVE_TABINDEX', `tabindex="${it.ti}" overrides the natural order`);
      for (const h of it.hiddenNow) add(it, h.sev, h.code || 'HIDDEN_FOCUSABLE', `Focusable but ${h.text}`);
      if (closestComposed(it.el, '[aria-hidden="true"]')) {
        add(it, 'error', 'ARIA_HIDDEN_FOCUSABLE', 'Focusable inside aria-hidden="true" (screen readers lose it)');
      }
      if (!it.focused) {
        add(it, 'info', 'FOCUS_REDIRECTED', 'Calling focus() did not land here; the page moved focus elsewhere');
      } else if (!it.hidden && !it.indicatorChanged) {
        if (fvUnverified) add(it, 'info', 'NO_FOCUS_INDICATOR', 'No visible change on programmatic focus. Press R to re-check in keyboard mode');
        else add(it, 'warn', 'NO_FOCUS_INDICATOR', 'No visible focus indicator (nothing changes when focused)');
      }
      // Path direction (only between stops a sighted user can see)
      if (!it.hidden) {
        if (prev) {
          const a = prev.docRect, b = it.docRect;
          const up = a.top - b.bottom;
          const sameRow = b.top < a.bottom && b.bottom > a.top;
          const rtl = getComputedStyle(it.el).direction === 'rtl';
          if (up > vh) add(it, 'error', 'FOCUS_JUMP', `Focus jumps backwards ${Math.round(up)}px up the page from #${prev.n}`);
          else if (up > vh * 0.5) add(it, 'warn', 'FOCUS_JUMP', `Focus moves back up ${Math.round(up)}px from #${prev.n}`);
          else if (sameRow && !rtl && b.right < a.left - 40) add(it, 'warn', 'FOCUS_JUMP', `Focus moves right-to-left within a row (from #${prev.n})`);
        }
        prev = it;
      }
      it.sev = it.issues.reduce((m, i) => (RANK[i.sev] > RANK[m] ? i.sev : m), 'ok');
    }

    const clickables = findUnreachableClickables(new Set(items.map((i) => i.el)));
    return { items, clickables, fvUnverified, keyboardModality, url: location.href, title: document.title, at: new Date() };
  }

  function findUnreachableClickables(tabbable) {
    const containsTabbable = new Set();
    tabbable.forEach((el) => {
      for (let n = parentOf(el); n && !containsTabbable.has(n); n = parentOf(n)) containsTabbable.add(n);
    });
    const flagged = new Set();
    const out = [];

    const check = (el) => {
      if (el === hostEl || el === document.body || el === document.documentElement) return;
      if (tabbable.has(el) || containsTabbable.has(el) || SKIP_TAGS.has(el.localName)) return;
      if (el.matches(NATIVE_INTERACTIVE)) return;
      const role = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
      const hasHandler = typeof el.onclick === 'function' || el.hasAttribute('onclick');
      const hasRole = WIDGET_ROLES.has(role);
      const cs = getComputedStyle(el);
      const p = parentOf(el);
      const pointer = cs.cursor === 'pointer' && !(p && p.nodeType === 1 && getComputedStyle(p).cursor === 'pointer');
      if (!hasHandler && !hasRole && !pointer) return;
      for (let n = p; n && n.nodeType === 1; n = parentOf(n)) {
        if (tabbable.has(n) || flagged.has(n) || n.matches(NATIVE_INTERACTIVE)) return;
      }
      if (!isRendered(el) || (el.checkVisibility && !el.checkVisibility({ opacityProperty: true }))) return;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 16) return;
      if (COMPOSITE_CHILD_ROLES.has(role)) {
        const c = closestComposed(el, COMPOSITE_PARENTS);
        if (c && (containsTabbable.has(c) || tabbable.has(c) || c.hasAttribute('aria-activedescendant'))) return; // roving tabindex
      }
      const why = [hasHandler && 'onclick handler', hasRole && `role="${role}"`, pointer && 'cursor: pointer'].filter(Boolean).join(', ');
      flagged.add(el);
      out.push({
        el, desc: describe(el), name: accName(el), sev: hasHandler || hasRole ? 'error' : 'warn',
        text: `Looks clickable (${why}) but can't be reached with Tab`, code: 'UNREACHABLE_CLICKABLE', wcag: WCAG.UNREACHABLE_CLICKABLE,
      });
    };

    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        check(el);
        if (el.shadowRoot && el !== hostEl) walk(el.shadowRoot);
      }
    };
    walk(document);
    return out;
  }

  // ---------------------------------------------------------------- overlay
  const CSS_TEXT = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    svg.lines, .layer { position: fixed; inset: 0; pointer-events: none; overflow: visible; }
    svg.lines { width: 100vw; height: 100vh; }
    .box { position: fixed; border: 2px solid var(--c); border-radius: 3px; background: color-mix(in srgb, var(--c) 7%, transparent); }
    .box.dashed { border-style: dashed; }
    .box.now { border-width: 3px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 30%, transparent); }
    .badge { position: fixed; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 11px; background: var(--c);
      color: #fff; font: 700 11px/22px ui-rounded, "SF Pro Rounded", system-ui, sans-serif; text-align: center;
      box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0,0,0,.45); pointer-events: auto; cursor: help; white-space: nowrap; }
    .badge.sq { border-radius: 4px; }
    .badge.now { transform: scale(1.45); z-index: 2; }
    .ring { position: fixed; border: 3px solid #e2008a; border-radius: 6px; animation: ping .9s ease-out 3; }
    @keyframes ping { from { box-shadow: 0 0 0 0 rgba(226,0,138,.65); } to { box-shadow: 0 0 0 16px rgba(226,0,138,0); } }
    .caption { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: min(720px, 92vw);
      background: #fff; color: #18203a; border: 2px solid var(--c); border-radius: 999px; padding: 8px 18px;
      font: 600 15px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25); text-align: center; }
    .caption b { color: var(--c); }

    .panel { position: fixed; top: 12px; right: 12px; width: 384px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      display: flex; flex-direction: column; pointer-events: auto; background: #fbfbfd; color: #18203a;
      border: 1px solid #c9cedd; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,64,.28);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; overflow: hidden; }
    .panel.left { right: auto; left: 12px; }
    header { display: flex; align-items: center; gap: 6px; padding: 10px 10px 10px 14px; background: #2547d0; color: #fff; }
    header h2 { margin: 0; font-size: 14px; font-weight: 700; flex: 1; }
    .body { padding: 12px 14px 14px; overflow: auto; }
    .panel.min .body { display: none; }
    .stats { margin: 0 0 10px; font-size: 13px; }
    .stats strong { font-size: 20px; margin-right: 2px; }
    .row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-bottom: 10px; }
    button, select { font: inherit; color: inherit; }
    .row button { background: #fff; border: 1px solid #8e97b3; border-radius: 7px; padding: 5px 10px; cursor: pointer; }
    .row button:hover { background: #eef1fb; }
    .row button.primary { background: #2547d0; border-color: #2547d0; color: #fff; }
    header button { background: transparent; border: 1px solid rgba(255,255,255,.55); color: #fff; border-radius: 6px;
      width: 28px; height: 28px; cursor: pointer; font-size: 14px; line-height: 1; }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 3px solid #e2008a; outline-offset: 2px; }
    kbd { font: 600 10px/1 system-ui, sans-serif; border: 1px solid currentColor; border-radius: 3px; padding: 1px 4px; margin-left: 4px; opacity: .8; }
    label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
    select { border: 1px solid #8e97b3; border-radius: 6px; padding: 2px 4px; background: #fff; }
    .note { background: #eef1fb; border-left: 3px solid #2547d0; padding: 8px 10px; margin: 0 0 10px; border-radius: 4px; }
    .status { min-height: 1.2em; margin: 0 0 6px; color: #3d4766; font-size: 12px; }
    h3 { font-size: 12px; margin: 12px 0 6px; color: #3d4766; }
    ul { list-style: none; margin: 0; padding: 0; }
    li + li { border-top: 1px solid #e3e6ef; }
    li button { all: unset; display: grid; grid-template-columns: 34px 1fr; gap: 8px; width: 100%; padding: 7px 4px; cursor: pointer; border-radius: 6px; }
    li button:hover { background: #eef1fb; }
    li button:focus-visible { outline: 3px solid #e2008a; outline-offset: -1px; }
    .num { justify-self: start; align-self: start; min-width: 26px; text-align: center; color: #fff; border-radius: 10px; font-weight: 700; font-size: 11px; padding: 2px 5px; }
    .what { display: block; font-weight: 600; }
    .where { display: block; color: #4a5370; font-size: 12px; word-break: break-word; }
    .wcag { color: #4a5370; font-size: 11px; }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 12px 0 0; font-size: 12px; color: #3d4766; }
    .legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); margin-right: 5px; vertical-align: -1px; }
    .empty { color: #3d4766; padding: 6px 0; }
    .credit { margin: 10px 0 0; font-size: 12px; color: #3d4766; }
    .credit a { color: #2547d0; }
    .credit a:focus-visible { outline: 3px solid #e2008a; outline-offset: 2px; }
    @media (prefers-reduced-motion: reduce) { .ring { animation: none; } .badge.now { transform: none; } }
  `;

  function mount() {
    hostEl = document.createElement('tab-order-visualizer');
    hostEl.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;');
    const root = hostEl.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS_TEXT}</style>
      <svg class="lines" aria-hidden="true"></svg>
      <div class="layer"></div>
      <section class="panel" role="region" aria-label="Tab Order Visualizer">
        <header>
          <h2>Tab Order Visualizer</h2>
          <button data-act="side" title="Move panel to the other side" aria-label="Move panel to the other side">⇄</button>
          <button data-act="min" title="Collapse panel" aria-label="Collapse panel" aria-expanded="true">–</button>
          <button data-act="close" title="Close (Esc)" aria-label="Close visualizer">✕</button>
        </header>
        <div class="body">
          <p class="stats"></p>
          <div class="row">
            <button class="primary" data-act="play" title="P, or Alt+Shift+P while typing">▶ Play path<kbd>P</kbd></button>
            <button data-act="rescan" title="R, or Alt+Shift+R while typing">Re-scan<kbd>R</kbd></button>
          </div>
          <div class="row">
            <label for="tov-format">Report</label>
            <select id="tov-format" data-opt="format" title="HTML to read or print, CSV for Excel or Jira, Markdown for GitHub">
              <option value="html" selected>HTML</option><option value="csv">CSV</option><option value="md">Markdown</option>
            </select>
            <button data-act="download" title="D">Download<kbd>D</kbd></button>
            <button data-act="copy">Copy</button>
          </div>
          <div class="row">
            <label><input type="checkbox" data-opt="numbers" checked> Numbers</label>
            <label><input type="checkbox" data-opt="path" checked> Path</label>
            <label><input type="checkbox" data-opt="issuesOnly"> Issues only</label>
            <label>Speed <select data-opt="speed">
              <option value="1000">Slow</option><option value="550" selected>Normal</option><option value="250">Fast</option>
            </select></label>
          </div>
          <p class="note" hidden></p>
          <p class="status" role="status" aria-live="polite"></p>
          <div class="list"></div>
          <p class="legend">
            <span style="--c:${COLORS.ok}">Tab stop</span><span style="--c:${COLORS.warn}">Warning</span>
            <span style="--c:${COLORS.error}">Error</span><span style="--c:${COLORS.click}">Not reachable</span>
          </p>
          <p class="credit">Made by <a href="https://www.linkedin.com/in/ashokkumaryadav" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Ashok Kumar Yadav</a></p>
        </div>
      </section>`;
    document.documentElement.appendChild(hostEl);
    return root;
  }

  function posRect(it) {
    if (it.hidden) return null;
    if (it.revealedOnFocus) {
      const d = it.docRect;
      return { left: d.left - scrollX, top: d.top - scrollY, right: d.right - scrollX, bottom: d.bottom - scrollY };
    }
    return it.el.isConnected ? it.el.getBoundingClientRect() : null;
  }

  function tooltip(n, it) {
    const lines = [`${n} · ${it.desc}${it.name ? ` “${it.name}”` : ''}`];
    if (it.ti > 0) lines.push(`tabindex=${it.ti}`);
    for (const i of it.issues) lines.push(`• ${i.text} [${i.wcag}]`);
    if (it.revealedOnFocus) lines.push('• Hidden until focused (skip-link pattern) ✓');
    return esc(lines.join('\n'));
  }

  function render() {
    state.raf = 0;
    const { items, clickables } = state.data;
    const vw = innerWidth, vh = innerHeight;
    const near = (r, m = 80) => r && r.bottom > -m && r.top < vh + m && r.right > -m && r.left < vw + m;
    const limit = state.playing ? state.playIndex : items.length;
    const nowIdx = state.playing ? state.playIndex - 1 : -1;
    const rects = items.map(posRect);
    let svg = `<defs>${['ok', 'warn', 'error'].map((k) => `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${COLORS[k]}"/></marker>`).join('')}</defs>`;
    let html = '';

    if (state.opts.path) {
      let prev = null, gap = false;
      for (let i = 0; i < limit; i++) {
        const r = rects[i];
        if (!r) { gap = true; continue; }
        const p = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
        if (prev) {
          const jump = items[i].issues.find((x) => x.code === 'FOCUS_JUMP');
          const k = jump ? jump.sev : 'ok';
          const offscreen = (prev.y < -vh && p.y < -vh) || (prev.y > 2 * vh && p.y > 2 * vh);
          if (!offscreen) {
            const dx = p.x - prev.x, dy = p.y - prev.y;
            const bend = jump ? 0.35 : 0.12;
            const cx = (prev.x + p.x) / 2 - dy * bend, cy = (prev.y + p.y) / 2 + dx * bend;
            svg += `<path d="M${prev.x.toFixed(1)},${prev.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}"
              fill="none" stroke="${COLORS[k]}" stroke-width="${jump ? 3 : 2}" stroke-opacity="${jump ? 0.95 : 0.7}"
              ${gap ? 'stroke-dasharray="7 6"' : ''} marker-end="url(#ah-${k})"/>`;
          }
        }
        prev = p; gap = false;
      }
    }

    for (let i = 0; i < limit; i++) {
      const it = items[i], r = rects[i];
      if (!near(r)) continue;
      if (state.opts.issuesOnly && it.sev === 'ok' && i !== nowIdx) continue;
      const c = COLORS[it.sev];
      const now = i === nowIdx ? ' now' : '';
      html += `<div class="box${now}" style="--c:${c};left:${r.left - 2}px;top:${r.top - 2}px;width:${r.right - r.left + 4}px;height:${r.bottom - r.top + 4}px"></div>`;
      if (state.opts.numbers) {
        const bx = Math.max(2, Math.min(vw - 30, r.left - 11)), by = Math.max(2, Math.min(vh - 24, r.top - 11));
        html += `<div class="badge${now}" style="--c:${c};left:${bx}px;top:${by}px" title="${tooltip('#' + it.n, it)}">${it.n}</div>`;
      }
    }

    if (!state.playing) {
      for (const c of clickables) {
        const r = c.el.isConnected ? c.el.getBoundingClientRect() : null;
        if (!near(r)) continue;
        html += `<div class="box dashed" style="--c:${COLORS.click};left:${r.left - 2}px;top:${r.top - 2}px;width:${r.right - r.left + 4}px;height:${r.bottom - r.top + 4}px"></div>`;
        html += `<div class="badge sq" style="--c:${COLORS.click};left:${Math.max(2, r.left - 11)}px;top:${Math.max(2, r.top - 11)}px"
          title="${esc(`${c.desc}${c.name ? ` “${c.name}”` : ''}\n• ${c.text} [${c.wcag}]`)}">✕</div>`;
      }
    }

    if (state.flash && Date.now() < state.flash.until) {
      const r = state.flash.el.getBoundingClientRect();
      html += `<div class="ring" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>`;
    }

    if (state.playing && nowIdx >= 0) {
      const it = items[nowIdx];
      const worst = it.issues.slice().sort((a, b) => RANK[b.sev] - RANK[a.sev])[0];
      const msg = worst ? ` · ${esc(worst.text)}` : '';
      html += `<div class="caption" style="--c:${COLORS[it.sev]}"><b>${it.n} / ${items.length}</b> · ${esc(it.desc)}${it.name ? ` “${esc(it.name)}”` : ''}${msg}</div>`;
    }

    state.svg.innerHTML = svg;
    state.layer.innerHTML = html;
  }

  const schedule = () => { if (state && !state.raf) state.raf = requestAnimationFrame(render); };

  // ---------------------------------------------------------------- panel
  function updatePanel() {
    const { items, clickables, fvUnverified } = state.data;
    const all = [];
    for (const it of items) for (const i of it.issues) all.push({ ...i, n: it.n, el: it.el, desc: it.desc, name: it.name });
    for (const c of clickables) all.push({ ...c, n: null });
    all.sort((a, b) => RANK[b.sev] - RANK[a.sev] || (a.n || 1e9) - (b.n || 1e9));
    const errors = all.filter((i) => i.sev === 'error').length;
    const warns = all.filter((i) => i.sev === 'warn').length;
    state.all = all;

    state.root.querySelector('.stats').innerHTML =
      `<strong>${items.length}</strong> tab stops &nbsp; <strong style="color:${COLORS.error}">${errors}</strong> errors &nbsp; ` +
      `<strong style="color:${COLORS.warn}">${warns}</strong> warnings`;

    const note = state.root.querySelector('.note');
    note.hidden = !fvUnverified;
    note.textContent = fvUnverified
      ? 'This page uses :focus-visible, which only shows after keyboard use. Press R on your keyboard to re-scan so focus outlines are checked accurately.'
      : '';

    const label = { error: 'Error', warn: 'Warning', info: 'Check' };
    const list = state.root.querySelector('.list');
    if (!all.length) {
      list.innerHTML = '<p class="empty">No issues found by the automated checks. Now press P and watch the path: does the order match the reading order?</p>';
      return;
    }
    list.innerHTML = `<h3>${all.length} findings</h3><ul>${all.map((f, idx) => `
      <li><button data-jump="${idx}">
        <span class="num" style="background:${f.code === 'UNREACHABLE_CLICKABLE' ? COLORS.click : COLORS[f.sev]}">${f.n || '✕'}</span>
        <span><span class="what">${label[f.sev]}: ${esc(f.text)}</span>
        <span class="where">${esc(f.desc)}${f.name ? ` “${esc(f.name)}”` : ''}</span>
        <span class="wcag">WCAG ${esc(f.wcag)}</span></span>
      </button></li>`).join('')}</ul>`;
  }

  function setStatus(msg) { state.root.querySelector('.status').textContent = msg; }

  function jumpTo(el) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    state.flash = { el, until: Date.now() + 2800 };
    const tick = () => { schedule(); if (state && state.flash && Date.now() < state.flash.until) setTimeout(tick, 120); };
    tick();
  }

  // ---------------------------------------------------------------- play
  function setPlayLabel() {
    state.root.querySelector('[data-act="play"]').innerHTML = state.playing ? '■ Stop<kbd>P</kbd>' : '▶ Play path<kbd>P</kbd>';
  }

  function setCollapsed(min) {
    state.panel.classList.toggle('min', min);
    const b = state.root.querySelector('[data-act="min"]');
    b.setAttribute('aria-expanded', String(!min));
    b.textContent = min ? '+' : '–';
  }

  function startPlay() {
    state.wasCollapsed = state.panel.classList.contains('min');
    setCollapsed(true); // keep the page visible while the path plays
    state.playing = true;
    state.playIndex = 0;
    setPlayLabel();
    step();
  }

  function step() {
    if (!state || !state.playing) return;
    const { items } = state.data;
    if (state.playIndex >= items.length) { stopPlay(); setStatus('Finished playing the tab path.'); return; }
    const it = items[state.playIndex++];
    try { it.el.focus(); } catch (e) { /* ignore */ }
    schedule();
    state.timer = setTimeout(step, state.opts.speed);
  }

  function stopPlay() {
    if (!state) return;
    clearTimeout(state.timer);
    if (state.playing && !state.wasCollapsed) setCollapsed(false);
    state.playing = false;
    setPlayLabel();
    schedule();
  }

  // ---------------------------------------------------------------- report
  function report() {
    const { items, title, url, at } = state.data;
    const cell = (s) => String(s || '').replace(/\|/g, '\\|');
    const errors = state.all.filter((i) => i.sev === 'error').length;
    const warns = state.all.filter((i) => i.sev === 'warn').length;
    const L = [
      `# Tab order report: ${cell(title) || url}`, '',
      `- URL: ${url}`, `- Scanned: ${at.toISOString()}`,
      `- ${items.length} tab stops, ${errors} errors, ${warns} warnings`,
      `- Tool: Tab Order Visualizer (automated checks; confirm each finding with a keyboard)`,
      `- This report does not certify conformance with WCAG, the ADA or any other standard or law, and is not legal advice.`, '',
      '## Findings', '',
      '| Stop | Severity | Finding | WCAG | Element | Name |', '|---|---|---|---|---|---|',
      ...state.all.map((f) => `| ${f.n || '—'} | ${f.sev} | ${cell(f.text)} | ${cell(f.wcag)} | \`${cell(cssPath(f.el))}\` | ${cell(f.name)} |`),
      '', '## Tab order', '', '| Stop | Element | Name | tabindex |', '|---|---|---|---|',
      ...items.map((it) => `| ${it.n} | \`${cell(cssPath(it.el))}\` | ${cell(it.name)} | ${it.ti} |`),
    ];
    return L.join('\n');
  }

  function reportFileName(ext) {
    const host = (location.hostname || 'local-file').replace(/[^a-z0-9.-]/gi, '-');
    const d = state.data.at;
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `tab-order-report-${host}-${stamp}.${ext}`;
  }

  function csvReport() {
    const { items, url } = state.data;
    const q = (v) => {
      const t = String(v == null ? '' : v);
      return /[",\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${(/^[=+\-@]/.test(t) ? "'" : '') + t.replace(/"/g, '""')}"` : t;
    };
    const rows = [['Stop', 'Severity', 'Finding', 'WCAG', 'Element', 'CSS selector', 'Accessible name', 'tabindex', 'Page URL']];
    for (const f of state.all) {
      const it = f.n ? items[f.n - 1] : null;
      rows.push([f.n || '', f.sev, f.text, f.wcag, f.desc, cssPath(f.el), f.name, it ? it.ti : '', url]);
    }
    return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n'); // BOM so Excel reads UTF-8
  }

  function htmlReport() {
    const { items, clickables, title, url, at } = state.data;
    const errors = state.all.filter((i) => i.sev === 'error').length;
    const warns = state.all.filter((i) => i.sev === 'warn').length;
    const checks = state.all.filter((i) => i.sev === 'info').length;
    const sevLabel = { error: 'Error', warn: 'Warning', info: 'Check' };
    const findings = state.all.length ? state.all.map((f) => `<tr class="${f.sev}">
        <td>${f.n || '—'}</td><td><span class="sev">${sevLabel[f.sev]}</span></td><td>${esc(f.text)}</td>
        <td>${esc(f.wcag)}</td><td><code>${esc(cssPath(f.el))}</code></td><td>${esc(f.name)}</td></tr>`).join('')
      : '<tr><td colspan="6">No issues found by the automated checks.</td></tr>';
    const order = items.map((it) => `<tr><td>${it.n}</td><td><code>${esc(cssPath(it.el))}</code></td><td>${esc(it.name)}</td>
        <td>${it.ti}</td><td>${it.sev === 'ok' ? '' : `<span class="dot ${it.sev}"></span>${it.issues.length}`}</td></tr>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tab order report: ${esc(title || url)}</title>
<style>
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #18203a; margin: 0; background: #f5f6fa; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 48px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 36px 0 10px; }
  .meta { color: #4a5370; margin: 0 0 20px; word-break: break-all; }
  .meta a { color: #2547d0; }
  .summary { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 0; list-style: none; }
  .summary li { background: #fff; border: 1px solid #d6dae6; border-radius: 10px; padding: 12px 18px; min-width: 130px; }
  .summary b { display: block; font-size: 28px; line-height: 1.1; }
  .summary .e b { color: #c0162c; } .summary .w b { color: #a35200; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d6dae6; }
  caption { text-align: left; color: #4a5370; padding: 0 0 8px; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid #e3e6ef; }
  th { background: #eef1fb; font-size: 13px; }
  code { font: 13px ui-monospace, Menlo, Consolas, monospace; word-break: break-word; }
  .sev { font-weight: 700; font-size: 13px; }
  tr.error .sev { color: #c0162c; } tr.warn .sev { color: #a35200; } tr.info .sev { color: #2547d0; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .dot.error { background: #c0162c; } .dot.warn { background: #a35200; } .dot.info { background: #2547d0; }
  .note { background: #fff; border-left: 4px solid #2547d0; padding: 12px 16px; margin: 28px 0 0; }
  footer { margin-top: 32px; color: #4a5370; font-size: 13px; }
  footer a { color: #2547d0; }
  @media print { body { background: #fff; } .summary li, table { border-color: #999; } tr { break-inside: avoid; } }
</style></head><body><main>
<h1>Tab order report</h1>
<p class="meta">${esc(title || 'Untitled page')}<br><a href="${esc(url)}">${esc(url)}</a><br>Scanned ${esc(at.toLocaleString())}</p>
<ul class="summary">
  <li><b>${items.length}</b> tab stops</li>
  <li class="e"><b>${errors}</b> errors</li>
  <li class="w"><b>${warns}</b> warnings</li>
  <li><b>${checks}</b> to check by hand</li>
  <li><b>${clickables.length}</b> unreachable clickables</li>
</ul>
<h2 id="findings">Findings</h2>
<div class="table-wrap"><table aria-labelledby="findings">
  <thead><tr><th scope="col">Stop</th><th scope="col">Severity</th><th scope="col">Finding</th><th scope="col">WCAG</th><th scope="col">Element</th><th scope="col">Accessible name</th></tr></thead>
  <tbody>${findings}</tbody></table></div>
<h2 id="order">Tab order</h2>
<div class="table-wrap"><table aria-labelledby="order">
  <thead><tr><th scope="col">Stop</th><th scope="col">Element</th><th scope="col">Accessible name</th><th scope="col">tabindex</th><th scope="col">Findings</th></tr></thead>
  <tbody>${order}</tbody></table></div>
<p class="note">These are automated checks. Confirm each finding by moving through the page with a keyboard: they show where to look, not a final verdict. This report does not certify conformance with WCAG, the ADA, the European Accessibility Act or any other standard or law, and it is not legal advice.</p>
<footer>Generated by Tab Order Visualizer, made by <a href="https://www.linkedin.com/in/ashokkumaryadav" rel="noopener noreferrer" referrerpolicy="no-referrer">Ashok Kumar Yadav</a>.</footer>
</main></body></html>`;
  }

  function downloadReport() {
    const format = state.opts.format || 'html';
    const make = { html: [htmlReport, 'text/html', 'html'], csv: [csvReport, 'text/csv', 'csv'], md: [report, 'text/markdown', 'md'] }[format];
    const [build, type, ext] = make;
    const name = reportFileName(ext);
    const blob = new Blob([build()], { type: `${type};charset=utf-8` });
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href; a.download = name; a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
    setStatus(`Downloaded ${name}`);
  }

  async function copyReport() {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Report copied as Markdown.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (ok) setStatus('Report copied as Markdown.');
      else { console.log(text); setStatus('Clipboard blocked on this page. The report is in the browser console.'); }
    }
  }

  // ---------------------------------------------------------------- lifecycle
  function rescan() {
    stopPlay();
    const t0 = performance.now();
    state.data = scan();
    updatePanel();
    schedule();
    const ms = Math.round(performance.now() - t0);
    setStatus(`Scanned ${state.data.items.length} tab stops in ${ms} ms${state.data.keyboardModality ? ' (keyboard mode)' : ''}.`);
    console.info('[Tab Order Visualizer]', state.data);
  }

  function isTyping(t) {
    return !!t && t.nodeType === 1 && (t.isContentEditable || /^(textarea|select)$/.test(t.localName) ||
      (t.localName === 'input' && !NON_TEXT_INPUTS.test(t.type)));
  }

  function onKey(e) {
    const inPanel = e.composedPath().includes(hostEl);
    const typing = !inPanel && isTyping(e.composedPath()[0]);
    // Alt+Shift+P / Alt+Shift+R work everywhere, even inside a search box
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyP' || e.code === 'KeyR')) {
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'KeyR') rescan(); else (state.playing ? stopPlay() : startPlay());
      return;
    }
    if (e.key === 'Escape') {
      if (state.playing) { e.stopPropagation(); stopPlay(); return; }
      if (typing) return;              // the page's own Esc (closing its search, a menu) wins
      e.stopPropagation(); destroy();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'r') { e.preventDefault(); rescan(); }
    else if (k === 'p') { e.preventDefault(); state.playing ? stopPlay() : startPlay(); }
    else if (k === 'd') { e.preventDefault(); downloadReport(); }
  }

  function onClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') destroy();
    else if (act === 'rescan') rescan();
    else if (act === 'play') state.playing ? stopPlay() : startPlay();
    else if (act === 'copy') copyReport();
    else if (act === 'download') downloadReport();
    else if (act === 'side') state.panel.classList.toggle('left');
    else if (act === 'min') setCollapsed(!state.panel.classList.contains('min'));
    else if (btn.dataset.jump) {
      const f = state.all[+btn.dataset.jump];
      if (f && f.el.isConnected) jumpTo(f.el);
    }
  }

  function onChange(e) {
    const opt = e.target.dataset.opt;
    if (!opt) return;
    state.opts[opt] = opt === 'speed' ? +e.target.value : opt === 'format' ? e.target.value : e.target.checked;
    schedule();
  }

  function destroy() {
    if (!state) return;
    clearTimeout(state.timer);
    if (state.raf) cancelAnimationFrame(state.raf);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    hostEl.remove();
    state = null; hostEl = null;
    delete window[NS];
  }

  // ---------------------------------------------------------------- go
  const root = mount();
  state = {
    root, svg: root.querySelector('svg'), layer: root.querySelector('.layer'), panel: root.querySelector('.panel'),
    opts: { numbers: true, path: true, issuesOnly: false, speed: 550, format: 'html' },
    playing: false, playIndex: 0, timer: 0, raf: 0, flash: null, data: null, all: [],
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window[NS] = { destroy, rescan, get results() { return state && state.data; }, report: () => state && report() };
  rescan();
})();
