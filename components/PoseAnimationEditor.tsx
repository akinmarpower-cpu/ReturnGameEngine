import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Box,
  Play,
  Pause,
  Plus,
  Copy,
  Trash2,
  X,
  Move,
  RotateCw,
  Maximize2,
  Camera,
  Save,
  RotateCcw,
  Check,
  Lock,
  Unlock,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  Upload,
  Repeat,
  FastForward,
  Hand,
} from 'lucide-react';
import type { GameAsset, GameObject, PoseAnimation, PoseFrame, Shape3D } from '../types';
import {
  applyMaterialTintToGroup,
  createObject3DMesh,
  detectSoftwareWebGL,
  disposeObject3D,
  getCachedGLTFSync,
  getEffectiveObject3DBounds,
  getObject3DPosition,
  getObject3DRotation,
  getObject3DDimensions,
  inferShape3D,
  preloadGLTFModels,
  samplePoseTimeline,
} from '../utils/threeObjectBuilder';

interface PoseAnimationEditorProps {
  assets: GameAsset[];
  onAddAsset?: (asset: GameAsset) => void;
  onClose: () => void;
  onSave: (animations: PoseAnimation[]) => void;
  initialPoseAnimations?: PoseAnimation[];
  selectedObject?: GameObject;
  onApplyPoseToSelectedObject?: (frame: PoseFrame) => void;
}

const SHAPE_OPTIONS: { id: Shape3D; label: string }[] = [
  { id: 'box', label: 'Cubo' },
  { id: 'sphere', label: 'Esfera' },
  { id: 'cylinder', label: 'Cilindro' },
  { id: 'cone', label: 'Cono' },
  { id: 'capsule', label: 'Cápsula' },
  { id: 'torus', label: 'Aro / Toro' },
  { id: 'ramp', label: 'Rampa' },
  { id: 'plane', label: 'Plano' },
  { id: 'character', label: 'Personaje' },
  { id: 'coin', label: 'Moneda' },
  { id: 'light', label: 'Faro / Luz' },
  { id: 'tree', label: 'Árbol' },
  { id: 'rock', label: 'Roca' },
];

const COLOR_SWATCHES = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#06b6d4',
  '#e2e8f0',
  '#475569',
];

type CameraPreset = 'iso' | 'front' | 'side' | 'top';

const CAMERA_PRESETS: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number]; label: string }> = {
  iso: { pos: [3.6, 2.8, 4.4], target: [0, 0.7, 0], label: 'Isométrica' },
  front: { pos: [0, 1.4, 5.0], target: [0, 0.7, 0], label: 'Frente' },
  side: { pos: [5.0, 1.4, 0], target: [0, 0.7, 0], label: 'Lateral' },
  top: { pos: [0, 6.2, 0.01], target: [0, 0, 0], label: 'Superior' },
};

