import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);

export interface ApkBuilderSigningInput {
  buildType?: 'debug' | 'release';
  signingMode?: 'debug' | 'keystore' | 'files' | 'generate';
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  appName?: string;
  keystoreBase64?: string;
  keystoreFileName?: string;
  storePassword?: string;
  alias?: string;
  keyPassword?: string;
  keystoreType?: 'pkcs12' | 'jks';
  generateKeystore?: boolean;
  certBase64?: string;
  certFileName?: string;
  privateKeyBase64?: string;
  privateKeyFileName?: string;
  privateKeyPassword?: string;
  distinguishedName?: {
    commonName?: string;
    organization?: string;
    country?: string;
  };
}

export interface WwwFileEntry {
  relPath: string;
  data: Buffer;
}

export interface ResolvedSigningMaterial {
  mode: 'debug' | 'keystore' | 'files' | 'generate';
  certPem: string;
  certDer: Buffer;
  keyPem: string;
  subject: string;
  sha256Fingerprint: string;
}

export interface BuiltApkResult {
  apkBuffer: Buffer;
  signingInfo: {
    mode: 'debug' | 'keystore' | 'files' | 'generate';
    subject: string;
    sha256Fingerprint: string;
    packageName: string;
    appName: string;
    versionName: string;
    versionCode: number;
    entryCount: number;
    v1Signed: boolean;
    v2Signed: boolean;
    resourcesAligned4: boolean;
  };
}

// ---------- Utility Helpers ----------

function stripBase64Prefix(raw: string): string {
  const idx = raw.indexOf(',');
  return idx >= 0 && raw.slice(0, idx).includes('base64') ? raw.slice(idx + 1).trim() : raw.trim();
}

function decodeInputBase64OrText(raw: string): Buffer {
  const trimmed = stripBase64Prefix(raw);
  if (trimmed.startsWith('-----BEGIN ')) {
    return Buffer.from(trimmed, 'utf8');
  }
  return Buffer.from(trimmed, 'base64');
}

function alignTo4(n: number): number {
  return (n + 3) & ~3;
}

function padBuffer4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, 0)]);
}

