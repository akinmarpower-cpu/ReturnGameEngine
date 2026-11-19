import React, { useState, useEffect, useCallback } from 'react';
import type { ProjectData } from '../types';
import {
  generateGameHTML,
  compressProjectAssets,
  generateGameZIP,
  generateGameAPKPackage,
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
  const [apkServerStatus, setApkServerStatus] = useState<'idle' | 'checking' | 'connected' | 'local' | 'offline' | 'none'>('idle');
  const [apkStatusMessage, setApkStatusMessage] = useState<string>('Verificando servidor de compilación APK...');
  const [isBuildingApk, setIsBuildingApk] = useState(false);

  // Android APK Keystore Signing State
  const [apkBuildType, setApkBuildType] = useState<'debug' | 'release'>('debug');
  const [apkPackageName, setApkPackageName] = useState<string>(() => {
    const raw = (projectData?.name || projectData?.scenes?.[0]?.name || 'mijuego').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mijuego';
    return `com.return2d.${raw}`;
  });
  const [apkVersionName, setApkVersionName] = useState<string>('1.0.0');
  const [apkVersionCode, setApkVersionCode] = useState<number>(1);
  const [keystoreMode, setKeystoreMode] = useState<'upload' | 'generate'>('generate');
  const [keystoreFileName, setKeystoreFileName] = useState<string>('release.keystore');
  const [keystoreBase64, setKeystoreBase64] = useState<string>('');
  const [keystoreType, setKeystoreType] = useState<'pkcs12' | 'jks'>('pkcs12');
  const [keystoreAlias, setKeystoreAlias] = useState<string>('releasekey');
  const [storePassword, setStorePassword] = useState<string>('return2d123');
  const [keyPassword, setKeyPassword] = useState<string>('return2d123');
  const [dnCommonName, setDnCommonName] = useState<string>('Return Game Studio');
  const [dnOrganization, setDnOrganization] = useState<string>('Return Interactive');
  const [dnCountry, setDnCountry] = useState<string>('ES');

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
          setApkStatusMessage(data.message || 'Android SDK y Cordova detectados en este servidor.');
        } else {
          setApkServerStatus('connected');
          setApkStatusMessage(data.message || `Conectado al servidor APK (${data.serverUrl || target}).`);
        }
      } else if (data?.mode === 'none') {
        setApkServerStatus('none');
        setApkStatusMessage(data.message || 'Sin servidor APK remoto conectado. Conecta una URL o descarga apk-build-server.mjs.');
      } else {
        setApkServerStatus('offline');
        setApkStatusMessage(data?.message || 'No se pudo conectar al servidor de compilación APK.');
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
        const urlToCheck = saved || info.defaultServerUrl || '';
        if (!saved && info.defaultServerUrl) {
          setApkServerUrl(info.defaultServerUrl);
        }
        if (urlToCheck) {
          await checkApkServerConnection(urlToCheck);
        } else {
          setApkServerStatus('none');
          setApkStatusMessage('Conecta la URL de tu servidor APK (p. ej. http://localhost:4050) para compilar .apk de depuración sin .zip.');
        }
      } catch {
        if (!cancelled) {
          setApkServerStatus('none');
          setApkStatusMessage('No se pudo consultar /api/apk-server/status.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setOptimizationProgress('Iniciando empaquetado del paquete ZIP...');
      try {
          const zipBlob = await generateGameZIP(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, { dimensionMode, skipStartScreen });
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

  const handleKeystoreFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const commaIdx = result.indexOf(',');
          const b64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
          setKeystoreBase64(b64);
          setKeystoreFileName(file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'release.keystore');
          setKeystoreMode('upload');
      };
      reader.readAsDataURL(file);
  };

  const buildSigningConfig = useCallback((): ApkSigningConfig => {
      const cleanPkg = apkPackageName.trim().replace(/[^a-zA-Z0-9_.]/g, '') || 'com.return2d.game';
      return {
          buildType: apkBuildType,
          packageName: cleanPkg.includes('.') ? cleanPkg : `com.return2d.${cleanPkg}`,
          versionName: apkVersionName.trim() || '1.0.0',
          versionCode: Math.max(1, Number(apkVersionCode) || 1),
          appName: projectData?.scenes?.[0]?.name || exportFileName.trim() || 'Return Game',
          keystoreBase64: apkBuildType === 'release' && keystoreMode === 'upload' ? keystoreBase64 : undefined,
          keystoreFileName: keystoreFileName.trim() || 'release.keystore',
          storePassword: storePassword.trim() || 'return2d123',
          alias: keystoreAlias.trim() || 'releasekey',
          keyPassword: keyPassword.trim() || storePassword.trim() || 'return2d123',
          keystoreType,
          generateKeystore: apkBuildType === 'release' && keystoreMode === 'generate',
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
      keystoreMode,
      keystoreBase64,
      keystoreFileName,
      storePassword,
      keystoreAlias,
      keyPassword,
      keystoreType,
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
          if (!keystoreAlias.trim()) return 'Debes indicar el Alias de la Keystore para compilar en modo Release.';
          if (!storePassword.trim() || storePassword.trim().length < 6) {
              return 'La contraseña del Store Password de la Keystore debe tener al menos 6 caracteres.';
          }
          if (!keyPassword.trim() || keyPassword.trim().length < 6) {
              return 'La contraseña Key Password de la Keystore debe tener al menos 6 caracteres.';
          }
          if (keystoreMode === 'upload' && !keystoreBase64) {
              return 'Sube tu archivo .keystore / .jks o selecciona "Autogenerar Keystore (keytool)".';
          }
      }
      return null;
  };

  const handleCompileDirectAPK = async () => {
      const baseData = getEffectiveProjectData();
      if (!baseData) return;
      const validationErr = validateApkSigning();
      if (validationErr) {
          setCustomAlert({ title: 'Configuración de Firma Keystore', message: validationErr });
          return;
      }
      const signing = buildSigningConfig();
      const suffix = signing.buildType === 'release' ? 'release' : 'debug';

      setIsBuildingApk(true);
      setIsOptimizing(true);
      setOptimizationProgress(`Preparando bundle Android ${suffix.toUpperCase()} con firma Keystore para enviar al servidor APK...`);
      try {
          const baseName = exportFileName.trim() || 'mi_juego_2d';
          const cordovaZipBlob = await generateGameAPKPackage(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, { dimensionMode, signing });
          setOptimizationProgress(`Enviando proyecto firmado (${suffix.toUpperCase()}) al servidor de compilación APK...`);
          const cordovaZipBase64 = await blobToBase64(cordovaZipBlob);
          const filteredData = applyExportDimensionFilter(baseData, { dimensionMode });
          const filteredHtml = generateGameHTML(filteredData, true, { dimensionMode });

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
                  html: filteredHtml,
                  projectJson: JSON.stringify(filteredData),
              }),
          });

          if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              if (response.status === 422 && errData?.error === 'NO_APK_BUILD_SERVER') {
                  setCustomAlert({
                      title: 'Servidor de Compilación APK Requerido',
                      message:
                        `${errData.message}\n\nCómo compilar directo a .apk (${suffix}):\n1. Descarga "Servidor APK (.mjs)" aquí abajo.\n2. En tu PC/VPS con Android SDK + JDK (keytool) + Cordova instalados, ejecuta:\n   node apk-build-server.mjs\n3. Pega la URL (ej. http://localhost:4050) arriba, pulsa "Probar Conexión" y vuelve a pulsar "Compilar APK".`,
                  });
                  return;
              }
              setCustomAlert({
                  title: `Error al Compilar APK ${suffix.toUpperCase()}`,
                  message: errData?.message || `El servidor devolvió estado HTTP ${response.status}.`,
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
          const zipBlob = await generateGameAPKPackage(baseData, (msg) => {
              setOptimizationProgress(msg);
          }, { dimensionMode, signing });
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
                : 'Comprimiendo y Optimizando Recursos'}
            </h3>
            <p className="text-xs text-gray-400 font-mono max-w-md bg-gray-900/50 px-4 py-3 rounded-lg border border-gray-800">
              {optimizationProgress}
            </p>
            <span className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-sm">
              {isBuildingApk
                ? `Conectando con el servidor de compilación Android para generar el binario .apk firmado con Keystore (${apkBuildType}).`
                : 'Reduciendo imágenes pesadas y pistas de audio para minimizar el peso del juego de MB a KB para una carga ultra rápida.'}
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

                    {/* Direct APK Debug / Release Keystore Build Server Section */}
                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-950/35 to-gray-900/60 border border-indigo-500/30 space-y-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h4 className="font-bold text-white tracking-tight text-sm flex items-center gap-2">
                                    <span>📱</span> Compilación Android APK con Keystore (.apk directo)
                                </h4>
                                <p className="text-[11px] text-gray-400 mt-0.5">
                                    Compila en modo <strong className="text-gray-200">Debug</strong> o <strong className="text-emerald-300">Release Firmado</strong> usando tu archivo <code className="text-indigo-300">.keystore</code> / <code className="text-indigo-300">.jks</code> o autogenerándolo con <code className="text-indigo-300">keytool</code>.
                                </p>
                            </div>
                            <span
                                data-testid="apk-server-badge"
                                className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded border ${
                                    apkServerStatus === 'connected' || apkServerStatus === 'local'
                                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                        : apkServerStatus === 'checking'
                                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                                            : apkServerStatus === 'offline'
                                                ? 'bg-red-500/15 border-red-500/40 text-red-300'
                                                : 'bg-gray-800 border-gray-700 text-gray-400'
                                }`}
                            >
                                {apkServerStatus === 'connected' && 'Servidor Conectado'}
                                {apkServerStatus === 'local' && 'SDK Local Listo'}
                                {apkServerStatus === 'checking' && 'Verificando...'}
                                {apkServerStatus === 'offline' && 'Sin Conexión'}
                                {(apkServerStatus === 'none' || apkServerStatus === 'idle') && 'Servidor Requerido'}
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
                                Debug (Pruebas)
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
                                Release (Firmado con Keystore)
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

                        {/* Release Keystore Signing Config */}
                        {apkBuildType === 'release' && (
                            <div data-testid="apk-keystore-panel" className="p-3 rounded-lg bg-[#0c0e14] border border-emerald-500/30 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-emerald-300 uppercase tracking-wide">
                                        Firma Digital Keystore
                                    </span>
                                    <div className="flex items-center gap-1 bg-[#141722] p-0.5 rounded border border-gray-800">
                                        <button
                                            type="button"
                                            data-testid="keystore-mode-generate"
                                            onClick={() => setKeystoreMode('generate')}
                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                                keystoreMode === 'generate' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            Autogenerar (keytool)
                                        </button>
                                        <button
                                            type="button"
                                            data-testid="keystore-mode-upload"
                                            onClick={() => setKeystoreMode('upload')}
                                            className={`px-2.5 py-1 rounded text-[10px] font-bold transition-colors ${
                                                keystoreMode === 'upload' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            Subir .keystore / .jks
                                        </button>
                                    </div>
                                </div>

                                {keystoreMode === 'upload' ? (
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                        <label className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 rounded-lg text-xs font-bold text-emerald-200 cursor-pointer text-center shrink-0">
                                            Seleccionar archivo Keystore
                                            <input
                                                type="file"
                                                accept=".keystore,.jks,.bks,.p12"
                                                onChange={handleKeystoreFileUpload}
                                                className="hidden"
                                            />
                                        </label>
                                        <span className="text-[11px] text-gray-300 font-mono truncate">
                                            {keystoreBase64
                                                ? `${keystoreFileName} (${Math.round((keystoreBase64.length * 3) / 4 / 1024)} KB cargados)`
                                                : 'Ningún archivo .keystore seleccionado'}
                                        </span>
                                    </div>
                                ) : (
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
                                )}

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
                                            <option value="pkcs12">PKCS12 (.keystore)</option>
                                            <option value="jks">JKS (.jks)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="url"
                                data-testid="apk-server-url-input"
                                value={apkServerUrl}
                                onChange={(e) => handleApkServerUrlChange(e.target.value)}
                                placeholder="http://localhost:4050  o  https://tu-servidor-apk.ejemplo.com"
                                className="bg-[#0c0c0e] border border-gray-700 focus:border-indigo-500 rounded-lg px-3 py-2 text-xs text-gray-200 outline-none flex-grow font-mono"
                            />
                            <button
                                type="button"
                                data-testid="apk-check-btn"
                                onClick={() => checkApkServerConnection()}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-lg border border-gray-700 transition-colors shrink-0"
                            >
                                Probar Conexión
                            </button>
                        </div>

                        <p data-testid="apk-status-message" className="text-[11px] text-gray-300 leading-relaxed">
                            {apkStatusMessage}
                        </p>

                        <div className="flex flex-wrap gap-2 pt-1">
                            <button
                                type="button"
                                data-testid="apk-compile-direct-btn"
                                onClick={handleCompileDirectAPK}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg transition-all shadow-lg hover:shadow-indigo-600/20"
                            >
                                {apkBuildType === 'release' ? 'Compilar APK Release Firmado (.apk)' : 'Compilar APK Debug (.apk)'}
                            </button>
                            <a
                                href="/api/apk-server/companion-script"
                                download="apk-build-server.mjs"
                                className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-emerald-500/30 inline-flex items-center"
                            >
                                Descargar Servidor APK (.mjs)
                            </a>
                            <button
                                type="button"
                                data-testid="apk-export-source-zip-btn"
                                onClick={handleExportAPKSourceZip}
                                className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg transition-colors border border-gray-700"
                            >
                                Respaldo Cordova (.zip)
                            </button>
                        </div>
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
