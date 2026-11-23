'use strict';

/**
 * Pure-Node Electron ASAR lossless patcher with SHA-256 block integrity verification.
 * - Zero external dependencies
 * - Strict Pickle bounds, alignment & entry offset/size validation
 * - Prototype-safe directory maps (Object.create(null))
 * - Byte-exact idempotent injection & lossless uninstall (AG_THEME_STUDIO_BEGIN .. END)
 * - Byte-for-byte preservation verification for untouched entries & third-party patches (e.g. GEMINI_NEKO_HUD, AG_ZH)
 */

const fs = require('fs');
const crypto = require('crypto');

const BLOCK_SIZE = 4 * 1024 * 1024; // 4 MiB standard Electron ASAR integrity block size

const MARKERS = {
  begin: '// ===== AG_THEME_STUDIO_BEGIN =====',
  end: '// ===== AG_THEME_STUDIO_END ====='
};

const NEKO_MARKERS = {
  begin: '// ===== GEMINI_NEKO_HUD_BEGIN =====',
  end: '// ===== GEMINI_NEKO_HUD_END ====='
};

function isSafeNonNegativeInt(n) {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

function parseEntryOffset(raw) {
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (isSafeNonNegativeInt(raw)) return raw;
  return null;
}

function toNullProtoTree(node) {
  if (!node || typeof node !== 'object') {
    throw new Error('Corrupted ASAR header: invalid node');
  }
  if (Object.prototype.hasOwnProperty.call(node, 'files')) {
    if (!node.files || typeof node.files !== 'object' || Array.isArray(node.files)) {
      throw new Error('Corrupted ASAR header: invalid directory files map');
    }
    const dir = Object.create(null);
    for (const key of Object.keys(node)) {
      if (key === 'files') continue;
      dir[key] = node[key];
    }
    const filesMap = Object.create(null);
    for (const name of Object.keys(node.files)) {
      if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`Corrupted ASAR header: invalid entry name "${name}"`);
      }
      filesMap[name] = toNullProtoTree(node.files[name]);
    }
    dir.files = filesMap;
    return dir;
  }

  const leaf = Object.create(null);
  for (const key of Object.keys(node)) {
    leaf[key] = node[key];
  }
  return leaf;
}

/**
 * Validate every packed entry in the ASAR tree stays strictly within [dataStart, buf.length].
 */
function validateHeaderEntries(node, dataStart, bufLength, prefix) {
  if (node.files) {
    for (const name of Object.keys(node.files)) {
      const rel = prefix ? `${prefix}/${name}` : name;
      validateHeaderEntries(node.files[name], dataStart, bufLength, rel);
    }
    return;
  }
  if (node.unpacked || node.link !== undefined) return;

  const size = node.size;
  const offset = parseEntryOffset(node.offset);
  if (!isSafeNonNegativeInt(size) || offset === null) {
    throw new Error(`Corrupted ASAR entry bounds metadata for ${prefix}`);
  }
  const start = dataStart + offset;
  const end = start + size;
  if (!Number.isSafeInteger(end) || start < dataStart || end > bufLength) {
    throw new Error(`Corrupted ASAR entry out of bounds: ${prefix} (${offset}+${size} > ${bufLength - dataStart})`);
  }
}

/**
 * Parse an ASAR archive buffer into { header, dataStart, buffer } with strict Pickle & bounds checks.
 */
function parseAsarBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) {
    throw new Error('Invalid ASAR buffer: too small');
  }
  const sizePicklePayload = buf.readUInt32LE(0);
  const headerPickleSize = buf.readUInt32LE(4);
  const headerPayloadSize = buf.readUInt32LE(8);
  const jsonByteLength = buf.readUInt32LE(12);

  if (sizePicklePayload !== 4) {
    throw new Error(`Unexpected ASAR size pickle payload: ${sizePicklePayload}`);
  }
  if (headerPickleSize < 8 || headerPickleSize % 4 !== 0) {
    throw new Error(`Corrupted ASAR header pickle size: ${headerPickleSize}`);
  }
  if (headerPayloadSize + 4 !== headerPickleSize) {
    throw new Error(`Corrupted ASAR header payload/pickle mismatch: ${headerPayloadSize} vs ${headerPickleSize}`);
  }
  const padLen = (4 - (jsonByteLength % 4)) % 4;
  if (headerPayloadSize !== 4 + jsonByteLength + padLen) {
    throw new Error(`Corrupted ASAR header json alignment: payload=${headerPayloadSize}, json=${jsonByteLength}, pad=${padLen}`);
  }

  const dataStart = 8 + headerPickleSize;
  if (dataStart > buf.length || 16 + jsonByteLength > dataStart) {
    throw new Error('Corrupted ASAR header bounds');
  }

  const headerJson = buf.subarray(16, 16 + jsonByteLength).toString('utf8');
  const rawHeader = JSON.parse(headerJson);
  if (!rawHeader || typeof rawHeader !== 'object' || !rawHeader.files) {
    throw new Error('Corrupted ASAR header: missing root files map');
  }
  const header = toNullProtoTree(rawHeader);
  validateHeaderEntries(header, dataStart, buf.length, '');
  return { header, dataStart, buffer: buf };
}

/**
 * Compute Electron ASAR integrity object for a file Buffer using the specified algorithm and block size.
 */
function computeIntegrityWithSpec(fileBuf, algorithm = 'SHA256', blockSize = BLOCK_SIZE) {
  const algName = String(algorithm || '').toUpperCase();
  const nodeAlg = algName === 'SHA256' ? 'sha256' : (algName === 'SHA512' ? 'sha512' : null);
  if (!nodeAlg) {
    throw new Error(`Unsupported ASAR integrity algorithm: ${algorithm}`);
  }
  if (!isSafeNonNegativeInt(blockSize) || blockSize <= 0) {
    throw new Error(`Invalid ASAR integrity blockSize: ${blockSize}`);
  }
  const hash = crypto.createHash(nodeAlg).update(fileBuf).digest('hex');
  const blocks = [];
  if (fileBuf.length === 0) {
    blocks.push(crypto.createHash(nodeAlg).update(Buffer.alloc(0)).digest('hex'));
  } else {
    for (let offset = 0; offset < fileBuf.length; offset += blockSize) {
      const chunk = fileBuf.subarray(offset, Math.min(offset + blockSize, fileBuf.length));
      blocks.push(crypto.createHash(nodeAlg).update(chunk).digest('hex'));
    }
  }
  return {
    algorithm: algName,
    hash,
    blockSize,
    blocks
  };
}

/**
 * Compute Electron ASAR integrity object for a file Buffer (SHA256, 4 MiB blocks).
 */
function computeIntegrity(fileBuf) {
  return computeIntegrityWithSpec(fileBuf, 'SHA256', BLOCK_SIZE);
}

function integrityEquals(a, b) {
  if (!a || !b) return false;
  if (String(a.algorithm || '').toUpperCase() !== String(b.algorithm || '').toUpperCase()) return false;
  if (String(a.hash || '').toLowerCase() !== String(b.hash || '').toLowerCase()) return false;
  if (a.blockSize !== b.blockSize) return false;
  if (!Array.isArray(a.blocks) || !Array.isArray(b.blocks) || a.blocks.length !== b.blocks.length) return false;
  for (let i = 0; i < a.blocks.length; i++) {
    if (String(a.blocks[i] || '').toLowerCase() !== String(b.blocks[i] || '').toLowerCase()) return false;
  }
  return true;
}

/**
 * Verify every packed source entry carrying an `integrity` block against its actual archived bytes.
 * Detects silent same-length bit-rot or tampering in untouched source files BEFORE repacking!
 */
function verifySourceArchiveIntegrity(parsed) {
  let checkedEntries = 0;
  function walk(node, prefix) {
    if (node.files) {
      for (const name of Object.keys(node.files)) {
        const rel = prefix ? `${prefix}/${name}` : name;
        walk(node.files[name], rel);
      }
      return;
    }
    if (node.unpacked || node.link !== undefined) return;
    if (!node.integrity) return;
    const buf = readEntryBuffer(parsed, prefix);
    if (!buf) {
      throw new Error(`Source ASAR integrity check failed: unreadable entry ${prefix}`);
    }
    const expected = computeIntegrityWithSpec(buf, node.integrity.algorithm, node.integrity.blockSize);
    if (!integrityEquals(node.integrity, expected)) {
      throw new Error(`Source ASAR integrity check failed: corrupted entry bytes for ${prefix}`);
    }
    checkedEntries++;
  }
  walk(parsed.header, '');
  return { verified: true, checkedEntries };
}