function adler32(buf: Buffer, startOffset = 0): number {
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;
  for (let i = startOffset; i < buf.length; i++) {
    a = (a + buf[i]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  return ((b << 16) | a) >>> 0;
}

// Standard CRC32 table for PNG and ZIP
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeUleb128(value: number): number[] {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

// ---------- Default Android Launcher PNG Generator ----------

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

export function generateDefaultIconPng(size = 48): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  const half = size / 2;
  const radius = size * 0.44;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowOff = y * stride;
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const pxOff = rowOff + 1 + x * 4;
      const dx = Math.abs(x + 0.5 - half);
      const dy = Math.abs(y + 0.5 - half);
      const boxLimit = half - 2 - cornerRadius;
      const cx = Math.max(dx - boxLimit, 0);
      const cy = Math.max(dy - boxLimit, 0);
      const dist = Math.hypot(cx, cy);
      const insideBadge = dx <= half - 2 && dy <= half - 2 && dist <= cornerRadius;

      if (!insideBadge) {
        raw[pxOff] = 0;
        raw[pxOff + 1] = 0;
        raw[pxOff + 2] = 0;
        raw[pxOff + 3] = 0;
        continue;
      }

      // Indigo gradient background
      const t = (x + y) / (size * 2);
      let r = Math.round(79 + (99 - 79) * t);
      let g = Math.round(70 + (102 - 70) * t);
      let b = Math.round(229 + (241 - 229) * t);

      // Inner crisp geometric play triangle motif
      const relX = (x + 0.5) / size;
      const relY = (y + 0.5) / size;
      const inTri =
        relX >= 0.34 &&
        relX <= 0.72 &&
        Math.abs(relY - 0.5) <= (0.72 - relX) * 0.58;
      if (inTri) {
        r = 255;
        g = 255;
        b = 255;
      } else if (Math.hypot(x + 0.5 - half, y + 0.5 - half) > radius * 0.92 && Math.hypot(x + 0.5 - half, y + 0.5 - half) < radius) {
        r = 129;
        g = 140;
        b = 248;
      }

      raw[pxOff] = r;
      raw[pxOff + 1] = g;
      raw[pxOff + 2] = b;
      raw[pxOff + 3] = 255;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Binary StringPool Builder (UTF-16LE for AXML & ARSC) ----------

function buildUtf16StringPoolChunk(strings: string[]): Buffer {
  const stringCount = strings.length;
  const encodedStrings: Buffer[] = [];
  const offsets: number[] = [];
  let currentOffset = 0;

  for (const s of strings) {
    offsets.push(currentOffset);
    const charLen = s.length;
    const strBytes = Buffer.from(s, 'utf16le');
    // UTF-16LE ResStringPool length prefix: for <= 0x7fff chars, single uint16
    const entry = Buffer.alloc(2 + strBytes.length + 2);
    entry.writeUInt16LE(charLen, 0);
    strBytes.copy(entry, 2);
    entry.writeUInt16LE(0, 2 + strBytes.length);
    encodedStrings.push(entry);
    currentOffset += entry.length;
  }

  const rawStringData = padBuffer4(Buffer.concat(encodedStrings));
  const headerSize = 28;
  const stringsStart = headerSize + stringCount * 4;
  const chunkSize = stringsStart + rawStringData.length;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0x0001, 0); // RES_STRING_POOL_TYPE
  header.writeUInt16LE(headerSize, 2);
  header.writeUInt32LE(chunkSize, 4);
  header.writeUInt32LE(stringCount, 8);
  header.writeUInt32LE(0, 12); // styleCount
  header.writeUInt32LE(0, 16); // flags = 0 (UTF-16)
  header.writeUInt32LE(stringsStart, 20);
  header.writeUInt32LE(0, 24); // stylesStart

  const offsetTable = Buffer.alloc(stringCount * 4);
  for (let i = 0; i < stringCount; i++) {
    offsetTable.writeUInt32LE(offsets[i], i * 4);
  }

  return Buffer.concat([header, offsetTable, rawStringData]);
}

// ---------- Binary AndroidManifest.xml (AXML) Compiler ----------

interface AxmlAttr {
  nsIdx: number;
  nameIdx: number;
  rawValueIdx: number;
  dataType: number; // 0x01 ref, 0x03 string, 0x10 int_dec, 0x12 int_bool
  data: number;
}

export function buildAndroidManifestBinaryXml(params: {
  packageName: string;
  appName: string;
  versionCode: number;
  versionName: string;
  orientation?: string;
}): Buffer {
  const androidNsUri = 'http://schemas.android.com/apk/res/android';
  const androidPrefix = 'android';
  const fullActivityName = `${params.packageName}.MainActivity`;

  // IMPORTANT: Attributes with Android system resource IDs MUST come first (indices 0..13)
  // so RES_XML_RESOURCE_MAP_TYPE maps indices 0..13 to their exact android.R.attr IDs.
  const attrResourceMap: Array<{ name: string; id: number }> = [
    { name: 'theme', id: 0x01010000 },
    { name: 'label', id: 0x01010001 },
    { name: 'icon', id: 0x01010002 },
    { name: 'name', id: 0x01010003 },
    { name: 'exported', id: 0x01010010 },
    { name: 'launchMode', id: 0x0101001d },
    { name: 'screenOrientation', id: 0x0101001e },
    { name: 'configChanges', id: 0x0101001f },
    { name: 'minSdkVersion', id: 0x0101020c },
    { name: 'versionCode', id: 0x0101021b },
    { name: 'versionName', id: 0x0101021c },
    { name: 'targetSdkVersion', id: 0x01010270 },
    { name: 'hardwareAccelerated', id: 0x010102d3 },
    { name: 'usesCleartextTraffic', id: 0x010104ec },
  ];

  const stringTable: string[] = attrResourceMap.map((a) => a.name);
  const indexMap = new Map<string, number>();
  stringTable.forEach((s, idx) => indexMap.set(s, idx));

  const intern = (str: string): number => {
    const existing = indexMap.get(str);
    if (existing !== undefined) return existing;
    const idx = stringTable.length;
    stringTable.push(str);
    indexMap.set(str, idx);
    return idx;
  };

  // Pre-intern all strings
  const idxPrefix = intern(androidPrefix);
  const idxUri = intern(androidNsUri);
  const idxManifest = intern('manifest');
  const idxPackage = intern('package');
  const idxUsesSdk = intern('uses-sdk');
  const idxUsesPermission = intern('uses-permission');
  const idxApplication = intern('application');
  const idxActivity = intern('activity');
  const idxIntentFilter = intern('intent-filter');
  const idxAction = intern('action');
  const idxCategory = intern('category');

  const idxPkgVal = intern(params.packageName);
  const idxVerName = intern(params.versionName);
  const idxPermInternet = intern('android.permission.INTERNET');
  const idxPermNetState = intern('android.permission.ACCESS_NETWORK_STATE');
  const idxMainActivity = intern(fullActivityName);
  const idxIntentMain = intern('android.intent.action.MAIN');
  const idxIntentLauncher = intern('android.intent.category.LAUNCHER');

  const TYPE_REF = 0x01;
  const TYPE_STRING = 0x03;
  const TYPE_INT_DEC = 0x10;
  const TYPE_INT_BOOL = 0x12;

  const attrIdx = (name: string) => indexMap.get(name)!;

  const chunks: Buffer[] = [];
  let lineNum = 1;

  const pushStartNamespace = () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0100, 0); // RES_XML_START_NAMESPACE_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(lineNum++, 8);
    buf.writeInt32LE(-1, 12); // comment
    buf.writeUInt32LE(idxPrefix, 16);
    buf.writeUInt32LE(idxUri, 20);
    chunks.push(buf);
  };

  const pushEndNamespace = () => {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0101, 0); // RES_XML_END_NAMESPACE_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(lineNum++, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeUInt32LE(idxPrefix, 16);
    buf.writeUInt32LE(idxUri, 20);
    chunks.push(buf);
  };

  const pushStartElement = (nameIdx: number, attrs: AxmlAttr[]) => {
    const attrSize = 20;
    const headerSize = 16;
    const extSize = 20;
    const chunkSize = headerSize + extSize + attrs.length * attrSize;
    const buf = Buffer.alloc(chunkSize);
    buf.writeUInt16LE(0x0102, 0); // RES_XML_START_ELEMENT_TYPE
    buf.writeUInt16LE(headerSize, 2);
    buf.writeUInt32LE(chunkSize, 4);
    buf.writeUInt32LE(lineNum++, 8);
    buf.writeInt32LE(-1, 12); // comment

    buf.writeInt32LE(-1, 16); // ns
    buf.writeUInt32LE(nameIdx, 20);
    buf.writeUInt16LE(extSize, 24); // attributeStart
    buf.writeUInt16LE(attrSize, 26);
    buf.writeUInt16LE(attrs.length, 28);
    buf.writeUInt16LE(0, 30); // idIndex
    buf.writeUInt16LE(0, 32); // classIndex
    buf.writeUInt16LE(0, 34); // styleIndex

    for (let i = 0; i < attrs.length; i++) {
      const a = attrs[i];
      const off = 36 + i * attrSize;
      buf.writeInt32LE(a.nsIdx, off);
      buf.writeUInt32LE(a.nameIdx, off + 4);
      buf.writeInt32LE(a.rawValueIdx, off + 8);
      buf.writeUInt16LE(8, off + 12); // Res_value.size
      buf.writeUInt8(0, off + 14); // res0
      buf.writeUInt8(a.dataType, off + 15);
      buf.writeUInt32LE(a.data >>> 0, off + 16);
    }
    chunks.push(buf);
  };

  const pushEndElement = (nameIdx: number) => {
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0103, 0); // RES_XML_END_ELEMENT_TYPE
    buf.writeUInt16LE(16, 2);
    buf.writeUInt32LE(24, 4);
    buf.writeUInt32LE(lineNum++, 8);
    buf.writeInt32LE(-1, 12);
    buf.writeInt32LE(-1, 16);
    buf.writeUInt32LE(nameIdx, 20);
    chunks.push(buf);
  };

  const orientationCode =
    params.orientation === 'portrait'
      ? 1
      : params.orientation === 'landscape'
        ? 0
        : 4; // 4 = sensor

  // Build XML tree
  pushStartNamespace();

  // <manifest android:versionCode="..." android:versionName="..." package="...">
  pushStartElement(idxManifest, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('versionCode'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: Math.max(1, params.versionCode | 0),
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('versionName'),
      rawValueIdx: idxVerName,
      dataType: TYPE_STRING,
      data: idxVerName,
    },
    {
      nsIdx: -1,
      nameIdx: idxPackage,
      rawValueIdx: idxPkgVal,
      dataType: TYPE_STRING,
      data: idxPkgVal,
    },
  ]);

  // <uses-sdk android:minSdkVersion="22" android:targetSdkVersion="33" />
  pushStartElement(idxUsesSdk, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('minSdkVersion'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: 22,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('targetSdkVersion'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: 33,
    },
  ]);
  pushEndElement(idxUsesSdk);

  // <uses-permission android:name="android.permission.INTERNET" />
  pushStartElement(idxUsesPermission, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('name'),
      rawValueIdx: idxPermInternet,
      dataType: TYPE_STRING,
      data: idxPermInternet,
    },
  ]);
  pushEndElement(idxUsesPermission);

  // <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
  pushStartElement(idxUsesPermission, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('name'),
      rawValueIdx: idxPermNetState,
      dataType: TYPE_STRING,
      data: idxPermNetState,
    },
  ]);
  pushEndElement(idxUsesPermission);

  // <application android:label="@string/app_name" android:icon="@mipmap/ic_launcher" android:hardwareAccelerated="true" android:usesCleartextTraffic="true">
  pushStartElement(idxApplication, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('label'),
      rawValueIdx: -1,
      dataType: TYPE_REF,
      data: 0x7f020000,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('icon'),
      rawValueIdx: -1,
      dataType: TYPE_REF,
      data: 0x7f010000,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('hardwareAccelerated'),
      rawValueIdx: -1,
      dataType: TYPE_INT_BOOL,
      data: 0xffffffff,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('usesCleartextTraffic'),
      rawValueIdx: -1,
      dataType: TYPE_INT_BOOL,
      data: 0xffffffff,
    },
  ]);

  // <activity android:theme="@android:style/Theme.NoTitleBar.Fullscreen" android:label="@string/app_name" android:name="<pkg>.MainActivity" android:exported="true" android:launchMode="singleTop" android:screenOrientation="..." android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|screenLayout|uiMode">
  pushStartElement(idxActivity, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('theme'),
      rawValueIdx: -1,
      dataType: TYPE_REF,
      data: 0x01030007, // android:style/Theme.NoTitleBar.Fullscreen
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('label'),
      rawValueIdx: -1,
      dataType: TYPE_REF,
      data: 0x7f020000,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('name'),
      rawValueIdx: idxMainActivity,
      dataType: TYPE_STRING,
      data: idxMainActivity,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('exported'),
      rawValueIdx: -1,
      dataType: TYPE_INT_BOOL,
      data: 0xffffffff,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('launchMode'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: 1, // singleTop
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('screenOrientation'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: orientationCode,
    },
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('configChanges'),
      rawValueIdx: -1,
      dataType: TYPE_INT_DEC,
      data: 0x0fb0, // orientation|screenSize|keyboardHidden|keyboard|screenLayout|smallestScreenSize|uiMode
    },
  ]);

  // <intent-filter>
  pushStartElement(idxIntentFilter, []);
  pushStartElement(idxAction, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('name'),
      rawValueIdx: idxIntentMain,
      dataType: TYPE_STRING,
      data: idxIntentMain,
    },
  ]);
  pushEndElement(idxAction);

  pushStartElement(idxCategory, [
    {
      nsIdx: idxUri,
      nameIdx: attrIdx('name'),
      rawValueIdx: idxIntentLauncher,
      dataType: TYPE_STRING,
      data: idxIntentLauncher,
    },
  ]);
  pushEndElement(idxCategory);
  pushEndElement(idxIntentFilter);

  pushEndElement(idxActivity);
  pushEndElement(idxApplication);
  pushEndElement(idxManifest);
  pushEndNamespace();

  // Build StringPool & ResourceMap
  const stringPoolChunk = buildUtf16StringPoolChunk(stringTable);

  const resMapSize = 8 + attrResourceMap.length * 4;
  const resMapChunk = Buffer.alloc(resMapSize);
  resMapChunk.writeUInt16LE(0x0180, 0); // RES_XML_RESOURCE_MAP_TYPE
  resMapChunk.writeUInt16LE(8, 2);
  resMapChunk.writeUInt32LE(resMapSize, 4);
  for (let i = 0; i < attrResourceMap.length; i++) {
    resMapChunk.writeUInt32LE(attrResourceMap[i].id, 8 + i * 4);
  }

  const body = Buffer.concat([stringPoolChunk, resMapChunk, ...chunks]);
  const xmlHeader = Buffer.alloc(8);
  xmlHeader.writeUInt16LE(0x0003, 0); // RES_XML_TYPE
  xmlHeader.writeUInt16LE(8, 2);
  xmlHeader.writeUInt32LE(8 + body.length, 4);

  return Buffer.concat([xmlHeader, body]);
}

// ---------- Binary resources.arsc Compiler ----------

