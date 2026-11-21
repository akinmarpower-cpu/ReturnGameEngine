import * as THREE from 'three';
import type { GameObject } from '../types';
import {
  createUniqueId,
  getObject3DPosition,
  getObject3DRotation,
} from './threeObjectBuilder';

const _matA = new THREE.Matrix4();
const _matB = new THREE.Matrix4();
const _matWorld = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'XYZ');

/**
 * Checks whether assigning newParentId to childId would create a cycle.
 */
export function wouldCreateParentCycle(
  childId: number,
  newParentId: number | null | undefined,
  objectsById: Map<number, GameObject>
): boolean {
  if (newParentId === null || newParentId === undefined) return false;
  if (newParentId === childId) return true;
  let currId: number | null | undefined = newParentId;
  let safety = 100;
  while (currId && safety-- > 0) {
    if (currId === childId) return true;
    currId = objectsById.get(currId)?.parentId;
  }
  return false;
}

/**
 * Builds the 4x4 local transform matrix (position3D + rotation3D, unit scale) for a GameObject.
 * (Object geometry scale3D is baked inside mesh children, keeping hierarchy transforms shear-free.)
 */
function writeLocalMatrix(obj: GameObject, target: THREE.Matrix4): void {
  const p = getObject3DPosition(obj);
  const r = getObject3DRotation(obj);
  _pos.set(p.x, p.y, p.z);
  _euler.set(r.x, r.y, r.z, 'XYZ');
  _quat.setFromEuler(_euler);
  _scl.set(1, 1, 1);
  target.compose(_pos, _quat, _scl);
}

/**
 * Computes the world-space 3D position and Euler XYZ rotation for any GameObject,
 * traversing parentId ancestors cleanly with cycle protection.
 */
export function getWorldTransform3D(
  obj: GameObject,
  objectsById: Map<number, GameObject>
): { pos: { x: number; y: number; z: number }; rot: { x: number; y: number; z: number } } {
  const chain: GameObject[] = [];
  const visited = new Set<number>();
  let curr: GameObject | undefined = obj;
  let safety = 64;
  while (curr && safety-- > 0 && !visited.has(curr.id)) {
    visited.add(curr.id);
    chain.push(curr);
    if (!curr.parentId || curr.isUI) break;
    curr = objectsById.get(curr.parentId);
  }

  _matWorld.identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    writeLocalMatrix(chain[i], _matA);
    _matWorld.multiply(_matA);
  }

  _matWorld.decompose(_pos, _quat, _scl);
  _euler.setFromQuaternion(_quat, 'XYZ');
  return {
    pos: {
      x: Number(_pos.x.toFixed(4)),
      y: Number(_pos.y.toFixed(4)),
      z: Number(_pos.z.toFixed(4)),
    },
    rot: {
      x: Number(_euler.x.toFixed(5)),
      y: Number(_euler.y.toFixed(5)),
      z: Number(_euler.z.toFixed(5)),
    },
  };
}

/**
 * Computes updates for reparenting childId -> newParentId while preserving world coordinates
 * cleanly across both 2D (x, y) and 3D (position3D, rotation3D).
 */
export function reparentGameObjectUpdates(
  childId: number,
  newParentId: number | null,
  objects: GameObject[]
): Partial<GameObject> | null {
  const objectsById = new Map<number, GameObject>(objects.map((o) => [o.id, o]));
  const child = objectsById.get(childId);
  if (!child) return null;

  const targetParentId = newParentId ?? null;
  if (targetParentId !== null) {
    if (!objectsById.has(targetParentId)) return null;
    if (wouldCreateParentCycle(childId, targetParentId, objectsById)) return null;
  }

  // 2D absolute position calculation
  const getAbs2D = (id: number): { x: number; y: number } => {
    let currId: number | null | undefined = id;
    let tx = 0;
    let ty = 0;
    let safety = 100;
    const seen = new Set<number>();
    while (currId && safety-- > 0 && !seen.has(currId)) {
      seen.add(currId);
      const o = objectsById.get(currId);
      if (!o) break;
      tx += o.x;
      ty += o.y;
      currId = o.parentId;
    }
    return { x: tx, y: ty };
  };

  const childAbs2D = getAbs2D(childId);
  let nextX = childAbs2D.x;
  let nextY = childAbs2D.y;
  if (targetParentId !== null) {
    const parentAbs2D = getAbs2D(targetParentId);
    nextX = childAbs2D.x - parentAbs2D.x;
    nextY = childAbs2D.y - parentAbs2D.y;
  }

  // 3D world-to-local conversion using matrices
  const childWorld3D = getWorldTransform3D(child, objectsById);
  let nextPos3D = childWorld3D.pos;
  let nextRot3D = childWorld3D.rot;

  if (targetParentId !== null) {
    const parentObj = objectsById.get(targetParentId)!;
    const parentWorld3D = getWorldTransform3D(parentObj, objectsById);

    const childWMat = new THREE.Matrix4().compose(
      new THREE.Vector3(childWorld3D.pos.x, childWorld3D.pos.y, childWorld3D.pos.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(childWorld3D.rot.x, childWorld3D.rot.y, childWorld3D.rot.z, 'XYZ')),
      new THREE.Vector3(1, 1, 1)
    );
    const parentWMat = new THREE.Matrix4().compose(
      new THREE.Vector3(parentWorld3D.pos.x, parentWorld3D.pos.y, parentWorld3D.pos.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(parentWorld3D.rot.x, parentWorld3D.rot.y, parentWorld3D.rot.z, 'XYZ')),
      new THREE.Vector3(1, 1, 1)
    );
    _matB.copy(parentWMat).invert();
    _matA.copy(_matB).multiply(childWMat);

    const lPos = new THREE.Vector3();
    const lQuat = new THREE.Quaternion();
    const lScl = new THREE.Vector3();
    _matA.decompose(lPos, lQuat, lScl);
    const lEuler = new THREE.Euler().setFromQuaternion(lQuat, 'XYZ');

    nextPos3D = {
      x: Number(lPos.x.toFixed(3)),
      y: Number(lPos.y.toFixed(3)),
      z: Number(lPos.z.toFixed(3)),
    };
    nextRot3D = {
      x: Number(lEuler.x.toFixed(4)),
      y: Number(lEuler.y.toFixed(4)),
      z: Number(lEuler.z.toFixed(4)),
    };
  } else {
    nextPos3D = {
      x: Number(childWorld3D.pos.x.toFixed(3)),
      y: Number(childWorld3D.pos.y.toFixed(3)),
      z: Number(childWorld3D.pos.z.toFixed(3)),
    };
    nextRot3D = {
      x: Number(childWorld3D.rot.x.toFixed(4)),
      y: Number(childWorld3D.rot.y.toFixed(4)),
      z: Number(childWorld3D.rot.z.toFixed(4)),
    };
  }

  return {
    parentId: targetParentId,
    x: Math.round(nextX),
    y: Math.round(nextY),
    position3D: nextPos3D,
    rotation3D: nextRot3D,
    rotation: Math.round((-nextRot3D.y * 180) / Math.PI),
  };
}

