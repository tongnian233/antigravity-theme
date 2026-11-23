;(function () {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.self !== window.top) return;
    if (globalThis.__AG_THEME_PRELOAD_LOADED__) return;
    globalThis.__AG_THEME_PRELOAD_LOADED__ = true;

    const electron = require('electron');
    const ipcRenderer = electron && electron.ipcRenderer;
    if (!ipcRenderer) return;

    const IDS = {
      styleBase: 'ag-theme-studio-base-style',
      styleDynamic: 'ag-theme-studio-dynamic-style',
      styleLearned: 'ag-theme-studio-learned-style',
      styleCustom: 'ag-theme-studio-custom-css',
      backdrop: 'ag-theme-studio-backdrop',
      triggerRoot: 'ag-theme-studio-trigger-root',
      uiRoot: 'ag-theme-studio-ui-root'
    };

    const FONT_PRESETS = [
      { label: '默认字体', value: '' },
      { label: '微软雅黑', value: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
      { label: '苹方 / PingFang', value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
      { label: '霞鹜文楷 (已安装时)', value: '"LXGW WenKai", "LXGW WenKai Screen", "Microsoft YaHei", sans-serif' },
      { label: '鸿蒙 / MiSans', value: '"MiSans", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif' },
      { label: '圆润现代 Inter', value: '"Inter", "Segoe UI", "Microsoft YaHei", sans-serif' }
    ];

    const BUBBLE_PRESETS = [
      { label: '星河蓝紫', bg: '#4c1d95', alpha: 0.72 },
      { label: '樱粉奶白', bg: '#fff1f5', alpha: 0.80 },
      { label: '冰透磨砂白', bg: '#ffffff', alpha: 0.62 },
      { label: '曜石磨砂黑', bg: '#181826', alpha: 0.68 },
      { label: '薰衣草紫', bg: '#ede9fe', alpha: 0.78 },
      { label: '极光青蓝', bg: '#0c4a6e', alpha: 0.72 }
    ];

    const ACCENT_SWATCHES = [
      '#a78bfa', // 蓝紫星河
      '#f472b6', // 猫耳玫粉
      '#fbbf24', // 异瞳琥珀金
      '#38bdf8', // 极光天蓝
      '#34d399', // 薄荷翡翠
      '#fb7185'  // 晚霞珊瑚
    ];

    const SLIDER_DEFAULTS = {
      opacity: 0.78,
      blur: 1,
      scrim: 0.2,
      panelAlpha: 0.62,
      panelBlur: 14,
      saturate: 1.08,
      userBubbleAlpha: 0.72
    };

    const state = {
      prefs: null,
      authoritativePrefs: null,
      hasAuthoritativeRevision: false,
      prefsRevision: 0,
      presets: [],
      presetThumbsLoaded: false,
      presetThumbsLoading: false,
      customList: [],
      drawerOpen: false,
      activeTab: 'wallpaper',
      advancedOpen: false,
      isDark: true,
      activeBlobUrl: '',
      activeMediaKey: '',
      activeIsVideo: false,
      activeEdgeColor: '',
      wallpaperLuma: null,
      wallpaperEdgeLuma: null,
      lastAutoVisualDark: null,
      mediaReqSeq: 0,
      videoSampleTimer: null,
      resizeSampleTimer: null,
      titleBarSeq: 0,
      titleBarTimers: [],
      pendingPatch: {},
      inFlightPatches: [],
      saveBatchSeq: 0,
      pendingImportCss: '',
      bootReady: false,
      bootError: '',
      saveTimer: null,
      scanTimer: null,
      rafPending: false,
      scrollRafPending: false,
      streamScanRafPending: false,
      pendingAddedRoots: new Set(),
      userStepIo: null,
      observedUserSteps: new WeakSet(),
      visibleUserSteps: new Set(),
      learnedFadeSelectors: new Set(),
      learnedBubbleSelectors: new Set(),
      toastTimer: null
    };

    // ---- Utilities ----
    function escapeHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function base64ToBlobUrl(base64, mime) {
      const bin = atob(base64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
      return URL.createObjectURL(blob);
    }

    function mediaToBlobUrl(media) {
      if (!media) return '';
      if (media.data) {
        const blob = new Blob([media.data], { type: media.mime || 'application/octet-stream' });
        return URL.createObjectURL(blob);
      }
      if (media.base64) {
        return base64ToBlobUrl(media.base64, media.mime);
      }
      return '';
    }

    function parseRgba(colorStr) {
      if (!colorStr || colorStr === 'transparent' || colorStr === 'none') return null;
      const numVal = (s) => (!s || s === 'none' ? 0 : parseFloat(s));
      const alphaVal = (s) => {
        if (s === undefined || s === null || s === '' || s === 'none') return 1;
        return String(s).endsWith('%') ? parseFloat(s) / 100 : Number(s);
      };
      // rgb(r, g, b) / rgba(r, g, b, a) / rgb(r g b / a)
      let m = colorStr.match(/rgba?\(\s*([-+]?[\d.]+(?:e[-+]?\d+)?|none)\s*[,\s]\s*([-+]?[\d.]+(?:e[-+]?\d+)?|none)\s*[,\s]\s*([-+]?[\d.]+(?:e[-+]?\d+)?|none)(?:\s*[,/]\s*([-+]?[\d.]+(?:e[-+]?\d+)?%?|none))?\s*\)/i);
      if (m) {
        return { r: numVal(m[1]), g: numVal(m[2]), b: numVal(m[3]), a: alphaVal(m[4]) };
      }
      // color(srgb r g b / a) / color(display-p3 r g b / a)
      m = colorStr.match(/color\(\s*(?:srgb|display-p3|srgb-linear|a98-rgb|prophoto-rgb|rec2020)\s+([-+]?[\d.]+(?:e[-+]?\d+)?|none)\s+([-+]?[\d.]+(?:e[-+]?\d+)?|none)\s+([-+]?[\d.]+(?:e[-+]?\d+)?|none)(?:\s*\/\s*([-+]?[\d.]+(?:e[-+]?\d+)?%?|none))?\s*\)/i);
      if (m) {
        return {
          r: Math.max(0, Math.min(255, numVal(m[1]) * 255)),
          g: Math.max(0, Math.min(255, numVal(m[2]) * 255)),
          b: Math.max(0, Math.min(255, numVal(m[3]) * 255)),
          a: alphaVal(m[4])
        };
      }
      // oklch(L C H / a) or oklab(L a b / a)
      m = colorStr.match(/ok(lch|lab)\(\s*([-+]?[\d.]+(?:e[-+]?\d+)?%?|none)\s+([-+]?[\d.]+(?:e[-+]?\d+)?|none)\s+([-+]?[\d.]+(?:e[-+]?\d+)?|none)(?:\s*\/\s*([-+]?[\d.]+(?:e[-+]?\d+)?%?|none))?\s*\)/i);
      if (m) {
        const rawL = m[2] === 'none' ? 0 : (m[2].endsWith('%') ? parseFloat(m[2]) / 100 : Number(m[2]));
        const c1 = Math.abs(numVal(m[3]));
        const c2 = m[1].toLowerCase() === 'lab' ? Math.abs(numVal(m[4])) : 0;
        const gray = Math.round(Math.max(0, Math.min(1, rawL)) * 255);
        // If chroma is tiny, treat as neutral gray; otherwise spread RGB so isNeutralColor returns false
        const spread = (c1 <= 0.045 && c2 <= 0.045) ? 0 : 80;
        return { r: gray, g: Math.max(0, gray - spread), b: Math.min(255, gray + spread), a: alphaVal(m[5]) };
      }
      return null;
    }

    function isNeutralColor(rgba) {
      if (!rgba) return false;
      const max = Math.max(rgba.r, rgba.g, rgba.b);
      const min = Math.min(rgba.r, rgba.g, rgba.b);
      // Neutral white/gray/black/slate surfaces have low RGB spread
      return (max - min) <= 28;
    }

    function luminance(rgba) {
      return (0.2126 * rgba.r + 0.7152 * rgba.g + 0.0722 * rgba.b) / 255;
    }

    function hexToRgb(hex) {
      const clean = String(hex || '').replace('#', '');
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) return { r: 76, g: 29, b: 149 };
      return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16)
      };
    }

    // WCAG relative luminance (0..1)
    function computeHexLuminance(hex) {
      const { r, g, b } = hexToRgb(hex);
      const lin = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    }

    // WCAG relative luminance to pick crisp light/dark text automatically matching bubble background
    function computeAutoTextColor(hex) {
      return computeHexLuminance(hex) > 0.42 ? '#18181b' : '#f8fafc';
    }

    function detectDarkMode() {
      const html = document.documentElement;
      const body = document.body;
      if (html) {
        if (html.classList.contains('dark')) return true;
        if (html.classList.contains('light')) return false;
        const dt = (html.getAttribute('data-theme') || html.getAttribute('data-color-scheme') || '').toLowerCase();
        if (dt.includes('dark')) return true;
        if (dt.includes('light')) return false;
        try {
          const cs = (window.getComputedStyle(html).colorScheme || '').toLowerCase();
          if (cs === 'dark') return true;
          if (cs === 'light') return false;
        } catch {}
      }
      if (body) {
        if (body.classList.contains('dark')) return true;
        if (body.classList.contains('light')) return false;
        // Sample body color-scheme or text/bg color
        try {
          const st = window.getComputedStyle(body);
          const cs = (st.colorScheme || '').toLowerCase();
          if (cs === 'dark') return true;
          if (cs === 'light') return false;
          const fg = parseRgba(st.color);
          if (fg && fg.a > 0.5) {
            return luminance(fg) > 0.52;
          }
          const bg = parseRgba(st.backgroundColor);
          if (bg && bg.a > 0.5) {
            return luminance(bg) < 0.45;
          }
        } catch {}
      }
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      } catch {
        return true;
      }
    }

    function isProtectedElement(el) {
      if (!el || el.nodeType !== 1) return true;
      const id = el.id || '';
      if (id.startsWith('ag-theme-') || id.includes('neko') || id.includes('Neko')) return true;
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.includes('ag-theme-') || cls.includes('neko')) return true;
      if (el.closest('#ag-theme-studio-ui-root, #ag-theme-studio-trigger-root, #ag-theme-studio-backdrop, [id*="neko"], [id*="Neko"]')) return true;
      if (el.closest('[data-ag-native-surface="1"], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper], [data-floating-ui-portal], .monaco-editor, .cm-editor, .xterm')) {
        return true;
      }
      return false;
    }

    // ---- Surface Scanner for Smart Glass Mode ----
    function clearSurfaceTags(keepFadeMasks) {
      const sel = keepFadeMasks
        ? '[data-ag-surface], [data-ag-app-shell], [data-ag-sidebar], [data-ag-main-pane], [data-ag-composer-region], [data-ag-chat-root], [data-ag-native-surface], [data-ag-native-clash], [data-ag-bubble-checked], [data-ag-preserve-fg]'
        : '[data-ag-surface], [data-ag-app-shell], [data-ag-fade-mask], [data-ag-sidebar], [data-ag-main-pane], [data-ag-composer-region], [data-ag-chat-root], [data-ag-native-surface], [data-ag-native-clash], [data-ag-bubble-checked], [data-ag-preserve-fg]';
      const tagged = document.querySelectorAll(sel);
      for (const el of tagged) {
        el.removeAttribute('data-ag-surface');
        el.removeAttribute('data-ag-app-shell');
        if (!keepFadeMasks) el.removeAttribute('data-ag-fade-mask');
        el.removeAttribute('data-ag-sidebar');
        el.removeAttribute('data-ag-main-pane');
        el.removeAttribute('data-ag-composer-region');
        el.removeAttribute('data-ag-chat-root');
        el.removeAttribute('data-ag-native-surface');
        el.removeAttribute('data-ag-native-clash');
        el.removeAttribute('data-ag-bubble-checked');
        el.removeAttribute('data-ag-preserve-fg');
      }
      if (state.userStepIo) {
        try { state.userStepIo.disconnect(); } catch {}
        state.userStepIo = null;
      }
      state.observedUserSteps = new WeakSet();
      state.visibleUserSteps.clear();
    }

    function hasOpaqueSurfaceBg(el) {
      if (!el || el.nodeType !== 1) return false;
      try {
        const st = window.getComputedStyle(el);
        const rgba = parseRgba(st.backgroundColor);
        if (rgba && rgba.a >= 0.72) return true;
      } catch {}
      // Check shallow large descendants only (fast: max 12 checks)
      const kids = el.querySelectorAll(':scope > div, :scope > section, :scope > main, :scope > aside, :scope > div > div, :scope > div > div > div');
      const lim = Math.min(kids.length, 12);
      for (let i = 0; i < lim; i++) {
        const k = kids[i];
        const kr = k.getBoundingClientRect();
        if (kr.width < 160 || kr.height < 90) continue;
        try {
          const kst = window.getComputedStyle(k);
          const krgba = parseRgba(kst.backgroundColor);
          if (krgba && krgba.a >= 0.72) return true;
        } catch {}
      }
      return false;
    }

    function stripSurfaceTagsInside(rootEl) {
      if (!rootEl) return;
      if (rootEl.hasAttribute('data-ag-surface')) rootEl.removeAttribute('data-ag-surface');
      if (rootEl.hasAttribute('data-ag-sidebar')) rootEl.removeAttribute('data-ag-sidebar');
      if (rootEl.hasAttribute('data-ag-chat-root')) rootEl.removeAttribute('data-ag-chat-root');
      const inner = rootEl.querySelectorAll('[data-ag-surface], [data-ag-sidebar], [data-ag-chat-root]');
      for (const node of inner) {
        node.removeAttribute('data-ag-surface');
        node.removeAttribute('data-ag-sidebar');
        node.removeAttribute('data-ag-chat-root');
      }
    }

    function isNativeOverlayCandidate(el, vw, vh, inputBox) {
      if (!el || el.nodeType !== 1) return false;
      const id = el.id || '';
      if (id === 'root' || id === 'app' || id.startsWith('ag-theme-') || id.includes('neko') || id.includes('Neko')) return false;
      if (el.closest('#ag-theme-studio-ui-root, #ag-theme-studio-trigger-root, #ag-theme-studio-backdrop, [id*="neko"], [id*="Neko"]')) return false;
      if (inputBox && (el === inputBox || el.contains(inputBox))) return false;
      if (el.querySelector('[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="planner-response-text"]')) return false;
      if (el.getAttribute('data-ag-sidebar') === '1' || el.getAttribute('data-ag-surface') === 'panel' || el.getAttribute('data-ag-surface') === 'canvas') return false;

      let st;
      try { st = window.getComputedStyle(el); } catch { return false; }
      if (!st || st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;

      const r = el.getBoundingClientRect();
      const isBodyPortal = el.parentElement === document.body && el.tagName === 'DIV';
      if (!isBodyPortal && (r.width < 130 || r.height < 64)) return false;

      const role = el.getAttribute('role') || '';
      const isExplicitOverlay = el.tagName === 'DIALOG' || role === 'dialog' || role === 'alertdialog' || role === 'menu' || role === 'listbox' || el.getAttribute('aria-modal') === 'true' || el.hasAttribute('data-radix-popper-content-wrapper') || el.hasAttribute('data-floating-ui-portal');
      const isFixedOverlay = st.position === 'fixed' && r.width >= 140 && r.height >= 72 && hasOpaqueSurfaceBg(el);
      const zVal = parseInt(st.zIndex, 10) || 0;
      const hasShadow = Boolean(st.boxShadow && st.boxShadow !== 'none');
      const isAbsOverlay = st.position === 'absolute' && st.pointerEvents !== 'none' && hasOpaqueSurfaceBg(el) && (
        (r.width >= vw * 0.5 && r.height >= vh * 0.5) ||
        (r.width >= 140 && r.height >= 72 && (zVal >= 5 || hasShadow))
      );
      const isOpaquePortal = isBodyPortal && hasOpaqueSurfaceBg(el);
      return Boolean(isExplicitOverlay || isFixedOverlay || isAbsOverlay || isOpaquePortal);
    }

    // Fast, diff-based native overlay detector (zero style churn when steady; catches popovers/overview cards anywhere in DOM!)
    function scanNativeOverlays(vw, vh) {
      const inputBox = document.querySelector('[data-testid="agent-input-box"]');
      const candidates = new Set();
      if (document.body) {
        for (const child of Array.from(document.body.children)) {
          if (child.tagName === 'DIV' || child.tagName === 'DIALOG') candidates.add(child);
        }
      }
      const queryNodes = document.querySelectorAll(
        'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-radix-portal], [data-radix-popper-content-wrapper], [data-floating-ui-portal], [data-state="open"], [class*="fixed"], [class*="inset-0"], [class*="shadow"], [class*="z-50"], [class*="z-40"], [class*="z-30"], [class*="z-20"], [class*="popover"], [class*="Popover"], [class*="dropdown"], [class*="Dropdown"]'
      );
      const qLim = Math.min(queryNodes.length, 240);
      for (let i = 0; i < qLim; i++) candidates.add(queryNodes[i]);

      const nextOverlays = new Set();

      for (const el of candidates) {
        let ancMatched = false;
        for (const existing of nextOverlays) {
          if (existing.contains(el)) { ancMatched = true; break; }
        }
        if (ancMatched) continue;
        if (isNativeOverlayCandidate(el, vw, vh, inputBox)) {
          nextOverlays.add(el);
        }
      }

      // Diff update: only touch DOM attributes when overlay membership actually changed!
      const prev = document.querySelectorAll('[data-ag-native-surface="1"]');
      for (const el of prev) {
        if (!nextOverlays.has(el) && el.getAttribute('data-ag-native-clash') !== '1') {
          el.removeAttribute('data-ag-native-surface');
        }
      }
      for (const el of nextOverlays) {
        if (el.getAttribute('data-ag-native-surface') !== '1') {
          el.setAttribute('data-ag-native-surface', '1');
          stripSurfaceTagsInside(el);
        }
      }
    }

    // Low-frequency post-scan safety net (checks both head & tail of DOM so late-mounted popovers/overview cards are never missed!)
    function scanClashingNativeSurfaces(vw, vh) {
      const p = state.prefs;
      const isGlass = Boolean(p && p.enabled && p.renderMode === 'glass');
      const visualDark = isGlass ? resolveVisualDark() : state.isDark;
      const rawTone = p ? (p.textTone || 'auto') : 'auto';
      const overridingText = isGlass && (rawTone !== 'auto' || visualDark !== state.isDark);
      const nextClash = new Set();
      if (overridingText) {
        const inputBox = document.querySelector('[data-testid="agent-input-box"]');
        const root = document.getElementById('root') || document.body;
        if (root) {
          const allNodes = root.querySelectorAll('div, section, aside, main');
          const total = allNodes.length;
          // Scan first 160 + last 240 nodes so deeply-mounted overlays near DOM tail are always covered
          const indices = [];
          const headEnd = Math.min(total, 160);
          for (let i = 0; i < headEnd; i++) indices.push(i);
          const tailStart = Math.max(headEnd, total - 240);
          for (let i = tailStart; i < total; i++) indices.push(i);
          for (const i of indices) {
            const el = allNodes[i];
            if (el === root || (el.id && (el.id.startsWith('ag-theme-') || el.id.includes('neko')))) continue;
            if (el.getAttribute('data-ag-surface') || el.getAttribute('data-ag-sidebar') === '1') continue;
            if (el.getAttribute('data-ag-native-surface') === '1' && el.getAttribute('data-ag-native-clash') !== '1') continue;
            if (el.closest('[data-ag-sidebar="1"], [data-ag-surface="panel"], [data-ag-surface="input-card"], [data-ag-surface="user-bubble"], pre, code, #ag-theme-studio-ui-root, #ag-theme-studio-trigger-root, [id*="neko"]')) continue;
            if (inputBox && (el === inputBox || el.contains(inputBox))) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 140 || r.height < 72) continue;
            if (el.querySelector('[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="planner-response-text"]')) continue;
            let st;
            try { st = window.getComputedStyle(el); } catch { continue; }
            if (!st || st.display === 'none' || st.visibility === 'hidden' || st.pointerEvents === 'none') continue;
            const rgba = parseRgba(st.backgroundColor);
            if (!rgba || rgba.a < 0.72 || !isNeutralColor(rgba)) continue;
            const lum = luminance(rgba);
            if ((!visualDark && lum < 0.36) || (visualDark && lum > 0.72)) {
              nextClash.add(el);
            }
          }
        }
      }
      const prevClash = document.querySelectorAll('[data-ag-native-clash="1"]');
      for (const el of prevClash) {
        if (!nextClash.has(el)) {
          el.removeAttribute('data-ag-native-clash');
          el.removeAttribute('data-ag-native-surface');
        }
      }
      for (const el of nextClash) {
        if (el.getAttribute('data-ag-native-surface') !== '1') {
          el.setAttribute('data-ag-native-surface', '1');
          stripSurfaceTagsInside(el);
        }
        if (el.getAttribute('data-ag-native-clash') !== '1') {
          el.setAttribute('data-ag-native-clash', '1');
        }
      }
    }

    /**
     * Refresh active pill state inside a segmented control track (e.g. Markdown Preview/Raw toggle).
     */
    function syncSegmentedTrackPills(trackEl) {
      if (!trackEl || !trackEl.isConnected) return;
      const btns = Array.from(trackEl.querySelectorAll('button'));
      if (btns.length < 2) return;
      // Temporarily clear chat-pill on siblings so we can read which button carries the native active background
      for (const b of btns) {
        if (b.getAttribute('data-ag-surface') === 'chat-pill') b.removeAttribute('data-ag-surface');
      }
      const semanticSel = '[aria-pressed="true"], [aria-selected="true"], [aria-current="true"], [data-state="active"], [data-state="on"], [data-active="true"]';
      let picked = null;
      for (const b of btns) {
        if (b.matches && b.matches(semanticSel)) {
          picked = b;
          break;
        }
      }
      if (!picked) {
        let bestAlpha = 0;
        for (const b of btns) {
          let st;
          try { st = window.getComputedStyle(b); } catch { continue; }
          const rgba = st ? parseRgba(st.backgroundColor) : null;
          if (rgba && rgba.a > bestAlpha && rgba.a >= 0.15) {
            bestAlpha = rgba.a;
            picked = b;
          }
        }
      }
      if (picked) picked.setAttribute('data-ag-surface', 'chat-pill');
    }

    /**
     * Soften small neutral-bg chat controls whose native dark/light surface clashes with current text tone
     * (e.g. Dark Mode + bright wallpaper -> Markdown [Preview | Raw] segmented pill & floating Scroll-to-Bottom button).
     */
    function scanClashingChatControls(scopeRoot, floatingOnly) {
      const p = state.prefs;
      const isGlass = Boolean(p && p.enabled && p.renderMode === 'glass');
      const visualDark = isGlass ? resolveVisualDark() : state.isDark;
      const rawTone = p ? (p.textTone || 'auto') : 'auto';
      const overridingText = isGlass && (rawTone !== 'auto' || visualDark !== state.isDark);

      if (!overridingText) {
        if (!floatingOnly) {
          const old = document.querySelectorAll('[data-ag-surface="chat-pill"], [data-ag-surface="chat-pill-track"], [data-ag-preserve-fg="1"]');
          for (const el of old) {
            if (el.getAttribute('data-ag-surface') === 'chat-pill' || el.getAttribute('data-ag-surface') === 'chat-pill-track') {
              el.removeAttribute('data-ag-surface');
            }
            if (el.hasAttribute('data-ag-preserve-fg')) el.removeAttribute('data-ag-preserve-fg');
          }
        }
        return;
      }

      const root = scopeRoot
        || document.querySelector('[data-ag-main-pane="1"]')
        || document.querySelector('[data-testid="conversation-view"]')
        || document.getElementById('root')
        || document.body;
      if (!root) return;

      const isClashingNeutral = (rgba) => {
        if (!rgba || rgba.a < 0.42 || !isNeutralColor(rgba)) return false;
        const lum = luminance(rgba);
        return (!visualDark && lum < 0.46) || (visualDark && lum > 0.64);
      };

      const selector = floatingOnly
        ? 'button[class*="rounded"]:not([data-ag-surface="chat-pill"]), button[aria-label*="bottom" i]:not([data-ag-surface="chat-pill"]), button[aria-label*="底部"]:not([data-ag-surface="chat-pill"]), button[title*="bottom" i]:not([data-ag-surface="chat-pill"]), button[title*="底部"]:not([data-ag-surface="chat-pill"])'
        : 'button';
      const buttons = root.querySelectorAll(selector);
      const checkedTracks = new Set();
      const syncedTracks = new Set();
      const lim = Math.min(buttons.length, floatingOnly ? 36 : 240);

      for (let i = 0; i < lim; i++) {
        const btn = buttons[i];
        if (!btn || isProtectedElement(btn)) continue;
        if (btn.closest('[data-ag-sidebar="1"], [data-ag-surface="panel"], [data-ag-surface="input-card"], [data-ag-surface="user-bubble"]')) continue;
        const r = btn.getBoundingClientRect();
        if (r.width < 16 || r.height < 16 || r.width > 240 || r.height > 56) continue;

        // 1. Check up to 2 ancestors for a compact segmented pill track (e.g. [ Preview | Raw ], even with tooltip wrappers!)
        let matchedTrack = null;
        let candTrack = btn.parentElement;
        for (let up = 0; candTrack && up < 2 && candTrack !== root && candTrack !== document.body; up++, candTrack = candTrack.parentElement) {
          if (isProtectedElement(candTrack)) break;
          if (candTrack.getAttribute('data-ag-surface') === 'chat-pill-track') {
            matchedTrack = candTrack;
            break;
          }
          if (checkedTracks.has(candTrack)) continue;
          const innerBtns = candTrack.querySelectorAll('button');
          if (innerBtns.length >= 2 && innerBtns.length <= 5) {
            checkedTracks.add(candTrack);
            const pr = candTrack.getBoundingClientRect();
            if (pr.width >= 48 && pr.width <= 320 && pr.height >= 20 && pr.height <= 48) {
              let pst;
              try { pst = window.getComputedStyle(candTrack); } catch {}
              const prgba = pst ? parseRgba(pst.backgroundColor) : null;
              if (isClashingNeutral(prgba)) {
                candTrack.setAttribute('data-ag-surface', 'chat-pill-track');
                matchedTrack = candTrack;
                break;
              }
            }
          }
        }
        if (matchedTrack) {
          if (!syncedTracks.has(matchedTrack)) {
            syncedTracks.add(matchedTrack);
            syncSegmentedTrackPills(matchedTrack);
          }
          continue;
        }

        // 2. Standalone small button (e.g. circular Scroll-to-Bottom FAB or solid pill action button)
        if (btn.getAttribute('data-ag-surface') === 'chat-pill') continue;
        let st;
        try { st = window.getComputedStyle(btn); } catch { continue; }
        if (!st || st.display === 'none' || st.visibility === 'hidden') continue;
        const rgba = parseRgba(st.backgroundColor);
        if (isClashingNeutral(rgba)) {
          btn.setAttribute('data-ag-surface', 'chat-pill');
        } else if (rgba && rgba.a >= 0.65 && !isNeutralColor(rgba)) {
          // Preserve native contrast on saturated accent buttons (e.g. blue primary CTA)
          if (btn.getAttribute('data-ag-preserve-fg') !== '1') {
            btn.setAttribute('data-ag-preserve-fg', '1');
          }
        } else if ((!rgba || rgba.a < 0.15) && btn.parentElement && !isProtectedElement(btn.parentElement)) {
          // Fallback: if the clashing circle/pill bg sits on the button's tight single-button wrapper
          const wr = btn.parentElement.getBoundingClientRect();
          if (wr.width >= 20 && wr.width <= 60 && wr.height >= 20 && wr.height <= 60 && btn.parentElement.querySelectorAll('button').length === 1) {
            let wst;
            try { wst = window.getComputedStyle(btn.parentElement); } catch {}
            const wrgba = wst ? parseRgba(wst.backgroundColor) : null;
            if (isClashingNeutral(wrgba)) {
              btn.parentElement.setAttribute('data-ag-surface', 'chat-pill');
            }
          }
        }
      }
    }

    // Reliably locate the main left sidebar (never matches inside settings modals; works even if sidebar div has transparent bg!)
    function findLeftSidebarElements(vw, vh) {
      const inputBox = document.querySelector('[data-testid="agent-input-box"]');
      const found = [];
      const addIfValid = (el) => {
        if (!el || isProtectedElement(el)) return false;
        if (inputBox && (el === inputBox || el.contains(inputBox))) return false;
        // NOTE: NEVER exclude [data-cascade-id] here because sidebar conversation rows carry data-cascade-id!
        if (el.querySelector('[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="planner-response-text"]')) return false;
        const r = el.getBoundingClientRect();
        if (r.left >= 60 || r.width < 150 || r.width > 460 || r.height < vh * 0.5) return false;
        if (!found.includes(el)) found.push(el);
        return true;
      };

      // 1. Deterministic anchor-upward detection via official sidebar testids/attributes
      const anchors = document.querySelectorAll(
        '[data-testid="project-group"], [data-project-card="true"], [data-testid="conversation-row-sidebar"], [data-testid="new-conversation-button"]'
      );
      for (const anchor of anchors) {
        if (isProtectedElement(anchor)) continue;
        let cur = anchor;
        let best = null;
        for (let depth = 0; cur && depth < 14 && cur !== document.body && cur !== document.documentElement; depth++) {
          if (isProtectedElement(cur)) {
            best = null;
            break;
          }
          if (inputBox && cur.contains(inputBox)) break;
          if (cur.querySelector('[data-testid="conversation-view"], [data-testid="agent-input-box"], [data-testid="planner-response-text"]')) break;
          const r = cur.getBoundingClientRect();
          if (r.left < 60 && r.width >= 150 && r.width <= 460 && r.height >= vh * 0.5) {
            best = cur;
          } else if (r.width > 480) {
            break;
          }
          cur = cur.parentElement;
        }
        if (best) addIfValid(best);
      }

      // 2. Explicit panel / aside / nav candidates
      const explicit = document.querySelectorAll('[data-ag-surface="panel"], aside, nav, [class*="sidebar"], [class*="Sidebar"]');
      for (const el of explicit) addIfValid(el);

      // 3. Geometric fallback when sidebar has no projects/conversations yet
      if (found.length === 0) {
        const root = document.getElementById('root') || document.body;
        if (root) {
          const divs = root.querySelectorAll('div');
          const lim = Math.min(divs.length, 180);
          for (let i = 0; i < lim; i++) {
            if (addIfValid(divs[i])) break;
          }
        }
      }

      // Deduplicate: keep outermost sidebar containers (avoid tagging nested inner wrappers as separate panels)
      return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    }

    // Incrementally prune only stale structural tags whose geometry no longer matches, avoiding backdrop-filter layer teardown!
    function pruneStaleStructuralTags(vw, vh) {
      const inputBox = document.querySelector('[data-testid="agent-input-box"]');
      const canvases = document.querySelectorAll('[data-ag-surface="canvas"]');
      for (const el of canvases) {
        if (inputBox && el.contains(inputBox)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < vw * 0.32 || r.height < vh * 0.24) {
          el.removeAttribute('data-ag-surface');
        }
      }
      const panels = document.querySelectorAll('[data-ag-surface="panel"]');
      for (const el of panels) {
        if (inputBox && el.contains(inputBox)) {
          el.setAttribute('data-ag-surface', 'canvas');
          el.removeAttribute('data-ag-sidebar');
          continue;
        }
        const r = el.getBoundingClientRect();
        const isEdgeDocked = r.left < 68 || r.right > vw - 68;
        const validSide = isEdgeDocked && r.width >= 140 && r.width <= 580 && r.height >= vh * 0.45;
        const validTop = r.top < 80 && r.width >= vw * 0.42 && r.height >= 20 && r.height <= 96;
        if (!validSide && !validTop) {
          el.removeAttribute('data-ag-surface');
          el.removeAttribute('data-ag-sidebar');
        }
      }
    }

    function clearInputSurfaceTags() {
      const tagged = document.querySelectorAll('[data-ag-surface="input-card"], [data-ag-surface="input-inner"], [data-ag-surface="input-shell"]');
      for (const el of tagged) el.removeAttribute('data-ag-surface');
    }

    function hasNeutralGradient(bgImage) {
      if (!bgImage || bgImage === 'none') return false;
      return /gradient\(/i.test(bgImage);
    }

    function rebuildLearnedCss() {
      const rules = [];
      const descendantProtect = ':not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([role="listbox"]):not([role="listbox"] *):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *)';
      const protectedGuard = `${descendantProtect}:not([data-ag-sidebar="1"]):not([data-ag-sidebar="1"] *):not([data-ag-surface="panel"]):not([data-ag-surface="input-card"]):not([data-ag-surface="user-bubble"])`;
      const bubbleGuard = `:not([data-testid="agent-input-box"])${descendantProtect}:not([data-ag-sidebar="1"]):not([data-ag-sidebar="1"] *):not([data-ag-surface="panel"]):not([data-ag-surface="panel"] *)`;
      for (const s of state.learnedFadeSelectors) {
        rules.push(
          `html[data-ag-theme-active="glass"] :is([data-ag-main-pane="1"], [data-ag-composer-region="1"], [data-testid="conversation-view"], [data-ag-sidebar="1"]) ${s}${protectedGuard}, html[data-ag-theme-active="glass"] :is([data-ag-main-pane="1"], [data-ag-composer-region="1"], [data-testid="conversation-view"], [data-ag-sidebar="1"]) ${s}${protectedGuard}::before, html[data-ag-theme-active="glass"] :is([data-ag-main-pane="1"], [data-ag-composer-region="1"], [data-testid="conversation-view"], [data-ag-sidebar="1"]) ${s}${protectedGuard}::after { background-image: none !important; background-color: transparent !important; box-shadow: none !important; }`
        );
      }
      for (const s of state.learnedBubbleSelectors) {
        rules.push(
          `html[data-ag-theme-active][data-ag-user-bubble="1"] :is([data-ag-main-pane="1"], [data-testid="conversation-view"], [data-testid="user-input-step"]) ${s}${bubbleGuard} { background-color: var(--ag-user-bubble-bg) !important; color: var(--ag-user-bubble-text) !important; border: 1px solid var(--ag-user-bubble-border) !important; backdrop-filter: blur(var(--ag-panel-blur)) !important; -webkit-backdrop-filter: blur(var(--ag-panel-blur)) !important; box-shadow: 0 4px 18px rgba(0, 0, 0, 0.14) !important; }`,
          `html[data-ag-theme-active][data-ag-user-bubble="1"] :is([data-ag-main-pane="1"], [data-testid="conversation-view"], [data-testid="user-input-step"]) ${s}${bubbleGuard} :is(p, span, div, li, strong, em, a, code):not(pre *)${descendantProtect} { color: var(--ag-user-bubble-text) !important; }`
        );
      }
      ensureStyleEl(IDS.styleLearned, rules.join('\n'));
    }

    function learnFadeSelector(el, allowSolidBottomStrip) {
      if (!el || !el.classList || el.classList.length === 0) return;
      const clsArr = Array.from(el.classList).filter((c) => c && !c.startsWith('ag-'));
      if (!clsArr.length) return;
      const esc = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
        ? CSS.escape(s)
        : s.replace(/([^\w-])/g, '\\$1');
      const gradClasses = clsArr.filter((c) => /gradient|linear-to|fade|scrim|mask/i.test(c));
      const anchorClasses = clsArr.filter((c) => /pointer-events-none|bottom-|top-|sticky|absolute|inset-x/i.test(c));
      let picked = [];
      if (gradClasses.length > 0) {
        picked = [...gradClasses.slice(0, 2), ...anchorClasses.slice(0, 2)];
        if (picked.length < 2 && !clsArr.some((c) => /scroll.*fade|fade.*mask|gradient-to-[tblr]|linear-to-[tblr]/i.test(c))) {
          return;
        }
      } else if (allowSolidBottomStrip) {
        // Also learn solid/CSS-module bottom fade & composer dock strips so switching to cold conversations NEVER flashes a black bar!
        const bgClasses = clsArr.filter((c) => /^bg-|^from-|^to-|^via-|fade|mask|scrim|gradient/i.test(c));
        const layoutAnchors = clsArr.filter((c) => /bottom-|sticky|absolute|inset-x|pointer-events-none|shrink-0|w-full|z-\d+|pb-|pt-|px-|mx-auto|max-w-/i.test(c));
        if (bgClasses.length > 0) {
          picked = [...bgClasses.slice(0, 2), ...layoutAnchors.slice(0, 3)];
        } else if (clsArr.some((c) => /pointer-events-none/i.test(c)) && layoutAnchors.length >= 2) {
          picked = layoutAnchors.slice(0, 3);
        }
        if (picked.length < 2) return;
      } else {
        return;
      }
      const uniquePicked = Array.from(new Set(picked));
      const sel = uniquePicked.map((c) => '.' + esc(c)).join('');
      if (!sel || state.learnedFadeSelectors.has(sel) || state.learnedFadeSelectors.size >= 40) return;
      state.learnedFadeSelectors.add(sel);
      rebuildLearnedCss();
    }

    function learnUserBubbleSelector(el) {
      if (!el || !el.classList || el.classList.length < 2) return;
      const clsArr = Array.from(el.classList).filter((c) => c && !c.startsWith('ag-'));
      const hasRound = clsArr.some((c) => /rounded/i.test(c));
      const hasBg = clsArr.some((c) => /^bg-/i.test(c));
      if (!hasRound || !hasBg) return;
      const esc = (s) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
        ? CSS.escape(s)
        : s.replace(/([^\w-])/g, '\\$1');
      const elSel = clsArr.slice(0, 6).map((c) => '.' + esc(c)).join('');
      let alignAncCls = '';
      let cur = el.parentElement;
      for (let d = 1; cur && d < 4 && cur !== document.body; d++) {
        const pCls = Array.from(cur.classList || []).find((c) => /^(self-end|ml-auto|justify-end|items-end)$/.test(c));
        if (pCls) {
          alignAncCls = '.' + esc(pCls) + ' ';
          break;
        }
        cur = cur.parentElement;
      }
      const fullSel = `${alignAncCls}${elSel}:not([data-testid="agent-input-box"]):not([id*="neko"]):not([id*="ag-theme"])`;
      if (state.learnedBubbleSelectors.has(fullSel) || state.learnedBubbleSelectors.size >= 12) return;
      state.learnedBubbleSelectors.add(fullSel);
      rebuildLearnedCss();
    }

    function tagFadeMaskIfMatched(el, vw, inputRect) {
      if (!el || isProtectedElement(el)) return;
      const tag = el.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'SVG' || tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }
      const surf = el.getAttribute('data-ag-surface');
      if (surf === 'input-card' || surf === 'user-bubble' || el.closest('[data-ag-surface="input-card"], [data-ag-surface="user-bubble"], pre, table')) {
        return;
      }
      let st;
      try { st = window.getComputedStyle(el); } catch { return; }
      if (!st || st.display === 'none') return;

      const rect = el.getBoundingClientRect();
      if (rect.width < vw * 0.25) return;

      const isNearInputZone = Boolean(
        inputRect &&
        rect.bottom >= inputRect.top - 36 &&
        rect.top >= inputRect.top - 160 &&
        rect.height >= 2 &&
        rect.height <= Math.max(220, inputRect.height + 110)
      );

      if (hasNeutralGradient(st.backgroundImage)) {
        const isSmallStrip = rect.height >= 2 && rect.height <= 280;
        const isLeafEmpty = el.childElementCount === 0 && !(el.firstChild && el.firstChild.nodeValue && el.firstChild.nodeValue.trim());
        const isEmptyOrPointerNone = isLeafEmpty || st.pointerEvents === 'none';
        const cls = typeof el.className === 'string' ? el.className : '';
        const looksLikeFade = isNearInputZone || /gradient-to-[tb]|linear-to-[tb]|fade|mask|scrim/i.test(cls) || isEmptyOrPointerNone;
        if (isSmallStrip && looksLikeFade) {
          el.setAttribute('data-ag-fade-mask', 'self');
          learnFadeSelector(el, true);
        }
      } else if (
        isNearInputZone &&
        !el.querySelector('pre, code, table, [data-testid="user-input-step"], [data-testid="planner-response-text"], [data-ag-surface="user-bubble"]')
      ) {
        const rgba = parseRgba(st.backgroundColor);
        const hasDarkBg = Boolean(rgba && rgba.a > 0.04 && isNeutralColor(rgba));
        const hasShadow = Boolean(st.boxShadow && st.boxShadow !== 'none');
        if (hasDarkBg || hasShadow) {
          el.setAttribute('data-ag-fade-mask', 'self');
          learnFadeSelector(el, true);
        }
      }

      // Check ::before and ::after pseudo-elements for gradient fade bars
      try {
        const bef = window.getComputedStyle(el, '::before');
        if (bef && bef.content !== 'none' && hasNeutralGradient(bef.backgroundImage)) {
          el.setAttribute('data-ag-fade-mask', 'before');
          learnFadeSelector(el);
        }
      } catch {}
      try {
        const aft = window.getComputedStyle(el, '::after');
        if (aft && aft.content !== 'none' && hasNeutralGradient(aft.backgroundImage)) {
          const cur = el.getAttribute('data-ag-fade-mask');
          el.setAttribute('data-ag-fade-mask', cur === 'before' ? 'both' : 'after');
          learnFadeSelector(el);
        }
      } catch {}
    }

    function scanInputBox(p) {
      const inputBox = document.querySelector('[data-testid="agent-input-box"]');
      if (!p.glassInputBox) {
        clearInputSurfaceTags();
        return inputBox;
      }
      if (!inputBox || isProtectedElement(inputBox)) return inputBox;

      const boxRect = inputBox.getBoundingClientRect();
      // Fast path: if input-card is already tagged inside inputBox and geometry still fits, keep it without tearing down backdrop-filter!
      const existingCard = inputBox.getAttribute('data-ag-surface') === 'input-card'
        ? inputBox
        : inputBox.querySelector('[data-ag-surface="input-card"]');
      if (existingCard) {
        const er = existingCard.getBoundingClientRect();
        if (er.width >= Math.max(160, boxRect.width * 0.72) && er.height >= 36) {
          return inputBox;
        }
      }

      clearInputSurfaceTags();
      const boxEls = [inputBox, ...Array.from(inputBox.querySelectorAll('div, form, section'))];

      // Pick the actual visible rounded composer pill (avoid tagging a square outer wrapper!)
      let bestCard = null;
      const largeEls = [];
      for (const el of boxEls) {
        if (isProtectedElement(el)) continue;
        if (el.closest('button, [role="button"], [role="menu"], [role="listbox"]')) continue;
        const r = el.getBoundingClientRect();
        if (r.width < Math.max(160, boxRect.width * 0.72) || r.height < 36) continue;
        let st;
        try { st = window.getComputedStyle(el); } catch { continue; }
        const radius = parseFloat(st.borderRadius || '0') || 0;
        const rgba = parseRgba(st.backgroundColor);
        const hasBg = Boolean(rgba && rgba.a >= 0.2 && isNeutralColor(rgba));
        const hasBorder = (parseFloat(st.borderTopWidth || '0') || 0) > 0;
        largeEls.push({ el, radius, hasBg, hasBorder, r });
        if (radius >= 10 && (hasBg || hasBorder)) {
          bestCard = el;
        }
      }
      if (!bestCard) {
        const anyRounded = largeEls.filter((x) => x.radius >= 8);
        bestCard = anyRounded.length ? anyRounded[anyRounded.length - 1].el : inputBox;
      }

      // Clean any tight parent wrapper around inputBox (prevents outer dark ring / double border)
      const parent = inputBox.parentElement;
      if (parent && !isProtectedElement(parent)) {
        const pr = parent.getBoundingClientRect();
        if (pr.width <= boxRect.width + 28 && pr.height <= boxRect.height + 28) {
          let pst;
          try { pst = window.getComputedStyle(parent); } catch {}
          const prgba = pst ? parseRgba(pst.backgroundColor) : null;
          if ((prgba && prgba.a >= 0.4 && isNeutralColor(prgba)) || (pst && pst.boxShadow && pst.boxShadow !== 'none')) {
            parent.setAttribute('data-ag-surface', 'input-shell');
          }
        }
      }

      for (const item of largeEls) {
        if (item.el === bestCard) {
          item.el.setAttribute('data-ag-surface', 'input-card');
        } else if (item.el.contains(bestCard)) {
          // Only strip outer wrappers surrounding bestCard; NEVER strip inner child elements!
          item.el.setAttribute('data-ag-surface', 'input-shell');
        }
      }
      bestCard.setAttribute('data-ag-surface', 'input-card');
      return inputBox;
    }

    function scanHeaderClean(rootEl, vw) {
      if (!rootEl) return;
      const seen = new Set();
      const candidates = [];
      const addAll = (list, cap) => {
        const lim = Math.min(list.length, cap);
        for (let i = 0; i < lim; i++) {
          const el = list[i];
          if (!seen.has(el)) { seen.add(el); candidates.push(el); }
        }
      };
      // Prefer targeted header / topbar containers + O(1) elementsFromPoint hit-test on top-right controls (catches any DOM depth!)
      addAll(rootEl.querySelectorAll('header, header *, nav, [role="banner"], [role="banner"] *, [class*="top-0"], [class*="header" i]'), 220);
      addAll(rootEl.querySelectorAll(':scope > div, :scope > div > div, :scope > div > div > div, :scope > div > div > div > button'), 120);
      if (typeof document.elementsFromPoint === 'function') {
        const probePts = [
          [vw - 20, 48], [vw - 56, 48], [vw - 100, 48],
          [vw - 20, 62], [vw - 56, 62], [vw - 100, 62]
        ];
        for (const [px, py] of probePts) {
          if (px <= 0 || py <= 0) continue;
          try {
            const stack = document.elementsFromPoint(px, py);
            for (const el of stack) {
              if (!el || el === document.body || el === document.documentElement) continue;
              if (!seen.has(el)) { seen.add(el); candidates.push(el); }
              // Also inspect immediate parent wrapper of top-right buttons (often carries the opaque black strip!)
              const pe = el.parentElement;
              if (pe && pe !== document.body && !seen.has(pe)) { seen.add(pe); candidates.push(pe); }
            }
          } catch {}
        }
      }

      const writes = [];
      for (const el of candidates) {
        if (isProtectedElement(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.top > 96 || r.bottom > 112 || r.height < 14 || r.height > 68 || r.width < 16 || r.width > vw * 0.48) continue;
        let st;
        try { st = window.getComputedStyle(el); } catch { continue; }
        if (!st || st.display === 'none') continue;
        const radius = parseFloat(st.borderRadius || '0') || 0;
        const hasGrad = hasNeutralGradient(st.backgroundImage);
        const rgba = parseRgba(st.backgroundColor);
        const isTopRightZone = r.right >= vw - 260;

        if (el.tagName === 'BUTTON') {
          if (!isTopRightZone) continue;
          if (rgba && rgba.a >= 0.45 && isNeutralColor(rgba) && (luminance(rgba) < 0.36 || luminance(rgba) > 0.85)) {
            writes.push([el, radius >= 6 ? 'header-pill' : 'header-clean']);
          }
          continue;
        }
        if (hasGrad || (rgba && rgba.a >= 0.65 && isNeutralColor(rgba))) {
          if (!hasGrad && radius >= 10 && isTopRightZone && r.width <= 120) {
            writes.push([el, 'header-pill']);
          } else if (hasGrad || radius < 10) {
            writes.push([el, 'header-clean']);
          }
        }
      }
      for (const [el, val] of writes) {
        if (el.getAttribute('data-ag-surface') !== val) el.setAttribute('data-ag-surface', val);
      }
    }

    function scanSurfaces() {
      const p = state.prefs;
      if (!p || !p.enabled) {
        clearSurfaceTags(false);
        return;
      }
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;

      // 0. Always identify & protect native opaque overlays (e.g. Settings modal/sheet) FIRST
      scanNativeOverlays(vw, vh);

      if (p.renderMode !== 'glass') {
        clearSurfaceTags(false);
        scanNativeOverlays(vw, vh);
        const rootEl = document.getElementById('root') || document.body;
        if (rootEl) rootEl.setAttribute('data-ag-chat-root', '1');
        // Tag left sidebar in overlay mode so textTone / userBubble rules cleanly exclude sidebar items
        const overlaySidebars = findLeftSidebarElements(vw, vh);
        for (const sb of overlaySidebars) sb.setAttribute('data-ag-sidebar', '1');
        scanHeaderClean(rootEl, vw);
        scanInputBox(p);
        scanUserBubbles(vw);
        syncTriggerButton();
        return;
      }

      // Incrementally prune only stale structural tags instead of tearing down active backdrop-filter layers
      pruneStaleStructuralTags(vw, vh);

      // 1. Safely elevate ONLY the real non-fixed app shell direct child of body (NEVER fixed pets/modals/portals!)
      if (document.body) {
        for (const child of Array.from(document.body.children)) {
          if (isProtectedElement(child)) continue;
          if (child.tagName !== 'DIV' && child.tagName !== 'MAIN') continue;
          let st;
          try { st = window.getComputedStyle(child); } catch { continue; }
          if (!st || st.position === 'fixed' || st.position === 'absolute') continue;
          const rect = child.getBoundingClientRect();
          if (rect.width >= vw * 0.45 && rect.height >= vh * 0.45) {
            child.setAttribute('data-ag-app-shell', '1');
          }
        }
      }

      // 2. Input box frosted glass (respects user toggle p.glassInputBox)
      const inputBox = scanInputBox(p);

      // 3. Tag verified composer dock region & remove bottom/top chat scroll-fade black gradient masks around inputBox
      if (inputBox) {
        const boxRect = inputBox.getBoundingClientRect();
        let composerRegion = null;
        let cur = inputBox;
        for (let depth = 0; cur && depth < 9 && cur !== document.body; depth++) {
          const nearRect = depth <= 3 ? boxRect : null;
          if (!isProtectedElement(cur)) {
            if (depth >= 1 && depth <= 3 && cur.tagName !== 'MAIN' && !cur.querySelector('[data-testid="conversation-view"]')) {
              const cr = cur.getBoundingClientRect();
              if (cr.height <= Math.max(260, boxRect.height + 140) && cr.width >= boxRect.width * 0.85) {
                composerRegion = cur;
              }
            }
            let st;
            try { st = window.getComputedStyle(cur); } catch {}
            if (st && hasNeutralGradient(st.backgroundImage)) {
              cur.setAttribute('data-ag-fade-mask', 'self');
              learnFadeSelector(cur);
            }
            tagFadeMaskIfMatched(cur, vw, nearRect);
            // Check siblings and their direct children (scroll fade overlays often sit at bottom of chat wrapper)
            for (const sib of Array.from(cur.children)) {
              if (sib === inputBox || sib.contains(inputBox)) continue;
              tagFadeMaskIfMatched(sib, vw, nearRect);
              for (const grand of Array.from(sib.children)) {
                tagFadeMaskIfMatched(grand, vw, nearRect);
              }
            }
          }
          cur = cur.parentElement;
        }
        if (composerRegion && composerRegion.getAttribute('data-ag-composer-region') !== '1') {
          const prevRegions = document.querySelectorAll('[data-ag-composer-region="1"]');
          for (const pr of prevRegions) {
            if (pr !== composerRegion) pr.removeAttribute('data-ag-composer-region');
          }
          composerRegion.setAttribute('data-ag-composer-region', '1');
        }
      }

      // Fast targeted scan for Tailwind v3/v4 or inline gradient fade strips at any DOM depth
      const gradNodes = document.querySelectorAll('[class*="gradient"], [class*="linear-to"], [style*="gradient"]');
      for (const el of gradNodes) {
        tagFadeMaskIfMatched(el, vw, null);
      }

      // 4. Inspect structural containers to gently lift opaque neutral canvases
      const candidates = document.querySelectorAll(
        'body > div, #root, #root > div, #root > div > div, #app, main, aside, nav, header, section, [role="main"], [class*="sidebar"], [class*="Sidebar"]'
      );

      for (const el of candidates) {
        if (isProtectedElement(el)) continue;
        if (inputBox && (el === inputBox || inputBox.contains(el))) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 24) continue;

        tagFadeMaskIfMatched(el, vw, null);

        const prevTag = el.getAttribute('data-ag-surface');
        if (prevTag) continue;

        let st;
        try { st = window.getComputedStyle(el); } catch { continue; }
        if (!st || st.display === 'none' || st.visibility === 'hidden' || st.position === 'fixed') continue;

        const rgba = parseRgba(st.backgroundColor);
        if (!rgba || rgba.a < 0.75 || !isNeutralColor(rgba)) continue;

        const wRatio = rect.width / vw;
        const hRatio = rect.height / vh;
        const tag = el.tagName;
        const holdsInput = Boolean(inputBox && el.contains(inputBox));
        const isEdgeDocked = rect.left < 68 || rect.right > vw - 68;

        // Large canvas wrappers (main shell, chat area) -> transparent so wallpaper shines through
        if ((wRatio >= 0.48 && hRatio >= 0.45) || (holdsInput && wRatio >= 0.28 && hRatio >= 0.35)) {
          el.setAttribute('data-ag-surface', 'canvas');
        } else if (
          !holdsInput && (
            tag === 'ASIDE' ||
            tag === 'NAV' ||
            tag === 'HEADER' ||
            (isEdgeDocked && rect.width >= 150 && rect.width <= 540 && hRatio >= 0.5) ||
            (rect.top < 80 && wRatio >= 0.45 && rect.height <= 90)
          )
        ) {
          el.setAttribute('data-ag-surface', 'panel');
        }
      }

      // 4b. Anchor-based guaranteed chat canvas transparency: walk UP from agent-input-box and [data-testid="conversation-view"] to #root!
      // Also tag the persistent main chat pane wrapper (outermost ancestor excluding left sidebar) with data-ag-main-pane="1"
      // so newly-mounted cold conversation loading/bottom wrappers are 0ms transparent via pure CSS!
      const knownSidebars = findLeftSidebarElements(vw, vh);
      const chatAnchors = [
        inputBox,
        ...Array.from(document.querySelectorAll('[data-testid="conversation-view"]'))
      ].filter(Boolean);
      let persistentMainPane = null;
      for (const anchorEl of chatAnchors) {
        if (!isProtectedElement(anchorEl) && anchorEl !== inputBox) {
          anchorEl.setAttribute('data-ag-surface', 'canvas');
        }
        let anc = anchorEl.parentElement;
        for (let up = 0; anc && up < 18 && anc !== document.body && anc !== document.documentElement; up++) {
          if (!isProtectedElement(anc)) {
            const ar = anc.getBoundingClientRect();
            if (ar.width >= vw * 0.38 && ar.height >= vh * 0.35) {
              anc.setAttribute('data-ag-surface', 'canvas');
              const holdsSidebar = knownSidebars.some((sb) => anc === sb || anc.contains(sb));
              if (!holdsSidebar && ar.width >= vw * 0.42 && ar.height >= vh * 0.5) {
                persistentMainPane = anc;
              }
              // Also clear any large sibling containers and their large inner scroll viewports (e.g. message scroll area above inputBox)
              if (anc.children) {
                for (let c = 0; c < anc.children.length; c++) {
                  const sib = anc.children[c];
                  if (sib === inputBox || (inputBox && sib.contains(inputBox)) || isProtectedElement(sib)) continue;
                  const sr = sib.getBoundingClientRect();
                  if (sr.width >= vw * 0.38 && sr.height >= vh * 0.25) {
                    sib.setAttribute('data-ag-surface', 'canvas');
                    const innerScrolls = sib.querySelectorAll('div, main, section');
                    const innerLim = Math.min(innerScrolls.length, 180);
                    for (let k = 0; k < innerLim; k++) {
                      const inEl = innerScrolls[k];
                      if (isProtectedElement(inEl) || inEl.closest('pre, table, [data-ag-surface="user-bubble"]')) continue;
                      const ir = inEl.getBoundingClientRect();
                      if (ir.width >= vw * 0.38 && ir.height >= vh * 0.25) {
                        inEl.setAttribute('data-ag-surface', 'canvas');
                      }
                    }
                  }
                }
              }
            }
          }
          anc = anc.parentElement;
        }
      }
      if (persistentMainPane && persistentMainPane.getAttribute('data-ag-main-pane') !== '1') {
        const oldMainPanes = document.querySelectorAll('[data-ag-main-pane="1"]');
        for (const om of oldMainPanes) {
          if (om !== persistentMainPane) om.removeAttribute('data-ag-main-pane');
        }
        persistentMainPane.setAttribute('data-ag-main-pane', '1');
      }

      // 5. Deep geometric-pruned scan of layout containers (capped for smooth pane open/close animations)
      const rootEl = document.getElementById('root') || document.querySelector('[data-ag-app-shell="1"]') || document.body;
      if (rootEl) {
        const divs = rootEl.querySelectorAll('div, main, section');
        const limit = Math.min(divs.length, 560);
        for (let i = 0; i < limit; i++) {
          const el = divs[i];
          if (el.hasAttribute('data-ag-surface') || (el.children && el.children.length === 0 && !el.className)) continue;
          if (isProtectedElement(el)) continue;
          if (inputBox && (el === inputBox || inputBox.contains(el))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < vw * 0.16 || rect.height < 10) continue;

          tagFadeMaskIfMatched(el, vw, null);

          if (rect.height < 44) continue;
          let st;
          try { st = window.getComputedStyle(el); } catch { continue; }
          if (!st || st.position === 'fixed') continue;
          const rgba = parseRgba(st.backgroundColor);
          if (!rgba || rgba.a < 0.75 || !isNeutralColor(rgba)) continue;

          const wRatio = rect.width / vw;
          const hRatio = rect.height / vh;
          const holdsInput = Boolean(inputBox && el.contains(inputBox));
          const isEdgeDocked = rect.left < 68 || rect.right > vw - 68;
          if (el.closest('pre, code, table, [data-ag-surface="user-bubble"]')) continue;
          if ((wRatio >= 0.48 && hRatio >= 0.45) || (holdsInput && wRatio >= 0.28 && hRatio >= 0.35)) {
            el.setAttribute('data-ag-surface', 'canvas');
          } else if (!holdsInput && isEdgeDocked && rect.width >= 150 && rect.width <= 560 && hRatio >= 0.5) {
            el.setAttribute('data-ag-surface', 'panel');
          }
        }
      }

      // 6. Clean opaque black/white strips, sticky headers ("项目列表"/"会话列表"), project folders & hover gradients inside left sidebar
      // Read geometry/styles first, then batch DOM writes to avoid interleaved layout thrashing
      const sidebarPanels = knownSidebars.length ? knownSidebars : findLeftSidebarElements(vw, vh);
      for (const sb of sidebarPanels) {
        if (sb.getAttribute('data-ag-sidebar') !== '1') sb.setAttribute('data-ag-sidebar', '1');
        if (sb.getAttribute('data-ag-surface') !== 'panel') {
          sb.setAttribute('data-ag-surface', 'panel');
        }
        const semanticSelectedSel = '[aria-current="page"], [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-state="active"]';
        const oldPills = sb.querySelectorAll('[data-ag-surface="sidebar-pill"]');
        for (const oldEl of oldPills) {
          if (oldEl.matches && oldEl.matches(semanticSelectedSel)) continue;
          oldEl.removeAttribute('data-ag-surface');
        }
        const sbRect = sb.getBoundingClientRect();
        const inner = sb.querySelectorAll('div, header, section, ul, li, button, nav, a, span');
        const pendingWrites = [];
        for (const el of inner) {
          const curSurf = el.getAttribute('data-ag-surface');
          if (curSurf === 'sidebar-clean' || curSurf === 'sidebar-action') continue;
          if (isProtectedElement(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 14) continue;
          let st;
          try { st = window.getComputedStyle(el); } catch { continue; }
          if (!st || st.display === 'none') continue;
          const radius = parseFloat(st.borderRadius || '0') || 0;
          const rgba = parseRgba(st.backgroundColor);
          const hasGrad = hasNeutralGradient(st.backgroundImage);

          // Small hover action overlays on list rows (e.g. [stop][pin][more] fade patch)
          if (r.width < sbRect.width * 0.56 && r.height <= 42) {
            const isHarshAction = hasGrad || (rgba && rgba.a >= 0.35 && isNeutralColor(rgba) && (luminance(rgba) < 0.32 || luminance(rgba) > 0.85));
            if (isHarshAction && el.tagName !== 'BUTTON') {
              pendingWrites.push([el, 'sidebar-action']);
            }
            continue;
          }

          if (r.width < sbRect.width * 0.56 || r.height < 18) continue;

          const isExplicitRow = el.getAttribute('data-testid') === 'conversation-row-sidebar' || el.getAttribute('data-project-card') === 'true';
          const isSticky = st.position === 'sticky';

          // Sticky section headers ("项目列表", "会话列表"), tall group wrappers & square wrappers -> always transparent!
          if ((isSticky && !isExplicitRow) || (!isExplicitRow && (radius < 4 || r.height > 64))) {
            if (isSticky || (rgba && rgba.a >= 0.15 && isNeutralColor(rgba)) || hasGrad) {
              pendingWrites.push([el, 'sidebar-clean']);
            }
          } else {
            // Skip rows already handled by semantic active CSS or currently hovered via pure CSS :hover
            if (el.matches && el.matches(semanticSelectedSel)) continue;
            if (el.getAttribute('data-testid') === 'conversation-row-sidebar' && el.matches && el.matches(':hover')) {
              continue;
            }
            // Rounded folder headers ("Gemini-thing", "antigravity-theme") & active conversation rows -> soft glass pill
            const minAlpha = isExplicitRow ? 0.05 : 0.18;
            const isHarshSolid = rgba && rgba.a >= minAlpha && isNeutralColor(rgba) && (luminance(rgba) < 0.36 || luminance(rgba) > 0.82);
            if (isHarshSolid) {
              pendingWrites.push([el, 'sidebar-pill']);
            }
          }
        }
        for (const [el, val] of pendingWrites) {
          if (el.getAttribute('data-ag-surface') !== val) el.setAttribute('data-ag-surface', val);
        }
      }

      // 7. Clean small opaque black wrappers & horizontal fade gradients in top titlebar / header icons (top <= 96px)
      scanHeaderClean(rootEl, vw);

      // Ensure at least one chat root is tagged for textTone / textShadow rules
      if (rootEl && !document.querySelector('[data-ag-surface="canvas"]')) {
        rootEl.setAttribute('data-ag-chat-root', '1');
      }

      // 8. Identify user-sent message bubbles (right-aligned rounded pills inside chat canvas)
      scanUserBubbles(vw);

      // 9. Post-scan safety net: protect any remaining un-transparentized dark/light native panels & soften clashing chat controls
      scanClashingNativeSurfaces(vw, vh);
      scanClashingChatControls(null, false);

      syncTriggerButton();
    }

    function isRightAlignedBubble(el) {
      let cur = el;
      for (let d = 0; cur && d < 4 && cur !== document.body; d++) {
        const cls = typeof cur.className === 'string' ? cur.className : '';
        if (/\b(self-end|ml-auto|justify-end|items-end)\b/.test(cls)) return true;
        let st;
        try { st = window.getComputedStyle(cur); } catch { break; }
        if (d === 0 && (st.alignSelf === 'flex-end' || st.alignSelf === 'end')) return true;
        if (d > 0 && (st.justifyContent === 'flex-end' || st.justifyContent === 'end' || st.alignItems === 'flex-end' || st.alignItems === 'end')) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    }

    function ensureUserStepObserver() {
      if (state.userStepIo || typeof IntersectionObserver !== 'function') return state.userStepIo;
      try {
        state.userStepIo = new IntersectionObserver((entries) => {
          const newlyVisible = [];
          for (const entry of entries) {
            const el = entry.target;
            if (!el) continue;
            if (entry.isIntersecting) {
              if (el.getAttribute('data-ag-bubble-checked') === '1') {
                try { state.userStepIo.unobserve(el); } catch {}
                state.visibleUserSteps.delete(el);
              } else {
                state.visibleUserSteps.add(el);
                newlyVisible.push(el);
              }
            } else {
              state.visibleUserSteps.delete(el);
            }
          }
          if (newlyVisible.length > 0 && state.prefs && state.prefs.enabled) {
            scanUserBubbles(window.innerWidth || 1280, true, { targetRoots: newlyVisible });
          }
        }, { rootMargin: '320px 0px 320px 0px', threshold: 0 });
      } catch {
        state.userStepIo = null;
      }
      return state.userStepIo;
    }

    function observeUncheckedUserSteps(list) {
      const io = ensureUserStepObserver();
      if (!io || !list) return;
      for (const step of list) {
        if (!step || step.nodeType !== 1 || state.observedUserSteps.has(step)) continue;
        if (step.getAttribute('data-ag-bubble-checked') === '1') continue;
        state.observedUserSteps.add(step);
        try { io.observe(step); } catch {}
      }
    }

    /**
     * O(log N) binary search over vertically-ordered DOM nodes to find the first node whose bottom >= -320
     * and scan ONLY nodes whose top <= vh + 320 (avoids O(N) getBoundingClientRect sweeps on long chats!).
     */
    function collectVisibleSliceByBinarySearch(nodes, vh) {
      const n = nodes.length;
      if (n === 0) return [];
      const minBottom = -320;
      const maxTop = vh + 320;
      if (n <= 12) {
        const res = [];
        for (let i = 0; i < n; i++) {
          const r = nodes[i].getBoundingClientRect();
          if (r.bottom >= minBottom && r.top <= maxTop) res.push(nodes[i]);
        }
        return res;
      }
      // Binary search for first element with rect.bottom >= minBottom
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        const r = nodes[mid].getBoundingClientRect();
        if (r.bottom < minBottom) lo = mid + 1;
        else hi = mid;
      }
      const visible = [];
      for (let i = lo; i < n; i++) {
        const r = nodes[i].getBoundingClientRect();
        if (r.top > maxTop) break;
        if (r.bottom >= minBottom) visible.push(nodes[i]);
      }
      return visible;
    }

    function scanUserBubbles(vw, fastOnly, scanOpts) {
      const p = state.prefs;
      if (!p || (!p.userBubbleEnabled && (!p.textTone || p.textTone === 'auto'))) return;
      const vh = window.innerHeight || 800;
      const viewportOnly = Boolean(scanOpts && scanOpts.viewportOnly);
      const targetRoots = scanOpts && Array.isArray(scanOpts.targetRoots) && scanOpts.targetRoots.length > 0
        ? scanOpts.targetRoots.filter((n) => n && n.isConnected && !isProtectedElement(n))
        : null;

      // Always scope to the chat container when available instead of scanning the entire host root
      const chatScope = document.querySelector('[data-testid="conversation-view"]')
        || document.querySelector('[data-ag-main-pane="1"]')
        || document.getElementById('root')
        || document.querySelector('[data-ag-app-shell="1"]')
        || document.body;
      if (!chatScope) return;
      const scopes = targetRoots || [chatScope];
      const inputBox = document.querySelector('[data-testid="agent-input-box"]');

      const markStepChecked = (step) => {
        step.setAttribute('data-ag-bubble-checked', '1');
        state.visibleUserSteps.delete(step);
        if (state.userStepIo) {
          try { state.userStepIo.unobserve(step); } catch {}
        }
      };

      const processUserStep = (step) => {
        if (!step || isProtectedElement(step)) return;
        if (step.getAttribute('data-ag-bubble-checked') === '1') return;
        if (step.getAttribute('data-ag-surface') === 'user-bubble' || step.querySelector('[data-ag-surface="user-bubble"]')) {
          markStepChecked(step);
          return;
        }
        const stepEls = [step, ...Array.from(step.querySelectorAll('div'))];
        let matched = false;
        for (const el of stepEls) {
          if (isProtectedElement(el)) continue;
          if (el.querySelector('button, textarea, input, [contenteditable="true"]')) continue;
          let st;
          try { st = window.getComputedStyle(el); } catch { continue; }
          if (!st || st.display === 'none') continue;
          const radius = parseFloat(st.borderRadius || '0') || 0;
          const rgba = parseRgba(st.backgroundColor);
          if (radius >= 10 && rgba && rgba.a >= 0.2) {
            el.setAttribute('data-ag-surface', 'user-bubble');
            learnUserBubbleSelector(el);
            matched = true;
            break;
          }
        }
        if (!matched && (step.textContent || '').trim()) {
          step.setAttribute('data-ag-surface', 'user-bubble');
          matched = true;
        }
        if (matched) markStepChecked(step);
      };

      // 1. Deterministic pass via Antigravity's official [data-testid="user-input-step"] attribute
      let foundStepCount = 0;
      if (viewportOnly && !targetRoots) {
        if (state.userStepIo) {
          // Zero offscreen getBoundingClientRect calls: process ONLY steps currently intersecting viewport!
          for (const step of Array.from(state.visibleUserSteps)) {
            if (!step || !step.isConnected) {
              state.visibleUserSteps.delete(step);
              continue;
            }
            foundStepCount++;
            processUserStep(step);
          }
        } else {
          // Fallback without IntersectionObserver: O(log N) binary search over unchecked steps (never O(N) full sweep!)
          const unchecked = chatScope.querySelectorAll('[data-testid="user-input-step"]:not([data-ag-bubble-checked="1"])');
          foundStepCount = unchecked.length;
          const visibleSteps = collectVisibleSliceByBinarySearch(unchecked, vh);
          for (const step of visibleSteps) {
            processUserStep(step);
          }
        }
      } else {
        const io = ensureUserStepObserver();
        for (const sc of scopes) {
          if (sc.matches && sc.matches('[data-testid="user-input-step"]:not([data-ag-bubble-checked="1"])')) {
            foundStepCount++;
            processUserStep(sc);
          }
          const userSteps = sc.querySelectorAll('[data-testid="user-input-step"]:not([data-ag-bubble-checked="1"])');
          foundStepCount += userSteps.length;
          if (io && userSteps.length > 24 && !targetRoots) {
            // Long history initial load: observe all unchecked steps and immediately process only visible slice!
            observeUncheckedUserSteps(userSteps);
            const visibleSteps = collectVisibleSliceByBinarySearch(userSteps, vh);
            for (const step of visibleSteps) {
              processUserStep(step);
            }
          } else {
            for (const step of userSteps) {
              processUserStep(step);
            }
          }
        }
      }

      // 2. Fast path: any new bubble inside chatScope matching already-learned bubble selectors immediately gets data-ag-surface="user-bubble"
      if (state.learnedBubbleSelectors.size > 0) {
        const joinedSel = Array.from(state.learnedBubbleSelectors).map((s) => `${s}:not([data-ag-surface="user-bubble"])`).join(',');
        for (const sc of scopes) {
          try {
            if (sc.matches && sc.matches(joinedSel)) {
              if (!isProtectedElement(sc) && !(inputBox && (sc === inputBox || inputBox.contains(sc) || sc.contains(inputBox))) && !sc.closest('header, nav, aside, [data-ag-sidebar="1"], [data-ag-surface="panel"], [data-ag-surface="input-card"], pre, button, [role="dialog"], [role="menu"]')) {
                sc.setAttribute('data-ag-surface', 'user-bubble');
              }
            }
            const rawMatches = sc.querySelectorAll(joinedSel);
            const matches = viewportOnly ? collectVisibleSliceByBinarySearch(rawMatches, vh) : rawMatches;
            for (const el of matches) {
              if (el.getAttribute('data-ag-surface') === 'user-bubble') continue;
              if (isProtectedElement(el)) continue;
              if (inputBox && (el === inputBox || inputBox.contains(el) || el.contains(inputBox))) continue;
              if (el.closest('header, nav, aside, [data-ag-sidebar="1"], [data-ag-surface="panel"], [data-ag-surface="input-card"], pre, button, [role="dialog"], [role="menu"]')) continue;
              el.setAttribute('data-ag-surface', 'user-bubble');
            }
          } catch {}
        }
      }

      // Skip expensive fallback heuristic sweep on incremental/scroll passes or once official/learned selectors already work
      if (fastOnly || targetRoots || foundStepCount > 0 || state.learnedBubbleSelectors.size > 0 || chatScope.querySelector('[data-testid="user-input-step"]')) {
        return;
      }

      // 3. Heuristic fallback pass strictly within chatScope for right-aligned user bubbles without [data-testid="user-input-step"]
      const candidates = chatScope.querySelectorAll('div');
      const candLim = Math.min(candidates.length, 480);
      for (let i = 0; i < candLim; i++) {
        const el = candidates[i];
        if (el.getAttribute('data-ag-surface') === 'user-bubble') continue;
        // User message bubbles are compact leaf/shallow cards; skip huge layout wrappers before calling getBoundingClientRect/getComputedStyle
        if (el.children && el.children.length > 18) continue;
        if (isProtectedElement(el)) continue;
        if (el.closest('header, nav, aside, [data-ag-sidebar="1"], [data-ag-surface="panel"], [data-ag-surface="input-card"], pre, button, [role="dialog"], [role="menu"]')) continue;
        if (inputBox && (el === inputBox || inputBox.contains(el) || el.contains(inputBox))) continue;

        const r = el.getBoundingClientRect();
        // NEVER filter by r.top < 72: bubbles scrolled above viewport have negative r.top, and bubbles near the top edge have 0 <= r.top < 72!
        if (r.width < 32 || r.width > vw * 0.86 || r.height < 24) continue;

        let st;
        try { st = window.getComputedStyle(el); } catch { continue; }
        if (!st || st.display === 'none' || st.position === 'fixed') continue;

        const radius = parseFloat(st.borderRadius || '0') || 0;
        if (radius < 12) continue;

        const rgba = parseRgba(st.backgroundColor);
        if (!rgba || rgba.a < 0.55 || !isNeutralColor(rgba)) continue;

        if (el.querySelector('button, textarea, input, [contenteditable="true"], [data-testid="agent-input-box"]')) continue;
        if (!(el.textContent || '').trim()) continue;

        if (isRightAlignedBubble(el)) {
          el.setAttribute('data-ag-surface', 'user-bubble');
          learnUserBubbleSelector(el);
        }
      }
    }

    function scheduleSurfaceScan(delayMs) {
      const minCooldown = 260;
      const now = Date.now();
      const sinceLast = now - (state.lastFullScanAt || 0);
      const baseDelay = delayMs === undefined ? 260 : delayMs;
      const d = (delayMs === 0) ? 0 : Math.max(baseDelay, minCooldown - sinceLast);
      const targetDue = now + d;
      // Prevent continuous startup/streaming DOM mutations from starving or flooding scanSurfaces!
      if (state.scanTimer && state.scanDueAt && state.scanDueAt <= targetDue + 30) {
        return;
      }
      if (state.scanTimer) clearTimeout(state.scanTimer);
      state.scanDueAt = targetDue;
      state.scanTimer = setTimeout(() => {
        state.scanTimer = null;
        state.scanDueAt = 0;
        state.lastFullScanAt = Date.now();
        const dark = detectDarkMode();
        if (dark !== state.isDark) {
          state.isDark = dark;
          resampleActiveWallpaper(false, true);
          applyDynamicCss();
          syncDrawerThemeAttr();
        }
        scanSurfaces();
      }, d);
    }

    // ---- Base Static CSS (Backdrop + Drawer Studio UI) ----
    const BASE_CSS = `
      /* Backdrop Layer */
      #ag-theme-studio-backdrop {
        position: fixed;
        inset: 0;
        pointer-events: none;
        overflow: hidden;
        opacity: 0;
        transition: opacity 0.28s ease;
        z-index: 0;
      }
      html[data-ag-theme-active="glass"] #ag-theme-studio-backdrop {
        opacity: 1;
        z-index: 0;
      }
      html[data-ag-theme-active="overlay"] #ag-theme-studio-backdrop {
        opacity: 1;
        z-index: 18;
      }
      #ag-theme-studio-backdrop .ag-bg-media,
      #ag-theme-studio-backdrop .ag-bg-gradient {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        user-select: none;
        transition: opacity 0.25s ease, filter 0.2s ease;
      }
      #ag-theme-studio-backdrop .ag-bg-scrim {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: background 0.25s ease;
      }
      #ag-theme-studio-backdrop .ag-bg-vignette {
        position: absolute;
        inset: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }

      /* Smart Glass Mode Layout Transparency */
      html[data-ag-theme-active="glass"],
      html[data-ag-theme-active="glass"] body {
        background-color: transparent !important;
        background-image: none !important;
      }
      /* Only elevate the main non-fixed app shell; NEVER touch fixed overlays/pets/modals */
      html[data-ag-theme-active="glass"] #root,
      html[data-ag-theme-active="glass"] #app,
      html[data-ag-theme-active="glass"] [data-ag-app-shell="1"] {
        position: relative;
        z-index: 1;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="canvas"] {
        background-color: transparent !important;
        background-image: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="panel"] {
        background-color: var(--ag-glass-panel-bg) !important;
        backdrop-filter: blur(var(--ag-panel-blur)) !important;
        -webkit-backdrop-filter: blur(var(--ag-panel-blur)) !important;
      }
      html[data-ag-theme-active="glass"][data-ag-panel-blur="0"] [data-ag-surface="panel"],
      html[data-ag-theme-active="glass"][data-ag-panel-blur="0"] [data-ag-surface="input-card"],
      html[data-ag-theme-active="glass"][data-ag-panel-blur="0"] [data-ag-surface="user-bubble"],
      html[data-ag-theme-active="glass"][data-ag-panel-blur="0"] [data-ag-surface="sidebar-action"] {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      html[data-ag-theme-active] [data-ag-surface="input-card"] {
        background-color: var(--ag-glass-input-bg) !important;
        border: 1px solid var(--ag-glass-input-border) !important;
        outline: none !important;
        backdrop-filter: blur(var(--ag-panel-blur)) saturate(1.22) !important;
        -webkit-backdrop-filter: blur(var(--ag-panel-blur)) saturate(1.22) !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14) !important;
      }
      html[data-ag-theme-active] [data-ag-surface="input-shell"],
      html[data-ag-theme-active] [data-ag-surface="input-inner"] {
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
        outline: none !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      /* Positive 0ms pure-CSS elimination strictly on verified chat shells & composer docks (NEVER clears arbitrary role-less native panels!) */
      html[data-ag-theme-active="glass"] [data-testid="conversation-view"],
      html[data-ag-theme-active="glass"] :is(div, main, section):has([data-testid="conversation-view"], [data-testid="planner-response-text"]):not([data-ag-surface="panel"]):not([data-ag-sidebar="1"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([data-ag-surface="input-card"]):not([data-ag-surface="user-bubble"]):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *),
      html[data-ag-theme-active="glass"] :is(div, main, section, footer, form):has([data-testid="agent-input-box"]):not([data-ag-surface="input-card"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *),
      html[data-ag-theme-active="glass"] :is(div, main, section, footer, form):has([data-testid="agent-input-box"]):not([data-ag-surface="input-card"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *)::before,
      html[data-ag-theme-active="glass"] :is(div, main, section, footer, form):has([data-testid="agent-input-box"]):not([data-ag-surface="input-card"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *)::after,
      html[data-ag-theme-active="glass"] :is(div, main, section, footer, form):has(> [data-testid="agent-input-box"]) > :is(div, span):is([data-ag-fade-mask], [class*="pointer-events-none"]:is([class*="gradient-to-"], [class*="linear-to-"], [class*="from-"], [class*="fade"], [class*="scrim"], [class*="mask"])):not([data-testid="agent-input-box"]):not([data-ag-surface="input-card"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([role="listbox"]):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *),
      html[data-ag-theme-active="glass"] :is(div, main, section, footer, form):has(> * > [data-testid="agent-input-box"]) > :is(div, span):is([data-ag-fade-mask], [class*="pointer-events-none"]:is([class*="gradient-to-"], [class*="linear-to-"], [class*="from-"], [class*="fade"], [class*="scrim"], [class*="mask"])):not(:has([data-testid="agent-input-box"])):not(:has([data-testid="conversation-view"], [data-testid="planner-response-text"], [data-testid="user-input-step"])):not([data-ag-surface="input-card"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([role="listbox"]):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *),
      html[data-ag-theme-active="glass"][data-ag-glass-input="1"] [data-testid="agent-input-box"]:not([data-ag-surface="input-card"]),
      html[data-ag-theme-active="glass"] [data-testid="agent-input-box"]::before,
      html[data-ag-theme-active="glass"] [data-testid="agent-input-box"]::after {
        background-color: transparent !important;
        background-image: none !important;
        box-shadow: none !important;
      }
      /* 0ms pure-CSS elimination of square black sticky wrappers around project groups & sidebar rows on boot / expand */
      html[data-ag-theme-active="glass"] [data-ag-surface="sidebar-clean"],
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-testid="project-group"],
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-testid="project-group"] :is(div, header, section, ul, li):not([data-project-card="true"]):not([data-testid="conversation-row-sidebar"]):not([data-ag-surface="sidebar-pill"]):not([data-ag-surface="sidebar-action"]),
      html[data-ag-theme-active="glass"] :is(aside, nav, [data-ag-sidebar="1"], [data-ag-surface="panel"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *) :is(div, header, section, ul, li):has([data-project-card="true"], [data-testid="conversation-row-sidebar"]):not([data-project-card="true"]):not([data-testid="conversation-row-sidebar"]):not([data-ag-surface="sidebar-pill"]):not([data-ag-surface="panel"]):not([data-ag-sidebar="1"]),
      html[data-ag-theme-active="glass"] :is(aside, nav, [data-ag-sidebar="1"], [data-ag-surface="panel"]):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *) [class*="sticky"]:not([data-project-card="true"]):not([data-testid="conversation-row-sidebar"]):not([data-ag-surface="sidebar-pill"]) {
        background-color: transparent !important;
        background-image: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="sidebar-pill"],
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-project-card="true"],
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-testid="conversation-row-sidebar"]:is([aria-current="page"], [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-state="active"]) {
        background-color: var(--ag-glass-sidebar-pill) !important;
        background-image: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-project-card="true"] :is(div, span, button, a):not([data-ag-surface="sidebar-action"]) {
        background-color: transparent !important;
        background-image: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="sidebar-pill"]:hover,
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-project-card="true"]:hover,
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [data-testid="conversation-row-sidebar"]:hover {
        background-color: var(--ag-glass-sidebar-pill-hover) !important;
        background-image: none !important;
      }
      [data-ag-measuring="1"],
      [data-ag-measuring="1"] * {
        transition: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="sidebar-action"],
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [class*="gradient"]:not([class*="pointer-events-none"]),
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] [class*="linear-to"]:not([class*="pointer-events-none"]) {
        background-image: none !important;
        background-color: var(--ag-glass-sidebar-action) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        border-radius: 6px !important;
      }
      /* 0ms suppression for sibling hover-action bars next to conversation rows (e.g. [↓][📌][⋮] black gradient overlay) */
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] :has(> [data-testid="conversation-row-sidebar"]) > :not([data-testid="conversation-row-sidebar"]),
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] :has(> [data-testid="conversation-row-sidebar"]) > :not([data-testid="conversation-row-sidebar"]) :is(div, span),
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] :has(> [data-project-card="true"]) > :not([data-project-card="true"]),
      html[data-ag-theme-active="glass"] [data-ag-sidebar="1"] :has(> [data-project-card="true"]) > :not([data-project-card="true"]) :is(div, span) {
        background-image: none !important;
      }
      html[data-ag-theme-active] [data-ag-surface="header-clean"] {
        background-color: transparent !important;
        background-image: none !important;
      }
      html[data-ag-theme-active] [data-ag-surface="header-pill"] {
        background-color: var(--ag-glass-sidebar-pill) !important;
        background-image: none !important;
      }
      html[data-ag-theme-active] [data-ag-surface="header-pill"]:hover {
        background-color: var(--ag-glass-sidebar-pill-hover) !important;
      }
      /* Adaptive frosted chat controls (e.g. Markdown Preview/Raw segmented pill & Scroll-to-Bottom FAB) */
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill-track"] {
        background-color: var(--ag-chat-pill-track) !important;
        background-image: none !important;
        border: 1px solid var(--ag-chat-pill-border) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill-track"] button:not([data-ag-surface="chat-pill"]) {
        background-color: transparent !important;
        color: var(--ag-chat-pill-muted) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill-track"] button:not([data-ag-surface="chat-pill"]):hover {
        color: var(--ag-chat-pill-fg) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill"] {
        background-color: var(--ag-chat-pill-bg) !important;
        background-image: none !important;
        color: var(--ag-chat-pill-fg) !important;
        border: 1px solid var(--ag-chat-pill-border) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill"]:hover {
        background-color: var(--ag-chat-pill-hover) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-surface="chat-pill"] :is(button, span, svg) {
        color: var(--ag-chat-pill-fg) !important;
      }
      /* Custom User Message Bubble Styling */
      html[data-ag-theme-active][data-ag-user-bubble="1"] [data-ag-surface="user-bubble"] {
        background-color: var(--ag-user-bubble-bg) !important;
        color: var(--ag-user-bubble-text) !important;
        border: 1px solid var(--ag-user-bubble-border) !important;
        backdrop-filter: blur(var(--ag-panel-blur)) saturate(1.2) !important;
        -webkit-backdrop-filter: blur(var(--ag-panel-blur)) saturate(1.2) !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.14) !important;
      }
      html[data-ag-theme-active][data-ag-user-bubble="1"] [data-ag-surface="user-bubble"] :is(p, span, div, li, strong, em, a, code):not(pre *):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *) {
        color: var(--ag-user-bubble-text) !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-fade-mask="self"] {
        background-image: none !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-fade-mask="before"]::before,
      html[data-ag-theme-active="glass"] [data-ag-fade-mask="both"]::before {
        background-image: none !important;
        background-color: transparent !important;
      }
      html[data-ag-theme-active="glass"] [data-ag-fade-mask="after"]::after,
      html[data-ag-theme-active="glass"] [data-ag-fade-mask="both"]::after {
        background-image: none !important;
        background-color: transparent !important;
      }
      /* Strictly composer-scoped 0ms suppression for pointer-events-none gradient fade strips above input box (NEVER matches Neko HUD or role-less overlays!) */
      html[data-ag-theme-active="glass"] :is([data-ag-composer-region="1"], :has(> [data-testid="agent-input-box"]), :has(> * > [data-testid="agent-input-box"])) [class*="pointer-events-none"]:is([class*="gradient-to-"], [class*="linear-to-"], [class*="from-"]):not(svg):not(svg *):not([data-ag-surface="input-card"]):not([data-ag-surface="input-card"] *):not([data-ag-native-surface="1"]):not([data-ag-native-surface="1"] *):not([role="dialog"]):not([role="dialog"] *):not([role="menu"]):not([role="menu"] *):not([id*="ag-theme"]):not([id*="ag-theme"] *):not([id*="neko"]):not([id*="neko"] *):not([id*="Neko"]):not([id*="Neko"] *) {
        background-image: none !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }
      html[data-ag-theme-active="glass"] pre {
        background-color: var(--ag-glass-code-bg) !important;
        border: 1px solid var(--ag-glass-input-border) !important;
        backdrop-filter: blur(8px) !important;
        border-radius: 10px !important;
      }
      html[data-ag-theme-active="glass"] pre > code,
      html[data-ag-theme-active="glass"] pre > div:not([role="button"]):not(button) {
        background-color: transparent !important;
      }

      /* Studio Floating Trigger (polite z-index: below dropdowns/popovers/modals!) */
      #ag-theme-studio-trigger-root {
        position: fixed !important;
        inset: 0 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: none !important;
        z-index: 25 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
        --studio-bg: rgba(14, 14, 17, 0.88);
        --studio-border: rgba(255, 255, 255, 0.11);
        --studio-text: #e4e4e7;
        --studio-blue: #2f71e3;
      }
      #ag-theme-studio-trigger-root[data-studio-theme="light"] {
        --studio-bg: rgba(255, 255, 255, 0.92);
        --studio-border: rgba(15, 23, 42, 0.12);
        --studio-text: #18181b;
        --studio-blue: #2f71e3;
      }
      #ag-theme-studio-trigger-root[data-studio-theme="glass"] {
        --studio-bg: rgba(18, 19, 26, 0.36);
        --studio-border: rgba(255, 255, 255, 0.18);
        --studio-text: #f4f4f6;
        --studio-blue: #2f71e3;
      }

      /* Studio Drawer UI - 1:1 Antigravity Official Settings Design System */
      #ag-theme-studio-ui-root {
        position: fixed !important;
        inset: 0 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: none !important;
        z-index: 2147483500 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif;
        --studio-bg: rgba(10, 10, 12, 0.96);
        --studio-group-bg: rgba(255, 255, 255, 0.015);
        --studio-border: rgba(255, 255, 255, 0.085);
        --studio-divider: rgba(255, 255, 255, 0.055);
        --studio-text: #f4f4f6;
        --studio-muted: #71717a;
        --studio-blue: #2f71e3;
        --studio-card-active-bg: rgba(47, 113, 227, 0.12);
        --studio-card-active-border: rgba(74, 144, 226, 0.48);
        --studio-pill-bg: rgba(255, 255, 255, 0.025);
        --studio-pill-active: rgba(255, 255, 255, 0.14);
        --studio-btn-bg: rgba(255, 255, 255, 0.06);
        --studio-btn-hover: rgba(255, 255, 255, 0.11);
      }
      #ag-theme-studio-ui-root[data-studio-theme="light"] {
        --studio-bg: rgba(252, 252, 253, 0.97);
        --studio-group-bg: rgba(15, 23, 42, 0.018);
        --studio-border: rgba(15, 23, 42, 0.09);
        --studio-divider: rgba(15, 23, 42, 0.06);
        --studio-text: #18181b;
        --studio-muted: #71717a;
        --studio-blue: #2f71e3;
        --studio-card-active-bg: rgba(47, 113, 227, 0.08);
        --studio-card-active-border: rgba(47, 113, 227, 0.45);
        --studio-pill-bg: rgba(15, 23, 42, 0.04);
        --studio-pill-active: rgba(15, 23, 42, 0.11);
        --studio-btn-bg: rgba(15, 23, 42, 0.055);
        --studio-btn-hover: rgba(15, 23, 42, 0.1);
      }
      #ag-theme-studio-ui-root[data-studio-theme="glass"] {
        --studio-bg: rgba(14, 15, 22, 0.36);
        --studio-group-bg: rgba(10, 11, 16, 0.24);
        --studio-border: rgba(255, 255, 255, 0.15);
        --studio-divider: rgba(255, 255, 255, 0.09);
        --studio-text: #f8fafc;
        --studio-muted: rgba(244, 244, 246, 0.72);
        --studio-blue: #2f71e3;
        --studio-card-active-bg: rgba(47, 113, 227, 0.22);
        --studio-card-active-border: rgba(96, 165, 250, 0.65);
        --studio-pill-bg: rgba(0, 0, 0, 0.22);
        --studio-pill-active: rgba(255, 255, 255, 0.22);
        --studio-btn-bg: rgba(255, 255, 255, 0.1);
        --studio-btn-hover: rgba(255, 255, 255, 0.18);
      }

      .ag-theme-trigger {
        position: fixed;
        pointer-events: auto;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        border: 1px solid var(--studio-border);
        background: var(--studio-bg);
        color: var(--studio-text);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: grab;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        opacity: 0.58;
        transition: opacity 0.16s ease, border-color 0.16s ease, background 0.16s ease;
        padding: 0;
        outline: none;
        user-select: none;
        touch-action: none;
      }
      .ag-theme-trigger:hover {
        opacity: 1;
        border-color: rgba(255, 255, 255, 0.24);
      }
      .ag-theme-trigger.dragging {
        cursor: grabbing;
        opacity: 1;
        transition: none;
      }
      .ag-theme-trigger.hidden { display: none; }

      .ag-theme-drawer-mask {
        position: fixed;
        inset: 0;
        background: transparent;
        opacity: 0;
        pointer-events: none;
      }
      .ag-theme-drawer-mask.open {
        opacity: 1;
        pointer-events: auto;
      }

      .ag-theme-drawer {
        position: fixed;
        top: 38px;
        right: 14px;
        bottom: 14px;
        width: 416px;
        max-width: calc(100vw - 28px);
        border-radius: 14px;
        border: 1px solid var(--studio-border);
        background: var(--studio-bg);
        color: var(--studio-text);
        backdrop-filter: blur(28px) saturate(1.2);
        -webkit-backdrop-filter: blur(28px) saturate(1.2);
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
        transform: translateX(calc(100% + 28px));
        transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s ease, backdrop-filter 0.18s ease, border-color 0.18s ease;
      }
      .ag-theme-drawer.open {
        transform: translateX(0);
      }
      /* Peek-Through Mode while dragging sliders */
      .ag-theme-drawer.peeking {
        background: rgba(10, 10, 12, 0.14) !important;
        backdrop-filter: blur(2px) !important;
        -webkit-backdrop-filter: blur(2px) !important;
        border-color: rgba(255, 255, 255, 0.04) !important;
        box-shadow: none !important;
      }
      .ag-theme-drawer.peeking .ag-drawer-header,
      .ag-theme-drawer.peeking .ag-drawer-tabs,
      .ag-theme-drawer.peeking .ag-drawer-footer,
      .ag-theme-drawer.peeking .ag-group-title,
      .ag-theme-drawer.peeking .ag-list-row:not(.peeking-active) {
        opacity: 0.12;
        transition: opacity 0.15s ease;
      }
      .ag-theme-drawer.peeking .ag-list-row.peeking-active {
        background: rgba(10, 10, 12, 0.82);
        border-radius: 8px;
      }

      /* Official Header Style (Strictly Aligned) */
      .ag-drawer-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 18px 22px 12px;
        flex-shrink: 0;
      }
      .ag-drawer-top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .ag-drawer-top-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }
      .ag-drawer-title {
        font-size: 18px;
        font-weight: 600;
        color: var(--studio-text);
        letter-spacing: -0.2px;
        line-height: 1.25;
      }
      .ag-drawer-subtitle {
        font-size: 12px;
        color: var(--studio-muted);
        line-height: 1.4;
      }
      .ag-close-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--studio-muted);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: color 0.15s, background 0.15s;
      }
      .ag-close-btn:hover {
        color: var(--studio-text);
        background: var(--studio-btn-bg);
      }

      /* Top Segmented Navigation Bar */
      .ag-drawer-tabs {
        padding: 0 22px 12px;
        flex-shrink: 0;
      }
      .ag-tab-bar {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        height: 32px;
        box-sizing: border-box;
        align-items: center;
        background: var(--studio-pill-bg);
        border: 1px solid var(--studio-border);
        border-radius: 999px;
        padding: 2px;
        gap: 2px;
      }
      .ag-tab-btn {
        height: 26px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--studio-muted);
        font-size: 12px;
        font-weight: 500;
        padding: 0 10px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.15s, color 0.15s;
      }
      .ag-tab-btn:hover {
        color: var(--studio-text);
      }
      .ag-tab-btn.active {
        background: var(--studio-pill-active);
        color: var(--studio-text);
        font-weight: 600;
      }

      .ag-drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 4px 22px 20px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .ag-drawer-body::-webkit-scrollbar { width: 4px; }
      .ag-drawer-body::-webkit-scrollbar-thumb {
        background: rgba(128, 128, 138, 0.25);
        border-radius: 999px;
      }

      /* Official Section Group & Divided List Box (0px flush left/right alignment) */
      .ag-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ag-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0;
      }
      .ag-group-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--studio-text);
      }
      .ag-group-hint {
        font-size: 11.5px;
        color: var(--studio-muted);
      }
      .ag-group-box {
        border: 1px solid var(--studio-border);
        border-radius: 10px;
        background: var(--studio-group-bg);
        overflow: hidden;
      }
      .ag-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        min-height: 48px;
        box-sizing: border-box;
        padding: 10px 15px;
      }
      .ag-list-row + .ag-list-row {
        border-top: 1px solid var(--studio-divider);
      }
      .ag-list-row.col {
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
        gap: 8px;
        padding: 12px 15px;
      }
      .ag-row-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .ag-row-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--studio-text);
        line-height: 1.35;
      }
      .ag-row-sub {
        font-size: 11.5px;
        color: var(--studio-muted);
        line-height: 1.35;
      }

      /* Official 2-Column Layout Cards (like "知识工作 / 软件工程") */
      .ag-layout-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      .ag-layout-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        padding: 13px 14px;
        border-radius: 10px;
        border: 1px solid var(--studio-border);
        background: var(--studio-group-bg);
        color: var(--studio-text);
        text-align: left;
        cursor: pointer;
        transition: border-color 0.16s, background 0.16s;
      }
      .ag-layout-card:hover {
        border-color: rgba(255, 255, 255, 0.18);
      }
      .ag-layout-card.active {
        background: var(--studio-card-active-bg);
        border-color: var(--studio-card-active-border);
      }
      .ag-layout-icon {
        color: var(--studio-text);
        opacity: 0.88;
        margin-bottom: 1px;
      }
      .ag-layout-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--studio-text);
      }
      .ag-layout-desc {
        font-size: 11.5px;
        color: var(--studio-muted);
        line-height: 1.38;
      }

      /* Official Toggle Switch (#2F71E3 Blue) */
      .ag-switch {
        position: relative;
        width: 40px;
        height: 22px;
        border-radius: 999px;
        background: rgba(128, 128, 138, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.08);
        cursor: pointer;
        transition: background 0.18s, border-color 0.18s;
        flex-shrink: 0;
        padding: 0;
      }
      .ag-switch::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .ag-switch[aria-checked="true"] {
        background: var(--studio-blue);
        border-color: var(--studio-blue);
      }
      .ag-switch[aria-checked="true"]::after {
        transform: translateX(18px);
      }

      /* Official Segmented Pill Control (Unified 28px height for crisp horizontal alignment) */
      .ag-pill-seg {
        display: inline-flex;
        align-items: center;
        height: 28px;
        box-sizing: border-box;
        background: var(--studio-pill-bg);
        border: 1px solid var(--studio-border);
        border-radius: 999px;
        padding: 2px;
        gap: 2px;
        flex-shrink: 0;
      }
      .ag-pill-btn {
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--studio-muted);
        font-size: 11.5px;
        font-weight: 500;
        padding: 0 10px;
        border-radius: 999px;
        cursor: pointer;
        transition: background 0.14s, color 0.14s;
        white-space: nowrap;
      }
      .ag-pill-btn:hover {
        color: var(--studio-text);
      }
      .ag-pill-btn.active {
        background: var(--studio-pill-active);
        color: var(--studio-text);
        font-weight: 600;
      }

      /* Official Action Pill Button (Unified 28px height) */
      .ag-action-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 28px;
        box-sizing: border-box;
        gap: 6px;
        padding: 0 13px;
        border-radius: 999px;
        border: 1px solid var(--studio-border);
        background: var(--studio-btn-bg);
        color: var(--studio-text);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s, border-color 0.15s;
        white-space: nowrap;
      }
      .ag-action-pill:hover {
        background: var(--studio-btn-hover);
        border-color: rgba(255, 255, 255, 0.18);
      }

      /* Official Color Swatch Pill (Unified 28px height) */
      .ag-color-pill {
        position: relative;
        display: inline-flex;
        align-items: center;
        height: 28px;
        box-sizing: border-box;
        gap: 7px;
        padding: 0 11px 0 7px;
        border-radius: 999px;
        border: 1px solid var(--studio-border);
        background: var(--studio-pill-bg);
        color: var(--studio-text);
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11.5px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        flex-shrink: 0;
      }
      .ag-color-pill:hover {
        border-color: rgba(255, 255, 255, 0.22);
        background: var(--studio-btn-bg);
      }
      .ag-color-dot {
        width: 13px;
        height: 13px;
        border-radius: 3.5px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        flex-shrink: 0;
      }
      .ag-color-pill input[type="color"] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
        border: none;
        padding: 0;
      }

      /* Wallpaper Gallery Grid */
      .ag-preset-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .ag-preset-card {
        position: relative;
        border-radius: 9px;
        overflow: hidden;
        border: 1px solid var(--studio-border);
        background: var(--studio-group-bg);
        cursor: pointer;
        text-align: left;
        padding: 0;
        color: #fff;
        height: 64px;
        transition: border-color 0.16s, box-shadow 0.16s;
      }
      .ag-preset-card.featured {
        grid-column: 1 / -1;
        height: 82px;
      }
      .ag-preset-card.featured .ag-preset-thumb {
        background-position: center 22%;
      }
      .ag-preset-card:hover {
        border-color: rgba(255, 255, 255, 0.24);
      }
      .ag-preset-card.active {
        border-color: var(--studio-blue);
        box-shadow: 0 0 0 1px var(--studio-blue);
      }
      .ag-preset-thumb {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
      }
      .ag-preset-label {
        position: absolute;
        inset: auto 0 0 0;
        padding: 14px 9px 6px;
        background: linear-gradient(to top, rgba(8, 8, 12, 0.88), transparent);
      }
      .ag-preset-name {
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
      }
      .ag-preset-sub {
        font-size: 10.5px;
        color: rgba(255, 255, 255, 0.68);
      }

      /* Custom Wallpaper List Rows inside Official Group Box */
      .ag-custom-scroll {
        max-height: 152px;
        overflow-y: auto;
      }
      .ag-custom-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 9px 14px;
        font-size: 12px;
        color: var(--studio-text);
        cursor: pointer;
        transition: background 0.14s;
      }
      .ag-custom-row + .ag-custom-row {
        border-top: 1px solid var(--studio-divider);
      }
      .ag-custom-row:hover {
        background: rgba(255, 255, 255, 0.03);
      }
      .ag-custom-row.active {
        background: var(--studio-card-active-bg);
      }
      .ag-custom-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
      }
      .ag-custom-tag {
        font-size: 10.5px;
        color: var(--studio-muted);
        padding: 1px 6px;
        border-radius: 4px;
        border: 1px solid var(--studio-border);
      }
      .ag-custom-del {
        border: none;
        background: transparent;
        color: var(--studio-muted);
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
      }
      .ag-custom-del:hover {
        color: #ef4444;
        background: rgba(239, 68, 68, 0.1);
      }

      /* Clean Sliders */
      .ag-slider-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12.5px;
      }
      .ag-slider-val {
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11.5px;
        color: var(--studio-muted);
      }
      .ag-range {
        width: 100%;
        height: 4px;
        accent-color: var(--studio-blue);
        cursor: pointer;
        margin: 2px 0 0;
      }

      /* Swatches & Select & Textarea */
      .ag-swatches {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ag-swatch {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        cursor: pointer;
        padding: 0;
        transition: transform 0.12s;
      }
      .ag-swatch:hover { transform: scale(1.08); }
      .ag-swatch.active {
        border-color: #ffffff;
        box-shadow: 0 0 0 1.5px var(--studio-blue);
      }
      .ag-select {
        height: 28px;
        box-sizing: border-box;
        border-radius: 999px;
        border: 1px solid var(--studio-border);
        background: var(--studio-pill-bg);
        color: var(--studio-text);
        font-size: 12px;
        padding: 0 12px;
        outline: none;
        cursor: pointer;
      }
      .ag-select option {
        background: #141417;
        color: #f4f4f6;
      }
      .ag-textarea {
        width: 100%;
        box-sizing: border-box;
        border-radius: 8px;
        border: 1px solid var(--studio-border);
        background: rgba(0, 0, 0, 0.2);
        color: var(--studio-text);
        padding: 8px 10px;
        outline: none;
        min-height: 76px;
        resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
        font-size: 11.5px;
      }
      #ag-theme-studio-ui-root[data-studio-theme="light"] .ag-textarea {
        background: rgba(15, 23, 42, 0.03);
      }

      /* Official Bottom Link ("高级设置 >") */
      .ag-more-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: var(--studio-muted);
        background: none;
        border: none;
        padding: 2px 0;
        cursor: pointer;
        transition: color 0.15s;
      }
      .ag-more-link:hover {
        color: var(--studio-text);
      }

      .ag-drawer-footer {
        padding: 10px 22px;
        border-top: 1px solid var(--studio-divider);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: var(--studio-muted);
        flex-shrink: 0;
      }

      .ag-toast {
        position: fixed;
        bottom: 22px;
        left: 50%;
        transform: translateX(-50%) translateY(12px);
        background: rgba(16, 16, 20, 0.95);
        color: #f4f4f6;
        border: 1px solid rgba(255, 255, 255, 0.12);
        padding: 7px 15px;
        border-radius: 999px;
        font-size: 12px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.18s, transform 0.18s;
      }
      .ag-toast.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    `;

    function ensureStyleEl(id, cssText) {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('style');
        el.id = id;
        const parent = document.head || document.documentElement;
        const baseEl = id === IDS.styleCustom ? document.getElementById(IDS.styleBase) : null;
        if (baseEl && baseEl.parentNode === parent) {
          parent.insertBefore(el, baseEl);
        } else {
          parent.appendChild(el);
        }
      }
      if (cssText !== undefined && el.textContent !== cssText) {
        el.textContent = cssText;
      }
      return el;
    }

    function showToast(msg) {
      const uiRoot = document.getElementById(IDS.uiRoot);
      if (!uiRoot) return;
      const toast = uiRoot.querySelector('.ag-toast');
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      if (state.toastTimer) clearTimeout(state.toastTimer);
      state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // Compute real perceived background brightness (0..1) combining wallpaper pixels, contain-edge fill, opacity & scrim
    function computeEffectiveBgLuma() {
      const p = state.prefs;
      if (!p || !p.enabled || p.renderMode !== 'glass' || p.presetId === 'nebula-css' || state.wallpaperLuma === null) {
        return state.isDark ? 0.12 : 0.92;
      }
      // In 'contain' mode, sidebars and canvas margins sit over the sampled edge fill color
      const rawImgLuma = (p.wallpaperFit === 'contain' && state.wallpaperEdgeLuma !== null)
        ? (state.wallpaperLuma * 0.55 + state.wallpaperEdgeLuma * 0.45)
        : state.wallpaperLuma;
      const baseLuma = state.isDark ? 0.08 : 0.96;
      const opacity = p.opacity !== undefined ? p.opacity : 0.78;
      const scrim = p.scrim !== undefined ? p.scrim : 0.2;
      const afterOpacity = rawImgLuma * opacity + baseLuma * (1 - opacity);
      const scrimLuma = state.isDark ? 0.03 : 1.0;
      return afterOpacity * (1 - scrim) + scrimLuma * scrim;
    }

    // Unified visual polarity brain with hysteresis for 'auto' (prevents flicker on dynamic video wallpapers!)
    function resolveVisualDark() {
      const p = state.prefs;
      if (!p || !p.enabled || p.renderMode !== 'glass') return state.isDark;
      const rawTone = p.textTone || 'auto';
      if (rawTone === 'dark') return false;
      if (rawTone === 'light') return true;
      if (rawTone === 'custom') {
        return computeHexLuminance(p.customTextColor || '#18181b') > 0.45;
      }
      // 'auto': genuinely sense actual wallpaper + scrim brightness with hysteresis band [0.48, 0.56]
      const luma = computeEffectiveBgLuma();
      if (state.lastAutoVisualDark === true) {
        if (luma >= 0.56) state.lastAutoVisualDark = false;
      } else if (state.lastAutoVisualDark === false) {
        if (luma <= 0.48) state.lastAutoVisualDark = true;
      } else {
        state.lastAutoVisualDark = luma < 0.54;
      }
      return state.lastAutoVisualDark;
    }

    function cancelTitleBarTimers() {
      if (Array.isArray(state.titleBarTimers)) {
        for (const id of state.titleBarTimers) clearTimeout(id);
      }
      state.titleBarTimers = [];
    }

    function syncNativeTitleBar(settle, force) {
      const p = state.prefs;
      const active = Boolean(p && p.enabled);
      const effectiveDark = active ? resolveVisualDark() : state.isDark;
      const key = `${active}:${effectiveDark}`;
      if (!force && state.lastTitleBarKey === key) return;
      state.lastTitleBarKey = key;
      cancelTitleBarTimers();
      const seq = ++state.titleBarSeq;
      const send = () => {
        if (seq !== state.titleBarSeq) return;
        ipcRenderer.invoke('ag-theme:sync-titlebar', { active, isDark: effectiveDark }).catch(() => {});
      };
      send();
      if (settle && active) {
        state.titleBarTimers.push(setTimeout(send, 160));
        state.titleBarTimers.push(setTimeout(send, 520));
      }
    }

    // ---- Dynamic Style & Backdrop Rendering ----
    function applyDynamicCss() {
      const p = state.prefs;
      const html = document.documentElement;
      if (!p || !p.enabled) {
        html.removeAttribute('data-ag-theme-active');
        html.removeAttribute('data-ag-user-bubble');
        html.removeAttribute('data-ag-glass-input');
        html.removeAttribute('data-ag-panel-blur');
        ensureStyleEl(IDS.styleDynamic, '');
        ensureStyleEl(IDS.styleCustom, '');
        clearSurfaceTags();
        clearActiveMedia(false);
        syncNativeTitleBar(false, true);
        return;
      }

      const isGlass = p.renderMode === 'glass';
      html.setAttribute('data-ag-theme-active', p.renderMode);
      html.setAttribute('data-ag-glass-input', p.glassInputBox ? '1' : '0');
      html.setAttribute('data-ag-panel-blur', p.panelBlur > 0 ? '1' : '0');
      if (p.userBubbleEnabled) html.setAttribute('data-ag-user-bubble', '1');
      else html.removeAttribute('data-ag-user-bubble');

      // Unified frosted-glass surface tone matching wallpaper brightness / text tone / custom text color!
      const dark = resolveVisualDark();
      const panelRgb = dark ? '15, 16, 24' : '255, 255, 255';
      const inputRgb = dark ? '20, 21, 34' : '255, 255, 255';
      const codeRgb = dark ? '12, 13, 20' : '244, 245, 248';
      const panelAlpha = p.panelAlpha.toFixed(2);
      const inputAlpha = Math.max(0.24, Math.min(0.88, p.panelAlpha * 0.92)).toFixed(2);
      const inputBorder = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.14)';
      const codeAlpha = Math.max(0.52, Math.min(0.92, p.panelAlpha + 0.32)).toFixed(2);
      const sidebarPill = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.065)';
      const sidebarPillHover = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.11)';
      const sidebarAction = dark ? 'rgba(54, 56, 74, 0.56)' : 'rgba(244, 246, 252, 0.78)';
      const chatPillBg = dark ? 'rgba(30, 32, 46, 0.86)' : 'rgba(255, 255, 255, 0.88)';
      const chatPillHover = dark ? 'rgba(46, 49, 70, 0.94)' : 'rgba(255, 255, 255, 0.97)';
      const chatPillTrack = dark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(15, 23, 42, 0.08)';
      const chatPillBorder = dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(15, 23, 42, 0.15)';
      const chatPillFg = dark ? '#f4f4f8' : '#18181b';
      const chatPillMuted = dark ? 'rgba(244, 244, 248, 0.68)' : 'rgba(24, 24, 27, 0.64)';

      // User message bubble adaptive colors
      const bubbleRgb = hexToRgb(p.userBubbleBg || '#4c1d95');
      const bubbleAlpha = (p.userBubbleAlpha !== undefined ? p.userBubbleAlpha : 0.72).toFixed(2);
      const bubbleAutoText = computeAutoTextColor(p.userBubbleBg || '#4c1d95');
      const bubbleText = p.userBubbleTextAuto ? bubbleAutoText : (p.userBubbleText || bubbleAutoText);
      const bubbleBorder = bubbleAutoText === '#18181b' ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.16)';

      const lines = [
        `:root {`,
        `  --ag-glass-panel-bg: rgba(${panelRgb}, ${panelAlpha});`,
        `  --ag-glass-input-bg: rgba(${inputRgb}, ${inputAlpha});`,
        `  --ag-glass-input-border: ${inputBorder};`,
        `  --ag-glass-code-bg: rgba(${codeRgb}, ${codeAlpha});`,
        `  --ag-glass-sidebar-pill: ${sidebarPill};`,
        `  --ag-glass-sidebar-pill-hover: ${sidebarPillHover};`,
        `  --ag-glass-sidebar-action: ${sidebarAction};`,
        `  --ag-chat-pill-bg: ${chatPillBg};`,
        `  --ag-chat-pill-hover: ${chatPillHover};`,
        `  --ag-chat-pill-track: ${chatPillTrack};`,
        `  --ag-chat-pill-border: ${chatPillBorder};`,
        `  --ag-chat-pill-fg: ${chatPillFg};`,
        `  --ag-chat-pill-muted: ${chatPillMuted};`,
        `  --ag-user-bubble-bg: rgba(${bubbleRgb.r}, ${bubbleRgb.g}, ${bubbleRgb.b}, ${bubbleAlpha});`,
        `  --ag-user-bubble-text: ${bubbleText};`,
        `  --ag-user-bubble-border: ${bubbleBorder};`,
        `  --ag-panel-blur: ${p.panelBlur}px;`,
        `}`
      ];

      if (p.fontFamily && p.fontFamily.trim()) {
        lines.push(`body, button, input, textarea { font-family: ${p.fontFamily.trim()} !important; }`);
      }

      if (p.useAccent && p.accentColor) {
        lines.push(
          `:root { --ag-custom-accent: ${p.accentColor}; }`,
          `::selection { background: ${p.accentColor}44; }`,
          `[data-ag-surface="input-card"]:focus-within { border-color: ${p.accentColor}aa !important; box-shadow: 0 0 0 2px ${p.accentColor}33 !important; }`
        );
      }

      // Scoped chat canvas text color override:
      // In glass mode, 'auto' senses actual wallpaper brightness and automatically flips to crisp dark/light text when wallpaper conflicts with native theme!
      // In overlay mode, prevent black-on-black (dark textTone on dark native canvas) or white-on-white!
      const rawTone = p.textTone || 'auto';
      let tone = rawTone;
      if (!isGlass) {
        if ((state.isDark && rawTone === 'dark') || (!state.isDark && rawTone === 'light')) {
          tone = 'auto';
        }
      } else if (rawTone === 'auto' && dark !== state.isDark) {
        // Wallpaper brightness opposes native app theme (e.g. Dark Mode + bright white wallpaper -> auto dark text!)
        tone = dark ? 'light' : 'dark';
      }
      const includeGlassPanels = isGlass && p.panelAlpha < 0.62;
      const scope = 'html[data-ag-theme-active] :is([data-ag-surface="canvas"], [data-ag-chat-root="1"], [data-testid="conversation-view"], [data-testid="planner-response-text"])';
      const panelExclude = includeGlassPanels ? '' : ':not([data-ag-sidebar="1"]):not([data-ag-sidebar="1"] *):not([data-ag-surface="panel"]):not([data-ag-surface="panel"] *)';
      const nativeOverlaySel = '[data-ag-native-surface="1"], dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="tooltip"], [data-radix-popper-content-wrapper], [data-floating-ui-portal]';
      // Compact high-hit exclusion list for fast Blink style recalculation (all detected overlays carry data-ag-native-surface="1")
      const nativeOverlayExclude = ':not([data-ag-native-surface="1"], [data-ag-native-surface="1"] *, [role="dialog"], [role="dialog"] *, [role="menu"], [role="menu"] *, [data-radix-popper-content-wrapper], [data-radix-popper-content-wrapper] *)';
      const notAnc = `${panelExclude}:not([data-ag-surface="input-card"]):not([data-ag-surface="input-card"] *):not([data-ag-surface="user-bubble"]):not([data-ag-surface="user-bubble"] *):not([data-ag-surface="chat-pill"]):not([data-ag-surface="chat-pill"] *):not([data-ag-surface="chat-pill-track"]):not([data-ag-surface="chat-pill-track"] *):not([data-ag-preserve-fg="1"]):not([data-ag-preserve-fg="1"] *)${nativeOverlayExclude}:not([id*="neko"]):not([id*="neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *)`;
      if (tone !== 'auto') {
        const textColor = tone === 'dark' ? '#18181b' : (tone === 'light' ? '#f4f4f8' : (p.customTextColor || '#18181b'));
        const mutedColor = tone === 'dark' ? '#3f3f46' : (tone === 'light' ? '#d4d4d8' : textColor);
        const placeholderColor = dark ? 'rgba(244, 244, 248, 0.55)' : 'rgba(24, 24, 27, 0.52)';
        const linkColor = tone === 'dark' ? '#2563eb' : (tone === 'light' ? '#93c5fd' : p.accentColor || '#6366f1');
        const inlineCodeBg = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.08)';
        const nativeFg = state.isDark ? '#f4f4f6' : '#18181b';
        // NOTE: Do NOT set -webkit-text-fill-color on generic wrapper <div>s (it inherits into modals/popovers and overrides native color!)
        lines.push(
          `${scope} :is(p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, strong, em, summary, figcaption, span, div, pre, code, article, section, ol, ul, dl, dt, dd, small, mark, details)${notAnc}:not(button) { color: ${textColor} !important; }`,
          `${scope} :is(button, button svg)${notAnc} { color: ${textColor} !important; }`,
          `${scope} a${notAnc} { color: ${linkColor} !important; }`,
          `${scope} :not(pre) > code${notAnc} { color: ${mutedColor} !important; background-color: ${inlineCodeBg} !important; }`,
          // Hard inheritance firewall at the boundary of every native modal / settings view / popover menu
          `html[data-ag-theme-active] :is(${nativeOverlaySel}) { color: ${nativeFg} !important; -webkit-text-fill-color: currentColor !important; text-shadow: none !important; }`
        );
        if (includeGlassPanels) {
          lines.push(
            `html[data-ag-theme-active="glass"] :is([data-ag-sidebar="1"], [data-ag-surface="panel"])${nativeOverlayExclude} :is(p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, strong, em, summary, figcaption, span, div, code, pre, a, button, svg)${nativeOverlayExclude}:not([id*="neko"] *):not([id^="ag-theme-studio-"] *) { color: ${textColor} !important; }`
          );
        }
        if (p.glassInputBox) {
          lines.push(
            `html[data-ag-theme-active] [data-ag-surface="input-card"] :is(textarea, input, [contenteditable="true"], span, div, button, svg)${nativeOverlayExclude} { color: ${textColor} !important; }`,
            `html[data-ag-theme-active] [data-ag-surface="input-card"] :is(textarea, input)::placeholder, html[data-ag-theme-active] [data-ag-surface="input-card"] [data-placeholder]::before { color: ${placeholderColor} !important; opacity: 1 !important; }`
          );
        }
      }

      if (p.textShadow) {
        const shadowCss = !dark
          ? '0 1px 2px rgba(255, 255, 255, 0.85), 0 0 6px rgba(255, 255, 255, 0.55)'
          : '0 1px 3px rgba(0, 0, 0, 0.72), 0 0 8px rgba(0, 0, 0, 0.42)';
        lines.push(
          `${scope} :is(p, li, h1, h2, h3, h4, h5, h6, td, th, strong, em, summary, blockquote, span, div):not([data-ag-sidebar="1"]):not([data-ag-sidebar="1"] *):not([data-ag-surface="input-card"]):not([data-ag-surface="input-card"] *):not([data-ag-surface="user-bubble"]):not([data-ag-surface="user-bubble"] *)${nativeOverlayExclude}:not([id*="neko"]):not([id*="neko"] *):not([id^="ag-theme-studio-"]):not([id^="ag-theme-studio-"] *) { text-shadow: ${shadowCss} !important; }`,
          // Hard inheritance firewall so inherited text-shadow from #root > div never bleeds into sidebar / modals / popovers / bubbles
          `html[data-ag-theme-active] :is([data-ag-sidebar="1"], [data-ag-surface="input-card"], [data-ag-surface="user-bubble"], ${nativeOverlaySel}) { text-shadow: none !important; }`
        );
      }

      ensureStyleEl(IDS.styleDynamic, lines.join('\n'));
      ensureStyleEl(IDS.styleCustom, p.customCss || '');
      updateBackdropVisuals();
      syncNativeTitleBar(true);
    }

    function ensureBackdropDom() {
      let wrap = document.getElementById(IDS.backdrop);
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = IDS.backdrop;
        wrap.innerHTML = `
          <div class="ag-bg-gradient"></div>
          <img class="ag-bg-media ag-bg-img" alt="" style="display:none;" />
          <video class="ag-bg-media ag-bg-video" autoplay loop muted playsinline style="display:none;"></video>
          <div class="ag-bg-scrim"></div>
          <div class="ag-bg-vignette"></div>
        `;
        if (document.body) {
          document.body.insertBefore(wrap, document.body.firstChild);
        } else {
          document.documentElement.appendChild(wrap);
        }
      }
      return wrap;
    }

    function updateBackdropVisuals() {
      const p = state.prefs;
      const wrap = ensureBackdropDom();
      const grad = wrap.querySelector('.ag-bg-gradient');
      const img = wrap.querySelector('.ag-bg-img');
      const vid = wrap.querySelector('.ag-bg-video');
      const scrim = wrap.querySelector('.ag-bg-scrim');
      const vig = wrap.querySelector('.ag-bg-vignette');

      if (!p || !p.enabled) {
        if (vid && !vid.paused) try { vid.pause(); } catch {}
        return;
      }

      const dark = state.isDark;
      const isOverlay = p.renderMode === 'overlay';
      const isCssPreset = p.presetId === 'nebula-css';
      const effectiveOpacity = isOverlay ? Math.min(0.46, p.opacity * 0.44) : p.opacity;
      const scale = p.blur > 0 ? (1 + Math.min(0.08, p.blur * 0.003)).toFixed(3) : '1';
      const filterStr = `blur(${p.blur}px) saturate(${p.saturate})`;

      // In overlay mode, native dark/light canvas background is preserved:
      // dark theme (#070708) MUST use 'screen' (multiply on black = 0 = invisible wallpaper!), light theme MUST use 'multiply'.
      wrap.style.mixBlendMode = isOverlay ? (dark ? 'screen' : 'multiply') : 'normal';

      // Pure CSS nebula gradient layer
      if (isCssPreset) {
        grad.style.display = 'block';
        grad.style.opacity = String(effectiveOpacity);
        grad.style.background = dark
          ? 'radial-gradient(circle at 84% 18%, rgba(168, 85, 247, 0.42) 0%, transparent 45%), radial-gradient(circle at 16% 85%, rgba(236, 72, 153, 0.28) 0%, transparent 46%), linear-gradient(135deg, #0b0c18 0%, #16132b 50%, #0d1321 100%)'
          : 'radial-gradient(circle at 84% 18%, rgba(236, 72, 153, 0.22) 0%, transparent 46%), radial-gradient(circle at 16% 85%, rgba(139, 92, 246, 0.2) 0%, transparent 48%), linear-gradient(135deg, #fdf8ff 0%, #f5f3ff 52%, #fffbeb 100%)';
        img.style.display = 'none';
        vid.style.display = 'none';
        if (!vid.paused) try { vid.pause(); } catch {}
      } else {
        // In 'contain' mode, fill the uncovered pillarbox/letterbox margins with the wallpaper's own sampled edge color so there are NEVER ugly black bars!
        if (p.wallpaperFit === 'contain' && state.activeEdgeColor && !state.activeIsVideo) {
          grad.style.display = 'block';
          grad.style.opacity = String(effectiveOpacity);
          grad.style.background = state.activeEdgeColor;
        } else {
          grad.style.display = 'none';
        }
        const activeEl = state.activeIsVideo ? vid : img;
        const inactiveEl = state.activeIsVideo ? img : vid;
        inactiveEl.style.display = 'none';
        if (!state.activeIsVideo && !vid.paused) try { vid.pause(); } catch {}

        if (state.activeBlobUrl) {
          activeEl.style.display = 'block';
          activeEl.style.objectFit = p.wallpaperFit;
          activeEl.style.objectPosition = p.wallpaperPos;
          activeEl.style.opacity = String(effectiveOpacity);
          activeEl.style.filter = filterStr;
          activeEl.style.transform = `scale(${scale})`;
          activeEl.style.mixBlendMode = 'normal';
          if (state.activeIsVideo && !document.hidden) {
            vid.play().catch(() => {});
          }
        } else {
          activeEl.style.display = 'none';
        }
      }

      // Scrim readability veil & vignette (in overlay mode keep clean so screen/multiply contrast isn't muddied)
      if (isOverlay) {
        scrim.style.background = 'transparent';
        vig.style.opacity = '0';
      } else {
        const scrimRgb = dark ? '8, 9, 16' : '255, 255, 255';
        scrim.style.background = p.scrim > 0.005 ? `rgba(${scrimRgb}, ${p.scrim.toFixed(2)})` : 'transparent';
        vig.style.background = dark
          ? 'radial-gradient(ellipse at center, transparent 48%, rgba(5, 6, 14, 0.45) 100%)'
          : 'radial-gradient(ellipse at center, transparent 54%, rgba(124, 58, 237, 0.08) 100%)';
        vig.style.opacity = p.vignette ? '1' : '0';
      }
    }

    function stopVideoSampleLoop() {
      if (state.videoSampleTimer) {
        clearInterval(state.videoSampleTimer);
        state.videoSampleTimer = null;
      }
    }

    function startVideoSampleLoopIfNeeded(vidEl) {
      stopVideoSampleLoop();
      const p = state.prefs;
      if (!p || !p.enabled || !state.activeIsVideo || p.presetId === 'nebula-css') return;
      if (p.renderMode !== 'glass' || (p.textTone || 'auto') !== 'auto') return;
      state.videoSampleTimer = setInterval(() => {
        if (document.hidden || !state.prefs || !state.prefs.enabled || !state.activeIsVideo) return;
        if ((state.prefs.textTone || 'auto') !== 'auto' || state.prefs.renderMode !== 'glass') return;
        if (!vidEl || vidEl.readyState < 2 || vidEl.paused) return;
        const prevDark = state.lastAutoVisualDark;
        const info = sampleWallpaperVisuals(vidEl);
        state.wallpaperLuma = info.luma;
        state.wallpaperEdgeLuma = info.edgeLuma;
        const nextDark = resolveVisualDark();
        if (nextDark !== prevDark) {
          applyDynamicCss();
        }
      }, 3000);
    }

    // Unified media teardown: pauses & detaches video, revokes Blob URL, resets sampling state
    function clearActiveMedia(reapplyCss) {
      state.mediaReqSeq++;
      stopVideoSampleLoop();
      const wrap = document.getElementById(IDS.backdrop);
      if (wrap) {
        const img = wrap.querySelector('.ag-bg-img');
        const vid = wrap.querySelector('.ag-bg-video');
        if (vid) {
          vid.onloadeddata = null;
          try { vid.pause(); } catch {}
          vid.removeAttribute('src');
          try { vid.load(); } catch {}
          vid.style.display = 'none';
        }
        if (img) {
          img.onload = null;
          img.removeAttribute('src');
          img.style.display = 'none';
        }
      }
      if (state.activeBlobUrl) {
        try { URL.revokeObjectURL(state.activeBlobUrl); } catch {}
        state.activeBlobUrl = '';
      }
      state.activeMediaKey = '';
      state.activeIsVideo = false;
      state.activeEdgeColor = '';
      state.wallpaperLuma = null;
      state.wallpaperEdgeLuma = null;
      state.lastAutoVisualDark = null;
      if (reapplyCss) applyDynamicCss();
    }

    // Alpha-composited, crop-aware wallpaper sampler (accounts for PNG transparency, wallpaperFit='cover', and wallpaperPos!)
    function sampleWallpaperVisuals(mediaEl) {
      try {
        const size = 24;
        const cvs = document.createElement('canvas');
        cvs.width = size;
        cvs.height = size;
        const ctx = cvs.getContext('2d');
        if (!ctx) return { edgeColor: '', luma: null, edgeLuma: null };

        // Pre-fill canvas with actual host backdrop base color so transparent PNG pixels composite accurately instead of turning black!
        ctx.fillStyle = state.isDark ? '#0e0f18' : '#ffffff';
        ctx.fillRect(0, 0, size, size);

        const mw = mediaEl.naturalWidth || mediaEl.videoWidth || 0;
        const mh = mediaEl.naturalHeight || mediaEl.videoHeight || 0;
        const p = state.prefs || {};
        const fit = p.wallpaperFit || 'cover';
        const pos = p.wallpaperPos || 'center';
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;

        if (mw > 0 && mh > 0 && fit === 'cover') {
          const vRatio = vw / vh;
          const mRatio = mw / mh;
          let sx = 0, sy = 0, sw = mw, sh = mh;
          if (mRatio > vRatio) {
            sw = Math.max(1, mh * vRatio);
            sx = pos === 'left' ? 0 : (pos === 'right' ? mw - sw : (mw - sw) / 2);
          } else {
            sh = Math.max(1, mw / vRatio);
            sy = pos === 'top' ? 0 : (pos === 'bottom' ? mh - sh : (mh - sh) / 2);
          }
          ctx.drawImage(mediaEl, sx, sy, sw, sh, 0, 0, size, size);
        } else {
          ctx.drawImage(mediaEl, 0, 0, size, size);
        }

        const imgData = ctx.getImageData(0, 0, size, size).data;

        // Sample left/top edge pixels for seamless 'contain' letterbox fill
        const edgeIdx = [0, (Math.floor(size / 2) * size), ((size - 1) * size), 2];
        let er = 0, eg = 0, eb = 0;
        for (const pIdx of edgeIdx) {
          const o = pIdx * 4;
          er += imgData[o];
          eg += imgData[o + 1];
          eb += imgData[o + 2];
        }
        er = Math.round(er / edgeIdx.length);
        eg = Math.round(eg / edgeIdx.length);
        eb = Math.round(eb / edgeIdx.length);
        const edgeColor = `rgb(${er}, ${eg}, ${eb})`;
        const edgeLuma = (0.2126 * er + 0.7152 * eg + 0.0722 * eb) / 255;

        // Weighted average perceived luminance across the reading area (left + center slightly emphasized)
        let lumaSum = 0;
        let weightSum = 0;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const o = (y * size + x) * 4;
            const l = (0.2126 * imgData[o] + 0.7152 * imgData[o + 1] + 0.0722 * imgData[o + 2]) / 255;
            const w = x < size * 0.72 ? 1.35 : 0.85;
            lumaSum += l * w;
            weightSum += w;
          }
        }
        return {
          edgeColor,
          luma: weightSum > 0 ? lumaSum / weightSum : null,
          edgeLuma
        };
      } catch {
        return { edgeColor: '', luma: null, edgeLuma: null };
      }
    }

    function applyMediaPayload(media, expectedSeq) {
      if (expectedSeq !== undefined && expectedSeq !== state.mediaReqSeq) return;
      if (!media || !media.ok || (!media.data && !media.base64)) {
        clearActiveMedia(true);
        return;
      }

      const key = `${media.source || 'preset'}:${media.file || ''}:${media.bytes || 0}`;
      if (key === state.activeMediaKey && state.activeBlobUrl) {
        updateBackdropVisuals();
        if (state.activeIsVideo) {
          const wrap = document.getElementById(IDS.backdrop);
          const vid = wrap && wrap.querySelector('.ag-bg-video');
          if (vid) startVideoSampleLoopIfNeeded(vid);
        }
        return;
      }

      const activeSeq = expectedSeq !== undefined ? expectedSeq : ++state.mediaReqSeq;
      stopVideoSampleLoop();

      const nextUrl = mediaToBlobUrl(media);
      const prevUrl = state.activeBlobUrl;
      state.activeBlobUrl = nextUrl;
      state.activeMediaKey = key;
      state.activeIsVideo = Boolean(media.isVideo);
      state.activeEdgeColor = '';
      state.wallpaperLuma = null;
      state.wallpaperEdgeLuma = null;
      state.lastAutoVisualDark = null;

      const wrap = ensureBackdropDom();
      const img = wrap.querySelector('.ag-bg-img');
      const vid = wrap.querySelector('.ag-bg-video');
      if (state.activeIsVideo) {
        img.onload = null;
        img.removeAttribute('src');
        vid.onloadeddata = () => {
          if (activeSeq !== state.mediaReqSeq) return;
          const info = sampleWallpaperVisuals(vid);
          state.wallpaperLuma = info.luma;
          state.wallpaperEdgeLuma = info.edgeLuma;
          applyDynamicCss();
          startVideoSampleLoopIfNeeded(vid);
        };
        vid.src = nextUrl;
      } else {
        vid.onloadeddata = null;
        try { vid.pause(); } catch {}
        vid.removeAttribute('src');
        try { vid.load(); } catch {}
        img.onload = () => {
          if (activeSeq !== state.mediaReqSeq) return;
          const info = sampleWallpaperVisuals(img);
          state.activeEdgeColor = info.edgeColor;
          state.wallpaperLuma = info.luma;
          state.wallpaperEdgeLuma = info.edgeLuma;
          applyDynamicCss();
        };
        img.src = nextUrl;
      }

      if (prevUrl) {
        setTimeout(() => { try { URL.revokeObjectURL(prevUrl); } catch {} }, 500);
      }
      updateBackdropVisuals();
    }

    async function loadCurrentWallpaper() {
      const p = state.prefs;
      if (!p || !p.enabled || p.presetId === 'nebula-css') {
        clearActiveMedia(false);
        updateBackdropVisuals();
        return;
      }
      let req = null;
      if (p.presetId === 'custom' && p.customWallpaperFile) {
        req = { source: 'custom', file: p.customWallpaperFile };
      } else {
        const preset = state.presets.find((x) => x.id === p.presetId);
        if (preset && preset.file) req = { source: 'preset', file: preset.file };
      }
      if (!req) {
        clearActiveMedia(true);
        return;
      }
      const reqSeq = ++state.mediaReqSeq;
      const res = await ipcRenderer.invoke('ag-theme:load-media', req);
      if (reqSeq !== state.mediaReqSeq) return; // Discard stale response!
      applyMediaPayload(res, reqSeq);
    }

    function resampleActiveWallpaper(reapplyCss, resetHysteresis) {
      const p = state.prefs;
      if (!p || !p.enabled || p.presetId === 'nebula-css' || !state.activeBlobUrl || state.activeIsVideo) {
        return false;
      }
      const wrap = document.getElementById(IDS.backdrop);
      const img = wrap && wrap.querySelector('.ag-bg-img');
      if (!img || !img.complete || !(img.naturalWidth > 0)) return false;
      const info = sampleWallpaperVisuals(img);
      state.activeEdgeColor = info.edgeColor;
      state.wallpaperLuma = info.luma;
      state.wallpaperEdgeLuma = info.edgeLuma;
      if (resetHysteresis) state.lastAutoVisualDark = null;
      if (reapplyCss) applyDynamicCss();
      return true;
    }

    function getUnconfirmedLocalPatch() {
      const combined = {};
      if (Array.isArray(state.inFlightPatches)) {
        for (const item of state.inFlightPatches) {
          if (item && item.patch) Object.assign(combined, item.patch);
        }
      }
      if (state.pendingPatch && typeof state.pendingPatch === 'object') {
        Object.assign(combined, state.pendingPatch);
      }
      return combined;
    }

    function prefsShallowEqual(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      const ka = Object.keys(a);
      const kb = Object.keys(b);
      if (ka.length !== kb.length) return false;
      for (const k of ka) {
        const va = a[k];
        const vb = b[k];
        if (va === vb) continue;
        if (va && vb && typeof va === 'object' && typeof vb === 'object') {
          if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
        } else {
          return false;
        }
      }
      return true;
    }

    /**
     * Recompute the active display `state.prefs` strictly as:
     *   latest authoritative main-process snapshot + remaining in-flight patches + unsent pendingPatch.
     * Guarantees that delayed ACKs, cross-window broadcasts, and save failures ALWAYS converge cleanly!
     */
    function reconcileDisplayPrefs(opts) {
      if (!state.authoritativePrefs) return false;
      const prev = state.prefs;
      const unconfirmed = getUnconfirmedLocalPatch();
      const nextDisplay = Object.keys(unconfirmed).length > 0
        ? { ...state.authoritativePrefs, ...unconfirmed }
        : { ...state.authoritativePrefs };

      const changed = !prefsShallowEqual(prev, nextDisplay);
      const forceApply = Boolean(opts && opts.forceApply);
      if (!changed && !forceApply && !(opts && opts.inlineMedia && opts.inlineMedia.ok)) {
        return false;
      }

      const mediaChanged = !prev
        || prev.presetId !== nextDisplay.presetId
        || prev.customWallpaperFile !== nextDisplay.customWallpaperFile
        || prev.enabled !== nextDisplay.enabled;
      const sampleLayoutChanged = Boolean(prev)
        && (prev.wallpaperFit !== nextDisplay.wallpaperFit || prev.wallpaperPos !== nextDisplay.wallpaperPos);

      state.prefs = nextDisplay;

      if (!nextDisplay.enabled || nextDisplay.presetId === 'nebula-css') {
        clearActiveMedia(false);
      } else if (!mediaChanged && sampleLayoutChanged) {
        resampleActiveWallpaper(false, true);
      }

      syncDrawerThemeAttr();
      applyDynamicCss();

      if (nextDisplay.enabled && nextDisplay.presetId !== 'nebula-css') {
        if (opts && opts.inlineMedia && opts.inlineMedia.ok) {
          const freshSeq = ++state.mediaReqSeq;
          applyMediaPayload(opts.inlineMedia, freshSeq);
        } else if (mediaChanged || !state.activeBlobUrl) {
          loadCurrentWallpaper().catch(() => {});
        } else if (state.activeIsVideo) {
          const wrap = document.getElementById(IDS.backdrop);
          const vid = wrap && wrap.querySelector('.ag-bg-video');
          if (vid) startVideoSampleLoopIfNeeded(vid);
        }
      } else {
        stopVideoSampleLoop();
      }

      syncTriggerButton();
      if (state.drawerOpen) renderDrawerContent();
      return true;
    }

    /**
     * Apply authoritative prefs from main process with monotonic revision ordering.
     * - Drops stale responses whose revision is older than state.prefsRevision.
     * - Stores the latest authoritative snapshot separately from optimistic local edits.
     * - Recomputes display prefs via reconcileDisplayPrefs() so unconfirmed edits stay intact while confirmed/superseded edits converge.
     */
    function applyAuthoritativePrefs(nextPrefs, revision, opts) {
      if (!nextPrefs || typeof nextPrefs !== 'object') return false;
      if (typeof revision === 'number' && state.hasAuthoritativeRevision && revision < state.prefsRevision) {
        return false;
      }
      if (typeof revision === 'number') {
        if (!state.hasAuthoritativeRevision || revision > state.prefsRevision) {
          state.prefsRevision = revision;
        }
        state.hasAuthoritativeRevision = true;
      }
      state.authoritativePrefs = { ...nextPrefs };

      const preserveUnconfirmed = Boolean(opts && opts.preserveUnconfirmed);
      if (!preserveUnconfirmed && opts && opts.clearPending) {
        state.pendingPatch = {};
        state.inFlightPatches = [];
      }

      reconcileDisplayPrefs({
        forceApply: true,
        inlineMedia: opts && opts.inlineMedia
      });
      return true;
    }

    function persistPrefsDebounced(immediate) {
      if (state.saveTimer) clearTimeout(state.saveTimer);
      const run = () => {
        state.saveTimer = null;
        if (!state.prefs) return;
        const patchToSend = state.pendingPatch && Object.keys(state.pendingPatch).length > 0
          ? { ...state.pendingPatch }
          : null;
        if (!patchToSend) return;
        state.pendingPatch = {};
        const batchSeq = ++state.saveBatchSeq;
        state.inFlightPatches.push({ seq: batchSeq, patch: patchToSend });
        ipcRenderer.invoke('ag-theme:save-prefs', patchToSend).then((res) => {
          state.inFlightPatches = state.inFlightPatches.filter((item) => item.seq !== batchSeq);
          if (res && res.ok === false) {
            showToast(res.error || '配置保存失败，请检查权限');
            reconcileDisplayPrefs({ forceApply: true });
            return;
          }
          if (res && res.prefs && typeof res.revision === 'number') {
            if (!state.hasAuthoritativeRevision || res.revision >= state.prefsRevision) {
              state.prefsRevision = res.revision;
              state.hasAuthoritativeRevision = true;
              state.authoritativePrefs = { ...res.prefs };
            }
          }
          // ALWAYS recompute display prefs after removing this in-flight batch so a newer broadcast
          // that arrived before a delayed older ACK immediately takes effect!
          reconcileDisplayPrefs({ forceApply: false });
        }).catch(() => {
          state.inFlightPatches = state.inFlightPatches.filter((item) => item.seq !== batchSeq);
          showToast('配置保存通信失败');
          reconcileDisplayPrefs({ forceApply: true });
        });
      };
      if (immediate) run();
      else state.saveTimer = setTimeout(run, 180);
    }

    function updatePref(patch, opts) {
      if (!state.prefs) return;
      state.prefs = { ...state.prefs, ...patch };
      state.pendingPatch = { ...(state.pendingPatch || {}), ...patch };
      // Re-sample if fit/position changed on an active image wallpaper
      if (patch.wallpaperFit !== undefined || patch.wallpaperPos !== undefined) {
        resampleActiveWallpaper(false, true);
      }
      if (patch.enabled === false || patch.presetId === 'nebula-css') {
        clearActiveMedia(false);
      }
      syncDrawerThemeAttr();
      applyDynamicCss();
      if (state.activeIsVideo && state.prefs.enabled && state.prefs.presetId !== 'nebula-css') {
        const wrap = document.getElementById(IDS.backdrop);
        const vid = wrap && wrap.querySelector('.ag-bg-video');
        if (vid) startVideoSampleLoopIfNeeded(vid);
      } else {
        stopVideoSampleLoop();
      }
      if (opts && opts.rescan) scheduleSurfaceScan(40);
      if ((opts && opts.reloadMedia) || (patch.enabled === true && !state.activeBlobUrl && state.prefs.presetId !== 'nebula-css')) {
        loadCurrentWallpaper();
      }
      if (opts && opts.rerenderDrawer) renderDrawerContent();
      syncTriggerButton();
      persistPrefsDebounced(Boolean(opts && opts.immediate));
    }

    // ---- Studio Trigger & Drawer UI ----
    function syncDrawerThemeAttr() {
      const p = state.prefs;
      const valid = ['dark', 'light', 'glass'];
      const theme = (p && valid.includes(p.studioTheme))
        ? p.studioTheme
        : (state.isDark ? 'dark' : 'light');
      const uiRoot = document.getElementById(IDS.uiRoot);
      if (uiRoot) uiRoot.setAttribute('data-studio-theme', theme);
      const trigRoot = document.getElementById(IDS.triggerRoot);
      if (trigRoot) trigRoot.setAttribute('data-studio-theme', theme);
    }

    function detectLeftSidebarWidth() {
      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const sidebars = findLeftSidebarElements(vw, vh);
      if (sidebars.length > 0) {
        return Math.round(sidebars[0].getBoundingClientRect().right);
      }
      return 0;
    }

    function syncTriggerButton() {
      const trigRoot = ensureTriggerRoot();
      if (!trigRoot || !state.prefs) return;
      const btn = trigRoot.querySelector('.ag-theme-trigger');
      if (!btn || btn.classList.contains('dragging')) return;
      const show = Boolean(state.prefs.showTriggerButton);
      btn.classList.toggle('hidden', !show);
      if (!show) return;

      const vw = window.innerWidth || 1280;
      const vh = window.innerHeight || 800;
      const corner = state.prefs.triggerCorner || 'sidebar-bottom';

      let top = '';
      let right = '';
      let bottom = '';
      let left = '';

      if (corner === 'custom' && state.prefs.triggerPos) {
        const x = Math.max(8, Math.min(vw - 38, state.prefs.triggerPos.x));
        const y = Math.max(40, Math.min(vh - 38, state.prefs.triggerPos.y));
        left = `${x}px`;
        top = `${y}px`;
      } else if (corner === 'sidebar-bottom') {
        const sbRight = detectLeftSidebarWidth();
        if (sbRight >= 150) {
          // Neatly sit inside the bottom-right of the left sidebar (next to "设置", zero overlap!)
          left = `${Math.max(110, sbRight - 40)}px`;
          bottom = '8px';
        } else {
          // Sidebar collapsed: tuck politely above bottom-left settings area
          left = '12px';
          bottom = '52px';
        }
      } else if (corner === 'bottom-left') {
        left = '14px';
        bottom = '52px';
      } else if (corner === 'top-left') {
        left = '16px';
        top = '84px';
      } else {
        // top-right
        right = '16px';
        top = '84px';
      }

      const posKey = `${top}|${right}|${bottom}|${left}`;
      if (btn.getAttribute('data-pos-key') === posKey) return;
      btn.setAttribute('data-pos-key', posKey);
      btn.style.top = top;
      btn.style.right = right;
      btn.style.bottom = bottom;
      btn.style.left = left;
    }

    function ensureTriggerRoot() {
      let trigRoot = document.getElementById(IDS.triggerRoot);
      if (trigRoot) return trigRoot;

      trigRoot = document.createElement('div');
      trigRoot.id = IDS.triggerRoot;
      trigRoot.innerHTML = `
        <button class="ag-theme-trigger" type="button" title="Antigravity 美化工作室 (点击打开 · 按住可拖动 · Ctrl+Shift+B)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r=".8" fill="currentColor"></circle>
            <circle cx="17.5" cy="10.5" r=".8" fill="currentColor"></circle>
            <circle cx="8.5" cy="7.5" r=".8" fill="currentColor"></circle>
            <circle cx="6.5" cy="12.5" r=".8" fill="currentColor"></circle>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3.3 0 6-2.7 6-6 0-5-4.5-8.6-10-8.6z"></path>
          </svg>
        </button>
      `;

      (document.body || document.documentElement).appendChild(trigRoot);
      syncDrawerThemeAttr();

      const btn = trigRoot.querySelector('.ag-theme-trigger');
      let dragState = null;

      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = btn.getBoundingClientRect();
        dragState = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: rect.left,
          origTop: rect.top,
          moved: false
        };
        try { btn.setPointerCapture(e.pointerId); } catch {}
      });

      btn.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.id) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) > 5) {
          dragState.moved = true;
          btn.classList.add('dragging');
        }
        if (dragState.moved) {
          const vw = window.innerWidth || 1280;
          const vh = window.innerHeight || 800;
          const nx = Math.max(8, Math.min(vw - 38, dragState.origLeft + dx));
          const ny = Math.max(40, Math.min(vh - 38, dragState.origTop + dy));
          btn.style.right = '';
          btn.style.bottom = '';
          btn.style.left = `${nx}px`;
          btn.style.top = `${ny}px`;
        }
      });

      const finishPointer = (e) => {
        if (!dragState || e.pointerId !== dragState.id) return;
        const wasMoved = dragState.moved;
        dragState = null;
        btn.classList.remove('dragging');
        try { btn.releasePointerCapture(e.pointerId); } catch {}
        if (wasMoved) {
          btn.removeAttribute('data-pos-key');
          const rect = btn.getBoundingClientRect();
          updatePref(
            { triggerCorner: 'custom', triggerPos: { x: Math.round(rect.left), y: Math.round(rect.top) } },
            { rerenderDrawer: state.drawerOpen, immediate: true }
          );
        } else {
          setDrawerOpen(!state.drawerOpen);
        }
      };

      btn.addEventListener('pointerup', finishPointer);
      btn.addEventListener('pointercancel', finishPointer);

      return trigRoot;
    }

    async function loadPresetThumbsIfNeeded() {
      if (state.presetThumbsLoaded || state.presetThumbsLoading || !state.bootReady) return;
      state.presetThumbsLoading = true;
      try {
        const res = await ipcRenderer.invoke('ag-theme:get-preset-thumbs');
        if (res && res.ok && res.thumbs && typeof res.thumbs === 'object') {
          state.presets = state.presets.map((pr) => {
            const t = res.thumbs[pr.id];
            return t ? { ...pr, available: t.available, thumbDataUrl: t.thumbDataUrl || '' } : pr;
          });
          state.presetThumbsLoaded = true;
          if (state.drawerOpen && state.activeTab === 'wallpaper') {
            renderDrawerContent();
          }
        }
      } catch {
      } finally {
        state.presetThumbsLoading = false;
      }
    }

    function setDrawerOpen(open) {
      state.drawerOpen = Boolean(open);
      const uiRoot = document.getElementById(IDS.uiRoot);
      if (!uiRoot) return;
      const mask = uiRoot.querySelector('.ag-theme-drawer-mask');
      const drawer = uiRoot.querySelector('.ag-theme-drawer');
      if (mask) mask.classList.toggle('open', state.drawerOpen);
      if (drawer) drawer.classList.toggle('open', state.drawerOpen);
      if (state.drawerOpen) {
        renderDrawerContent();
        loadPresetThumbsIfNeeded().catch(() => {});
      }
    }

    function ensureUiRoot() {
      let uiRoot = document.getElementById(IDS.uiRoot);
      if (uiRoot) return uiRoot;

      uiRoot = document.createElement('div');
      uiRoot.id = IDS.uiRoot;
      uiRoot.innerHTML = `
        <div class="ag-theme-drawer-mask"></div>
        <aside class="ag-theme-drawer" aria-label="外观与壁纸设置">
          <div class="ag-drawer-header">
            <div class="ag-drawer-top-bar">
              <div class="ag-drawer-title">外观与壁纸</div>
              <div class="ag-drawer-top-actions">
                <div class="ag-pill-seg ag-studio-theme-seg" title="切换设置面板外观（深色黑 / 浅色白 / 通透透明）">
                  <button type="button" class="ag-pill-btn" data-studio-theme-opt="dark">黑</button>
                  <button type="button" class="ag-pill-btn" data-studio-theme-opt="light">白</button>
                  <button type="button" class="ag-pill-btn" data-studio-theme-opt="glass">透明</button>
                </div>
                <button class="ag-close-btn" type="button" title="关闭 (Esc)">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </div>
            <div class="ag-drawer-subtitle">配置桌面背景壁纸、毛玻璃透光与会话视觉偏好。</div>
          </div>
          <div class="ag-drawer-tabs"></div>
          <div class="ag-drawer-body"></div>
          <div class="ag-drawer-footer">
            <span>快捷键 Ctrl + Shift + B</span>
            <span>双击滑块可恢复该项默认值</span>
          </div>
        </aside>
        <div class="ag-toast"></div>
      `;

      (document.body || document.documentElement).appendChild(uiRoot);
      ensureTriggerRoot();
      syncDrawerThemeAttr();

      uiRoot.querySelector('.ag-theme-drawer-mask').addEventListener('click', () => setDrawerOpen(false));
      uiRoot.querySelector('.ag-close-btn').addEventListener('click', () => setDrawerOpen(false));
      uiRoot.querySelectorAll('[data-studio-theme-opt]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-studio-theme-opt');
          updatePref({ studioTheme: mode }, { rerenderDrawer: true, immediate: true });
        });
      });

      return uiRoot;
    }

    function renderDrawerContent() {
      const uiRoot = ensureUiRoot();
      const tabsWrap = uiRoot.querySelector('.ag-drawer-tabs');
      const body = uiRoot.querySelector('.ag-drawer-body');
      const p = state.prefs;
      if (!body) return;
      if (!p) {
        if (tabsWrap) tabsWrap.innerHTML = '';
        body.innerHTML = `
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">初始化状态</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">${state.bootError ? '配置加载失败' : '正在加载美化配置...'}</div>
                  <div class="ag-row-sub">${escapeHtml(state.bootError || '请稍候，或点击重试按钮重新连接主进程。')}</div>
                </div>
                <button type="button" class="ag-action-pill" data-action="retry-boot">重试加载</button>
              </div>
            </div>
          </div>
        `;
        const retryBtn = body.querySelector('[data-action="retry-boot"]');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => {
            if (typeof state.retryBootFn === 'function') state.retryBootFn();
          });
        }
        return;
      }

      const curStudioTheme = ['dark', 'light', 'glass'].includes(p.studioTheme) ? p.studioTheme : 'dark';
      uiRoot.querySelectorAll('[data-studio-theme-opt]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-studio-theme-opt') === curStudioTheme);
      });

      const tab = state.activeTab || 'wallpaper';
      if (tabsWrap) {
        tabsWrap.innerHTML = `
          <div class="ag-tab-bar">
            <button type="button" class="ag-tab-btn ${tab === 'wallpaper' ? 'active' : ''}" data-tab="wallpaper">壁纸与布局</button>
            <button type="button" class="ag-tab-btn ${tab === 'lighting' ? 'active' : ''}" data-tab="lighting">光影与质感</button>
            <button type="button" class="ag-tab-btn ${tab === 'appearance' ? 'active' : ''}" data-tab="appearance">色彩与高级</button>
          </div>
        `;
        tabsWrap.querySelectorAll('[data-tab]').forEach((btn) => {
          btn.addEventListener('click', () => {
            state.activeTab = btn.getAttribute('data-tab');
            renderDrawerContent();
          });
        });
      }

      if (tab === 'wallpaper') {
        const presetsHtml = state.presets.map((pr) => {
          const isActive = p.presetId === pr.id;
          const bgStyle = pr.thumbDataUrl
            ? `background-image: url('${pr.thumbDataUrl}');`
            : `background: ${pr.swatch};`;
          return `
            <button type="button" class="ag-preset-card ${pr.featured ? 'featured' : ''} ${isActive ? 'active' : ''}" data-preset-id="${escapeHtml(pr.id)}">
              <div class="ag-preset-thumb" style="${bgStyle}"></div>
              <div class="ag-preset-label">
                <div class="ag-preset-name">${escapeHtml(pr.name)}</div>
                <div class="ag-preset-sub">${escapeHtml(pr.subtitle)}</div>
              </div>
            </button>
          `;
        }).join('');

        const customRowsHtml = state.customList.length
          ? `<div class="ag-custom-scroll">${state.customList.map((item) => {
              const active = p.presetId === 'custom' && p.customWallpaperFile === item.file;
              const tag = item.isVideo ? '动态视频' : '图片';
              const displayName = item.file.replace(/^[a-z0-9]+_/i, '');
              return `
                <div class="ag-custom-row ${active ? 'active' : ''}" data-custom-file="${escapeHtml(item.file)}">
                  <span class="ag-custom-name" title="${escapeHtml(item.file)}">${escapeHtml(displayName)}</span>
                  <span class="ag-custom-tag">${tag}</span>
                  <button type="button" class="ag-custom-del" data-del-file="${escapeHtml(item.file)}" title="移除">×</button>
                </div>
              `;
            }).join('')}</div>`
          : `<div class="ag-list-row"><span class="ag-row-sub">暂未导入本地壁纸（支持 PNG / JPG / WebP / GIF / MP4）</span></div>`;

        body.innerHTML = `
          <!-- 通用开关 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">通用</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">启用桌面背景美化</div>
                  <div class="ag-row-sub">关闭后立即无损恢复客户端默认界面。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="enabled" aria-checked="${p.enabled}"></button>
              </div>
            </div>
          </div>

          <!-- 渲染模式（1:1 官方「界面布局」双大卡片） -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">渲染模式</span></div>
            <div class="ag-layout-grid">
              <button type="button" class="ag-layout-card ${p.renderMode === 'glass' ? 'active' : ''}" data-mode="glass">
                <svg class="ag-layout-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                  <line x1="9" y1="3" x2="9" y2="21"></line>
                </svg>
                <div class="ag-layout-name">通透毛玻璃</div>
                <div class="ag-layout-desc">柔化主画布与侧边栏背景，透出底层壁纸光影。</div>
              </button>
              <button type="button" class="ag-layout-card ${p.renderMode === 'overlay' ? 'active' : ''}" data-mode="overlay">
                <svg class="ag-layout-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                  <polyline points="2 17 12 22 22 17"></polyline>
                  <polyline points="2 12 12 17 22 12"></polyline>
                </svg>
                <div class="ag-layout-name">轻柔叠层</div>
                <div class="ag-layout-desc">保持原生布局结构不变，以滤色或正片叠底融合壁纸。</div>
              </button>
            </div>
          </div>

          <!-- 预设壁纸 -->
          <div class="ag-group">
            <div class="ag-group-header">
              <span class="ag-group-title">主题预设壁纸</span>
              <span class="ag-group-hint">单击换图 · 再点套用推荐参数</span>
            </div>
            <div class="ag-preset-grid">${presetsHtml}</div>
          </div>

          <!-- 本地壁纸 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">本地壁纸</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">自定义壁纸文件</div>
                  <div class="ag-row-sub">导入本地静态图片或循环动态视频。</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="ag-action-pill" data-action="open-folder">壁纸目录</button>
                  <button type="button" class="ag-action-pill" data-action="pick-wallpaper">选择文件</button>
                </div>
              </div>
              ${customRowsHtml}
            </div>
          </div>

          <!-- 画面布局 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">画面构图</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">填充方式</div>
                </div>
                <div class="ag-pill-seg">
                  <button type="button" class="ag-pill-btn ${p.wallpaperFit === 'cover' ? 'active' : ''}" data-fit="cover">铺满</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperFit === 'contain' ? 'active' : ''}" data-fit="contain">完整</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperFit === 'fill' ? 'active' : ''}" data-fit="fill">拉伸</button>
                </div>
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">对齐锚点</div>
                </div>
                <div class="ag-pill-seg">
                  <button type="button" class="ag-pill-btn ${(p.wallpaperPos || 'center') === 'center' ? 'active' : ''}" data-pos="center">居中</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperPos === 'top' ? 'active' : ''}" data-pos="top">居上</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperPos === 'bottom' ? 'active' : ''}" data-pos="bottom">居下</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperPos === 'left' ? 'active' : ''}" data-pos="left">居左</button>
                  <button type="button" class="ag-pill-btn ${p.wallpaperPos === 'right' ? 'active' : ''}" data-pos="right">居右</button>
                </div>
              </div>
            </div>
          </div>
        `;
      } else if (tab === 'lighting') {
        body.innerHTML = `
          <!-- 壁纸图层光影 -->
          <div class="ag-group">
            <div class="ag-group-header">
              <span class="ag-group-title">壁纸图层</span>
              <span class="ag-group-hint">按住拖动时自动透视预览</span>
            </div>
            <div class="ag-group-box">
              <div class="ag-list-row col" data-slider-row="opacity">
                <div class="ag-slider-head">
                  <span class="ag-row-title">背景可见度</span>
                  <span class="ag-slider-val" data-val-for="opacity">${Math.round(p.opacity * 100)}%</span>
                </div>
                <input class="ag-range" type="range" min="0.05" max="1" step="0.01" value="${p.opacity}" data-slider="opacity" />
              </div>
              <div class="ag-list-row col" data-slider-row="blur">
                <div class="ag-slider-head">
                  <span class="ag-row-title">背景模糊度</span>
                  <span class="ag-slider-val" data-val-for="blur">${p.blur}px</span>
                </div>
                <input class="ag-range" type="range" min="0" max="32" step="1" value="${p.blur}" data-slider="blur" />
              </div>
              <div class="ag-list-row col" data-slider-row="scrim">
                <div class="ag-slider-head">
                  <span class="ag-row-title">护眼遮罩浓度</span>
                  <span class="ag-slider-val" data-val-for="scrim">${Math.round(p.scrim * 100)}%</span>
                </div>
                <input class="ag-range" type="range" min="0" max="0.85" step="0.01" value="${p.scrim}" data-slider="scrim" />
              </div>
              <div class="ag-list-row col" data-slider-row="saturate">
                <div class="ag-slider-head">
                  <span class="ag-row-title">色彩饱和度</span>
                  <span class="ag-slider-val" data-val-for="saturate">${Math.round(p.saturate * 100)}%</span>
                </div>
                <input class="ag-range" type="range" min="0.5" max="1.6" step="0.02" value="${p.saturate}" data-slider="saturate" />
              </div>
            </div>
          </div>

          <!-- 毛玻璃面板质感 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">毛玻璃质感</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row col" data-slider-row="panelAlpha">
                <div class="ag-slider-head">
                  <span class="ag-row-title">侧栏与面板不透明度</span>
                  <span class="ag-slider-val" data-val-for="panelAlpha">${Math.round(p.panelAlpha * 100)}%</span>
                </div>
                <input class="ag-range" type="range" min="0.15" max="0.96" step="0.01" value="${p.panelAlpha}" data-slider="panelAlpha" />
              </div>
              <div class="ag-list-row col" data-slider-row="panelBlur">
                <div class="ag-slider-head">
                  <span class="ag-row-title">面板磨砂模糊强度</span>
                  <span class="ag-slider-val" data-val-for="panelBlur">${p.panelBlur}px</span>
                </div>
                <input class="ag-range" type="range" min="0" max="28" step="1" value="${p.panelBlur}" data-slider="panelBlur" />
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">输入框毛玻璃透明化</div>
                  <div class="ag-row-sub">让底部对话输入框呈现磨砂半透明质感。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="glassInputBox" aria-checked="${p.glassInputBox}"></button>
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">四周柔和暗角</div>
                  <div class="ag-row-sub">增强画面边缘聚光感与状态栏可读性。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="vignette" aria-checked="${p.vignette}"></button>
              </div>
            </div>
          </div>
        `;
      } else {
        const fontOptionsHtml = FONT_PRESETS.map((f) => {
          const selected = p.fontFamily === f.value ? 'selected' : '';
          return `<option value="${escapeHtml(f.value)}" ${selected}>${escapeHtml(f.label)}</option>`;
        }).join('');

        const customTextHex = (p.customTextColor || '#18181b').toUpperCase();
        const bubbleBgHex = (p.userBubbleBg || '#4c1d95').toUpperCase();
        const bubbleTextHex = (p.userBubbleText || computeAutoTextColor(p.userBubbleBg)).toUpperCase();
        const accentHex = (p.accentColor || '#a78bfa').toUpperCase();

        body.innerHTML = `
          <!-- 聊天文字与可读性 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">聊天文字</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">会话文字色调</div>
                  <div class="ag-row-sub">自动模式会识别壁纸明暗，智能匹配文字与通透底色。</div>
                </div>
                <div class="ag-pill-seg">
                  <button type="button" class="ag-pill-btn ${p.textTone === 'auto' ? 'active' : ''}" data-text-tone="auto">自动</button>
                  <button type="button" class="ag-pill-btn ${p.textTone === 'dark' ? 'active' : ''}" data-text-tone="dark">深色</button>
                  <button type="button" class="ag-pill-btn ${p.textTone === 'light' ? 'active' : ''}" data-text-tone="light">浅色</button>
                  <button type="button" class="ag-pill-btn ${p.textTone === 'custom' ? 'active' : ''}" data-text-tone="custom">自定义</button>
                </div>
              </div>
              ${p.textTone === 'custom' ? `
                <div class="ag-list-row">
                  <div class="ag-row-info"><div class="ag-row-title">前景文字颜色</div></div>
                  <label class="ag-color-pill">
                    <span class="ag-color-dot" style="background:${escapeHtml(customTextHex)}" data-dot-for="customTextColor"></span>
                    <span data-hex-for="customTextColor">${escapeHtml(customTextHex)}</span>
                    <input type="color" value="${escapeHtml(p.customTextColor || '#18181b')}" data-color-picker="customTextColor" />
                  </label>
                </div>
              ` : ''}
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">文字轮廓柔影</div>
                  <div class="ag-row-sub">在复杂纹理壁纸上提升文字边缘对比度。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="textShadow" aria-checked="${p.textShadow}"></button>
              </div>
            </div>
          </div>

          <!-- 发送消息气泡 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">消息气泡</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">自定义发送气泡样式</div>
                  <div class="ag-row-sub">调整用户消息气泡的底色与磨砂透光度。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="userBubbleEnabled" aria-checked="${p.userBubbleEnabled}"></button>
              </div>
              ${p.userBubbleEnabled ? `
                <div class="ag-list-row">
                  <div class="ag-row-info"><div class="ag-row-title">气泡预设与底色</div></div>
                  <div style="display:flex;align-items:center;gap:8px;">
                    <div class="ag-swatches">
                      ${BUBBLE_PRESETS.map((bp) => `
                        <button type="button" class="ag-swatch ${p.userBubbleBg.toLowerCase() === bp.bg.toLowerCase() ? 'active' : ''}"
                          style="background:${bp.bg}" data-bubble-preset="${bp.bg}" data-bubble-alpha="${bp.alpha}" title="${bp.label}"></button>
                      `).join('')}
                    </div>
                    <label class="ag-color-pill">
                      <span class="ag-color-dot" style="background:${escapeHtml(bubbleBgHex)}" data-dot-for="userBubbleBg"></span>
                      <span data-hex-for="userBubbleBg">${escapeHtml(bubbleBgHex)}</span>
                      <input type="color" value="${escapeHtml(p.userBubbleBg || '#4c1d95')}" data-color-picker="userBubbleBg" />
                    </label>
                  </div>
                </div>
                <div class="ag-list-row col" data-slider-row="userBubbleAlpha">
                  <div class="ag-slider-head">
                    <span class="ag-row-title">气泡不透明度</span>
                    <span class="ag-slider-val" data-val-for="userBubbleAlpha">${Math.round((p.userBubbleAlpha ?? 0.72) * 100)}%</span>
                  </div>
                  <input class="ag-range" type="range" min="0.15" max="1" step="0.01" value="${p.userBubbleAlpha ?? 0.72}" data-slider="userBubbleAlpha" />
                </div>
                <div class="ag-list-row">
                  <div class="ag-row-info">
                    <div class="ag-row-title">文字颜色自动对比</div>
                    <div class="ag-row-sub">根据气泡底色明暗自动切换深浅文字。</div>
                  </div>
                  <button type="button" class="ag-switch" data-toggle="userBubbleTextAuto" aria-checked="${p.userBubbleTextAuto}"></button>
                </div>
                ${!p.userBubbleTextAuto ? `
                  <div class="ag-list-row">
                    <div class="ag-row-info"><div class="ag-row-title">气泡文字颜色</div></div>
                    <label class="ag-color-pill">
                      <span class="ag-color-dot" style="background:${escapeHtml(bubbleTextHex)}" data-dot-for="userBubbleText"></span>
                      <span data-hex-for="userBubbleText">${escapeHtml(bubbleTextHex)}</span>
                      <input type="color" value="${escapeHtml(p.userBubbleText || computeAutoTextColor(p.userBubbleBg))}" data-color-picker="userBubbleText" />
                    </label>
                  </div>
                ` : ''}
              ` : ''}
            </div>
          </div>

          <!-- 外观与入口 -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">全局外观与快捷入口</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info"><div class="ag-row-title">界面字体</div></div>
                <select class="ag-select" data-select="fontFamily">${fontOptionsHtml}</select>
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info"><div class="ag-row-title">自定义焦点强调色</div></div>
                <div style="display:flex;align-items:center;gap:8px;">
                  <label class="ag-color-pill">
                    <span class="ag-color-dot" style="background:${escapeHtml(accentHex)}" data-dot-for="accentColor"></span>
                    <span data-hex-for="accentColor">${escapeHtml(accentHex)}</span>
                    <input type="color" value="${escapeHtml(p.accentColor)}" data-color-picker="accentColor" />
                  </label>
                  <button type="button" class="ag-switch" data-toggle="useAccent" aria-checked="${p.useAccent}"></button>
                </div>
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">显示悬浮快捷按钮</div>
                  <div class="ag-row-sub">支持在窗口内按住自由拖动位置。</div>
                </div>
                <button type="button" class="ag-switch" data-toggle="showTriggerButton" aria-checked="${p.showTriggerButton}"></button>
              </div>
              <div class="ag-list-row">
                <div class="ag-row-info"><div class="ag-row-title">悬浮按钮停靠区</div></div>
                <div class="ag-pill-seg">
                  <button type="button" class="ag-pill-btn ${p.triggerCorner === 'sidebar-bottom' ? 'active' : ''}" data-corner-opt="sidebar-bottom">侧栏底</button>
                  <button type="button" class="ag-pill-btn ${p.triggerCorner === 'bottom-left' ? 'active' : ''}" data-corner-opt="bottom-left">左下</button>
                  <button type="button" class="ag-pill-btn ${p.triggerCorner === 'top-right' ? 'active' : ''}" data-corner-opt="top-right">右上</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 配置管理与高级 CSS -->
          <div class="ag-group">
            <div class="ag-group-header"><span class="ag-group-title">配置管理</span></div>
            <div class="ag-group-box">
              <div class="ag-list-row">
                <div class="ag-row-info">
                  <div class="ag-row-title">主题配置备份</div>
                  <div class="ag-row-sub">导入或导出 JSON 格式的主题参数。</div>
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="ag-action-pill" data-action="import-prefs">导入</button>
                  <button type="button" class="ag-action-pill" data-action="export-prefs">导出</button>
                  <button type="button" class="ag-action-pill" data-action="reset-prefs">重置</button>
                </div>
              </div>
              <div class="ag-list-row col">
                <button type="button" class="ag-more-link" data-action="toggle-advanced">
                  <span>自定义 CSS 样式表</span>
                  <span>${state.advancedOpen ? '▾' : '›'}</span>
                </button>
                ${state.pendingImportCss ? `
                  <div style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:1px solid rgba(251,191,36,0.45);background:rgba(251,191,36,0.08);font-size:12px;">
                    <div style="font-weight:600;margin-bottom:4px;">⚠️ 导入的配置包含自定义 CSS（已默认暂不执行）</div>
                    <div style="opacity:0.8;margin-bottom:6px;">出于安全，分享配置中的 CSS 需经你完整审阅后手动启用（共 ${state.pendingImportCss.length} 字符，${state.pendingImportCss.split('\n').length} 行）：</div>
                    <pre data-pending-import-css-preview="1" style="max-height:220px;overflow:auto;padding:8px;border-radius:6px;font-size:11px;line-height:1.45;margin:0 0 8px 0;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,0.28);">${escapeHtml(state.pendingImportCss)}</pre>
                    <div style="display:flex;gap:6px;justify-content:flex-end;">
                      <button type="button" class="ag-action-pill" data-action="dismiss-import-css">忽略</button>
                      <button type="button" class="ag-action-pill" data-action="apply-import-css">确认启用</button>
                    </div>
                  </div>
                ` : ''}
                ${state.advancedOpen ? `
                  <textarea class="ag-textarea" data-input="customCss" placeholder="/* 自定义 CSS 片段（实时生效） */">${escapeHtml(p.customCss)}</textarea>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }

      bindDrawerEvents(body);
    }

    function bindDrawerEvents(body) {
      // Switches
      body.querySelectorAll('[data-toggle]').forEach((el) => {
        el.addEventListener('click', () => {
          const key = el.getAttribute('data-toggle');
          const next = !state.prefs[key];
          updatePref(
            { [key]: next },
            {
              rescan: key === 'enabled' || key === 'glassInputBox' || key === 'userBubbleEnabled',
              reloadMedia: key === 'enabled' && next,
              rerenderDrawer: true,
              immediate: true
            }
          );
          if (key === 'enabled') showToast(next ? '已开启桌面美化 ✨' : '已暂时关闭美化，恢复原版界面');
          if (key === 'glassInputBox') showToast(next ? '输入框已开启毛玻璃质感' : '输入框已恢复原版实色');
          if (key === 'userBubbleEnabled') showToast(next ? '已开启自定义用户消息气泡 💬' : '用户消息气泡已恢复原版样式');
        });
      });

      // Render Mode
      body.querySelectorAll('[data-mode]').forEach((el) => {
        el.addEventListener('click', () => {
          const mode = el.getAttribute('data-mode');
          updatePref({ renderMode: mode }, { rescan: true, rerenderDrawer: true, immediate: true });
          showToast(mode === 'glass' ? '切换为：通透毛玻璃模式' : '切换为：轻柔叠层模式');
        });
      });

      // Fit Mode & Wallpaper Position
      body.querySelectorAll('[data-fit]').forEach((el) => {
        el.addEventListener('click', () => {
          updatePref({ wallpaperFit: el.getAttribute('data-fit') }, { rerenderDrawer: true, immediate: true });
        });
      });
      body.querySelectorAll('[data-pos]').forEach((el) => {
        el.addEventListener('click', () => {
          updatePref({ wallpaperPos: el.getAttribute('data-pos') }, { rerenderDrawer: true, immediate: true });
        });
      });

      // Chat Text Tone
      body.querySelectorAll('[data-text-tone]').forEach((el) => {
        el.addEventListener('click', () => {
          const tone = el.getAttribute('data-text-tone');
          updatePref({ textTone: tone }, { rerenderDrawer: true, immediate: true });
          const labels = { auto: '自动匹配壁纸明暗 ✨', dark: '深色字（配浅色壁纸）', light: '浅色字（配深色壁纸）', custom: '自定义颜色（自动配底色）' };
          showToast(`会话文字：${labels[tone] || tone}`);
        });
      });

      // Trigger Corner
      body.querySelectorAll('[data-corner-opt]').forEach((el) => {
        el.addEventListener('click', () => {
          updatePref({ triggerCorner: el.getAttribute('data-corner-opt'), triggerPos: null }, { rerenderDrawer: true, immediate: true });
        });
      });

      // Preset Cards: first click switches wallpaper only (preserving user's custom sliders/mode); clicking active preset applies its recommended sliders
      body.querySelectorAll('[data-preset-id]').forEach((el) => {
        el.addEventListener('click', () => {
          const id = el.getAttribute('data-preset-id');
          const preset = state.presets.find((x) => x.id === id);
          const alreadyActive = state.prefs && state.prefs.presetId === id;
          const patch = { enabled: true, presetId: id };
          if (alreadyActive && preset && preset.recommended) {
            Object.assign(patch, preset.recommended);
            const effTone = patch.textTone || (state.prefs && state.prefs.textTone) || 'auto';
            let contrastTip = '';
            // Only add protective scrim when user manually forced a clashing text tone (auto mode flips text cleanly!)
            if (effTone === 'light' && preset.modeHint === 'light') {
              patch.scrim = Math.max(patch.scrim || 0, 0.52);
              contrastTip = '（浅色字模式下已自动加深护眼遮罩）';
            } else if (effTone === 'dark' && preset.modeHint === 'dark') {
              patch.scrim = Math.max(patch.scrim || 0, 0.52);
              contrastTip = '（深色字模式下已自动提亮护眼遮罩）';
            }
            updatePref(patch, { rescan: true, reloadMedia: false, rerenderDrawer: true, immediate: true });
            showToast(`已套用「${preset.name}」推荐参数 ✨${contrastTip}`);
          } else {
            updatePref(patch, { rescan: true, reloadMedia: true, rerenderDrawer: true, immediate: true });
            showToast(`已切换壁纸：${preset ? preset.name : id}（再次点击可套用推荐参数）`);
          }
        });
      });

      // Custom Wallpaper Select
      body.querySelectorAll('[data-custom-file]').forEach((el) => {
        el.addEventListener('click', (evt) => {
          if (evt.target && evt.target.closest('[data-del-file]')) return;
          const file = el.getAttribute('data-custom-file');
          updatePref({ enabled: true, presetId: 'custom', customWallpaperFile: file }, { rescan: true, reloadMedia: true, rerenderDrawer: true, immediate: true });
          showToast('已应用本地壁纸 🖼️');
        });
      });

      // Custom Wallpaper Delete
      body.querySelectorAll('[data-del-file]').forEach((el) => {
        el.addEventListener('click', async (evt) => {
          evt.stopPropagation();
          const file = el.getAttribute('data-del-file');
          const res = await ipcRenderer.invoke('ag-theme:delete-custom', file);
          if (res && res.ok) {
            state.customList = res.customList || [];
            if (res.prefs) {
              applyAuthoritativePrefs(res.prefs, res.revision, { preserveUnconfirmed: true });
            }
            renderDrawerContent();
            showToast('已删除该壁纸');
          }
        });
      });

      // Live Sliders + Peek-Through Mode while dragging + Double-click row to reset default
      const drawerEl = body.closest('.ag-theme-drawer');
      body.querySelectorAll('[data-slider]').forEach((el) => {
        const key = el.getAttribute('data-slider');
        const rowEl = el.closest('.ag-list-row');

        const stopPeek = () => {
          if (drawerEl) drawerEl.classList.remove('peeking');
          if (rowEl) rowEl.classList.remove('peeking-active');
        };
        el.addEventListener('pointerdown', () => {
          if (drawerEl) drawerEl.classList.add('peeking');
          if (rowEl) rowEl.classList.add('peeking-active');
        });
        el.addEventListener('pointerup', stopPeek);
        el.addEventListener('pointercancel', stopPeek);
        el.addEventListener('blur', stopPeek);

        el.addEventListener('input', () => {
          const val = Number(el.value);
          const label = body.querySelector(`[data-val-for="${key}"]`);
          if (label) {
            if (key === 'blur' || key === 'panelBlur') label.textContent = `${val}px`;
            else label.textContent = `${Math.round(val * 100)}%`;
          }
          updatePref({ [key]: val }, { immediate: false });
        });
      });

      body.querySelectorAll('[data-slider-row]').forEach((row) => {
        row.addEventListener('dblclick', (evt) => {
          if (evt.target && evt.target.tagName === 'INPUT') return;
          const key = row.getAttribute('data-slider-row');
          if (!key || SLIDER_DEFAULTS[key] === undefined) return;
          const defVal = SLIDER_DEFAULTS[key];
          updatePref({ [key]: defVal }, { rerenderDrawer: true, immediate: true });
          showToast('已恢复该项默认值');
        });
      });

      // Bubble Presets
      body.querySelectorAll('[data-bubble-preset]').forEach((el) => {
        el.addEventListener('click', () => {
          const bg = el.getAttribute('data-bubble-preset');
          const alpha = Number(el.getAttribute('data-bubble-alpha')) || 0.72;
          const autoText = computeAutoTextColor(bg);
          updatePref(
            {
              userBubbleEnabled: true,
              userBubbleBg: bg,
              userBubbleAlpha: alpha,
              userBubbleTextAuto: true,
              userBubbleText: autoText
            },
            { rescan: true, rerenderDrawer: true, immediate: true }
          );
          showToast(`已切换气泡配色：${el.getAttribute('title') || bg}`);
        });
      });

      // Accent Swatches & Official Color Swatch Pills
      body.querySelectorAll('[data-swatch]').forEach((el) => {
        el.addEventListener('click', () => {
          updatePref({ useAccent: true, accentColor: el.getAttribute('data-swatch') }, { rerenderDrawer: true, immediate: true });
        });
      });
      body.querySelectorAll('[data-color-picker]').forEach((picker) => {
        picker.addEventListener('input', () => {
          const key = picker.getAttribute('data-color-picker');
          const valLower = String(picker.value || '').toLowerCase();
          const valUpper = valLower.toUpperCase();
          const dotEl = body.querySelector(`[data-dot-for="${key}"]`);
          if (dotEl) dotEl.style.background = valUpper;
          const hexEl = body.querySelector(`[data-hex-for="${key}"]`);
          if (hexEl) hexEl.textContent = valUpper;

          if (key === 'customTextColor') {
            updatePref({ textTone: 'custom', customTextColor: picker.value }, { immediate: false });
          } else if (key === 'userBubbleBg') {
            const patch = { userBubbleEnabled: true, userBubbleBg: picker.value };
            if (state.prefs && state.prefs.userBubbleTextAuto) {
              patch.userBubbleText = computeAutoTextColor(picker.value);
            }
            updatePref(patch, { immediate: false });
            body.querySelectorAll('[data-bubble-preset]').forEach((sw) => {
              sw.classList.toggle('active', (sw.getAttribute('data-bubble-preset') || '').toLowerCase() === valLower);
            });
          } else if (key === 'userBubbleText') {
            updatePref({ userBubbleEnabled: true, userBubbleTextAuto: false, userBubbleText: picker.value }, { immediate: false });
          } else {
            updatePref({ useAccent: true, accentColor: picker.value }, { immediate: false });
            const swBtn = body.querySelector('[data-toggle="useAccent"]');
            if (swBtn) swBtn.setAttribute('aria-checked', 'true');
            body.querySelectorAll('[data-swatch]').forEach((sw) => {
              sw.classList.toggle('active', (sw.getAttribute('data-swatch') || '').toLowerCase() === valLower);
            });
          }
        });
      });

      // Font Select
      const fontSel = body.querySelector('[data-select="fontFamily"]');
      if (fontSel) {
        fontSel.addEventListener('change', () => {
          updatePref({ fontFamily: fontSel.value }, { immediate: true });
        });
      }

      // Custom CSS Textarea
      const cssInput = body.querySelector('[data-input="customCss"]');
      if (cssInput) {
        cssInput.addEventListener('input', () => {
          updatePref({ customCss: cssInput.value }, { immediate: false });
        });
      }

      // Action Buttons
      body.querySelectorAll('[data-action]').forEach((el) => {
        el.addEventListener('click', async () => {
          const act = el.getAttribute('data-action');
          if (act === 'toggle-advanced') {
            state.advancedOpen = !state.advancedOpen;
            renderDrawerContent();
          } else if (act === 'pick-wallpaper') {
            const res = await ipcRenderer.invoke('ag-theme:pick-wallpaper');
            if (res && !res.canceled) {
              if (!res.ok) {
                showToast(res.error || '导入壁纸失败');
                return;
              }
              state.customList = res.customList || [];
              const applied = applyAuthoritativePrefs(res.prefs, res.revision, {
                preserveUnconfirmed: true,
                inlineMedia: res.media
              });
              if (applied) {
                scheduleSurfaceScan(50);
                renderDrawerContent();
                showToast('自定义壁纸已生效 ✨');
              }
            }
          } else if (act === 'open-folder') {
            await ipcRenderer.invoke('ag-theme:open-folder');
          } else if (act === 'export-prefs') {
            const res = await ipcRenderer.invoke('ag-theme:export-prefs');
            if (res && res.ok && !res.canceled) showToast('主题配置已导出 📤');
          } else if (act === 'import-prefs') {
            const res = await ipcRenderer.invoke('ag-theme:import-prefs');
            if (res && !res.canceled) {
              if (!res.ok) { showToast(res.error || '导入失败'); return; }
              const applied = applyAuthoritativePrefs(res.prefs, res.revision, { clearPending: true });
              if (!applied) return;
              state.pendingImportCss = res.pendingCustomCss || '';
              if (state.pendingImportCss) {
                state.activeTab = 'appearance';
                state.advancedOpen = true;
              }
              scheduleSurfaceScan(50);
              renderDrawerContent();
              showToast(state.pendingImportCss ? '配置已导入（自定义 CSS 待你完整审阅后启用）' : '主题配置已导入 📥');
            }
          } else if (act === 'apply-import-css') {
            const css = state.pendingImportCss || '';
            state.pendingImportCss = '';
            updatePref({ customCss: css }, { rerenderDrawer: true, immediate: true });
            showToast('已启用导入的自定义 CSS ✨');
          } else if (act === 'dismiss-import-css') {
            state.pendingImportCss = '';
            renderDrawerContent();
            showToast('已忽略导入的自定义 CSS');
          } else if (act === 'reset-prefs') {
            const res = await ipcRenderer.invoke('ag-theme:reset-prefs');
            if (res && res.ok) {
              const applied = applyAuthoritativePrefs(res.prefs, res.revision, { clearPending: true });
              if (!applied) return;
              state.pendingImportCss = '';
              scheduleSurfaceScan(50);
              renderDrawerContent();
              showToast('已恢复默认美化配置');
            }
          }
        });
      });
    }

    // ---- Boot ----
    function boot() {
      let listenersInstalled = false;
      let bootPromise = null;

      const installGlobalShortcutsAndSync = () => {
        if (listenersInstalled) return;
        listenersInstalled = true;

        // Register Ctrl+Shift+B / Escape BEFORE IPC so recovery drawer is ALWAYS reachable even if get-boot fails!
        window.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
            e.preventDefault();
            setDrawerOpen(!state.drawerOpen);
          } else if (e.key === 'Escape' && state.drawerOpen) {
            setDrawerOpen(false);
          }
        }, true);

        // Multi-window preference sync (P1-7): revision-ordered broadcast merge that preserves unconfirmed local edits!
        if (typeof ipcRenderer.on === 'function') {
          ipcRenderer.on('ag-theme:prefs-updated', (_evt, payload) => {
            if (!payload || typeof payload !== 'object') return;
            const nextPrefs = payload.prefs && typeof payload.prefs === 'object' ? payload.prefs : payload;
            const rev = typeof payload.revision === 'number' ? payload.revision : undefined;
            const applied = applyAuthoritativePrefs(nextPrefs, rev, { preserveUnconfirmed: true });
            if (!applied) return;
            scheduleSurfaceScan(80);
            syncTriggerButton();
            if (state.drawerOpen) renderDrawerContent();
          });
        }
      };

      let observersInstalled = false;
      const installObservers = () => {
        if (observersInstalled) return;
        observersInstalled = true;

        // Fast, throttled micro-pass on next animation frame
        let lastFastPassAt = 0;
        function fastConversationSwitchPass(forceNow) {
          const now = Date.now();
          if (!forceNow && now - lastFastPassAt < 120) return;
          if (state.rafPending) return;
          state.rafPending = true;
          requestAnimationFrame(() => {
            state.rafPending = false;
            lastFastPassAt = Date.now();
            const p = state.prefs;
            if (!p || !p.enabled) return;
            const dark = detectDarkMode();
            if (dark !== state.isDark) {
              state.isDark = dark;
              resampleActiveWallpaper(false, true);
              applyDynamicCss();
              syncDrawerThemeAttr();
            }
            const vw = window.innerWidth || 1280;
            const vh = window.innerHeight || 800;
            scanNativeOverlays(vw, vh);
            if (p.renderMode !== 'glass') return;
            const gradNodes = document.querySelectorAll('[class*="gradient"], [class*="linear-to"], [style*="gradient"]');
            const gLim = Math.min(gradNodes.length, 48);
            for (let i = 0; i < gLim; i++) {
              const el = gradNodes[i];
              if (el.hasAttribute('data-ag-fade-mask') || el.getAttribute('data-ag-surface') === 'header-clean') continue;
              tagFadeMaskIfMatched(el, vw, null);
              if (!isProtectedElement(el)) {
                const r = el.getBoundingClientRect();
                if (r.top <= 104 && r.height >= 12 && r.height <= 68 && r.width >= 6 && r.width <= vw * 0.48) {
                  el.setAttribute('data-ag-surface', 'header-clean');
                  learnFadeSelector(el);
                }
              }
            }
            const rootEl = document.getElementById('root') || document.body;
            scanHeaderClean(rootEl, vw);
            const inputBox = scanInputBox(p);
            // Ultra-lightweight immediate sweep of inputBox's close ancestors, siblings & point-probed overlay above composer
            if (inputBox) {
              const boxRect = inputBox.getBoundingClientRect();
              if (typeof document.elementsFromPoint === 'function' && boxRect.width > 120 && boxRect.top > 24) {
                const probeY = Math.max(8, boxRect.top - 10);
                const probeXs = [boxRect.left + 24, boxRect.left + boxRect.width * 0.5];
                for (const px of probeXs) {
                  try {
                    const stack = document.elementsFromPoint(px, probeY);
                    for (const hit of stack) {
                      if (!hit || hit === document.body || hit.hasAttribute('data-ag-fade-mask')) continue;
                      tagFadeMaskIfMatched(hit, vw, boxRect);
                    }
                  } catch {}
                }
              }
              let cur = inputBox;
              for (let d = 0; cur && d < 8 && cur !== document.body; d++) {
                const nearRect = d <= 4 ? boxRect : null;
                if (!isProtectedElement(cur)) {
                  if (d >= 1 && d <= 3 && cur.tagName !== 'MAIN' && !cur.querySelector('[data-testid="conversation-view"]')) {
                    const cr = cur.getBoundingClientRect();
                    if (cr.height <= Math.max(260, boxRect.height + 140) && cr.width >= boxRect.width * 0.85) {
                      if (cur.getAttribute('data-ag-composer-region') !== '1') {
                        cur.setAttribute('data-ag-composer-region', '1');
                      }
                    }
                  }
                  if (!cur.hasAttribute('data-ag-fade-mask')) {
                    tagFadeMaskIfMatched(cur, vw, nearRect);
                  }
                  const kids = cur.children;
                  const kLim = Math.min(kids.length, 10);
                  for (let k = 0; k < kLim; k++) {
                    const sib = kids[k];
                    if (sib === inputBox || sib.contains(inputBox)) continue;
                    if (!sib.hasAttribute('data-ag-fade-mask')) {
                      tagFadeMaskIfMatched(sib, vw, nearRect);
                    }
                    const grands = sib.children;
                    const gLim = Math.min(grands.length, 6);
                    for (let g = 0; g < gLim; g++) {
                      const grand = grands[g];
                      if (!grand.hasAttribute('data-ag-fade-mask')) {
                        tagFadeMaskIfMatched(grand, vw, nearRect);
                      }
                    }
                  }
                }
                cur = cur.parentElement;
              }
            }
            scanUserBubbles(vw, true);
            scanClashingChatControls(null, false);
          });
        }

        // 1. Zero-overhead theme observer: watches ONLY html & body root attributes (subtree: false!)
        const themeMo = new MutationObserver(() => {
          if (document.hidden) return;
          const dark = detectDarkMode();
          if (dark !== state.isDark) {
            state.isDark = dark;
            resampleActiveWallpaper(false, true);
            applyDynamicCss();
            syncDrawerThemeAttr();
            scheduleSurfaceScan(120);
          }
        });
        themeMo.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style']
        });
        if (document.body) {
          themeMo.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'data-theme', 'data-color-scheme', 'style']
          });
        }

        function scheduleIncrementalAddedScan() {
          if (state.streamScanRafPending) return;
          state.streamScanRafPending = true;
          requestAnimationFrame(() => {
            state.streamScanRafPending = false;
            const roots = Array.from(state.pendingAddedRoots);
            state.pendingAddedRoots.clear();
            if (!roots.length || !state.prefs || !state.prefs.enabled) return;
            const vw = window.innerWidth || 1280;
            scanUserBubbles(vw, true, { targetRoots: roots });
          });
        }

        // 2. Structural DOM observer: watches ONLY childList mounts/unmounts; routes streaming text mounts incrementally!
        const domMo = new MutationObserver((mutations) => {
          if (document.hidden) return;
          let hasStructuralChange = false;
          let hasConversationMount = false;
          let hasIncrementalBubbleMount = false;
          const vw = window.innerWidth || 1280;
          const vh = window.innerHeight || 800;
          const inputBox = document.querySelector('[data-testid="agent-input-box"]');
          let addedCheckCount = 0;
          for (const m of mutations) {
            const targetEl = m.target && m.target.nodeType === 1 ? m.target : null;
            // Pure assistant streaming text updates inside planner-response-text never alter structural layout or user bubbles
            const insideStreamingAssistant = Boolean(
              targetEl && targetEl.closest && targetEl.closest('[data-testid="planner-response-text"]')
            );
            const insideConversationStream = Boolean(
              !insideStreamingAssistant && targetEl && targetEl.closest && targetEl.closest('[data-testid="conversation-view"]')
            );

            if (m.addedNodes && m.addedNodes.length > 0) {
              for (const n of m.addedNodes) {
                if (n.nodeType !== 1 || isProtectedElement(n)) continue;
                if (insideStreamingAssistant) {
                  // Only check newly mounted interactive controls (e.g. Markdown Preview/Raw toggle) inside streamed responses
                  if (n.tagName === 'BUTTON' || (n.querySelector && n.querySelector('button'))) {
                    requestAnimationFrame(() => scanClashingChatControls(n, false));
                  }
                  continue;
                }

                const tid = n.getAttribute('data-testid') || '';
                const isConvRoot = tid === 'conversation-view' || tid === 'agent-input-box'
                  || Boolean(n.querySelector && n.querySelector('[data-testid="agent-input-box"], [data-testid="conversation-view"]'));
                if (isConvRoot) {
                  hasConversationMount = true;
                  hasStructuralChange = true;
                }

                // Instant 0ms protection for newly mounted popovers/overview cards/modals (e.g. Ctrl+Alt+O overview panel!)
                let handledSpecial = false;
                if (addedCheckCount < 6) {
                  addedCheckCount++;
                  if (isNativeOverlayCandidate(n, vw, vh, inputBox)) {
                    n.setAttribute('data-ag-native-surface', '1');
                    stripSurfaceTagsInside(n);
                    hasStructuralChange = true;
                    handledSpecial = true;
                  } else if (n.firstElementChild && isNativeOverlayCandidate(n.firstElementChild, vw, vh, inputBox)) {
                    n.firstElementChild.setAttribute('data-ag-native-surface', '1');
                    stripSurfaceTagsInside(n.firstElementChild);
                    hasStructuralChange = true;
                    handledSpecial = true;
                  } else if (n.closest && n.closest('[data-ag-sidebar="1"]')) {
                    const sb = n.closest('[data-ag-sidebar="1"]');
                    if (sb) cleanSidebarHoverAction(n, sb, true);
                    hasStructuralChange = true;
                    handledSpecial = true;
                  }
                }

                if (!isConvRoot && !handledSpecial && insideConversationStream) {
                  if (state.pendingAddedRoots.size < 30) {
                    state.pendingAddedRoots.add(n);
                  }
                  hasIncrementalBubbleMount = true;
                } else if (!handledSpecial) {
                  hasStructuralChange = true;
                }
              }
            }
            if (!hasStructuralChange && m.removedNodes && m.removedNodes.length > 0) {
              for (const n of m.removedNodes) {
                if (n.nodeType === 1 && (n.getAttribute('data-ag-native-surface') === '1' || n.getAttribute('role') === 'dialog' || n.getAttribute('role') === 'menu')) {
                  hasStructuralChange = true;
                  break;
                }
              }
            }
          }
          if (hasIncrementalBubbleMount && !hasStructuralChange) {
            scheduleIncrementalAddedScan();
          }
          if (hasStructuralChange) {
            // Bypass 120ms throttle immediately when switching/loading a cold conversation so bottom black strip NEVER flashes!
            fastConversationSwitchPass(hasConversationMount);
            // Debounce full scan to 380ms so side-pane open/close width animations stay butter-smooth!
            scheduleSurfaceScan(hasConversationMount ? 160 : 380);
          }
        });
        domMo.observe(document.documentElement, {
          childList: true,
          subtree: true
        });

        window.addEventListener('resize', () => {
          if (state.resizeSampleTimer) clearTimeout(state.resizeSampleTimer);
          state.resizeSampleTimer = setTimeout(() => {
            state.resizeSampleTimer = null;
            resampleActiveWallpaper(true, false);
          }, 180);
          scheduleSurfaceScan(260);
        });

        // Ultra-fast viewport-bounded user-bubble tagging during chat scrolling (O(visible unchecked bubbles))
        let lastScrollScanAt = 0;
        document.addEventListener('scroll', () => {
          const p = state.prefs;
          if (!p || !p.enabled) return;
          const now = Date.now();
          if (state.scrollRafPending || now - lastScrollScanAt < 90) return;
          state.scrollRafPending = true;
          requestAnimationFrame(() => {
            state.scrollRafPending = false;
            lastScrollScanAt = Date.now();
            scanUserBubbles(window.innerWidth || 1280, true, { viewportOnly: true });
            scanClashingChatControls(null, true);
          });
        }, { capture: true, passive: true });

        // Lightweight hover action bar cleaner: softens small [↓][📌][⋮] action overlays inside a hovered row OR its sibling wrapper.
        // NEVER toggles data-ag-measuring (no layout thrashing) and NEVER stamps permanent sidebar-pill onto hovered rows!
        let lastHoverCleanAt = 0;
        let lastHoverScope = null;
        function inspectHoverActionScope(scopeEl, sbRect) {
          if (!scopeEl) return;
          const smalls = scopeEl.querySelectorAll('div, span');
          const sLim = Math.min(smalls.length, 32);
          for (let i = 0; i < sLim; i++) {
            const el = smalls[i];
            if (el.getAttribute('data-testid') === 'conversation-row-sidebar' || el.getAttribute('data-project-card') === 'true') continue;
            if (el.getAttribute('data-ag-surface') === 'sidebar-action' || el.getAttribute('data-ag-fade-mask')) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 6 || r.width >= sbRect.width * 0.68 || r.height < 10 || r.height > 48) continue;
            let st;
            try { st = window.getComputedStyle(el); } catch { continue; }
            if (!st || st.display === 'none') continue;
            try {
              const bef = window.getComputedStyle(el, '::before');
              if (bef && bef.content !== 'none' && hasNeutralGradient(bef.backgroundImage)) {
                el.setAttribute('data-ag-fade-mask', 'before');
              }
            } catch {}
            try {
              const aft = window.getComputedStyle(el, '::after');
              if (aft && aft.content !== 'none' && hasNeutralGradient(aft.backgroundImage)) {
                const cur = el.getAttribute('data-ag-fade-mask');
                el.setAttribute('data-ag-fade-mask', cur === 'before' ? 'both' : 'after');
              }
            } catch {}
            const hasGrad = hasNeutralGradient(st.backgroundImage);
            const rgba = parseRgba(st.backgroundColor);
            const isHarshBg = Boolean(rgba && rgba.a >= 0.35 && isNeutralColor(rgba) && (luminance(rgba) < 0.32 || luminance(rgba) > 0.85));
            if (hasGrad || isHarshBg) {
              if (el.querySelector('button, svg')) {
                el.setAttribute('data-ag-surface', 'sidebar-action');
              } else {
                el.setAttribute('data-ag-fade-mask', 'self');
                learnFadeSelector(el);
              }
            }
          }
        }

        function cleanSidebarHoverAction(targetEl, sb, bypassThrottle) {
          const now = Date.now();
          let row = targetEl.closest('[data-testid="conversation-row-sidebar"], [data-project-card="true"]');
          let scopeEl = row;
          if (!scopeEl) {
            // Pointer may be directly on the sibling action bar itself! Walk up to row wrapper (height <= 56)
            let cur = targetEl;
            for (let d = 0; cur && d < 4 && cur !== sb; d++) {
              const cr = cur.getBoundingClientRect();
              if (cr.height >= 22 && cr.height <= 58 && cr.width >= 120) {
                scopeEl = cur;
                break;
              }
              cur = cur.parentElement;
            }
          } else if (scopeEl.parentElement && scopeEl.parentElement !== sb) {
            // Include the tight parent wrapper so sibling action bars ([↓][📌][⋮]) next to <button data-testid="conversation-row-sidebar"> are scanned!
            const pr = scopeEl.parentElement.getBoundingClientRect();
            if (pr.height <= 60) scopeEl = scopeEl.parentElement;
          }
          if (!scopeEl || !sb.contains(scopeEl)) return;
          if (!bypassThrottle && scopeEl === lastHoverScope && now - lastHoverCleanAt < 100) return;
          lastHoverScope = scopeEl;
          lastHoverCleanAt = now;
          const sbRect = sb.getBoundingClientRect();
          inspectHoverActionScope(scopeEl, sbRect);
          if (!bypassThrottle) {
            requestAnimationFrame(() => inspectHoverActionScope(scopeEl, sbRect));
          }
        }

        document.addEventListener('pointerover', (e) => {
          const p = state.prefs;
          if (!p || !p.enabled || p.renderMode !== 'glass') return;
          const t = e.target;
          if (!t || t.nodeType !== 1) return;
          const sb = t.closest && t.closest('[data-ag-sidebar="1"]');
          if (!sb) return;
          cleanSidebarHoverAction(t, sb, false);
        }, { capture: true, passive: true });

        // O(1) instant check when pointer leaves a conversation row:
        // respects semantic active attributes first, then checks native color fallback (with live mode guard on delayed checks)
        const SEMANTIC_ACTIVE_ROW = '[aria-current="page"], [aria-selected="true"], [data-active="true"], [data-selected="true"], [data-state="active"]';
        function syncRowPillOnLeave(row, strictThreshold) {
          const p = state.prefs;
          if (!p || !p.enabled || p.renderMode !== 'glass') return;
          if (!row || !row.isConnected) return;
          if (row.matches && (row.matches(':hover') || row.matches(SEMANTIC_ACTIVE_ROW))) return;
          const hadPill = row.getAttribute('data-ag-surface') === 'sidebar-pill';
          if (hadPill) row.removeAttribute('data-ag-surface');
          let st;
          try { st = window.getComputedStyle(row); } catch { return; }
          if (!st || st.display === 'none') return;
          const rgba = parseRgba(st.backgroundColor);
          const minA = strictThreshold ? 0.35 : 0.05;
          const isHarshActive = Boolean(
            rgba && rgba.a >= minA && isNeutralColor(rgba) &&
            (luminance(rgba) < 0.36 || luminance(rgba) > 0.82)
          );
          if (isHarshActive) {
            row.setAttribute('data-ag-surface', 'sidebar-pill');
          }
        }

        document.addEventListener('pointerout', (e) => {
          const p = state.prefs;
          if (!p || !p.enabled || p.renderMode !== 'glass') return;
          const t = e.target;
          if (!t || t.nodeType !== 1) return;
          const row = t.closest && t.closest('[data-ag-sidebar="1"] [data-testid="conversation-row-sidebar"]');
          if (!row) return;
          const rel = e.relatedTarget;
          if (rel && rel.nodeType === 1 && row.contains(rel)) return;
          if (row.matches && row.matches(SEMANTIC_ACTIVE_ROW)) return;
          syncRowPillOnLeave(row, true);
          requestAnimationFrame(() => syncRowPillOnLeave(row, true));
          setTimeout(() => syncRowPillOnLeave(row, false), 180);
        }, { capture: true, passive: true });

        // Single debounced click handler for opening settings/popovers/right pane or switching conversations
        let clickScanTimer = null;
        document.addEventListener('click', (e) => {
          const p = state.prefs;
          if (!p || !p.enabled) return;
          const t = e.target;
          if (t && t.nodeType === 1 && t.closest && t.closest('#ag-theme-studio-ui-root, #ag-theme-studio-trigger-root')) return;
          const segTrack = t && t.nodeType === 1 && t.closest && t.closest('[data-ag-surface="chat-pill-track"]');
          if (segTrack) {
            requestAnimationFrame(() => syncSegmentedTrackPills(segTrack));
          }
          if (clickScanTimer) clearTimeout(clickScanTimer);
          const inSidebar = Boolean(t && t.nodeType === 1 && t.closest && t.closest('[data-ag-sidebar="1"]'));
          const inTopBar = typeof e.clientY === 'number' && e.clientY <= 110;
          clickScanTimer = setTimeout(() => {
            clickScanTimer = null;
            fastConversationSwitchPass(true);
            if (inTopBar) scheduleSurfaceScan(380);
            else if (inSidebar) scheduleSurfaceScan(200);
            else scheduleSurfaceScan(300);
          }, inTopBar ? 30 : 45);
        }, { capture: true, passive: true });

        // Pause video wallpaper when app window is hidden to save GPU; ONLY resume active, visible non-CSS video!
        document.addEventListener('visibilitychange', () => {
          const p = state.prefs;
          if (!document.hidden && p && p.enabled) {
            scheduleSurfaceScan(80);
          }
          const wrap = document.getElementById(IDS.backdrop);
          const vid = wrap && wrap.querySelector('.ag-bg-video');
          if (!vid) return;
          if (document.hidden || !p || !p.enabled || p.presetId === 'nebula-css' || !state.activeIsVideo || !state.activeBlobUrl) {
            stopVideoSampleLoop();
            try { if (!vid.paused) vid.pause(); } catch {}
          } else if (vid.style.display !== 'none') {
            vid.play().catch(() => {});
            startVideoSampleLoopIfNeeded(vid);
          }
        });
      };

      const loadBootData = async () => {
        if (bootPromise) return bootPromise;
        bootPromise = (async () => {
          ensureStyleEl(IDS.styleBase, BASE_CSS);
          state.isDark = detectDarkMode();
          ensureBackdropDom();
          ensureUiRoot();
          installGlobalShortcutsAndSync();
          state.bootError = '';

          try {
            const bootData = await ipcRenderer.invoke('ag-theme:get-boot');
            state.presets = bootData.presets || [];
            state.customList = bootData.customList || [];
            state.bootReady = true;
            state.bootError = '';

            // Apply boot prefs via revision-aware path (never overwrites newer broadcast that arrived mid-boot!)
            const applied = applyAuthoritativePrefs(bootData.prefs, bootData.revision, {
              preserveUnconfirmed: true,
              inlineMedia: bootData.activeMedia || null
            });
            if (!applied && state.prefs && state.prefs.enabled && state.prefs.presetId !== 'nebula-css' && !state.activeBlobUrl) {
              loadCurrentWallpaper().catch(() => {});
            }
            syncTriggerButton();
            installObservers();
            scanSurfaces();
            scheduleSurfaceScan(100);
            setTimeout(() => scheduleSurfaceScan(0), 450);
            setTimeout(() => scheduleSurfaceScan(0), 1100);
            if (state.drawerOpen) {
              renderDrawerContent();
              loadPresetThumbsIfNeeded().catch(() => {});
            }
          } catch (err) {
            state.bootError = String(err && err.message ? err.message : err);
            try { console.error('[AG-Theme-Studio] get-boot failed:', err); } catch {}
            // Keep trigger button visible so user can open drawer and click retry even after an IPC hiccup
            const trigRoot = ensureTriggerRoot();
            const btn = trigRoot && trigRoot.querySelector('.ag-theme-trigger');
            if (btn) {
              btn.classList.remove('hidden');
              if (!btn.style.left && !btn.style.right) {
                btn.style.left = '14px';
                btn.style.bottom = '52px';
              }
            }
            if (state.drawerOpen) renderDrawerContent();
          } finally {
            bootPromise = null;
          }
        })();
        return bootPromise;
      };

      state.retryBootFn = () => {
        loadBootData().catch(() => {});
      };

      const startDom = () => {
        loadBootData().catch((err) => {
          try { console.error('[AG-Theme-Studio] boot error:', err); } catch {}
        });
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startDom, { once: true });
      } else {
        startDom();
      }
    }

    boot();
  } catch (err) {
    try { console.error('[AG-Theme-Studio] preload error:', err); } catch {}
  }
})();
