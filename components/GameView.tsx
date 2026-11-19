
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { Scene, GameObject, Animation, GameAsset, Behavior, Variable, Action, Condition, CollisionProperties, ProjectData, Shape3D, PoseAnimation } from '../types';
import { samplePoseTimeline } from './PoseAnimationEditor';
import {
  applyMaterialTintToGroup,
  build3DVisualSignature,
  createObject3DMesh,
  createUniqueId,
  detectSoftwareWebGL,
  boxesOverlap3D,
  solveOBBCollision3D,
  getWalkableSurface3D,
  getEffectiveObject3DBounds,
  type Object3DBounds,
  disposeObject3D,
  getCachedGLTFSync,
  getObject3DDimensions,
  getObject3DPosition,
  getObject3DRotation,
  inferShape3D,
  isSolidObject3D,
  preloadGLTFModels,
  sync3DTo2D,
} from '../utils/threeObjectBuilder';

const memorySaveSlots = new Map<string, string>();

const TRANSIENT_SERIALIZE_KEYS = new Set([
  '_originalBehaviors',
  '_solidUpdatedInPrepass',
  '_solidUpdatedInPrepass3D',
  '_preEvt',
  '_mutatedBy3DAction',
  '_moved3DThisFrame',
  '_lastSolidPos3D',
  '_lastSolidX',
  '_lastSolidY',
  '_platformDx',
  '_platformDy',
  '_platformDx3D',
  '_platformDy3D',
  '_platformDz3D',
  '_standingPlatformId',
  '_standingPlatformId3D',
  '_runtimeAnim3D',
  '_pendingLoopImpulse3D',
  '_burstImpulse3D',
  '_effectiveVel3D',
  '_prevPoseOffY',
  'mixer',
  'material',
  'geometry',
]);

function safeSerialize(obj: any): string {
  const stack: object[] = [];
  const cloneClean = (value: any): any => {
    if (value === null || value === undefined) return value;
    const t = typeof value;
    if (t === 'function' || t === 'symbol') return undefined;
    if (t !== 'object') return value;
    if (
      (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) ||
      (typeof Window !== 'undefined' && value instanceof Window) ||
      (typeof Document !== 'undefined' && value instanceof Document)
    ) {
      return undefined;
    }
    if (stack.includes(value)) {
      return undefined;
    }
    stack.push(value);
    try {
      if (Array.isArray(value)) {
        const arr: any[] = [];
        for (let i = 0; i < value.length; i++) {
          const item = cloneClean(value[i]);
          arr.push(item === undefined ? null : item);
        }
        return arr;
      }
      const out: Record<string, any> = {};
      for (const key of Object.keys(value)) {
        if (key.startsWith('_three') || TRANSIENT_SERIALIZE_KEYS.has(key)) continue;
        const cleaned = cloneClean(value[key]);
        if (cleaned !== undefined) {
          out[key] = cleaned;
        }
      }
      return out;
    } finally {
      stack.pop();
    }
  };
  return JSON.stringify(cloneClean(obj));
}

function parseNumericValue(raw: any): number | null {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const trimmed = String(raw).trim().replace(',', '.');
  if (trimmed === '') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function roundCleanNumber(num: number): number {
  const rounded = Math.round(num * 1e9) / 1e9;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeVariableInputValue(raw: any): string | number | boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Number.isFinite(raw) ? roundCleanNumber(raw) : 0;
  if (raw === null || raw === undefined) return '';
  const num = parseNumericValue(raw);
  return num !== null ? roundCleanNumber(num) : String(raw);
}

function sanitizeLoadedGameObjects(rawObjects: any, is3D: boolean): GameObject[] {
  if (!Array.isArray(rawObjects)) return [];
  return rawObjects
    .filter((o): o is GameObject => Boolean(o && typeof o === 'object'))
    .map((raw) => {
      const obj: GameObject = { ...raw };
      if (Array.isArray(obj.behaviors)) {
        obj.behaviors = obj.behaviors.filter((b): b is Behavior => Boolean(b && typeof b === 'object' && b.name));
      } else {
        obj.behaviors = [];
      }
      if (Array.isArray(obj._originalBehaviors)) {
        const cleanOrig = obj._originalBehaviors.filter((b): b is Behavior => Boolean(b && typeof b === 'object' && b.name));
        obj._originalBehaviors = cleanOrig.length > 0 ? cleanOrig : obj.behaviors.map(b => ({ ...b, properties: { ...(b.properties || {}) } }));
      } else {
        obj._originalBehaviors = obj.behaviors.map(b => ({ ...b, properties: { ...(b.properties || {}) } }));
      }
      delete (obj as any)._solidUpdatedInPrepass;
      delete (obj as any)._solidUpdatedInPrepass3D;
      delete (obj as any)._preEvt;
      delete (obj as any)._mutatedBy3DAction;
      delete (obj as any)._moved3DThisFrame;
      delete (obj as any)._lastSolidPos3D;
      delete (obj as any)._lastSolidX;
      delete (obj as any)._lastSolidY;
      delete (obj as any)._platformDx;
      delete (obj as any)._platformDy;
      delete (obj as any)._platformDx3D;
      delete (obj as any)._platformDy3D;
      delete (obj as any)._platformDz3D;
      delete (obj as any)._standingPlatformId;
      delete (obj as any)._standingPlatformId3D;
      delete (obj as any)._runtimeAnim3D;
      delete (obj as any)._pendingLoopImpulse3D;
      delete (obj as any)._burstImpulse3D;
      delete (obj as any)._effectiveVel3D;
      delete (obj as any)._customVx;
      delete (obj as any)._customVy;
      delete (obj as any).rpgKnockbackVx;
      delete (obj as any).rpgKnockbackVy;
      obj.vx = 0;
      obj.vy = 0;
      obj.vx3D = 0;
      obj.vy3D = 0;
      obj.vz3D = 0;
      obj.pendingMovements = [];
      obj.tweens = [];
      if (is3D && !obj.isUI) {
        obj.position3D = getObject3DPosition(obj);
        const dims = getObject3DDimensions(obj);
        obj.scale3D = { x: dims.w, y: dims.h, z: dims.d };
        obj.rotation3D = getObject3DRotation(obj);
        sync3DTo2D(obj);
      }
      return obj;
    });
}

export interface GameState {
  gameObjects: GameObject[];
  gameVariables: Record<string, any>;
}

interface GameViewProps {
  scene: Scene;
  sceneMode?: '2d' | '3d';
  allScenes: Scene[];
  animations: Animation[];
  assets: GameAsset[];
  globalObjects?: GameObject[];
  globalVariables: Variable[];
  gameWidth: number;
  gameHeight: number;
  responsive?: boolean;
  joystick?: ProjectData['joystick'];
  initialState?: GameState;
  onExit: (finalState: GameState) => void;
  onGoToScene: (sceneName: string) => void;
  projectData?: ProjectData;
}

interface ActiveAnimation {
    animation: Animation;
    startTime: number;
}

const getObjectAbsolutePosition = (objectId: number, objectsById: Map<number, GameObject>): { x: number; y: number } => {
    let currentId: number | null | undefined = objectId;
    let totalX = 0;
    let totalY = 0;
    let safety = 100; // Prevent infinite loops
    while(currentId && safety-- > 0) {
        const obj = objectsById.get(currentId);
        if (!obj) break;
        totalX += obj.x;
        totalY += obj.y;
        currentId = obj.parentId;
    }
    return { x: totalX, y: totalY };
};

const isObjectUI = (obj: GameObject, objectsById: Map<number, GameObject>): boolean => {
    let curr: GameObject | undefined = obj;
    let safety = 100;
    while (curr && safety-- > 0) {
        if (curr.isUI) return true;
        if (!curr.parentId) break;
        curr = objectsById.get(curr.parentId);
    }
    return false;
};

type CollisionBox2D = {
    x: number;
    y: number;
    width: number;
    height: number;
    cx: number;
    cy: number;
    halfW: number;
    halfH: number;
    rotRad: number;
};

const getCollisionBox = (objWithAbsPos: GameObject & {x: number, y: number, absRotation?: number}): CollisionBox2D => {
    const scaleX = Math.abs((objWithAbsPos.scaleX ?? 1) * (objWithAbsPos.animScaleX ?? 1));
    const scaleY = Math.abs((objWithAbsPos.scaleY ?? 1) * (objWithAbsPos.animScaleY ?? 1));
    
    const offsetX = objWithAbsPos.animOffsetX ?? 0;
    const offsetY = objWithAbsPos.animOffsetY ?? 0;
    const rotDeg = (objWithAbsPos.absRotation !== undefined ? objWithAbsPos.absRotation : (objWithAbsPos.rotation || 0)) + (objWithAbsPos.animRotation || 0);
    const rotation = rotDeg * Math.PI / 180;

    // Base dimensions and center
    let w = objWithAbsPos.width * scaleX;
    let h = objWithAbsPos.height * scaleY;
    let cx = objWithAbsPos.x + offsetX + objWithAbsPos.width / 2;
    let cy = objWithAbsPos.y + offsetY + objWithAbsPos.height / 2;

    if (objWithAbsPos.useCustomCollision && objWithAbsPos.collision) {
        w = objWithAbsPos.collision.width * scaleX;
        h = objWithAbsPos.collision.height * scaleY;
        cx = objWithAbsPos.x + offsetX + objWithAbsPos.width / 2 + (objWithAbsPos.collision.offsetX + objWithAbsPos.collision.width / 2 - objWithAbsPos.width / 2) * scaleX;
        cy = objWithAbsPos.y + offsetY + objWithAbsPos.height / 2 + (objWithAbsPos.collision.offsetY + objWithAbsPos.collision.height / 2 - objWithAbsPos.height / 2) * scaleY;
    }

    const halfW = w / 2;
    const halfH = h / 2;

    if (Math.abs(rotation) < 1e-4) {
        return {
            x: cx - halfW,
            y: cy - halfH,
            width: w,
            height: h,
            cx,
            cy,
            halfW,
            halfH,
            rotRad: 0,
        };
    }

    // Calculate AABB broadphase of rotated rectangle
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const newW = w * cos + h * sin;
    const newH = w * sin + h * cos;

    return {
        x: cx - newW / 2,
        y: cy - newH / 2,
        width: newW,
        height: newH,
        cx,
        cy,
        halfW,
        halfH,
        rotRad: rotation,
    };
};

const getCollisionMTV2D = (
    b1: { x: number; y: number; width: number; height: number; cx?: number; cy?: number; halfW?: number; halfH?: number; rotRad?: number },
    b2: { x: number; y: number; width: number; height: number; cx?: number; cy?: number; halfW?: number; halfH?: number; rotRad?: number }
): { x: number; y: number; depth: number } | null => {
    if (
        b1.x >= b2.x + b2.width ||
        b1.x + b1.width <= b2.x ||
        b1.y >= b2.y + b2.height ||
        b1.y + b1.height <= b2.y
    ) {
        return null;
    }

    const r1Angle = b1.rotRad || 0;
    const r2Angle = b2.rotRad || 0;
    const c1x = b1.cx ?? (b1.x + b1.width / 2);
    const c1y = b1.cy ?? (b1.y + b1.height / 2);
    const c2x = b2.cx ?? (b2.x + b2.width / 2);
    const c2y = b2.cy ?? (b2.y + b2.height / 2);
    const hw1 = b1.halfW ?? (b1.width / 2);
    const hh1 = b1.halfH ?? (b1.height / 2);
    const hw2 = b2.halfW ?? (b2.width / 2);
    const hh2 = b2.halfH ?? (b2.height / 2);

    if (Math.abs(r1Angle) < 1e-4 && Math.abs(r2Angle) < 1e-4) {
        const ox = Math.min(b1.x + b1.width, b2.x + b2.width) - Math.max(b1.x, b2.x);
        const oy = Math.min(b1.y + b1.height, b2.y + b2.height) - Math.max(b1.y, b2.y);
        if (ox <= 0 || oy <= 0) return null;
        if (ox < oy) {
            return { x: c1x < c2x ? -ox : ox, y: 0, depth: ox };
        }
        return { x: 0, y: c1y < c2y ? -oy : oy, depth: oy };
    }

    const cos1 = Math.cos(r1Angle), sin1 = Math.sin(r1Angle);
    const cos2 = Math.cos(r2Angle), sin2 = Math.sin(r2Angle);
    const u1x = cos1, u1y = sin1, v1x = -sin1, v1y = cos1;
    const u2x = cos2, u2y = sin2, v2x = -sin2, v2y = cos2;

    const dx = c1x - c2x;
    const dy = c1y - c2y;
    const axes: [number, number][] = [
        [u1x, u1y],
        [v1x, v1y],
        [u2x, u2y],
        [v2x, v2y],
    ];

    let minOverlap = Infinity;
    let bestX = 0;
    let bestY = -1;

    for (let i = 0; i < axes.length; i++) {
        const ax = axes[i][0];
        const ay = axes[i][1];
        const proj1 = Math.abs(ax * u1x + ay * u1y) * hw1 + Math.abs(ax * v1x + ay * v1y) * hh1;
        const proj2 = Math.abs(ax * u2x + ay * u2y) * hw2 + Math.abs(ax * v2x + ay * v2y) * hh2;
        const dist = dx * ax + dy * ay;
        const overlap = proj1 + proj2 - Math.abs(dist);
        if (overlap <= 0) return null;
        if (overlap < minOverlap) {
            minOverlap = overlap;
            const sign = dist >= 0 ? 1 : -1;
            bestX = ax * sign;
            bestY = ay * sign;
        }
    }

    if (!Number.isFinite(minOverlap)) return null;
    return { x: bestX * minOverlap, y: bestY * minOverlap, depth: minOverlap };
};

const getRotatedSurfaceY = (playerX: number, playerWidth: number, solid: GameObject & { absX?: number; absY?: number; absRotation?: number }): number | null => {
    const rotDeg = solid.absRotation !== undefined ? solid.absRotation : (solid.rotation || 0);
    const mod90 = Math.abs(rotDeg % 90);
    if (mod90 < 0.5 || Math.abs(mod90 - 90) < 0.5) {
        return null;
    }

    const box = getCollisionBox({ ...solid, x: solid.absX !== undefined ? solid.absX : solid.x, y: solid.absY !== undefined ? solid.absY : solid.y } as any);
    const cos = Math.cos(box.rotRad);
    const sin = Math.sin(box.rotRad);
    const ux = cos, uy = sin;
    const vx = -sin, vy = cos;

    // 4 candidate edges: [normalX, normalY, normalDist, tangentX, tangentY, tangentHalf]
    const candidates: [number, number, number, number, number, number][] = [
        [-vx, -vy, box.halfH, ux, uy, box.halfW],
        [vx, vy, box.halfH, ux, uy, box.halfW],
        [ux, uy, box.halfW, vx, vy, box.halfH],
        [-ux, -uy, box.halfW, vx, vy, box.halfH],
    ];

    let topEdge = candidates[0];
    for (let i = 1; i < candidates.length; i++) {
        if (candidates[i][1] < topEdge[1]) {
            topEdge = candidates[i];
        }
    }
    const nx = topEdge[0], ny = topEdge[1], dF = topEdge[2];
    const tx = topEdge[3], ty = topEdge[4], hT = topEdge[5];

    // Upward normal in 2D screen coordinates has ny < 0; reject steep walls (> ~70 deg)
    if (ny > -0.35) {
        return null;
    }

    const mx = box.cx + nx * dF;
    const my = box.cy + ny * dF;
    const p1x = mx - tx * hT;
    const p2x = mx + tx * hT;
    const minEdgeX = Math.min(p1x, p2x);
    const maxEdgeX = Math.max(p1x, p2x);

    const pLeft = playerX;
    const pRight = playerX + playerWidth;
    if (pRight < minEdgeX - 2 || pLeft > maxEdgeX + 2) {
        return null;
    }

    const clampedLeft = Math.max(minEdgeX, Math.min(maxEdgeX, pLeft));
    const clampedMid = Math.max(minEdgeX, Math.min(maxEdgeX, playerX + playerWidth * 0.5));
    const clampedRight = Math.max(minEdgeX, Math.min(maxEdgeX, pRight));
    const sampleXs = [clampedLeft, clampedMid, clampedRight];

    let highestSurfaceY: number | null = null;
    for (const sx of sampleXs) {
        const sy = my - ((sx - mx) * nx) / ny;
        if (Number.isFinite(sy) && (highestSurfaceY === null || sy < highestSurfaceY)) {
            highestSurfaceY = sy;
        }
    }
    return highestSurfaceY;
};


const GameView: React.FC<GameViewProps> = ({ scene, sceneMode, allScenes, animations, assets, globalObjects, globalVariables, gameWidth: initialGameWidth, gameHeight: initialGameHeight, responsive, joystick, initialState, onExit, onGoToScene, projectData }) => {
  const hasExplicitSceneMode = scene?.sceneMode === '2d' || scene?.sceneMode === '3d';
  const hasExplicitPropMode = sceneMode === '2d' || sceneMode === '3d';
  const inferredHas3D = Boolean(
    scene?.gameObjects?.some(o =>
      o.modelUrl ||
      o.shape3D ||
      o.behaviors?.some(b =>
        ['Player3D', 'Solid3D', 'Physics3D', 'FollowCamera3D', 'Patrol3D', 'Oscillate3D', 'Rotate3D', 'Boss3D'].includes(b.name)
      )
    ) ||
    scene?.events?.some(e => e.dimension === '3D' || e.programmingMode === 'blocks')
  );
  const is3DScene = hasExplicitSceneMode
    ? scene!.sceneMode === '3d'
    : hasExplicitPropMode
      ? sceneMode === '3d'
      : inferredHas3D;
  const previewMode: string = is3DScene ? '3d' : '2d';
  const is3DModeRef = useRef<boolean>(is3DScene);
  is3DModeRef.current = is3DScene;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeContainerRef = useRef<HTMLDivElement>(null);
  const threeRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const threeSceneRef = useRef<THREE.Scene | null>(null);
  const threeCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const threeControlsRef = useRef<OrbitControls | null>(null);
  const threeAmbientLightRef = useRef<THREE.AmbientLight | null>(null);
  const threeSunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const threeMeshMapRef = useRef<Map<number, { group: THREE.Group; signature: string }>>(new Map());
  const threeSkyboxTextureRef = useRef<THREE.Texture | null>(null);
  const threeSkyboxUrlRef = useRef<string>('');
  const camera3DRuntimeRef = useRef<{
    mode: string;
    offset: { x: number; y: number; z: number };
    targetObjectName?: string;
    fogEnabled?: boolean;
    fogColor?: string;
    fogDensity?: number;
    skyboxImageUrl?: string;
    yaw?: number;
    pitch?: number;
    fpPitch?: number;
    distance?: number;
  }>({
    mode: scene?.camera3DMode || 'thirdPerson',
    offset: scene?.camera3DOffset ? { ...scene.camera3DOffset } : { x: 0, y: 5, z: 9 },
    fogEnabled: scene?.fogEnabled ?? false,
    fogColor: scene?.fogColor || scene?.backgroundColor || '#111827',
    fogDensity: scene?.fogDensity ?? 0.02,
    skyboxImageUrl: scene?.skyboxImageUrl || '',
  });

  const orbitYawRef = useRef(0);
  const orbitPitchRef = useRef(0.38);
  const orbitFirstPersonPitchRef = useRef(0);
  const orbitDistanceRef = useRef(9);
  const isCameraOrbitingRef = useRef(false);
  const lastOrbitPointerRef = useRef({ x: 0, y: 0 });
  const activePointers3DRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchInitialDistanceRef = useRef<number | null>(null);
  const pinchInitialOrbitDistanceRef = useRef<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [dimensions, setDimensions] = useState({ width: initialGameWidth, height: initialGameHeight });
  const gameObjectsRef = useRef<GameObject[]>([]);
  const keysPressed = useRef<Record<string, boolean>>({});
  const suppressedKeysUntilReleaseRef = useRef<Set<string>>(new Set());
  const gamepadMoveLockUntilNeutralRef = useRef<boolean>(false);
  const playerPressStates = useRef<Record<number, { jumpPressed: boolean; attackPressed: boolean }>>({});
  
  const myPlayerNumber = useRef<number | null>(null);
  const remotePlayers = useRef<Record<number, any>>({});
  const lastEmitTime = useRef<number>(0);
  const lastEmittedState = useRef<string>('');
  const selectedPlayerIdRef = useRef<number | null>(null);
  const actionsPressed = useRef<Record<string, any>>({});
  const gameVariables = useRef<Record<string, string | number | boolean>>({});
  const activeAnimations = useRef<Map<number, ActiveAnimation>>(new Map());
  const activePoseAnimationsRef = useRef<Map<number, {
    poseAnimation: PoseAnimation;
    startTime: number;
    loop: boolean;
    speed: number;
    lastVisualFrameId?: string;
    finished?: boolean;
    origVisual?: {
      shape3D?: Shape3D;
      color?: string;
      emissive3D?: string;
      emissiveIntensity3D?: number;
      modelUrl?: string;
    };
  }>>(new Map());
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const videoCache = useRef<Map<string, HTMLVideoElement>>(new Map());
  const camera = useRef({ x: 0, y: 0, zoom: 1 });
  const [uiObjects, setUiObjects] = useState<GameObject[]>([]);
  const backgroundMusicPlayer = useRef<HTMLAudioElement | null>(null);
  const currentBackgroundMusicId = useRef<string | null>(null);
  const [runtimeBackgroundColor, setRuntimeBackgroundColor] = useState(scene.backgroundColor);
  const runtimeBgColorRef = useRef<string>(scene.backgroundColor || '#111827');
  runtimeBgColorRef.current = runtimeBackgroundColor || scene.backgroundColor || '#111827';
  const [dialogue, setDialogue] = useState<{ text: string; speaker?: string; onCompleteActions?: Action[] } | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleValue, setConsoleValue] = useState('');
  const [joystickData, setJoystickData] = useState<{x: number, y: number} | null>(null);
  const [joystickRuntimeEnabled, setJoystickRuntimeEnabled] = useState(joystick?.enabled ?? false);
  useEffect(() => {
    setJoystickRuntimeEnabled(joystick?.enabled ?? false);
  }, [joystick?.enabled]);

  useEffect(() => {
    if (assets && assets.length > 0) {
      assets.forEach(asset => {
        if (asset.type === 'image' && asset.url) {
          if (!imageCache.current.has(asset.url) || !imageCache.current.has(asset.id)) {
            const img = new Image();
            img.src = asset.url;
            img.onload = () => {
              imageCache.current.set(asset.url, img);
              imageCache.current.set(asset.id, img);
              if (asset.name) imageCache.current.set(asset.name, img);
            };
          }
        }
      });
    }
  }, [assets]);
  const draggingRef = useRef<{ id: number; offsetX: number; offsetY: number; initialX: number; initialY: number } | null>(null);
  const floatingFeedbacks = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    text: string;
    color: string;
    opacity: number;
    lifetime: number;
  }[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  useEffect(() => {
    selectedPlayerIdRef.current = selectedPlayerId;
  }, [selectedPlayerId]);
  const [activeInteractable, setActiveInteractable] = useState<{ id: number; name: string; prompt: string } | null>(null);
  const activeInteractableRef = useRef<{ id: number; name: string; prompt: string } | null>(null);

  const playShootSynthSound = () => {
      try {
          initAudio();
          const ctx = audioContextRef.current;
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(400, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.12);
          
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.12);
      } catch (e) {}
  };

  const playSwordSynthSound = () => {
      try {
          initAudio();
          const ctx = audioContextRef.current;
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(120, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(500, ctx.currentTime + 0.08);
          
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
          
          osc.start();
          osc.stop(ctx.currentTime + 0.08);
      } catch (e) {}
  };

  useEffect(() => {
    if (!responsive) {
        setDimensions({ width: initialGameWidth, height: initialGameHeight });
        return;
    }

    const mainElement = mainRef.current;
    if (!mainElement) return;

    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            setDimensions({ width, height });
        }
    });

    observer.observe(mainElement);
    return () => observer.disconnect();
  }, [responsive, initialGameWidth, initialGameHeight]);

  const { width: gameWidth, height: gameHeight } = dimensions;
  
  const frameCollisions = useRef<{obj1Name: string, obj2Name: string, type: string, obj1Id: number, obj2Id: number}[]>([]);
  const frameClicks = useRef<{name: string, id: number}[]>([]);
  const frameInteractions = useRef<{name: string, id: number}[]>([]);
  const frameJoystickEvents = useRef<string[]>([]);
  const frameTimerEvents = useRef<string[]>([]);
  const frameAttacks = useRef<{name: string, id: number}[]>([]);
  const frameKeyPresses = useRef<string[]>([]);
  const frameKeyReleases = useRef<string[]>([]);
  const frameObjectReleases = useRef<{name: string, id: number}[]>([]);
  const pointerDownObjectRef = useRef<{ id: number; name: string } | null>(null);
  const frameDialogueEnd = useRef<boolean>(false);
  const frameButtonDown = useRef<string[]>([]);
  const frameButtonUp = useRef<string[]>([]);
  const gamepadButtonStateRef = useRef<Record<string, boolean>>({});
  const frameTriggerDown = useRef<string[]>([]);
  const frameTriggerUp = useRef<string[]>([]);
  const frameConsoleCommands = useRef<string[]>([]);
  const framePlayerJoined = useRef<boolean>(false);
  const framePlayerLeft = useRef<boolean>(false);
  const frameMatchFound = useRef<boolean>(false);
  const frameReceiveNetworkMessage = useRef<boolean>(false);
  const sceneChangeRequested = useRef(false);
  const timersRef = useRef<Map<string, { startTime: number; duration: number }>>(new Map());
  const intervalsRef = useRef<Map<string, { interval: number; lastTriggerTime: number }>>(new Map());
  const activeSequencesRef = useRef<Set<string>>(new Set());
  const sequenceFrameRef = useRef<number>(0);
  const sequenceStatesRef = useRef<Map<string, {
    phases: { actions: Action[]; waitSeconds: number }[];
    phaseIndex: number;
    elapsedInPhase: number;
    enteredPhase: boolean;
    isContinuous: boolean;
    lastSeenFrame: number;
    self?: GameObject;
    pickedObjects?: Record<string, GameObject[]>;
    signature: string;
  }>>(new Map());

  const joystickState = useRef({ active: false, angle: 0, distance: 0 });
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickHandleRef = useRef<HTMLDivElement>(null);
  const joystickTouchId = useRef<number | null>(null);
  const joystickPointerId = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const joystickUpPreviousFrame = useRef(false);

  const resetJoystick = useCallback(() => {
    joystickState.current = { active: false, angle: 0, distance: 0 };
    joystickTouchId.current = null;
    joystickPointerId.current = null;
    joystickUpPreviousFrame.current = false;
    frameJoystickEvents.current = [];
    if (joystickHandleRef.current) {
      joystickHandleRef.current.style.transform = 'translate(0, 0)';
    }
    actionsPressed.current.moveHorizontalIntensity = 0;
    actionsPressed.current.moveVerticalIntensity = 0;
    ['moveLeft', 'moveRight', 'moveUp', 'moveDown'].forEach(act => {
      if (!actionsPressed.current[act + '_ui']) actionsPressed.current[act] = false;
    });
  }, []);

  const isGamepadDirectionalActive = (gp: Gamepad | null) => {
    if (!gp) return false;
    if (gp.buttons) {
      if (gp.buttons[12]?.pressed || gp.buttons[13]?.pressed || gp.buttons[14]?.pressed || gp.buttons[15]?.pressed) {
        return true;
      }
    }
    if (gp.axes && gp.axes.length >= 2 && (Math.abs(gp.axes[0]) > 0.18 || Math.abs(gp.axes[1]) > 0.18)) {
      return true;
    }
    return false;
  };

  const resetAllInputs = useCallback((fromSceneChange: boolean = false) => {
    resetJoystick();
    if (fromSceneChange === true) {
      Object.keys(keysPressed.current).forEach(k => {
        if (keysPressed.current[k]) suppressedKeysUntilReleaseRef.current.add(k);
      });
      try {
        const gps = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gps) {
          if (isGamepadDirectionalActive(gp)) {
            gamepadMoveLockUntilNeutralRef.current = true;
            break;
          }
        }
      } catch (e) {}
    } else {
      suppressedKeysUntilReleaseRef.current.clear();
      gamepadMoveLockUntilNeutralRef.current = false;
    }
    keysPressed.current = {};
    actionsPressed.current = {};
    frameKeyPresses.current = [];
    frameKeyReleases.current = [];
    frameCollisions.current = [];
    frameClicks.current = [];
    frameInteractions.current = [];
    frameTimerEvents.current = [];
    frameAttacks.current = [];
    frameObjectReleases.current = [];
    frameButtonDown.current = [];
    frameButtonUp.current = [];
    frameTriggerDown.current = [];
    frameTriggerUp.current = [];
    frameDialogueEnd.current = false;
    pointerDownObjectRef.current = null;
  }, [resetJoystick]);

    const spawnFloatingFeedback = (obj: GameObject | undefined, val: number | string, label?: string) => {
        const numVal = Number(val);
        if (isNaN(numVal) || numVal === 0) return;
        
        let displayX = (initialGameWidth || 1024) / 2;
        let displayY = (initialGameHeight || 768) / 2;
        if (obj && typeof obj.x === 'number') {
            displayX = obj.x + (obj.width || 0) / 2;
            displayY = obj.y - 10;
        }
        
        const isNegative = numVal < 0;
        const text = isNegative ? `${numVal} ${label ? label.toUpperCase() : ''}` : `+${numVal} ${label ? label.toUpperCase() : ''}`;
        const color = isNegative ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';
        
        floatingFeedbacks.current.push({
            x: displayX,
            y: displayY,
            vx: (Math.random() - 0.5) * 20,
            vy: -60,
            text,
            color,
            opacity: 1.0,
            lifetime: 1.2
        });
    };

    const executeActionSingle = (action: Action, self?: GameObject, targetOverride?: GameObject, isContinuous: boolean = false, deltaTime: number = 0, forceRestart: boolean = false) => {
      let targetObj : GameObject | undefined;
      if (targetOverride) {
          targetObj = gameObjectsRef.current.find(o => o.id === targetOverride.id);
      } else if ((action.object === 'Self' || (self && action.object === self.name)) && self) {
          targetObj = gameObjectsRef.current.find(o => o.id === self.id);
      } else {
          targetObj = gameObjectsRef.current.find(o => o.name === action.object);
      }

      const GLOBAL_ACTIONS = new Set([
          'SetVariable', 'AddToVariable', 'SetBooleanVariable', 'ToggleBooleanVariable',
          'GoToScene', 'ChangeScene', 'SaveGame', 'LoadGame', 'StartTimer', 'StopTimer',
          'SetBackgroundColor', 'SetCameraZoom', 'SetSceneUnlocked', 'SetJoystickEnabled',
          'ShowDialogue', 'ShowConsole', 'PlaySound', 'SetBackgroundMusic', 'PauseBackgroundMusic',
          'ResumeBackgroundMusic', 'StopBackgroundMusic', 'SetBackgroundMusicVolume',
          'SetCamera3DMode', 'SetCamera3DOffset', 'SetFog3D', 'SetSkybox3D', 'SetQuestState',
          'CreateMatch', 'JoinMatch', 'SendNetworkMessage', 'SetPlayerSkin',
          'CreateObject', 'CreateObject3D', 'GenerateObjectAt'
      ]);
      if (!targetObj && action.object !== 'System' && action.object !== 'Camera' && !GLOBAL_ACTIONS.has(action.action)) return;

      let params = action.params;
      if (typeof params === 'string') {
          try {
              params = JSON.parse(params);
          } catch (e) {}
      }

      switch (action.action) {
          case 'SetVisible':
              if (targetObj) targetObj.visible = params?.visible !== false;
              break;
          case 'SetOpacity':
              if (targetObj) targetObj.opacity = Number(params?.opacity ?? 1);
              break;
          case 'SetZIndex':
              if (targetObj) targetObj.zIndex = Number(params?.zIndex ?? 0);
              break;
          case 'SetFlipX':
              if (targetObj) targetObj.direction = params?.flip ? 'left' : 'right';
              break;
          case 'SetFlipY':
              if (targetObj) targetObj.flipY = !!params?.flip;
              break;
          case 'Destroy':
              if (targetObj) {
                  const idsToDestroy = new Set<number>([targetObj.id]);
                  let added = true;
                  while (added) {
                      added = false;
                      gameObjectsRef.current.forEach(o => {
                          if (o.parentId && idsToDestroy.has(o.parentId) && !idsToDestroy.has(o.id)) {
                              idsToDestroy.add(o.id);
                              added = true;
                          }
                      });
                  }
                  gameObjectsRef.current = gameObjectsRef.current.filter(o => !idsToDestroy.has(o.id));
              }
              break;
          case 'SetVariable': {
              const varName = String(params?.variable || '').trim();
              if (varName) {
                  gameVariables.current[varName] = normalizeVariableInputValue(params.value);
              }
              break;
          }
          case 'SetBooleanVariable': {
              const varName = String(params?.variable || '').trim();
              if (varName) {
                  gameVariables.current[varName] = params.valueBoolean === true || params.valueBoolean === 'true';
              }
              break;
          }
          case 'ToggleBooleanVariable': {
              const varName = String(params?.variable || '').trim();
              if (varName) {
                  const cur = gameVariables.current[varName];
                  const curBool = cur === 'false' ? false : !!cur;
                  gameVariables.current[varName] = !curBool;
              }
              break;
          }
          case 'SetObjectPosition':
              if (targetObj && params) {
                  if (params.x != null) targetObj.x = Number(params.x);
                  if (params.y != null) targetObj.y = Number(params.y);
                  if (is3DModeRef.current) {
                      const pos = getObject3DPosition(targetObj);
                      if (params.x != null) pos.x = Number(params.x) / 50;
                      if (params.y != null) pos.z = Number(params.y) / 50;
                      targetObj.position3D = pos;
                      (targetObj as any)._moved3DThisFrame = true;
                  }
              }
              break;
          case 'TeleportToObject':
              if (targetObj && params?.targetObjectName) {
                  const targetToTeleport = gameObjectsRef.current.find(o => o.name === params.targetObjectName);
                  if (targetToTeleport) {
                      targetObj.x = targetToTeleport.x;
                      targetObj.y = targetToTeleport.y;
                      if (is3DModeRef.current) {
                          targetObj.position3D = { ...getObject3DPosition(targetToTeleport) };
                          (targetObj as any)._moved3DThisFrame = true;
                      }
                  }
              }
              break;
          case 'AddToVariable': {
              const varName = String(params?.variable || '').trim();
              if (varName) {
                  const currentRaw = gameVariables.current[varName];
                  const parsedCur = (currentRaw === undefined || currentRaw === null || currentRaw === '')
                      ? 0
                      : parseNumericValue(currentRaw);
                  const parsedAdd = parseNumericValue(params?.value ?? 0);
                  const currentVal = parsedCur !== null ? parsedCur : 0;
                  const toAdd = parsedAdd !== null ? parsedAdd : 0;
                  const result = roundCleanNumber(currentVal + toAdd);
                  gameVariables.current[varName] = result;
                  spawnFloatingFeedback(targetObj || self, toAdd, varName);
              }
              break;
          }
          case 'SetObjectVariable': {
              const varName = String(params?.variable || '').trim();
              if (targetObj && varName) {
                  if (!targetObj.variables) targetObj.variables = [];
                  const v = targetObj.variables.find(v => v.name === varName);
                  const finalVal = normalizeVariableInputValue(params.value);
                  if (v) v.value = finalVal;
                  else targetObj.variables.push({ name: varName, value: finalVal });
              }
              break;
          }
          case 'SetObjectBooleanVariable': {
              const varName = String(params?.variable || '').trim();
              if (targetObj && varName) {
                  if (!targetObj.variables) targetObj.variables = [];
                  const v = targetObj.variables.find(v => v.name === varName);
                  const boolVal = params.valueBoolean === true || params.valueBoolean === 'true';
                  if (v) v.value = boolVal;
                  else targetObj.variables.push({ name: varName, value: boolVal });
              }
              break;
          }
          case 'ToggleObjectBooleanVariable': {
              const varName = String(params?.variable || '').trim();
              if (targetObj && varName) {
                  if (!targetObj.variables) targetObj.variables = [];
                  const v = targetObj.variables.find(v => v.name === varName);
                  if (v) {
                      const curBool = v.value === 'false' ? false : !!v.value;
                      v.value = !curBool;
                  } else {
                      targetObj.variables.push({ name: varName, value: true });
                  }
              }
              break;
          }
          case 'AddToObjectVariable': {
              const varName = String(params?.variable || '').trim();
              if (targetObj && varName) {
                  if (!targetObj.variables) targetObj.variables = [];
                  const v = targetObj.variables.find(v => v.name === varName);
                  const parsedAdd = parseNumericValue(params?.value ?? 0);
                  const toAdd = parsedAdd !== null ? parsedAdd : 0;
                  const parsedCur = v ? parseNumericValue(v.value) : 0;
                  const curVal = parsedCur !== null ? parsedCur : 0;
                  const result = roundCleanNumber(curVal + toAdd);
                  if (v) v.value = result;
                  else targetObj.variables.push({ name: varName, value: result });
                  spawnFloatingFeedback(targetObj, toAdd, varName);
              }
              break;
          }
          case 'GoToScene':
              if (params?.sceneName) {
                  sceneChangeRequested.current = true;
                  onGoToScene(params.sceneName);
              }
              break;
          case 'SetSceneUnlocked':
              if (params?.sceneName) {
                  const unlocked = params.valueBoolean !== false;
                  gameVariables.current['scene_unlocked_' + params.sceneName] = unlocked;
              }
              break;
          case 'CreateMatch':
              frameMatchFound.current = true;
              framePlayerJoined.current = true;
              break;
          case 'JoinMatch':
              frameMatchFound.current = true;
              framePlayerJoined.current = true;
              break;
          case 'SendNetworkMessage':
              frameReceiveNetworkMessage.current = true;
              break;
          case 'SetPlayerName':
              if (targetObj) {
                  targetObj.name = params?.name || params?.value || 'Jugador';
              }
              break;
           case 'PlayAnimation':
              if(targetObj && params?.animationId) {
                  (targetObj as any)._scriptAnimTime = performance.now();
                  const animId = String(params.animationId);
                  const objAnims = [...animations, ...(targetObj.animations || [])];
                  const anim = objAnims.find(a => String(a.id) === animId || a.name === animId);
                  if (anim && anim.frames && anim.frames.length > 0) {
                      const currentAnim: any = activeAnimations.current.get(targetObj.id);
                      const isOneShotProtected = currentAnim && (currentAnim.isOneShotProtected !== undefined
                          ? currentAnim.isOneShotProtected
                          : (currentAnim.animation.loop === false && !currentAnim.startedContinuous));
                      const transitioningOutOfAirJump = Boolean(
                          currentAnim && currentAnim.startedWhileRising &&
                          (targetObj.grounded || targetObj.grounded3D || (targetObj.vy || 0) > 0.5 || (targetObj.vy3D || 0) < -0.05)
                      );
                      let stillPlaying = false;
                      if (isOneShotProtected && !transitioningOutOfAirJump) {
                          const totalDuration = currentAnim.animation.frames.reduce((sum: number, f: any) => sum + Math.max(20, Number(f?.duration) || 100), 0);
                          const elapsed = performance.now() - currentAnim.startTime;
                          if (elapsed < totalDuration) {
                              stillPlaying = true;
                          }
                      }
                      if (forceRestart || !currentAnim || (String(currentAnim.animation.id) !== String(anim.id) && !stillPlaying)) {
                          const clonedAnim = { ...anim, frames: anim.frames.map(f => ({ ...f })) };
                          activeAnimations.current.set(targetObj.id, {
                              animation: clonedAnim,
                              startTime: performance.now(),
                              startedContinuous: Boolean(isContinuous),
                              isOneShotProtected: !isContinuous && clonedAnim.loop === false,
                              startedWhileRising: Boolean(!targetObj.grounded && (targetObj.vy || 0) <= 0.5 && (targetObj.vy3D === undefined || targetObj.vy3D >= -0.05)),
                              isAutoAnim: false,
                          } as any);
                      }
                  }
                  // Also check 3D animation clip & PoseAnimation
                  const entry3D = threeMeshMapRef.current.get(targetObj.id);
                  const pAnim = (projectData?.poseAnimations || []).find(pa => String(pa.id) === animId || pa.name === animId);
                  if (pAnim) {
                      const currentPose: any = activePoseAnimationsRef.current.get(targetObj.id);
                      const shouldStart = forceRestart || !currentPose || String(currentPose.poseAnimation.id) !== String(pAnim.id) || (!isContinuous && currentPose.finished);
                      if (shouldStart) {
                          if (currentPose && String(currentPose.poseAnimation.id) !== String(pAnim.id) && currentPose.origVisual) {
                              targetObj.shape3D = currentPose.origVisual.shape3D;
                              if (currentPose.origVisual.color !== undefined) targetObj.color = currentPose.origVisual.color;
                              targetObj.emissive3D = currentPose.origVisual.emissive3D;
                              targetObj.emissiveIntensity3D = currentPose.origVisual.emissiveIntensity3D;
                              targetObj.modelUrl = currentPose.origVisual.modelUrl;
                          }
                          const origVisual = currentPose?.origVisual || {
                              shape3D: targetObj.shape3D,
                              color: targetObj.color,
                              emissive3D: targetObj.emissive3D,
                              emissiveIntensity3D: targetObj.emissiveIntensity3D,
                              modelUrl: targetObj.modelUrl,
                          };
                          activePoseAnimationsRef.current.set(targetObj.id, {
                              poseAnimation: pAnim,
                              startTime: performance.now(),
                              loop: pAnim.loop !== false,
                              speed: 1,
                              isAutoPose: false,
                              startedInAir: Boolean(!targetObj.grounded3D && !targetObj.grounded) || (targetObj.vy3D !== undefined && targetObj.vy3D > 0.05),
                              origVisual,
                          } as any);
                          const firstClipCompat = pAnim.frames?.[0]?.modelAnimName;
                          if (firstClipCompat) {
                              const clipSpd = Number(pAnim.frames?.[0]?.modelAnimSpeed ?? 1) || 1;
                              (targetObj as any)._runtimeAnim3D = { name: firstClipCompat, loop: pAnim.loop !== false, speed: clipSpd };
                              if (entry3D?.group?.userData?.playAnimation3D) {
                                  entry3D.group.userData.playAnimation3D(firstClipCompat, pAnim.loop !== false, clipSpd);
                              } else if (entry3D?.group) {
                                  entry3D.group.userData.pendingAnimation3D = { name: firstClipCompat, loop: pAnim.loop !== false, speed: clipSpd };
                              }
                          } else if (targetObj.animation3D) {
                              const defLoop = targetObj.animation3DLoop !== false;
                              const defSpd = Number(targetObj.animation3DSpeed ?? 1) || 1;
                              delete (targetObj as any)._runtimeAnim3D;
                              if (entry3D?.group?.userData?.playAnimation3D) {
                                  entry3D.group.userData.playAnimation3D(targetObj.animation3D, defLoop, defSpd);
                              }
                          } else {
                              delete (targetObj as any)._runtimeAnim3D;
                              if (entry3D?.group) {
                                  delete entry3D.group.userData.pendingAnimation3D;
                                  entry3D.group.userData.stopAnimation3D?.();
                              }
                          }
                      }
                  } else if (animId) {
                      const clipLoop = params?.loop !== false && params?.loop !== 'false';
                      const clipSpeed = Number(params?.speed ?? 1) || 1;
                      (targetObj as any)._runtimeAnim3D = { name: animId, loop: clipLoop, speed: clipSpeed };
                      if (entry3D?.group?.userData?.playAnimation3D) {
                          if (forceRestart || !isContinuous || entry3D.group.userData.currentActionName?.toLowerCase() !== animId.toLowerCase()) {
                              entry3D.group.userData.playAnimation3D(animId, clipLoop, clipSpeed);
                          }
                      } else if (entry3D?.group) {
                          entry3D.group.userData.pendingAnimation3D = { name: animId, loop: clipLoop, speed: clipSpeed };
                      }
                  }
              }
              break;
          case 'PlayAnimation3D':
              if (targetObj) {
                  (targetObj as any)._scriptAnimTime = performance.now();
                  const poseAnimId = String(params?.poseAnimationId || params?.animationId || params?.animationName || '');
                  const modelAnimName = String(params?.modelAnimName || '');
                  const loopParam = params?.loop3D !== undefined ? params.loop3D : params?.loop;
                  const speed = Math.max(0.05, Number(params?.speed ?? 1) || 1);
                  const entry3D = threeMeshMapRef.current.get(targetObj.id);
                  const pAnim = poseAnimId
                      ? (projectData?.poseAnimations || []).find(pa => String(pa.id) === poseAnimId || pa.name === poseAnimId)
                      : undefined;

                  if (pAnim) {
                      const resolvedLoop = (loopParam === 'true' || loopParam === true)
                          ? true
                          : (loopParam === 'false' || loopParam === false)
                          ? false
                          : (pAnim.loop !== false);
                      const currentPose: any = activePoseAnimationsRef.current.get(targetObj.id);
                      const shouldStart = forceRestart || !currentPose || String(currentPose.poseAnimation.id) !== String(pAnim.id) || (!isContinuous && currentPose.finished);
                      if (shouldStart) {
                          if (currentPose && String(currentPose.poseAnimation.id) !== String(pAnim.id) && currentPose.origVisual) {
                              targetObj.shape3D = currentPose.origVisual.shape3D;
                              if (currentPose.origVisual.color !== undefined) targetObj.color = currentPose.origVisual.color;
                              targetObj.emissive3D = currentPose.origVisual.emissive3D;
                              targetObj.emissiveIntensity3D = currentPose.origVisual.emissiveIntensity3D;
                              targetObj.modelUrl = currentPose.origVisual.modelUrl;
                          }
                          const origVisual = currentPose?.origVisual || {
                              shape3D: targetObj.shape3D,
                              color: targetObj.color,
                              emissive3D: targetObj.emissive3D,
                              emissiveIntensity3D: targetObj.emissiveIntensity3D,
                              modelUrl: targetObj.modelUrl,
                          };
                          activePoseAnimationsRef.current.set(targetObj.id, {
                              poseAnimation: pAnim,
                              startTime: performance.now(),
                              loop: resolvedLoop,
                              speed,
                              isAutoPose: false,
                              startedInAir: Boolean(!targetObj.grounded3D && !targetObj.grounded) || (targetObj.vy3D !== undefined && targetObj.vy3D > 0.05),
                              origVisual,
                          } as any);
                          const firstClip = modelAnimName || pAnim.frames?.[0]?.modelAnimName;
                          if (firstClip) {
                              const clipSpeed = Number(pAnim.frames?.[0]?.modelAnimSpeed ?? speed) || speed;
                              (targetObj as any)._runtimeAnim3D = { name: firstClip, loop: resolvedLoop, speed: clipSpeed };
                              if (entry3D?.group?.userData?.playAnimation3D) {
                                  entry3D.group.userData.playAnimation3D(firstClip, resolvedLoop, clipSpeed);
                              } else if (entry3D?.group) {
                                  entry3D.group.userData.pendingAnimation3D = { name: firstClip, loop: resolvedLoop, speed: clipSpeed };
                              }
                          } else if (targetObj.animation3D) {
                              const defLoop = targetObj.animation3DLoop !== false;
                              const defSpd = Number(targetObj.animation3DSpeed ?? 1) || 1;
                              delete (targetObj as any)._runtimeAnim3D;
                              if (entry3D?.group?.userData?.playAnimation3D) {
                                  entry3D.group.userData.playAnimation3D(targetObj.animation3D, defLoop, defSpd);
                              }
                          } else {
                              delete (targetObj as any)._runtimeAnim3D;
                              if (entry3D?.group) {
                                  delete entry3D.group.userData.pendingAnimation3D;
                                  entry3D.group.userData.stopAnimation3D?.();
                              }
                          }
                      }
                  } else if (modelAnimName || poseAnimId) {
                      const prevPose = activePoseAnimationsRef.current.get(targetObj.id);
                      if (prevPose) {
                          if (prevPose.origVisual) {
                              targetObj.shape3D = prevPose.origVisual.shape3D;
                              if (prevPose.origVisual.color !== undefined) targetObj.color = prevPose.origVisual.color;
                              targetObj.emissive3D = prevPose.origVisual.emissive3D;
                              targetObj.emissiveIntensity3D = prevPose.origVisual.emissiveIntensity3D;
                              targetObj.modelUrl = prevPose.origVisual.modelUrl;
                          }
                          activePoseAnimationsRef.current.delete(targetObj.id);
                          if (entry3D?.group) entry3D.group.scale.set(1, 1, 1);
                      }
                      const clipToPlay = modelAnimName || poseAnimId;
                      const resolvedLoop = !(loopParam === 'false' || loopParam === false);
                      (targetObj as any)._runtimeAnim3D = { name: clipToPlay, loop: resolvedLoop, speed };
                      if (entry3D?.group?.userData?.playAnimation3D) {
                          if (forceRestart || !isContinuous || entry3D.group.userData.currentActionName?.toLowerCase() !== clipToPlay.toLowerCase()) {
                              entry3D.group.userData.playAnimation3D(clipToPlay, resolvedLoop, speed);
                          }
                      } else if (entry3D?.group) {
                          entry3D.group.userData.pendingAnimation3D = { name: clipToPlay, loop: resolvedLoop, speed };
                      }
                  }
              }
              break;
          case 'StopAnimation3D':
              if (targetObj) {
                  const currentPose = activePoseAnimationsRef.current.get(targetObj.id);
                  if (currentPose?.origVisual) {
                      targetObj.shape3D = currentPose.origVisual.shape3D;
                      if (currentPose.origVisual.color !== undefined) targetObj.color = currentPose.origVisual.color;
                      targetObj.emissive3D = currentPose.origVisual.emissive3D;
                      targetObj.emissiveIntensity3D = currentPose.origVisual.emissiveIntensity3D;
                      targetObj.modelUrl = currentPose.origVisual.modelUrl;
                  }
                  activePoseAnimationsRef.current.delete(targetObj.id);
                  delete (targetObj as any)._runtimeAnim3D;
                  const entry3D = threeMeshMapRef.current.get(targetObj.id);
                  if (entry3D?.group) {
                      delete entry3D.group.userData.pendingAnimation3D;
                      entry3D.group.scale.set(1, 1, 1);
                      if (entry3D.group.userData.stopAnimation3D) {
                          entry3D.group.userData.stopAnimation3D();
                      }
                  }
              }
              break;
          case 'SetUIText':
              if (targetObj && targetObj.isUI && typeof params?.text === 'string') {
                  targetObj.text = params.text;
              }
              break;
          case 'MoveObject':
                if (targetObj && params?.direction && params?.speed != null) {
                    const speed = Number(params.speed);
                    const direction = (params.direction || '').toLowerCase();
                    if (isContinuous) {
                        if (!targetObj.pendingMovements) targetObj.pendingMovements = [];
                        targetObj.pendingMovements.push({ direction, speed });
                    } else {
                        switch (direction) {
                            case 'right': targetObj.x += speed; break;
                            case 'left': targetObj.x -= speed; break;
                            case 'up': targetObj.y -= speed; break;
                            case 'down': targetObj.y += speed; break;
                        }
                        if (is3DModeRef.current) {
                            const pos = getObject3DPosition(targetObj);
                            const step3 = speed / 50;
                            if (direction === 'right') pos.x += step3;
                            else if (direction === 'left') pos.x -= step3;
                            else if (direction === 'up' || direction === 'forward') pos.z -= step3;
                            else if (direction === 'down' || direction === 'backward') pos.z += step3;
                            targetObj.position3D = pos;
                            (targetObj as any)._moved3DThisFrame = true;
                        }
                    }
                }
                break;
          case 'FollowObject':
                if (targetObj && params?.targetObjectName) {
                    targetObj.followTarget = String(params.targetObjectName);
                    targetObj.followSpeed = Number(params.speed || 100);
                }
                break;
          case 'MoveInDirection':
                if (targetObj && params?.direction && params?.speed != null) {
                    const speed = Number(params.speed);
                    const direction = (params.direction || '').toLowerCase();
                    switch (direction) {
                        case 'right': targetObj.vx = speed; if (is3DModeRef.current) targetObj.vx3D = speed / 50; break;
                        case 'left': targetObj.vx = -speed; if (is3DModeRef.current) targetObj.vx3D = -speed / 50; break;
                        case 'up': targetObj.vy = -speed; if (is3DModeRef.current) targetObj.vz3D = -speed / 50; break;
                        case 'down': targetObj.vy = speed; if (is3DModeRef.current) targetObj.vz3D = speed / 50; break;
                    }
                }
                break;
          case 'SetVelocityX':
                if (targetObj && (params?.vx != null || params?.velocity != null)) {
                    const val = Number(params.vx ?? params.velocity);
                    targetObj.vx = val;
                    (targetObj as any)._customVx = val;
                    if (is3DModeRef.current) targetObj.vx3D = val / 50;
                    if (val > 0) targetObj.direction = 'right';
                    if (val < 0) targetObj.direction = 'left';
                }
                break;
          case 'SetVelocityY':
                if (targetObj && (params?.vy != null || params?.velocity != null)) {
                    const val = Number(params.vy ?? params.velocity);
                    targetObj.vy = val;
                    (targetObj as any)._customVy = val;
                    if (is3DModeRef.current) {
                        targetObj.vy3D = -val / 50;
                        if (val < 0) targetObj.grounded3D = false;
                    }
                    if (val < 0) {
                        targetObj.grounded = false;
                    }
                }
                break;
          case 'SetRotationSpeed':
                if (targetObj && params?.speed != null) {
                    targetObj.rotationSpeed = Number(params.speed);
                }
                break;
          case 'SetScaleSpeedX':
                if (targetObj && params?.speed != null) {
                    targetObj.scaleSpeedX = Number(params.speed);
                }
                break;
          case 'SetScaleSpeedY':
                if (targetObj && params?.speed != null) {
                    targetObj.scaleSpeedY = Number(params.speed);
                }
                break;
            case 'OscillateObject':
                if (targetObj && params?.axis && params?.distance != null && params?.speed != null) {
                    targetObj.oscillation = {
                        axis: params.axis as 'x' | 'y',
                        distance: Number(params.distance),
                        speed: Number(params.speed),
                        initialX: targetObj.initialX ?? targetObj.x,
                        initialY: targetObj.initialY ?? targetObj.y,
                        startTime: performance.now()
                    };
                    if (targetObj.initialX === undefined) targetObj.initialX = targetObj.x;
                    if (targetObj.initialY === undefined) targetObj.initialY = targetObj.y;
                }
                break;
            case 'OscillateScale':
                if (targetObj && params?.distance != null && params?.speed != null) {
                    targetObj.scaleOscillation = {
                        distance: Number(params.distance),
                        speed: Number(params.speed),
                        initialScaleX: targetObj.initialScaleX ?? (targetObj.scaleX || 1),
                        initialScaleY: targetObj.initialScaleY ?? (targetObj.scaleY || 1),
                        startTime: performance.now()
                    };
                    if (targetObj.initialScaleX === undefined) targetObj.initialScaleX = targetObj.scaleX || 1;
                    if (targetObj.initialScaleY === undefined) targetObj.initialScaleY = targetObj.scaleY || 1;
                }
                break;
            case 'RotateContinuously':
                if (targetObj && params?.speed != null) {
                    targetObj.rotationSpeed = Number(params.speed);
                }
                break;
            case 'RotateObject':
                if (targetObj && params?.rotation != null) {
                    const rotation = Number(params.rotation || 0);
                    const deltaDeg = isContinuous ? rotation * deltaTime : rotation;
                    targetObj.rotation = ((targetObj.rotation || 0) + deltaDeg) % 360;
                    if (targetObj.rotation < 0) targetObj.rotation += 360;
                    if (is3DModeRef.current) {
                        const r3 = getObject3DRotation(targetObj);
                        r3.y += (deltaDeg * Math.PI) / 180;
                        targetObj.rotation3D = r3;
                    }
                }
                break;
            case 'ScaleObject':
                if (targetObj && params?.scaleX != null && params?.scaleY != null) {
                    const scaleX = Number(params.scaleX || 1);
                    const scaleY = Number(params.scaleY || 1);
                    if (isContinuous) {
                        targetObj.scaleX = Math.max(0.01, (targetObj.scaleX ?? 1) + (scaleX - 1) * deltaTime);
                        targetObj.scaleY = Math.max(0.01, (targetObj.scaleY ?? 1) + (scaleY - 1) * deltaTime);
                    } else {
                        targetObj.scaleX = Math.max(0.01, (targetObj.scaleX ?? 1) * scaleX);
                        targetObj.scaleY = Math.max(0.01, (targetObj.scaleY ?? 1) * scaleY);
                    }
                    if (is3DModeRef.current) {
                        const d3 = getObject3DDimensions(targetObj);
                        targetObj.scale3D = {
                            x: Math.max(0.05, isContinuous ? d3.w + (scaleX - 1) * deltaTime : d3.w * scaleX),
                            y: Math.max(0.05, isContinuous ? d3.h + (scaleY - 1) * deltaTime : d3.h * scaleY),
                            z: Math.max(0.05, isContinuous ? d3.d + (scaleX - 1) * deltaTime : d3.d * scaleX),
                        };
                    }
                }
                break;
            case 'SetScale':
                if (targetObj && params?.scaleX != null && params?.scaleY != null) {
                    targetObj.scaleX = Math.max(0.01, Number(params.scaleX));
                    targetObj.scaleY = Math.max(0.01, Number(params.scaleY));
                    if (is3DModeRef.current) {
                        const d3 = getObject3DDimensions(targetObj);
                        targetObj.scale3D = {
                            x: Math.max(0.05, Number(params.scaleX)),
                            y: Math.max(0.05, Number(params.scaleY)),
                            z: Math.max(0.05, d3.d),
                        };
                    }
                }
                break;
            case 'MoveTo':
                if (targetObj && params?.x != null && params?.y != null) {
                    const duration = Number(params.duration || 1);
                    if (!targetObj.tweens) targetObj.tweens = [];
                    // Remove existing position tweens to avoid conflicts
                    targetObj.tweens = targetObj.tweens.filter(t => t.type !== 'position');
                    targetObj.tweens.push({
                        type: 'position',
                        startX: targetObj.x,
                        startY: targetObj.y,
                        endX: Number(params.x),
                        endY: Number(params.y),
                        startTime: performance.now(),
                        duration: duration * 1000
                    });
                }
                break;
            case 'RotateTo':
                if (targetObj && params?.rotation != null) {
                    const duration = Number(params.duration || 1);
                    if (!targetObj.tweens) targetObj.tweens = [];
                    // Remove existing rotation tweens
                    targetObj.tweens = targetObj.tweens.filter(t => t.type !== 'rotation');
                    targetObj.tweens.push({
                        type: 'rotation',
                        startRotation: targetObj.rotation || 0,
                        endRotation: Number(params.rotation),
                        startTime: performance.now(),
                        duration: duration * 1000
                    });
                }
                break;
            case 'ScaleTo':
                if (targetObj && params?.scaleX != null && params?.scaleY != null) {
                    const duration = Number(params.duration || 1);
                    if (!targetObj.tweens) targetObj.tweens = [];
                    // Remove existing scale tweens
                    targetObj.tweens = targetObj.tweens.filter(t => t.type !== 'scale');
                    targetObj.tweens.push({
                        type: 'scale',
                        startScaleX: targetObj.scaleX || 1,
                        startScaleY: targetObj.scaleY || 1,
                        endScaleX: Number(params.scaleX),
                        endScaleY: Number(params.scaleY),
                        startTime: performance.now(),
                        duration: duration * 1000
                    });
                }
                break;
            case 'SlideTo':
                if (targetObj && params?.x != null && params?.y != null) {
                    const duration = Number(params.duration || 1);
                    if (!targetObj.tweens) targetObj.tweens = [];
                    targetObj.tweens = targetObj.tweens.filter(t => t.type !== 'position');
                    targetObj.tweens.push({
                        type: 'position',
                        startX: targetObj.x,
                        startY: targetObj.y,
                        endX: Number(params.x),
                        endY: Number(params.y),
                        startTime: performance.now(),
                        duration: duration * 1000
                    });
                }
                break;
            case 'SetDraggable':
                if (targetObj) {
                    targetObj.isDraggable = params?.enabled !== false;
                    targetObj.dragXLocked = !!params?.lockX;
                    targetObj.dragYLocked = !!params?.lockY;
                    if (params?.minX != null) targetObj.dragMinX = Number(params.minX);
                    if (params?.maxX != null) targetObj.dragMaxX = Number(params.maxX);
                    if (params?.minY != null) targetObj.dragMinY = Number(params.minY);
                    if (params?.maxY != null) targetObj.dragMaxY = Number(params.maxY);
                    if (params?.dropBehavior) targetObj.dragDropBehavior = params.dropBehavior;
                    if (params?.randomMinX != null) targetObj.dragRandomMinX = Number(params.randomMinX);
                    if (params?.randomMaxX != null) targetObj.dragRandomMaxX = Number(params.randomMaxX);
                    if (params?.randomMinY != null) targetObj.dragRandomMinY = Number(params.randomMinY);
                    if (params?.randomMaxY != null) targetObj.dragRandomMaxY = Number(params.randomMaxY);
                }
                break;
            case 'EnableCollision':
                if (targetObj) {
                    targetObj.isTouchable = true;
                }
                break;
            case 'DisableCollision':
                if (targetObj) {
                    targetObj.isTouchable = false;
                }
                break;
            case 'ShowConsole':
                setConsoleOpen(true);
                break;
            case 'CreateObject':
                if (action.params?.templateObjectName) {
                    const templateName = action.params.templateObjectName;
                    const templateObj = scene.gameObjects.find(o => o.name === templateName) || globalObjects?.find(o => o.name === templateName);
                    if (templateObj) {
                        const newObj: GameObject = {
                            ...JSON.parse(JSON.stringify(templateObj)),
                            id: createUniqueId(),
                            x: action.params?.x != null ? Number(action.params.x) : 0,
                            y: action.params?.y != null ? Number(action.params.y) : 0
                        };
                        if (is3DModeRef.current) {
                            newObj.position3D = { x: newObj.x / 50, y: 0, z: newObj.y / 50 };
                        }
                        gameObjectsRef.current.push(newObj);
                    }
                }
                break;
            case 'GenerateObjectAt':
                if (action.params?.templateObjectName && action.params?.targetObjectName) {
                    const templateName = action.params.templateObjectName;
                    const targetName = action.params.targetObjectName;
                    const templateObj = scene.gameObjects.find(o => o.name === templateName) || globalObjects?.find(o => o.name === templateName);
                    const targetObjRef = gameObjectsRef.current.find(o => o.name === targetName);
                    if (templateObj && targetObjRef) {
                        const targetAbsPos = getObjectAbsolutePosition(targetObjRef.id, new Map(gameObjectsRef.current.map(o => [o.id, o])));
                        const targetPos3D = getObject3DPosition(targetObjRef);
                        const newObj: GameObject = {
                            ...JSON.parse(JSON.stringify(templateObj)),
                            id: createUniqueId(),
                            x: targetAbsPos.x,
                            y: targetAbsPos.y,
                            position3D: { ...targetPos3D }
                        };
                        gameObjectsRef.current.push(newObj);
                    }
                }
                break;
            case 'SetQuestState':
                if (action.params?.questId && action.params?.questState) {
                    gameVariables.current['quest_' + action.params.questId] = action.params.questState;
                }
                break;
            case 'ForceJump':
                if (targetObj && action.params?.jumpForce != null) {
                    const jf = Number(action.params.jumpForce);
                    if (is3DModeRef.current) {
                        targetObj.vy3D = jf > 25 ? jf / 45 : jf;
                        targetObj.grounded3D = false;
                        targetObj.grounded = false;
                    } else if (targetObj.behaviors?.some(b => ['PlatformerCharacter', 'Physics'].includes(b.name))) {
                        targetObj.vy = -jf;
                        targetObj.grounded = false;
                    }
                }
                break;
            case 'TriggerAttack':
                if (targetObj) {
                    frameAttacks.current.push({ name: targetObj.name, id: targetObj.id });
                }
                break;
            case 'SetParent':
                if (targetObj) {
                    if (!action.params?.parentName) {
                        targetObj.parentId = null;
                    } else {
                        const parentObj = gameObjectsRef.current.find(o => o.name === action.params.parentName);
                        if (parentObj) {
                            targetObj.parentId = parentObj.id;
                        }
                    }
                }
                break;
          case 'PlaySound':
                if (action.params?.soundId) {
                    const soundAsset = assets.find(a => String(a.id) === String(action.params.soundId) || a.url === action.params.soundId || a.name === action.params.soundId);
                    const soundUrl = soundAsset ? soundAsset.url : action.params.soundId;
                    if (soundUrl) {
                        let cachedAudio = audioCache.current.get(soundUrl);
                        if (!cachedAudio) {
                            cachedAudio = new Audio(soundUrl);
                            audioCache.current.set(soundUrl, cachedAudio);
                        }
                        if (cachedAudio) {
                            const audioToPlay = cachedAudio.cloneNode() as HTMLAudioElement;
                            audioToPlay.loop = action.params.loop === true || action.params.loop === 'true';
                            audioToPlay.play().catch(() => {});
                        }
                    }
                }
              break;
            case 'SetBackgroundMusic':
                if (action.params?.soundId) {
                    if (backgroundMusicPlayer.current) {
                        backgroundMusicPlayer.current.pause();
                        backgroundMusicPlayer.current = null;
                    }
                    const musicAsset = assets.find(a => String(a.id) === String(action.params.soundId) || a.url === action.params.soundId || a.name === action.params.soundId);
                    const musicUrl = musicAsset ? musicAsset.url : action.params.soundId;
                    if (musicUrl) {
                        currentBackgroundMusicId.current = musicAsset ? musicAsset.id : action.params.soundId;
                        let cachedAudio = audioCache.current.get(musicUrl);
                        if (!cachedAudio) {
                            cachedAudio = new Audio(musicUrl);
                            audioCache.current.set(musicUrl, cachedAudio);
                        }
                        if (cachedAudio) {
                            const audio = cachedAudio.cloneNode() as HTMLAudioElement;
                            audio.loop = action.params.loop !== false && action.params.loop !== 'false';
                            backgroundMusicPlayer.current = audio;
                            const playPromise = audio.play();
                            if (playPromise && typeof playPromise.catch === 'function') {
                                playPromise.catch((e) => {
                                    console.warn("Autoplay blocked background music. Registering gesture fallback...", e);
                                    const playOnGesture = () => {
                                        if (backgroundMusicPlayer.current) {
                                            backgroundMusicPlayer.current.play().catch(() => {});
                                        }
                                        window.removeEventListener('pointerdown', playOnGesture);
                                        window.removeEventListener('click', playOnGesture);
                                        window.removeEventListener('keydown', playOnGesture);
                                        window.removeEventListener('touchstart', playOnGesture);
                                    };
                                    window.addEventListener('pointerdown', playOnGesture, { once: true });
                                    window.addEventListener('click', playOnGesture, { once: true });
                                    window.addEventListener('keydown', playOnGesture, { once: true });
                                    window.addEventListener('touchstart', playOnGesture, { once: true });
                                });
                            }
                        }
                    }
                }
                break;
            case 'StopBackgroundMusic':
                if (backgroundMusicPlayer.current) {
                    backgroundMusicPlayer.current.pause();
                    backgroundMusicPlayer.current.currentTime = 0;
                    backgroundMusicPlayer.current = null;
                    currentBackgroundMusicId.current = null;
                }
                break;
            case 'PauseBackgroundMusic':
                if (backgroundMusicPlayer.current) {
                    backgroundMusicPlayer.current.pause();
                }
                break;
            case 'ResumeBackgroundMusic':
                if (backgroundMusicPlayer.current) {
                    backgroundMusicPlayer.current.play().catch(() => {});
                }
                break;
            case 'SetBackgroundMusicVolume':
                if (backgroundMusicPlayer.current && action.params?.volume != null) {
                    const volume = Math.max(0, Math.min(100, Number(action.params.volume))) / 100;
                    backgroundMusicPlayer.current.volume = volume;
                }
                break;
          case 'SetBackgroundColor':
                if(action.params?.color) setRuntimeBackgroundColor(action.params.color);
              break;
          case 'PlayVideo': {
              const selectedAsset = projectData.assets?.find(a => a.id === action.params?.videoAssetId);
              const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
              if (url) {
                  let video = videoCache.current.get(url);
                  if (!video) {
                      video = document.createElement('video');
                      video.muted = targetObj?.videoMuted !== false;
                      video.playsInline = true;
                      video.setAttribute('webkit-playsinline', 'true');
                      video.loop = targetObj?.videoLoop !== false;
                      video.src = url;
                      video.load();
                      videoCache.current.set(url, video);
                  }
                  if (video) {
                      video.dataset.playState = 'playing';
                      video.play().catch(()=>{});
                  }
                  if (targetObj) {
                      targetObj.videoUrl = url;
                  }
              }
              break;
          }
          case 'PauseVideo': {
              const selectedAsset = projectData.assets?.find(a => a.id === action.params?.videoAssetId);
              const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
              if (url) {
                  let video = videoCache.current.get(url);
                  if (!video) {
                      video = document.createElement('video');
                      video.muted = targetObj?.videoMuted !== false;
                      video.playsInline = true;
                      video.setAttribute('webkit-playsinline', 'true');
                      video.loop = targetObj?.videoLoop !== false;
                      video.src = url;
                      video.load();
                      videoCache.current.set(url, video);
                  }
                  if (video) {
                      video.dataset.playState = 'paused';
                      video.pause();
                  }
              }
              break;
          }
          case 'StopVideo': {
              const selectedAsset = projectData.assets?.find(a => a.id === action.params?.videoAssetId);
              const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
              if (url) {
                  let video = videoCache.current.get(url);
                  if (!video) {
                      video = document.createElement('video');
                      video.muted = targetObj?.videoMuted !== false;
                      video.playsInline = true;
                      video.setAttribute('webkit-playsinline', 'true');
                      video.loop = targetObj?.videoLoop !== false;
                      video.src = url;
                      video.load();
                      videoCache.current.set(url, video);
                  }
                  if (video) {
                      video.dataset.playState = 'paused';
                      video.pause();
                      video.currentTime = 0;
                  }
              }
              break;
          }
          case 'SetCameraZoom':
              if (action.params?.zoomLevel) {
                  camera.current.zoom = Math.max(0.1, Number(action.params.zoomLevel));
              }
              break;
           case 'SaveGame': {
              const slot = String(action.params?.slot || '1').trim() || '1';
              try {
                  const nowSavePose = performance.now();
                  const activePosesSerialized = Array.from(activePoseAnimationsRef.current.entries()).map(([id, p]) => ({
                      id,
                      poseAnimation: p.poseAnimation,
                      loop: p.loop,
                      speed: p.speed,
                      elapsedMs: Math.max(0, nowSavePose - p.startTime)
                  }));
                  const gameState = {
                      sceneName: scene.name,
                      sceneId: scene.id,
                      backgroundColor: runtimeBgColorRef.current,
                      gameObjects: gameObjectsRef.current,
                      gameVariables: gameVariables.current,
                      camera: camera.current,
                      camera3DRuntime: camera3DRuntimeRef.current ? {
                          mode: camera3DRuntimeRef.current.mode,
                          yaw: orbitYawRef.current,
                          pitch: orbitPitchRef.current,
                          fpPitch: orbitFirstPersonPitchRef.current,
                          distance: orbitDistanceRef.current,
                          offset: camera3DRuntimeRef.current.offset,
                          targetObjectName: camera3DRuntimeRef.current.targetObjectName,
                          fogEnabled: camera3DRuntimeRef.current.fogEnabled,
                          fogColor: camera3DRuntimeRef.current.fogColor,
                          fogDensity: camera3DRuntimeRef.current.fogDensity,
                          skyboxImageUrl: camera3DRuntimeRef.current.skyboxImageUrl,
                      } : null,
                      selectedPlayerId: selectedPlayerIdRef.current,
                      joystickEnabled: joystickRuntimeEnabled,
                      activePoseAnimations: activePosesSerialized,
                  };
                  const jsonStr = safeSerialize(gameState);
                  memorySaveSlots.set('return-2d-save-slot-' + slot, jsonStr);
                  try {
                      localStorage.setItem('return-2d-save-slot-' + slot, jsonStr);
                  } catch (lsErr) {
                      console.warn('LocalStorage save failed, using memory slot fallback:', lsErr);
                  }
                  console.log('Game saved to slot ' + slot);
              } catch (e) {
                  console.error('Error saving game state:', e);
              }
              break;
           }
           case 'LoadGame': {
              const slot = String(action.params?.slot || '1').trim() || '1';
              try {
                  let savedStateJSON: string | null = null;
                  try {
                      savedStateJSON = localStorage.getItem('return-2d-save-slot-' + slot);
                  } catch (lsErr) {
                      console.warn('LocalStorage read failed, checking memory slot:', lsErr);
                  }
                  if (!savedStateJSON && memorySaveSlots.has('return-2d-save-slot-' + slot)) {
                      savedStateJSON = memorySaveSlots.get('return-2d-save-slot-' + slot) || null;
                  }
                  if (savedStateJSON) {
                      const savedState = JSON.parse(savedStateJSON);
                      const targetSceneName = savedState.sceneName || savedState.sceneId;
                      if (targetSceneName && targetSceneName !== scene.name && targetSceneName !== scene.id) {
                          sceneChangeRequested.current = true;
                          memorySaveSlots.set('return-2d-pending-load-slot', slot);
                          try {
                              localStorage.setItem('return-2d-pending-load-slot', slot);
                          } catch (e) {}
                          onGoToScene(targetSceneName); 
                      } else {
                          gameObjectsRef.current = sanitizeLoadedGameObjects(savedState.gameObjects || [], is3DModeRef.current);
                          gameVariables.current = (savedState.gameVariables && typeof savedState.gameVariables === 'object')
                              ? JSON.parse(JSON.stringify(savedState.gameVariables))
                              : {};
                          if (savedState.backgroundColor) {
                              setRuntimeBackgroundColor(savedState.backgroundColor);
                          }
                          if (savedState.camera && typeof savedState.camera === 'object') {
                              camera.current = { ...camera.current, ...savedState.camera };
                          }
                          if (savedState.camera3DRuntime && camera3DRuntimeRef.current) {
                              Object.assign(camera3DRuntimeRef.current, savedState.camera3DRuntime);
                              if (typeof savedState.camera3DRuntime.yaw === 'number') orbitYawRef.current = savedState.camera3DRuntime.yaw;
                              if (typeof savedState.camera3DRuntime.pitch === 'number') orbitPitchRef.current = savedState.camera3DRuntime.pitch;
                              if (typeof savedState.camera3DRuntime.fpPitch === 'number') orbitFirstPersonPitchRef.current = savedState.camera3DRuntime.fpPitch;
                              if (typeof savedState.camera3DRuntime.distance === 'number') orbitDistanceRef.current = savedState.camera3DRuntime.distance;
                          }
                          if (savedState.selectedPlayerId !== undefined) {
                              setSelectedPlayerId(savedState.selectedPlayerId);
                          }
                          if (savedState.joystickEnabled !== undefined) {
                              setJoystickRuntimeEnabled(savedState.joystickEnabled);
                          }
                          activeAnimations.current.clear();
                          activePoseAnimationsRef.current.clear();
                          if (savedState.activePoseAnimations && Array.isArray(savedState.activePoseAnimations)) {
                              const now = performance.now();
                              savedState.activePoseAnimations.forEach((item: any) => {
                                  if (item && item.id && item.poseAnimation) {
                                      activePoseAnimationsRef.current.set(item.id, {
                                          poseAnimation: item.poseAnimation,
                                          startTime: now - (item.elapsedMs || 0),
                                          loop: item.loop !== false,
                                          speed: item.speed || 1,
                                          origVisual: undefined
                                      });
                                  }
                              });
                          }
                          draggingRef.current = null;
                          pointerDownObjectRef.current = null;
                          timersRef.current.clear();
                          intervalsRef.current.clear();
                          activeSequencesRef.current.clear();
                          sequenceStatesRef.current.clear();
                          setDialogue(null);
                          if (threeSceneRef.current) {
                              threeMeshMapRef.current.forEach(entry => {
                                  threeSceneRef.current?.remove(entry.group);
                                  disposeObject3D(entry.group);
                              });
                              threeMeshMapRef.current.clear();
                          }
                          console.log('Game loaded from slot ' + slot);
                      }
                  } else {
                      console.warn('No saved state found for slot ' + slot);
                  }
              } catch(e) {
                  console.error('Error loading game state:', e);
              }
              break;
           }
            case 'StartTimer':
                if (action.params?.timerName && action.params?.duration != null) {
                    timersRef.current.set(action.params.timerName, {
                        startTime: performance.now(),
                        duration: Number(action.params.duration) * 1000
                    });
                }
                break;
            case 'StopTimer':
                if (action.params?.timerName) {
                    timersRef.current.delete(action.params.timerName);
                }
                break;
        case 'Attack':
            if (targetObj) {
                playSwordSynthSound();
                targetObj.attackEndTime = Date.now() + 150;
                const damageVal = action.params?.damage !== undefined ? Number(action.params.damage) : 15;
                const pos3 = getObject3DPosition(targetObj);
                const rot3 = getObject3DRotation(targetObj);
                const fwdX = Math.sin(rot3.y);
                const fwdZ = Math.cos(rot3.y);
                const attackBox: GameObject = {
                    id: createUniqueId(),
                    name: 'AttackBox',
                    x: targetObj.x + (targetObj.direction === 'left' ? -35 : targetObj.width + 5),
                    y: targetObj.y + (targetObj.height * 0.1),
                    width: 35,
                    height: targetObj.height * 0.8,
                    shape3D: 'box',
                    position3D: { x: pos3.x + fwdX * 0.9, y: pos3.y + 0.4, z: pos3.z + fwdZ * 0.9 },
                    scale3D: { x: 0.9, y: 0.9, z: 0.9 },
                    isProjectile: true,
                    projectileLifetime: 0.15,
                    behaviors: [],
                    color: '#ffffff',
                    opacity: 0.6,
                    zIndex: 10,
                    stats: { hp: 1, maxHp: 1, attack: damageVal }
                };
                gameObjectsRef.current.push(attackBox);
            }
            break;
        case 'Shoot':
            if (targetObj) {
                playShootSynthSound();
                targetObj.attackEndTime = Date.now() + 100;
                const bSpeed = Number(action.params?.speed || 400);
                const bDamage = Number(action.params?.damage || 15);
                const bDir = targetObj.direction === 'left' ? -1 : 1;
                const pos3d = getObject3DPosition(targetObj);
                const rot3d = getObject3DRotation(targetObj);
                const bulletBox: GameObject = {
                    id: createUniqueId(),
                    name: 'Bullet',
                    x: targetObj.x + (bDir === -1 ? -15 : targetObj.width + 5),
                    y: targetObj.y + targetObj.height / 2 - 4,
                    width: 12,
                    height: 6,
                    shape3D: 'sphere',
                    position3D: { x: pos3d.x + bDir * 0.8, y: pos3d.y + 0.7, z: pos3d.z },
                    scale3D: { x: 0.3, y: 0.3, z: 0.3 },
                    vx3D: Math.sin(rot3d.y) * (bSpeed / 30) || bDir * (bSpeed / 30),
                    vz3D: Math.cos(rot3d.y) * (bSpeed / 30),
                    vy3D: 0,
                    isProjectile: true,
                    projectileLifetime: 3.0,
                    vx: bDir * bSpeed,
                    vy: 0,
                    color: action.params?.color || '#ffff00',
                    opacity: 0.9,
                    zIndex: 12,
                    stats: { hp: 1, maxHp: 1, attack: bDamage }
                };
                gameObjectsRef.current.push(bulletBox);
            }
            break;
        case 'CreatePlayers':
            {
                const pCount = Math.max(2, Math.min(16, Number(action.params?.count || action.params?.value || 2)));
                const mainPlayer = gameObjectsRef.current.find(obj => 
                    obj.behaviors?.some(b => ['PlatformerCharacter', 'TopDownRPGMovement', 'Player3D'].includes(b.name))
                );
                if (mainPlayer) {
                    const rootName = mainPlayer.name.split('_Player')[0];
                    const existingClones = gameObjectsRef.current.filter(obj => 
                        obj.id !== mainPlayer.id && obj.name.startsWith(rootName + '_Player')
                    );
                    if (existingClones.length + 1 !== pCount) {
                        gameObjectsRef.current = gameObjectsRef.current.filter(obj => 
                            obj.id === mainPlayer.id || !obj.name.startsWith(rootName + '_Player')
                        );
                        for (let i = 1; i < pCount; i++) {
                            const clone: GameObject = JSON.parse(JSON.stringify(mainPlayer));
                            clone.id = createUniqueId();
                            clone.name = `${rootName}_Player${i + 1}`;
                            clone.x = mainPlayer.x + i * (mainPlayer.width + 12);
                            if (clone.position3D) clone.position3D.x += i * 1.5;
                            gameObjectsRef.current.push(clone);
                        }
                    }
                }
            }
            break;
        case 'DisconnectPlayers':
            {
                const mainPlayer = gameObjectsRef.current.find(obj => 
                    obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement')
                );
                if (mainPlayer) {
                    const rootName = mainPlayer.name.split('_Player')[0];
                    gameObjectsRef.current = gameObjectsRef.current.filter(obj => 
                        obj.id === mainPlayer.id || !obj.name.startsWith(rootName + '_Player')
                    );
                    framePlayerLeft.current = true;
                }
            }
            break;
        case 'ModifyStat':
            if (targetObj?.stats && action.params?.stat && action.params?.operation && action.params?.value != null) {
                const stat = action.params.stat as keyof GameObject['stats'];
                const operation = action.params.operation;
                const parsedValue = parseNumericValue(action.params.value);
                if (parsedValue === null) break;
                const value = parsedValue;
                let currentVal = Number(targetObj.stats[stat] ?? 0);
                
                let diff = 0;
                if (operation === 'add') diff = value;
                else if (operation === 'subtract') diff = -value;
                else if (operation === 'set') diff = value - currentVal;

                if (operation === 'add') currentVal = roundCleanNumber(currentVal + value);
                else if (operation === 'subtract') currentVal = roundCleanNumber(currentVal - value);
                else if (operation === 'set') currentVal = roundCleanNumber(value);
                
                if (stat === 'hp') {
                    targetObj.stats.hp = Math.max(0, Math.min(targetObj.stats.maxHp, currentVal));
                    spawnFloatingFeedback(targetObj, diff, 'HP');
                } else {
                    targetObj.stats[stat] = currentVal;
                    spawnFloatingFeedback(targetObj, diff, stat);
                }
            }
            break;
        case 'GainHealth':
            if (targetObj && targetObj.stats && params?.value != null) {
                const gain = parseNumericValue(params.value);
                if (gain !== null) {
                    const curHp = targetObj.stats.hp ?? 100;
                    targetObj.stats.hp = Math.max(0, Math.min(targetObj.stats.maxHp, roundCleanNumber(curHp + gain)));
                    spawnFloatingFeedback(targetObj, gain, 'HP');
                }
            }
            break;
        case 'LoseHealth':
            if (targetObj && targetObj.stats && params?.value != null) {
                const loss = parseNumericValue(params.value);
                if (loss !== null) {
                    const curHp = targetObj.stats.hp ?? 100;
                    targetObj.stats.hp = Math.max(0, roundCleanNumber(curHp - loss));
                    spawnFloatingFeedback(targetObj, -loss, 'HP');
                }
            }
            break;
        case 'Knockback':
            if (targetObj) {
                const force = Number(params?.force || 300);
                const sourceName = params?.fromObjectName;
                if (is3DModeRef.current) {
                    const pT = getObject3DPosition(targetObj);
                    let dx = targetObj.direction === 'left' ? 1 : -1;
                    let dz = 0;
                    const src = sourceName === 'Self' ? self : gameObjectsRef.current.find(o => o.name === sourceName);
                    if (src && src.id !== targetObj.id) {
                        const pS = getObject3DPosition(src);
                        dx = pT.x - pS.x;
                        dz = pT.z - pS.z;
                    }
                    const mag = Math.hypot(dx, dz) || 1;
                    const f3 = force > 25 ? force / 45 : force;
                    targetObj.vx3D = (dx / mag) * f3;
                    targetObj.vz3D = (dz / mag) * f3;
                    targetObj.vy3D = Math.max(4, f3 * 0.6);
                    targetObj.grounded3D = false;
                    targetObj.grounded = false;
                } else {
                    let angle = -Math.PI / 4;
                    if (sourceName === 'Self' && self && targetObj.id !== self.id) {
                        const dx = targetObj.x - self.x;
                        const dy = targetObj.y - self.y;
                        angle = Math.atan2(dy, dx);
                    } else if (sourceName && sourceName !== 'Self') {
                        const sourceObj = gameObjectsRef.current.find(o => o.name === sourceName);
                        if (sourceObj) {
                            const dx = targetObj.x - sourceObj.x;
                            const dy = targetObj.y - sourceObj.y;
                            angle = Math.atan2(dy, dx);
                        }
                    }
                    let vx = Math.cos(angle) * force;
                    let vy = Math.sin(angle) * force;
                    const hasRPG = targetObj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
                    if (hasRPG) {
                        targetObj.rpgKnockbackVx = vx;
                        targetObj.rpgKnockbackVy = vy;
                    } else {
                        if (Math.abs(vx) < 50) {
                            vx = (targetObj.direction === 'left' ? 1 : -1) * force * 0.7;
                        }
                        if (vy > -120) {
                            vy = -force * 0.5;
                        }
                        targetObj.vx = vx;
                        targetObj.vy = vy;
                        targetObj.grounded = false;
                    }
                }
            }
            break;
          case 'ShowDialogue':
              if (action.params?.dialogueText) {
                  setDialogue({ 
                      text: action.params.dialogueText, 
                      speaker: action.object,
                      onCompleteActions: action.onCompleteActions
                  });
              }
              break;
          case 'SetJoystickEnabled': {
              const rawVal = params?.enabled !== undefined ? params.enabled : params?.valueBoolean;
              const isEnabled = rawVal === true || rawVal === 'true' || rawVal === undefined;
              setJoystickRuntimeEnabled(isEnabled);
              break;
          }
          case 'EnableBehavior': {
              if (targetObj && (targetObj.behaviors || targetObj._originalBehaviors) && params?.behaviorName) {
                  const origBehavs = targetObj._originalBehaviors || targetObj.behaviors || [];
                  origBehavs.forEach((b: any) => {
                      if (b.name === params.behaviorName) {
                          b.disabled = false;
                      }
                  });
              }
              break;
          }
          case 'DisableBehavior': {
              if (targetObj && (targetObj.behaviors || targetObj._originalBehaviors) && params?.behaviorName) {
                  const origBehavs = targetObj._originalBehaviors || targetObj.behaviors || [];
                  origBehavs.forEach((b: any) => {
                      if (b.name === params.behaviorName) {
                          b.disabled = true;
                      }
                  });
              }
              break;
          }
          case 'SetSkin':
              if (targetObj) {
                  let url = params?.imageUrl;
                  if (params?.assetId) {
                      const asset = assets.find(a => a.id === params.assetId);
                      if (asset) url = asset.url;
                  }
                  if (url) {
                      targetObj.imageUrl = url;
                      if (!imageCache.current.has(url)) {
                          const img = new Image();
                          img.src = url;
                          img.onload = () => {
                              imageCache.current.set(url, img);
                          };
                      }
                  }
                  if (params?.color) {
                      targetObj.color = params.color;
                  }
              }
              break;
          case 'SetPlayerSkin': {
              const playerObj = gameObjectsRef.current.find(o => 
                  !o.isUI && 
                  (
                      o.behaviors?.some(b => ['PlatformerCharacter', 'TopDownRPGMovement'].includes(b.name)) ||
                      ['player', 'jugador', 'jugador_1', 'player_1'].includes(o.name.toLowerCase())
                  )
              );
              const targetToUse = playerObj || targetObj;
              if (targetToUse) {
                  let url = params?.imageUrl;
                  if (params?.assetId) {
                      const asset = assets.find(a => a.id === params.assetId);
                      if (asset) url = asset.url;
                  }
                  if (url) {
                      targetToUse.imageUrl = url;
                      if (!imageCache.current.has(url)) {
                          const img = new Image();
                          img.src = url;
                          img.onload = () => {
                              imageCache.current.set(url, img);
                          };
                      }
                  }
                  if (params?.color) {
                      targetToUse.color = params.color;
                  }
              }
              break;
          }
          // === 3D Block & Event Actions ===
          case 'SetPosition3D':
              if (targetObj && params) {
                  const pos = getObject3DPosition(targetObj);
                  if (params.x3d != null && params.x3d !== '') pos.x = Number(params.x3d);
                  if (params.y3d != null && params.y3d !== '') pos.y = Number(params.y3d);
                  if (params.z3d != null && params.z3d !== '') pos.z = Number(params.z3d);
                  targetObj.position3D = pos;
                  (targetObj as any)._mutatedBy3DAction = true;
                  (targetObj as any)._moved3DThisFrame = true;
                  sync3DTo2D(targetObj);
              }
              break;
          case 'Move3D':
              if (targetObj && params) {
                  const pos = getObject3DPosition(targetObj);
                  const mult = isContinuous ? deltaTime : 1;
                  pos.x += Number(params.dx || 0) * mult;
                  pos.y += Number(params.dy || 0) * mult;
                  pos.z += Number(params.dz || 0) * mult;
                  targetObj.position3D = pos;
                  (targetObj as any)._mutatedBy3DAction = true;
                  (targetObj as any)._moved3DThisFrame = true;
                  sync3DTo2D(targetObj);
              }
              break;
          case 'Rotate3D':
              if (targetObj && params) {
                  const rot = getObject3DRotation(targetObj);
                  const mult = isContinuous ? deltaTime : 1;
                  rot.x += ((Number(params.rx || 0) * Math.PI) / 180) * mult;
                  rot.y += ((Number(params.ry || 0) * Math.PI) / 180) * mult;
                  rot.z += ((Number(params.rz || 0) * Math.PI) / 180) * mult;
                  targetObj.rotation3D = rot;
                  targetObj.rotation = (rot.y * 180) / Math.PI;
                  (targetObj as any)._mutatedBy3DAction = true;
              }
              break;
          case 'RotateContinuously3D':
              if (targetObj && params) {
                  const axis = (params.axis3d === 'x' || params.axis3d === 'z') ? params.axis3d : 'y';
                  const speed = Number(params.speed ?? 90);
                  targetObj.rotationSpeed3D = {
                      ...(targetObj.rotationSpeed3D || { x: 0, y: 0, z: 0 }),
                      [axis]: speed
                  };
                  (targetObj as any)._mutatedBy3DAction = true;
              }
              break;
          case 'Scale3D':
              if (targetObj && params) {
                  const d = getObject3DDimensions(targetObj);
                  const dim = { x: d.w, y: d.h, z: d.d };
                  if (params.sx != null && params.sx !== '') dim.x = Math.max(0.05, Number(params.sx));
                  if (params.sy != null && params.sy !== '') dim.y = Math.max(0.05, Number(params.sy));
                  if (params.sz != null && params.sz !== '') dim.z = Math.max(0.05, Number(params.sz));
                  targetObj.scale3D = dim;
                  (targetObj as any)._mutatedBy3DAction = true;
              }
              break;
          case 'ForceJump3D':
              if (targetObj) {
                  const jf = Number(params?.jumpForce ?? 7);
                  targetObj.vy3D = jf;
                  targetObj.grounded3D = false;
                  targetObj.grounded = false;
              }
              break;
          case 'ApplyImpulse3D':
              if (targetObj && params) {
                  const ix = parseNumericValue(params.ix ?? 0) ?? 0;
                  const iy = parseNumericValue(params.iy ?? 0) ?? 0;
                  const iz = parseNumericValue(params.iz ?? 0) ?? 0;
                  const hasGrav = Boolean(targetObj.behaviors?.some(b =>
                      ['Player3D', 'PlatformerCharacter', 'Physics3D', 'Physics', 'Boss3D', 'Boss'].includes(b.name)
                  ));
                  if (isContinuous) {
                      const prevLoop = (targetObj as any)._pendingLoopImpulse3D || { x: 0, y: 0, z: 0 };
                      (targetObj as any)._pendingLoopImpulse3D = {
                          x: prevLoop.x + ix,
                          y: prevLoop.y + iy,
                          z: prevLoop.z + iz,
                      };
                      const burst = (targetObj as any)._burstImpulse3D;
                      if (burst) {
                          if (ix !== 0 && burst.x * ix < 0) burst.x = 0;
                          if (iy !== 0 && burst.y * iy < 0) burst.y = 0;
                          if (iz !== 0 && burst.z * iz < 0) burst.z = 0;
                      }
                      if (iy > 0) {
                          targetObj.grounded3D = false;
                          targetObj.grounded = false;
                      }
                  } else {
                      const burst = (targetObj as any)._burstImpulse3D || { x: 0, y: 0, z: 0 };
                      if (ix !== 0) burst.x = (burst.x * ix < 0) ? ix : (burst.x + ix);
                      if (iz !== 0) burst.z = (burst.z * iz < 0) ? iz : (burst.z + iz);
                      if (hasGrav) {
                          if (iy !== 0) {
                              targetObj.vy3D = ((targetObj.vy3D || 0) * iy < 0) ? iy : ((targetObj.vy3D || 0) + iy);
                              if (iy > 0) {
                                  targetObj.grounded3D = false;
                                  targetObj.grounded = false;
                              }
                          }
                      } else if (iy !== 0) {
                          burst.y = (burst.y * iy < 0) ? iy : (burst.y + iy);
                          if (iy > 0) {
                              targetObj.grounded3D = false;
                              targetObj.grounded = false;
                          }
                      }
                      (targetObj as any)._burstImpulse3D = burst;
                  }
                  (targetObj as any)._mutatedBy3DAction = true;
              }
              break;
          case 'SetModel3D':
              if (targetObj && (params?.modelUrl || params?.url || params?.value)) {
                  const url = String(params.modelUrl || params.url || params.value);
                  targetObj.modelUrl = url;
                  preloadGLTFModels([url]);
                  (targetObj as any)._mutatedBy3DAction = true;
              }
              break;
          case 'SetShape3D':
              if (targetObj && params?.shape3D) {
                  targetObj.shape3D = params.shape3D as Shape3D;
              }
              break;
          case 'SetColor3D':
              if (targetObj && params) {
                  if (params.color) targetObj.color = params.color;
                  if (params.emissiveColor) targetObj.emissive3D = params.emissiveColor;
                  if (params.emissiveIntensity != null && params.emissiveIntensity !== '') {
                      targetObj.emissiveIntensity3D = Number(params.emissiveIntensity);
                  }
              }
              break;
          case 'SetCamera3DMode':
              if (params?.cameraMode) {
                  camera3DRuntimeRef.current.mode = params.cameraMode;
              }
              if (params?.targetObjectName) {
                  camera3DRuntimeRef.current.targetObjectName = params.targetObjectName;
              }
              break;
          case 'SetCamera3DOffset':
              if (params) {
                  camera3DRuntimeRef.current.offset = {
                      x: params.cx != null && params.cx !== '' ? Number(params.cx) : camera3DRuntimeRef.current.offset.x,
                      y: params.cy != null && params.cy !== '' ? Number(params.cy) : camera3DRuntimeRef.current.offset.y,
                      z: params.cz != null && params.cz !== '' ? Number(params.cz) : camera3DRuntimeRef.current.offset.z,
                  };
              }
              break;
          case 'LookAtObject3D':
              if (targetObj && params?.targetObjectName) {
                  const lookTarget = gameObjectsRef.current.find(o => o.name === params.targetObjectName);
                  if (lookTarget) {
                      const p1 = getObject3DPosition(targetObj);
                      const p2 = getObject3DPosition(lookTarget);
                      const rot = getObject3DRotation(targetObj);
                      rot.y = Math.atan2(p2.x - p1.x, p2.z - p1.z);
                      targetObj.rotation3D = rot;
                      targetObj.rotation = (rot.y * 180) / Math.PI;
                      (targetObj as any)._mutatedBy3DAction = true;
                  }
              }
              break;
          case 'MoveTowards3D':
              if (targetObj && params?.targetObjectName) {
                  const moveTarget = gameObjectsRef.current.find(o => o.name === params.targetObjectName);
                  if (moveTarget) {
                      const p1 = getObject3DPosition(targetObj);
                      const p2 = getObject3DPosition(moveTarget);
                      const dx = p2.x - p1.x;
                      const dz = p2.z - p1.z;
                      const dist = Math.hypot(dx, dz);
                      if (dist > 0.15) {
                          const spd = Number(params.speed ?? 3.5);
                          const step = isContinuous ? spd * deltaTime : Math.min(dist, spd * 0.25);
                          p1.x += (dx / dist) * step;
                          p1.z += (dz / dist) * step;
                          targetObj.position3D = p1;
                          const rot = getObject3DRotation(targetObj);
                          rot.y = Math.atan2(dx, dz);
                          targetObj.rotation3D = rot;
                          (targetObj as any)._mutatedBy3DAction = true;
                          (targetObj as any)._moved3DThisFrame = true;
                          sync3DTo2D(targetObj);
                      }
                  }
              }
              break;
          case 'CreateObject3D':
              if (params?.templateObjectName) {
                  const tpl = scene.gameObjects.find(o => o.name === params.templateObjectName) || globalObjects?.find(o => o.name === params.templateObjectName);
                  if (tpl) {
                      const newObj: GameObject = JSON.parse(JSON.stringify(tpl));
                      newObj.id = createUniqueId();
                      newObj.position3D = {
                          x: Number(params.x3d ?? 0),
                          y: Number(params.y3d ?? 0),
                          z: Number(params.z3d ?? 0),
                      };
                      sync3DTo2D(newObj);
                      gameObjectsRef.current.push(newObj);
                  }
              }
              break;
          case 'Shoot3D':
              if (targetObj) {
                  playShootSynthSound();
                  const pos = getObject3DPosition(targetObj);
                  const rot = getObject3DRotation(targetObj);
                  const speed = Number(params?.speed ?? 15);
                  const damage = Number(params?.damage ?? 20);
                  const dirX = Math.sin(rot.y);
                  const dirZ = Math.cos(rot.y);
                  const bullet3D: GameObject = {
                      id: createUniqueId(),
                      name: 'Bullet',
                      x: targetObj.x,
                      y: targetObj.y,
                      width: 16,
                      height: 16,
                      color: params?.color || '#facc15',
                      shape3D: 'sphere',
                      emissive3D: params?.color || '#facc15',
                      emissiveIntensity3D: 0.8,
                      position3D: { x: pos.x + dirX * 0.9, y: pos.y + 0.8, z: pos.z + dirZ * 0.9 },
                      scale3D: { x: 0.35, y: 0.35, z: 0.35 },
                      vx3D: dirX * speed,
                      vy3D: 0,
                      vz3D: dirZ * speed,
                      zIndex: 15,
                      isProjectile: true,
                      projectileLifetime: 3.0,
                      stats: { hp: 1, maxHp: 1, attack: damage },
                  };
                  sync3DTo2D(bullet3D);
                  gameObjectsRef.current.push(bullet3D);
              }
              break;
          case 'SetLight3D':
              if (targetObj && params) {
                  if (params.intensity != null && params.intensity !== '') targetObj.lightIntensity3D = Number(params.intensity);
                  if (params.distance != null && params.distance !== '') targetObj.lightDistance3D = Number(params.distance);
                  if (params.color) targetObj.color = params.color;
              }
              break;
          case 'SetFog3D':
              if (params) {
                  camera3DRuntimeRef.current.fogEnabled = params.enabled !== false && params.enabled !== 'false';
                  if (params.color) camera3DRuntimeRef.current.fogColor = params.color;
                  if (params.density != null && params.density !== '') camera3DRuntimeRef.current.fogDensity = Number(params.density);
              }
              break;
          case 'SetSkybox3D': {
              let skyUrl = params?.imageUrl ? String(params.imageUrl) : '';
              if (!skyUrl && params?.assetId) {
                  const skyAsset = assets.find(a => String(a.id) === String(params.assetId));
                  if (skyAsset) skyUrl = skyAsset.url;
              }
              camera3DRuntimeRef.current.skyboxImageUrl = skyUrl || '';
              break;
          }
      }
  };

  const executeAction = (action: Action, self?: GameObject, isContinuous: boolean = false, deltaTime: number = 0, forceRestart: boolean = false, pickedObjects?: Record<string, GameObject[]>) => {
      if (action.object === 'System' || action.object === 'Camera' || action.object === 'Self' || (self && action.object === self.name)) {
          executeActionSingle(action, self, undefined, isContinuous, deltaTime, forceRestart);
          return;
      }
      
      let targetInstances = pickedObjects && pickedObjects[action.object] ? pickedObjects[action.object] : undefined;
      
      if (!targetInstances || targetInstances.length === 0) {
          targetInstances = gameObjectsRef.current.filter(o => o.name === action.object);
      }
      
      if (targetInstances.length > 0) {
          targetInstances.forEach(inst => {
              executeActionSingle(action, self, inst, isContinuous, deltaTime, forceRestart);
          });
      } else {
          executeActionSingle(action, self, undefined, isContinuous, deltaTime, forceRestart);
      }
  };

  const CONTINUOUS_WAIT_PHASE_ACTIONS = new Set<string>([
      'Move3D', 'MoveTowards3D', 'Rotate3D', 'LookAtObject3D', 'ApplyImpulse3D',
      'MoveObject', 'RotateObject', 'ScaleObject', 'FollowObject', 'MoveInDirection'
  ]);

  const compileSequencePhases = (actionsList: Action[]): { phases: { actions: Action[]; waitSeconds: number }[]; signature: string } => {
      const phases: { actions: Action[]; waitSeconds: number }[] = [];
      let pendingActions: Action[] = [];
      const sigParts: string[] = [];

      for (const act of actionsList) {
          if (act.action === 'Wait') {
              const rawDur = act.params?.duration !== undefined && act.params?.duration !== '' ? Number(act.params.duration) : 1;
              const secs = Math.max(0, Number.isFinite(rawDur) ? rawDur : 1);
              sigParts.push(`W:${secs}`);
              if (pendingActions.length === 0 && phases.length > 0) {
                  phases[phases.length - 1].waitSeconds += secs;
              } else {
                  phases.push({ actions: pendingActions, waitSeconds: secs });
                  pendingActions = [];
              }
          } else {
              sigParts.push(`${act.action}:${act.object || ''}`);
              pendingActions.push(act);
          }
      }
      if (pendingActions.length > 0) {
          phases.push({ actions: pendingActions, waitSeconds: 0 });
      }
      return { phases, signature: sigParts.join('|') };
  };

  const advanceSequenceState = (
      key: string,
      state: {
          phases: { actions: Action[]; waitSeconds: number }[];
          phaseIndex: number;
          elapsedInPhase: number;
          enteredPhase: boolean;
          isContinuous: boolean;
          lastSeenFrame: number;
          self?: GameObject;
          pickedObjects?: Record<string, GameObject[]>;
          signature: string;
      },
      deltaTime: number
  ) => {
      if (!state.phases.length) {
          sequenceStatesRef.current.delete(key);
          return;
      }

      let dtLeft = Math.max(0, deltaTime);
      let safety = state.phases.length + 4;
      let ranZeroDt = false;

      while (safety-- > 0) {
          const phase = state.phases[state.phaseIndex];
          if (!phase) {
              sequenceStatesRef.current.delete(key);
              return;
          }

          if (!state.enteredPhase) {
              state.enteredPhase = true;
              for (const act of phase.actions) {
                  if (!state.isContinuous || !CONTINUOUS_WAIT_PHASE_ACTIONS.has(act.action)) {
                      executeAction(act, state.self, false, 0, false, state.pickedObjects);
                      if (sceneChangeRequested.current) {
                          sceneChangeRequested.current = false;
                          sequenceStatesRef.current.delete(key);
                          return;
                      }
                  }
              }
          }

          const remaining = Math.max(0, phase.waitSeconds - state.elapsedInPhase);
          const stepDt = phase.waitSeconds > 0 ? Math.min(dtLeft, remaining) : 0;

          if (state.isContinuous && (stepDt > 0 || (dtLeft === 0 && !ranZeroDt))) {
              for (const act of phase.actions) {
                  if (CONTINUOUS_WAIT_PHASE_ACTIONS.has(act.action)) {
                      executeAction(act, state.self, true, stepDt, false, state.pickedObjects);
                      if (sceneChangeRequested.current) {
                          sceneChangeRequested.current = false;
                          sequenceStatesRef.current.delete(key);
                          return;
                      }
                  }
              }
              ranZeroDt = true;
          }

          state.elapsedInPhase += stepDt;
          dtLeft -= stepDt;

          if (phase.waitSeconds <= 0 || state.elapsedInPhase >= phase.waitSeconds - 1e-6) {
              if (state.phaseIndex < state.phases.length - 1) {
                  state.phaseIndex += 1;
                  state.elapsedInPhase = 0;
                  state.enteredPhase = false;
              } else if (state.isContinuous) {
                  state.phaseIndex = 0;
                  state.elapsedInPhase = 0;
                  state.enteredPhase = false;
                  if (dtLeft <= 1e-6) break;
              } else {
                  sequenceStatesRef.current.delete(key);
                  return;
              }
          } else {
              break;
          }
      }
  };

  const stepActiveSequences = (deltaTime: number) => {
      const curFrame = sequenceFrameRef.current;
      const entries = Array.from(sequenceStatesRef.current.entries());
      for (const [key, state] of entries) {
          if (state.isContinuous) {
              if (state.lastSeenFrame !== curFrame) {
                  sequenceStatesRef.current.delete(key);
              }
          } else {
              advanceSequenceState(key, state, deltaTime);
          }
      }
  };

  const executeActionsSequential = (
      actionsList: Action[], 
      self?: GameObject, 
      isContinuous: boolean = false, 
      deltaTime: number = 0, 
      forceRestart: boolean = false, 
      pickedObjects?: Record<string, GameObject[]>,
      sequenceKey?: string
  ) => {
      const hasWait = actionsList.some(a => a.action === 'Wait');
      if (!hasWait) {
          if (sequenceKey) sequenceStatesRef.current.delete(sequenceKey);
          for (let i = 0; i < actionsList.length; i++) {
              executeAction(actionsList[i], self, isContinuous, deltaTime, forceRestart, pickedObjects);
              if (sceneChangeRequested.current) {
                  sceneChangeRequested.current = false;
                  break;
              }
          }
          return;
      }

      const key = sequenceKey || `anon-${Date.now()}-${Math.random()}`;
      const existing = sequenceStatesRef.current.get(key);
      if (existing && !existing.isContinuous) {
          if (!isContinuous) {
              return;
          }
      }

      const compiled = compileSequencePhases(actionsList);
      if (!compiled.phases.length) return;

      if (existing && existing.isContinuous && isContinuous) {
          if (existing.signature === compiled.signature) {
              // Keep running smoothly while hot-reading live params & targets every frame!
              let idx = 0;
              let pCursor = 0;
              while (pCursor < existing.phases.length && idx < actionsList.length) {
                  const targetPhase = existing.phases[pCursor];
                  const nextActs: Action[] = [];
                  let mergedWait = 0;
                  while (idx < actionsList.length && actionsList[idx].action !== 'Wait') {
                      nextActs.push(actionsList[idx++]);
                  }
                  while (idx < actionsList.length && actionsList[idx].action === 'Wait') {
                      const rawD = actionsList[idx].params?.duration !== undefined && actionsList[idx].params?.duration !== '' ? Number(actionsList[idx].params.duration) : 1;
                      mergedWait += Math.max(0, Number.isFinite(rawD) ? rawD : 1);
                      idx++;
                  }
                  targetPhase.actions = nextActs;
                  targetPhase.waitSeconds = mergedWait;
                  pCursor++;
              }
              existing.self = self;
              existing.pickedObjects = pickedObjects;
              existing.lastSeenFrame = sequenceFrameRef.current;
              advanceSequenceState(key, existing, deltaTime);
              return;
          }
      }

      const nextState = {
          phases: compiled.phases,
          phaseIndex: 0,
          elapsedInPhase: 0,
          enteredPhase: false,
          isContinuous,
          lastSeenFrame: sequenceFrameRef.current,
          self,
          pickedObjects,
          signature: compiled.signature,
      };
      sequenceStatesRef.current.set(key, nextState);
      advanceSequenceState(key, nextState, isContinuous ? deltaTime : 0);
  };

  const checkCondition = (cond: Condition, executingObj?: GameObject, executingObj2?: GameObject, continuousLoop: boolean = false) => {
    const variable = cond.params?.variable !== undefined ? String(cond.params.variable).trim() : '';
    const value = cond.params?.value;
    const operator = cond.params?.operator || '==';
    let obj = executingObj && executingObj.name === cond.object ? executingObj : 
              executingObj2 && executingObj2.name === cond.object ? executingObj2 :
              gameObjectsRef.current.find(o => o.name === cond.object);

    switch (cond.trigger) {
        case 'Always':
            return true;
        case 'OnCollisionWith':
        case 'OnVerticalCollision':
        case 'OnHorizontalCollision':
            return frameCollisions.current.some(c => {
                const pairMatch = ((c.obj1Name === cond.object && c.obj2Name === cond.target) || (c.obj2Name === cond.object && c.obj1Name === cond.target));
                if (!pairMatch) return false;
                if (cond.trigger === 'OnCollisionWith') return true;
                return c.type === cond.trigger;
            });
        case 'OnClick':
        case 'OnObjectClicked':
        case 'OnObjectClicked3D':
            if (obj) {
                return frameClicks.current.some(c => c.id === obj.id || (cond.object && c.name === cond.object));
            }
            if (executingObj) {
                return frameClicks.current.some(c => c.id === executingObj.id || c.name === executingObj.name);
            }
            if (cond.object && cond.object !== 'System') {
                return frameClicks.current.some(c => c.name === cond.object);
            }
            return frameClicks.current.length > 0;
        case 'OnObjectReleased':
            if (obj) {
                return frameObjectReleases.current.some(c => c.id === obj.id || (cond.object && c.name === cond.object));
            }
            if (executingObj) {
                return frameObjectReleases.current.some(c => c.id === executingObj.id || c.name === executingObj.name);
            }
            if (cond.object && cond.object !== 'System') {
                return frameObjectReleases.current.some(c => c.name === cond.object);
            }
            return frameObjectReleases.current.length > 0;
        case 'OnInteract':
            return obj ? frameInteractions.current.some(c => c.id === obj.id) : frameInteractions.current.some(c => c.name === cond.object);
        case 'IsSceneUnlocked':
            if (cond.params?.sceneName) {
                return !!gameVariables.current['scene_unlocked_' + cond.params.sceneName];
            }
            return false;
        case 'OnKeyPress': {
            const k = cond.params?.key ? String(cond.params.key).toLowerCase() : '';
            if (!k) return false;
            return continuousLoop
                ? Boolean(keysPressed.current[k] || frameKeyPresses.current.includes(k))
                : frameKeyPresses.current.includes(k);
        }
        case 'OnKeyRelease':
            return !!(cond.params?.key && frameKeyReleases.current.includes(String(cond.params.key).toLowerCase()));
        case 'OnAnyKeyPress':
            return continuousLoop
                ? (Object.values(keysPressed.current).some(Boolean) || frameKeyPresses.current.length > 0)
                : frameKeyPresses.current.length > 0;
        case 'OnAnyKeyRelease':
            return frameKeyReleases.current.length > 0;
        case 'OnAttack':
            return obj ? frameAttacks.current.some(c => c.id === obj.id) : frameAttacks.current.some(c => c.name === cond.object);
        case 'OnTimerElapsed':
            return frameTimerEvents.current.includes(cond.params?.timerName);
        case 'OnDialogueEnd':
            return frameDialogueEnd.current;
        case 'IsMobile':
            return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
        case 'IsPC':
            return !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768);
        case 'CompareVariable': {
            if (!variable) return false;
            const op = operator || '==';
            const currentVarRaw = gameVariables.current[variable];
            const varValue = (currentVarRaw === undefined || currentVarRaw === null || currentVarRaw === '') ? 0 : currentVarRaw;
            const compValue = value !== undefined ? String(value).trim() : "";

            const nVar = parseNumericValue(varValue);
            const nComp = parseNumericValue(compValue);
            if (nVar !== null && nComp !== null) {
                switch (op) {
                    case '==': return nVar === nComp;
                    case '!=': return nVar !== nComp;
                    case '>': return nVar > nComp;
                    case '<': return nVar < nComp;
                    case '>=': return nVar >= nComp;
                    case '<=': return nVar <= nComp;
                    default: return false;
                }
            }

            switch (op) {
                case '==': return String(varValue).trim() === compValue;
                case '!=': return String(varValue).trim() !== compValue;
                default: return false;
            }
        }
        case 'CompareBooleanVariable': {
            if (!variable) return false;
            let currentVarRaw = gameVariables.current[variable];
            if (currentVarRaw === 'false') currentVarRaw = false;
            else if (currentVarRaw === 'true') currentVarRaw = true;
            else currentVarRaw = !!currentVarRaw;
            
            const targetBool = cond.params?.valueBoolean === true || cond.params?.valueBoolean === 'true';
            return currentVarRaw === targetBool;
        }
        case 'CompareObjectVariable': {
            if (!obj || !variable) return false;
            const op = operator || '==';
            const objVar = obj.variables?.find(v => v.name === variable);
            const varValue = (objVar && objVar.value !== undefined && objVar.value !== null && objVar.value !== '') ? objVar.value : 0;
            const compValue = value !== undefined ? String(value).trim() : "";

            const nVar = parseNumericValue(varValue);
            const nComp = parseNumericValue(compValue);
            if (nVar !== null && nComp !== null) {
                switch (op) {
                    case '==': return nVar === nComp;
                    case '!=': return nVar !== nComp;
                    case '>': return nVar > nComp;
                    case '<': return nVar < nComp;
                    case '>=': return nVar >= nComp;
                    case '<=': return nVar <= nComp;
                    default: return false;
                }
            }
            switch (op) {
                case '==': return String(varValue).trim() === compValue;
                case '!=': return String(varValue).trim() !== compValue;
                default: return false;
            }
        }
        case 'CompareObjectBooleanVariable': {
            if (!obj || !variable) return false;
            const objVar = obj.variables?.find(v => v.name === variable);
            let varValue = objVar ? objVar.value : false;
            if (varValue === 'false') varValue = false;
            else if (varValue === 'true') varValue = true;
            else varValue = !!varValue;
            
            const targetBool = cond.params?.valueBoolean === true || cond.params?.valueBoolean === 'true';
            return varValue === targetBool;
        }
        case 'CompareStat': {
            if (!obj || !cond.params?.stat) return false;
            const op = operator || '==';
            const statName = cond.params?.stat as keyof GameObject['stats'];
            const statValue = obj.stats?.[statName] ?? 0;
            const compValue = value !== undefined ? String(value).trim() : "";

            const nStat = parseNumericValue(statValue);
            const nComp = parseNumericValue(compValue);
            if (nStat !== null && nComp !== null) {
                switch (op) {
                    case '==': return nStat === nComp;
                    case '!=': return nStat !== nComp;
                    case '>': return nStat > nComp;
                    case '<': return nStat < nComp;
                    case '>=': return nStat >= nComp;
                    case '<=': return nStat <= nComp;
                    default: return false;
                }
            }
            switch (op) {
                case '==': return String(statValue).trim() === compValue;
                case '!=': return String(statValue).trim() !== compValue;
                default: return false;
            }
        }
        case 'IsOnGround': return !!(obj && (!!obj.grounded || !!obj.grounded3D));
        case 'IsGrounded3D': return !!(obj && (!!obj.grounded3D || !!obj.grounded));
        case 'Distance3DLessThan': {
            const targetName = cond.target || cond.params?.targetObjectName;
            const sourceObj = obj || executingObj;
            if (!sourceObj || !targetName) return false;
            const maxDist = Number(cond.params?.distance ?? 3);
            const p1 = getObject3DPosition(sourceObj);
            if (executingObj2 && executingObj2.name === targetName && executingObj2.id !== sourceObj.id) {
                const p2 = getObject3DPosition(executingObj2);
                return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z) <= maxDist;
            }
            return gameObjectsRef.current.some(cand => {
                if (cand.name !== targetName || cand.id === sourceObj.id) return false;
                const p2 = getObject3DPosition(cand);
                return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z) <= maxDist;
            });
        }
        case 'IsMoving': {
            const ev = (obj as any)?._effectiveVel3D;
            const vx3 = ev ? ev.x : (obj?.vx3D || 0);
            const vy3 = ev ? ev.y : (obj?.vy3D || 0);
            const vz3 = ev ? ev.z : (obj?.vz3D || 0);
            return !!(obj && (Math.abs(obj.vx || 0) > 1 || Math.abs(obj.vy || 0) > 1 || Math.hypot(vx3, vy3, vz3) > 0.05));
        }
        case 'IsIdle': {
            if (!obj || obj.isClimbing || obj.parentId) return false;
            const ev = (obj as any)?._effectiveVel3D;
            const vx3 = ev ? ev.x : (obj?.vx3D || 0);
            const vz3 = ev ? ev.z : (obj?.vz3D || 0);
            const hasGrav = !!obj.behaviors?.some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
            const hasTopDown = !!obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
            const isGrounded = !!(obj.grounded || obj.grounded3D || (hasTopDown && !hasGrav));
            if (!isGrounded) return false;
            if (is3DModeRef.current) {
                return Math.hypot(vx3, vz3) <= 0.05;
            }
            const moving2D = (hasTopDown && !hasGrav) ? Math.hypot(obj.vx || 0, obj.vy || 0) > 1 : Math.abs(obj.vx || 0) > 1;
            return !moving2D;
        }
        case 'IsRunning': {
            if (!obj || obj.isClimbing || obj.parentId) return false;
            const ev = (obj as any)?._effectiveVel3D;
            const vx3 = ev ? ev.x : (obj?.vx3D || 0);
            const vz3 = ev ? ev.z : (obj?.vz3D || 0);
            const hasGrav = !!obj.behaviors?.some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
            const hasTopDown = !!obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
            const isGrounded = !!(obj.grounded || obj.grounded3D || (hasTopDown && !hasGrav));
            if (!isGrounded) return false;
            if (is3DModeRef.current) {
                return Math.hypot(vx3, vz3) > 0.05;
            }
            return (hasTopDown && !hasGrav) ? Math.hypot(obj.vx || 0, obj.vy || 0) > 1 : Math.abs(obj.vx || 0) > 1;
        }
        case 'IsJumping': {
            if (!obj || obj.isClimbing || obj.parentId) return false;
            const ev = (obj as any)?._effectiveVel3D;
            const vy3 = obj?.vy3D !== undefined ? obj.vy3D : (ev ? ev.y : 0);
            const hasGrav = !!obj.behaviors?.some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
            const hasTopDown = !!obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
            const isGrounded = is3DModeRef.current ? !!obj.grounded3D : !!(obj.grounded || (hasTopDown && !hasGrav));
            if (isGrounded) return false;
            return is3DModeRef.current ? vy3 > 0.05 : (obj.vy || 0) < -0.5;
        }
        case 'IsFalling': {
            if (!obj || obj.isClimbing || obj.parentId) return false;
            const ev = (obj as any)?._effectiveVel3D;
            const vy3 = obj?.vy3D !== undefined ? obj.vy3D : (ev ? ev.y : 0);
            const hasGrav = !!obj.behaviors?.some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
            const hasTopDown = !!obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
            const isGrounded = is3DModeRef.current ? !!obj.grounded3D : !!(obj.grounded || (hasTopDown && !hasGrav));
            if (isGrounded) return false;
            return is3DModeRef.current ? vy3 < -0.05 : (obj.vy || 0) > 0.5;
        }
        case 'IsClimbing': return !!(obj && !!obj.isClimbing);
        case 'IsLookingLeft': return !!(obj && obj.direction === 'left');
        case 'IsLookingRight': return !!(obj && obj.direction === 'right');
        case 'IsMusicPlaying': {
            const isPlaying = backgroundMusicPlayer.current && !backgroundMusicPlayer.current.paused;
            if (!isPlaying) return false;
            if (cond.params?.soundId) return String(currentBackgroundMusicId.current) === String(cond.params.soundId);
            return true;
        }
        case 'OnJoystickMove':
            return frameJoystickEvents.current.length > 0;
        case 'OnJoystickUp':
            return frameJoystickEvents.current.includes('up');
        case 'OnJoystickDown':
            return frameJoystickEvents.current.includes('down');
        case 'OnJoystickLeft':
            return frameJoystickEvents.current.includes('left');
        case 'OnJoystickRight':
            return frameJoystickEvents.current.includes('right');
        case 'OnButtonDown': {
            const reqBtnD = cond.params?.buttonName ? String(cond.params.buttonName).toLowerCase() : '';
            return reqBtnD ? frameButtonDown.current.some(b => String(b).toLowerCase() === reqBtnD) : frameButtonDown.current.length > 0;
        }
        case 'OnButtonUp': {
            const reqBtnU = cond.params?.buttonName ? String(cond.params.buttonName).toLowerCase() : '';
            return reqBtnU ? frameButtonUp.current.some(b => String(b).toLowerCase() === reqBtnU) : frameButtonUp.current.length > 0;
        }
        case 'OnTriggerDown': {
            const reqTrigD = cond.params?.triggerName ? String(cond.params.triggerName).toLowerCase() : '';
            return reqTrigD ? frameTriggerDown.current.some(t => String(t).toLowerCase() === reqTrigD) : frameTriggerDown.current.length > 0;
        }
        case 'OnTriggerUp': {
            const reqTrigU = cond.params?.triggerName ? String(cond.params.triggerName).toLowerCase() : '';
            return reqTrigU ? frameTriggerUp.current.some(t => String(t).toLowerCase() === reqTrigU) : frameTriggerUp.current.length > 0;
        }
        case 'OnConsoleCommand': {
            const reqCmd = cond.params?.command ? String(cond.params.command).toLowerCase() : '';
            return reqCmd ? frameConsoleCommands.current.some(c => String(c).toLowerCase() === reqCmd) : frameConsoleCommands.current.length > 0;
        }
        case 'OnMatchFound':
            return frameMatchFound.current;
        case 'OnPlayerJoined':
            return framePlayerJoined.current;
        case 'OnPlayerLeft':
            return framePlayerLeft.current;
        case 'OnReceiveNetworkMessage':
            return frameReceiveNetworkMessage.current;
        case 'OnHealthDepleted':
            return !!(obj && obj.stats && obj.stats.hp <= 0);
        default: return false;
    }
};

  const evaluateSingleEvent = (
      event: typeof scene.events[number],
      deltaTime: number = 0,
      options: { skipTrigger?: string; skipCondIndex?: number; forceOneShot?: boolean; objectMap?: Map<string, GameObject[]> } = {}
  ) => {
      const objectMap = options.objectMap || (() => {
          const map = new Map<string, GameObject[]>();
          gameObjectsRef.current.forEach(obj => {
              if (!map.has(obj.name)) map.set(obj.name, []);
              map.get(obj.name)!.push(obj);
          });
          return map;
      })();

      const OBJECT_SCOPED_TRIGGERS = new Set([
          'OnClick', 'OnObjectClicked', 'OnObjectClicked3D', 'OnObjectReleased', 'OnInteract',
          'OnHealthDepleted', 'IsIdle', 'IsRunning', 'IsJumping', 'IsFalling', 'IsOnGround',
          'IsGrounded3D', 'Distance3DLessThan', 'IsMoving', 'IsClimbing', 'IsLookingLeft',
          'IsLookingRight', 'CompareObjectVariable', 'CompareStat', 'CompareObjectBooleanVariable',
          'OnAttack'
      ]);

      const ONE_SHOT_TRIGGERS = new Set([
          'OnStart', 'EveryXSeconds', 'OnClick', 'OnObjectClicked', 'OnObjectClicked3D',
          'OnObjectReleased', 'OnInteract', 'OnKeyPress', 'OnKeyRelease', 'OnAnyKeyPress',
          'OnAnyKeyRelease', 'OnAttack', 'OnTimerElapsed', 'OnDialogueEnd', 'OnButtonDown',
          'OnButtonUp', 'OnTriggerDown', 'OnTriggerUp', 'OnConsoleCommand', 'OnMatchFound',
          'OnPlayerJoined', 'OnPlayerLeft', 'OnReceiveNetworkMessage',
          'OnJoystickUp', 'OnJoystickDown', 'OnJoystickLeft', 'OnJoystickRight'
      ]);

      const pickedObjects: Record<string, GameObject[]> = {};
      let conditionsMet = true;
      const conds = event.conditions || [];
      const hasAlwaysCond = conds.some(c => c.trigger === 'Always' || (c.trigger as string) === 'OnUpdate');

      for (let i = 0; i < conds.length; i++) {
          const cond = conds[i];
          if (options.skipCondIndex !== undefined && i === options.skipCondIndex) continue;
          if (options.skipTrigger && cond.trigger === options.skipTrigger) continue;

          if (cond.trigger === 'OnCollisionWith' || cond.trigger === 'OnVerticalCollision' || cond.trigger === 'OnHorizontalCollision') {
              const objName = cond.object;
              const targetName = cond.target;
              const candidateObj1 = pickedObjects[objName] || objectMap.get(objName) || [];
              const candidateObj2 = (targetName ? (pickedObjects[targetName] || objectMap.get(targetName)) : undefined) || [];

              const validObj1: GameObject[] = [];
              const validObj2: GameObject[] = [];

              frameCollisions.current.forEach(c => {
                  if (cond.trigger !== 'OnCollisionWith' && c.type !== cond.trigger) return;
                  if (c.obj1Name === objName && c.obj2Name === targetName) {
                      const o1 = candidateObj1.find(o => o.id === c.obj1Id);
                      const o2 = candidateObj2.find(o => o.id === c.obj2Id);
                      if (o1 && o2) {
                          if (!validObj1.includes(o1)) validObj1.push(o1);
                          if (!validObj2.includes(o2)) validObj2.push(o2);
                      }
                  }
                  if (c.obj2Name === objName && c.obj1Name === targetName) {
                      const o1 = candidateObj1.find(o => o.id === c.obj2Id);
                      const o2 = candidateObj2.find(o => o.id === c.obj1Id);
                      if (o1 && o2) {
                          if (!validObj1.includes(o1)) validObj1.push(o1);
                          if (!validObj2.includes(o2)) validObj2.push(o2);
                      }
                  }
              });

              if (validObj1.length === 0 || validObj2.length === 0) {
                  conditionsMet = false;
                  break;
              }

              pickedObjects[objName] = validObj1;
              if (targetName) pickedObjects[targetName] = validObj2;
          } else if (OBJECT_SCOPED_TRIGGERS.has(cond.trigger)) {
              const objectName = cond.object;
              if (cond.trigger === 'Distance3DLessThan') {
                  const targetName = cond.target || cond.params?.targetObjectName;
                  const instances1 = pickedObjects[objectName] || objectMap.get(objectName) || [];
                  const instances2 = (targetName ? (pickedObjects[targetName] || objectMap.get(targetName)) : undefined) || [];
                  const valid1: GameObject[] = [];
                  const valid2: GameObject[] = [];
                  for (const o1 of instances1) {
                      for (const o2 of instances2) {
                          if (checkCondition(cond, o1, o2, hasAlwaysCond)) {
                              if (!valid1.includes(o1)) valid1.push(o1);
                              if (!valid2.includes(o2)) valid2.push(o2);
                          }
                      }
                  }
                  if (valid1.length === 0) {
                      conditionsMet = false;
                      break;
                  }
                  pickedObjects[objectName] = valid1;
                  if (targetName && valid2.length > 0) pickedObjects[targetName] = valid2;
              } else if (!objectName || objectName === 'System') {
                  if (!checkCondition(cond, undefined, undefined, hasAlwaysCond)) {
                      conditionsMet = false;
                      break;
                  }
              } else {
                  const instancesToCheck = pickedObjects[objectName] || objectMap.get(objectName) || [];
                  const validInstances = instancesToCheck.filter(inst => checkCondition(cond, inst, undefined, hasAlwaysCond));
                  if (validInstances.length === 0) {
                      conditionsMet = false;
                      break;
                  }
                  pickedObjects[objectName] = validInstances;
              }
          } else {
              if (!checkCondition(cond, undefined, undefined, hasAlwaysCond)) {
                  conditionsMet = false;
                  break;
              }
          }
      }

      if (conditionsMet) {
          const isEventTrigger = Boolean(options.forceOneShot) || (!hasAlwaysCond && conds.some(c => ONE_SHOT_TRIGGERS.has(c.trigger)));
          executeActionsSequential(event.actions, undefined, !isEventTrigger, deltaTime, false, pickedObjects, `event-${event.id}`);
      }
  };

  const evaluateEvents = (deltaTime: number = 0) => {
      const objectMap = new Map<string, GameObject[]>();
      gameObjectsRef.current.forEach(obj => {
          if (!objectMap.has(obj.name)) objectMap.set(obj.name, []);
          objectMap.get(obj.name)!.push(obj);
      });
      scene.events.forEach(event => {
        if (event.conditions.some(c => c.trigger === 'OnStart' || c.trigger === 'EveryXSeconds')) {
            return;
        }
        evaluateSingleEvent(event, deltaTime, { objectMap });
      });
  };

  // Mount & manage Three.js WebGL viewport when playing a 3D scene
  useEffect(() => {
    if (!is3DScene) return;
    const container = threeContainerRef.current;
    if (!container) return;

    const preloadUrls: (string | undefined)[] = [
      ...(scene.gameObjects || []).map(o => o.modelUrl),
      ...(gameObjectsRef.current || []).map(o => o.modelUrl),
      ...(assets || []).filter(a => a.type === '3d-model' || String(a.type) === 'model' || (a.url && (a.url.endsWith('.glb') || a.url.endsWith('.gltf')))).map(a => a.url),
      ...(projectData?.poseAnimations || []).flatMap(pa => (pa.frames || []).map(f => f.modelUrl)),
    ];
    preloadGLTFModels(preloadUrls);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    const isSoftwareGl = detectSoftwareWebGL(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1.5 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (!isSoftwareGl) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    const initW = container.clientWidth || initialGameWidth || 1024;
    const initH = container.clientHeight || initialGameHeight || 768;
    renderer.setSize(initW, initH);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    threeRendererRef.current = renderer;

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(runtimeBgColorRef.current || '#111827');
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    threeScene.environment = envTarget.texture;
    threeSceneRef.current = threeScene;

    const threeCamera = new THREE.PerspectiveCamera(50, initW / Math.max(1, initH), 0.1, 600);
    threeCamera.position.set(0, 7, 12);
    threeCamera.lookAt(0, 0, 0);
    threeCameraRef.current = threeCamera;

    const ambientLight = new THREE.AmbientLight(0xffffff, scene.ambientLightIntensity ?? 0.65);
    threeScene.add(ambientLight);
    threeAmbientLightRef.current = ambientLight;

    const sunLight = new THREE.DirectionalLight(0xffffff, scene.sunLightIntensity ?? 1.25);
    sunLight.position.set(18, 28, 16);
    if (!isSoftwareGl) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 1;
      sunLight.shadow.camera.far = 120;
      const d = 35;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
    }
    threeScene.add(sunLight);
    threeSunLightRef.current = sunLight;

    const grid = new THREE.GridHelper(120, 60, 0x475569, 0x1e293b);
    grid.position.y = -0.01;
    const gridMat = grid.material as THREE.Material | THREE.Material[];
    const applyGridMat = (m: THREE.Material) => {
      m.transparent = true;
      m.opacity = 0.28;
    };
    if (Array.isArray(gridMat)) gridMat.forEach(applyGridMat);
    else if (gridMat) applyGridMat(gridMat);
    threeScene.add(grid);

    const floorGeo = new THREE.PlaneGeometry(160, 160);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.25 });
    const floorReceiver = new THREE.Mesh(floorGeo, floorMat);
    floorReceiver.receiveShadow = true;
    floorReceiver.position.y = 0;
    threeScene.add(floorReceiver);

    const controls = new OrbitControls(threeCamera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enabled = (scene.camera3DMode || 'thirdPerson') === 'freeOrbit';
    threeControlsRef.current = controls;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(1, Math.floor(entry.contentRect.width));
      const h = Math.max(1, Math.floor(entry.contentRect.height));
      threeCamera.aspect = w / h;
      threeCamera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    resizeObserver.observe(container);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitPoint = new THREE.Vector3();

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerNdc.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    };

    const findGameObjFromHit = (object: THREE.Object3D | null): GameObject | undefined => {
      let cur: THREE.Object3D | null = object;
      while (cur) {
        if (cur.userData && cur.userData.gameObjectId !== undefined) {
          return gameObjectsRef.current.find(o => o.id === cur!.userData.gameObjectId);
        }
        cur = cur.parent;
      }
      return undefined;
    };

    const onPointerDown3D = (e: PointerEvent) => {
      initAudio();
      if (dialogue) {
        setDialogue(null);
        frameDialogueEnd.current = true;
        return;
      }
      updateNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, threeCamera);
      const groups: THREE.Object3D[] = [];
      threeMeshMapRef.current.forEach(({ group }) => {
        if (group.visible) groups.push(group);
      });
      const intersects = raycaster.intersectObjects(groups, true);
      if (intersects.length > 0) {
        const clickedObject = findGameObjFromHit(intersects[0].object);
        if (clickedObject) {
          const objectsById = new Map<number, GameObject>(gameObjectsRef.current.map(o => [o.id, o]));
          const chain: GameObject[] = [];
          let curr: GameObject | undefined = clickedObject;
          let safety = 100;
          while (curr && safety-- > 0) {
            chain.push(curr);
            if (!curr.parentId) break;
            curr = objectsById.get(curr.parentId);
          }
          chain.forEach(o => {
            frameClicks.current.push({ name: o.name, id: o.id });
            o.scripts?.forEach(script => {
              if (script.trigger === 'OnClick') {
                const scriptId = script.id || script.trigger;
                executeActionsSequential(script.actions, o, false, 0, false, undefined, `obj-${o.id}-script-${scriptId}`);
              }
            });
          });
          pointerDownObjectRef.current = { id: clickedObject.id, name: clickedObject.name };

          if (clickedObject.isDraggable) {
            const p3 = getObject3DPosition(clickedObject);
            dragPlane.set(new THREE.Vector3(0, 1, 0), -p3.y);
            if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
              if (controls) controls.enabled = false;
              draggingRef.current = {
                id: clickedObject.id,
                offsetX: p3.x - hitPoint.x,
                offsetY: p3.z - hitPoint.z,
                initialX: clickedObject.x,
                initialY: clickedObject.y,
                planeY: p3.y,
              } as any;
            }
          }
        }
      }
      const resolveCam3DModeNow = () => {
        if (camera3DRuntimeRef.current.mode) return camera3DRuntimeRef.current.mode;
        const fObj = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera3D'));
        const fBeh = fObj?.behaviors?.find(b => b.name === 'FollowCamera3D');
        return fBeh?.properties?.mode || scene.camera3DMode || 'thirdPerson';
      };

      if (!draggingRef.current && resolveCam3DModeNow() !== 'freeOrbit') {
        isCameraOrbitingRef.current = true;
        lastOrbitPointerRef.current = { x: e.clientX, y: e.clientY };
        activePointers3DRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch {}
        if (activePointers3DRef.current.size === 2) {
          const pts = Array.from(activePointers3DRef.current.values());
          pinchInitialDistanceRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchInitialOrbitDistanceRef.current = orbitDistanceRef.current;
        }
      }
    };

    const onPointerMove3D = (e: PointerEvent) => {
      const dragInfo = draggingRef.current as any;
      if (dragInfo && dragInfo.planeY !== undefined) {
        const obj = gameObjectsRef.current.find(o => o.id === dragInfo.id);
        if (!obj) return;
        updateNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, threeCamera);
        dragPlane.set(new THREE.Vector3(0, 1, 0), -dragInfo.planeY);
        if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
          const pos = getObject3DPosition(obj);
          if (!obj.dragXLocked) pos.x = hitPoint.x + dragInfo.offsetX;
          if (!obj.dragYLocked) pos.z = hitPoint.z + dragInfo.offsetY;
          obj.position3D = pos;
          obj.vx3D = 0;
          obj.vz3D = 0;
          sync3DTo2D(obj);
        }
        return;
      }
      const fObjMove = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera3D'));
      const fBehMove = fObjMove?.behaviors?.find(b => b.name === 'FollowCamera3D');
      const activeModeMove = camera3DRuntimeRef.current.mode || fBehMove?.properties?.mode || scene.camera3DMode || 'thirdPerson';
      if (isCameraOrbitingRef.current && activeModeMove !== 'freeOrbit') {
        activePointers3DRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers3DRef.current.size >= 2 && pinchInitialDistanceRef.current && pinchInitialOrbitDistanceRef.current) {
          const pts = Array.from(activePointers3DRef.current.values());
          const curP = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          if (curP > 10) {
            const ratio = curP / pinchInitialDistanceRef.current;
            orbitDistanceRef.current = Math.max(2.5, Math.min(35, pinchInitialOrbitDistanceRef.current / ratio));
          }
        } else {
          const dx = e.clientX - lastOrbitPointerRef.current.x;
          const dy = e.clientY - lastOrbitPointerRef.current.y;
          lastOrbitPointerRef.current = { x: e.clientX, y: e.clientY };
          orbitYawRef.current -= dx * 0.006;
          if (activeModeMove === 'firstPerson') {
            // Drag/slide UP (dy < 0) tilts look UP; drag/slide DOWN (dy > 0) tilts look DOWN
            orbitFirstPersonPitchRef.current = Math.max(-1.35, Math.min(1.35, orbitFirstPersonPitchRef.current - dy * 0.005));
          } else {
            // Drag/slide UP (dy < 0) lowers camera pitch so view tilts UP; drag/slide DOWN (dy > 0) raises camera pitch so view tilts DOWN
            orbitPitchRef.current = Math.max(-0.35, Math.min(1.45, orbitPitchRef.current + dy * 0.005));
          }
        }
      }
    };

    const onPointerUp3D = (e: PointerEvent) => {
      try { if (e && e.pointerId !== undefined) renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
      if (e && e.pointerId !== undefined) {
        activePointers3DRef.current.delete(e.pointerId);
      }
      if (activePointers3DRef.current.size < 2) {
        pinchInitialDistanceRef.current = null;
        pinchInitialOrbitDistanceRef.current = null;
        if (activePointers3DRef.current.size === 1) {
          const remaining = Array.from(activePointers3DRef.current.values())[0];
          lastOrbitPointerRef.current = { x: remaining.x, y: remaining.y };
        }
      }
      if (activePointers3DRef.current.size === 0) {
        isCameraOrbitingRef.current = false;
      }
      const releasedList: { id: number; name: string }[] = [];
      if (draggingRef.current) {
        const draggedObj = gameObjectsRef.current.find(o => o.id === draggingRef.current!.id);
        if (draggedObj) {
          releasedList.push({ id: draggedObj.id, name: draggedObj.name });
          draggedObj.vx = 0;
          draggedObj.vy = 0;
          draggedObj.vx3D = 0;
          draggedObj.vz3D = 0;
          if (draggedObj.dragDropBehavior === 'return' && draggingRef.current.initialX !== undefined) {
            draggedObj.x = draggingRef.current.initialX;
            draggedObj.y = draggingRef.current.initialY;
            const pos = getObject3DPosition(draggedObj);
            pos.x = draggedObj.x / 50;
            pos.z = draggedObj.y / 50;
            draggedObj.position3D = pos;
          }
        }
      }
      if (pointerDownObjectRef.current && !releasedList.some(r => r.id === pointerDownObjectRef.current!.id)) {
        releasedList.push(pointerDownObjectRef.current);
      }
      releasedList.forEach(rel => {
        frameObjectReleases.current.push(rel);
        const obj = gameObjectsRef.current.find(o => o.id === rel.id);
        obj?.scripts?.forEach(script => {
          if (script.trigger === 'OnObjectReleased') {
            const scriptId = script.id || script.trigger;
            executeActionsSequential(script.actions, obj, false, 0, false, undefined, `obj-${obj.id}-script-${scriptId}`);
          }
        });
      });
      draggingRef.current = null;
      pointerDownObjectRef.current = null;
      if (controls) {
        const fObjUp = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera3D'));
        const fBehUp = fObjUp?.behaviors?.find(b => b.name === 'FollowCamera3D');
        const modeUp = camera3DRuntimeRef.current.mode || fBehUp?.properties?.mode || scene.camera3DMode || 'thirdPerson';
        controls.enabled = modeUp === 'freeOrbit';
      }
    };

    const onWheel3D = (e: WheelEvent) => {
      const fObjW = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera3D'));
      const fBehW = fObjW?.behaviors?.find(b => b.name === 'FollowCamera3D');
      const modeW = camera3DRuntimeRef.current.mode || fBehW?.properties?.mode || scene.camera3DMode || 'thirdPerson';
      if (modeW !== 'freeOrbit') {
        e.preventDefault();
        orbitDistanceRef.current = Math.max(2.5, Math.min(35, orbitDistanceRef.current + e.deltaY * 0.008));
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown3D);
    renderer.domElement.addEventListener('pointermove', onPointerMove3D);
    renderer.domElement.addEventListener('pointerup', onPointerUp3D);
    renderer.domElement.addEventListener('pointercancel', onPointerUp3D);
    renderer.domElement.addEventListener('wheel', onWheel3D, { passive: false });

    return () => {
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown3D);
      renderer.domElement.removeEventListener('pointermove', onPointerMove3D);
      renderer.domElement.removeEventListener('pointerup', onPointerUp3D);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp3D);
      renderer.domElement.removeEventListener('wheel', onWheel3D);
      threeMeshMapRef.current.forEach(({ group }) => {
        threeScene.remove(group);
        disposeObject3D(group);
      });
      threeMeshMapRef.current.clear();
      if (threeSkyboxTextureRef.current) {
        threeSkyboxTextureRef.current.dispose();
        threeSkyboxTextureRef.current = null;
      }
      threeSkyboxUrlRef.current = '';
      floorGeo.dispose();
      floorMat.dispose();
      if (grid.geometry) grid.geometry.dispose();
      if (Array.isArray(grid.material)) grid.material.forEach(m => m.dispose());
      else if (grid.material) (grid.material as THREE.Material).dispose();
      envTarget.dispose();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      threeRendererRef.current = null;
      threeSceneRef.current = null;
      threeCameraRef.current = null;
      threeControlsRef.current = null;
      threeAmbientLightRef.current = null;
      threeSunLightRef.current = null;
    };
  }, [is3DScene, scene.id]);

  useEffect(() => {
    resetAllInputs(true);
    setRuntimeBackgroundColor(scene.backgroundColor);
    camera.current.zoom = scene.defaultZoom || 1;
    camera.current.x = (initialGameWidth || 1024) / 2;
    camera.current.y = (initialGameHeight || 768) / 2;
    const initialOff = scene?.camera3DOffset ? { ...scene.camera3DOffset } : { x: 0, y: 5, z: 9 };
    const initDist = Math.hypot(initialOff.x || 0, initialOff.z || 9);
    orbitDistanceRef.current = Math.max(2.5, Math.min(35, initDist || 9));
    orbitYawRef.current = Math.atan2(initialOff.x || 0, initialOff.z || 9);
    orbitPitchRef.current = Math.max(-0.35, Math.min(1.45, Math.atan2(initialOff.y ?? 5, Math.max(0.1, initDist || 9))));
    orbitFirstPersonPitchRef.current = 0;
    camera3DRuntimeRef.current = {
      mode: scene?.camera3DMode || '',
      offset: initialOff,
      fogEnabled: scene?.fogEnabled ?? false,
      fogColor: scene?.fogColor || scene?.backgroundColor || '#111827',
      fogDensity: scene?.fogDensity ?? 0.02,
      skyboxImageUrl: scene?.skyboxImageUrl || '',
    };
    
    let loadedFromPending = false;
    try {
        let pendingSlot: string | null = null;
        try {
            pendingSlot = localStorage.getItem('return-2d-pending-load-slot');
            if (pendingSlot) localStorage.removeItem('return-2d-pending-load-slot');
        } catch (e) {}
        if (!pendingSlot && memorySaveSlots.has('return-2d-pending-load-slot')) {
            pendingSlot = memorySaveSlots.get('return-2d-pending-load-slot') || null;
            memorySaveSlots.delete('return-2d-pending-load-slot');
        }
        if (pendingSlot) {
            let savedStateJSON: string | null = null;
            try {
                savedStateJSON = localStorage.getItem('return-2d-save-slot-' + pendingSlot);
            } catch (e) {}
            if (!savedStateJSON && memorySaveSlots.has('return-2d-save-slot-' + pendingSlot)) {
                savedStateJSON = memorySaveSlots.get('return-2d-save-slot-' + pendingSlot) || null;
            }
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                const matchesScene = savedState.sceneName === scene.name || savedState.sceneName === scene.id || (!savedState.sceneName);
                if (matchesScene) {
                    gameObjectsRef.current = sanitizeLoadedGameObjects(savedState.gameObjects || [], is3DModeRef.current);
                    gameVariables.current = (savedState.gameVariables && typeof savedState.gameVariables === 'object')
                        ? JSON.parse(JSON.stringify(savedState.gameVariables))
                        : {};
                    if (savedState.backgroundColor) {
                        setRuntimeBackgroundColor(savedState.backgroundColor);
                    }
                    if (savedState.camera && typeof savedState.camera === 'object') {
                        camera.current = { ...camera.current, ...savedState.camera };
                    }
                    if (savedState.camera3DRuntime && camera3DRuntimeRef.current) {
                        Object.assign(camera3DRuntimeRef.current, savedState.camera3DRuntime);
                        if (typeof savedState.camera3DRuntime.yaw === 'number') orbitYawRef.current = savedState.camera3DRuntime.yaw;
                        if (typeof savedState.camera3DRuntime.pitch === 'number') orbitPitchRef.current = savedState.camera3DRuntime.pitch;
                        if (typeof savedState.camera3DRuntime.fpPitch === 'number') orbitFirstPersonPitchRef.current = savedState.camera3DRuntime.fpPitch;
                        if (typeof savedState.camera3DRuntime.distance === 'number') orbitDistanceRef.current = savedState.camera3DRuntime.distance;
                    }
                    if (savedState.selectedPlayerId !== undefined) {
                        setSelectedPlayerId(savedState.selectedPlayerId);
                    }
                    if (savedState.joystickEnabled !== undefined) {
                        setJoystickRuntimeEnabled(savedState.joystickEnabled);
                    }
                    activePoseAnimationsRef.current.clear();
                    if (savedState.activePoseAnimations && Array.isArray(savedState.activePoseAnimations)) {
                        const now = performance.now();
                        savedState.activePoseAnimations.forEach((item: any) => {
                            if (item && item.id && item.poseAnimation) {
                                activePoseAnimationsRef.current.set(item.id, {
                                    poseAnimation: item.poseAnimation,
                                    startTime: now - (item.elapsedMs || 0),
                                    loop: item.loop !== false,
                                    speed: item.speed || 1,
                                    origVisual: undefined
                                });
                            }
                        });
                    }
                    loadedFromPending = true;
                    console.log('Restored pending game state from slot ' + pendingSlot);
                }
            }
        }
    } catch (e) {
        console.error('Error loading pending game state:', e);
    }

    if (!loadedFromPending) {
        if (initialState) {
            gameObjectsRef.current = sanitizeLoadedGameObjects(initialState.gameObjects || [], is3DModeRef.current);
            gameVariables.current = JSON.parse(JSON.stringify(initialState.gameVariables || {}));
        } else {
            gameObjectsRef.current = JSON.parse(JSON.stringify(scene.gameObjects.map(o => {
                const hasHealthB = o.behaviors?.some(b => b.name === 'Health');
                const bossB = o.behaviors?.find(b => b.name === 'Boss' || b.name === 'Boss3D');
                let stats = o.stats;
                if (!stats) {
                    if (bossB) {
                        const hp = Number(bossB.properties?.hp !== undefined ? bossB.properties.hp : 500);
                        const maxHp = Number(bossB.properties?.maxHp !== undefined ? bossB.properties.maxHp : 500);
                        stats = { hp, maxHp, attack: 15 };
                    } else if (hasHealthB) {
                        stats = { hp: 100, maxHp: 100, attack: 10 };
                    }
                }
                const initialized: GameObject = {
                    ...o,
                    vx: 0, vy: 0, grounded: false,
                    vx3D: 0, vy3D: 0, vz3D: 0, grounded3D: false,
                    pendingMovements: [],
                    tweens: [],
                    stats
                };
                delete (initialized as any)._customVx;
                delete (initialized as any)._customVy;
                delete (initialized as any).rpgKnockbackVx;
                delete (initialized as any).rpgKnockbackVy;
                if (is3DModeRef.current && !initialized.isUI) {
                    initialized.position3D = getObject3DPosition(initialized);
                    const dInit = getObject3DDimensions(initialized);
                    initialized.scale3D = { x: dInit.w, y: dInit.h, z: dInit.d };
                    initialized.rotation3D = getObject3DRotation(initialized);
                    sync3DTo2D(initialized);
                }
                return initialized;
            })));
            
            const initialVars: Record<string, string | number | boolean> = {};
            globalVariables.forEach(v => { initialVars[v.name] = v.value; });
            // Only initialize variables if they haven't been set yet (to allow persistence across scenes)
            if (Object.keys(gameVariables.current).length === 0) {
                gameVariables.current = initialVars;
            } else {
                // Ensure any NEW global variables are added, but keep existing values
                globalVariables.forEach(v => {
                    if (gameVariables.current[v.name] === undefined) {
                        gameVariables.current[v.name] = v.value;
                    }
                });
            }
        }
        activePoseAnimationsRef.current.clear();
    }
    
    activeAnimations.current.clear();
    timersRef.current.clear();
    intervalsRef.current.clear();
    activeSequencesRef.current.clear();
    sequenceStatesRef.current.clear();
    setDialogue(null);

    if (backgroundMusicPlayer.current) {
        backgroundMusicPlayer.current.pause();
        backgroundMusicPlayer.current = null;
        currentBackgroundMusicId.current = null;
    }
    if (scene.backgroundMusicId) {
        const musicAsset = assets.find(a => String(a.id) === String(scene.backgroundMusicId) || a.url === scene.backgroundMusicId || a.name === scene.backgroundMusicId);
        const musicUrl = musicAsset ? musicAsset.url : scene.backgroundMusicId;
        if (musicUrl) {
            currentBackgroundMusicId.current = musicAsset ? musicAsset.id : scene.backgroundMusicId;
            let cachedAudio = audioCache.current.get(musicUrl);
            if (!cachedAudio) {
                cachedAudio = new Audio(musicUrl);
                audioCache.current.set(musicUrl, cachedAudio);
            }
            if (cachedAudio) {
                const audio = cachedAudio.cloneNode() as HTMLAudioElement;
                audio.loop = true;
                backgroundMusicPlayer.current = audio;
                const playPromise = audio.play();
                if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((e) => {
                        console.warn("Autoplay blocked background music. Registering gesture fallback...", e);
                        const playOnGesture = () => {
                            if (backgroundMusicPlayer.current) {
                                backgroundMusicPlayer.current.play().catch(() => {});
                            }
                            window.removeEventListener('pointerdown', playOnGesture);
                            window.removeEventListener('click', playOnGesture);
                            window.removeEventListener('keydown', playOnGesture);
                            window.removeEventListener('touchstart', playOnGesture);
                        };
                        window.addEventListener('pointerdown', playOnGesture, { once: true });
                        window.addEventListener('click', playOnGesture, { once: true });
                        window.addEventListener('keydown', playOnGesture, { once: true });
                        window.addEventListener('touchstart', playOnGesture, { once: true });
                    });
                }
            }
        }
    }

    const handleKeyDown = (e: KeyboardEvent) => { 
        if (e.key === 'Tab') {
            e.preventDefault();
            setConsoleOpen(prev => !prev);
            return;
        }
        if (consoleOpen) return;
        const key = e.key.toLowerCase();
        const code = e.code.toLowerCase();
        if (suppressedKeysUntilReleaseRef.current.has(key) || suppressedKeysUntilReleaseRef.current.has(code)) {
            if (e.repeat) return;
            suppressedKeysUntilReleaseRef.current.delete(key);
            suppressedKeysUntilReleaseRef.current.delete(code);
        } else if (e.repeat && !keysPressed.current[key] && !keysPressed.current[code]) {
            return;
        }
        if (key === 'e' && activeInteractableRef.current) {
            frameInteractions.current.push({
                id: activeInteractableRef.current.id,
                name: activeInteractableRef.current.name
            });
        }
        if (!keysPressed.current[key] && !keysPressed.current[code]) {
            frameKeyPresses.current.push(key);
            frameKeyPresses.current.push(code);
        }
        keysPressed.current[code] = true; 
        keysPressed.current[key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => { 
        const code = e.code.toLowerCase();
        const key = e.key.toLowerCase();
        suppressedKeysUntilReleaseRef.current.delete(key);
        suppressedKeysUntilReleaseRef.current.delete(code);
        keysPressed.current[code] = false; 
        keysPressed.current[key] = false;
        frameKeyReleases.current.push(key);
        frameKeyReleases.current.push(code);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const getActivePlayerNumber = () => {
        const controllablePlayers = gameObjectsRef.current.filter(obj => 
            !obj.isUI && obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement' || b.name === 'Player3D')
        );
        const currentControlledId = selectedPlayerIdRef.current !== null && controllablePlayers.some(p => p.id === selectedPlayerIdRef.current)
            ? selectedPlayerIdRef.current
            : controllablePlayers[0]?.id;
            
        if (!currentControlledId) return 1;
        return 1;
    };

    const getPlayerActions = (pNum: number) => {
        const act = {
            moveLeft: false,
            moveRight: false,
            moveUp: false,
            moveDown: false,
            jump: false,
            jumpAction: false,
            attack: false,
            attackAction: false,
            run: false,
            moveHorizontalIntensity: 0
        };

        if (pNum === 1) {
            act.moveLeft = actionsPressed.current.moveLeft || keysPressed.current['keya'] || keysPressed.current['arrowleft'];
            act.moveRight = actionsPressed.current.moveRight || keysPressed.current['keyd'] || keysPressed.current['arrowright'];
            act.moveUp = actionsPressed.current.moveUp || keysPressed.current['keyw'] || keysPressed.current['arrowup'];
            act.moveDown = actionsPressed.current.moveDown || keysPressed.current['keys'] || keysPressed.current['arrowdown'];
            act.jump = actionsPressed.current.jump || keysPressed.current['space'];
            act.jumpAction = actionsPressed.current.jumpAction;
            act.attack = actionsPressed.current.attack || keysPressed.current['keyx'] || keysPressed.current['keyf'];
            act.attackAction = actionsPressed.current.attackAction;
            act.run = actionsPressed.current.run || keysPressed.current['shift'] || keysPressed.current['shiftleft'];
            act.moveHorizontalIntensity = actionsPressed.current.moveHorizontalIntensity;

            if (act.moveHorizontalIntensity === 0) {
                if (keysPressed.current['arrowleft'] || keysPressed.current['keya']) act.moveHorizontalIntensity -= 1;
                if (keysPressed.current['arrowright'] || keysPressed.current['keyd']) act.moveHorizontalIntensity += 1;
            }
        }

        if (!playerPressStates.current) {
            playerPressStates.current = {};
        }
        if (!playerPressStates.current[pNum]) {
            playerPressStates.current[pNum] = { jumpPressed: false, attackPressed: false };
        }

        const state = playerPressStates.current[pNum];
        if (act.jump) {
            if (!state.jumpPressed) {
                act.jumpAction = true;
                state.jumpPressed = true;
            } else {
                act.jumpAction = false;
            }
        } else {
            state.jumpPressed = false;
            act.jumpAction = false;
        }

        if (act.attack) {
            if (!state.attackPressed) {
                act.attackAction = true;
                state.attackPressed = true;
            } else {
                act.attackAction = false;
            }
        } else {
            state.attackPressed = false;
            act.attackAction = false;
        }

        act.moveHorizontalIntensity = Math.max(-1, Math.min(1, act.moveHorizontalIntensity));
        
        return act;
    };;

    let lastTime = 0;
    let lastFrameTime = 0;
    let animationFrameId: number;

    const gameLoop = (timestamp: number) => {
      // Filter out behaviors that are disabled
      gameObjectsRef.current.forEach(obj => {
          if (obj.behaviors) {
              if (!obj._originalBehaviors) {
                  obj._originalBehaviors = [...obj.behaviors];
              }
              obj.behaviors = obj._originalBehaviors.filter(b => (b as any).disabled !== true);
          }
      });

      const now = performance.now();
      if (lastTime === 0) {
        lastTime = now;
        lastFrameTime = now;
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
      }
      
      const targetFps = projectData?.fps || 60;
      const fpsInterval = 1000 / targetFps;
      const elapsed = now - lastFrameTime;
      if (elapsed < fpsInterval) {
          animationFrameId = requestAnimationFrame(gameLoop);
          return;
        }

      const deltaTime = Math.min(0.1, elapsed / 1000.0);
      lastTime = now;
      lastFrameTime = now - (elapsed % fpsInterval);
      sequenceFrameRef.current += 1;

      const resolve3DSolidsForObject = (
          obj: GameObject,
          dt: number,
          moveVelX: number,
          moveVelY: number,
          moveVelZ: number,
          isPlayerControlled: boolean,
          hasGravity3D: boolean
      ) => {
          if (!obj.position3D) obj.position3D = getObject3DPosition(obj);
          const solids3D = gameObjectsRef.current.filter(s => s.id !== obj.id && isSolidObject3D(s));
          const nowPhysics = performance.now();
          const activePoseForObj = activePoseAnimationsRef.current.get(obj.id);
          const boss3DBehav = obj.behaviors?.find(b => b.name === 'Boss3D' || b.name === 'Boss');
          const useStableYawXZ = isPlayerControlled || !!boss3DBehav || inferShape3D(obj) === 'character';
          const bObj = getEffectiveObject3DBounds(obj, activePoseForObj, nowPhysics, { stableYawXZ: useStableYawXZ });
          const poseOffX = bObj.centerX - obj.position3D.x;
          const poseOffY = bObj.minY - obj.position3D.y;
          const poseOffZ = bObj.centerZ - obj.position3D.z;
          const prevPoseOffY = typeof (obj as any)._prevPoseOffY === 'number' ? (obj as any)._prevPoseOffY : poseOffY;
          const poseShiftY = Math.abs(poseOffY - prevPoseOffY);
          const wasGrounded3D = Boolean(obj.grounded3D);
          const horizSpeed = Math.hypot(moveVelX, moveVelZ);

          // 0. Carry with standing moving platform & lift above rising solids before XZ sweeps
          const standingPlatId3D = (obj as any)._standingPlatformId3D;
          if (standingPlatId3D && moveVelY <= 0.15) {
              const plat3D = solids3D.find(s => s.id === standingPlatId3D);
              if (plat3D) {
                  const isStickyPlat = !(plat3D.behaviors?.some(b => (b.name === 'Oscillate3D' || b.name === 'Oscillate' || b.name === 'Patrol3D' || b.name === 'Patrol') && b.properties?.sticky === false));
                  if (isStickyPlat) {
                      obj.position3D.x += (plat3D as any)._platformDx3D || 0;
                      obj.position3D.z += (plat3D as any)._platformDz3D || 0;
                      obj.position3D.y += (plat3D as any)._platformDy3D || 0;
                  }
              }
          }
          if (moveVelY <= 0.15) {
              const bNowCarry = getEffectiveObject3DBounds(obj, activePoseForObj, nowPhysics, { stableYawXZ: useStableYawXZ });
              for (const s of solids3D) {
                  const pDy = (s as any)._platformDy3D || 0;
                  if (pDy > 0.0001) {
                      const bSolid = getEffectiveObject3DBounds(s, activePoseAnimationsRef.current.get(s.id), nowPhysics);
                      const walkY = getWalkableSurface3D(bNowCarry.centerX, bNowCarry.centerZ, bNowCarry.hx, bNowCarry.hz, bSolid);
                      if (walkY !== null) {
                          const prevTop = walkY - pDy;
                          const colMinYR = bNowCarry.minY;
                          if (colMinYR >= prevTop - 0.18 && colMinYR < walkY) {
                              obj.position3D.y = walkY - poseOffY;
                              obj.vy3D = 0;
                              obj.grounded3D = true;
                              obj.grounded = true;
                              (obj as any)._standingPlatformId3D = s.id;
                          }
                      }
                  }
              }
          }

          // 1. Horizontal XZ Sweep & OBB/Ramp Resolution (supports rotated walls & all ramp rotations!)
          obj.position3D.x += moveVelX * dt;
          obj.position3D.z += moveVelZ * dt;

          for (const s of solids3D) {
              const bSolid = getEffectiveObject3DBounds(s, activePoseAnimationsRef.current.get(s.id), nowPhysics);
              const bCurr = getEffectiveObject3DBounds(obj, activePoseForObj, nowPhysics, { stableYawXZ: useStableYawXZ });

              const walkY = getWalkableSurface3D(bCurr.centerX, bCurr.centerZ, bCurr.hx, bCurr.hz, bSolid);
              if (walkY !== null && moveVelY <= 0.15) {
                  const stepUpTol = (bSolid.shape3D === 'ramp'
                      ? Math.max(0.45, horizSpeed * dt + 0.25)
                      : Math.max(0.18, Math.max(0, (s as any)._platformDy3D || 0) + 0.14)) + (wasGrounded3D ? poseShiftY : 0);
                  const snapDownTol = wasGrounded3D
                      ? Math.max(0.32, horizSpeed * dt * 1.8 + 0.12) + poseShiftY
                      : 0.14;
                  if (bCurr.minY >= walkY - stepUpTol && bCurr.minY <= walkY + snapDownTol) {
                      obj.position3D.y = walkY - poseOffY;
                      obj.vy3D = Math.min(0, obj.vy3D || 0);
                      obj.grounded3D = true;
                      obj.grounded = true;
                      (obj as any)._standingPlatformId3D = s.id;
                      continue;
                  }
              }

              const mtv = solveOBBCollision3D(bCurr, bSolid, 0);
              if (!mtv || mtv.depth <= 1e-4) continue;

              // If overlap is mostly lifting up onto top surface and moving object isn't rising fast
              if (mtv.y > 0.55 * mtv.depth && moveVelY <= 0.15 && walkY !== null && bCurr.minY >= walkY - 0.25) {
                  obj.position3D.y = walkY - poseOffY;
                  obj.vy3D = Math.min(0, obj.vy3D || 0);
                  obj.grounded3D = true;
                  obj.grounded = true;
                  (obj as any)._standingPlatformId3D = s.id;
                  continue;
              }

              const horizMag = Math.hypot(mtv.x, mtv.z);
              if (horizMag > 1e-4 && Math.abs(mtv.y) <= 0.72 * mtv.depth) {
                  obj.position3D.x += mtv.x;
                  obj.position3D.z += mtv.z;
                  frameCollisions.current.push({ obj1Name: obj.name, obj2Name: s.name, type: 'OnHorizontalCollision', obj1Id: obj.id, obj2Id: s.id });

                  const nx = mtv.x / horizMag;
                  const nz = mtv.z / horizMag;
                  if (!isPlayerControlled) {
                      const vx = obj.vx3D || 0;
                      const vz = obj.vz3D || 0;
                      const vn = vx * nx + vz * nz;
                      if (vn < 0) {
                          obj.vx3D = Math.abs(nx) > 0.9 ? 0 : vx - vn * nx;
                          obj.vz3D = Math.abs(nz) > 0.9 ? 0 : vz - vn * nz;
                      }
                  }
                  const burst = (obj as any)._burstImpulse3D;
                  if (burst) {
                      const bn = (burst.x || 0) * nx + (burst.z || 0) * nz;
                      if (bn < 0) {
                          burst.x -= bn * nx;
                          burst.z -= bn * nz;
                          if (Math.abs(burst.x) < 1e-3) burst.x = 0;
                          if (Math.abs(burst.z) < 1e-3) burst.z = 0;
                      }
                  }
              } else {
                  if (mtv.y > 0 && moveVelY > 0.15) {
                      obj.position3D.y += mtv.y;
                  } else {
                      obj.position3D.y += mtv.y;
                      frameCollisions.current.push({ obj1Name: obj.name, obj2Name: s.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: s.id });
                      if (mtv.y > 0) {
                          obj.vy3D = Math.min(0, obj.vy3D || 0);
                          obj.grounded3D = true;
                          obj.grounded = true;
                          (obj as any)._standingPlatformId3D = s.id;
                      } else if (mtv.y < 0 && (obj.vy3D || 0) > 0) {
                          obj.vy3D = 0;
                          if ((obj as any)._burstImpulse3D) (obj as any)._burstImpulse3D.y = 0;
                      }
                  }
              }
          }

          // 2. Vertical Y Axis (Gravity + Loop/Burst Y + Ramp Descent Snap + Ceiling)
          if (hasGravity3D || moveVelY !== 0) {
              obj.grounded3D = false;
              obj.grounded = false;
              (obj as any)._standingPlatformId3D = null;
              obj.position3D.y += moveVelY * dt;

              for (const s of solids3D) {
                  const bSolid = getEffectiveObject3DBounds(s, activePoseAnimationsRef.current.get(s.id), nowPhysics);
                  const bCurr = getEffectiveObject3DBounds(obj, activePoseForObj, nowPhysics, { stableYawXZ: useStableYawXZ });

                  const walkY = getWalkableSurface3D(bCurr.centerX, bCurr.centerZ, bCurr.hx, bCurr.hz, bSolid);
                  const downSnap = wasGrounded3D
                      ? Math.max(0.32, horizSpeed * dt * 1.8 + 0.14) + poseShiftY
                      : Math.max(0.16, Math.abs(moveVelY) * dt + 0.08);
                  const upTol = Math.max(0.4, Math.abs(moveVelY) * dt + 0.2) + (wasGrounded3D ? poseShiftY : 0);

                  if (walkY !== null && moveVelY <= 0.15 && bCurr.minY <= walkY + downSnap && bCurr.minY >= walkY - upTol) {
                      frameCollisions.current.push({ obj1Name: obj.name, obj2Name: s.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: s.id });
                      obj.position3D.y = walkY - poseOffY;
                      obj.vy3D = 0;
                      if ((obj as any)._burstImpulse3D) (obj as any)._burstImpulse3D.y = 0;
                      obj.grounded3D = true;
                      obj.grounded = true;
                      obj.doubleJumped = false;
                      (obj as any)._standingPlatformId3D = s.id;
                      continue;
                  }

                  const mtv = solveOBBCollision3D(bCurr, bSolid, 0);
                  if (mtv && mtv.depth > 1e-4) {
                      if (mtv.y > 0.35 * mtv.depth && moveVelY <= 0.15) {
                          frameCollisions.current.push({ obj1Name: obj.name, obj2Name: s.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: s.id });
                          obj.position3D.y += mtv.y;
                          obj.vy3D = 0;
                          if ((obj as any)._burstImpulse3D) (obj as any)._burstImpulse3D.y = 0;
                          obj.grounded3D = true;
                          obj.grounded = true;
                          obj.doubleJumped = false;
                          (obj as any)._standingPlatformId3D = s.id;
                      } else if (mtv.y < -0.35 * mtv.depth && moveVelY > 0) {
                          frameCollisions.current.push({ obj1Name: obj.name, obj2Name: s.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: s.id });
                          obj.position3D.y += mtv.y;
                          obj.vy3D = 0;
                          if ((obj as any)._burstImpulse3D) (obj as any)._burstImpulse3D.y = 0;
                      } else if (Math.hypot(mtv.x, mtv.z) > 1e-4) {
                          obj.position3D.x += mtv.x;
                          obj.position3D.z += mtv.z;
                      }
                  }
              }

              if ((hasGravity3D || moveVelY < 0) && moveVelY <= 0.15 && (obj.position3D.y + poseOffY) <= 0) {
                  obj.position3D.y = -poseOffY;
                  obj.vy3D = 0;
                  if ((obj as any)._burstImpulse3D) (obj as any)._burstImpulse3D.y = 0;
                  obj.grounded3D = true;
                  obj.grounded = true;
                  obj.doubleJumped = false;
              }
          }
          (obj as any)._prevPoseOffY = poseOffY;
          if ((obj as any)._effectiveVel3D && obj.grounded3D) {
              (obj as any)._effectiveVel3D.y = obj.vy3D || 0;
          }
      };

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Process timers and intervals
      timersRef.current.forEach((timer, name) => {
          if (now >= timer.startTime + timer.duration) {
              frameTimerEvents.current.push(name);
              timersRef.current.delete(name);
          }
      });
      scene.events.forEach((event, eventIndex) => {
          event.conditions.forEach((cond, condIndex) => {
              if (cond.trigger === 'EveryXSeconds') {
                  const intervalSec = parseNumericValue(cond.params?.interval);
                  if (intervalSec === null || intervalSec <= 0) return;
                  const key = `evt-${event.id || eventIndex}-cond-${condIndex}`;
                  const intervalData = intervalsRef.current.get(key);
                  const intervalMs = intervalSec * 1000;
                  if (!intervalData) {
                      intervalsRef.current.set(key, { interval: intervalMs, lastTriggerTime: now });
                  } else if (now >= intervalData.lastTriggerTime + intervalData.interval) {
                      evaluateSingleEvent(event, 0, { skipCondIndex: condIndex, forceOneShot: true });
                      intervalData.lastTriggerTime = now;
                  }
              }
          });
      });

      const controllablePlayers = gameObjectsRef.current.filter(obj => 
          !obj.isUI && obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement' || b.name === 'Player3D')
      );
      
      const currentControlledId = selectedPlayerIdRef.current !== null && controllablePlayers.some(p => p.id === selectedPlayerIdRef.current)
          ? selectedPlayerIdRef.current
          : controllablePlayers[0]?.id;

      const objectsById = new Map<number, GameObject>(gameObjectsRef.current.map(o => [o.id, o]));

      // Pre-update 2D Solid platforms before building staticCollisionShapes so moving platforms never lag 1 frame or throw players sideways
      if (!is3DModeRef.current) {
          const now2DPre = performance.now();
          gameObjectsRef.current.forEach(s => {
              if (s.isUI || !s.behaviors?.some(b => b.name === 'Solid')) return;
              if (draggingRef.current && draggingRef.current.id === s.id) return;
              const prevX = (s as any)._lastSolidX !== undefined ? (s as any)._lastSolidX : s.x;
              const prevY = (s as any)._lastSolidY !== undefined ? (s as any)._lastSolidY : s.y;

              if (s.followTarget) {
                  const target = gameObjectsRef.current.find(o => o.name === s.followTarget);
                  if (target) {
                      const dx = target.x - s.x;
                      const dy = target.y - s.y;
                      const dist = Math.sqrt(dx * dx + dy * dy);
                      if (dist > 5) {
                          const speed = s.followSpeed || 100;
                          s.x += (dx / dist) * speed * deltaTime;
                          s.y += (dy / dist) * speed * deltaTime;
                      }
                  }
              }
              if (s.tweens) {
                  s.tweens = s.tweens.filter(tween => {
                      const elapsedT = now2DPre - tween.startTime;
                      const progress = Math.min(1, elapsedT / Math.max(1, tween.duration));
                      if (tween.type === 'position') {
                          s.x = tween.startX + (tween.endX - tween.startX) * progress;
                          s.y = tween.startY + (tween.endY - tween.startY) * progress;
                      } else if (tween.type === 'rotation') {
                          s.rotation = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;
                      } else if (tween.type === 'scale') {
                          s.scaleX = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;
                          s.scaleY = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;
                      }
                      return progress < 1;
                  });
              }
              if (s.oscillation) {
                  const timeOsc = (now2DPre - s.oscillation.startTime) / 1000;
                  const offsetOsc = Math.sin(timeOsc * s.oscillation.speed) * s.oscillation.distance;
                  if (s.oscillation.axis === 'x') s.x = s.oscillation.initialX + offsetOsc;
                  else s.y = s.oscillation.initialY + offsetOsc;
              }
              const patS = s.behaviors?.find(b => b.name === 'Patrol');
              if (patS) {
                  const { speed = 50, range = 100 } = patS.properties;
                  if (s.initialX === undefined) s.initialX = s.x;
                  const tPat = ((now2DPre / 1000) * speed) / Math.max(0.001, range);
                  const cycle = tPat % 2;
                  const offset = cycle < 1 ? cycle * range : (2 - cycle) * range;
                  s.x = s.initialX + offset - range / 2;
                  s.direction = cycle < 1 ? 'right' : 'left';
              }
              const oscS = s.behaviors?.find(b => b.name === 'Oscillate');
              if (oscS) {
                  const { axis = 'x', distance = 100, speed = 2 } = oscS.properties;
                  if (s.initialX === undefined) s.initialX = s.x;
                  if (s.initialY === undefined) s.initialY = s.y;
                  const offset = Math.sin((now2DPre / 1000) * speed) * distance;
                  if (axis === 'x') s.x = s.initialX + offset;
                  else s.y = s.initialY + offset;
              }
              const tpS = s.behaviors?.find(b => b.name === 'TweenPath');
              if (tpS) {
                  const { speed = 100, loop = true, points: pointsStr = '0,0;100,100' } = tpS.properties;
                  const points = String(pointsStr).split(';').map((p: string) => { const [px, py] = p.split(','); return { x: Number(px), y: Number(py) }; });
                  if (s.tweenPathIndex === undefined) s.tweenPathIndex = 0;
                  if (s.tweenPathProgress === undefined) s.tweenPathProgress = 0;
                  const p1 = points[s.tweenPathIndex];
                  const p2 = points[(s.tweenPathIndex + 1) % points.length];
                  if (p1 && p2) {
                      const dist = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
                      if (dist === 0) {
                          s.tweenPathIndex = (s.tweenPathIndex + 1) % points.length;
                      } else {
                          s.tweenPathProgress += (speed * deltaTime) / dist;
                          if (s.tweenPathProgress >= 1) {
                              s.tweenPathProgress = 0;
                              s.tweenPathIndex = s.tweenPathIndex + 1;
                              if (!loop && s.tweenPathIndex >= points.length - 1) {
                                  s.tweenPathIndex = points.length - 2;
                                  s.tweenPathProgress = 1;
                              } else {
                                  s.tweenPathIndex = s.tweenPathIndex % points.length;
                              }
                          }
                          s.x = p1.x + (p2.x - p1.x) * s.tweenPathProgress;
                          s.y = p1.y + (p2.y - p1.y) * s.tweenPathProgress;
                      }
                  }
              }
              if (s.pendingMovements && s.pendingMovements.length > 0) {
                  s.pendingMovements.forEach(move => {
                      const speed = Number(move.speed || 0);
                      const direction = (move.direction || '').toLowerCase();
                      switch (direction) {
                          case 'right': s.x += speed * deltaTime; break;
                          case 'left': s.x -= speed * deltaTime; break;
                          case 'up': s.y -= speed * deltaTime; break;
                          case 'down': s.y += speed * deltaTime; break;
                      }
                  });
                  s.pendingMovements = [];
              }
              (s as any)._platformDx = s.x - prevX;
              (s as any)._platformDy = s.y - prevY;
              if (deltaTime > 0) {
                  s.platformVx = (s as any)._platformDx / deltaTime;
                  s.platformVy = (s as any)._platformDy / deltaTime;
              }
              (s as any)._solidUpdatedInPrepass = true;
          });
      }

      const staticCollisionShapes: ({ x: number; y: number; width: number; height: number; owner: GameObject })[] = [];
        const allObjectsWithAbsPosForPhysics = gameObjectsRef.current.map(o => ({...o, ...getObjectAbsolutePosition(o.id, objectsById)}));
        
        allObjectsWithAbsPosForPhysics.forEach(obj => {
            if (obj.behaviors?.some(b => b.name === 'Solid')) {
                staticCollisionShapes.push({ ...getCollisionBox(obj), owner: obj });
            }
            const tilemapBehavior = obj.behaviors?.find(b => b.name === 'Tilemap');
            if (tilemapBehavior) {
                const { tileSize = 32, collisionData = '' } = tilemapBehavior.properties;
                const rows = String(collisionData).split('\n');
                rows.forEach((row, y) => {
                    for (let x = 0; x < row.length; x++) {
                        if (row[x] !== ' ' && row[x] !== '0') {
                            staticCollisionShapes.push({
                                x: obj.x + x * tileSize,
                                y: obj.y + y * tileSize,
                                width: tileSize,
                                height: tileSize,
                                owner: obj,
                            });
                        }
                    }
                });
            }
        });


      frameJoystickEvents.current = [];
      const actions = actionsPressed.current;
      
      // Reset non-UI actions and intensity
      ['moveLeft','moveRight','moveUp','moveDown','jump','attack','run'].forEach(act => {
        if (!actions[act+'_ui']) actions[act] = false;
      });
      actions.moveHorizontalIntensity = 0;
      actions.moveVerticalIntensity = 0;

      // Direct Gamepad (Bluetooth & USB) input processing
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (gamepadMoveLockUntilNeutralRef.current) {
          let anyDirActive = false;
          for (const gp of gamepads) {
              if (isGamepadDirectionalActive(gp)) { anyDirActive = true; break; }
          }
          if (!anyDirActive) gamepadMoveLockUntilNeutralRef.current = false;
      }
      if (!gamepadMoveLockUntilNeutralRef.current) {
          for (const gp of gamepads) {
              if (!gp) continue;
              if (gp.buttons) {
                  if (gp.buttons[0]?.pressed) actions.jump = true;
                  if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) actions.attack = true;
                  if (gp.buttons[3]?.pressed) actions.jump = true;
                  if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed || gp.buttons[6]?.pressed || (gp.buttons[6]?.value > 0.3)) actions.run = true;
                  if (gp.buttons[7]?.pressed || (gp.buttons[7]?.value > 0.3)) actions.attack = true;
                  if (gp.buttons[12]?.pressed) { actions.moveUp = true; actions.moveVerticalIntensity = -1; }
                  if (gp.buttons[13]?.pressed) { actions.moveDown = true; actions.moveVerticalIntensity = 1; }
                  if (gp.buttons[14]?.pressed) { actions.moveLeft = true; actions.moveHorizontalIntensity = -1; }
                  if (gp.buttons[15]?.pressed) { actions.moveRight = true; actions.moveHorizontalIntensity = 1; }
              }
              if (gp.axes && gp.axes.length >= 2) {
                  const x = gp.axes[0], y = gp.axes[1];
                  if (Math.abs(x) > 0.18) {
                      actions.moveHorizontalIntensity = x;
                      if (x > 0.18) actions.moveRight = true;
                      if (x < -0.18) actions.moveLeft = true;
                  }
                  if (Math.abs(y) > 0.18) {
                      actions.moveVerticalIntensity = y;
                      if (y > 0.18) actions.moveDown = true;
                      if (y < -0.18) actions.moveUp = true;
                  }
              }
          }
      }
      
      if (keysPressed.current['shift'] || keysPressed.current['shiftleft'] || keysPressed.current['shiftright'] || keysPressed.current['keyz']) {
          actions.run = true;
      }

      const joystickUpNow = joystickState.current.active && joystickState.current.angle > -135 && joystickState.current.angle < -45;
      
      joystickUpPreviousFrame.current = joystickUpNow;

      if (joystickState.current.active) {
          const joystickSize = joystick?.size ?? 120;
          const maxDistance = joystickSize / 2;
          const intensity = joystickState.current.distance / maxDistance;
          const angle = joystickState.current.angle;
          const angleRad = angle * (Math.PI / 180);
          const horizontalProjection = Math.cos(angleRad);
          const verticalProjection = Math.sin(angleRad);
          
          if (Math.abs(horizontalProjection) > 0.15) { // Threshold
             actions.moveHorizontalIntensity = horizontalProjection * intensity;
             if (horizontalProjection > 0) {
                 actions.moveRight = true;
                 if (!frameJoystickEvents.current.includes('right')) frameJoystickEvents.current.push('right');
             } else {
                 actions.moveLeft = true;
                 if (!frameJoystickEvents.current.includes('left')) frameJoystickEvents.current.push('left');
             }
          }

          if (Math.abs(verticalProjection) > 0.15) {
             actions.moveVerticalIntensity = verticalProjection * intensity;
          }

          // Keep vertical logic for events
          if (angle > 45 && angle < 135) {
             actions.moveDown = true;
             if (!frameJoystickEvents.current.includes('down')) frameJoystickEvents.current.push('down');
          }

          if (joystickUpNow) {
              actions.moveUp = true;
              if (!frameJoystickEvents.current.includes('up')) frameJoystickEvents.current.push('up');
          }
      }
      
      // Keyboard input overrides joystick for horizontal movement intensity
      let keyboardHorizontal = 0;
      if (keysPressed.current['arrowleft'] || keysPressed.current['keya']) keyboardHorizontal -= 1;
      if (keysPressed.current['arrowright'] || keysPressed.current['keyd']) keyboardHorizontal += 1;
      
      if (keyboardHorizontal !== 0) {
          actions.moveHorizontalIntensity = keyboardHorizontal;
      }

      // Set digital actions for events from keyboard
      if (keysPressed.current['arrowleft'] || keysPressed.current['keya']) actions.moveLeft = true;
      if (keysPressed.current['arrowright'] || keysPressed.current['keyd']) actions.moveRight = true;
      if (keysPressed.current['arrowup'] || keysPressed.current['keyw']) actions.moveUp = true;
      if (keysPressed.current['arrowdown'] || keysPressed.current['keys']) actions.moveDown = true;
      if (keysPressed.current['space']) actions.jump = true;
      if (keysPressed.current['keyx'] || actions.attack) actions.attack = true;
      
      // Handle single-press actions like jump and attack
      if (actions.jump) {
        if (!actions.jumpPressed) {
            actions.jumpAction = true;
            actions.jumpPressed = true;
        } else {
            actions.jumpAction = false;
        }
      } else {
          actions.jumpPressed = false;
          actions.jumpAction = false;
      }

      if (actions.attack) {
          if (!actions.attackPressed) {
              actions.attackAction = true;
              actions.attackPressed = true;
          } else {
              actions.attackAction = false;
          }
      } else {
          actions.attackPressed = false;
          actions.attackAction = false;
      }

      // Pre-update 3D solid platforms so moving solids have exact deltas and positions before any player physics run
      if (is3DModeRef.current) {
          const now3DPre = performance.now();
          gameObjectsRef.current.forEach(s => {
              if (s.isUI || !isSolidObject3D(s)) return;
              if (!s.position3D) s.position3D = getObject3DPosition(s);
              if (!s.scale3D) {
                  const dS = getObject3DDimensions(s);
                  s.scale3D = { x: dS.w, y: dS.h, z: dS.d };
              }
              if (!s.rotation3D) s.rotation3D = getObject3DRotation(s);
              if (draggingRef.current && draggingRef.current.id === s.id) {
                  (s as any)._platformDx3D = 0;
                  (s as any)._platformDy3D = 0;
                  (s as any)._platformDz3D = 0;
                  return;
              }
              const prev3 = (s as any)._lastSolidPos3D || { ...s.position3D };

              if (s.tweens && s.tweens.length > 0) {
                  s.tweens = s.tweens.filter(tween => {
                      const elapsedT = now3DPre - tween.startTime;
                      const progress = Math.min(1, elapsedT / Math.max(1, tween.duration));
                      if (tween.type === 'position') {
                          s.position3D!.x = (tween.startX + (tween.endX - tween.startX) * progress) / 50;
                          s.position3D!.z = (tween.startY + (tween.endY - tween.startY) * progress) / 50;
                      } else if (tween.type === 'rotation') {
                          const deg = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;
                          s.rotation3D!.y = (deg * Math.PI) / 180;
                      } else if (tween.type === 'scale') {
                          const sx = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;
                          const sy = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;
                          s.scale3D!.x = Math.max(0.05, sx);
                          s.scale3D!.z = Math.max(0.05, sy);
                      }
                      return progress < 1;
                  });
              }
              if (s.followTarget) {
                  const fTarget = gameObjectsRef.current.find(o => o.name === s.followTarget);
                  if (fTarget) {
                      const pT = getObject3DPosition(fTarget);
                      const dx = pT.x - s.position3D.x;
                      const dz = pT.z - s.position3D.z;
                      const dist = Math.hypot(dx, dz);
                      if (dist > 0.25) {
                          const fSpeed = (s.followSpeed || 120) / 50;
                          s.position3D.x += (dx / dist) * fSpeed * deltaTime;
                          s.position3D.z += (dz / dist) * fSpeed * deltaTime;
                          s.rotation3D.y = Math.atan2(dx, dz);
                      }
                  }
              }
              if (s.pendingMovements && s.pendingMovements.length > 0) {
                  s.pendingMovements.forEach(move => {
                      const spd = Number(move.speed || 0) / 50;
                      const direction = (move.direction || '').toLowerCase();
                      if (direction === 'right') s.position3D!.x += spd * deltaTime;
                      else if (direction === 'left') s.position3D!.x -= spd * deltaTime;
                      else if (direction === 'up' || direction === 'forward') s.position3D!.z -= spd * deltaTime;
                      else if (direction === 'down' || direction === 'backward') s.position3D!.z += spd * deltaTime;
                  });
                  s.pendingMovements = [];
              }
              const pat3S = s.behaviors?.find(b => b.name === 'Patrol3D' || b.name === 'Patrol');
              if (pat3S) {
                  const is3DPatrol = pat3S.name === 'Patrol3D';
                  const spd = Number(pat3S.properties?.speed ?? (is3DPatrol ? 2.5 : 50)) / (is3DPatrol ? 1 : 50);
                  const rng = Math.max(0.2, Number(pat3S.properties?.range ?? (is3DPatrol ? 4 : 100)) / (is3DPatrol ? 1 : 50));
                  const axis = pat3S.properties?.axis || 'x';
                  if (s.initial3D === undefined) s.initial3D = { ...s.position3D };
                  const tPat = ((now3DPre / 1000) * spd) / rng;
                  const cycle = tPat % 2;
                  const offset = (cycle < 1 ? cycle * rng : (2 - cycle) * rng) - rng / 2;
                  if (axis === 'x') s.position3D.x = s.initial3D.x + offset;
                  else if (axis === 'y') s.position3D.y = s.initial3D.y + offset;
                  else s.position3D.z = s.initial3D.z + offset;
              }
              const osc3S = s.behaviors?.find(b => b.name === 'Oscillate3D' || b.name === 'Oscillate');
              if (osc3S) {
                  const is3DOsc = osc3S.name === 'Oscillate3D';
                  const axis = osc3S.properties?.axis || 'y';
                  const dist3D = Number(osc3S.properties?.distance ?? (is3DOsc ? 1.5 : 100)) / (is3DOsc ? 1 : 50);
                  const speed = Number(osc3S.properties?.speed ?? 2);
                  if (s.initial3D === undefined) s.initial3D = { ...s.position3D };
                  const offset = Math.sin((now3DPre / 1000) * speed) * dist3D;
                  if (axis === 'x') s.position3D.x = s.initial3D.x + offset;
                  else if (axis === 'y') s.position3D.y = s.initial3D.y + offset;
                  else s.position3D.z = s.initial3D.z + offset;
              }

              (s as any)._platformDx3D = s.position3D.x - prev3.x;
              (s as any)._platformDy3D = s.position3D.y - prev3.y;
              (s as any)._platformDz3D = s.position3D.z - prev3.z;
              (s as any)._solidUpdatedInPrepass3D = true;
              sync3DTo2D(s);
          });
      }

      gameObjectsRef.current.forEach(obj => {
          if (obj.followTarget && !(obj as any)._solidUpdatedInPrepass && !(obj as any)._solidUpdatedInPrepass3D) {
            const target = gameObjectsRef.current.find(o => o.name === obj.followTarget);
            if (target) {
                const dx = target.x - obj.x;
                const dy = target.y - obj.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 5) { // Small threshold to stop jitter
                    const speed = obj.followSpeed || 100;
                    const vx = (dx / dist) * speed * deltaTime;
                    const vy = (dy / dist) * speed * deltaTime;
                    obj.x += vx;
                    obj.y += vy;
                }
            }
          }
          if (draggingRef.current && draggingRef.current.id === obj.id) {
              obj.vx = 0;
              obj.vy = 0;
              if (obj.position3D) {
                  obj.position3D.x = obj.x / 50;
                  obj.position3D.z = obj.y / 50;
                  obj.vy3D = 0;
                  obj.vx3D = 0;
                  obj.vz3D = 0;
              }
              return;
          }
          if (is3DModeRef.current) {
              if (!obj.position3D) obj.position3D = getObject3DPosition(obj);
              if (!obj.scale3D) {
                  const dObj = getObject3DDimensions(obj);
                  obj.scale3D = { x: dObj.w, y: dObj.h, z: dObj.d };
              }
              if (!obj.rotation3D) obj.rotation3D = getObject3DRotation(obj);

              if (obj.isUI) {
                  const scoreCounterBehavior = obj.behaviors?.find(b => b.name === 'ScoreCounter');
                  if (scoreCounterBehavior) {
                      const { variableName = 'score', format = 'Score: {value}' } = scoreCounterBehavior.properties;
                      const value = gameVariables.current[variableName] ?? 0;
                      obj.text = String(format).replace('{value}', String(value));
                  }
                  const textVarBehavior = obj.behaviors?.find(b => b.name === 'TextVariable');
                  if (textVarBehavior) {
                      const { variableName = '', prefix = '', suffix = '' } = textVarBehavior.properties;
                      const value = variableName ? (gameVariables.current[variableName] ?? 0) : '';
                      obj.text = `${prefix || ''}${value}${suffix || ''}`;
                  }
                  obj.x += (obj.vx || 0) * deltaTime;
                  obj.y += (obj.vy || 0) * deltaTime;
                  return;
              }

              const solidPre3D = Boolean((obj as any)._solidUpdatedInPrepass3D);

              if (!solidPre3D && obj.tweens && obj.tweens.length > 0) {
                  const nowTween = performance.now();
                  obj.tweens = obj.tweens.filter(tween => {
                      const elapsed = nowTween - tween.startTime;
                      const progress = Math.min(1, elapsed / Math.max(1, tween.duration));
                      if (tween.type === 'position') {
                          obj.position3D!.x = (tween.startX + (tween.endX - tween.startX) * progress) / 50;
                          obj.position3D!.z = (tween.startY + (tween.endY - tween.startY) * progress) / 50;
                      } else if (tween.type === 'rotation') {
                          const deg = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;
                          obj.rotation3D!.y = (deg * Math.PI) / 180;
                      } else if (tween.type === 'scale') {
                          const sx = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;
                          const sy = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;
                          obj.scale3D!.x = Math.max(0.05, sx);
                          obj.scale3D!.z = Math.max(0.05, sy);
                      }
                      return progress < 1;
                  });
              }

              let movedByFollowOrPending = false;
              const prevPos3X = obj.position3D.x;
              const prevPos3Y = obj.position3D.y;
              const prevPos3Z = obj.position3D.z;

              // FollowTarget 3D
              if (!solidPre3D && obj.followTarget) {
                  const fTarget = gameObjectsRef.current.find(o => o.name === obj.followTarget);
                  if (fTarget) {
                      const pT = getObject3DPosition(fTarget);
                      const dx = pT.x - obj.position3D.x;
                      const dz = pT.z - obj.position3D.z;
                      const dist = Math.hypot(dx, dz);
                      if (dist > 0.25) {
                          const fSpeed = (obj.followSpeed || 120) / 50;
                          obj.position3D.x += (dx / dist) * fSpeed * deltaTime;
                          obj.position3D.z += (dz / dist) * fSpeed * deltaTime;
                          obj.rotation3D.y = Math.atan2(dx, dz);
                          movedByFollowOrPending = true;
                      }
                  }
              }

              // Per-object scripts
              obj.scripts?.forEach(script => {
                  const scriptId = script.id || script.trigger;
                  if (script.trigger === 'OnUpdate' || script.trigger === 'Always') {
                      executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                  } else if (!['OnStart', 'OnClick', 'OnCollisionWith', 'OnTimerElapsed'].includes(script.trigger)) {
                      const mockCondition: Condition = {
                          trigger: script.trigger as any,
                          object: obj.name,
                          params: script.params,
                          target: script.params?.targetObjectName
                      };
                      if (checkCondition(mockCondition, obj)) {
                          executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                      }
                  }
              });

              // Pending movements (2D actions mapped to 3D XZ)
              if (!solidPre3D && obj.pendingMovements && obj.pendingMovements.length > 0) {
                  obj.pendingMovements.forEach(move => {
                      const spd = Number(move.speed || 0) / 50;
                      const direction = (move.direction || '').toLowerCase();
                      if (direction === 'right') obj.position3D!.x += spd * deltaTime;
                      else if (direction === 'left') obj.position3D!.x -= spd * deltaTime;
                      else if (direction === 'up' || direction === 'forward') obj.position3D!.z -= spd * deltaTime;
                      else if (direction === 'down' || direction === 'backward') obj.position3D!.z += spd * deltaTime;
                      movedByFollowOrPending = true;
                  });
                  obj.pendingMovements = [];
              }

              const isCurrentControlled = currentControlledId === undefined || obj.id === currentControlledId;
              const player3DBehav = obj.behaviors?.find(b => b.name === 'Player3D');
              const platformer = obj.behaviors?.find(b => b.name === 'PlatformerCharacter');
              const rpgMovement = obj.behaviors?.find(b => b.name === 'TopDownRPGMovement');
              const physics3DBehav = obj.behaviors?.find(b => b.name === 'Physics3D' || b.name === 'Physics');
              const isPlayerControlled = !!(player3DBehav || platformer || rpgMovement);

              let moveVelX = obj.vx3D || 0;
              let moveVelZ = obj.vz3D || 0;

              if (isPlayerControlled && isCurrentControlled) {
                  const baseSpeed = player3DBehav
                      ? Number(player3DBehav.properties?.speed ?? 6)
                      : Number(platformer?.properties?.speed ?? rpgMovement?.properties?.speed ?? 200) / 36;
                  const sprintMult = player3DBehav ? Number(player3DBehav.properties?.sprintMultiplier ?? 1.6) : 1.7;
                  const speedVal = actions.run ? baseSpeed * sprintMult : baseSpeed;
                  const jumpVal = player3DBehav
                      ? Number(player3DBehav.properties?.jumpForce ?? 8)
                      : Number(platformer?.properties?.jumpForce ?? 380) / 50;

                  let moveX = actions.moveHorizontalIntensity || 0;
                  let moveZ = actions.moveVerticalIntensity || 0;
                  if (moveX === 0) {
                      if (actions.moveLeft) moveX -= 1;
                      if (actions.moveRight) moveX += 1;
                  }
                  if (moveZ === 0) {
                      if (actions.moveUp) moveZ -= 1;
                      if (actions.moveDown) moveZ += 1;
                  }
                  const len = Math.hypot(moveX, moveZ);
                  if (len > 1) {
                      moveX /= len;
                      moveZ /= len;
                  }

                  const forwardInput = -moveZ;
                  const rightInput = moveX;
                  const yaw = orbitYawRef.current || 0;
                  const camFwdX = -Math.sin(yaw);
                  const camFwdZ = -Math.cos(yaw);
                  const camRightX = Math.cos(yaw);
                  const camRightZ = -Math.sin(yaw);
                  let worldMoveX = camRightX * rightInput + camFwdX * forwardInput;
                  let worldMoveZ = camRightZ * rightInput + camFwdZ * forwardInput;
                  const mag = Math.hypot(worldMoveX, worldMoveZ);
                  if (mag > 1) {
                      worldMoveX /= mag;
                      worldMoveZ /= mag;
                  }

                  moveVelX = worldMoveX * speedVal;
                  moveVelZ = worldMoveZ * speedVal;
                  obj.vx3D = moveVelX;
                  obj.vz3D = moveVelZ;

                  if (mag > 0.05) {
                      obj.rotation3D.y = Math.atan2(worldMoveX, worldMoveZ);
                      obj.direction = worldMoveX < 0 ? 'left' : 'right';
                  }

                  if (obj.vy3D === undefined) obj.vy3D = 0;
                  if (actions.jumpAction || (actions.jump && obj.grounded3D)) {
                      const canDouble = player3DBehav?.properties?.doubleJumpEnabled || platformer?.properties?.doubleJumpEnabled;
                      if (obj.grounded3D) {
                          obj.vy3D = jumpVal;
                          obj.grounded3D = false;
                          obj.grounded = false;
                          obj.doubleJumped = false;
                      } else if (actions.jumpAction && !obj.doubleJumped && canDouble) {
                          obj.vy3D = jumpVal;
                          obj.doubleJumped = true;
                      }
                  }
                  if (actions.attackAction) {
                      frameAttacks.current.push({ name: obj.name, id: obj.id });
                  }
              }

              // Merge non-permanent loop impulses & decaying burst impulses
              const loopImp3D = (obj as any)._pendingLoopImpulse3D;
              const burstImp3D = (obj as any)._burstImpulse3D;
              const impVelX = (loopImp3D?.x || 0) + (burstImp3D?.x || 0);
              const impVelZ = (loopImp3D?.z || 0) + (burstImp3D?.z || 0);
              moveVelX += impVelX;
              moveVelZ += impVelZ;

              // Apply gravity for Player3D / Platformer / Physics3D / Physics / Boss3D
              const boss3DBehav = obj.behaviors?.find(b => b.name === 'Boss3D' || b.name === 'Boss');
              const hasGravity3D = !!(player3DBehav || platformer || physics3DBehav || boss3DBehav);
              if (hasGravity3D && !obj.isProjectile) {
                  const gravVal = player3DBehav
                      ? Number(player3DBehav.properties?.gravity ?? 18)
                      : physics3DBehav?.name === 'Physics3D'
                      ? Number(physics3DBehav.properties?.gravity ?? 18)
                      : Number(physics3DBehav?.properties?.gravity ?? platformer?.properties?.gravity ?? 600) / 36;
                  if (loopImp3D && loopImp3D.y !== 0) {
                      obj.vy3D = loopImp3D.y;
                      if (loopImp3D.y > 0) {
                          obj.grounded3D = false;
                          obj.grounded = false;
                      }
                  } else {
                      obj.vy3D = (obj.vy3D || 0) - gravVal * deltaTime;
                  }
              }
              const moveVelY = hasGravity3D
                  ? (obj.vy3D || 0)
                  : ((obj.vy3D || 0) + (loopImp3D?.y || 0) + (burstImp3D?.y || 0));
              (obj as any)._effectiveVel3D = { x: moveVelX, y: moveVelY, z: moveVelZ };

              // Patrol in 3D
              const patrolBehavior = !solidPre3D ? obj.behaviors?.find(b => b.name === 'Patrol3D' || b.name === 'Patrol') : undefined;
              if (patrolBehavior) {
                  const is3DPatrol = patrolBehavior.name === 'Patrol3D';
                  const spd = Number(patrolBehavior.properties?.speed ?? (is3DPatrol ? 2.5 : 50)) / (is3DPatrol ? 1 : 50);
                  const rng = Math.max(0.2, Number(patrolBehavior.properties?.range ?? (is3DPatrol ? 4 : 100)) / (is3DPatrol ? 1 : 50));
                  const axis = patrolBehavior.properties?.axis || 'x';
                  if (obj.initial3D === undefined) obj.initial3D = { ...obj.position3D };
                  const time = performance.now() / 1000;
                  const t = (time * spd) / rng;
                  const cycle = t % 2;
                  const offset = (cycle < 1 ? cycle * rng : (2 - cycle) * rng) - rng / 2;
                  if (axis === 'x') obj.position3D.x = obj.initial3D.x + offset;
                  else if (axis === 'y') obj.position3D.y = obj.initial3D.y + offset;
                  else obj.position3D.z = obj.initial3D.z + offset;
              }

              // Oscillate in 3D
              const oscillateBehavior = !solidPre3D ? obj.behaviors?.find(b => b.name === 'Oscillate3D' || b.name === 'Oscillate') : undefined;
              if (oscillateBehavior) {
                  const is3DOsc = oscillateBehavior.name === 'Oscillate3D';
                  const axis = oscillateBehavior.properties?.axis || 'y';
                  const dist3D = Number(oscillateBehavior.properties?.distance ?? (is3DOsc ? 1.5 : 100)) / (is3DOsc ? 1 : 50);
                  const speed = Number(oscillateBehavior.properties?.speed ?? 2);
                  if (obj.initial3D === undefined) obj.initial3D = { ...obj.position3D };
                  const offset = Math.sin((performance.now() / 1000) * speed) * dist3D;
                  if (axis === 'x') obj.position3D.x = obj.initial3D.x + offset;
                  else if (axis === 'y') obj.position3D.y = obj.initial3D.y + offset;
                  else obj.position3D.z = obj.initial3D.z + offset;
              }

              // Rotate / Rotate3D behavior + action speeds
              const rotate3DBehav = obj.behaviors?.find(b => b.name === 'Rotate3D' || b.name === 'Rotate');
              if (rotate3DBehav) {
                  const p = rotate3DBehav.properties || {};
                  if (p.speedX !== undefined || p.speedY !== undefined || p.speedZ !== undefined) {
                      obj.rotation3D.x += ((Number(p.speedX) || 0) * Math.PI / 180) * deltaTime;
                      obj.rotation3D.y += ((Number(p.speedY) || 0) * Math.PI / 180) * deltaTime;
                      obj.rotation3D.z += ((Number(p.speedZ) || 0) * Math.PI / 180) * deltaTime;
                  } else {
                      const degPerSec = Number(p.speed ?? p.rotationSpeed ?? 90);
                      const axis = p.axis || 'y';
                      const radDelta = (degPerSec * Math.PI / 180) * deltaTime;
                      if (axis === 'x') obj.rotation3D.x += radDelta;
                      else if (axis === 'z') obj.rotation3D.z += radDelta;
                      else obj.rotation3D.y += radDelta;
                  }
              }
              if (obj.rotationSpeed) {
                  obj.rotation3D.y += (obj.rotationSpeed * Math.PI / 180) * deltaTime;
              }
              if (obj.rotationSpeed3D) {
                  obj.rotation3D.x += ((obj.rotationSpeed3D.x || 0) * Math.PI / 180) * deltaTime;
                  obj.rotation3D.y += ((obj.rotationSpeed3D.y || 0) * Math.PI / 180) * deltaTime;
                  obj.rotation3D.z += ((obj.rotationSpeed3D.z || 0) * Math.PI / 180) * deltaTime;
              }

              // Pulse behavior in 3D
              const pulseBehavior = obj.behaviors?.find(b => b.name === 'Pulse');
              if (pulseBehavior) {
                  const dist = Number(pulseBehavior.properties?.distance ?? 0.2);
                  const speed = Number(pulseBehavior.properties?.speed ?? 2);
                  if (!obj.initialScaleX) obj.initialScaleX = obj.scale3D.x;
                  if (!obj.initialScaleY) obj.initialScaleY = obj.scale3D.y;
                  const pulseOffset = Math.sin((performance.now() / 1000) * speed) * dist;
                  obj.scale3D.x = Math.max(0.1, obj.initialScaleX * (1 + pulseOffset));
                  obj.scale3D.y = Math.max(0.1, obj.initialScaleY * (1 + pulseOffset));
                  obj.scale3D.z = Math.max(0.1, obj.initialScaleX * (1 + pulseOffset));
              }

              // Boss3D / Boss AI in 3D
              if (boss3DBehav) {
                  const bProps = boss3DBehav.properties || {};
                  const spd = bProps.speed !== undefined ? Number(bProps.speed) / (boss3DBehav.name === 'Boss3D' ? 1 : 30) : 2.5;
                  const jumpF = bProps.jumpForce !== undefined ? Number(bProps.jumpForce) / (boss3DBehav.name === 'Boss3D' ? 1 : 50) : 7;
                  const attackInt = Number(bProps.attackInterval ?? 2.0);
                  const attackSpd = bProps.attackSpeed !== undefined ? Number(bProps.attackSpeed) / (boss3DBehav.name === 'Boss3D' ? 1 : 40) : 9;
                  const projColor = bProps.projectileColor || '#ef4444';
                  const playerObj = gameObjectsRef.current.find(p => p.id !== obj.id && p.behaviors?.some(b => ['Player3D', 'PlatformerCharacter', 'TopDownRPGMovement'].includes(b.name)));
                  if (playerObj) {
                      const pPos = getObject3DPosition(playerObj);
                      const dx = pPos.x - obj.position3D.x;
                      const dz = pPos.z - obj.position3D.z;
                      const dist = Math.hypot(dx, dz);
                      if (dist > 1.2) {
                          moveVelX = (dx / dist) * spd;
                          moveVelZ = (dz / dist) * spd;
                          obj.rotation3D.y = Math.atan2(dx, dz);
                      } else {
                          moveVelX = 0;
                          moveVelZ = 0;
                      }
                      if (obj.grounded3D && Math.random() < 0.015) {
                          obj.vy3D = jumpF;
                          obj.grounded3D = false;
                      }
                      if (!obj._lastAttackTime) obj._lastAttackTime = Date.now();
                      const timeNow = Date.now();
                      if (timeNow - obj._lastAttackTime > attackInt * 1000) {
                          obj._lastAttackTime = timeNow;
                          const angle = Math.atan2(dx, dz);
                          const proj3D: GameObject = {
                              id: createUniqueId(),
                              name: `${obj.name}_Proyectil3D`,
                              x: obj.x,
                              y: obj.y,
                              width: 16,
                              height: 16,
                              color: projColor,
                              shape3D: 'sphere',
                              emissive3D: projColor,
                              emissiveIntensity3D: 0.7,
                              zIndex: 20,
                              isUI: false,
                              isProjectile: true,
                              projectileLifetime: 3.0,
                              position3D: { x: obj.position3D.x, y: obj.position3D.y + 0.6, z: obj.position3D.z },
                              scale3D: { x: 0.4, y: 0.4, z: 0.4 },
                              vx3D: Math.sin(angle) * attackSpd,
                              vz3D: Math.cos(angle) * attackSpd,
                              vy3D: 0,
                              stats: { hp: 1, maxHp: 1, attack: 10 },
                          };
                          sync3DTo2D(proj3D);
                          gameObjectsRef.current.push(proj3D);
                      }
                  }
              }

              // Projectiles in 3D
              if (obj.isProjectile) {
                  if (obj.vx3D === undefined && obj.vx !== undefined) obj.vx3D = obj.vx / 50;
                  if (obj.vz3D === undefined && obj.vy !== undefined) obj.vz3D = obj.vy / 50;
                  obj.position3D.x += (obj.vx3D || 0) * deltaTime;
                  obj.position3D.z += (obj.vz3D || 0) * deltaTime;
                  obj.position3D.y += (obj.vy3D || 0) * deltaTime;
                  if (obj.projectileLifetime !== undefined) {
                      obj.projectileLifetime -= deltaTime;
                      if (obj.projectileLifetime <= 0) {
                          setTimeout(() => {
                              if (gameObjectsRef.current) {
                                  gameObjectsRef.current = gameObjectsRef.current.filter(o => o.id !== obj.id);
                              }
                          }, 0);
                      }
                  }
                  const isFriendly = obj.name === 'Bullet' || obj.name === 'AttackBox';
                  let projectileHitSolid = false;
                  for (const other of gameObjectsRef.current) {
                      if (other.id !== obj.id && !other.isProjectile && other.visible !== false && !other.isUI && (other.isTouchable ?? true)) {
                          if (!checkCollision3D(obj, other)) continue;
                          frameCollisions.current.push({ obj1Name: obj.name, obj2Name: other.name, type: 'OnCollisionWith', obj1Id: obj.id, obj2Id: other.id });
                          const isPlayer = other.behaviors?.some(b => ['Player3D', 'PlatformerCharacter', 'TopDownRPGMovement'].includes(b.name));
                          const isEnemy = other.behaviors?.some(b => b.name === 'Boss' || b.name === 'Boss3D') || other.name.toLowerCase().includes('enemy') || other.name.toLowerCase().includes('enemigo') || (!isPlayer && other.stats !== undefined);
                          const canHit = (isFriendly && isEnemy) || (!isFriendly && isPlayer && obj.name !== 'AttackBox' && obj.name !== 'Bullet');
                          if (canHit) {
                              if (other.stats) {
                                  const dmg = obj.stats?.attack ?? 15;
                                  other.stats.hp = Math.max(0, (other.stats.hp || 100) - dmg);
                              }
                              if (obj.name !== 'AttackBox') {
                                  setTimeout(() => {
                                      if (gameObjectsRef.current) {
                                          gameObjectsRef.current = gameObjectsRef.current.filter(o => o.id !== obj.id);
                                      }
                                  }, 0);
                                  break;
                              }
                          } else if (isSolidObject3D(other) && obj.name !== 'AttackBox') {
                              projectileHitSolid = true;
                              break;
                          }
                      }
                  }
                  if (projectileHitSolid) {
                      setTimeout(() => {
                          if (gameObjectsRef.current) {
                              gameObjectsRef.current = gameObjectsRef.current.filter(o => o.id !== obj.id);
                          }
                      }, 0);
                  }
                  sync3DTo2D(obj);
                  return;
              }

              // Solid3D / Solid / isSolid3D 3D OBB SAT + Ramp collision resolution
              const isSolidObj = isSolidObject3D(obj);
              const movedByAction3D = Boolean((obj as any)._moved3DThisFrame) || movedByFollowOrPending || obj.position3D.x !== prevPos3X || obj.position3D.y !== prevPos3Y || obj.position3D.z !== prevPos3Z;
              (obj as any)._moved3DThisFrame = false;
              const needsPhysics3D = !isSolidObj && (isPlayerControlled || hasGravity3D || moveVelX !== 0 || moveVelZ !== 0 || moveVelY !== 0 || movedByAction3D);
              if (needsPhysics3D) {
                  resolve3DSolidsForObject(obj, deltaTime, moveVelX, moveVelY, moveVelZ, isPlayerControlled, hasGravity3D);
              } else if (isSolidObj && (impVelX !== 0 || (loopImp3D?.y || 0) !== 0 || (burstImp3D?.y || 0) !== 0 || impVelZ !== 0)) {
                  obj.position3D.x += moveVelX * deltaTime;
                  obj.position3D.y += moveVelY * deltaTime;
                  obj.position3D.z += moveVelZ * deltaTime;
              }

              // Reset per-frame loop impulse so loops never become permanent, and damp one-shot bursts
              if ((obj as any)._pendingLoopImpulse3D) {
                  (obj as any)._pendingLoopImpulse3D.x = 0;
                  (obj as any)._pendingLoopImpulse3D.y = 0;
                  (obj as any)._pendingLoopImpulse3D.z = 0;
              }
              if ((obj as any)._burstImpulse3D) {
                  const damp3D = Math.exp(-5.5 * deltaTime);
                  (obj as any)._burstImpulse3D.x *= damp3D;
                  (obj as any)._burstImpulse3D.y *= damp3D;
                  (obj as any)._burstImpulse3D.z *= damp3D;
                  if (Math.abs((obj as any)._burstImpulse3D.x) < 0.02) (obj as any)._burstImpulse3D.x = 0;
                  if (Math.abs((obj as any)._burstImpulse3D.y) < 0.02) (obj as any)._burstImpulse3D.y = 0;
                  if (Math.abs((obj as any)._burstImpulse3D.z) < 0.02) (obj as any)._burstImpulse3D.z = 0;
              }

              // Clamp to camera bounds if set
              if (scene.cameraBounds?.enabled) {
                  const minX = scene.cameraBounds.x / 50;
                  const maxX = (scene.cameraBounds.x + scene.cameraBounds.width) / 50;
                  const minZ = scene.cameraBounds.y / 50;
                  const maxZ = (scene.cameraBounds.y + scene.cameraBounds.height) / 50;
                  obj.position3D.x = Math.max(minX, Math.min(maxX, obj.position3D.x));
                  obj.position3D.z = Math.max(minZ, Math.min(maxZ, obj.position3D.z));
              }

              // Post-physics per-object scripts for state triggers (IsJumping, IsFalling, IsMoving, etc.)
              obj.scripts?.forEach(script => {
                  const scriptId = script.id || script.trigger;
                  if (!['OnStart', 'OnClick', 'OnCollisionWith', 'OnTimerElapsed', 'OnUpdate', 'Always'].includes(script.trigger)) {
                      const mockCondition: Condition = {
                          trigger: script.trigger as any,
                          object: obj.name,
                          params: script.params,
                          target: script.params?.targetObjectName
                      };
                      if (checkCondition(mockCondition, obj)) {
                          executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                      }
                  }
              });

              // Unified automatic animations & poses for 3D characters (Player3D, PlatformerCharacter in 3D)
              const p3dBehav = obj.behaviors?.find(b => b.name === 'Player3D');
              const plat3DBehav = obj.behaviors?.find(b => b.name === 'PlatformerCharacter');
              const mp3DBehav = obj.behaviors?.find(b => b.name === 'MultiplayerTag' && b.properties?.movementType === 'platformer');
              const animCharBehav = p3dBehav || plat3DBehav || mp3DBehav;

              if (animCharBehav) {
                  const nowTime = performance.now();
                  const isAttackingNow = (isCurrentControlled && actions.attackAction) || frameAttacks.current.some(a => a.id === obj.id);
                  const attackAnimId = animCharBehav.properties?.attackAnimId;
                  const idleAnimId = animCharBehav.properties?.idleAnimId;
                  const runAnimId = animCharBehav.properties?.runAnimId;
                  const jumpAnimId = animCharBehav.properties?.jumpAnimId;
                  const fallAnimId = animCharBehav.properties?.fallAnimId;

                  const allPoses = projectData?.poseAnimations || [];
                  const entry3D = threeMeshMapRef.current.get(obj.id);
                  const glbClips3D: any[] = entry3D?.group?.userData?.animations || [];
                  const findClip3D = (prefId?: string, keywords?: string[]) => {
                      if (!glbClips3D || glbClips3D.length === 0) return null;
                      if (prefId) {
                          const pl = String(prefId).toLowerCase();
                          const mPref = glbClips3D.find(c => c.name && c.name.toLowerCase() === pl) ||
                              glbClips3D.find(c => c.name && c.name.toLowerCase().includes(pl));
                          if (mPref) return mPref;
                      }
                      if (keywords && keywords.length > 0) {
                          const mKw = glbClips3D.find(c => {
                              const cn = (c.name || '').toLowerCase();
                              return keywords.some(kw => cn.includes(kw));
                          });
                          if (mKw) return mKw;
                      }
                      return null;
                  };

                  const restoreOrigVisual3D = (origV: any) => {
                      if (!origV) return;
                      obj.shape3D = origV.shape3D;
                      if (origV.color !== undefined) obj.color = origV.color;
                      obj.emissive3D = origV.emissive3D;
                      obj.emissiveIntensity3D = origV.emissiveIntensity3D;
                      obj.modelUrl = origV.modelUrl;
                  };

                  const startAutoPose3D = (targetPose: any, isAirPose = false) => {
                      if (!targetPose) return;
                      const currentPose: any = activePoseAnimationsRef.current.get(obj.id);
                      if (!currentPose || String(currentPose.poseAnimation.id) !== String(targetPose.id)) {
                          const prevHadClip = Boolean(currentPose?.poseAnimation?.frames?.some((f: any) => f.modelAnimName));
                          if (currentPose?.origVisual) {
                              restoreOrigVisual3D(currentPose.origVisual);
                          }
                          const origVisual = currentPose?.origVisual || {
                              shape3D: obj.shape3D,
                              color: obj.color,
                              emissive3D: obj.emissive3D,
                              emissiveIntensity3D: obj.emissiveIntensity3D,
                              modelUrl: obj.modelUrl,
                          };
                          activePoseAnimationsRef.current.set(obj.id, {
                              poseAnimation: targetPose,
                              startTime: nowTime,
                              loop: targetPose.loop !== false,
                              speed: 1,
                              isAutoPose: true,
                              isAutoAirPose: isAirPose,
                              origVisual,
                          } as any);
                          const nextHasClip = Boolean(targetPose.frames?.[0]?.modelAnimName);
                          if (prevHadClip && !nextHasClip) {
                              delete (obj as any)._runtimeAnim3D;
                              if (entry3D?.group) {
                                  delete entry3D.group.userData.pendingAnimation3D;
                                  if (obj.animation3D && entry3D.group.userData.playAnimation3D) {
                                      entry3D.group.userData.playAnimation3D(obj.animation3D, obj.animation3DLoop !== false, Number(obj.animation3DSpeed ?? 1) || 1);
                                  } else {
                                      entry3D.group.userData.stopAnimation3D?.();
                                  }
                              }
                          }
                      }
                  };

                  // 1. Resolve Attack
                  if (isAttackingNow) {
                      const matchingAttackPose = (attackAnimId && allPoses.find(pa => String(pa.id) === String(attackAnimId) || pa.name === attackAnimId)) ||
                          allPoses.find(pa => {
                              const nameL = pa.name.toLowerCase();
                              const objL = obj.name.toLowerCase();
                              return nameL.includes(objL) && (nameL.includes('attack') || nameL.includes('atacar') || nameL.includes('golpe'));
                          }) || allPoses.find(pa => {
                              const nameL = pa.name.toLowerCase();
                              return nameL.includes('attack') || nameL.includes('atacar') || nameL.includes('golpe');
                          });

                      let attackDuration = 350;
                      if (matchingAttackPose && matchingAttackPose.frames?.length) {
                          attackDuration = matchingAttackPose.frames.reduce((sum, f) => sum + Math.max(20, Number(f.duration) || 300), 0);
                      }
                      obj.rpgAttackEndTime = nowTime + attackDuration;

                      if (matchingAttackPose) {
                          startAutoPose3D(matchingAttackPose, false);
                      } else if (attackAnimId && entry3D?.group?.userData?.playAnimation3D) {
                          const atkClip3D = findClip3D(attackAnimId, []);
                          if (atkClip3D) entry3D.group.userData.playAnimation3D(atkClip3D.name, false, 1);
                      }
                  }

                  const isCurrentlyAttacking = nowTime < (obj.rpgAttackEndTime || 0);
                  const hasScriptAnimActive = (obj as any)._scriptAnimTime && (nowTime - (obj as any)._scriptAnimTime < 120);

                  if (!isCurrentlyAttacking && !hasScriptAnimActive) {
                      const inAir3D = !obj.grounded3D;
                      const currentVy = obj.vy3D !== undefined ? obj.vy3D : ((obj as any)._effectiveVel3D?.y || 0);
                      const clearAirPose3D = () => {
                          const curP: any = activePoseAnimationsRef.current.get(obj.id);
                          if (curP && curP.poseAnimation) {
                              const n = (curP.poseAnimation.name || '').toLowerCase();
                              const pid = String(curP.poseAnimation.id);
                              const matchesConfiguredAirId =
                                  (jumpAnimId && (pid === String(jumpAnimId) || curP.poseAnimation.name === jumpAnimId)) ||
                                  (fallAnimId && (pid === String(fallAnimId) || curP.poseAnimation.name === fallAnimId));
                              const isAirKeyword = n.includes('jump') || n.includes('salto') || n.includes('saltar') || n.includes('brinco') || n.includes('fall') || n.includes('caer') || n.includes('caida') || n.includes('caída');
                              if (curP.isAutoAirPose || curP.startedInAir || matchesConfiguredAirId || isAirKeyword) {
                                  const hadClip = Boolean(curP.poseAnimation.frames?.some((f: any) => f.modelAnimName));
                                  if (curP.origVisual) {
                                      restoreOrigVisual3D(curP.origVisual);
                                  }
                                  activePoseAnimationsRef.current.delete(obj.id);
                                  if (entry3D?.group) entry3D.group.scale.set(1, 1, 1);
                                  if (hadClip) {
                                      delete (obj as any)._runtimeAnim3D;
                                      if (entry3D?.group) {
                                          delete entry3D.group.userData.pendingAnimation3D;
                                          if (obj.animation3D && entry3D.group.userData.playAnimation3D) {
                                              entry3D.group.userData.playAnimation3D(obj.animation3D, obj.animation3DLoop !== false, Number(obj.animation3DSpeed ?? 1) || 1);
                                          } else {
                                              entry3D.group.userData.stopAnimation3D?.();
                                          }
                                      }
                                  }
                              }
                          }
                      };

                      if (inAir3D) {
                          const curPAir: any = activePoseAnimationsRef.current.get(obj.id);
                          const isFalling = currentVy < -0.05;
                          let targetPose: any = undefined;
                          let targetClipObj: any = null;

                          if (isFalling) {
                              targetPose = (fallAnimId && allPoses.find(p => String(p.id) === String(fallAnimId) || p.name === fallAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      const on = obj.name.toLowerCase();
                                      return n.includes(on) && (n.includes('fall') || n.includes('caer') || n.includes('caida') || n.includes('caída'));
                                  }) || allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('fall') || n.includes('caer') || n.includes('caida') || n.includes('caída');
                                  }) ||
                                  (jumpAnimId && allPoses.find(p => String(p.id) === String(jumpAnimId) || p.name === jumpAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('jump') || n.includes('salto') || n.includes('saltar') || n.includes('brinco');
                                  });

                              if (!targetPose) {
                                  targetClipObj = findClip3D(fallAnimId, ['fall', 'caer', 'caida', 'caída']) ||
                                      findClip3D(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']);
                              }
                          } else {
                              targetPose = (jumpAnimId && allPoses.find(p => String(p.id) === String(jumpAnimId) || p.name === jumpAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      const on = obj.name.toLowerCase();
                                      return n.includes(on) && (n.includes('jump') || n.includes('salto') || n.includes('saltar') || n.includes('brinco'));
                                  }) || allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('jump') || n.includes('salto') || n.includes('saltar') || n.includes('brinco');
                                  }) ||
                                  (fallAnimId && allPoses.find(p => String(p.id) === String(fallAnimId) || p.name === fallAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('fall') || n.includes('caer') || n.includes('caida') || n.includes('caída');
                                  });

                              if (!targetPose) {
                                  targetClipObj = findClip3D(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']) ||
                                      findClip3D(fallAnimId, ['fall', 'caer', 'caida', 'caída']);
                              }
                          }

                          const keepExplicitAirScriptPose = Boolean(curPAir && curPAir.isAutoPose === false && !isFalling);
                          if (!keepExplicitAirScriptPose) {
                              if (targetPose) {
                                  startAutoPose3D(targetPose, true);
                              } else if (targetClipObj && entry3D?.group?.userData?.playAnimation3D) {
                                  if ((entry3D.group.userData.currentActionName || '').toLowerCase() !== (targetClipObj.name || '').toLowerCase()) {
                                      entry3D.group.userData.playAnimation3D(targetClipObj.name, true, 1);
                                  }
                              }
                          }
                      } else {
                          // Grounded: Run or Idle
                          const isMovingHoriz = Math.hypot(moveVelX, moveVelZ) > 0.08 || Math.hypot(obj.vx3D || 0, obj.vz3D || 0) > 0.08;

                          if (isMovingHoriz) {
                              const targetRunPose = (runAnimId && allPoses.find(p => String(p.id) === String(runAnimId) || p.name === runAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      const on = obj.name.toLowerCase();
                                      return n.includes(on) && (n.includes('run') || n.includes('correr') || n.includes('walk') || n.includes('caminar'));
                                  }) || allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('run') || n.includes('correr') || n.includes('walk') || n.includes('caminar');
                                  });

                              if (targetRunPose) {
                                  startAutoPose3D(targetRunPose, false);
                              } else {
                                  clearAirPose3D();
                                  const targetRunClip = findClip3D(runAnimId, ['run', 'correr', 'walk', 'caminar']);
                                  if (targetRunClip && entry3D?.group?.userData?.playAnimation3D) {
                                      if ((entry3D.group.userData.currentActionName || '').toLowerCase() !== (targetRunClip.name || '').toLowerCase()) {
                                          entry3D.group.userData.playAnimation3D(targetRunClip.name, true, 1);
                                      }
                                  }
                              }
                          } else {
                              // Idle
                              const targetIdlePose = (idleAnimId && allPoses.find(p => String(p.id) === String(idleAnimId) || p.name === idleAnimId)) ||
                                  allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      const on = obj.name.toLowerCase();
                                      return n.includes(on) && (n.includes('idle') || n.includes('quieto') || n.includes('reposo') || n.includes('stand'));
                                  }) || allPoses.find(p => {
                                      const n = p.name.toLowerCase();
                                      return n.includes('idle') || n.includes('quieto') || n.includes('reposo') || n.includes('stand');
                                  });

                              if (targetIdlePose) {
                                  startAutoPose3D(targetIdlePose, false);
                              } else {
                                  clearAirPose3D();
                                  const targetIdleClip = findClip3D(idleAnimId, ['idle', 'quieto', 'reposo', 'stand']);
                                  if (targetIdleClip && entry3D?.group?.userData?.playAnimation3D) {
                                      if ((entry3D.group.userData.currentActionName || '').toLowerCase() !== (targetIdleClip.name || '').toLowerCase()) {
                                          entry3D.group.userData.playAnimation3D(targetIdleClip.name, true, 1);
                                      }
                                  }
                              }
                          }
                      }
                  }
              }

              sync3DTo2D(obj);
              return;
          }

          if (obj.isProjectile) {
              obj.x += (obj.vx || 0) * deltaTime;
              obj.y += (obj.vy || 0) * deltaTime;
              
              if (obj.projectileLifetime !== undefined) {
                  obj.projectileLifetime -= deltaTime;
                  if (obj.projectileLifetime <= 0) {
                      setTimeout(() => {
                         if (gameObjectsRef.current) {
                            gameObjectsRef.current = gameObjectsRef.current.filter(o => o.id !== obj.id);
                         }
                      }, 0);
                  }
              }

              // Check collisions with other objects
              const projBox = getCollisionBox(obj);
              const isFriendly = obj.name === 'Bullet' || obj.name === 'AttackBox';
              
              for (const other of gameObjectsRef.current) {
                  if (other.id !== obj.id && !other.isProjectile) {
                      const isPlayer = other.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement');
                      const isEnemy = other.behaviors?.some(b => b.name === 'Boss') || other.name.toLowerCase().includes('enemy') || other.name.toLowerCase().includes('enemigo') || (!isPlayer && other.stats !== undefined);

                      // Friendly projectiles hit enemies. Hostile projectiles hit players!
                      const canHit = (isFriendly && isEnemy) || (!isFriendly && isPlayer && obj.name !== 'AttackBox' && obj.name !== 'Bullet');

                      if (canHit && isColliding(projBox, getCollisionBox(other))) {
                          if (other.stats) {
                              const dmg = obj.stats?.attack ?? 15;
                              other.stats.hp = Math.max(0, (other.stats.hp || 100) - dmg);
                          }
                          
                          // Apply horizontal and vertical knockback
                          const knockForceX = 220;
                          const knockForceY = -160;
                          // If projectile on left of target, push right. Else push left.
                          const pushDir = (obj.x + obj.width / 2) < (other.x + other.width / 2) ? 1 : -1;
                          
                          other.vx = pushDir * knockForceX;
                          other.vy = knockForceY;
                          if (other.behaviors?.some(b => b.name === 'TopDownRPGMovement')) {
                              other.rpgKnockbackVx = pushDir * knockForceX * 1.8;
                              other.rpgKnockbackVy = Math.sign(other.y - obj.y) * knockForceX;
                          }
                          
                          // Remove projectile (unless it is a persistent melee slash AttackBox)
                          if (obj.name !== 'AttackBox') {
                              setTimeout(() => {
                                 if (gameObjectsRef.current) {
                                    gameObjectsRef.current = gameObjectsRef.current.filter(o => o.id !== obj.id);
                                 }
                              }, 0);
                              break;
                          }
                      }
                  }
              }
              return; // Skip normal script and updates for transient projectiles
          }

           obj.scripts?.forEach(script => {
             const scriptId = script.id || script.trigger;
             if (script.trigger === 'OnUpdate' || script.trigger === 'Always') {
                 executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, `obj-${obj.id}-script-${scriptId}`);
             }
           });

          const solidPre2D = Boolean((obj as any)._solidUpdatedInPrepass);

          if (!solidPre2D && obj.tweens) {
              const now = performance.now();
              obj.tweens = obj.tweens.filter(tween => {
                  const elapsed = now - tween.startTime;
                  const progress = Math.min(1, elapsed / tween.duration);
                  
                  // Simple linear easing
                  if (tween.type === 'position') {
                      obj.x = tween.startX + (tween.endX - tween.startX) * progress;
                      obj.y = tween.startY + (tween.endY - tween.startY) * progress;
                  } else if (tween.type === 'rotation') {
                      obj.rotation = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;
                  } else if (tween.type === 'scale') {
                      obj.scaleX = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;
                      obj.scaleY = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;
                  }
                  
                  return progress < 1;
              });
          }

          if (!solidPre2D && obj.oscillation) {
              const time = (performance.now() - obj.oscillation.startTime) / 1000;
              const offset = Math.sin(time * obj.oscillation.speed) * obj.oscillation.distance;
              if (obj.oscillation.axis === 'x') {
                  obj.x = obj.oscillation.initialX + offset;
              } else {
                  obj.y = obj.oscillation.initialY + offset;
              }
          }

          // New Behaviors Implementation
          const patrolBehavior = !solidPre2D ? obj.behaviors?.find(b => b.name === 'Patrol') : undefined;
          if (patrolBehavior) {
              const { speed = 50, range = 100, sticky = true } = patrolBehavior.properties;
              if (obj.initialX === undefined) obj.initialX = obj.x;
              const time = performance.now() / 1000;
              // Use a triangle wave for linear patrol
              const t = (time * speed) / range;
              const cycle = t % 2;
              const offset = cycle < 1 ? cycle * range : (2 - cycle) * range;
              const lastX = obj.x;
              obj.x = obj.initialX + offset - range / 2;
              obj.direction = cycle < 1 ? 'right' : 'left';
              if (sticky && deltaTime > 0) {
                  obj.platformVx = (obj.x - lastX) / deltaTime;
                  obj.platformVy = 0;
              }
          }

          const oscillateBehavior = !solidPre2D ? obj.behaviors?.find(b => b.name === 'Oscillate') : undefined;
          if (oscillateBehavior) {
              const { axis = 'x', distance = 100, speed = 2, sticky = true } = oscillateBehavior.properties;
              if (obj.initialX === undefined) obj.initialX = obj.x;
              if (obj.initialY === undefined) obj.initialY = obj.y;
              const time = performance.now() / 1000;
              const offset = Math.sin(time * speed) * distance;
              const lastX = obj.x;
              const lastY = obj.y;
              if (axis === 'x') {
                  obj.x = obj.initialX + offset;
              } else {
                  obj.y = obj.initialY + offset;
              }
              if (sticky && deltaTime > 0) {
                  obj.platformVx = (obj.x - lastX) / deltaTime;
                  obj.platformVy = (obj.y - lastY) / deltaTime;
              }
          }

          const rotateBehavior = obj.behaviors?.find(b => b.name === 'Rotate');
          if (rotateBehavior) {
              const { rotationSpeed = 90 } = rotateBehavior.properties;
              obj.rotation = ((obj.rotation || 0) + rotationSpeed * deltaTime) % 360;
              if (obj.rotation < 0) obj.rotation += 360;
          }

          const pulseBehavior = obj.behaviors?.find(b => b.name === 'Pulse');
          if (pulseBehavior) {
              const { distance = 0.2, speed = 2 } = pulseBehavior.properties;
              if (obj.initialScaleX === undefined) obj.initialScaleX = obj.scaleX ?? 1;
              if (obj.initialScaleY === undefined) obj.initialScaleY = obj.scaleY ?? 1;
              const time = performance.now() / 1000;
              const offset = Math.sin(time * speed) * distance;
              obj.scaleX = obj.initialScaleX + offset;
              obj.scaleY = obj.initialScaleY + offset;
          }

          const scoreCounterBehavior = obj.behaviors?.find(b => b.name === 'ScoreCounter');
          if (scoreCounterBehavior) {
              const { variableName = 'score', format = 'Score: {value}' } = scoreCounterBehavior.properties;
              const value = gameVariables.current[variableName] ?? 0;
              obj.text = String(format).replace('{value}', String(value));
          }
          const textVarBehavior = obj.behaviors?.find(b => b.name === 'TextVariable');
          if (textVarBehavior) {
              const { variableName = '', prefix = '', suffix = '' } = textVarBehavior.properties;
              const value = variableName ? (gameVariables.current[variableName] ?? 0) : '';
              obj.text = `${prefix || ''}${value}${suffix || ''}`;
          }

          const tweenPathBehavior = !solidPre2D ? obj.behaviors?.find(b => b.name === 'TweenPath') : undefined;
          if (tweenPathBehavior) {
               const { speed = 100, loop = true, points: pointsStr = '0,0;100,100' } = tweenPathBehavior.properties;
               const points = String(pointsStr).split(';').map((p: string) => { const [x, y] = p.split(','); return { x: Number(x), y: Number(y) }; });
               
               if (obj.tweenPathIndex === undefined) obj.tweenPathIndex = 0;
               if (obj.tweenPathProgress === undefined) obj.tweenPathProgress = 0;

               const p1 = points[obj.tweenPathIndex];
               const p2 = points[(obj.tweenPathIndex + 1) % points.length];
               
               const dist = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
               if (dist === 0) {
                     obj.tweenPathIndex = (obj.tweenPathIndex + 1) % points.length;
               } else {
                     const step = (speed * deltaTime) / dist;
                     obj.tweenPathProgress += step;
                     if (obj.tweenPathProgress >= 1) {
                         obj.tweenPathProgress = 0;
                         obj.tweenPathIndex = obj.tweenPathIndex + 1;
                         if (!loop && obj.tweenPathIndex >= points.length - 1) {
                             obj.tweenPathIndex = points.length - 2;
                             obj.tweenPathProgress = 1;
                         } else {
                             obj.tweenPathIndex = obj.tweenPathIndex % points.length;
                         }
                     }
                     // Apply tweened position
                     // If obj.initialX/Y are not set, we might need to anchor this.
                     // Let's assume points are absolute for now.
                     obj.x = p1.x + (p2.x - p1.x) * obj.tweenPathProgress;
                     obj.y = p1.y + (p2.y - p1.y) * obj.tweenPathProgress;
               }
          }

          const attackBehavior = obj.behaviors?.find(b => b.name === 'Attack');
          if (attackBehavior) {
              // This behavior might be used to trigger the attack action
          }
          
          const bossBehavior = obj.behaviors?.find(b => b.name === 'Boss');
          if (bossBehavior) {
              const bProps = bossBehavior.properties || {};
              if (obj.bossSpeed === undefined) obj.bossSpeed = Number(bProps.speed !== undefined ? bProps.speed : 80);
              if (obj.bossJumpForce === undefined) obj.bossJumpForce = Number(bProps.jumpForce !== undefined ? bProps.jumpForce : 300);
              if (obj.bossAttackInterval === undefined) obj.bossAttackInterval = Number(bProps.attackInterval !== undefined ? bProps.attackInterval : 2);
              if (obj.bossAttackSpeed === undefined) obj.bossAttackSpeed = Number(bProps.attackSpeed !== undefined ? bProps.attackSpeed : 300);
              if (obj.bossFollowPlayer === undefined) obj.bossFollowPlayer = bProps.followPlayer !== undefined ? bProps.followPlayer : true;
              if (obj.bossProjectileColor === undefined) obj.bossProjectileColor = bProps.projectileColor || '#ef4444';

              const speed = obj.bossSpeed;
              const jumpForce = obj.bossJumpForce;
              const attackInterval = obj.bossAttackInterval;
              const attackSpeed = obj.bossAttackSpeed;
              const followPlayer = obj.bossFollowPlayer;
              const projectileColor = obj.bossProjectileColor;

              const playerObj = gameObjectsRef.current?.find(o => 
                  o.name.toLowerCase().includes('player') || 
                  o.name.toLowerCase().includes('jugador') ||
                  o.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement')
              );

              if (followPlayer && playerObj) {
                  if (playerObj.x < obj.x) {
                      obj.direction = 'left';
                      obj.vx = -speed;
                  } else {
                      obj.direction = 'right';
                      obj.vx = speed;
                  }

                  const playerIsHigher = playerObj.y < obj.y - 40;
                  const isBlocked = Math.abs(obj.vx) > 0 && Math.abs((obj.lastX || 0) - obj.x) < 0.2;
                  if (obj.grounded && (isBlocked || (playerIsHigher && Math.random() < 0.015))) {
                      obj.vy = -jumpForce;
                      obj.grounded = false;
                  }
                  obj.lastX = obj.x;
              }

              if (!obj._lastAttackTime) obj._lastAttackTime = Date.now();
              const now = Date.now();
              if (now - obj._lastAttackTime > attackInterval * 1000) {
                  obj._lastAttackTime = now;
                  if (playerObj) {
                      const projId = createUniqueId();
                      const angle = Math.atan2(playerObj.y - obj.y, playerObj.x - obj.x);
                      const projVx = Math.cos(angle) * attackSpeed;
                      const projVy = Math.sin(angle) * attackSpeed;

                      const bossProjectile = {
                          id: projId,
                          name: `${obj.name}_Proyectil`,
                          x: obj.direction === 'left' ? obj.x - 15 : obj.x + obj.width + 15,
                          y: obj.y + obj.height / 2 - 5,
                          width: 14,
                          height: 14,
                          color: projectileColor,
                          zIndex: 20,
                          vx: projVx,
                          vy: projVy,
                          isUI: false,
                          behaviors: [
                              { name: 'Physics', properties: { gravity: 0 } }
                          ],
                          variables: [],
                          stats: { hp: 1, maxHp: 1, attack: 10 },
                          isProjectile: true,
                          projectileLifetime: 3.0
                      };

                      gameObjectsRef.current.push(bossProjectile);
                  }
              }
          }

          if (obj.rotationSpeed) {
              obj.rotation = ((obj.rotation || 0) + obj.rotationSpeed * deltaTime) % 360;
              if (obj.rotation < 0) obj.rotation += 360;
          }

          if (obj.scaleOscillation) {
              const time = (performance.now() - obj.scaleOscillation.startTime) / 1000;
              const offset = Math.sin(time * obj.scaleOscillation.speed) * obj.scaleOscillation.distance;
              obj.scaleX = Math.max(0.01, obj.scaleOscillation.initialScaleX + offset);
              obj.scaleY = Math.max(0.01, obj.scaleOscillation.initialScaleY + offset);
          } else {
              if (obj.scaleSpeedX) {
                  obj.scaleX = Math.max(0.01, (obj.scaleX ?? 1) + obj.scaleSpeedX * deltaTime);
              }
              if (obj.scaleSpeedY) {
                  obj.scaleY = Math.max(0.01, (obj.scaleY ?? 1) + obj.scaleSpeedY * deltaTime);
              }
          }

          if (!solidPre2D && obj.pendingMovements) {
              obj.pendingMovements.forEach(move => {
                  const speed = Number(move.speed || 0);
                  const direction = (move.direction || '').toLowerCase();
                  switch (direction) {
                      case 'right': obj.x += speed * deltaTime; break;
                      case 'left': obj.x -= speed * deltaTime; break;
                      case 'up': obj.y -= speed * deltaTime; break;
                      case 'down': obj.y += speed * deltaTime; break;
                  }
              });
              obj.pendingMovements = [];
          }

          if (draggingRef.current && draggingRef.current.id === obj.id) {
              obj.vx = 0;
              obj.vy = 0;
              return;
          }

          if(obj.isUI) {
              obj.x += (obj.vx || 0) * deltaTime;
              obj.y += (obj.vy || 0) * deltaTime;
              return;
          }

          const isCurrentControlled = currentControlledId === undefined || obj.id === currentControlledId;

          
          
          

          const platformer = obj.behaviors?.find(b => b.name === 'PlatformerCharacter');
          const hasRPGMovement = obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
          const rpgMovement = obj.behaviors?.find(b => b.name === 'TopDownRPGMovement');

          const isControllable = isCurrentControlled;

          let activeActions = actions;
          

          if (platformer && !hasRPGMovement) {
              let { speed, jumpForce } = platformer.properties;
              if (activeActions.run) {
                  speed *= 2;
              }

              // Check ladder and climber behavior
              const climber = obj.behaviors?.find(b => b.name === 'LadderClimber');
              const ladders = gameObjectsRef.current.filter(o => o.behaviors?.some(b => b.name === 'Ladder'));
              const isOverlappingLadder = ladders.some(ladder => {
                  const box1 = getCollisionBox({...obj, ...getObjectAbsolutePosition(obj.id, objectsById)});
                  const box2 = getCollisionBox({...ladder, ...getObjectAbsolutePosition(ladder.id, objectsById)});
                  return box1.x < box2.x + box2.width &&
                         box1.x + box1.width > box2.x &&
                         box1.y < box2.y + box2.height &&
                         box1.y + box1.height > box2.y;
              });

              if (!isOverlappingLadder) {
                  obj.isClimbing = false;
              } else if (climber && isControllable) {
                  const climbUpInput = activeActions.moveUp || (activeActions.moveVerticalIntensity && activeActions.moveVerticalIntensity < -0.3);
                  const climbDownInput = activeActions.moveDown || (activeActions.moveVerticalIntensity && activeActions.moveVerticalIntensity > 0.3);
                  if (climbUpInput || climbDownInput) {
                      obj.isClimbing = true;
                  }
              }

              if (isControllable) {
                  if (obj.isClimbing && climber) {
                      const climbSpeed = climber.properties?.speed ?? 100;
                      obj.vx = (activeActions.moveHorizontalIntensity || 0) * speed;
                      if ((obj.vx || 0) > 0) obj.direction = 'right';
                      if ((obj.vx || 0) < 0) obj.direction = 'left';

                      const climbUpInput = activeActions.moveUp || (activeActions.moveVerticalIntensity && activeActions.moveVerticalIntensity < -0.3);
                      const climbDownInput = activeActions.moveDown || (activeActions.moveVerticalIntensity && activeActions.moveVerticalIntensity > 0.3);
                      if (climbUpInput) {
                          obj.vy = -climbSpeed;
                      } else if (climbDownInput) {
                          obj.vy = climbSpeed;
                      } else {
                          obj.vy = 0; // Hanger
                      }

                      if (activeActions.jumpAction) {
                          obj.isClimbing = false;
                          obj.vy = -jumpForce;
                      }
                  } else {
                      const hasHorizInput = (activeActions.moveHorizontalIntensity || 0) !== 0;
                      if (hasHorizInput) {
                          obj.vx = (activeActions.moveHorizontalIntensity || 0) * speed;
                          (obj as any)._customVx = undefined;
                      } else if ((obj as any)._customVx !== undefined) {
                          obj.vx = (obj as any)._customVx;
                      } else {
                          obj.vx = 0;
                      }
                      if ((obj.vx || 0) > 0) obj.direction = 'right';
                      if ((obj.vx || 0) < 0) obj.direction = 'left';

                      if ((obj as any)._customVy !== undefined) {
                          obj.vy = (obj as any)._customVy;
                          (obj as any)._customVy = undefined;
                      }

                      // Double Jump logic
                      if (activeActions.jumpAction) {
                          if (obj.grounded) {
                              obj.vy = -jumpForce;
                              obj.grounded = false;
                              obj.doubleJumped = false;
                          } else if (!obj.doubleJumped && platformer.properties?.doubleJumpEnabled) {
                              obj.vy = -jumpForce;
                              obj.doubleJumped = true;
                          }
                      }
                  }
                  
                  if (isControllable && activeActions.attackAction) {
                      frameAttacks.current.push({ name: obj.name, id: obj.id });
                  }
              } else {
                  if ((obj as any)._customVx !== undefined) {
                      obj.vx = (obj as any)._customVx;
                  } else if (obj.vx === undefined) {
                      obj.vx = 0;
                  }
                  if ((obj.vx || 0) > 0) obj.direction = 'right';
                  if ((obj.vx || 0) < 0) obj.direction = 'left';

                  if ((obj as any)._customVy !== undefined) {
                      obj.vy = (obj as any)._customVy;
                      (obj as any)._customVy = undefined;
                  }
                  if (obj.isClimbing) {
                      obj.vy = 0;
                  }
              }
          }

          if (rpgMovement) {
              let { speed } = rpgMovement.properties;
              if (activeActions.run) {
                  speed *= 2;
              }
              
              if (isControllable) {
                  if (joystickState.current.active) {
                      const joystickSize = joystick?.size ?? 120;
                      const maxDistance = joystickSize / 2;
                      const intensity = joystickState.current.distance / maxDistance;
                      const angleRad = joystickState.current.angle * Math.PI / 180;
                      obj.vx = speed * intensity * Math.cos(angleRad);
                      obj.vy = speed * intensity * Math.sin(angleRad);
                      (obj as any)._customVx = undefined;
                      (obj as any)._customVy = undefined;
                      if (Math.abs(joystickState.current.angle) > 90) {
                          obj.direction = 'left';
                      } else {
                          obj.direction = 'right';
                      }
                  } else {
                      let inputVx = 0;
                      let inputVy = 0;
                      if (activeActions.moveLeft) { inputVx = -speed; obj.direction = 'left'; }
                      if (activeActions.moveRight) { inputVx = speed; obj.direction = 'right'; }
                      if (activeActions.moveUp) inputVy = -speed;
                      if (activeActions.moveDown) inputVy = speed;
                      
                      if (inputVx !== 0 && inputVy !== 0) {
                          inputVx /= Math.sqrt(2);
                          inputVy /= Math.sqrt(2);
                      }

                      if (inputVx !== 0 || inputVy !== 0) {
                          obj.vx = inputVx;
                          obj.vy = inputVy;
                          (obj as any)._customVx = undefined;
                          (obj as any)._customVy = undefined;
                      } else {
                          if ((obj as any)._customVx !== undefined) {
                              obj.vx = (obj as any)._customVx;
                          } else {
                              obj.vx = 0;
                          }
                          if ((obj as any)._customVy !== undefined) {
                              obj.vy = (obj as any)._customVy;
                          } else {
                              obj.vy = 0;
                          }
                      }
                  }
              } else {
                  if ((obj as any)._customVx !== undefined) {
                      obj.vx = (obj as any)._customVx;
                  } else if (obj.vx === undefined) {
                      obj.vx = 0;
                  }
                  if ((obj as any)._customVy !== undefined) {
                      obj.vy = (obj as any)._customVy;
                  } else if (obj.vy === undefined) {
                      obj.vy = 0;
                  }
              }

              // Apply decay impulse knockback!
              if (obj.rpgKnockbackVx || obj.rpgKnockbackVy) {
                  obj.vx = (obj.vx || 0) + (obj.rpgKnockbackVx || 0);
                  obj.vy = (obj.vy || 0) + (obj.rpgKnockbackVy || 0);
                  obj.rpgKnockbackVx = (obj.rpgKnockbackVx || 0) * 0.82;
                  obj.rpgKnockbackVy = (obj.rpgKnockbackVy || 0) * 0.82;
                  if (Math.abs(obj.rpgKnockbackVx) < 5) obj.rpgKnockbackVx = 0;
                  if (Math.abs(obj.rpgKnockbackVy) < 5) obj.rpgKnockbackVy = 0;
              }
          }

          const physics = obj.behaviors?.find(b => ['Physics', 'PlatformerCharacter', 'Boss'].includes(b.name || ''));
          
          // Carry object along with its standing moving platform BEFORE horizontal collision checks
          if ((rpgMovement || physics) && (obj as any)._standingPlatformId) {
              const plat2D = objectsById.get((obj as any)._standingPlatformId);
              if (plat2D) {
                  const isSticky2D = !(plat2D.behaviors?.some(b => (b.name === 'Oscillate' || b.name === 'Patrol') && b.properties?.sticky === false));
                  if (isSticky2D && (rpgMovement || (obj.vy || 0) >= -5)) {
                      obj.x += (plat2D as any)._platformDx || 0;
                      obj.y += (plat2D as any)._platformDy || 0;
                  }
              }
          }

          const preMoveX = obj.x;
          const preMoveY = obj.y;

          if (rpgMovement) {
            obj.x += (obj.vx || 0) * deltaTime;
            let currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
            let objWithAbsPosH = {...obj, ...currentAbsPos};
            for (const solidShape of staticCollisionShapes) {
                if (obj.id !== solidShape.owner.id) {
                    const hBoxRpg = getCollisionBox(objWithAbsPosH);
                    const pDyRpg = (solidShape.owner as any)._platformDy || 0;
                    const mtvH = getCollisionMTV2D(hBoxRpg, solidShape);
                    if (mtvH) {
                         if (pDyRpg < -0.001 && (hBoxRpg.y + hBoxRpg.height) <= (solidShape.y - pDyRpg) + 8) {
                             obj.y += (solidShape.y - hBoxRpg.height) - hBoxRpg.y;
                             (obj as any)._standingPlatformId = solidShape.owner.id;
                             currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                             objWithAbsPosH = {...obj, ...currentAbsPos};
                             continue;
                         }
                         frameCollisions.current.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnHorizontalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                         obj.x += mtvH.x;
                         obj.y += mtvH.y;
                         if (Math.abs(mtvH.x) >= Math.abs(mtvH.y)) obj.vx = 0;
                         currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                         objWithAbsPosH = {...obj, ...currentAbsPos};
                    }
                }
            }
            
            (obj as any)._standingPlatformId = null;
            obj.y += (obj.vy || 0) * deltaTime;
            currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
            let objWithAbsPosV = {...obj, ...currentAbsPos};
            for (const solidShape of staticCollisionShapes) {
                if (obj.id !== solidShape.owner.id) {
                    const verticalBox = getCollisionBox(objWithAbsPosV);
                    const mtvV = getCollisionMTV2D(verticalBox, solidShape);
                    if (mtvV) {
                         frameCollisions.current.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                         obj.x += mtvV.x;
                         obj.y += mtvV.y;
                         if (mtvV.y < 0) {
                             (obj as any)._standingPlatformId = solidShape.owner.id;
                         }
                         if (Math.abs(mtvV.y) >= Math.abs(mtvV.x)) obj.vy = 0;
                         currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                         objWithAbsPosV = {...obj, ...currentAbsPos};
                    }
                }
            }
          } else if (physics) {
              const wasGrounded2D = Boolean(obj.grounded);
              let currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
              let objWithAbsPos = {...obj, ...currentAbsPos};
              if ((obj.vy || 0) >= 0) {
                  for (const solidShape of staticCollisionShapes) {
                      if (obj.id === solidShape.owner.id) continue;
                      const pDy = (solidShape.owner as any)._platformDy || 0;
                      if (pDy < -0.001) {
                          const cBox = getCollisionBox(objWithAbsPos);
                          const overX = (cBox.x + 3) < (solidShape.x + solidShape.width) && (cBox.x + cBox.width - 3) > solidShape.x;
                          const prevTop = solidShape.y - pDy;
                          const feet = cBox.y + cBox.height;
                          if (overX && feet <= prevTop + 8 && feet > solidShape.y) {
                              obj.y += (solidShape.y - cBox.height) - cBox.y;
                              obj.vy = 0;
                              obj.grounded = true;
                              (obj as any)._standingPlatformId = solidShape.owner.id;
                              currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                              objWithAbsPos = {...obj, ...currentAbsPos};
                          }
                      }
                  }
              }

              // 1. UPDATE AND RESOLVE HORIZONTAL MOVEMENT FIRST
              obj.x += (obj.vx || 0) * deltaTime;
              currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
              objWithAbsPos = {...obj, ...currentAbsPos};

              for (const solidShape of staticCollisionShapes) {
                  if (obj.id !== solidShape.owner.id) {
                      const horizFullBox = getCollisionBox(objWithAbsPos);
                      const rotDegSolid = (solidShape.owner as any).absRotation !== undefined ? (solidShape.owner as any).absRotation : (solidShape.owner.rotation || 0);
                      const isRotatedSolid = Math.abs(rotDegSolid % 180) > 0.5 || !!(solidShape.owner.fixedColRotate || solidShape.owner.collision?.fixedColRotate);
                      if (isRotatedSolid) {
                          const surfaceY = getRotatedSurfaceY(horizFullBox.cx - horizFullBox.halfW, horizFullBox.halfW * 2, solidShape.owner);
                          if (surfaceY !== null) {
                              const playerBottom = horizFullBox.y + horizFullBox.height;
                              const rampSnapDownH = wasGrounded2D ? Math.max(28, Math.abs(obj.vx || 0) * deltaTime * 1.8 + 16) : 20;
                              if ((obj.vy || 0) >= 0 && playerBottom >= surfaceY - 26 && playerBottom <= surfaceY + rampSnapDownH) {
                                  obj.y += (surfaceY - horizFullBox.height) - horizFullBox.y;
                                  obj.grounded = true;
                                  obj.doubleJumped = false;
                                  obj.vy = 0;
                                  currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                  objWithAbsPos = {...obj, ...currentAbsPos};
                                  continue;
                              }
                          }
                      }

                      const horizontalBox = getCollisionBox(objWithAbsPos);
                      const shrinkAmountY = 3;
                      const adjustedBoxH = {
                          ...horizontalBox,
                          y: horizontalBox.y + shrinkAmountY,
                          height: Math.max(1, horizontalBox.height - 2 * shrinkAmountY),
                          halfH: Math.max(0.5, horizontalBox.halfH - shrinkAmountY),
                      };

                      const mtvH = getCollisionMTV2D(adjustedBoxH, solidShape);
                      if (mtvH) {
                          const platDy = (solidShape.owner as any)._platformDy || 0;
                          if ((obj.vy || 0) >= 0 && platDy < -0.001 && (horizontalBox.y + horizontalBox.height) <= (solidShape.y - platDy) + 8) {
                              obj.y += (solidShape.y - horizontalBox.height) - horizontalBox.y;
                              obj.vy = 0;
                              obj.grounded = true;
                              (obj as any)._standingPlatformId = solidShape.owner.id;
                              currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                              objWithAbsPos = {...obj, ...currentAbsPos};
                              continue;
                          }

                          const maxStepUp = Math.max(12, platDy < 0 ? Math.ceil(Math.abs(platDy)) + 12 : 12);
                          let steppedUp = false;
                          for (let step = 1; step <= maxStepUp; step++) {
                              const testBox = { ...adjustedBoxH, y: adjustedBoxH.y - step, cy: adjustedBoxH.cy - step };
                              if (!getCollisionMTV2D(testBox, solidShape)) {
                                  const clearedAll = staticCollisionShapes.every(otherShape => {
                                      if (obj.id === otherShape.owner.id) return true;
                                      const cStep = getCollisionBox({...objWithAbsPos, y: objWithAbsPos.y - step});
                                      const otherTestBox = { 
                                          ...cStep, 
                                          y: cStep.y + shrinkAmountY, 
                                          height: Math.max(1, cStep.height - 2 * shrinkAmountY),
                                          halfH: Math.max(0.5, cStep.halfH - shrinkAmountY),
                                      };
                                      return !getCollisionMTV2D(otherTestBox, otherShape);
                                  });
                                  if (clearedAll) {
                                      obj.y -= step;
                                      steppedUp = true;
                                      currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                      objWithAbsPos = {...obj, ...currentAbsPos};
                                      break;
                                  }
                              }
                          }
                          
                          if (!steppedUp) {
                              frameCollisions.current.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnHorizontalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                              if (isRotatedSolid && Math.abs(mtvH.x) > 0 && Math.abs(mtvH.y) > 0) {
                                  obj.x += mtvH.x;
                                  obj.y += mtvH.y;
                                  if (mtvH.y < 0) {
                                      obj.grounded = true;
                                      obj.doubleJumped = false;
                                  }
                              } else {
                                  obj.x += mtvH.x;
                                  obj.vx = 0;
                              }
                              currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                              objWithAbsPos = {...obj, ...currentAbsPos};
                          }
                      }
                  }
              }

              // 2. UPDATE AND RESOLVE VERTICAL MOVEMENT SECOND
              obj.grounded = false;
              (obj as any)._standingPlatformId = null;
              const gravity = (obj.isClimbing || obj.parentId) ? 0 : Number(physics.properties?.gravity !== undefined ? physics.properties.gravity : 500);
              if (!obj.isClimbing && !obj.parentId) {
                  obj.vy = (obj.vy || 0) + gravity * deltaTime;
              }
              const preMoveBoxV = getCollisionBox(objWithAbsPos);
              obj.y += (obj.vy || 0) * deltaTime;
              
              currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
              objWithAbsPos = {...obj, ...currentAbsPos};

              for (const solidShape of staticCollisionShapes) {
                  if (obj.id !== solidShape.owner.id) {
                      const verticalBox = getCollisionBox(objWithAbsPos);
                      const rotDegSolid = (solidShape.owner as any).absRotation !== undefined ? (solidShape.owner as any).absRotation : (solidShape.owner.rotation || 0);
                      const isRotatedSolid = Math.abs(rotDegSolid % 180) > 0.5 || !!(solidShape.owner.fixedColRotate || solidShape.owner.collision?.fixedColRotate);

                      if (isRotatedSolid) {
                          const surfaceY = getRotatedSurfaceY(verticalBox.cx - verticalBox.halfW, verticalBox.halfW * 2, solidShape.owner);
                          if (surfaceY !== null) {
                              const playerBottom = verticalBox.y + verticalBox.height;
                              const fallMargin = wasGrounded2D
                                  ? Math.max(24, Math.abs(obj.vx || 0) * deltaTime * 1.8 + Math.abs(obj.vy || 0) * deltaTime + 16)
                                  : Math.max(20, Math.abs(obj.vy || 0) * deltaTime + 14);
                              if ((obj.vy || 0) >= 0 && playerBottom >= surfaceY - 14 && playerBottom <= surfaceY + fallMargin) {
                                  frameCollisions.current.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                                  obj.y += (surfaceY - verticalBox.height) - verticalBox.y;
                                  obj.grounded = true;
                                  obj.doubleJumped = false;
                                  obj.vy = 0;
                                  (obj as any)._standingPlatformId = solidShape.owner.id;
                                  currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                  objWithAbsPos = {...obj, ...currentAbsPos};
                                  continue;
                              }
                          }
                      }

                      const shrinkAmountX = 3;
                      const adjustedBoxV = {
                          ...verticalBox,
                          x: verticalBox.x + shrinkAmountX,
                          width: Math.max(1, verticalBox.width - 2 * shrinkAmountX),
                          halfW: Math.max(0.5, verticalBox.halfW - shrinkAmountX),
                      };

                      const mtvV = getCollisionMTV2D(adjustedBoxV, solidShape);
                      if (mtvV) {
                          frameCollisions.current.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                          if (isRotatedSolid) {
                              obj.x += mtvV.x;
                              obj.y += mtvV.y;
                              if (mtvV.y < -0.25 * mtvV.depth && (obj.vy || 0) >= 0) {
                                  obj.grounded = true;
                                  obj.doubleJumped = false;
                                  obj.vy = 0;
                                  (obj as any)._standingPlatformId = solidShape.owner.id;
                              } else if (mtvV.y > 0.25 * mtvV.depth && (obj.vy || 0) < 0) {
                                  obj.vy = 0;
                              }
                          } else {
                              const vObjCenterY = verticalBox.y + verticalBox.height / 2;
                              const vSolidCenterY = solidShape.y + solidShape.height / 2;
                              const wasAbove = preMoveBoxV.y + preMoveBoxV.height <= solidShape.y + 1.5;
                              const wasBelow = preMoveBoxV.y >= solidShape.y + solidShape.height - 1.5;
                              if ((obj.vy || 0) >= 0 && (wasAbove || vObjCenterY <= vSolidCenterY + solidShape.height * 0.25)) {
                                  obj.y += (solidShape.y - verticalBox.height) - verticalBox.y;
                                  obj.grounded = true;
                                  obj.doubleJumped = false;
                                  obj.vy = 0;
                                  (obj as any)._standingPlatformId = solidShape.owner.id;
                              } else if ((obj.vy || 0) < 0 && (wasBelow || vObjCenterY >= vSolidCenterY)) {
                                  obj.y += (solidShape.y + solidShape.height) - verticalBox.y;
                                  obj.vy = 0;
                              }
                          }
                          currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                          objWithAbsPos = {...obj, ...currentAbsPos};
                      }
                  }
              }
          } else {
              // No specific movement behavior, just apply velocity
              obj.x += (obj.vx || 0) * deltaTime;
              obj.y += (obj.vy || 0) * deltaTime;
          }

          // Clamp to camera bounds if enabled and object is a player/moving character
          if (scene.cameraBounds?.enabled && !obj.isUI) {
              const hasMovement = obj.behaviors?.some(b => ['PlatformerCharacter', 'TopDownRPGMovement'].includes(b.name)) ||
                                  ['player', 'jugador', 'jugador_1', 'player_1'].includes(obj.name.toLowerCase());
              if (hasMovement) {
                  const bounds = scene.cameraBounds;
                  const minX = bounds.x;
                  const maxX = bounds.x + bounds.width - (obj.width || 0);
                  const minY = bounds.y;
                  const maxY = bounds.y + bounds.height - (obj.height || 0);

                  if (obj.x < minX) {
                      obj.x = minX;
                      obj.vx = 0;
                  }
                  if (obj.x > maxX) {
                      obj.x = maxX;
                      obj.vx = 0;
                  }
                  if (obj.y < minY) {
                      obj.y = minY;
                      obj.vy = 0;
                  }
                  if (obj.y > maxY) {
                      obj.y = maxY;
                      obj.vy = 0;
                  }
              }
          }

          // Post-physics unified automatic animations for Platformer and RPG characters
          const mpPlatBehav = obj.behaviors?.find(b => b.name === 'MultiplayerTag' && b.properties?.movementType === 'platformer');
          const platBehav = obj.behaviors?.find(b => b.name === 'PlatformerCharacter') || mpPlatBehav;
          const isPlayerControlled = platBehav || rpgMovement;
          const clearAutoAnim2D = (onlyAir: boolean) => {
              const currentAnim: any = activeAnimations.current.get(obj.id);
              if (!currentAnim) return;
              const animNameL = String(currentAnim.animation?.name || '').toLowerCase();
              const isAirAnim = currentAnim.autoKind === 'air' ||
                  animNameL.includes('jump') || animNameL.includes('salto') || animNameL.includes('saltar') || animNameL.includes('brinco') ||
                  animNameL.includes('fall') || animNameL.includes('caer') || animNameL.includes('caida') || animNameL.includes('caída');
              if (onlyAir ? (currentAnim.autoKind === 'air' || (isAirAnim && currentAnim.animation?.loop)) : currentAnim.animation?.loop) {
                  activeAnimations.current.delete(obj.id);
                  const originalObject = scene.gameObjects.find(o => o.id === obj.id);
                  if (originalObject) {
                      obj.imageUrl = originalObject.imageUrl;
                      obj.animOffsetX = 0;
                      obj.animOffsetY = 0;
                      obj.animRotation = 0;
                      obj.animScaleX = 1;
                      obj.animScaleY = 1;
                  }
              }
          };

          if (isPlayerControlled) {
                  const allObjAnims2D = [...animations, ...(obj.animations || [])];
                  const allPoseAnims = projectData?.poseAnimations || [];
                  const adaptPoseTo2D = (poseAnim: any) => {
                      if (!poseAnim || !poseAnim.frames || poseAnim.frames.length === 0) return null;
                      return {
                          id: poseAnim.id,
                          name: poseAnim.name,
                          loop: poseAnim.loop !== false,
                          frames: poseAnim.frames.map((f: any) => ({
                              assetId: f.assetId || '',
                              imageUrl: f.imageUrl,
                              duration: Math.max(20, Number(f.duration) || 150),
                              x: (f.position?.x || 0) * 50,
                              y: -(f.position?.y || 0) * 50,
                              rotation: f.rotation?.z || f.rotation?.y || 0,
                              scaleX: f.scale?.x ?? 1,
                              scaleY: f.scale?.y ?? 1,
                          })),
                      };
                  };
                  const resolve2DAnimByIdOrKeywords = (preferredId?: string, keywords?: string[]) => {
                      if (preferredId) {
                          const byId = allObjAnims2D.find(a => (String(a.id) === String(preferredId) || a.name === preferredId) && a.frames && a.frames.length > 0);
                          if (byId) return byId;
                          const poseMatch = allPoseAnims.find(p => (String(p.id) === String(preferredId) || p.name === preferredId) && p.frames && p.frames.length > 0);
                          if (poseMatch) return adaptPoseTo2D(poseMatch);
                      }
                      if (keywords && keywords.length > 0) {
                          const objL = (obj.name || '').toLowerCase();
                          const withObjName = allObjAnims2D.find(a => {
                              if (!a.frames || a.frames.length === 0) return false;
                              const nl = (a.name || '').toLowerCase();
                              return nl.includes(objL) && keywords.some(kw => nl.includes(kw));
                          });
                          if (withObjName) return withObjName;
                          const anyAnim = allObjAnims2D.find(a => {
                              if (!a.frames || a.frames.length === 0) return false;
                              const nl = (a.name || '').toLowerCase();
                              return keywords.some(kw => nl.includes(kw));
                          });
                          if (anyAnim) return anyAnim;
                      }
                      return null;
                  };

                  const activeBehav = rpgMovement || platBehav;
                  const idleAnimId = activeBehav?.properties?.idleAnimId;
                  const runAnimId = activeBehav?.properties?.runAnimId;
                  const jumpAnimId = activeBehav?.properties?.jumpAnimId;
                  const fallAnimId = activeBehav?.properties?.fallAnimId;
                  const attackAnimId = activeBehav?.properties?.attackAnimId;

                  const isAttackingNow = (isControllable && activeActions.attackAction) || frameAttacks.current.some(a => a.id === obj.id);
                  const nowTime = performance.now();

                  // 1. Resolve Attack Animation
                  if (isAttackingNow) {
                      const matchingAttackAnim = resolve2DAnimByIdOrKeywords(attackAnimId, ['attack', 'atacar', 'golpe']);

                      let attackDuration = 350;
                      if (matchingAttackAnim) {
                          attackDuration = matchingAttackAnim.frames.reduce((sum: number, f: any) => sum + Math.max(20, Number(f?.duration) || 100), 0);
                          if (attackDuration <= 0) attackDuration = 350;
                      }

                      obj.rpgAttackEndTime = nowTime + attackDuration;

                      if (matchingAttackAnim) {
                          const currentAnim = activeAnimations.current.get(obj.id);
                          if (!currentAnim || String(currentAnim.animation.id) !== String(matchingAttackAnim.id)) {
                              const animCopy = JSON.parse(JSON.stringify(matchingAttackAnim));
                              animCopy.loop = false;
                              activeAnimations.current.set(obj.id, {
                                  animation: animCopy,
                                  startTime: nowTime,
                                  startedContinuous: false,
                                  isOneShotProtected: true,
                                  isAutoAnim: true,
                                  autoKind: 'attack',
                              } as any);
                          }
                      }
                  }

                  const isCurrentlyAttacking = nowTime < (obj.rpgAttackEndTime || 0);
                  const hasScriptAnimActive = (obj as any)._scriptAnimTime && (nowTime - (obj as any)._scriptAnimTime < 120);

                  if (!isCurrentlyAttacking && !hasScriptAnimActive) {
                      // 2. Resolve Jump / Fall Animation (Platformer only, when not grounded and not climbing)
                      const isJumpingState = platBehav && !obj.grounded && !obj.isClimbing;
                      
                      if (isJumpingState) {
                          const isFalling2D = (obj.vy || 0) > 0.5;
                          let targetAirAnim: any = undefined;

                          if (isFalling2D) {
                              targetAirAnim = resolve2DAnimByIdOrKeywords(fallAnimId, ['fall', 'caer', 'caida', 'caída']) ||
                                  resolve2DAnimByIdOrKeywords(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']);
                          } else {
                              targetAirAnim = resolve2DAnimByIdOrKeywords(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']) ||
                                  resolve2DAnimByIdOrKeywords(fallAnimId, ['fall', 'caer', 'caida', 'caída']);
                          }

                          if (targetAirAnim) {
                              const currentAnim = activeAnimations.current.get(obj.id);
                              if (!currentAnim || String(currentAnim.animation.id) !== String(targetAirAnim.id)) {
                                  const animCopy = JSON.parse(JSON.stringify(targetAirAnim));
                                  animCopy.loop = true;
                                  activeAnimations.current.set(obj.id, {
                                      animation: animCopy,
                                      startTime: nowTime,
                                      startedContinuous: true,
                                      isOneShotProtected: false,
                                      isAutoAnim: true,
                                      autoKind: 'air',
                                  } as any);
                              }
                          }
                      }
                      // 3. Resolve Running / Walking Animation
                      else if (Math.abs(obj.vx || 0) > 1 || (platBehav ? false : Math.abs(obj.vy || 0) > 1)) {
                          const matchingWalkAnim = resolve2DAnimByIdOrKeywords(runAnimId, ['walk', 'run', 'move', 'caminar', 'correr', 'moverse']);

                          if (matchingWalkAnim) {
                              const currentAnim = activeAnimations.current.get(obj.id);
                              if (!currentAnim || String(currentAnim.animation.id) !== String(matchingWalkAnim.id)) {
                                  const animCopy = JSON.parse(JSON.stringify(matchingWalkAnim));
                                  animCopy.loop = true;
                                  activeAnimations.current.set(obj.id, {
                                      animation: animCopy,
                                      startTime: nowTime,
                                      startedContinuous: true,
                                      isOneShotProtected: false,
                                      isAutoAnim: true,
                                      autoKind: 'run',
                                  } as any);
                              }
                          } else {
                              clearAutoAnim2D(true);
                          }
                      }
                      // 4. Resolve Idle Animation
                      else {
                          const matchingIdleAnim = resolve2DAnimByIdOrKeywords(idleAnimId, ['idle', 'quieto', 'parado', 'stand', 'reposo']);

                          if (matchingIdleAnim) {
                              const currentAnim = activeAnimations.current.get(obj.id);
                              if (!currentAnim || String(currentAnim.animation.id) !== String(matchingIdleAnim.id)) {
                                  const animCopy = JSON.parse(JSON.stringify(matchingIdleAnim));
                                  animCopy.loop = true;
                                  activeAnimations.current.set(obj.id, {
                                      animation: animCopy,
                                      startTime: nowTime,
                                      startedContinuous: true,
                                      isOneShotProtected: false,
                                      isAutoAnim: true,
                                      autoKind: 'idle',
                                  } as any);
                              }
                          } else {
                              clearAutoAnim2D(false);
                          }
                      }
                  }
          } else {
              clearAutoAnim2D(false);
          }

                });

      if (!is3DModeRef.current) {
          gameObjectsRef.current.forEach(obj => {
              obj.scripts?.forEach(script => {
                  const scriptId = script.id || script.trigger;
                  if (!['OnStart', 'OnClick', 'OnCollisionWith', 'OnTimerElapsed', 'OnObjectReleased', 'OnUpdate', 'Always'].includes(script.trigger)) {
                      const mockCondition: Condition = {
                          trigger: script.trigger as any,
                          object: obj.name,
                          params: script.params,
                          target: script.params?.targetObjectName
                      };
                      if (checkCondition(mockCondition, obj)) {
                          executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                      }
                  }
              });
          });
      }

      const allObjectsWithAbsPosForCollision = gameObjectsRef.current.map(o => ({...o, ...getObjectAbsolutePosition(o.id, objectsById)}));
      const nonUiObjects = allObjectsWithAbsPosForCollision.filter(o => !o.isUI && (o.isTouchable ?? true));

      for (let i = 0; i < nonUiObjects.length; i++) {
          for (let j = i + 1; j < nonUiObjects.length; j++) {
              const obj1 = nonUiObjects[i];
              const obj2 = nonUiObjects[j];

              const isHit = (previewMode === '3d') 
                  ? checkCollision3D(obj1, obj2) 
                  : isColliding(getCollisionBox(obj1), getCollisionBox(obj2));

              if (isHit) {
                  frameCollisions.current.push({ obj1Name: obj1.name, obj2Name: obj2.name, type: 'OnCollisionWith', obj1Id: obj1.id, obj2Id: obj2.id });
                  
                  const originalObj1 = gameObjectsRef.current.find(o => o.id === obj1.id);
                  const originalObj2 = gameObjectsRef.current.find(o => o.id === obj2.id);

                   if (originalObj1) {
                       const targetsDict: Record<string, GameObject[]> = originalObj2 ? { [originalObj2.name]: [originalObj2] } : {};
                       originalObj1.scripts?.forEach(script => {
                           if (script.trigger === 'OnCollisionWith' && (!script.params?.targetObjectName || script.params.targetObjectName === originalObj2?.name)) {
                               const scriptId = script.id || script.trigger;
                               executeActionsSequential(script.actions, originalObj1, false, deltaTime, false, targetsDict, `obj-${originalObj1.id}-script-${scriptId}`);
                           }
                       });
                   }

                   if (originalObj2) {
                       const targetsDict: Record<string, GameObject[]> = originalObj1 ? { [originalObj1.name]: [originalObj1] } : {};
                       originalObj2.scripts?.forEach(script => {
                           if (script.trigger === 'OnCollisionWith' && (!script.params?.targetObjectName || script.params.targetObjectName === originalObj1?.name)) {
                               const scriptId = script.id || script.trigger;
                               executeActionsSequential(script.actions, originalObj2, false, deltaTime, false, targetsDict, `obj-${originalObj2.id}-script-${scriptId}`);
                           }
                       });
                   }
              }
          }
      }

      for (const gp of gamepads) {
          if (!gp) continue;
          
          const getButtonName = (idx: number) => {
              const mapping: Record<number, string> = {
                  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 
                  4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2',
                  8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3',
                  12: 'DpadUp', 13: 'DpadDown', 14: 'DpadLeft', 15: 'DpadRight',
                  16: 'Home', 17: 'Capture'
              };
              return mapping[idx] || `button_${idx}`;
          };

          gp.buttons.forEach((btn, idx) => {
              const btnKey = `gp_${gp.index}_${idx}`;
              const name = getButtonName(idx);
              const isBtnPressed = !!(btn && (btn.pressed || ((idx === 6 || idx === 7) && btn.value > 0.3)));
              const wasPressed = !!gamepadButtonStateRef.current[btnKey];
              if (isBtnPressed) {
                  if (!wasPressed) {
                      frameButtonDown.current.push(name, `button_${idx}`);
                      if (idx === 6) { frameButtonDown.current.push('ZL'); frameTriggerDown.current.push('L2', 'ZL', 'LT'); }
                      if (idx === 7) { frameButtonDown.current.push('ZR'); frameTriggerDown.current.push('R2', 'ZR', 'RT'); }
                      if (idx === 8) frameButtonDown.current.push('Minus');
                      if (idx === 9) frameButtonDown.current.push('Plus');
                      if (idx === 4) frameButtonDown.current.push('L');
                      if (idx === 5) frameButtonDown.current.push('R');
                      gamepadButtonStateRef.current[btnKey] = true;
                  }
              } else if (wasPressed) {
                  frameButtonUp.current.push(name, `button_${idx}`);
                  if (idx === 6) { frameButtonUp.current.push('ZL'); frameTriggerUp.current.push('L2', 'ZL', 'LT'); }
                  if (idx === 7) { frameButtonUp.current.push('ZR'); frameTriggerUp.current.push('R2', 'ZR', 'RT'); }
                  if (idx === 8) frameButtonUp.current.push('Minus');
                  if (idx === 9) frameButtonUp.current.push('Plus');
                  if (idx === 4) frameButtonUp.current.push('L');
                  if (idx === 5) frameButtonUp.current.push('R');
                  gamepadButtonStateRef.current[btnKey] = false;
              }
          });
          if (gp.axes.length >= 2) {
              const x = gp.axes[0], y = gp.axes[1];
              if (Math.abs(x) > 0.3 || Math.abs(y) > 0.3) {
                  frameJoystickEvents.current.push('move');
                  if (x > 0.3) { frameJoystickEvents.current.push('right'); }
                  if (x < -0.3) { frameJoystickEvents.current.push('left'); }
                  if (y > 0.3) { frameJoystickEvents.current.push('down'); }
                  if (y < -0.3) { frameJoystickEvents.current.push('up'); }
              }
          }
      }

      // Check for interactables near player
      const playerObjForInteract = gameObjectsRef.current.find(o => o.behaviors?.some(b => b.name === 'Player3D' || b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement'));
      let currentActiveInteractable: { id: number; name: string; prompt: string } | null = null;
      
      if (playerObjForInteract) {
          const interactables = gameObjectsRef.current.filter(o => o.behaviors?.some(b => b.name === 'Interactable'));
          let minDistance = Infinity;
          for (const item of interactables) {
              const dist = is3DModeRef.current
                  ? Math.hypot(
                      getObject3DPosition(item).x - getObject3DPosition(playerObjForInteract).x,
                      getObject3DPosition(item).y - getObject3DPosition(playerObjForInteract).y,
                      getObject3DPosition(item).z - getObject3DPosition(playerObjForInteract).z
                    ) * 50
                  : Math.hypot(item.x - playerObjForInteract.x, item.y - playerObjForInteract.y);
              const interactBehav = item.behaviors?.find(b => b.name === 'Interactable');
              const radius = Number(interactBehav?.properties?.radius || 60);
              
              if (dist <= radius && dist < minDistance) {
                  minDistance = dist;
                  currentActiveInteractable = {
                      id: item.id,
                      name: item.name,
                      prompt: String(interactBehav?.properties?.prompt || 'Interactuar [E]')
                  };
              }
          }
      }
      
      if (activeInteractableRef.current?.id !== currentActiveInteractable?.id) {
          activeInteractableRef.current = currentActiveInteractable;
          setActiveInteractable(currentActiveInteractable);
      }

      if (is3DModeRef.current) {
          gameObjectsRef.current.forEach(o => {
              (o as any)._preEvt = {
                  x: o.x,
                  y: o.y,
                  zIndex: o.zIndex || 0,
                  rotation: o.rotation || 0,
                  scaleX: o.scaleX ?? 1,
                  scaleY: o.scaleY ?? 1,
              };
              (o as any)._mutatedBy3DAction = false;
          });
      }

      evaluateEvents(deltaTime);
      stepActiveSequences(deltaTime);

      if (is3DModeRef.current) {
          gameObjectsRef.current.forEach(o => {
              if (!o.isUI) {
                  const pre = (o as any)._preEvt;
                  if (pre && !(o as any)._mutatedBy3DAction) {
                      const pos = getObject3DPosition(o);
                      const rot = getObject3DRotation(o);
                      let changed2D = false;
                      if (o.x !== pre.x) {
                          pos.x += (o.x - pre.x) / 50;
                          changed2D = true;
                      }
                      if (o.y !== pre.y) {
                          pos.z += (o.y - pre.y) / 50;
                          changed2D = true;
                      }
                      if ((o.zIndex || 0) !== pre.zIndex) {
                          pos.y += ((o.zIndex || 0) - pre.zIndex) * 0.1;
                          changed2D = true;
                      }
                      if ((o.rotation || 0) !== pre.rotation) {
                          rot.y += (((o.rotation || 0) - pre.rotation) * Math.PI) / 180;
                          o.rotation3D = rot;
                          changed2D = true;
                      }
                      if (((o.scaleX ?? 1) !== pre.scaleX && pre.scaleX > 0) || ((o.scaleY ?? 1) !== pre.scaleY && pre.scaleY > 0)) {
                          const dCur = getObject3DDimensions(o);
                          const nextScale3D = { x: dCur.w, y: dCur.h, z: dCur.d };
                          if ((o.scaleX ?? 1) !== pre.scaleX && pre.scaleX > 0) {
                              nextScale3D.x = Math.max(0.05, dCur.w * ((o.scaleX ?? 1) / pre.scaleX));
                          }
                          if ((o.scaleY ?? 1) !== pre.scaleY && pre.scaleY > 0) {
                              nextScale3D.z = Math.max(0.05, dCur.d * ((o.scaleY ?? 1) / pre.scaleY));
                          }
                          o.scale3D = nextScale3D;
                          changed2D = true;
                      }
                      if (changed2D) {
                          o.position3D = pos;
                          (o as any)._moved3DThisFrame = true;
                      }
                  }
                  if ((o as any)._customVx !== undefined && !o.vx3D) {
                      o.vx3D = Number((o as any)._customVx) / 50;
                  }
                  if ((o as any)._customVy !== undefined && !o.vz3D) {
                      o.vz3D = Number((o as any)._customVy) / 50;
                  }
                  if ((o as any)._moved3DThisFrame && !isSolidObject3D(o)) {
                      (o as any)._moved3DThisFrame = false;
                      resolve3DSolidsForObject(o, 0, 0, 0, 0, false, false);
                  }
                  sync3DTo2D(o);
              }
              delete (o as any)._preEvt;
              delete (o as any)._mutatedBy3DAction;
          });
      }

      // Record end-of-frame solid positions so even event-driven solid platforms have accurate deltas next frame
      gameObjectsRef.current.forEach(s => {
          (s as any)._solidUpdatedInPrepass = false;
          (s as any)._solidUpdatedInPrepass3D = false;
          if (!s.isUI && (s.behaviors?.some(b => b.name === 'Solid') || isSolidObject3D(s))) {
              (s as any)._lastSolidX = s.x;
              (s as any)._lastSolidY = s.y;
              if (s.position3D) {
                  (s as any)._lastSolidPos3D = { ...s.position3D };
              }
          }
      });

      frameKeyPresses.current = [];
      frameKeyReleases.current = [];
      frameCollisions.current = [];
      frameClicks.current = [];
      frameObjectReleases.current = [];
      frameInteractions.current = [];
      frameTimerEvents.current = [];
      frameAttacks.current = [];
      frameDialogueEnd.current = false;
      frameButtonDown.current = [];
      frameButtonUp.current = [];
      frameTriggerDown.current = [];
      frameTriggerUp.current = [];
      frameConsoleCommands.current = [];
      framePlayerJoined.current = false;
      framePlayerLeft.current = false;
      frameMatchFound.current = false;
      frameReceiveNetworkMessage.current = false;

      const getAnimFrameDuration = (f: any) => Math.max(20, Number(f?.duration) || 100);
      activeAnimations.current.forEach((activeAnim, objId) => {
        const obj = gameObjectsRef.current.find(o => o.id === objId);
        if (!obj || !activeAnim.animation || !activeAnim.animation.frames || activeAnim.animation.frames.length === 0) {
            activeAnimations.current.delete(objId);
            return;
        }

        const totalDuration = activeAnim.animation.frames.reduce((sum, f) => sum + getAnimFrameDuration(f), 0);
        if (totalDuration <= 0) {
            activeAnimations.current.delete(objId);
            return;
        }

        const elapsed = now - activeAnim.startTime;

        if (elapsed >= totalDuration) {
            if (activeAnim.animation.loop) {
                activeAnim.startTime = now - (elapsed % totalDuration);
            } else {
                activeAnimations.current.delete(objId);
                const originalObject = scene.gameObjects.find(o => o.id === objId);
                if (originalObject) {
                    obj.imageUrl = originalObject.imageUrl;
                    obj.animOffsetX = 0;
                    obj.animOffsetY = 0;
                    obj.animRotation = 0;
                    obj.animScaleX = 1;
                    obj.animScaleY = 1;
                }
                return;
            }
        }

        const currentElapsed = (now - activeAnim.startTime) % totalDuration;
        let cumulativeTime = 0;
        let currentFrameIndex = 0;
        for (let i = 0; i < activeAnim.animation.frames.length; i++) {
            cumulativeTime += getAnimFrameDuration(activeAnim.animation.frames[i]);
            if (currentElapsed < cumulativeTime) {
                currentFrameIndex = i;
                break;
            }
        }
        
        const currentFrame = activeAnim.animation.frames[currentFrameIndex];
        const nextFrameIndex = (currentFrameIndex + 1) % activeAnim.animation.frames.length;
        const nextFrame = activeAnim.animation.frames[nextFrameIndex];

        const curFrameDur = getAnimFrameDuration(currentFrame);
        const frameStartTime = cumulativeTime - curFrameDur;
        const frameElapsed = Math.max(0, currentElapsed - frameStartTime);
        const t = frameElapsed / curFrameDur;

        if (currentFrame) {
            const asset = currentFrame.assetId
                ? assets.find(a => String(a.id) === String(currentFrame.assetId) || a.name === currentFrame.assetId || a.url === currentFrame.assetId)
                : null;
            if (asset && asset.url) obj.imageUrl = asset.url;
            else if ((currentFrame as any).imageUrl) obj.imageUrl = (currentFrame as any).imageUrl;
            
            const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
            const shouldInterpolate = activeAnim.animation.loop || currentFrameIndex < activeAnim.animation.frames.length - 1;
            
            obj.animOffsetX = shouldInterpolate ? lerp(currentFrame.x ?? 0, nextFrame.x ?? currentFrame.x ?? 0, t) : (currentFrame.x ?? 0);
            obj.animOffsetY = shouldInterpolate ? lerp(currentFrame.y ?? 0, nextFrame.y ?? currentFrame.y ?? 0, t) : (currentFrame.y ?? 0);
            obj.animRotation = shouldInterpolate ? lerp(currentFrame.rotation ?? 0, nextFrame.rotation ?? currentFrame.rotation ?? 0, t) : (currentFrame.rotation ?? 0);
            obj.animScaleX = shouldInterpolate ? lerp(currentFrame.scaleX ?? 1, nextFrame.scaleX ?? currentFrame.scaleX ?? 1, t) : (currentFrame.scaleX ?? 1);
            obj.animScaleY = shouldInterpolate ? lerp(currentFrame.scaleY ?? 1, nextFrame.scaleY ?? currentFrame.scaleY ?? 1, t) : (currentFrame.scaleY ?? 1);
        }
      });

      // Apply dynamic sword swing rotation effect
      gameObjectsRef.current.forEach(obj => {
          if (obj.attackEndTime !== undefined && Date.now() < obj.attackEndTime) {
              const remaining = obj.attackEndTime - Date.now();
              const progress = Math.max(0, Math.min(1, remaining / 150));
              const swingAngle = 45 * progress;
              obj.animRotation = (obj.direction === 'left' ? -swingAngle : swingAngle);
          }
      });
      
      const currentUiObjects = gameObjectsRef.current.filter(o => o.isUI);
      currentUiObjects.forEach(uiObj => {
          const scB = uiObj.behaviors?.find(b => b.name === 'ScoreCounter');
          if (scB) {
              const varN = String(scB.properties?.variableName || 'score').trim() || 'score';
              const fmt = scB.properties?.format || 'Score: {value}';
              const val = gameVariables.current[varN] ?? 0;
              uiObj.text = String(fmt).replace('{value}', String(val));
          }
          const tvB = uiObj.behaviors?.find(b => b.name === 'TextVariable');
          if (tvB) {
              const varN = String(tvB.properties?.variableName || '').trim();
              const prefix = tvB.properties?.prefix || '';
              const suffix = tvB.properties?.suffix || '';
              const val = varN ? (gameVariables.current[varN] ?? 0) : '';
              uiObj.text = `${prefix || ''}${val}${suffix || ''}`;
          }
      });
      if (currentUiObjects.length > 0) {
          setUiObjects([...currentUiObjects]);
      } else if (uiObjects.length > 0) {
          setUiObjects([]);
      }
      
      let followTarget = gameObjectsRef.current.find(o => o.behaviors?.some(b => b.name === 'FollowCamera'));
      if (scene.cameraBounds?.enabled) {
          const bounds = scene.cameraBounds;
          const zoomedWidth = canvas.width / camera.current.zoom;
          const zoomedHeight = canvas.height / camera.current.zoom;
          
          let targetX = bounds.x + bounds.width / 2;
          let targetY = bounds.y + bounds.height / 2;

          if (followTarget) {
              const followTargetWithAbsPos = {...followTarget, ...getObjectAbsolutePosition(followTarget.id, objectsById)};
              const collisionBox = getCollisionBox(followTargetWithAbsPos);
              targetX = collisionBox.x + collisionBox.width / 2;
              targetY = collisionBox.y + collisionBox.height / 2;
          }

          if (bounds.width < zoomedWidth) {
              camera.current.x = bounds.x + bounds.width / 2;
          } else {
              const minCamX = bounds.x + zoomedWidth / 2;
              const maxCamX = bounds.x + bounds.width - zoomedWidth / 2;
              camera.current.x = Math.max(minCamX, Math.min(targetX, maxCamX));
          }

          if (bounds.height < zoomedHeight) {
              camera.current.y = bounds.y + bounds.height / 2;
          } else {
              const minCamY = bounds.y + zoomedHeight / 2;
              const maxCamY = bounds.y + bounds.height - zoomedHeight / 2;
              camera.current.y = Math.max(minCamY, Math.min(targetY, maxCamY));
          }
      } else if (followTarget) {
          const followTargetWithAbsPos = {...followTarget, ...getObjectAbsolutePosition(followTarget.id, objectsById)};
          const collisionBox = getCollisionBox(followTargetWithAbsPos);
          camera.current.x = collisionBox.x + collisionBox.width / 2;
          camera.current.y = collisionBox.y + collisionBox.height / 2;
      } else {
          camera.current.x = (initialGameWidth || 1024) / 2;
          camera.current.y = (initialGameHeight || 768) / 2;
      }


      if (is3DModeRef.current && threeRendererRef.current && threeSceneRef.current && threeCameraRef.current) {
          const tScene = threeSceneRef.current;
          const tCam = threeCameraRef.current;
          const tRenderer = threeRendererRef.current;
          const tControls = threeControlsRef.current;

          const bgHex = runtimeBgColorRef.current || '#111827';
          const skyUrl = camera3DRuntimeRef.current.skyboxImageUrl || '';
          if (skyUrl) {
              if (threeSkyboxUrlRef.current !== skyUrl) {
                  threeSkyboxUrlRef.current = skyUrl;
                  const loader = new THREE.TextureLoader();
                  loader.load(
                      skyUrl,
                      (tex) => {
                          if (threeSkyboxUrlRef.current !== skyUrl || !threeSceneRef.current) {
                              tex.dispose();
                              return;
                          }
                          if (threeSkyboxTextureRef.current && threeSkyboxTextureRef.current !== tex) {
                              threeSkyboxTextureRef.current.dispose();
                          }
                          tex.mapping = THREE.EquirectangularReflectionMapping;
                          tex.colorSpace = THREE.SRGBColorSpace;
                          tex.needsUpdate = true;
                          threeSkyboxTextureRef.current = tex;
                          threeSceneRef.current.background = tex;
                      },
                      undefined,
                      () => {}
                  );
              } else if (threeSkyboxTextureRef.current && tScene.background !== threeSkyboxTextureRef.current) {
                  tScene.background = threeSkyboxTextureRef.current;
              }
          } else {
              if (threeSkyboxUrlRef.current) {
                  threeSkyboxUrlRef.current = '';
                  if (threeSkyboxTextureRef.current) {
                      threeSkyboxTextureRef.current.dispose();
                      threeSkyboxTextureRef.current = null;
                  }
              }
              if (!(tScene.background instanceof THREE.Color) || '#' + tScene.background.getHexString() !== bgHex.toLowerCase()) {
                  try {
                      tScene.background = new THREE.Color(bgHex);
                  } catch {}
              }
          }

          if (threeAmbientLightRef.current) {
              threeAmbientLightRef.current.intensity = scene.ambientLightIntensity ?? 0.65;
          }
          if (threeSunLightRef.current) {
              threeSunLightRef.current.intensity = scene.sunLightIntensity ?? 1.25;
          }

          if (camera3DRuntimeRef.current.fogEnabled) {
              const fCol = camera3DRuntimeRef.current.fogColor || bgHex;
              const fDen = camera3DRuntimeRef.current.fogDensity ?? 0.02;
              if (!(tScene.fog instanceof THREE.FogExp2)) {
                  tScene.fog = new THREE.FogExp2(fCol, fDen);
              } else {
                  tScene.fog.color.set(fCol);
                  tScene.fog.density = fDen;
              }
          } else if (tScene.fog) {
              tScene.fog = null;
          }

          const active3DIds = new Set<number>();
          gameObjectsRef.current.forEach(obj => {
              if (obj.isUI) return;
              active3DIds.add(obj.id);

              let animPosOffsetX = 0;
              let animPosOffsetY = 0;
              let animPosOffsetZ = 0;
              let animRotOffsetX = 0;
              let animRotOffsetY = 0;
              let animRotOffsetZ = 0;
              let animScaleX = 1;
              let animScaleY = 1;
              let animScaleZ = 1;
              let pendingFrameClip: { name: string; loop: boolean; speed: number } | null = null;

              const activePose = activePoseAnimationsRef.current.get(obj.id);
              if (activePose && activePose.poseAnimation.frames && activePose.poseAnimation.frames.length > 0) {
                  const frames = activePose.poseAnimation.frames;
                  const totalMs = frames.reduce((sum, f) => sum + Math.max(20, Number(f.duration) || 300), 0);
                  const rawElapsed = Math.max(0, (performance.now() - activePose.startTime) * (activePose.speed || 1));
                  if (!activePose.loop && rawElapsed >= totalMs) {
                      activePose.finished = true;
                  }
                  const sampled = samplePoseTimeline(frames, rawElapsed, activePose.loop);

                  animPosOffsetX = sampled.position.x || 0;
                  animPosOffsetY = sampled.position.y || 0;
                  animPosOffsetZ = sampled.position.z || 0;
                  animRotOffsetX = THREE.MathUtils.degToRad(sampled.rotation.x || 0);
                  animRotOffsetY = THREE.MathUtils.degToRad(sampled.rotation.y || 0);
                  animRotOffsetZ = THREE.MathUtils.degToRad(sampled.rotation.z || 0);
                  animScaleX = Math.max(0.05, sampled.scale.x || 1);
                  animScaleY = Math.max(0.05, sampled.scale.y || 1);
                  animScaleZ = Math.max(0.05, sampled.scale.z || 1);

                  const vf = sampled.visualFrame;
                  if (vf && vf.id !== activePose.lastVisualFrameId) {
                      activePose.lastVisualFrameId = vf.id;
                      const origV = activePose.origVisual || {};
                      const preservedModelUrl = origV.modelUrl || obj.modelUrl;
                      const origShape = origV.shape3D || inferShape3D({ ...obj, shape3D: undefined });
                      const origColor = origV.color || '';
                      const origEmissive = origV.emissive3D || '';
                      const origEmissiveInt = origV.emissiveIntensity3D || 0;

                      const hasModelMorph = frames.some(f => Boolean(f.modelUrl) && f.modelUrl !== (origV.modelUrl || ''));
                      const activeFrameModelUrl = vf.modelUrl || (hasModelMorph ? origV.modelUrl : preservedModelUrl);
                      const hasShapeMorph = !activeFrameModelUrl && frames.some(f => Boolean(f.shape3D) && f.shape3D !== origShape);
                      const hasColorMorph = frames.some(f => Boolean(f.color) && f.color !== origColor);
                      const hasEmissiveMorph = frames.some(f => (f.emissive3D || '') !== origEmissive || (f.emissiveIntensity3D || 0) !== origEmissiveInt);

                      if (hasShapeMorph && vf.shape3D) obj.shape3D = vf.shape3D;
                      if (hasColorMorph && vf.color) obj.color = vf.color;
                      if (hasEmissiveMorph) {
                          obj.emissive3D = vf.emissive3D;
                          obj.emissiveIntensity3D = vf.emissiveIntensity3D;
                      }
                      if (hasModelMorph && vf.modelUrl) {
                          obj.modelUrl = vf.modelUrl;
                      } else if (origV.modelUrl && !vf.modelUrl) {
                          obj.modelUrl = origV.modelUrl;
                      }
                      if (vf.modelAnimName) {
                          pendingFrameClip = {
                              name: vf.modelAnimName,
                              loop: activePose.loop,
                              speed: Number(vf.modelAnimSpeed ?? activePose.speed ?? 1) || 1,
                          };
                          (obj as any)._runtimeAnim3D = pendingFrameClip;
                      }
                  }
              }

              const sig = build3DVisualSignature(obj);
              const dims3 = getObject3DDimensions(obj);
              const dimsSig = `${dims3.w.toFixed(3)}|${dims3.h.toFixed(3)}|${dims3.d.toFixed(3)}`;
              const existing = threeMeshMapRef.current.get(obj.id);
              let group: THREE.Group;
              if (
                  existing &&
                  obj.modelUrl &&
                  existing.group.userData.loadedModelUrl === obj.modelUrl &&
                  existing.group.userData._dimsSig === dimsSig
              ) {
                  group = existing.group;
                  if (existing.signature !== sig) {
                      applyMaterialTintToGroup(group, obj, false);
                      existing.signature = sig;
                  }
              } else if (!existing || existing.signature !== sig) {
                  if (existing && obj.modelUrl && !getCachedGLTFSync(obj.modelUrl)) {
                      preloadGLTFModels([obj.modelUrl]);
                      group = existing.group;
                  } else {
                      if (existing) {
                          tScene.remove(existing.group);
                          disposeObject3D(existing.group);
                      }
                      group = createObject3DMesh(obj, assets, { isEditor: false, hidePlaceholder: true });
                      group.userData.gameObjectId = obj.id;
                      group.userData._dimsSig = dimsSig;
                      tScene.add(group);
                      threeMeshMapRef.current.set(obj.id, { group, signature: sig });
                  }
              } else {
                  group = existing.group;
              }

              if (pendingFrameClip) {
                  (obj as any)._runtimeAnim3D = pendingFrameClip;
                  if (group.userData?.playAnimation3D) {
                      group.userData.playAnimation3D(pendingFrameClip.name, pendingFrameClip.loop, pendingFrameClip.speed);
                  } else {
                      group.userData.pendingAnimation3D = pendingFrameClip;
                  }
              }

              if (group.userData?.mixer) {
                  group.userData.mixer.update(deltaTime);
              }

              const pos = getObject3DPosition(obj);
              const rot = getObject3DRotation(obj);
              group.visible = obj.visible !== false;
              group.position.set(pos.x + animPosOffsetX, pos.y + animPosOffsetY, pos.z + animPosOffsetZ);
              group.rotation.set(rot.x + animRotOffsetX, rot.y + animRotOffsetY, rot.z + animRotOffsetZ);
              group.scale.set(animScaleX, animScaleY, animScaleZ);
          });

          threeMeshMapRef.current.forEach((entry, id) => {
              if (!active3DIds.has(id)) {
                  tScene.remove(entry.group);
                  disposeObject3D(entry.group);
                  threeMeshMapRef.current.delete(id);
                  activePoseAnimationsRef.current.delete(id);
              }
          });

          // Camera 3D controller
          const runtimeCamTarget = camera3DRuntimeRef.current.targetObjectName
              ? gameObjectsRef.current.find(o => o.name === camera3DRuntimeRef.current.targetObjectName && !o.isUI)
              : (scene.camera3DTargetId ? gameObjectsRef.current.find(o => o.id === scene.camera3DTargetId && !o.isUI) : undefined);
          const follow3DBehavObj = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera3D'));
          const follow2DBehavObj = gameObjectsRef.current.find(o => !o.isUI && o.behaviors?.some(b => b.name === 'FollowCamera'));
          const activePlayerObj = gameObjectsRef.current.find(o => o.id === currentControlledId);
          const camTargetObj = runtimeCamTarget || follow3DBehavObj || follow2DBehavObj || activePlayerObj;
          const follow3DBehav = follow3DBehavObj?.behaviors?.find(b => b.name === 'FollowCamera3D');

          const camMode = camera3DRuntimeRef.current.mode || follow3DBehav?.properties?.mode || scene.camera3DMode || 'thirdPerson';
          if (camMode === 'freeOrbit') {
              if (tControls) {
                  if (!draggingRef.current) tControls.enabled = true;
                  tControls.update();
              }
          } else {
              if (tControls) tControls.enabled = false;
              if (camTargetObj) {
                  const tp = getObject3DPosition(camTargetObj);
                  const dim = getObject3DDimensions(camTargetObj);
                  const lerpAlpha = 1 - Math.exp(-14 * deltaTime);
                  const targetH = Math.max(0.6, dim.h * 0.5);
                  const targetX = tp.x;
                  const targetY = tp.y + targetH;
                  const targetZ = tp.z;

                  if (camMode === 'firstPerson') {
                      const eyeY = tp.y + dim.h * 0.85;
                      const eyePos = new THREE.Vector3(targetX, eyeY, targetZ);
                      const yawFp = orbitYawRef.current || 0;
                      const pitchFp = Math.max(-1.35, Math.min(1.35, orbitFirstPersonPitchRef.current || 0));
                      const cosPitchFp = Math.cos(pitchFp);
                      const lookDir = new THREE.Vector3(-Math.sin(yawFp) * cosPitchFp, Math.sin(pitchFp), -Math.cos(yawFp) * cosPitchFp);
                      tCam.position.lerp(eyePos, lerpAlpha);
                      tCam.lookAt(tCam.position.x + lookDir.x * 10, tCam.position.y + lookDir.y * 10, tCam.position.z + lookDir.z * 10);
                  } else if (camMode === 'isometric') {
                      const isoDist = orbitDistanceRef.current || 14;
                      const desired = new THREE.Vector3(targetX + isoDist * 0.7, targetY + isoDist * 0.6, targetZ + isoDist * 0.7);
                      tCam.position.lerp(desired, lerpAlpha);
                      tCam.lookAt(targetX, targetY, targetZ);
                  } else if (camMode === 'topDown3D') {
                      const topDist = orbitDistanceRef.current || 16;
                      const desired = new THREE.Vector3(targetX, targetY + topDist, targetZ + 0.1);
                      tCam.position.lerp(desired, lerpAlpha);
                      tCam.lookAt(targetX, targetY, targetZ);
                  } else {
                      // thirdPerson orbit
                      const yaw = orbitYawRef.current || 0;
                      const pitch = Math.max(-0.35, Math.min(1.45, orbitPitchRef.current !== undefined ? orbitPitchRef.current : 0.38));
                      const dist = Math.max(2.5, Math.min(35, orbitDistanceRef.current || 9));

                      const cy = Math.cos(pitch);
                      const sy = Math.sin(pitch);
                      const desiredY = Math.max(0.25, targetY + dist * sy);
                      const desired = new THREE.Vector3(
                          targetX + dist * Math.sin(yaw) * cy,
                          desiredY,
                          targetZ + dist * Math.cos(yaw) * cy
                      );

                      tCam.position.lerp(desired, lerpAlpha);
                      tCam.lookAt(targetX, targetY, targetZ);
                  }
              }
          }

          floatingFeedbacks.current.forEach(f => {
              f.x += f.vx * deltaTime;
              f.y += f.vy * deltaTime;
              f.lifetime -= deltaTime;
              f.opacity = Math.max(0, f.lifetime);
          });
          floatingFeedbacks.current = floatingFeedbacks.current.filter(f => f.lifetime > 0);

          tRenderer.render(tScene, tCam);
          animationFrameId = requestAnimationFrame(gameLoop);
          return;
      }

      const isPixelArt = scene?.pixelArt === true || projectData?.pixelArt === true;
      const isSmoothGraphics = !isPixelArt;
      ctx.imageSmoothingEnabled = isSmoothGraphics;
      if (isSmoothGraphics) {
          ctx.imageSmoothingQuality = 'high';
      }

      ctx.fillStyle = runtimeBackgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      ctx.save();

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.scale(camera.current.zoom, camera.current.zoom);
      ctx.translate(-camera.current.x, -camera.current.y);
      
      const allDrawableObjects = gameObjectsRef.current.map(o => ({...o, ...getObjectAbsolutePosition(o.id, objectsById)}));

      const renderedVideoUrls = new Set<string>();

      allDrawableObjects.filter(o => {
        if (o.isUI) return false;
        if (o.visible === false) return false;
        
        
        
        return true;
      }).sort((a,b) => (a.zIndex || 0) - (b.zIndex || 0)).forEach(obj => {
        const tilemapBehavior = obj.behaviors?.find(b => b.name === 'Tilemap');

        if (tilemapBehavior && obj.imageUrl) {
            const img = imageCache.current.get(obj.imageUrl);
            if (img && img.complete) {
                const { tileSize = 32, collisionData = '' } = tilemapBehavior.properties;
                const rows = String(collisionData).split('\n');
                rows.forEach((row, y) => {
                    for (let x = 0; x < row.length; x++) {
                        if (row[x] !== ' ' && row[x] !== '0') {
                            ctx.drawImage(img, obj.x + x * tileSize, obj.y + y * tileSize, tileSize, tileSize);
                        }
                    }
                });
            }
        } else {
            ctx.save();
            ctx.globalAlpha = obj.opacity ?? 1;
            const centerX = obj.x + obj.width / 2;
            const centerY = obj.y + obj.height / 2;
            
            ctx.translate(centerX + (obj.animOffsetX || 0), centerY + (obj.animOffsetY || 0));
            ctx.rotate(((obj.rotation || 0) + (obj.animRotation || 0)) * Math.PI / 180);
            const scaleX = (obj.scaleX ?? 1) * (obj.animScaleX ?? 1) * (obj.direction === 'left' ? -1 : 1);
            const scaleY = (obj.scaleY ?? 1) * (obj.animScaleY ?? 1) * (obj.flipY ? -1 : 1);
            ctx.scale(scaleX, scaleY);
            
            const drawX = -obj.width / 2;
            const drawY = -obj.height / 2;

            if (obj.videoUrl) {
                renderedVideoUrls.add(obj.videoUrl);
                let video = videoCache.current.get(obj.videoUrl);
                if (!video) {
                    video = document.createElement('video');
                    video.muted = obj.videoMuted !== false;
                    video.playsInline = true;
                    video.setAttribute('webkit-playsinline', 'true');
                    video.loop = obj.videoLoop !== false;
                    video.src = obj.videoUrl;
                    video.load();
                    videoCache.current.set(obj.videoUrl, video);
                }
                if (video) {
                    if (video.dataset.playState === undefined) {
                        video.dataset.playState = (obj.videoAutoplay ?? true) ? 'playing' : 'paused';
                    }
                    if (video.dataset.playState === 'playing') {
                        if (video.paused) {
                            video.play().catch(()=>{});
                        }
                    } else {
                        if (!video.paused) {
                            video.pause();
                        }
                    }
                    video.loop = obj.videoLoop !== false;
                    video.muted = obj.videoMuted !== false;
                    try {
                        ctx.drawImage(video, drawX, drawY, obj.width, obj.height);
                    } catch (e) {
                        // Video might not be ready, ignore error
                    }
                }
            } else if (obj.imageUrl || obj.assetId) {
                let rawUrl = obj.imageUrl || '';
                if (!rawUrl && obj.assetId) {
                    const foundAsset = assets?.find(a => String(a.id) === String(obj.assetId));
                    if (foundAsset) rawUrl = foundAsset.url;
                }
                if (rawUrl && !rawUrl.startsWith('data:') && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('/')) {
                    const foundAsset = assets?.find(a => String(a.id) === String(rawUrl) || a.name === rawUrl);
                    if (foundAsset) rawUrl = foundAsset.url;
                }

                if (rawUrl) {
                    let img = imageCache.current.get(rawUrl) || (obj.imageUrl ? imageCache.current.get(obj.imageUrl) : undefined);
                    if (!img) {
                        img = new Image();
                        img.src = rawUrl;
                        imageCache.current.set(rawUrl, img);
                        if (obj.imageUrl) imageCache.current.set(obj.imageUrl, img);
                    }
                    if (img && img.complete && img.naturalWidth > 0) {
                        ctx.drawImage(img, drawX, drawY, obj.width, obj.height);
                    } else if (obj.color && obj.color !== 'transparent') {
                        ctx.fillStyle = obj.color;
                        ctx.fillRect(drawX, drawY, obj.width, obj.height);
                    }
                } else if (obj.color && obj.color !== 'transparent') {
                    ctx.fillStyle = obj.color;
                    ctx.fillRect(drawX, drawY, obj.width, obj.height);
                }
            } else if (obj.color !== 'transparent') {
                ctx.fillStyle = obj.color;
                ctx.fillRect(drawX, drawY, obj.width, obj.height);
            }
            
            // Draw Health Bar
            const healthBehavior = obj.behaviors?.find(b => b.name === 'Health');
            if (healthBehavior && healthBehavior.properties.showHealthBar !== false && obj.stats) {
                const hp = obj.stats.hp ?? 100;
                const maxHp = obj.stats.maxHp ?? 100;
                const hpPercent = Math.max(0, Math.min(1, hp / maxHp));
                
                const barWidth = obj.width;
                const barHeight = 6;
                const barY = drawY - barHeight - 4;
                const barX = drawX;
                
                // Background
                ctx.fillStyle = 'rgba(0,0,0,0.6)';
                ctx.fillRect(barX, barY, barWidth, barHeight);
                // Foreground
                ctx.fillStyle = hpPercent > 0.5 ? '#22c55e' : (hpPercent > 0.25 ? '#eab308' : '#ef4444');
                ctx.fillRect(barX, barY, barWidth * hpPercent, barHeight);
            }

            // Draw Score / Text (if any)
            if (obj.text) {
                ctx.fillStyle = obj.textColor || 'white';
                ctx.font = `bold ${obj.fontSize || 16}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(obj.text, 0, 0); // drawX and drawY are -width/2, -height/2, so 0,0 is center
            }

            ctx.restore();
        }
      });
      
      // Pause any cached video that is not actively rendering in this frame to prevent background lag
      videoCache.current.forEach((video, url) => {
          if (!renderedVideoUrls.has(url) && !video.paused) {
              try {
                  video.pause();
              } catch (e) {
                  // Ignore errors
              }
          }
      });
      
      // Update and draw visual floating feedbacks!
      floatingFeedbacks.current.forEach(f => {
          f.x += f.vx * deltaTime;
          f.y += f.vy * deltaTime;
          f.lifetime -= deltaTime;
          f.opacity = Math.max(0, f.lifetime);
      });
      floatingFeedbacks.current = floatingFeedbacks.current.filter(f => f.lifetime > 0);

      floatingFeedbacks.current.forEach(f => {
          ctx.save();
          ctx.globalAlpha = f.opacity;
          ctx.fillStyle = f.color;
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 4;
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.strokeText(f.text, f.x, f.y);
          ctx.fillText(f.text, f.x, f.y);
          ctx.restore();
      });
      
      ctx.restore();

      animationFrameId = requestAnimationFrame(gameLoop);
    };
    
    const charImageUrls: string[] = [];
    scene.gameObjects.forEach(o => {
        if (o.characterImageMapping) {
            const map = parseCharacterImageMapping(o.characterImageMapping);
            Object.values(map).forEach(url => {
                if (url && !charImageUrls.includes(url)) charImageUrls.push(url);
            });
        }
    });

    const allImageAssets = [...assets.filter(a => a.type === 'image')];
    charImageUrls.forEach(url => {
        if (!allImageAssets.some(a => a.url === url)) {
            allImageAssets.push({ id: 'char-' + url, type: 'image', url, name: 'CharImg' });
        }
    });

    const imagePromises = allImageAssets.map(asset => new Promise<void>((resolve) => {
        if (imageCache.current.has(asset.url)) return resolve();
        const img = new Image();
        img.onload = () => { imageCache.current.set(asset.url, img); resolve(); };
        img.onerror = () => { console.error(`Failed to load image: ${asset.url}`); resolve(); }; // Resolve anyway to not block game start
        img.src = asset.url;
    }));

    const audioPromises = assets.filter(a => a.type === 'audio').map(asset => new Promise<void>((resolve) => {
        if (audioCache.current.has(asset.url)) return resolve();
        const audio = new Audio();
        let resolved = false;
        const done = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };
        const timer = setTimeout(done, 150);
        audio.oncanplaythrough = () => {
            clearTimeout(timer);
            audioCache.current.set(asset.url, audio);
            done();
        };
        audio.onerror = () => {
            clearTimeout(timer);
            console.error(`Failed to load audio: ${asset.url}`);
            done();
        };
        audio.src = asset.url;
    }));
    
    const usedVideoUrls = new Set<string>();
    scene.gameObjects.forEach(obj => {
        if (obj.videoUrl) {
            usedVideoUrls.add(obj.videoUrl);
        }
    });
    scene.events.forEach(event => {
        event.actions.forEach(action => {
            if (action.action === 'PlayVideo' && action.params?.videoAssetId) {
                const asset = assets.find(a => a.id === action.params.videoAssetId);
                if (asset?.url) usedVideoUrls.add(asset.url);
            }
        });
    });
    scene.gameObjects.forEach(obj => {
        obj.scripts?.forEach(script => {
            script.actions.forEach(action => {
                if (action.action === 'PlayVideo' && action.params?.videoAssetId) {
                    const asset = assets.find(a => a.id === action.params.videoAssetId);
                    if (asset?.url) usedVideoUrls.add(asset.url);
                }
            });
        });
    });

    const videoPromises = assets.filter(a => a.type === 'video' && usedVideoUrls.has(a.url)).map(asset => new Promise<void>((resolve) => {
        if (videoCache.current.has(asset.url)) return resolve();
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('webkit-playsinline', 'true');
        video.loop = true;
        let resolved = false;
        const done = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };
        const timer = setTimeout(done, 150);
        video.oncanplay = () => {
            clearTimeout(timer);
            videoCache.current.set(asset.url, video);
            done();
        };
        video.onerror = () => {
            clearTimeout(timer);
            console.error(`Failed to load video: ${asset.url}`);
            done();
        };
        video.src = asset.url;
        video.load();
    }));

    // Boot the game loop and OnStart triggers instantly for zero black-screen lag
    if (!initialState && !loadedFromPending) {
        scene.events.forEach(event => {
            const hasOnStart = event.conditions.some(c => c.trigger === 'OnStart');
            if (hasOnStart) {
                evaluateSingleEvent(event, 0, { skipTrigger: 'OnStart', forceOneShot: true });
            }
        });
        gameObjectsRef.current.forEach(obj => {
            obj.scripts?.forEach(script => {
                if (script.trigger === 'OnStart') {
                    const scriptId = script.id || script.trigger;
                    executeActionsSequential(script.actions, obj, false, 0, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                }
            });
        });
    }
    
    // Launch the rendering animation loop instantly!
    animationFrameId = requestAnimationFrame(gameLoop);

    // Preload assets asynchronously in the background to populate the cache
    Promise.allSettled([...imagePromises, ...audioPromises, ...videoPromises]).then(() => {
        console.log("Background asset caching finished.");
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (backgroundMusicPlayer.current) {
          backgroundMusicPlayer.current.pause();
          backgroundMusicPlayer.current = null;
      }
      videoCache.current.forEach(video => {
          try {
              video.pause();
              video.src = '';
              video.load();
          } catch (e) {
              // Ignore any errors when stopping videos
          }
      });
      videoCache.current.clear();
    };
  }, [scene, is3DScene, onGoToScene, globalVariables, assets, animations, initialState]);

  const isColliding = (
    box1: { x: number; y: number; width: number; height: number; cx?: number; cy?: number; halfW?: number; halfH?: number; rotRad?: number },
    box2: { x: number; y: number; width: number; height: number; cx?: number; cy?: number; halfW?: number; halfH?: number; rotRad?: number }
  ) => {
    if ((box1.rotRad && Math.abs(box1.rotRad) >= 1e-4) || (box2.rotRad && Math.abs(box2.rotRad) >= 1e-4)) {
      return getCollisionMTV2D(box1, box2) !== null;
    }
    return box1.x < box2.x + box2.width &&
           box1.x + box1.width > box2.x &&
           box1.y < box2.y + box2.height &&
           box1.y + box1.height > box2.y;
  };

  const checkCollision3D = (obj1: GameObject, obj2: GameObject) => {
    const active1 = activePoseAnimationsRef.current.get(obj1.id);
    const active2 = activePoseAnimationsRef.current.get(obj2.id);
    const nowPoseCol = performance.now();
    const b1 = getEffectiveObject3DBounds(obj1, active1, nowPoseCol);
    const b2 = getEffectiveObject3DBounds(obj2, active2, nowPoseCol);
    return boxesOverlap3D(b1, b2, 0.04);
  };

  const parseCharacterImageMapping = (mappingStr: string | undefined): Record<string, string> => {
      const map: Record<string, string> = {};
      if (!mappingStr) return map;
      const lines = mappingStr.split(/[\n,]/);
      lines.forEach(line => {
          const parts = line.split('=');
          if (parts.length >= 2) {
              const char = parts[0].trim();
              const url = parts.slice(1).join('=').trim();
              if (char) {
                  map[char] = url;
              }
          }
      });
      return map;
  };

  const renderUITextElements = (text: string, obj?: GameObject) => {
      let newText = text;
      for (const key in gameVariables.current) {
          newText = newText.replace(new RegExp(`\\{${key}\\}`, 'g'), String(gameVariables.current[key]));
      }
      if (obj && obj.variables) {
          obj.variables.forEach(v => {
              newText = newText.replace(new RegExp(`\\{${v.name}\\}`, 'g'), String(v.value));
          });
      }

      if (obj && obj.characterImageMapping) {
          const map = parseCharacterImageMapping(obj.characterImageMapping);
          if (Object.keys(map).length > 0) {
              return (
                  <div className="flex items-center justify-center gap-0.5 flex-wrap pointer-events-none">
                      {Array.from(newText).map((char, idx) => {
                          const imgUrl = map[char] || map[char.toLowerCase()] || map[char.toUpperCase()];
                          if (imgUrl) {
                              return (
                                  <img 
                                      key={idx} 
                                      src={imgUrl} 
                                      alt={char} 
                                      className="object-contain inline-block" 
                                      style={{ height: `${obj.fontSize || 24}px`, minWidth: `${(obj.fontSize || 24) * 0.6}px` }} 
                                      referrerPolicy="no-referrer"
                                  />
                              );
                          }
                          return <span key={idx} style={{ fontSize: `${obj.fontSize || 16}px` }} className="text-white font-bold">{char}</span>;
                      })}
                  </div>
              );
          }
      }

      return <span>{newText}</span>;
  }

  const renderUIText = (text: string, obj?: GameObject) => {
      let newText = text;
      for (const key in gameVariables.current) {
          newText = newText.replace(new RegExp(`\\{${key}\\}`, 'g'), String(gameVariables.current[key]));
      }
      if (obj && obj.variables) {
          obj.variables.forEach(v => {
              newText = newText.replace(new RegExp(`\\{${v.name}\\}`, 'g'), String(v.value));
          });
      }
      return newText;
  }
  
  const initVideos = () => {
    const activeVideoUrls = new Set<string>();
    gameObjectsRef.current.forEach(obj => {
        if (obj.videoUrl && obj.visible !== false) {
            activeVideoUrls.add(obj.videoUrl);
        }
    });
    uiObjects.forEach(obj => {
        if (obj.videoUrl && obj.visible !== false) {
            activeVideoUrls.add(obj.videoUrl);
        }
    });

    videoCache.current.forEach((video, url) => {
        if (activeVideoUrls.has(url)) {
            if (video.paused && video.dataset.playState !== 'paused') {
                video.play().catch(() => {});
            }
        } else {
            if (!video.paused) {
                try {
                    video.pause();
                } catch (e) {
                    // Ignore errors
                }
            }
        }
    });
  };

  const initAudio = () => {
    if (!audioContextRef.current) {
        try {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser");
        }
    }
    if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
    }
    initVideos();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
        (e.target as Element).setPointerCapture(e.pointerId);
    } catch (err) {
        console.error("Failed to set pointer capture", err);
    }
    initAudio();
    if (dialogue) {
        setDialogue(null);
        frameDialogueEnd.current = true;
        return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const objectsById = new Map<number, GameObject>(gameObjectsRef.current.map(o => [o.id, o]));
    const worldMouseX = (mouseX / camera.current.zoom) + camera.current.x - (canvas.width / (2*camera.current.zoom));
    const worldMouseY = (mouseY / camera.current.zoom) + camera.current.y - (canvas.height / (2*camera.current.zoom));
    
    const clickedObject = [...gameObjectsRef.current]
        .filter(obj => obj.visible !== false)
        .sort((a,b) => (b.zIndex || 0) - (a.zIndex || 0))
        .find(obj => {
            const absPos = getObjectAbsolutePosition(obj.id, objectsById);
            if (isObjectUI(obj, objectsById)) {
                return mouseX >= absPos.x && mouseX <= absPos.x + (obj.width || 32) &&
                       mouseY >= absPos.y && mouseY <= absPos.y + (obj.height || 32);
            }
            const collisionBox = getCollisionBox({...obj, ...absPos});
            return worldMouseX >= collisionBox.x && worldMouseX <= collisionBox.x + collisionBox.width &&
                   worldMouseY >= collisionBox.y && worldMouseY <= collisionBox.y + collisionBox.height;
        });
    
    if (clickedObject) {
        const chain: GameObject[] = [];
        let curr: GameObject | undefined = clickedObject;
        let safety = 100;
        while (curr && safety-- > 0) {
            chain.push(curr);
            if (!curr.parentId) break;
            curr = objectsById.get(curr.parentId);
        }

        chain.forEach(o => {
            frameClicks.current.push({ name: o.name, id: o.id });
            o.scripts?.forEach(script => {
                if (script.trigger === 'OnClick') {
                    const scriptId = script.id || script.trigger;
                    executeActionsSequential(script.actions, o, false, 0, false, undefined, `obj-${o.id}-script-${scriptId}`);
                }
            });
        });

        pointerDownObjectRef.current = { id: clickedObject.id, name: clickedObject.name };

        if (clickedObject.isDraggable) {
            const isUI = isObjectUI(clickedObject, objectsById);
            const clickPos = isUI ? { x: mouseX, y: mouseY } : { x: worldMouseX, y: worldMouseY };
            draggingRef.current = {
                id: clickedObject.id,
                offsetX: clickedObject.x - clickPos.x,
                offsetY: clickedObject.y - clickPos.y,
                initialX: clickedObject.x,
                initialY: clickedObject.y,
            };
        }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;

      const worldMouseX = (mouseX / camera.current.zoom) + camera.current.x - (canvas.width / (2*camera.current.zoom));
      const worldMouseY = (mouseY / camera.current.zoom) + camera.current.y - (canvas.height / (2*camera.current.zoom));

      const obj = [...gameObjectsRef.current, ...uiObjects].find(o => o.id === draggingRef.current!.id);
      if (obj) {
          const isUI = isObjectUI(obj, new Map(gameObjectsRef.current.map(o => [o.id, o])));
          const targetX = isUI ? mouseX : worldMouseX;
          const targetY = isUI ? mouseY : worldMouseY;

          let updatedX = obj.x;
          let updatedY = obj.y;

          if (!obj.dragXLocked) {
              let newX = targetX + draggingRef.current!.offsetX;
              if (obj.dragMinX !== undefined) newX = Math.max(obj.dragMinX, newX);
              if (obj.dragMaxX !== undefined) newX = Math.min(obj.dragMaxX, newX);
              obj.x = Math.round(newX);
              updatedX = obj.x;
          }
          if (!obj.dragYLocked) {
              let newY = targetY + draggingRef.current!.offsetY;
              if (obj.dragMinY !== undefined) newY = Math.max(obj.dragMinY, newY);
              if (obj.dragMaxY !== undefined) newY = Math.min(obj.dragMaxY, newY);
              obj.y = Math.round(newY);
              updatedY = obj.y;
          }

          if (isUI) {
              setUiObjects(prev => prev.map(o => o.id === obj.id ? { ...o, x: updatedX, y: updatedY } : o));
          }
      }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const releasedList: { id: number; name: string }[] = [];
      if (draggingRef.current) {
          const draggedObj = [...gameObjectsRef.current, ...uiObjects].find(o => o.id === draggingRef.current!.id);
          if (draggedObj) {
              releasedList.push({ id: draggedObj.id, name: draggedObj.name });
              draggedObj.vx = 0;
              draggedObj.vy = 0;

              // Handle on-drop behavior
              if (draggedObj.dragDropBehavior === 'return' && draggingRef.current.initialX !== undefined) {
                  draggedObj.x = draggingRef.current.initialX;
                  draggedObj.y = draggingRef.current.initialY;
              } else if (draggedObj.dragDropBehavior === 'random') {
                  const minX = draggedObj.dragRandomMinX ?? (draggedObj.dragMinX ?? 50);
                  const maxX = draggedObj.dragRandomMaxX ?? (draggedObj.dragMaxX ?? ((canvas?.width ?? 800) - draggedObj.width));
                  const minY = draggedObj.dragRandomMinY ?? (draggedObj.dragMinY ?? 50);
                  const maxY = draggedObj.dragRandomMaxY ?? (draggedObj.dragMaxY ?? ((canvas?.height ?? 600) - draggedObj.height));
                  draggedObj.x = Math.round(minX + Math.random() * Math.max(1, maxX - minX));
                  draggedObj.y = Math.round(minY + Math.random() * Math.max(1, maxY - minY));
              }
          }
      }
      if (pointerDownObjectRef.current) {
          if (!releasedList.some(r => r.id === pointerDownObjectRef.current!.id)) {
              releasedList.push(pointerDownObjectRef.current);
          }
      }
      releasedList.forEach(rel => {
          frameObjectReleases.current.push(rel);
          const obj = [...gameObjectsRef.current, ...uiObjects].find(o => o.id === rel.id);
          if (obj?.scripts) {
              obj.scripts.forEach(script => {
                  if (script.trigger === 'OnObjectReleased') {
                      const scriptId = script.id || script.trigger;
                      executeActionsSequential(script.actions, obj, false, 0, false, undefined, `obj-${obj.id}-script-${scriptId}`);
                  }
              });
          }
      });
      draggingRef.current = null;
      pointerDownObjectRef.current = null;
  };
  
  const joystickSize = joystick?.size ?? 120;
  const joystickHandleSize = joystickSize / 2.4;

  const updateJoystickFromClient = useCallback((clientX: number, clientY: number) => {
    const base = joystickBaseRef.current;
    if (!base) {
      resetJoystick();
      return;
    }
    const rect = base.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      resetJoystick();
      return;
    }
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const distance = Math.min(joystickSize / 2, Math.hypot(dx, dy));
    joystickState.current = { active: true, angle, distance };

    if (joystickHandleRef.current) {
        const x = distance * Math.cos(angle * Math.PI / 180);
        const y = distance * Math.sin(angle * Math.PI / 180);
        joystickHandleRef.current.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, [joystickSize, resetJoystick]);

  const handleJoystickTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    const touch = e.changedTouches[0];
    if (touch && joystickBaseRef.current) {
        joystickPointerId.current = null;
        joystickTouchId.current = touch.identifier;
        updateJoystickFromClient(touch.clientX, touch.clientY);
    }
  };

  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    e.stopPropagation();
    initAudio();
    if (joystickBaseRef.current) {
        joystickTouchId.current = null;
        joystickPointerId.current = e.pointerId;
        updateJoystickFromClient(e.clientX, e.clientY);
    }
  };

  useEffect(() => {
    const handleJoystickTouchMove = (e: TouchEvent) => {
        if (joystickTouchId.current !== null) {
            let matchedTouch: Touch | null = null;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === joystickTouchId.current) {
                    matchedTouch = e.changedTouches[i];
                    break;
                }
            }
            if (!matchedTouch && e.touches) {
                for (let i = 0; i < e.touches.length; i++) {
                    if (e.touches[i].identifier === joystickTouchId.current) {
                        matchedTouch = e.touches[i];
                        break;
                    }
                }
            }
            if (matchedTouch) {
                e.preventDefault();
                updateJoystickFromClient(matchedTouch.clientX, matchedTouch.clientY);
                return;
            }
            if (e.touches && !Array.from(e.touches).some(t => t.identifier === joystickTouchId.current)) {
                resetJoystick();
            }
        }
    };
    const handleJoystickTouchEndOrCancel = (e: TouchEvent) => {
        if (joystickTouchId.current !== null) {
            let ended = false;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === joystickTouchId.current) {
                    ended = true;
                    break;
                }
            }
            if (!ended && (!e.touches || !Array.from(e.touches).some(t => t.identifier === joystickTouchId.current))) {
                ended = true;
            }
            if (ended) {
                e.preventDefault();
                resetJoystick();
            }
        }
    };
    const handleJoystickPointerMove = (e: PointerEvent) => {
        if (joystickPointerId.current !== null && e.pointerId === joystickPointerId.current) {
            if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
                resetJoystick();
                return;
            }
            updateJoystickFromClient(e.clientX, e.clientY);
        }
    };
    const handleJoystickPointerEnd = (e: PointerEvent) => {
        if (joystickPointerId.current !== null && e.pointerId === joystickPointerId.current) {
            resetJoystick();
        }
    };
    const handleBlur = () => {
        resetAllInputs(false);
    };
    const handleVisibility = () => {
        if (document.hidden) resetAllInputs(false);
    };
    window.addEventListener('touchmove', handleJoystickTouchMove, { passive: false });
    window.addEventListener('touchend', handleJoystickTouchEndOrCancel, { passive: false, capture: true });
    window.addEventListener('touchcancel', handleJoystickTouchEndOrCancel, { passive: false, capture: true });
    window.addEventListener('pointermove', handleJoystickPointerMove);
    window.addEventListener('pointerup', handleJoystickPointerEnd, { capture: true });
    window.addEventListener('pointercancel', handleJoystickPointerEnd, { capture: true });
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
        window.removeEventListener('touchmove', handleJoystickTouchMove);
        window.removeEventListener('touchend', handleJoystickTouchEndOrCancel, { capture: true });
        window.removeEventListener('touchcancel', handleJoystickTouchEndOrCancel, { capture: true });
        window.removeEventListener('pointermove', handleJoystickPointerMove);
        window.removeEventListener('pointerup', handleJoystickPointerEnd, { capture: true });
        window.removeEventListener('pointercancel', handleJoystickPointerEnd, { capture: true });
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [updateJoystickFromClient, resetJoystick, resetAllInputs]);

  const controllablePlayers = gameObjectsRef.current.filter(obj => 
      !obj.isUI && obj.behaviors?.some(b => b.name === 'Player3D' || b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement')
  );
  
  const currentControlledId = selectedPlayerId !== null && controllablePlayers.some(p => p.id === selectedPlayerId)
      ? selectedPlayerId
      : controllablePlayers[0]?.id;

  return (
    <div ref={containerRef} className="fixed inset-0 bg-black z-50 flex flex-col overflow-hidden">
      {!responsive && (
        <header className="flex items-center justify-between p-2 bg-gray-900 text-white shrink-0 border-b border-gray-800">
            <div className="flex items-center gap-4">
                <span className="font-bold">Vista Previa del Juego</span>
            </div>
            <button onClick={() => onExit({ gameObjects: gameObjectsRef.current, gameVariables: gameVariables.current })} className="px-4 py-1 bg-red-600 hover:bg-red-700 rounded-md">Salir</button>
        </header>
      )}
      {responsive && (
        <>
          <button 
              onClick={() => onExit({ gameObjects: gameObjectsRef.current, gameVariables: gameVariables.current })} 
              className="absolute top-4 right-4 z-[60] p-2 bg-red-600/85 hover:bg-red-600 text-white rounded-full transition-colors border border-white/20 shadow-lg"
              title="Salir"
          >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
          </button>
        </>
      )}

      <main className="relative flex-1 w-full flex items-center justify-center bg-black overflow-hidden pointer-events-none">
        <div
            ref={threeContainerRef}
            className={is3DScene ? 'w-full h-full pointer-events-auto touch-none select-none' : 'hidden'}
        />
        <canvas 
            ref={canvasRef} 
            width={gameWidth} 
            height={gameHeight} 
            className={is3DScene ? 'hidden' : 'block pointer-events-auto'} 
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{ imageRendering: (scene?.pixelArt || projectData?.pixelArt) ? 'pixelated' : 'auto', width: '100%', height: '100%', objectFit: 'contain' }} 
        />
        
        {gameObjectsRef.current.filter(o => o.isUI && o.visible !== false).map(obj => {
                const isControlButton = obj.name.toLowerCase().includes('btn') || obj.name.toLowerCase().includes('boton') || obj.name.toLowerCase().includes('button') || obj.controlAction;
                const hasClickScript = obj.scripts && obj.scripts.some(s => s.trigger === 'OnClick');
                const isInteractive = isControlButton || hasClickScript || obj.isDraggable;
                const scaleX = obj.scaleX ?? 1;
                const scaleY = obj.scaleY ?? 1;
                const rotation = obj.rotation ?? 0;
                
                const style: React.CSSProperties = {
                    position: 'absolute',
                    left: `${obj.x}px`,
                    top: `${obj.y}px`,
                    width: `${obj.width}px`,
                    height: `${obj.height}px`,
                    backgroundColor: obj.imageUrl ? 'transparent' : (obj.isHealthBar ? 'transparent' : obj.color),
                    backgroundImage: obj.imageUrl ? `url(${obj.imageUrl})` : 'none',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                    zIndex: obj.zIndex,
                    opacity: obj.opacity ?? 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: obj.textColor || 'white',
                    fontSize: `${obj.fontSize || 16}px`,
                    pointerEvents: isInteractive ? 'auto' : 'none',
                    cursor: isInteractive ? 'pointer' : 'default',
                    transformOrigin: 'top left',
                    transform: `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
                };
                
                const handlePress = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => { 
                    initAudio();
                    if (obj.controlAction) {
                      actionsPressed.current[obj.controlAction] = true; 
                      actionsPressed.current[obj.controlAction+'_ui'] = true;
                    }
                    
                    const objectsById = new Map<number, GameObject>(gameObjectsRef.current.map(o => [o.id, o]));
                    const chain: GameObject[] = [];
                    let curr: GameObject | undefined = obj;
                    let safety = 100;
                    while (curr && safety-- > 0) {
                      chain.push(curr);
                      if (!curr.parentId) break;
                      curr = objectsById.get(curr.parentId);
                    }

                    chain.forEach(o => {
                      frameClicks.current.push({ name: o.name, id: o.id });
                      o.scripts?.forEach(script => {
                        if (script.trigger === 'OnClick') {
                          const scriptId = script.id || script.trigger;
                          executeActionsSequential(script.actions, o, false, 0, false, undefined, `obj-${o.id}-script-${scriptId}`);
                        }
                      });
                    });
                };
                const handleRelease = (e: React.MouseEvent | React.TouchEvent | React.PointerEvent) => { 
                     if(obj.controlAction) {
                      actionsPressed.current[obj.controlAction] = false; 
                      actionsPressed.current[obj.controlAction+'_ui'] = false;
                    }
                };

                if (isControlButton) {
                    return (
                        <button
                            key={obj.id}
                            style={style}
                            onPointerDown={handlePress}
                            onPointerUp={handleRelease}
                            onPointerLeave={handleRelease}
                            className="font-bold active:bg-indigo-500/70 select-none outline-none"
                        >
                            <span style={{ transform: scaleX < 0 ? 'scaleX(-1)' : 'none' }}>
                                {obj.text && renderUITextElements(obj.text, obj)}
                            </span>
                        </button>
                    )
                }

                if (obj.isHealthBar) {
                    let targetObj = gameObjectsRef.current.find(o => o.name === obj.healthBarTarget);
                    if (!targetObj && obj.healthBarTarget) {
                        targetObj = gameObjectsRef.current.find(o => o.name.toLowerCase().includes(obj.healthBarTarget!.toLowerCase()));
                    }
                    if (!targetObj) {
                        targetObj = gameObjectsRef.current.find(o => o.name.toLowerCase().includes('jugador') || o.name.toLowerCase().includes('player'));
                    }
                    if (!targetObj) {
                        targetObj = gameObjectsRef.current.find(o => o.stats && typeof o.stats.hp === 'number');
                    }

                    const hp = targetObj?.stats?.hp ?? 100;
                    const maxHp = targetObj?.stats?.maxHp ?? 100;
                    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

                    let barColor = 'bg-[#10b981]'; // Emerald
                    if (hpPercent < 25) {
                        barColor = 'bg-[#ef4444] animate-pulse'; // Red
                    } else if (hpPercent < 50) {
                        barColor = 'bg-[#f59e0b]'; // Amber
                    }

                    return (
                        <div key={obj.id} style={{
                            ...style,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            justifyContent: 'center',
                            backgroundColor: 'rgba(15, 23, 42, 0.85)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: '0.5rem',
                            padding: '6px 8px',
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.3)',
                            pointerEvents: 'none'
                        }}>
                            <div className="flex items-center justify-between text-[11px] font-bold text-white mb-1.5 tracking-wide">
                                <span className="flex items-center gap-1">
                                    ❤️ <span className="font-sans text-[11px] text-gray-200">{targetObj ? targetObj.name : (obj.healthBarTarget || 'Jugador')}</span>
                                </span>
                                <span className="font-mono text-gray-300">{Math.round(hp)}/{maxHp}</span>
                            </div>
                            <div className="w-full bg-[#020617] rounded-full h-2.5 overflow-hidden border border-white/5 relative">
                                <div 
                                    className={`${barColor} h-full transition-all duration-300 rounded-full`}
                                    style={{ width: `${hpPercent}%` }}
                                />
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={obj.id} style={style} onPointerDown={hasClickScript ? handlePress : undefined}>
                        {obj.text && <div className="w-full h-full p-1 font-bold text-white text-center flex items-center justify-center pointer-events-none" style={{ transform: scaleX < 0 ? 'scaleX(-1)' : 'none' }}>{renderUITextElements(obj.text, obj)}</div>}
                    </div>
                );
            })}
            {joystickRuntimeEnabled && (
              <div
                  ref={joystickBaseRef}
                  onTouchStart={handleJoystickTouchStart}
                  onPointerDown={handleJoystickPointerDown}
                  style={{
                      position: 'absolute',
                      bottom: '40px',
                      [joystick?.position || 'left']: '40px',
                      width: `${joystickSize}px`,
                      height: `${joystickSize}px`,
                      backgroundColor: joystick?.backgroundImageUrl ? 'transparent' : `rgba(255, 255, 255, ${joystick?.opacity ?? 0.1})`,
                      backgroundImage: joystick?.backgroundImageUrl ? `url(${joystick?.backgroundImageUrl})` : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      borderRadius: '50%',
                      pointerEvents: 'auto',
                      userSelect: 'none',
                      touchAction: 'none',
                      zIndex: 999
                  }}
              >
                  <div 
                      ref={joystickHandleRef}
                      style={{
                          position: 'absolute',
                          width: `${joystickHandleSize}px`,
                          height: `${joystickHandleSize}px`,
                          backgroundColor: joystick?.handleImageUrl ? 'transparent' : 'rgba(255, 255, 255, 0.3)',
                          backgroundImage: joystick?.handleImageUrl ? `url(${joystick?.handleImageUrl})` : 'none',
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          borderRadius: '50%',
                          left: `calc(50% - ${joystickHandleSize / 2}px)`,
                          top: `calc(50% - ${joystickHandleSize / 2}px)`,
                          transition: 'transform 50ms linear',
                          pointerEvents: 'none'
                      }}/>
              </div>
            )}
            {activeInteractable && (
                <>
                    {/* Visual Prompt Bubble */}
                    <div 
                        className="absolute bottom-1/4 left-1/2 -translate-x-1/2 bg-indigo-950/90 border border-indigo-400 text-indigo-100 font-bold px-4 py-2 rounded-full shadow-2xl text-xs flex items-center gap-2 animate-pulse pointer-events-auto cursor-pointer select-none z-50"
                        onClick={() => {
                            if (activeInteractableRef.current) {
                                frameInteractions.current.push({
                                    id: activeInteractableRef.current.id,
                                    name: activeInteractableRef.current.name
                                });
                            }
                        }}
                    >
                        <span className="bg-indigo-500 text-white rounded-full w-5 h-5 flex items-center justify-center font-mono">E</span>
                        <span>{activeInteractable.prompt}</span>
                    </div>

                    {/* Pro Mobile/Arcade Action Button */}
                    <button 
                        style={{
                            position: 'absolute',
                            bottom: '40px',
                            [joystick?.position === 'right' ? 'left' : 'right']: '45px',
                            width: '72px',
                            height: '72px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(99, 102, 241, 0.85)',
                            border: '3px solid rgba(255, 255, 255, 0.5)',
                            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                            color: 'white',
                            fontWeight: 'bold',
                            fontSize: '11px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '2px',
                            cursor: 'pointer',
                            userSelect: 'none',
                            pointerEvents: 'auto',
                            zIndex: 999
                        }}
                        onClick={() => {
                            if (activeInteractableRef.current) {
                                frameInteractions.current.push({
                                    id: activeInteractableRef.current.id,
                                    name: activeInteractableRef.current.name
                                });
                            }
                        }}
                        className="active:scale-95 transition-transform"
                    >
                        <span className="text-[14px]">⚡</span>
                        <span>INTERACT</span>
                    </button>
                </>
            )}
             {dialogue && (
                <div className="absolute bottom-28 left-1/2 -translate-x-1/2 w-3/4 max-w-2xl bg-black/80 text-white p-4 rounded-lg border-2 border-indigo-400 pointer-events-auto" onClick={() => setDialogue(null)}>
                    <p className="text-lg">{dialogue.text}</p>
                    <small className="text-indigo-300 block mt-2 text-right">Click para continuar...</small>
                </div>
            )}
            {consoleOpen && (
              <div className="absolute bottom-4 left-4 right-4 bg-black/95 border border-indigo-500/50 p-3 rounded-lg shadow-2xl pointer-events-auto animate-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-center gap-3">
                  <span className="text-indigo-400 font-mono font-bold leading-8 select-none">{'>'}</span>
                  <input 
                    autoFocus
                    type="text" 
                    className="flex-grow bg-transparent text-white font-mono text-base outline-none border-none h-10 w-full placeholder:text-gray-600"
                    placeholder="Escribe un comando y pulsa [ENTER]..."
                    value={consoleValue}
                    onChange={(e) => setConsoleValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.stopPropagation();
                            if (consoleValue.trim()) {
                                frameConsoleCommands.current.push(consoleValue.trim());
                                setConsoleValue('');
                            }
                            setConsoleOpen(false);
                        } else if (e.key === 'Escape') {
                            e.stopPropagation();
                            setConsoleOpen(false);
                        }
                    }}
                  />
                </div>
              </div>
            )}
      </main>
    </div>
  );
};

export default GameView;