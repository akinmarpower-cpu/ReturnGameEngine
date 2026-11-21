import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GameAsset, GameObject, Scene } from '../types';
import {
  applyMaterialTintToGroup,
  build3DVisualSignature,
  createObject3DMesh,
  detectSoftwareWebGL,
  disposeObject3D,
  getObject3DDimensions,
  getObject3DPosition,
  getObject3DRotation,
  getWorld3DTransformFromMap,
} from '../utils/threeObjectBuilder';
import {
  instantiateGlobalObject,
  reparentGameObjectUpdates,
  wouldCreateParentCycle,
} from '../utils/objectHierarchy';
import {
  Box,
  Circle,
  Compass,
  Hand,
  Lightbulb,
  Maximize,
  Maximize2,
  Move,
  MoveVertical,
  RotateCw,
  Sun,
  Trees,
  User,
  ZoomIn,
  ZoomOut,
  Coins,
  Square,
} from 'lucide-react';

export interface Camera3DSnapshot {
  pos: [number, number, number];
  target: [number, number, number];
}

interface SceneEditor3DProps {
  scene: Scene | undefined;
  objects: GameObject[];
  assets: GameAsset[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onUpdateObject: (id: number, updates: Partial<GameObject>) => void;
  onAddObject: (initialProps?: Partial<GameObject>) => void;
  onAddObjectsBatch?: (objs: GameObject[]) => void;
  isPaused?: boolean;
  cameraCacheRef?: React.MutableRefObject<Map<string, Camera3DSnapshot>>;
}

type ToolMode3D = 'moveObj' | 'rotateObj' | 'scaleObj' | 'orbit' | 'pan';

const SceneEditor3D: React.FC<SceneEditor3DProps> = ({
  scene,
  objects,
  assets,
  selectedId,
  onSelect,
  onUpdateObject,
  onAddObject,
  onAddObjectsBatch,
  isPaused = false,
  cameraCacheRef,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [toolMode, setToolMode] = useState<ToolMode3D>('moveObj');
  const [dragAxis, setDragAxis] = useState<'xz' | 'y'>('xz');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragHoverTarget, setDragHoverTarget] = useState<{ id: number; name: string } | null>(null);

  const toolModeRef = useRef<ToolMode3D>(toolMode);
  toolModeRef.current = toolMode;
  const dragAxisRef = useRef<'xz' | 'y'>(dragAxis);
  dragAxisRef.current = dragAxis;

  const objectsRef = useRef<GameObject[]>(objects);
  objectsRef.current = objects;
  const assetsRef = useRef<GameAsset[]>(assets);
  assetsRef.current = assets;
  const selectedIdRef = useRef<number | null>(selectedId);
  selectedIdRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onUpdateObjectRef = useRef(onUpdateObject);
  onUpdateObjectRef.current = onUpdateObject;

  // Imperative Three.js refs
  const threeStateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    tControls: TransformControls;
    isGizmoDragging: boolean;
    objectsRoot: THREE.Group;
    meshMap: Map<number, { group: THREE.Group; signature: string }>;
    selectionHelper: THREE.BoxHelper | null;
    ambientLight: THREE.HemisphereLight;
    dirLight: THREE.DirectionalLight;
    skyboxTexture?: THREE.Texture | null;
    skyboxUrl?: string;
    requestRender: () => void;
  } | null>(null);

  const dragSessionRef = useRef<{
    objId: number;
    group: THREE.Group;
    startPointer: { x: number; y: number };
    startPos3D: { x: number; y: number; z: number };
    startWorldPos: { x: number; y: number; z: number };
    plane: THREE.Plane;
    startHit: THREE.Vector3;
    lastPos3D: { x: number; y: number; z: number };
    moved: boolean;
    verticalMode: boolean;
  } | null>(null);

  const pointerDownInfoRef = useRef<{ x: number; y: number; hitId: number | null } | null>(null);

  // Save camera snapshot per scene ID
  const saveCameraSnapshot = useCallback(() => {
    const st = threeStateRef.current;
    if (!st || !cameraCacheRef) return;
    const key = scene?.id || 'default';
    cameraCacheRef.current.set(key, {
      pos: [st.camera.position.x, st.camera.position.y, st.camera.position.z],
      target: [st.controls.target.x, st.controls.target.y, st.controls.target.z],
    });
  }, [cameraCacheRef, scene?.id]);

