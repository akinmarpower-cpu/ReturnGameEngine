import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GameAsset, GameObject, PoseAnimation, PoseFrame, Shape3D } from '../types';

let idCounter = 1;

/**
 * Generates strictly unique positive integer IDs safe for parseInt/Number and IndexedDB keys.
 */
export function createUniqueId(): number {
  idCounter = (idCounter + 1) % 1000;
  return Date.now() * 1000 + idCounter;
}

export function detectSoftwareWebGL(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const vendor = String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '');
      const rStr = String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '');
      if (/SwiftShader|llvmpipe|Software|Mesa OffScreen|Microsoft Basic/i.test(vendor + ' ' + rStr)) {
        return true;
      }
    }
  } catch {
    // Ignore errors querying debug extension
  }
  return false;
}

export function inferShape3D(obj: GameObject): Shape3D {
  if (obj.shape3D) return obj.shape3D;
  const lower = (obj.name || '').toLowerCase();
  if (lower.includes('luz') || lower.includes('light') || lower.includes('lamp')) return 'light';
  if (lower.includes('moneda') || lower.includes('coin')) return 'coin';
  if (lower.includes('rampa') || lower.includes('ramp')) return 'ramp';
  if (lower.includes('arbol') || lower.includes('árbol') || lower.includes('tree')) return 'tree';
  if (lower.includes('roca') || lower.includes('rock') || lower.includes('piedra')) return 'rock';
  if (lower.includes('esfera') || lower.includes('sphere') || lower.includes('ball') || lower.includes('orb')) return 'sphere';
  if (lower.includes('cilindro') || lower.includes('cylinder') || lower.includes('pilar')) return 'cylinder';
  if (lower.includes('cono') || lower.includes('cone')) return 'cone';
  if (lower.includes('plano') || lower.includes('plane')) return 'plane';
  if (
    lower.includes('jugador') ||
    lower.includes('player') ||
    lower.includes('enemigo') ||
    lower.includes('enemy') ||
    lower.includes('boss') ||
    lower.includes('jefe') ||
    obj.behaviors?.some((b) =>
      ['Player3D', 'PlatformerCharacter', 'TopDownRPGMovement', 'Boss', 'Boss3D'].includes(b.name)
    )
  ) {
    return 'character';
  }
  return 'box';
}

export function getObject3DPosition(obj: GameObject): { x: number; y: number; z: number } {
  if (obj.position3D) {
    return {
      x: Number(obj.position3D.x) || 0,
      y: Number(obj.position3D.y) || 0,
      z: Number(obj.position3D.z) || 0,
    };
  }
  const cx = (obj.x ?? 0) + (obj.width ?? 50) / 2;
  const cy = (obj.y ?? 0) + (obj.height ?? 50) / 2;
  return {
    x: Number((cx / 50).toFixed(3)),
    y: 0,
    z: Number((cy / 50).toFixed(3)),
  };
}

export function getObject3DRotation(obj: GameObject): { x: number; y: number; z: number } {
  if (obj.rotation3D) {
    return {
      x: Number(obj.rotation3D.x) || 0,
      y: Number(obj.rotation3D.y) || 0,
      z: Number(obj.rotation3D.z) || 0,
    };
  }
  return {
    x: 0,
    y: -((obj.rotation || 0) * Math.PI) / 180,
    z: 0,
  };
}

export function getObject3DDimensions(obj: GameObject): { w: number; h: number; d: number } {
  if (obj.scale3D) {
    return {
      w: Math.max(0.05, Number(obj.scale3D.x) || 1),
      h: Math.max(0.05, Number(obj.scale3D.y) || 1),
      d: Math.max(0.05, Number(obj.scale3D.z) || 1),
    };
  }
  const shape = inferShape3D(obj);
  const w2d = Math.max(0.2, ((obj.width || 50) / 50) * Math.abs(obj.scaleX ?? 1));
  const h2d = Math.max(0.2, ((obj.height || 50) / 50) * Math.abs(obj.scaleY ?? 1));
  const isFlatGround =
    shape === 'plane' ||
    obj.name.toLowerCase().includes('ground') ||
    obj.name.toLowerCase().includes('suelo') ||
    obj.name.toLowerCase().includes('piso') ||
    (w2d >= 3.5 && h2d <= 2);

  if (isFlatGround) {
    return {
      w: w2d,
      h: shape === 'plane' ? 0.08 : 0.6,
      d: Math.max(2, h2d),
    };
  }
  return {
    w: w2d,
    h: h2d,
    d: w2d,
  };
}

/**
 * Syncs 3D coordinates cleanly back into 2D object properties so 2D and 3D views/events stay unified.
 */
export function sync3DTo2D(obj: GameObject): void {
  const pos = getObject3DPosition(obj);
  const dims = getObject3DDimensions(obj);
  const rot = getObject3DRotation(obj);
  obj.x = Math.round(pos.x * 50 - (obj.width || dims.w * 50) / 2);
  obj.y = Math.round(pos.z * 50 - (obj.height || dims.d * 50) / 2);
  obj.rotation = Math.round((-rot.y * 180) / Math.PI);
}

/**
 * Checks if a GameObject acts as a solid collider in 3D scenes.
 */
export function isSolidObject3D(obj: GameObject): boolean {
  if (!obj || obj.isUI || obj.visible === false || obj.isTouchable === false) return false;
  if (obj.isSolid3D === true) return true;
  return Boolean(obj.behaviors?.some((b) => b.name === 'Solid3D' || b.name === 'Solid'));
}

/**
 * Resolves an object's image texture URL if it references an asset ID or URL.
 */