function buildResTypeSpecAndTypeChunk(params: {
  typeId: number;
  keyIndex: number;
  globalStringIndex: number;
}): Buffer {
  // ResTable_typeSpec (0x0202)
  const specChunk = Buffer.alloc(20);
  specChunk.writeUInt16LE(0x0202, 0); // RES_TABLE_TYPE_SPEC_TYPE
  specChunk.writeUInt16LE(16, 2);
  specChunk.writeUInt32LE(20, 4);
  specChunk.writeUInt8(params.typeId, 8);
  specChunk.writeUInt8(0, 9);
  specChunk.writeUInt16LE(0, 10);
  specChunk.writeUInt32LE(1, 12); // entryCount
  specChunk.writeUInt32LE(0, 16); // entry 0 spec flags (default config)

  // ResTable_type (0x0201) with 64-byte ResTable_config
  const typeHeaderSize = 20 + 64; // 84
  const entryTableSize = 4; // 1 entry offset
  const entryPayloadSize = 16; // ResTable_entry (8) + Res_value (8)
  const typeChunkSize = typeHeaderSize + entryTableSize + entryPayloadSize;
  const typeChunk = Buffer.alloc(typeChunkSize);

  typeChunk.writeUInt16LE(0x0201, 0); // RES_TABLE_TYPE_TYPE
  typeChunk.writeUInt16LE(typeHeaderSize, 2);
  typeChunk.writeUInt32LE(typeChunkSize, 4);
  typeChunk.writeUInt8(params.typeId, 8);
  typeChunk.writeUInt8(0, 9);
  typeChunk.writeUInt16LE(0, 10);
  typeChunk.writeUInt32LE(1, 12); // entryCount
  typeChunk.writeUInt32LE(typeHeaderSize + entryTableSize, 16); // entriesStart

  // ResTable_config (at offset 20, size = 64, default empty config)
  typeChunk.writeUInt32LE(64, 20);

  // entry offset[0] = 0
  typeChunk.writeUInt32LE(0, typeHeaderSize);

  // ResTable_entry + Res_value
  const entryOff = typeHeaderSize + entryTableSize;
  typeChunk.writeUInt16LE(8, entryOff); // entry size
  typeChunk.writeUInt16LE(0, entryOff + 2); // flags
  typeChunk.writeUInt32LE(params.keyIndex, entryOff + 4); // key string index

  // Res_value
  typeChunk.writeUInt16LE(8, entryOff + 8); // Res_value.size
  typeChunk.writeUInt8(0, entryOff + 10); // res0
  typeChunk.writeUInt8(0x03, entryOff + 11); // TYPE_STRING
  typeChunk.writeUInt32LE(params.globalStringIndex, entryOff + 12);

  return Buffer.concat([specChunk, typeChunk]);
}

export function buildResourcesArsc(params: {
  packageName: string;
  appName: string;
}): Buffer {
  const iconResPath = 'res/mipmap/ic_launcher.png';
  const globalStringPool = buildUtf16StringPoolChunk([iconResPath, params.appName]);
  const typeStrings = buildUtf16StringPoolChunk(['mipmap', 'string']);
  const keyStrings = buildUtf16StringPoolChunk(['ic_launcher', 'app_name']);

  const mipmapChunks = buildResTypeSpecAndTypeChunk({
    typeId: 1,
    keyIndex: 0,
    globalStringIndex: 0,
  });
  const stringChunks = buildResTypeSpecAndTypeChunk({
    typeId: 2,
    keyIndex: 1,
    globalStringIndex: 1,
  });

  const pkgHeaderSize = 288;
  const pkgBody = Buffer.concat([typeStrings, keyStrings, mipmapChunks, stringChunks]);
  const pkgHeader = Buffer.alloc(pkgHeaderSize);
  pkgHeader.writeUInt16LE(0x0200, 0); // RES_TABLE_PACKAGE_TYPE
  pkgHeader.writeUInt16LE(pkgHeaderSize, 2);
  pkgHeader.writeUInt32LE(pkgHeaderSize + pkgBody.length, 4);
  pkgHeader.writeUInt32LE(0x7f, 8); // package id

  const pkgNameUtf16 = Buffer.from(params.packageName.slice(0, 127), 'utf16le');
  pkgNameUtf16.copy(pkgHeader, 12); // uint16_t name[128]

  pkgHeader.writeUInt32LE(pkgHeaderSize, 268); // typeStrings offset from pkg start
  pkgHeader.writeUInt32LE(0, 272); // lastPublicType
  pkgHeader.writeUInt32LE(pkgHeaderSize + typeStrings.length, 276); // keyStrings offset from pkg start
  pkgHeader.writeUInt32LE(0, 280); // lastPublicKey
  pkgHeader.writeUInt32LE(0, 284); // typeIdOffset

  const tableHeaderSize = 12;
  const totalSize = tableHeaderSize + globalStringPool.length + pkgHeader.length + pkgBody.length;
  const tableHeader = Buffer.alloc(tableHeaderSize);
  tableHeader.writeUInt16LE(0x0002, 0); // RES_TABLE_TYPE
  tableHeader.writeUInt16LE(tableHeaderSize, 2);
  tableHeader.writeUInt32LE(totalSize, 4);
  tableHeader.writeUInt32LE(1, 8); // packageCount

  return Buffer.concat([tableHeader, globalStringPool, pkgHeader, pkgBody]);
}

// ---------- Dalvik DEX v035 Compiler for WebView MainActivity ----------

interface DexMethodSpec {
  classDesc: string;
  name: string;
  retDesc: string;
  paramDescs: string[];
}

