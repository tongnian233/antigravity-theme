#!/usr/bin/env node
'use strict';

/**
 * Antigravity Theme Studio - Transactional Installer, Verifier & Uninstaller
 * Usage:
 *   node setup.cjs                     Install / update assets & patch app.asar (stages if running/locked)
 *   node setup.cjs --kill --relaunch   Close target Antigravity, atomically patch app.asar, and relaunch
 *   node setup.cjs --apply-staged      Verify source+staged hashes and atomically apply staged patch
 *   node setup.cjs --dry-run           Read-only verification (works with install, --uninstall, --apply-staged)
 *   node setup.cjs --check             Print JSON status, host version & Electron fuse compatibility check
 *   node setup.cjs --uninstall         Remove ONLY AG_THEME_STUDIO blocks (keeps Neko HUD & localization)
 *   node setup.cjs --uninstall --purge-data  Also remove theme_prefs.json & custom wallpapers after commit
 *   node setup.cjs --install-dir PATH  Explicit Antigravity installation or resources directory
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const { inspectAsar, inspectAsarBuffer, buildPatchedAsarFromBuffer, parseAsarBuffer } = require('./src/asar_patcher.cjs');

const ROOT_DIR = __dirname;
const PLUGIN_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'antigravity-theme');
const VERIFIED_HOST_VERSIONS = ['2.34.0'];

// Official Electron Fuses v1 sentinel (32 ASCII bytes) + index 4 = EnableEmbeddedAsarIntegrityValidation
const ELECTRON_FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'ascii');
const FUSE_IDX_ASAR_INTEGRITY = 4;

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function parseArgs(argv) {
  const opts = {
    check: false,
    dryRun: false,
    uninstall: false,
    applyStaged: false,
    kill: false,
    relaunch: false,
    purgeData: false,
    allowUnverifiedHost: false,
    installDir: ''
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--uninstall') opts.uninstall = true;
    else if (a === '--apply-staged') opts.applyStaged = true;
    else if (a === '--kill') opts.kill = true;
    else if (a === '--relaunch') opts.relaunch = true;
    else if (a === '--purge-data') opts.purgeData = true;
    else if (a === '--allow-unverified-host') opts.allowUnverifiedHost = true;
    else if (a === '--install-dir') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('参数错误：--install-dir 后缺少目录路径。');
      }
      opts.installDir = next;
      i++;
    } else if (a === '--help' || a === '-h') {
      opts.help = true;
    } else {
      throw new Error(`未知参数：${a}（请使用 --help 查看支持的命令参数）`);
    }
  }

  // Reject conflicting action combinations before any side effect
  const modes = [opts.check, opts.uninstall, opts.applyStaged].filter(Boolean).length;
  if (modes > 1) {
    throw new Error('参数冲突：--check、--uninstall、--apply-staged 不能同时使用。');
  }
  if (opts.purgeData && !opts.uninstall) {
    throw new Error('参数冲突：--purge-data 只能与 --uninstall 搭配使用。');
  }
  if (opts.check && (opts.kill || opts.relaunch || opts.dryRun)) {
    throw new Error('参数冲突：--check 为纯只读检查，不能与 --kill / --relaunch / --dry-run 同时使用。');
  }
  if (opts.dryRun && (opts.kill || opts.relaunch)) {
    throw new Error('参数冲突：--dry-run 必须保持严格只读，不能与 --kill 或 --relaunch 同时使用。');
  }
  return opts;
}

function detectResourcesDir(customDir) {
  if (customDir) {
    const resolved = path.resolve(customDir);
    const explicitCandidates = [resolved, path.join(resolved, 'resources')];
    for (const dir of explicitCandidates) {
      if (fs.existsSync(path.join(dir, 'app.asar'))) return dir;
    }
    // Never silently fall back to default installs when user explicitly provided --install-dir
    throw new Error(`指定的目录中未找到 app.asar：${resolved}`);
  }

  const candidates = [];
  if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(localApp, 'Programs', 'antigravity', 'resources'),
      path.join(localApp, 'Programs', 'Antigravity', 'resources'),
      'C:\\Program Files\\Antigravity\\resources'
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources',
      path.join(os.homedir(), 'Applications', 'Antigravity.app', 'Contents', 'Resources')
    );
  } else {
    candidates.push(
      '/opt/Antigravity/resources',
      '/usr/lib/antigravity/resources',
      '/usr/share/antigravity/resources'
    );
  }

  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, 'app.asar'))) return dir;
  }
  return null;
}

function detectExecutable(resourcesDir) {
  if (process.platform === 'win32') {
    const exe = path.join(path.dirname(resourcesDir), 'Antigravity.exe');
    return fs.existsSync(exe) ? exe : null;
  }
  if (process.platform === 'darwin') {
    const appBundle = path.resolve(resourcesDir, '..', '..');
    const macBin = path.join(appBundle, 'Contents', 'MacOS', 'Antigravity');
    if (fs.existsSync(macBin)) return macBin;
    return fs.existsSync(appBundle) ? appBundle : null;
  }
  const bin = path.join(path.dirname(resourcesDir), 'antigravity');
  return fs.existsSync(bin) ? bin : null;
}

/**
 * Inspect Electron Fuse v1 block in host executable to check EnableEmbeddedAsarIntegrityValidation.
 * Returns { status: 'disabled' | 'enabled' | 'not_found' | 'unreadable' }.
 */
