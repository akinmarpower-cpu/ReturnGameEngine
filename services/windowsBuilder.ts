// Pure TypeScript / Uint8Array Windows Electron + ICO Builder (works in browser & Node)

export interface WindowsExportConfig {
  appName?: string;
  appId?: string;
  version?: string;
  fullscreen?: boolean;
  resizable?: boolean;
  width?: number;
  height?: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32Bytes(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32Bytes(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32Bytes(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

function zlibStoreBytes(raw: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blockCount = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const totalLen = 2 + blockCount * 5 + raw.length + 4;
  const out = new Uint8Array(totalLen);
  out[0] = 0x78;
  out[1] = 0x01;
  let pos = 2;
  let src = 0;
  for (let b = 0; b < blockCount; b++) {
    const chunkLen = Math.min(MAX_BLOCK, raw.length - src);
    const isFinal = b === blockCount - 1 ? 1 : 0;
    out[pos++] = isFinal;
    out[pos++] = chunkLen & 0xff;
    out[pos++] = (chunkLen >>> 8) & 0xff;
    const nlen = (~chunkLen) & 0xffff;
    out[pos++] = nlen & 0xff;
    out[pos++] = (nlen >>> 8) & 0xff;
    if (chunkLen > 0) {
      out.set(raw.subarray(src, src + chunkLen), pos);
      pos += chunkLen;
      src += chunkLen;
    }
  }
  const adler = adler32Bytes(raw);
  const view = new DataView(out.buffer, pos, 4);
  view.setUint32(0, adler, false);
  return out;
}

export function generateProceduralIconPng(size = 256): Uint8Array {
  const rowStride = 1 + size * 4;
  const raw = new Uint8Array(rowStride * size);
  const center = (size - 1) / 2;
  const radius = size * 0.44;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y++) {
    const rowStart = y * rowStride;
    raw[rowStart] = 0;
    const dy = y - center;
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const p = rowStart + 1 + x * 4;

      // Rounded-square SDF
      const qx = Math.abs(dx) - (radius - cornerRadius);
      const qy = Math.abs(dy) - (radius - cornerRadius);
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cornerRadius;

      if (dist <= 0.75) {
        const alpha = dist <= -0.5 ? 255 : Math.max(0, Math.min(255, Math.round((0.75 - dist) / 1.25 * 255)));
        const t = (x + y) / (size * 2);
        let r = Math.round(79 + t * 50);
        let g = Math.round(70 + t * 25);
        let b = Math.round(229 - t * 20);

        // Inner play/cube emblem
        const nx = dx / radius;
        const ny = dy / radius;
        const inPlayTri = nx >= -0.26 && nx <= 0.42 && Math.abs(ny) <= (0.42 - nx) * 0.65;
        const ringDist = Math.abs(Math.hypot(nx, ny) - 0.64);
        if (inPlayTri || ringDist < 0.055) {
          r = 255;
          g = 255;
          b = 255;
        }
        raw[p] = r;
        raw[p + 1] = g;
        raw[p + 2] = b;
        raw[p + 3] = alpha;
      } else {
        raw[p] = 0;
        raw[p + 1] = 0;
        raw[p + 2] = 0;
        raw[p + 3] = 0;
      }
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, size, false);
  ihdrView.setUint32(4, size, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = pngChunk('IHDR', ihdr);
  const idatChunk = pngChunk('IDAT', zlibStoreBytes(raw));
  const iendChunk = pngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(sig.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let off = 0;
  png.set(sig, off); off += sig.length;
  png.set(ihdrChunk, off); off += ihdrChunk.length;
  png.set(idatChunk, off); off += idatChunk.length;
  png.set(iendChunk, off);
  return png;
}

export function buildMultiSizeIcoFromPngs(entries: Array<{ size: number; png: Uint8Array }>): Uint8Array {
  const count = entries.length;
  const headerSize = 6 + count * 16;
  const totalData = entries.reduce((sum, e) => sum + e.png.length, 0);
  const out = new Uint8Array(headerSize + totalData);
  const view = new DataView(out.buffer);

  // ICONDIR header
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type = 1 (.ICO)
  view.setUint16(4, count, true);

  let dataOffset = headerSize;
  for (let i = 0; i < count; i++) {
    const { size, png } = entries[i];
    const dirOff = 6 + i * 16;
    out[dirOff + 0] = size >= 256 ? 0 : size;
    out[dirOff + 1] = size >= 256 ? 0 : size;
    out[dirOff + 2] = 0; // palette count
    out[dirOff + 3] = 0; // reserved
    view.setUint16(dirOff + 4, 1, true); // color planes
    view.setUint16(dirOff + 6, 32, true); // bpp
    view.setUint32(dirOff + 8, png.length, true); // bytes in res
    view.setUint32(dirOff + 12, dataOffset, true); // offset
    out.set(png, dataOffset);
    dataOffset += png.length;
  }
  return out;
}

export function generateDefaultWindowsIcons(): { iconPng: Uint8Array; iconIco: Uint8Array } {
  const png256 = generateProceduralIconPng(256);
  const png48 = generateProceduralIconPng(48);
  const png32 = generateProceduralIconPng(32);
  const png16 = generateProceduralIconPng(16);
  const iconIco = buildMultiSizeIcoFromPngs([
    { size: 256, png: png256 },
    { size: 48, png: png48 },
    { size: 32, png: png32 },
    { size: 16, png: png16 },
  ]);
  return { iconPng: png256, iconIco };
}

export function generateElectronMainJs(config: WindowsExportConfig): string {
  const width = Math.max(640, Number(config.width || 1280));
  const height = Math.max(480, Number(config.height || 720));
  const fullscreen = config.fullscreen === true;
  const resizable = config.resizable !== false;

  return `const { app, BrowserWindow, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Flags de rendimiento WebGL, GPU y audio automático sin bloqueos
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Registrar esquema custom "app://" para evitar por completo errores CORS de file:// en Three.js, audio y GLB
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
};

let mainWindow = null;

function resolveAppFile(reqUrl) {
  const appRoot = path.join(__dirname, 'app');
  let pathname = '/index.html';
  try {
    const parsed = new URL(reqUrl);
    pathname = decodeURIComponent(parsed.pathname || '/index.html');
  } catch {}
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const rel = pathname.replace(/^\\/+/, '');
  const fullPath = path.normalize(path.join(appRoot, rel));
  if (!fullPath.startsWith(appRoot)) {
    return path.join(appRoot, 'index.html');
  }
  return fullPath;
}

function registerAppProtocol() {
  if (typeof protocol.handle === 'function') {
    protocol.handle('app', async (request) => {
      const target = resolveAppFile(request.url);
      if (!fs.existsSync(target)) {
        return new Response('Not found', { status: 404 });
      }
      const ext = path.extname(target).toLowerCase();
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      const resp = await net.fetch(pathToFileURL(target).href);
      const headers = new Headers(resp.headers);
      headers.set('Content-Type', mime);
      return new Response(resp.body, { status: resp.status, headers });
    });
  } else {
    protocol.registerFileProtocol('app', (request, callback) => {
      const target = resolveAppFile(request.url);
      callback({ path: target });
    });
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);
  const iconPath = fs.existsSync(path.join(__dirname, 'build', 'icon.ico'))
    ? path.join(__dirname, 'build', 'icon.ico')
    : path.join(__dirname, 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: ${width},
    height: ${height},
    minWidth: 480,
    minHeight: 360,
    fullscreen: ${fullscreen},
    resizable: ${resizable},
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      event.preventDefault();
      if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  mainWindow.loadURL('app://game/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;
}

export function generateElectronPreloadJs(): string {
  return `const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__RETURN_DESKTOP__', {
  platform: process.platform,
  isElectron: true,
});
`;
}

export function generateElectronPackageJson(config: WindowsExportConfig): string {
  const rawName = (config.appName || 'Return Game').trim() || 'Return Game';
  const slug = rawName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'return-game';
  const version = /^\d+\.\d+\.\d+/.test((config.version || '').trim()) ? (config.version || '').trim() : '1.0.0';
  const appId = (config.appId || `com.returngame.${slug.replace(/[^a-z0-9]/g, '') || 'app'}`).replace(/[^a-zA-Z0-9._-]/g, '');

  const pkg = {
    name: slug,
    productName: rawName,
    version,
    description: `${rawName} - Return Game Engine Desktop Edition`,
    main: 'main.js',
    scripts: {
      start: 'electron .',
      'build:portable': 'electron-builder --win portable --x64',
      'build:installer': 'electron-builder --win nsis --x64',
      'build:win': 'electron-builder --win --x64',
    },
    devDependencies: {
      electron: '^31.2.1',
      'electron-builder': '^24.13.3',
    },
    build: {
      appId,
      productName: rawName,
      asar: true,
      compression: 'maximum',
      forceCodeSigning: false,
      directories: {
        output: 'dist-win',
      },
      files: ['main.js', 'preload.js', 'app/**/*', 'build/**/*'],
      win: {
        target: [
          { target: 'portable', arch: ['x64'] },
          { target: 'nsis', arch: ['x64'] },
        ],
        icon: 'build/icon.ico',
        signAndEditExecutable: false,
      },
      portable: {
        artifactName: `${slug}-portable.exe`,
      },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        artifactName: `${slug}-setup.exe`,
      },
    },
  };
  return JSON.stringify(pkg, null, 2);
}

export function generateWindowsBatchScripts(appName: string): {
  playBat: string;
  buildPortableBat: string;
  buildInstallerBat: string;
  readmeTxt: string;
  githubActionYml: string;
} {
  const safeTitle = (appName || 'Return Game').replace(/[&|<>^"%]/g, '');

  const playBat = `@echo off
title ${safeTitle} - Electron Launcher
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] No se detecto Node.js en este equipo.
  echo Descargalo gratis en https://nodejs.org ^(version LTS^) o ejecuta primero una compilacion .exe.
  pause
  exit /b 1
)
if not exist "node_modules\\electron" (
  echo Instalando runtime Electron por primera vez...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] No se pudo instalar Electron. Verifica tu conexion a internet.
    pause
    exit /b 1
  )
)
echo Iniciando ${safeTitle}...
call npx electron .
`;

  const buildPortableBat = `@echo off
