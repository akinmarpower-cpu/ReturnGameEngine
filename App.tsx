import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, ProjectData, GameObject, Scene, GameAsset, Animation, Variable, PoseFrame } from './types';

import SplashScreen from './components/SplashScreen';
import ProjectLoadingScreen from './components/ProjectLoadingScreen';
import StartScreen from './components/StartScreen';
import Header from './components/Header';
import SceneHierarchy from './components/SceneHierarchy';
import SceneEditor from './components/SceneEditor';
import type { Camera3DSnapshot } from './components/SceneEditor3D';
import { createUniqueId, getObject3DDimensions, getObject3DPosition, getObject3DRotation, sync3DTo2D } from './utils/threeObjectBuilder';
import PropertiesInspector from './components/PropertiesInspector';
import GameView, { type GameState } from './components/GameView';
import { ExportModal } from './components/ExportModal';
import EventEditor from './components/EventEditor';
import AnimationEditor from './components/AnimationEditor';
import { SpriteEditor } from './components/SpriteEditor';
import PoseAnimationEditor from './components/PoseAnimationEditor';
import AudioLab from './components/AudioLab';
import SoundtrackEditor from './components/SoundtrackEditor';
import CharacterSkinsEditor from './components/CharacterSkinsEditor';
import { PrivacyPolicyModal } from './components/PrivacyPolicyModal';
import { PrototypeNoticeModal } from './components/PrototypeNoticeModal';
import Toast from './components/Toast';
import { HierarchyIcon } from './components/icons/HierarchyIcon';
import { EditorIcon } from './components/icons/EditorIcon';
import { InspectorIcon } from './components/icons/InspectorIcon';
import { get, set } from 'idb-keyval';
import { motion, AnimatePresence } from 'motion/react';

import { LanguageProvider, useLanguage } from './LanguageContext';

const PROJECTS_STORAGE_KEY = 'return2d-projects';

const saveProjectsToStorage = async (projectsToSave: Project[]) => {
    try {
        await set(PROJECTS_STORAGE_KEY, projectsToSave);
    } catch (idbErr) {
        console.warn("IndexedDB save failed, falling back to localStorage:", idbErr);
    }

    try {
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projectsToSave));
    } catch (lsErr) {
        console.warn("localStorage backup skipped or quota exceeded:", lsErr);
    }
};

const loadProjectsFromStorage = async (): Promise<Project[] | null> => {
    try {
        const idbData = await get(PROJECTS_STORAGE_KEY);
        if (idbData && Array.isArray(idbData) && idbData.length > 0) {
            return idbData as Project[];
        }
    } catch (e) {
        console.warn("Failed to load from IndexedDB:", e);
    }

    try {
        const lsData = localStorage.getItem(PROJECTS_STORAGE_KEY);
        if (lsData) {
            const parsed = JSON.parse(lsData);
            if (Array.isArray(parsed) && parsed.length > 0) {
                set(PROJECTS_STORAGE_KEY, parsed).catch(() => {});
                return parsed as Project[];
            }
        }
    } catch (e) {
        console.warn("Failed to load from localStorage:", e);
    }

    return null;
};

const createNewScene = (name: string): Scene => {
    const sceneId = `scene_${Date.now()}`;
    return {
      id: sceneId,
      name,
      sceneMode: '2d',
      backgroundColor: '#1a1a1a', // More Godot-like neutral dark gray
      defaultZoom: 1,
      cameraBounds: { enabled: false, x: 0, y: 0, width: 1024, height: 768 },
      gameObjects: [],
      events: [],
    };
};

const createNewProjectData = (t: (key: string) => string): ProjectData => {
    const starterScene = createNewScene(t('starter.sceneName') || 'Main Scene');
    
    starterScene.gameObjects = [
      { id: 1, name: 'Player', x: 200, y: 300, width: 40, height: 60, color: '#3b82f6', zIndex: 10, behaviors: [{ name: 'PlatformerCharacter', properties: { speed: 200, jumpForce: 400, gravity: 600 } }, { name: 'FollowCamera', properties: {} }], variables: [], direction: 'right', rotation: 0, scaleX: 1, scaleY: 1, stats: { hp: 100, maxHp: 100, attack: 10} },
      { id: 2, name: 'Ground', x: 0, y: 500, width: 1200, height: 60, color: '#2a2a2a', zIndex: 1, behaviors: [{ name: 'Solid', properties: {} }] },
    ];
    return {
        scenes: [starterScene],
        activeSceneId: starterScene.id,
        assets: [],
        animations: [],
        globalObjects: [],
        globalVariables: [{name: 'score', value: 0}],
        orientation: 'landscape',
        gameWidth: 1024,
        gameHeight: 768,
        responsive: true,
        joystick: {
            enabled: true,
            position: 'left',
            size: 120,
            opacity: 0.5
        }
    };
};

type AppState = 'loading' | 'start' | 'editor' | 'playing';

const App: React.FC = () => {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
};