  // Fit / Center camera onto visible 3D objects
  const fitCameraToScene = useCallback(() => {
    const st = threeStateRef.current;
    if (!st) return;

    const worldObjs = objectsRef.current.filter((o) => !o.isUI);
    if (worldObjs.length === 0) {
      st.controls.target.set(0, 0.5, 0);
      st.camera.position.set(10, 8, 12);
      st.controls.update();
      st.requestRender();
      saveCameraSnapshot();
      return;
    }

    const box = new THREE.Box3();
    const byId = new Map<number, GameObject>(worldObjs.map((o) => [o.id, o]));
    worldObjs.forEach((o) => {
      const p = getWorld3DTransformFromMap(o, byId).pos;
      const d = getObject3DDimensions(o);
      box.expandByPoint(new THREE.Vector3(p.x - d.w / 2, p.y, p.z - d.d / 2));
      box.expandByPoint(new THREE.Vector3(p.x + d.w / 2, p.y + d.h, p.z + d.d / 2));
    });

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 6);
    const dist = Math.min(Math.max(maxDim * 1.15, 8), 45);

    st.controls.target.copy(center);
    st.camera.position.set(center.x + dist * 0.65, center.y + dist * 0.55, center.z + dist * 0.78);
    st.controls.update();
    st.requestRender();
    saveCameraSnapshot();
  }, [saveCameraSnapshot]);

  const zoomByFactor = useCallback((factor: number) => {
    const st = threeStateRef.current;
    if (!st) return;
    const offset = st.camera.position.clone().sub(st.controls.target);
    const newLen = Math.min(Math.max(offset.length() * factor, 2), 140);
    offset.setLength(newLen);
    st.camera.position.copy(st.controls.target).add(offset);
    st.controls.update();
    st.requestRender();
    saveCameraSnapshot();
  }, [saveCameraSnapshot]);

  // Initialize Three.js WebGL context cleanly (only active when not paused)
  useEffect(() => {
    if (isPaused) return;
    const container = mountRef.current;
    if (!container) return;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    const isSoftwareGl = detectSoftwareWebGL(renderer);
    const maxDpr = isSoftwareGl ? 1 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = isSoftwareGl ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const threeScene = new THREE.Scene();
    const bgHex = scene?.backgroundColor || '#141824';
    threeScene.background = new THREE.Color(bgHex);
    if (scene?.fogEnabled) {
      threeScene.fog = new THREE.FogExp2(scene.fogColor || bgHex, scene.fogDensity ?? 0.015);
    }

    // Subtle PBR environment reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmremGenerator.fromScene(roomEnv, 0.04);
    threeScene.environment = envRT.texture;
    roomEnv.dispose();

    const camera = new THREE.PerspectiveCamera(scene?.camera3DFov || 55, width / height, 0.1, 400);

    // Restore saved camera or fit to scene
    const cachedCam = cameraCacheRef?.current.get(scene?.id || 'default');
    if (cachedCam) {
      camera.position.set(...cachedCam.pos);
    } else {
      camera.position.set(10, 8, 12);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false; // On-demand rendering without continuous loop
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 150;
    controls.maxPolarAngle = Math.PI * 0.495;
    if (cachedCam) {
      controls.target.set(...cachedCam.target);
    } else {
      controls.target.set(0, 0.5, 0);
    }
    controls.update();

    const tControls = new TransformControls(camera, renderer.domElement);
    tControls.setSize(0.85);
    threeScene.add(tControls);

    // Lighting
    const ambientLight = new THREE.HemisphereLight('#dbeafe', '#1e293b', scene?.ambientLightIntensity ?? 0.85);
    threeScene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(scene?.sunLightColor || '#fffbeb', scene?.sunLightIntensity ?? 1.55);
    dirLight.position.set(14, 22, 12);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = isSoftwareGl ? 512 : 1024;
    dirLight.shadow.mapSize.height = isSoftwareGl ? 512 : 1024;
    dirLight.shadow.camera.near = 1;
    dirLight.shadow.camera.far = 80;
    const d = 24;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    dirLight.shadow.bias = -0.0005;
    threeScene.add(dirLight);

    // Ground grid & subtle shadow receiver plane
    const grid = new THREE.GridHelper(60, 60, 0x4f46e5, 0x262b3d);
    grid.position.y = 0.002;
    threeScene.add(grid);

    const floorGeo = new THREE.PlaneGeometry(140, 140);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    const floorReceiver = new THREE.Mesh(floorGeo, floorMat);
    floorReceiver.receiveShadow = true;
    floorReceiver.position.y = 0;
    threeScene.add(floorReceiver);

    const objectsRoot = new THREE.Group();
    threeScene.add(objectsRoot);

    let rafScheduled = false;
    const renderNow = () => {
      rafScheduled = false;
      renderer.render(threeScene, camera);
    };
    const requestRender = () => {
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(renderNow);
      }
    };

    const meshMap = new Map<number, { group: THREE.Group; signature: string }>();

    threeStateRef.current = {
      renderer,
      scene: threeScene,
      camera,
      controls,
      tControls,
      isGizmoDragging: false,
      objectsRoot,
      meshMap,
      selectionHelper: null,
      ambientLight,
      dirLight,
      requestRender,
    };

    let activeGizmoBaseDims: { w: number; h: number; d: number } | null = null;

    const onTransformChange = () => {
      requestRender();
    };
    const onTransformObjectChange = () => {
      if (threeStateRef.current?.selectionHelper) {
        threeStateRef.current.selectionHelper.update();
      }
      requestRender();
    };
    const onTransformDraggingChanged = (event: { value?: unknown }) => {
      const stNow = threeStateRef.current;
      if (!stNow) return;
      const dragging = Boolean(event?.value);
      stNow.isGizmoDragging = dragging;
      controls.enabled = !dragging;
      const targetGroup = tControls.object as THREE.Group | undefined;
      const targetId = targetGroup?.userData?.gameObjectId;
      const objData = typeof targetId === 'number' ? objectsRef.current.find((o) => o.id === targetId) : undefined;
      if (dragging) {
        activeGizmoBaseDims = objData ? getObject3DDimensions(objData) : null;
      } else if (targetGroup && typeof targetId === 'number' && objData) {
        if (toolModeRef.current === 'rotateObj') {
          const rot3 = {
            x: Number(targetGroup.rotation.x.toFixed(4)),
            y: Number(targetGroup.rotation.y.toFixed(4)),
            z: Number(targetGroup.rotation.z.toFixed(4)),
          };
          onUpdateObjectRef.current(targetId, {
            rotation3D: rot3,
            rotation: Math.round((-rot3.y * 180) / Math.PI),
          });
        } else if (toolModeRef.current === 'scaleObj') {
          const base = activeGizmoBaseDims || getObject3DDimensions(objData);
          const nextScale3D = {
            x: Number(Math.max(0.05, base.w * targetGroup.scale.x).toFixed(2)),
            y: Number(Math.max(0.05, base.h * targetGroup.scale.y).toFixed(2)),
            z: Number(Math.max(0.05, base.d * targetGroup.scale.z).toFixed(2)),
          };
          targetGroup.scale.set(1, 1, 1);
          onUpdateObjectRef.current(targetId, {
            scale3D: nextScale3D,
            width: Math.max(10, Math.round(nextScale3D.x * 50)),
            height: Math.max(10, Math.round(nextScale3D.z * 50)),
          });
        }
        activeGizmoBaseDims = null;
      }
      requestRender();
    };
    tControls.addEventListener('change', onTransformChange);
    tControls.addEventListener('objectChange', onTransformObjectChange);
    tControls.addEventListener('dragging-changed', onTransformDraggingChanged as any);

    const handleControlsChange = () => {
      requestRender();
      saveCameraSnapshot();
    };
    controls.addEventListener('change', handleControlsChange);

    // ResizeObserver for crisp layout
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(entry.contentRect.width, 1);
        const h = Math.max(entry.contentRect.height, 1);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    // Fit camera on initial scene open if no saved camera exists
    if (!cachedCam) {
      setTimeout(() => fitCameraToScene(), 20);
    }

    // Raycasting & Dragging Helpers (allocated once)
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const intersection = new THREE.Vector3();

    const getNDC = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const findHitObjectId = (clientX: number, clientY: number): number | null => {
      getNDC(clientX, clientY);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(objectsRoot.children, true);
      for (const hit of hits) {
        let curr: THREE.Object3D | null = hit.object;
        while (curr) {
          if (typeof curr.userData?.gameObjectId === 'number') {
            return curr.userData.gameObjectId;
          }
          curr = curr.parent;
        }
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if ((tControls as any).axis !== null || threeStateRef.current?.isGizmoDragging) return;
      const hitId = findHitObjectId(e.clientX, e.clientY);
      pointerDownInfoRef.current = { x: e.clientX, y: e.clientY, hitId };

      if (toolModeRef.current === 'moveObj' && hitId !== null) {
        const entry = meshMap.get(hitId);
        const objData = objectsRef.current.find((o) => o.id === hitId);
        if (entry && objData) {
          onSelectRef.current(hitId);
          controls.enabled = false;

          const startPos = getObject3DPosition(objData);
          entry.group.updateWorldMatrix(true, false);
          const worldVec = new THREE.Vector3();
          entry.group.getWorldPosition(worldVec);
          const startWorldPos = { x: worldVec.x, y: worldVec.y, z: worldVec.z };
          const verticalMode = dragAxisRef.current === 'y' || e.shiftKey;

          // Build drag plane in world coordinates passing through object's world origin
          const plane = new THREE.Plane();
          if (verticalMode) {
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            camDir.y = 0;
            if (camDir.lengthSq() < 0.001) camDir.set(0, 0, 1);
            camDir.normalize();
            plane.setFromNormalAndCoplanarPoint(camDir, new THREE.Vector3(startWorldPos.x, startWorldPos.y, startWorldPos.z));
          } else {
            plane.set(new THREE.Vector3(0, 1, 0), -startWorldPos.y);
          }

          getNDC(e.clientX, e.clientY);
          raycaster.setFromCamera(ndc, camera);
          const startHit = new THREE.Vector3(startWorldPos.x, startWorldPos.y, startWorldPos.z);
          raycaster.ray.intersectPlane(plane, startHit);

          dragSessionRef.current = {
            objId: hitId,
            group: entry.group,
            startPointer: { x: e.clientX, y: e.clientY },
            startPos3D: { ...startPos },
            startWorldPos,
            plane,
            startHit: startHit.clone(),
            lastPos3D: { ...startPos },
            moved: false,
            verticalMode,
          };

          try {
            renderer.domElement.setPointerCapture(e.pointerId);
          } catch {}
        }
      }
    };

    const _dragTargetWorld = new THREE.Vector3();
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragSessionRef.current;
      if (!drag) return;

      const distPx = Math.hypot(e.clientX - drag.startPointer.x, e.clientY - drag.startPointer.y);
      if (distPx > 3) drag.moved = true;

      getNDC(e.clientX, e.clientY);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(drag.plane, intersection)) {
        const dx = intersection.x - drag.startHit.x;
        const dy = intersection.y - drag.startHit.y;
        const dz = intersection.z - drag.startHit.z;

        if (drag.verticalMode) {
          _dragTargetWorld.set(
            drag.startWorldPos.x,
            Math.max(-10, Math.min(80, drag.startWorldPos.y + dy)),
            drag.startWorldPos.z
          );
        } else {
          _dragTargetWorld.set(
            drag.startWorldPos.x + dx,
            drag.startWorldPos.y,
            drag.startWorldPos.z + dz
          );
        }

        const parentObj3D = drag.group.parent;
        if (parentObj3D && parentObj3D !== objectsRoot) {
          parentObj3D.updateWorldMatrix(true, false);
          parentObj3D.worldToLocal(_dragTargetWorld);
        }

        const nextPos = {
          x: Number(_dragTargetWorld.x.toFixed(2)),
          y: Number(_dragTargetWorld.y.toFixed(2)),
          z: Number(_dragTargetWorld.z.toFixed(2)),
        };

        drag.lastPos3D = nextPos;
        drag.group.position.set(nextPos.x, nextPos.y, nextPos.z);

        if (threeStateRef.current?.selectionHelper) {
          threeStateRef.current.selectionHelper.update();
        }
        requestRender();
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const drag = dragSessionRef.current;
      if (drag) {
        controls.enabled = true;
        try {
          renderer.domElement.releasePointerCapture(e.pointerId);
        } catch {}

        if (drag.moved) {
          const objData = objectsRef.current.find((o) => o.id === drag.objId);
          const dims = objData ? getObject3DDimensions(objData) : { w: 1, h: 1, d: 1 };
          onUpdateObjectRef.current(drag.objId, {
            position3D: drag.lastPos3D,
            x: Math.round(drag.lastPos3D.x * 50 - (objData?.width || dims.w * 50) / 2),
            y: Math.round(drag.lastPos3D.z * 50 - (objData?.height || dims.d * 50) / 2),
          });
        }
        dragSessionRef.current = null;
        pointerDownInfoRef.current = null;
        requestRender();
        return;
      }

      const downInfo = pointerDownInfoRef.current;
      if (downInfo) {
        const moveDist = Math.hypot(e.clientX - downInfo.x, e.clientY - downInfo.y);
        if (moveDist < 6) {
          onSelectRef.current(downInfo.hitId);
        }
        pointerDownInfoRef.current = null;
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    return () => {
      saveCameraSnapshot();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      tControls.removeEventListener('change', onTransformChange);
      tControls.removeEventListener('objectChange', onTransformObjectChange);
      tControls.removeEventListener('dragging-changed', onTransformDraggingChanged as any);
      tControls.detach();
      threeScene.remove(tControls);
      tControls.dispose();
      controls.removeEventListener('change', handleControlsChange);
      resizeObserver.disconnect();

      if (threeStateRef.current?.selectionHelper) {
        threeStateRef.current.selectionHelper.geometry.dispose();
        (threeStateRef.current.selectionHelper.material as THREE.Material).dispose();
      }
      meshMap.forEach(({ group }) => disposeObject3D(group));
      meshMap.clear();
      if (threeStateRef.current?.skyboxTexture) {
        threeStateRef.current.skyboxTexture.dispose();
        threeStateRef.current.skyboxTexture = null;
      }
      floorGeo.dispose();
      floorMat.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      envRT.dispose();
      pmremGenerator.dispose();
      controls.dispose();
      renderer.dispose();
      threeStateRef.current = null;
    };
  }, [isPaused, scene?.id, cameraCacheRef, fitCameraToScene, saveCameraSnapshot]);

  // Sync OrbitControls mapping when toolMode changes
  useEffect(() => {
    const st = threeStateRef.current;
    if (!st) return;
    if (toolMode === 'pan') {
      st.controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      st.controls.touches = {
        ONE: THREE.TOUCH.PAN,
        TWO: THREE.TOUCH.DOLLY_ROTATE,
      };
    } else {
      st.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      };
      st.controls.touches = {
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      };
    }
    st.controls.update();
    st.requestRender();
  }, [toolMode, isPaused]);

  // Sync Scene Environment (bg, skybox, fog, lighting)
  useEffect(() => {
    const st = threeStateRef.current;
    if (!st || !scene) return;
    const bgHex = scene.backgroundColor || '#141824';
    const skyUrl = scene.skyboxImageUrl || '';
    let cancelled = false;

    if (!skyUrl) {
      if (st.skyboxTexture) {
        st.skyboxTexture.dispose();
        st.skyboxTexture = null;
      }
      st.skyboxUrl = '';
      st.scene.background = new THREE.Color(bgHex);
    } else if (st.skyboxUrl !== skyUrl) {
      st.skyboxUrl = skyUrl;
      const loader = new THREE.TextureLoader();
      loader.load(
        skyUrl,
        (tex) => {
          if (cancelled || threeStateRef.current !== st || st.skyboxUrl !== skyUrl) {
            tex.dispose();
            return;
          }
          if (st.skyboxTexture && st.skyboxTexture !== tex) {
            st.skyboxTexture.dispose();
          }
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          st.skyboxTexture = tex;
          st.scene.background = tex;
          st.requestRender();
        },
        undefined,
        () => {
          if (!cancelled && threeStateRef.current === st && st.skyboxUrl === skyUrl) {
            st.scene.background = new THREE.Color(bgHex);
            st.requestRender();
          }
        }
      );
    }

    if (scene.fogEnabled) {
      st.scene.fog = new THREE.FogExp2(scene.fogColor || bgHex, scene.fogDensity ?? 0.015);
    } else {
      st.scene.fog = null;
    }
    st.ambientLight.intensity = scene.ambientLightIntensity ?? 0.85;
    st.dirLight.intensity = scene.sunLightIntensity ?? 1.55;
    st.dirLight.color.set(scene.sunLightColor || '#fffbeb');
    st.camera.fov = scene.camera3DFov || 55;
    st.camera.updateProjectionMatrix();
    st.requestRender();

    return () => {
      cancelled = true;
    };
  }, [
    scene?.backgroundColor,
    scene?.skyboxImageUrl,
    scene?.fogEnabled,
    scene?.fogColor,
    scene?.fogDensity,
    scene?.ambientLightIntensity,
    scene?.sunLightIntensity,
    scene?.sunLightColor,
    scene?.camera3DFov,
    isPaused,
  ]);

  // Synchronize GameObjects -> Three.js Scene Graph cleanly (preserving parentId nesting)
  useEffect(() => {
    const st = threeStateRef.current;
    if (!st) return;

    const worldObjects = objects.filter((o) => !o.isUI);
    const worldById = new Map<number, GameObject>(worldObjects.map((o) => [o.id, o]));
    const activeIds = new Set(worldObjects.map((o) => o.id));

    const rescueNestedChildRoots = (grp: THREE.Group) => {
      const snapshot = [...grp.children];
      for (const ch of snapshot) {
        if (ch.userData?.isGameObjectRoot) {
          st.objectsRoot.add(ch);
        }
      }
    };

    // Remove deleted objects (rescuing any live nested children first)
    for (const [id, entry] of st.meshMap.entries()) {
      if (!activeIds.has(id)) {
        rescueNestedChildRoots(entry.group);
        entry.group.parent?.remove(entry.group);
        disposeObject3D(entry.group);
        st.meshMap.delete(id);
      }
    }

    // Add or update objects
    for (const obj of worldObjects) {
      const sig = build3DVisualSignature(obj, assets, true);
      const dims = getObject3DDimensions(obj);
      const dimsSig = `${dims.w.toFixed(3)}|${dims.h.toFixed(3)}|${dims.d.toFixed(3)}`;
      let entry = st.meshMap.get(obj.id);
      if (
        entry &&
        obj.modelUrl &&
        entry.group.userData.loadedModelUrl === obj.modelUrl &&
        entry.group.userData._dimsSig === dimsSig
      ) {
        if (entry.signature !== sig) {
          applyMaterialTintToGroup(entry.group, obj, true);
          if (obj.animation3D && entry.group.userData.playAnimation3D) {
            entry.group.userData.playAnimation3D(
              obj.animation3D,
              obj.animation3DLoop !== false,
              Number(obj.animation3DSpeed ?? 1) || 1
            );
          }
          entry.signature = sig;
          st.requestRender();
        }
      } else if (!entry || entry.signature !== sig) {
        if (entry) {
          rescueNestedChildRoots(entry.group);
          entry.group.parent?.remove(entry.group);
          disposeObject3D(entry.group);
        }
        const newGroup = createObject3DMesh(obj, assets, {
          isEditor: true,
          onModelLoaded: () => st.requestRender(),
        });
        newGroup.userData._dimsSig = dimsSig;
        st.objectsRoot.add(newGroup);
        entry = { group: newGroup, signature: sig };
        st.meshMap.set(obj.id, entry);
      }
    }

    // Link Three.js parent-child hierarchy cleanly (after all groups exist)
    for (const obj of worldObjects) {
      const entry = st.meshMap.get(obj.id);
      if (!entry) continue;
      let targetParent: THREE.Object3D = st.objectsRoot;
      if (obj.parentId && st.meshMap.has(obj.parentId) && !wouldCreateParentCycle(obj.id, obj.parentId, worldById)) {
        targetParent = st.meshMap.get(obj.parentId)!.group;
      }
      if (entry.group.parent !== targetParent) {
        targetParent.add(entry.group);
      }

      // Skip overwriting active drag or gizmo transform
      if (dragSessionRef.current?.objId !== obj.id && !(st.isGizmoDragging && selectedId === obj.id)) {
        const pos = getObject3DPosition(obj);
        const rot = getObject3DRotation(obj);
        entry.group.position.set(pos.x, pos.y, pos.z);
        entry.group.rotation.set(rot.x, rot.y, rot.z);
      }
    }

    st.objectsRoot.updateMatrixWorld(true);

    // Update Selection BoxHelper
    if (st.selectionHelper) {
      st.scene.remove(st.selectionHelper);
      st.selectionHelper.geometry.dispose();
      (st.selectionHelper.material as THREE.Material).dispose();
      st.selectionHelper = null;
    }

    const selectedEntry = selectedId !== null ? st.meshMap.get(selectedId) : undefined;
    if (selectedEntry) {
      const helper = new THREE.BoxHelper(selectedEntry.group, 0x818cf8);
      st.scene.add(helper);
      st.selectionHelper = helper;
    }

    // Sync TransformControls gizmo for rotateObj / scaleObj modes
    if (selectedEntry && (toolMode === 'rotateObj' || toolMode === 'scaleObj')) {
      if (st.tControls.object !== selectedEntry.group) {
        st.tControls.attach(selectedEntry.group);
      }
      st.tControls.setMode(toolMode === 'rotateObj' ? 'rotate' : 'scale');
      st.tControls.setSpace('local');
      st.tControls.enabled = true;
      st.tControls.visible = true;
    } else {
      if (st.tControls.object) st.tControls.detach();
      st.tControls.enabled = false;
      st.tControls.visible = false;
    }

    st.requestRender();
  }, [objects, assets, selectedId, toolMode, isPaused]);

  const raycastDropTarget = (clientX: number, clientY: number): { dropPos: { x: number; y: number; z: number }; hitObjId: number | null } => {
    const st = threeStateRef.current;
    let dropPos = { x: 0, y: 0, z: 0 };
    let hitObjId: number | null = null;
    if (!st) return { dropPos, hitObjId };

    const rect = st.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, st.camera);

    const objHits = raycaster.intersectObjects(st.objectsRoot.children, true);
    if (objHits.length > 0) {
      const firstHit = objHits[0];
      let curr: THREE.Object3D | null = firstHit.object;
      while (curr) {
        if (typeof curr.userData?.gameObjectId === 'number') {
          hitObjId = curr.userData.gameObjectId;
          break;
        }
        curr = curr.parent;
      }
      dropPos = {
        x: Number(firstHit.point.x.toFixed(2)),
        y: Number(Math.max(0, firstHit.point.y).toFixed(2)),
        z: Number(firstHit.point.z.toFixed(2)),
      };
      return { dropPos, hitObjId };
    }

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) {
      dropPos = { x: Number(hit.x.toFixed(2)), y: 0, z: Number(hit.z.toFixed(2)) };
    }
    return { dropPos, hitObjId };
  };

  // Drop Assets, Global Object templates, or Hierarchy objects onto 3D viewport or existing 3D objects
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setDragHoverTarget(null);
    const st = threeStateRef.current;
    const assetString = e.dataTransfer.getData('application/game-asset');
    const templateString = e.dataTransfer.getData('application/game-object-template');
    const objectIdString = e.dataTransfer.getData('application/game-object-id');

    const { dropPos, hitObjId } = raycastDropTarget(e.clientX, e.clientY);

    if (objectIdString) {
      const draggedId = Number(objectIdString);
      const draggedObj = objects.find((o) => o.id === draggedId);
      if (!draggedObj || Number.isNaN(draggedId)) return;

      if (hitObjId !== null && hitObjId !== draggedId) {
        const reparentUpdates = reparentGameObjectUpdates(draggedId, hitObjId, objects);
        if (reparentUpdates) {
          onUpdateObject(draggedId, reparentUpdates);
          onSelect(draggedId);
          return;
        }
      }

      // Dropped onto empty ground/space: move to dropPos (converted to parent-local if still parented)
      let localPos = { ...dropPos };
      if (draggedObj.parentId && st) {
        const parentEntry = st.meshMap.get(draggedObj.parentId);
        if (parentEntry) {
          parentEntry.group.updateWorldMatrix(true, false);
          const v = new THREE.Vector3(dropPos.x, dropPos.y, dropPos.z);
          parentEntry.group.worldToLocal(v);
          localPos = {
            x: Number(v.x.toFixed(2)),
            y: Number(v.y.toFixed(2)),
            z: Number(v.z.toFixed(2)),
          };
        }
      }
      onUpdateObject(draggedId, {
        position3D: localPos,
        x: Math.round(localPos.x * 50),
        y: Math.round(localPos.z * 50),
      });
      onSelect(draggedId);
      return;
    }

    if (templateString) {
      try {
        const tpl = JSON.parse(templateString) as GameObject;
        let targetParentId: number | null = null;
        let spawnPos = dropPos;

        if (hitObjId !== null && (e.altKey || e.shiftKey)) {
          targetParentId = hitObjId;
          if (st) {
            const parentEntry = st.meshMap.get(hitObjId);
            if (parentEntry) {
              parentEntry.group.updateWorldMatrix(true, false);
              const v = new THREE.Vector3(dropPos.x, dropPos.y, dropPos.z);
              parentEntry.group.worldToLocal(v);
              spawnPos = { x: Number(v.x.toFixed(2)), y: Number(v.y.toFixed(2)), z: Number(v.z.toFixed(2)) };
            }
          }
        }

        const { root, allObjects } = instantiateGlobalObject(tpl, {
          parentId: targetParentId,
          position3D: spawnPos,
          x: Math.round(spawnPos.x * 50),
          y: Math.round(spawnPos.z * 50),
        });
        if (allObjects.length > 1 && onAddObjectsBatch) {
          onAddObjectsBatch(allObjects);
        } else {
          allObjects.forEach((o) => onAddObject(o));
        }
        onSelect(root.id);
      } catch {}
      return;
    }

    if (assetString) {
      try {
        const asset: GameAsset = JSON.parse(assetString);
        const cleanName = asset.name.split('.').slice(0, -1).join('.') || asset.name;

        // Dropping an image/3d-model asset directly onto an existing 3D object updates that object's texture/model!
        if (hitObjId !== null) {
          if (asset.type === '3d-model') {
            onUpdateObject(hitObjId, { modelUrl: asset.url });
            onSelect(hitObjId);
            return;
          } else if (asset.type === 'image') {
            onUpdateObject(hitObjId, { imageUrl: asset.url, color: '#ffffff' });
            onSelect(hitObjId);
            return;
          }
        }

        if (asset.type === '3d-model') {
          onAddObject({
            name: cleanName || 'Modelo_3D',
            modelUrl: asset.url,
            shape3D: 'box',
            color: '#ffffff',
            width: 60,
            height: 60,
            position3D: dropPos,
            scale3D: { x: 1.5, y: 1.5, z: 1.5 },
            x: Math.round(dropPos.x * 50),
            y: Math.round(dropPos.z * 50),
            zIndex: 5,
          });
        } else if (asset.type === 'image') {
          onAddObject({
            name: cleanName || 'Cubo_Textura',
            shape3D: 'box',
            imageUrl: asset.url,
            color: '#ffffff',
            width: 50,
            height: 50,
            position3D: dropPos,
            scale3D: { x: 1.2, y: 1.2, z: 1.2 },
            x: Math.round(dropPos.x * 50),
            y: Math.round(dropPos.z * 50),
            zIndex: 5,
          });
        }
      } catch {}
    }
  };

  const uiCount = objects.filter((o) => o.isUI).length;

  return (
    <div
      className={`relative flex-grow w-full h-full overflow-hidden bg-[#141824] select-none ${
        isDragOver ? 'ring-2 ring-inset ring-indigo-500' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
        const { hitObjId } = raycastDropTarget(e.clientX, e.clientY);
        if (hitObjId !== null) {
          const hitObj = objects.find((o) => o.id === hitObjId);
          if (hitObj && dragHoverTarget?.id !== hitObj.id) {
            setDragHoverTarget({ id: hitObj.id, name: hitObj.name });
          }
        } else if (dragHoverTarget !== null) {
          setDragHoverTarget(null);
        }
      }}
      onDragLeave={() => {
        setIsDragOver(false);
        setDragHoverTarget(null);
      }}
      onDrop={handleDrop}
    >
      {isDragOver && dragHoverTarget && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-emerald-950/95 border border-emerald-400/60 text-emerald-200 px-3 py-1.5 rounded-lg shadow-2xl text-[11px] font-bold pointer-events-none">
          Soltar sobre «{dragHoverTarget.name}» (emparenta nodo o aplica textura/modelo)
        </div>
      )}
      {/* WebGL Canvas Mount */}
      <div ref={mountRef} className="w-full h-full touch-none" />

      {/* Left Floating Navigation Controls (Touch & Mouse friendly, ZERO backdrop-blur over WebGL) */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-auto">
        <div className="flex flex-wrap items-center gap-1 bg-[#18181b] border border-white/15 rounded-lg p-1 shadow-xl">
          <button
            onClick={() => setToolMode('moveObj')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-colors ${
              toolMode === 'moveObj' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-white/10'
            }`}
            title="Arrastrar objetos con el dedo o ratón (fondo vacío rota cámara)"
          >
            <Move size={13} />
            <span className="hidden sm:inline">Mover Obj</span>
          </button>
          <button
            onClick={() => setToolMode('rotateObj')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-colors ${
              toolMode === 'rotateObj' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-white/10'
            }`}
            title="Rotar objeto seleccionado con ejes 3D"
          >
            <RotateCw size={13} />
            <span className="hidden sm:inline">Rotar Obj</span>
          </button>
          <button
            onClick={() => setToolMode('scaleObj')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-colors ${
              toolMode === 'scaleObj' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-white/10'
            }`}
            title="Escalar objeto seleccionado con ejes 3D"
          >
            <Maximize2 size={13} />
            <span className="hidden sm:inline">Escalar Obj</span>
          </button>
          <button
            onClick={() => setToolMode('orbit')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-colors ${
              toolMode === 'orbit' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-white/10'
            }`}
            title="Rotar / Orbitar cámara 3D con un dedo"
          >
            <Compass size={13} />
            <span className="hidden sm:inline">Orbitar</span>
          </button>
          <button
            onClick={() => setToolMode('pan')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-bold transition-colors ${
              toolMode === 'pan' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-white/10'
            }`}
            title="Desplazarse por la escena 3D con un dedo"
          >
            <Hand size={13} />
            <span className="hidden sm:inline">Mover Vista</span>
          </button>
        </div>

        {toolMode === 'moveObj' && (
          <div className="flex items-center gap-1 bg-[#18181b] border border-white/15 rounded-lg p-1 shadow-xl w-fit">
            <button
              onClick={() => setDragAxis('xz')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                dragAxis === 'xz' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
              title="Arrastrar horizontalmente (X / Z)"
            >
              <Compass size={12} />
              Plano X/Z
            </button>
            <button
              onClick={() => setDragAxis('y')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                dragAxis === 'y' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
              title="Subir / bajar altura del objeto (Eje Y)"
            >
              <MoveVertical size={12} />
              Altura Y
            </button>
          </div>
        )}
      </div>

      {/* Right Floating Zoom & Fit Controls */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1 bg-[#18181b] border border-white/15 rounded-lg p-1 shadow-xl pointer-events-auto">
        <button
          onClick={() => zoomByFactor(0.8)}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Acercar Zoom"
        >
          <ZoomIn size={15} />
        </button>
        <button
          onClick={() => zoomByFactor(1.25)}
          className="p-1.5 text-gray-300 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Alejar Zoom"
        >
          <ZoomOut size={15} />
        </button>
        <button
          onClick={fitCameraToScene}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-indigo-300 hover:text-white hover:bg-indigo-600/40 rounded transition-colors"
          title="Centrar vista y enfocar todos los objetos"
        >
          <Maximize size={13} />
          <span className="hidden sm:inline">Centrar</span>
        </button>
      </div>

      {/* Bottom Quick-Add 3D Objects Strip */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between gap-2 pointer-events-none">
        <div className="flex items-center gap-1 bg-[#18181b] border border-white/15 rounded-lg p-1 shadow-xl overflow-x-auto max-w-full pointer-events-auto">
          <button
            onClick={() =>
              onAddObject({
                name: 'Jugador_3D',
                shape3D: 'character',
                color: '#3b82f6',
                width: 45,
                height: 60,
                position3D: { x: 0, y: 0, z: 0 },
                scale3D: { x: 0.9, y: 1.7, z: 0.9 },
                x: -22,
                y: -30,
                zIndex: 10,
                behaviors: [
                  { name: 'Player3D', properties: { speed: 6, jumpForce: 8, gravity: 18, canJump: true } },
                  { name: 'FollowCamera3D', properties: { mode: 'thirdPerson', distance: 9, height: 5 } },
                  { name: 'Health', properties: { hp: 100, maxHp: 100 } },
                ],
                stats: { hp: 100, maxHp: 100, attack: 15 },
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-sky-300 hover:bg-sky-600/30 border border-sky-500/30 shrink-0"
          >
            <User size={12} /> Jugador 3D
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: 'Suelo_3D',
                shape3D: 'box',
                color: '#334155',
                width: 800,
                height: 800,
                position3D: { x: 0, y: -0.5, z: 0 },
                scale3D: { x: 18, y: 0.5, z: 18 },
                x: -400,
                y: -400,
                zIndex: 0,
                behaviors: [{ name: 'Solid3D', properties: {} }],
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-slate-200 hover:bg-white/10 border border-white/10 shrink-0"
          >
            <Square size={12} /> Suelo 3D
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: `Cubo_3D_${objects.length + 1}`,
                shape3D: 'box',
                color: '#6366f1',
                width: 50,
                height: 50,
                position3D: { x: Number(((Math.random() - 0.5) * 4).toFixed(1)), y: 0, z: Number(((Math.random() - 0.5) * 4).toFixed(1)) },
                scale3D: { x: 1.2, y: 1.2, z: 1.2 },
                behaviors: [{ name: 'Solid3D', properties: {} }],
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-indigo-300 hover:bg-indigo-600/30 border border-indigo-500/30 shrink-0"
          >
            <Box size={12} /> Cubo
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: `Esfera_3D_${objects.length + 1}`,
                shape3D: 'sphere',
                color: '#ec4899',
                width: 50,
                height: 50,
                position3D: { x: 2, y: 0, z: 0 },
                scale3D: { x: 1.2, y: 1.2, z: 1.2 },
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-pink-300 hover:bg-pink-600/30 border border-pink-500/30 shrink-0"
          >
            <Circle size={12} /> Esfera
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: 'Moneda_3D',
                shape3D: 'coin',
                color: '#facc15',
                width: 35,
                height: 35,
                position3D: { x: 0, y: 0.4, z: 3 },
                scale3D: { x: 0.9, y: 0.9, z: 0.9 },
                isTouchable: true,
                behaviors: [{ name: 'Rotate3D', properties: { speedX: 0, speedY: 140, speedZ: 0 } }],
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-amber-300 hover:bg-amber-600/30 border border-amber-500/30 shrink-0"
          >
            <Coins size={12} /> Moneda
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: `Arbol_3D_${objects.length + 1}`,
                shape3D: 'tree',
                color: '#16a34a',
                width: 70,
                height: 70,
                position3D: { x: -4, y: 0, z: -3 },
                scale3D: { x: 1.6, y: 3.2, z: 1.6 },
                behaviors: [{ name: 'Solid3D', properties: {} }],
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 shrink-0"
          >
            <Trees size={12} /> Árbol
          </button>
          <button
            onClick={() =>
              onAddObject({
                name: `Luz_3D_${objects.length + 1}`,
                shape3D: 'light',
                color: '#fef08a',
                width: 30,
                height: 30,
                position3D: { x: 0, y: 4, z: 0 },
                scale3D: { x: 0.6, y: 0.6, z: 0.6 },
                lightIntensity3D: 3,
                lightDistance3D: 22,
              })
            }
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold text-yellow-300 hover:bg-yellow-600/30 border border-yellow-500/30 shrink-0"
          >
            <Lightbulb size={12} /> Luz
          </button>
        </div>

        {uiCount > 0 && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-[#18181b] border border-white/15 rounded text-[10px] font-medium text-teal-300 shadow-xl">
            <Sun size={12} />
            <span>{uiCount} HUD 2D activo(s) al jugar</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SceneEditor3D;