title Compilar ${safeTitle} (.exe Portable sin errores de firma)
cd /d "%~dp0"
set CSC_IDENTITY_AUTO_DISCOVERY=false
set ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Se necesita Node.js LTS instalado para generar el .exe localmente: https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\\electron-builder" (
  echo [1/2] Instalando Electron y Electron-Builder...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Fallo al instalar dependencias npm.
    pause
    exit /b 1
  )
)
echo [2/2] Compilando ejecutable Portable .exe (x64)...
call npx electron-builder --win portable --x64 --config.win.signAndEditExecutable=false
if errorlevel 1 (
  echo [ERROR] La compilacion .exe fallo. Revisa los mensajes anteriores.
  pause
  exit /b 1
)
echo ============================================================
echo LISTO! Tu archivo .exe Portable esta en la carpeta: dist-win\\
echo ============================================================
explorer "dist-win"
pause
`;

  const buildInstallerBat = `@echo off
title Compilar ${safeTitle} (Instalador Windows .exe)
cd /d "%~dp0"
set CSC_IDENTITY_AUTO_DISCOVERY=false
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Instala Node.js LTS desde https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\\electron-builder" (
  call npm install --no-audit --no-fund
)
call npx electron-builder --win nsis --x64 --config.win.signAndEditExecutable=false
if errorlevel 1 (
  pause
  exit /b 1
)
echo Instalador .exe generado en dist-win\\
explorer "dist-win"
pause
`;

  const readmeTxt = `================================================================