function inspectAsarIntegrityFuse(resourcesDir) {
  const exe = detectExecutable(resourcesDir);
  if (!exe || !fs.existsSync(exe)) return { status: 'not_found' };
  try {
    const st = fs.statSync(exe);
    if (!st.isFile()) return { status: 'not_found' };
    // Stream in 8 MiB overlapping chunks to avoid buffering huge binaries unnecessarily
    const chunkSize = 8 * 1024 * 1024;
    const overlap = 128;
    const fd = fs.openSync(exe, 'r');
    try {
      const buf = Buffer.allocUnsafe(chunkSize + overlap);
      let pos = 0;
      let carryLen = 0;
      while (pos < st.size) {
        const toRead = Math.min(chunkSize, st.size - pos);
        const bytesRead = fs.readSync(fd, buf, carryLen, toRead, pos);
        if (bytesRead <= 0) break;
        const total = carryLen + bytesRead;
        const slice = buf.subarray(0, total);
        const idx = slice.indexOf(ELECTRON_FUSE_SENTINEL);
        if (idx >= 0 && idx + ELECTRON_FUSE_SENTINEL.length + 2 + FUSE_IDX_ASAR_INTEGRITY < total) {
          const fuseVer = slice[idx + ELECTRON_FUSE_SENTINEL.length];
          const fuseLen = slice[idx + ELECTRON_FUSE_SENTINEL.length + 1];
          if (fuseVer === 1 && fuseLen > FUSE_IDX_ASAR_INTEGRITY) {
            const flagByte = slice[idx + ELECTRON_FUSE_SENTINEL.length + 2 + FUSE_IDX_ASAR_INTEGRITY];
            if (flagByte === 0x31) return { status: 'enabled', exe };
            if (flagByte === 0x30) return { status: 'disabled', exe };
          }
        }
        if (total > overlap) {
          buf.copy(buf, 0, total - overlap, total);
          carryLen = overlap;
        } else {
          carryLen = total;
        }
        pos += bytesRead;
      }
    } finally {
      fs.closeSync(fd);
    }
    return { status: 'not_found', exe };
  } catch (err) {
    return { status: 'unreadable', error: err.message };
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Classify Windows Antigravity.exe process inspection rows into verified target PIDs vs unidentifiable PIDs.
 * NEVER places processes with empty/unreadable ExecutablePath into the killable `pids` list!
 */
function classifyWindowsProcesses(records, targetExeLower, selfPid) {
  const matchedPids = [];
  const unknownPids = [];
  const list = Array.isArray(records) ? records : (records ? [records] : []);
  for (const rec of list) {
    if (!rec || typeof rec !== 'object') continue;
    const pid = Number(rec.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue;
    const exePath = typeof rec.ExecutablePath === 'string' ? rec.ExecutablePath.trim() : '';
    if (!exePath) {
      unknownPids.push(pid);
    } else if (exePath.toLowerCase() === targetExeLower) {
      matchedPids.push(pid);
    }
  }
  if (unknownPids.length > 0) {
    return { state: 'unknown', pids: matchedPids, unknownPids };
  }
  return { state: matchedPids.length > 0 ? 'running' : 'stopped', pids: matchedPids, unknownPids: [] };
}

/**
 * Find exact running PIDs belonging to the target Antigravity installation.
 * Returns { state: 'running' | 'stopped' | 'unknown', pids: number[], unknownPids: number[] }.
 */
function findTargetHostProcesses(resourcesDir) {
  const exe = detectExecutable(resourcesDir);
  const installRoot = path.dirname(resourcesDir);
  try {
    if (process.platform === 'win32') {
      const targetExe = (exe || path.join(installRoot, 'Antigravity.exe')).toLowerCase();
      const psScript = [
        '$ErrorActionPreference = "Stop"',
        '$procs = @(Get-CimInstance Win32_Process -Filter "Name = \'Antigravity.exe\'" | Select-Object ProcessId, ExecutablePath)',
        'ConvertTo-Json -InputObject $procs -Compress'
      ].join('; ');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      const parsed = out ? JSON.parse(out) : [];
      return classifyWindowsProcesses(parsed, targetExe, process.pid);
    }

    if (process.platform === 'darwin') {
      const appBundle = path.resolve(resourcesDir, '..', '..');
      const prefix = path.join(appBundle, 'Contents', 'MacOS');
      const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const pids = [];
      for (const line of out.split('\n')) {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid === process.pid) continue;
        if (m[2].startsWith(prefix)) pids.push(pid);
      }
      return { state: pids.length > 0 ? 'running' : 'stopped', pids, unknownPids: [] };
    }

    // Linux: inspect /proc/<pid>/exe to match ONLY the resolved target binary (never kills unrelated processes!)
    const targetReal = exe ? fs.realpathSync(exe) : null;
    if (!targetReal) return { state: 'unknown', pids: [], unknownPids: [] };
    const pids = [];
    const unknownPids = [];
    const targetBase = path.basename(targetReal).toLowerCase();
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === process.pid) continue;
      try {
        const procExe = fs.readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
        if (procExe === targetReal) pids.push(pid);
      } catch (err) {
        if (err && err.code === 'EACCES') {
          try {
            const comm = fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim().toLowerCase();
            if (comm === targetBase) unknownPids.push(pid);
          } catch {}
        }
      }
    }
    if (unknownPids.length > 0) {
      return { state: 'unknown', pids, unknownPids };
    }
    return { state: pids.length > 0 ? 'running' : 'stopped', pids, unknownPids: [] };
  } catch {
    return { state: 'unknown', pids: [], unknownPids: [] };
  }
}