export function buildWebViewMainActivityDex(packageName: string): Buffer {
  const pkgPath = packageName.replace(/\./g, '/');
  const mainActivityDesc = `L${pkgPath}/MainActivity;`;
  const startUrl = 'file:///android_asset/www/index.html';

  const methodSpecs: DexMethodSpec[] = [
    { classDesc: 'Landroid/app/Activity;', name: '<init>', retDesc: 'V', paramDescs: [] },
    { classDesc: 'Landroid/app/Activity;', name: 'getWindow', retDesc: 'Landroid/view/Window;', paramDescs: [] },
    { classDesc: 'Landroid/app/Activity;', name: 'onCreate', retDesc: 'V', paramDescs: ['Landroid/os/Bundle;'] },
    { classDesc: 'Landroid/app/Activity;', name: 'requestWindowFeature', retDesc: 'Z', paramDescs: ['I'] },
    { classDesc: 'Landroid/app/Activity;', name: 'setContentView', retDesc: 'V', paramDescs: ['Landroid/view/View;'] },
    { classDesc: 'Landroid/view/Window;', name: 'addFlags', retDesc: 'V', paramDescs: ['I'] },
    { classDesc: 'Landroid/webkit/WebChromeClient;', name: '<init>', retDesc: 'V', paramDescs: [] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setAllowFileAccess', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setAllowFileAccessFromFileURLs', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setAllowUniversalAccessFromFileURLs', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setDomStorageEnabled', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setJavaScriptEnabled', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setLoadWithOverviewMode', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setMediaPlaybackRequiresUserGesture', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebSettings;', name: 'setUseWideViewPort', retDesc: 'V', paramDescs: ['Z'] },
    { classDesc: 'Landroid/webkit/WebView;', name: '<init>', retDesc: 'V', paramDescs: ['Landroid/content/Context;'] },
    { classDesc: 'Landroid/webkit/WebView;', name: 'getSettings', retDesc: 'Landroid/webkit/WebSettings;', paramDescs: [] },
    { classDesc: 'Landroid/webkit/WebView;', name: 'loadUrl', retDesc: 'V', paramDescs: ['Ljava/lang/String;'] },
    { classDesc: 'Landroid/webkit/WebView;', name: 'setBackgroundColor', retDesc: 'V', paramDescs: ['I'] },
    { classDesc: 'Landroid/webkit/WebView;', name: 'setWebChromeClient', retDesc: 'V', paramDescs: ['Landroid/webkit/WebChromeClient;'] },
    { classDesc: 'Landroid/webkit/WebView;', name: 'setWebViewClient', retDesc: 'V', paramDescs: ['Landroid/webkit/WebViewClient;'] },
    { classDesc: 'Landroid/webkit/WebViewClient;', name: '<init>', retDesc: 'V', paramDescs: [] },
    { classDesc: mainActivityDesc, name: '<init>', retDesc: 'V', paramDescs: [] },
    { classDesc: mainActivityDesc, name: 'onCreate', retDesc: 'V', paramDescs: ['Landroid/os/Bundle;'] },
  ];

  const makeShorty = (retDesc: string, paramDescs: string[]): string => {
    const ch = (d: string) => (d.startsWith('L') || d.startsWith('[') ? 'L' : d);
    return ch(retDesc) + paramDescs.map(ch).join('');
  };

  // Collect all unique strings
  const stringSet = new Set<string>([startUrl]);
  const typeSet = new Set<string>([mainActivityDesc, 'Landroid/app/Activity;']);
  const protoKeySet = new Map<string, { shorty: string; retDesc: string; paramDescs: string[] }>();

  for (const m of methodSpecs) {
    stringSet.add(m.classDesc);
    stringSet.add(m.name);
    typeSet.add(m.classDesc);
    typeSet.add(m.retDesc);
    stringSet.add(m.retDesc);
    for (const p of m.paramDescs) {
      typeSet.add(p);
      stringSet.add(p);
    }
    const shorty = makeShorty(m.retDesc, m.paramDescs);
    stringSet.add(shorty);
    const pKey = `${m.retDesc}|${m.paramDescs.join(',')}`;
    if (!protoKeySet.has(pKey)) {
      protoKeySet.set(pKey, { shorty, retDesc: m.retDesc, paramDescs: m.paramDescs });
    }
  }
  stringSet.add('Landroid/app/Activity;');
  stringSet.add(mainActivityDesc);

  // DEX requires string_ids sorted strictly lexicographically by UTF-8 bytes
  const sortedStrings = Array.from(stringSet).sort((a, b) =>
    Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  );
  const strIdx = (s: string): number => {
    const idx = sortedStrings.indexOf(s);
    if (idx < 0) throw new Error(`Missing DEX string: ${s}`);
    return idx;
  };

  // DEX requires type_ids sorted by descriptor string index
  const sortedTypes = Array.from(typeSet).sort((a, b) => strIdx(a) - strIdx(b));
  const typeIdx = (t: string): number => {
    const idx = sortedTypes.indexOf(t);
    if (idx < 0) throw new Error(`Missing DEX type: ${t}`);
    return idx;
  };

  // DEX requires proto_ids sorted by (return_type_idx, parameter type_idx list)
  const sortedProtos = Array.from(protoKeySet.values()).sort((a, b) => {
    const retDiff = typeIdx(a.retDesc) - typeIdx(b.retDesc);
    if (retDiff !== 0) return retDiff;
    const minLen = Math.min(a.paramDescs.length, b.paramDescs.length);
    for (let i = 0; i < minLen; i++) {
      const pDiff = typeIdx(a.paramDescs[i]) - typeIdx(b.paramDescs[i]);
      if (pDiff !== 0) return pDiff;
    }
    return a.paramDescs.length - b.paramDescs.length;
  });
  const protoIdx = (retDesc: string, paramDescs: string[]): number => {
    const idx = sortedProtos.findIndex(
      (p) =>
        p.retDesc === retDesc &&
        p.paramDescs.length === paramDescs.length &&
        p.paramDescs.every((d, i) => d === paramDescs[i])
    );
    if (idx < 0) throw new Error(`Missing DEX proto: (${paramDescs.join('')})${retDesc}`);
    return idx;
  };

  // DEX requires method_ids sorted by (class_idx, name_idx, proto_idx)
  const sortedMethods = [...methodSpecs].sort((a, b) => {
    const cDiff = typeIdx(a.classDesc) - typeIdx(b.classDesc);
    if (cDiff !== 0) return cDiff;
    const nDiff = strIdx(a.name) - strIdx(b.name);
    if (nDiff !== 0) return nDiff;
    return protoIdx(a.retDesc, a.paramDescs) - protoIdx(b.retDesc, b.paramDescs);
  });

  const methodIdx = (classDesc: string, name: string, retDesc?: string, paramDescs?: string[]): number => {
    const idx = sortedMethods.findIndex(
      (m) =>
        m.classDesc === classDesc &&
        m.name === name &&
        (retDesc === undefined || m.retDesc === retDesc) &&
        (paramDescs === undefined ||
          (m.paramDescs.length === paramDescs.length && m.paramDescs.every((p, i) => p === paramDescs[i])))
    );
    if (idx < 0) throw new Error(`Missing DEX method: ${classDesc}.${name}`);
    return idx;
  };

  // Emit Dalvik bytecode instructions
  const encodeInvoke35c = (opcode: number, args: number[], methIndex: number): number[] => {
    const count = args.length;
    const padded = [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0, args[4] ?? 0];
    const u0 = ((count & 0x0f) << 12) | ((padded[4] & 0x0f) << 8) | (opcode & 0xff);
    const u1 = methIndex & 0xffff;
    const u2 =
      ((padded[3] & 0x0f) << 12) |
      ((padded[2] & 0x0f) << 8) |
      ((padded[1] & 0x0f) << 4) |
      (padded[0] & 0x0f);
    return [u0, u1, u2];
  };

  // 1) MainActivity.<init>()V  (registers=1, ins=1, outs=1)
  const initInsns: number[] = [
    ...encodeInvoke35c(0x70, [0], methodIdx('Landroid/app/Activity;', '<init>')),
    0x000e, // return-void
  ];

  // 2) MainActivity.onCreate(Bundle)V  (registers=6: v0..v3 local, v4=this, v5=savedInstanceState; ins=2, outs=2)
  const onCreateInsns: number[] = [
    // super.onCreate(savedInstanceState)
    ...encodeInvoke35c(0x6f, [4, 5], methodIdx('Landroid/app/Activity;', 'onCreate')),
    // requestWindowFeature(1)
    (1 << 12) | (0 << 8) | 0x12, // const/4 v0, 1
    ...encodeInvoke35c(0x6e, [4, 0], methodIdx('Landroid/app/Activity;', 'requestWindowFeature')),
    // getWindow().addFlags(1024)
    ...encodeInvoke35c(0x6e, [4], methodIdx('Landroid/app/Activity;', 'getWindow')),
    (1 << 8) | 0x0c, // move-result-object v1
    (2 << 8) | 0x13, // const/16 v2, 1024
    1024,
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/view/Window;', 'addFlags')),
    // v0 = new WebView(this)
    (0 << 8) | 0x22, // new-instance v0, WebView
    typeIdx('Landroid/webkit/WebView;'),
    ...encodeInvoke35c(0x70, [0, 4], methodIdx('Landroid/webkit/WebView;', '<init>')),
    // v1 = v0.getSettings()
    ...encodeInvoke35c(0x6e, [0], methodIdx('Landroid/webkit/WebView;', 'getSettings')),
    (1 << 8) | 0x0c, // move-result-object v1
    // Enable all game WebView settings (v2 = 1)
    (1 << 12) | (2 << 8) | 0x12, // const/4 v2, 1
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setJavaScriptEnabled')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setDomStorageEnabled')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setAllowFileAccess')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setAllowFileAccessFromFileURLs')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setAllowUniversalAccessFromFileURLs')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setUseWideViewPort')),
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setLoadWithOverviewMode')),
    // Allow WebAudio & <video> autoplay without extra gesture (v2 = 0)
    (0 << 12) | (2 << 8) | 0x12, // const/4 v2, 0
    ...encodeInvoke35c(0x6e, [1, 2], methodIdx('Landroid/webkit/WebSettings;', 'setMediaPlaybackRequiresUserGesture')),
    // v0.setWebViewClient(new WebViewClient())
    (2 << 8) | 0x22,
    typeIdx('Landroid/webkit/WebViewClient;'),
    ...encodeInvoke35c(0x70, [2], methodIdx('Landroid/webkit/WebViewClient;', '<init>')),
    ...encodeInvoke35c(0x6e, [0, 2], methodIdx('Landroid/webkit/WebView;', 'setWebViewClient')),
    // v0.setWebChromeClient(new WebChromeClient())
    (2 << 8) | 0x22,
    typeIdx('Landroid/webkit/WebChromeClient;'),
    ...encodeInvoke35c(0x70, [2], methodIdx('Landroid/webkit/WebChromeClient;', '<init>')),
    ...encodeInvoke35c(0x6e, [0, 2], methodIdx('Landroid/webkit/WebView;', 'setWebChromeClient')),
    // v0.setBackgroundColor(0xff000000)
    (2 << 8) | 0x14, // const v2, 0xff000000
    0x0000,
    0xff00,
    ...encodeInvoke35c(0x6e, [0, 2], methodIdx('Landroid/webkit/WebView;', 'setBackgroundColor')),
    // v0.loadUrl("file:///android_asset/www/index.html")
    (2 << 8) | 0x1a, // const-string v2, string@idx
    strIdx(startUrl),
    ...encodeInvoke35c(0x6e, [0, 2], methodIdx('Landroid/webkit/WebView;', 'loadUrl')),
    // setContentView(v0)
    ...encodeInvoke35c(0x6e, [4, 0], methodIdx('Landroid/app/Activity;', 'setContentView')),
    0x000e, // return-void
  ];

  const makeCodeItem = (registersSize: number, insSize: number, outsSize: number, insns: number[]): Buffer => {
    const headerSize = 16;
    const insnsBytes = insns.length * 2;
    const totalSize = alignTo4(headerSize + insnsBytes);
    const buf = Buffer.alloc(totalSize);
    buf.writeUInt16LE(registersSize, 0);
    buf.writeUInt16LE(insSize, 2);
    buf.writeUInt16LE(outsSize, 4);
    buf.writeUInt16LE(0, 6); // tries_size
    buf.writeUInt32LE(0, 8); // debug_info_off
    buf.writeUInt32LE(insns.length, 12); // insns_size in 16-bit code units
    for (let i = 0; i < insns.length; i++) {
      buf.writeUInt16LE(insns[i] & 0xffff, headerSize + i * 2);
    }
    return buf;
  };

  // Layout DEX sections carefully:
  // Header (0x70 = 112 bytes)
  // string_id_item[] (4 * stringCount)
  // type_id_item[] (4 * typeCount)
  // proto_id_item[] (12 * protoCount)
  // field_id_item[] (0)
  // method_id_item[] (8 * methodCount)
  // class_def_item[] (32 * 1)
  const headerSize = 0x70;
  const stringIdsOff = headerSize;
  const typeIdsOff = stringIdsOff + sortedStrings.length * 4;
  const protoIdsOff = typeIdsOff + sortedTypes.length * 4;
  const fieldIdsOff = 0; // count 0
  const methodIdsOff = protoIdsOff + sortedProtos.length * 12;
  const classDefsOff = methodIdsOff + sortedMethods.length * 8;
  const dataOff = alignTo4(classDefsOff + 32);

  // Build data section sequentially
  const dataChunks: Buffer[] = [];
  let cursor = dataOff;
  const appendData = (chunk: Buffer, align4 = false): number => {
    if (align4 && cursor % 4 !== 0) {
      const pad = 4 - (cursor % 4);
      dataChunks.push(Buffer.alloc(pad, 0));
      cursor += pad;
    }
    const off = cursor;
    dataChunks.push(chunk);
    cursor += chunk.length;
    return off;
  };

  // 1) type_list items for protos with params (4-byte aligned)
  const protoParamOffs: number[] = [];
  let typeListCount = 0;
  for (const p of sortedProtos) {
    if (p.paramDescs.length === 0) {
      protoParamOffs.push(0);
    } else {
      typeListCount++;
      const listBuf = Buffer.alloc(alignTo4(4 + p.paramDescs.length * 2));
      listBuf.writeUInt32LE(p.paramDescs.length, 0);
      for (let i = 0; i < p.paramDescs.length; i++) {
        listBuf.writeUInt16LE(typeIdx(p.paramDescs[i]), 4 + i * 2);
      }
      protoParamOffs.push(appendData(listBuf, true));
    }
  }

  // 2) code_item items (4-byte aligned)
  const initCodeOff = appendData(makeCodeItem(1, 1, 1, initInsns), true);
  const onCreateCodeOff = appendData(makeCodeItem(6, 2, 2, onCreateInsns), true);

  // 3) string_data_item items (byte-aligned, ULEB128 len + UTF-8 + NUL)
  const stringDataOffs: number[] = [];
  for (const s of sortedStrings) {
    const utf8 = Buffer.from(s, 'utf8');
    const lenPrefix = Buffer.from(encodeUleb128(s.length));
    const entry = Buffer.concat([lenPrefix, utf8, Buffer.from([0])]);
    stringDataOffs.push(appendData(entry, false));
  }

  // 4) class_data_item for MainActivity
  const directMethodIdx = methodIdx(mainActivityDesc, '<init>');
  const virtualMethodIdx = methodIdx(mainActivityDesc, 'onCreate');
  const classDataBytes: number[] = [
    ...encodeUleb128(0), // static_fields_size
    ...encodeUleb128(0), // instance_fields_size
    ...encodeUleb128(1), // direct_methods_size
    ...encodeUleb128(1), // virtual_methods_size
    // direct method: <init>
    ...encodeUleb128(directMethodIdx),
    ...encodeUleb128(0x10001), // ACC_PUBLIC | ACC_CONSTRUCTOR
    ...encodeUleb128(initCodeOff),
    // virtual method: onCreate
    ...encodeUleb128(virtualMethodIdx),
    ...encodeUleb128(0x0001), // ACC_PUBLIC
    ...encodeUleb128(onCreateCodeOff),
  ];
  const classDataOff = appendData(Buffer.from(classDataBytes), false);

  // 5) map_list (4-byte aligned)
  const mapEntries: Array<{ type: number; size: number; offset: number }> = [
    { type: 0x0000, size: 1, offset: 0 }, // header_item
    { type: 0x0001, size: sortedStrings.length, offset: stringIdsOff }, // string_id_item
    { type: 0x0002, size: sortedTypes.length, offset: typeIdsOff }, // type_id_item
    { type: 0x0003, size: sortedProtos.length, offset: protoIdsOff }, // proto_id_item
    { type: 0x0005, size: sortedMethods.length, offset: methodIdsOff }, // method_id_item
    { type: 0x0006, size: 1, offset: classDefsOff }, // class_def_item
  ];
  if (typeListCount > 0) {
    mapEntries.push({
      type: 0x1001,
      size: typeListCount,
      offset: protoParamOffs.find((o) => o > 0)!,
    });
  }
  mapEntries.push(
    { type: 0x2001, size: 2, offset: initCodeOff }, // code_item
    { type: 0x2002, size: sortedStrings.length, offset: stringDataOffs[0] }, // string_data_item
    { type: 0x2000, size: 1, offset: classDataOff } // class_data_item
  );
  // Sort map entries by offset ascending before appending map_list itself
  mapEntries.sort((a, b) => a.offset - b.offset);
  const mapListOff = alignTo4(cursor);
  mapEntries.push({ type: 0x1000, size: 1, offset: mapListOff });

  const mapBuf = Buffer.alloc(4 + mapEntries.length * 12);
  mapBuf.writeUInt32LE(mapEntries.length, 0);
  for (let i = 0; i < mapEntries.length; i++) {
    const e = mapEntries[i];
    const base = 4 + i * 12;
    mapBuf.writeUInt16LE(e.type, base);
    mapBuf.writeUInt16LE(0, base + 2);
    mapBuf.writeUInt32LE(e.size, base + 4);
    mapBuf.writeUInt32LE(e.offset, base + 8);
  }
  appendData(mapBuf, true);

  // Align total file length to 4 bytes
  const fileSize = alignTo4(cursor);
  const dex = Buffer.alloc(fileSize);

  // Write string_id_item[]
  for (let i = 0; i < sortedStrings.length; i++) {
    dex.writeUInt32LE(stringDataOffs[i], stringIdsOff + i * 4);
  }
  // Write type_id_item[]
  for (let i = 0; i < sortedTypes.length; i++) {
    dex.writeUInt32LE(strIdx(sortedTypes[i]), typeIdsOff + i * 4);
  }
  // Write proto_id_item[]
  for (let i = 0; i < sortedProtos.length; i++) {
    const p = sortedProtos[i];
    const off = protoIdsOff + i * 12;
    dex.writeUInt32LE(strIdx(p.shorty), off);
    dex.writeUInt32LE(typeIdx(p.retDesc), off + 4);
    dex.writeUInt32LE(protoParamOffs[i], off + 8);
  }
  // Write method_id_item[]
  for (let i = 0; i < sortedMethods.length; i++) {
    const m = sortedMethods[i];
    const off = methodIdsOff + i * 8;
    dex.writeUInt16LE(typeIdx(m.classDesc), off);
    dex.writeUInt16LE(protoIdx(m.retDesc, m.paramDescs), off + 2);
    dex.writeUInt32LE(strIdx(m.name), off + 4);
  }
  // Write class_def_item (MainActivity)
  dex.writeUInt32LE(typeIdx(mainActivityDesc), classDefsOff); // class_idx
  dex.writeUInt32LE(0x0001, classDefsOff + 4); // ACC_PUBLIC
  dex.writeUInt32LE(typeIdx('Landroid/app/Activity;'), classDefsOff + 8); // superclass_idx
  dex.writeUInt32LE(0, classDefsOff + 12); // interfaces_off
  dex.writeUInt32LE(0xffffffff, classDefsOff + 16); // source_file_idx (NO_INDEX)
  dex.writeUInt32LE(0, classDefsOff + 20); // annotations_off
  dex.writeUInt32LE(classDataOff, classDefsOff + 24); // class_data_off
  dex.writeUInt32LE(0, classDefsOff + 28); // static_values_off

  // Copy data section
  Buffer.concat(dataChunks).copy(dex, dataOff);

  // Write DEX header (0x70 bytes)
  Buffer.from('dex\n035\0', 'ascii').copy(dex, 0);
  dex.writeUInt32LE(fileSize, 32);
  dex.writeUInt32LE(headerSize, 36);
  dex.writeUInt32LE(0x12345678, 40); // ENDIAN_CONSTANT
  dex.writeUInt32LE(0, 44); // link_size
  dex.writeUInt32LE(0, 48); // link_off
  dex.writeUInt32LE(mapListOff, 52);
  dex.writeUInt32LE(sortedStrings.length, 56);
  dex.writeUInt32LE(stringIdsOff, 60);
  dex.writeUInt32LE(sortedTypes.length, 64);
  dex.writeUInt32LE(typeIdsOff, 68);
  dex.writeUInt32LE(sortedProtos.length, 72);
  dex.writeUInt32LE(protoIdsOff, 76);
  dex.writeUInt32LE(0, 80); // field_ids_size
  dex.writeUInt32LE(fieldIdsOff, 84);
  dex.writeUInt32LE(sortedMethods.length, 88);
  dex.writeUInt32LE(methodIdsOff, 92);
  dex.writeUInt32LE(1, 96); // class_defs_size
  dex.writeUInt32LE(classDefsOff, 100);
  dex.writeUInt32LE(fileSize - dataOff, 104); // data_size
  dex.writeUInt32LE(dataOff, 108);

  // Compute SHA-1 signature over bytes 32..end
  const sha1 = crypto.createHash('sha1').update(dex.subarray(32)).digest();
  sha1.copy(dex, 12);

  // Compute Adler-32 checksum over bytes 12..end
  const csum = adler32(dex, 12);
  dex.writeUInt32LE(csum, 8);

  return dex;
}