export function resolveObjectImageUrl(obj: GameObject, assets?: GameAsset[]): string | undefined {
  if (!obj.imageUrl && !obj.assetId) return undefined;
  const raw = obj.imageUrl || '';
  if (raw && (raw.startsWith('data:') || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/'))) {
    return raw;
  }
  const key = obj.assetId || obj.imageUrl;
  const found = assets?.find((a) => String(a.id) === String(key) || a.name === key);
  return found?.url || (raw || undefined);
}

// Shared Texture & GLTF Caches (with proper ref counting / clone reuse)
const textureCache = new Map<string, THREE.Texture>();

export interface GLTFCacheEntry {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const gltfCache = new Map<string, Promise<GLTFCacheEntry>>();
const resolvedGltfCache = new Map<string, GLTFCacheEntry>();
const gltfLoader = new GLTFLoader();

function getCachedTexture(url: string): THREE.Texture {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    textureCache.set(url, tex);
  }
  return tex;
}

function cloneGLTFScene(scene: THREE.Group): THREE.Group {
  try {
    return (SkeletonUtils.clone(scene) as THREE.Group) || scene.clone(true);
  } catch {
    return scene.clone(true);
  }
}

export function getCachedGLTFSync(url?: string): GLTFCacheEntry | null {
  if (!url) return null;
  const entry = resolvedGltfCache.get(url);
  if (!entry) return null;
  return {
    scene: cloneGLTFScene(entry.scene),
    animations: entry.animations,
  };
}

export function loadCachedGLTF(url: string): Promise<GLTFCacheEntry> {
  const cached = resolvedGltfCache.get(url);
  if (cached) {
    return Promise.resolve({
      scene: cloneGLTFScene(cached.scene),
      animations: cached.animations,
    });
  }
  let promise = gltfCache.get(url);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      gltfLoader.load(
        url,
        (gltf) => {
          const entry: GLTFCacheEntry = {
            scene: gltf.scene,
            animations: gltf.animations || [],
          };
          resolvedGltfCache.set(url, entry);
          resolve(entry);
        },
        undefined,
        (err) => {
          gltfCache.delete(url);
          reject(err);
        }
      );
    });
    gltfCache.set(url, promise);
  }
  return promise.then((entry) => ({
    scene: cloneGLTFScene(entry.scene),
    animations: entry.animations,
  }));
}

export async function preloadGLTFModels(urls: (string | undefined | null)[]): Promise<void> {
  const unique = Array.from(new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0)));
  if (unique.length === 0) return;
  await Promise.allSettled(unique.map((u) => loadCachedGLTF(u)));
}

export async function getModelAnimations(url: string): Promise<{ name: string; duration: number }[]> {
  try {
    const data = await loadCachedGLTF(url);
    return (data.animations || []).map((a, i) => ({
      name: a.name || `Animación ${i + 1}`,
      duration: Number(a.duration.toFixed(2)),
    }));
  } catch {
    return [];
  }
}

export function build3DVisualSignature(obj: GameObject, assets?: GameAsset[], editorMode = false): string {
  const shape = inferShape3D(obj);
  const img = resolveObjectImageUrl(obj, assets) || '';
  const dims = getObject3DDimensions(obj);
  return [
    shape,
    obj.modelUrl || '',
    obj.animation3D || '',
    obj.color || '#eab308',
    obj.opacity ?? 1,
    obj.visible !== false ? 1 : 0,
    editorMode ? 1 : 0,
    obj.roughness3D ?? 0.55,
    obj.metalness3D ?? 0.1,
    obj.emissive3D || '',
    obj.emissiveIntensity3D ?? 0,
    obj.castShadow3D !== false ? 1 : 0,
    obj.receiveShadow3D !== false ? 1 : 0,
    obj.lightIntensity3D ?? 2,
    obj.lightDistance3D ?? 20,
    img.slice(0, 64),
    dims.w.toFixed(3),
    dims.h.toFixed(3),
    dims.d.toFixed(3),
  ].join('|');
}

function parseColorSafe(colorStr?: string, fallback = '#6366f1'): THREE.Color {
  if (!colorStr || colorStr === 'transparent') {
    return new THREE.Color(fallback);
  }
  try {
    return new THREE.Color(colorStr);
  } catch {
    return new THREE.Color(fallback);
  }
}

function traverseOwnObject3D(root: THREE.Object3D, visitor: (node: THREE.Object3D) => void): void {
  visitor(root);
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (ch.userData?.isGameObjectRoot) continue;
    traverseOwnObject3D(ch, visitor);
  }
}

export function applyMaterialTintToGroup(root: THREE.Object3D, obj: GameObject, isEditor = false): void {
  const isHidden = obj.visible === false;
  const opacity = isHidden && isEditor ? 0.3 : (obj.opacity ?? 1);
  const transparent = opacity < 1 || (isHidden && isEditor);
  const hasModel = Boolean(root.userData?.modelGroup);
  const hasEmissive = Boolean(obj.emissive3D && obj.emissive3D !== '#000000' && (obj.emissiveIntensity3D ?? 0) > 0);
  const emissiveColor = hasEmissive ? parseColorSafe(obj.emissive3D, '#000000') : null;
  const emissiveIntensity = hasEmissive ? (obj.emissiveIntensity3D ?? 0.6) : 0;

  traverseOwnObject3D(root, (child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std) return;
      if (std.userData._origEmissiveSaved !== true) {
        std.userData._origEmissiveSaved = true;
        std.userData._origEmissiveHex = std.emissive ? std.emissive.getHex() : 0x000000;
        std.userData._origEmissiveIntensity = std.emissiveIntensity ?? 0;
        std.userData._origOpacity = std.opacity ?? 1;
        std.userData._origTransparent = Boolean(std.transparent);
      }
      if (!hasModel && !std.map && std.color && obj.color && obj.color !== 'transparent') {
        std.color.copy(parseColorSafe(obj.color, '#6366f1'));
      }
      if (std.emissive) {
        if (emissiveColor) {
          std.emissive.copy(emissiveColor);
          std.emissiveIntensity = emissiveIntensity;
        } else {
          std.emissive.setHex(std.userData._origEmissiveHex ?? 0x000000);
          std.emissiveIntensity = std.userData._origEmissiveIntensity ?? 0;
        }
      }
      std.opacity = Math.min(1, opacity * (hasModel ? (std.userData._origOpacity ?? 1) : 1));
      std.transparent = transparent || Boolean(std.userData._origTransparent && hasModel);
      std.needsUpdate = true;
    });
  });
}