/**
 * Resolve a slash-separated path inside the ASAR header tree.
 */
function findEntry(header, relPath) {
  const parts = relPath.split('/').filter(Boolean);
  let cur = header;
  for (const part of parts) {
    if (!cur || !cur.files || !Object.prototype.hasOwnProperty.call(cur.files, part)) {
      return null;
    }
    cur = cur.files[part];
  }
  return cur;
}

/**
 * Read a single file from a parsed ASAR as a Buffer with strict bounds checking.
 */
function readEntryBuffer(parsed, relPath) {
  const entry = findEntry(parsed.header, relPath);
  if (!entry || entry.files || entry.unpacked || entry.link !== undefined) {
    return null;
  }
  const offset = parseEntryOffset(entry.offset);
  const size = entry.size;
  if (offset === null || !isSafeNonNegativeInt(size)) {
    throw new Error(`Invalid entry offset/size for ${relPath}`);
  }
  const start = parsed.dataStart + offset;
  const end = start + size;
  if (start < parsed.dataStart || end > parsed.buffer.length) {
    throw new Error(`Out-of-bounds read for ${relPath}`);
  }
  return parsed.buffer.subarray(start, end);
}

/**
 * Find exact standalone-line marker ranges for a marker pair.
 * Throws if markers are orphaned, reversed, nested, or duplicated.
 */
function findStandaloneMarkerRange(sourceText, beginMarker, endMarker, label) {
  const lineRe = /[^\r\n]*(?:\r?\n|$)/g;
  const begins = [];
  const ends = [];
  let m;
  while ((m = lineRe.exec(sourceText)) !== null) {
    const rawLine = m[0];
    if (!rawLine) break;
    const content = rawLine.replace(/\r?\n$/, '');
    const start = m.index;
    const end = m.index + rawLine.length;
    const contentEnd = m.index + content.length;
    if (content === beginMarker) {
      begins.push({ start, end, contentEnd });
    } else if (content === endMarker) {
      ends.push({ start, end, contentEnd });
    }
  }

  if (begins.length === 0 && ends.length === 0) {
    return null;
  }
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(`Malformed ${label} markers: found ${begins.length} BEGIN and ${ends.length} END lines`);
  }
  if (begins[0].end > ends[0].start) {
    throw new Error(`Malformed ${label} markers: END appears before BEGIN`);
  }

  let blockStart = begins[0].start;
  const blockEnd = ends[0].end;
  const rawBlockText = sourceText.slice(begins[0].start, ends[0].end);

  // One-time lossless migration ONLY for legacy v1 installs (which lack @ag-theme-v2 and placed a standalone ";" line directly before BEGIN)
  if (label === 'AG_THEME_STUDIO' && !rawBlockText.includes('// @ag-theme-v2')) {
    const before = sourceText.slice(0, blockStart);
    const legacySemi = before.match(/(?:^|\r?\n)(;\r?\n)$/);
    if (legacySemi) {
      blockStart -= legacySemi[1].length;
    }
  }

  return {
    start: blockStart,
    end: blockEnd,
    beginLineStart: begins[0].start,
    endLineEnd: ends[0].end,
    endLineContentEnd: ends[0].contentEnd
  };
}

/**
 * Extract an exact third-party marker block verbatim for byte-exact preservation assertions.
 */
function extractMarkerBlock(sourceText, beginMarker, endMarker, label) {
  const range = findStandaloneMarkerRange(sourceText, beginMarker, endMarker, label);
  if (!range) return null;
  return sourceText.slice(range.beginLineStart, range.endLineContentEnd);
}

/**
 * Strip any existing AG_THEME_STUDIO marker block from source text without modifying surrounding host bytes.
 * If another third-party patch was appended after AG_THEME_STUDIO_END on a host file that originally lacked
 * a trailing newline, preserve the line break so trailing code NEVER fuses onto the host's last line/comment!
 */