// ---------- Signing Material Resolver (Debug / Keystore / Files / Auto-Release) ----------

let cachedDebugMaterial: ResolvedSigningMaterial | null = null;

async function createSelfSignedMaterial(params: {
  mode: 'debug' | 'generate';
  commonName: string;
  organization: string;
  country: string;
  days: number;
}): Promise<ResolvedSigningMaterial> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'return2d-cert-'));
  try {
    const keyPath = path.join(workDir, 'key.pem');
    const certPath = path.join(workDir, 'cert.pem');
    const cn = params.commonName.replace(/[,="/\\]/g, '').trim() || 'Return Game';
    const org = params.organization.replace(/[,="/\\]/g, '').trim() || 'Return Studio';
    const country =
      params.country
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 2)
        .toUpperCase() || 'ES';

    await execFileAsync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        String(params.days),
        '-subj',
        `/C=${country}/O=${org}/CN=${cn}`,
      ],
      { timeout: 25000 }
    );

    const [keyPem, certPem] = await Promise.all([
      fs.readFile(keyPath, 'utf8'),
      fs.readFile(certPath, 'utf8'),
    ]);

    const x509 = new crypto.X509Certificate(certPem);
    return {
      mode: params.mode,
      certPem,
      certDer: Buffer.from(x509.raw),
      keyPem,
      subject: x509.subject.replace(/\n/g, ', '),
      sha256Fingerprint: x509.fingerprint256,
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function normalizeCertificateBuffer(raw: Buffer, tmpDir: string): Promise<{ certPem: string; certDer: Buffer; subject: string; sha256Fingerprint: string }> {
  const asText = raw.toString('utf8');
  if (asText.includes('-----BEGIN CERTIFICATE-----')) {
    const match = asText.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    const certPem = match ? `${match[0]}\n` : asText;
    const x509 = new crypto.X509Certificate(certPem);
    return {
      certPem,
      certDer: Buffer.from(x509.raw),
      subject: x509.subject.replace(/\n/g, ', '),
      sha256Fingerprint: x509.fingerprint256,
    };
  }

  // Binary DER certificate (.cer / .crt / .der)
  const derPath = path.join(tmpDir, 'cert.der');
  await fs.writeFile(derPath, raw);
  const { stdout: certPem } = await execFileAsync(
    'openssl',
    ['x509', '-inform', 'DER', '-in', derPath, '-outform', 'PEM'],
    { timeout: 10000 }
  );
  const x509 = new crypto.X509Certificate(certPem);
  return {
    certPem,
    certDer: Buffer.from(x509.raw),
    subject: x509.subject.replace(/\n/g, ', '),
    sha256Fingerprint: x509.fingerprint256,
  };
}

function normalizePrivateKeyBuffer(raw: Buffer, password?: string): string {
  const asText = raw.toString('utf8');
  const opts: crypto.PrivateKeyInput = {
    key: asText.includes('-----BEGIN ') ? asText : raw,
    format: asText.includes('-----BEGIN ') ? 'pem' : 'der',
  };
  if (!asText.includes('-----BEGIN ')) {
    opts.type = 'pkcs8';
  }
  if (password) {
    opts.passphrase = password;
  }

  let keyObj: crypto.KeyObject;
  try {
    keyObj = crypto.createPrivateKey(opts);
  } catch (err: any) {
    // Retry DER as pkcs1 if pkcs8 failed
    if (!asText.includes('-----BEGIN ')) {
      try {
        keyObj = crypto.createPrivateKey({
          key: raw,
          format: 'der',
          type: 'pkcs1',
          ...(password ? { passphrase: password } : {}),
        });
      } catch {
        throw new Error(`No se pudo leer la clave privada (.pem/.key/.pk8): ${err?.message || 'formato o contraseña incorrecta'}`);
      }
    } else {
      throw new Error(`No se pudo leer la clave privada: ${err?.message || 'formato o contraseña incorrecta'}`);
    }
  }

  return String(keyObj.export({ type: 'pkcs8', format: 'pem' }));
}

export async function resolveSigningMaterial(
  signing?: ApkBuilderSigningInput
): Promise<ResolvedSigningMaterial> {
  const s = signing || {};
  const explicitMode = s.signingMode;
  const mode: 'debug' | 'keystore' | 'files' | 'generate' =
    explicitMode ||
    (s.certBase64 && s.privateKeyBase64
      ? 'files'
      : s.keystoreBase64
        ? 'keystore'
        : s.buildType === 'release' && s.generateKeystore
          ? 'generate'
          : 'debug');

  if (mode === 'debug') {
    if (!cachedDebugMaterial) {
      cachedDebugMaterial = await createSelfSignedMaterial({
        mode: 'debug',
        commonName: 'Android Debug',
        organization: 'Android',
        country: 'US',
        days: 10950,
      });
    }
    return cachedDebugMaterial;
  }

  if (mode === 'generate') {
    return createSelfSignedMaterial({
      mode: 'generate',
      commonName: s.distinguishedName?.commonName || s.appName || 'Return Game',
      organization: s.distinguishedName?.organization || 'Return Studio',
      country: s.distinguishedName?.country || 'ES',
      days: 10000,
    });
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'return2d-signmat-'));
  try {
    if (mode === 'files') {
      if (!s.certBase64 || !s.privateKeyBase64) {
        throw new Error('Debes adjuntar tanto el certificado (.pem/.crt/.cer/.der) como la clave privada (.pem/.key/.pk8).');
      }
      const certBuf = decodeInputBase64OrText(s.certBase64);
      const keyBuf = decodeInputBase64OrText(s.privateKeyBase64);
      const normCert = await normalizeCertificateBuffer(certBuf, tmpDir);
      const keyPem = normalizePrivateKeyBuffer(keyBuf, s.privateKeyPassword);
      return {
        mode: 'files',
        ...normCert,
        keyPem,
      };
    }

    // mode === 'keystore' (.keystore PKCS12 / .p12 / .pfx)
    if (!s.keystoreBase64) {
      throw new Error('Debes seleccionar un archivo .keystore / .p12 para firmar en modo Keystore.');
    }
    const ksBuf = decodeInputBase64OrText(s.keystoreBase64);

    // Detect legacy binary JKS magic (0xfeedfeed)
    if (ksBuf.length >= 4 && ksBuf.readUInt32BE(0) === 0xfeedfeed) {
      throw new Error(
        'El archivo subido usa formato Java JKS binario heredado. Exporta el keystore a PKCS12 (.p12 / .keystore), usa la pestaña "Firmar con Archivos (Certificado + Clave)", o elige "Autogenerar Firma Release".'
      );
    }

    const ksPath = path.join(tmpDir, 'upload.p12');
    const outPemPath = path.join(tmpDir, 'out.pem');
    await fs.writeFile(ksPath, ksBuf);
    const storePass = s.storePassword ?? '';

    const runPkcs12 = async (useLegacy: boolean) => {
      const args = [
        'pkcs12',
        '-in',
        ksPath,
        '-nodes',
        '-passin',
        `pass:${storePass}`,
        '-out',
        outPemPath,
      ];
      if (useLegacy) args.push('-legacy');
      await execFileAsync('openssl', args, { timeout: 15000 });
    };

    try {
      await runPkcs12(false);
    } catch {
      try {
        await runPkcs12(true);
      } catch (err: any) {
        throw new Error(
          `No se pudo abrir el archivo .keystore/.p12 con la contraseña proporcionada: ${err?.message || 'contraseña o archivo inválido'}`
        );
      }
    }

    const pemBundle = await fs.readFile(outPemPath, 'utf8');
    const certMatch = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    const keyMatch = pemBundle.match(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z0-9 ]*PRIVATE KEY-----/);
    if (!certMatch || !keyMatch) {
      throw new Error('El keystore .p12/.keystore no contiene un par válido de certificado y clave privada.');
    }

    const normCert = await normalizeCertificateBuffer(Buffer.from(certMatch[0], 'utf8'), tmpDir);
    const keyPem = normalizePrivateKeyBuffer(Buffer.from(keyMatch[0], 'utf8'), s.keyPassword || storePass);

    return {
      mode: 'keystore',
      ...normCert,
      keyPem,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------- JAR v1 Signature Generator (MANIFEST.MF, CERT.SF, CERT.RSA) ----------

function wrapManifestLine(line: string): string {
  const utf8 = Buffer.from(line, 'utf8');
  if (utf8.length <= 70) return `${line}\r\n`;

  const chunks: string[] = [];
  let current = '';
  let maxBytes = 70;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (Buffer.byteLength(current, 'utf8') + chBytes > maxBytes) {
      chunks.push(current);
      current = ` ${ch}`;
      maxBytes = 70;
    } else {
      current += ch;
    }
  }
  if (current) chunks.push(current);
  return `${chunks.join('\r\n')}\r\n`;
}

async function generateJarV1SignatureFiles(
  entries: Array<{ name: string; data: Buffer }>,
  material: ResolvedSigningMaterial
): Promise<Array<{ name: string; data: Buffer }>> {
  const manifestHeader =
    'Manifest-Version: 1.0\r\nCreated-By: Return Game Engine APK Signer\r\n\r\n';
  const manifestParts: string[] = [manifestHeader];
  const sfEntries: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('META-INF/')) continue;
    const sha256B64 = crypto.createHash('sha256').update(entry.data).digest('base64');
    const stanza =
      wrapManifestLine(`Name: ${entry.name}`) +
      wrapManifestLine(`SHA-256-Digest: ${sha256B64}`) +
      '\r\n';
    manifestParts.push(stanza);

    const stanzaHashB64 = crypto
      .createHash('sha256')
      .update(Buffer.from(stanza, 'utf8'))
      .digest('base64');
    sfEntries.push(
      wrapManifestLine(`Name: ${entry.name}`) +
        wrapManifestLine(`SHA-256-Digest: ${stanzaHashB64}`) +
        '\r\n'
    );
  }

  const manifestBuf = Buffer.from(manifestParts.join(''), 'utf8');
  const manifestDigestB64 = crypto.createHash('sha256').update(manifestBuf).digest('base64');

  const sfHeader =
    'Signature-Version: 1.0\r\n' +
    'Created-By: Return Game Engine APK Signer\r\n' +
    wrapManifestLine(`SHA-256-Digest-Manifest: ${manifestDigestB64}`) +
    'X-Android-APK-Signed: 2\r\n\r\n';
  const sfBuf = Buffer.from(sfHeader + sfEntries.join(''), 'utf8');

  // Generate PKCS#7 / CMS DER detached signature for META-INF/CERT.RSA
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'return2d-cms-'));
  let certRsaBuf: Buffer;
  try {
    const sfPath = path.join(tmpDir, 'CERT.SF');
    const certPath = path.join(tmpDir, 'cert.pem');
    const keyPath = path.join(tmpDir, 'key.pem');
    const rsaPath = path.join(tmpDir, 'CERT.RSA');

    await Promise.all([
      fs.writeFile(sfPath, sfBuf),
      fs.writeFile(certPath, material.certPem, 'utf8'),
      fs.writeFile(keyPath, material.keyPem, 'utf8'),
    ]);

    await execFileAsync(
      'openssl',
      [
        'cms',
        '-sign',
        '-binary',
        '-in',
        sfPath,
        '-signer',
        certPath,
        '-inkey',
        keyPath,
        '-outform',
        'DER',
        '-noattr',
        '-md',
        'sha256',
        '-out',
        rsaPath,
      ],
      { timeout: 15000 }
    );

    certRsaBuf = await fs.readFile(rsaPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return [
    { name: 'META-INF/MANIFEST.MF', data: manifestBuf },
    { name: 'META-INF/CERT.SF', data: sfBuf },
    { name: 'META-INF/CERT.RSA', data: certRsaBuf },
  ];
}

// ---------- Aligned ZIP Writer & APK Signature Scheme v2 ----------

interface ZipBuildEntry {
  name: string;
  data: Buffer;
  store?: boolean;
  align4?: boolean;
}

function buildZipSections(entries: ZipBuildEntry[]): {
  section1: Buffer;
  section3: Buffer;
  section4: Buffer;
  resourcesAligned4: boolean;
} {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;
  let resourcesAligned4 = true;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataCrc = crc32(entry.data);
    const uncompressedSize = entry.data.length;

    let method = 8; // DEFLATE
    let payload: Buffer;
    if (entry.store) {
      method = 0;
      payload = entry.data;
    } else {
      const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
      if (compressed.length < entry.data.length) {
        payload = compressed;
      } else {
        method = 0;
        payload = entry.data;
      }
    }

    let extraLen = 0;
    if (entry.align4 && method === 0) {
      const rawDataStart = offset + 30 + nameBuf.length;
      const rem = rawDataStart % 4;
      if (rem !== 0) {
        extraLen = 4 - rem;
      }
      if (entry.name === 'resources.arsc') {
        resourcesAligned4 = ((rawDataStart + extraLen) % 4) === 0;
      }
    }

    const lfh = Buffer.alloc(30 + nameBuf.length + extraLen);
    lfh.writeUInt32LE(0x04034b50, 0); // Local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0x5421, 12); // mod date (2022-01-01)
    lfh.writeUInt32LE(dataCrc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(uncompressedSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(extraLen, 28);
    nameBuf.copy(lfh, 30);

    const cdh = Buffer.alloc(46 + nameBuf.length);
    cdh.writeUInt32LE(0x02014b50, 0); // Central directory header
    cdh.writeUInt16LE(20, 4); // version made by
    cdh.writeUInt16LE(20, 6); // version needed
    cdh.writeUInt16LE(0x0800, 8); // UTF-8
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0x5421, 14);
    cdh.writeUInt32LE(dataCrc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(uncompressedSize, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra len
    cdh.writeUInt16LE(0, 32); // comment len
    cdh.writeUInt16LE(0, 34); // disk start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(cdh, 46);

    localParts.push(lfh, payload);
    cdParts.push(cdh);
    offset += lfh.length + payload.length;
  }

  const section1 = Buffer.concat(localParts);
  const section3 = Buffer.concat(cdParts);

  const section4 = Buffer.alloc(22);
  section4.writeUInt32LE(0x06054b50, 0); // EOCD signature
  section4.writeUInt16LE(0, 4);
  section4.writeUInt16LE(0, 6);
  section4.writeUInt16LE(entries.length, 8);
  section4.writeUInt16LE(entries.length, 10);
  section4.writeUInt32LE(section3.length, 12);
  section4.writeUInt32LE(section1.length, 16);
  section4.writeUInt16LE(0, 20);

  return { section1, section3, section4, resourcesAligned4 };
}

function u32LE(val: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(val >>> 0, 0);
  return b;
}

function u64LE(val: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(val), 0);
  return b;
}

function lengthPrefixed32(payload: Buffer): Buffer {
  return Buffer.concat([u32LE(payload.length), payload]);
}

function computeApkV2Digest(section1: Buffer, section3: Buffer, section4: Buffer): Buffer {
  const CHUNK_SIZE = 1024 * 1024;
  const chunkDigests: Buffer[] = [];
  const prefix = Buffer.alloc(5);
  prefix[0] = 0xa5;

  for (const sec of [section1, section3, section4]) {
    if (sec.length === 0) {
      prefix.writeUInt32LE(0, 1);
      chunkDigests.push(crypto.createHash('sha256').update(prefix).digest());
      continue;
    }
    for (let pos = 0; pos < sec.length; pos += CHUNK_SIZE) {
      const chunk = sec.subarray(pos, Math.min(pos + CHUNK_SIZE, sec.length));
      prefix.writeUInt32LE(chunk.length, 1);
      const h = crypto.createHash('sha256');
      h.update(prefix);
      h.update(chunk);
      chunkDigests.push(h.digest());
    }
  }

  const topPrefix = Buffer.alloc(5);
  topPrefix[0] = 0x5a;
  topPrefix.writeUInt32LE(chunkDigests.length, 1);

  const rootHash = crypto.createHash('sha256');
  rootHash.update(topPrefix);
  for (const d of chunkDigests) {
    rootHash.update(d);
  }
  return rootHash.digest();
}

function applyApkSignatureSchemeV2(
  section1: Buffer,
  section3: Buffer,
  section4: Buffer,
  material: ResolvedSigningMaterial
): Buffer {
  // Section 4 EOCD already has cd_offset = section1.length for digest computation
  const contentDigest = computeApkV2Digest(section1, section3, section4);

  const SIG_ALG_RSA_PKCS1_V15_SHA256 = 0x0103;
  const APK_SIG_SCHEME_V2_BLOCK_ID = 0x7109871a;

  const digestItem = lengthPrefixed32(
    Buffer.concat([u32LE(SIG_ALG_RSA_PKCS1_V15_SHA256), lengthPrefixed32(contentDigest)])
  );
  const certItem = lengthPrefixed32(material.certDer);
  const signedData = Buffer.concat([
    lengthPrefixed32(digestItem),
    lengthPrefixed32(certItem),
    u32LE(0), // additional attributes
  ]);

  const signatureBytes = crypto.sign('sha256', signedData, material.keyPem);
  const signatureItem = lengthPrefixed32(
    Buffer.concat([u32LE(SIG_ALG_RSA_PKCS1_V15_SHA256), lengthPrefixed32(signatureBytes)])
  );

  const x509 = new crypto.X509Certificate(material.certPem);
  const spkiDer = Buffer.from(x509.publicKey.export({ type: 'spki', format: 'der' }));

  const signerBlock = Buffer.concat([
    lengthPrefixed32(signedData),
    lengthPrefixed32(signatureItem),
    lengthPrefixed32(spkiDer),
  ]);
  const signersList = lengthPrefixed32(signerBlock);
  const v2BlockValue = lengthPrefixed32(signersList);

  const pairBody = Buffer.concat([u32LE(APK_SIG_SCHEME_V2_BLOCK_ID), v2BlockValue]);
  const pair = Buffer.concat([u64LE(pairBody.length), pairBody]);

  // Android spec recommends sizeOfBlockExcludingFirstU64 = pairsLen + 8 + 16
  const sizeOfBlock = BigInt(pair.length + 24);
  const magic = Buffer.from('APK Sig Block 42', 'ascii');
  const signingBlock = Buffer.concat([
    u64LE(sizeOfBlock),
    pair,
    u64LE(sizeOfBlock),
    magic,
  ]);

  const finalSection4 = Buffer.from(section4);
  finalSection4.writeUInt32LE(section1.length + signingBlock.length, 16);

  return Buffer.concat([section1, signingBlock, section3, finalSection4]);
}

// ---------- High-level Asset Extractor & APK Orchestrator ----------

export async function extractWwwFilesFromPayload(payload: {
  cordovaZipBase64?: string;
  html?: string;
  projectJson?: string;
}): Promise<WwwFileEntry[]> {
  const out: WwwFileEntry[] = [];

  if (typeof payload.cordovaZipBase64 === 'string' && payload.cordovaZipBase64.length > 0) {
    const zipBuf = Buffer.from(stripBase64Prefix(payload.cordovaZipBase64), 'base64');
    const zip = await JSZip.loadAsync(zipBuf);
    const paths = Object.keys(zip.files).sort();
    for (const entryPath of paths) {
      const entry = zip.files[entryPath];
      if (entry.dir) continue;
      const clean = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
      if (clean.startsWith('www/')) {
        const relPath = clean.slice('www/'.length);
        if (!relPath || relPath.includes('..')) continue;
        const data = await entry.async('nodebuffer');
        out.push({ relPath, data });
      }
    }
  }

  if (out.length === 0) {
    if (payload.html) {
      out.push({ relPath: 'index.html', data: Buffer.from(String(payload.html), 'utf8') });
    }
    if (payload.projectJson) {
      out.push({ relPath: 'project.json', data: Buffer.from(String(payload.projectJson), 'utf8') });
    }
  } else {
    // Ensure index.html is present even if zip omitted it
    if (payload.html && !out.some((f) => f.relPath === 'index.html')) {
      out.push({ relPath: 'index.html', data: Buffer.from(String(payload.html), 'utf8') });
    }
    if (payload.projectJson && !out.some((f) => f.relPath === 'project.json')) {
      out.push({ relPath: 'project.json', data: Buffer.from(String(payload.projectJson), 'utf8') });
    }
  }

  if (!out.some((f) => f.relPath === 'index.html')) {
    throw new Error('No se encontró www/index.html para empaquetar dentro del APK.');
  }

  return out;
}

export async function buildSignedApk(params: {
  wwwFiles: WwwFileEntry[];
  signing?: ApkBuilderSigningInput;
}): Promise<BuiltApkResult> {
  const s = params.signing || {};
  const rawPkg = (s.packageName || 'com.return2d.game').trim();
  const packageName = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(rawPkg)
    ? rawPkg
    : 'com.return2d.game';
  const appName = (s.appName || 'Return Game').trim() || 'Return Game';
  const versionName = (s.versionName || '1.0.0').trim() || '1.0.0';
  const versionCode = Math.max(1, Number(s.versionCode) || 1);

  const material = await resolveSigningMaterial(s);

  const manifestXml = buildAndroidManifestBinaryXml({
    packageName,
    appName,
    versionCode,
    versionName,
    orientation: 'sensor',
  });
  const resourcesArsc = buildResourcesArsc({ packageName, appName });
  const classesDex = buildWebViewMainActivityDex(packageName);
  const iconPng = generateDefaultIconPng(48);

  const baseEntries: ZipBuildEntry[] = [
    { name: 'AndroidManifest.xml', data: manifestXml, store: false },
    { name: 'classes.dex', data: classesDex, store: false },
    { name: 'resources.arsc', data: resourcesArsc, store: true, align4: true },
    { name: 'res/mipmap/ic_launcher.png', data: iconPng, store: true, align4: true },
  ];

  // Store pre-compressed media formats uncompressed so Android AssetManager / MediaPlayer stream cleanly
  const uncompressExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.woff2']);
  for (const wf of params.wwwFiles) {
    const cleanRel = wf.relPath.replace(/^\/+/, '');
    const ext = path.extname(cleanRel).toLowerCase();
    baseEntries.push({
      name: `assets/www/${cleanRel}`,
      data: wf.data,
      store: uncompressExts.has(ext),
    });
  }

  const jarV1Files = await generateJarV1SignatureFiles(
    baseEntries.map((e) => ({ name: e.name, data: e.data })),
    material
  );

  // Order with META-INF entries + resources.arsc aligned cleanly
  const allEntries: ZipBuildEntry[] = [
    ...jarV1Files.map((f) => ({ name: f.name, data: f.data, store: false })),
    ...baseEntries,
  ];

  const { section1, section3, section4, resourcesAligned4 } = buildZipSections(allEntries);
  const apkBuffer = applyApkSignatureSchemeV2(section1, section3, section4, material);

  return {
    apkBuffer,
    signingInfo: {
      mode: material.mode,
      subject: material.subject,
      sha256Fingerprint: material.sha256Fingerprint,
      packageName,
      appName,
      versionName,
      versionCode,
      entryCount: allEntries.length,
      v1Signed: true,
      v2Signed: true,
      resourcesAligned4,
    },
  };
}

export async function generateReleaseSigningFilesBundle(params: {
  commonName?: string;
  organization?: string;
  country?: string;
  alias?: string;
  storePassword?: string;
}): Promise<{
  certPem: string;
  keyPem: string;
  keystoreP12Base64: string;
  subject: string;
  sha256Fingerprint: string;
}> {
  const mat = await createSelfSignedMaterial({
    mode: 'generate',
    commonName: params.commonName || 'Return Game Studio',
    organization: params.organization || 'Return Interactive',
    country: params.country || 'ES',
    days: 10000,
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'return2d-p12-'));
  try {
    const keyPath = path.join(tmpDir, 'key.pem');
    const certPath = path.join(tmpDir, 'cert.pem');
    const p12Path = path.join(tmpDir, 'release.keystore');
    await Promise.all([
      fs.writeFile(keyPath, mat.keyPem, 'utf8'),
      fs.writeFile(certPath, mat.certPem, 'utf8'),
    ]);
    await execFileAsync(
      'openssl',
      [
        'pkcs12',
        '-export',
        '-out',
        p12Path,
        '-inkey',
        keyPath,
        '-in',
        certPath,
        '-name',
        (params.alias || 'releasekey').trim() || 'releasekey',
        '-passout',
        `pass:${params.storePassword || 'return2d123'}`,
      ],
      { timeout: 15000 }
    );
    const p12Buf = await fs.readFile(p12Path);
    return {
      certPem: mat.certPem,
      keyPem: mat.keyPem,
      keystoreP12Base64: p12Buf.toString('base64'),
      subject: mat.subject,
      sha256Fingerprint: mat.sha256Fingerprint,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

