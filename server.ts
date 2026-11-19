import express from "express";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import JSZip from "jszip";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface ApkSigningPayload {
  buildType?: "debug" | "release";
  packageName?: string;
  versionName?: string;
  versionCode?: number;
  appName?: string;
  keystoreBase64?: string;
  keystoreFileName?: string;
  storePassword?: string;
  alias?: string;
  keyPassword?: string;
  keystoreType?: "pkcs12" | "jks";
  generateKeystore?: boolean;
  distinguishedName?: {
    commonName?: string;
    organization?: string;
    country?: string;
  };
}

interface ToolchainStatus {
  localSdkAvailable: boolean;
  tools: {
    java: boolean;
    cordova: boolean;
    gradle: boolean;
    androidSdk: boolean;
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
    await execAsync(checkCmd, { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

async function detectLocalAndroidToolchain(): Promise<ToolchainStatus> {
  const [java, cordova, gradle] = await Promise.all([
    commandExists("java"),
    commandExists("cordova"),
    commandExists("gradle"),
  ]);
  const sdkPath = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  let androidSdk = false;
  if (sdkPath) {
    try {
      const stat = await fs.stat(sdkPath);
      androidSdk = stat.isDirectory();
    } catch {
      androidSdk = false;
    }
  }
  const localSdkAvailable = java && androidSdk && (cordova || gradle);
  return {
    localSdkAvailable,
    tools: { java, cordova, gradle, androidSdk },
  };
}

function normalizeServerUrl(raw?: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function sanitizeSafeName(raw?: unknown): string {
  if (typeof raw !== "string") return "juego_return2d";
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "juego_return2d";
}

function sanitizeKeystoreFileName(raw?: unknown, fallback = "release.keystore"): string {
  if (typeof raw !== "string") return fallback;
  const base = path.basename(raw.trim()).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || fallback;
}

function buildCompanionServerScript(): string {
  return `#!/usr/bin/env node
// Return Game Engine — Servidor Local/Remoto de Compilación Directa APK Debug & Release (Keystore)
// Requisitos en el host: Node.js 18+, JDK 17+ (con keytool), Android SDK (ANDROID_HOME), Apache Cordova (npm i -g cordova)
// Ejecución: node apk-build-server.mjs

import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const PORT = Number(process.env.APK_SERVER_PORT || process.env.PORT || 4050);

async function hasCmd(cmd) {
  try {
    const c = process.platform === "win32" ? \`where \${cmd}\` : \`command -v \${cmd}\`;
    await execAsync(c, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function getCapabilities() {
  const [java, keytool, cordova, gradle, unzipCmd] = await Promise.all([
    hasCmd("java"),
    hasCmd("keytool"),
    hasCmd("cordova"),
    hasCmd("gradle"),
    hasCmd("unzip"),
  ]);
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
  return {
    java,
    keytool,
    cordova,
    gradle,
    unzip: unzipCmd,
    androidSdk: Boolean(androidHome),
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 120 * 1024 * 1024) {
      throw new Error("Payload too large (>120MB)");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw || "{}");
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

async function setupSigningInWorkDir(workDir, buildType, signing) {
  const s = signing || {};
  const isRelease = buildType === "release";
  const ksName = path.basename(String(s.keystoreFileName || (isRelease ? "release.keystore" : "debug.keystore"))).replace(/[^a-zA-Z0-9._-]/g, "_") || (isRelease ? "release.keystore" : "debug.keystore");
  const ksType = s.keystoreType === "jks" ? "jks" : "pkcs12";
  const alias = String(s.alias || (isRelease ? "releasekey" : "androiddebugkey"));
  const storePass = String(s.storePassword || (isRelease ? "return2d123" : "android"));
  const keyPass = String(s.keyPassword || storePass);
  const ksPath = path.join(workDir, ksName);

  if (typeof s.keystoreBase64 === "string" && s.keystoreBase64.length > 0) {
    const rawB64 = s.keystoreBase64.includes(",") ? s.keystoreBase64.split(",")[1] : s.keystoreBase64;
    await fs.writeFile(ksPath, Buffer.from(rawB64, "base64"));
  } else if (isRelease && s.generateKeystore) {
    const exists = await fs.stat(ksPath).then(() => true).catch(() => false);
    if (!exists) {
      const cn = String(s.distinguishedName?.commonName || "Return Game").replace(/[,="\\\\]/g, "");
      const org = String(s.distinguishedName?.organization || "Return Studio").replace(/[,="\\\\]/g, "");
      const country = String(s.distinguishedName?.country || "ES").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "ES";
      await execFileAsync("keytool", [
        "-genkeypair",
        "-v",
        "-keystore", ksPath,
        "-storetype", ksType === "jks" ? "JKS" : "PKCS12",
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-alias", alias,
        "-storepass", storePass,
        "-keypass", keyPass,
        "-dname", \`CN=\${cn}, O=\${org}, C=\${country}\`,
      ], { cwd: workDir, timeout: 60000 });
    }
  }

  const androidDir = path.join(workDir, "platforms", "android");
  const androidExists = await fs.stat(androidDir).then(st => st.isDirectory()).catch(() => false);
  if (androidExists) {
    const ksBytes = await fs.readFile(ksPath).catch(() => null);
    if (ksBytes) {
      await fs.writeFile(path.join(androidDir, ksName), ksBytes);
    }
  }

  let buildJson = { android: {} };
  try {
    buildJson = JSON.parse(await fs.readFile(path.join(workDir, "build.json"), "utf8"));
  } catch {}
  buildJson.android = buildJson.android || {};
  if (isRelease) {
    buildJson.android.release = {
      keystore: ksName,
      storePassword: storePass,
      alias,
      password: keyPass,
      keystoreType: ksType,
    };
  } else if (!buildJson.android.debug) {
    buildJson.android.debug = {
      keystore: "debug.keystore",
      storePassword: "android",
      alias: "androiddebugkey",
      password: "android",
      keystoreType: "pkcs12",
    };
  }
  await fs.writeFile(path.join(workDir, "build.json"), JSON.stringify(buildJson, null, 2), "utf8");
}

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqPath = (req.url || "/").split("?")[0];

  if (req.method === "GET" && (reqPath === "/health" || reqPath === "/")) {
    const tools = await getCapabilities();
    const ready = tools.java && tools.androidSdk && (tools.cordova || tools.gradle);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "return2d-apk-build-server",
      readyToCompile: ready,
      supportsKeystoreSigning: true,
      tools,
      port: PORT,
    }));
    return;
  }

  if (req.method === "POST" && reqPath === "/build-apk") {
    let workDir = null;
    try {
      const body = await readJsonBody(req);
      const safeName = String(body.fileName || "juego").replace(/[^a-zA-Z0-9_-]/g, "_") || "juego";
      const buildType = (body.buildType === "release" || body.signing?.buildType === "release") ? "release" : "debug";
      const tools = await getCapabilities();
      if (!tools.java || !tools.androidSdk || (!tools.cordova && !tools.gradle)) {
        res.writeHead(422, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "TOOLCHAIN_MISSING",
          message: "Faltan herramientas en este host (JDK, ANDROID_HOME o Cordova/Gradle).",
          tools,
        }));
        return;
      }

      workDir = await fs.mkdtemp(path.join(os.tmpdir(), "return2d-apk-"));
      if (typeof body.cordovaZipBase64 === "string" && body.cordovaZipBase64.length > 0) {
        const zipPath = path.join(workDir, "bundle.zip");
        await fs.writeFile(zipPath, Buffer.from(body.cordovaZipBase64, "base64"));
        if (process.platform === "win32") {
          await execAsync(\`powershell -NoProfile -Command "Expand-Archive -Path '\${zipPath}' -DestinationPath '\${workDir}' -Force"\`);
        } else {
          await execAsync(\`unzip -o "\${zipPath}" -d "\${workDir}"\`);
        }
        await fs.rm(zipPath, { force: true });
      } else {
        await fs.mkdir(path.join(workDir, "www"), { recursive: true });
        if (body.html) await fs.writeFile(path.join(workDir, "www", "index.html"), String(body.html), "utf8");
        if (body.projectJson) await fs.writeFile(path.join(workDir, "www", "project.json"), String(body.projectJson), "utf8");
      }

      await setupSigningInWorkDir(workDir, buildType, body.signing);

      if (tools.cordova) {
        try {
          await execAsync("cordova platform add android", { cwd: workDir, timeout: 180000 });
        } catch {
          // platform may already exist from zip
        }
        const flag = buildType === "release" ? "--release" : "--debug";
        await execAsync(\`cordova build android \${flag} --buildConfig=build.json\`, {
          cwd: workDir,
          timeout: 300000,
        });
      } else {
        const androidDir = path.join(workDir, "platforms", "android");
        const task = buildType === "release" ? "assembleRelease" : "assembleDebug";
        await execAsync(\`gradle \${task}\`, { cwd: androidDir, timeout: 300000 });
      }

      const candidates = buildType === "release"
        ? [
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "release", "app-release-signed.apk"),
            path.join(workDir, "platforms", "android", "build", "outputs", "apk", "release", "app-release.apk"),
          ]
        : [
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
            path.join(workDir, "platforms", "android", "build", "outputs", "apk", "debug", "app-debug.apk"),
          ];
      let apkBuf = null;
      for (const candidate of candidates) {
        try {
          apkBuf = await fs.readFile(candidate);
          break;
        } catch {}
      }
      if (!apkBuf || apkBuf.length < 4 || apkBuf[0] !== 0x50 || apkBuf[1] !== 0x4b) {
        throw new Error(\`No se encontró app-\${buildType}.apk válido tras la compilación.\`);
      }

      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": \`attachment; filename="\${safeName}-\${buildType}.apk"\`,
        "Content-Length": String(apkBuf.length),
      });
      res.end(apkBuf);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "APK_BUILD_FAILED",
        message: err?.message || String(err),
      }));
    } finally {
      if (workDir) {
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(\`Return Game Engine APK Build Server (Debug + Release Keystore) activo en http://0.0.0.0:\${PORT}\`);
});
`;
}

async function prepareApkWorkspaceSigning(
  workDir: string,
  buildType: "debug" | "release",
  signing?: ApkSigningPayload
): Promise<void> {
  if (!signing && buildType === "debug") return;
  const s = signing || {};
  const isRelease = buildType === "release";
  const ksName = sanitizeKeystoreFileName(
    s.keystoreFileName,
    isRelease ? "release.keystore" : "debug.keystore"
  );
  const ksType = s.keystoreType === "jks" ? "jks" : "pkcs12";
  const alias = String(s.alias || (isRelease ? "releasekey" : "androiddebugkey"));
  const storePass = String(s.storePassword || (isRelease ? "return2d123" : "android"));
  const keyPass = String(s.keyPassword || storePass);
  const ksPath = path.join(workDir, ksName);

  if (typeof s.keystoreBase64 === "string" && s.keystoreBase64.length > 0) {
    const cleanB64 = s.keystoreBase64.includes(",") ? s.keystoreBase64.split(",")[1] : s.keystoreBase64;
    await fs.writeFile(ksPath, Buffer.from(cleanB64, "base64"));
  } else if (isRelease && s.generateKeystore) {
    const exists = await fs.stat(ksPath).then(() => true).catch(() => false);
    if (!exists) {
      const hasKeytool = await commandExists("keytool");
      if (!hasKeytool) {
        throw new Error("Se requiere 'keytool' (incluido en el JDK) para autogenerar la Keystore de firma.");
      }
      const cn = String(s.distinguishedName?.commonName || "Return Game").replace(/[,="\\]/g, "");
      const org = String(s.distinguishedName?.organization || "Return Studio").replace(/[,="\\]/g, "");
      const country = String(s.distinguishedName?.country || "ES").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "ES";
      await execFileAsync(
        "keytool",
        [
          "-genkeypair",
          "-v",
          "-keystore",
          ksPath,
          "-storetype",
          ksType === "jks" ? "JKS" : "PKCS12",
          "-keyalg",
          "RSA",
          "-keysize",
          "2048",
          "-validity",
          "10000",
          "-alias",
          alias,
          "-storepass",
          storePass,
          "-keypass",
          keyPass,
          "-dname",
          `CN=${cn}, O=${org}, C=${country}`,
        ],
        { cwd: workDir, timeout: 60000 }
      );
    }
  }

  const androidDir = path.join(workDir, "platforms", "android");
  const androidExists = await fs.stat(androidDir).then((st) => st.isDirectory()).catch(() => false);
  if (androidExists) {
    const ksBytes = await fs.readFile(ksPath).catch(() => null);
    if (ksBytes) {
      await fs.writeFile(path.join(androidDir, ksName), ksBytes);
    }
  }

  let buildJson: Record<string, any> = { android: {} };
  try {
    buildJson = JSON.parse(await fs.readFile(path.join(workDir, "build.json"), "utf8"));
  } catch {
    // ignore missing build.json
  }
  buildJson.android = buildJson.android || {};
  if (isRelease) {
    buildJson.android.release = {
      keystore: ksName,
      storePassword: storePass,
      alias,
      password: keyPass,
      keystoreType: ksType,
    };
  } else if (!buildJson.android.debug) {
    buildJson.android.debug = {
      keystore: "debug.keystore",
      storePassword: "android",
      alias: "androiddebugkey",
      password: "android",
      keystoreType: "pkcs12",
    };
  }
  await fs.writeFile(path.join(workDir, "build.json"), JSON.stringify(buildJson, null, 2), "utf8");
}

async function compileApkLocally(payload: {
  cordovaZipBase64?: string;
  html?: string;
  projectJson?: string;
  buildType?: "debug" | "release";
  signing?: ApkSigningPayload;
}): Promise<Buffer> {
  const buildType = payload.buildType === "release" || payload.signing?.buildType === "release" ? "release" : "debug";
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "return2d-local-apk-"));
  try {
    if (typeof payload.cordovaZipBase64 === "string" && payload.cordovaZipBase64.length > 0) {
      const zipBuffer = Buffer.from(payload.cordovaZipBase64, "base64");
      const zip = await JSZip.loadAsync(zipBuffer);
      const entries = Object.keys(zip.files);
      for (const relPath of entries) {
        const entry = zip.files[relPath];
        const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
        const destPath = path.join(workDir, safeRel);
        if (!destPath.startsWith(workDir)) continue;
        if (entry.dir) {
          await fs.mkdir(destPath, { recursive: true });
        } else {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          const content = await entry.async("nodebuffer");
          await fs.writeFile(destPath, content);
        }
      }
    } else {
      await fs.mkdir(path.join(workDir, "www"), { recursive: true });
      if (payload.html) {
        await fs.writeFile(path.join(workDir, "www", "index.html"), String(payload.html), "utf8");
      }
      if (payload.projectJson) {
        await fs.writeFile(path.join(workDir, "www", "project.json"), String(payload.projectJson), "utf8");
      }
    }

    await prepareApkWorkspaceSigning(workDir, buildType, payload.signing);

    const hasCordova = await commandExists("cordova");
    if (hasCordova) {
      try {
        await execAsync("cordova platform add android", { cwd: workDir, timeout: 180000 });
      } catch {
        // Ignore if platform directory already exists
      }
      const flag = buildType === "release" ? "--release" : "--debug";
      await execAsync(`cordova build android ${flag} --buildConfig=build.json`, {
        cwd: workDir,
        timeout: 300000,
      });
    } else {
      const androidDir = path.join(workDir, "platforms", "android");
      const task = buildType === "release" ? "assembleRelease" : "assembleDebug";
      await execAsync(`gradle ${task}`, { cwd: androidDir, timeout: 300000 });
    }

    const candidatePaths =
      buildType === "release"
        ? [
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "release", "app-release.apk"),
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "release", "app-release-signed.apk"),
            path.join(workDir, "platforms", "android", "build", "outputs", "apk", "release", "app-release.apk"),
          ]
        : [
            path.join(workDir, "platforms", "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
            path.join(workDir, "platforms", "android", "build", "outputs", "apk", "debug", "app-debug.apk"),
          ];
    for (const candidate of candidatePaths) {
      try {
        const apkBuffer = await fs.readFile(candidate);
        if (apkBuffer.length >= 4 && apkBuffer[0] === 0x50 && apkBuffer[1] === 0x4b) {
          return apkBuffer;
        }
      } catch {
        // check next candidate
      }
    }
    throw new Error(`La compilación finalizó pero no se encontró app-${buildType}.apk.`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "100mb" }));

  // Inspect APK build capabilities (local Android SDK / Cordova or configured default server)
  app.get("/api/apk-server/status", async (_req, res) => {
    const toolchain = await detectLocalAndroidToolchain();
    const defaultServerUrl = normalizeServerUrl(process.env.APK_BUILD_SERVER_URL) || "";
    res.json({
      localSdkAvailable: toolchain.localSdkAvailable,
      tools: toolchain.tools,
      defaultServerUrl,
      hasDefaultServer: Boolean(defaultServerUrl),
    });
  });

  // Test connection to a remote APK build server (or report local toolchain)
  app.post("/api/apk-server/check", async (req, res) => {
    const toolchain = await detectLocalAndroidToolchain();
    const rawUrl = req.body?.serverUrl ?? process.env.APK_BUILD_SERVER_URL;
    const requestedStr = typeof rawUrl === "string" ? rawUrl.trim() : "";

    if (!requestedStr) {
      if (toolchain.localSdkAvailable) {
        return res.json({
          ok: true,
          mode: "local",
          tools: toolchain.tools,
          message: "SDK de Android y Cordova/Gradle detectados localmente en el servidor.",
        });
      }
      return res.json({
        ok: false,
        mode: "none",
        tools: toolchain.tools,
        message: "Sin servidor APK configurado y este contenedor no incluye Android SDK/Cordova.",
      });
    }

    const baseUrl = normalizeServerUrl(requestedStr);
    if (!baseUrl) {
      return res.status(400).json({
        ok: false,
        mode: "invalid",
        message: "URL inválida. Usa un formato válido como http://localhost:4050 o https://tu-servidor-apk.com",
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      let response = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      if (response.status === 404) {
        response = await fetch(baseUrl, {
          method: "GET",
          signal: controller.signal,
        });
      }
      const contentType = response.headers.get("content-type") || "";
      let info: unknown = null;
      if (contentType.includes("application/json")) {
        info = await response.json().catch(() => null);
      } else {
        const text = await response.text().catch(() => "");
        info = text.slice(0, 300);
      }

      if (!response.ok) {
        return res.status(502).json({
          ok: false,
          mode: "offline",
          status: response.status,
          serverUrl: baseUrl,
          info,
          message: `El servidor respondió con estado HTTP ${response.status}.`,
        });
      }

      return res.json({
        ok: true,
        mode: "remote",
        status: response.status,
        serverUrl: baseUrl,
        info,
        message: `Conectado correctamente al servidor de compilación APK (${baseUrl}).`,
      });
    } catch (err: any) {
      return res.status(502).json({
        ok: false,
        mode: "offline",
        serverUrl: baseUrl,
        message: err?.name === "AbortError"
          ? "Tiempo de espera agotado (6s) al conectar con el servidor de compilación APK."
          : `No se pudo conectar con ${baseUrl}: ${err?.message || "Error de red"}`,
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // Download companion self-hosted Node APK compiler microservice
  app.get("/api/apk-server/companion-script", (_req, res) => {
    const script = buildCompanionServerScript();
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="apk-build-server.mjs"');
    res.send(script);
  });

  // Direct debug/release APK compilation via connected remote APK server or local Android SDK
  app.post("/api/build-apk", async (req, res) => {
    const {
      fileName,
      serverUrl,
      appName,
      packageName,
      versionName,
      versionCode,
      buildType: rawBuildType,
      signing,
      cordovaZipBase64,
      html,
      projectJson,
    } = req.body || {};

    const buildType: "debug" | "release" =
      rawBuildType === "release" || signing?.buildType === "release" ? "release" : "debug";
    const safeName = sanitizeSafeName(fileName || appName);
    const targetUrl = normalizeServerUrl(serverUrl) || normalizeServerUrl(process.env.APK_BUILD_SERVER_URL);

    if (targetUrl) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300000);
      try {
        const upstream = await fetch(`${targetUrl}/build-apk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: safeName,
            appName: appName || safeName,
            packageName: packageName || "com.return2d.game",
            versionName: versionName || "1.0.0",
            versionCode: versionCode || 1,
            buildType,
            signing,
            cordovaZipBase64,
            html,
            projectJson,
          }),
          signal: controller.signal,
        });

        if (!upstream.ok) {
          const errText = await upstream.text().catch(() => "");
          let parsedErr: any = null;
          try {
            parsedErr = JSON.parse(errText);
          } catch {}
          return res.status(502).json({
            error: "REMOTE_APK_BUILD_FAILED",
            upstreamStatus: upstream.status,
            message: parsedErr?.message || errText || `El servidor de compilación devolvió HTTP ${upstream.status}.`,
          });
        }

        const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
        const arrayBuf = await upstream.arrayBuffer();
        const apkBuf = Buffer.from(arrayBuf);

        // Validate ZIP/APK container signature ('PK') and reject JSON/HTML error payloads
        if (apkBuf.length < 4 || apkBuf[0] !== 0x50 || apkBuf[1] !== 0x4b) {
          return res.status(502).json({
            error: "INVALID_APK_BINARY",
            message: "El servidor remoto no devolvió un binario .apk válido (firma PK ausente).",
          });
        }
        if (contentType.includes("application/zip") && !contentType.includes("android")) {
          return res.status(502).json({
            error: "ZIP_RETURNED_INSTEAD_OF_APK",
            message: "El servidor remoto devolvió application/zip en lugar de application/vnd.android.package-archive (.apk).",
          });
        }

        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${buildType}.apk"`);
        res.setHeader("Content-Length", String(apkBuf.length));
        res.setHeader("X-APK-Build-Mode", `remote-${buildType}`);
        return res.send(apkBuf);
      } catch (err: any) {
        return res.status(502).json({
          error: "REMOTE_APK_UNREACHABLE",
          message: err?.name === "AbortError"
            ? "La compilación remota excedió el tiempo máximo (5 minutos)."
            : `No se pudo compilar el APK en ${targetUrl}: ${err?.message || "Error de conexión"}`,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    const toolchain = await detectLocalAndroidToolchain();
    if (toolchain.localSdkAvailable) {
      try {
        const apkBuf = await compileApkLocally({
          cordovaZipBase64,
          html,
          projectJson,
          buildType,
          signing,
        });
        res.setHeader("Content-Type", "application/vnd.android.package-archive");
        res.setHeader("Content-Disposition", `attachment; filename="${safeName}-${buildType}.apk"`);
        res.setHeader("Content-Length", String(apkBuf.length));
        res.setHeader("X-APK-Build-Mode", `local-${buildType}`);
        return res.send(apkBuf);
      } catch (err: any) {
        return res.status(500).json({
          error: "LOCAL_APK_BUILD_FAILED",
          message: err?.message || "Error al compilar APK localmente con Cordova/Gradle.",
        });
      }
    }

    return res.status(422).json({
      error: "NO_APK_BUILD_SERVER",
      localSdkAvailable: false,
      tools: toolchain.tools,
      message:
        "No hay un servidor de compilación APK conectado y este entorno no tiene Android SDK / Cordova instalado. Conecta la URL de tu servidor APK (o ejecuta apk-build-server.mjs en tu PC/VPS) para compilar el .apk firmado directamente.",
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