function attachGLTFModelToRoot(
  root: THREE.Group,
  obj: GameObject,
  gltfGroup: THREE.Group,
  animations: THREE.AnimationClip[],
  dims: { w: number; h: number; d: number },
  castShadow: boolean,
  receiveShadow: boolean,
  isEditor: boolean,
  onModelLoaded?: (data?: { animations: THREE.AnimationClip[] }) => void
): void {
  const box = new THREE.Box3().setFromObject(gltfGroup);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const normScale = Math.max(dims.w, dims.h, dims.d) / maxDim;
  gltfGroup.scale.setScalar(normScale);
  gltfGroup.position.set(-center.x * normScale, -box.min.y * normScale, -center.z * normScale);

  gltfGroup.traverse((child) => {
    child.userData.gameObjectId = obj.id;
    if ((child as THREE.Mesh).isMesh) {
      const m = child as THREE.Mesh;
      m.castShadow = castShadow;
      m.receiveShadow = receiveShadow;
    }
  });

  root.userData.animations = animations || [];
  root.userData.modelGroup = gltfGroup;
  root.userData.loadedModelUrl = obj.modelUrl;

  if (animations && animations.length > 0) {
    const mixer = new THREE.AnimationMixer(gltfGroup);
    root.userData.mixer = mixer;
    const clipMap = new Map<string, THREE.AnimationClip>();
    animations.forEach((c) => {
      if (c.name) clipMap.set(c.name.toLowerCase(), c);
    });
    root.userData.clipMap = clipMap;

    const playAction = (animName?: string, loop = true, speed = 1) => {
      let clip: THREE.AnimationClip | undefined;
      if (animName) {
        clip = clipMap.get(animName.toLowerCase()) || animations.find((c) => c.name.toLowerCase().includes(animName.toLowerCase()));
      } else if (animations.length > 0) {
        clip = animations[0];
      }
      if (!clip) return;
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.timeScale = speed || 1;
      action.play();
      root.userData.currentActionName = clip.name;
      root.userData.currentActionLoop = loop;
      root.userData.currentActionSpeed = speed || 1;
    };

    root.userData.playAnimation3D = playAction;
    root.userData.stopAnimation3D = () => {
      mixer.stopAllAction();
      root.userData.currentActionName = undefined;
    };

    const pendingAnim = root.userData.pendingAnimation3D as { name?: string; loop?: boolean; speed?: number } | undefined;
    const runtimeAnim = (obj as any)._runtimeAnim3D as { name?: string; loop?: boolean; speed?: number } | undefined;
    const anim3DBehav = obj.behaviors?.find((b) => b.name === 'Animation3D');
    const targetAnimName = pendingAnim?.name || runtimeAnim?.name || obj.animation3D || anim3DBehav?.properties?.animationName;
    const autoPlay = anim3DBehav?.properties?.autoPlay !== false;
    const loop = pendingAnim?.loop ?? runtimeAnim?.loop ?? (anim3DBehav?.properties?.loop !== false && obj.animation3DLoop !== false);
    const speed = Number(pendingAnim?.speed ?? runtimeAnim?.speed ?? anim3DBehav?.properties?.speed ?? obj.animation3DSpeed ?? 1);
    delete root.userData.pendingAnimation3D;

    if (targetAnimName) {
      playAction(targetAnimName, loop, speed);
    } else if (pendingAnim || runtimeAnim) {
      playAction(undefined, loop, speed);
    } else if (autoPlay && animations.length > 0) {
      const defaultClip = animations.find((c) => /idle|reposo|quieto|stand/i.test(c.name)) || animations[0];
      playAction(defaultClip.name, true, 1);
    }
  }

  root.add(gltfGroup);
  applyMaterialTintToGroup(root, obj, isEditor);
  onModelLoaded?.({ animations: animations || [] });
}

