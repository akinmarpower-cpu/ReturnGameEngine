import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectData } from '../types';
import {
  generateGameHTML,
  compressProjectAssets,
  generateGameZIP,
  generateGameAPKPackage,
  generateWindowsElectronZIP,
  applyExportDimensionFilter,
  getSceneDimension,
  type ExportDimensionMode,
  type ApkSigningConfig,
} from '../services/exportService';
import { useLanguage } from '../LanguageContext';

interface ExportModalProps {
  onClose: () => void;
  projectData?: ProjectData | null;
  initialShowCode?: boolean;
}

const APK_SERVER_URL_STORAGE_KEY = 'return2d_apk_server_url';
const WIN_SERVER_URL_STORAGE_KEY = 'return2d_win_server_url';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el paquete ZIP en base64.'));
    reader.readAsDataURL(blob);
  });
}

export const ExportModal: React.FC<ExportModalProps> = ({ onClose, projectData, initialShowCode = false }) => {
  const { t } = useLanguage();
  const [showCode, setShowCode] = useState(initialShowCode);
  const [viewType, setViewType] = useState<'HTML' | 'JSON'>('HTML');
  const [dimensionMode, setDimensionMode] = useState<ExportDimensionMode>('all');
  const [skipStartScreen, setSkipStartScreen] = useState<boolean>(true);
  const [joystickEnabled, setJoystickEnabled] = useState<boolean>(() => Boolean(projectData?.joystick?.enabled));
  const [exportFileName, setExportFileName] = useState(() => {
    if (projectData && projectData.scenes && projectData.scenes.length > 0) {
      return projectData.scenes[0].name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    }
    return 'mi_juego';
  });

  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState('');
  const [optimizedProjectData, setOptimizedProjectData] = useState<ProjectData | null>(null);
  const [generatedCode, setGeneratedCode] = useState('');

  // APK Build Server connection state
  const [apkServerUrl, setApkServerUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(APK_SERVER_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [apkServerStatus, setApkServerStatus] = useState<'idle' | 'checking' | 'connected' | 'local' | 'standalone' | 'offline' | 'none'>('idle');
  const [apkStatusMessage, setApkStatusMessage] = useState<string>('Inicializando compilador directo APK...');
  const [isBuildingApk, setIsBuildingApk] = useState(false);

  // Android APK Signing State (Debug predeterminado o Firma con Archivos / Keystore / Autogenerada)
  const [apkBuildType, setApkBuildType] = useState<'debug' | 'release'>('debug');
  const [apkPackageName, setApkPackageName] = useState<string>(() => {
    const raw = (projectData?.name || projectData?.scenes?.[0]?.name || 'mijuego').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mijuego';
    return `com.return2d.${raw}`;
  });
  const [apkVersionName, setApkVersionName] = useState<string>('1.0.0');
  const [apkVersionCode, setApkVersionCode] = useState<number>(1);
  const [releaseSigningMode, setReleaseSigningMode] = useState<'files' | 'keystore' | 'generate'>('files');
  const [keystoreFileName, setKeystoreFileName] = useState<string>('release.keystore');
  const [keystoreBase64, setKeystoreBase64] = useState<string>('');
  const [keystoreType, setKeystoreType] = useState<'pkcs12' | 'jks'>('pkcs12');
  const [keystoreAlias, setKeystoreAlias] = useState<string>('releasekey');
  const [storePassword, setStorePassword] = useState<string>('return2d123');
  const [keyPassword, setKeyPassword] = useState<string>('return2d123');
  const [certBase64, setCertBase64] = useState<string>('');
  const [certFileName, setCertFileName] = useState<string>('');
  const [privateKeyBase64, setPrivateKeyBase64] = useState<string>('');
  const [privateKeyFileName, setPrivateKeyFileName] = useState<string>('');
  const [privateKeyPassword, setPrivateKeyPassword] = useState<string>('');
  const [isGeneratingSigningFiles, setIsGeneratingSigningFiles] = useState<boolean>(false);
  const [dnCommonName, setDnCommonName] = useState<string>('Return Game Studio');
  const [dnOrganization, setDnOrganization] = useState<string>('Return Interactive');
  const [dnCountry, setDnCountry] = useState<string>('ES');

  // Windows Electron (.zip & .exe) State
  const [winFullscreen, setWinFullscreen] = useState<boolean>(false);
  const [winVersion, setWinVersion] = useState<string>('1.0.0');
  const [winTarget, setWinTarget] = useState<'portable' | 'nsis'>('portable');
  const [winServerUrl, setWinServerUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(WIN_SERVER_URL_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [winServerStatus, setWinServerStatus] = useState<'idle' | 'checking' | 'local' | 'remote' | 'package-only' | 'offline'>('idle');
  const [winStatusMessage, setWinStatusMessage] = useState<string>('Paquete Windows Electron (.zip con icon.ico, app:// sin CORS y scripts 1-clic para .exe) listo.');
  const [isBuildingWinExe, setIsBuildingWinExe] = useState<boolean>(false);
  const threeVendorCacheRef = useRef<string | null>(null);

  // Non-blocking custom dialog states
  const [customConfirm, setCustomConfirm] = useState<{
    title?: string;
    message: string;
    confirmText: string;
    cancelText: string;
    onConfirm: () => void;
  } | null>(null);

  const [customAlert, setCustomAlert] = useState<{
    title?: string;
    message: string;
  } | null>(null);

  const scenesList = projectData?.scenes || [];
  const scenes2DCount = scenesList.filter(s => getSceneDimension(s) === '2d').length;
  const scenes3DCount = scenesList.filter(s => getSceneDimension(s) === '3d').length;

  const getEffectiveProjectData = useCallback((): ProjectData | null => {
    if (!projectData) return null;
    if (!projectData.joystick) return projectData;
    return {
      ...projectData,
      joystick: {
        ...projectData.joystick,
        enabled: joystickEnabled,
      },
    };
  }, [projectData, joystickEnabled]);

  const checkApkServerConnection = useCallback(async (urlToTest?: string) => {
    const target = (urlToTest ?? apkServerUrl).trim();
    setApkServerStatus('checking');
    setApkStatusMessage('Probando conexión con servidor de compilación APK...');
    try {
      const resp = await fetch('/api/apk-server/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: target || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        if (data.mode === 'local') {
          setApkServerStatus('local');
          setApkStatusMessage(data.message || 'Android SDK y Cordova detectados localmente.');
        } else if (data.mode === 'standalone') {
          setApkServerStatus('standalone');
          setApkStatusMessage(data.message || 'Compilador directo integrado listo (sin servidor externo: firma Debug y Release con archivos).');
        } else {
          setApkServerStatus('connected');
          setApkStatusMessage(data.message || `Conectado al servidor APK (${data.serverUrl || target}).`);
        }
      } else if (data?.mode === 'none') {
        setApkServerStatus('none');
        setApkStatusMessage(data.message || 'Sin servidor APK remoto configurado.');
      } else {
        setApkServerStatus('offline');
        setApkStatusMessage(data?.message || 'No se pudo conectar al servidor remoto opcional.');
      }
    } catch (err: any) {
      setApkServerStatus('offline');
      setApkStatusMessage(`Error al verificar servidor APK: ${err?.message || 'Sin respuesta'}`);
    }
  }, [apkServerUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/apk-server/status');
        if (!res.ok) return;
        const info = await res.json();
        if (cancelled) return;
        if (info.localSdkAvailable) {
          setApkServerStatus('local');
          setApkStatusMessage('Android SDK y Cordova detectados localmente: listo para compilar .apk directo.');
          return;
        }
        const saved = apkServerUrl.trim();
        if (saved) {
          await checkApkServerConnection(saved);
        } else if (info.standaloneReady !== false) {
          setApkServerStatus('standalone');
          setApkStatusMessage('Compilador y firmador APK integrado listo: genera tu .apk firmado directamente sin servidor de compilación.');
        } else {
          setApkServerStatus('none');
          setApkStatusMessage('Conecta la URL de tu servidor APK si deseas compilar remotamente.');
        }
      } catch {
        if (!cancelled) {
          setApkServerStatus('standalone');
          setApkStatusMessage('Listo para exportar .apk firmado en modo integrado.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkWinServerConnection = useCallback(async (urlToTest?: string) => {
    const target = (urlToTest ?? winServerUrl).trim();
    setWinServerStatus('checking');
    setWinStatusMessage('Verificando compilador Windows (.exe)...');
    try {
      const resp = await fetch('/api/win-server/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: target || undefined }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.ok) {
        if (data.mode === 'local') {
          setWinServerStatus('local');
          setWinStatusMessage(data.message || 'Electron-Builder local detectado para compilar .exe directo.');
        } else if (data.mode === 'remote') {
          setWinServerStatus('remote');
          setWinStatusMessage(data.message || `Conectado al servidor Windows (.exe) en ${data.serverUrl || target}.`);
        } else {
          setWinServerStatus('package-only');
          setWinStatusMessage(data.message || 'Paquete Windows Electron (.zip listo para .exe) disponible sin servidor externo.');
        }
      } else {
        setWinServerStatus('offline');
        setWinStatusMessage(data?.message || 'No se pudo conectar al servidor Windows remoto.');
      }
    } catch (err: any) {
      setWinServerStatus('offline');
      setWinStatusMessage(`Error al verificar servidor Windows: ${err?.message || 'Sin respuesta'}`);
    }
  }, [winServerUrl]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/win-server/status');
        if (!res.ok) return;
        const info = await res.json();
        if (cancelled) return;
        if (info.localWinBuilderAvailable) {
          setWinServerStatus('local');
          setWinStatusMessage('Electron-Builder detectado localmente: compila .exe o descarga el .zip Electron.');
          return;
        }
        const saved = winServerUrl.trim();
        if (saved) {
          await checkWinServerConnection(saved);
        } else {
          setWinServerStatus('package-only');
          setWinStatusMessage('Paquete Windows Electron (.zip listo para .exe) listo sin servidor. Incluye icon.ico, Three.js offline y .bat automáticos.');
        }
      } catch {
        if (!cancelled) setWinServerStatus('package-only');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLocalThreeVendorScript = useCallback(async (filtered: ProjectData | null): Promise<string | undefined> => {
    if (!filtered) return undefined;
    const needs3D = Boolean(filtered.scenes?.some(s => getSceneDimension(s) === '3d'));
    if (!needs3D) return undefined;
    if (threeVendorCacheRef.current) return threeVendorCacheRef.current;
    try {
      const resp = await fetch('/api/vendor/three-bundle.js');
      if (resp.ok) {
        const code = await resp.text();
        if (code && code.length > 1000) {
          threeVendorCacheRef.current = code;
          return code;
        }
      }
    } catch {
      // Fallback to CDN importmap if offline vendor bundle fetch fails
    }
    return undefined;
  }, []);

  const getOptimizedData = async (): Promise<ProjectData | null> => {
    const baseData = getEffectiveProjectData();
    if (!baseData) return null;
    if (optimizedProjectData) {
      return {
        ...optimizedProjectData,
        joystick: baseData.joystick,
      };
    }

    setIsOptimizing(true);
    setOptimizationProgress('Iniciando optimizador de recursos...');
    try {
      const optimized = await compressProjectAssets(baseData, (msg) => {
        setOptimizationProgress(msg);
      });
      setOptimizedProjectData(optimized);
      return optimized;
    } catch (err) {
      console.error('Asset optimization failed:', err);
      return baseData;
    } finally {
      setIsOptimizing(false);
    }
  };

  useEffect(() => {
    if (initialShowCode && projectData) {
      getOptimizedData().then((optimized) => {
        if (optimized) {
          setGeneratedCode(generateGameHTML(optimized, skipStartScreen, { dimensionMode, skipStartScreen }));
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShowCode, projectData, dimensionMode, skipStartScreen]);

  const triggerStandardDownload = (content: string | Blob, filename: string, mimeType: string, closeModal = true) => {
      const blob = (typeof content !== 'string') ? content : new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      }, 100);
      if (closeModal) onClose();
  };

  const handleExport = async (platform: string) => {
      let extension = '.html';
      let mimeType = 'text/html';
      let content: string | Blob = '';

      if (platform === 'HTML5') {
          const dataToUse = await getOptimizedData();
          content = generateGameHTML(dataToUse, skipStartScreen, { dimensionMode, skipStartScreen });
          if (!content) {
              setCustomAlert({
                  title: 'Sin Datos',
                  message: t('export.noData') || 'No hay datos del proyecto'
              });
              return;
          }
          extension = '.html';
          mimeType = 'text/html';
      } else if (platform === 'JSON') {
          const baseData = getEffectiveProjectData();
          if (!baseData) return;
          const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
          content = JSON.stringify(filtered, null, 2);
          extension = '.json';
          mimeType = 'application/json';
      }

      const baseName = exportFileName.trim() || 'juego';
      const finalFilename = baseName.toLowerCase().endsWith(extension) ? baseName : baseName + extension;

      if ('showSaveFilePicker' in window) {
          try {
              const handle = await (window as any).showSaveFilePicker({
                  suggestedName: finalFilename,
                  types: [{
                      description: platform === 'JSON' ? 'JSON Project File' : 'HTML5 Game File',
                      accept: { [mimeType]: [extension] },
                  }],
              });
              const writable = await handle.createWritable();
              const blobContent = (typeof content !== 'string') ? content : new Blob([content], { type: mimeType });
              await writable.write(blobContent);
              await writable.close();
              onClose();
              return;
          } catch (err) {
              if ((err as Error).name === 'AbortError') return;
              console.warn('File System Access API failed or blocked, explaining iframe constraints:', err);

              setCustomConfirm({
                  title: 'Selector bloqueado',
                  message: `⚠️ El navegador bloquea el Gestor de Archivos dentro del visor de diseño por seguridad.\n\nPara poder elegir la carpeta exacta en tu PC:\n1. Abre la app en pestaña nueva (botón superior derecho de la pantalla).\n2. Pulsa "Exportar" allí.\n\n¿Quieres guardarlo en "Descargas" automáticamente por ahora?`,
                  confirmText: 'Sí, Guardar',
                  cancelText: 'Cancelar',
                  onConfirm: () => triggerStandardDownload(content, finalFilename, mimeType)
              });
              return;
          }
      } else {
          setCustomConfirm({
              title: 'Selector no soportado',
              message: `⚠️ Tu navegador actual o visor interno no soporta la selección de carpeta directa.\n\n¿Quieres descargar el archivo directamente a tu carpeta de Descargas?`,
              confirmText: 'Descargar',
              cancelText: 'Cancelar',
              onConfirm: () => triggerStandardDownload(content, finalFilename, mimeType)
          });
          return;
      }
  };

  const handleExportBoth = async () => {
      const dataToUse = await getOptimizedData();
      const htmlContent = generateGameHTML(dataToUse, skipStartScreen, { dimensionMode, skipStartScreen });
      if (!htmlContent) {
          setCustomAlert({
              title: 'Sin Datos',
              message: t('export.noData') || 'No hay datos del proyecto'
          });
          return;
      }
      const baseData = getEffectiveProjectData();
      const jsonContent = baseData ? JSON.stringify(applyExportDimensionFilter(baseData, { dimensionMode }), null, 2) : '';

      const baseName = exportFileName.trim() || 'juego';
      const htmlFilename = baseName.toLowerCase().endsWith('.html') ? baseName : baseName + '.html';
      const jsonFilename = baseName.toLowerCase().endsWith('.json') ? baseName : baseName + '.json';

      const triggerBothDownloadsFallback = () => {
          const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
          const htmlUrl = URL.createObjectURL(htmlBlob);
          const aHtml = document.createElement('a');
          aHtml.href = htmlUrl;
          aHtml.download = htmlFilename;
          document.body.appendChild(aHtml);
          aHtml.click();

          setTimeout(() => {
              document.body.removeChild(aHtml);
              URL.revokeObjectURL(htmlUrl);

              if (jsonContent) {
                  const jsonBlob = new Blob([jsonContent], { type: 'application/json' });
                  const jsonUrl = URL.createObjectURL(jsonBlob);
                  const aJson = document.createElement('a');
                  aJson.href = jsonUrl;
                  aJson.download = jsonFilename;
                  document.body.appendChild(aJson);
                  aJson.click();

                  setTimeout(() => {
                      document.body.removeChild(aJson);
                      URL.revokeObjectURL(jsonUrl);
                  }, 100);
              }
          }, 150);
          onClose();
      };

      if ('showDirectoryPicker' in window) {
          try {
              const dirHandle = await (window as any).showDirectoryPicker({
                  mode: 'readwrite'
              });

              const htmlFileHandle = await dirHandle.getFileHandle(htmlFilename, { create: true });
              const htmlWritable = await htmlFileHandle.createWritable();
              await htmlWritable.write(new Blob([htmlContent], { type: 'text/html' }));
              await htmlWritable.close();

              if (jsonContent) {
                  const jsonFileHandle = await dirHandle.getFileHandle(jsonFilename, { create: true });
                  const jsonWritable = await jsonFileHandle.createWritable();
                  await jsonWritable.write(new Blob([jsonContent], { type: 'application/json' }));
                  await jsonWritable.close();
              }

              setCustomAlert({
                  title: '¡Guardado con éxito!',
                  message: '¡Los archivos HTML5 y JSON se han guardado correctamente en la carpeta que has seleccionado!'
              });
              onClose();
              return;
          } catch (err) {
              if ((err as Error).name === 'AbortError') return;
              console.warn('Directory Picker API failed or blocked, explaining iframe constraints:', err);

              setCustomConfirm({
                  title: 'Selector de carpeta bloqueado',
                  message: `⚠️ El navegador bloquea el selector de carpetas dentro del visor integrado por seguridad.\n\nPara poder elegir una carpeta exacta de tu PC:\n1. Abre la app en pestaña nueva (botón superior derecho de la pantalla).\n2. Pulsa "Exportar" -> "Guardar Ambos en Carpeta" allí.\n\n¿Quieres descargar ambos archivos automáticamente en tu carpeta "Descargas" por ahora?`,
                  confirmText: 'Sí, Guardar',
                  cancelText: 'Cancelar',
                  onConfirm: triggerBothDownloadsFallback
              });
              return;
          }
      } else {
          setCustomConfirm({
              title: 'Selector de carpeta no soportado',
              message: `⚠️ Tu navegador actual o visor interno no soporta la selección de carpeta directa.\n\n¿Quieres descargar ambos archivos automáticamente en tu carpeta de Descargas?`,
              confirmText: 'Descargar',
              cancelText: 'Cancelar',
              onConfirm: triggerBothDownloadsFallback
          });
          return;
      }
  };

  const handleExportZip = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      setIsOptimizing(true);
      setOptimizationProgress('Iniciando empaquetado del paquete ZIP optimizado...');
      try {
          const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
          const threeVendorScript = await fetchLocalThreeVendorScript(filtered);
          const zipBlob = await generateGameZIP(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, { dimensionMode, skipStartScreen, useLocalThreeVendor: Boolean(threeVendorScript), threeVendorScript });
          const baseName = exportFileName.trim() || 'mi_juego';
          const finalFilename = baseName.toLowerCase().endsWith('.zip') ? baseName : `${baseName}.zip`;

          triggerStandardDownload(zipBlob, finalFilename, 'application/zip');
      } catch (err) {
          console.error('Error al exportar ZIP:', err);
          setCustomAlert({
              title: 'Error de Exportación ZIP',
              message: 'Ocurrió un fallo al empaquetar los archivos multimedia en el archivo ZIP. Inténtalo nuevamente.'
          });
      } finally {
          setIsOptimizing(false);
      }
  };

  const readFileAsBase64 = (file: File, onDone: (base64: string, cleanName: string) => void) => {
      const reader = new FileReader();
      reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = result.indexOf(',');
          const b64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
          onDone(b64, file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'file');
      };
      reader.readAsDataURL(file);
  };

  const handleKeystoreFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsBase64(file, (b64, cleanName) => {
          setKeystoreBase64(b64);
          setKeystoreFileName(cleanName || 'release.keystore');
          setReleaseSigningMode('keystore');
      });
  };

  const handleCertFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsBase64(file, (b64, cleanName) => {
          setCertBase64(b64);
          setCertFileName(cleanName || 'certificado.pem');
          setReleaseSigningMode('files');
      });
  };

  const handlePrivateKeyFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      readFileAsBase64(file, (b64, cleanName) => {
          setPrivateKeyBase64(b64);
          setPrivateKeyFileName(cleanName || 'clave_privada.key');
          setReleaseSigningMode('files');
      });
  };

  const handleGenerateAndDownloadSigningFiles = async () => {
      setIsGeneratingSigningFiles(true);
      try {
          const resp = await fetch('/api/apk/generate-signing-files', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  commonName: dnCommonName.trim() || 'Return Game Studio',
                  organization: dnOrganization.trim() || 'Return Interactive',
                  country: (dnCountry.trim() || 'ES').slice(0, 2).toUpperCase(),
                  alias: keystoreAlias.trim() || 'releasekey',
                  storePassword: storePassword.trim() || 'return2d123',
              }),
          });
          const data = await resp.json();
          if (!resp.ok || !data?.ok) {
              throw new Error(data?.message || 'Error al generar certificado y clave.');
          }
          const certB64 = btoa(unescape(encodeURIComponent(data.certPem)));
          const keyB64 = btoa(unescape(encodeURIComponent(data.keyPem)));
          setCertBase64(certB64);
          setCertFileName('release-cert.pem');
          setPrivateKeyBase64(keyB64);
          setPrivateKeyFileName('release-key.pem');
          setPrivateKeyPassword('');
          if (data.keystoreP12Base64) {
              setKeystoreBase64(data.keystoreP12Base64);
              setKeystoreFileName('release.keystore');
          }
          // Download .pem certificate & .key private key so user keeps their signing identity
          triggerStandardDownload(data.certPem, 'release-cert.pem', 'application/x-pem-file', false);
          setTimeout(() => {
              triggerStandardDownload(data.keyPem, 'release-key.pem', 'application/x-pem-file', false);
          }, 150);
          setReleaseSigningMode('files');
          setCustomAlert({
              title: 'Certificado y Clave Generados',
              message: `Se han generado y cargado en el editor tus archivos de firma Release:\n\n• release-cert.pem\n• release-key.pem\n• Huella SHA-256: ${data.sha256Fingerprint}\n\nGuarda ambos archivos en un lugar seguro para futuras actualizaciones.`,
          });
      } catch (err: any) {
          setCustomAlert({
              title: 'Error generando firma',
              message: err?.message || 'No se pudieron generar los archivos de firma.',
          });
      } finally {
          setIsGeneratingSigningFiles(false);
      }
  };

  const buildSigningConfig = useCallback((): ApkSigningConfig => {
      const cleanPkg = apkPackageName.trim().replace(/[^a-zA-Z0-9_.]/g, '') || 'com.return2d.game';
      const activeMode: ApkSigningConfig['signingMode'] =
          apkBuildType === 'debug' ? 'debug' : releaseSigningMode;
      return {
          buildType: apkBuildType,
          signingMode: activeMode,
          packageName: cleanPkg.includes('.') ? cleanPkg : `com.return2d.${cleanPkg}`,
          versionName: apkVersionName.trim() || '1.0.0',
          versionCode: Math.max(1, Number(apkVersionCode) || 1),
          appName: projectData?.scenes?.[0]?.name || exportFileName.trim() || 'Return Game',
          keystoreBase64: apkBuildType === 'release' && releaseSigningMode === 'keystore' ? keystoreBase64 : undefined,
          keystoreFileName: keystoreFileName.trim() || 'release.keystore',
          storePassword: storePassword.trim() || 'return2d123',
          alias: keystoreAlias.trim() || 'releasekey',
          keyPassword: keyPassword.trim() || storePassword.trim() || 'return2d123',
          keystoreType,
          generateKeystore: apkBuildType === 'release' && releaseSigningMode === 'generate',
          certBase64: apkBuildType === 'release' && releaseSigningMode === 'files' ? certBase64 : undefined,
          certFileName: certFileName.trim() || 'release-cert.pem',
          privateKeyBase64: apkBuildType === 'release' && releaseSigningMode === 'files' ? privateKeyBase64 : undefined,
          privateKeyFileName: privateKeyFileName.trim() || 'release-key.pem',
          privateKeyPassword: privateKeyPassword || undefined,
          distinguishedName: {
              commonName: dnCommonName.trim() || 'Return Game',
              organization: dnOrganization.trim() || 'Return Studio',
              country: (dnCountry.trim() || 'ES').slice(0, 2).toUpperCase(),
          },
      };
  }, [
      apkBuildType,
      apkPackageName,
      apkVersionName,
      apkVersionCode,
      projectData,
      exportFileName,
      releaseSigningMode,
      keystoreBase64,
      keystoreFileName,
      storePassword,
      keystoreAlias,
      keyPassword,
      keystoreType,
      certBase64,
      certFileName,
      privateKeyBase64,
      privateKeyFileName,
      privateKeyPassword,
      dnCommonName,
      dnOrganization,
      dnCountry,
  ]);

  const validateApkSigning = (): string | null => {
      const pkg = apkPackageName.trim();
      if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg)) {
          return 'El Package ID de Android debe tener formato de paquete válido (ej. com.tunombre.mijuego).';
      }
      if (apkBuildType === 'release') {
          if (releaseSigningMode === 'files') {
              if (!certBase64) {
                  return 'Selecciona tu archivo de certificado (.pem, .crt, .cer o .der) o pulsa "Autogenerar y Descargar".';
              }
              if (!privateKeyBase64) {
                  return 'Selecciona tu archivo de clave privada (.pem, .key o .pk8) para firmar el APK.';
              }
          } else if (releaseSigningMode === 'keystore') {
              if (!keystoreBase64) {
                  return 'Sube tu archivo .keystore / .p12 o cambia a "Firmar con Archivos".';
              }
              if (!storePassword.trim()) {
                  return 'Indica la contraseña (Store Password) del archivo .keystore / .p12.';
              }
          } else if (releaseSigningMode === 'generate') {
              if (!dnCommonName.trim()) {
                  return 'Indica un Nombre / Autor (CN) para generar el certificado Release.';
              }
          }
      }
      return null;
  };

  const handleCompileDirectAPK = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      const validationErr = validateApkSigning();
      if (validationErr) {
          setCustomAlert({ title: 'Configuración de Firma APK', message: validationErr });
          return;
      }
      const signing = buildSigningConfig();
      const suffix = signing.buildType === 'release' ? 'release' : 'debug';
      const isStandaloneFastPath = (apkServerStatus === 'standalone' || apkServerStatus === 'none' || apkServerStatus === 'idle') && !apkServerUrl.trim();

      setIsBuildingApk(true);
      setIsOptimizing(true);
      setOptimizationProgress(`Optimizando assets y compilando APK ${suffix.toUpperCase()} firmado (${signing.signingMode === 'debug' ? 'Debug predeterminado' : signing.signingMode === 'files' ? 'con archivos' : signing.signingMode === 'keystore' ? 'con Keystore' : 'Release autogenerado'})...`);
      try {
          const baseName = exportFileName.trim() || 'mi_juego_2d';
          const filteredData = applyExportDimensionFilter(baseData, { dimensionMode });
          const threeVendorScript = await fetchLocalThreeVendorScript(filteredData);
          const cordovaZipBlob = await generateGameAPKPackage(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, {
              dimensionMode,
              signing,
              wwwOnly: isStandaloneFastPath,
              useLocalThreeVendor: Boolean(threeVendorScript),
              threeVendorScript,
          });
          setOptimizationProgress(`Generando APK binario firmado (${suffix.toUpperCase()}) con firma JAR v1 + APK v2...`);
          const cordovaZipBase64 = await blobToBase64(cordovaZipBlob);

          const response = await fetch('/api/build-apk', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  fileName: baseName,
                  serverUrl: apkServerUrl.trim() || undefined,
                  appName: signing.appName,
                  packageName: signing.packageName,
                  versionName: signing.versionName,
                  versionCode: signing.versionCode,
                  buildType: signing.buildType,
                  signing,
                  cordovaZipBase64,
              }),
          });

          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              setCustomAlert({
                  title: `Error al Compilar APK ${suffix.toUpperCase()}`,
                  message: errData?.message || `El compilador devolvió estado HTTP ${response.status}.`,
              });
              return;
          }

          const apkBlob = await response.blob();
          const finalApkFilename = baseName.toLowerCase().endsWith('.apk') ? baseName : `${baseName}-${suffix}.apk`;
          triggerStandardDownload(apkBlob, finalApkFilename, 'application/vnd.android.package-archive');
      } catch (err: any) {
          console.error('Error compilando APK directo:', err);
          setCustomAlert({
              title: 'Error de Compilación APK',
              message: err?.message || 'No se pudo completar la compilación del archivo .apk.',
          });
      } finally {
          setIsBuildingApk(false);
          setIsOptimizing(false);
      }
  };

  const handleExportAPKSourceZip = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      const validationErr = validateApkSigning();
      if (validationErr) {
          setCustomAlert({ title: 'Configuración de Firma Keystore', message: validationErr });
          return;
      }
      const signing = buildSigningConfig();
      setIsOptimizing(true);
      setOptimizationProgress(`Empaquetando proyecto Cordova APK (${signing.buildType?.toUpperCase()}) con Keystore y build.json...`);
      try {
          const filteredData = applyExportDimensionFilter(baseData, { dimensionMode });
          const threeVendorScript = await fetchLocalThreeVendorScript(filteredData);
          const zipBlob = await generateGameAPKPackage(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, {
              dimensionMode,
              signing,
              useLocalThreeVendor: Boolean(threeVendorScript),
              threeVendorScript,
          });
          const baseName = exportFileName.trim() || 'mi_juego_2d';
          const finalFilename = baseName.toLowerCase().endsWith('.zip') ? baseName : `${baseName}_apk_cordova_${signing.buildType || 'debug'}.zip`;

          triggerStandardDownload(zipBlob, finalFilename, 'application/zip');
      } catch (err) {
          console.error('Error al exportar fuente APK ZIP:', err);
          setCustomAlert({
              title: 'Error de Exportación',
              message: 'Ocurrió un fallo al empaquetar los archivos fuente Cordova.'
          });
      } finally {
          setIsOptimizing(false);
      }
  };

  const handleExportWindowsZip = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      setIsBuildingWinExe(false);
      setIsOptimizing(true);
      setOptimizationProgress('Empaquetando juego Windows Electron (.zip listo para .exe)...');
      try {
          const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
          const threeVendorScript = await fetchLocalThreeVendorScript(filtered);
          const appName = baseData.name || baseData.scenes?.[0]?.name || exportFileName.trim() || 'Return Game';
          const zipBlob = await generateWindowsElectronZIP(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, {
              dimensionMode,
              skipStartScreen,
              useLocalThreeVendor: Boolean(threeVendorScript),
              threeVendorScript,
              windowsConfig: {
                  appName,
                  version: winVersion.trim() || '1.0.0',
                  fullscreen: winFullscreen,
                  resizable: true,
                  width: baseData.gameWidth || 1280,
                  height: baseData.gameHeight || 720,
              },
          });
          const baseName = exportFileName.trim() || 'mi_juego';
          const finalFilename = `${baseName}_windows_electron.zip`;
          triggerStandardDownload(zipBlob, finalFilename, 'application/zip');
      } catch (err) {
          console.error('Error al exportar Windows Electron ZIP:', err);
          setCustomAlert({
              title: 'Error de Exportación Windows',
              message: 'No se pudo generar el paquete Windows Electron (.zip). Inténtalo nuevamente.',
          });
      } finally {
          setIsOptimizing(false);
      }
  };

  const handleCompileDirectWinExe = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      setIsBuildingWinExe(true);
      setIsOptimizing(true);
      setOptimizationProgress('Generando paquete Electron y compilando ejecutable Windows (.exe)...');
      try {
          const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
          const threeVendorScript = await fetchLocalThreeVendorScript(filtered);
          const appName = baseData.name || baseData.scenes?.[0]?.name || exportFileName.trim() || 'Return Game';
          const zipBlob = await generateWindowsElectronZIP(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, {
              dimensionMode,
              skipStartScreen,
              useLocalThreeVendor: Boolean(threeVendorScript),
              threeVendorScript,
              windowsConfig: {
                  appName,
                  version: winVersion.trim() || '1.0.0',
                  fullscreen: winFullscreen,
                  resizable: true,
                  width: baseData.gameWidth || 1280,
                  height: baseData.gameHeight || 720,
              },
          });
          const electronZipBase64 = await blobToBase64(zipBlob);
          const baseName = exportFileName.trim() || 'mi_juego';
          setOptimizationProgress(`Compilando binario Windows ${winTarget === 'nsis' ? 'Instalador Setup' : 'Portable'} (.exe)...`);

          const response = await fetch('/api/build-win-exe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  fileName: baseName,
                  target: winTarget,
                  serverUrl: winServerUrl.trim() || undefined,
                  electronZipBase64,
              }),
          });

          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              setCustomConfirm({
                  title: 'Compilación Directa .EXE No Disponible Aquí',
                  message: `${errData?.message || 'Este servidor no tiene Electron-Builder para compilar .exe directo.'}\n\n¿Quieres descargar ahora el paquete Windows Electron (.zip) ya compilado con icon.ico, Three.js offline y COMPILAR_ELECTRON_EXE.bat de 1 clic?`,
                  confirmText: 'Descargar .ZIP Electron',
                  cancelText: 'Cerrar',
                  onConfirm: () => {
                      triggerStandardDownload(zipBlob, `${baseName}_windows_electron.zip`, 'application/zip');
                  },
              });
              return;
          }

          const exeBlob = await response.blob();
          triggerStandardDownload(exeBlob, `${baseName}-${winTarget}.exe`, 'application/vnd.microsoft.portable-executable');
      } catch (err: any) {
          console.error('Error compilando Windows .exe directo:', err);
          setCustomAlert({
              title: 'Error de Compilación .EXE',
              message: err?.message || 'No se pudo completar la compilación del ejecutable Windows.',
          });
      } finally {
          setIsBuildingWinExe(false);
          setIsOptimizing(false);
      }
  };

  const handleCopyUrl = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
      const content = JSON.stringify(filtered, null, 2);
      const mimeType = 'application/json';

      try {
          const base64Data = btoa(unescape(encodeURIComponent(content)));
          const dataUrl = `data:${mimeType};charset=utf-8;base64,${base64Data}`;

          await navigator.clipboard.writeText(dataUrl);

          setCustomAlert({
              title: '¡URL Copiada al Portapapeles!',
              message: `Se ha copiado la URL Data del JSON.\n\nPuedes pegarla directamente en la barra de direcciones de tu navegador.`
          });
      } catch (err) {
          console.error('Error copying URL:', err);
          setCustomAlert({
              title: 'Error al Copiar URL',
              message: 'No se pudo copiar la URL al portapapeles.'
          });
      }
  };

  const handleViewJsonCode = () => {
    const baseData = getEffectiveProjectData();
    if (!baseData) return;
    const filtered = applyExportDimensionFilter(baseData, { dimensionMode });
    setGeneratedCode(JSON.stringify(filtered, null, 2));
    setViewType('JSON');
    setShowCode(true);
  };

  const handleApkServerUrlChange = (val: string) => {
    setApkServerUrl(val);
    try {
      localStorage.setItem(APK_SERVER_URL_STORAGE_KEY, val);
    } catch {
      // ignore storage quota issues
    }
  };

  const handleWinServerUrlChange = (val: string) => {
    setWinServerUrl(val);
    try {
      localStorage.setItem(WIN_SERVER_URL_STORAGE_KEY, val);
    } catch {
      // ignore storage quota issues
    }
  };

  const ExportOption: React.FC<{
    title: string;
    description: string;
    icon: React.ReactNode;
    onExport: () => void;
    exportLabel?: string;
    onViewCode?: () => void;
    viewCodeLabel?: string;
    onCopyUrl?: () => void;
    copyUrlLabel?: string;
  }> = ({ title, description, icon, onExport, exportLabel, onViewCode, viewCodeLabel, onCopyUrl, copyUrlLabel }) => {
    return (
        <div className="p-4 rounded-xl flex flex-col md:flex-row md:items-center gap-4 transition-all bg-gray-900/50 border border-gray-700/50 hover:border-indigo-500/30">
            <div className="flex items-center gap-4 flex-grow">
                <div className="p-3 rounded-lg bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shrink-0">
                    {icon}
                </div>
                <div>
                    <h4 className="font-bold text-white tracking-tight">
                        {title}
                    </h4>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{description}</p>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end mt-2 md:mt-0">
                {onCopyUrl && (
                    <button
                        onClick={onCopyUrl}
                        className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-emerald-500/30 flex items-center gap-1.5"
                    >
                        <span>🔗</span> {copyUrlLabel || 'Copiar URL'}
                    </button>
                )}
                {onViewCode && (
                    <button
                        onClick={onViewCode}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-gray-700"
                    >
                        {viewCodeLabel || 'Ver Código'}
                    </button>
                )}
                <button
                    onClick={onExport}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all shadow-lg hover:shadow-indigo-600/20"
                >
                    {exportLabel || 'Exportar'}
                </button>
            </div>
        </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[#18181b] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col border border-gray-800 max-h-[90vh] relative overflow-hidden" onClick={e => e.stopPropagation()}>
        {isOptimizing && (
          <div className="absolute inset-0 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center z-50 p-6 text-center">
            <div className="relative flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-full border-4 border-indigo-500/20 border-t-indigo-500 animate-spin"></div>
              <div className="absolute w-10 h-10 rounded-full border-4 border-emerald-500/20 border-b-emerald-500 animate-spin [animation-direction:reverse]"></div>
            </div>
            <h3 className="text-lg font-black text-white uppercase tracking-wider mb-2">
              {isBuildingApk
                ? `Compilando Android APK ${apkBuildType === 'release' ? 'Release Firmado' : 'Debug'} (.apk)`
                : isBuildingWinExe
                  ? 'Compilando Windows Electron (.exe)'
                  : 'Comprimiendo y Optimizando Recursos'}
            </h3>
            <p className="text-xs text-gray-400 font-mono max-w-md bg-gray-900/50 px-4 py-3 rounded-lg border border-gray-800">
              {optimizationProgress}
            </p>
            <span className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-sm">
              {isBuildingApk
                ? `Generando y firmando el binario Android .apk directamente (JAR v1 + APK v2, modo ${apkBuildType}).`
                : isBuildingWinExe
                  ? 'Empaquetando aplicación Electron con protocolo app://, icon.ico y Three.js offline para Windows x64.'
                  : 'Reduciendo imágenes, minificando scripts y empaquetando assets para carga ultra rápida.'}
            </span>
          </div>
        )}
        <header className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
          <h2 className="text-lg font-black tracking-tight uppercase text-white">
            {showCode ? (viewType === 'HTML' ? t('export.codeTitle') : 'Código de Datos JSON') : t('export.title')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl font-bold leading-none select-none transition-colors">&times;</button>
        </header>

        <main className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
            {showCode ? (
                <div className="space-y-4">
                    <div className="flex justify-between items-center bg-gray-900/30 p-3 rounded-lg border border-gray-800">
                        <p className="text-gray-400 text-xs leading-relaxed">
                            {viewType === 'HTML' ? t('export.codeDescription') : 'Aquí tienes los parámetros de configuración JSON de tu proyecto:'}
                        </p>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(generatedCode);
                                setCustomAlert({
                                    title: '¡Copiado con éxito!',
                                    message: t('export.codeCopied') || 'El código se ha copiado al portapapeles.'
                                });
                            }}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md transition-colors shadow-sm shrink-0 ml-4"
                        >
                            {t('export.copyCode') || 'Copiar'}
                        </button>
                    </div>
                    <pre className="bg-black/40 p-4 rounded-xl overflow-x-auto text-xs font-mono text-indigo-300 border border-gray-800 max-h-[45vh] custom-scrollbar selection:bg-indigo-500/30 selection:text-white">
                        {generatedCode}
                    </pre>
                    <button
                        onClick={() => setShowCode(false)}
                        className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                        {t('export.backToOptions') || 'Volver'}
                    </button>
                </div>
            ) : (
                <>
                    {/* Filename configure inline */}
                    <div className="bg-gray-900/30 p-4 rounded-xl border border-gray-800 space-y-2">
                        <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
                            Nombre del Archivo de Destino
                        </label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="text"
                                value={exportFileName}
                                onChange={(e) => setExportFileName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_'))}
                                placeholder="mi_juego"
                                className="bg-[#0c0c0e] border border-gray-800 hover:border-gray-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none w-full transition-all font-mono"
                            />
                            <span className="text-xs font-mono text-gray-500 bg-[#0c0c0e] px-2 py-2 rounded-lg border border-gray-800 select-none shrink-0">
                                .html / .apk
                            </span>
                        </div>
                        <span className="text-[10px] text-gray-500 block leading-relaxed">
                            Introduce el nombre del instalador o archivo exportado sin extensión (solo letras, números y guiones).
                        </span>
                    </div>

                    {/* Dimension / Scene Filter Selector: All vs 2D vs 3D */}
                    <div className="bg-gray-900/30 p-4 rounded-xl border border-gray-800 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
                                Escenas / Dimensión a Exportar
                            </label>
                            <span className="text-[10px] text-gray-400 font-mono">
                                {scenes2DCount} 2D · {scenes3DCount} 3D
                            </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                type="button"
                                data-testid="export-dim-all"
                                onClick={() => setDimensionMode('all')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all text-center ${
                                    dimensionMode === 'all'
                                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-md'
                                        : 'bg-[#0c0c0e] border-gray-800 text-gray-300 hover:border-gray-700'
                                }`}
                            >
                                Todas ({scenesList.length})
                            </button>
                            <button
                                type="button"
                                data-testid="export-dim-2d"
                                onClick={() => setDimensionMode('2d')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all text-center ${
                                    dimensionMode === '2d'
                                        ? 'bg-cyan-600 border-cyan-500 text-white shadow-md'
                                        : 'bg-[#0c0c0e] border-gray-800 text-gray-300 hover:border-gray-700'
                                }`}
                            >
                                Escenas 2D ({scenes2DCount})
                            </button>
                            <button
                                type="button"
                                data-testid="export-dim-3d"
                                onClick={() => setDimensionMode('3d')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all text-center ${
                                    dimensionMode === '3d'
                                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                                        : 'bg-[#0c0c0e] border-gray-800 text-gray-300 hover:border-gray-700'
                                }`}
                            >
                                Escenas 3D ({scenes3DCount})
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed">
                            {dimensionMode === 'all' && 'Incluye todas las escenas (2D en Canvas y 3D en WebGL Three.js) compartiendo variables globales.'}
                            {dimensionMode === '2d' && (scenes2DCount > 0
                                ? `Exportará únicamente las ${scenes2DCount} escena(s) 2D con motor Canvas 2D ligero.`
                                : 'No hay escenas marcadas como 2D: forzará la exportación en modo 2D Canvas.')}
                            {dimensionMode === '3d' && (scenes3DCount > 0
                                ? `Exportará únicamente las ${scenes3DCount} escena(s) 3D con runtime WebGL Three.js completo.`
                                : 'No hay escenas marcadas como 3D: forzará la exportación con motor WebGL 3D.')}
                        </p>
                    </div>

                    {/* Direct launch without engine start screen */}
                    <div className="bg-gray-900/30 p-4 rounded-xl border border-gray-800 flex items-center justify-between gap-4">
                        <div>
                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest block">
                                Inicio Directo en HTML y ZIP
                            </span>
                            <span className="text-xs text-gray-400 mt-0.5 leading-relaxed block">
                                {skipStartScreen
                                  ? 'Exporta el juego directamente sin la pantalla previa del motor.'
                                  : 'Mostrará una pantalla inicial de "JUGAR" antes de arrancar el juego.'}
                            </span>
                        </div>
                        <button
                            type="button"
                            data-testid="export-skip-startscreen-toggle"
                            onClick={() => setSkipStartScreen((prev) => !prev)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all border shrink-0 ${
                                skipStartScreen
                                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md hover:bg-emerald-500'
                                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                            }`}
                        >
                            {skipStartScreen ? 'Sin Pantalla (Directo)' : 'Con Pantalla'}
                        </button>
                    </div>

                    {/* Joystick option */}
                    {projectData?.joystick && (
                        <div className="bg-gray-900/30 p-4 rounded-xl border border-gray-800 flex items-center justify-between">
                            <div>
                                <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest block">
                                    Control Joystick Táctil
                                </span>
                                <span className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                                    Habilitar joystick virtual en pantallas táctiles o móviles
                                </span>
                            </div>
                            <button
                                onClick={() => {
                                    if (projectData.joystick) {
                                        const nextVal = !joystickEnabled;
                                        projectData.joystick.enabled = nextVal;
                                        setJoystickEnabled(nextVal);
                                    }
                                }}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all border ${
                                    joystickEnabled
                                        ? 'bg-indigo-600 border-indigo-500 text-white shadow-md hover:bg-indigo-500'
                                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                                }`}
                            >
                                {joystickEnabled ? 'Habilitado' : 'Deshabilitado'}
                            </button>
                        </div>
                    )}

                    {/* Direct Signed APK Section (No External Compile Server Required) */}
                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/35 to-gray-900/60 border border-indigo-500/30 space-y-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h4 className="font-bold text-white tracking-tight text-sm flex items-center gap-2">
                                    <span>📱</span> Exportar APK Firmado (.apk directo sin servidor)
                                </h4>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    Genera tu binario <code className="text-indigo-300">.apk</code> firmado (JAR v1 + APK v2) al instante en modo <strong className="text-gray-200">Debug Predeterminado</strong> o <strong className="text-emerald-300">Firmado con Archivos / Keystore</strong>.
                                </p>
                            </div>
                            <span
                                data-testid="apk-server-badge"
                                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${
                                    apkServerStatus === 'connected' || apkServerStatus === 'local' || apkServerStatus === 'standalone'
                                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                        : apkServerStatus === 'checking'
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                            : apkServerStatus === 'offline'
                                                ? 'bg-red-500/15 border-red-500/40 text-red-300'
                                                : 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                }`}
                            >
                                {apkServerStatus === 'connected' && 'Servidor Conectado'}
                                {apkServerStatus === 'local' && 'SDK Local Listo'}
                                {apkServerStatus === 'standalone' && 'Sin Servidor · Listo'}
                                {apkServerStatus === 'checking' && 'Verificando...'}
                                {apkServerStatus === 'offline' && 'Remoto Sin Conexión'}
                                {(apkServerStatus === 'none' || apkServerStatus === 'idle') && 'Sin Servidor · Listo'}
                            </span>
                        </div>

                        {/* Build Type Toggle & Package Metadata */}
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                data-testid="apk-buildtype-debug"
                                onClick={() => setApkBuildType('debug')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                                    apkBuildType === 'debug'
                                        ? 'bg-indigo-600 border-indigo-500 text-white'
                                        : 'bg-[#0c0c0e] border-gray-800 text-gray-300 hover:border-gray-700'
                                }`}
                            >
                                Debug Predeterminado
                            </button>
                            <button
                                type="button"
                                data-testid="apk-buildtype-release"
                                onClick={() => setApkBuildType('release')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                                    apkBuildType === 'release'
                                        ? 'bg-emerald-600 border-emerald-500 text-white'
                                        : 'bg-[#0c0c0e] border-gray-800 text-gray-300 hover:border-gray-700'
                                }`}
                            >
                                Firmar Release (Archivos / Keystore)
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <div className="sm:col-span-2">
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Package ID (Android)
                                </label>
                                <input
                                    type="text"
                                    data-testid="apk-package-input"
                                    value={apkPackageName}
                                    onChange={(e) => setApkPackageName(e.target.value)}
                                    placeholder="com.estudio.mijuego"
                                    className="w-full bg-[#0c0c0e] border border-gray-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Versión
                                </label>
                                <input
                                    type="text"
                                    value={apkVersionName}
                                    onChange={(e) => setApkVersionName(e.target.value)}
                                    placeholder="1.0.0"
                                    className="w-full bg-[#0c0c0e] border border-gray-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Version Code
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    value={apkVersionCode}
                                    onChange={(e) => setApkVersionCode(Math.max(1, parseInt(e.target.value, 10) || 1))}
                                    className="w-full bg-[#0c0c0e] border border-gray-700 focus:border-indigo-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono tabular-nums outline-none"
                                />
                            </div>
                        </div>

                        {/* Release Signing Config: Archivos (Cert+Key), Keystore (.keystore/.p12), o Autogenerado */}
                        {apkBuildType === 'release' && (
                            <div data-testid="apk-keystore-panel" className="p-3 rounded-lg bg-[#0c0e14] border border-emerald-500/30 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wide">
                                        Modo de Firma Digital
                                    </span>
                                    <div className="flex flex-wrap items-center gap-1 bg-[#141722] p-0.5 rounded border border-gray-800">
                                        <button
                                            type="button"
                                            data-testid="signing-mode-files"
                                            onClick={() => setReleaseSigningMode('files')}
                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                                releaseSigningMode === 'files' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            Archivos (Cert + Clave)
                                        </button>
                                        <button
                                            type="button"
                                            data-testid="keystore-mode-upload"
                                            onClick={() => setReleaseSigningMode('keystore')}
                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                                releaseSigningMode === 'keystore' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            .keystore / .p12
                                        </button>
                                        <button
                                            type="button"
                                            data-testid="keystore-mode-generate"
                                            onClick={() => setReleaseSigningMode('generate')}
                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                                releaseSigningMode === 'generate' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            Autogenerar
                                        </button>
                                    </div>
                                </div>

                                {releaseSigningMode === 'files' && (
                                    <div className="space-y-2.5">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div className="flex flex-col gap-1.5 bg-[#12151f] p-2.5 rounded-lg border border-gray-800">
                                                <label className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[11px] font-bold text-emerald-200 cursor-pointer text-center">
                                                    Subir Certificado (.pem / .crt / .cer / .der)
                                                    <input
                                                        type="file"
                                                        data-testid="apk-cert-file-input"
                                                        accept=".pem,.crt,.cer,.der"
                                                        onChange={handleCertFileUpload}
                                                        className="hidden"
                                                    />
                                                </label>
                                                <span className="text-[10px] text-gray-300 font-mono truncate text-center">
                                                    {certBase64
                                                        ? `✓ ${certFileName}`
                                                        : 'Ningún certificado cargado'}
                                                </span>
                                            </div>
                                            <div className="flex flex-col gap-1.5 bg-[#12151f] p-2.5 rounded-lg border border-gray-800">
                                                <label className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded text-[11px] font-bold text-emerald-200 cursor-pointer text-center">
                                                    Subir Clave Privada (.pem / .key / .pk8)
                                                    <input
                                                        type="file"
                                                        data-testid="apk-key-file-input"
                                                        accept=".pem,.key,.pk8"
                                                        onChange={handlePrivateKeyFileUpload}
                                                        className="hidden"
                                                    />
                                                </label>
                                                <span className="text-[10px] text-gray-300 font-mono truncate text-center">
                                                    {privateKeyBase64
                                                        ? `✓ ${privateKeyFileName}`
                                                        : 'Ninguna clave cargada'}
                                                </span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-400 block mb-1">Contraseña de la Clave Privada (opcional si no está cifrada)</label>
                                            <input
                                                type="password"
                                                data-testid="apk-keypass-files-input"
                                                value={privateKeyPassword}
                                                onChange={(e) => setPrivateKeyPassword(e.target.value)}
                                                placeholder="Dejar vacío si tu clave no tiene contraseña"
                                                className="w-full bg-[#131620] border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-200 font-mono outline-none"
                                            />
                                        </div>
                                    </div>
                                )}

                                {releaseSigningMode === 'keystore' && (
                                    <div className="space-y-2.5">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                            <label className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-200 cursor-pointer text-center shrink-0">
                                                Seleccionar .keystore / .p12
                                                <input
                                                    type="file"
                                                    accept=".keystore,.p12,.pfx,.jks"
                                                    onChange={handleKeystoreFileUpload}
                                                    className="hidden"
                                                />
                                            </label>
                                            <span className="text-[11px] text-gray-300 font-mono truncate">
                                                {keystoreBase64
                                                    ? `${keystoreFileName} (${Math.round((keystoreBase64.length * 3) / 4 / 1024)} KB cargados)`
                                                    : 'Ningún archivo .keystore / .p12 seleccionado'}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Alias</label>
                                                <input
                                                    type="text"
                                                    data-testid="keystore-alias-input"
                                                    value={keystoreAlias}
                                                    onChange={(e) => setKeystoreAlias(e.target.value)}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Store Password</label>
                                                <input
                                                    type="password"
                                                    data-testid="keystore-storepass-input"
                                                    value={storePassword}
                                                    onChange={(e) => setStorePassword(e.target.value)}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Key Password</label>
                                                <input
                                                    type="password"
                                                    data-testid="keystore-keypass-input"
                                                    value={keyPassword}
                                                    onChange={(e) => setKeyPassword(e.target.value)}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Tipo</label>
                                                <select
                                                    value={keystoreType}
                                                    onChange={(e) => setKeystoreType(e.target.value as 'pkcs12' | 'jks')}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
                                                >
                                                    <option value="pkcs12">PKCS12 (.p12/.keystore)</option>
                                                    <option value="jks">JKS</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {releaseSigningMode === 'generate' && (
                                    <div className="space-y-2.5">
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Nombre / Autor (CN)</label>
                                                <input
                                                    type="text"
                                                    value={dnCommonName}
                                                    onChange={(e) => setDnCommonName(e.target.value)}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">Organización (O)</label>
                                                <input
                                                    type="text"
                                                    value={dnOrganization}
                                                    onChange={(e) => setDnOrganization(e.target.value)}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] text-gray-400 block mb-1">País (C, 2 letras)</label>
                                                <input
                                                    type="text"
                                                    maxLength={2}
                                                    value={dnCountry}
                                                    onChange={(e) => setDnCountry(e.target.value.toUpperCase())}
                                                    className="w-full bg-[#131620] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 font-mono uppercase outline-none"
                                                />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={isGeneratingSigningFiles}
                                            onClick={handleGenerateAndDownloadSigningFiles}
                                            className="w-full py-1.5 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-[11px] font-bold text-emerald-200 transition-colors"
                                        >
                                            {isGeneratingSigningFiles
                                                ? 'Generando certificado RSA-2048...'
                                                : 'Generar, Cargar y Descargar Certificado + Clave (.pem / .key)'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        <p data-testid="apk-status-message" className="text-[11px] text-emerald-300/90 leading-relaxed">
                            {apkStatusMessage}
                        </p>

                        <div className="flex flex-wrap gap-2 pt-1">
                            <button
                                type="button"
                                data-testid="apk-compile-direct-btn"
                                onClick={handleCompileDirectAPK}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all shadow-lg hover:shadow-indigo-600/20"
                            >
                                {apkBuildType === 'release'
                                    ? 'Exportar APK Release Firmado (.apk)'
                                    : 'Exportar APK Debug Predeterminado (.apk)'}
                            </button>
                            <button
                                type="button"
                                data-testid="apk-export-source-zip-btn"
                                onClick={handleExportAPKSourceZip}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-gray-700"
                            >
                                Proyecto Cordova (.zip)
                            </button>
                        </div>

                        <details className="pt-1">
                            <summary className="text-[10px] font-bold text-gray-400 hover:text-gray-200 uppercase tracking-wider cursor-pointer select-none">
                                Opciones avanzadas: Servidor Gradle/Cordova remoto (opcional)
                            </summary>
                            <div className="mt-2.5 space-y-2 p-2.5 rounded-lg bg-[#0c0c0e]/80 border border-gray-800">
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="url"
                                        data-testid="apk-server-url-input"
                                        value={apkServerUrl}
                                        onChange={(e) => handleApkServerUrlChange(e.target.value)}
                                        placeholder="Opcional: http://localhost:4050"
                                        className="bg-[#0c0c0e] border border-gray-700 focus:border-indigo-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none flex-grow font-mono"
                                    />
                                    <button
                                        type="button"
                                        data-testid="apk-check-btn"
                                        onClick={() => checkApkServerConnection()}
                                        className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-gray-700 transition-colors shrink-0"
                                    >
                                        Probar Conexión
                                    </button>
                                </div>
                                <a
                                    href="/api/apk-server/companion-script"
                                    download="apk-build-server.mjs"
                                    className="bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded border border-emerald-500/30 inline-flex items-center"
                                >
                                    Descargar Servidor Cordova Opcional (.mjs)
                                </a>
                            </div>
                        </details>
                    </div>

                    {/* Windows Desktop Export Section (.ZIP + Electron .EXE) */}
                    <div data-testid="win-export-card" className="p-4 rounded-xl bg-gradient-to-br from-sky-950/35 to-gray-900/60 border border-sky-500/30 space-y-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h4 className="font-bold text-white tracking-tight text-sm flex items-center gap-2">
                                    <span>🖥️</span> Exportar a Windows (.zip y Electron .exe)
                                </h4>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    Paquete Electron preconfigurado sin errores de CORS ni firma (<code className="text-sky-300">icon.ico</code> multi-resolución, protocolo <code className="text-sky-300">app://</code> y scripts 1-clic para <code className="text-sky-300">.exe</code>).
                                </p>
                            </div>
                            <span
                                data-testid="win-server-badge"
                                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${
                                    winServerStatus === 'remote' || winServerStatus === 'local' || winServerStatus === 'package-only' || winServerStatus === 'idle'
                                        ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                                        : winServerStatus === 'checking'
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                            : 'bg-red-500/15 border-red-500/40 text-red-300'
                                }`}
                            >
                                {winServerStatus === 'remote' && 'Servidor EXE Conectado'}
                                {winServerStatus === 'local' && 'Electron Local Listo'}
                                {(winServerStatus === 'package-only' || winServerStatus === 'idle') && 'Electron ZIP · Listo'}
                                {winServerStatus === 'checking' && 'Verificando...'}
                                {winServerStatus === 'offline' && 'Remoto Sin Conexión'}
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Pantalla en Windows
                                </label>
                                <button
                                    type="button"
                                    data-testid="win-fullscreen-toggle"
                                    onClick={() => setWinFullscreen((p) => !p)}
                                    className={`w-full px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                        winFullscreen
                                            ? 'bg-sky-600 border-sky-500 text-white'
                                            : 'bg-[#0c0c0e] border-gray-700 text-gray-300 hover:border-gray-600'
                                    }`}
                                >
                                    {winFullscreen ? 'Pantalla Completa (F11)' : 'Modo Ventana'}
                                </button>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Formato .EXE Directo
                                </label>
                                <select
                                    data-testid="win-target-select"
                                    value={winTarget}
                                    onChange={(e) => setWinTarget(e.target.value as 'portable' | 'nsis')}
                                    className="w-full bg-[#0c0c0e] border border-gray-700 focus:border-sky-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none"
                                >
                                    <option value="portable">Portable (.exe único)</option>
                                    <option value="nsis">Instalador Setup (.exe)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                    Versión Windows
                                </label>
                                <input
                                    type="text"
                                    value={winVersion}
                                    onChange={(e) => setWinVersion(e.target.value)}
                                    placeholder="1.0.0"
                                    className="w-full bg-[#0c0c0e] border border-gray-700 focus:border-sky-500 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 font-mono outline-none"
                                />
                            </div>
                        </div>

                        <p data-testid="win-status-message" className="text-[11px] text-sky-300/90 leading-relaxed">
                            {winStatusMessage}
                        </p>

                        <div className="flex flex-wrap gap-2 pt-1">
                            <button
                                type="button"
                                data-testid="win-export-zip-btn"
                                onClick={handleExportWindowsZip}
                                className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all shadow-lg hover:shadow-sky-600/20"
                            >
                                Exportar Windows Electron (.zip listo para .exe)
                            </button>
                            <button
                                type="button"
                                data-testid="win-compile-exe-btn"
                                onClick={handleCompileDirectWinExe}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-gray-700"
                            >
                                Compilar .exe Directo
                            </button>
                        </div>

                        <details className="pt-1">
                            <summary className="text-[10px] font-bold text-gray-400 hover:text-gray-200 uppercase tracking-wider cursor-pointer select-none">
                                Opciones avanzadas: Servidor Electron Builder Windows (.exe remoto opcional)
                            </summary>
                            <div className="mt-2.5 space-y-2 p-2.5 rounded-lg bg-[#0c0c0e]/80 border border-gray-800">
                                <div className="flex flex-col sm:flex-row gap-2">
                                    <input
                                        type="url"
                                        data-testid="win-server-url-input"
                                        value={winServerUrl}
                                        onChange={(e) => handleWinServerUrlChange(e.target.value)}
                                        placeholder="Opcional: http://localhost:4060"
                                        className="bg-[#0c0c0e] border border-gray-700 focus:border-sky-500 rounded-lg px-3 py-1.5 text-xs text-gray-200 outline-none flex-grow font-mono"
                                    />
                                    <button
                                        type="button"
                                        data-testid="win-check-btn"
                                        onClick={() => checkWinServerConnection()}
                                        className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg border border-gray-700 transition-colors shrink-0"
                                    >
                                        Probar Conexión
                                    </button>
                                </div>
                                <a
                                    href="/api/win-server/companion-script"
                                    download="win-exe-build-server.mjs"
                                    className="bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded border border-sky-500/30 inline-flex items-center"
                                >
                                    Descargar Servidor Compilador .EXE para Windows (.mjs)
                                </a>
                            </div>
                        </details>
                    </div>

                    <p className="text-xs text-gray-400 leading-relaxed">Otras plataformas de exportación web y datos:</p>

                    <div className="space-y-3">
                        <ExportOption
                            title="HTML5 (Archivo Único)"
                            description={t('export.webDescription')}
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>}
                            onExport={() => handleExport('HTML5')}
                        />
                        <ExportOption
                            title="Paquete ZIP Comprimido (Web / itch.io)"
                            description="Exporta todo el proyecto empaquetado en un archivo .ZIP con la carpeta de assets/ independiente para alojar en Netlify, itch.io o GitHub Pages."
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>}
                            onExport={handleExportZip}
                        />
                        <ExportOption
                            title={t('export.jsonTitle')}
                            description={t('export.jsonDescription')}
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                            onExport={() => handleExport('JSON')}
                            onViewCode={handleViewJsonCode}
                            viewCodeLabel="Ver JSON"
                            onCopyUrl={handleCopyUrl}
                            copyUrlLabel="Copiar URL"
                        />
                        <ExportOption
                            title="Guardar Ambos en Carpeta (HTML + JSON)"
                            description="Selecciona una carpeta local para guardar simultáneamente el archivo HTML5 del juego y el de datos JSON."
                            icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>}
                            onExport={handleExportBoth}
                        />
                    </div>
                </>
            )}
        </main>
      </div>

      {/* Custom Non-blocking confirmation overlay */}
      {customConfirm && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-4" onClick={() => setCustomConfirm(null)}>
          <div className="bg-[#1f1f23] rounded-2xl shadow-2xl p-6 max-w-md w-full border border-gray-800" onClick={e => e.stopPropagation()}>
            {customConfirm.title && (
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="text-indigo-400">📁</span> {customConfirm.title}
              </h3>
            )}
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap mb-6">
              {customConfirm.message}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setCustomConfirm(null)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold uppercase tracking-wider rounded-lg border border-gray-700 transition-colors"
              >
                {customConfirm.cancelText}
              </button>
              <button
                onClick={() => {
                  const confirmAction = customConfirm.onConfirm;
                  setCustomConfirm(null);
                  confirmAction();
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-all shadow-lg hover:shadow-indigo-600/20"
              >
                {customConfirm.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Non-blocking alert overlay */}
      {customAlert && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[99999] p-4" onClick={() => setCustomAlert(null)}>
          <div className="bg-[#1f1f23] rounded-2xl shadow-2xl p-6 max-w-md w-full border border-gray-800" onClick={e => e.stopPropagation()}>
            {customAlert.title && (
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="text-indigo-400">✨</span> {customAlert.title}
              </h3>
            )}
            <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap mb-6">
              {customAlert.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setCustomAlert(null)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider rounded-lg transition-all shadow-lg hover:shadow-indigo-600/20"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