function stripThemeBlock(sourceText) {
  const range = findStandaloneMarkerRange(sourceText, MARKERS.begin, MARKERS.end, 'AG_THEME_STUDIO');
  if (!range) return sourceText;

  let prefix = sourceText.slice(0, range.start);
  const suffix = sourceText.slice(range.end);

  const blockText = sourceText.slice(range.beginLineStart, range.endLineEnd);
  if (blockText.includes('@ag-theme-added-eol') && prefix.endsWith('\n')) {
    // Only remove our synthetic separator newline when nothing follows (exact host restore)
    // or when suffix already begins with its own line break.
    if (suffix.length === 0 || suffix.startsWith('\n') || suffix.startsWith('\r\n')) {
      prefix = prefix.slice(0, -1);
    }
  }
  if (prefix.length > 0 && suffix.length > 0 && !prefix.endsWith('\n') && !prefix.endsWith('\r') && !suffix.startsWith('\n') && !suffix.startsWith('\r')) {
    return `${prefix}\n${suffix}`;
  }
  return prefix + suffix;
}

/**
 * Inject (or idempotently replace) the AG_THEME_STUDIO marker block at the end of source text.
 * Guarantees:
 * - Same-version re-install is 100% byte-identical.
 * - Install followed by uninstall restores the exact original host bytes (including trailing whitespace/CRLF).
 * - Preserves all surrounding bytes outside the theme block verbatim.
 */
function applyThemeBlock(sourceText, blockBody) {
  const existing = findStandaloneMarkerRange(sourceText, MARKERS.begin, MARKERS.end, 'AG_THEME_STUDIO');
  const trimmedBody = String(blockBody || '').trim();
  if (!trimmedBody) {
    return stripThemeBlock(sourceText);
  }

  // Ensure the body begins with a safe statement separator INSIDE our own block
  const safeBody = trimmedBody.startsWith(';') ? trimmedBody : `;\n${trimmedBody}`;

  if (existing) {
    let prefix = sourceText.slice(0, existing.start);
    const suffix = sourceText.slice(existing.end);
    const oldBlock = sourceText.slice(existing.beginLineStart, existing.endLineEnd);
    const hadAddedEol = oldBlock.includes('@ag-theme-added-eol');
    if (hadAddedEol && prefix.endsWith('\n')) {
      prefix = prefix.slice(0, -1);
    }
    const needsLeadingEol = prefix.length > 0 && !prefix.endsWith('\n');
    const metaTag = needsLeadingEol ? '\n// @ag-theme-v2 @ag-theme-added-eol' : '\n// @ag-theme-v2';
    const lead = needsLeadingEol ? '\n' : '';
    const nextBlock = `${lead}${MARKERS.begin}${metaTag}\n${safeBody}\n${MARKERS.end}\n`;
    return prefix + nextBlock + suffix;
  }

  const needsLeadingEol = sourceText.length > 0 && !sourceText.endsWith('\n');
  const metaTag = needsLeadingEol ? '\n// @ag-theme-v2 @ag-theme-added-eol' : '\n// @ag-theme-v2';
  const lead = needsLeadingEol ? '\n' : '';
  return `${sourceText}${lead}${MARKERS.begin}${metaTag}\n${safeBody}\n${MARKERS.end}\n`;
}

/**
 * Check whether source text currently contains an intact, unique AG_THEME_STUDIO block.
 */
function hasThemeBlock(sourceText) {
  try {
    return findStandaloneMarkerRange(sourceText, MARKERS.begin, MARKERS.end, 'AG_THEME_STUDIO') !== null;
  } catch {
    return false;
  }
}

function cloneJsonPlain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Rebuild an ASAR archive buffer, replacing only the entries in `replacements` (Map<relPath, Buffer>).
 * Every untouched entry keeps its exact original bytes and metadata (offsets updated cleanly).
 */