function killTargetHostProcesses(resourcesDir) {
  const initial = findTargetHostProcesses(resourcesDir);
  if (initial.state === 'stopped') return initial;
  if (initial.state === 'unknown') {
    const unkInfo = initial.unknownPids && initial.unknownPids.length
      ? `（发现 ${initial.unknownPids.length} 个无法确认安装路径的同名进程）`
      : '';
    console.warn(`[Theme Studio] ⚠️ 无法安全确认运行中进程的归属${unkInfo}，已跳过强制结束并改为安全暂存。`);
    return initial;
  }

  console.log(`[Theme Studio] 正在关闭运行中的目标 Antigravity 进程 (${initial.pids.length} 个)...`);
  for (const pid of initial.pids) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {}
  }

  // Poll up to 5 seconds to verify all target PIDs actually exited
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    sleepMs(250);
    const check = findTargetHostProcesses(resourcesDir);
    if (check.state === 'stopped' || check.state === 'unknown') return check;
    if (process.platform !== 'win32' && Date.now() + 1500 > deadline) {
      for (const pid of check.pids) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
  }
  return findTargetHostProcesses(resourcesDir);
}

function relaunchAntigravity(resourcesDir) {
  const exe = detectExecutable(resourcesDir);
  if (!exe) {
    console.log('[Theme Studio] 未找到 Antigravity 可执行文件，请手动重新打开客户端。');
    return;
  }
  console.log(`[Theme Studio] 正在重新启动 Antigravity: ${exe}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'darwin') {
    const appBundle = path.resolve(resourcesDir, '..', '..');
    spawn('open', [appBundle], { detached: true, stdio: 'ignore', env }).unref();
  } else {
    spawn(exe, [], { detached: true, stdio: 'ignore', env }).unref();
  }
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

function checkPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (err) {
    if (err && err.code === 'EPERM') return 'alive';
    if (err && err.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

function publishLockFileAtomic(targetPath, jsonPayload, tmpTag) {
  const tmpLock = `${targetPath}.tmp.${process.pid}.${Date.now()}.${tmpTag}`;
  try {
    fs.writeFileSync(tmpLock, jsonPayload, { encoding: 'utf8', mode: 0o600 });
    try {
      // Atomic link: targetPath appears with complete JSON payload instantaneously (zero empty-file window!)
      fs.linkSync(tmpLock, targetPath);
      return;
    } catch (linkErr) {
      if (linkErr && linkErr.code === 'EEXIST') throw linkErr;
      if (linkErr && (linkErr.code === 'EPERM' || linkErr.code === 'ENOTSUP' || linkErr.code === 'EXDEV' || linkErr.code === 'ENOSYS')) {
        fs.writeFileSync(targetPath, jsonPayload, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        return;
      }
      throw linkErr;
    }
  } finally {
    try { if (fs.existsSync(tmpLock)) fs.unlinkSync(tmpLock); } catch {}
  }
}

function releaseOwnedLockFile(targetPath, expectedToken) {
  try {
    const cur = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    if (cur && cur.pid === process.pid && cur.token === expectedToken) {
      fs.unlinkSync(targetPath);
    }
  } catch {}
}

function inspectLockDeadState(lockPath) {
  let raw;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { exists: false, dead: false };
    return { exists: true, dead: false };
  }
  if (!raw || !raw.trim()) return { exists: true, dead: false };
  try {
    const info = JSON.parse(raw);
    if (info && Number.isInteger(info.pid) && info.pid > 0 && info.pid !== process.pid) {
      if (checkPidAlive(info.pid) === 'dead') {
        return { exists: true, dead: true, info };
      }
    }
  } catch {}
  return { exists: true, dead: false };
}

function acquireInstallLock(asarPath) {
  const lockPath = asarPath + '.theme-lock';
  const reclaimPath = lockPath + '.reclaim';
  const token = crypto.randomBytes(12).toString('hex');
  const payload = JSON.stringify({ pid: process.pid, createdAt: Date.now(), token });

  // Fast path: acquire directly when no lock exists
  try {
    publishLockFileAtomic(lockPath, payload, token.slice(0, 6));
    return () => releaseOwnedLockFile(lockPath, token);
  } catch (err) {
    if (!err || err.code !== 'EEXIST') throw err;
  }

  // Pre-check: NEVER touch an empty/unparseable lock or a live lock (regardless of age)
  const pre = inspectLockDeadState(lockPath);
  if (pre.exists && !pre.dead) {
    throw new Error(`检测到另一个安装/卸载任务正在操作同一目标（锁文件：${lockPath}），请稍候再试。`);
  }

  // Mutually exclusive dead-lock reclaim: acquire dedicated reclaim mutex BEFORE unlinking stale lock,
  // then re-verify lock identity inside the reclaim critical section so two concurrent reclaimers
  // can NEVER delete each other's freshly published live lock!
  const reclaimToken = crypto.randomBytes(12).toString('hex');
  const reclaimPayload = JSON.stringify({ pid: process.pid, createdAt: Date.now(), token: reclaimToken });
  try {
    publishLockFileAtomic(reclaimPath, reclaimPayload, reclaimToken.slice(0, 6));
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      throw new Error(`检测到另一个安装/卸载任务正在回收或操作锁文件（${reclaimPath}），请稍候再试；若确认已无任何安装进程，可手动清理该锁文件后重试。`);
    }
    throw err;
  }

  try {
    const inside = inspectLockDeadState(lockPath);
    if (inside.exists) {
      if (!inside.dead) {
        throw new Error(`检测到另一个安装/卸载任务已持有该目标锁（锁文件：${lockPath}），请稍候再试。`);
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkErr) {
        if (!unlinkErr || unlinkErr.code !== 'ENOENT') throw unlinkErr;
      }
    }
    try {
      publishLockFileAtomic(lockPath, payload, token.slice(0, 6));
      return () => releaseOwnedLockFile(lockPath, token);
    } catch (pubErr) {
      if (pubErr && pubErr.code === 'EEXIST') {
        throw new Error(`检测到另一个安装/卸载任务正在操作同一目标（锁文件：${lockPath}），请稍候再试。`);
      }
      throw pubErr;
    }
  } finally {
    releaseOwnedLockFile(reclaimPath, reclaimToken);
  }
}

function writeAtomicFile(destPath, contentBufOrStr, encoding) {
  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    if (Buffer.isBuffer(contentBufOrStr)) {
      fs.writeFileSync(tmp, contentBufOrStr);
    } else {
      fs.writeFileSync(tmp, contentBufOrStr, encoding || 'utf8');
    }
    fs.renameSync(tmp, destPath);
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function ensureCleanBackup(asarPath) {
  const bakPath = asarPath + '.theme-bak';
  const curInfo = inspectAsar(asarPath);
  const shouldRefreshBackup = !fs.existsSync(bakPath) || (!curInfo.themeMainPatched && !curInfo.themePreloadPatched);
  if (!shouldRefreshBackup) return bakPath;

  const srcBuf = fs.readFileSync(asarPath);
  writeAtomicFile(bakPath, srcBuf);
  if (sha256File(bakPath) !== sha256Buffer(srcBuf)) {
    throw new Error(`备份文件校验失败：${bakPath}`);
  }
  return bakPath;
}

function getStagedPaths(asarPath) {
  const stagedPath = asarPath + '.theme-staged';
  const metaPath = stagedPath + '.meta.json';
  const legacyShaPath = stagedPath + '.sha256';
  return { stagedPath, metaPath, legacyShaPath };
}

function saveStagedTransaction(asarPath, outBuf, meta) {
  const { stagedPath, metaPath, legacyShaPath } = getStagedPaths(asarPath);
  if (typeof meta.purgeData !== 'boolean') {
    throw new Error('内部错误：暂存元数据 purgeData 必须为布尔值。');
  }
  writeAtomicFile(stagedPath, outBuf);
  const actualSha = sha256File(stagedPath);
  if (actualSha !== meta.stagedSha256) {
    try { fs.unlinkSync(stagedPath); } catch {}
    throw new Error('暂存文件回读校验失败，已中止暂存。');
  }
  writeAtomicFile(metaPath, JSON.stringify({
    version: 2,
    mode: meta.mode,
    purgeData: meta.purgeData === true,
    sourceSha256: meta.sourceSha256,
    stagedSha256: meta.stagedSha256,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8');
  try { if (fs.existsSync(legacyShaPath)) fs.unlinkSync(legacyShaPath); } catch {}
  return { stagedPath, metaPath };
}

function cleanupStagedFiles(asarPath) {
  const { stagedPath, metaPath, legacyShaPath } = getStagedPaths(asarPath);
  for (const p of [stagedPath, metaPath, legacyShaPath]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

function validateStagedMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('暂存元数据格式无效，已中止应用。');
  }
  if (meta.version !== 2) {
    throw new Error('暂存元数据版本不受支持，已中止应用。');
  }
  if (meta.mode !== 'install' && meta.mode !== 'uninstall') {
    throw new Error('暂存元数据 mode 字段无效，已中止应用。');
  }
  if (typeof meta.purgeData !== 'boolean') {
    throw new Error('暂存元数据 purgeData 类型无效（必须为严格布尔值），已中止应用！');
  }
  if (meta.mode === 'install' && meta.purgeData !== false) {
    throw new Error('暂存元数据冲突：install 模式不允许 purgeData=true，已中止应用。');
  }
  if (typeof meta.sourceSha256 !== 'string' || !SHA256_HEX_RE.test(meta.sourceSha256)) {
    throw new Error('暂存元数据 sourceSha256 格式无效，已中止应用。');
  }
  if (typeof meta.stagedSha256 !== 'string' || !SHA256_HEX_RE.test(meta.stagedSha256)) {
    throw new Error('暂存元数据 stagedSha256 格式无效，已中止应用。');
  }
}

function loadAndVerifyStagedTransaction(asarPath) {
  const { stagedPath, metaPath } = getStagedPaths(asarPath);
  if (!fs.existsSync(stagedPath)) {
    throw new Error('未找到暂存补丁 app.asar.theme-staged。');
  }
  if (!fs.existsSync(metaPath)) {
    throw new Error('缺少暂存元数据 app.asar.theme-staged.meta.json（拒绝应用无源校验的旧暂存包，请重新运行安装或卸载）。');
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new Error(`暂存元数据损坏：${err.message}`);
  }
  validateStagedMeta(meta);

  const stagedBuf = fs.readFileSync(stagedPath);
  const actualStagedSha = sha256Buffer(stagedBuf);
  if (actualStagedSha !== meta.stagedSha256) {
    throw new Error('暂存包 SHA-256 校验不匹配（文件已损坏或被篡改），已中止应用！');
  }
  // Ensure staged archive itself parses cleanly
  parseAsarBuffer(stagedBuf);

  const currentSourceSha = sha256File(asarPath);
  if (currentSourceSha !== meta.sourceSha256) {
    throw new Error('检测到正式 app.asar 在暂存之后已发生变化（可能是宿主升级或其他补丁更新），已拒绝应用过期暂存包！请重新运行安装/卸载命令。');
  }

  return { stagedBuf, meta };
}

function commitAsarTransaction(resourcesDir, asarPath, outBuf, meta) {
  // 1. Backup MUST succeed before any mutation
  ensureCleanBackup(asarPath);

  // 2. Early host process check (NEVER bypass when running or unknown!)
  const earlyProc = findTargetHostProcesses(resourcesDir);
  if (earlyProc.state !== 'stopped') {
    const saved = saveStagedTransaction(asarPath, outBuf, meta);
    return {
      applied: false,
      staged: true,
      stagedPath: saved.stagedPath,
      error: earlyProc.state === 'running' ? 'ANTIGRAVITY_RUNNING' : 'PROCESS_STATE_UNKNOWN'
    };
  }

  // 3. Write unique temp file in same directory & finish full read-back SHA-256 check BEFORE final source check + rename
  const tmpPath = path.join(path.dirname(asarPath), `app.asar.theme-tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmpPath, outBuf);
  if (sha256File(tmpPath) !== meta.stagedSha256) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error('临时 ASAR 文件写入校验失败，正式 app.asar 未受影响。');
  }

  // 4. Immediately before atomic rename: re-verify host process is still stopped AND source app.asar is unchanged
  const finalProc = findTargetHostProcesses(resourcesDir);
  if (finalProc.state !== 'stopped') {
    try { fs.unlinkSync(tmpPath); } catch {}
    const saved = saveStagedTransaction(asarPath, outBuf, meta);
    return {
      applied: false,
      staged: true,
      stagedPath: saved.stagedPath,
      error: finalProc.state === 'running' ? 'ANTIGRAVITY_RUNNING' : 'PROCESS_STATE_UNKNOWN'
    };
  }
  const liveSourceSha = sha256File(asarPath);
  if (liveSourceSha !== meta.sourceSha256) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw new Error('提交中止：正式 app.asar 在临时包落盘期间已被其他进程修改，请重试。');
  }

  // 5. Atomic replace via renameSync (NEVER partial copyFileSync overwrite!)
  try {
    fs.renameSync(tmpPath, asarPath);
    cleanupStagedFiles(asarPath);
    return { applied: true, staged: false };
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
      const saved = saveStagedTransaction(asarPath, outBuf, meta);
      return { applied: false, staged: true, stagedPath: saved.stagedPath, error: err.code };
    }
    throw err;
  }
}

function copyDirRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function syncPluginAssets() {
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.mkdirSync(path.join(PLUGIN_DIR, 'wallpapers', 'custom'), { recursive: true });

  for (const rel of ['plugin.json', 'README.md']) {
    const src = path.join(ROOT_DIR, rel);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PLUGIN_DIR, rel));
  }
  copyDirRecursive(path.join(ROOT_DIR, 'assets'), path.join(PLUGIN_DIR, 'assets'));
  copyDirRecursive(path.join(ROOT_DIR, 'skills'), path.join(PLUGIN_DIR, 'skills'));
  console.log(`[Theme Studio] 已同步插件资源与预设壁纸到: ${PLUGIN_DIR}`);
}

function cleanupPluginDataOnUninstall(purgeData) {
  if (!fs.existsSync(PLUGIN_DIR)) return;
  if (purgeData) {
    fs.rmSync(PLUGIN_DIR, { recursive: true, force: true });
    console.log('[Theme Studio] 已清理插件目录与自定义壁纸数据。');
  } else {
    for (const rel of ['plugin.json', 'README.md', 'skills']) {
      const target = path.join(PLUGIN_DIR, rel);
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    }
    console.log('[Theme Studio] 已卸载美化插件（已保留 theme_prefs.json 与自定义壁纸备份）。');
  }
}

