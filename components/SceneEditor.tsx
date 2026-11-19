import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { GameObject, GameAsset, Scene } from '../types';
import {
  Monitor,
  Zap,
  Maximize,
  MousePointer2,
  Hand,
  RotateCw,
  Layers,
  Box,
  ZoomIn,
  ZoomOut,
  EyeOff,
} from 'lucide-react';
import { useLanguage } from '../LanguageContext';
import SceneEditor3D, { type Camera3DSnapshot } from './SceneEditor3D';
import { createUniqueId } from '../utils/threeObjectBuilder';

interface SceneEditorProps {
  scene: Scene | undefined;
  objects: GameObject[];
  assets: GameAsset[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onUpdateObject: (id: number, updates: Partial<GameObject>) => void;
  onAddObject: (initialProps?: Partial<GameObject>) => void;
  onOpenEventEditor: () => void;
  gameWidth: number;
  gameHeight: number;
  globalObjects?: GameObject[];
  sceneMode?: '2d' | '3d';
  onChangeSceneMode?: (mode: '2d' | '3d') => void;
  is3DPaused?: boolean;
  camera3DCacheRef?: React.MutableRefObject<Map<string, Camera3DSnapshot>>;
}

type GameObjectWithAbsPos = GameObject & { absPos: { x: number; y: number } };
type Tool2D = 'select' | 'pan' | 'rotate';

const SceneEditor: React.FC<SceneEditorProps> = ({
  scene,
  objects,
  assets,
  selectedId,
  onSelect,
  onUpdateObject,
  onAddObject,
  onOpenEventEditor,
  gameWidth,
  gameHeight,
  globalObjects,
  sceneMode,
  onChangeSceneMode,
  is3DPaused = false,
  camera3DCacheRef,
}) => {
  const { t } = useLanguage();
  const activeMode: '2d' | '3d' = sceneMode ?? scene?.sceneMode ?? '2d';

  const sceneRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<Tool2D>('select');
  const activeToolRef = useRef<Tool2D>(activeTool);
  activeToolRef.current = activeTool;

  const [draggingState, setDraggingState] = useState<{
    type: 'move' | 'rotate';
    id: number;
    offsetX?: number;
    offsetY?: number;
    parentAbsolutePos?: { x: number; y: number };
    center?: { x: number; y: number };
    startAngle?: number;
  } | null>(null);
  const draggingStateRef = useRef(draggingState);
  draggingStateRef.current = draggingState;

  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewOffsetRef = useRef(viewOffset);
  viewOffsetRef.current = viewOffset;

  const [isPanning, setIsPanning] = useState(false);
  const isSpacePressed = useRef(false);
  const [isAssetDragOver, setIsAssetDragOver] = useState(false);
  const [dragOverObjectId, setDragOverObjectId] = useState<number | null>(null);
  const pinchStateRef = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);
  const touchPanStartRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; didPan: boolean } | null>(null);
  const hasDraggedRef = useRef(false);

  const [localObjects, setLocalObjects] = useState<GameObject[]>(objects);
  const localObjectsRef = useRef<GameObject[]>(objects);

  useEffect(() => {
    localObjectsRef.current = localObjects;
  }, [localObjects]);

  const centerView = useCallback(() => {
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect || sceneRect.width < 10 || sceneRect.height < 10) return;

    const pad = 40;
    const fitZoomX = Math.max(0.1, (sceneRect.width - pad) / gameWidth);
    const fitZoomY = Math.max(0.1, (sceneRect.height - pad) / gameHeight);
    const fitZoom = Math.min(fitZoomX, fitZoomY, 1.1);

    setZoom(fitZoom);
    const ox = (sceneRect.width / fitZoom - gameWidth) / 2;
    const oy = (sceneRect.height / fitZoom - gameHeight) / 2;
    setViewOffset({ x: ox, y: oy });
  }, [gameWidth, gameHeight]);

  // Only center on initial mount or scene change — never reset zoom/pan on panel collapse or mobile keyboard resize
  const centeredSceneRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeMode !== '2d') return;
    const currentId = scene?.id ?? '__default__';
    if (centeredSceneRef.current === currentId) return;
    const timer = setTimeout(() => {
      centerView();
      centeredSceneRef.current = currentId;
    }, 80);
    return () => clearTimeout(timer);
  }, [activeMode, scene?.id, centerView]);

  const localObjectsWithAbsPos = useMemo((): GameObjectWithAbsPos[] => {
    const objectsById = new Map<number, GameObject>(localObjects.map((o) => [o.id, o]));
    const posCache = new Map<number, { x: number; y: number }>();
    const visiting = new Set<number>();

    const getPos = (objId: number): { x: number; y: number } => {
      if (posCache.has(objId)) return posCache.get(objId)!;
      if (visiting.has(objId)) return { x: 0, y: 0 };

      const obj = objectsById.get(objId);
      if (!obj) return { x: 0, y: 0 };

      if (obj.isUI || !obj.parentId || !objectsById.has(obj.parentId)) {
        const pos = { x: obj.x, y: obj.y };
        posCache.set(objId, pos);
        return pos;
      }

      visiting.add(objId);
      const parentPos = getPos(obj.parentId);
      visiting.delete(objId);
      const pos = { x: parentPos.x + obj.x, y: parentPos.y + obj.y };
      posCache.set(objId, pos);
      return pos;
    };

    return localObjects.map((obj) => ({
      ...obj,
      absPos: getPos(obj.id),
    }));
  }, [localObjects]);

  useEffect(() => {
    if (!draggingStateRef.current) {
      setLocalObjects(objects);
      localObjectsRef.current = objects;
    }
  }, [objects]);

  const getSceneCoords = useCallback((e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect) return { x: 0, y: 0 };
    const mouseX = e.clientX - sceneRect.left;
    const mouseY = e.clientY - sceneRect.top;
    const z = zoomRef.current;
    const vo = viewOffsetRef.current;
    return {
      x: mouseX / z - vo.x,
      y: mouseY / z - vo.y,
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        isSpacePressed.current = true;
        sceneRef.current?.classList.add('cursor-grab');
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed.current = false;
        sceneRef.current?.classList.remove('cursor-grab', 'cursor-grabbing');
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const beginRotateForPoint = (clientX: number, clientY: number, object: GameObjectWithAbsPos) => {
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect) return;
    const z = zoomRef.current;
    const vo = viewOffsetRef.current;
    const centerX = sceneRect.left + (vo.x + object.absPos.x + object.width / 2) * z;
    const centerY = sceneRect.top + (vo.y + object.absPos.y + object.height / 2) * z;
    const startAngleRad = Math.atan2(clientY - centerY, clientX - centerX);
    const initialObjectRotationRad = (object.rotation || 0) * (Math.PI / 180);
    setDraggingState({
      type: 'rotate',
      id: object.id,
      center: { x: centerX, y: centerY },
      startAngle: startAngleRad - initialObjectRotationRad,
    });
  };

  const handleObjectMouseDown = (e: React.MouseEvent<HTMLDivElement>, obj: GameObjectWithAbsPos) => {
    if (activeToolRef.current === 'pan' || isSpacePressed.current || e.button === 1 || e.button === 2) {
      return; // allow scene pan underneath
    }
    e.stopPropagation();
    if (isPanning) return;
    hasDraggedRef.current = false;
    onSelect(obj.id);

    if (activeToolRef.current === 'rotate') {
      beginRotateForPoint(e.clientX, e.clientY, obj);
      return;
    }

    const parent = obj.parentId ? localObjectsWithAbsPos.find((o) => o.id === obj.parentId) : null;
    const parentAbsolutePos = parent ? parent.absPos : { x: 0, y: 0 };
    const { x: mouseWorldX, y: mouseWorldY } = getSceneCoords(e);
    setDraggingState({
      type: 'move',
      id: obj.id,
      offsetX: mouseWorldX - obj.absPos.x,
      offsetY: mouseWorldY - obj.absPos.y,
      parentAbsolutePos,
    });
  };

  const handleRotationStart = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!selectedId) return;
    const object = localObjectsWithAbsPos.find((o) => o.id === selectedId);
    if (!object) return;
    beginRotateForPoint(e.clientX, e.clientY, object);
  };

  const handleRotationTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!selectedId || e.touches.length !== 1) return;
    const object = localObjectsWithAbsPos.find((o) => o.id === selectedId);
    if (!object) return;
    beginRotateForPoint(e.touches[0].clientX, e.touches[0].clientY, object);
  };

  const handleObjectTouchStart = (e: React.TouchEvent<HTMLDivElement>, obj: GameObjectWithAbsPos) => {
    if (activeToolRef.current === 'pan') return;
    e.stopPropagation();
    hasDraggedRef.current = false;

    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      setDraggingState(null);
      pinchStateRef.current = {
        dist: Math.max(1, Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)),
        mid: { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 },
      };
      return;
    }
    if (e.touches.length !== 1) return;

    onSelect(obj.id);
    if (activeToolRef.current === 'rotate') {
      beginRotateForPoint(e.touches[0].clientX, e.touches[0].clientY, obj);
      return;
    }

    const parent = obj.parentId ? localObjectsWithAbsPos.find((o) => o.id === obj.parentId) : null;
    const parentAbsolutePos = parent ? parent.absPos : { x: 0, y: 0 };
    const { x: touchWorldX, y: touchWorldY } = getSceneCoords(e.touches[0]);
    setDraggingState({
      type: 'move',
      id: obj.id,
      offsetX: touchWorldX - obj.absPos.x,
      offsetY: touchWorldY - obj.absPos.y,
      parentAbsolutePos,
    });
  };

  const handleSceneMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && (isSpacePressed.current || activeToolRef.current === 'pan'))) {
      e.preventDefault();
      setIsPanning(true);
      sceneRef.current?.classList.add('cursor-grabbing');
    } else if (e.button === 0) {
      onSelect(null);
    }
  };

  const handleSceneTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      setIsPanning(false);
      setDraggingState(null);
      touchPanStartRef.current = null;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      pinchStateRef.current = {
        dist: Math.max(1, Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY)),
        mid: { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 },
      };
    } else if (e.touches.length === 1) {
      touchPanStartRef.current = {
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        lastX: e.touches[0].clientX,
        lastY: e.touches[0].clientY,
        didPan: false,
      };
    }
  };

  useEffect(() => {
    if (activeMode !== '2d') return;

    const handleMove = (coords: { clientX: number; clientY: number }) => {
      const ds = draggingStateRef.current;
      if (!ds) return;

      if (ds.type === 'move') {
        hasDraggedRef.current = true;
        const objectBeingDragged = localObjectsRef.current.find((o) => o.id === ds.id);
        if (!objectBeingDragged) return;

        const { x: worldX, y: worldY } = getSceneCoords(coords);
        let newAbsoluteX = worldX - ds.offsetX!;
        let newAbsoluteY = worldY - ds.offsetY!;

        if (objectBeingDragged.isUI) {
          newAbsoluteX = Math.max(0, Math.min(newAbsoluteX, gameWidth - objectBeingDragged.width));
          newAbsoluteY = Math.max(0, Math.min(newAbsoluteY, gameHeight - objectBeingDragged.height));
        }

        const newX = newAbsoluteX - (ds.parentAbsolutePos?.x || 0);
        const newY = newAbsoluteY - (ds.parentAbsolutePos?.y || 0);
        const roundedX = Math.round(newX);
        const roundedY = Math.round(newY);

        setLocalObjects((currentObjects) => {
          const updated = currentObjects.map((obj) =>
            obj.id === ds.id ? { ...obj, x: roundedX, y: roundedY } : obj
          );
          localObjectsRef.current = updated;
          return updated;
        });
      } else if (ds.type === 'rotate') {
        hasDraggedRef.current = true;
        const { center, startAngle } = ds;
        const currentAngleRad = Math.atan2(coords.clientY - center!.y, coords.clientX - center!.x);
        const newRotationRad = currentAngleRad - startAngle!;
        const newRotationDeg = Math.round(newRotationRad * (180 / Math.PI) * 10) / 10;
        setLocalObjects((currentObjects) => {
          const updated = currentObjects.map((obj) =>
            obj.id === ds.id ? { ...obj, rotation: newRotationDeg } : obj
          );
          localObjectsRef.current = updated;
          return updated;
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isPanning) {
        const z = zoomRef.current;
        setViewOffset((prev) => ({
          x: prev.x + e.movementX / z,
          y: prev.y + e.movementY / z,
        }));
        return;
      }
      handleMove(e);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        if (draggingStateRef.current) {
          e.preventDefault();
          handleMove(e.touches[0]);
        } else if (touchPanStartRef.current) {
          e.preventDefault();
          const touch = e.touches[0];
          const pan = touchPanStartRef.current;
          if (!pan.didPan && Math.hypot(touch.clientX - pan.startX, touch.clientY - pan.startY) > 5) {
            pan.didPan = true;
          }
          if (pan.didPan) {
            const dx = touch.clientX - pan.lastX;
            const dy = touch.clientY - pan.lastY;
            const z = zoomRef.current;
            setViewOffset((prev) => ({
              x: prev.x + dx / z,
              y: prev.y + dy / z,
            }));
          }
          pan.lastX = touch.clientX;
          pan.lastY = touch.clientY;
        }
      } else if (e.touches.length === 2 && pinchStateRef.current) {
        e.preventDefault();
        const sceneRect = sceneRef.current?.getBoundingClientRect();
        if (!sceneRect) return;

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const prevMid = pinchStateRef.current.mid;
        const prevDist = Math.max(1, pinchStateRef.current.dist);
        const newMid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
        const newDist = Math.max(1, Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY));

        const oldZoom = zoomRef.current;
        const oldViewOffset = viewOffsetRef.current;
        const newZoom = Math.min(Math.max(0.1, oldZoom * (newDist / prevDist)), 4);
        const worldX = (prevMid.x - sceneRect.left) / oldZoom - oldViewOffset.x;
        const worldY = (prevMid.y - sceneRect.top) / oldZoom - oldViewOffset.y;
        const newViewOffsetX = (newMid.x - sceneRect.left) / newZoom - worldX;
        const newViewOffsetY = (newMid.y - sceneRect.top) / newZoom - worldY;

        zoomRef.current = newZoom;
        viewOffsetRef.current = { x: newViewOffsetX, y: newViewOffsetY };
        setZoom(newZoom);
        setViewOffset({ x: newViewOffsetX, y: newViewOffsetY });
        pinchStateRef.current = { dist: newDist, mid: newMid };
      }
    };

    const handleUp = () => {
      const ds = draggingStateRef.current;
      if (ds) {
        const finalObject = localObjectsRef.current.find((o) => o.id === ds.id);
        if (finalObject) {
          if (ds.type === 'move') {
            onUpdateObject(ds.id, { x: finalObject.x, y: finalObject.y });
          } else if (ds.type === 'rotate') {
            onUpdateObject(ds.id, { rotation: finalObject.rotation });
          }
        }
      } else if (touchPanStartRef.current && !touchPanStartRef.current.didPan && !pinchStateRef.current) {
        onSelect(null);
      }
      setIsPanning(false);
      setDraggingState(null);
      pinchStateRef.current = null;
      touchPanStartRef.current = null;
      sceneRef.current?.classList.remove('cursor-grabbing');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleUp);
    window.addEventListener('touchcancel', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleUp);
      window.removeEventListener('touchcancel', handleUp);
    };
  }, [activeMode, isPanning, getSceneCoords, onUpdateObject, onSelect, gameWidth, gameHeight]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/game-asset')) {
      e.dataTransfer.dropEffect = 'copy';
      setIsAssetDragOver(true);
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = () => {
    setIsAssetDragOver(false);
    setDragOverObjectId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsAssetDragOver(false);
    setDragOverObjectId(null);
    const objectIdString = e.dataTransfer.getData('application/game-object-id');
    const assetString = e.dataTransfer.getData('application/game-asset');
    const templateString = e.dataTransfer.getData('application/game-object-template');

    const { x: dropX, y: dropY } = getSceneCoords(e);

    if (templateString) {
      try {
        const templateObj = JSON.parse(templateString);
        onAddObject({
          ...templateObj,
          id: createUniqueId(),
          parentId: null,
          x: Math.round(dropX - (templateObj.width || 50) / 2),
          y: Math.round(dropY - (templateObj.height || 50) / 2),
        });
      } catch (err) {
        console.error('Error parsing template string', err);
      }
    } else if (objectIdString) {
      const id = Number(objectIdString);
      const object = localObjectsWithAbsPos.find((o) => o.id === id);
      if (!object) return;

      const parent = object.parentId ? localObjectsWithAbsPos.find((o) => o.id === object.parentId) : null;
      const parentAbsPos = parent ? parent.absPos : { x: 0, y: 0 };

      let newX = dropX - object.width / 2 - parentAbsPos.x;
      let newY = dropY - object.height / 2 - parentAbsPos.y;

      if (object.isUI) {
        newX = Math.max(0, Math.min(newX, gameWidth - object.width));
        newY = Math.max(0, Math.min(newY, gameHeight - object.height));
      }

      newX = Math.round(newX);
      newY = Math.round(newY);

      onUpdateObject(id, { x: newX, y: newY });
      setLocalObjects((prev) => {
        const updated = prev.map((o) => (o.id === id ? { ...o, x: newX, y: newY } : o));
        localObjectsRef.current = updated;
        return updated;
      });
    } else if (assetString) {
      try {
        const asset: GameAsset = JSON.parse(assetString);
        if (asset.type === 'image') {
          const defaultWidth = 50;
          const defaultHeight = 50;
          onAddObject({
            x: Math.round(dropX - defaultWidth / 2),
            y: Math.round(dropY - defaultHeight / 2),
            width: defaultWidth,
            height: defaultHeight,
            imageUrl: asset.url,
            color: 'transparent',
            name: asset.name.split('.').slice(0, -1).join('.') || 'ImageObject',
          });
        } else if (asset.type === 'video') {
          const defaultWidth = 160;
          const defaultHeight = 90;
          onAddObject({
            x: Math.round(dropX - defaultWidth / 2),
            y: Math.round(dropY - defaultHeight / 2),
            width: defaultWidth,
            height: defaultHeight,
            videoUrl: asset.url,
            videoLoop: true,
            videoAutoplay: true,
            color: 'transparent',
            name: asset.name.split('.').slice(0, -1).join('.') || 'VideoObject',
          });
        } else if (asset.type === '3d-model') {
          onAddObject({
            x: Math.round(dropX - 30),
            y: Math.round(dropY - 30),
            width: 60,
            height: 60,
            modelUrl: asset.url,
            shape3D: 'box',
            color: '#6366f1',
            name: asset.name.split('.').slice(0, -1).join('.') || 'Modelo3D',
          });
        }
      } catch (error) {
        console.error('Failed to parse dropped asset data:', error);
      }
    }
  };

  const applyZoomAroundPoint = (nextZoom: number, clientX?: number, clientY?: number) => {
    const sceneRect = sceneRef.current?.getBoundingClientRect();
    if (!sceneRect) {
      setZoom(nextZoom);
      return;
    }
    const px = clientX !== undefined ? clientX - sceneRect.left : sceneRect.width / 2;
    const py = clientY !== undefined ? clientY - sceneRect.top : sceneRect.height / 2;
    const oldZoom = zoomRef.current;
    const vo = viewOffsetRef.current;
    const worldXBefore = px / oldZoom - vo.x;
    const worldYBefore = py / oldZoom - vo.y;
    setZoom(nextZoom);
    setViewOffset({
      x: px / nextZoom - worldXBefore,
      y: py / nextZoom - worldYBefore,
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(0.1, zoomRef.current * zoomFactor), 4);
    applyZoomAroundPoint(newZoom, e.clientX, e.clientY);
  };

  const selectedObjectData = localObjectsWithAbsPos.find((o) => o.id === selectedId);

  const handleObjectDragOver = (e: React.DragEvent, objId: number) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/game-asset')) {
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDragOverObjectId(objId);
    }
  };

  const handleObjectDrop = (e: React.DragEvent, objId: number) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/game-asset')) {
      e.stopPropagation();
      setDragOverObjectId(null);
      const assetString = e.dataTransfer.getData('application/game-asset');
      if (!assetString) return;
      try {
        const asset: GameAsset = JSON.parse(assetString);
        if (asset.type === 'image') {
          onUpdateObject(objId, { imageUrl: asset.url, color: 'transparent', videoUrl: undefined });
        } else if (asset.type === 'video') {
          onUpdateObject(objId, { videoUrl: asset.url, color: 'transparent', imageUrl: undefined, videoLoop: true, videoAutoplay: true });
        } else if (asset.type === '3d-model') {
          onUpdateObject(objId, { modelUrl: asset.url });
        }
      } catch (error) {
        console.error('Failed to parse dropped asset data onto object:', error);
      }
    }
  };

  const resolveImageUrl = (obj: GameObject): string | undefined => {
    if (!obj.imageUrl && !obj.assetId) return undefined;
    const url = obj.imageUrl || '';
    if (url && (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/'))) {
      return url;
    }
    const assetId = obj.assetId || obj.imageUrl;
    const found = assets?.find((a) => String(a.id) === String(assetId) || a.name === assetId);
    if (found?.url) return found.url;
    return url || undefined;
  };

  const renderObject = (obj: GameObjectWithAbsPos) => {
    const isDraggingThis = draggingState?.id === obj.id;
    const resolvedImageUrl = resolveImageUrl(obj);
    const isNode = obj.color === 'transparent' && !resolvedImageUrl;
    const isDropTarget = dragOverObjectId === obj.id;
    const isHidden = obj.visible === false;
    const { absPos } = obj;

    const scaleX = (obj.scaleX ?? 1) * (obj.direction === 'left' ? -1 : 1);
    const scaleY = obj.scaleY ?? 1;

    const style: React.CSSProperties = {
      left: absPos.x,
      top: absPos.y,
      width: obj.width,
      height: obj.height,
      zIndex: isDraggingThis ? 1000 : obj.zIndex,
      backgroundColor: resolvedImageUrl || isNode ? 'transparent' : obj.color,
      transformOrigin: 'center',
      transform: `rotate(${obj.rotation || 0}deg) scale(${scaleX}, ${scaleY}) ${isDraggingThis && draggingState?.type === 'move' ? 'scale(1.03)' : ''}`,
      opacity: isDraggingThis ? 0.85 : isHidden ? 0.35 : (obj.opacity ?? 1),
      pointerEvents: 'auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      overflow: 'hidden',
      border: isHidden
        ? '1px dashed #f59e0b'
        : isNode
        ? `1px dashed ${selectedId === obj.id ? '#6366F1' : 'rgba(255, 255, 255, 0.5)'}`
        : isDropTarget
        ? '2px solid #6366F1'
        : 'none',
    };

    return (
      <div
        key={obj.id}
        onMouseDown={(e) => handleObjectMouseDown(e, obj)}
        onTouchStart={(e) => handleObjectTouchStart(e, obj)}
        onClick={(e) => {
          e.stopPropagation();
          if (!hasDraggedRef.current) {
            onSelect(obj.id);
          }
        }}
        onDragOver={(e) => handleObjectDragOver(e, obj.id)}
        onDrop={(e) => handleObjectDrop(e, obj.id)}
        onDragLeave={() => setDragOverObjectId(null)}
        className={`absolute ${activeTool === 'pan' ? 'cursor-grab' : 'cursor-grab'} ${isDraggingThis ? 'cursor-grabbing' : ''}`}
        style={style}
      >
        {resolvedImageUrl && (
          <img
            src={resolvedImageUrl}
            alt={obj.name}
            className="w-full h-full object-contain pointer-events-none select-none"
            draggable={false}
            referrerPolicy="no-referrer"
          />
        )}
        {(obj.modelUrl || obj.shape3D) && (
          <div className="absolute top-0.5 right-0.5 bg-indigo-600 text-[8px] font-black text-white px-1 py-0.5 rounded shadow border border-white/20 select-none uppercase tracking-wider z-20">
            3D
          </div>
        )}
        {isHidden && (
          <div className="absolute bottom-0.5 left-0.5 bg-amber-950/90 text-amber-300 px-1 py-0.5 rounded text-[8px] font-bold flex items-center gap-0.5 z-20">
            <EyeOff size={9} />
          </div>
        )}
        {isNode && (
          <div className="absolute w-full h-full">
            <div className="absolute top-1/2 left-0 w-full h-[1px] bg-white/50 -translate-y-1/2"></div>
            <div className="absolute left-1/2 top-0 h-full w-[1px] bg-white/50 -translate-x-1/2"></div>
          </div>
        )}
        {obj.isUI && obj.text && (
          <span className="p-1 select-none overflow-hidden font-bold text-white z-10" style={{ transform: scaleX < 0 ? 'scaleX(-1)' : 'none' }}>
            {obj.text}
          </span>
        )}
        {!obj.isUI && selectedId === obj.id && (
          <div className="absolute -top-5 z-20 pointer-events-none">
            <span className="text-xs text-white p-1 bg-black bg-opacity-70 select-none rounded-sm" style={{ transform: `scale(${1 / zoom})`, transformOrigin: 'bottom center' }}>
              {obj.name}
            </span>
          </div>
        )}
        {selectedId === obj.id && obj.useCustomCollision && obj.collision && (
          <div
            className="absolute pointer-events-none bg-blue-500 bg-opacity-30 border-2 border-blue-400 z-10"
            style={{
              left: obj.collision.offsetX,
              top: obj.collision.offsetY,
              width: obj.collision.width,
              height: obj.collision.height,
            }}
          />
        )}
      </div>
    );
  };

  const handleAddGameObjectClick = () => {
    if (activeMode === '3d') {
      onAddObject({
        name: `Cubo_3D_${objects.length + 1}`,
        shape3D: 'box',
        color: '#6366f1',
        width: 50,
        height: 50,
        position3D: { x: 0, y: 0, z: 0 },
        scale3D: { x: 1.2, y: 1.2, z: 1.2 },
        behaviors: [{ name: 'Solid3D', properties: {} }],
      });
    } else {
      onAddObject();
    }
  };

  const handleAddUIObjectClick = () => {
    onAddObject({
      isUI: true,
      name: `UI_Element_${objects.length + 1}`,
      x: 10,
      y: 10,
      width: 120,
      height: 44,
      color: '#4f46e5',
      text: t('sceneEditor.defaultButtonText') || 'Botón',
      zIndex: 1000,
    });
  };

  return (
    <div className="flex-grow flex flex-col bg-gray-950 relative overflow-hidden">
      {/* Unified 2D / 3D Editor Toolbar */}
      <div className="flex items-center h-10 px-2 bg-[#1a1a1a] border-b border-[#333333] shrink-0 gap-1 select-none overflow-x-auto">
        {/* 2D / 3D Switcher */}
        <div className="flex items-center bg-[#111111] p-0.5 rounded border border-white/10 mr-1.5 shrink-0">
          <button
            onClick={() => onChangeSceneMode?.('2d')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-black uppercase transition-colors ${
              activeMode === '2d' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Editor de Escena 2D"
          >
            <Layers size={12} />
            2D
          </button>
          <button
            onClick={() => onChangeSceneMode?.('3d')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-black uppercase transition-colors ${
              activeMode === '3d' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Editor de Escena 3D (Compatible con Eventos 2D)"
          >
            <Box size={12} />
            3D
          </button>
        </div>

        {activeMode === '2d' && (
          <div className="flex items-center gap-0.5 bg-[#252525] p-0.5 rounded border border-white/5 mr-1 shrink-0">
            <button
              onClick={() => setActiveTool('select')}
              title="Seleccionar / Arrastrar Objetos"
              className={`p-1.5 rounded transition-colors ${activeTool === 'select' ? 'bg-indigo-600 text-white shadow' : 'hover:bg-white/5 text-gray-400'}`}
            >
              <MousePointer2 size={14} />
            </button>
            <button
              onClick={() => setActiveTool('pan')}
              title="Mover Vista (Arrastrar Escena con Dedo o Ratón)"
              className={`p-1.5 rounded transition-colors ${activeTool === 'pan' ? 'bg-indigo-600 text-white shadow' : 'hover:bg-white/5 text-gray-400'}`}
            >
              <Hand size={14} />
            </button>
            <button
              onClick={() => setActiveTool('rotate')}
              title="Rotar Objeto"
              className={`p-1.5 rounded transition-colors ${activeTool === 'rotate' ? 'bg-indigo-600 text-white shadow' : 'hover:bg-white/5 text-gray-400'}`}
            >
              <RotateCw size={14} />
            </button>
          </div>
        )}

        <div className="h-4 w-[1px] bg-white/10 mx-1 shrink-0" />

        <button onClick={handleAddGameObjectClick} className="flex items-center gap-1.5 hover:bg-white/5 text-gray-300 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0">
          {activeMode === '3d' ? <Box size={14} className="text-emerald-400" /> : <Layers size={14} className="text-indigo-400" />}
          {activeMode === '3d' ? '+ Obj 3D' : '+ Objeto'}
        </button>
        <button onClick={handleAddUIObjectClick} className="flex items-center gap-1.5 hover:bg-white/5 text-gray-300 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0">
          <Monitor size={14} className="text-green-400" />
          UI
        </button>
        <button onClick={onOpenEventEditor} className="flex items-center gap-1.5 hover:bg-white/5 text-gray-300 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors shrink-0">
          <Zap size={14} className="text-yellow-400" />
          Eventos / Bloques
        </button>

        {globalObjects && globalObjects.length > 0 && (
          <div className="relative group shrink-0">
            <button className="flex items-center gap-1.5 hover:bg-white/5 text-gray-300 px-2.5 py-1 rounded text-[11px] font-bold uppercase tracking-wider transition-colors">
              <Layers size={14} className="text-yellow-400" />
              Globales ({globalObjects.length})
            </button>
            <div className="absolute left-0 mt-0 w-48 bg-[#1e1e1e] border border-[#333333] rounded shadow-xl hidden group-hover:block z-50">
              <div className="p-1 max-h-60 overflow-y-auto">
                {globalObjects.map((obj) => (
                  <button
                    key={obj.id}
                    onClick={() => {
                      onAddObject({
                        ...JSON.parse(JSON.stringify(obj)),
                        id: createUniqueId(),
                        x: 100,
                        y: 100,
                        position3D: obj.position3D || { x: 0, y: 0, z: 0 },
                      });
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[#333333] text-gray-300 hover:text-white rounded text-[11px] font-medium truncate"
                  >
                    {obj.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeMode === '2d' && (
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              onClick={() => applyZoomAroundPoint(Math.max(0.15, zoomRef.current * 0.8))}
              className="p-1 text-gray-400 hover:text-white hover:bg-white/5 rounded"
              title="Alejar Zoom"
            >
              <ZoomOut size={14} />
            </button>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/40 rounded border border-white/5 text-[10px] font-mono text-gray-400">
              <span className="text-gray-200">{Math.round(zoom * 100)}%</span>
            </div>
            <button
              onClick={() => applyZoomAroundPoint(Math.min(4, zoomRef.current * 1.25))}
              className="p-1 text-gray-400 hover:text-white hover:bg-white/5 rounded"
              title="Acercar Zoom"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={centerView}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-indigo-300 hover:text-white hover:bg-indigo-600/30 rounded transition-colors"
              title="Centrar Vista en la Escena"
            >
              <Maximize size={13} />
              <span className="hidden md:inline">Centrar</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Viewport Area */}
      {activeMode === '3d' ? (
        <SceneEditor3D
          scene={scene}
          objects={objects}
          assets={assets}
          selectedId={selectedId}
          onSelect={onSelect}
          onUpdateObject={onUpdateObject}
          onAddObject={onAddObject}
          isPaused={is3DPaused}
          cameraCacheRef={camera3DCacheRef}
        />
      ) : (
        <div
          ref={sceneRef}
          className={`flex-grow w-full h-full relative overflow-hidden touch-none transition-colors duration-200 ${
            activeTool === 'pan' ? 'cursor-grab' : ''
          } ${isAssetDragOver ? 'bg-indigo-500/10' : ''}`}
          style={{ backgroundColor: scene?.backgroundColor || '#111827' }}
          onMouseDown={handleSceneMouseDown}
          onTouchStart={handleSceneTouchStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            className="absolute top-0 left-0"
            style={{
              transform: `scale(${zoom}) translate(${viewOffset.x}px, ${viewOffset.y}px)`,
              transformOrigin: 'top left',
            }}
          >
            <div
              className="absolute border-2 border-dashed border-white/50 pointer-events-none"
              style={{
                left: 0,
                top: 0,
                width: gameWidth,
                height: gameHeight,
                boxShadow: `0 0 0 9999px rgba(0,0,0,0.6)`,
                backgroundSize: `20px 20px`,
                backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, rgba(0,0,0,0) 1px)',
              }}
            >
              {localObjectsWithAbsPos
                .filter((o) => o.isUI)
                .sort((a, b) => a.zIndex - b.zIndex)
                .map(renderObject)}
            </div>
            {scene?.cameraBounds?.enabled && (
              <div
                className="absolute border-2 border-dashed border-cyan-400 pointer-events-none"
                style={{
                  left: scene.cameraBounds.x,
                  top: scene.cameraBounds.y,
                  width: scene.cameraBounds.width,
                  height: scene.cameraBounds.height,
                }}
              />
            )}
            {localObjectsWithAbsPos
              .filter((o) => !o.isUI)
              .sort((a, b) => a.zIndex - b.zIndex)
              .map(renderObject)}
            {selectedObjectData && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: selectedObjectData.absPos.x,
                  top: selectedObjectData.absPos.y,
                  width: selectedObjectData.width,
                  height: selectedObjectData.height,
                  transform: `rotate(${selectedObjectData.rotation || 0}deg)`,
                  transformOrigin: 'center',
                }}
              >
                <div
                  className="absolute w-full h-full border-2 border-indigo-500"
                  style={{
                    transform: `scale(${selectedObjectData.scaleX ?? 1}, ${selectedObjectData.scaleY ?? 1})`,
                    transformOrigin: 'center',
                  }}
                />
                <div
                  className="absolute bg-indigo-500 rounded-full cursor-alias pointer-events-auto hover:ring-4 ring-indigo-400/50 touch-none"
                  title={t('sceneEditor.rotateObject')}
                  style={{
                    width: `${18 / zoom}px`,
                    height: `${18 / zoom}px`,
                    top: `calc(0% - ${9 / zoom}px)`,
                    left: `calc(100% + ${8 / zoom}px)`,
                    transform: `translateY(${selectedObjectData.height / 2}px)`,
                  }}
                  onMouseDown={handleRotationStart}
                  onTouchStart={handleRotationTouchStart}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SceneEditor;