function rebuildAsarBuffer(parsed, replacements) {
  const dataChunks = [];
  let currentOffset = 0;

  function cloneAndPack(node, prefix) {
    if (node.files) {
      const nextFiles = Object.create(null);
      for (const name of Object.keys(node.files)) {
        const rel = prefix ? `${prefix}/${name}` : name;
        nextFiles[name] = cloneAndPack(node.files[name], rel);
      }
      const dirCopy = Object.create(null);
      for (const k of Object.keys(node)) {
        if (k !== 'files') dirCopy[k] = node[k];
      }
      dirCopy.files = nextFiles;
      return dirCopy;
    }

    // Symlink or unpacked file: preserve metadata verbatim
    if (node.unpacked || node.link !== undefined) {
      return toNullProtoTree(cloneJsonPlain(node));
    }

    let fileBuf;
    let modified = false;
    if (replacements && replacements.has(prefix)) {
      fileBuf = replacements.get(prefix);
      modified = true;
    } else {
      const offset = parseEntryOffset(node.offset);
      const start = parsed.dataStart + offset;
      fileBuf = parsed.buffer.subarray(start, start + node.size);
    }

    const nextEntry = Object.create(null);
    for (const k of Object.keys(node)) {
      if (k !== 'size' && k !== 'offset' && k !== 'integrity') {
        nextEntry[k] = node[k];
      }
    }
    nextEntry.size = fileBuf.length;
    nextEntry.offset = String(currentOffset);

    if (modified || node.integrity) {
      nextEntry.integrity = modified ? computeIntegrity(fileBuf) : cloneJsonPlain(node.integrity);
    }

    dataChunks.push(fileBuf);
    currentOffset += fileBuf.length;
    return nextEntry;
  }

  const nextHeader = cloneAndPack(parsed.header, '');
  const headerJsonBuf = Buffer.from(JSON.stringify(nextHeader), 'utf8');
  const jsonLen = headerJsonBuf.length;
  const padLen = (4 - (jsonLen % 4)) % 4;
  const headerPayloadSize = 4 + jsonLen + padLen;
  const headerPickleSize = 4 + headerPayloadSize;

  const prefixBuf = Buffer.alloc(16);
  prefixBuf.writeUInt32LE(4, 0);
  prefixBuf.writeUInt32LE(headerPickleSize, 4);
  prefixBuf.writeUInt32LE(headerPayloadSize, 8);
  prefixBuf.writeUInt32LE(jsonLen, 12);

  const padBuf = padLen > 0 ? Buffer.alloc(padLen, 0) : Buffer.alloc(0);

  return Buffer.concat([prefixBuf, headerJsonBuf, padBuf, ...dataChunks]);
}

/**
 * Recursively verify every untouched entry in `verify` has identical bytes & metadata to `orig`,
 * and every replaced entry matches exact expected bytes and full block-level SHA-256 integrity.
 */
function verifyRebuiltArchive(origParsed, rebuiltParsed, replacements) {
  function compareNodes(origNode, nextNode, prefix) {
    if (origNode.files) {
      if (!nextNode || !nextNode.files) {
        throw new Error(`ASAR verify failed: missing directory ${prefix}`);
      }
      const origKeys = Object.keys(origNode.files);
      const nextKeys = Object.keys(nextNode.files);
      if (origKeys.length !== nextKeys.length) {
        throw new Error(`ASAR verify failed: directory entry count mismatch at ${prefix || '/'}`);
      }
      for (const name of origKeys) {
        if (!Object.prototype.hasOwnProperty.call(nextNode.files, name)) {
          throw new Error(`ASAR verify failed: missing entry ${prefix ? `${prefix}/${name}` : name}`);
        }
        const rel = prefix ? `${prefix}/${name}` : name;
        compareNodes(origNode.files[name], nextNode.files[name], rel);
      }
      return;
    }

    if (origNode.unpacked || origNode.link !== undefined) {
      if (JSON.stringify(origNode) !== JSON.stringify(nextNode)) {
        throw new Error(`ASAR verify failed: unpacked/symlink metadata altered for ${prefix}`);
      }
      return;
    }

    const nextBuf = readEntryBuffer(rebuiltParsed, prefix);
    if (!nextBuf) {
      throw new Error(`ASAR verify failed: unreadable entry ${prefix}`);
    }

    if (replacements && replacements.has(prefix)) {
      const expectedBuf = replacements.get(prefix);
      if (!nextBuf.equals(expectedBuf)) {
        throw new Error(`ASAR verify failed: replaced bytes mismatch for ${prefix}`);
      }
      const calc = computeIntegrity(nextBuf);
      if (!integrityEquals(nextNode.integrity, calc)) {
        throw new Error(`ASAR verify failed: block integrity mismatch for ${prefix}`);
      }
      return;
    }

    // Untouched entry: verify exact byte equality & metadata preservation
    const origBuf = readEntryBuffer(origParsed, prefix);
    if (!origBuf || !origBuf.equals(nextBuf)) {
      throw new Error(`ASAR verify failed: untouched file bytes altered for ${prefix}`);
    }
    if (origNode.executable !== nextNode.executable) {
      throw new Error(`ASAR verify failed: executable flag altered for ${prefix}`);
    }
    if (origNode.integrity && !integrityEquals(origNode.integrity, nextNode.integrity)) {
      throw new Error(`ASAR verify failed: untouched integrity altered for ${prefix}`);
    }
  }

  compareNodes(origParsed.header, rebuiltParsed.header, '');
}