function validateScriptSyntax(label, code) {
  try {
    new Function(code);
  } catch (err) {
    throw new Error(`语法校验失败 (${label}): ${err.message}`);
  }
}

function assertFuseCompatible(resourcesDir) {
  const fuse = inspectAsarIntegrityFuse(resourcesDir);
  if (fuse.status === 'enabled') {
    throw new Error(
      `安全中止：当前宿主可执行文件启用了 Electron ASAR Header Integrity 强校验 (${fuse.exe})。直接重打包 app.asar 会导致客户端拒绝启动！`
    );
  }
  return fuse;
}

/**
 * Gate formal commit for installs on BOTH confirmed disabled Electron ASAR integrity fuse AND verified host version,
 * unless explicitly overridden via --allow-unverified-host (enabled fuse is ALWAYS hard-blocked).
 */
function evaluateHostCommitSafety(resourcesDir, appVersion) {
  const fuse = inspectAsarIntegrityFuse(resourcesDir);
  const hostVersionVerified = VERIFIED_HOST_VERSIONS.includes(appVersion);
  const fuseConfirmedDisabled = fuse.status === 'disabled';
  return {
    fuse,
    appVersion,
    hostVersionVerified,
    fuseConfirmedDisabled,
    commitAllowed: fuseConfirmedDisabled && hostVersionVerified
  };
}