export function createObject3DMesh(
  obj: GameObject,
  assets?: GameAsset[],
  options: { isEditor?: boolean; hidePlaceholder?: boolean; onModelLoaded?: (data?: { animations: THREE.AnimationClip[] }) => void } = {}
): THREE.Group {
  const root = new THREE.Group();
  root.userData.isGameObjectRoot = true;
  root.userData.gameObjectId = obj.id;
  root.userData.gameObjectName = obj.name;

  const isEditor = Boolean(options.isEditor);
  const shape = inferShape3D(obj);
  const dims = getObject3DDimensions(obj);
  const isHidden = obj.visible === false;
  const opacity = isHidden && isEditor ? 0.3 : (obj.opacity ?? 1);
  const transparent = opacity < 1 || (isHidden && isEditor);

  const imageUrl = resolveObjectImageUrl(obj, assets);
  const baseColor = parseColorSafe(obj.color, '#6366f1');
  const roughness = obj.roughness3D ?? (shape === 'coin' ? 0.25 : 0.55);
  const metalness = obj.metalness3D ?? (shape === 'coin' ? 0.85 : 0.1);
  const castShadow = obj.castShadow3D !== false && shape !== 'plane' && shape !== 'light';
  const receiveShadow = obj.receiveShadow3D !== false;

  const makeMaterial = (overrideColor?: THREE.ColorRepresentation, extra?: THREE.MeshStandardMaterialParameters) => {
    const matParams: THREE.MeshStandardMaterialParameters = {
      color: overrideColor !== undefined ? overrideColor : baseColor,
      roughness,
      metalness,
      transparent,
      opacity,
      ...(obj.emissive3D ? { emissive: parseColorSafe(obj.emissive3D, '#000000'), emissiveIntensity: obj.emissiveIntensity3D ?? 0.6 } : {}),
      ...extra,
    };
    if (imageUrl && overrideColor === undefined) {
      matParams.map = getCachedTexture(imageUrl);
      matParams.color = 0xffffff;
    }
    return new THREE.MeshStandardMaterial(matParams);
  };

  // Custom GLB Model support
  if (obj.modelUrl) {
    root.userData.loadedModelUrl = obj.modelUrl;
    const syncCached = getCachedGLTFSync(obj.modelUrl);
    if (syncCached) {
      attachGLTFModelToRoot(
        root,
        obj,
        syncCached.scene,
        syncCached.animations,
        dims,
        castShadow,
        receiveShadow,
        isEditor,
        options.onModelLoaded
      );
      return root;
    }

    let placeholder: THREE.Mesh | null = null;
    let placeholderMat: THREE.MeshStandardMaterial | null = null;
    if (isEditor && !options.hidePlaceholder) {
      placeholderMat = makeMaterial(baseColor, { wireframe: true, opacity: 0.35, transparent: true });
      placeholder = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), placeholderMat);
      placeholder.position.y = dims.h / 2;
      placeholder.userData.gameObjectId = obj.id;
      root.add(placeholder);
    }

    loadCachedGLTF(obj.modelUrl)
      .then(({ scene: gltfGroup, animations }) => {
        if (root.userData._disposed || (!root.parent && !isEditor)) return;
        if (placeholder) {
          root.remove(placeholder);
          placeholder.geometry.dispose();
          placeholderMat?.dispose();
          placeholder = null;
          placeholderMat = null;
        }
        attachGLTFModelToRoot(
          root,
          obj,
          gltfGroup,
          animations,
          dims,
          castShadow,
          receiveShadow,
          isEditor,
          options.onModelLoaded
        );
      })
      .catch(() => {
        if (root.userData._disposed || root.userData.modelGroup) return;
        if (placeholder && placeholderMat) {
          placeholderMat.wireframe = false;
          placeholderMat.opacity = opacity;
          placeholderMat.transparent = transparent;
        } else {
          const fallbackMat = makeMaterial(baseColor, { opacity, transparent });
          const fallbackMesh = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), fallbackMat);
          fallbackMesh.position.y = dims.h / 2;
          fallbackMesh.userData.gameObjectId = obj.id;
          root.add(fallbackMesh);
        }
      });
    return root;
  }

  switch (shape) {
    case 'light': {
      const lightColor = parseColorSafe(obj.color, '#fde047');
      const pLight = new THREE.PointLight(lightColor, obj.lightIntensity3D ?? 2.4, obj.lightDistance3D ?? 22, 1.5);
      pLight.position.set(0, 0.5, 0);
      root.add(pLight);

      if (isEditor) {
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 16, 12),
          new THREE.MeshStandardMaterial({
            color: lightColor,
            emissive: lightColor,
            emissiveIntensity: 1.5,
            roughness: 0.2,
          })
        );
        bulb.position.y = 0.5;
        bulb.userData.gameObjectId = obj.id;
        root.add(bulb);
      }
      break;
    }

    case 'character': {
      const bodyH = dims.h * 0.52;
      const headR = Math.min(dims.w, dims.d) * 0.34;
      const legH = dims.h * 0.28;
      const legW = dims.w * 0.26;
      const bodyMat = makeMaterial();
      const headMat = makeMaterial(baseColor.clone().lerp(new THREE.Color('#ffffff'), 0.22));
      const visorMat = new THREE.MeshStandardMaterial({
        color: '#0f172a',
        emissive: '#38bdf8',
        emissiveIntensity: 0.45,
        roughness: 0.2,
        metalness: 0.4,
        transparent,
        opacity,
      });

      const legL = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), bodyMat);
      legL.position.set(-dims.w * 0.2, legH / 2, 0);
      const legR = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), bodyMat);
      legR.position.set(dims.w * 0.2, legH / 2, 0);

      const torso = new THREE.Mesh(new THREE.BoxGeometry(dims.w * 0.8, bodyH, dims.d * 0.6), bodyMat);
      torso.position.y = legH + bodyH / 2;

      const armW = dims.w * 0.22;
      const armL = new THREE.Mesh(new THREE.BoxGeometry(armW, bodyH * 0.9, armW), bodyMat);
      armL.position.set(-dims.w * 0.54, legH + bodyH * 0.5, 0);
      const armR = new THREE.Mesh(new THREE.BoxGeometry(armW, bodyH * 0.9, armW), bodyMat);
      armR.position.set(dims.w * 0.54, legH + bodyH * 0.5, 0);

      const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 14), headMat);
      head.position.y = legH + bodyH + headR * 0.85;

      // Forward-facing visor so player heading (+Z local or -Z) is unmistakable
      const visor = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.25, headR * 0.48, headR * 0.55), visorMat);
      visor.position.set(0, legH + bodyH + headR * 0.9, headR * 0.72);

      [legL, legR, torso, armL, armR, head, visor].forEach((m) => {
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
        m.userData.gameObjectId = obj.id;
        root.add(m);
      });
      break;
    }

    case 'coin': {
      const r = Math.min(dims.w, dims.h, dims.d) * 0.48;
      const thickness = Math.max(0.12, r * 0.28);
      const coinMat = makeMaterial(obj.color === 'transparent' ? '#facc15' : baseColor, {
        metalness: 0.85,
        roughness: 0.22,
        emissive: '#ca8a04',
        emissiveIntensity: 0.2,
      });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, thickness, 24), coinMat);
      disc.rotation.x = Math.PI / 2;
      disc.position.y = r + 0.12;
      disc.castShadow = castShadow;
      disc.receiveShadow = receiveShadow;
      disc.userData.gameObjectId = obj.id;

      const rimMat = new THREE.MeshStandardMaterial({
        color: '#fef08a',
        metalness: 0.9,
        roughness: 0.15,
        transparent,
        opacity,
      });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.88, thickness * 0.25, 10, 24), rimMat);
      rim.position.y = r + 0.12;
      rim.userData.gameObjectId = obj.id;

      root.add(disc, rim);
      break;
    }

    case 'sphere': {
      const radius = Math.max(dims.w, dims.h, dims.d) / 2;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 18), makeMaterial());
      mesh.scale.set(dims.w / (radius * 2), dims.h / (radius * 2), dims.d / (radius * 2));
      mesh.position.y = dims.h / 2;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'cylinder': {
      const r = Math.min(dims.w, dims.d) / 2;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dims.h, 24), makeMaterial());
      mesh.position.y = dims.h / 2;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'cone': {
      const r = Math.min(dims.w, dims.d) / 2;
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(r, dims.h, 20), makeMaterial());
      mesh.position.y = dims.h / 2;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'capsule': {
      const r = Math.min(dims.w, dims.d) / 2;
      const bodyLen = Math.max(0.1, dims.h - r * 2);
      const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, bodyLen, 8, 16), makeMaterial());
      mesh.position.y = dims.h / 2;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'torus': {
      const majorR = Math.min(dims.w, dims.d) * 0.38;
      const tubeR = Math.max(0.08, majorR * 0.35);
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(majorR, tubeR, 14, 28), makeMaterial());
      mesh.position.y = majorR + tubeR;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'ramp': {
      // Wedge geometry sloped upward along -Z -> +Z
      const hw = dims.w / 2;
      const hd = dims.d / 2;
      const h = dims.h;
      const vertices = new Float32Array([
        // Bottom face
        -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,
        -hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd,
        // Back face (+Z high end)
        -hw, 0, hd,   hw, 0, hd,   hw, h, hd,
        -hw, 0, hd,   hw, h, hd,  -hw, h, hd,
        // Sloped top
        -hw, 0, -hd,  hw, h, hd,   hw, 0, -hd,
        -hw, 0, -hd, -hw, h, hd,   hw, h, hd,
        // Left side
        -hw, 0, -hd, -hw, 0, hd,  -hw, h, hd,
        // Right side
         hw, 0, -hd,  hw, h, hd,   hw, 0, hd,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, makeMaterial());
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'tree': {
      const trunkH = dims.h * 0.42;
      const trunkR = Math.min(dims.w, dims.d) * 0.16;
      const trunkMat = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.85, transparent, opacity });
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 10), trunkMat);
      trunk.position.y = trunkH / 2;

      const foliageColor = obj.color && obj.color !== 'transparent' ? baseColor : '#15803d';
      const crownMat = new THREE.MeshStandardMaterial({ color: foliageColor, roughness: 0.72, flatShading: true, transparent, opacity });
      const cone1 = new THREE.Mesh(new THREE.ConeGeometry(dims.w * 0.52, dims.h * 0.45, 7), crownMat);
      cone1.position.y = trunkH + dims.h * 0.18;
      const cone2 = new THREE.Mesh(new THREE.ConeGeometry(dims.w * 0.38, dims.h * 0.38, 7), crownMat);
      cone2.position.y = trunkH + dims.h * 0.42;

      [trunk, cone1, cone2].forEach((m) => {
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
        m.userData.gameObjectId = obj.id;
        root.add(m);
      });
      break;
    }

    case 'rock': {
      const radius = Math.max(dims.w, dims.h, dims.d) * 0.45;
      const mat = makeMaterial(obj.color === '#eab308' ? '#64748b' : baseColor, {
        roughness: 0.9,
        metalness: 0.05,
        flatShading: true,
      });
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(radius, 0), mat);
      rock.scale.set(dims.w / (radius * 2), dims.h / (radius * 2), dims.d / (radius * 2));
      rock.position.y = dims.h * 0.42;
      rock.castShadow = castShadow;
      rock.receiveShadow = receiveShadow;
      rock.userData.gameObjectId = obj.id;
      root.add(rock);
      break;
    }

    case 'plane': {
      const geo = new THREE.PlaneGeometry(dims.w, dims.d);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, makeMaterial(undefined, { side: THREE.DoubleSide }));
      mesh.position.y = 0.02;
      mesh.receiveShadow = true;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }

    case 'box':
    default: {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), makeMaterial());
      mesh.position.y = dims.h / 2;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.userData.gameObjectId = obj.id;
      root.add(mesh);
      break;
    }
  }

  return root;
}