const AppContent: React.FC = () => {
  const { t } = useLanguage();
  const [appState, setAppState] = useState<AppState>('loading');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: '', show: false });

  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projects;
  const projectDataRef = useRef<ProjectData | null>(null);
  projectDataRef.current = projectData;
  const activeProjectIdRef = useRef<string | null>(null);
  activeProjectIdRef.current = activeProjectId;

  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportModalInitialShowCode, setExportModalInitialShowCode] = useState(false);
  const [showEventEditor, setShowEventEditor] = useState(false);
  const [showAnimationEditor, setShowAnimationEditor] = useState(false);
  const [showSpriteEditor, setShowSpriteEditor] = useState(false);
  const [editingSpriteAssetId, setEditingSpriteAssetId] = useState<string | null>(null);
  const [showAudioLab, setShowAudioLab] = useState(false);
  const [showPoseAnimationEditor, setShowPoseAnimationEditor] = useState(false);
  const [showSoundtrackEditor, setShowSoundtrackEditor] = useState(false);
  const [showCharacterSkinsEditor, setShowCharacterSkinsEditor] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  
  const [hierarchyWidth, setHierarchyWidth] = useState(260);
  const [inspectorWidth, setInspectorWidth] = useState(300);
  const [isHierarchyCollapsed, setIsHierarchyCollapsed] = useState(false);
  const [isInspectorCollapsed, setIsInspectorCollapsed] = useState(false);
  const [activeMobilePanel, setActiveMobilePanel] = useState<'hierarchy' | 'editor' | 'inspector'>('editor');
  const [previewMode, setPreviewMode] = useState<'2d' | '3d'>('2d');
  const prePlaySceneIdRef = useRef<string | null>(null);
  const camera3DCacheRef = useRef<Map<string, Camera3DSnapshot>>(new Map());
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  const [isResizingHierarchy, setIsResizingHierarchy] = useState(false);
  const [isResizingInspector, setIsResizingInspector] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast({ message, show: true });
    setTimeout(() => setToast({ message: '', show: false }), 3000);
  }, []);

  // Initial load from IndexedDB with localStorage fallback
  useEffect(() => {
    const loadData = async () => {
        try {
            const storedProjects = await loadProjectsFromStorage();
            if (storedProjects && storedProjects.length > 0) {
                projectsRef.current = storedProjects;
                setProjects(storedProjects);
            } else {
                const starterProject: Project = {
                    id: `proj_${Date.now()}`,
                    name: 'Mi Primer Juego',
                    lastModified: Date.now(),
                    icon: '🎮',
                    data: createNewProjectData(t),
                };
                const initialList = [starterProject];
                projectsRef.current = initialList;
                setProjects(initialList);
                await saveProjectsToStorage(initialList);
            }
        } catch (error) {
            console.error("Error loading projects:", error);
            showToast("Error al cargar los proyectos");
        }
        setTimeout(() => setAppState('start'), 600);
    };
    loadData();
  }, [showToast, t]);

  const handleSaveProjects = useCallback(async (updatedProjects: Project[]) => {
      projectsRef.current = updatedProjects;
      setProjects(updatedProjects);
      try {
          await saveProjectsToStorage(updatedProjects);
      } catch (error) {
          console.error("Error saving projects:", error);
          showToast("Error al guardar: Espacio insuficiente");
      }
  }, [showToast]);

  const scheduleAutoSave = useCallback(() => {
      if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = setTimeout(() => {
          if (projectsRef.current.length > 0) {
              saveProjectsToStorage(projectsRef.current).catch(err => {
                  console.error("Auto-save error:", err);
              });
          }
      }, 500);
  }, []);

  const handleSaveCurrentProject = useCallback(async (showNotification = false) => {
    const activeId = activeProjectIdRef.current;
    const currentData = projectDataRef.current;
    if (!activeId || !currentData) return;

    if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
    }

    const exists = projectsRef.current.some(p => p.id === activeId);
    let updatedProjects: Project[];
    if (exists) {
        updatedProjects = projectsRef.current.map(p => 
            p.id === activeId 
            ? { ...p, data: currentData, lastModified: Date.now() } 
            : p
        );
    } else {
        const curProject = projects.find(p => p.id === activeId);
        const name = curProject?.name || 'Proyecto';
        const icon = curProject?.icon || '🎮';
        updatedProjects = [
            { id: activeId, name, icon, data: currentData, lastModified: Date.now() },
            ...projectsRef.current
        ];
    }
    projectsRef.current = updatedProjects;
    setProjects(updatedProjects);

    try {
        await saveProjectsToStorage(updatedProjects);
        if (showNotification) {
            showToast("Proyecto guardado");
        }
    } catch (error) {
        console.error("Error saving current project:", error);
        if (showNotification) {
            showToast("Error al guardar");
        }
    }
  }, [projects, showToast]);

  const updateProjectData = useCallback((updates: Partial<ProjectData> | ((prev: ProjectData) => ProjectData)) => {
      setProjectData(prev => {
          if (!prev) return null;
          const nextData = typeof updates === 'function' ? updates(prev) : { ...prev, ...updates };
          if (!nextData) return null;
          projectDataRef.current = nextData;

          // Keep active project in projectsRef and projects state synchronized in real time
          const activeId = activeProjectIdRef.current;
          if (activeId) {
              const exists = projectsRef.current.some(p => p.id === activeId);
              let updatedProjects: Project[];
              if (exists) {
                  updatedProjects = projectsRef.current.map(p => 
                      p.id === activeId 
                      ? { ...p, data: nextData, lastModified: Date.now() } 
                      : p
                  );
              } else {
                  updatedProjects = [
                      { id: activeId, name: 'Proyecto', icon: '🎮', data: nextData, lastModified: Date.now() },
                      ...projectsRef.current
                  ];
              }
              projectsRef.current = updatedProjects;
              setProjects(updatedProjects);
              scheduleAutoSave();
          }
          return nextData;
      });
  }, [scheduleAutoSave]);

  const handleLoadProject = useCallback((projectId: string, overrideProject?: Project) => {
    const projectToLoad = overrideProject || projectsRef.current.find(p => p.id === projectId) || projects.find(p => p.id === projectId);
    if (projectToLoad) {
        setAppState('loading');
        setTimeout(() => {
            setActiveProjectId(projectId);
            activeProjectIdRef.current = projectId;
            const clonedData = JSON.parse(JSON.stringify(projectToLoad.data)) as ProjectData;
            if (!Array.isArray(clonedData.globalVariables)) {
              clonedData.globalVariables = [{ name: 'score', value: 0 }];
            }
            const loadedActive = clonedData.scenes?.find(s => s.id === clonedData.activeSceneId) || clonedData.scenes?.[0];
            setPreviewMode(loadedActive?.sceneMode === '3d' ? '3d' : '2d');
            setProjectData(clonedData);
            projectDataRef.current = clonedData;
            setAppState('editor');
            setSelectedObjectId(null);
        }, 350);
    } else {
        showToast("No se pudo cargar el proyecto");
    }
  }, [projects, showToast]);

  const handleCreateProject = useCallback(async () => {
    const name = `Nuevo Proyecto ${projectsRef.current.length + 1}`;
    const newProject: Project = {
        id: `proj_${Date.now()}`,
        name,
        lastModified: Date.now(),
        data: createNewProjectData(t),
    };
    const updatedProjects = [...projectsRef.current, newProject];
    projectsRef.current = updatedProjects;
    setProjects(updatedProjects);
    await handleSaveProjects(updatedProjects);
    handleLoadProject(newProject.id, newProject);
  }, [t, handleSaveProjects, handleLoadProject]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    const updatedProjects = projectsRef.current.filter(p => p.id !== projectId);
    projectsRef.current = updatedProjects;
    setProjects(updatedProjects);
    await handleSaveProjects(updatedProjects);
  }, [handleSaveProjects]);
  
  const handleImportProject = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const result = e.target?.result as string;
        if (!result) throw new Error("File is empty");
        
        const importedData = JSON.parse(result);
        const data = importedData.data || importedData;
        
        if (data && data.scenes && Array.isArray(data.scenes)) {
          const newProject: Project = {
            id: `proj_${Date.now()}`,
            name: importedData.name || `Import_${Date.now()}`,
            lastModified: Date.now(),
            data: data,
          };
          
          const updatedProjects = [...projectsRef.current, newProject];
          projectsRef.current = updatedProjects;
          setProjects(updatedProjects);
          await handleSaveProjects(updatedProjects);
          showToast("Proyecto importado!");
        }
      } catch (error) {
        console.error("Error importing:", error);
        showToast("Archivo inválido");
      }
    };
    reader.readAsText(file);
  }, [handleSaveProjects, showToast]);

  const handleReturnToStart = useCallback(async () => {
    try {
        await handleSaveCurrentProject(false);
    } catch (e) {
        console.error("Error saving on return to start:", e);
    }
    setActiveProjectId(null);
    activeProjectIdRef.current = null;
    setProjectData(null);
    projectDataRef.current = null;
    setSelectedObjectId(null);
    setAppState('start');
  }, [handleSaveCurrentProject]);

  // Window unload and tab hide handler to ensure no changes are lost when exiting or refreshing
  useEffect(() => {
    const flushCurrentProject = () => {
        const activeId = activeProjectIdRef.current;
        const currentData = projectDataRef.current;
        if (activeId && currentData) {
            const updated = projectsRef.current.map(p => 
                p.id === activeId ? { ...p, data: currentData, lastModified: Date.now() } : p
            );
            projectsRef.current = updated;
            try {
                localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(updated));
            } catch (e) {}
            saveProjectsToStorage(updated).catch(() => {});
        }
    };

    window.addEventListener('beforeunload', flushCurrentProject);
    window.addEventListener('pagehide', flushCurrentProject);
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            flushCurrentProject();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        window.removeEventListener('beforeunload', flushCurrentProject);
        window.removeEventListener('pagehide', flushCurrentProject);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Keyboard shortcut: Ctrl+S / Cmd+S to save instantly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (appState === 'editor') {
                handleSaveCurrentProject(true);
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [appState, handleSaveCurrentProject]);

  const activeScene = projectData?.scenes.find(s => s.id === projectData.activeSceneId);

  const handleUpdateObject = useCallback((id: number, updates: Partial<GameObject>) => {
    updateProjectData(prev => {
        if (!prev) return prev;
        const currentActiveSceneId = prev.activeSceneId;
        return {
            ...prev,
            scenes: prev.scenes.map(scene => 
                scene.id === currentActiveSceneId 
                ? { ...scene, gameObjects: scene.gameObjects.map(obj => obj.id === id ? { ...obj, ...updates } : obj) }
                : scene
            )
        };
    });
  }, [updateProjectData]);
  
  const handleAddObject = useCallback((initialProps?: Partial<GameObject>) => {
      const createdId = initialProps?.id ? Number(initialProps.id) : createUniqueId();
      updateProjectData(prev => {
          if (!prev) return prev;
          const targetScene = prev.scenes.find(s => s.id === prev.activeSceneId) || prev.scenes[0];
          if (!targetScene) return prev;
          const newObject: GameObject = {
              id: createdId,
              name: `Objeto_${targetScene.gameObjects.length + 1}`,
              x: 200, y: 200, width: 50, height: 50,
              color: '#eab308', zIndex: 1,
              ...initialProps
          };
          newObject.id = createdId;
          const updatedScene = { ...targetScene, gameObjects: [...targetScene.gameObjects, newObject] };
          return {
              ...prev,
              scenes: prev.scenes.map(s => s.id === targetScene.id ? updatedScene : s),
          };
      });
      setSelectedObjectId(createdId);
  }, [updateProjectData]);

  const handleDeleteObject = useCallback((id: number) => {
      updateProjectData(prev => {
          if (!prev) return prev;
          const targetScene = prev.scenes.find(s => s.id === prev.activeSceneId);
          if (!targetScene) return prev;
          const updatedObjects = targetScene.gameObjects.filter(obj => obj.id !== id);
          const updatedScene = { ...targetScene, gameObjects: updatedObjects };
          return {
              ...prev,
              scenes: prev.scenes.map(s => s.id === targetScene.id ? updatedScene : s),
          };
      });
      setSelectedObjectId(prev => (prev === id ? null : prev));
  }, [updateProjectData]);

  const handleCloneObject = (id: number) => {
    const curScene = projectDataRef.current?.scenes.find(s => s.id === projectDataRef.current?.activeSceneId);
    if (!curScene) return;
    const objectToClone = curScene.gameObjects.find(o => o.id === id);
    if (!objectToClone) return;
    const cloned: GameObject = JSON.parse(JSON.stringify(objectToClone));
    cloned.id = createUniqueId();
    cloned.name = `${objectToClone.name}_copia`;
    cloned.x = (objectToClone.x ?? 0) + 24;
    cloned.y = (objectToClone.y ?? 0) + 24;
    if (cloned.position3D) {
      cloned.position3D = {
        x: cloned.position3D.x + 1,
        y: cloned.position3D.y,
        z: cloned.position3D.z + 1,
      };
    }
    handleAddObject(cloned);
  };
  
  const handleAddAsset = useCallback((asset: GameAsset) => {
      updateProjectData(prev => ({
          ...prev,
          assets: [...(prev.assets ?? []), asset]
      }));
  }, [updateProjectData]);

  const handleUpdateAsset = useCallback((asset: GameAsset) => {
      updateProjectData(prev => ({
          ...prev,
          assets: (prev.assets ?? []).map(a => a.id === asset.id ? asset : a)
      }));
  }, [updateProjectData]);

  const handleDeleteAsset = useCallback((assetId: string) => {
      updateProjectData(prev => {
          const assetsList = prev.assets ?? [];
          const target = assetsList.find(a => a.id === assetId);
          if (!target) return prev;
          const remainingAssets = assetsList.filter(a => a.id !== assetId);
          const urlStillUsed = remainingAssets.some(a => a.url === target.url);
          const clearUrl = !urlStillUsed ? target.url : null;

          const cleanObject = (obj: GameObject): GameObject => {
              let changed = false;
              const next = { ...obj };
              if (next.assetId === assetId) {
                  delete next.assetId;
                  changed = true;
              }
              if (clearUrl) {
                  if (next.imageUrl === clearUrl) {
                      delete next.imageUrl;
                      if (!next.color || next.color === 'transparent') next.color = '#eab308';
                      changed = true;
                  }
                  if (next.videoUrl === clearUrl) {
                      delete next.videoUrl;
                      if (!next.color || next.color === 'transparent') next.color = '#eab308';
                      changed = true;
                  }
                  if (next.modelUrl === clearUrl) {
                      delete next.modelUrl;
                      changed = true;
                  }
              }
              return changed ? next : obj;
          };

          return {
              ...prev,
              assets: remainingAssets,
              scenes: prev.scenes.map(sc => ({
                  ...sc,
                  skyboxImageUrl: clearUrl && sc.skyboxImageUrl === clearUrl ? undefined : sc.skyboxImageUrl,
                  backgroundMusicId: sc.backgroundMusicId === assetId ? undefined : sc.backgroundMusicId,
                  gameObjects: sc.gameObjects.map(cleanObject),
              })),
              globalObjects: (prev.globalObjects ?? []).map(cleanObject),
              joystick: prev.joystick ? {
                  ...prev.joystick,
                  backgroundImageUrl: clearUrl && prev.joystick.backgroundImageUrl === clearUrl ? undefined : prev.joystick.backgroundImageUrl,
                  handleImageUrl: clearUrl && prev.joystick.handleImageUrl === clearUrl ? undefined : prev.joystick.handleImageUrl,
              } : prev.joystick,
          };
      });
      showToast("Archivo eliminado");
  }, [updateProjectData, showToast]);

  const handleOpenSpriteEditor = (assetId: string | null) => {
      setEditingSpriteAssetId(assetId);
      setShowSpriteEditor(true);
  };

  const handleChangeSceneMode = useCallback((mode: '2d' | '3d') => {
    setPreviewMode(mode);
    updateProjectData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(s => s.id === prev.activeSceneId ? { ...s, sceneMode: mode } : s),
      };
    });
  }, [updateProjectData]);

  const handleStartPlay = useCallback(() => {
    prePlaySceneIdRef.current = projectDataRef.current?.activeSceneId ?? null;
    setAppState('playing');
  }, []);

  const handleExitPlay = useCallback(() => {
    const preSceneId = prePlaySceneIdRef.current;
    if (preSceneId && projectDataRef.current?.scenes.some(s => s.id === preSceneId) && projectDataRef.current.activeSceneId !== preSceneId) {
      updateProjectData({ activeSceneId: preSceneId });
    }
    setAppState('editor');
  }, [updateProjectData]);

  if (appState === 'loading') return <SplashScreen />;
  if (appState === 'start') {
      return (
            <StartScreen 
                projects={projects} 
                onLoadProject={handleLoadProject} 
                onCreateProject={handleCreateProject} 
                onDeleteProject={handleDeleteProject} 
                onImportProject={handleImportProject}
                onUpdateProjectIcon={(projectId, icon) => {
                    const updatedProjects = projectsRef.current.map(p => p.id === projectId ? { ...p, icon, lastModified: Date.now() } : p);
                    projectsRef.current = updatedProjects;
                    setProjects(updatedProjects);
                    handleSaveProjects(updatedProjects);
                }}
                onOpenPrivacyPolicy={() => setShowPrivacyPolicy(true)}
            />
      );
  }
  
  const selectedObject = activeScene?.gameObjects.find(obj => obj.id === selectedObjectId) || null;
  const editingSpriteAsset = projectData?.assets.find(a => a.id === editingSpriteAssetId) || null;
  const activeSceneMode: '2d' | '3d' =
    activeScene?.sceneMode === '3d'
      ? '3d'
      : activeScene?.sceneMode === '2d'
        ? '2d'
        : previewMode || '2d';

  const isPlayingNow = appState === 'playing';
  const is3DPaused = isPlayingNow || showPoseAnimationEditor;

  return (
    <>
      {isPlayingNow && activeScene && (
        <GameView 
            scene={activeScene}
            sceneMode={activeSceneMode}
            allScenes={projectData?.scenes ?? []}
            animations={projectData?.animations ?? []}
            assets={projectData?.assets ?? []}
            globalObjects={projectData?.globalObjects ?? []}
            globalVariables={projectData?.globalVariables ?? []}
            gameWidth={projectData?.gameWidth ?? 1024}
            gameHeight={projectData?.gameHeight ?? 768}
            responsive={projectData?.responsive}
            joystick={projectData?.joystick}
            projectData={projectData}
            onExit={handleExitPlay}
            onGoToScene={(nameOrId) => {
              const target = projectDataRef.current?.scenes.find(s => s.name === nameOrId || s.id === nameOrId);
              if (target) {
                setPreviewMode(target.sceneMode === '3d' ? '3d' : '2d');
                updateProjectData({ activeSceneId: target.id });
              }
            }}
        />
      )}

      <div className={`${isPlayingNow ? 'hidden' : 'flex'} flex-col h-screen bg-[#111111] text-[#e0e0e0] font-sans selection:bg-indigo-500/30`}>
        <Header 
            onSave={() => handleSaveCurrentProject(true)}
            isPlaying={isPlayingNow}
            onTogglePlay={isPlayingNow ? handleExitPlay : handleStartPlay}
            onExport={() => {
                setExportModalInitialShowCode(false);
                setShowExportModal(true);
            }}
            onViewCode={() => {
                setExportModalInitialShowCode(true);
                setShowExportModal(true);
            }}
            onReturnToStart={handleReturnToStart}
            onImportProject={handleImportProject}
            projectName={projects.find(p => p.id === activeProjectId)?.name ?? 'Untitled Project'}
            onUpdateProjectName={(newName) => {
                const activeId = activeProjectIdRef.current;
                if (!activeId) return;
                const updatedProjects = projectsRef.current.map(p => p.id === activeId ? { ...p, name: newName, lastModified: Date.now() } : p);
                projectsRef.current = updatedProjects;
                setProjects(updatedProjects);
                handleSaveProjects(updatedProjects);
            }}
            projectIcon={projects.find(p => p.id === activeProjectId)?.icon ?? '🎮'}
            onUpdateProjectIcon={(newIcon) => {
                const activeId = activeProjectIdRef.current;
                if (!activeId) return;
                const updatedProjects = projectsRef.current.map(p => p.id === activeId ? { ...p, icon: newIcon, lastModified: Date.now() } : p);
                projectsRef.current = updatedProjects;
                setProjects(updatedProjects);
                handleSaveProjects(updatedProjects);
            }}
            activeScene={activeScene}
            projectData={projectData}
            onUpdateProjectData={updateProjectData}
            onAddObject={handleAddObject}
            sceneMode={activeSceneMode}
            onChangeSceneMode={handleChangeSceneMode}
            onOpenCharacterSkins={() => setShowCharacterSkinsEditor(true)}
            onOpenPoseAnimationEditor={() => setShowPoseAnimationEditor(true)}
            onOpenPrivacyPolicy={() => setShowPrivacyPolicy(true)}
        />
        
        <main className="flex-grow flex h-full overflow-hidden relative">
            {/* Godot Style Lateral Panels */}
            <AnimatePresence mode="popLayout">
                {(!isMobile || activeMobilePanel === 'hierarchy') && (
                    <motion.div 
                        layout
                        initial={isMobile ? { x: -300 } : { width: hierarchyWidth }}
                        animate={isMobile ? { x: 0 } : { width: isHierarchyCollapsed ? 32 : hierarchyWidth }}
                        exit={{ x: -400 }}
                        className={`bg-[#202020] border-r border-[#333333] shrink-0 z-40 ${isMobile ? 'fixed inset-y-16 left-0 w-80' : 'relative'}`}
                    >
                        <SceneHierarchy 
                            scenes={projectData?.scenes ?? []}
                            activeSceneId={projectData?.activeSceneId ?? null}
                            onSelectScene={(id) => {
                                const target = projectDataRef.current?.scenes.find(s => s.id === id);
                                if (target) setPreviewMode(target.sceneMode === '3d' ? '3d' : '2d');
                                updateProjectData({ activeSceneId: id });
                            }}
                            onAddScene={() => {
                                const newScene = createNewScene(t('starter.sceneName') || `Scene ${(projectDataRef.current?.scenes.length ?? 0) + 1}`);
                                setPreviewMode(newScene.sceneMode === '3d' ? '3d' : '2d');
                                updateProjectData(prev => ({
                                    ...prev,
                                    scenes: [...prev.scenes, newScene],
                                    activeSceneId: newScene.id
                                }));
                            }}
                            onCloneScene={(sceneId) => {
                                updateProjectData(prev => {
                                    const sceneToClone = prev.scenes.find(s => s.id === sceneId);
                                    if (!sceneToClone) return prev;
                                    const baseTime = Date.now();
                                    const clonedScene = {
                                        ...sceneToClone,
                                        id: `scene_${baseTime}_cloned`,
                                        name: `${sceneToClone.name} - Copia`,
                                        gameObjects: sceneToClone.gameObjects.map((obj, i) => ({
                                            ...obj,
                                            id: baseTime + i + 1
                                        })),
                                        events: sceneToClone.events.map((ev, i) => ({
                                            ...ev,
                                            id: `ev_${baseTime}_${i + 1}`
                                        }))
                                    };
                                    setPreviewMode(clonedScene.sceneMode === '3d' ? '3d' : '2d');
                                    return {
                                        ...prev,
                                        scenes: [...prev.scenes, clonedScene],
                                        activeSceneId: clonedScene.id
                                    };
                                });
                            }}
                            onDeleteScene={(sceneId) => {
                                updateProjectData(prev => {
                                    if (prev.scenes.length <= 1) {
                                        showToast("No puedes borrar la única escena que tienes.");
                                        return prev;
                                    }
                                    const remaining = prev.scenes.filter(s => s.id !== sceneId);
                                    const nextActive = prev.activeSceneId === sceneId ? remaining[0].id : prev.activeSceneId;
                                    const nextScene = remaining.find(s => s.id === nextActive);
                                    if (nextScene) setPreviewMode(nextScene.sceneMode === '3d' ? '3d' : '2d');
                                    return {
                                        ...prev,
                                        scenes: remaining,
                                        activeSceneId: nextActive
                                    };
                                });
                            }}
                            objects={activeScene?.gameObjects ?? []}
                            globalObjects={projectData?.globalObjects ?? []}
                            onAddObject={handleAddObject}
                            selectedId={selectedObjectId}
                            onSelect={setSelectedObjectId}
                            onUpdateObject={handleUpdateObject}
                            assets={projectData?.assets ?? []}
                            onAddAsset={handleAddAsset}
                            onUpdateAsset={handleUpdateAsset}
                            onDeleteAsset={handleDeleteAsset}
                            onOpenAnimationEditor={() => setShowAnimationEditor(true)}
                            onOpenPoseAnimationEditor={() => setShowPoseAnimationEditor(true)}
                            onOpenSpriteEditor={handleOpenSpriteEditor}
                            onOpenAudioLab={() => setShowAudioLab(true)}
                            onOpenSoundtrackEditor={() => setShowSoundtrackEditor(true)}
                            width={isHierarchyCollapsed ? 32 : hierarchyWidth}
                            onToggleCollapse={() => setIsHierarchyCollapsed(!isHierarchyCollapsed)}
                            projectData={projectData}
                            onUpdateProjectData={updateProjectData}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-grow flex flex-col relative bg-[#181818] overflow-hidden">
                <SceneEditor
                    scene={activeScene}
                    objects={activeScene?.gameObjects ?? []}
                    selectedId={selectedObjectId}
                    onSelect={setSelectedObjectId}
                    onUpdateObject={handleUpdateObject}
                    onAddObject={handleAddObject}
                    onOpenEventEditor={() => setShowEventEditor(true)}
                    assets={projectData?.assets ?? []}
                    gameWidth={projectData?.gameWidth ?? 1024}
                    gameHeight={projectData?.gameHeight ?? 768}
                    globalObjects={projectData?.globalObjects ?? []}
                    sceneMode={activeSceneMode}
                    onChangeSceneMode={handleChangeSceneMode}
                    is3DPaused={is3DPaused}
                    camera3DCacheRef={camera3DCacheRef}
                />
                
                {/* Mobile Panel Toggle */}
                {isMobile && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex bg-[#252525] border border-white/10 rounded-full p-1 shadow-2xl z-50">
                        <button onClick={() => setActiveMobilePanel('hierarchy')} className={`px-4 py-2 rounded-full text-xs font-bold transition-colors ${activeMobilePanel === 'hierarchy' ? 'bg-indigo-600' : 'hover:bg-white/5'}`}>SCENE</button>
                        <button onClick={() => setActiveMobilePanel('editor')} className={`px-4 py-2 rounded-full text-xs font-bold transition-colors ${activeMobilePanel === 'editor' ? 'bg-indigo-600' : 'hover:bg-white/5'}`}>VIEW</button>
                        <button onClick={() => setActiveMobilePanel('inspector')} className={`px-4 py-2 rounded-full text-xs font-bold transition-colors ${activeMobilePanel === 'inspector' ? 'bg-indigo-600' : 'hover:bg-white/5'}`}>PROPS</button>
                    </div>
                )}
            </div>

            <AnimatePresence mode="popLayout">
                {(!isMobile || activeMobilePanel === 'inspector') && (
                    <motion.div 
                        layout
                        initial={isMobile ? { x: 300 } : { width: inspectorWidth }}
                        animate={isMobile ? { x: 0 } : { width: isInspectorCollapsed ? 32 : inspectorWidth }}
                        exit={{ x: 400 }}
                        className={`bg-[#202020] border-l border-[#333333] shrink-0 z-40 ${isMobile ? 'fixed inset-y-16 right-0 w-80' : 'relative'}`}
                    >
                        <PropertiesInspector 
                            selectedObject={selectedObject}
                            projectData={projectData!}
                            onUpdateProjectData={updateProjectData}
                            onUpdateObject={handleUpdateObject}
                            onDeleteObject={handleDeleteObject}
                            onCloneObject={handleCloneObject}
                            onSaveAsGlobalObject={(obj) => {
                                updateProjectData(prev => {
                                    const list = prev.globalObjects ?? [];
                                    const exists = list.some(o => o.name === obj.name);
                                    return {
                                        ...prev,
                                        globalObjects: exists ? list.map(o => o.name === obj.name ? obj : o) : [...list, obj]
                                    };
                                });
                                showToast("Guardado como objeto global");
                            }}
                            onAddAsset={handleAddAsset}
                            onDeleteAsset={handleDeleteAsset}
                            width={isInspectorCollapsed ? 32 : inspectorWidth}
                            onToggleCollapse={() => setIsInspectorCollapsed(!isInspectorCollapsed)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </main>
        
        {/* Modals & Overlays */}
        {showExportModal && <ExportModal 
            onClose={() => setShowExportModal(false)} 
            projectData={projectData} 
            initialShowCode={exportModalInitialShowCode}
        />}
        {showEventEditor && <EventEditor 
            onClose={() => setShowEventEditor(false)}
            scene={activeScene}
            allScenes={projectData?.scenes ?? []}
            animations={projectData?.animations ?? []}
            poseAnimations={projectData?.poseAnimations ?? []}
            assets={projectData?.assets ?? []}
            globalObjects={projectData?.globalObjects ?? []}
            globalVariables={projectData?.globalVariables ?? []}
            onUpdateGlobalVariables={(globalVariables) => updateProjectData({ globalVariables })}
            onAddEvent={(e) => {
                updateProjectData(prev => {
                    const targetSceneId = prev.activeSceneId;
                    return {
                        ...prev,
                        scenes: prev.scenes.map(s => s.id === targetSceneId ? { ...s, events: [...s.events, e] } : s)
                    };
                });
            }}
            onDeleteEvent={(id) => {
                updateProjectData(prev => {
                    const targetSceneId = prev.activeSceneId;
                    return {
                        ...prev,
                        scenes: prev.scenes.map(s => s.id === targetSceneId ? { ...s, events: s.events.filter(ev => ev.id !== id) } : s)
                    };
                });
            }}
            onUpdateEvent={(e) => {
                updateProjectData(prev => {
                    const targetSceneId = prev.activeSceneId;
                    return {
                        ...prev,
                        scenes: prev.scenes.map(s => s.id === targetSceneId ? { ...s, events: s.events.map(ev => ev.id === e.id ? e : ev) } : s)
                    };
                });
            }}
        />}
        {showAnimationEditor && <AnimationEditor
            onClose={() => setShowAnimationEditor(false)}
            animations={projectData?.animations ?? []}
            assets={projectData?.assets ?? []}
            onSave={(animations) => updateProjectData({ animations })}
            onCreateObject={handleAddObject}
        />}
        {showPoseAnimationEditor && <PoseAnimationEditor
            onClose={() => setShowPoseAnimationEditor(false)}
            assets={projectData?.assets ?? []}
            onAddAsset={handleAddAsset}
            initialPoseAnimations={projectData?.poseAnimations ?? []}
            selectedObject={selectedObject ?? undefined}
            onApplyPoseToSelectedObject={(frame: PoseFrame) => {
                if (!selectedObject) return;
                const curPos = getObject3DPosition(selectedObject);
                const curRot = getObject3DRotation(selectedObject);
                const curDims = getObject3DDimensions(selectedObject);
                const nextScale3D = {
                    x: Number(Math.max(0.05, curDims.w * (frame.scale.x || 1)).toFixed(3)),
                    y: Number(Math.max(0.05, curDims.h * (frame.scale.y || 1)).toFixed(3)),
                    z: Number(Math.max(0.05, curDims.d * (frame.scale.z || 1)).toFixed(3)),
                };
                const nextObj: GameObject = {
                    ...selectedObject,
                    shape3D: frame.shape3D || selectedObject.shape3D || 'box',
                    modelUrl: frame.modelUrl || undefined,
                    animation3D: frame.modelAnimName || selectedObject.animation3D,
                    color: frame.color || selectedObject.color,
                    emissive3D: frame.emissive3D !== undefined ? frame.emissive3D : selectedObject.emissive3D,
                    emissiveIntensity3D: frame.emissiveIntensity3D !== undefined ? frame.emissiveIntensity3D : selectedObject.emissiveIntensity3D,
                    position3D: {
                        x: Number((curPos.x + (frame.position.x || 0)).toFixed(3)),
                        y: Number((curPos.y + (frame.position.y || 0)).toFixed(3)),
                        z: Number((curPos.z + (frame.position.z || 0)).toFixed(3)),
                    },
                    rotation3D: {
                        x: curRot.x + ((frame.rotation.x || 0) * Math.PI) / 180,
                        y: curRot.y + ((frame.rotation.y || 0) * Math.PI) / 180,
                        z: curRot.z + ((frame.rotation.z || 0) * Math.PI) / 180,
                    },
                    scale3D: nextScale3D,
                    width: Math.max(10, Math.round(nextScale3D.x * 50)),
                    height: Math.max(10, Math.round(nextScale3D.z * 50)),
                };
                sync3DTo2D(nextObj);
                handleUpdateObject(selectedObject.id, nextObj);
                showToast(`Pose, modelo y animación 3D aplicados a "${selectedObject.name}"`);
            }}
            onSave={(poseAnimations) => {
                updateProjectData({ poseAnimations });
                setShowPoseAnimationEditor(false);
                showToast("Animaciones de Poses 3D guardadas con éxito");
            }}
        />}
        {showSpriteEditor && <SpriteEditor 
            assetToEdit={editingSpriteAsset}
            onSave={(asset) => {
                const existing = projectDataRef.current?.assets.find(a => a.id === asset.id);
                if (existing) handleUpdateAsset(asset);
                else handleAddAsset(asset);
                setShowSpriteEditor(false);
            }}
            onClose={() => setShowSpriteEditor(false)}
        />}
        {showAudioLab && <AudioLab onClose={() => setShowAudioLab(false)} onAddAsset={handleAddAsset} />}
        {showSoundtrackEditor && <SoundtrackEditor onClose={() => setShowSoundtrackEditor(false)} onAddAsset={handleAddAsset} />}
        {showCharacterSkinsEditor && (
            <CharacterSkinsEditor 
                isOpen={showCharacterSkinsEditor}
                onClose={() => setShowCharacterSkinsEditor(false)}
                projectData={projectData!}
                onUpdateProjectData={updateProjectData}
            />
        )}
        <PrivacyPolicyModal 
            isOpen={showPrivacyPolicy} 
            onClose={() => setShowPrivacyPolicy(false)} 
        />
        <PrototypeNoticeModal />
        
        <Toast message={toast.message} show={toast.show} />
      </div>
    </>
  );
};

export default App;