function assertHostCompatibleForCommit(resourcesDir, appVersion, opts, actionMode) {
  const safety = evaluateHostCommitSafety(resourcesDir, appVersion);
  if (safety.fuse.status === 'enabled') {
    throw new Error(
      `安全中止：当前宿主可执行文件启用了 Electron ASAR Header Integrity 强校验 (${safety.fuse.exe})。直接重打包 app.asar 会导致客户端拒绝启动！`
    );
  }
  if (actionMode === 'install' && !(opts && opts.allowUnverifiedHost)) {
    if (!safety.fuseConfirmedDisabled) {
      throw new Error(
        `安全中止：未能确认当前宿主的 Electron ASAR 强完整性开关已关闭（探测结果：${safety.fuse.status}）。为避免破坏客户端启动，已停止正式写入。可先运行 --check / --dry-run 诊断，若确认可启动且自担风险请加 --allow-unverified-host。`
      );
    }
    if (!safety.hostVersionVerified) {
      throw new Error(
        `安全中止：当前 Antigravity 版本 (${appVersion}) 不在已实测通过的版本清单 [${VERIFIED_HOST_VERSIONS.join(', ')}] 内。请先使用 --dry-run 诊断；若确认兼容且自担风险请加 --allow-unverified-host。`
      );
    }
  }
  return safety;
}

