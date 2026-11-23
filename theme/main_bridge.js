;(function () {
  try {
    const electron = require('electron');
    const ipcMain = electron && electron.ipcMain;
    const dialog = electron && electron.dialog;
    const shell = electron && electron.shell;
    const BaseWindow = electron && electron.BaseWindow;
    const BrowserWindow = electron && electron.BrowserWindow;

    if (!ipcMain || globalThis.__AG_THEME_MAIN_BRIDGE__) return;
    globalThis.__AG_THEME_MAIN_BRIDGE__ = true;

    const fs = require('fs');
    const fsp = fs.promises;
    const os = require('os');
    const path = require('path');

    // Resolve host Antigravity Hub registry & active LS origin when injected into dist/main.js
    let hostUtils = null;
    let hostAuthBootstrap = null;
    let hostConstants = null;
    try { hostUtils = require('./utils'); } catch {}
    try { hostAuthBootstrap = require('./authBootstrap'); } catch {}
    try { hostConstants = require('./constants'); } catch {}

    const PLUGIN_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-theme');
    const PREFS_PATH = path.join(PLUGIN_DIR, 'theme_prefs.json');
    const PRESET_DIR = path.join(PLUGIN_DIR, 'assets', 'wallpapers');
    const CUSTOM_DIR = path.join(PLUGIN_DIR, 'wallpapers', 'custom');

    const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
    const MAX_VIDEO_BYTES = 35 * 1024 * 1024;
    const MAX_PREFS_JSON_BYTES = 256 * 1024; // 256 KiB cap for imported config JSON

    const MIME_MAP = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.avif': 'image/avif',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm'
    };

    const BUILTIN_PRESETS = [
      {
        id: 'gemini-neko',
        name: 'Gemini 猫猫',
        subtitle: '默认 · 白底异瞳猫娘',
        file: 'gemini-neko.jpg',
        modeHint: 'light',
        featured: true,
        swatch: 'linear-gradient(135deg, #ffffff 0%, #ede9fe 55%, #f5d0fe 100%)',
        recommended: {
          renderMode: 'glass',
          wallpaperFit: 'contain',
          wallpaperPos: 'center',
          opacity: 1,
          blur: 1,
          scrim: 0,
          saturate: 1,
          panelAlpha: 0.15,
          panelBlur: 0,
          vignette: false,
          textTone: 'auto',
          userBubbleEnabled: true,
          userBubbleBg: '#ffffff',
          userBubbleAlpha: 0.62,
          userBubbleTextAuto: true,
          userBubbleText: '#18181b',
          accentColor: '#a78bfa'
        }
      },
      {
        id: 'starry-neko',
        name: '蓝紫星河',
        subtitle: '深色 · 猫猫星穹',
        file: 'starry-neko.jpg',
        modeHint: 'dark',
        swatch: 'linear-gradient(135deg, #12122b 0%, #3b1d6c 58%, #d9468f 100%)',
        recommended: {
          renderMode: 'glass',
          wallpaperFit: 'cover',
          wallpaperPos: 'center',
          opacity: 0.78,
          blur: 1,
          scrim: 0.2,
          saturate: 1.08,
          panelAlpha: 0.6,
          panelBlur: 14,
          vignette: true,
          textTone: 'auto',
          accentColor: '#a78bfa'
        }
      },
      {
        id: 'sakura-mist',
        name: '樱雪微光',
        subtitle: '浅色 · 柔雾花瓣',
        file: 'sakura-mist.jpg',
        modeHint: 'light',
        swatch: 'linear-gradient(135deg, #fff7fb 0%, #f5d0fe 55%, #fde68a 100%)',
        recommended: {
          renderMode: 'glass',
          wallpaperFit: 'cover',
          wallpaperPos: 'center',
          opacity: 0.85,
          blur: 1,
          scrim: 0.14,
          saturate: 1.04,
          panelAlpha: 0.66,
          panelBlur: 12,
          vignette: false,
          textTone: 'auto',
          accentColor: '#ec4899'
        }
      },
      {
        id: 'cyber-aurora',
        name: '极光深海',
        subtitle: '深色 · 极客霓光',
        file: 'cyber-aurora.jpg',
        modeHint: 'dark',
        swatch: 'linear-gradient(135deg, #090d16 0%, #0e7490 55%, #7c3aed 100%)',
        recommended: {
          renderMode: 'glass',
          wallpaperFit: 'cover',
          wallpaperPos: 'center',
          opacity: 0.8,
          blur: 1,
          scrim: 0.18,
          saturate: 1.1,
          panelAlpha: 0.62,
          panelBlur: 14,
          vignette: true,
          textTone: 'auto',
          accentColor: '#38bdf8'
        }
      },
      {
        id: 'nebula-css',
        name: '纯光渐变',
        subtitle: '零图片 · 轻量流光',
        file: '',
        modeHint: 'auto',
        swatch: 'radial-gradient(circle at 80% 20%, #a855f7 0%, #1e1b4b 55%, #09090b 100%)',
        recommended: {
          renderMode: 'glass',
          opacity: 0.85,
          blur: 0,
          scrim: 0.12,
          saturate: 1.05,
          panelAlpha: 0.68,
          panelBlur: 12,
          textTone: 'auto',
          accentColor: '#8b5cf6'
        }
      }
    ];

    const DEFAULT_PREFS = {
      prefsVersion: 2,
      enabled: true,
      presetId: 'gemini-neko',
      renderMode: 'glass',
      customWallpaperFile: '',
      wallpaperFit: 'contain',
      wallpaperPos: 'center',
      opacity: 1,
      blur: 1,
      scrim: 0,
      saturate: 1,
      panelAlpha: 0.15,
      panelBlur: 0,
      glassInputBox: true,
      vignette: false,
      textTone: 'auto',
      customTextColor: '#18181b',
      textShadow: false,
      userBubbleEnabled: true,
      userBubbleBg: '#ffffff',
      userBubbleAlpha: 0.62,
      userBubbleTextAuto: true,
      userBubbleText: '#18181b',
      useAccent: false,
      accentColor: '#a78bfa',
      fontFamily: '',
      customCss: '',
      studioTheme: 'glass',
      showTriggerButton: true,
      triggerCorner: 'sidebar-bottom',
      triggerPos: null
    };

    const presetThumbCache = new Map(); // file -> { mtimeMs, thumbDataUrl }
    const registeredThemeContents = new Set(); // Strictly verified Hub WebContents eligible for broadcast

    function getAllowedHostOrigins() {
      const origins = new Set();
      if (!hostAuthBootstrap) return origins;
      let gotBase = false;
      try {
        if (typeof hostAuthBootstrap.getActiveLsBaseUrl === 'function') {
          const base = hostAuthBootstrap.getActiveLsBaseUrl();
          if (base) {
            const parsed = new URL(base);
            if (parsed.protocol === 'https:') {
              origins.add(parsed.origin);
              gotBase = true;
            }
          }
        }
      } catch {}
      if (!gotBase) {
        try {
          if (typeof hostAuthBootstrap.getActiveLsPort === 'function') {
            const port = hostAuthBootstrap.getActiveLsPort();
            if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535) {
              const baseOrigin = (hostConstants && typeof hostConstants.WINDOW_ORIGIN === 'string' && hostConstants.WINDOW_ORIGIN)
                ? hostConstants.WINDOW_ORIGIN
                : 'https://127.0.0.1';
              const parsed = new URL(`${baseOrigin}:${port}`);
              if (parsed.protocol === 'https:') {
                origins.add(parsed.origin);
              }
            }
          }
        } catch {}
      }
      return origins;
    }

    function isPathInsideDirSync(baseDir, candidatePath) {
      if (!baseDir || !candidatePath) return false;
      try {
        const realBase = fs.realpathSync(baseDir);
        const realTarget = fs.realpathSync(candidatePath);
        const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
        if (process.platform === 'win32') {
          return realTarget.toLowerCase().startsWith(prefix.toLowerCase());
        }
        return realTarget.startsWith(prefix);
      } catch {
        return false;
      }
    }

    function isTrustedOriginUrl(rawUrl) {
      // Fail-closed: ONLY accept exact HTTPS origins actively reported by the host authBootstrap.
      // NEVER accept HTTP, DEV_URL override, empty URL, about:*, file://, arbitrary ports, or unknown origins!
      if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
      try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:') return false;
        const allowedOrigins = getAllowedHostOrigins();
        if (allowedOrigins.size === 0) return false;
        return allowedOrigins.has(u.origin);
      } catch {
        return false;
      }
    }

    function isHostRegisteredHubWebContents(sender) {
      if (!sender || typeof sender.isDestroyed !== 'function' || sender.isDestroyed()) return false;
      // Reject <webview> guests and embedded child guests
      if (sender.hostWebContents) return false;
      if (typeof sender.getType === 'function' && sender.getType() === 'webview') return false;

      // Fail-closed: require host Hub registry APIs to definitively prove sender is a registered Hub window
      if (!hostUtils || typeof hostUtils.resolveHubWindowFromWebContents !== 'function' || typeof hostUtils.getHubWebContents !== 'function') {
        return false;
      }
      try {
        const win = hostUtils.resolveHubWindowFromWebContents(sender);
        if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
        const hub = hostUtils.getHubWebContents(win);
        if (!hub) return false;
        return hub === sender || (typeof sender.id === 'number' && hub.id === sender.id);
      } catch {
        return false;
      }
    }

    function registerTrustedWebContents(sender) {
      if (!sender || registeredThemeContents.has(sender)) return;
      registeredThemeContents.add(sender);
      if (typeof sender.once === 'function') {
        try {
          sender.once('destroyed', () => {
            registeredThemeContents.delete(sender);
          });
        } catch {}
      }
    }

    function assertTrustedSender(evt) {
      if (!evt || !evt.sender || typeof evt.sender.isDestroyed !== 'function' || evt.sender.isDestroyed()) {
        throw new Error('Unauthorized IPC sender');
      }
      const sender = evt.sender;
      // Strictly require senderFrame and verify it is the top-level mainFrame (never allow missing senderFrame or subframes!)
      if (!evt.senderFrame) {
        throw new Error('IPC rejected: missing senderFrame');
      }
      if (!sender.mainFrame || evt.senderFrame !== sender.mainFrame || evt.senderFrame.parent) {
        throw new Error('IPC rejected: non-main frame');
      }
      if (!isHostRegisteredHubWebContents(sender)) {
        throw new Error('IPC rejected: caller is not a registered Hub window');
      }
      const frameUrl = typeof evt.senderFrame.url === 'string' && evt.senderFrame.url
        ? evt.senderFrame.url
        : (typeof sender.getURL === 'function' ? sender.getURL() : '');
      if (!isTrustedOriginUrl(frameUrl)) {
        throw new Error('IPC rejected: untrusted origin');
      }
      registerTrustedWebContents(sender);
      return sender;
    }

    function resolveSenderWindow(evt) {
      try {
        const sender = evt && evt.sender;
        if (!sender) return null;
        if (hostUtils && typeof hostUtils.resolveHubWindowFromWebContents === 'function' && typeof hostUtils.getHubWebContents === 'function') {
          const win = hostUtils.resolveHubWindowFromWebContents(sender);
          if (win && (!win.isDestroyed || !win.isDestroyed())) {
            const hub = hostUtils.getHubWebContents(win);
            if (hub && (hub === sender || (typeof sender.id === 'number' && hub.id === sender.id))) {
              return win;
            }
          }
          return null;
        }
        if (BrowserWindow && typeof BrowserWindow.fromWebContents === 'function') {
          const bw = BrowserWindow.fromWebContents(sender);
          if (bw && !bw.isDestroyed()) return bw;
        }
        if (BaseWindow && typeof BaseWindow.fromWebContents === 'function') {
          const base = BaseWindow.fromWebContents(sender);
          if (base && !base.isDestroyed()) return base;
        }
        // Inspect BaseWindow WebContentsView hierarchy directly to avoid ever touching an unrelated window
        if (BaseWindow && typeof BaseWindow.getAllWindows === 'function') {
          const all = BaseWindow.getAllWindows();
          const hasSenderInView = (view) => {
            if (!view) return false;
            if (view.webContents && view.webContents.id === sender.id) return true;
            if (Array.isArray(view.children)) {
              for (const child of view.children) {
                if (hasSenderInView(child)) return true;
              }
            }
            return false;
          };
          for (const win of all) {
            if (!win || win.isDestroyed()) continue;
            if (win.contentView && hasSenderInView(win.contentView)) return win;
          }
        }
      } catch {}
      return null;
    }

    function ensureDirsSync() {
      try { fs.mkdirSync(PLUGIN_DIR, { recursive: true }); } catch {}
      try { fs.mkdirSync(CUSTOM_DIR, { recursive: true }); } catch {}
    }

    async function ensureDirsAsync() {
      await fsp.mkdir(PLUGIN_DIR, { recursive: true }).catch(() => {});
      await fsp.mkdir(CUSTOM_DIR, { recursive: true }).catch(() => {});
    }

    function clamp(num, min, max, fallback) {
      const n = Number(num);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function sanitizePrefs(raw) {
      const src = raw && typeof raw === 'object' ? raw : {};
      const validModes = ['glass', 'overlay'];
      const validFits = ['cover', 'contain', 'fill'];
      const validPos = ['center', 'top', 'bottom', 'left', 'right'];
      const validCorners = ['sidebar-bottom', 'bottom-left', 'top-right', 'top-left', 'custom'];
      const validTextTones = ['auto', 'dark', 'light', 'custom'];
      const validStudioThemes = ['dark', 'light', 'glass'];
      const hexRe = /^#[0-9a-fA-F]{6}$/;

      const isLegacyV1 = Number(src.prefsVersion || 1) < 2;
      let corner = validCorners.includes(src.triggerCorner) ? src.triggerCorner : DEFAULT_PREFS.triggerCorner;
      if (isLegacyV1 && corner === 'top-right') {
        corner = 'sidebar-bottom';
      }

      let triggerPos = null;
      if (src.triggerPos && typeof src.triggerPos === 'object') {
        const x = Number(src.triggerPos.x);
        const y = Number(src.triggerPos.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          triggerPos = { x: Math.round(x), y: Math.round(y) };
        }
      }

      return {
        prefsVersion: 2,
        enabled: src.enabled !== undefined ? Boolean(src.enabled) : DEFAULT_PREFS.enabled,
        presetId: typeof src.presetId === 'string' ? src.presetId.slice(0, 64) : DEFAULT_PREFS.presetId,
        renderMode: validModes.includes(src.renderMode) ? src.renderMode : DEFAULT_PREFS.renderMode,
        customWallpaperFile: typeof src.customWallpaperFile === 'string'
          ? path.basename(src.customWallpaperFile).slice(0, 180)
          : '',
        wallpaperFit: validFits.includes(src.wallpaperFit) ? src.wallpaperFit : DEFAULT_PREFS.wallpaperFit,
        wallpaperPos: validPos.includes(src.wallpaperPos) ? src.wallpaperPos : DEFAULT_PREFS.wallpaperPos,
        opacity: clamp(src.opacity, 0.05, 1, DEFAULT_PREFS.opacity),
        blur: clamp(src.blur, 0, 32, DEFAULT_PREFS.blur),
        scrim: clamp(src.scrim, 0, 0.85, DEFAULT_PREFS.scrim),
        saturate: clamp(src.saturate, 0.5, 1.6, DEFAULT_PREFS.saturate),
        panelAlpha: clamp(src.panelAlpha, 0.15, 0.96, DEFAULT_PREFS.panelAlpha),
        panelBlur: clamp(src.panelBlur, 0, 28, DEFAULT_PREFS.panelBlur),
        glassInputBox: src.glassInputBox !== undefined ? Boolean(src.glassInputBox) : DEFAULT_PREFS.glassInputBox,
        vignette: src.vignette !== undefined ? Boolean(src.vignette) : DEFAULT_PREFS.vignette,
        textTone: validTextTones.includes(src.textTone) ? src.textTone : DEFAULT_PREFS.textTone,
        customTextColor: typeof src.customTextColor === 'string' && hexRe.test(src.customTextColor)
          ? src.customTextColor
          : DEFAULT_PREFS.customTextColor,
        textShadow: src.textShadow !== undefined ? Boolean(src.textShadow) : DEFAULT_PREFS.textShadow,
        userBubbleEnabled: src.userBubbleEnabled !== undefined ? Boolean(src.userBubbleEnabled) : DEFAULT_PREFS.userBubbleEnabled,
        userBubbleBg: typeof src.userBubbleBg === 'string' && hexRe.test(src.userBubbleBg)
          ? src.userBubbleBg
          : DEFAULT_PREFS.userBubbleBg,
        userBubbleAlpha: clamp(src.userBubbleAlpha, 0.15, 1, DEFAULT_PREFS.userBubbleAlpha),
        userBubbleTextAuto: src.userBubbleTextAuto !== undefined ? Boolean(src.userBubbleTextAuto) : DEFAULT_PREFS.userBubbleTextAuto,
        userBubbleText: typeof src.userBubbleText === 'string' && hexRe.test(src.userBubbleText)
          ? src.userBubbleText
          : DEFAULT_PREFS.userBubbleText,
        useAccent: src.useAccent !== undefined ? Boolean(src.useAccent) : DEFAULT_PREFS.useAccent,
        accentColor: typeof src.accentColor === 'string' && hexRe.test(src.accentColor)
          ? src.accentColor
          : DEFAULT_PREFS.accentColor,
        fontFamily: typeof src.fontFamily === 'string' ? src.fontFamily.replace(/[{}<>\\;]/g, '').slice(0, 140) : '',
        customCss: typeof src.customCss === 'string' ? src.customCss.slice(0, 20000) : '',
        studioTheme: validStudioThemes.includes(src.studioTheme) ? src.studioTheme : DEFAULT_PREFS.studioTheme,
        showTriggerButton: src.showTriggerButton !== undefined ? Boolean(src.showTriggerButton) : DEFAULT_PREFS.showTriggerButton,
        triggerCorner: corner,
        triggerPos
      };
    }

    let defaultOverlayTransparent = true;
    let saveSeq = 0;
    let prefsRevision = 0;
    let prefsQueue = Promise.resolve();

    function refreshDefaultOverlayFlag(prefs) {
      defaultOverlayTransparent = Boolean(prefs && prefs.enabled);
    }

    /**
     * Read up to `maxBytes` from an already-validated file path using a single open file handle.
     * Protects against TOCTOU file growth during read and bounds peak memory strictly to maxBytes.
     */
    async function readFileBoundedAsync(filePath, maxBytes, opts) {
      const checkDir = opts && opts.allowedBaseDir ? opts.allowedBaseDir : null;
      const rejectSymlink = Boolean(opts && opts.rejectSymlink);
      if (rejectSymlink || checkDir) {
        let lst;
        try {
          lst = await fsp.lstat(filePath);
        } catch {
          return { ok: false, code: 'ENOENT', error: 'file not found' };
        }
        if (!lst.isFile() || lst.isSymbolicLink()) {
          return { ok: false, error: 'not a regular file' };
        }
        if (checkDir) {
          try {
            const inside = await isStrictlyInsideDir(checkDir, filePath);
            if (!inside) return { ok: false, error: 'path boundary violation' };
          } catch {
            return { ok: false, error: 'path verification failed' };
          }
        }
      }

      let fh;
      try {
        fh = await fsp.open(filePath, 'r');
        const st = await fh.stat();
        if (!st.isFile()) return { ok: false, error: 'not a regular file' };
        if (st.size > maxBytes) {
          return { ok: false, code: 'LIMIT', error: `file exceeds limit (${maxBytes} bytes)` };
        }
        const chunks = [];
        let total = 0;
        let pos = 0;
        const CHUNK_SIZE = 64 * 1024;
        while (true) {
          const remainingAllowance = (maxBytes - total) + 1;
          const toRead = Math.min(CHUNK_SIZE, remainingAllowance);
          const buf = Buffer.allocUnsafe(toRead);
          const { bytesRead } = await fh.read(buf, 0, toRead, pos);
          if (bytesRead <= 0) break;
          pos += bytesRead;
          total += bytesRead;
          if (total > maxBytes) {
            return { ok: false, code: 'LIMIT', error: `file exceeds limit (${maxBytes} bytes)` };
          }
          chunks.push(bytesRead === toRead ? buf : buf.subarray(0, bytesRead));
        }
        const dataBuf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
        return { ok: true, buffer: dataBuf, bytes: total, mtimeMs: st.mtimeMs };
      } catch (err) {
        return { ok: false, code: err && err.code, error: String(err && err.message || err) };
      } finally {
        if (fh) { try { await fh.close(); } catch {} }
      }
    }

    function loadPrefsSync() {
      ensureDirsSync();
      let fd = null;
      try {
        const lst = fs.lstatSync(PREFS_PATH);
        if (lst.isFile() && !lst.isSymbolicLink() && isPathInsideDirSync(PLUGIN_DIR, PREFS_PATH)) {
          fd = fs.openSync(PREFS_PATH, 'r');
          const st = fs.fstatSync(fd);
          if (st.isFile() && st.size <= MAX_PREFS_JSON_BYTES) {
            const chunks = [];
            let total = 0;
            let pos = 0;
            const CHUNK_SIZE = 32 * 1024;
            let overflow = false;
            while (true) {
              const toRead = Math.min(CHUNK_SIZE, (MAX_PREFS_JSON_BYTES - total) + 1);
              const buf = Buffer.allocUnsafe(toRead);
              const n = fs.readSync(fd, buf, 0, toRead, pos);
              if (n <= 0) break;
              pos += n;
              total += n;
              if (total > MAX_PREFS_JSON_BYTES) {
                overflow = true;
                break;
              }
              chunks.push(n === toRead ? buf : buf.subarray(0, n));
            }
            if (!overflow) {
              const rawBuf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, total);
              const parsed = JSON.parse(rawBuf.toString('utf8'));
              const p = sanitizePrefs(parsed);
              refreshDefaultOverlayFlag(p);
              return p;
            }
          }
        }
      } catch {} finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch {} }
      }
      const def = sanitizePrefs(DEFAULT_PREFS);
      refreshDefaultOverlayFlag(def);
      return def;
    }

    async function loadPrefsAsync() {
      await ensureDirsAsync();
      try {
        const res = await readFileBoundedAsync(PREFS_PATH, MAX_PREFS_JSON_BYTES, {
          allowedBaseDir: PLUGIN_DIR,
          rejectSymlink: true
        });
        if (res.ok) {
          const p = sanitizePrefs(JSON.parse(res.buffer.toString('utf8')));
          refreshDefaultOverlayFlag(p);
          return p;
        }
      } catch {}
      const def = sanitizePrefs(DEFAULT_PREFS);
      refreshDefaultOverlayFlag(def);
      return def;
    }

    async function savePrefsAtomic(next) {
      await ensureDirsAsync();
      const normalized = sanitizePrefs(next);
      const jsonStr = JSON.stringify(normalized, null, 2);
      const tmp = `${PREFS_PATH}.${process.pid}.${++saveSeq}.tmp`;
      try {
        await fsp.writeFile(tmp, jsonStr, 'utf8');
        await fsp.rename(tmp, PREFS_PATH);
      } catch (err) {
        try { await fsp.unlink(tmp); } catch {}
        throw new Error(`保存配置失败: ${err && err.message ? err.message : String(err)}`);
      }
      refreshDefaultOverlayFlag(normalized);
      return normalized;
    }

    /**
     * Strictly serialize all preference read-merge-write transactions so concurrent multi-window saves
     * NEVER clobber each other's distinct fields, and monotonically bump `prefsRevision` on each commit.
     */
    function runPrefsTransaction(mutatorFn) {
      const task = prefsQueue.then(async () => {
        const current = await loadPrefsAsync();
        return mutatorFn(current);
      });
      prefsQueue = task.catch(() => {});
      return task;
    }

    function broadcastPrefsUpdated(prefs, revision, changedKeys, excludeSenderId) {
      try {
        for (const wc of Array.from(registeredThemeContents)) {
          if (!wc || typeof wc.isDestroyed !== 'function' || wc.isDestroyed()) {
            registeredThemeContents.delete(wc);
            continue;
          }
          if (wc.id === excludeSenderId) continue;
          const url = (wc.mainFrame && typeof wc.mainFrame.url === 'string' && wc.mainFrame.url)
            ? wc.mainFrame.url
            : (typeof wc.getURL === 'function' ? wc.getURL() : '');
          if (!isHostRegisteredHubWebContents(wc) || !isTrustedOriginUrl(url)) {
            registeredThemeContents.delete(wc);
            continue;
          }
          try {
            wc.send('ag-theme:prefs-updated', {
              prefs,
              revision,
              changedKeys: Array.isArray(changedKeys) ? changedKeys : null
            });
          } catch {}
        }
      } catch {}
    }

    // Intercept native Windows titleBarOverlay updates on BOTH BaseWindow & BrowserWindow (0ms zero-flash!)
    loadPrefsSync();
    function wrapOverlayProto(proto) {
      if (!proto || typeof proto.setTitleBarOverlay !== 'function' || proto.__agThemeOverlayWrapped) return;
      const origSetTitleBarOverlay = proto.setTitleBarOverlay;
      proto.__agThemeOverlayWrapped = true;
      proto.__agThemeOrigSetTitleBarOverlay = origSetTitleBarOverlay;
      proto.setTitleBarOverlay = function (options) {
        try {
          if (options && typeof options === 'object') {
            this.__agThemeLastOrigOverlay = { ...options };
            const shouldBeTransparent = this.__agThemeOverlayActive !== undefined
              ? Boolean(this.__agThemeOverlayActive)
              : defaultOverlayTransparent;
            if (shouldBeTransparent) {
              return origSetTitleBarOverlay.call(this, { ...options, color: '#00000000' });
            }
          }
        } catch {}
        return origSetTitleBarOverlay.call(this, options);
      };
    }
    if (process.platform === 'win32') {
      if (BaseWindow && BaseWindow.prototype) wrapOverlayProto(BaseWindow.prototype);
      if (BrowserWindow && BrowserWindow.prototype) wrapOverlayProto(BrowserWindow.prototype);
    }

    async function isStrictlyInsideDir(baseDir, candidatePath) {
      const realBase = await fsp.realpath(baseDir);
      const realTarget = await fsp.realpath(candidatePath);
      const prefix = realBase.endsWith(path.sep) ? realBase : realBase + path.sep;
      if (process.platform === 'win32') {
        return realTarget.toLowerCase().startsWith(prefix.toLowerCase());
      }
      return realTarget.startsWith(prefix);
    }

    async function listCustomWallpapersAsync() {
      await ensureDirsAsync();
      try {
        const names = await fsp.readdir(CUSTOM_DIR);
        const items = [];
        for (const name of names) {
          const ext = path.extname(name).toLowerCase();
          if (!MIME_MAP[ext]) continue;
          const full = path.join(CUSTOM_DIR, name);
          let st;
          try { st = await fsp.lstat(full); } catch { continue; }
          if (!st.isFile() || st.isSymbolicLink()) continue;
          items.push({
            file: name,
            mime: MIME_MAP[ext],
            isVideo: ext === '.mp4' || ext === '.webm',
            size: st.size,
            mtimeMs: st.mtimeMs
          });
        }
        items.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return items.slice(0, 24);
      } catch {
        return [];
      }
    }

    async function readMediaFileAsync(source, rawFile) {
      const safeName = path.basename(String(rawFile || ''));
      if (!safeName || safeName === '.' || safeName === '..') {
        return { ok: false, error: 'empty filename' };
      }
      const ext = path.extname(safeName).toLowerCase();
      const mime = MIME_MAP[ext];
      if (!mime) return { ok: false, error: `unsupported format: ${ext}` };

      const baseDir = source === 'preset' ? PRESET_DIR : CUSTOM_DIR;
      const fullPath = path.join(baseDir, safeName);
      const isVideo = ext === '.mp4' || ext === '.webm';
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

      const res = await readFileBoundedAsync(fullPath, limit, {
        allowedBaseDir: baseDir,
        rejectSymlink: true
      });
      if (!res.ok) {
        if (res.code === 'LIMIT') {
          return { ok: false, error: `file exceeds ${(limit / 1024 / 1024).toFixed(0)}MB limit` };
        }
        return { ok: false, error: res.error };
      }
      const buf = res.buffer;
      return {
        ok: true,
        source,
        file: safeName,
        mime,
        isVideo,
        bytes: buf.length,
        mtimeMs: res.mtimeMs,
        data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      };
    }

    async function getPresetThumbAsync(file) {
      if (!file) return { available: true, thumbDataUrl: '' };
      const full = path.join(PRESET_DIR, path.basename(file));
      let st;
      try {
        st = await fsp.lstat(full);
        if (!st.isFile() || st.isSymbolicLink()) return { available: false, thumbDataUrl: '' };
      } catch {
        return { available: false, thumbDataUrl: '' };
      }
      const cached = presetThumbCache.get(file);
      if (cached && cached.mtimeMs === st.mtimeMs) {
        return { available: true, thumbDataUrl: cached.thumbDataUrl };
      }
      const m = await readMediaFileAsync('preset', file);
      if (!m.ok) return { available: false, thumbDataUrl: '' };
      let thumbDataUrl = '';
      if (!m.isVideo && m.bytes <= 2 * 1024 * 1024) {
        const b64 = Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength).toString('base64');
        thumbDataUrl = `data:${m.mime};base64,${b64}`;
      }
      presetThumbCache.set(file, { mtimeMs: st.mtimeMs, thumbDataUrl });
      return { available: true, thumbDataUrl };
    }

    // Lightweight boot: NEVER blocks startup on preset thumbnails or heavy active media payload!
    // Capture { prefs, revision } atomically inside the SAME serialized prefs transaction so slow directory scans
    // can NEVER pair an older prefs object with a newer prefsRevision!
    ipcMain.handle('ag-theme:get-boot', async (evt) => {
      assertTrustedSender(evt);
      const [snapshot, customList] = await Promise.all([
        runPrefsTransaction(async (current) => ({ prefs: current, revision: prefsRevision })),
        listCustomWallpapersAsync()
      ]);
      const presets = BUILTIN_PRESETS.map((p) => {
        const cached = p.file ? presetThumbCache.get(p.file) : null;
        return {
          ...p,
          available: true,
          thumbDataUrl: cached ? cached.thumbDataUrl : ''
        };
      });
      return {
        prefs: snapshot.prefs,
        revision: snapshot.revision,
        presets,
        customList
      };
    });

    // On-demand preset thumbnail loader (invoked lazily when Settings Drawer opens)
    ipcMain.handle('ag-theme:get-preset-thumbs', async (evt) => {
      assertTrustedSender(evt);
      const thumbs = {};
      await Promise.all(BUILTIN_PRESETS.map(async (p) => {
        const res = await getPresetThumbAsync(p.file);
        thumbs[p.id] = res;
      }));
      return { ok: true, thumbs };
    });

    ipcMain.handle('ag-theme:save-prefs', async (evt, partial) => {
      const sender = assertTrustedSender(evt);
      const patch = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
      const changedKeys = Object.keys(patch);
      try {
        return await runPrefsTransaction(async (current) => {
          const merged = await savePrefsAtomic({ ...current, ...patch });
          const revision = ++prefsRevision;
          broadcastPrefsUpdated(merged, revision, changedKeys, sender.id);
          return { ok: true, prefs: merged, revision };
        });
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    });

    ipcMain.handle('ag-theme:reset-prefs', async (evt) => {
      const sender = assertTrustedSender(evt);
      try {
        return await runPrefsTransaction(async () => {
          const merged = await savePrefsAtomic(DEFAULT_PREFS);
          const revision = ++prefsRevision;
          broadcastPrefsUpdated(merged, revision, Object.keys(merged), sender.id);
          return { ok: true, prefs: merged, revision };
        });
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    });

    ipcMain.handle('ag-theme:load-media', async (evt, req) => {
      assertTrustedSender(evt);
      const source = req && req.source === 'custom' ? 'custom' : 'preset';
      const file = req && req.file ? req.file : '';
      return readMediaFileAsync(source, file);
    });

    ipcMain.handle('ag-theme:pick-wallpaper', async (evt) => {
      const sender = assertTrustedSender(evt);
      if (!dialog) return { ok: false, error: 'dialog unavailable' };
      const win = resolveSenderWindow(evt) || undefined;
      const res = await dialog.showOpenDialog(win, {
        title: '选择 Antigravity 自定义背景壁纸',
        properties: ['openFile'],
        filters: [
          {
            name: '图片与动态壁纸',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm']
          }
        ]
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths.length) {
        return { ok: true, canceled: true };
      }

      const srcPath = res.filePaths[0];
      const ext = path.extname(srcPath).toLowerCase();
      if (!MIME_MAP[ext]) {
        return { ok: false, error: `不支持的文件格式: ${ext}` };
      }

      const isVideo = ext === '.mp4' || ext === '.webm';
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      // Single-handle bounded read protects against TOCTOU growth on picked media files too
      const readRes = await readFileBoundedAsync(srcPath, limit, { rejectSymlink: false });
      if (!readRes.ok) {
        if (readRes.code === 'LIMIT') {
          return { ok: false, error: `文件体积过大（最大支持 ${(limit / 1024 / 1024).toFixed(0)}MB）` };
        }
        return { ok: false, error: `无法读取所选文件: ${readRes.error}` };
      }

      await ensureDirsAsync();
      const rawBase = path.basename(srcPath, ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48) || 'wallpaper';
      const destName = `${Date.now().toString(36)}_${rawBase}${ext}`;
      const destPath = path.join(CUSTOM_DIR, destName);
      const tmpDest = `${destPath}.${process.pid}.${++saveSeq}.tmp`;
      try {
        await fsp.writeFile(tmpDest, readRes.buffer);
        await fsp.rename(tmpDest, destPath);
      } catch (err) {
        try { await fsp.unlink(tmpDest); } catch {}
        return { ok: false, error: `写入壁纸副本失败: ${err && err.message || err}` };
      }

      const tx = await runPrefsTransaction(async (current) => {
        const nextPrefs = await savePrefsAtomic({
          ...current,
          enabled: true,
          presetId: 'custom',
          customWallpaperFile: destName
        });
        const revision = ++prefsRevision;
        broadcastPrefsUpdated(nextPrefs, revision, ['enabled', 'presetId', 'customWallpaperFile'], sender.id);
        return { prefs: nextPrefs, revision };
      });

      const customList = await listCustomWallpapersAsync();
      const buf = readRes.buffer;
      return {
        ok: true,
        canceled: false,
        prefs: tx.prefs,
        revision: tx.revision,
        media: {
          ok: true,
          source: 'custom',
          file: destName,
          mime: MIME_MAP[ext],
          isVideo,
          bytes: buf.length,
          mtimeMs: Date.now(),
          data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
        },
        customList
      };
    });

    ipcMain.handle('ag-theme:delete-custom', async (evt, fileName) => {
      const sender = assertTrustedSender(evt);
      const safeName = path.basename(String(fileName || ''));
      if (!safeName || safeName === '.' || safeName === '..') return { ok: false, error: 'invalid file' };
      const target = path.join(CUSTOM_DIR, safeName);
      try {
        const lst = await fsp.lstat(target);
        if (!lst.isFile() || lst.isSymbolicLink()) return { ok: false, error: 'not a regular file' };
        const inside = await isStrictlyInsideDir(CUSTOM_DIR, target);
        if (!inside) return { ok: false, error: 'path boundary violation' };
        await fsp.unlink(target);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') {
          return { ok: false, error: String(err && err.message || err) };
        }
      }
      const tx = await runPrefsTransaction(async (current) => {
        if (current.presetId === 'custom' && current.customWallpaperFile === safeName) {
          const nextPrefs = await savePrefsAtomic({ ...current, presetId: DEFAULT_PREFS.presetId, customWallpaperFile: '' });
          const revision = ++prefsRevision;
          broadcastPrefsUpdated(nextPrefs, revision, ['presetId', 'customWallpaperFile'], sender.id);
          return { prefs: nextPrefs, revision, changed: true };
        }
        return { prefs: current, revision: prefsRevision, changed: false };
      });
      return {
        ok: true,
        prefs: tx.prefs,
        revision: tx.revision,
        customList: await listCustomWallpapersAsync()
      };
    });

    ipcMain.handle('ag-theme:open-folder', async (evt) => {
      assertTrustedSender(evt);
      await ensureDirsAsync();
      if (shell && typeof shell.openPath === 'function') {
        await shell.openPath(CUSTOM_DIR);
        return { ok: true };
      }
      return { ok: false, error: 'shell unavailable' };
    });

    ipcMain.handle('ag-theme:sync-titlebar', async (evt, payload) => {
      try {
        assertTrustedSender(evt);
        if (process.platform !== 'win32') return { ok: true, skipped: true };
        // Strictly target ONLY the window owning evt.sender (never fall back to another window!)
        const win = resolveSenderWindow(evt);
        if (!win || typeof win.setTitleBarOverlay !== 'function') {
          return { ok: false, error: 'sender window not resolved' };
        }
        const active = Boolean(payload && payload.active);
        win.__agThemeOverlayActive = active;
        defaultOverlayTransparent = active;
        const isDark = payload && payload.isDark !== undefined ? Boolean(payload.isDark) : true;
        const origFn = win.__agThemeOrigSetTitleBarOverlay || win.setTitleBarOverlay;
        const lastOrig = win.__agThemeLastOrigOverlay || {};
        const symbolColor = active
          ? (isDark ? '#e4e4e7' : '#18181b')
          : (lastOrig.symbolColor || (isDark ? '#e4e4e7' : '#18181b'));
        const nextOpts = {
          ...(lastOrig.height !== undefined ? { height: lastOrig.height } : {}),
          symbolColor,
          color: active ? '#00000000' : (lastOrig.color || (isDark ? '#111114' : '#ffffff'))
        };
        origFn.call(win, nextOpts);
        return { ok: true, ...nextOpts };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    });

    ipcMain.handle('ag-theme:export-prefs', async (evt) => {
      assertTrustedSender(evt);
      if (!dialog) return { ok: false, error: 'dialog unavailable' };
      const win = resolveSenderWindow(evt) || undefined;
      const prefs = await runPrefsTransaction(async (current) => current);
      const res = await dialog.showSaveDialog(win, {
        title: '导出 Antigravity 主题配置',
        defaultPath: 'antigravity-theme-config.json',
        filters: [{ name: 'JSON 主题配置', extensions: ['json'] }]
      });
      if (!res || res.canceled || !res.filePath) return { ok: true, canceled: true };
      await fsp.writeFile(res.filePath, JSON.stringify(prefs, null, 2), 'utf8');
      return { ok: true, canceled: false };
    });

    ipcMain.handle('ag-theme:import-prefs', async (evt) => {
      const sender = assertTrustedSender(evt);
      if (!dialog) return { ok: false, error: 'dialog unavailable' };
      const win = resolveSenderWindow(evt) || undefined;
      const res = await dialog.showOpenDialog(win, {
        title: '导入 Antigravity 主题配置',
        properties: ['openFile'],
        filters: [{ name: 'JSON 主题配置', extensions: ['json'] }]
      });
      if (!res || res.canceled || !res.filePaths || !res.filePaths.length) {
        return { ok: true, canceled: true };
      }
      try {
        const importPath = res.filePaths[0];
        const readRes = await readFileBoundedAsync(importPath, MAX_PREFS_JSON_BYTES, { rejectSymlink: false });
        if (!readRes.ok) {
          if (readRes.code === 'LIMIT') {
            return { ok: false, error: `配置文件过大（上限 ${Math.round(MAX_PREFS_JSON_BYTES / 1024)}KB）` };
          }
          return { ok: false, error: `无法读取配置文件: ${readRes.error}` };
        }
        const rawText = readRes.buffer.toString('utf8');
        const parsed = JSON.parse(rawText);
        const sanitized = sanitizePrefs(parsed);

        // Security: NEVER silently execute customCss from an imported third-party JSON!
        // Keep current local customCss and return imported customCss for explicit user opt-in.
        const pendingCustomCss = (sanitized.customCss || '').trim();
        const tx = await runPrefsTransaction(async (current) => {
          const safeToApply = { ...sanitized, customCss: current.customCss || '' };
          const prefs = await savePrefsAtomic(safeToApply);
          const revision = ++prefsRevision;
          broadcastPrefsUpdated(prefs, revision, Object.keys(prefs), sender.id);
          return { prefs, revision };
        });

        return {
          ok: true,
          canceled: false,
          prefs: tx.prefs,
          revision: tx.revision,
          pendingCustomCss
        };
      } catch (err) {
        return { ok: false, error: '配置文件解析失败: ' + String(err && err.message || err) };
      }
    });
  } catch (err) {
    try { console.error('[AG-Theme-Studio] main bridge error:', err); } catch {}
  }
})();