${safeTitle} - Exportacion Windows (ZIP + Electron .EXE)
================================================================

ESTRUCTURA DEL PAQUETE (OPTIMIZADA SIN ERRORES DE RUTA/CORS):
- app/index.html       -> Juego optimizado con arranque directo.
- app/assets/          -> Imágenes, audios, vídeos y modelos 3D extraídos.
- app/vendor/          -> Librería Three.js offline incluida (si usa 3D).
- main.js / preload.js -> Protocolo interno "app://game/" (cero errores CORS/file://).
- build/icon.ico       -> Icono multi-resolución (256x256) válido para Windows .exe.
- package.json         -> Configuración electron-builder sin errores winCodeSign.

OPCIÓN 1 — PROBAR / JUGAR AL INSTANTE:
  Haz doble clic en "JUGAR_EN_WINDOWS.bat"

OPCIÓN 2 — GENERAR ARCHIVO .EXE PORTABLE (1 SOLO ARCHIVO):
  Haz doble clic en "COMPILAR_ELECTRON_EXE.bat"
  El archivo .exe final aparecerá en la carpeta "dist-win\\".

OPCIÓN 3 — GENERAR INSTALADOR SETUP .EXE:
  Haz doble clic en "COMPILAR_INSTALADOR_EXE.bat"

OPCIÓN 4 — COMPILAR EN LA NUBE CON GITHUB ACTIONS (SI NO TIENES PC WINDOWS):
  Sube esta carpeta a un repositorio de GitHub; el flujo incluido
  en ".github/workflows/build-windows-exe.yml" compilará el .exe automáticamente.
`;

  const githubActionYml = `name: Build Windows Electron EXE
on:
  workflow_dispatch:
  push:
    branches: [ main, master ]
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install --no-audit --no-fund
      - run: npx electron-builder --win portable --x64
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: false
      - uses: actions/upload-artifact@v4
        with:
          name: windows-portable-exe
          path: dist-win/*.exe
`;

  return { playBat, buildPortableBat, buildInstallerBat, readmeTxt, githubActionYml };
}
