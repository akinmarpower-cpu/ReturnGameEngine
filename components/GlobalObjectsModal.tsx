import React, { useMemo, useState } from 'react';
import {
  Box,
  Check,
  Edit3,
  Globe,
  Layers,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { GameObject, ProjectData, Scene } from '../types';
import {
  buildGlobalObjectTemplate,
  instantiateGlobalObject,
} from '../utils/objectHierarchy';

interface GlobalObjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectData: ProjectData;
  activeScene: Scene | undefined;
  onUpdateProjectData: (updates: Partial<ProjectData> | ((prev: ProjectData) => ProjectData)) => void;
  onAddObject: (props?: Partial<GameObject>) => void;
  onAddObjectsBatch?: (objs: GameObject[]) => void;
  onSelectObject?: (id: number | null) => void;
  onShowToast?: (msg: string) => void;
}

const SHAPE_NAMES: Record<string, string> = {
  box: 'Cubo 3D',
  sphere: 'Esfera 3D',
  cylinder: 'Cilindro 3D',
  cone: 'Cono 3D',
  capsule: 'Cápsula 3D',
  plane: 'Plano 3D',
  torus: 'Aro 3D',
  ramp: 'Rampa 3D',
  character: 'Personaje 3D',
  coin: 'Moneda 3D',
  light: 'Luz 3D',
  tree: 'Árbol 3D',
  rock: 'Roca 3D',
};

const ObjectPreviewThumb: React.FC<{ obj: GameObject }> = ({ obj }) => {
  if (obj.imageUrl) {
    return (
      <div className="w-12 h-12 rounded-lg bg-[#111318] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
        <img src={obj.imageUrl} alt={obj.name} className="w-10 h-10 object-contain" />
      </div>
    );
  }
  if (obj.isUI) {
    return (
      <div
        className="w-12 h-12 rounded-lg border border-teal-500/40 flex items-center justify-center text-[9px] font-bold text-white px-1 text-center overflow-hidden shrink-0"
        style={{ backgroundColor: obj.color && obj.color !== 'transparent' ? obj.color : '#115e59' }}
      >
        {obj.text ? obj.text.slice(0, 8) : <Layers size={18} className="text-teal-200" />}
      </div>
    );
  }
  const has3D = Boolean(obj.modelUrl || obj.shape3D);
  const bg = obj.color && obj.color !== 'transparent' ? obj.color : '#6366f1';
  return (
    <div
      className="w-12 h-12 rounded-lg border border-white/15 flex flex-col items-center justify-center shrink-0 relative shadow-inner"
      style={{
        background: `linear-gradient(135deg, ${bg}dd 0%, ${bg}66 100%)`,
        borderRadius: obj.shape3D === 'sphere' || obj.shape3D === 'coin' ? '9999px' : '0.5rem',
      }}
    >
      {has3D ? (
        <Box size={18} className="text-white drop-shadow" />
      ) : (
        <div className="w-5 h-5 rounded-sm border border-white/60 bg-white/15" />
      )}
      {obj.modelUrl && (
        <span className="absolute -bottom-1 px-1 rounded bg-emerald-600 text-[8px] font-black text-white uppercase shadow">
          GLB
        </span>
      )}
    </div>
  );
};