/**
 * Inspect an ASAR file and return compatibility/status diagnostics.
 */
function inspectAsar(asarPath) {
  const buf = fs.readFileSync(asarPath);
  return inspectAsarBuffer(buf);
}

function inspectAsarBuffer(buf) {
  const parsed = parseAsarBuffer(buf);

  const mainBuf = readEntryBuffer(parsed, 'dist/main.js');
  const preloadBuf = readEntryBuffer(parsed, 'dist/preload.js');
  const pkgBuf = readEntryBuffer(parsed, 'package.json');

  if (!mainBuf || !preloadBuf) {
    throw new Error('Target app.asar does not contain dist/main.js and dist/preload.js');
  }

  const mainText = mainBuf.toString('utf8');
  const preloadText = preloadBuf.toString('utf8');
  let appVersion = 'unknown';
  try {
    appVersion = JSON.parse(pkgBuf.toString('utf8')).version || 'unknown';
  } catch {}

  return {
    appVersion,
    asarBytes: buf.length,
    asarSha256: crypto.createHash('sha256').update(buf).digest('hex'),
    themeMainPatched: hasThemeBlock(mainText),
    themePreloadPatched: hasThemeBlock(preloadText),
    nekoHudMainPresent: extractMarkerBlock(mainText, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD') !== null,
    nekoHudPreloadPresent: extractMarkerBlock(preloadText, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD') !== null,
    zhLocalizationPresent: mainText.includes('AG_ZH') || preloadText.includes('AG_ZH') || preloadText.includes('__agCnRuntimeStart')
  };
}

/**
 * Build a patched (or unpatched when mode === 'uninstall') ASAR Buffer from an in-memory Buffer or file path and self-verify it.
 */
function buildPatchedAsarFromBuffer(srcBuf, options) {
  const { mode = 'install', mainBlock = '', preloadBlock = '' } = options || {};
  if (mode !== 'install' && mode !== 'uninstall') {
    throw new Error(`Unsupported patch mode: ${mode}`);
  }
  const sourceSha256 = crypto.createHash('sha256').update(srcBuf).digest('hex');
  const parsed = parseAsarBuffer(srcBuf);
  const sourceIntegrity = verifySourceArchiveIntegrity(parsed);

  const mainBuf = readEntryBuffer(parsed, 'dist/main.js');
  const preloadBuf = readEntryBuffer(parsed, 'dist/preload.js');
  if (!mainBuf || !preloadBuf) {
    throw new Error('Cannot locate dist/main.js or dist/preload.js inside app.asar');
  }

  const origMain = mainBuf.toString('utf8');
  const origPreload = preloadBuf.toString('utf8');

  // Capture exact third-party blocks and outside-theme host bytes before transformation
  const origNekoMain = extractMarkerBlock(origMain, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD');
  const origNekoPreload = extractMarkerBlock(origPreload, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD');
  const hostMainOutside = stripThemeBlock(origMain);
  const hostPreloadOutside = stripThemeBlock(origPreload);

  const nextMain = mode === 'uninstall' ? hostMainOutside : applyThemeBlock(origMain, mainBlock);
  const nextPreload = mode === 'uninstall' ? hostPreloadOutside : applyThemeBlock(origPreload, preloadBlock);

  const nextMainBuf = Buffer.from(nextMain, 'utf8');
  const nextPreloadBuf = Buffer.from(nextPreload, 'utf8');

  const replacements = new Map([
    ['dist/main.js', nextMainBuf],
    ['dist/preload.js', nextPreloadBuf]
  ]);

  const outBuf = rebuildAsarBuffer(parsed, replacements);

  // Full archive verification: Pickle structure, every untouched entry byte-for-byte, and block-level SHA-256 of modified entries
  const verify = parseAsarBuffer(outBuf);
  verifyRebuiltArchive(parsed, verify, replacements);

  // Verify outside-theme host bytes (covering AG_ZH, localization runtimes, and all host code) are 100% byte-identical
  const vMain = readEntryBuffer(verify, 'dist/main.js').toString('utf8');
  const vPreload = readEntryBuffer(verify, 'dist/preload.js').toString('utf8');
  if (stripThemeBlock(vMain) !== hostMainOutside) {
    throw new Error('Safety abort: host bytes outside AG_THEME_STUDIO in dist/main.js changed!');
  }
  if (stripThemeBlock(vPreload) !== hostPreloadOutside) {
    throw new Error('Safety abort: host bytes outside AG_THEME_STUDIO in dist/preload.js changed!');
  }

  // Verify GEMINI_NEKO_HUD blocks are preserved verbatim byte-for-byte
  const nextNekoMain = extractMarkerBlock(vMain, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD');
  const nextNekoPreload = extractMarkerBlock(vPreload, NEKO_MARKERS.begin, NEKO_MARKERS.end, 'GEMINI_NEKO_HUD');
  if (origNekoMain !== null && nextNekoMain !== origNekoMain) {
    throw new Error('Safety abort: GEMINI_NEKO_HUD main block bytes changed!');
  }
  if (origNekoPreload !== null && nextNekoPreload !== origNekoPreload) {
    throw new Error('Safety abort: GEMINI_NEKO_HUD preload block bytes changed!');
  }

  const outSha256 = crypto.createHash('sha256').update(outBuf).digest('hex');

  return {
    buffer: outBuf,
    sourceSha256,
    sha256: outSha256,
    stats: {
      origBytes: srcBuf.length,
      newBytes: outBuf.length,
      sourceSha256,
      sourceIntegrityVerified: sourceIntegrity.verified,
      sourceIntegrityEntriesChecked: sourceIntegrity.checkedEntries,
      repackFidelityVerified: true,
      themeMainPatched: hasThemeBlock(vMain),
      themePreloadPatched: hasThemeBlock(vPreload),
      hostOutsidePreserved: true,
      nekoHudPreserved: (origNekoMain === null || nextNekoMain === origNekoMain) && (origNekoPreload === null || nextNekoPreload === origNekoPreload),
      zhLocalizationPreserved: (!origMain.includes('AG_ZH') || vMain.includes('AG_ZH')) && (!origPreload.includes('AG_ZH') || vPreload.includes('AG_ZH')) && (!origPreload.includes('__agCnRuntimeStart') || vPreload.includes('__agCnRuntimeStart'))
    }
  };
}

function buildPatchedAsarBuffer(asarPath, options) {
  const srcBuf = fs.readFileSync(asarPath);
  return buildPatchedAsarFromBuffer(srcBuf, options);
}

module.exports = {
  MARKERS,
  NEKO_MARKERS,
  parseAsarBuffer,
  computeIntegrity,
  computeIntegrityWithSpec,
  integrityEquals,
  verifySourceArchiveIntegrity,
  inspectAsar,
  inspectAsarBuffer,
  buildPatchedAsarBuffer,
  buildPatchedAsarFromBuffer,
  rebuildAsarBuffer,
  stripThemeBlock,
  applyThemeBlock,
  hasThemeBlock,
  extractMarkerBlock
};