export function disposeObject3D(group: THREE.Object3D): void {
  group.userData._disposed = true;
  traverseOwnObject3D(group, (child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    if (Array.isArray(mat)) {
      mat.forEach((m) => m.dispose());
    } else if (mat) {
      mat.dispose();
    }
  });
}

const _wtMatA = new THREE.Matrix4();
const _wtMatWorld = new THREE.Matrix4();
const _wtPos = new THREE.Vector3();
const _wtQuat = new THREE.Quaternion();
const _wtScl = new THREE.Vector3(1, 1, 1);
const _wtEuler = new THREE.Euler(0, 0, 0, 'XYZ');

export function getWorld3DTransformFromMap(
  obj: GameObject,
  objectsById?: Map<number, GameObject>
): { pos: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number } } {
  if (!obj.parentId || obj.isUI || !objectsById || !objectsById.has(obj.parentId)) {
    return {
      pos: getObject3DPosition(obj),
      rot: getObject3DRotation(obj),
    };
  }
  const chain: GameObject[] = [];
  const seen = new Set<number>();
  let curr: GameObject | undefined = obj;
  let safety = 64;
  while (curr && safety-- > 0 && !seen.has(curr.id)) {
    seen.add(curr.id);
    chain.push(curr);
    if (!curr.parentId || curr.isUI) break;
    curr = objectsById.get(curr.parentId);
  }
  _wtMatWorld.identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = getObject3DPosition(chain[i]);
    const r = getObject3DRotation(chain[i]);
    _wtPos.set(p.x, p.y, p.z);
    _wtEuler.set(r.x, r.y, r.z, 'XYZ');
    _wtQuat.setFromEuler(_wtEuler);
    _wtMatA.compose(_wtPos, _wtQuat, _wtScl);
    _wtMatWorld.multiply(_wtMatA);
  }
  _wtMatWorld.decompose(_wtPos, _wtQuat, _wtScl);
  _wtEuler.setFromQuaternion(_wtQuat, 'XYZ');
  return {
    pos: { x: _wtPos.x, y: _wtPos.y, z: _wtPos.z },
    rot: { x: _wtEuler.x, y: _wtEuler.y, z: _wtEuler.z },
  };
}

export interface Object3DBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  width: number;
  height: number;
  depth: number;
  hx: number;
  hy: number;
  hz: number;
  ax: [number, number, number];
  ay: [number, number, number];
  az: [number, number, number];
  isRotated: boolean;
  shape3D?: Shape3D;
}

export interface CollisionMTV3D {
  x: number;
  y: number;
  z: number;
  depth: number;
}

export function samplePoseTimeline(
  frames: PoseFrame[],
  elapsedMs: number,
  loop: boolean
): {
  frameIndex: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  visualFrame: PoseFrame;
} {
  if (!frames || frames.length === 0) {
    const def: PoseFrame = {
      id: 'frame_default',
      name: 'Default',
      shape3D: 'box',
      color: '#3b82f6',
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      duration: 300,
    };
    return {
      frameIndex: 0,
      position: def.position,
      rotation: def.rotation,
      scale: def.scale,
      visualFrame: def,
    };
  }
  if (frames.length === 1) {
    const f = frames[0];
    return {
      frameIndex: 0,
      position: f.position || { x: 0, y: 0, z: 0 },
      rotation: f.rotation || { x: 0, y: 0, z: 0 },
      scale: f.scale || { x: 1, y: 1, z: 1 },
      visualFrame: f,
    };
  }

  const durations = frames.map((f) => Math.max(20, Number(f.duration) || 300));
  const totalMs = durations.reduce((acc, d) => acc + d, 0);
  const clampedMs = loop ? ((elapsedMs % totalMs) + totalMs) % totalMs : Math.min(elapsedMs, totalMs);

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  let cursor = 0;
  for (let i = 0; i < frames.length; i++) {
    const dur = durations[i];
    if (clampedMs <= cursor + dur || i === frames.length - 1) {
      const nextIdx = loop ? (i + 1) % frames.length : Math.min(i + 1, frames.length - 1);
      const t = dur > 0 ? Math.min(1, Math.max(0, (clampedMs - cursor) / dur)) : 0;
      const cur = frames[i];
      const nxt = frames[nextIdx];
      const curPos = cur.position || { x: 0, y: 0, z: 0 };
      const nxtPos = nxt.position || { x: 0, y: 0, z: 0 };
      const curRot = cur.rotation || { x: 0, y: 0, z: 0 };
      const nxtRot = nxt.rotation || { x: 0, y: 0, z: 0 };
      const curScale = cur.scale || { x: 1, y: 1, z: 1 };
      const nxtScale = nxt.scale || { x: 1, y: 1, z: 1 };
      return {
        frameIndex: i,
        position: {
          x: lerp(curPos.x, nxtPos.x, t),
          y: lerp(curPos.y, nxtPos.y, t),
          z: lerp(curPos.z, nxtPos.z, t),
        },
        rotation: {
          x: lerp(curRot.x, nxtRot.x, t),
          y: lerp(curRot.y, nxtRot.y, t),
          z: lerp(curRot.z, nxtRot.z, t),
        },
        scale: {
          x: lerp(curScale.x, nxtScale.x, t),
          y: lerp(curScale.y, nxtScale.y, t),
          z: lerp(curScale.z, nxtScale.z, t),
        },
        visualFrame: cur,
      };
    }
    cursor += dur;
  }

  const last = frames[frames.length - 1];
  return {
    frameIndex: frames.length - 1,
    position: last.position || { x: 0, y: 0, z: 0 },
    rotation: last.rotation || { x: 0, y: 0, z: 0 },
    scale: last.scale || { x: 1, y: 1, z: 1 },
    visualFrame: last,
  };
}