const createDefaultFrame = (overrides?: Partial<PoseFrame>): PoseFrame => ({
  id: `frame_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  name: 'Pose Clave',
  shape3D: 'character',
  color: '#3b82f6',
  emissive3D: '#000000',
  emissiveIntensity3D: 0,
  modelUrl: '',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  duration: 400,
  ...overrides,
});

const frameFromObject = (obj: GameObject): PoseFrame => {
  return createDefaultFrame({
    name: obj.name || 'Desde Objeto',
    shape3D: inferShape3D(obj),
    color: obj.color && obj.color !== 'transparent' ? obj.color : '#3b82f6',
    emissive3D: obj.emissive3D || '#000000',
    emissiveIntensity3D: obj.emissiveIntensity3D || 0,
    modelUrl: obj.modelUrl || '',
    modelAnimName: obj.animation3D || undefined,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
};

const captureSceneTransformFromObject = (obj: GameObject) => {
  const pos = getObject3DPosition(obj);
  const rotRad = getObject3DRotation(obj);
  const dims = getObject3DDimensions(obj);
  return {
    position: {
      x: Number(pos.x.toFixed(2)),
      y: Number(pos.y.toFixed(2)),
      z: Number(pos.z.toFixed(2)),
    },
    rotation: {
      x: Math.round((rotRad.x * 180) / Math.PI),
      y: Math.round((rotRad.y * 180) / Math.PI),
      z: Math.round((rotRad.z * 180) / Math.PI),
    },
    scale: {
      x: Number(Math.max(0.05, dims.w).toFixed(2)),
      y: Number(Math.max(0.05, dims.h).toFixed(2)),
      z: Number(Math.max(0.05, dims.d).toFixed(2)),
    },
  };
};

export { samplePoseTimeline } from '../utils/threeObjectBuilder';

const PoseAnimationEditor: React.FC<PoseAnimationEditorProps> = ({
  assets,
  onAddAsset,
  onClose,
  onSave,
  initialPoseAnimations = [],
  selectedObject,
  onApplyPoseToSelectedObject,
}) => {
  const [animations, setAnimations] = useState<PoseAnimation[]>(() => {
    if (initialPoseAnimations.length > 0) {
      return initialPoseAnimations.map((a) => ({
        ...a,
        loop: a.loop ?? true,
        frames: (a.frames || []).map((f) => createDefaultFrame(f)),
      }));
    }
    return [
      {
        id: 'pose_anim_1',
        name: 'Secuencia Pose 3D',
        loop: true,
        frames: [
          selectedObject
            ? frameFromObject(selectedObject)
            : createDefaultFrame({ name: 'Pose Inicial', shape3D: 'character' }),
        ],
      },
    ];
  });

  const [selectedAnimId, setSelectedAnimId] = useState<string>(animations[0]?.id || '');
  const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('iso');
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate' | 'scale' | 'view'>('translate');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [uniformScale, setUniformScale] = useState<boolean>(false);
  const [showColliderBox, setShowColliderBox] = useState<boolean>(true);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  // 3D Model Upload & Animation Playback State
  const [uploadedModels, setUploadedModels] = useState<GameAsset[]>([]);
  const [modelAnimations, setModelAnimations] = useState<{ name: string; duration: number }[]>([]);
  const [selectedModelAnim, setSelectedModelAnim] = useState<string>('');
  const [isModelAnimPlaying, setIsModelAnimPlaying] = useState<boolean>(true);
  const [modelAnimSpeed, setModelAnimSpeed] = useState<number>(1);
  const [modelAnimLoop, setModelAnimLoop] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAnim = animations.find((a) => a.id === selectedAnimId) || animations[0];
  const activeFrame = activeAnim?.frames[currentFrameIndex] || activeAnim?.frames[0];

  // Three.js Refs
  const canvasMountRef = useRef<HTMLDivElement>(null);
  const activeFrameRef = useRef<PoseFrame | undefined>(activeFrame);
  activeFrameRef.current = activeFrame;
  const activeAnimRef = useRef<PoseAnimation | undefined>(activeAnim);
  activeAnimRef.current = activeAnim;
  const isPlayingRef = useRef<boolean>(isPlaying);
  isPlayingRef.current = isPlaying;
  const transformModeRef = useRef<'translate' | 'rotate' | 'scale' | 'view'>(transformMode);
  transformModeRef.current = transformMode;
  const showColliderBoxRef = useRef<boolean>(showColliderBox);
  showColliderBoxRef.current = showColliderBox;
  const colliderInfoDomRef = useRef<HTMLSpanElement>(null);
  const assetsRef = useRef<GameAsset[]>(assets);
  assetsRef.current = assets;

  const isModelAnimPlayingRef = useRef<boolean>(isModelAnimPlaying);
  isModelAnimPlayingRef.current = isModelAnimPlaying;
  const modelAnimSpeedRef = useRef<number>(modelAnimSpeed);
  modelAnimSpeedRef.current = modelAnimSpeed;
  const modelAnimLoopRef = useRef<boolean>(modelAnimLoop);
  modelAnimLoopRef.current = modelAnimLoop;
  const selectedModelAnimRef = useRef<string>(selectedModelAnim);
  selectedModelAnimRef.current = selectedModelAnim;
  const hasModelAnimationsRef = useRef<boolean>(false);
  hasModelAnimationsRef.current = modelAnimations.length > 0;

  const requestRenderRef = useRef<() => void>(() => {});
  const applyCameraPresetRef = useRef<(preset: CameraPreset) => void>(() => {});
  const playModelAnimRef = useRef<(name?: string, loop?: boolean, speed?: number) => void>(() => {});
  const playStartTimeRef = useRef<number>(0);
  const setCurrentFrameIdxRef = useRef<(idx: number) => void>(setCurrentFrameIndex);
  setCurrentFrameIdxRef.current = setCurrentFrameIndex;
  const setIsPlayingRef = useRef<(playing: boolean) => void>(setIsPlaying);
  setIsPlayingRef.current = setIsPlaying;
  const syncGizmoTransformRef = useRef<(
    pos: { x: number; y: number; z: number },
    rot: { x: number; y: number; z: number },
    scl: { x: number; y: number; z: number }
  ) => void>(() => {});
  syncGizmoTransformRef.current = (pos, rot, scl) => {
    const animIdNow = activeAnimRef.current?.id;
    const frameIdNow = activeFrameRef.current?.id;
    if (!animIdNow || !frameIdNow) return;
    setAnimations((prev) =>
      prev.map((anim) =>
        anim.id === animIdNow
          ? {
              ...anim,
              frames: anim.frames.map((f) =>
                f.id === frameIdNow ? { ...f, position: pos, rotation: rot, scale: scl } : f
              ),
            }
          : anim
      )
    );
  };

  // Initialize Pure Three.js Studio Viewport
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const width = Math.max(320, mount.clientWidth || 720);
    const height = Math.max(240, mount.clientHeight || 480);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const isSoftwareGl = detectSoftwareWebGL(renderer);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#13161f');
    scene.fog = new THREE.Fog('#13161f', 16, 48);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 120);
    camera.position.set(...CAMERA_PRESETS.iso.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 30;
    controls.target.set(...CAMERA_PRESETS.iso.target);
    controls.update();

    const tControls = new TransformControls(camera, renderer.domElement);
    tControls.setSize(0.9);
    tControls.setSpace('local');
    scene.add(tControls);

    // 3-Point Studio Lighting Rig
    const hemi = new THREE.HemisphereLight('#bfd9ff', '#1e293b', 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff4e0', 1.6);
    keyLight.position.set(5.5, 9, 6);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 30;
    const d = 6;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#93c5fd', 0.75);
    rimLight.position.set(-5, 4.5, -5);
    scene.add(rimLight);

    // Ground Grid + Shadow Receiver + Axis Reference
    const grid = new THREE.GridHelper(20, 20, '#3b82f6', '#262b38');
    grid.position.y = 0;
    scene.add(grid);

    const shadowFloorGeo = new THREE.PlaneGeometry(24, 24);
    shadowFloorGeo.rotateX(-Math.PI / 2);
    const shadowFloorMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowFloor = new THREE.Mesh(shadowFloorGeo, shadowFloorMat);
    shadowFloor.position.y = 0.004;
    shadowFloor.receiveShadow = !isSoftwareGl;
    scene.add(shadowFloor);

    const axes = new THREE.AxesHelper(1.2);
    axes.position.y = 0.015;
    scene.add(axes);

    // 3D Pose Collider Wireframe Box (follows pose position, scale, and rotation)
    const unitColliderGeo = new THREE.BoxGeometry(1, 1, 1);
    const colliderEdgesGeo = new THREE.EdgesGeometry(unitColliderGeo);
    unitColliderGeo.dispose();
    const colliderLineMat = new THREE.LineBasicMaterial({
      color: '#22d3ee',
      transparent: true,
      opacity: 0.92,
    });
    const colliderWireframe = new THREE.LineSegments(colliderEdgesGeo, colliderLineMat);
    colliderWireframe.renderOrder = 10;
    scene.add(colliderWireframe);

    // Subject Container
    let subjectGroup: THREE.Group | null = null;
    let lastVisualSig = '';
    const camGoalPos = new THREE.Vector3();
    const camGoalTarget = new THREE.Vector3();
    let isCamTransitioning = false;
    let isGizmoDragging = false;
    let lastFrameTime = performance.now();

    const syncGizmoAttachment = () => {
      const mode = transformModeRef.current;
      if (subjectGroup && !isPlayingRef.current && mode !== 'view') {
        if (tControls.object !== subjectGroup) {
          tControls.attach(subjectGroup);
        }
        tControls.setMode(mode);
        tControls.setSpace(mode === 'scale' ? 'local' : 'world');
        tControls.enabled = true;
        tControls.visible = true;
      } else {
        if (tControls.object) tControls.detach();
        tControls.enabled = false;
        tControls.visible = false;
      }
    };

    const syncSubjectVisual = (frame: PoseFrame | undefined) => {
      const f = frame || createDefaultFrame();
      const sig = [
        f.shape3D || 'box',
        f.modelUrl || '',
        f.color || '#3b82f6',
        f.emissive3D || '#000000',
        f.emissiveIntensity3D ?? 0,
      ].join('|');

      const syntheticObj: GameObject = {
        id: 999999,
        name: f.name || 'PosePreview',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        zIndex: 0,
        color: f.color || '#3b82f6',
        shape3D: f.modelUrl ? (f.shape3D || 'character') : (f.shape3D || 'box'),
        modelUrl: f.modelUrl || undefined,
        emissive3D: f.emissive3D || '#000000',
        emissiveIntensity3D: f.emissiveIntensity3D ?? 0,
        position3D: { x: 0, y: 0, z: 0 },
        rotation3D: { x: 0, y: 0, z: 0 },
        scale3D: { x: 1, y: 1, z: 1 },
      };

      // If the same 3D model is already loaded on subjectGroup, never destroy/recreate it (avoids any cube/placeholder flash)
      if (subjectGroup && f.modelUrl && subjectGroup.userData.loadedModelUrl === f.modelUrl) {
        if (sig !== lastVisualSig) {
          applyMaterialTintToGroup(subjectGroup, syntheticObj, true);
          lastVisualSig = sig;
        }
        if (
          f.modelAnimName &&
          subjectGroup.userData.playAnimation3D &&
          subjectGroup.userData.currentActionName?.toLowerCase() !== f.modelAnimName.toLowerCase()
        ) {
          subjectGroup.userData.playAnimation3D(
            f.modelAnimName,
            modelAnimLoopRef.current,
            Number(f.modelAnimSpeed ?? modelAnimSpeedRef.current) || 1
          );
        }
        return;
      }

      if (sig !== lastVisualSig || !subjectGroup) {
        // If switching to an uncached 3D model while already displaying a model, preload first so we swap seamlessly without flashing a cube
        if (subjectGroup && f.modelUrl && !getCachedGLTFSync(f.modelUrl)) {
          preloadGLTFModels([f.modelUrl]).then(() => requestRenderRef.current());
          return;
        }
        if (subjectGroup) {
          if (tControls.object === subjectGroup) tControls.detach();
          scene.remove(subjectGroup);
          disposeObject3D(subjectGroup);
          subjectGroup = null;
        }
        subjectGroup = createObject3DMesh(syntheticObj, assetsRef.current, {
          isEditor: true,
          hidePlaceholder: true,
          onModelLoaded: (data) => {
            const anims = (data?.animations || []).map((a, i) => ({
              name: a.name || `Animación ${i + 1}`,
              duration: Number(a.duration.toFixed(2)),
            }));
            setModelAnimations(anims);
            hasModelAnimationsRef.current = anims.length > 0;
            if (anims.length > 0) {
              const targetA = f.modelAnimName || anims[0].name;
              setSelectedModelAnim(targetA);
              if (subjectGroup?.userData?.playAnimation3D) {
                subjectGroup.userData.playAnimation3D(
                  targetA,
                  modelAnimLoopRef.current,
                  modelAnimSpeedRef.current
                );
              }
            } else {
              setSelectedModelAnim('');
            }
            requestRenderRef.current();
          },
        });
        scene.add(subjectGroup);
        lastVisualSig = sig;
        syncGizmoAttachment();
      }
    };

    playModelAnimRef.current = (name?: string, loop: boolean = true, speed: number = 1) => {
      if (subjectGroup?.userData?.playAnimation3D) {
        subjectGroup.userData.playAnimation3D(name || selectedModelAnimRef.current, loop, speed);
      }
    };

    const applyTransformToSubject = (
      pos: { x: number; y: number; z: number },
      rotDeg: { x: number; y: number; z: number },
      scl: { x: number; y: number; z: number }
    ) => {
      if (!subjectGroup) return;
      subjectGroup.position.set(pos.x, pos.y, pos.z);
      subjectGroup.rotation.set(
        THREE.MathUtils.degToRad(rotDeg.x),
        THREE.MathUtils.degToRad(rotDeg.y),
        THREE.MathUtils.degToRad(rotDeg.z)
      );
      subjectGroup.scale.set(
        Math.max(0.05, scl.x),
        Math.max(0.05, scl.y),
        Math.max(0.05, scl.z)
      );
    };

    const updateColliderWireframe = (
      frame: PoseFrame | undefined,
      pos: { x: number; y: number; z: number },
      rotDeg: { x: number; y: number; z: number },
      scl: { x: number; y: number; z: number }
    ) => {
      const f = frame || createDefaultFrame();
      const syntheticObj: GameObject = {
        id: 999999,
        name: f.name || 'PosePreview',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        zIndex: 0,
        color: f.color || '#3b82f6',
        shape3D: f.modelUrl ? (f.shape3D || 'character') : (f.shape3D || 'box'),
        modelUrl: f.modelUrl || undefined,
        position3D: { x: 0, y: 0, z: 0 },
        rotation3D: { x: 0, y: 0, z: 0 },
        scale3D: { x: 1, y: 1, z: 1 },
      };
      const poseSnap: PoseFrame = {
        ...f,
        position: { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 },
        rotation: { x: rotDeg.x || 0, y: rotDeg.y || 0, z: rotDeg.z || 0 },
        scale: {
          x: Math.max(0.05, scl.x || 1),
          y: Math.max(0.05, scl.y || 1),
          z: Math.max(0.05, scl.z || 1),
        },
      };
      const bounds = getEffectiveObject3DBounds(
        syntheticObj,
        {
          poseAnimation: {
            id: '_pose_preview',
            name: '_pose_preview',
            loop: false,
            frames: [poseSnap],
          },
          startTime: 0,
          loop: false,
          speed: 1,
        },
        0
      );
      colliderWireframe.visible = showColliderBoxRef.current;
      colliderWireframe.position.set(bounds.centerX, bounds.centerY, bounds.centerZ);
      colliderWireframe.scale.set(
        Math.max(0.05, bounds.width),
        Math.max(0.05, bounds.height),
        Math.max(0.05, bounds.depth)
      );
      if (colliderInfoDomRef.current) {
        colliderInfoDomRef.current.textContent = `Col (${bounds.width.toFixed(2)}×${bounds.height.toFixed(2)}×${bounds.depth.toFixed(2)})`;
      }
    };

    let rafId = 0;
    let timeoutId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;
    let lastShownTimelineIdx = -1;

    const afterDraw = (cb: () => void) => {
      if (disposed) return;
      try {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (typeof gl.fenceSync === 'function') {
          const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          gl.flush();
          const poll = () => {
            if (disposed) {
              if (sync) gl.deleteSync(sync);
              return;
            }
            const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
            if (status === gl.UNSIGNALED) {
              timeoutId = window.setTimeout(poll, 6);
            } else {
              if (sync) gl.deleteSync(sync);
              timeoutId = window.setTimeout(cb, 65);
            }
          };
          timeoutId = window.setTimeout(poll, 6);
          return;
        }
      } catch {
        // fallback below
      }
      timeoutId = window.setTimeout(cb, 65);
    };

    const drawSingleFrame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
      lastFrameTime = now;

      if (isCamTransitioning) {
        if (isSoftwareGl) {
          camera.position.copy(camGoalPos);
          controls.target.copy(camGoalTarget);
          isCamTransitioning = false;
        } else {
          camera.position.x = THREE.MathUtils.damp(camera.position.x, camGoalPos.x, 8, dt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, camGoalPos.y, 8, dt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, camGoalPos.z, 8, dt);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, camGoalTarget.x, 8, dt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, camGoalTarget.y, 8, dt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, camGoalTarget.z, 8, dt);
          if (
            camera.position.distanceToSquared(camGoalPos) < 0.0008 &&
            controls.target.distanceToSquared(camGoalTarget) < 0.0008
          ) {
            camera.position.copy(camGoalPos);
            controls.target.copy(camGoalTarget);
            isCamTransitioning = false;
          }
        }
      }

      controls.update();

      // Real-time 3D AnimationMixer update for GLTF model
      if (subjectGroup?.userData?.mixer && isModelAnimPlayingRef.current) {
        subjectGroup.userData.mixer.update(dt * (modelAnimSpeedRef.current || 1));
      }

      if (isPlayingRef.current && activeAnimRef.current && activeAnimRef.current.frames.length > 0) {
        syncGizmoAttachment();
        const elapsed = now - playStartTimeRef.current;
        const sampled = samplePoseTimeline(
          activeAnimRef.current.frames,
          elapsed,
          activeAnimRef.current.loop !== false
        );
        syncSubjectVisual(sampled.visualFrame);
        applyTransformToSubject(sampled.position, sampled.rotation, sampled.scale);
        updateColliderWireframe(sampled.visualFrame, sampled.position, sampled.rotation, sampled.scale);
        if (sampled.frameIndex !== lastShownTimelineIdx) {
          lastShownTimelineIdx = sampled.frameIndex;
          setCurrentFrameIdxRef.current(sampled.frameIndex);
        }
      } else {
        const f = activeFrameRef.current;
        syncSubjectVisual(f);
        syncGizmoAttachment();
        if (f && !isGizmoDragging) {
          applyTransformToSubject(f.position, f.rotation, f.scale);
          updateColliderWireframe(f, f.position, f.rotation, f.scale);
        }
      }

      renderer.render(scene, camera);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      rafId = requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        drawSingleFrame();
        const done = () => {
          renderBusy = false;
          if (
            !disposed &&
            (isPlayingRef.current ||
              isCamTransitioning ||
              renderDirty ||
              (isModelAnimPlayingRef.current && hasModelAnimationsRef.current))
          ) {
            requestRender();
          }
        };
        if (isSoftwareGl) {
          afterDraw(done);
        } else {
          done();
        }
      });
    };

    requestRenderRef.current = requestRender;

    applyCameraPresetRef.current = (preset: CameraPreset) => {
      const cfg = CAMERA_PRESETS[preset];
      camGoalPos.set(...cfg.pos);
      camGoalTarget.set(...cfg.target);
      isCamTransitioning = true;
      requestRender();
    };

    const onControlsStart = () => {
      isCamTransitioning = false;
    };
    const onControlsChange = () => {
      requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    const onTransformControlsChange = () => {
      requestRender();
    };
    const onTransformDraggingChanged = (event: { value?: unknown }) => {
      const dragging = Boolean(event?.value);
      isGizmoDragging = dragging;
      controls.enabled = !dragging;
      if (dragging && isPlayingRef.current) {
        setIsPlayingRef.current(false);
      }
      requestRender();
    };
    const onTransformObjectChange = () => {
      if (!subjectGroup || !isGizmoDragging) return;
      const pos = {
        x: Number(subjectGroup.position.x.toFixed(2)),
        y: Number(subjectGroup.position.y.toFixed(2)),
        z: Number(subjectGroup.position.z.toFixed(2)),
      };
      const rotDeg = {
        x: Math.round(THREE.MathUtils.radToDeg(subjectGroup.rotation.x)),
        y: Math.round(THREE.MathUtils.radToDeg(subjectGroup.rotation.y)),
        z: Math.round(THREE.MathUtils.radToDeg(subjectGroup.rotation.z)),
      };
      const scl = {
        x: Number(Math.max(0.05, subjectGroup.scale.x).toFixed(2)),
        y: Number(Math.max(0.05, subjectGroup.scale.y).toFixed(2)),
        z: Number(Math.max(0.05, subjectGroup.scale.z).toFixed(2)),
      };
      subjectGroup.scale.set(scl.x, scl.y, scl.z);
      updateColliderWireframe(activeFrameRef.current, pos, rotDeg, scl);
      syncGizmoTransformRef.current(pos, rotDeg, scl);
      requestRender();
    };
    tControls.addEventListener('change', onTransformControlsChange);
    tControls.addEventListener('dragging-changed', onTransformDraggingChanged as any);
    tControls.addEventListener('objectChange', onTransformObjectChange);

    const onResize = () => {
      if (!mount || disposed) return;
      const w = Math.max(320, mount.clientWidth || 720);
      const h = Math.max(240, mount.clientHeight || 480);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    if (resizeObserver) resizeObserver.observe(mount);

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    if (!isSoftwareGl) {
      try {
        renderer.compile(scene, camera);
      } catch {
        // Ignore pre-compile errors on edge GPUs
      }
    }

    // Initial render
    syncSubjectVisual(activeFrameRef.current);
    if (activeFrameRef.current) {
      applyTransformToSubject(
        activeFrameRef.current.position,
        activeFrameRef.current.rotation,
        activeFrameRef.current.scale
      );
      updateColliderWireframe(
        activeFrameRef.current,
        activeFrameRef.current.position,
        activeFrameRef.current.rotation,
        activeFrameRef.current.scale
      );
    }
    syncGizmoAttachment();
    requestRender();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      tControls.removeEventListener('change', onTransformControlsChange);
      tControls.removeEventListener('dragging-changed', onTransformDraggingChanged as any);
      tControls.removeEventListener('objectChange', onTransformObjectChange);
      tControls.detach();
      scene.remove(tControls);
      tControls.dispose();
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      window.removeEventListener('resize', onResize);
      if (resizeObserver) resizeObserver.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);

      if (subjectGroup) {
        scene.remove(subjectGroup);
        disposeObject3D(subjectGroup);
      }
      scene.remove(colliderWireframe);
      colliderEdgesGeo.dispose();
      colliderLineMat.dispose();
      grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach((m) => m.dispose());
      else grid.material.dispose();
      shadowFloorGeo.dispose();
      shadowFloorMat.dispose();
      axes.dispose();
      envTarget.dispose();
      renderer.dispose();
    };
  }, []);

  // Trigger re-render when frame, animation, transformMode, collider visibility, or playback state updates
  useEffect(() => {
    if (isPlaying) {
      playStartTimeRef.current = performance.now();
    }
    requestRenderRef.current();
  }, [activeFrame, selectedAnimId, currentFrameIndex, isPlaying, showColliderBox, transformMode]);

  const showTempNotice = useCallback((msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 2200);
  }, []);

  const updateCurrentFrame = (updates: Partial<PoseFrame>) => {
    if (!activeAnim || !activeFrame) return;
    setAnimations((prev) =>
      prev.map((anim) => {
        if (anim.id !== activeAnim.id) return anim;
        return {
          ...anim,
          frames: anim.frames.map((f, idx) => (idx === currentFrameIndex ? { ...f, ...updates } : f)),
        };
      })
    );
  };

  const handleScaleChange = (axis: 'x' | 'y' | 'z', val: number) => {
    if (!activeFrame) return;
    const clamped = Math.max(0.05, Number.isFinite(val) ? val : 1);
    if (uniformScale) {
      const prevAxisVal = activeFrame.scale[axis] || 1;
      const ratio = clamped / prevAxisVal;
      updateCurrentFrame({
        scale: {
          x: Number(Math.max(0.05, activeFrame.scale.x * ratio).toFixed(2)),
          y: Number(Math.max(0.05, activeFrame.scale.y * ratio).toFixed(2)),
          z: Number(Math.max(0.05, activeFrame.scale.z * ratio).toFixed(2)),
        },
      });
    } else {
      updateCurrentFrame({
        scale: { ...activeFrame.scale, [axis]: clamped },
      });
    }
  };

  const handleAddAnimation = () => {
    const newId = `pose_anim_${Date.now()}`;
    const firstFrame = selectedObject
      ? frameFromObject(selectedObject)
      : createDefaultFrame({ name: 'Pose Inicial', shape3D: 'box' });
    const newAnim: PoseAnimation = {
      id: newId,
      name: `Animación 3D ${animations.length + 1}`,
      loop: true,
      frames: [firstFrame],
    };
    setAnimations((prev) => [...prev, newAnim]);
    setSelectedAnimId(newId);
    setCurrentFrameIndex(0);
    setIsPlaying(false);
  };

  const handleDeleteAnimation = (id: string) => {
    if (animations.length <= 1) return;
    const next = animations.filter((a) => a.id !== id);
    setAnimations(next);
    if (selectedAnimId === id) {
      setSelectedAnimId(next[0].id);
      setCurrentFrameIndex(0);
    }
    setIsPlaying(false);
  };

  const handleAddFrame = () => {
    if (!activeAnim) return;
    const base = activeFrame || createDefaultFrame();
    const newFrame: PoseFrame = {
      ...base,
      id: `frame_${Date.now()}`,
      name: `Pose #${activeAnim.frames.length + 1}`,
      position: { ...base.position },
      rotation: { ...base.rotation },
      scale: { ...base.scale },
    };
    setAnimations((prev) =>
      prev.map((anim) =>
        anim.id === activeAnim.id ? { ...anim, frames: [...anim.frames, newFrame] } : anim
      )
    );
    setCurrentFrameIndex(activeAnim.frames.length);
  };

  const handleDuplicateFrame = (idx: number) => {
    if (!activeAnim) return;
    const src = activeAnim.frames[idx];
    if (!src) return;
    const clone: PoseFrame = {
      ...src,
      id: `frame_${Date.now()}_copy`,
      name: `${src.name || `Pose #${idx + 1}`} (Copia)`,
      position: { ...src.position },
      rotation: { ...src.rotation },
      scale: { ...src.scale },
    };
    setAnimations((prev) =>
      prev.map((anim) => {
        if (anim.id !== activeAnim.id) return anim;
        const frames = [...anim.frames];
        frames.splice(idx + 1, 0, clone);
        return { ...anim, frames };
      })
    );
    setCurrentFrameIndex(idx + 1);
  };

  const handleMoveFrame = (idx: number, dir: -1 | 1) => {
    if (!activeAnim) return;
    const target = idx + dir;
    if (target < 0 || target >= activeAnim.frames.length) return;
    setAnimations((prev) =>
      prev.map((anim) => {
        if (anim.id !== activeAnim.id) return anim;
        const frames = [...anim.frames];
        const [item] = frames.splice(idx, 1);
        frames.splice(target, 0, item);
        return { ...anim, frames };
      })
    );
    setCurrentFrameIndex(target);
  };

  const handleRemoveFrame = (idx: number) => {
    if (!activeAnim || activeAnim.frames.length <= 1) return;
    setAnimations((prev) =>
      prev.map((anim) =>
        anim.id === activeAnim.id
          ? { ...anim, frames: anim.frames.filter((_, i) => i !== idx) }
          : anim
      )
    );
    setCurrentFrameIndex(Math.max(0, idx - 1));
  };

  const handleResetPose = () => {
    updateCurrentFrame({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    showTempNotice('Transformación 3D restablecida');
  };

  const handleImportFromSelected = () => {
    if (!selectedObject) return;
    const imported = frameFromObject(selectedObject);
    updateCurrentFrame({
      shape3D: imported.shape3D,
      color: imported.color,
      emissive3D: imported.emissive3D,
      emissiveIntensity3D: imported.emissiveIntensity3D,
      modelUrl: imported.modelUrl,
      modelAnimName: imported.modelAnimName,
    });
    showTempNotice(`Forma importada de "${selectedObject.name}" (pose libre)`);
  };

  const handleCaptureTransformFromSelected = () => {
    if (!selectedObject) return;
    const cap = captureSceneTransformFromObject(selectedObject);
    updateCurrentFrame({
      position: cap.position,
      rotation: cap.rotation,
      scale: cap.scale,
    });
    showTempNotice(`Transformación de escena capturada de "${selectedObject.name}"`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      const newAsset: GameAsset = {
        id: `asset_3d_${Date.now()}`,
        name: cleanName || 'Modelo 3D',
        type: '3d-model',
        url: dataUrl,
      };
      if (onAddAsset) {
        onAddAsset(newAsset);
      }
      setUploadedModels((prev) => [...prev, newAsset]);
      updateCurrentFrame({
        modelUrl: dataUrl,
        name: activeFrame?.name && activeFrame.name !== 'Pose Inicial' ? activeFrame.name : cleanName,
      });
      showTempNotice(`Modelo "${cleanName}" subido y puesto en la pose 3D`);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const applyModelToAllFrames = (url?: string) => {
    if (!url) return;
    setAnimations((prev) =>
      prev.map((anim) =>
        anim.id === selectedAnimId
          ? {
              ...anim,
              frames: anim.frames.map((f) => ({
                ...f,
                modelUrl: url,
                modelAnimName: selectedModelAnim || f.modelAnimName,
              })),
            }
          : anim
      )
    );
    showTempNotice('Modelo 3D copiado a todas las poses de la secuencia');
  };

  const handleSelectModelAnim = (animName: string) => {
    setSelectedModelAnim(animName);
    updateCurrentFrame({ modelAnimName: animName });
    playModelAnimRef.current(animName, modelAnimLoop, modelAnimSpeed);
    requestRenderRef.current();
  };

  const handleToggleModelAnimPlay = () => {
    const nextState = !isModelAnimPlaying;
    setIsModelAnimPlaying(nextState);
    if (nextState) {
      playModelAnimRef.current(selectedModelAnim, modelAnimLoop, modelAnimSpeed);
    }
    requestRenderRef.current();
  };

  const handleSave = () => {
    onSave(animations);
  };

  const allModelAssets: GameAsset[] = [
    ...assets.filter(
      (a) =>
        a.type === '3d-model' ||
        String(a.type) === 'model' ||
        (a.url && (a.url.endsWith('.glb') || a.url.endsWith('.gltf') || a.url.startsWith('data:model/'))) ||
        (a.name && (a.name.endsWith('.glb') || a.name.endsWith('.gltf')))
    ),
    ...uploadedModels,
    ...(selectedObject?.modelUrl
      ? [
          {
            id: 'selected_obj_model',
            name: `${selectedObject.name || 'Objeto'} (Modelo)`,
            type: '3d-model' as const,
            url: selectedObject.modelUrl,
          },
        ]
      : []),
    ...(activeFrame?.modelUrl && !assets.some((a) => a.url === activeFrame.modelUrl)
      ? [
          {
            id: 'current_frame_model',
            name: activeFrame.name || 'Modelo en Pose',
            type: '3d-model' as const,
            url: activeFrame.modelUrl,
          },
        ]
      : []),
  ];

  const uniqueModelAssets = allModelAssets.filter(
    (item, idx, arr) => arr.findIndex((x) => x.url === item.url) === idx
  );

  return (
    <div
      data-testid="pose-animation-editor"
      className="fixed inset-0 bg-[#0d0f14] z-50 flex flex-col font-sans text-gray-200 select-none"
    >
      {/* Top Header */}
      <header className="h-14 px-4 bg-[#141720] border-b border-[#262b38] flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-pink-600/20 border border-pink-500/40 flex items-center justify-center shrink-0">
            <Box className="text-pink-400" size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-white truncate">
              Editor de Poses y Formas 3D
            </h1>
            <p className="text-[11px] text-gray-400 truncate">
              Posiciones, escalas, rotaciones y formas 3D en tiempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {savedNotice && (
            <span className="text-xs font-medium text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-md flex items-center gap-1 whitespace-nowrap">
              <Check size={12} /> {savedNotice}
            </span>
          )}
          {selectedObject && onApplyPoseToSelectedObject && activeFrame && (
            <button
              type="button"
              data-testid="pose-apply-object-btn"
              onClick={() => {
                onApplyPoseToSelectedObject(activeFrame);
                showTempNotice(`Aplicado a "${selectedObject.name}"`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-md text-xs font-bold text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles size={13} /> Aplicar a {selectedObject.name}
            </button>
          )}
          <button
            type="button"
            data-testid="pose-save-btn"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-xs font-bold text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Save size={13} /> Guardar Poses
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition-colors shrink-0"
            title="Cerrar"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Sidebar: Animations List */}
        <aside className="w-60 bg-[#11131b] border-r border-[#242936] flex flex-col shrink-0">
          <div className="p-3 border-b border-[#242936] flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-wide text-gray-400 flex items-center gap-1.5">
              <Layers size={13} className="text-pink-400" /> Secuencias 3D
            </span>
            <button
              type="button"
              data-testid="pose-add-anim-btn"
              onClick={handleAddAnimation}
              className="p-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30 text-indigo-300 rounded transition-colors"
              title="Nueva Animación de Poses"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-grow overflow-y-auto p-2 space-y-1.5">
            {animations.map((anim) => {
              const isSelected = anim.id === activeAnim?.id;
              return (
                <div
                  key={anim.id}
                  onClick={() => {
                    setSelectedAnimId(anim.id);
                    setCurrentFrameIndex(0);
                    setIsPlaying(false);
                  }}
                  className={`w-full p-2.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-between gap-2 border ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500/50 text-white font-semibold'
                      : 'hover:bg-white/5 border-transparent text-gray-400'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="truncate">{anim.name}</div>
                    <div className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                      {anim.frames.length} {anim.frames.length === 1 ? 'pose' : 'poses'} ·{' '}
                      {anim.loop !== false ? 'Bucle' : '1 vez'}
                    </div>
                  </div>
                  {animations.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAnimation(anim.id);
                      }}
                      className="p-1 text-gray-500 hover:text-red-400 rounded transition-colors shrink-0"
                      title="Eliminar animación"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {selectedObject && (
            <div className="p-3 border-t border-[#242936] space-y-1.5">
              <button
                type="button"
                onClick={handleImportFromSelected}
                className="w-full py-2 px-2.5 bg-[#1b2030] hover:bg-[#23293d] border border-[#2f364b] rounded-lg text-[11px] font-semibold text-gray-200 transition-colors"
              >
                Importar Forma de "{selectedObject.name}"
              </button>
              <button
                type="button"
                onClick={handleCaptureTransformFromSelected}
                className="w-full py-1.5 px-2.5 bg-[#161a26] hover:bg-[#1e2436] border border-[#2a3044] rounded-lg text-[10px] font-medium text-gray-400 hover:text-gray-200 transition-colors"
                title="Copia Posición, Rotación y Escala actuales del objeto en la escena"
              >
                Capturar Pos/Rot/Esc de Escena
              </button>
            </div>
          )}
        </aside>

        {/* Center: Pure Three.js Viewport + Bottom Timeline */}
        <section className="flex-1 flex flex-col min-w-0 bg-[#13161f]">
          {/* Viewport Top Toolbar (Solid Dark Bar, No backdrop-blur over WebGL) */}
          <div className="min-h-11 py-1 px-3 bg-[#171a24] border-b border-[#242936] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Interactive 3D Transform Gizmo Tools */}
              <div className="flex items-center gap-1 bg-[#11141c] p-0.5 rounded border border-[#262b38]">
                <button
                  type="button"
                  data-testid="pose-tool-translate"
                  onClick={() => setTransformMode('translate')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                    transformMode === 'translate'
                      ? 'bg-indigo-600 text-white'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                  title="Arrastrar posición libremente en 3D"
                >
                  <Move size={12} /> Mover
                </button>
                <button
                  type="button"
                  data-testid="pose-tool-rotate"
                  onClick={() => setTransformMode('rotate')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                    transformMode === 'rotate'
                      ? 'bg-cyan-600 text-white'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                  title="Rotar pose libremente en 3D"
                >
                  <RotateCw size={12} /> Rotar
                </button>
                <button
                  type="button"
                  data-testid="pose-tool-scale"
                  onClick={() => setTransformMode('scale')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                    transformMode === 'scale'
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                  title="Escalar pose libremente en 3D"
                >
                  <Maximize2 size={12} /> Escalar
                </button>
                <button
                  type="button"
                  data-testid="pose-tool-view"
                  onClick={() => setTransformMode('view')}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold transition-colors whitespace-nowrap shrink-0 ${
                    transformMode === 'view'
                      ? 'bg-slate-600 text-white'
                      : 'text-gray-300 hover:text-white hover:bg-white/5'
                  }`}
                  title="Ocultar ejes y solo rotar cámara"
                >
                  <Hand size={12} /> Vista
                </button>
              </div>

              {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setCameraPreset(preset);
                    applyCameraPresetRef.current(preset);
                  }}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    cameraPreset === preset
                      ? 'bg-pink-600 text-white'
                      : 'bg-[#1f2433] text-gray-300 hover:text-white'
                  }`}
                >
                  <Camera size={12} />
                  {CAMERA_PRESETS[preset].label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="pose-collider-toggle"
                onClick={() => setShowColliderBox((c) => !c)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                  showColliderBox
                    ? 'bg-cyan-600/25 border-cyan-400/60 text-cyan-200'
                    : 'bg-[#1f2433] border-transparent text-gray-400 hover:text-white'
                }`}
                title="Mostrar u ocultar la caja de colisión 3D (sigue posición, rotación y escala)"
              >
                <Box size={12} /> Colisión 3D
              </button>
              <button
                type="button"
                data-testid="pose-play-toggle"
                onClick={() => setIsPlaying((p) => !p)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition-colors whitespace-nowrap shrink-0 ${
                  isPlaying
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
                {isPlaying ? 'Pausar' : 'Reproducir'}
              </button>
              <button
                type="button"
                onClick={handleResetPose}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#1f2433] hover:bg-[#2a3044] text-gray-300 hover:text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
                title="Restablecer Posición, Rotación y Escala"
              >
                <RotateCcw size={12} /> Reset Pose
              </button>
            </div>
          </div>

          {/* 3D Canvas Stage */}
          <div className="flex-1 min-h-0 relative">
            <div ref={canvasMountRef} className="w-full h-full" data-testid="pose-3d-canvas" />
            {activeFrame && (
              <div className="absolute bottom-3 left-3 bg-[#11141c]/90 border border-[#2a3040] rounded-md px-3 py-1.5 text-[11px] font-mono tabular-nums text-gray-300 pointer-events-none flex flex-wrap items-center">
                <span>
                  {activeFrame.modelUrl
                    ? 'Modelo GLB'
                    : SHAPE_OPTIONS.find((s) => s.id === (activeFrame.shape3D || 'box'))?.label ||
                      'Cubo'}
                </span>
                <span className="mx-2 text-gray-600">/</span>
                <span>
                  Pos ({activeFrame.position.x.toFixed(1)}, {activeFrame.position.y.toFixed(1)},{' '}
                  {activeFrame.position.z.toFixed(1)})
                </span>
                <span className="mx-2 text-gray-600">/</span>
                <span>
                  Rot ({activeFrame.rotation.x}°, {activeFrame.rotation.y}°,{' '}
                  {activeFrame.rotation.z}°)
                </span>
                <span className="mx-2 text-gray-600">/</span>
                <span>
                  Esc ({activeFrame.scale.x.toFixed(2)}, {activeFrame.scale.y.toFixed(2)},{' '}
                  {activeFrame.scale.z.toFixed(2)})
                </span>
                <span className="mx-2 text-gray-600">/</span>
                <span ref={colliderInfoDomRef} className="text-cyan-300" data-testid="pose-collider-readout">
                  Col (1.00×1.00×1.00)
                </span>
              </div>
            )}
          </div>

          {/* Bottom Timeline */}
          <div className="h-32 bg-[#11131b] border-t border-[#242936] flex flex-col shrink-0">
            <div className="h-9 px-3 border-b border-[#242936] flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wide text-gray-400">
                Línea de Tiempo de Poses ({activeAnim?.frames.length || 0})
              </span>
              <button
                type="button"
                data-testid="pose-add-frame-btn"
                onClick={handleAddFrame}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/35 border border-indigo-500/40 text-indigo-300 text-[11px] font-bold transition-colors"
              >
                <Plus size={12} /> Añadir Pose
              </button>
            </div>
            <div className="flex-1 flex gap-2.5 items-center px-3 overflow-x-auto">
              {activeAnim?.frames.map((frame, idx) => {
                const isActive = idx === currentFrameIndex;
                return (
                  <div
                    key={frame.id}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentFrameIndex(idx);
                    }}
                    className={`min-w-[168px] h-16 rounded-lg border p-2 flex flex-col justify-between cursor-pointer transition-colors shrink-0 ${
                      isActive
                        ? 'bg-pink-600/15 border-pink-500 text-white'
                        : 'bg-[#171a24] border-[#262b38] text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] font-bold truncate">
                        #{idx + 1} · {frame.name || `Pose ${idx + 1}`}
                      </span>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveFrame(idx, -1);
                          }}
                          disabled={idx === 0}
                          className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30"
                          title="Mover a la izquierda"
                        >
                          <ChevronLeft size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveFrame(idx, 1);
                          }}
                          disabled={idx === activeAnim.frames.length - 1}
                          className="p-0.5 text-gray-400 hover:text-white disabled:opacity-30"
                          title="Mover a la derecha"
                        >
                          <ChevronRight size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateFrame(idx);
                          }}
                          className="p-0.5 text-cyan-400 hover:text-cyan-300"
                          title="Duplicar pose"
                        >
                          <Copy size={11} />
                        </button>
                        {activeAnim.frames.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFrame(idx);
                            }}
                            className="p-0.5 text-red-400 hover:text-red-300"
                            title="Eliminar pose"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-gray-400">
                      <span>{frame.duration}ms</span>
                      <span className="text-pink-300 truncate ml-2">
                        {SHAPE_OPTIONS.find((s) => s.id === (frame.shape3D || 'box'))?.label ||
                          'Cubo'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Right Inspector: Shapes, Materials, 3D Transforms */}
        <aside className="w-80 bg-[#11131b] border-l border-[#242936] flex flex-col overflow-y-auto shrink-0">
          <div className="p-3.5 border-b border-[#242936] space-y-2.5">
            <div>
              <label className="text-[11px] font-bold text-gray-400 block mb-1">
                Nombre de Secuencia
              </label>
              <input
                type="text"
                value={activeAnim?.name || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setAnimations((prev) =>
                    prev.map((a) => (a.id === activeAnim?.id ? { ...a, name: val } : a))
                  );
                }}
                className="w-full bg-[#1a1e2a] border border-[#2c3244] rounded-md px-2.5 py-1.5 text-xs text-white font-semibold focus:outline-none focus:border-indigo-500"
              />
            </div>
            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span>Repetir animación en bucle</span>
              <input
                type="checkbox"
                checked={activeAnim?.loop !== false}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAnimations((prev) =>
                    prev.map((a) => (a.id === activeAnim?.id ? { ...a, loop: checked } : a))
                  );
                }}
                className="accent-pink-500 w-4 h-4"
              />
            </label>
          </div>

          {activeFrame ? (
            <div className="p-3.5 space-y-5">
              {/* Pose Label & Duration */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-gray-400 block mb-1">
                    Nombre Pose
                  </label>
                  <input
                    type="text"
                    value={activeFrame.name || ''}
                    onChange={(e) => updateCurrentFrame({ name: e.target.value })}
                    placeholder={`Pose #${currentFrameIndex + 1}`}
                    className="w-full bg-[#1a1e2a] border border-[#2c3244] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-pink-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-gray-400 block mb-1">
                    Duración (ms)
                  </label>
                  <input
                    type="number"
                    min={20}
                    step={20}
                    value={activeFrame.duration}
                    onChange={(e) =>
                      updateCurrentFrame({ duration: Math.max(20, parseInt(e.target.value, 10) || 300) })
                    }
                    className="w-full bg-[#1a1e2a] border border-[#2c3244] rounded px-2.5 py-1.5 text-xs text-white font-mono tabular-nums focus:outline-none focus:border-pink-500"
                  />
                </div>
              </div>

              {/* 3D Shape Selector */}
              <div className="pt-3 border-t border-[#242936] space-y-2">
                <label className="text-[11px] font-bold text-gray-300 block">
                  Forma 3D (Primitiva / Compuesta)
                </label>
                <div className="grid grid-cols-3 gap-1.5" data-testid="pose-shape-grid">
                  {SHAPE_OPTIONS.map((shape) => {
                    const active = (activeFrame.shape3D || 'box') === shape.id && !activeFrame.modelUrl;
                    return (
                      <button
                        key={shape.id}
                        type="button"
                        data-testid={`pose-shape-${shape.id}`}
                        onClick={() => updateCurrentFrame({ shape3D: shape.id, modelUrl: '' })}
                        className={`px-2 py-1.5 rounded text-[11px] font-semibold border transition-colors truncate ${
                          active
                            ? 'bg-pink-600 border-pink-500 text-white'
                            : 'bg-[#171a24] border-[#292f40] text-gray-300 hover:border-gray-500'
                        }`}
                      >
                        {shape.label}
                      </button>
                    );
                  })}
                </div>

                {/* Custom GLB Model Selector & Upload */}
                <div className="pt-2 border-t border-[#242936] space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-emerald-400 block">
                      Modelo 3D (.GLB / .GLTF)
                    </label>
                    {activeFrame.modelUrl && (
                      <button
                        type="button"
                        onClick={() => updateCurrentFrame({ modelUrl: '' })}
                        className="text-[10px] text-gray-400 hover:text-red-400 underline font-medium"
                      >
                        Quitar modelo
                      </button>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {/* Upload button */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="pose-upload-model-btn"
                    className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-bold shadow-md transition-all active:scale-[0.98] border border-emerald-400/30 cursor-pointer"
                  >
                    <Upload size={14} />
                    <span>Subir Modelo 3D (.GLB / .GLTF)</span>
                  </button>

                  <select
                    value={activeFrame.modelUrl || ''}
                    onChange={(e) => {
                      updateCurrentFrame({ modelUrl: e.target.value });
                    }}
                    data-testid="pose-model-selector"
                    className="w-full bg-[#1a1e2a] border border-[#2c3244] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">-- Usar Forma 3D Procedural --</option>
                    {uniqueModelAssets.map((a) => (
                      <option key={a.id || a.url} value={a.url}>
                        📦 {a.name}
                      </option>
                    ))}
                  </select>

                  {activeFrame.modelUrl && (
                    <button
                      type="button"
                      onClick={() => applyModelToAllFrames(activeFrame.modelUrl)}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-medium cursor-pointer"
                    >
                      Copiar este modelo a todas las poses
                    </button>
                  )}

                  {/* 3D Model Embedded Animation Player */}
                  {modelAnimations.length > 0 && (
                    <div
                      data-testid="pose-model-anim-panel"
                      className="mt-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1.5">
                          <Sparkles size={12} className="text-emerald-400" />
                          Animación 3D del Modelo ({modelAnimations.length})
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                          GLTF
                        </span>
                      </div>

                      <select
                        value={selectedModelAnim}
                        onChange={(e) => handleSelectModelAnim(e.target.value)}
                        data-testid="pose-model-anim-select"
                        className="w-full bg-[#121620] border border-emerald-500/40 rounded px-2 py-1 text-xs text-emerald-200 font-semibold focus:outline-none"
                      >
                        {modelAnimations.map((ma) => (
                          <option key={ma.name} value={ma.name}>
                            ▶ {ma.name} ({ma.duration}s)
                          </option>
                        ))}
                      </select>

                      <div className="flex items-center justify-between gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={handleToggleModelAnimPlay}
                          data-testid="pose-model-anim-play-btn"
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-2.5 rounded text-[11px] font-bold transition-colors ${
                            isModelAnimPlaying
                              ? 'bg-amber-600 hover:bg-amber-500 text-white'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                          }`}
                        >
                          {isModelAnimPlaying ? <Pause size={11} /> : <Play size={11} />}
                          <span>{isModelAnimPlaying ? 'Pausar' : 'Reproducir'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const next = !modelAnimLoop;
                            setModelAnimLoop(next);
                            playModelAnimRef.current(selectedModelAnim, next, modelAnimSpeed);
                          }}
                          className={`p-1 px-2 rounded text-[10px] font-bold border transition-colors flex items-center gap-1 ${
                            modelAnimLoop
                              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                              : 'bg-gray-800 border-gray-700 text-gray-400'
                          }`}
                          title={modelAnimLoop ? 'Bucle activado' : 'Reproducir una vez'}
                        >
                          <Repeat size={11} />
                          <span>{modelAnimLoop ? 'Bucle' : '1 vez'}</span>
                        </button>

                        <div className="flex items-center gap-1 bg-[#121620] p-0.5 rounded border border-[#262b38]">
                          {[0.5, 1, 1.5, 2].map((spd) => (
                            <button
                              key={spd}
                              type="button"
                              onClick={() => {
                                setModelAnimSpeed(spd);
                                playModelAnimRef.current(selectedModelAnim, modelAnimLoop, spd);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors ${
                                modelAnimSpeed === spd
                                  ? 'bg-emerald-600 text-white'
                                  : 'text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              {spd}x
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-1 flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">
                          Animación activa en pose:
                        </span>
                        <span className="text-[10px] font-mono text-emerald-300 font-bold">
                          {selectedModelAnim || 'Ninguna'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Material Color & Emissive */}
              <div className="pt-3 border-t border-[#242936] space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-gray-300">Color Base</label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-gray-400 uppercase">
                      {activeFrame.color || '#3b82f6'}
                    </span>
                    <input
                      type="color"
                      value={activeFrame.color || '#3b82f6'}
                      onChange={(e) => updateCurrentFrame({ color: e.target.value })}
                      className="w-7 h-6 rounded border border-[#2c3244] bg-transparent cursor-pointer"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {COLOR_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => updateCurrentFrame({ color: hex })}
                      className={`w-5 h-5 rounded border ${
                        activeFrame.color === hex ? 'border-white scale-110' : 'border-black/40'
                      }`}
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Emisión</label>
                    <input
                      type="color"
                      value={activeFrame.emissive3D || '#000000'}
                      onChange={(e) => updateCurrentFrame({ emissive3D: e.target.value })}
                      className="w-full h-7 rounded border border-[#2c3244] bg-[#1a1e2a] cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">
                      Brillo Emisivo ({(activeFrame.emissiveIntensity3D ?? 0).toFixed(1)})
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={activeFrame.emissiveIntensity3D ?? 0}
                      onChange={(e) =>
                        updateCurrentFrame({ emissiveIntensity3D: parseFloat(e.target.value) })
                      }
                      className="w-full accent-pink-500"
                    />
                  </div>
                </div>
              </div>

              {/* 3D Position */}
              <div className="pt-3 border-t border-[#242936] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Move size={13} className="text-pink-400" />
                    <span>Posición 3D (Libre)</span>
                  </div>
                  <span className="text-[10px] text-gray-500">Offset relativo</span>
                </div>
                {(['x', 'y', 'z'] as const).map((axis) => {
                  const posVal = activeFrame.position[axis];
                  const minPos = Math.min(-25, Math.floor(posVal) - 5);
                  const maxPos = Math.max(25, Math.ceil(posVal) + 5);
                  return (
                    <div key={axis} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold uppercase w-4 text-gray-400">
                        {axis}
                      </span>
                      <input
                        type="range"
                        min={minPos}
                        max={maxPos}
                        step="0.05"
                        value={posVal}
                        onChange={(e) =>
                          updateCurrentFrame({
                            position: { ...activeFrame.position, [axis]: parseFloat(e.target.value) },
                          })
                        }
                        className="flex-1 accent-pink-500 h-1.5 bg-[#1c202e] rounded-full"
                      />
                      <input
                        type="number"
                        step="0.1"
                        data-testid={`pose-pos-${axis}`}
                        value={posVal}
                        onChange={(e) =>
                          updateCurrentFrame({
                            position: {
                              ...activeFrame.position,
                              [axis]: parseFloat(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-16 bg-[#1a1e2a] border border-[#2c3244] rounded px-1.5 py-1 text-[11px] font-mono tabular-nums text-right text-white"
                      />
                    </div>
                  );
                })}
              </div>

              {/* 3D Rotation */}
              <div className="pt-3 border-t border-[#242936] space-y-2.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                  <RotateCw size={13} className="text-cyan-400" />
                  <span>Rotación 3D (Grados)</span>
                </div>
                {(['x', 'y', 'z'] as const).map((axis) => {
                  const rotVal = activeFrame.rotation[axis];
                  const minRot = Math.min(-360, Math.floor(rotVal / 90) * 90 - 90);
                  const maxRot = Math.max(360, Math.ceil(rotVal / 90) * 90 + 90);
                  return (
                    <div key={axis} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold uppercase w-4 text-gray-400">
                        {axis}
                      </span>
                      <input
                        type="range"
                        min={minRot}
                        max={maxRot}
                        step="1"
                        value={rotVal}
                        onChange={(e) =>
                          updateCurrentFrame({
                            rotation: {
                              ...activeFrame.rotation,
                              [axis]: parseFloat(e.target.value) || 0,
                            },
                          })
                        }
                        className="flex-1 accent-cyan-400 h-1.5 bg-[#1c202e] rounded-full"
                      />
                      <input
                        type="number"
                        step="1"
                        data-testid={`pose-rot-${axis}`}
                        value={rotVal}
                        onChange={(e) =>
                          updateCurrentFrame({
                            rotation: {
                              ...activeFrame.rotation,
                              [axis]: parseFloat(e.target.value) || 0,
                            },
                          })
                        }
                        className="w-16 bg-[#1a1e2a] border border-[#2c3244] rounded px-1.5 py-1 text-[11px] font-mono tabular-nums text-right text-white"
                      />
                    </div>
                  );
                })}
              </div>

              {/* 3D Scale */}
              <div className="pt-3 border-t border-[#242936] space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-gray-200">
                    <Maximize2 size={13} className="text-emerald-400" />
                    <span>Escala 3D (Libre)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUniformScale((u) => !u)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                      uniformScale
                        ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-[#1a1e2a] border-[#2c3244] text-gray-400'
                    }`}
                    title="Bloquear proporción uniforme"
                  >
                    {uniformScale ? <Lock size={10} /> : <Unlock size={10} />}
                    Uniforme
                  </button>
                </div>
                {(['x', 'y', 'z'] as const).map((axis) => {
                  const sclVal = activeFrame.scale[axis];
                  const maxScl = Math.max(15, Math.ceil(sclVal) + 3);
                  return (
                    <div key={axis} className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold uppercase w-4 text-gray-400">
                        {axis}
                      </span>
                      <input
                        type="range"
                        min="0.05"
                        max={maxScl}
                        step="0.05"
                        value={sclVal}
                        onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value))}
                        className="flex-1 accent-emerald-400 h-1.5 bg-[#1c202e] rounded-full"
                      />
                      <input
                        type="number"
                        min="0.05"
                        step="0.05"
                        data-testid={`pose-scale-${axis}`}
                        value={sclVal}
                        onChange={(e) => handleScaleChange(axis, parseFloat(e.target.value))}
                        className="w-16 bg-[#1a1e2a] border border-[#2c3244] rounded px-1.5 py-1 text-[11px] font-mono tabular-nums text-right text-white"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center p-6 text-center text-gray-500">
              <Box size={24} className="text-gray-600 mb-2" />
              <p className="text-xs">No hay pose seleccionado en esta secuencia.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};

export default PoseAnimationEditor;