function printHelp() {
  console.log([
    'Antigravity Theme Studio CLI',
    '  node setup.cjs                       安装/更新美化补丁（运行中则安全暂存）',
    '  node setup.cjs --kill --relaunch     关闭目标客户端、原子写入补丁并重启',
    '  node setup.cjs --dry-run             纯只读内存校验（支持与 --uninstall / --apply-staged 组合）',
    '  node setup.cjs --check               输出当前宿主状态、已验证版本与 Electron Fuse 报告',
    '  node setup.cjs --apply-staged        校验源包与暂存包双哈希后原子应用暂存补丁',
    '  node setup.cjs --uninstall           无损卸载美化补丁（--purge-data 可连同自定义数据一起清除）',
    '  node setup.cjs --install-dir <PATH>  显式指定 Antigravity 安装目录或 resources 目录',
    '  node setup.cjs --allow-unverified-host  允许在未实测宿主版本或未检出 Fuse 的分发版上正式写入（enabled 仍强制拦截）'
  ].join('\n'));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const resourcesDir = detectResourcesDir(opts.installDir);
  if (!resourcesDir) {
    console.error('[Theme Studio] 错误：未找到 Antigravity 的 resources/app.asar。请使用 --install-dir 手动指定路径。');
    process.exitCode = 1;
    return;
  }

  const asarPath = path.join(resourcesDir, 'app.asar');
  const { stagedPath, metaPath } = getStagedPaths(asarPath);

  // ---- CHECK (Strictly Read-Only) ----
  if (opts.check) {
    const info = inspectAsar(asarPath);
    const safety = evaluateHostCommitSafety(resourcesDir, info.appVersion);
    const proc = findTargetHostProcesses(resourcesDir);
    const wpDir = path.join(PLUGIN_DIR, 'assets', 'wallpapers');
    const presetsCount = fs.existsSync(wpDir)
      ? fs.readdirSync(wpDir).filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f)).length
      : 0;
    const out = {
      resourcesDir,
      asarPath,
      ...info,
      hostVersionVerified: safety.hostVersionVerified,
      verifiedHostVersions: VERIFIED_HOST_VERSIONS,
      asarIntegrityFuse: safety.fuse.status,
      commitAllowed: safety.commitAllowed,
      hostProcessState: proc.state,
      unknownProcessCount: (proc.unknownPids || []).length,
      pluginDirExists: fs.existsSync(PLUGIN_DIR),
      prefsExists: fs.existsSync(path.join(PLUGIN_DIR, 'theme_prefs.json')),
      presetsCount,
      stagedPending: fs.existsSync(stagedPath),
      stagedMetaPresent: fs.existsSync(metaPath)
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // ---- APPLY STAGED (Supports --dry-run strictly read-only; formal apply reads & commits inside lock) ----
  if (opts.applyStaged) {
    if (opts.dryRun) {
      const hostInfo = inspectAsar(asarPath);
      const safety = evaluateHostCommitSafety(resourcesDir, hostInfo.appVersion);
      if (safety.fuse.status === 'enabled') assertFuseCompatible(resourcesDir);
      const { meta } = loadAndVerifyStagedTransaction(asarPath);
      console.log('[Theme Studio] ✅ DRY-RUN 暂存包校验通过（源包与暂存包双哈希一致，未修改磁盘）！');
      console.log(JSON.stringify({
        asarPath,
        appVersion: hostInfo.appVersion,
        hostVersionVerified: safety.hostVersionVerified,
        asarIntegrityFuse: safety.fuse.status,
        commitAllowed: meta.mode === 'uninstall' ? (safety.fuse.status !== 'enabled') : safety.commitAllowed,
        ...meta
      }, null, 2));
      return;
    }

    const releaseLock = acquireInstallLock(asarPath);
    try {
      const { stagedBuf, meta } = loadAndVerifyStagedTransaction(asarPath);
      const hostInfo = inspectAsar(asarPath);
      assertHostCompatibleForCommit(resourcesDir, hostInfo.appVersion, opts, meta.mode);
      if (opts.kill) killTargetHostProcesses(resourcesDir);
      const res = commitAsarTransaction(resourcesDir, asarPath, stagedBuf, meta);
      if (!res.applied) {
        console.error(`[Theme Studio] 写入未提交 (${res.error})：请先完全退出 Antigravity 后重试，或加上 --kill --relaunch。`);
        process.exitCode = 2;
        return;
      }
      if (meta.mode === 'uninstall') {
        cleanupPluginDataOnUninstall(meta.purgeData === true);
        console.log('[Theme Studio] ✅ 暂存的卸载补丁已原子提交并完成清理！');
      } else {
        console.log('[Theme Studio] ✅ 暂存的美化补丁已原子写入 app.asar！');
      }
      if (opts.relaunch) relaunchAntigravity(resourcesDir);
    } finally {
      releaseLock();
    }
    return;
  }

  // ---- UNINSTALL (Supports --dry-run strictly read-only BEFORE any kill/write) ----
  if (opts.uninstall) {
    const fuse = assertFuseCompatible(resourcesDir);
    if (opts.dryRun) {
      const srcBuf = fs.readFileSync(asarPath);
      const built = buildPatchedAsarFromBuffer(srcBuf, { mode: 'uninstall' });
      console.log('[Theme Studio] ✅ DRY-RUN 卸载校验全部通过（未修改磁盘，未终止进程）！');
      console.log(JSON.stringify({
        asarPath,
        sha256: built.sha256,
        asarIntegrityFuse: fuse.status,
        ...built.stats
      }, null, 2));
      return;
    }

    const releaseLock = acquireInstallLock(asarPath);
    try {
      if (opts.kill) killTargetHostProcesses(resourcesDir);
      const srcBuf = fs.readFileSync(asarPath);
      const built = buildPatchedAsarFromBuffer(srcBuf, { mode: 'uninstall' });
      const res = commitAsarTransaction(resourcesDir, asarPath, built.buffer, {
        mode: 'uninstall',
        purgeData: opts.purgeData === true,
        sourceSha256: built.sourceSha256,
        stagedSha256: built.sha256
      });

      if (res.applied) {
        // Only remove plugin files/data AFTER formal app.asar has been atomically committed!
        cleanupPluginDataOnUninstall(opts.purgeData === true);
        console.log('[Theme Studio] ✅ 已从 app.asar 无损移除美化补丁，其他插件（猫娘挂件/汉化）完好无损！');
        if (opts.relaunch) relaunchAntigravity(resourcesDir);
      } else {
        console.log(`[Theme Studio] ⚠️ Antigravity 正在运行导致未写入正式包 (${res.error})。已生成安全暂存卸载包：${res.stagedPath}`);
        console.log('[Theme Studio] （为避免影响当前运行中的客户端，插件数据暂未删除，待正式提交时自动清理）');
        console.log('[Theme Studio] 请退出 Antigravity 后执行：node setup.cjs --apply-staged');
      }
    } finally {
      releaseLock();
    }
    return;
  }

  // ---- INSTALL / UPDATE (Supports --dry-run strictly read-only BEFORE any sync/kill/write) ----
  const mainBridgePath = path.join(ROOT_DIR, 'theme', 'main_bridge.js');
  const preloadThemePath = path.join(ROOT_DIR, 'theme', 'preload_theme.js');
  const mainCode = fs.readFileSync(mainBridgePath, 'utf8');
  const preloadCode = fs.readFileSync(preloadThemePath, 'utf8');

  validateScriptSyntax('theme/main_bridge.js', mainCode);
  validateScriptSyntax('theme/preload_theme.js', preloadCode);

  if (opts.dryRun) {
    const srcBuf = fs.readFileSync(asarPath);
    const hostInfo = inspectAsar(asarPath);
    const safety = evaluateHostCommitSafety(resourcesDir, hostInfo.appVersion);
    const built = buildPatchedAsarFromBuffer(srcBuf, {
      mode: 'install',
      mainBlock: mainCode,
      preloadBlock: preloadCode
    });
    console.log('[Theme Studio] ✅ DRY-RUN 校验全部通过（未修改磁盘上的 app.asar）！');
    console.log(JSON.stringify({
      asarPath,
      appVersion: hostInfo.appVersion,
      hostVersionVerified: safety.hostVersionVerified,
      asarIntegrityFuse: safety.fuse.status,
      commitAllowed: safety.commitAllowed,
      sha256: built.sha256,
      ...built.stats
    }, null, 2));
    return;
  }

  const hostInfoBeforeLock = inspectAsar(asarPath);
  assertHostCompatibleForCommit(resourcesDir, hostInfoBeforeLock.appVersion, opts, 'install');

  const releaseLock = acquireInstallLock(asarPath);
  try {
    syncPluginAssets();
    if (opts.kill) killTargetHostProcesses(resourcesDir);

    const srcBuf = fs.readFileSync(asarPath);
    assertHostCompatibleForCommit(resourcesDir, inspectAsarBuffer(srcBuf).appVersion, opts, 'install');
    const built = buildPatchedAsarFromBuffer(srcBuf, {
      mode: 'install',
      mainBlock: mainCode,
      preloadBlock: preloadCode
    });

    const res = commitAsarTransaction(resourcesDir, asarPath, built.buffer, {
      mode: 'install',
      purgeData: false,
      sourceSha256: built.sourceSha256,
      stagedSha256: built.sha256
    });
    if (res.applied) {
      console.log('[Theme Studio] ✅ 美化补丁原子安装成功！（SHA-256 分块校验与块外逐字节比对全部通过）');
      console.log('[Theme Studio] 请完全重启一次 Antigravity 客户端，启动后按 Ctrl + Shift + B 或点击左侧栏底部 🎨 按钮即可调参！');
      if (opts.relaunch) relaunchAntigravity(resourcesDir);
    } else {
      console.log(`[Theme Studio] ⚠️ Antigravity 正在运行导致未写入正式包 (${res.error})。`);
      console.log(`[Theme Studio] 已同步壁纸资源，并将带双哈希元数据的新版 ASAR 暂存至：${res.stagedPath}`);
      console.log('[Theme Studio] 下一步：关闭 Antigravity 后执行 node setup.cjs --apply-staged 或双击「双击安装美化补丁.bat」');
    }
  } finally {
    releaseLock();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('[Theme Studio] 错误：' + (err && err.message ? err.message : String(err)));
    process.exitCode = 1;
  }
}

module.exports = {
  VERIFIED_HOST_VERSIONS,
  parseArgs,
  classifyWindowsProcesses,
  inspectAsarIntegrityFuse,
  evaluateHostCommitSafety,
  assertHostCompatibleForCommit,
  acquireInstallLock,
  validateStagedMeta,
  saveStagedTransaction,
  loadAndVerifyStagedTransaction,
  commitAsarTransaction
};
