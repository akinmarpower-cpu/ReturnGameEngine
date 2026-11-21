import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectData } from '../types';
import {
  generateGameHTML,
  compressProjectAssets,
  generateGameZIP,
  applyExportDimensionFilter,
  getSceneDimension,
  type ExportDimensionMode,
} from '../services/exportService';
import { useLanguage } from '../LanguageContext';

interface ExportModalProps {
  onClose: () => void;
  projectData?: ProjectData | null;
  initialShowCode?: boolean;
}

const TURTLE_COMPILER_URL = 'https://turtle-forge-1--68lbstae.preview.emergentagent.com/';

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
              Comprimiendo y Optimizando Recursos
            </h3>
            <p className="text-xs text-gray-400 font-mono max-w-md bg-gray-900/50 px-4 py-3 rounded-lg border border-gray-800">
              {optimizationProgress}
            </p>
            <span className="text-[10px] text-gray-500 mt-4 leading-relaxed max-w-sm">
              Reduciendo imágenes, minificando scripts y empaquetando assets para carga ultra rápida.
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
                                .html / .zip
                            </span>
                        </div>
                        <span className="text-[10px] text-gray-500 block leading-relaxed">
                            Introduce el nombre del archivo exportado sin extensión (solo letras, números y guiones).
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

                    {/* Exportar a APK y EXE mediante Turtle Compiler */}
                    <div
                        data-testid="turtle-compiler-card"
                        className="p-4 rounded-xl bg-gradient-to-br from-emerald-950/40 via-teal-950/25 to-gray-900/70 border border-emerald-500/35 space-y-3"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1 flex-1 min-w-[220px]">
                                <h4 className="font-black text-white tracking-tight text-sm flex items-center gap-2">
                                    <span>🐢</span> Exportar a APK (Android) y EXE (Windows) con Turtle Compiler
                                </h4>
                                <p className="text-xs text-gray-300 leading-relaxed">
                                    Exporta primero tu juego en <strong className="text-indigo-300">HTML5</strong> o <strong className="text-emerald-300">ZIP</strong> y compílalo fácilmente a <strong className="text-white">.APK</strong> y <strong className="text-white">.EXE</strong> desde la herramienta externa <strong className="text-emerald-300">Turtle Compiler</strong>.
                                </p>
                            </div>
                            <a
                                data-testid="turtle-compiler-link"
                                href={TURTLE_COMPILER_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition-all shadow-lg hover:shadow-emerald-600/25 shrink-0 inline-flex items-center gap-1.5"
                            >
                                <span>Abrir Turtle Compiler</span>
                                <span aria-hidden="true">↗</span>
                            </a>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 bg-[#0c1112] border border-emerald-900/50 rounded-lg px-3 py-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 shrink-0">
                                URL Oficial:
                            </span>
                            <code className="text-[11px] font-mono text-emerald-200 truncate flex-1">
                                {TURTLE_COMPILER_URL}
                            </code>
                            <button
                                type="button"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(TURTLE_COMPILER_URL);
                                        setCustomAlert({
                                            title: 'URL de Turtle Compiler Copiada',
                                            message: `Se ha copiado el enlace:\n${TURTLE_COMPILER_URL}`,
                                        });
                                    } catch {
                                        setCustomAlert({
                                            title: 'Enlace Turtle Compiler',
                                            message: TURTLE_COMPILER_URL,
                                        });
                                    }
                                }}
                                className="px-2.5 py-1 rounded bg-emerald-600/20 hover:bg-emerald-600/35 text-emerald-300 text-[10px] font-bold uppercase border border-emerald-500/30 shrink-0"
                            >
                                Copiar URL
                            </button>
                        </div>

                        <div
                            data-testid="turtle-compiler-tip"
                            className="p-3 rounded-lg bg-amber-950/35 border border-amber-500/40 text-amber-100 text-xs leading-relaxed flex items-start gap-2.5"
                        >
                            <span className="text-base leading-none mt-0.5 shrink-0">💡</span>
                            <div>
                                <strong className="text-amber-300 uppercase text-[10px] tracking-wider block mb-0.5">
                                    Consejo importante
                                </strong>
                                <span>
                                    Cuando se conecte al servidor del desarrollador podrás empezar con el proceso de compilación a APK o EXE. Esto puede tardar un poco, así que deberás tener paciencia.
                                </span>
                            </div>
                        </div>
                    </div>

                    <p className="text-xs text-gray-400 leading-relaxed">Plataformas de exportación web y datos:</p>

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