/**
 * Strips runtime-only ephemeral properties before saving/cloning an object cleanly.
 */
function stripTransientProps(obj: GameObject): GameObject {
  const cloned: Record<string, any> = JSON.parse(JSON.stringify(obj));
  Object.keys(cloned).forEach((k) => {
    if (k.startsWith('_') && k !== '_globalChildren' && k !== '_originalBehaviors') {
      delete cloned[k];
    }
  });
  return cloned as GameObject;
}

/**
 * Promotes a scene GameObject (along with its full appearance, 3D shape/model/PBR properties,
 * behaviors, scripts, UI settings, and any nested child hierarchy) into an identical Global Object template.
 */
export function buildGlobalObjectTemplate(
  obj: GameObject,
  sceneObjects: GameObject[] = [],
  overrideName?: string
): GameObject {
  const objectsById = new Map<number, GameObject>(sceneObjects.map((o) => [o.id, o]));
  const rootWorld3D = getWorldTransform3D(obj, objectsById);

  const rootClone = stripTransientProps(obj);
  const newGlobalId = createUniqueId();
  const origRootId = obj.id;

  if (overrideName && overrideName.trim()) {
    rootClone.name = overrideName.trim();
  }
  rootClone.id = newGlobalId;
  rootClone.parentId = null;

  // Normalize position3D/rotation3D to root world if promoted from a child node
  if (obj.parentId && !obj.isUI) {
    rootClone.position3D = rootWorld3D.pos;
    rootClone.rotation3D = rootWorld3D.rot;
  }

  // Collect full child subtree recursively (breadth-first so parents precede children)
  const descendants: GameObject[] = [];
  const queue: number[] = [origRootId];
  const visited = new Set<number>([origRootId]);

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const candidate of sceneObjects) {
      if (candidate.parentId === parentId && !visited.has(candidate.id)) {
        visited.add(candidate.id);
        queue.push(candidate.id);
        descendants.push(stripTransientProps(candidate));
      }
    }
  }

  if (descendants.length > 0) {
    rootClone._globalChildren = descendants;
  } else {
    delete rootClone._globalChildren;
  }

  return rootClone;
}

/**
 * Instantiates a Global Object template (preserving 100% of its 2D/3D visual properties, behaviors,
 * scripts, and any attached child subtree) for insertion into a scene.
 */
export function instantiateGlobalObject(
  template: GameObject,
  overrides?: {
    x?: number;
    y?: number;
    position3D?: { x: number; y: number; z: number };
    parentId?: number | null;
    name?: string;
  }
): { root: GameObject; allObjects: GameObject[] } {
  const rootClone = stripTransientProps(template);
  const storedChildren = Array.isArray(rootClone._globalChildren)
    ? rootClone._globalChildren.map((c) => stripTransientProps(c))
    : [];
  delete rootClone._globalChildren;

  const newRootId = createUniqueId();
  rootClone.id = newRootId;
  rootClone.parentId = overrides?.parentId !== undefined ? overrides.parentId : null;
  if (overrides?.name) rootClone.name = overrides.name;

  if (overrides?.position3D) {
    rootClone.position3D = { ...overrides.position3D };
  } else if (rootClone.position3D) {
    rootClone.position3D = { ...rootClone.position3D };
  }

  if (typeof overrides?.x === 'number') {
    rootClone.x = Math.round(overrides.x);
  }
  if (typeof overrides?.y === 'number') {
    rootClone.y = Math.round(overrides.y);
  }

  const allObjects: GameObject[] = [rootClone];

  if (storedChildren.length > 0) {
    const idMap = new Map<number, number>();
    idMap.set(template.id, newRootId);
    for (const ch of storedChildren) {
      idMap.set(ch.id, createUniqueId());
    }
    for (const ch of storedChildren) {
      const mappedId = idMap.get(ch.id) || createUniqueId();
      const mappedParentId =
        ch.parentId !== null && ch.parentId !== undefined && idMap.has(ch.parentId)
          ? idMap.get(ch.parentId)!
          : newRootId;
      allObjects.push({
        ...ch,
        id: mappedId,
        parentId: mappedParentId,
      });
    }
  }

  return { root: rootClone, allObjects };
}