export function getEffectiveObject3DBounds(
  obj: GameObject,
  activePose?: {
    poseAnimation?: PoseAnimation;
    animation?: PoseAnimation;
    startTime?: number;
    startedAt?: number;
    loop?: boolean;
    speed?: number;
  } | null,
  nowMs: number = Date.now(),
  options?: { stableYawXZ?: boolean; objectsById?: Map<number, GameObject> }
): Object3DBounds {
  const worldT = options?.objectsById
    ? getWorld3DTransformFromMap(obj, options.objectsById)
    : { pos: getObject3DPosition(obj), rot: getObject3DRotation(obj) };
  const basePos = worldT.pos;
  const baseDims = getObject3DDimensions(obj);
  const baseRot = worldT.rot;

  let animPosOffX = 0;
  let animPosOffY = 0;
  let animPosOffZ = 0;
  let rotX = baseRot.x;
  let rotY = baseRot.y;
  let rotZ = baseRot.z;
  let scaleX = 1;
  let scaleY = 1;
  let scaleZ = 1;

  const poseAnim = activePose?.poseAnimation || activePose?.animation;
  if (poseAnim && poseAnim.frames && poseAnim.frames.length > 0) {
    const frames = poseAnim.frames;
    const startTime = activePose.startTime ?? activePose.startedAt ?? nowMs;
    const speed = activePose.speed ?? 1;
    const isLoop = activePose.loop !== false;
    const rawElapsed = Math.max(0, (nowMs - startTime) * speed);
    const sampled = samplePoseTimeline(frames, rawElapsed, isLoop);

    animPosOffX = sampled.position.x || 0;
    animPosOffY = sampled.position.y || 0;
    animPosOffZ = sampled.position.z || 0;
    rotX = baseRot.x + (sampled.rotation.x || 0) * (Math.PI / 180);
    rotY = baseRot.y + (sampled.rotation.y || 0) * (Math.PI / 180);
    rotZ = baseRot.z + (sampled.rotation.z || 0) * (Math.PI / 180);
    scaleX = Math.max(0.05, sampled.scale.x || 1);
    scaleY = Math.max(0.05, sampled.scale.y || 1);
    scaleZ = Math.max(0.05, sampled.scale.z || 1);
  }

  const posX = basePos.x + animPosOffX;
  const posY = basePos.y + animPosOffY;
  const posZ = basePos.z + animPosOffZ;

  const effW = baseDims.w * scaleX;
  const effH = baseDims.h * scaleY;
  const effD = baseDims.d * scaleZ;

  const useStableYaw = Boolean(options?.stableYawXZ && Math.abs(rotX) < 0.05 && Math.abs(rotZ) < 0.05);
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  const cy = useStableYaw ? 1 : Math.cos(rotY), sy = useStableYaw ? 0 : Math.sin(rotY);
  const cz = Math.cos(rotZ), sz = Math.sin(rotZ);

  // Euler XYZ rotation matrix columns
  const r00 = cy * cz;
  const r10 = cx * sz + sx * sy * cz;
  const r20 = sx * sz - cx * sy * cz;

  const r01 = -cy * sz;
  const r11 = cx * cz - sx * sy * sz;
  const r21 = sx * cz + cx * sy * sz;

  const r02 = sy;
  const r12 = -sx * cy;
  const r22 = cx * cy;

  const localCenterY = effH / 2;
  const centerX = posX + r01 * localCenterY;
  const centerY = posY + r11 * localCenterY;
  const centerZ = posZ + r21 * localCenterY;

  const hx = effW / 2;
  const hy = effH / 2;
  const hz = effD / 2;

  const halfX = Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz;
  const halfY = Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz;
  const halfZ = Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz;

  const isRotated =
    Math.abs(rotX) > 1e-4 ||
    Math.abs(useStableYaw ? 0 : rotY) > 1e-4 ||
    Math.abs(rotZ) > 1e-4;

  return {
    minX: centerX - halfX,
    maxX: centerX + halfX,
    minY: centerY - halfY,
    maxY: centerY + halfY,
    minZ: centerZ - halfZ,
    maxZ: centerZ + halfZ,
    centerX,
    centerY,
    centerZ,
    width: halfX * 2,
    height: halfY * 2,
    depth: halfZ * 2,
    hx,
    hy,
    hz,
    ax: [r00, r10, r20],
    ay: [r01, r11, r21],
    az: [r02, r12, r22],
    isRotated,
    shape3D: inferShape3D(obj),
  };
}

function getRampWedgeVertices(b: Object3DBounds): [number, number, number][] {
  const { centerX: cx, centerY: cy, centerZ: cz, ax, ay, az, hx, hy, hz } = b;
  const pt = (sx: number, sy: number, sz: number): [number, number, number] => [
    cx + ax[0] * (sx * hx) + ay[0] * (sy * hy) + az[0] * (sz * hz),
    cy + ax[1] * (sx * hx) + ay[1] * (sy * hy) + az[1] * (sz * hz),
    cz + ax[2] * (sx * hx) + ay[2] * (sy * hy) + az[2] * (sz * hz),
  ];
  return [
    pt(-1, -1, -1),
    pt( 1, -1, -1),
    pt(-1, -1,  1),
    pt( 1, -1,  1),
    pt(-1,  1,  1),
    pt( 1,  1,  1),
  ];
}