export const GlobalObjectsModal: React.FC<GlobalObjectsModalProps> = ({
  isOpen,
  onClose,
  projectData,
  activeScene,
  onUpdateProjectData,
  onAddObject,
  onAddObjectsBatch,
  onSelectObject,
  onShowToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSourceSceneId, setSelectedSourceSceneId] = useState<string>(
    activeScene?.id || projectData.scenes[0]?.id || ''
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isDragOverGlobals, setIsDragOverGlobals] = useState(false);

  const sourceScene = useMemo(() => {
    return (
      projectData.scenes.find(s => s.id === selectedSourceSceneId) ||
      activeScene ||
      projectData.scenes[0]
    );
  }, [projectData.scenes, selectedSourceSceneId, activeScene]);

  const globalObjects = projectData.globalObjects || [];

  const filteredGlobals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return globalObjects;
    return globalObjects.filter(
      g =>
        g.name.toLowerCase().includes(q) ||
        (g.shape3D || '').toLowerCase().includes(q)
    );
  }, [globalObjects, searchQuery]);

  const filteredSceneObjects = useMemo(() => {
    const list = sourceScene?.gameObjects || [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(o => o.name.toLowerCase().includes(q));
  }, [sourceScene, searchQuery]);

  if (!isOpen) return null;

  const handlePromoteSceneObject = (sceneObj: GameObject, fromSceneObjs?: GameObject[]) => {
    const allObjs = fromSceneObjs || sourceScene?.gameObjects || [];
    const identicalTemplate = buildGlobalObjectTemplate(sceneObj, allObjs);

    onUpdateProjectData(prev => {
      const existing = prev.globalObjects || [];
      const alreadyExists = existing.some(g => g.name === identicalTemplate.name);
      const nextGlobals = alreadyExists
        ? existing.map(g => (g.name === identicalTemplate.name ? identicalTemplate : g))
        : [...existing, identicalTemplate];
      return {
        ...prev,
        globalObjects: nextGlobals,
      };
    });

    onShowToast?.(
      `"${identicalTemplate.name}" guardado como Objeto Global idéntico${
        identicalTemplate._globalChildren?.length
          ? ` (+${identicalTemplate._globalChildren.length} hijo${identicalTemplate._globalChildren.length > 1 ? 's' : ''})`
          : ''
      }`
    );
  };

  const handleInsertIntoActiveScene = (template: GameObject) => {
    const is3D = activeScene?.sceneMode === '3d' || Boolean(template.modelUrl || template.shape3D);
    const existingCount = activeScene?.gameObjects?.length || 0;
    const offsetStep = existingCount % 5;
    const { root, allObjects } = instantiateGlobalObject(
      template,
      is3D
        ? {
            position3D: {
              x: Number((offsetStep * 1.5 - 3).toFixed(2)),
              y: template.position3D?.y ?? 0,
              z: Number((offsetStep * 1.2 - 2).toFixed(2)),
            },
            x: 200 + offsetStep * 32,
            y: 200 + offsetStep * 32,
          }
        : {
            x: 160 + offsetStep * 36,
            y: 160 + offsetStep * 36,
          }
    );

    if (onAddObjectsBatch) {
      onAddObjectsBatch(allObjects);
    } else if (root) {
      onAddObject(root);
    }
    if (root) {
      onSelectObject?.(root.id);
    }
    onShowToast?.(`"${template.name}" insertado en la escena actual`);
  };

  const handleDeleteGlobal = (id: number, name: string) => {
    onUpdateProjectData(prev => ({
      ...prev,
      globalObjects: (prev.globalObjects || []).filter(g => g.id !== id),
    }));
    onShowToast?.(`Objeto Global "${name}" eliminado`);
  };

  const handleSaveRename = (id: number) => {
    const clean = editingName.trim();
    if (!clean) {
      setEditingId(null);
      return;
    }
    onUpdateProjectData(prev => ({
      ...prev,
      globalObjects: (prev.globalObjects || []).map(g =>
        g.id === id ? { ...g, name: clean } : g
      ),
    }));
    setEditingId(null);
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[90] p-4"
      onClick={onClose}
    >
      <div
        data-testid="global-objects-modal"
        className="bg-[#18181c] border border-gray-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden text-gray-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#121216] border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-base font-black uppercase tracking-wider text-white flex items-center gap-2">
                Objetos Globales del Proyecto
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {globalObjects.length}
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Convierte cualquier objeto de escena en global conservando su forma 3D, modelo GLB, texturas, propiedades, scripts e hijos exactamente iguales.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar objeto..."
                className="pl-8 pr-3 py-1.5 bg-[#0e0e12] border border-gray-800 focus:border-amber-500 rounded-lg text-xs text-gray-200 outline-none w-48"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-gray-800/80 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              title="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Body 2-column layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden min-h-0">
          {/* Left Panel: Scene objects to promote */}
          <section className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-gray-800 bg-[#141418] flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-800/80 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                  <Sparkles size={13} /> Objetos de Escena
                </span>
                <select
                  value={sourceScene?.id || ''}
                  onChange={e => setSelectedSourceSceneId(e.target.value)}
                  className="bg-[#0e0e12] border border-gray-800 rounded-md px-2 py-1 text-[11px] text-gray-200 outline-none focus:border-indigo-500"
                >
                  {projectData.scenes.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.gameObjects.length})
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-gray-500 leading-snug">
                Pulsa <strong className="text-amber-300">Hacer Global</strong> para copiar el objeto idéntico (sin convertirlo en un cubo genérico).
              </p>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {filteredSceneObjects.length === 0 ? (
                <div className="text-center py-10 text-xs text-gray-500 border border-dashed border-gray-800 rounded-xl">
                  No hay objetos en esta escena.
                </div>
              ) : (
                filteredSceneObjects.map(obj => {
                  const allSceneObjs = sourceScene?.gameObjects || [];
                  const directChildrenCount = allSceneObjs.filter(c => c.parentId === obj.id).length;
                  const shapeLabel = obj.modelUrl
                    ? 'Modelo GLB'
                    : obj.shape3D
                      ? SHAPE_NAMES[obj.shape3D] || obj.shape3D
                      : obj.isUI
                        ? 'UI / Interfaz'
                        : 'Sprite / 2D';
                  return (
                    <div
                      key={obj.id}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-[#1b1b22] border border-gray-800/90 hover:border-indigo-500/40 transition-all"
                    >
                      <ObjectPreviewThumb obj={obj} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-white truncate">{obj.name}</span>
                          {directChildrenCount > 0 && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                              +{directChildrenCount} hijos
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-400 flex flex-wrap gap-x-2 mt-0.5">
                          <span>{shapeLabel}</span>
                          {obj.scale3D && (
                            <span>
                              Escala {obj.scale3D.x}×{obj.scale3D.y}×{obj.scale3D.z}
                            </span>
                          )}
                          {(obj.behaviors?.length || 0) > 0 && (
                            <span className="text-indigo-300">{obj.behaviors!.length} comp.</span>
                          )}
                          {(obj.scripts?.length || 0) > 0 && (
                            <span className="text-amber-300">{obj.scripts!.length} scripts</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`promote-scene-obj-${obj.id}`}
                        onClick={() => handlePromoteSceneObject(obj, allSceneObjs)}
                        className="px-2.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider transition-all shrink-0 flex items-center gap-1"
                      >
                        <Globe size={11} /> Hacer Global
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Right Panel: Saved Global Objects */}
          <section
            className={`lg:col-span-7 flex flex-col min-h-0 transition-colors ${
              isDragOverGlobals ? 'bg-amber-950/20' : 'bg-[#18181c]'
            }`}
            onDragOver={e => {
              if (e.dataTransfer.types.includes('application/game-object-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setIsDragOverGlobals(true);
              }
            }}
            onDragLeave={() => setIsDragOverGlobals(false)}
            onDrop={e => {
              setIsDragOverGlobals(false);
              const objIdStr = e.dataTransfer.getData('application/game-object-id');
              if (objIdStr) {
                e.preventDefault();
                const objId = Number(objIdStr);
                const sceneObjs = activeScene?.gameObjects || sourceScene?.gameObjects || [];
                const found = sceneObjs.find(o => o.id === objId);
                if (found) handlePromoteSceneObject(found, sceneObjs);
              }
            }}
          >
            <div className="p-4 border-b border-gray-800/80 flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">
                Catálogo Global ({filteredGlobals.length})
              </span>
              <span className="text-[10px] text-gray-500">
                Arrastra cualquier tarjeta a la escena 2D/3D o pulsa Insertar
              </span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {filteredGlobals.length === 0 ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center border-2 border-dashed border-gray-800 rounded-2xl p-6 text-gray-500">
                  <Globe size={34} className="text-amber-500/40 mb-3" />
                  <p className="text-sm font-bold text-gray-300 mb-1">
                    Aún no hay Objetos Globales guardados
                  </p>
                  <p className="text-xs text-gray-500 max-w-md">
                    Selecciona cualquier objeto de la columna izquierda y pulsa <strong className="text-amber-300">Hacer Global</strong>. Conservará su modelo 3D, textura, dimensiones, scripts e hijos sin convertirse en un cubo o cuadrado genérico.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredGlobals.map(gObj => {
                    const childrenCount = gObj._globalChildren?.length || 0;
                    const shapeLabel = gObj.modelUrl
                      ? 'Modelo 3D GLB'
                      : gObj.shape3D
                        ? SHAPE_NAMES[gObj.shape3D] || gObj.shape3D
                        : gObj.isUI
                          ? 'Elemento UI'
                          : 'Sprite / Objeto 2D';
                    const isEditing = editingId === gObj.id;

                    return (
                      <div
                        key={gObj.id}
                        data-testid={`global-object-card-${gObj.id}`}
                        draggable
                        onDragStart={e => {
                          e.dataTransfer.setData('application/game-object-template', JSON.stringify(gObj));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        className="p-3 rounded-xl bg-[#202028] border border-gray-800 hover:border-amber-500/50 transition-all flex flex-col gap-3 cursor-grab active:cursor-grabbing shadow-md"
                      >
                        <div className="flex items-start gap-3">
                          <ObjectPreviewThumb obj={gObj} />
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={e => setEditingName(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveRename(gObj.id);
                                    if (e.key === 'Escape') setEditingId(null);
                                  }}
                                  autoFocus
                                  className="w-full bg-[#111116] border border-amber-500 rounded px-2 py-0.5 text-xs text-white outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveRename(gObj.id)}
                                  className="p-1 text-emerald-400 hover:text-emerald-300"
                                >
                                  <Check size={13} />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-black text-white truncate">{gObj.name}</h4>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(gObj.id);
                                    setEditingName(gObj.name);
                                  }}
                                  className="text-gray-500 hover:text-amber-300 p-0.5"
                                  title="Renombrar"
                                >
                                  <Edit3 size={11} />
                                </button>
                              </div>
                            )}

                            <div className="text-[10px] text-gray-400 mt-1 space-y-0.5">
                              <div className="flex flex-wrap gap-1.5 items-center">
                                <span className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-gray-200 font-semibold">
                                  {shapeLabel}
                                </span>
                                {childrenCount > 0 && (
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono">
                                    +{childrenCount} hijos
                                  </span>
                                )}
                              </div>
                              <div className="text-gray-500 flex flex-wrap gap-x-2">
                                <span>{gObj.width}×{gObj.height}px</span>
                                {gObj.scale3D && (
                                  <span>
                                    3D: {gObj.scale3D.x}×{gObj.scale3D.y}×{gObj.scale3D.z}
                                  </span>
                                )}
                                {(gObj.behaviors?.length || 0) > 0 && (
                                  <span>{gObj.behaviors!.length} comport.</span>
                                )}
                                {(gObj.scripts?.length || 0) > 0 && (
                                  <span>{gObj.scripts!.length} scripts</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                          <button
                            type="button"
                            data-testid={`insert-global-obj-${gObj.id}`}
                            onClick={() => handleInsertIntoActiveScene(gObj)}
                            className="flex-1 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Plus size={13} /> Insertar en Escena
                          </button>
                          <button
                            type="button"
                            data-testid={`delete-global-obj-${gObj.id}`}
                            onClick={() => handleDeleteGlobal(gObj.id, gObj.name)}
                            className="p-1.5 rounded-lg bg-red-950/40 hover:bg-red-600/30 text-red-400 hover:text-red-200 border border-red-900/40 transition-colors"
                            title="Eliminar de Globales"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default GlobalObjectsModal;