function solveRampVsOBB3D(ramp: Object3DBounds, obb: Object3DBounds, eps: number): CollisionMTV3D | null {
  const wedgeVerts = getRampWedgeVertices(ramp);
  const axes: [number, number, number][] = [];
  const pushAxis = (x: number, y: number, z: number) => {
    const lenSq = x * x + y * y + z * z;
    if (lenSq < 1e-10) return;
    const inv = 1 / Math.sqrt(lenSq);
    axes.push([x * inv, y * inv, z * inv]);
  };

  // OBB axes + ramp basis + ramp slope normal
  pushAxis(obb.ax[0], obb.ax[1], obb.ax[2]);
  pushAxis(obb.ay[0], obb.ay[1], obb.ay[2]);
  pushAxis(obb.az[0], obb.az[1], obb.az[2]);
  pushAxis(ramp.ax[0], ramp.ax[1], ramp.ax[2]);
  pushAxis(ramp.ay[0], ramp.ay[1], ramp.ay[2]);
  pushAxis(ramp.az[0], ramp.az[1], ramp.az[2]);

  // Sloped top normal in world coords: ay * hz - az * hy
  const snx = ramp.ay[0] * ramp.hz - ramp.az[0] * ramp.hy;
  const sny = ramp.ay[1] * ramp.hz - ramp.az[1] * ramp.hy;
  const snz = ramp.ay[2] * ramp.hz - ramp.az[2] * ramp.hy;
  pushAxis(snx, sny, snz);

  // Slope edge direction: ay * hy + az * hz crossed with OBB axes
  const sex = ramp.ay[0] * ramp.hy + ramp.az[0] * ramp.hz;
  const sey = ramp.ay[1] * ramp.hy + ramp.az[1] * ramp.hz;
  const sez = ramp.ay[2] * ramp.hy + ramp.az[2] * ramp.hz;
  const rampEdges: [number, number, number][] = [ramp.ax, ramp.ay, ramp.az, [sex, sey, sez]];
  const obbAxes: [number, number, number][] = [obb.ax, obb.ay, obb.az];
  for (const e of rampEdges) {
    for (const a of obbAxes) {
      pushAxis(e[1] * a[2] - e[2] * a[1], e[2] * a[0] - e[0] * a[2], e[0] * a[1] - e[1] * a[0]);
    }
  }

  let minOverlap = Infinity;
  let bestAxis: [number, number, number] = [0, 1, 0];

  for (const L of axes) {
    let minW = Infinity;
    let maxW = -Infinity;
    for (const v of wedgeVerts) {
      const p = v[0] * L[0] + v[1] * L[1] + v[2] * L[2];
      if (p < minW) minW = p;
      if (p > maxW) maxW = p;
    }

    const cObb = obb.centerX * L[0] + obb.centerY * L[1] + obb.centerZ * L[2];
    const rObb =
      Math.abs(obb.ax[0] * L[0] + obb.ax[1] * L[1] + obb.ax[2] * L[2]) * obb.hx +
      Math.abs(obb.ay[0] * L[0] + obb.ay[1] * L[1] + obb.ay[2] * L[2]) * obb.hy +
      Math.abs(obb.az[0] * L[0] + obb.az[1] * L[1] + obb.az[2] * L[2]) * obb.hz;
    const minO = cObb - rObb;
    const maxO = cObb + rObb;

    const overlap = Math.min(maxW, maxO) - Math.max(minW, minO) + eps;
    if (overlap <= 0) return null;

    if (overlap < minOverlap) {
      minOverlap = overlap;
      const midW = (minW + maxW) * 0.5;
      const sign = cObb >= midW ? 1 : -1;
      bestAxis = [L[0] * sign, L[1] * sign, L[2] * sign];
    }
  }

  if (!Number.isFinite(minOverlap)) return null;
  return {
    x: bestAxis[0] * minOverlap,
    y: bestAxis[1] * minOverlap,
    z: bestAxis[2] * minOverlap,
    depth: minOverlap,
  };
}

/**
 * Computes Minimum Translation Vector (MTV) pushing b1 out of b2 in 3D using exact SAT (OBB & Ramp wedge).
 * Returns null if separated.
 */
export function solveOBBCollision3D(
  b1: Object3DBounds,
  b2: Object3DBounds,
  eps: number = 0
): CollisionMTV3D | null {
  if (
    b1.maxX <= b2.minX - eps || b1.minX >= b2.maxX + eps ||
    b1.maxY <= b2.minY - eps || b1.minY >= b2.maxY + eps ||
    b1.maxZ <= b2.minZ - eps || b1.minZ >= b2.maxZ + eps
  ) {
    return null;
  }

  if (b2.shape3D === 'ramp' && b1.shape3D !== 'ramp') {
    return solveRampVsOBB3D(b2, b1, eps);
  }
  if (b1.shape3D === 'ramp' && b2.shape3D !== 'ramp') {
    const mtv = solveRampVsOBB3D(b1, b2, eps);
    return mtv ? { x: -mtv.x, y: -mtv.y, z: -mtv.z, depth: mtv.depth } : null;
  }

  if (!b1.isRotated && !b2.isRotated) {
    const ox = Math.min(b1.maxX, b2.maxX) - Math.max(b1.minX, b2.minX) + eps;
    const oy = Math.min(b1.maxY, b2.maxY) - Math.max(b1.minY, b2.minY) + eps;
    const oz = Math.min(b1.maxZ, b2.maxZ) - Math.max(b1.minZ, b2.minZ) + eps;
    if (ox <= 0 || oy <= 0 || oz <= 0) return null;
    if (oy <= ox && oy <= oz) {
      const s = b1.centerY >= b2.centerY ? 1 : -1;
      return { x: 0, y: oy * s, z: 0, depth: oy };
    } else if (ox <= oz) {
      const s = b1.centerX >= b2.centerX ? 1 : -1;
      return { x: ox * s, y: 0, z: 0, depth: ox };
    } else {
      const s = b1.centerZ >= b2.centerZ ? 1 : -1;
      return { x: 0, y: 0, z: oz * s, depth: oz };
    }
  }

  const dx = b1.centerX - b2.centerX;
  const dy = b1.centerY - b2.centerY;
  const dz = b1.centerZ - b2.centerZ;

  const A = [b1.ax, b1.ay, b1.az];
  const B = [b2.ax, b2.ay, b2.az];
  const hA = [b1.hx, b1.hy, b1.hz];
  const hB = [b2.hx, b2.hy, b2.hz];

  let minOverlap = Infinity;
  let bestAxis: [number, number, number] = [0, 1, 0];

  const testAxis = (lx: number, ly: number, lz: number) => {
    const lenSq = lx * lx + ly * ly + lz * lz;
    if (lenSq < 1e-10) return true;
    const inv = 1 / Math.sqrt(lenSq);
    const ux = lx * inv;
    const uy = ly * inv;
    const uz = lz * inv;

    const r1 =
      Math.abs(A[0][0] * ux + A[0][1] * uy + A[0][2] * uz) * hA[0] +
      Math.abs(A[1][0] * ux + A[1][1] * uy + A[1][2] * uz) * hA[1] +
      Math.abs(A[2][0] * ux + A[2][1] * uy + A[2][2] * uz) * hA[2];
    const r2 =
      Math.abs(B[0][0] * ux + B[0][1] * uy + B[0][2] * uz) * hB[0] +
      Math.abs(B[1][0] * ux + B[1][1] * uy + B[1][2] * uz) * hB[1] +
      Math.abs(B[2][0] * ux + B[2][1] * uy + B[2][2] * uz) * hB[2];

    const centerDist = dx * ux + dy * uy + dz * uz;
    const overlap = r1 + r2 - Math.abs(centerDist) + eps;
    if (overlap <= 0) return false;
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const s = centerDist >= 0 ? 1 : -1;
      bestAxis = [ux * s, uy * s, uz * s];
    }
    return true;
  };

  for (let i = 0; i < 3; i++) {
    if (!testAxis(A[i][0], A[i][1], A[i][2])) return null;
  }
  for (let j = 0; j < 3; j++) {
    if (!testAxis(B[j][0], B[j][1], B[j][2])) return null;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (!testAxis(
        A[i][1] * B[j][2] - A[i][2] * B[j][1],
        A[i][2] * B[j][0] - A[i][0] * B[j][2],
        A[i][0] * B[j][1] - A[i][1] * B[j][0]
      )) return null;
    }
  }

  if (!Number.isFinite(minOverlap)) return null;
  return {
    x: bestAxis[0] * minOverlap,
    y: bestAxis[1] * minOverlap,
    z: bestAxis[2] * minOverlap,
    depth: minOverlap,
  };
}

/**
 * Returns the walkable top surface world Y under/near a moving object's XZ footprint
 * on a ramp (supporting any rotation3D) or rotated/tilted solid platform.
 */
export function getWalkableSurface3D(
  footX: number,
  footZ: number,
  footHalfX: number,
  footHalfZ: number,
  bSolid: Object3DBounds
): number | null {
  const rx = Math.max(0.05, footHalfX * 0.7);
  const rz = Math.max(0.05, footHalfZ * 0.7);
  const samples: [number, number][] = [
    [footX, footZ],
    [footX - rx, footZ],
    [footX + rx, footZ],
    [footX, footZ - rz],
    [footX, footZ + rz],
  ];

  if (bSolid.shape3D === 'ramp') {
    const nx = bSolid.ay[0] * bSolid.hz - bSolid.az[0] * bSolid.hy;
    const ny = bSolid.ay[1] * bSolid.hz - bSolid.az[1] * bSolid.hy;
    const nz = bSolid.ay[2] * bSolid.hz - bSolid.az[2] * bSolid.hy;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-6) return null;
    const Nx = nx / nLen, Ny = ny / nLen, Nz = nz / nLen;
    if (Ny < 0.25) return null;

    let bestY: number | null = null;
    for (const [px, pz] of samples) {
      const dx = px - bSolid.centerX;
      const dz = pz - bSolid.centerZ;
      const sy = bSolid.centerY - (dx * Nx + dz * Nz) / Ny;
      const dy = sy - bSolid.centerY;
      const u = dx * bSolid.ax[0] + dy * bSolid.ax[1] + dz * bSolid.ax[2];
      const w = dx * bSolid.az[0] + dy * bSolid.az[1] + dz * bSolid.az[2];
      if (Math.abs(u) <= bSolid.hx + 0.04 && Math.abs(w) <= bSolid.hz + 0.04) {
        if (bestY === null || sy > bestY) bestY = sy;
      }
    }
    return bestY;
  }

  // Rotated / flat solid box or plane: find most upward-facing OBB face
  const faceCandidates: { axis: [number, number, number]; hF: number; t1: [number, number, number]; h1: number; t2: [number, number, number]; h2: number }[] = [
    { axis: bSolid.ay, hF: bSolid.hy, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.az, h2: bSolid.hz },
    { axis: [-bSolid.ay[0], -bSolid.ay[1], -bSolid.ay[2]], hF: bSolid.hy, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.az, h2: bSolid.hz },
    { axis: bSolid.ax, hF: bSolid.hx, t1: bSolid.ay, h1: bSolid.hy, t2: bSolid.az, h2: bSolid.hz },
    { axis: [-bSolid.ax[0], -bSolid.ax[1], -bSolid.ax[2]], hF: bSolid.hx, t1: bSolid.ay, h1: bSolid.hy, t2: bSolid.az, h2: bSolid.hz },
    { axis: bSolid.az, hF: bSolid.hz, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.ay, h2: bSolid.hy },
    { axis: [-bSolid.az[0], -bSolid.az[1], -bSolid.az[2]], hF: bSolid.hz, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.ay, h2: bSolid.hy },
  ];

  let topFace = faceCandidates[0];
  for (let i = 1; i < faceCandidates.length; i++) {
    if (faceCandidates[i].axis[1] > topFace.axis[1]) {
      topFace = faceCandidates[i];
    }
  }
  const Fy = topFace.axis[1];
  if (Fy < 0.45) return null;

  const fcX = bSolid.centerX + topFace.axis[0] * topFace.hF;
  const fcY = bSolid.centerY + topFace.axis[1] * topFace.hF;
  const fcZ = bSolid.centerZ + topFace.axis[2] * topFace.hF;
  const Fx = topFace.axis[0];
  const Fz = topFace.axis[2];

  let bestY: number | null = null;
  for (const [px, pz] of samples) {
    const dx = px - fcX;
    const dz = pz - fcZ;
    const sy = fcY - (dx * Fx + dz * Fz) / Fy;
    const dy = sy - fcY;
    const c1 = dx * topFace.t1[0] + dy * topFace.t1[1] + dz * topFace.t1[2];
    const c2 = dx * topFace.t2[0] + dy * topFace.t2[1] + dz * topFace.t2[2];
    if (Math.abs(c1) <= topFace.h1 + 0.03 && Math.abs(c2) <= topFace.h2 + 0.03) {
      if (bestY === null || sy > bestY) bestY = sy;
    }
  }
  return bestY;
}

export function boxesOverlap3D(b1: Object3DBounds, b2: Object3DBounds, eps: number = 0.04): boolean {
  return solveOBBCollision3D(b1, b2, eps) !== null;
}
