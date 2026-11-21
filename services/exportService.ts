import JSZip from 'jszip';
import type { ProjectData, Scene } from '../types';
import {
    generateDefaultWindowsIcons,
    generateElectronMainJs,
    generateElectronPackageJson,
    generateElectronPreloadJs,
    generateWindowsBatchScripts,
    type WindowsExportConfig,
} from './windowsBuilder';

export type { WindowsExportConfig };

export type ExportDimensionMode = 'all' | '2d' | '3d';

export interface ApkSigningConfig {
    buildType?: 'debug' | 'release';
    signingMode?: 'debug' | 'keystore' | 'files' | 'generate';
    packageName?: string;
    versionName?: string;
    versionCode?: number;
    appName?: string;
    keystoreBase64?: string;
    keystoreFileName?: string;
    storePassword?: string;
    alias?: string;
    keyPassword?: string;
    keystoreType?: 'pkcs12' | 'jks';
    generateKeystore?: boolean;
    certBase64?: string;
    certFileName?: string;
    privateKeyBase64?: string;
    privateKeyFileName?: string;
    privateKeyPassword?: string;
    distinguishedName?: {
        commonName?: string;
        organization?: string;
        country?: string;
    };
}

export interface ExportOptions {
    dimensionMode?: ExportDimensionMode;
    signing?: ApkSigningConfig;
    windowsConfig?: WindowsExportConfig;
    skipStartScreen?: boolean;
    useLocalThreeVendor?: boolean;
    threeVendorScript?: string;
    wwwOnly?: boolean;
}

export const getSceneDimension = (scene?: Scene | null): '2d' | '3d' => {
    if (!scene) return '2d';
    if (scene.sceneMode === '3d') return '3d';
    if (scene.sceneMode === '2d') return '2d';
    const has3D = Boolean(
        scene.gameObjects?.some(o =>
            o.modelUrl ||
            o.shape3D ||
            o.behaviors?.some(b =>
                ['Player3D', 'Solid3D', 'Physics3D', 'FollowCamera3D', 'Patrol3D', 'Oscillate3D', 'Rotate3D', 'Boss3D'].includes(b.name)
            )
        ) ||
        scene.events?.some(e => e.dimension === '3D' || e.programmingMode === 'blocks')
    );
    return has3D ? '3d' : '2d';
};

export const applyExportDimensionFilter = (
    projectData: ProjectData,
    options?: ExportOptions
): ProjectData => {
    const cloned = JSON.parse(JSON.stringify(projectData)) as ProjectData;
    const mode = options?.dimensionMode || 'all';
    if (!Array.isArray(cloned.scenes) || cloned.scenes.length === 0) return cloned;

    if (mode === '2d' || mode === '3d') {
        const matching = cloned.scenes.filter(s => getSceneDimension(s) === mode);
        if (matching.length > 0) {
            cloned.scenes = matching.map(s => ({ ...s, sceneMode: mode }));
        } else {
            cloned.scenes = cloned.scenes.map(s => ({ ...s, sceneMode: mode }));
        }
        cloned.defaultDimension = mode;
        if (!cloned.scenes.some(s => s.id === cloned.activeSceneId)) {
            cloned.activeSceneId = cloned.scenes[0]?.id || null;
        }
    }
    return cloned;
};

const getExported3DRetryHelpersScript = (): string => [
    '        // --- 3D Runtime Helpers & Three.js WebGL Engine ---',
    '        let isCurrentScene3D = false;',
    '        let camera3DRuntime = {',
    '            mode: "thirdPerson",',
    '            offset: { x: 0, y: 5, z: 9 },',
    '            targetObjectName: "",',
    '            fogEnabled: false,',
    '            fogColor: "#111827",',
    '            fogDensity: 0.02,',
    '            ambientIntensity: 0.85,',
    '            sunIntensity: 1.55,',
    '            sunColor: "#fffbeb",',
    '            skyboxImageUrl: "",',
    '            movementEnabled: true,',
    '            rightStickEnabled: false,',
    '            rightStickSensitivity: 2.4,',
    '            yaw: 0,',
    '            pitch: 0.38,',
    '            fpPitch: 0,',
    '            distance: 9,',
    '            isOrbiting: false,',
    '            lastPointerX: 0,',
    '            lastPointerY: 0,',
    '            activePointers: new Map(),',
    '            pinchDist: null,',
    '            pinchBaseDistance: null',
    '        };',
    '        let gamepadRightStick = { x: 0, y: 0 };',
    '        let threeEngine = null;',
    '        let threeSkyboxTexture = null;',
    '        let threeSkyboxUrl = "";',
    '        let activeDrag3D = null;',
    '',
    '        function resolveCam3DMode() {',
    '            if (camera3DRuntime && camera3DRuntime.mode) return camera3DRuntime.mode;',
    '            var objs = typeof gameObjects !== "undefined" ? gameObjects : [];',
    '            var fObj = objs.find(function(o) { return !o.isUI && (o.behaviors || []).some(function(b) { return b.name === "FollowCamera3D"; }); });',
    '            var fBeh = fObj && (fObj.behaviors || []).find(function(b) { return b.name === "FollowCamera3D"; });',
    '            return (fBeh && fBeh.properties && fBeh.properties.mode) || (typeof currentScene !== "undefined" && currentScene && currentScene.camera3DMode) || "thirdPerson";',
    '        }',
    '',
    '        function resolveSceneIs3D(sc) {',
    '            if (!sc) return false;',
    '            if (sc.sceneMode === "3d") return true;',
    '            if (sc.sceneMode === "2d") return false;',
    '            return Boolean((sc.gameObjects || []).some(function(o) {',
    '                return o.modelUrl || o.shape3D || (o.behaviors || []).some(function(b) {',
    '                    return ["Player3D", "Solid3D", "Physics3D", "FollowCamera3D", "Patrol3D", "Oscillate3D", "Rotate3D", "Boss3D"].indexOf(b.name) !== -1;',
    '                });',
    '            }) || (sc.events || []).some(function(e) { return e.dimension === "3D" || e.programmingMode === "blocks"; }));',
    '        }',
    '',
    '        function inferShape3D(obj) {',
    '            if (obj.shape3D) return obj.shape3D;',
    '            var lower = (obj.name || "").toLowerCase();',
    '            if (lower.indexOf("luz") !== -1 || lower.indexOf("light") !== -1 || lower.indexOf("lamp") !== -1) return "light";',
    '            if (lower.indexOf("moneda") !== -1 || lower.indexOf("coin") !== -1) return "coin";',
    '            if (lower.indexOf("rampa") !== -1 || lower.indexOf("ramp") !== -1) return "ramp";',
    '            if (lower.indexOf("arbol") !== -1 || lower.indexOf("árbol") !== -1 || lower.indexOf("tree") !== -1) return "tree";',
    '            if (lower.indexOf("roca") !== -1 || lower.indexOf("rock") !== -1 || lower.indexOf("piedra") !== -1) return "rock";',
    '            if (lower.indexOf("esfera") !== -1 || lower.indexOf("sphere") !== -1 || lower.indexOf("ball") !== -1 || lower.indexOf("orb") !== -1) return "sphere";',
    '            if (lower.indexOf("cilindro") !== -1 || lower.indexOf("cylinder") !== -1 || lower.indexOf("pilar") !== -1) return "cylinder";',
    '            if (lower.indexOf("cono") !== -1 || lower.indexOf("cone") !== -1) return "cone";',
    '            if (lower.indexOf("plano") !== -1 || lower.indexOf("plane") !== -1) return "plane";',
    '            if (',
    '                lower.indexOf("jugador") !== -1 ||',
    '                lower.indexOf("player") !== -1 ||',
    '                lower.indexOf("enemigo") !== -1 ||',
    '                lower.indexOf("enemy") !== -1 ||',
    '                lower.indexOf("boss") !== -1 ||',
    '                lower.indexOf("jefe") !== -1 ||',
    '                (obj.behaviors || []).some(function(b) {',
    '                    return ["Player3D", "PlatformerCharacter", "TopDownRPGMovement", "Boss", "Boss3D"].indexOf(b.name) !== -1;',
    '                })',
    '            ) {',
    '                return "character";',
    '            }',
    '            return "box";',
    '        }',
    '',
    '        function getObject3DDimensions(obj) {',
    '            if (obj.scale3D) {',
    '                return {',
    '                    w: Math.max(0.05, Number(obj.scale3D.x) || 1),',
    '                    h: Math.max(0.05, Number(obj.scale3D.y) || 1),',
    '                    d: Math.max(0.05, Number(obj.scale3D.z) || 1)',
    '                };',
    '            }',
    '            var shape = inferShape3D(obj);',
    '            var sx = obj.scaleX !== undefined ? obj.scaleX : 1;',
    '            var sy = obj.scaleY !== undefined ? obj.scaleY : 1;',
    '            var w2d = Math.max(0.2, ((obj.width || 50) / 50) * Math.abs(sx));',
    '            var h2d = Math.max(0.2, ((obj.height || 50) / 50) * Math.abs(sy));',
    '            var lowerName = (obj.name || "").toLowerCase();',
    '            var isFlatGround = shape === "plane" ||',
    '                lowerName.indexOf("ground") !== -1 ||',
    '                lowerName.indexOf("suelo") !== -1 ||',
    '                lowerName.indexOf("piso") !== -1 ||',
    '                (w2d >= 3.5 && h2d <= 2);',
    '            if (isFlatGround) {',
    '                return {',
    '                    w: w2d,',
    '                    h: shape === "plane" ? 0.08 : 0.6,',
    '                    d: Math.max(2, h2d)',
    '                };',
    '            }',
    '            return { w: w2d, h: h2d, d: w2d };',
    '        }',
    '',
    '        function getObject3DPosition(obj) {',
    '            if (obj.position3D) return { x: Number(obj.position3D.x || 0), y: Number(obj.position3D.y || 0), z: Number(obj.position3D.z || 0) };',
    '            var cx = (obj.x !== undefined ? obj.x : 0) + (obj.width || 50) / 2;',
    '            var cy = (obj.y !== undefined ? obj.y : 0) + (obj.height || 50) / 2;',
    '            return { x: Number((cx / 50).toFixed(3)), y: 0, z: Number((cy / 50).toFixed(3)) };',
    '        }',
    '',
    '        function getObject3DRotation(obj) {',
    '            if (obj.rotation3D) return { x: Number(obj.rotation3D.x || 0), y: Number(obj.rotation3D.y || 0), z: Number(obj.rotation3D.z || 0) };',
    '            return { x: 0, y: -((obj.rotation || 0) * Math.PI) / 180, z: 0 };',
    '        }',
    '',
    '        function sync3DTo2D(obj) {',
    '            var pos = getObject3DPosition(obj);',
    '            var dims = getObject3DDimensions(obj);',
    '            var rot = getObject3DRotation(obj);',
    '            obj.x = Math.round(pos.x * 50 - (obj.width || dims.w * 50) / 2);',
    '            obj.y = Math.round(pos.z * 50 - (obj.height || dims.d * 50) / 2);',
    '            obj.rotation = Math.round((-rot.y * 180) / Math.PI);',
    '        }',
    '',
    '        function isSolidObject3D(obj) {',
    '            if (!obj || obj.isUI || obj.visible === false || obj.isTouchable === false) return false;',
    '            return obj.isSolid3D === true || (obj.behaviors || []).some(function(b) { return b.name === "Solid3D" || b.name === "Solid"; });',
    '        }',
    '',
    '        function samplePoseTimeline3D(frames, elapsedMs, loop) {',
    '            if (!frames || frames.length === 0) {',
    '                return { frameIndex: 0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visualFrame: null };',
    '            }',
    '            if (frames.length === 1) {',
    '                var fOnly = frames[0];',
    '                return {',
    '                    frameIndex: 0,',
    '                    position: fOnly.position || { x: 0, y: 0, z: 0 },',
    '                    rotation: fOnly.rotation || { x: 0, y: 0, z: 0 },',
    '                    scale: fOnly.scale || { x: 1, y: 1, z: 1 },',
    '                    visualFrame: fOnly',
    '                };',
    '            }',
    '            var durations = frames.map(function(f) { return Math.max(20, Number(f.duration) || 300); });',
    '            var totalMs = durations.reduce(function(acc, d) { return acc + d; }, 0);',
    '            var clampedMs = loop ? (((elapsedMs % totalMs) + totalMs) % totalMs) : Math.min(elapsedMs, totalMs);',
    '            var cursor = 0;',
    '            for (var i = 0; i < frames.length; i++) {',
    '                var dur = durations[i];',
    '                if (clampedMs <= cursor + dur || i === frames.length - 1) {',
    '                    var nextIdx = loop ? (i + 1) % frames.length : Math.min(i + 1, frames.length - 1);',
    '                    var t = dur > 0 ? Math.min(1, Math.max(0, (clampedMs - cursor) / dur)) : 0;',
    '                    var cur = frames[i], nxt = frames[nextIdx];',
    '                    var cp = cur.position || { x: 0, y: 0, z: 0 }, np = nxt.position || cp;',
    '                    var cr = cur.rotation || { x: 0, y: 0, z: 0 }, nr = nxt.rotation || cr;',
    '                    var cs = cur.scale || { x: 1, y: 1, z: 1 }, ns = nxt.scale || cs;',
    '                    return {',
    '                        frameIndex: i,',
    '                        position: { x: cp.x + (np.x - cp.x) * t, y: cp.y + (np.y - cp.y) * t, z: cp.z + (np.z - cp.z) * t },',
    '                        rotation: { x: cr.x + (nr.x - cr.x) * t, y: cr.y + (nr.y - cr.y) * t, z: cr.z + (nr.z - cr.z) * t },',
    '                        scale: { x: cs.x + (ns.x - cs.x) * t, y: cs.y + (ns.y - cs.y) * t, z: cs.z + (ns.z - cs.z) * t },',
    '                        visualFrame: cur',
    '                    };',
    '                }',
    '                cursor += dur;',
    '            }',
    '            var lastF = frames[frames.length - 1];',
    '            return {',
    '                frameIndex: frames.length - 1,',
    '                position: lastF.position || { x: 0, y: 0, z: 0 },',
    '                rotation: lastF.rotation || { x: 0, y: 0, z: 0 },',
    '                scale: lastF.scale || { x: 1, y: 1, z: 1 },',
    '                visualFrame: lastF',
    '            };',
    '        }',
    '',
    '        function traverseOwnObject3DExport(root, callback) {',
    '            if (!root) return;',
    '            callback(root);',
    '            if (!root.children) return;',
    '            for (var i = 0; i < root.children.length; i++) {',
    '                var child = root.children[i];',
    '                if (child && child.userData && child.userData.isGameObjectRoot) continue;',
    '                traverseOwnObject3DExport(child, callback);',
    '            }',
    '        }',
    '',
    '        function wouldCreateParentCycle3DExport(childId, newParentId, objectsById) {',
    '            if (newParentId === null || newParentId === undefined) return false;',
    '            if (newParentId === childId) return true;',
    '            var currId = newParentId;',
    '            var safety = 100;',
    '            while (currId && safety-- > 0) {',
    '                if (currId === childId) return true;',
    '                var pObj = objectsById.get(currId);',
    '                currId = pObj ? pObj.parentId : null;',
    '            }',
    '            return false;',
    '        }',
    '',
    '        function composeEulerXYZMat34Export(px, py, pz, rx, ry, rz) {',
    '            var cx = Math.cos(rx), sx = Math.sin(rx);',
    '            var cy = Math.cos(ry), sy = Math.sin(ry);',
    '            var cz = Math.cos(rz), sz = Math.sin(rz);',
    '            return [',
    '                cy * cz, -cy * sz, sy, px,',
    '                cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, py,',
    '                sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy, pz',
    '            ];',
    '        }',
    '',
    '        function mulMat34Export(a, b) {',
    '            return [',
    '                a[0] * b[0] + a[1] * b[4] + a[2] * b[8],',
    '                a[0] * b[1] + a[1] * b[5] + a[2] * b[9],',
    '                a[0] * b[2] + a[1] * b[6] + a[2] * b[10],',
    '                a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3],',
    '                a[4] * b[0] + a[5] * b[4] + a[6] * b[8],',
    '                a[4] * b[1] + a[5] * b[5] + a[6] * b[9],',
    '                a[4] * b[2] + a[5] * b[6] + a[6] * b[10],',
    '                a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7],',
    '                a[8] * b[0] + a[9] * b[4] + a[10] * b[8],',
    '                a[8] * b[1] + a[9] * b[5] + a[10] * b[9],',
    '                a[8] * b[2] + a[9] * b[6] + a[10] * b[10],',
    '                a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11]',
    '            ];',
    '        }',
    '',
    '        function extractEulerXYZFromMat34Export(m) {',
    '            var m11 = m[0], m12 = m[1], m13 = m[2];',
    '            var m22 = m[5], m23 = m[6];',
    '            var m32 = m[9], m33 = m[10];',
    '            var ey = Math.asin(Math.max(-1, Math.min(1, m13)));',
    '            var ex = 0, ez = 0;',
    '            if (Math.abs(m13) < 0.9999999) {',
    '                ex = Math.atan2(-m23, m33);',
    '                ez = Math.atan2(-m12, m11);',
    '            } else {',
    '                ex = Math.atan2(m32, m22);',
    '                ez = 0;',
    '            }',
    '            return { x: ex, y: ey, z: ez };',
    '        }',
    '',
    '        function getWorldMatrix34Export(obj, objectsById) {',
    '            var chain = [];',
    '            var visited = new Set();',
    '            var curr = obj;',
    '            var safety = 64;',
    '            while (curr && safety-- > 0 && !visited.has(curr.id)) {',
    '                visited.add(curr.id);',
    '                chain.push(curr);',
    '                if (!curr.parentId || curr.isUI) break;',
    '                curr = objectsById.get(curr.parentId);',
    '            }',
    '            var acc = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];',
    '            for (var i = chain.length - 1; i >= 0; i--) {',
    '                var lp = getObject3DPosition(chain[i]);',
    '                var lr = getObject3DRotation(chain[i]);',
    '                acc = mulMat34Export(acc, composeEulerXYZMat34Export(lp.x, lp.y, lp.z, lr.x, lr.y, lr.z));',
    '            }',
    '            return acc;',
    '        }',
    '',
    '        function getWorldTransform3DExport(obj, objectsById) {',
    '            if (!obj) return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };',
    '            if (!obj.parentId || obj.isUI || !objectsById) {',
    '                return { pos: getObject3DPosition(obj), rot: getObject3DRotation(obj) };',
    '            }',
    '            var m = getWorldMatrix34Export(obj, objectsById);',
    '            return {',
    '                pos: { x: m[3], y: m[7], z: m[11] },',
    '                rot: extractEulerXYZFromMat34Export(m)',
    '            };',
    '        }',
    '',
    '        function getEffectiveObject3DBoundsExport(obj, activePose, nowMs, options) {',
    '            var p = getObject3DPosition(obj);',
    '            var d = getObject3DDimensions(obj);',
    '            var r = getObject3DRotation(obj);',
    '            var animPosOffX = 0, animPosOffY = 0, animPosOffZ = 0;',
    '            var rotX = r.x, rotY = r.y, rotZ = r.z;',
    '            var sclX = 1, sclY = 1, sclZ = 1;',
    '            if (activePose && activePose.poseAnimation && activePose.poseAnimation.frames && activePose.poseAnimation.frames.length > 0) {',
    '                var pFrames = activePose.poseAnimation.frames;',
    '                var rawElapsedP = Math.max(0, (nowMs - (activePose.startTime || 0)) * (activePose.speed || 1));',
    '                var sampledP = samplePoseTimeline3D(pFrames, rawElapsedP, activePose.loop !== false);',
    '                animPosOffX = sampledP.position.x || 0;',
    '                animPosOffY = sampledP.position.y || 0;',
    '                animPosOffZ = sampledP.position.z || 0;',
    '                rotX = r.x + (((sampledP.rotation.x || 0) * Math.PI) / 180);',
    '                rotY = r.y + (((sampledP.rotation.y || 0) * Math.PI) / 180);',
    '                rotZ = r.z + (((sampledP.rotation.z || 0) * Math.PI) / 180);',
    '                sclX = Math.max(0.05, sampledP.scale.x || 1);',
    '                sclY = Math.max(0.05, sampledP.scale.y || 1);',
    '                sclZ = Math.max(0.05, sampledP.scale.z || 1);',
    '            }',
    '            var posX = p.x + animPosOffX;',
    '            var posY = p.y + animPosOffY;',
    '            var posZ = p.z + animPosOffZ;',
    '            var effW = d.w * sclX;',
    '            var effH = d.h * sclY;',
    '            var effD = d.d * sclZ;',
    '            var useStableYaw = Boolean(options && options.stableYawXZ && Math.abs(rotX) < 0.05 && Math.abs(rotZ) < 0.05);',
    '            var effRotY = useStableYaw ? 0 : rotY;',
    '            var mLocal = composeEulerXYZMat34Export(posX, posY, posZ, rotX, effRotY, rotZ);',
    '            var mWorld = mLocal;',
    '            var parentObj = (options && options.objectsById && obj.parentId && !obj.isUI) ? options.objectsById.get(obj.parentId) : null;',
    '            if (parentObj && !wouldCreateParentCycle3DExport(obj.id, obj.parentId, options.objectsById)) {',
    '                mWorld = mulMat34Export(getWorldMatrix34Export(parentObj, options.objectsById), mLocal);',
    '                posX = mWorld[3];',
    '                posY = mWorld[7];',
    '                posZ = mWorld[11];',
    '            }',
    '            var r00 = mWorld[0], r01 = mWorld[1], r02 = mWorld[2];',
    '            var r10 = mWorld[4], r11 = mWorld[5], r12 = mWorld[6];',
    '            var r20 = mWorld[8], r21 = mWorld[9], r22 = mWorld[10];',
    '            var localCenterY = effH / 2;',
    '            var centerX = posX + r01 * localCenterY;',
    '            var centerY = posY + r11 * localCenterY;',
    '            var centerZ = posZ + r21 * localCenterY;',
    '            var hx = effW / 2;',
    '            var hy = effH / 2;',
    '            var hz = effD / 2;',
    '            var halfX = Math.abs(r00) * hx + Math.abs(r01) * hy + Math.abs(r02) * hz;',
    '            var halfY = Math.abs(r10) * hx + Math.abs(r11) * hy + Math.abs(r12) * hz;',
    '            var halfZ = Math.abs(r20) * hx + Math.abs(r21) * hy + Math.abs(r22) * hz;',
    '            var worldRot = extractEulerXYZFromMat34Export(mWorld);',
    '            var isRotated = Math.abs(worldRot.x) > 1e-4 || Math.abs(worldRot.y) > 1e-4 || Math.abs(worldRot.z) > 1e-4;',
    '            return {',
    '                minX: centerX - halfX,',
    '                maxX: centerX + halfX,',
    '                minY: centerY - halfY,',
    '                maxY: centerY + halfY,',
    '                minZ: centerZ - halfZ,',
    '                maxZ: centerZ + halfZ,',
    '                centerX: centerX,',
    '                centerY: centerY,',
    '                centerZ: centerZ,',
    '                width: halfX * 2,',
    '                height: halfY * 2,',
    '                depth: halfZ * 2,',
    '                hx: hx,',
    '                hy: hy,',
    '                hz: hz,',
    '                ax: [r00, r10, r20],',
    '                ay: [r01, r11, r21],',
    '                az: [r02, r12, r22],',
    '                isRotated: isRotated,',
    '                shape3D: inferShape3D(obj)',
    '            };',
    '        }',
    '',
    '        function getRampWedgeVerticesExport(b) {',
    '            var cx = b.centerX, cy = b.centerY, cz = b.centerZ;',
    '            var ax = b.ax, ay = b.ay, az = b.az, hx = b.hx, hy = b.hy, hz = b.hz;',
    '            function pt(sx, sy, sz) {',
    '                return [',
    '                    cx + ax[0] * (sx * hx) + ay[0] * (sy * hy) + az[0] * (sz * hz),',
    '                    cy + ax[1] * (sx * hx) + ay[1] * (sy * hy) + az[1] * (sz * hz),',
    '                    cz + ax[2] * (sx * hx) + ay[2] * (sy * hy) + az[2] * (sz * hz)',
    '                ];',
    '            }',
    '            return [pt(-1, -1, -1), pt(1, -1, -1), pt(-1, -1, 1), pt(1, -1, 1), pt(-1, 1, 1), pt(1, 1, 1)];',
    '        }',
    '',
    '        function solveRampVsOBB3DExport(ramp, obb, eps) {',
    '            var wedgeVerts = getRampWedgeVerticesExport(ramp);',
    '            var axes = [];',
    '            function pushAxis(x, y, z) {',
    '                var lenSq = x * x + y * y + z * z;',
    '                if (lenSq < 1e-10) return;',
    '                var inv = 1 / Math.sqrt(lenSq);',
    '                axes.push([x * inv, y * inv, z * inv]);',
    '            }',
    '            pushAxis(obb.ax[0], obb.ax[1], obb.ax[2]);',
    '            pushAxis(obb.ay[0], obb.ay[1], obb.ay[2]);',
    '            pushAxis(obb.az[0], obb.az[1], obb.az[2]);',
    '            pushAxis(ramp.ax[0], ramp.ax[1], ramp.ax[2]);',
    '            pushAxis(ramp.ay[0], ramp.ay[1], ramp.ay[2]);',
    '            pushAxis(ramp.az[0], ramp.az[1], ramp.az[2]);',
    '            var snx = ramp.ay[0] * ramp.hz - ramp.az[0] * ramp.hy;',
    '            var sny = ramp.ay[1] * ramp.hz - ramp.az[1] * ramp.hy;',
    '            var snz = ramp.ay[2] * ramp.hz - ramp.az[2] * ramp.hy;',
    '            pushAxis(snx, sny, snz);',
    '            var sex = ramp.ay[0] * ramp.hy + ramp.az[0] * ramp.hz;',
    '            var sey = ramp.ay[1] * ramp.hy + ramp.az[1] * ramp.hz;',
    '            var sez = ramp.ay[2] * ramp.hy + ramp.az[2] * ramp.hz;',
    '            var rampEdges = [ramp.ax, ramp.ay, ramp.az, [sex, sey, sez]];',
    '            var obbAxes = [obb.ax, obb.ay, obb.az];',
    '            for (var re = 0; re < rampEdges.length; re++) {',
    '                var e = rampEdges[re];',
    '                for (var oa = 0; oa < obbAxes.length; oa++) {',
    '                    var a = obbAxes[oa];',
    '                    pushAxis(e[1] * a[2] - e[2] * a[1], e[2] * a[0] - e[0] * a[2], e[0] * a[1] - e[1] * a[0]);',
    '                }',
    '            }',
    '            var minOverlap = Infinity;',
    '            var bestAxis = [0, 1, 0];',
    '            for (var li = 0; li < axes.length; li++) {',
    '                var L = axes[li];',
    '                var minW = Infinity, maxW = -Infinity;',
    '                for (var wi = 0; wi < wedgeVerts.length; wi++) {',
    '                    var v = wedgeVerts[wi];',
    '                    var pv = v[0] * L[0] + v[1] * L[1] + v[2] * L[2];',
    '                    if (pv < minW) minW = pv;',
    '                    if (pv > maxW) maxW = pv;',
    '                }',
    '                var cObb = obb.centerX * L[0] + obb.centerY * L[1] + obb.centerZ * L[2];',
    '                var rObb = Math.abs(obb.ax[0] * L[0] + obb.ax[1] * L[1] + obb.ax[2] * L[2]) * obb.hx +',
    '                           Math.abs(obb.ay[0] * L[0] + obb.ay[1] * L[1] + obb.ay[2] * L[2]) * obb.hy +',
    '                           Math.abs(obb.az[0] * L[0] + obb.az[1] * L[1] + obb.az[2] * L[2]) * obb.hz;',
    '                var minO = cObb - rObb, maxO = cObb + rObb;',
    '                var overlap = Math.min(maxW, maxO) - Math.max(minW, minO) + eps;',
    '                if (overlap <= 0) return null;',
    '                if (overlap < minOverlap) {',
    '                    minOverlap = overlap;',
    '                    var midW = (minW + maxW) * 0.5;',
    '                    var sgn = cObb >= midW ? 1 : -1;',
    '                    bestAxis = [L[0] * sgn, L[1] * sgn, L[2] * sgn];',
    '                }',
    '            }',
    '            if (!isFinite(minOverlap)) return null;',
    '            return { x: bestAxis[0] * minOverlap, y: bestAxis[1] * minOverlap, z: bestAxis[2] * minOverlap, depth: minOverlap };',
    '        }',
    '',
    '        function solveOBBCollision3DExport(b1, b2, eps) {',
    '            if (eps === undefined) eps = 0;',
    '            if (b1.maxX <= b2.minX - eps || b1.minX >= b2.maxX + eps ||',
    '                b1.maxY <= b2.minY - eps || b1.minY >= b2.maxY + eps ||',
    '                b1.maxZ <= b2.minZ - eps || b1.minZ >= b2.maxZ + eps) {',
    '                return null;',
    '            }',
    '            if (b2.shape3D === "ramp" && b1.shape3D !== "ramp") return solveRampVsOBB3DExport(b2, b1, eps);',
    '            if (b1.shape3D === "ramp" && b2.shape3D !== "ramp") {',
    '                var mR = solveRampVsOBB3DExport(b1, b2, eps);',
    '                return mR ? { x: -mR.x, y: -mR.y, z: -mR.z, depth: mR.depth } : null;',
    '            }',
    '            if (!b1.isRotated && !b2.isRotated) {',
    '                var ox = Math.min(b1.maxX, b2.maxX) - Math.max(b1.minX, b2.minX) + eps;',
    '                var oy = Math.min(b1.maxY, b2.maxY) - Math.max(b1.minY, b2.minY) + eps;',
    '                var oz = Math.min(b1.maxZ, b2.maxZ) - Math.max(b1.minZ, b2.minZ) + eps;',
    '                if (ox <= 0 || oy <= 0 || oz <= 0) return null;',
    '                if (oy <= ox && oy <= oz) return { x: 0, y: oy * (b1.centerY >= b2.centerY ? 1 : -1), z: 0, depth: oy };',
    '                if (ox <= oz) return { x: ox * (b1.centerX >= b2.centerX ? 1 : -1), y: 0, z: 0, depth: ox };',
    '                return { x: 0, y: 0, z: oz * (b1.centerZ >= b2.centerZ ? 1 : -1), depth: oz };',
    '            }',
    '            var dx = b1.centerX - b2.centerX, dy = b1.centerY - b2.centerY, dz = b1.centerZ - b2.centerZ;',
    '            var A = [b1.ax, b1.ay, b1.az], B = [b2.ax, b2.ay, b2.az];',
    '            var hA = [b1.hx, b1.hy, b1.hz], hB = [b2.hx, b2.hy, b2.hz];',
    '            var minOverlap = Infinity, bestAxis = [0, 1, 0];',
    '            function testAxis(lx, ly, lz) {',
    '                var lenSq = lx * lx + ly * ly + lz * lz;',
    '                if (lenSq < 1e-10) return true;',
    '                var inv = 1 / Math.sqrt(lenSq);',
    '                var ux = lx * inv, uy = ly * inv, uz = lz * inv;',
    '                var r1 = Math.abs(A[0][0] * ux + A[0][1] * uy + A[0][2] * uz) * hA[0] +',
    '                         Math.abs(A[1][0] * ux + A[1][1] * uy + A[1][2] * uz) * hA[1] +',
    '                         Math.abs(A[2][0] * ux + A[2][1] * uy + A[2][2] * uz) * hA[2];',
    '                var r2 = Math.abs(B[0][0] * ux + B[0][1] * uy + B[0][2] * uz) * hB[0] +',
    '                         Math.abs(B[1][0] * ux + B[1][1] * uy + B[1][2] * uz) * hB[1] +',
    '                         Math.abs(B[2][0] * ux + B[2][1] * uy + B[2][2] * uz) * hB[2];',
    '                var centerDist = dx * ux + dy * uy + dz * uz;',
    '                var overlap = r1 + r2 - Math.abs(centerDist) + eps;',
    '                if (overlap <= 0) return false;',
    '                if (overlap < minOverlap) {',
    '                    minOverlap = overlap;',
    '                    var sgn = centerDist >= 0 ? 1 : -1;',
    '                    bestAxis = [ux * sgn, uy * sgn, uz * sgn];',
    '                }',
    '                return true;',
    '            }',
    '            for (var i = 0; i < 3; i++) { if (!testAxis(A[i][0], A[i][1], A[i][2])) return null; }',
    '            for (var j = 0; j < 3; j++) { if (!testAxis(B[j][0], B[j][1], B[j][2])) return null; }',
    '            for (var i2 = 0; i2 < 3; i2++) {',
    '                for (var j2 = 0; j2 < 3; j2++) {',
    '                    if (!testAxis(',
    '                        A[i2][1] * B[j2][2] - A[i2][2] * B[j2][1],',
    '                        A[i2][2] * B[j2][0] - A[i2][0] * B[j2][2],',
    '                        A[i2][0] * B[j2][1] - A[i2][1] * B[j2][0]',
    '                    )) return null;',
    '                }',
    '            }',
    '            if (!isFinite(minOverlap)) return null;',
    '            return { x: bestAxis[0] * minOverlap, y: bestAxis[1] * minOverlap, z: bestAxis[2] * minOverlap, depth: minOverlap };',
    '        }',
    '',
    '        function getWalkableSurface3DExport(footX, footZ, footHalfX, footHalfZ, bSolid) {',
    '            var rx = Math.max(0.05, footHalfX * 0.7);',
    '            var rz = Math.max(0.05, footHalfZ * 0.7);',
    '            var samples = [[footX, footZ], [footX - rx, footZ], [footX + rx, footZ], [footX, footZ - rz], [footX, footZ + rz]];',
    '            if (bSolid.shape3D === "ramp") {',
    '                var nx = bSolid.ay[0] * bSolid.hz - bSolid.az[0] * bSolid.hy;',
    '                var ny = bSolid.ay[1] * bSolid.hz - bSolid.az[1] * bSolid.hy;',
    '                var nz = bSolid.ay[2] * bSolid.hz - bSolid.az[2] * bSolid.hy;',
    '                var nLen = Math.hypot(nx, ny, nz);',
    '                if (nLen < 1e-6) return null;',
    '                var Nx = nx / nLen, Ny = ny / nLen, Nz = nz / nLen;',
    '                if (Ny < 0.25) return null;',
    '                var bestY = null;',
    '                for (var si = 0; si < samples.length; si++) {',
    '                    var px = samples[si][0], pz = samples[si][1];',
    '                    var ddx = px - bSolid.centerX, ddz = pz - bSolid.centerZ;',
    '                    var sy = bSolid.centerY - (ddx * Nx + ddz * Nz) / Ny;',
    '                    var ddy = sy - bSolid.centerY;',
    '                    var u = ddx * bSolid.ax[0] + ddy * bSolid.ax[1] + ddz * bSolid.ax[2];',
    '                    var w = ddx * bSolid.az[0] + ddy * bSolid.az[1] + ddz * bSolid.az[2];',
    '                    if (Math.abs(u) <= bSolid.hx + 0.04 && Math.abs(w) <= bSolid.hz + 0.04) {',
    '                        if (bestY === null || sy > bestY) bestY = sy;',
    '                    }',
    '                }',
    '                return bestY;',
    '            }',
    '            var faceCandidates = [',
    '                { axis: bSolid.ay, hF: bSolid.hy, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.az, h2: bSolid.hz },',
    '                { axis: [-bSolid.ay[0], -bSolid.ay[1], -bSolid.ay[2]], hF: bSolid.hy, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.az, h2: bSolid.hz },',
    '                { axis: bSolid.ax, hF: bSolid.hx, t1: bSolid.ay, h1: bSolid.hy, t2: bSolid.az, h2: bSolid.hz },',
    '                { axis: [-bSolid.ax[0], -bSolid.ax[1], -bSolid.ax[2]], hF: bSolid.hx, t1: bSolid.ay, h1: bSolid.hy, t2: bSolid.az, h2: bSolid.hz },',
    '                { axis: bSolid.az, hF: bSolid.hz, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.ay, h2: bSolid.hy },',
    '                { axis: [-bSolid.az[0], -bSolid.az[1], -bSolid.az[2]], hF: bSolid.hz, t1: bSolid.ax, h1: bSolid.hx, t2: bSolid.ay, h2: bSolid.hy }',
    '            ];',
    '            var topFace = faceCandidates[0];',
    '            for (var fi = 1; fi < faceCandidates.length; fi++) {',
    '                if (faceCandidates[fi].axis[1] > topFace.axis[1]) topFace = faceCandidates[fi];',
    '            }',
    '            var Fy = topFace.axis[1];',
    '            if (Fy < 0.45) return null;',
    '            var fcX = bSolid.centerX + topFace.axis[0] * topFace.hF;',
    '            var fcY = bSolid.centerY + topFace.axis[1] * topFace.hF;',
    '            var fcZ = bSolid.centerZ + topFace.axis[2] * topFace.hF;',
    '            var Fx = topFace.axis[0], Fz = topFace.axis[2];',
    '            var bestFaceY = null;',
    '            for (var sj = 0; sj < samples.length; sj++) {',
    '                var ppx = samples[sj][0], ppz = samples[sj][1];',
    '                var fdx = ppx - fcX, fdz = ppz - fcZ;',
    '                var fsy = fcY - (fdx * Fx + fdz * Fz) / Fy;',
    '                var fdy = fsy - fcY;',
    '                var c1 = fdx * topFace.t1[0] + fdy * topFace.t1[1] + fdz * topFace.t1[2];',
    '                var c2 = fdx * topFace.t2[0] + fdy * topFace.t2[1] + fdz * topFace.t2[2];',
    '                if (Math.abs(c1) <= topFace.h1 + 0.03 && Math.abs(c2) <= topFace.h2 + 0.03) {',
    '                    if (bestFaceY === null || fsy > bestFaceY) bestFaceY = fsy;',
    '                }',
    '            }',
    '            return bestFaceY;',
    '        }',
    '',
    '        function checkCollision3D(o1, o2) {',
    '            var active1 = typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(o1.id) : null;',
    '            var active2 = typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(o2.id) : null;',
    '            var nowMs = performance.now();',
    '            var colMap3D = new Map();',
    '            for (var ci = 0; ci < gameObjects.length; ci++) colMap3D.set(gameObjects[ci].id, gameObjects[ci]);',
    '            var b1 = getEffectiveObject3DBoundsExport(o1, active1, nowMs, { objectsById: colMap3D });',
    '            var b2 = getEffectiveObject3DBoundsExport(o2, active2, nowMs, { objectsById: colMap3D });',
    '            return solveOBBCollision3DExport(b1, b2, 0.04) !== null;',
    '        }',
    '',
    '        var exportedGltfPromiseCache = new Map();',
    '        var exportedResolvedGltfCache = new Map();',
    '',
    '        function cloneExportedGLTFScene(sceneObj) {',
    '            var lib = window.__R2D_THREE__;',
    '            try {',
    '                if (lib && lib.SkeletonUtils && typeof lib.SkeletonUtils.clone === "function") {',
    '                    return lib.SkeletonUtils.clone(sceneObj) || sceneObj.clone(true);',
    '                }',
    '            } catch (e) {}',
    '            return sceneObj.clone(true);',
    '        }',
    '',
    '        function getExportedGLTFSync(url) {',
    '            if (!url) return null;',
    '            var entry = exportedResolvedGltfCache.get(url);',
    '            if (!entry) return null;',
    '            return { scene: cloneExportedGLTFScene(entry.scene), animations: entry.animations };',
    '        }',
    '',
    '        function loadExportedGLTF(url, GLTFLoaderCtor) {',
    '            var cached = exportedResolvedGltfCache.get(url);',
    '            if (cached) {',
    '                return Promise.resolve({ scene: cloneExportedGLTFScene(cached.scene), animations: cached.animations });',
    '            }',
    '            var promise = exportedGltfPromiseCache.get(url);',
    '            if (!promise) {',
    '                var LoaderCtor = GLTFLoaderCtor || (window.__R2D_THREE__ && window.__R2D_THREE__.GLTFLoader);',
    '                if (!LoaderCtor) return Promise.reject(new Error("GLTFLoader missing"));',
    '                var loader = new LoaderCtor();',
    '                promise = new Promise(function(resolve, reject) {',
    '                    loader.load(url, function(gltf) {',
    '                        var entry = { scene: gltf.scene, animations: gltf.animations || [] };',
    '                        exportedResolvedGltfCache.set(url, entry);',
    '                        resolve(entry);',
    '                    }, undefined, function(err) {',
    '                        exportedGltfPromiseCache.delete(url);',
    '                        reject(err);',
    '                    });',
    '                });',
    '                exportedGltfPromiseCache.set(url, promise);',
    '            }',
    '            return promise.then(function(entry) {',
    '                return { scene: cloneExportedGLTFScene(entry.scene), animations: entry.animations };',
    '            });',
    '        }',
    '',
    '        function preloadExportedGLTFs(urls) {',
    '            var lib = window.__R2D_THREE__;',
    '            if (!lib || !lib.GLTFLoader || !urls || !urls.length) return Promise.resolve();',
    '            var seen = {};',
    '            var unique = [];',
    '            for (var i = 0; i < urls.length; i++) {',
    '                var u = urls[i];',
    '                if (typeof u === "string" && u.length > 0 && !seen[u]) { seen[u] = true; unique.push(u); }',
    '            }',
    '            if (!unique.length) return Promise.resolve();',
    '            return Promise.allSettled(unique.map(function(u) { return loadExportedGLTF(u, lib.GLTFLoader); }));',
    '        }',
    '',
    '        function applyMaterialTintToGroup3D(root, obj, THREE) {',
    '            if (!root || !THREE) return;',
    '            var opacity = obj.opacity !== undefined ? Number(obj.opacity) : 1;',
    '            var transparent = opacity < 1;',
    '            var hasModel = Boolean(root.userData && root.userData.modelGroup);',
    '            var hasEmiss = Boolean(obj.emissive3D && obj.emissive3D !== "#000000" && Number(obj.emissiveIntensity3D || 0) > 0);',
    '            var emissCol = hasEmiss ? new THREE.Color(obj.emissive3D) : null;',
    '            var emissInt = hasEmiss ? (obj.emissiveIntensity3D !== undefined ? Number(obj.emissiveIntensity3D) : 0.6) : 0;',
    '            traverseOwnObject3DExport(root, function(child) {',
    '                if (!child.isMesh || !child.material) return;',
    '                var mats = Array.isArray(child.material) ? child.material : [child.material];',
    '                mats.forEach(function(mat) {',
    '                    if (!mat) return;',
    '                    if (!mat.userData) mat.userData = {};',
    '                    if (mat.userData._origSaved !== true) {',
    '                        mat.userData._origSaved = true;',
    '                        mat.userData._origEmissHex = mat.emissive ? mat.emissive.getHex() : 0x000000;',
    '                        mat.userData._origEmissInt = mat.emissiveIntensity !== undefined ? mat.emissiveIntensity : 0;',
    '                        mat.userData._origOpacity = mat.opacity !== undefined ? mat.opacity : 1;',
    '                        mat.userData._origTransparent = Boolean(mat.transparent);',
    '                    }',
    '                    if (!hasModel && !mat.map && mat.color && obj.color && obj.color !== "transparent") {',
    '                        try { mat.color.set(obj.color); } catch(e) {}',
    '                    }',
    '                    if (mat.emissive) {',
    '                        if (emissCol) { mat.emissive.copy(emissCol); mat.emissiveIntensity = emissInt; }',
    '                        else { mat.emissive.setHex(mat.userData._origEmissHex || 0x000000); mat.emissiveIntensity = mat.userData._origEmissInt || 0; }',
    '                    }',
    '                    mat.opacity = Math.min(1, opacity * (hasModel ? (mat.userData._origOpacity || 1) : 1));',
    '                    mat.transparent = transparent || Boolean(mat.userData._origTransparent && hasModel);',
    '                    mat.needsUpdate = true;',
    '                });',
    '            });',
    '        }',
    '',
    '        function attachExportedGLTFToGroup(group, obj, model, animations, dims, castShadow, receiveShadow, THREE) {',
    '            var box = new THREE.Box3().setFromObject(model);',
    '            var sz = new THREE.Vector3(); box.getSize(sz);',
    '            var center = new THREE.Vector3(); box.getCenter(center);',
    '            var maxAxis = Math.max(sz.x || 1, sz.y || 1, sz.z || 1);',
    '            var targetScale = Math.max(dims.w, dims.h, dims.d) / maxAxis;',
    '            model.scale.setScalar(targetScale);',
    '            model.position.set(-center.x * targetScale, -box.min.y * targetScale, -center.z * targetScale);',
    '            model.traverse(function(c) {',
    '                c.userData.gameObjectId = obj.id;',
    '                if (c.isMesh) { c.castShadow = castShadow; c.receiveShadow = receiveShadow; }',
    '            });',
    '            group.userData.animations = animations || [];',
    '            group.userData.modelGroup = model;',
    '            group.userData.loadedModelUrl = obj.modelUrl;',
    '            if (animations && animations.length > 0) {',
    '                var mixer = new THREE.AnimationMixer(model);',
    '                group.userData.mixer = mixer;',
    '                var clipMap = new Map();',
    '                animations.forEach(function(c) {',
    '                    if (c.name) clipMap.set(c.name.toLowerCase(), c);',
    '                });',
    '                var playAction = function(animName, loop, speed) {',
    '                    var isLoop = loop !== false;',
    '                    var spd = Number(speed || 1) || 1;',
    '                    var clip = null;',
    '                    if (animName) {',
    '                        var low = String(animName).toLowerCase();',
    '                        clip = clipMap.get(low) || animations.find(function(c) { return c.name && c.name.toLowerCase().indexOf(low) !== -1; });',
    '                    } else if (animations.length > 0) {',
    '                        clip = animations[0];',
    '                    }',
    '                    if (!clip) return;',
    '                    mixer.stopAllAction();',
    '                    var act = mixer.clipAction(clip);',
    '                    act.reset();',
    '                    act.setLoop(isLoop ? THREE.LoopRepeat : THREE.LoopOnce, isLoop ? Infinity : 1);',
    '                    act.clampWhenFinished = !isLoop;',
    '                    act.timeScale = spd;',
    '                    act.play();',
    '                    group.userData.currentActionName = clip.name;',
    '                };',
    '                group.userData.playAnimation3D = playAction;',
    '                group.userData.stopAnimation3D = function() {',
    '                    mixer.stopAllAction();',
    '                    group.userData.currentActionName = undefined;',
    '                };',
    '                var pendA = group.userData.pendingAnimation3D;',
    '                var rtA = obj._runtimeAnim3D;',
    '                var animBeh = (obj.behaviors || []).find(function(b) { return b.name === "Animation3D"; });',
    '                var targetA = (pendA && pendA.name) || (rtA && rtA.name) || obj.animation3D || (animBeh && animBeh.properties && animBeh.properties.animationName);',
    '                var autoP = !(animBeh && animBeh.properties && animBeh.properties.autoPlay === false);',
    '                var loopA = pendA && pendA.loop !== undefined ? pendA.loop : (rtA && rtA.loop !== undefined ? rtA.loop : (!(animBeh && animBeh.properties && animBeh.properties.loop === false) && obj.animation3DLoop !== false));',
    '                var spdA = Number((pendA && pendA.speed) || (rtA && rtA.speed) || (animBeh && animBeh.properties && animBeh.properties.speed) || obj.animation3DSpeed || 1);',
    '                delete group.userData.pendingAnimation3D;',
    '                if (targetA) {',
    '                    playAction(targetA, loopA, spdA);',
    '                } else if (pendA || rtA) {',
    '                    playAction(undefined, loopA, spdA);',
    '                } else if (autoP) {',
    '                    var defClip = animations.find(function(c) { return /idle|reposo|quieto|stand/i.test(c.name || ""); }) || animations[0];',
    '                    if (defClip) playAction(defClip.name, true, 1);',
    '                }',
    '            }',
    '            group.add(model);',
    '            applyMaterialTintToGroup3D(group, obj, THREE);',
    '        }',
    '',
    '        function disposeThreeResources(root) {',
    '            if (!root) return;',
    '            if (root.userData) root.userData._disposed = true;',
    '            traverseOwnObject3DExport(root, function(child) {',
    '                if (child.geometry) child.geometry.dispose();',
    '                if (child.material) {',
    '                    var mats = Array.isArray(child.material) ? child.material : [child.material];',
    '                    mats.forEach(function(m) {',
    '                        if (m.map) m.map.dispose();',
    '                        m.dispose();',
    '                    });',
    '                }',
    '            });',
    '        }',
    '',
    '        function createExportedMesh3D(obj, THREE, GLTFLoader) {',
    '            var group = new THREE.Group();',
    '            group.userData.isGameObjectRoot = true;',
    '            var dims = getObject3DDimensions(obj);',
    '            var shape = inferShape3D(obj);',
    '            var color = obj.color && obj.color !== "transparent" ? obj.color : (shape === "coin" ? "#facc15" : (shape === "rock" ? "#64748b" : "#6366f1"));',
    '            var roughness = obj.roughness3D !== undefined ? Number(obj.roughness3D) : (shape === "coin" ? 0.22 : (shape === "rock" ? 0.9 : 0.55));',
    '            var metalness = obj.metalness3D !== undefined ? Number(obj.metalness3D) : (shape === "coin" ? 0.85 : 0.1);',
    '            var transparent = (obj.opacity !== undefined && obj.opacity < 1);',
    '            var opacity = obj.opacity !== undefined ? Number(obj.opacity) : 1;',
    '            var castShadow = obj.castShadow3D !== false && shape !== "plane" && shape !== "light";',
    '            var receiveShadow = obj.receiveShadow3D !== false;',
    '',
    '            function makeMat(col, extra) {',
    '                var matParams = {',
    '                    color: new THREE.Color(col !== undefined ? col : color),',
    '                    roughness: roughness,',
    '                    metalness: metalness,',
    '                    transparent: transparent,',
    '                    opacity: opacity',
    '                };',
    '                if (obj.emissive3D) {',
    '                    matParams.emissive = new THREE.Color(obj.emissive3D);',
    '                    matParams.emissiveIntensity = obj.emissiveIntensity3D !== undefined ? Number(obj.emissiveIntensity3D) : 0.6;',
    '                }',
    '                if (extra) {',
    '                    for (var k in extra) { matParams[k] = extra[k]; }',
    '                }',
    '                if (obj.imageUrl && col === undefined) {',
    '                    try {',
    '                        var tex = new THREE.TextureLoader().load(obj.imageUrl);',
    '                        tex.colorSpace = THREE.SRGBColorSpace;',
    '                        matParams.map = tex;',
    '                        matParams.color = new THREE.Color(0xffffff);',
    '                    } catch(e) {}',
    '                }',
    '                return new THREE.MeshStandardMaterial(matParams);',
    '            }',
    '',
    '            if (obj.modelUrl && GLTFLoader) {',
    '                group.userData.loadedModelUrl = obj.modelUrl;',
    '                var syncModel = getExportedGLTFSync(obj.modelUrl);',
    '                if (syncModel) {',
    '                    attachExportedGLTFToGroup(group, obj, syncModel.scene, syncModel.animations, dims, castShadow, receiveShadow, THREE);',
    '                    return group;',
    '                }',
    '                loadExportedGLTF(obj.modelUrl, GLTFLoader).then(function(data) {',
    '                    if (group.userData._disposed) return;',
    '                    attachExportedGLTFToGroup(group, obj, data.scene, data.animations, dims, castShadow, receiveShadow, THREE);',
    '                }).catch(function() {',
    '                    if (group.userData._disposed || group.userData.modelGroup) return;',
    '                    var fallbackBox = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), makeMat(color));',
    '                    fallbackBox.position.y = dims.h / 2;',
    '                    group.add(fallbackBox);',
    '                });',
    '                return group;',
    '            }',
    '',
    '            if (shape === "character") {',
    '                var bodyH = dims.h * 0.52;',
    '                var headR = Math.min(dims.w, dims.d) * 0.34;',
    '                var legH = dims.h * 0.28;',
    '                var legW = dims.w * 0.26;',
    '                var baseColor = new THREE.Color(color);',
    '                var bodyMat = makeMat(color);',
    '                var headColor = baseColor.clone().lerp(new THREE.Color("#ffffff"), 0.22);',
    '                var headMat = makeMat(headColor);',
    '                var visorMat = new THREE.MeshStandardMaterial({',
    '                    color: new THREE.Color("#0f172a"),',
    '                    emissive: new THREE.Color("#38bdf8"),',
    '                    emissiveIntensity: 0.45,',
    '                    roughness: 0.2,',
    '                    metalness: 0.4,',
    '                    transparent: transparent,',
    '                    opacity: opacity',
    '                });',
    '                var legL = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), bodyMat);',
    '                legL.position.set(-dims.w * 0.2, legH / 2, 0);',
    '                var legR = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legW), bodyMat);',
    '                legR.position.set(dims.w * 0.2, legH / 2, 0);',
    '                var torso = new THREE.Mesh(new THREE.BoxGeometry(dims.w * 0.8, bodyH, dims.d * 0.6), bodyMat);',
    '                torso.position.y = legH + bodyH / 2;',
    '                var armW = dims.w * 0.22;',
    '                var armL = new THREE.Mesh(new THREE.BoxGeometry(armW, bodyH * 0.9, armW), bodyMat);',
    '                armL.position.set(-dims.w * 0.54, legH + bodyH * 0.5, 0);',
    '                var armR = new THREE.Mesh(new THREE.BoxGeometry(armW, bodyH * 0.9, armW), bodyMat);',
    '                armR.position.set(dims.w * 0.54, legH + bodyH * 0.5, 0);',
    '                var head = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 14), headMat);',
    '                head.position.y = legH + bodyH + headR * 0.85;',
    '                var visor = new THREE.Mesh(new THREE.BoxGeometry(headR * 1.25, headR * 0.48, headR * 0.55), visorMat);',
    '                visor.position.set(0, legH + bodyH + headR * 0.9, headR * 0.72);',
    '                [legL, legR, torso, armL, armR, head, visor].forEach(function(m) {',
    '                    m.castShadow = castShadow;',
    '                    m.receiveShadow = receiveShadow;',
    '                    group.add(m);',
    '                });',
    '            } else if (shape === "coin") {',
    '                var rCoin = Math.min(dims.w, dims.h, dims.d) * 0.48;',
    '                var thickCoin = Math.max(0.12, rCoin * 0.28);',
    '                var cMat = makeMat("#facc15", { metalness: 0.85, roughness: 0.22, emissive: new THREE.Color("#ca8a04"), emissiveIntensity: 0.2 });',
    '                var disc = new THREE.Mesh(new THREE.CylinderGeometry(rCoin, rCoin, thickCoin, 24), cMat);',
    '                disc.rotation.x = Math.PI / 2;',
    '                disc.position.y = rCoin + 0.12;',
    '                disc.castShadow = castShadow;',
    '                disc.receiveShadow = receiveShadow;',
    '                var rimMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#fef08a"), metalness: 0.9, roughness: 0.15, transparent: transparent, opacity: opacity });',
    '                var rim = new THREE.Mesh(new THREE.TorusGeometry(rCoin * 0.88, thickCoin * 0.25, 10, 24), rimMat);',
    '                rim.position.y = rCoin + 0.12;',
    '                group.add(disc, rim);',
    '            } else if (shape === "tree") {',
    '                var trunkH = dims.h * 0.42;',
    '                var trunkR = Math.min(dims.w, dims.d) * 0.16;',
    '                var trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color("#78350f"), roughness: 0.85, transparent: transparent, opacity: opacity });',
    '                var trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 10), trunkMat);',
    '                trunk.position.y = trunkH / 2;',
    '                var folColor = obj.color && obj.color !== "transparent" ? obj.color : "#15803d";',
    '                var folMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(folColor), roughness: 0.72, flatShading: true, transparent: transparent, opacity: opacity });',
    '                var cone1 = new THREE.Mesh(new THREE.ConeGeometry(dims.w * 0.52, dims.h * 0.45, 7), folMat);',
    '                cone1.position.y = trunkH + dims.h * 0.18;',
    '                var cone2 = new THREE.Mesh(new THREE.ConeGeometry(dims.w * 0.38, dims.h * 0.38, 7), folMat);',
    '                cone2.position.y = trunkH + dims.h * 0.42;',
    '                [trunk, cone1, cone2].forEach(function(m) {',
    '                    m.castShadow = castShadow;',
    '                    m.receiveShadow = receiveShadow;',
    '                    group.add(m);',
    '                });',
    '            } else if (shape === "rock") {',
    '                var rRock = Math.max(dims.w, dims.h, dims.d) * 0.45;',
    '                var rockMat = makeMat(obj.color && obj.color !== "transparent" ? obj.color : "#64748b", { roughness: 0.9, metalness: 0.05, flatShading: true });',
    '                var rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rRock, 0), rockMat);',
    '                rock.scale.set(dims.w / (rRock * 2), dims.h / (rRock * 2), dims.d / (rRock * 2));',
    '                rock.position.y = dims.h * 0.42;',
    '                rock.castShadow = castShadow;',
    '                rock.receiveShadow = receiveShadow;',
    '                group.add(rock);',
    '            } else if (shape === "ramp") {',
    '                var hw = dims.w / 2, hd = dims.d / 2, rh = dims.h;',
    '                var verts = new Float32Array([',
    '                    -hw, 0, -hd,  hw, 0, -hd,  hw, 0, hd,',
    '                    -hw, 0, -hd,  hw, 0, hd,  -hw, 0, hd,',
    '                    -hw, 0, hd,   hw, 0, hd,   hw, rh, hd,',
    '                    -hw, 0, hd,   hw, rh, hd,  -hw, rh, hd,',
    '                    -hw, 0, -hd,  hw, rh, hd,   hw, 0, -hd,',
    '                    -hw, 0, -hd, -hw, rh, hd,   hw, rh, hd,',
    '                    -hw, 0, -hd, -hw, 0, hd,  -hw, rh, hd,',
    '                     hw, 0, -hd,  hw, rh, hd,   hw, 0, hd',
    '                ]);',
    '                var rampGeo = new THREE.BufferGeometry();',
    '                rampGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));',
    '                rampGeo.computeVertexNormals();',
    '                var rampMesh = new THREE.Mesh(rampGeo, makeMat());',
    '                rampMesh.castShadow = castShadow;',
    '                rampMesh.receiveShadow = receiveShadow;',
    '                group.add(rampMesh);',
    '            } else if (shape === "sphere") {',
    '                var sRadius = Math.max(dims.w, dims.h, dims.d) / 2;',
    '                var sMesh = new THREE.Mesh(new THREE.SphereGeometry(sRadius, 24, 18), makeMat());',
    '                sMesh.scale.set(dims.w / (sRadius * 2), dims.h / (sRadius * 2), dims.d / (sRadius * 2));',
    '                sMesh.position.y = dims.h / 2;',
    '                sMesh.castShadow = castShadow;',
    '                sMesh.receiveShadow = receiveShadow;',
    '                group.add(sMesh);',
    '            } else if (shape === "cylinder") {',
    '                var cylR = Math.min(dims.w, dims.d) / 2;',
    '                var cylMesh = new THREE.Mesh(new THREE.CylinderGeometry(cylR, cylR, dims.h, 24), makeMat());',
    '                cylMesh.position.y = dims.h / 2;',
    '                cylMesh.castShadow = castShadow;',
    '                cylMesh.receiveShadow = receiveShadow;',
    '                group.add(cylMesh);',
    '            } else if (shape === "cone") {',
    '                var coneR = Math.min(dims.w, dims.d) / 2;',
    '                var coneMesh = new THREE.Mesh(new THREE.ConeGeometry(coneR, dims.h, 20), makeMat());',
    '                coneMesh.position.y = dims.h / 2;',
    '                coneMesh.castShadow = castShadow;',
    '                coneMesh.receiveShadow = receiveShadow;',
    '                group.add(coneMesh);',
    '            } else if (shape === "capsule") {',
    '                var capR = Math.min(dims.w, dims.d) / 2;',
    '                var capLen = Math.max(0.1, dims.h - capR * 2);',
    '                var capMesh = new THREE.Mesh(new THREE.CapsuleGeometry(capR, capLen, 8, 16), makeMat());',
    '                capMesh.position.y = dims.h / 2;',
    '                capMesh.castShadow = castShadow;',
    '                capMesh.receiveShadow = receiveShadow;',
    '                group.add(capMesh);',
    '            } else if (shape === "torus") {',
    '                var tMaj = Math.min(dims.w, dims.d) * 0.38;',
    '                var tTub = Math.max(0.08, tMaj * 0.35);',
    '                var torMesh = new THREE.Mesh(new THREE.TorusGeometry(tMaj, tTub, 14, 28), makeMat());',
    '                torMesh.position.y = tMaj + tTub;',
    '                torMesh.castShadow = castShadow;',
    '                torMesh.receiveShadow = receiveShadow;',
    '                group.add(torMesh);',
    '            } else if (shape === "plane") {',
    '                var plGeo = new THREE.PlaneGeometry(dims.w, dims.d);',
    '                var plMesh = new THREE.Mesh(plGeo, makeMat());',
    '                plMesh.rotation.x = -Math.PI / 2;',
    '                plMesh.position.y = 0.001;',
    '                plMesh.receiveShadow = true;',
    '                group.add(plMesh);',
    '            } else if (shape === "light") {',
    '                var pLgt = new THREE.PointLight(color, obj.lightIntensity3D !== undefined ? Number(obj.lightIntensity3D) : 2.4, obj.lightDistance3D !== undefined ? Number(obj.lightDistance3D) : 22, 1.5);',
    '                pLgt.position.set(0, 0.5, 0);',
    '                group.add(pLgt);',
    '            } else {',
    '                var boxMesh = new THREE.Mesh(new THREE.BoxGeometry(dims.w, dims.h, dims.d), makeMat());',
    '                boxMesh.position.y = dims.h / 2;',
    '                boxMesh.castShadow = castShadow;',
    '                boxMesh.receiveShadow = receiveShadow;',
    '                group.add(boxMesh);',
    '            }',
    '            return group;',
    '        }',
    '',
    '        function build3DSignature(obj) {',
    '            var d = getObject3DDimensions(obj);',
    '            var shape = inferShape3D(obj);',
    '            return [shape, obj.color || "", obj.imageUrl || "", obj.modelUrl || "", d.w.toFixed(2), d.h.toFixed(2), d.d.toFixed(2), obj.roughness3D, obj.metalness3D, obj.emissive3D, obj.emissiveIntensity3D, obj.lightIntensity3D, obj.lightDistance3D, obj.opacity].join("|");',
    '        }',
    '',
    '        function ensureThreeEngine() {',
    '            var lib = window.__R2D_THREE__;',
    '            if (!lib || !lib.THREE) return null;',
    '            var THREE = lib.THREE;',
    '            var container = document.getElementById("game3d-container");',
    '            if (!container) return null;',
    '            if (threeEngine) return threeEngine;',
    '            var glTest = document.createElement("canvas");',
    '            var gl = glTest.getContext("webgl2") || glTest.getContext("webgl");',
    '            var dbg = gl ? gl.getExtension("WEBGL_debug_renderer_info") : null;',
    '            var rendererStr = dbg && gl ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";',
    '            var isSw = /swiftshader|llvmpipe|software|mesa/i.test(rendererStr);',
    '            var renderer = new THREE.WebGLRenderer({ antialias: !isSw, powerPreference: "high-performance" });',
    '            var maxDpr = (window.projectData && window.projectData.fourKRendering) ? 2.5 : (window.projectData && window.projectData.hdRendering ? 2 : 1.5);',
    '            renderer.setPixelRatio(isSw ? 1 : Math.min(window.devicePixelRatio || 1, maxDpr));',
    '            renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);',
    '            renderer.outputColorSpace = THREE.SRGBColorSpace;',
    '            renderer.toneMapping = THREE.ACESFilmicToneMapping;',
    '            renderer.toneMappingExposure = 1.05;',
    '            renderer.shadowMap.enabled = !isSw;',
    '            renderer.shadowMap.type = isSw ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;',
    '            renderer.domElement.style.touchAction = "none";',
    '            container.innerHTML = "";',
    '            container.appendChild(renderer.domElement);',
    '            var tScene = new THREE.Scene();',
    '            tScene.background = new THREE.Color(runtimeBackgroundColor || "#111827");',
    '            if (lib.RoomEnvironment) {',
    '                var pmrem = new THREE.PMREMGenerator(renderer);',
    '                var envTarget = pmrem.fromScene(new lib.RoomEnvironment(), 0.04);',
    '                tScene.environment = envTarget.texture;',
    '            }',
    '            var tCam = new THREE.PerspectiveCamera(55, (container.clientWidth || 800) / Math.max(1, container.clientHeight || 600), 0.1, 400);',
    '            tCam.position.set(0, 7, 12);',
    '            tCam.lookAt(0, 0, 0);',
    '            var controls = lib.OrbitControls ? new lib.OrbitControls(tCam, renderer.domElement) : null;',
    '            if (controls) { controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enabled = false; }',
    '            var ambient = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, camera3DRuntime.ambientIntensity !== undefined ? camera3DRuntime.ambientIntensity : 0.85);',
    '            var sun = new THREE.DirectionalLight(camera3DRuntime.sunColor || 0xfffbeb, camera3DRuntime.sunIntensity !== undefined ? camera3DRuntime.sunIntensity : 1.55);',
    '            sun.position.set(14, 22, 12);',
    '            sun.castShadow = !isSw;',
    '            if (sun.shadow) {',
    '                sun.shadow.mapSize.width = isSw ? 512 : 1024;',
    '                sun.shadow.mapSize.height = isSw ? 512 : 1024;',
    '                sun.shadow.camera.near = 1;',
    '                sun.shadow.camera.far = 80;',
    '                var dCam = 24;',
    '                sun.shadow.camera.left = -dCam;',
    '                sun.shadow.camera.right = dCam;',
    '                sun.shadow.camera.top = dCam;',
    '                sun.shadow.camera.bottom = -dCam;',
    '                sun.shadow.bias = -0.0005;',
    '            }',
    '            tScene.add(ambient);',
    '            tScene.add(sun);',
    '            var grid = new THREE.GridHelper(60, 60, 0x4f46e5, 0x262b3d);',
    '            grid.position.y = 0.002;',
    '            tScene.add(grid);',
    '            var floorGeo = new THREE.PlaneGeometry(160, 160);',
    '            floorGeo.rotateX(-Math.PI / 2);',
    '            var floorMat = new THREE.ShadowMaterial({ opacity: 0.25 });',
    '            var floorReceiver = new THREE.Mesh(floorGeo, floorMat);',
    '            floorReceiver.receiveShadow = true;',
    '            floorReceiver.position.y = 0;',
    '            tScene.add(floorReceiver);',
    '            var raycaster = new THREE.Raycaster();',
    '            var pointerNdc = new THREE.Vector2();',
    '            var dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);',
    '            var hitPoint = new THREE.Vector3();',
    '',
    '            renderer.domElement.addEventListener("pointerdown", function(e) {',
    '                if (!window.audioContext) {',
    '                    try { window.audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch(errAudio) {}',
    '                }',
    '                if (window.audioContext && window.audioContext.state === "suspended") window.audioContext.resume().catch(function(){});',
    '                if (dialogueElement) {',
    '                    var dCb = dialogueElement._onComplete;',
    '                    dialogueElement.remove();',
    '                    dialogueElement = null;',
    '                    frameDialogueEnd = true;',
    '                    if (typeof dCb === "function") dCb();',
    '                    return;',
    '                }',
    '                var rect = renderer.domElement.getBoundingClientRect();',
    '                pointerNdc.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;',
    '                pointerNdc.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;',
    '                raycaster.setFromCamera(pointerNdc, tCam);',
    '                var groups = [];',
    '                threeEngine.meshMap.forEach(function(entry) { if (entry.group.visible) groups.push(entry.group); });',
    '                var hits = raycaster.intersectObjects(groups, true);',
    '                var clickedObj = null;',
    '                if (hits.length > 0) {',
    '                    var curr = hits[0].object;',
    '                    while (curr && !curr.userData.gameObjectId) curr = curr.parent;',
    '                    if (curr && curr.userData.gameObjectId) {',
    '                        clickedObj = gameObjects.find(function(o) { return o.id === curr.userData.gameObjectId; });',
    '                        if (clickedObj) {',
    '                            var objsById = new Map(gameObjects.map(function(o) { return [o.id, o]; }));',
    '                            var chain = [];',
    '                            var curNode = clickedObj;',
    '                            var safetyCnt = 100;',
    '                            while (curNode && safetyCnt-- > 0) {',
    '                                chain.push(curNode);',
    '                                if (!curNode.parentId) break;',
    '                                curNode = objsById.get(curNode.parentId);',
    '                            }',
    '                            chain.forEach(function(chainObj) {',
    '                                frameClicks.push({ name: chainObj.name, id: chainObj.id });',
    '                                (chainObj.scripts || []).forEach(function(s) {',
    '                                    if (s.trigger === "OnClick") {',
    '                                        var sIdClick = s.id || s.trigger;',
    '                                        executeActionsSequential(s.actions, chainObj, false, 0, false, undefined, "obj-" + chainObj.id + "-script-" + sIdClick);',
    '                                    }',
    '                                });',
    '                            });',
    '                            pointerDownObject = { id: clickedObj.id, name: clickedObj.name };',
    '                            if (clickedObj.isDraggable) {',
    '                                var p3 = getObject3DPosition(clickedObj);',
    '                                dragPlane.set(new THREE.Vector3(0, 1, 0), -p3.y);',
    '                                if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {',
    '                                    if (controls) controls.enabled = false;',
    '                                    activeDrag3D = { id: clickedObj.id, offsetX: p3.x - hitPoint.x, offsetZ: p3.z - hitPoint.z, planeY: p3.y, initialX: clickedObj.x, initialY: clickedObj.y };',
    '                                }',
    '                            }',
    '                        }',
    '                    }',
    '                }',
    '                if (!activeDrag3D && camera3DRuntime.movementEnabled !== false && resolveCam3DMode() !== "freeOrbit") {',
    '                    camera3DRuntime.isOrbiting = true;',
    '                    camera3DRuntime.lastPointerX = e.clientX;',
    '                    camera3DRuntime.lastPointerY = e.clientY;',
    '                    camera3DRuntime.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });',
    '                    try { renderer.domElement.setPointerCapture(e.pointerId); } catch(errCap) {}',
    '                    if (camera3DRuntime.activePointers.size === 2) {',
    '                        var pts = Array.from(camera3DRuntime.activePointers.values());',
    '                        camera3DRuntime.pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);',
    '                        camera3DRuntime.pinchBaseDistance = camera3DRuntime.distance || 9;',
    '                    }',
    '                }',
    '            });',
    '',
    '            renderer.domElement.addEventListener("pointermove", function(e) {',
    '                if (activeDrag3D) {',
    '                    var dObj = gameObjects.find(function(o) { return o.id === activeDrag3D.id; });',
    '                    if (dObj) {',
    '                        var rectD = renderer.domElement.getBoundingClientRect();',
    '                        pointerNdc.x = ((e.clientX - rectD.left) / Math.max(1, rectD.width)) * 2 - 1;',
    '                        pointerNdc.y = -((e.clientY - rectD.top) / Math.max(1, rectD.height)) * 2 + 1;',
    '                        raycaster.setFromCamera(pointerNdc, tCam);',
    '                        dragPlane.set(new THREE.Vector3(0, 1, 0), -activeDrag3D.planeY);',
    '                        if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {',
    '                            var pCur = getObject3DPosition(dObj);',
    '                            if (!dObj.dragXLocked) pCur.x = hitPoint.x + activeDrag3D.offsetX;',
    '                            if (!dObj.dragYLocked) pCur.z = hitPoint.z + activeDrag3D.offsetZ;',
    '                            dObj.position3D = pCur;',
    '                            dObj.vx3D = 0; dObj.vz3D = 0;',
    '                            sync3DTo2D(dObj);',
    '                        }',
    '                    }',
    '                    return;',
    '                }',
    '                var activeCamModeMove = resolveCam3DMode();',
    '                if (camera3DRuntime.isOrbiting && camera3DRuntime.movementEnabled !== false && activeCamModeMove !== "freeOrbit") {',
    '                    camera3DRuntime.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });',
    '                    if (camera3DRuntime.activePointers.size >= 2 && camera3DRuntime.pinchDist && camera3DRuntime.pinchBaseDistance) {',
    '                        var pts2 = Array.from(camera3DRuntime.activePointers.values());',
    '                        var curPinch = Math.hypot(pts2[0].x - pts2[1].x, pts2[0].y - pts2[1].y);',
    '                        if (curPinch > 10) {',
    '                            var ratio = curPinch / camera3DRuntime.pinchDist;',
    '                            camera3DRuntime.distance = Math.max(2.5, Math.min(35, camera3DRuntime.pinchBaseDistance / ratio));',
    '                        }',
    '                    } else {',
    '                        var dx = e.clientX - camera3DRuntime.lastPointerX;',
    '                        var dy = e.clientY - camera3DRuntime.lastPointerY;',
    '                        camera3DRuntime.lastPointerX = e.clientX;',
    '                        camera3DRuntime.lastPointerY = e.clientY;',
    '                        camera3DRuntime.yaw -= dx * 0.006;',
    '                        if (activeCamModeMove === "firstPerson") {',
    '                            var curFp = camera3DRuntime.fpPitch !== undefined ? camera3DRuntime.fpPitch : 0;',
    '                            camera3DRuntime.fpPitch = Math.max(-1.35, Math.min(1.35, curFp - dy * 0.005));',
    '                        } else {',
    '                            var curP = camera3DRuntime.pitch !== undefined ? camera3DRuntime.pitch : 0.38;',
    '                            camera3DRuntime.pitch = Math.max(-0.35, Math.min(1.45, curP + dy * 0.005));',
    '                        }',
    '                    }',
    '                }',
    '            });',
    '',
    '            var endPointer = function(e) {',
    '                try { if (e && e.pointerId !== undefined) renderer.domElement.releasePointerCapture(e.pointerId); } catch(errRel) {}',
    '                if (e && e.pointerId !== undefined) camera3DRuntime.activePointers.delete(e.pointerId);',
    '                if (camera3DRuntime.activePointers.size < 2) {',
    '                    camera3DRuntime.pinchDist = null; camera3DRuntime.pinchBaseDistance = null;',
    '                    if (camera3DRuntime.activePointers.size === 1) {',
    '                        var remPt = Array.from(camera3DRuntime.activePointers.values())[0];',
    '                        camera3DRuntime.lastPointerX = remPt.x;',
    '                        camera3DRuntime.lastPointerY = remPt.y;',
    '                    }',
    '                }',
    '                if (camera3DRuntime.activePointers.size === 0) camera3DRuntime.isOrbiting = false;',
    '                var releasedList = [];',
    '                if (activeDrag3D) {',
    '                    var draggedObj = gameObjects.find(function(o) { return o.id === activeDrag3D.id; });',
    '                    if (draggedObj) {',
    '                        releasedList.push({ id: draggedObj.id, name: draggedObj.name });',
    '                        draggedObj.vx = 0; draggedObj.vy = 0; draggedObj.vx3D = 0; draggedObj.vz3D = 0;',
    '                        if (draggedObj.dragDropBehavior === "return" && activeDrag3D.initialX !== undefined) {',
    '                            draggedObj.x = activeDrag3D.initialX; draggedObj.y = activeDrag3D.initialY;',
    '                            var retPos = getObject3DPosition(draggedObj);',
    '                            retPos.x = draggedObj.x / 50; retPos.z = draggedObj.y / 50;',
    '                            draggedObj.position3D = retPos;',
    '                        }',
    '                    }',
    '                }',
    '                if (pointerDownObject && !releasedList.some(function(r) { return r.id === pointerDownObject.id; })) {',
    '                    releasedList.push(pointerDownObject);',
    '                }',
    '                releasedList.forEach(function(rel) {',
    '                    frameObjectReleases.push(rel);',
    '                    var relObj = gameObjects.find(function(o) { return o.id === rel.id; });',
    '                    if (relObj && relObj.scripts) {',
    '                        relObj.scripts.forEach(function(s) {',
    '                            if (s.trigger === "OnObjectReleased") {',
    '                                var sIdRel = s.id || s.trigger;',
    '                                executeActionsSequential(s.actions, relObj, false, 0, false, undefined, "obj-" + relObj.id + "-script-" + sIdRel);',
    '                            }',
    '                        });',
    '                    }',
    '                });',
    '                activeDrag3D = null;',
    '                pointerDownObject = null;',
    '                if (controls) controls.enabled = (resolveCam3DMode() === "freeOrbit") && (camera3DRuntime.movementEnabled !== false);',
    '            };',
    '            renderer.domElement.addEventListener("pointerup", endPointer);',
    '            renderer.domElement.addEventListener("pointercancel", endPointer);',
    '            renderer.domElement.addEventListener("wheel", function(e) {',
    '                if (resolveCam3DMode() !== "freeOrbit") {',
    '                    e.preventDefault();',
    '                    if (camera3DRuntime.movementEnabled !== false) {',
    '                        var curDist = camera3DRuntime.distance || 9;',
    '                        camera3DRuntime.distance = Math.max(2.5, Math.min(35, curDist + e.deltaY * 0.008));',
    '                    }',
    '                }',
    '            }, { passive: false });',
    '',
    '            window.addEventListener("resize", function() {',
    '                if (!threeEngine || !isCurrentScene3D) return;',
    '                var w = container.clientWidth || window.innerWidth;',
    '                var h = Math.max(1, container.clientHeight || window.innerHeight);',
    '                tCam.aspect = w / h; tCam.updateProjectionMatrix();',
    '                renderer.setSize(w, h);',
    '            });',
    '            threeEngine = { renderer: renderer, scene: tScene, camera: tCam, controls: controls, ambient: ambient, sun: sun, meshMap: new Map(), GLTFLoader: lib.GLTFLoader, THREE: THREE };',
    '            return threeEngine;',
    '        }',
    '',
    '        function clearThreeMeshes() {',
    '            if (typeof activePoseAnimations !== "undefined") activePoseAnimations.clear();',
    '            threeSkyboxUrl = "";',
    '            if (threeSkyboxTexture) {',
    '                try { threeSkyboxTexture.dispose(); } catch (eTex) {}',
    '                threeSkyboxTexture = null;',
    '            }',
    '            if (!threeEngine) return;',
    '            threeEngine.meshMap.forEach(function(entry) {',
    '                threeEngine.scene.remove(entry.group);',
    '                disposeThreeResources(entry.group);',
    '            });',
    '            threeEngine.meshMap.clear();',
    '        }',
    '',
    '        function stepAndRender3D(deltaTime, activeActions) {',
    '            var startGen3D = sceneGeneration;',
    '            var controllablePlayers3D = gameObjects.filter(function(o) {',
    '                return !o.isUI && (o.behaviors || []).some(function(b) {',
    '                    return b.name === "Player3D" || b.name === "PlatformerCharacter" || b.name === "TopDownRPGMovement";',
    '                });',
    '            });',
    '            var currentControlledId3D = (typeof selectedPlayerId !== "undefined" && selectedPlayerId !== null && controllablePlayers3D.some(function(p) { return p.id === selectedPlayerId; }))',
    '                ? selectedPlayerId',
    '                : (controllablePlayers3D[0] ? controllablePlayers3D[0].id : undefined);',
    '            var nowMs = performance.now();',
    '',
    '            function resolve3DSolidsForObject(obj, dt, moveVelX, moveVelY, moveVelZ, isPlayerControlled, hasGravity3D) {',
    '                if (!obj.position3D) obj.position3D = getObject3DPosition(obj);',
    '                var worldMap3D = new Map();',
    '                for (var wi = 0; wi < gameObjects.length; wi++) worldMap3D.set(gameObjects[wi].id, gameObjects[wi]);',
    '                var solids3D = gameObjects.filter(function(s) { return s.id !== obj.id && isSolidObject3D(s); });',
    '                var nowPhys = performance.now();',
    '                var activePoseSelf = typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(obj.id) : null;',
    '                var boss3DBeh = (obj.behaviors || []).find(function(b) { return b.name === "Boss3D" || b.name === "Boss"; });',
    '                var useStableYaw3 = isPlayerControlled || !!boss3DBeh || inferShape3D(obj) === "character";',
    '                var bObj = getEffectiveObject3DBoundsExport(obj, activePoseSelf, nowPhys, { stableYawXZ: useStableYaw3, objectsById: worldMap3D });',
    '                var poseOffX = bObj.centerX - obj.position3D.x;',
    '                var poseOffY = bObj.minY - obj.position3D.y;',
    '                var poseOffZ = bObj.centerZ - obj.position3D.z;',
    '                var prevPoseOffY = typeof obj._prevPoseOffY === "number" ? obj._prevPoseOffY : poseOffY;',
    '                var poseShiftY = Math.abs(poseOffY - prevPoseOffY);',
    '                var wasGrounded3D = Boolean(obj.grounded3D);',
    '                var horizSpeed = Math.hypot(moveVelX, moveVelZ);',
    '',
    '                if (obj._standingPlatformId3D && moveVelY <= 0.15) {',
    '                    var plat3D = solids3D.find(function(s) { return s.id === obj._standingPlatformId3D; });',
    '                    if (plat3D) {',
    '                        var isStickyP3 = !(plat3D.behaviors || []).some(function(b) { return (b.name === "Oscillate3D" || b.name === "Oscillate" || b.name === "Patrol3D" || b.name === "Patrol") && b.properties && b.properties.sticky === false; });',
    '                        if (isStickyP3) {',
    '                            obj.position3D.x += plat3D._platformDx3D || 0;',
    '                            obj.position3D.z += plat3D._platformDz3D || 0;',
    '                            obj.position3D.y += plat3D._platformDy3D || 0;',
    '                        }',
    '                    }',
    '                }',
    '                if (moveVelY <= 0.15) {',
    '                    var bNowCarry = getEffectiveObject3DBoundsExport(obj, activePoseSelf, nowPhys, { stableYawXZ: useStableYaw3, objectsById: worldMap3D });',
    '                    for (var sr = 0; sr < solids3D.length; sr++) {',
    '                        var sR = solids3D[sr], pDyR = sR._platformDy3D || 0;',
    '                        if (pDyR > 0.0001) {',
    '                            var bSolidR = getEffectiveObject3DBoundsExport(sR, typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(sR.id) : null, nowPhys, { objectsById: worldMap3D });',
    '                            var walkYR = getWalkableSurface3DExport(bNowCarry.centerX, bNowCarry.centerZ, bNowCarry.hx, bNowCarry.hz, bSolidR);',
    '                            if (walkYR !== null) {',
    '                                var prevTopR = walkYR - pDyR;',
    '                                var colMinYR = bNowCarry.minY;',
    '                                if (colMinYR >= prevTopR - 0.18 && colMinYR < walkYR) {',
    '                                    obj.position3D.y = walkYR - poseOffY;',
    '                                    obj.vy3D = 0; obj.grounded3D = true; obj.grounded = true;',
    '                                    obj._standingPlatformId3D = sR.id;',
    '                                }',
    '                            }',
    '                        }',
    '                    }',
    '                }',
    '',
    '                obj.position3D.x += moveVelX * dt;',
    '                obj.position3D.z += moveVelZ * dt;',
    '                for (var sx = 0; sx < solids3D.length; sx++) {',
    '                    var sX = solids3D[sx];',
    '                    var bSolidX = getEffectiveObject3DBoundsExport(sX, typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(sX.id) : null, nowPhys, { objectsById: worldMap3D });',
    '                    var bCurrX = getEffectiveObject3DBoundsExport(obj, activePoseSelf, nowPhys, { stableYawXZ: useStableYaw3, objectsById: worldMap3D });',
    '                    var walkYX = getWalkableSurface3DExport(bCurrX.centerX, bCurrX.centerZ, bCurrX.hx, bCurrX.hz, bSolidX);',
    '                    if (walkYX !== null && moveVelY <= 0.15) {',
    '                        var stepUpTol = (bSolidX.shape3D === "ramp" ? Math.max(0.45, horizSpeed * dt + 0.25) : Math.max(0.18, Math.max(0, sX._platformDy3D || 0) + 0.14)) + (wasGrounded3D ? poseShiftY : 0);',
    '                        var snapDownTol = wasGrounded3D ? Math.max(0.32, horizSpeed * dt * 1.8 + 0.12) + poseShiftY : 0.14;',
    '                        if (bCurrX.minY >= walkYX - stepUpTol && bCurrX.minY <= walkYX + snapDownTol) {',
    '                            obj.position3D.y = walkYX - poseOffY;',
    '                            obj.vy3D = Math.min(0, obj.vy3D || 0);',
    '                            obj.grounded3D = true; obj.grounded = true;',
    '                            obj._standingPlatformId3D = sX.id;',
    '                            continue;',
    '                        }',
    '                    }',
    '                    var mtv = solveOBBCollision3DExport(bCurrX, bSolidX, 0);',
    '                    if (!mtv || mtv.depth <= 1e-4) continue;',
    '                    if (mtv.y > 0.55 * mtv.depth && moveVelY <= 0.15 && walkYX !== null && bCurrX.minY >= walkYX - 0.25) {',
    '                        obj.position3D.y = walkYX - poseOffY;',
    '                        obj.vy3D = Math.min(0, obj.vy3D || 0);',
    '                        obj.grounded3D = true; obj.grounded = true;',
    '                        obj._standingPlatformId3D = sX.id;',
    '                        continue;',
    '                    }',
    '                    var horizMag = Math.hypot(mtv.x, mtv.z);',
    '                    if (horizMag > 1e-4 && Math.abs(mtv.y) <= 0.72 * mtv.depth) {',
    '                        obj.position3D.x += mtv.x;',
    '                        obj.position3D.z += mtv.z;',
    '                        frameCollisions.push({ obj1Id: obj.id, obj2Id: sX.id, obj1Name: obj.name, obj2Name: sX.name, type: "OnHorizontalCollision" });',
    '                        var nxH = mtv.x / horizMag, nzH = mtv.z / horizMag;',
    '                        if (!isPlayerControlled) {',
    '                            var vx = obj.vx3D || 0, vz = obj.vz3D || 0;',
    '                            var vn = vx * nxH + vz * nzH;',
    '                            if (vn < 0) {',
    '                                obj.vx3D = Math.abs(nxH) > 0.9 ? 0 : vx - vn * nxH;',
    '                                obj.vz3D = Math.abs(nzH) > 0.9 ? 0 : vz - vn * nzH;',
    '                            }',
    '                        }',
    '                        var burstH = obj._burstImpulse3D;',
    '                        if (burstH) {',
    '                            var bn = (burstH.x || 0) * nxH + (burstH.z || 0) * nzH;',
    '                            if (bn < 0) {',
    '                                burstH.x -= bn * nxH;',
    '                                burstH.z -= bn * nzH;',
    '                                if (Math.abs(burstH.x) < 1e-3) burstH.x = 0;',
    '                                if (Math.abs(burstH.z) < 1e-3) burstH.z = 0;',
    '                            }',
    '                        }',
    '                    } else {',
    '                        if (mtv.y > 0 && moveVelY > 0.15) {',
    '                            obj.position3D.y += mtv.y;',
    '                        } else {',
    '                            obj.position3D.y += mtv.y;',
    '                            frameCollisions.push({ obj1Id: obj.id, obj2Id: sX.id, obj1Name: obj.name, obj2Name: sX.name, type: "OnVerticalCollision" });',
    '                            if (mtv.y > 0) {',
    '                                obj.vy3D = Math.min(0, obj.vy3D || 0); obj.grounded3D = true; obj.grounded = true; obj._standingPlatformId3D = sX.id;',
    '                            } else if (mtv.y < 0 && (obj.vy3D || 0) > 0) {',
    '                                obj.vy3D = 0;',
    '                                if (obj._burstImpulse3D) obj._burstImpulse3D.y = 0;',
    '                            }',
    '                        }',
    '                    }',
    '                }',
    '',
    '                if (hasGravity3D || moveVelY !== 0) {',
    '                    obj.grounded3D = false; obj.grounded = false; obj._standingPlatformId3D = null;',
    '                    obj.position3D.y += moveVelY * dt;',
    '                    for (var sy = 0; sy < solids3D.length; sy++) {',
    '                        var sY = solids3D[sy];',
    '                        var bSolidY = getEffectiveObject3DBoundsExport(sY, typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(sY.id) : null, nowPhys, { objectsById: worldMap3D });',
    '                        var bCurrY = getEffectiveObject3DBoundsExport(obj, activePoseSelf, nowPhys, { stableYawXZ: useStableYaw3, objectsById: worldMap3D });',
    '                        var walkYY = getWalkableSurface3DExport(bCurrY.centerX, bCurrY.centerZ, bCurrY.hx, bCurrY.hz, bSolidY);',
    '                        var downSnap = wasGrounded3D ? Math.max(0.32, horizSpeed * dt * 1.8 + 0.14) + poseShiftY : Math.max(0.16, Math.abs(moveVelY) * dt + 0.08);',
    '                        var upTol = Math.max(0.4, Math.abs(moveVelY) * dt + 0.2) + (wasGrounded3D ? poseShiftY : 0);',
    '                        if (walkYY !== null && moveVelY <= 0.15 && bCurrY.minY <= walkYY + downSnap && bCurrY.minY >= walkYY - upTol) {',
    '                            frameCollisions.push({ obj1Id: obj.id, obj2Id: sY.id, obj1Name: obj.name, obj2Name: sY.name, type: "OnVerticalCollision" });',
    '                            obj.position3D.y = walkYY - poseOffY;',
    '                            obj.vy3D = 0;',
    '                            if (obj._burstImpulse3D) obj._burstImpulse3D.y = 0;',
    '                            obj.grounded3D = true; obj.grounded = true; obj.doubleJumped = false;',
    '                            obj._standingPlatformId3D = sY.id;',
    '                            continue;',
    '                        }',
    '                        var mtvY = solveOBBCollision3DExport(bCurrY, bSolidY, 0);',
    '                        if (mtvY && mtvY.depth > 1e-4) {',
    '                            if (mtvY.y > 0.35 * mtvY.depth && moveVelY <= 0.15) {',
    '                                frameCollisions.push({ obj1Id: obj.id, obj2Id: sY.id, obj1Name: obj.name, obj2Name: sY.name, type: "OnVerticalCollision" });',
    '                                obj.position3D.y += mtvY.y;',
    '                                obj.vy3D = 0;',
    '                                if (obj._burstImpulse3D) obj._burstImpulse3D.y = 0;',
    '                                obj.grounded3D = true; obj.grounded = true; obj.doubleJumped = false;',
    '                                obj._standingPlatformId3D = sY.id;',
    '                            } else if (mtvY.y < -0.35 * mtvY.depth && moveVelY > 0) {',
    '                                frameCollisions.push({ obj1Id: obj.id, obj2Id: sY.id, obj1Name: obj.name, obj2Name: sY.name, type: "OnVerticalCollision" });',
    '                                obj.position3D.y += mtvY.y;',
    '                                obj.vy3D = 0;',
    '                                if (obj._burstImpulse3D) obj._burstImpulse3D.y = 0;',
    '                            } else if (Math.hypot(mtvY.x, mtvY.z) > 1e-4) {',
    '                                obj.position3D.x += mtvY.x;',
    '                                obj.position3D.z += mtvY.z;',
    '                            }',
    '                        }',
    '                    }',
    '                    if ((hasGravity3D || moveVelY < 0) && moveVelY <= 0.15 && (obj.position3D.y + poseOffY) <= 0) {',
    '                        obj.position3D.y = -poseOffY; obj.vy3D = 0;',
    '                        if (obj._burstImpulse3D) obj._burstImpulse3D.y = 0;',
    '                        obj.grounded3D = true; obj.grounded = true; obj.doubleJumped = false;',
    '                    }',
    '                }',
    '                obj._prevPoseOffY = poseOffY;',
    '                if (obj._effectiveVel3D && obj.grounded3D) {',
    '                    obj._effectiveVel3D.y = obj.vy3D || 0;',
    '                }',
    '            }',
    '',
    '            // Pre-update 3D solid platforms before dynamic physics so moving solids never lag or eject players sideways',
    '            gameObjects.forEach(function(s) {',
    '                if (s.isUI || !isSolidObject3D(s)) return;',
    '                if (!s.position3D) s.position3D = getObject3DPosition(s);',
    '                if (!s.scale3D) { var dInitS = getObject3DDimensions(s); s.scale3D = { x: dInitS.w, y: dInitS.h, z: dInitS.d }; }',
    '                if (!s.rotation3D) s.rotation3D = getObject3DRotation(s);',
    '                var prevS = s._lastSolidPos3D || { x: s.position3D.x, y: s.position3D.y, z: s.position3D.z };',
    '                if (s.tweens && s.tweens.length > 0) {',
    '                    s.tweens = s.tweens.filter(function(tween) {',
    '                        var elapsed = nowMs - tween.startTime;',
    '                        var progress = tween.duration > 0 ? Math.min(1, elapsed / tween.duration) : 1;',
    '                        if (tween.type === "position") {',
    '                            var cur2DX = tween.startX + (tween.endX - tween.startX) * progress;',
    '                            var cur2DY = tween.startY + (tween.endY - tween.startY) * progress;',
    '                            s.x = cur2DX; s.y = cur2DY;',
    '                            s.position3D.x = (cur2DX + (s.width || 50) / 2) / 50;',
    '                            s.position3D.z = (cur2DY + (s.height || 50) / 2) / 50;',
    '                        } else if (tween.type === "rotation") {',
    '                            var rotDeg = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;',
    '                            s.rotation = rotDeg; s.rotation3D.y = -(rotDeg * Math.PI) / 180;',
    '                        } else if (tween.type === "scale") {',
    '                            var sxTw = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;',
    '                            var syTw = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;',
    '                            s.scaleX = sxTw; s.scaleY = syTw;',
    '                            s.scale3D.x = Math.max(0.05, sxTw); s.scale3D.y = Math.max(0.05, syTw); s.scale3D.z = Math.max(0.05, sxTw);',
    '                        }',
    '                        return progress < 1;',
    '                    });',
    '                }',
    '                if (s.followTarget) {',
    '                    var fTgtS = gameObjects.find(function(o) { return o.name === s.followTarget; });',
    '                    if (fTgtS) {',
    '                        var fPosS = getObject3DPosition(fTgtS);',
    '                        var fDxS = fPosS.x - s.position3D.x, fDzS = fPosS.z - s.position3D.z;',
    '                        var fDistS = Math.hypot(fDxS, fDzS);',
    '                        if (fDistS > 0.2) {',
    '                            var fSpdS = Number(s.followSpeed || 100) / 36;',
    '                            s.position3D.x += (fDxS / fDistS) * fSpdS * deltaTime;',
    '                            s.position3D.z += (fDzS / fDistS) * fSpdS * deltaTime;',
    '                            s.rotation3D.y = Math.atan2(fDxS, fDzS);',
    '                        }',
    '                    }',
    '                }',
    '                if (s.oscillation) {',
    '                    if (!s.initial3D) s.initial3D = { x: s.position3D.x, y: s.position3D.y, z: s.position3D.z };',
    '                    var oscTimeS = (nowMs - s.oscillation.startTime) / 1000;',
    '                    var oscOffS = Math.sin(oscTimeS * s.oscillation.speed) * (s.oscillation.distance / 50);',
    '                    if (s.oscillation.axis === "x") s.position3D.x = s.initial3D.x + oscOffS;',
    '                    else if (s.oscillation.axis === "y") s.position3D.y = s.initial3D.y + oscOffS;',
    '                    else s.position3D.z = s.initial3D.z + oscOffS;',
    '                }',
    '                if (s.pendingMovements && s.pendingMovements.length > 0) {',
    '                    s.pendingMovements.forEach(function(mv) {',
    '                        var mvSpd = Number(mv.speed || 0) / 50;',
    '                        var mvDir = String(mv.direction || "").toLowerCase();',
    '                        if (mvDir === "right") s.position3D.x += mvSpd * deltaTime;',
    '                        else if (mvDir === "left") s.position3D.x -= mvSpd * deltaTime;',
    '                        else if (mvDir === "up" || mvDir === "forward") s.position3D.z -= mvSpd * deltaTime;',
    '                        else if (mvDir === "down" || mvDir === "backward") s.position3D.z += mvSpd * deltaTime;',
    '                    });',
    '                    s.pendingMovements = [];',
    '                }',
    '                var osc3S = (s.behaviors || []).find(function(b) { return b.name === "Oscillate3D" || b.name === "Oscillate"; });',
    '                if (osc3S) {',
    '                    if (!s.initial3D) s.initial3D = { x: s.position3D.x, y: s.position3D.y, z: s.position3D.z };',
    '                    var opS = osc3S.properties || {};',
    '                    var is3DOscS = osc3S.name === "Oscillate3D";',
    '                    var oscDistS = Number(opS.distance !== undefined ? opS.distance : (is3DOscS ? 1.5 : 100)) / (is3DOscS ? 1 : 50);',
    '                    var offS = Math.sin((nowMs / 1000) * Number(opS.speed || 2)) * oscDistS;',
    '                    if (opS.axis === "x") s.position3D.x = s.initial3D.x + offS;',
    '                    else if (opS.axis === "z") s.position3D.z = s.initial3D.z + offS;',
    '                    else s.position3D.y = s.initial3D.y + offS;',
    '                }',
    '                var pat3S = (s.behaviors || []).find(function(b) { return b.name === "Patrol3D" || b.name === "Patrol"; });',
    '                if (pat3S) {',
    '                    if (!s.initial3D) s.initial3D = { x: s.position3D.x, y: s.position3D.y, z: s.position3D.z };',
    '                    var ppS = pat3S.properties || {};',
    '                    var is3DPatS = pat3S.name === "Patrol3D";',
    '                    var patSpdS = Number(ppS.speed !== undefined ? ppS.speed : (is3DPatS ? 2.5 : 50)) / (is3DPatS ? 1 : 50);',
    '                    var rngS = Math.max(0.2, Number(ppS.range !== undefined ? ppS.range : (is3DPatS ? 4 : 100)) / (is3DPatS ? 1 : 50));',
    '                    var cycS = ((nowMs / 1000) * patSpdS / rngS) % 2;',
    '                    var posOffS = (cycS < 1 ? cycS * rngS : (2 - cycS) * rngS) - rngS / 2;',
    '                    if (ppS.axis === "z") s.position3D.z = s.initial3D.z + posOffS;',
    '                    else if (ppS.axis === "y") s.position3D.y = s.initial3D.y + posOffS;',
    '                    else s.position3D.x = s.initial3D.x + posOffS;',
    '                }',
    '                s._platformDx3D = s.position3D.x - prevS.x;',
    '                s._platformDy3D = s.position3D.y - prevS.y;',
    '                s._platformDz3D = s.position3D.z - prevS.z;',
    '                s._solidUpdatedInPrepass3D = true;',
    '                sync3DTo2D(s);',
    '            });',
    '',
    '            gameObjects.forEach(function(obj) {',
    '                if (obj.isUI) {',
    '                    if (obj.tweens && obj.tweens.length > 0) {',
    '                        obj.tweens = obj.tweens.filter(function(tween) {',
    '                            var elapsedUI = nowMs - tween.startTime;',
    '                            var progressUI = tween.duration > 0 ? Math.min(1, elapsedUI / tween.duration) : 1;',
    '                            if (tween.type === "position") {',
    '                                obj.x = tween.startX + (tween.endX - tween.startX) * progressUI;',
    '                                obj.y = tween.startY + (tween.endY - tween.startY) * progressUI;',
    '                            } else if (tween.type === "rotation") {',
    '                                obj.rotation = tween.startRotation + (tween.endRotation - tween.startRotation) * progressUI;',
    '                            } else if (tween.type === "scale") {',
    '                                obj.scaleX = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progressUI;',
    '                                obj.scaleY = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progressUI;',
    '                            }',
    '                            return progressUI < 1;',
    '                        });',
    '                    }',
    '                    if (obj.followTarget) {',
    '                        var uiFTgt = gameObjects.find(function(o) { return o.name === obj.followTarget; });',
    '                        if (uiFTgt) {',
    '                            var uiFdx = uiFTgt.x - obj.x, uiFdy = uiFTgt.y - obj.y, uiFdist = Math.hypot(uiFdx, uiFdy);',
    '                            if (uiFdist > 5) {',
    '                                var uiFspd = Number(obj.followSpeed || 100);',
    '                                obj.x += (uiFdx / uiFdist) * uiFspd * deltaTime;',
    '                                obj.y += (uiFdy / uiFdist) * uiFspd * deltaTime;',
    '                            }',
    '                        }',
    '                    }',
    '                    if (obj.oscillation) {',
    '                        var uiOscT = (nowMs - obj.oscillation.startTime) / 1000;',
    '                        var uiOscOff = Math.sin(uiOscT * obj.oscillation.speed) * obj.oscillation.distance;',
    '                        if (obj.oscillation.axis === "x") obj.x = obj.oscillation.initialX + uiOscOff;',
    '                        else obj.y = obj.oscillation.initialY + uiOscOff;',
    '                    }',
    '                    var patUIBeh = (obj.behaviors || []).find(function(b) { return b.name === "Patrol"; });',
    '                    if (patUIBeh) {',
    '                        var patP = patUIBeh.properties || {};',
    '                        var pSpd = Number(patP.speed !== undefined ? patP.speed : 50);',
    '                        var pRng = Math.max(1, Number(patP.range !== undefined ? patP.range : 100));',
    '                        if (obj.initialX === undefined) obj.initialX = obj.x;',
    '                        var pCyc = (((nowMs / 1000) * pSpd) / pRng) % 2;',
    '                        var pOff = pCyc < 1 ? pCyc * pRng : (2 - pCyc) * pRng;',
    '                        obj.x = obj.initialX + pOff - pRng / 2;',
    '                        obj.direction = pCyc < 1 ? "right" : "left";',
    '                    }',
    '                    var oscUIBeh = (obj.behaviors || []).find(function(b) { return b.name === "Oscillate"; });',
    '                    if (oscUIBeh) {',
    '                        var oscP = oscUIBeh.properties || {};',
    '                        if (obj.initialX === undefined) obj.initialX = obj.x;',
    '                        if (obj.initialY === undefined) obj.initialY = obj.y;',
    '                        var oOff = Math.sin((nowMs / 1000) * Number(oscP.speed !== undefined ? oscP.speed : 2)) * Number(oscP.distance !== undefined ? oscP.distance : 100);',
    '                        if ((oscP.axis || "x") === "x") obj.x = obj.initialX + oOff;',
    '                        else obj.y = obj.initialY + oOff;',
    '                    }',
    '                    var rotUIBeh = (obj.behaviors || []).find(function(b) { return b.name === "Rotate"; });',
    '                    if (rotUIBeh) {',
    '                        var rSpdU = Number((rotUIBeh.properties && rotUIBeh.properties.rotationSpeed !== undefined) ? rotUIBeh.properties.rotationSpeed : 90);',
    '                        obj.rotation = ((obj.rotation || 0) + rSpdU * deltaTime) % 360;',
    '                        if (obj.rotation < 0) obj.rotation += 360;',
    '                    }',
    '                    var pulseUIBeh = (obj.behaviors || []).find(function(b) { return b.name === "Pulse"; });',
    '                    if (pulseUIBeh) {',
    '                        var plPU = pulseUIBeh.properties || {};',
    '                        if (obj.initialScaleX === undefined) obj.initialScaleX = obj.scaleX !== undefined ? obj.scaleX : 1;',
    '                        if (obj.initialScaleY === undefined) obj.initialScaleY = obj.scaleY !== undefined ? obj.scaleY : 1;',
    '                        var plOffU = Math.sin((nowMs / 1000) * Number(plPU.speed !== undefined ? plPU.speed : 2)) * Number(plPU.distance !== undefined ? plPU.distance : 0.2);',
    '                        obj.scaleX = obj.initialScaleX + plOffU;',
    '                        obj.scaleY = obj.initialScaleY + plOffU;',
    '                    }',
    '                    var scBeh = (obj.behaviors || []).find(function(b) { return b.name === "ScoreCounter"; });',
    '                    if (scBeh) {',
    '                        var vn = (scBeh.properties && scBeh.properties.variableName) || "score";',
    '                        var fmt = (scBeh.properties && scBeh.properties.format) || "Score: {value}";',
    '                        obj.text = String(fmt).replace("{value}", String(gameVariables[vn] !== undefined ? gameVariables[vn] : 0));',
    '                    }',
    '                    var tvBeh = (obj.behaviors || []).find(function(b) { return b.name === "TextVariable"; });',
    '                    if (tvBeh) {',
    '                        var vn2 = (tvBeh.properties && tvBeh.properties.variableName) || "";',
    '                        var pref = (tvBeh.properties && tvBeh.properties.prefix) || "";',
    '                        var suff = (tvBeh.properties && tvBeh.properties.suffix) || "";',
    '                        var val2 = vn2 ? (gameVariables[vn2] !== undefined ? gameVariables[vn2] : 0) : "";',
    '                        obj.text = String(pref) + String(val2) + String(suff);',
    '                    }',
    '                    var tpUIBeh = (obj.behaviors || []).find(function(b) { return b.name === "TweenPath"; });',
    '                    if (tpUIBeh) {',
    '                        var tpP = tpUIBeh.properties || {};',
    '                        var tpSpd = Number(tpP.speed !== undefined ? tpP.speed : 100);',
    '                        var tpLoop = tpP.loop !== false;',
    '                        var tpPts = String(tpP.points || "0,0;100,100").split(";").map(function(pt) { var ps = pt.split(","); return { x: Number(ps[0] || 0), y: Number(ps[1] || 0) }; });',
    '                        if (obj.tweenPathIndex === undefined) obj.tweenPathIndex = 0;',
    '                        if (obj.tweenPathProgress === undefined) obj.tweenPathProgress = 0;',
    '                        var tp1 = tpPts[obj.tweenPathIndex], tp2 = tpPts[(obj.tweenPathIndex + 1) % tpPts.length];',
    '                        if (tp1 && tp2) {',
    '                            var tpDist = Math.hypot(tp2.x - tp1.x, tp2.y - tp1.y);',
    '                            if (tpDist === 0) obj.tweenPathIndex = (obj.tweenPathIndex + 1) % tpPts.length;',
    '                            else {',
    '                                obj.tweenPathProgress += (tpSpd * deltaTime) / tpDist;',
    '                                if (obj.tweenPathProgress >= 1) {',
    '                                    obj.tweenPathProgress = 0;',
    '                                    obj.tweenPathIndex = obj.tweenPathIndex + 1;',
    '                                    if (!tpLoop && obj.tweenPathIndex >= tpPts.length - 1) {',
    '                                        obj.tweenPathIndex = Math.max(0, tpPts.length - 2);',
    '                                        obj.tweenPathProgress = 1;',
    '                                    } else {',
    '                                        obj.tweenPathIndex = obj.tweenPathIndex % tpPts.length;',
    '                                    }',
    '                                }',
    '                                obj.x = tp1.x + (tp2.x - tp1.x) * obj.tweenPathProgress;',
    '                                obj.y = tp1.y + (tp2.y - tp1.y) * obj.tweenPathProgress;',
    '                            }',
    '                        }',
    '                    }',
    '                    if (obj.rotationSpeed) {',
    '                        obj.rotation = ((obj.rotation || 0) + obj.rotationSpeed * deltaTime) % 360;',
    '                        if (obj.rotation < 0) obj.rotation += 360;',
    '                    }',
    '                    if (obj.scaleOscillation) {',
    '                        var uiScT = (nowMs - obj.scaleOscillation.startTime) / 1000;',
    '                        var uiScOff = Math.sin(uiScT * obj.scaleOscillation.speed) * obj.scaleOscillation.distance;',
    '                        obj.scaleX = Math.max(0.01, obj.scaleOscillation.initialScaleX + uiScOff);',
    '                        obj.scaleY = Math.max(0.01, obj.scaleOscillation.initialScaleY + uiScOff);',
    '                    } else {',
    '                        if (obj.scaleSpeedX) obj.scaleX = Math.max(0.01, (obj.scaleX !== undefined ? obj.scaleX : 1) + obj.scaleSpeedX * deltaTime);',
    '                        if (obj.scaleSpeedY) obj.scaleY = Math.max(0.01, (obj.scaleY !== undefined ? obj.scaleY : 1) + obj.scaleSpeedY * deltaTime);',
    '                    }',
    '                    if (obj.scripts) {',
    '                        obj.scripts.forEach(function(sc) {',
    '                            var sIdU = sc.id || sc.trigger;',
    '                            if (sc.trigger === "OnUpdate" || sc.trigger === "Always") {',
    '                                executeActionsSequential(sc.actions, obj, true, deltaTime, false, undefined, "obj-" + obj.id + "-script-" + sIdU);',
    '                            } else if (["OnStart", "OnClick", "OnCollisionWith", "OnTimerElapsed", "OnObjectReleased"].indexOf(sc.trigger) === -1) {',
    '                                var mockCondU = { trigger: sc.trigger, object: obj.name, params: sc.params, target: sc.params && sc.params.targetObjectName };',
    '                                if (checkCondition(mockCondU, obj)) {',
    '                                    executeActionsSequential(sc.actions, obj, true, deltaTime, false, undefined, "obj-" + obj.id + "-script-" + sIdU);',
    '                                }',
    '                            }',
    '                        });',
    '                    }',
    '                    if (obj.pendingMovements && obj.pendingMovements.length > 0) {',
    '                        obj.pendingMovements.forEach(function(mvU) {',
    '                            var spdU = Number(mvU.speed || 0), dirU = String(mvU.direction || "").toLowerCase();',
    '                            if (dirU === "right") obj.x += spdU * deltaTime;',
    '                            else if (dirU === "left") obj.x -= spdU * deltaTime;',
    '                            else if (dirU === "up") obj.y -= spdU * deltaTime;',
    '                            else if (dirU === "down") obj.y += spdU * deltaTime;',
    '                        });',
    '                        obj.pendingMovements = [];',
    '                    }',
    '                    obj.x += (obj.vx || 0) * deltaTime;',
    '                    obj.y += (obj.vy || 0) * deltaTime;',
    '                    return;',
    '                }',
    '                if (!obj.position3D) obj.position3D = getObject3DPosition(obj);',
    '                if (!obj.scale3D) { var dInit = getObject3DDimensions(obj); obj.scale3D = { x: dInit.w, y: dInit.h, z: dInit.d }; }',
    '                if (!obj.rotation3D) obj.rotation3D = getObject3DRotation(obj);',
    '                var prevPos3X = obj.position3D.x;',
    '                var prevPos3Y = obj.position3D.y;',
    '                var prevPos3Z = obj.position3D.z;',
    '                var movedByFollowOrPending = false;',
    '                var solidPre3D = Boolean(obj._solidUpdatedInPrepass3D);',
    '',
    '                if (!solidPre3D && obj.tweens && obj.tweens.length > 0) {',
    '                    obj.tweens = obj.tweens.filter(function(tween) {',
    '                        var elapsed = nowMs - tween.startTime;',
    '                        var progress = tween.duration > 0 ? Math.min(1, elapsed / tween.duration) : 1;',
    '                        if (tween.type === "position") {',
    '                            var cur2DX = tween.startX + (tween.endX - tween.startX) * progress;',
    '                            var cur2DY = tween.startY + (tween.endY - tween.startY) * progress;',
    '                            obj.x = cur2DX; obj.y = cur2DY;',
    '                            obj.position3D.x = (cur2DX + (obj.width || 50) / 2) / 50;',
    '                            obj.position3D.z = (cur2DY + (obj.height || 50) / 2) / 50;',
    '                            movedByFollowOrPending = true;',
    '                        } else if (tween.type === "rotation") {',
    '                            var rotDeg = tween.startRotation + (tween.endRotation - tween.startRotation) * progress;',
    '                            obj.rotation = rotDeg;',
    '                            obj.rotation3D.y = -(rotDeg * Math.PI) / 180;',
    '                        } else if (tween.type === "scale") {',
    '                            var sxTw = tween.startScaleX + (tween.endScaleX - tween.startScaleX) * progress;',
    '                            var syTw = tween.startScaleY + (tween.endScaleY - tween.startScaleY) * progress;',
    '                            obj.scaleX = sxTw; obj.scaleY = syTw;',
    '                            obj.scale3D.x = Math.max(0.05, sxTw);',
    '                            obj.scale3D.y = Math.max(0.05, syTw);',
    '                            obj.scale3D.z = Math.max(0.05, sxTw);',
    '                        }',
    '                        return progress < 1;',
    '                    });',
    '                }',
    '',
    '                if (!solidPre3D && obj.followTarget) {',
    '                    var fTarget = gameObjects.find(function(o) { return o.name === obj.followTarget; });',
    '                    if (fTarget) {',
    '                        var fPos = getObject3DPosition(fTarget);',
    '                        var fDx = fPos.x - obj.position3D.x;',
    '                        var fDz = fPos.z - obj.position3D.z;',
    '                        var fDist = Math.hypot(fDx, fDz);',
    '                        if (fDist > 0.2) {',
    '                            var fSpd = Number(obj.followSpeed || 100) / 36;',
    '                            obj.position3D.x += (fDx / fDist) * fSpd * deltaTime;',
    '                            obj.position3D.z += (fDz / fDist) * fSpd * deltaTime;',
    '                            obj.rotation3D.y = Math.atan2(fDx, fDz);',
    '                            movedByFollowOrPending = true;',
    '                        }',
    '                    }',
    '                }',
    '',
    '                if (!solidPre3D && obj.oscillation) {',
    '                    if (!obj.initial3D) obj.initial3D = { x: obj.position3D.x, y: obj.position3D.y, z: obj.position3D.z };',
    '                    var oscTime3 = (nowMs - obj.oscillation.startTime) / 1000;',
    '                    var oscOff3 = Math.sin(oscTime3 * obj.oscillation.speed) * (obj.oscillation.distance / 50);',
    '                    if (obj.oscillation.axis === "x") obj.position3D.x = obj.initial3D.x + oscOff3;',
    '                    else if (obj.oscillation.axis === "y") obj.position3D.y = obj.initial3D.y + oscOff3;',
    '                    else obj.position3D.z = obj.initial3D.z + oscOff3;',
    '                    movedByFollowOrPending = true;',
    '                }',
    '                if (obj.scaleOscillation) {',
    '                    if (!obj.initialScaleX) obj.initialScaleX = obj.scale3D.x;',
    '                    if (!obj.initialScaleY) obj.initialScaleY = obj.scale3D.y;',
    '                    if (!obj.initialScaleZ) obj.initialScaleZ = obj.scale3D.z;',
    '                    var scTime3 = (nowMs - obj.scaleOscillation.startTime) / 1000;',
    '                    var scOff3 = Math.sin(scTime3 * obj.scaleOscillation.speed) * obj.scaleOscillation.distance;',
    '                    obj.scale3D.x = Math.max(0.05, obj.initialScaleX * Math.max(0.05, 1 + scOff3));',
    '                    obj.scale3D.y = Math.max(0.05, obj.initialScaleY * Math.max(0.05, 1 + scOff3));',
    '                    obj.scale3D.z = Math.max(0.05, obj.initialScaleZ * Math.max(0.05, 1 + scOff3));',
    '                } else {',
    '                    if (obj.scaleSpeedX) {',
    '                        obj.scale3D.x = Math.max(0.05, obj.scale3D.x + obj.scaleSpeedX * deltaTime);',
    '                        obj.scale3D.z = Math.max(0.05, obj.scale3D.z + obj.scaleSpeedX * deltaTime);',
    '                    }',
    '                    if (obj.scaleSpeedY) {',
    '                        obj.scale3D.y = Math.max(0.05, obj.scale3D.y + obj.scaleSpeedY * deltaTime);',
    '                    }',
    '                }',
    '                if (obj.scripts) {',
    '                    obj.scripts.forEach(function(sc) {',
    '                        var sId = sc.id || sc.trigger;',
    '                        if (sc.trigger === "OnUpdate" || sc.trigger === "Always") {',
    '                            executeActionsSequential(sc.actions, obj, true, deltaTime, false, undefined, "obj-" + obj.id + "-script-" + sId);',
    '                        } else if (["OnStart", "OnClick", "OnCollisionWith", "OnTimerElapsed", "OnObjectReleased"].indexOf(sc.trigger) === -1) {',
    '                            var mockCond = { trigger: sc.trigger, object: obj.name, params: sc.params, target: sc.params && sc.params.targetObjectName };',
    '                            if (checkCondition(mockCond, obj)) {',
    '                                executeActionsSequential(sc.actions, obj, true, deltaTime, false, undefined, "obj-" + obj.id + "-script-" + sId);',
    '                            }',
    '                        }',
    '                    });',
    '                }',
    '',
    '                if (!solidPre3D && obj.pendingMovements && obj.pendingMovements.length > 0) {',
    '                    obj.pendingMovements.forEach(function(mv) {',
    '                        var mvSpd = Number(mv.speed || 0) / 50;',
    '                        var mvDir = String(mv.direction || "").toLowerCase();',
    '                        if (mvDir === "right") obj.position3D.x += mvSpd * deltaTime;',
    '                        else if (mvDir === "left") obj.position3D.x -= mvSpd * deltaTime;',
    '                        else if (mvDir === "up" || mvDir === "forward") obj.position3D.z -= mvSpd * deltaTime;',
    '                        else if (mvDir === "down" || mvDir === "backward") obj.position3D.z += mvSpd * deltaTime;',
    '                        movedByFollowOrPending = true;',
    '                    });',
    '                    obj.pendingMovements = [];',
    '                }',
    '',
    '                if (obj.isProjectile) {',
    '                    if (obj.vx3D === undefined && obj.vx !== undefined) obj.vx3D = obj.vx / 50;',
    '                    if (obj.vz3D === undefined && obj.vy !== undefined) obj.vz3D = obj.vy / 50;',
    '                    obj.position3D.x += (obj.vx3D || 0) * deltaTime;',
    '                    obj.position3D.y += (obj.vy3D || 0) * deltaTime;',
    '                    obj.position3D.z += (obj.vz3D || 0) * deltaTime;',
    '                    obj.projectileLifetime = (obj.projectileLifetime !== undefined ? obj.projectileLifetime : 2) - deltaTime;',
    '                    if (obj.projectileLifetime <= 0) { gameObjects = gameObjects.filter(function(o) { return o.id !== obj.id; }); }',
    '                    var isFriendlyP = obj.name === "Bullet" || obj.name === "AttackBox";',
    '                    var hitSolidP = false;',
    '                    for (var pi = 0; pi < gameObjects.length; pi++) {',
    '                        var otherP = gameObjects[pi];',
    '                        if (otherP.id !== obj.id && !otherP.isProjectile && otherP.visible !== false && !otherP.isUI && otherP.isTouchable !== false) {',
    '                            if (!checkCollision3D(obj, otherP)) continue;',
    '                            frameCollisions.push({ obj1Id: obj.id, obj2Id: otherP.id, obj1Name: obj.name, obj2Name: otherP.name, type: "OnCollisionWith" });',
    '                            var otherIsPl = (otherP.behaviors || []).some(function(b) { return ["Player3D", "PlatformerCharacter", "TopDownRPGMovement"].indexOf(b.name) !== -1; });',
    '                            var otherIsEn = (otherP.behaviors || []).some(function(b) { return b.name === "Boss" || b.name === "Boss3D"; }) || (otherP.name || "").toLowerCase().indexOf("enemy") !== -1 || (otherP.name || "").toLowerCase().indexOf("enemigo") !== -1 || (!otherIsPl && otherP.stats !== undefined);',
    '                            var canHitP = (isFriendlyP && otherIsEn) || (!isFriendlyP && otherIsPl && obj.name !== "AttackBox" && obj.name !== "Bullet");',
    '                            if (canHitP) {',
    '                                if (otherP.stats) {',
    '                                    var dmgP = (obj.stats && obj.stats.attack !== undefined) ? obj.stats.attack : 15;',
    '                                    otherP.stats.hp = Math.max(0, (otherP.stats.hp || 100) - dmgP);',
    '                                }',
    '                                if (obj.name !== "AttackBox") { gameObjects = gameObjects.filter(function(o) { return o.id !== obj.id; }); break; }',
    '                            } else if (isSolidObject3D(otherP) && obj.name !== "AttackBox") {',
    '                                hitSolidP = true;',
    '                                break;',
    '                            }',
    '                        }',
    '                    }',
    '                    if (hitSolidP) { gameObjects = gameObjects.filter(function(o) { return o.id !== obj.id; }); }',
    '                    sync3DTo2D(obj);',
    '                    return;',
    '                }',
    '',
    '                if (obj.rotationSpeed) {',
    '                    obj.rotation3D.y += ((Number(obj.rotationSpeed) || 0) * Math.PI / 180) * deltaTime;',
    '                }',
    '                if (obj.rotationSpeed3D) {',
    '                    obj.rotation3D.x += (obj.rotationSpeed3D.x || 0) * deltaTime;',
    '                    obj.rotation3D.y += (obj.rotationSpeed3D.y || 0) * deltaTime;',
    '                    obj.rotation3D.z += (obj.rotationSpeed3D.z || 0) * deltaTime;',
    '                }',
    '                var rot3DBeh = (obj.behaviors || []).find(function(b) { return b.name === "Rotate3D" || b.name === "Rotate"; });',
    '                if (rot3DBeh) {',
    '                    var rp = rot3DBeh.properties || {};',
    '                    if (rp.speedX !== undefined || rp.speedY !== undefined || rp.speedZ !== undefined) {',
    '                        obj.rotation3D.x += ((Number(rp.speedX || 0) * Math.PI) / 180) * deltaTime;',
    '                        obj.rotation3D.y += ((Number(rp.speedY || 0) * Math.PI) / 180) * deltaTime;',
    '                        obj.rotation3D.z += ((Number(rp.speedZ || 0) * Math.PI) / 180) * deltaTime;',
    '                    } else {',
    '                        var rotSpd = Number(rp.speed !== undefined ? rp.speed : (rp.rotationSpeed !== undefined ? rp.rotationSpeed : 90));',
    '                        var rotRadDelta = (rotSpd * Math.PI / 180) * deltaTime;',
    '                        if (rp.axis === "x") obj.rotation3D.x += rotRadDelta;',
    '                        else if (rp.axis === "z") obj.rotation3D.z += rotRadDelta;',
    '                        else obj.rotation3D.y += rotRadDelta;',
    '                    }',
    '                }',
    '                var osc3DBeh = !solidPre3D ? (obj.behaviors || []).find(function(b) { return b.name === "Oscillate3D" || b.name === "Oscillate"; }) : null;',
    '                if (osc3DBeh) {',
    '                    if (!obj.initial3D) obj.initial3D = { x: obj.position3D.x, y: obj.position3D.y, z: obj.position3D.z };',
    '                    var op = osc3DBeh.properties || {};',
    '                    var is3DOsc = osc3DBeh.name === "Oscillate3D";',
    '                    var oscDist = Number(op.distance !== undefined ? op.distance : (is3DOsc ? 1.5 : 100)) / (is3DOsc ? 1 : 50);',
    '                    var off = Math.sin((nowMs / 1000) * Number(op.speed || 2)) * oscDist;',
    '                    if (op.axis === "x") obj.position3D.x = obj.initial3D.x + off;',
    '                    else if (op.axis === "z") obj.position3D.z = obj.initial3D.z + off;',
    '                    else obj.position3D.y = obj.initial3D.y + off;',
    '                }',
    '                var pat3DBeh = !solidPre3D ? (obj.behaviors || []).find(function(b) { return b.name === "Patrol3D" || b.name === "Patrol"; }) : null;',
    '                if (pat3DBeh) {',
    '                    if (!obj.initial3D) obj.initial3D = { x: obj.position3D.x, y: obj.position3D.y, z: obj.position3D.z };',
    '                    var pp = pat3DBeh.properties || {};',
    '                    var is3DPat = pat3DBeh.name === "Patrol3D";',
    '                    var patSpd = Number(pp.speed !== undefined ? pp.speed : (is3DPat ? 2.5 : 50)) / (is3DPat ? 1 : 50);',
    '                    var rng = Math.max(0.2, Number(pp.range !== undefined ? pp.range : (is3DPat ? 4 : 100)) / (is3DPat ? 1 : 50));',
    '                    var cyc = ((nowMs / 1000) * patSpd / rng) % 2;',
    '                    var posOff = (cyc < 1 ? cyc * rng : (2 - cyc) * rng) - rng / 2;',
    '                    if (pp.axis === "z") obj.position3D.z = obj.initial3D.z + posOff;',
    '                    else if (pp.axis === "y") obj.position3D.y = obj.initial3D.y + posOff;',
    '                    else obj.position3D.x = obj.initial3D.x + posOff;',
    '                }',
    '                var pulse3DBeh = (obj.behaviors || []).find(function(b) { return b.name === "Pulse"; });',
    '                if (pulse3DBeh) {',
    '                    var plP = pulse3DBeh.properties || {};',
    '                    if (!obj.initialScaleX) obj.initialScaleX = obj.scale3D.x;',
    '                    if (!obj.initialScaleY) obj.initialScaleY = obj.scale3D.y;',
    '                    var plOff = Math.sin((nowMs / 1000) * Number(plP.speed || 2)) * Number(plP.distance || 0.2);',
    '                    obj.scale3D.x = Math.max(0.1, obj.initialScaleX * (1 + plOff));',
    '                    obj.scale3D.y = Math.max(0.1, obj.initialScaleY * (1 + plOff));',
    '                    obj.scale3D.z = Math.max(0.1, obj.initialScaleX * (1 + plOff));',
    '                }',
    '',
    '                var isCurrentControlled = currentControlledId3D === undefined || obj.id === currentControlledId3D;',
    '                var p3d = (obj.behaviors || []).find(function(b) { return b.name === "Player3D"; });',
    '                var platformer = (obj.behaviors || []).find(function(b) { return b.name === "PlatformerCharacter"; });',
    '                var rpgMovement = (obj.behaviors || []).find(function(b) { return b.name === "TopDownRPGMovement"; });',
    '                var phys3d = (obj.behaviors || []).find(function(b) { return b.name === "Physics3D" || b.name === "Physics"; });',
    '                var boss3d = (obj.behaviors || []).find(function(b) { return b.name === "Boss3D" || b.name === "Boss"; });',
    '                var isPlayer = Boolean(p3d || platformer || rpgMovement);',
    '                var hasGravity3D = Boolean(p3d || platformer || phys3d || boss3d);',
    '                var moveVelX = obj.vx3D || 0;',
    '                var moveVelZ = obj.vz3D || 0;',
    '',
    '                if (isPlayer && isCurrentControlled) {',
    '                    var pProps = (p3d && p3d.properties) || (platformer && platformer.properties) || (rpgMovement && rpgMovement.properties) || {};',
    '                    var baseSpd = p3d ? Number(pProps.speed || 6) : Number(pProps.speed || 200) / 36;',
    '                    var sprintMult = p3d ? Number(pProps.sprintMultiplier || 1.6) : 1.7;',
    '                    var spd = baseSpd;',
    '                    if (obj._customRunActive && Number(obj._customRunSpeed) > 0) {',
    '                        spd = Number(obj._customRunSpeed);',
    '                    } else if (activeActions.run) {',
    '                        spd = Number(obj._configuredSprintSpeed) > 0 ? Number(obj._configuredSprintSpeed) : baseSpd * sprintMult;',
    '                    }',
    '                    var jf = p3d ? Number(pProps.jumpForce || 8) : Number(pProps.jumpForce || 380) / 50;',
    '                    var inpX = (activeActions.moveHorizontalIntensity !== undefined && activeActions.moveHorizontalIntensity !== 0)',
    '                        ? activeActions.moveHorizontalIntensity',
    '                        : ((activeActions.moveRight ? 1 : 0) - (activeActions.moveLeft ? 1 : 0));',
    '                    var inpZ = (activeActions.moveVerticalIntensity !== undefined && activeActions.moveVerticalIntensity !== 0)',
    '                        ? activeActions.moveVerticalIntensity',
    '                        : ((activeActions.moveDown ? 1 : 0) - (activeActions.moveUp ? 1 : 0));',
    '                    var inpLen = Math.hypot(inpX, inpZ);',
    '                    var autoRunSpd3 = Number(obj._autoRunSpeed || 0);',
    '                    var worldMoveX = 0;',
    '                    var worldMoveZ = 0;',
    '                    var mag = 0;',
    '                    if (inpLen > 0.01) {',
    '                        if (inpLen > 1) { inpX /= inpLen; inpZ /= inpLen; }',
    '                        var forwardInput = -inpZ;',
    '                        var rightInput = inpX;',
    '                        var yaw = camera3DRuntime.yaw || 0;',
    '                        var camFwdX = -Math.sin(yaw);',
    '                        var camFwdZ = -Math.cos(yaw);',
    '                        var camRightX = Math.cos(yaw);',
    '                        var camRightZ = -Math.sin(yaw);',
    '                        worldMoveX = camRightX * rightInput + camFwdX * forwardInput;',
    '                        worldMoveZ = camRightZ * rightInput + camFwdZ * forwardInput;',
    '                        mag = Math.hypot(worldMoveX, worldMoveZ);',
    '                        if (mag > 1) { worldMoveX /= mag; worldMoveZ /= mag; }',
    '                    } else if (autoRunSpd3 > 0) {',
    '                        var facingYaw3 = (obj.rotation3D && obj.rotation3D.y) || 0;',
    '                        worldMoveX = Math.sin(facingYaw3);',
    '                        worldMoveZ = Math.cos(facingYaw3);',
    '                        mag = 1;',
    '                        spd = autoRunSpd3;',
    '                    }',
    '                    moveVelX = worldMoveX * spd;',
    '                    moveVelZ = worldMoveZ * spd;',
    '                    obj.vx3D = moveVelX;',
    '                    obj.vz3D = moveVelZ;',
    '                    if (mag > 0.05 && inpLen > 0.01) {',
    '                        obj.rotation3D.y = Math.atan2(worldMoveX, worldMoveZ);',
    '                        obj.direction = worldMoveX < 0 ? "left" : "right";',
    '                    }',
    '                    if (activeActions.jumpAction || (activeActions.jump && obj.grounded3D)) {',
    '                        var canDouble = pProps.doubleJumpEnabled;',
    '                        if (obj.grounded3D) {',
    '                            obj.vy3D = jf; obj.grounded3D = false; obj.grounded = false; obj.doubleJumped = false;',
    '                        } else if (activeActions.jumpAction && !obj.doubleJumped && canDouble) {',
    '                            obj.vy3D = jf; obj.doubleJumped = true;',
    '                        }',
    '                    }',
    '                    if (activeActions.attackAction) {',
    '                        frameAttacks.push({ name: obj.name, id: obj.id });',
    '                    }',
    '                } else if (Number(obj._autoRunSpeed || 0) > 0) {',
    '                    var autoNonP3 = Number(obj._autoRunSpeed);',
    '                    var nonPYaw = (obj.rotation3D && obj.rotation3D.y) || 0;',
    '                    moveVelX = Math.sin(nonPYaw) * autoNonP3;',
    '                    moveVelZ = Math.cos(nonPYaw) * autoNonP3;',
    '                    obj.vx3D = moveVelX;',
    '                    obj.vz3D = moveVelZ;',
    '                }',
    '',
    '                if (boss3d) {',
    '                    var bp = boss3d.properties || {};',
    '                    var bSpd = bp.speed !== undefined ? Number(bp.speed) / (boss3d.name === "Boss3D" ? 1 : 30) : 2.5;',
    '                    var bJump = bp.jumpForce !== undefined ? Number(bp.jumpForce) / (boss3d.name === "Boss3D" ? 1 : 50) : 7;',
    '                    var bInt = Number(bp.attackInterval || 2.0);',
    '                    var bAtkSpd = bp.attackSpeed !== undefined ? Number(bp.attackSpeed) / (boss3d.name === "Boss3D" ? 1 : 40) : 9;',
    '                    var bProjCol = bp.projectileColor || "#ef4444";',
    '                    var bTarget = gameObjects.find(function(p) { return p.id !== obj.id && (p.behaviors || []).some(function(b) { return ["Player3D", "PlatformerCharacter", "TopDownRPGMovement"].indexOf(b.name) !== -1; }); });',
    '                    if (bTarget) {',
    '                        var btp = getObject3DPosition(bTarget);',
    '                        var bDx = btp.x - obj.position3D.x, bDz = btp.z - obj.position3D.z;',
    '                        var bDist = Math.hypot(bDx, bDz);',
    '                        if (bDist > 1.2) {',
    '                            moveVelX = (bDx / bDist) * bSpd;',
    '                            moveVelZ = (bDz / bDist) * bSpd;',
    '                            obj.rotation3D.y = Math.atan2(bDx, bDz);',
    '                        } else {',
    '                            moveVelX = 0; moveVelZ = 0;',
    '                        }',
    '                        if (obj.grounded3D && Math.random() < 0.015) { obj.vy3D = bJump; obj.grounded3D = false; }',
    '                        if (!obj._lastAttackTime) obj._lastAttackTime = Date.now();',
    '                        var tNowB = Date.now();',
    '                        if (tNowB - obj._lastAttackTime > bInt * 1000) {',
    '                            obj._lastAttackTime = tNowB;',
    '                            var bAng = Math.atan2(bDx, bDz);',
    '                            gameObjects.push({',
    '                                id: Date.now() + Math.floor(Math.random() * 10000),',
    '                                name: obj.name + "_Proyectil3D",',
    '                                shape3D: "sphere", color: bProjCol, emissive3D: bProjCol, emissiveIntensity3D: 0.7,',
    '                                x: obj.x, y: obj.y, width: 16, height: 16, zIndex: 20, isUI: false, isProjectile: true, projectileLifetime: 3.0,',
    '                                position3D: { x: obj.position3D.x, y: obj.position3D.y + 0.6, z: obj.position3D.z },',
    '                                scale3D: { x: 0.4, y: 0.4, z: 0.4 },',
    '                                vx3D: Math.sin(bAng) * bAtkSpd, vz3D: Math.cos(bAng) * bAtkSpd, vy3D: 0,',
    '                                stats: { hp: 1, maxHp: 1, attack: 10 }',
    '                            });',
    '                        }',
    '                    }',
    '                }',
    '',
    '                var loopImp3D = obj._pendingLoopImpulse3D;',
    '                var burstImp3D = obj._burstImpulse3D;',
    '                var impVelX = (loopImp3D ? (loopImp3D.x || 0) : 0) + (burstImp3D ? (burstImp3D.x || 0) : 0);',
    '                var impVelZ = (loopImp3D ? (loopImp3D.z || 0) : 0) + (burstImp3D ? (burstImp3D.z || 0) : 0);',
    '                moveVelX += impVelX;',
    '                moveVelZ += impVelZ;',
    '',
    '                if (hasGravity3D) {',
    '                    var gravVal = p3d ? Number((p3d.properties && p3d.properties.gravity) || 18)',
    '                        : (phys3d && phys3d.name === "Physics3D") ? Number((phys3d.properties && phys3d.properties.gravity) || 18)',
    '                        : Number((phys3d && phys3d.properties && phys3d.properties.gravity) || (platformer && platformer.properties && platformer.properties.gravity) || 600) / 36;',
    '                    if (loopImp3D && loopImp3D.y !== 0) {',
    '                        obj.vy3D = loopImp3D.y;',
    '                        if (loopImp3D.y > 0) {',
    '                            obj.grounded3D = false;',
    '                            obj.grounded = false;',
    '                        }',
    '                    } else {',
    '                        obj.vy3D = (obj.vy3D || 0) - gravVal * deltaTime;',
    '                    }',
    '                }',
    '                var moveVelY = hasGravity3D',
    '                    ? (obj.vy3D || 0)',
    '                    : ((obj.vy3D || 0) + (loopImp3D ? (loopImp3D.y || 0) : 0) + (burstImp3D ? (burstImp3D.y || 0) : 0));',
    '                obj._effectiveVel3D = { x: moveVelX, y: moveVelY, z: moveVelZ };',
    '',
    '                var isSolidSelf = isSolidObject3D(obj);',
    '                var movedByAction3D = Boolean(obj._moved3DThisFrame) || movedByFollowOrPending || obj.position3D.x !== prevPos3X || obj.position3D.y !== prevPos3Y || obj.position3D.z !== prevPos3Z;',
    '                obj._moved3DThisFrame = false;',
    '                var needsPhysics3D = !isSolidSelf && (isPlayer || hasGravity3D || moveVelX !== 0 || moveVelZ !== 0 || moveVelY !== 0 || movedByAction3D);',
    '                if (needsPhysics3D) {',
    '                    resolve3DSolidsForObject(obj, deltaTime, moveVelX, moveVelY, moveVelZ, isPlayer, hasGravity3D);',
    '                } else if (isSolidSelf && (impVelX !== 0 || (loopImp3D && loopImp3D.y !== 0) || (burstImp3D && burstImp3D.y !== 0) || impVelZ !== 0)) {',
    '                    obj.position3D.x += moveVelX * deltaTime;',
    '                    obj.position3D.y += moveVelY * deltaTime;',
    '                    obj.position3D.z += moveVelZ * deltaTime;',
    '                }',
    '                if (obj._pendingLoopImpulse3D) {',
    '                    obj._pendingLoopImpulse3D.x = 0; obj._pendingLoopImpulse3D.y = 0; obj._pendingLoopImpulse3D.z = 0;',
    '                }',
    '                if (obj._burstImpulse3D) {',
    '                    var damp3D = Math.exp(-5.5 * deltaTime);',
    '                    obj._burstImpulse3D.x *= damp3D; obj._burstImpulse3D.y *= damp3D; obj._burstImpulse3D.z *= damp3D;',
    '                    if (Math.abs(obj._burstImpulse3D.x) < 0.02) obj._burstImpulse3D.x = 0;',
    '                    if (Math.abs(obj._burstImpulse3D.y) < 0.02) obj._burstImpulse3D.y = 0;',
    '                    if (Math.abs(obj._burstImpulse3D.z) < 0.02) obj._burstImpulse3D.z = 0;',
    '                }',
    '                if (currentScene && currentScene.cameraBounds && currentScene.cameraBounds.enabled) {',
    '                    var bMinX = currentScene.cameraBounds.x / 50;',
    '                    var bMaxX = (currentScene.cameraBounds.x + currentScene.cameraBounds.width) / 50;',
    '                    var bMinZ = currentScene.cameraBounds.y / 50;',
    '                    var bMaxZ = (currentScene.cameraBounds.y + currentScene.cameraBounds.height) / 50;',
    '                    obj.position3D.x = Math.max(bMinX, Math.min(bMaxX, obj.position3D.x));',
    '                    obj.position3D.z = Math.max(bMinZ, Math.min(bMaxZ, obj.position3D.z));',
    '                }',
    '                if (obj.scripts) {',
    '                    obj.scripts.forEach(function(sc3) {',
    '                        if (sceneGeneration !== startGen3D) return;',
    '                        var sId = sc3.id || sc3.trigger;',
    '                        if (["OnStart", "OnClick", "OnCollisionWith", "OnTimerElapsed", "OnObjectReleased", "OnUpdate", "Always"].indexOf(sc3.trigger) === -1) {',
    '                            var mockCond = { trigger: sc3.trigger, object: obj.name, params: sc3.params, target: sc3.params && sc3.params.targetObjectName };',
    '                            if (checkCondition(mockCond, obj)) {',
    '                                executeActionsSequential(sc3.actions, obj, true, deltaTime, false, undefined, "obj-" + obj.id + "-script-" + sId);',
    '                            }',
    '                        }',
    '                    });',
    '                    if (sceneGeneration !== startGen3D) return;',
    '                }',
    '                var p3dBehav = (obj.behaviors || []).find(function(b) { return b.name === "Player3D"; });',
    '                var plat3DBehav = (obj.behaviors || []).find(function(b) { return b.name === "PlatformerCharacter"; });',
    '                var mp3DBehav = (obj.behaviors || []).find(function(b) { return b.name === "MultiplayerTag" && b.properties && b.properties.movementType === "platformer"; });',
    '                var animCharB = p3dBehav || plat3DBehav || mp3DBehav;',
    '                if (animCharB) {',
    '                    var nowTime3D = performance.now();',
    '                    var isAtkNow3D = (isCurrentControlled && activeActions.attackAction) || frameAttacks.some(function(a) { return a.id === obj.id; });',
    '                    var bProps = animCharB.properties || {};',
    '                    var atkId3D = bProps.attackAnimId;',
    '                    var idleId3D = bProps.idleAnimId;',
    '                    var runId3D = bProps.runAnimId;',
    '                    var jumpId3D = bProps.jumpAnimId;',
    '                    var fallId3D = bProps.fallAnimId;',
    '                    var allPosesExport = typeof poseAnimations !== "undefined" ? poseAnimations : [];',
    '                    var entry3D = (typeof threeEngine !== "undefined" && threeEngine && threeEngine.meshMap) ? threeEngine.meshMap.get(obj.id) : null;',
    '                    var glbClips3D = (entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.animations) ? entry3D.group.userData.animations : [];',
    '                    var findClip3D = function(prefId, keywords) {',
    '                        if (!glbClips3D || glbClips3D.length === 0) return null;',
    '                        if (prefId) {',
    '                            var pl = String(prefId).toLowerCase();',
    '                            var mPref = glbClips3D.find(function(c) { return c.name && c.name.toLowerCase() === pl; }) ||',
    '                                glbClips3D.find(function(c) { return c.name && c.name.toLowerCase().indexOf(pl) !== -1; });',
    '                            if (mPref) return mPref;',
    '                        }',
    '                        if (keywords && keywords.length > 0) {',
    '                            var mKw = glbClips3D.find(function(c) {',
    '                                var cn = (c.name || "").toLowerCase();',
    '                                return keywords.some(function(kw) { return cn.indexOf(kw) !== -1; });',
    '                            });',
    '                            if (mKw) return mKw;',
    '                        }',
    '                        return null;',
    '                    };',
    '                    var restoreOrigVisual3D = function(origV) {',
    '                        if (!origV) return;',
    '                        obj.shape3D = origV.shape3D;',
    '                        if (origV.color !== undefined) obj.color = origV.color;',
    '                        obj.emissive3D = origV.emissive3D;',
    '                        obj.emissiveIntensity3D = origV.emissiveIntensity3D;',
    '                        obj.modelUrl = origV.modelUrl;',
    '                    };',
    '                    var startAutoPose3D = function(targetPose, isAirPose) {',
    '                        if (!targetPose || typeof activePoseAnimations === "undefined") return;',
    '                        var curP = activePoseAnimations.get(obj.id);',
    '                        if (!curP || String(curP.poseAnimation.id) !== String(targetPose.id)) {',
    '                            var prevHadClip = Boolean(curP && curP.poseAnimation && curP.poseAnimation.frames && curP.poseAnimation.frames.some(function(f) { return f.modelAnimName; }));',
    '                            if (curP && curP.origVisual) {',
    '                                restoreOrigVisual3D(curP.origVisual);',
    '                            }',
    '                            var origVis = (curP && curP.origVisual) || { shape3D: obj.shape3D, color: obj.color, emissive3D: obj.emissive3D, emissiveIntensity3D: obj.emissiveIntensity3D, modelUrl: obj.modelUrl };',
    '                            activePoseAnimations.set(obj.id, { poseAnimation: targetPose, startTime: nowTime3D, loop: targetPose.loop !== false, speed: 1, isAutoPose: true, isAutoAirPose: Boolean(isAirPose), origVisual: origVis });',
    '                            var nextHasClip = Boolean(targetPose.frames && targetPose.frames[0] && targetPose.frames[0].modelAnimName);',
    '                            if (prevHadClip && !nextHasClip) {',
    '                                delete obj._runtimeAnim3D;',
    '                                if (entry3D && entry3D.group && entry3D.group.userData) {',
    '                                    delete entry3D.group.userData.pendingAnimation3D;',
    '                                    if (obj.animation3D && entry3D.group.userData.playAnimation3D) {',
    '                                        entry3D.group.userData.playAnimation3D(obj.animation3D, obj.animation3DLoop !== false, Number(obj.animation3DSpeed !== undefined ? obj.animation3DSpeed : 1) || 1);',
    '                                    } else if (entry3D.group.userData.stopAnimation3D) {',
    '                                        entry3D.group.userData.stopAnimation3D();',
    '                                    }',
    '                                }',
    '                            }',
    '                        }',
    '                    };',
    '                    if (isAtkNow3D) {',
    '                        var matchAtkPose = (atkId3D && allPosesExport.find(function(pa) { return String(pa.id) === String(atkId3D) || pa.name === atkId3D; })) ||',
    '                            allPosesExport.find(function(pa) { var nl = pa.name.toLowerCase(); return nl.indexOf((obj.name || "").toLowerCase()) !== -1 && (nl.indexOf("attack") !== -1 || nl.indexOf("atacar") !== -1 || nl.indexOf("golpe") !== -1); }) ||',
    '                            allPosesExport.find(function(pa) { var nl = pa.name.toLowerCase(); return nl.indexOf("attack") !== -1 || nl.indexOf("atacar") !== -1 || nl.indexOf("golpe") !== -1; });',
    '                        var atkDur = 350;',
    '                        if (matchAtkPose && matchAtkPose.frames && matchAtkPose.frames.length) {',
    '                            atkDur = matchAtkPose.frames.reduce(function(sum, f) { return sum + Math.max(20, Number(f.duration) || 300); }, 0);',
    '                        }',
    '                        obj.rpgAttackEndTime = nowTime3D + atkDur;',
    '                        if (matchAtkPose && typeof activePoseAnimations !== "undefined") {',
    '                            startAutoPose3D(matchAtkPose, false);',
    '                        } else if (atkId3D && entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {',
    '                            var atkClip3D = findClip3D(atkId3D, []);',
    '                            if (atkClip3D) entry3D.group.userData.playAnimation3D(atkClip3D.name, false, 1);',
    '                        }',
    '                    }',
    '                    var isCurAtk3D = nowTime3D < (obj.rpgAttackEndTime || 0);',
    '                    var hasScAtk3D = obj._scriptAnimTime && (nowTime3D - obj._scriptAnimTime < 120);',
    '                    if (!isCurAtk3D && !hasScAtk3D) {',
    '                        var inAir3D = !obj.grounded3D;',
    '                        var curVy3D = obj.vy3D !== undefined ? obj.vy3D : ((obj._effectiveVel3D && obj._effectiveVel3D.y) || 0);',
    '                        var clearAirPose3D = function() {',
    '                            if (typeof activePoseAnimations === "undefined") return;',
    '                            var curP = activePoseAnimations.get(obj.id);',
    '                            if (curP && curP.poseAnimation) {',
    '                                var n = (curP.poseAnimation.name || "").toLowerCase();',
    '                                var pid = String(curP.poseAnimation.id);',
    '                                var matchesConfiguredAirId = (jumpId3D && (pid === String(jumpId3D) || curP.poseAnimation.name === jumpId3D)) || (fallId3D && (pid === String(fallId3D) || curP.poseAnimation.name === fallId3D));',
    '                                var isAirKeyword = n.indexOf("jump") !== -1 || n.indexOf("salto") !== -1 || n.indexOf("saltar") !== -1 || n.indexOf("brinco") !== -1 || n.indexOf("fall") !== -1 || n.indexOf("caer") !== -1 || n.indexOf("caida") !== -1 || n.indexOf("caída") !== -1;',
    '                                if (curP.isAutoAirPose || curP.startedInAir || matchesConfiguredAirId || isAirKeyword) {',
    '                                    var hadClip = Boolean(curP.poseAnimation.frames && curP.poseAnimation.frames.some(function(f) { return f.modelAnimName; }));',
    '                                    if (curP.origVisual) restoreOrigVisual3D(curP.origVisual);',
    '                                    activePoseAnimations.delete(obj.id);',
    '                                    if (entry3D && entry3D.group) entry3D.group.scale.set(1, 1, 1);',
    '                                    if (hadClip) {',
    '                                        delete obj._runtimeAnim3D;',
    '                                        if (entry3D && entry3D.group && entry3D.group.userData) {',
    '                                            delete entry3D.group.userData.pendingAnimation3D;',
    '                                            if (obj.animation3D && entry3D.group.userData.playAnimation3D) {',
    '                                                entry3D.group.userData.playAnimation3D(obj.animation3D, obj.animation3DLoop !== false, Number(obj.animation3DSpeed !== undefined ? obj.animation3DSpeed : 1) || 1);',
    '                                            } else if (entry3D.group.userData.stopAnimation3D) {',
    '                                                entry3D.group.userData.stopAnimation3D();',
    '                                            }',
    '                                        }',
    '                                    }',
    '                                }',
    '                            }',
    '                        };',
    '                        if (inAir3D) {',
    '                            var curPAir = typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(obj.id) : null;',
    '                            var isFalling3D = curVy3D < -0.05;',
    '                            var targetPoseAir = null;',
    '                            var targetClipObjAir = null;',
    '                            if (isFalling3D) {',
    '                                targetPoseAir = (fallId3D && allPosesExport.find(function(p) { return String(p.id) === String(fallId3D) || p.name === fallId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf((obj.name || "").toLowerCase()) !== -1 && (n.indexOf("fall") !== -1 || n.indexOf("caer") !== -1 || n.indexOf("caida") !== -1 || n.indexOf("caída") !== -1); }) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("fall") !== -1 || n.indexOf("caer") !== -1 || n.indexOf("caida") !== -1 || n.indexOf("caída") !== -1; }) ||',
    '                                    (jumpId3D && allPosesExport.find(function(p) { return String(p.id) === String(jumpId3D) || p.name === jumpId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("jump") !== -1 || n.indexOf("salto") !== -1 || n.indexOf("saltar") !== -1 || n.indexOf("brinco") !== -1; });',
    '                                if (!targetPoseAir) targetClipObjAir = findClip3D(fallId3D, ["fall", "caer", "caida", "caída"]) || findClip3D(jumpId3D, ["jump", "salto", "saltar", "brinco"]);',
    '                            } else {',
    '                                targetPoseAir = (jumpId3D && allPosesExport.find(function(p) { return String(p.id) === String(jumpId3D) || p.name === jumpId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf((obj.name || "").toLowerCase()) !== -1 && (n.indexOf("jump") !== -1 || n.indexOf("salto") !== -1 || n.indexOf("saltar") !== -1 || n.indexOf("brinco") !== -1); }) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("jump") !== -1 || n.indexOf("salto") !== -1 || n.indexOf("saltar") !== -1 || n.indexOf("brinco") !== -1; }) ||',
    '                                    (fallId3D && allPosesExport.find(function(p) { return String(p.id) === String(fallId3D) || p.name === fallId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("fall") !== -1 || n.indexOf("caer") !== -1 || n.indexOf("caida") !== -1 || n.indexOf("caída") !== -1; });',
    '                                if (!targetPoseAir) targetClipObjAir = findClip3D(jumpId3D, ["jump", "salto", "saltar", "brinco"]) || findClip3D(fallId3D, ["fall", "caer", "caida", "caída"]);',
    '                            }',
    '                            var keepExplicitAirScriptPose = Boolean(curPAir && curPAir.isAutoPose === false && !isFalling3D);',
    '                            if (!keepExplicitAirScriptPose) {',
    '                                if (targetPoseAir && typeof activePoseAnimations !== "undefined") {',
    '                                    startAutoPose3D(targetPoseAir, true);',
    '                                } else if (targetClipObjAir && entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {',
    '                                    if ((entry3D.group.userData.currentActionName || "").toLowerCase() !== (targetClipObjAir.name || "").toLowerCase()) {',
    '                                        entry3D.group.userData.playAnimation3D(targetClipObjAir.name, true, 1);',
    '                                    }',
    '                                }',
    '                            }',
    '                        } else {',
    '                            var isMovHoriz3D = Math.hypot(moveVelX, moveVelZ) > 0.08 || Math.hypot(obj.vx3D || 0, obj.vz3D || 0) > 0.08;',
    '                            if (isMovHoriz3D) {',
    '                                var targetRunPose = (runId3D && allPosesExport.find(function(p) { return String(p.id) === String(runId3D) || p.name === runId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf((obj.name || "").toLowerCase()) !== -1 && (n.indexOf("run") !== -1 || n.indexOf("correr") !== -1 || n.indexOf("walk") !== -1 || n.indexOf("caminar") !== -1); }) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("run") !== -1 || n.indexOf("correr") !== -1 || n.indexOf("walk") !== -1 || n.indexOf("caminar") !== -1; });',
    '                                if (targetRunPose && typeof activePoseAnimations !== "undefined") {',
    '                                    startAutoPose3D(targetRunPose, false);',
    '                                } else {',
    '                                    clearAirPose3D();',
    '                                    var targetRunClip = findClip3D(runId3D, ["run", "correr", "walk", "caminar"]);',
    '                                    if (targetRunClip && entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {',
    '                                        if ((entry3D.group.userData.currentActionName || "").toLowerCase() !== (targetRunClip.name || "").toLowerCase()) {',
    '                                            entry3D.group.userData.playAnimation3D(targetRunClip.name, true, 1);',
    '                                        }',
    '                                    }',
    '                                }',
    '                            } else {',
    '                                var targetIdlePose = (idleId3D && allPosesExport.find(function(p) { return String(p.id) === String(idleId3D) || p.name === idleId3D; })) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf((obj.name || "").toLowerCase()) !== -1 && (n.indexOf("idle") !== -1 || n.indexOf("quieto") !== -1 || n.indexOf("reposo") !== -1 || n.indexOf("stand") !== -1); }) ||',
    '                                    allPosesExport.find(function(p) { var n = p.name.toLowerCase(); return n.indexOf("idle") !== -1 || n.indexOf("quieto") !== -1 || n.indexOf("reposo") !== -1 || n.indexOf("stand") !== -1; });',
    '                                if (targetIdlePose && typeof activePoseAnimations !== "undefined") {',
    '                                    startAutoPose3D(targetIdlePose, false);',
    '                                } else {',
    '                                    clearAirPose3D();',
    '                                    var targetIdleClip = findClip3D(idleId3D, ["idle", "quieto", "reposo", "stand"]);',
    '                                    if (targetIdleClip && entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {',
    '                                        if ((entry3D.group.userData.currentActionName || "").toLowerCase() !== (targetIdleClip.name || "").toLowerCase()) {',
    '                                            entry3D.group.userData.playAnimation3D(targetIdleClip.name, true, 1);',
    '                                        }',
    '                                    }',
    '                                }',
    '                            }',
    '                        }',
    '                    }',
    '                }',
    '                sync3DTo2D(obj);',
    '            });',
    '',
    '            if (sceneGeneration !== startGen3D) return;',
    '            for (var i = 0; i < gameObjects.length; i++) {',
    '                if (sceneGeneration !== startGen3D) return;',
    '                for (var j = i + 1; j < gameObjects.length; j++) {',
    '                    if (sceneGeneration !== startGen3D) return;',
    '                    var o1 = gameObjects[i], o2 = gameObjects[j];',
    '                    if (o1.isUI || o2.isUI || o1.isTouchable === false || o2.isTouchable === false) continue;',
    '                    if (checkCollision3D(o1, o2)) {',
    '                        frameCollisions.push({ obj1Id: o1.id, obj2Id: o2.id, obj1Name: o1.name, obj2Name: o2.name, type: "OnCollisionWith" });',
    '                        var targetsDict3 = {}; targetsDict3[o1.name] = [o1]; targetsDict3[o2.name] = [o2];',
    '                        (o1.scripts || []).forEach(function(sc3) {',
    '                            if (sceneGeneration !== startGen3D) return;',
    '                            if (sc3.trigger === "OnCollisionWith" && (!sc3.params || !sc3.params.targetObjectName || sc3.params.targetObjectName === o2.name)) {',
    '                                executeActionsSequential(sc3.actions, o1, false, deltaTime, false, targetsDict3, "obj-" + o1.id + "-script-" + (sc3.id || sc3.trigger));',
    '                            }',
    '                        });',
    '                        if (sceneGeneration !== startGen3D) return;',
    '                        (o2.scripts || []).forEach(function(sc3b) {',
    '                            if (sceneGeneration !== startGen3D) return;',
    '                            if (sc3b.trigger === "OnCollisionWith" && (!sc3b.params || !sc3b.params.targetObjectName || sc3b.params.targetObjectName === o1.name)) {',
    '                                executeActionsSequential(sc3b.actions, o2, false, deltaTime, false, targetsDict3, "obj-" + o2.id + "-script-" + (sc3b.id || sc3b.trigger));',
    '                            }',
    '                        });',
    '                        if (sceneGeneration !== startGen3D) return;',
    '                    }',
    '                }',
    '            }',
    '',
    '            if (sceneGeneration !== startGen3D) return;',
    '            updateInteractables();',
    '            gameObjects.forEach(function(oPre) {',
    '                oPre._preEvt = { x: oPre.x, y: oPre.y, zIndex: oPre.zIndex || 0, rotation: oPre.rotation || 0, scaleX: oPre.scaleX !== undefined ? oPre.scaleX : 1, scaleY: oPre.scaleY !== undefined ? oPre.scaleY : 1 };',
    '                oPre._mutatedBy3DAction = false;',
    '            });',
    '            evaluateEvents(deltaTime);',
    '            if (sceneGeneration !== startGen3D) return;',
    '            stepActiveSequences(deltaTime);',
    '            if (sceneGeneration !== startGen3D) return;',
    '            gameObjects.forEach(function(oPost) {',
    '                if (!oPost.isUI) {',
    '                    var preE = oPost._preEvt;',
    '                    if (preE && !oPost._mutatedBy3DAction) {',
    '                        var pPost = getObject3DPosition(oPost), rPost = getObject3DRotation(oPost), ch2D = false;',
    '                        if (oPost.x !== preE.x) { pPost.x += (oPost.x - preE.x) / 50; ch2D = true; }',
    '                        if (oPost.y !== preE.y) { pPost.z += (oPost.y - preE.y) / 50; ch2D = true; }',
    '                        if ((oPost.zIndex || 0) !== preE.zIndex) { pPost.y += ((oPost.zIndex || 0) - preE.zIndex) * 0.1; ch2D = true; }',
    '                        if ((oPost.rotation || 0) !== preE.rotation) { rPost.y += (((oPost.rotation || 0) - preE.rotation) * Math.PI) / 180; oPost.rotation3D = rPost; ch2D = true; }',
    '                        var curSxP = oPost.scaleX !== undefined ? oPost.scaleX : 1, curSyP = oPost.scaleY !== undefined ? oPost.scaleY : 1;',
    '                        if ((curSxP !== preE.scaleX && preE.scaleX > 0) || (curSyP !== preE.scaleY && preE.scaleY > 0)) {',
    '                            var dCurP = getObject3DDimensions(oPost);',
    '                            var ns3 = { x: dCurP.w, y: dCurP.h, z: dCurP.d };',
    '                            if (curSxP !== preE.scaleX && preE.scaleX > 0) ns3.x = Math.max(0.05, dCurP.w * (curSxP / preE.scaleX));',
    '                            if (curSyP !== preE.scaleY && preE.scaleY > 0) ns3.z = Math.max(0.05, dCurP.d * (curSyP / preE.scaleY));',
    '                            oPost.scale3D = ns3; ch2D = true;',
    '                        }',
    '                        if (ch2D) {',
    '                            oPost.position3D = pPost;',
    '                            oPost._moved3DThisFrame = true;',
    '                        }',
    '                    }',
    '                    if (oPost._customVx !== undefined && !oPost.vx3D) oPost.vx3D = Number(oPost._customVx) / 50;',
    '                    if (oPost._customVy !== undefined && !oPost.vz3D) oPost.vz3D = Number(oPost._customVy) / 50;',
    '                    if (oPost._moved3DThisFrame && !isSolidObject3D(oPost)) {',
    '                        oPost._moved3DThisFrame = false;',
    '                        resolve3DSolidsForObject(oPost, 0, 0, 0, 0, false, false);',
    '                    }',
    '                    sync3DTo2D(oPost);',
    '                }',
    '                delete oPost._preEvt; delete oPost._mutatedBy3DAction;',
    '                oPost._solidUpdatedInPrepass3D = false;',
    '                if (!oPost.isUI && isSolidObject3D(oPost) && oPost.position3D) {',
    '                    oPost._lastSolidPos3D = { x: oPost.position3D.x, y: oPost.position3D.y, z: oPost.position3D.z };',
    '                }',
    '            });',
    '            if (typeof stepActiveAnimations2D === "function") stepActiveAnimations2D(nowMs);',
    '            updateUIDOMElements();',
    '',
    '            var eng = ensureThreeEngine();',
    '            if (eng) {',
    '                var bgHex3 = runtimeBackgroundColor || "#111827";',
    '                var skyUrl3 = camera3DRuntime.skyboxImageUrl || "";',
    '                if (skyUrl3) {',
    '                    if (threeSkyboxUrl !== skyUrl3) {',
    '                        threeSkyboxUrl = skyUrl3;',
    '                        try {',
    '                            var skyLoader = new eng.THREE.TextureLoader();',
    '                            skyLoader.load(',
    '                                skyUrl3,',
    '                                function(tex) {',
    '                                    if (threeSkyboxUrl !== skyUrl3 || !eng || !eng.scene) {',
    '                                        tex.dispose();',
    '                                        return;',
    '                                    }',
    '                                    if (threeSkyboxTexture && threeSkyboxTexture !== tex) threeSkyboxTexture.dispose();',
    '                                    tex.mapping = eng.THREE.EquirectangularReflectionMapping;',
    '                                    if (eng.THREE.SRGBColorSpace !== undefined) tex.colorSpace = eng.THREE.SRGBColorSpace;',
    '                                    tex.needsUpdate = true;',
    '                                    threeSkyboxTexture = tex;',
    '                                    eng.scene.background = tex;',
    '                                },',
    '                                undefined,',
    '                                function() {}',
    '                            );',
    '                        } catch (eSky) {}',
    '                    } else if (threeSkyboxTexture && eng.scene.background !== threeSkyboxTexture) {',
    '                        eng.scene.background = threeSkyboxTexture;',
    '                    }',
    '                } else {',
    '                    if (threeSkyboxUrl) {',
    '                        threeSkyboxUrl = "";',
    '                        if (threeSkyboxTexture) {',
    '                            threeSkyboxTexture.dispose();',
    '                            threeSkyboxTexture = null;',
    '                        }',
    '                    }',
    '                    eng.scene.background = new eng.THREE.Color(bgHex3);',
    '                }',
    '                eng.ambient.intensity = camera3DRuntime.ambientIntensity !== undefined ? camera3DRuntime.ambientIntensity : 0.85;',
    '                eng.sun.intensity = camera3DRuntime.sunIntensity !== undefined ? camera3DRuntime.sunIntensity : 1.55;',
    '                if (camera3DRuntime.fogEnabled) eng.scene.fog = new eng.THREE.FogExp2(camera3DRuntime.fogColor || "#111827", camera3DRuntime.fogDensity || 0.02);',
    '                else eng.scene.fog = null;',
    '                var activeIds = new Set();',
    '                var active3DList = [];',
    '                var activeObjMap3D = new Map();',
    '                gameObjects.forEach(function(obj) {',
    '                    if (obj.isUI) return;',
    '                    activeIds.add(obj.id);',
    '                    active3DList.push(obj);',
    '                    activeObjMap3D.set(obj.id, obj);',
    '                    var animPosOffX = 0, animPosOffY = 0, animPosOffZ = 0;',
    '                    var animRotOffX = 0, animRotOffY = 0, animRotOffZ = 0;',
    '                    var animSclX = 1, animSclY = 1, animSclZ = 1;',
    '                    var pendingFrameClip = null;',
    '                    var activePose = typeof activePoseAnimations !== "undefined" ? activePoseAnimations.get(obj.id) : null;',
    '                    if (activePose && activePose.poseAnimation && activePose.poseAnimation.frames && activePose.poseAnimation.frames.length > 0) {',
    '                        var pFrames = activePose.poseAnimation.frames;',
    '                        var totalMsP = pFrames.reduce(function(sum, f) { return sum + Math.max(20, Number(f.duration) || 300); }, 0);',
    '                        var rawElapsedP = Math.max(0, (performance.now() - activePose.startTime) * (activePose.speed || 1));',
    '                        if (!activePose.loop && rawElapsedP >= totalMsP) activePose.finished = true;',
    '                        var sampledP = samplePoseTimeline3D(pFrames, rawElapsedP, activePose.loop);',
    '                        var deg2rad = Math.PI / 180;',
    '                        animPosOffX = sampledP.position.x || 0;',
    '                        animPosOffY = sampledP.position.y || 0;',
    '                        animPosOffZ = sampledP.position.z || 0;',
    '                        animRotOffX = (sampledP.rotation.x || 0) * deg2rad;',
    '                        animRotOffY = (sampledP.rotation.y || 0) * deg2rad;',
    '                        animRotOffZ = (sampledP.rotation.z || 0) * deg2rad;',
    '                        animSclX = Math.max(0.05, sampledP.scale.x || 1);',
    '                        animSclY = Math.max(0.05, sampledP.scale.y || 1);',
    '                        animSclZ = Math.max(0.05, sampledP.scale.z || 1);',
    '                        var vf = sampledP.visualFrame;',
    '                        if (vf && vf.id !== activePose.lastVisualFrameId) {',
    '                            activePose.lastVisualFrameId = vf.id;',
    '                            var origV = activePose.origVisual || {};',
    '                            var preservedModelUrl = origV.modelUrl || obj.modelUrl;',
    '                            var origShape = origV.shape3D || inferShape3D(Object.assign({}, obj, { shape3D: undefined }));',
    '                            var origColor = origV.color || "";',
    '                            var origEmissive = origV.emissive3D || "";',
    '                            var origEmissiveInt = origV.emissiveIntensity3D || 0;',
    '                            var hasModelM = pFrames.some(function(f) { return Boolean(f.modelUrl) && f.modelUrl !== (origV.modelUrl || ""); });',
    '                            var activeFrameModelUrl = vf.modelUrl || (hasModelM ? origV.modelUrl : preservedModelUrl);',
    '                            var hasShapeM = !activeFrameModelUrl && pFrames.some(function(f) { return Boolean(f.shape3D) && f.shape3D !== origShape; });',
    '                            var hasColorM = pFrames.some(function(f) { return Boolean(f.color) && f.color !== origColor; });',
    '                            var hasEmissM = pFrames.some(function(f) { return (f.emissive3D || "") !== origEmissive || (f.emissiveIntensity3D || 0) !== origEmissiveInt; });',
    '                            if (hasShapeM && vf.shape3D) obj.shape3D = vf.shape3D;',
    '                            if (hasColorM && vf.color) obj.color = vf.color;',
    '                            if (hasEmissM) { obj.emissive3D = vf.emissive3D; obj.emissiveIntensity3D = vf.emissiveIntensity3D; }',
    '                            if (hasModelM && vf.modelUrl) obj.modelUrl = vf.modelUrl;',
    '                            else if (origV.modelUrl && !vf.modelUrl) obj.modelUrl = origV.modelUrl;',
    '                            if (vf.modelAnimName) {',
    '                                pendingFrameClip = { name: vf.modelAnimName, loop: activePose.loop, speed: Number(vf.modelAnimSpeed !== undefined ? vf.modelAnimSpeed : (activePose.speed || 1)) || 1 };',
    '                                obj._runtimeAnim3D = pendingFrameClip;',
    '                            }',
    '                        }',
    '                    }',
    '                    var sig = build3DSignature(obj);',
    '                    var d3Sig = getObject3DDimensions(obj);',
    '                    var dimsSig = d3Sig.w.toFixed(3) + "|" + d3Sig.h.toFixed(3) + "|" + d3Sig.d.toFixed(3);',
    '                    var existing = eng.meshMap.get(obj.id);',
    '                    var grp;',
    '                    if (existing && obj.modelUrl && existing.group.userData.loadedModelUrl === obj.modelUrl && existing.group.userData._dimsSig === dimsSig) {',
    '                        grp = existing.group;',
    '                        if (existing.signature !== sig) {',
    '                            applyMaterialTintToGroup3D(grp, obj, eng.THREE);',
    '                            existing.signature = sig;',
    '                        }',
    '                    } else if (!existing || existing.signature !== sig) {',
    '                        if (existing && obj.modelUrl && !getExportedGLTFSync(obj.modelUrl)) {',
    '                            preloadExportedGLTFs([obj.modelUrl]);',
    '                            grp = existing.group;',
    '                        } else {',
    '                            if (existing) {',
    '                                var savedChildren = existing.group.children.slice();',
    '                                for (var sci = 0; sci < savedChildren.length; sci++) {',
    '                                    if (savedChildren[sci] && savedChildren[sci].userData && savedChildren[sci].userData.isGameObjectRoot) {',
    '                                        eng.scene.add(savedChildren[sci]);',
    '                                    }',
    '                                }',
    '                                if (existing.group.parent) existing.group.parent.remove(existing.group);',
    '                                disposeThreeResources(existing.group);',
    '                            }',
    '                            grp = createExportedMesh3D(obj, eng.THREE, eng.GLTFLoader);',
    '                            grp.userData.gameObjectId = obj.id;',
    '                            grp.userData.isGameObjectRoot = true;',
    '                            grp.userData._dimsSig = dimsSig;',
    '                            eng.scene.add(grp);',
    '                            eng.meshMap.set(obj.id, { group: grp, signature: sig });',
    '                        }',
    '                    } else {',
    '                        grp = existing.group;',
    '                        grp.userData.isGameObjectRoot = true;',
    '                    }',
    '                    if (pendingFrameClip) {',
    '                        obj._runtimeAnim3D = pendingFrameClip;',
    '                        if (grp.userData && grp.userData.playAnimation3D) {',
    '                            grp.userData.playAnimation3D(pendingFrameClip.name, pendingFrameClip.loop, pendingFrameClip.speed);',
    '                        } else {',
    '                            grp.userData.pendingAnimation3D = pendingFrameClip;',
    '                        }',
    '                    }',
    '                    if (grp.userData && grp.userData.mixer) {',
    '                        grp.userData.mixer.update(deltaTime);',
    '                    }',
    '                    var p = getObject3DPosition(obj), r = getObject3DRotation(obj);',
    '                    grp.visible = obj.visible !== false;',
    '                    grp.position.set(p.x + animPosOffX, p.y + animPosOffY, p.z + animPosOffZ);',
    '                    grp.rotation.set(r.x + animRotOffX, r.y + animRotOffY, r.z + animRotOffZ);',
    '                    grp.scale.set(animSclX, animSclY, animSclZ);',
    '                });',
    '                eng.meshMap.forEach(function(entry, id) {',
    '                    if (!activeIds.has(id)) {',
    '                        var orphanChildren = entry.group.children.slice();',
    '                        for (var oci = 0; oci < orphanChildren.length; oci++) {',
    '                            if (orphanChildren[oci] && orphanChildren[oci].userData && orphanChildren[oci].userData.isGameObjectRoot) {',
    '                                eng.scene.add(orphanChildren[oci]);',
    '                            }',
    '                        }',
    '                        if (entry.group.parent) entry.group.parent.remove(entry.group);',
    '                        disposeThreeResources(entry.group);',
    '                        eng.meshMap.delete(id);',
    '                        if (typeof activePoseAnimations !== "undefined") activePoseAnimations.delete(id);',
    '                    }',
    '                });',
    '                for (var hi = 0; hi < active3DList.length; hi++) {',
    '                    var hObj = active3DList[hi];',
    '                    var hEntry = eng.meshMap.get(hObj.id);',
    '                    if (!hEntry) continue;',
    '                    var hasValidParent = Boolean(hObj.parentId && hObj.parentId !== hObj.id && !wouldCreateParentCycle3DExport(hObj.id, hObj.parentId, activeObjMap3D) && eng.meshMap.has(hObj.parentId));',
    '                    var targetParentGroup = hasValidParent ? eng.meshMap.get(hObj.parentId).group : eng.scene;',
    '                    if (hEntry.group.parent !== targetParentGroup) {',
    '                        targetParentGroup.add(hEntry.group);',
    '                    }',
    '                }',
    '                var followObj = (camera3DRuntime.targetObjectName ? gameObjects.find(function(o) { return o.name === camera3DRuntime.targetObjectName && !o.isUI; }) : (currentScene && currentScene.camera3DTargetId ? gameObjects.find(function(o) { return o.id === currentScene.camera3DTargetId && !o.isUI; }) : null)) || gameObjects.find(function(o) { return !o.isUI && (o.behaviors || []).some(function(b) { return b.name === "FollowCamera3D" || b.name === "FollowCamera" || b.name === "Player3D" || b.name === "PlatformerCharacter"; }); });',
    '                var mode = resolveCam3DMode();',
    '                var camMoveAllowed = camera3DRuntime.movementEnabled !== false;',
    '                if (camMoveAllowed && camera3DRuntime.rightStickEnabled === true && typeof gamepadRightStick !== "undefined" && (gamepadRightStick.x !== 0 || gamepadRightStick.y !== 0)) {',
    '                    var rSens = Number(camera3DRuntime.rightStickSensitivity !== undefined ? camera3DRuntime.rightStickSensitivity : 2.4) * deltaTime;',
    '                    if (mode === "freeOrbit" && eng.controls) {',
    '                        var tVecR = eng.controls.target || new eng.THREE.Vector3(0, 0, 0);',
    '                        var relPosR = eng.camera.position.clone().sub(tVecR);',
    '                        var sphR = new eng.THREE.Spherical().setFromVector3(relPosR);',
    '                        sphR.theta -= gamepadRightStick.x * rSens;',
    '                        sphR.phi = Math.max(0.12, Math.min(Math.PI - 0.12, sphR.phi + gamepadRightStick.y * rSens * 0.85));',
    '                        relPosR.setFromSpherical(sphR);',
    '                        eng.camera.position.copy(tVecR).add(relPosR);',
    '                        eng.camera.lookAt(tVecR);',
    '                    } else {',
    '                        camera3DRuntime.yaw = (camera3DRuntime.yaw || 0) - gamepadRightStick.x * rSens;',
    '                        if (mode === "firstPerson") {',
    '                            var fpCurR = camera3DRuntime.fpPitch !== undefined ? camera3DRuntime.fpPitch : 0;',
    '                            camera3DRuntime.fpPitch = Math.max(-1.35, Math.min(1.35, fpCurR - gamepadRightStick.y * rSens * 0.8));',
    '                        } else {',
    '                            var tpCurR = camera3DRuntime.pitch !== undefined ? camera3DRuntime.pitch : 0.38;',
    '                            camera3DRuntime.pitch = Math.max(-0.35, Math.min(1.45, tpCurR + gamepadRightStick.y * rSens * 0.8));',
    '                        }',
    '                    }',
    '                }',
    '                if (mode === "freeOrbit" && eng.controls) {',
    '                    eng.controls.enabled = camMoveAllowed;',
    '                    if (eng.controls.enabled) eng.controls.update();',
    '                } else if (followObj) {',
    '                    if (eng.controls) eng.controls.enabled = false;',
    '                    var tp = getWorldTransform3DExport(followObj, activeObjMap3D).pos;',
    '                    var dimsF = getObject3DDimensions(followObj);',
    '                    var alpha = 1 - Math.exp(-14 * deltaTime);',
    '                    var targetH = Math.max(0.6, dimsF.h * 0.5);',
    '                    var targetX = tp.x;',
    '                    var targetY = tp.y + targetH;',
    '                    var targetZ = tp.z;',
    '                    var camScratchVec = eng.camera.userData._r2dScratchVec || (eng.camera.userData._r2dScratchVec = new eng.THREE.Vector3());',
    '                    if (mode === "firstPerson") {',
    '                        var eyeY = tp.y + dimsF.h * 0.85;',
    '                        camScratchVec.set(targetX, eyeY, targetZ);',
    '                        eng.camera.position.lerp(camScratchVec, alpha);',
    '                        var pitchFp = Math.max(-1.35, Math.min(1.35, camera3DRuntime.fpPitch || 0));',
    '                        var yawFp = camera3DRuntime.yaw || 0;',
    '                        var cosPitchFp = Math.cos(pitchFp);',
    '                        var lookFwdX = -Math.sin(yawFp) * cosPitchFp;',
    '                        var lookFwdZ = -Math.cos(yawFp) * cosPitchFp;',
    '                        eng.camera.lookAt(eng.camera.position.x + lookFwdX * 10, eng.camera.position.y + Math.sin(pitchFp) * 10, eng.camera.position.z + lookFwdZ * 10);',
    '                    } else if (mode === "isometric") {',
    '                        var isoDist = camera3DRuntime.distance || 14;',
    '                        camScratchVec.set(targetX + isoDist * 0.7, targetY + isoDist * 0.6, targetZ + isoDist * 0.7);',
    '                        eng.camera.position.lerp(camScratchVec, alpha);',
    '                        eng.camera.lookAt(targetX, targetY, targetZ);',
    '                    } else if (mode === "topDown3D") {',
    '                        var topDist = camera3DRuntime.distance || 16;',
    '                        camScratchVec.set(targetX, targetY + topDist, targetZ + 0.1);',
    '                        eng.camera.position.lerp(camScratchVec, alpha);',
    '                        eng.camera.lookAt(targetX, targetY, targetZ);',
    '                    } else {',
    '                        var yawThird = camera3DRuntime.yaw || 0;',
    '                        var pitchThird = Math.max(-0.35, Math.min(1.45, camera3DRuntime.pitch !== undefined ? camera3DRuntime.pitch : 0.38));',
    '                        var distThird = Math.max(2.5, Math.min(35, camera3DRuntime.distance || 9));',
    '                        var cyThird = Math.cos(pitchThird);',
    '                        var syThird = Math.sin(pitchThird);',
    '                        var desiredX = targetX + distThird * Math.sin(yawThird) * cyThird;',
    '                        var desiredY = Math.max(0.25, targetY + distThird * syThird);',
    '                        var desiredZ = targetZ + distThird * Math.cos(yawThird) * cyThird;',
    '                        camScratchVec.set(desiredX, desiredY, desiredZ);',
    '                        eng.camera.position.lerp(camScratchVec, alpha);',
    '                        eng.camera.lookAt(targetX, targetY, targetZ);',
    '                    }',
    '                }',
    '                eng.renderer.render(eng.scene, eng.camera);',
    '            }',
    '        }',
].join('\n');

export const generateGameHTML = (projectData?: ProjectData | null, instantStartOrOptions: boolean | ExportOptions = true, optionsArg?: ExportOptions): string => {
    if (!projectData) return '';
    const options = typeof instantStartOrOptions === 'object' ? instantStartOrOptions : optionsArg;
    const instantStart = typeof instantStartOrOptions === 'boolean' ? instantStartOrOptions : true;
    const resolvedInstantStart = options?.skipStartScreen !== undefined ? Boolean(options.skipStartScreen) : instantStart;
    const filteredProjectData = applyExportDimensionFilter(projectData, options);
    const has3DScenes = Boolean(filteredProjectData.scenes?.some(s => getSceneDimension(s) === '3d'));
    const exported3DScript = has3DScenes ? getExported3DRetryHelpersScript() : `
        let isCurrentScene3D = false;
        let camera3DRuntime = { mode: "thirdPerson", offset: { x: 0, y: 5, z: 9 }, fogEnabled: false, fogColor: "#111827", fogDensity: 0.02, skyboxImageUrl: "", movementEnabled: true, rightStickEnabled: false, rightStickSensitivity: 2.4 };
        let gamepadRightStick = { x: 0, y: 0 };
        function resolveSceneIs3D() { return false; }
        function clearThreeMeshes() {}
        function stepAndRender3D() {}
    `;

    // This script is a self-contained game engine, adapted from GameView.tsx
    // to provide full feature parity with the in-editor preview.
    const gameEngineScript = `
        const canvas = document.getElementById('gameCanvas');
        if (!canvas) throw new Error("Canvas not found");
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error("Could not get 2D context");
        ${exported3DScript}

        // Game State
        let gameObjects = [];
        let keysPressed = {};
        let actionsPressed = {};
        let gameVariables = {};
        const memorySaveSlots = new Map();
        const TRANSIENT_SERIALIZE_KEYS = new Set([
            '_originalBehaviors', '_solidUpdatedInPrepass', '_solidUpdatedInPrepass3D', '_preEvt',
            '_mutatedBy3DAction', '_moved3DThisFrame', '_lastSolidPos3D', '_lastSolidX', '_lastSolidY',
            '_platformDx', '_platformDy', '_platformDx3D', '_platformDy3D', '_platformDz3D',
            '_standingPlatformId', '_standingPlatformId3D', '_pendingLoopImpulse3D', '_burstImpulse3D',
            '_effectiveVel3D', '_prevPoseOffY', '_runtimeAnim3D', 'mixer', 'material', 'geometry'
        ]);
        const safeSerialize = (obj) => {
            const stack = [];
            const cloneClean = (value) => {
                if (value === null || value === undefined) return value;
                const t = typeof value;
                if (t === 'function' || t === 'symbol') return undefined;
                if (t !== 'object') return value;
                if ((typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) ||
                    (typeof Window !== 'undefined' && value instanceof Window) ||
                    (typeof Document !== 'undefined' && value instanceof Document)) {
                    return undefined;
                }
                if (stack.indexOf(value) !== -1) return undefined;
                stack.push(value);
                try {
                    if (Array.isArray(value)) {
                        const arr = [];
                        for (let i = 0; i < value.length; i++) {
                            const item = cloneClean(value[i]);
                            arr.push(item === undefined ? null : item);
                        }
                        return arr;
                    }
                    const out = {};
                    const keys = Object.keys(value);
                    for (let i = 0; i < keys.length; i++) {
                        const key = keys[i];
                        if (key.indexOf('_three') === 0 || TRANSIENT_SERIALIZE_KEYS.has(key)) continue;
                        const cleaned = cloneClean(value[key]);
                        if (cleaned !== undefined) out[key] = cleaned;
                    }
                    return out;
                } finally {
                    stack.pop();
                }
            };
            return JSON.stringify(cloneClean(obj));
        };
        const parseNumericValue = (raw) => {
            if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
            if (typeof raw === 'number') return isFinite(raw) ? raw : null;
            const trimmed = String(raw).trim().replace(',', '.');
            if (trimmed === '') return null;
            const num = Number(trimmed);
            return isFinite(num) ? num : null;
        };
        const roundCleanNumber = (num) => {
            const rounded = Math.round(num * 1e9) / 1e9;
            return Object.is(rounded, -0) ? 0 : rounded;
        };
        const normalizeVariableInputValue = (raw) => {
            if (typeof raw === 'boolean') return raw;
            if (typeof raw === 'number') return isFinite(raw) ? roundCleanNumber(raw) : 0;
            if (raw === null || raw === undefined) return '';
            const num = parseNumericValue(raw);
            return num !== null ? roundCleanNumber(num) : String(raw);
        };
        const sanitizeLoadedGameObjects = (rawObjects, is3D) => {
            if (!Array.isArray(rawObjects)) return [];
            return rawObjects.filter(o => o && typeof o === 'object').map(raw => {
                const obj = { ...raw };
                obj.behaviors = Array.isArray(obj.behaviors) ? obj.behaviors.filter(b => b && typeof b === 'object' && b.name) : [];
                if (Array.isArray(obj._originalBehaviors)) {
                    const cleanOrig = obj._originalBehaviors.filter(b => b && typeof b === 'object' && b.name);
                    obj._originalBehaviors = cleanOrig.length > 0 ? cleanOrig : obj.behaviors.map(b => ({ ...b, properties: { ...(b.properties || {}) } }));
                } else {
                    obj._originalBehaviors = obj.behaviors.map(b => ({ ...b, properties: { ...(b.properties || {}) } }));
                }
                TRANSIENT_SERIALIZE_KEYS.forEach(k => { if (k !== '_originalBehaviors') delete obj[k]; });
                obj.vx = 0;
                obj.vy = 0;
                obj.vx3D = 0;
                obj.vy3D = 0;
                obj.vz3D = 0;
                obj._customVx = undefined;
                obj._customVy = undefined;
                obj.rpgKnockbackVx = 0;
                obj.rpgKnockbackVy = 0;
                obj.pendingMovements = [];
                if (is3D && !obj.isUI && typeof getObject3DPosition === 'function') {
                    obj.position3D = getObject3DPosition(obj);
                    const dims = getObject3DDimensions(obj);
                    obj.scale3D = { x: dims.w, y: dims.h, z: dims.d };
                    obj.rotation3D = getObject3DRotation(obj);
                    sync3DTo2D(obj);
                }
                return obj;
            });
        };
        // Initialize gameVariables with global values from project data
        if (window.projectData && window.projectData.globalVariables) {
            window.projectData.globalVariables.forEach(v => {
                gameVariables[v.name] = v.value;
            });
        }

        let imageCache = new Map();
        let audioCache = new Map();
        let videoCache = new Map();
        let backgroundMusicPlayer = null;
        let currentBackgroundMusicId = null;
        let activeAnimations = new Map();
        let activePoseAnimations = new Map();
        let camera = { x: 0, y: 0, zoom: 1 };
        let currentScene = null;
        let runtimeBackgroundColor = '#111827';
        let interactionRequired = true;
        let selectedPlayerId = null;
        let playerPressStates = {};
        let joinedPlayers = { 1: true }; 
        let lastPlayerInputTime = { 1: Date.now() };
        let socket = null;
        let myPlayerNumber = null;
        let remotePlayers = {};
        let lastEmitTime = 0;
        let lastEmittedState = '';
        let mpTag = null;
        let mpTagForJoin = null;
        let isMpPlatformer = false;

        const isPlayerJoined = (pNum) => {
            
            return !!joinedPlayers[pNum];
        };
        
        // Project Data
        let allScenes = [];
        let assets = [];
        let animations = [];
        let poseAnimations = [];
        let globalObjects = [];
        
        // Loop and Event Management
        let animationFrameId;
        let dialogueElement = null;
        let frameCollisions = [];
        let frameClicks = [];
        let frameInteractions = [];
        let frameJoystickEvents = [];
        let frameTimerEvents = [];
        let frameAttacks = [];
        let frameButtonDown = [];
        let frameButtonUp = [];
        let frameTriggerDown = [];
        let frameTriggerUp = [];
        let frameConsoleCommands = [];
        let framePlayerJoined = false;
        let framePlayerLeft = false;
        let frameMatchFound = false;
        let frameReceiveNetworkMessage = false;
        let frameNetworkMessages = [];
        let sceneGeneration = 0;
        let sceneChangeRequested = false;
        let sequenceFrame = 0;
        let timers = new Map();
        let intervals = new Map();
        let joystickState = { active: false, angle: 0, distance: 0 };
        let joystickTouchId = null;
        let joystickPointerId = null;
        let joystickUpPreviousFrame = false;
        let activeJoystickBase = null;
        let activeJoystickHandle = null;
        let joystickWindowListenersAttached = false;
        const suppressedKeysUntilRelease = new Set();
        let gamepadMoveLockUntilNeutral = false;
        window.audioContext = null;
        let joystickSize = 120;
        let dragging = null;
        let buttonState = {};
        let activeInteractable = null;
        let floatingFeedbacks = [];

        function updateJoystickVisualsDOM() {
            const handle = activeJoystickHandle || document.getElementById('joystick-handle');
            if (!handle) return;
            if (joystickState.active) {
                const x = joystickState.distance * Math.cos(joystickState.angle * Math.PI / 180);
                const y = joystickState.distance * Math.sin(joystickState.angle * Math.PI / 180);
                handle.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
            } else {
                handle.style.transform = 'translate(0, 0)';
            }
        }

        function updateJoystickFromClient(clientX, clientY) {
            const base = activeJoystickBase || document.getElementById('joystick-base');
            if (!base || base.style.display === 'none') {
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
            joystickState = { active: true, angle, distance };
            updateJoystickVisualsDOM();
        }

        function resetJoystick() {
            joystickState = { active: false, angle: 0, distance: 0 };
            joystickTouchId = null;
            joystickPointerId = null;
            joystickUpPreviousFrame = false;
            frameJoystickEvents = [];
            actionsPressed.moveHorizontalIntensity = 0;
            actionsPressed.moveVerticalIntensity = 0;
            ['moveLeft', 'moveRight', 'moveUp', 'moveDown'].forEach(act => {
                if (!actionsPressed[act + '_ui']) actionsPressed[act] = false;
            });
            updateJoystickVisualsDOM();
        }

        function isGamepadDirectionalActive(gp) {
            if (!gp) return false;
            if (gp.buttons && (gp.buttons[12]?.pressed || gp.buttons[13]?.pressed || gp.buttons[14]?.pressed || gp.buttons[15]?.pressed)) {
                return true;
            }
            if (gp.axes && gp.axes.length >= 2 && (Math.abs(gp.axes[0]) > 0.18 || Math.abs(gp.axes[1]) > 0.18)) {
                return true;
            }
            return false;
        }

        function resetAllInputs(fromSceneChange = false) {
            resetJoystick();
            if (fromSceneChange === true) {
                Object.keys(keysPressed).forEach(k => {
                    if (keysPressed[k]) suppressedKeysUntilRelease.add(k);
                });
                try {
                    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
                    for (const gp of gps) {
                        if (isGamepadDirectionalActive(gp)) {
                            gamepadMoveLockUntilNeutral = true;
                            break;
                        }
                    }
                } catch (e) {}
            } else {
                suppressedKeysUntilRelease.clear();
                gamepadMoveLockUntilNeutral = false;
            }
            Object.keys(keysPressed).forEach(k => { keysPressed[k] = false; });
            Object.keys(actionsPressed).forEach(k => {
                actionsPressed[k] = (k === 'moveHorizontalIntensity' || k === 'moveVerticalIntensity') ? 0 : false;
            });
            frameKeyPresses = [];
            frameKeyReleases = [];
            frameCollisions = [];
            frameClicks = [];
            frameInteractions = [];
            frameTimerEvents = [];
            frameAttacks = [];
            frameObjectReleases = [];
            frameButtonDown = [];
            frameButtonUp = [];
            frameTriggerDown = [];
            frameTriggerUp = [];
            frameDialogueEnd = false;
            playerPressStates = {};
            buttonState = {};
            pointerDownObject = null;
            dragging = null;
            activeDrag3D = null;
        }

        const parseCharacterImageMapping = (mappingStr) => {
            const map = {};
            if (!mappingStr) return map;
            const lines = mappingStr.split(/[\\n,]/);
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

        const getActivePlayerNumber = () => { return 1; };

        const getPlayerActions = (pNum) => {
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
            act.moveLeft = actionsPressed.moveLeft || keysPressed['keya'] || keysPressed['arrowleft'];
            act.moveRight = actionsPressed.moveRight || keysPressed['keyd'] || keysPressed['arrowright'];
            act.moveUp = actionsPressed.moveUp || keysPressed['keyw'] || keysPressed['arrowup'];
            act.moveDown = actionsPressed.moveDown || keysPressed['keys'] || keysPressed['arrowdown'];
            act.jump = actionsPressed.jump || keysPressed['space'];
            act.jumpAction = actionsPressed.jumpAction;
            act.attack = actionsPressed.attack || keysPressed['keyx'] || keysPressed['keyf'];
            act.attackAction = actionsPressed.attackAction;
            act.run = actionsPressed.run || keysPressed['shift'] || keysPressed['shiftleft'];
            act.moveHorizontalIntensity = actionsPressed.moveHorizontalIntensity;

            if (act.moveHorizontalIntensity === 0) {
                if (keysPressed['arrowleft'] || keysPressed['keya']) act.moveHorizontalIntensity -= 1;
                if (keysPressed['arrowright'] || keysPressed['keyd']) act.moveHorizontalIntensity += 1;
            }
        }

        if (!playerPressStates) playerPressStates = {};
        if (!playerPressStates[pNum]) playerPressStates[pNum] = { jumpPressed: false, attackPressed: false };
        
        const state = playerPressStates[pNum];
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

        const spawnFloatingFeedback = (obj, val, label) => {
            const numVal = Number(val);
            if (isNaN(numVal) || numVal === 0) return;
            
            let displayX = (window.projectData?.gameWidth || 1024) / 2;
            let displayY = (window.projectData?.gameHeight || 768) / 2;
            if (obj && typeof obj.x === 'number') {
                displayX = obj.x + (obj.width || 0) / 2;
                displayY = obj.y - 10;
            }
            
            const isNegative = numVal < 0;
            const text = isNegative ? (String(numVal) + (label ? ' ' + label.toUpperCase() : '')) : ('+' + numVal + (label ? ' ' + label.toUpperCase() : ''));
            const color = isNegative ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';
            
            floatingFeedbacks.push({
                x: displayX,
                y: displayY,
                vx: (Math.random() - 0.5) * 20,
                vy: -60,
                text: text,
                color: color,
                opacity: 1.0,
                lifetime: 1.2
            });
        };

        const getObjectAbsolutePosition = (objectId, objectsById) => {
            let currentId = objectId;
            let absX = 0;
            let absY = 0;
            let currentRotation = 0;
            let safety = 100;
            const path = [];
            
            while(currentId && safety-- > 0) {
                const obj = objectsById.get(currentId);
                if (!obj) break;
                path.unshift(obj);
                currentId = obj.parentId;
            }
            
            for (const obj of path) {
                // Apply current rotation to this object's position
                const rad = currentRotation * Math.PI / 180;
                const rotatedX = obj.x * Math.cos(rad) - obj.y * Math.sin(rad);
                const rotatedY = obj.x * Math.sin(rad) + obj.y * Math.cos(rad);
                
                absX += rotatedX;
                absY += rotatedY;
                
                currentRotation += (obj.rotation || 0) + (obj.animRotation || 0);
            }
            return { x: absX, y: absY, rotation: currentRotation };
        };

        const isObjectUI = (obj, objectsById) => {
            let curr = obj;
            let safety = 100;
            while (curr && safety-- > 0) {
                if (curr.isUI) return true;
                if (!curr.parentId) break;
                curr = objectsById.get(curr.parentId);
            }
            return false;
        };

        let _exportIdCounter = 1;
        const nextExportUniqueId = () => {
            _exportIdCounter = (_exportIdCounter + 1) % 1000;
            return Date.now() * 1000 + _exportIdCounter;
        };

        const wouldCreateParentCycleExport = (childId, newParentId, objectsById) => {
            if (newParentId === null || newParentId === undefined) return false;
            if (newParentId === childId) return true;
            let currId = newParentId;
            let safety = 100;
            while (currId && safety-- > 0) {
                if (currId === childId) return true;
                currId = objectsById.get(currId)?.parentId;
            }
            return false;
        };

        const composeEulerXYZMat34Runtime = (px, py, pz, rx, ry, rz) => {
            const cx = Math.cos(rx), sx = Math.sin(rx);
            const cy = Math.cos(ry), sy = Math.sin(ry);
            const cz = Math.cos(rz), sz = Math.sin(rz);
            return [
                cy * cz, -cy * sz, sy, px,
                cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy, py,
                sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy, pz
            ];
        };

        const mulMat34Runtime = (a, b) => [
            a[0] * b[0] + a[1] * b[4] + a[2] * b[8],
            a[0] * b[1] + a[1] * b[5] + a[2] * b[9],
            a[0] * b[2] + a[1] * b[6] + a[2] * b[10],
            a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3],
            a[4] * b[0] + a[5] * b[4] + a[6] * b[8],
            a[4] * b[1] + a[5] * b[5] + a[6] * b[9],
            a[4] * b[2] + a[5] * b[6] + a[6] * b[10],
            a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7],
            a[8] * b[0] + a[9] * b[4] + a[10] * b[8],
            a[8] * b[1] + a[9] * b[5] + a[10] * b[9],
            a[8] * b[2] + a[9] * b[6] + a[10] * b[10],
            a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11]
        ];

        const invertRigidMat34Runtime = (m) => {
            const r00 = m[0], r01 = m[4], r02 = m[8];
            const r10 = m[1], r11 = m[5], r12 = m[9];
            const r20 = m[2], r21 = m[6], r22 = m[10];
            const tx = m[3], ty = m[7], tz = m[11];
            return [
                r00, r01, r02, -(r00 * tx + r01 * ty + r02 * tz),
                r10, r11, r12, -(r10 * tx + r11 * ty + r12 * tz),
                r20, r21, r22, -(r20 * tx + r21 * ty + r22 * tz)
            ];
        };

        const extractEulerXYZRuntime = (m) => {
            const m11 = m[0], m12 = m[1], m13 = m[2];
            const m22 = m[5], m23 = m[6];
            const m32 = m[9], m33 = m[10];
            const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
            let ex = 0, ez = 0;
            if (Math.abs(m13) < 0.9999999) {
                ex = Math.atan2(-m23, m33);
                ez = Math.atan2(-m12, m11);
            } else {
                ex = Math.atan2(m32, m22);
                ez = 0;
            }
            return { x: ex, y: ey, z: ez };
        };

        const getObjPos3DFallback = (obj) => {
            if (typeof getObject3DPosition === 'function') return getObject3DPosition(obj);
            if (obj.position3D) return { x: Number(obj.position3D.x || 0), y: Number(obj.position3D.y || 0), z: Number(obj.position3D.z || 0) };
            const cx = (obj.x || 0) + (obj.width || 50) / 2;
            const cy = (obj.y || 0) + (obj.height || 50) / 2;
            return { x: cx / 50, y: 0, z: cy / 50 };
        };

        const getObjRot3DFallback = (obj) => {
            if (typeof getObject3DRotation === 'function') return getObject3DRotation(obj);
            if (obj.rotation3D) return { x: Number(obj.rotation3D.x || 0), y: Number(obj.rotation3D.y || 0), z: Number(obj.rotation3D.z || 0) };
            return { x: 0, y: -((obj.rotation || 0) * Math.PI) / 180, z: 0 };
        };

        const getWorldMatrix34Runtime = (obj, objectsById) => {
            const chain = [];
            const visited = new Set();
            let curr = obj;
            let safety = 64;
            while (curr && safety-- > 0 && !visited.has(curr.id)) {
                visited.add(curr.id);
                chain.push(curr);
                if (!curr.parentId || curr.isUI) break;
                curr = objectsById.get(curr.parentId);
            }
            let acc = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
            for (let i = chain.length - 1; i >= 0; i--) {
                const lp = getObjPos3DFallback(chain[i]);
                const lr = getObjRot3DFallback(chain[i]);
                acc = mulMat34Runtime(acc, composeEulerXYZMat34Runtime(lp.x, lp.y, lp.z, lr.x, lr.y, lr.z));
            }
            return acc;
        };

        const getWorldTransform3DRuntime = (obj, objectsById) => {
            if (!obj) return { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
            if (!obj.parentId || obj.isUI || !objectsById) {
                return { pos: getObjPos3DFallback(obj), rot: getObjRot3DFallback(obj) };
            }
            const m = getWorldMatrix34Runtime(obj, objectsById);
            return {
                pos: { x: m[3], y: m[7], z: m[11] },
                rot: extractEulerXYZRuntime(m)
            };
        };

        const reparentGameObjectExport = (childId, newParentId, list) => {
            const byId = new Map(list.map(o => [o.id, o]));
            const child = byId.get(childId);
            if (!child) return null;
            const targetParentId = newParentId ?? null;
            if (targetParentId !== null) {
                if (!byId.has(targetParentId)) return null;
                if (wouldCreateParentCycleExport(childId, targetParentId, byId)) return null;
            }
            const childAbs2D = getObjectAbsolutePosition(childId, byId);
            let nextX = childAbs2D.x;
            let nextY = childAbs2D.y;
            if (targetParentId !== null) {
                const parentAbs2D = getObjectAbsolutePosition(targetParentId, byId);
                nextX = childAbs2D.x - parentAbs2D.x;
                nextY = childAbs2D.y - parentAbs2D.y;
            }
            const childWorld3D = getWorldTransform3DRuntime(child, byId);
            let nextPos3D = { x: Number(childWorld3D.pos.x.toFixed(3)), y: Number(childWorld3D.pos.y.toFixed(3)), z: Number(childWorld3D.pos.z.toFixed(3)) };
            let nextRot3D = { x: Number(childWorld3D.rot.x.toFixed(4)), y: Number(childWorld3D.rot.y.toFixed(4)), z: Number(childWorld3D.rot.z.toFixed(4)) };
            if (targetParentId !== null) {
                const parentObj = byId.get(targetParentId);
                const childM = composeEulerXYZMat34Runtime(childWorld3D.pos.x, childWorld3D.pos.y, childWorld3D.pos.z, childWorld3D.rot.x, childWorld3D.rot.y, childWorld3D.rot.z);
                const parentM = getWorldMatrix34Runtime(parentObj, byId);
                const localM = mulMat34Runtime(invertRigidMat34Runtime(parentM), childM);
                const localRot = extractEulerXYZRuntime(localM);
                nextPos3D = { x: Number(localM[3].toFixed(3)), y: Number(localM[7].toFixed(3)), z: Number(localM[11].toFixed(3)) };
                nextRot3D = { x: Number(localRot.x.toFixed(4)), y: Number(localRot.y.toFixed(4)), z: Number(localRot.z.toFixed(4)) };
            }
            return {
                parentId: targetParentId,
                x: Math.round(nextX),
                y: Math.round(nextY),
                position3D: nextPos3D,
                rotation3D: nextRot3D,
                rotation: Math.round((-nextRot3D.y * 180) / Math.PI)
            };
        };

        const stripTransientRuntimeProps = (obj) => {
            const cloned = JSON.parse(JSON.stringify(obj));
            Object.keys(cloned).forEach(k => {
                if (k.startsWith('_') && k !== '_globalChildren' && k !== '_originalBehaviors') {
                    delete cloned[k];
                }
            });
            return cloned;
        };

        const instantiateGlobalObjectExport = (template, overrides, sync3dFlag) => {
            const rootClone = stripTransientRuntimeProps(template);
            const storedChildren = Array.isArray(rootClone._globalChildren)
                ? rootClone._globalChildren.map(c => stripTransientRuntimeProps(c))
                : [];
            delete rootClone._globalChildren;

            const newRootId = nextExportUniqueId();
            rootClone.id = newRootId;
            rootClone.parentId = overrides && overrides.parentId !== undefined ? overrides.parentId : null;
            rootClone.vx = 0; rootClone.vy = 0;
            rootClone.vx3D = 0; rootClone.vy3D = 0; rootClone.vz3D = 0;
            rootClone.grounded = false; rootClone.grounded3D = false;

            if (overrides && typeof overrides.x === 'number') rootClone.x = overrides.x;
            if (overrides && typeof overrides.y === 'number') rootClone.y = overrides.y;
            if (overrides && overrides.position3D) {
                rootClone.position3D = { ...overrides.position3D };
            } else if (rootClone.position3D) {
                rootClone.position3D = { ...rootClone.position3D };
            }
            if (sync3dFlag && typeof sync3DTo2D === 'function') sync3DTo2D(rootClone);

            const allObjects = [rootClone];
            if (storedChildren.length > 0) {
                const idMap = new Map();
                idMap.set(template.id, newRootId);
                storedChildren.forEach(ch => idMap.set(ch.id, nextExportUniqueId()));
                storedChildren.forEach(ch => {
                    const mappedId = idMap.get(ch.id) || nextExportUniqueId();
                    const mappedParentId = (ch.parentId !== null && ch.parentId !== undefined && idMap.has(ch.parentId))
                        ? idMap.get(ch.parentId)
                        : newRootId;
                    const childObj = {
                        ...ch,
                        id: mappedId,
                        parentId: mappedParentId,
                        vx: 0, vy: 0,
                        vx3D: 0, vy3D: 0, vz3D: 0,
                        grounded: false, grounded3D: false
                    };
                    if (sync3dFlag && typeof sync3DTo2D === 'function') sync3DTo2D(childObj);
                    allObjects.push(childObj);
                });
            }
            return { root: rootClone, allObjects };
        };

        const getCollisionBox = (objWithAbsPos) => {
            const scaleX = Math.abs((objWithAbsPos.scaleX ?? 1) * (objWithAbsPos.animScaleX ?? 1));
            const scaleY = Math.abs((objWithAbsPos.scaleY ?? 1) * (objWithAbsPos.animScaleY ?? 1));
            
            const offsetX = objWithAbsPos.animOffsetX ?? 0;
            const offsetY = objWithAbsPos.animOffsetY ?? 0;
            const rotDeg = objWithAbsPos.absRotation !== undefined
                ? objWithAbsPos.absRotation
                : ((objWithAbsPos.rotation || 0) + (objWithAbsPos.animRotation || 0));
            const rotation = rotDeg * Math.PI / 180;

            const baseObjX = objWithAbsPos.absX !== undefined ? objWithAbsPos.absX : objWithAbsPos.x;
            const baseObjY = objWithAbsPos.absY !== undefined ? objWithAbsPos.absY : objWithAbsPos.y;

            let w = objWithAbsPos.width * scaleX;
            let h = objWithAbsPos.height * scaleY;
            let cx = baseObjX + offsetX + objWithAbsPos.width / 2;
            let cy = baseObjY + offsetY + objWithAbsPos.height / 2;

            if (objWithAbsPos.useCustomCollision && objWithAbsPos.collision) {
                w = objWithAbsPos.collision.width * scaleX;
                h = objWithAbsPos.collision.height * scaleY;
                cx = baseObjX + offsetX + objWithAbsPos.width / 2 + (objWithAbsPos.collision.offsetX + objWithAbsPos.collision.width / 2 - objWithAbsPos.width / 2) * scaleX;
                cy = baseObjY + offsetY + objWithAbsPos.height / 2 + (objWithAbsPos.collision.offsetY + objWithAbsPos.collision.height / 2 - objWithAbsPos.height / 2) * scaleY;
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
                    rotRad: 0
                };
            }

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
                rotRad: rotation
            };
        };

        const getCollisionMTV2D = (b1, b2) => {
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
            const c1x = b1.cx !== undefined ? b1.cx : (b1.x + b1.width / 2);
            const c1y = b1.cy !== undefined ? b1.cy : (b1.y + b1.height / 2);
            const c2x = b2.cx !== undefined ? b2.cx : (b2.x + b2.width / 2);
            const c2y = b2.cy !== undefined ? b2.cy : (b2.y + b2.height / 2);
            const hw1 = b1.halfW !== undefined ? b1.halfW : (b1.width / 2);
            const hh1 = b1.halfH !== undefined ? b1.halfH : (b1.height / 2);
            const hw2 = b2.halfW !== undefined ? b2.halfW : (b2.width / 2);
            const hh2 = b2.halfH !== undefined ? b2.halfH : (b2.height / 2);

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
            const axes = [
                [u1x, u1y],
                [v1x, v1y],
                [u2x, u2y],
                [v2x, v2y]
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

            if (!isFinite(minOverlap)) return null;
            return { x: bestX * minOverlap, y: bestY * minOverlap, depth: minOverlap };
        };

        const getRotatedSurfaceY = (playerX, playerWidth, solid) => {
            const rotDeg = solid.absRotation !== undefined ? solid.absRotation : (solid.rotation || 0);
            const mod90 = Math.abs(rotDeg % 90);
            if (mod90 < 0.5 || Math.abs(mod90 - 90) < 0.5) {
                return null;
            }

            const box = getCollisionBox({
                ...solid,
                x: solid.absX !== undefined ? solid.absX : solid.x,
                y: solid.absY !== undefined ? solid.absY : solid.y
            });
            const cos = Math.cos(box.rotRad);
            const sin = Math.sin(box.rotRad);
            const ux = cos, uy = sin;
            const vx = -sin, vy = cos;

            const candidates = [
                [-vx, -vy, box.halfH, ux, uy, box.halfW],
                [vx, vy, box.halfH, ux, uy, box.halfW],
                [ux, uy, box.halfW, vx, vy, box.halfH],
                [-ux, -uy, box.halfW, vx, vy, box.halfH]
            ];

            let topEdge = candidates[0];
            for (let i = 1; i < candidates.length; i++) {
                if (candidates[i][1] < topEdge[1]) {
                    topEdge = candidates[i];
                }
            }
            const nx = topEdge[0], ny = topEdge[1], dF = topEdge[2];
            const tx = topEdge[3], ty = topEdge[4], hT = topEdge[5];

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

            let highestSurfaceY = null;
            for (let si = 0; si < sampleXs.length; si++) {
                const sx = sampleXs[si];
                const sy = my - ((sx - mx) * nx) / ny;
                if (isFinite(sy) && (highestSurfaceY === null || sy < highestSurfaceY)) {
                    highestSurfaceY = sy;
                }
            }
            return highestSurfaceY;
        };

        const isColliding = (box1, box2) => {
            return getCollisionMTV2D(box1, box2) !== null;
        };
        
        const showDialogue = (text, onComplete) => {
            if (dialogueElement) dialogueElement.remove();
            dialogueElement = document.createElement('div');
            dialogueElement.style.position = 'fixed';
            dialogueElement.style.bottom = '10%';
            dialogueElement.style.left = '50%';
            dialogueElement.style.transform = 'translateX(-50%)';
            dialogueElement.style.width = '80%';
            dialogueElement.style.maxWidth = '600px';
            dialogueElement.style.padding = '1rem';
            dialogueElement.style.backgroundColor = 'rgba(0,0,0,0.8)';
            dialogueElement.style.color = 'white';
            dialogueElement.style.border = '2px solid #6366f1';
            dialogueElement.style.borderRadius = '8px';
            dialogueElement.style.cursor = 'pointer';
            dialogueElement.style.zIndex = '10000';
            dialogueElement.innerText = text;
            dialogueElement._onComplete = onComplete;
            document.body.appendChild(dialogueElement);
            dialogueElement.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const cb = dialogueElement ? dialogueElement._onComplete : null;
                if (dialogueElement) dialogueElement.remove();
                dialogueElement = null;
                frameDialogueEnd = true;
                if (typeof cb === 'function') cb();
            });
        };
        
        const executeActionSingle = (action, self, targetOverride, isContinuous = false, deltaTime = 0, forceRestart = false) => {
            let params = action.params;
            if (typeof params === 'string') {
                try {
                    params = JSON.parse(params);
                } catch (e) {}
            }

            let targetObj;
            if (targetOverride) {
                targetObj = gameObjects.find(o => o.id === targetOverride.id);
            } else if ((action.object === 'Self' || (self && action.object === self.name)) && self) {
                targetObj = gameObjects.find(o => o.id === self.id);
            } else {
                targetObj = gameObjects.find(o => o.name === action.object) || gameObjects.find(o => o.id === action.object);
            }

            const GLOBAL_ACTIONS = new Set([
                'SetVariable', 'SetBooleanVariable', 'ToggleBooleanVariable', 'AddToVariable',
                'GoToScene', 'ChangeScene', 'SetSceneUnlocked', 'PlayMusic', 'StopMusic', 'PlaySound',
                'SaveGame', 'LoadGame', 'SetCameraZoom', 'StartTimer', 'StopTimer',
                'SetPlayerSkin', 'CreatePlayers', 'DisconnectPlayers', 'SetJoystickEnabled',
                'SetCamera3DMode', 'SetCamera3DOffset', 'SetCamera3DMovement', 'CreateObject3D', 'SetFog3D', 'SetSkybox3D', 'SetBackgroundColor',
                'ConsoleLog', 'ShowDialogue', 'SetQuestState'
            ]);
            if (!targetObj && action.object && action.object !== 'System' && action.object !== 'Camera' && !GLOBAL_ACTIONS.has(action.action)) return;

            switch (action.action) {
                case 'SetVisible':
                    if (targetObj) targetObj.visible = params?.visible !== false && params?.visible !== 'false';
                    break;
                case 'SetOpacity':
                    if (targetObj) targetObj.opacity = Number(params?.opacity ?? 1);
                    break;
                case 'SetZIndex':
                    if (targetObj) targetObj.zIndex = Number(params?.zIndex ?? 0);
                    break;
                case 'SetFlipX':
                    if (targetObj) targetObj.direction = (params?.flip === true || params?.flip === 'true') ? 'left' : 'right';
                    break;
                case 'SetFlipY':
                    if (targetObj) targetObj.flipY = (params?.flip === true || params?.flip === 'true');
                    break;
                case 'Destroy':
                    if (targetObj) {
                        const idsToDestroy = new Set([targetObj.id]);
                        let added = true;
                        while (added) {
                            added = false;
                            gameObjects.forEach(o => {
                                if (o.parentId && idsToDestroy.has(o.parentId) && !idsToDestroy.has(o.id)) {
                                    idsToDestroy.add(o.id);
                                    added = true;
                                }
                            });
                        }
                        gameObjects = gameObjects.filter(o => !idsToDestroy.has(o.id));
                    }
                    break;
                case 'SetVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (varName) {
                        gameVariables[varName] = normalizeVariableInputValue(params.value);
                    }
                    break;
                }
                case 'SetBooleanVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (varName) {
                        gameVariables[varName] = (params.valueBoolean === true || params.valueBoolean === 'true');
                    }
                    break;
                }
                case 'ToggleBooleanVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (varName) {
                        const cur = gameVariables[varName];
                        const curBool = cur === 'false' ? false : (cur === 'true' ? true : !!cur);
                        gameVariables[varName] = !curBool;
                    }
                    break;
                }
                case 'SetObjectPosition':
                    if (targetObj && params) {
                        if (params.x != null && params.x !== '') targetObj.x = Number(params.x);
                        if (params.y != null && params.y !== '') targetObj.y = Number(params.y);
                        if (isCurrentScene3D) {
                            const pSet2D = getObject3DPosition(targetObj);
                            if (params.x != null && params.x !== '') pSet2D.x = (Number(params.x) + (targetObj.width || 50) / 2) / 50;
                            if (params.y != null && params.y !== '') pSet2D.z = (Number(params.y) + (targetObj.height || 50) / 2) / 50;
                            targetObj.position3D = pSet2D;
                            targetObj._moved3DThisFrame = true;
                            targetObj._mutatedBy3DAction = true;
                            sync3DTo2D(targetObj);
                        }
                    }
                    break;
                case 'TeleportToObject':
                    if (targetObj && params?.targetObjectName) {
                        const targetToTeleport = gameObjects.find(o => o.name === params.targetObjectName);
                        if (targetToTeleport) {
                            targetObj.x = targetToTeleport.x;
                            targetObj.y = targetToTeleport.y;
                            if (isCurrentScene3D) {
                                const pTel = getObject3DPosition(targetToTeleport);
                                targetObj.position3D = { x: pTel.x, y: pTel.y, z: pTel.z };
                                targetObj._moved3DThisFrame = true;
                                targetObj._mutatedBy3DAction = true;
                                sync3DTo2D(targetObj);
                            }
                        }
                    }
                    break;
                case 'SetParent':
                    if (targetObj) {
                        if (!params?.parentName) {
                            const updates = reparentGameObjectExport(targetObj.id, null, gameObjects);
                            if (updates) {
                                targetObj.parentId = null;
                                targetObj.x = updates.x;
                                targetObj.y = updates.y;
                                if (isCurrentScene3D) {
                                    targetObj.position3D = updates.position3D;
                                    targetObj.rotation3D = updates.rotation3D;
                                    targetObj.rotation = updates.rotation;
                                    targetObj._moved3DThisFrame = true;
                                    targetObj._mutatedBy3DAction = true;
                                }
                            } else {
                                targetObj.parentId = null;
                            }
                        } else {
                            const parentObj = gameObjects.find(o => o.name === params.parentName);
                            if (parentObj && parentObj.id !== targetObj.id) {
                                const updates = reparentGameObjectExport(targetObj.id, parentObj.id, gameObjects);
                                if (updates) {
                                    targetObj.parentId = parentObj.id;
                                    targetObj.x = updates.x;
                                    targetObj.y = updates.y;
                                    if (isCurrentScene3D) {
                                        targetObj.position3D = updates.position3D;
                                        targetObj.rotation3D = updates.rotation3D;
                                        targetObj.rotation = updates.rotation;
                                        targetObj._moved3DThisFrame = true;
                                        targetObj._mutatedBy3DAction = true;
                                    }
                                }
                            }
                        }
                    }
                    break;
                case 'AddToVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (varName) {
                        const currentRaw = gameVariables[varName];
                        const parsedCurrent = (currentRaw === undefined || currentRaw === null || currentRaw === '') ? 0 : (parseNumericValue(currentRaw) ?? 0);
                        const toAdd = parseNumericValue(params?.value ?? 0) ?? 0;
                        const result = roundCleanNumber(parsedCurrent + toAdd);
                        gameVariables[varName] = result;
                        spawnFloatingFeedback(targetObj || self, toAdd, varName);
                    }
                    break;
                }
                case 'SetObjectVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
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
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (targetObj && varName) {
                        if (!targetObj.variables) targetObj.variables = [];
                        const v = targetObj.variables.find(v => v.name === varName);
                        const objBoolVal = (params.valueBoolean === true || params.valueBoolean === 'true');
                        if (v) v.value = objBoolVal;
                        else targetObj.variables.push({ name: varName, value: objBoolVal });
                    }
                    break;
                }
                case 'ToggleObjectBooleanVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (targetObj && varName) {
                        if (!targetObj.variables) targetObj.variables = [];
                        const v = targetObj.variables.find(v => v.name === varName);
                        if (v) {
                            const curBool = v.value === 'false' ? false : (v.value === 'true' ? true : !!v.value);
                            v.value = !curBool;
                        } else {
                            targetObj.variables.push({ name: varName, value: true });
                        }
                    }
                    break;
                }
                case 'AddToObjectVariable': {
                    const varName = params?.variable ? String(params.variable).trim() : '';
                    if (targetObj && varName) {
                        if (!targetObj.variables) targetObj.variables = [];
                        const v = targetObj.variables.find(v => v.name === varName);
                        const currentVal = v ? (parseNumericValue(v.value) ?? 0) : 0;
                        const toAdd = parseNumericValue(params?.value ?? 0) ?? 0;
                        const result = roundCleanNumber(currentVal + toAdd);
                        if (v) v.value = result;
                        else targetObj.variables.push({ name: varName, value: result });
                        spawnFloatingFeedback(targetObj, toAdd, varName);
                    }
                    break;
                }
                case 'GoToScene':
                case 'ChangeScene':
                    if (params?.sceneName) {
                        sceneChangeRequested = true;
                        loadSceneByName(params.sceneName);
                    }
                    break;
                case 'SetSceneUnlocked':
                    if (params?.sceneName) {
                        const unlocked = params.valueBoolean !== false && params.valueBoolean !== 'false';
                        gameVariables['scene_unlocked_' + params.sceneName] = unlocked;
                    }
                    break;
                case 'CreateMatch':
                    frameMatchFound = true;
                    framePlayerJoined = true;
                    break;
                case 'JoinMatch':
                    frameMatchFound = true;
                    framePlayerJoined = true;
                    break;
                case 'SendNetworkMessage':
                    frameReceiveNetworkMessage = true;
                    if (params?.message) {
                        frameNetworkMessages.push(String(params.message));
                        if (socket && typeof socket.emit === 'function') {
                            socket.emit('network-message', { roomId: currentScene?.name || 'default-room', message: String(params.message) });
                        }
                    }
                    break;
                case 'SetPlayerName':
                    if (targetObj) {
                        targetObj.name = params?.name || params?.value || 'Jugador';
                    }
                    break;
                case 'PlayAnimation':
                    if (targetObj && params?.animationId) {
                        targetObj._scriptAnimTime = performance.now();
                        const animId = String(params.animationId);
                        const objAnims = [...animations, ...(targetObj.animations || [])];
                        const anim = objAnims.find(a => String(a.id) === animId || a.name === animId);
                        if (anim && anim.frames && anim.frames.length > 0) {
                            const currentAnim = activeAnimations.get(targetObj.id);
                            const isOneShotProtected = currentAnim && (currentAnim.isOneShotProtected !== undefined
                                ? currentAnim.isOneShotProtected
                                : (currentAnim.animation.loop === false && !currentAnim.startedContinuous));
                            const transitioningOutOfAirJump = Boolean(
                                currentAnim && currentAnim.startedWhileRising &&
                                (targetObj.grounded || targetObj.grounded3D || (targetObj.vy || 0) > 0.5 || (targetObj.vy3D || 0) < -0.05)
                            );
                            let stillPlaying = false;
                            if (isOneShotProtected && !transitioningOutOfAirJump) {
                                const totalDuration = currentAnim.animation.frames.reduce((sum, f) => sum + Math.max(20, Number(f?.duration) || 100), 0);
                                const elapsed = performance.now() - currentAnim.startTime;
                                if (elapsed < totalDuration) {
                                    stillPlaying = true;
                                }
                            }
                            if (forceRestart || !currentAnim || (String(currentAnim.animation.id) !== String(anim.id) && !stillPlaying)) {
                                const clonedAnim = { ...anim, frames: anim.frames.map(f => ({ ...f })) };
                                activeAnimations.set(targetObj.id, {
                                    animation: clonedAnim,
                                    startTime: performance.now(),
                                    startedContinuous: Boolean(isContinuous),
                                    isOneShotProtected: !isContinuous && clonedAnim.loop === false,
                                    startedWhileRising: Boolean(!targetObj.grounded && (targetObj.vy || 0) <= 0.5 && (targetObj.vy3D === undefined || targetObj.vy3D >= -0.05)),
                                    isAutoAnim: false,
                                });
                            }
                        } else {
                            const pAnimCompat = (poseAnimations || []).find(pa => String(pa.id) === animId || pa.name === animId);
                            const entry3DCompat = (typeof threeEngine !== 'undefined' && threeEngine && threeEngine.meshMap) ? threeEngine.meshMap.get(targetObj.id) : null;
                            if (pAnimCompat) {
                                const curP = activePoseAnimations.get(targetObj.id);
                                const shouldStartC = forceRestart || !curP || String(curP.poseAnimation.id) !== String(pAnimCompat.id) || (!isContinuous && curP.finished);
                                if (shouldStartC) {
                                    if (curP && String(curP.poseAnimation.id) !== String(pAnimCompat.id) && curP.origVisual) {
                                        targetObj.shape3D = curP.origVisual.shape3D;
                                        if (curP.origVisual.color !== undefined) targetObj.color = curP.origVisual.color;
                                        targetObj.emissive3D = curP.origVisual.emissive3D;
                                        targetObj.emissiveIntensity3D = curP.origVisual.emissiveIntensity3D;
                                        targetObj.modelUrl = curP.origVisual.modelUrl;
                                    }
                                    const origVisualC = (curP && curP.origVisual) || {
                                        shape3D: targetObj.shape3D,
                                        color: targetObj.color,
                                        emissive3D: targetObj.emissive3D,
                                        emissiveIntensity3D: targetObj.emissiveIntensity3D,
                                        modelUrl: targetObj.modelUrl
                                    };
                                    activePoseAnimations.set(targetObj.id, {
                                        poseAnimation: pAnimCompat,
                                        startTime: performance.now(),
                                        loop: pAnimCompat.loop !== false,
                                        speed: 1,
                                        isAutoPose: false,
                                        startedInAir: Boolean(!targetObj.grounded3D && !targetObj.grounded) || (targetObj.vy3D !== undefined && targetObj.vy3D > 0.05),
                                        origVisual: origVisualC
                                    });
                                    const firstClipCompat = pAnimCompat.frames && pAnimCompat.frames[0] && pAnimCompat.frames[0].modelAnimName;
                                    if (firstClipCompat) {
                                        const clipSpdC = Number((pAnimCompat.frames && pAnimCompat.frames[0] && pAnimCompat.frames[0].modelAnimSpeed) ?? 1) || 1;
                                        targetObj._runtimeAnim3D = { name: firstClipCompat, loop: pAnimCompat.loop !== false, speed: clipSpdC };
                                        if (entry3DCompat && entry3DCompat.group && entry3DCompat.group.userData && entry3DCompat.group.userData.playAnimation3D) {
                                            entry3DCompat.group.userData.playAnimation3D(firstClipCompat, pAnimCompat.loop !== false, clipSpdC);
                                        } else if (entry3DCompat && entry3DCompat.group) {
                                            entry3DCompat.group.userData.pendingAnimation3D = { name: firstClipCompat, loop: pAnimCompat.loop !== false, speed: clipSpdC };
                                        }
                                    } else if (targetObj.animation3D) {
                                        const defLoopC = targetObj.animation3DLoop !== false;
                                        const defSpdC = Number(targetObj.animation3DSpeed ?? 1) || 1;
                                        delete targetObj._runtimeAnim3D;
                                        if (entry3DCompat && entry3DCompat.group && entry3DCompat.group.userData && entry3DCompat.group.userData.playAnimation3D) {
                                            entry3DCompat.group.userData.playAnimation3D(targetObj.animation3D, defLoopC, defSpdC);
                                        }
                                    } else {
                                        delete targetObj._runtimeAnim3D;
                                        if (entry3DCompat && entry3DCompat.group) {
                                            delete entry3DCompat.group.userData.pendingAnimation3D;
                                            if (entry3DCompat.group.userData.stopAnimation3D) entry3DCompat.group.userData.stopAnimation3D();
                                        }
                                    }
                                }
                            } else if (animId) {
                                const clipLoopC = params?.loop !== false && params?.loop !== 'false';
                                const clipSpeedC = Number(params?.speed ?? 1) || 1;
                                targetObj._runtimeAnim3D = { name: animId, loop: clipLoopC, speed: clipSpeedC };
                                if (entry3DCompat && entry3DCompat.group && entry3DCompat.group.userData && entry3DCompat.group.userData.playAnimation3D) {
                                    if (forceRestart || !isContinuous || (entry3DCompat.group.userData.currentActionName || '').toLowerCase() !== animId.toLowerCase()) {
                                        entry3DCompat.group.userData.playAnimation3D(animId, clipLoopC, clipSpeedC);
                                    }
                                } else if (entry3DCompat && entry3DCompat.group) {
                                    entry3DCompat.group.userData.pendingAnimation3D = { name: animId, loop: clipLoopC, speed: clipSpeedC };
                                }
                            }
                        }
                    }
                    break;
                case 'PlayAnimation3D':
                    if (targetObj) {
                        targetObj._scriptAnimTime = performance.now();
                        const poseAnimId = String(params?.poseAnimationId || params?.animationId || params?.animationName || '');
                        const modelAnimName = String(params?.modelAnimName || '');
                        const loopParam = params?.loop3D !== undefined ? params.loop3D : params?.loop;
                        const speed3D = Math.max(0.05, Number(params?.speed ?? 1) || 1);
                        const entry3D = (typeof threeEngine !== 'undefined' && threeEngine && threeEngine.meshMap) ? threeEngine.meshMap.get(targetObj.id) : null;
                        const pAnim = poseAnimId ? (poseAnimations || []).find(pa => String(pa.id) === poseAnimId || pa.name === poseAnimId) : null;
                        if (pAnim) {
                            const resolvedLoop = (loopParam === 'true' || loopParam === true)
                                ? true
                                : (loopParam === 'false' || loopParam === false)
                                ? false
                                : (pAnim.loop !== false);
                            const currentPose = activePoseAnimations.get(targetObj.id);
                            const shouldStart = forceRestart || !currentPose || String(currentPose.poseAnimation.id) !== String(pAnim.id) || (!isContinuous && currentPose.finished);
                            if (shouldStart) {
                                if (currentPose && String(currentPose.poseAnimation.id) !== String(pAnim.id) && currentPose.origVisual) {
                                    targetObj.shape3D = currentPose.origVisual.shape3D;
                                    if (currentPose.origVisual.color !== undefined) targetObj.color = currentPose.origVisual.color;
                                    targetObj.emissive3D = currentPose.origVisual.emissive3D;
                                    targetObj.emissiveIntensity3D = currentPose.origVisual.emissiveIntensity3D;
                                    targetObj.modelUrl = currentPose.origVisual.modelUrl;
                                }
                                const origVisual = (currentPose && currentPose.origVisual) || {
                                    shape3D: targetObj.shape3D,
                                    color: targetObj.color,
                                    emissive3D: targetObj.emissive3D,
                                    emissiveIntensity3D: targetObj.emissiveIntensity3D,
                                    modelUrl: targetObj.modelUrl
                                };
                                activePoseAnimations.set(targetObj.id, {
                                    poseAnimation: pAnim,
                                    startTime: performance.now(),
                                    loop: resolvedLoop,
                                    speed: speed3D,
                                    isAutoPose: false,
                                    startedInAir: Boolean(!targetObj.grounded3D && !targetObj.grounded) || (targetObj.vy3D !== undefined && targetObj.vy3D > 0.05),
                                    origVisual
                                });
                                const firstClip = modelAnimName || (pAnim.frames && pAnim.frames[0] && pAnim.frames[0].modelAnimName);
                                if (firstClip) {
                                    const clipSpd = Number((pAnim.frames && pAnim.frames[0] && pAnim.frames[0].modelAnimSpeed) ?? speed3D) || speed3D;
                                    targetObj._runtimeAnim3D = { name: firstClip, loop: resolvedLoop, speed: clipSpd };
                                    if (entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {
                                        entry3D.group.userData.playAnimation3D(firstClip, resolvedLoop, clipSpd);
                                    } else if (entry3D && entry3D.group) {
                                        entry3D.group.userData.pendingAnimation3D = { name: firstClip, loop: resolvedLoop, speed: clipSpd };
                                    }
                                } else if (targetObj.animation3D) {
                                    const defLoop = targetObj.animation3DLoop !== false;
                                    const defSpd = Number(targetObj.animation3DSpeed ?? 1) || 1;
                                    delete targetObj._runtimeAnim3D;
                                    if (entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {
                                        entry3D.group.userData.playAnimation3D(targetObj.animation3D, defLoop, defSpd);
                                    }
                                } else {
                                    delete targetObj._runtimeAnim3D;
                                    if (entry3D && entry3D.group) {
                                        delete entry3D.group.userData.pendingAnimation3D;
                                        if (entry3D.group.userData.stopAnimation3D) entry3D.group.userData.stopAnimation3D();
                                    }
                                }
                            }
                        } else if (modelAnimName || poseAnimId) {
                            const prevPose = activePoseAnimations.get(targetObj.id);
                            if (prevPose) {
                                if (prevPose.origVisual) {
                                    targetObj.shape3D = prevPose.origVisual.shape3D;
                                    if (prevPose.origVisual.color !== undefined) targetObj.color = prevPose.origVisual.color;
                                    targetObj.emissive3D = prevPose.origVisual.emissive3D;
                                    targetObj.emissiveIntensity3D = prevPose.origVisual.emissiveIntensity3D;
                                    targetObj.modelUrl = prevPose.origVisual.modelUrl;
                                }
                                activePoseAnimations.delete(targetObj.id);
                                if (entry3D && entry3D.group) entry3D.group.scale.set(1, 1, 1);
                            }
                            const clipToPlay = modelAnimName || poseAnimId;
                            const resolvedLoop = !(loopParam === 'false' || loopParam === false);
                            targetObj._runtimeAnim3D = { name: clipToPlay, loop: resolvedLoop, speed: speed3D };
                            if (entry3D && entry3D.group && entry3D.group.userData && entry3D.group.userData.playAnimation3D) {
                                if (forceRestart || !isContinuous || (entry3D.group.userData.currentActionName || '').toLowerCase() !== clipToPlay.toLowerCase()) {
                                    entry3D.group.userData.playAnimation3D(clipToPlay, resolvedLoop, speed3D);
                                }
                            } else if (entry3D && entry3D.group) {
                                entry3D.group.userData.pendingAnimation3D = { name: clipToPlay, loop: resolvedLoop, speed: speed3D };
                            }
                        }
                    }
                    break;
                case 'StopAnimation3D':
                    if (targetObj) {
                        const curPoseStop = activePoseAnimations.get(targetObj.id);
                        if (curPoseStop && curPoseStop.origVisual) {
                            targetObj.shape3D = curPoseStop.origVisual.shape3D;
                            if (curPoseStop.origVisual.color !== undefined) targetObj.color = curPoseStop.origVisual.color;
                            targetObj.emissive3D = curPoseStop.origVisual.emissive3D;
                            targetObj.emissiveIntensity3D = curPoseStop.origVisual.emissiveIntensity3D;
                            targetObj.modelUrl = curPoseStop.origVisual.modelUrl;
                        }
                        activePoseAnimations.delete(targetObj.id);
                        delete targetObj._runtimeAnim3D;
                        const entry3DStop = (typeof threeEngine !== 'undefined' && threeEngine && threeEngine.meshMap) ? threeEngine.meshMap.get(targetObj.id) : null;
                        if (entry3DStop && entry3DStop.group) {
                            delete entry3DStop.group.userData.pendingAnimation3D;
                            entry3DStop.group.scale.set(1, 1, 1);
                            if (entry3DStop.group.userData && entry3DStop.group.userData.stopAnimation3D) {
                                entry3DStop.group.userData.stopAnimation3D();
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
                        } else if (isCurrentScene3D) {
                            const curP3 = getObject3DPosition(targetObj);
                            const step3 = speed / 50;
                            switch (direction) {
                                case 'right': curP3.x += step3; targetObj.direction = 'right'; break;
                                case 'left': curP3.x -= step3; targetObj.direction = 'left'; break;
                                case 'up': case 'forward': curP3.z -= step3; break;
                                case 'down': case 'backward': curP3.z += step3; break;
                            }
                            targetObj.position3D = curP3;
                            targetObj._moved3DThisFrame = true;
                            targetObj._mutatedBy3DAction = true;
                            sync3DTo2D(targetObj);
                        } else {
                            switch (direction) {
                                case 'right': targetObj.x += speed; targetObj.direction = 'right'; break;
                                case 'left': targetObj.x -= speed; targetObj.direction = 'left'; break;
                                case 'up': targetObj.y -= speed; break;
                                case 'down': targetObj.y += speed; break;
                            }
                        }
                    }
                    break;
                case 'MoveInDirection':
                    if (targetObj && params?.direction && params?.speed != null) {
                        const speed = Number(params.speed);
                        const direction = (params.direction || '').toLowerCase();
                        switch (direction) {
                            case 'right':
                                targetObj.vx = speed;
                                targetObj._customVx = speed;
                                targetObj.direction = 'right';
                                if (isCurrentScene3D) targetObj.vx3D = speed / 50;
                                break;
                            case 'left':
                                targetObj.vx = -speed;
                                targetObj._customVx = -speed;
                                targetObj.direction = 'left';
                                if (isCurrentScene3D) targetObj.vx3D = -speed / 50;
                                break;
                            case 'up':
                            case 'forward':
                                targetObj.vy = -speed;
                                targetObj._customVy = -speed;
                                if (isCurrentScene3D) targetObj.vz3D = -speed / 50;
                                break;
                            case 'down':
                            case 'backward':
                                targetObj.vy = speed;
                                targetObj._customVy = speed;
                                if (isCurrentScene3D) targetObj.vz3D = speed / 50;
                                break;
                        }
                    }
                    break;
                case 'FollowObject':
                    if (targetObj && params?.targetObjectName) {
                        targetObj.followTarget = String(params.targetObjectName);
                        targetObj.followSpeed = Number(params.speed || 100);
                    }
                    break;
                case 'RunAtSpeed':
                    if (targetObj) {
                        const runMode = String(params?.runMode || 'active');
                        const rawSpd = Number(params?.speed ?? (isCurrentScene3D ? 12 : 400));
                        if (runMode === 'stop' || !Number.isFinite(rawSpd) || rawSpd <= 0) {
                            targetObj._customRunSpeed = undefined;
                            targetObj._customRunActive = false;
                            targetObj._configuredSprintSpeed = undefined;
                            targetObj._autoRunSpeed = undefined;
                        } else if (runMode === 'onSprint') {
                            targetObj._configuredSprintSpeed = rawSpd;
                            targetObj._autoRunSpeed = undefined;
                        } else if (runMode === 'autoMove') {
                            targetObj._customRunSpeed = rawSpd;
                            targetObj._customRunActive = true;
                            targetObj._autoRunSpeed = rawSpd;
                        } else {
                            targetObj._customRunSpeed = rawSpd;
                            targetObj._customRunActive = true;
                            targetObj._autoRunSpeed = undefined;
                        }
                    }
                    break;
                case 'SetVelocityX':
                    if (targetObj && (params?.vx != null || params?.velocity != null)) {
                        const val = Number(params?.vx ?? params?.velocity);
                        targetObj.vx = val;
                        targetObj._customVx = val;
                        if (isCurrentScene3D) targetObj.vx3D = val / 50;
                        if (val > 0) targetObj.direction = 'right';
                        if (val < 0) targetObj.direction = 'left';
                    }
                    break;
                case 'SetVelocityY':
                    if (targetObj && (params?.vy != null || params?.velocity != null)) {
                        const val = Number(params?.vy ?? params?.velocity);
                        targetObj.vy = val;
                        targetObj._customVy = val;
                        if (isCurrentScene3D) targetObj.vy3D = -val / 50;
                        if (val < 0) {
                            targetObj.grounded = false;
                            targetObj.grounded3D = false;
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
                            axis: params.axis,
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
                        const deltaRot = isContinuous ? rotation * deltaTime : rotation;
                        targetObj.rotation = ((targetObj.rotation || 0) + deltaRot) % 360;
                        if (targetObj.rotation < 0) targetObj.rotation += 360;
                        if (isCurrentScene3D) {
                            const rObj = getObject3DRotation(targetObj);
                            rObj.y += (deltaRot * Math.PI) / 180;
                            targetObj.rotation3D = rObj;
                            targetObj._mutatedBy3DAction = true;
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
                        if (isCurrentScene3D) {
                            const dCur = getObject3DDimensions(targetObj);
                            targetObj.scale3D = isContinuous
                                ? { x: Math.max(0.05, dCur.w + (scaleX - 1) * deltaTime), y: Math.max(0.05, dCur.h + (scaleY - 1) * deltaTime), z: Math.max(0.05, dCur.d + (scaleX - 1) * deltaTime) }
                                : { x: Math.max(0.05, dCur.w * scaleX), y: Math.max(0.05, dCur.h * scaleY), z: Math.max(0.05, dCur.d * scaleX) };
                            targetObj._mutatedBy3DAction = true;
                        }
                    }
                    break;
                case 'SetScale':
                    if (targetObj && params?.scaleX != null && params?.scaleY != null) {
                        const sxVal = Math.max(0.01, Number(params.scaleX));
                        const syVal = Math.max(0.01, Number(params.scaleY));
                        targetObj.scaleX = sxVal;
                        targetObj.scaleY = syVal;
                        if (isCurrentScene3D) {
                            const dSetS = getObject3DDimensions(targetObj);
                            targetObj.scale3D = { x: Math.max(0.05, sxVal), y: Math.max(0.05, syVal), z: Math.max(0.05, dSetS.d) };
                            targetObj._mutatedBy3DAction = true;
                        }
                    }
                    break;
                case 'MoveTo':
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
                case 'RotateTo':
                    if (targetObj && params?.rotation != null) {
                        const duration = Number(params.duration || 1);
                        if (!targetObj.tweens) targetObj.tweens = [];
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
                        targetObj.isDraggable = params?.enabled !== false && params?.enabled !== 'false';
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
                    if (typeof showConsole === 'function') showConsole();
                    break;
                case 'CreateObject':
                    if (params?.templateObjectName) {
                        const templateName = params.templateObjectName;
                        const templateObj = allScenes.flatMap(s => s.gameObjects).find(o => o.name === templateName) || globalObjects.find(o => o.name === templateName) || gameObjects.find(o => o.name === templateName);
                        if (templateObj) {
                            let spawnX = Number(params.x) || 0;
                            let spawnY = Number(params.y) || 0;
                            let spawnPos3 = templateObj.position3D ? { ...templateObj.position3D } : { x: 0, y: 1, z: 0 };
                            if (params.positionType === 'relativeToObject' && params.relativeToObjectName) {
                                const relObj = gameObjects.find(o => o.name === params.relativeToObjectName);
                                if (relObj) {
                                    const objMapNow = new Map(gameObjects.map(o => [o.id, o]));
                                    const parentAbsPos = getObjectAbsolutePosition(relObj.id, objMapNow);
                                    spawnX = parentAbsPos.x + (Number(params.offsetX) || 0);
                                    spawnY = parentAbsPos.y + (Number(params.offsetY) || 0);
                                    const rp3 = getWorldTransform3DRuntime(relObj, objMapNow).pos;
                                    spawnPos3 = {
                                        x: rp3.x + (Number(params.offsetX) || 0) / 50,
                                        y: rp3.y,
                                        z: rp3.z + (Number(params.offsetY) || 0) / 50
                                    };
                                }
                            } else if (params.x !== undefined || params.y !== undefined) {
                                spawnPos3 = { x: spawnX / 50, y: spawnPos3.y, z: spawnY / 50 };
                            }
                            const spawned = instantiateGlobalObjectExport(templateObj, {
                                x: spawnX,
                                y: spawnY,
                                position3D: isCurrentScene3D ? spawnPos3 : templateObj.position3D,
                                parentId: null
                            }, isCurrentScene3D);
                            spawned.allObjects.forEach(o => gameObjects.push(o));
                        }
                    }
                    break;
                case 'GenerateObjectAt':
                    if (params?.templateObjectName && params?.targetObjectName) {
                        const templateName = params.templateObjectName;
                        const targetName = params.targetObjectName;
                        const templateObj = allScenes.flatMap(s => s.gameObjects).find(o => o.name === templateName) || globalObjects.find(o => o.name === templateName) || gameObjects.find(o => o.name === templateName);
                        const targetObjRef = gameObjects.find(o => o.name === targetName);
                        if (templateObj && targetObjRef) {
                            const objMapNow = new Map(gameObjects.map(o => [o.id, o]));
                            const targetAbsPos = getObjectAbsolutePosition(targetObjRef.id, objMapNow);
                            const tp3 = getWorldTransform3DRuntime(targetObjRef, objMapNow).pos;
                            const spawned = instantiateGlobalObjectExport(templateObj, {
                                x: targetAbsPos.x,
                                y: targetAbsPos.y,
                                position3D: isCurrentScene3D ? { x: tp3.x, y: tp3.y, z: tp3.z } : templateObj.position3D,
                                parentId: null
                            }, isCurrentScene3D);
                            spawned.allObjects.forEach(o => gameObjects.push(o));
                        }
                    }
                    break;
                case 'PlaySound':
                    if (params?.soundId) {
                        const soundAsset = (assets || []).find(a => String(a.id) === String(params.soundId) || a.url === params.soundId || a.name === params.soundId);
                        const soundUrl = soundAsset ? soundAsset.url : params.soundId;
                        if (soundUrl) {
                            let cachedAudio = audioCache.get(soundUrl);
                            if (!cachedAudio) {
                                cachedAudio = new Audio(soundUrl);
                                audioCache.set(soundUrl, cachedAudio);
                            }
                            if (cachedAudio) {
                                try {
                                    const clone = cachedAudio.cloneNode();
                                    clone.loop = params.loop === true || params.loop === 'true';
                                    if (typeof params.volume === 'number') {
                                        clone.volume = Math.max(0, Math.min(1, params.volume));
                                    }
                                    clone.play().catch(() => {});
                                } catch(e) {}
                            }
                        }
                    }
                    break;
                case 'SetBackgroundMusic':
                    if (params?.soundId) {
                        if (backgroundMusicPlayer) backgroundMusicPlayer.pause();
                        const musicAsset = (assets || []).find(a => String(a.id) === String(params.soundId) || a.url === params.soundId || a.name === params.soundId);
                        const musicUrl = musicAsset ? musicAsset.url : params.soundId;
                        if (musicUrl) {
                            let cachedAudio = audioCache.get(musicUrl);
                            if (!cachedAudio) {
                                cachedAudio = new Audio(musicUrl);
                                audioCache.set(musicUrl, cachedAudio);
                            }
                            if (cachedAudio) {
                                backgroundMusicPlayer = cachedAudio.cloneNode();
                                backgroundMusicPlayer.loop = params.loop !== false && params.loop !== 'false';
                                currentBackgroundMusicId = musicAsset ? musicAsset.id : params.soundId;
                                const playPromise = backgroundMusicPlayer.play();
                                if (playPromise && typeof playPromise.catch === 'function') {
                                    playPromise.catch((e) => {
                                        console.warn("Autoplay blocked background music. Registering gesture fallback...", e);
                                        const playOnGesture = () => {
                                            if (backgroundMusicPlayer) {
                                                backgroundMusicPlayer.play().catch(()=>{});
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
                    if (backgroundMusicPlayer) {
                        backgroundMusicPlayer.pause();
                        backgroundMusicPlayer.currentTime = 0;
                        currentBackgroundMusicId = null;
                    }
                    break;
                case 'PauseBackgroundMusic':
                    if (backgroundMusicPlayer) backgroundMusicPlayer.pause();
                    break;
                case 'ResumeBackgroundMusic':
                    if (backgroundMusicPlayer) backgroundMusicPlayer.play().catch(()=>{});
                    break;
                case 'SetBackgroundMusicVolume':
                    if (backgroundMusicPlayer && params?.volume != null) {
                        backgroundMusicPlayer.volume = Math.max(0, Math.min(100, Number(params.volume))) / 100;
                    }
                    break;
                case 'SetBackgroundColor':
                    if (params?.color) runtimeBackgroundColor = params.color;
                    break;
                case 'PlayVideo': {
                    const selectedAsset = (assets || []).find(a => String(a.id) === String(params?.videoAssetId) || a.url === params?.videoAssetId || a.name === params?.videoAssetId);
                    const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
                    if (url) {
                        let video = videoCache.get(url);
                        if (!video) {
                            video = document.createElement('video');
                            video.muted = targetObj?.videoMuted !== false;
                            video.playsInline = true;
                            video.setAttribute('webkit-playsinline', 'true');
                            video.loop = targetObj?.videoLoop !== false;
                            video.src = url;
                            video.load();
                            videoCache.set(url, video);
                        }
                        if (video) {
                            video.dataset.playState = 'playing';
                            video.play().catch(()=>{});
                        }
                        if (targetObj) targetObj.videoUrl = url;
                    }
                    break;
                }
                case 'PauseVideo': {
                    const selectedAsset = (assets || []).find(a => String(a.id) === String(params?.videoAssetId) || a.url === params?.videoAssetId || a.name === params?.videoAssetId);
                    const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
                    if (url) {
                        let video = videoCache.get(url);
                        if (!video) {
                            video = document.createElement('video');
                            video.muted = targetObj?.videoMuted !== false;
                            video.playsInline = true;
                            video.setAttribute('webkit-playsinline', 'true');
                            video.loop = targetObj?.videoLoop !== false;
                            video.src = url;
                            video.load();
                            videoCache.set(url, video);
                        }
                        if (video) {
                            video.dataset.playState = 'paused';
                            video.pause();
                        }
                    }
                    break;
                }
                case 'StopVideo': {
                    const selectedAsset = (assets || []).find(a => String(a.id) === String(params?.videoAssetId) || a.url === params?.videoAssetId || a.name === params?.videoAssetId);
                    const url = selectedAsset ? selectedAsset.url : targetObj?.videoUrl;
                    if (url) {
                        let video = videoCache.get(url);
                        if (!video) {
                            video = document.createElement('video');
                            video.muted = targetObj?.videoMuted !== false;
                            video.playsInline = true;
                            video.setAttribute('webkit-playsinline', 'true');
                            video.loop = targetObj?.videoLoop !== false;
                            video.src = url;
                            video.load();
                            videoCache.set(url, video);
                        }
                        if (video) {
                            video.dataset.playState = 'paused';
                            video.pause();
                            video.currentTime = 0;
                        }
                    }
                    break;
                }
                case 'ModifyStat':
                    if (targetObj?.stats && params?.stat && params?.operation && params?.value != null) {
                        const { stat, operation, value } = params;
                        const valNum = parseNumericValue(value);
                        if (valNum === null) break;
                        let currentVal = Number(targetObj.stats[stat] ?? 0);
                        
                        let diff = 0;
                        if (operation === 'add') diff = valNum;
                        else if (operation === 'subtract') diff = -valNum;
                        else if (operation === 'set') diff = valNum - currentVal;

                        if (operation === 'add') currentVal = roundCleanNumber(currentVal + valNum);
                        else if (operation === 'subtract') currentVal = roundCleanNumber(currentVal - valNum);
                        else if (operation === 'set') currentVal = roundCleanNumber(valNum);

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
                        if (isCurrentScene3D) {
                            const pTKb = getObject3DPosition(targetObj);
                            let dxKb = targetObj.direction === 'left' ? 1 : -1;
                            let dzKb = 0;
                            const srcKb = sourceName === 'Self' ? self : (sourceName ? gameObjects.find(o => o.name === sourceName) : null);
                            if (srcKb && srcKb.id !== targetObj.id) {
                                const pSKb = getObject3DPosition(srcKb);
                                dxKb = pTKb.x - pSKb.x;
                                dzKb = pTKb.z - pSKb.z;
                            }
                            const magKb = Math.hypot(dxKb, dzKb) || 1;
                            const f3Kb = force > 25 ? force / 45 : force;
                            targetObj.vx3D = (dxKb / magKb) * f3Kb;
                            targetObj.vz3D = (dzKb / magKb) * f3Kb;
                            targetObj.vy3D = Math.max(4, f3Kb * 0.6);
                            targetObj.grounded3D = false;
                            targetObj.grounded = false;
                        } else {
                            let angle = -Math.PI / 4;

                            if (sourceName === 'Self' && self && targetObj.id !== self.id) {
                                const dx = targetObj.x - self.x;
                                const dy = targetObj.y - self.y;
                                angle = Math.atan2(dy, dx);
                            } else if (sourceName && sourceName !== 'Self') {
                                const sourceObj = gameObjects.find(o => o.name === sourceName);
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
                case 'Attack':
                    if (targetObj) {
                        try {
                            if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
                                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                                if (ctx.state === 'suspended') ctx.resume();
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
                            }
                        } catch (e) {}

                        targetObj.attackEndTime = Date.now() + 150;

                        const damageVal = params?.damage !== undefined ? Number(params.damage) : 15;
                        const attackP3 = getObject3DPosition(targetObj);
                        const attackR3 = getObject3DRotation(targetObj);
                        const attackBox = {
                            id: Date.now() + Math.random(),
                            name: 'AttackBox',
                            x: targetObj.x + (targetObj.direction === 'left' ? -35 : targetObj.width + 5),
                            y: targetObj.y + (targetObj.height * 0.1),
                            width: 35,
                            height: targetObj.height * 0.8,
                            shape3D: 'box',
                            position3D: isCurrentScene3D ? { x: attackP3.x + Math.sin(attackR3.y) * 1.1, y: attackP3.y + 0.3, z: attackP3.z + Math.cos(attackR3.y) * 1.1 } : undefined,
                            scale3D: isCurrentScene3D ? { x: 1.0, y: 1.0, z: 1.0 } : undefined,
                            isProjectile: true,
                            projectileLifetime: 0.15,
                            behaviors: [],
                            color: '#ffffff',
                            opacity: 0.6,
                            zIndex: 10,
                            stats: { hp: 1, maxHp: 1, attack: damageVal }
                        };
                        gameObjects.push(attackBox);
                    }
                    break;
                case 'Shoot':
                    if (targetObj) {
                        try {
                            if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
                                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                                if (ctx.state === 'suspended') ctx.resume();
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
                            }
                        } catch (e) {}

                        targetObj.attackEndTime = Date.now() + 100;

                        const bSpeed = Number(params?.speed || 400);
                        const bDamage = Number(params?.damage || 15);
                        const bDir = targetObj.direction === 'left' ? -1 : 1;
                        const shP3 = getObject3DPosition(targetObj);
                        const shR3 = getObject3DRotation(targetObj);
                        const bSpeed3 = Math.max(4, bSpeed / 30);

                        const bulletBox = {
                            id: Date.now() + Math.random(),
                            name: 'Bullet',
                            x: targetObj.x + (bDir === -1 ? -15 : targetObj.width + 5),
                            y: targetObj.y + targetObj.height / 2 - 4,
                            width: 12,
                            height: 6,
                            shape3D: 'sphere',
                            position3D: isCurrentScene3D ? { x: shP3.x + Math.sin(shR3.y) * 0.9, y: shP3.y + 0.4, z: shP3.z + Math.cos(shR3.y) * 0.9 } : undefined,
                            scale3D: isCurrentScene3D ? { x: 0.35, y: 0.35, z: 0.35 } : undefined,
                            vx3D: isCurrentScene3D ? Math.sin(shR3.y) * bSpeed3 : undefined,
                            vz3D: isCurrentScene3D ? Math.cos(shR3.y) * bSpeed3 : undefined,
                            vy3D: 0,
                            isProjectile: true,
                            projectileLifetime: 3.0,
                            vx: bDir * bSpeed,
                            vy: 0,
                            color: params?.color || '#ffff00',
                            opacity: 0.9,
                            zIndex: 12,
                            stats: { hp: 1, maxHp: 1, attack: bDamage }
                        };
                        gameObjects.push(bulletBox);
                    }
                    break;
                case 'CreatePlayers':
                    {
                        const pCount = Math.max(2, Math.min(16, Number(params?.count || params?.value || 2)));
                        const mainPlayer = gameObjects.find(obj => 
                            obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement' || b.name === 'Player3D')
                        );
                        if (mainPlayer) {
                            const rootName = mainPlayer.name.split('_Player')[0];
                            const existingClones = gameObjects.filter(obj => 
                                obj.id !== mainPlayer.id && obj.name.startsWith(rootName + '_Player')
                            );
                            if (existingClones.length + 1 !== pCount) {
                                gameObjects = gameObjects.filter(obj => 
                                    obj.id === mainPlayer.id || !obj.name.startsWith(rootName + '_Player')
                                );
                                for (let i = 1; i < pCount; i++) {
                                    const clone = JSON.parse(JSON.stringify(mainPlayer));
                                    clone.id = Date.now() + Math.random() + i;
                                    clone.name = rootName + '_Player' + (i + 1);
                                    clone.x = mainPlayer.x + i * (mainPlayer.width + 12);
                                    if (isCurrentScene3D && clone.position3D) {
                                        clone.position3D.x += i * 1.5;
                                    }
                                    gameObjects.push(clone);
                                }
                            }
                        }
                    }
                    break;
                case 'DisconnectPlayers':
                    {
                        const mainPlayer = gameObjects.find(obj => 
                            obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement' || b.name === 'Player3D')
                        );
                        if (mainPlayer) {
                            const rootName = mainPlayer.name.split('_Player')[0];
                            gameObjects = gameObjects.filter(obj => 
                                obj.id === mainPlayer.id || !obj.name.startsWith(rootName + '_Player')
                            );
                            framePlayerLeft = true;
                        }
                    }
                    break;
                case 'ShowDialogue':
                    if (params?.dialogueText) {
                        const onCompActs = action.onCompleteActions;
                        showDialogue(params.dialogueText, () => {
                            if (Array.isArray(onCompActs) && onCompActs.length > 0) {
                                executeActionsSequential(onCompActs, self, false, 0, false, undefined, 'dialogue-complete-' + Date.now());
                            }
                        });
                    }
                    break;
                case 'SetQuestState':
                    if (params?.questId && params?.questState) gameVariables['quest_' + params.questId] = params.questState;
                    break;
                case 'ForceJump':
                    if (targetObj && params?.jumpForce != null) {
                        const jfNum = Number(params.jumpForce);
                        if (isCurrentScene3D) {
                            targetObj.vy3D = jfNum > 25 ? jfNum / 45 : jfNum;
                            targetObj.grounded3D = false;
                            targetObj.grounded = false;
                        } else if (targetObj.behaviors?.some(b => ['PlatformerCharacter', 'Physics'].includes(b.name))) {
                            targetObj.vy = -jfNum;
                            targetObj.grounded = false;
                        }
                    }
                    break;
                case 'TriggerAttack':
                    if (targetObj) {
                        frameAttacks.push({ name: targetObj.name, id: targetObj.id });
                    }
                    break;
                case 'SaveGame': {
                    const slot = String(params?.slot || '1').trim() || '1';
                    try {
                        const joyBase = document.getElementById('joystick-base');
                        const joystickEnabled = joyBase ? (joyBase.style.display !== 'none') : false;
                        const activePosesSerialized = (typeof activePoseAnimations !== 'undefined')
                            ? Array.from(activePoseAnimations.entries()).map(([id, p]) => ({
                                id,
                                poseAnimation: p.poseAnimation,
                                loop: p.loop,
                                speed: p.speed,
                                elapsedMs: performance.now() - (p.startTime || performance.now())
                            }))
                            : [];
                        const savedCam3D = (typeof camera3DRuntime !== 'undefined' && camera3DRuntime) ? {
                            mode: camera3DRuntime.mode,
                            offset: camera3DRuntime.offset,
                            targetObjectName: camera3DRuntime.targetObjectName,
                            fogEnabled: camera3DRuntime.fogEnabled,
                            fogColor: camera3DRuntime.fogColor,
                            fogDensity: camera3DRuntime.fogDensity,
                            ambientIntensity: camera3DRuntime.ambientIntensity,
                            sunIntensity: camera3DRuntime.sunIntensity,
                            sunColor: camera3DRuntime.sunColor,
                            skyboxImageUrl: camera3DRuntime.skyboxImageUrl || '',
                            movementEnabled: camera3DRuntime.movementEnabled !== false,
                            rightStickEnabled: camera3DRuntime.rightStickEnabled === true,
                            rightStickSensitivity: camera3DRuntime.rightStickSensitivity ?? 2.4,
                            yaw: camera3DRuntime.yaw,
                            pitch: camera3DRuntime.pitch,
                            fpPitch: camera3DRuntime.fpPitch,
                            distance: camera3DRuntime.distance
                        } : null;
                        const jsonStr = safeSerialize({
                            sceneName: currentScene?.name,
                            sceneId: currentScene?.id,
                            backgroundColor: runtimeBackgroundColor,
                            gameObjects,
                            gameVariables,
                            camera,
                            camera3DRuntime: savedCam3D,
                            selectedPlayerId,
                            joystickEnabled,
                            activePoseAnimations: activePosesSerialized
                        });
                        memorySaveSlots.set('return-2d-save-slot-' + slot, jsonStr);
                        try {
                            localStorage.setItem('return-2d-save-slot-' + slot, jsonStr);
                        } catch (lsErr) {
                            console.warn('LocalStorage save failed, using memory slot fallback:', lsErr);
                        }
                    } catch (e) { console.error('Error saving game:', e); }
                    break;
                }
                case 'LoadGame': {
                    const slot = String(params?.slot || '1').trim() || '1';
                    try {
                        let rawSaved = null;
                        try {
                            rawSaved = localStorage.getItem('return-2d-save-slot-' + slot);
                        } catch (lsErr) {
                            console.warn('LocalStorage read failed, checking memory slot:', lsErr);
                        }
                        if (!rawSaved && memorySaveSlots.has('return-2d-save-slot-' + slot)) {
                            rawSaved = memorySaveSlots.get('return-2d-save-slot-' + slot);
                        }
                        const saved = rawSaved ? JSON.parse(rawSaved) : null;
                        if (saved) {
                            loadSceneByName(saved.sceneName || saved.sceneId || currentScene?.name, saved);
                            if (saved.joystickEnabled !== undefined) {
                                const joyBase = document.getElementById('joystick-base');
                                if (joyBase) {
                                    joyBase.style.display = saved.joystickEnabled ? 'block' : 'none';
                                }
                            }
                        }
                    } catch(e) { console.error('Error loading game:', e); }
                    break;
                }
                case 'SetCameraZoom':
                    if (params?.zoomLevel) {
                        camera.zoom = Math.max(0.1, Number(params.zoomLevel));
                        if (isCurrentScene3D) {
                            camera3DRuntime.distance = Math.max(2.5, Math.min(35, 9 / camera.zoom));
                        }
                    }
                    break;
                case 'StartTimer':
                    if (params?.timerName && params?.duration != null) {
                        timers.set(params.timerName, { startTime: performance.now(), duration: Number(params.duration) * 1000 });
                    }
                    break;
                case 'StopTimer':
                    if (params?.timerName) {
                        timers.delete(params.timerName);
                    }
                    break;
                case 'SetJoystickEnabled': {
                    const rawVal = params?.enabled !== undefined ? params.enabled : params?.valueBoolean;
                    const isEnabled = rawVal === true || rawVal === 'true' || rawVal === undefined;
                    const joystickBase = document.getElementById('joystick-base');
                    if (joystickBase) {
                        joystickBase.style.display = isEnabled ? 'block' : 'none';
                    }
                    if (!isEnabled) {
                        resetJoystick();
                    }
                    break;
                }
                case 'EnableBehavior': {
                    if (targetObj && (targetObj.behaviors || targetObj._originalBehaviors) && params?.behaviorName) {
                        const origBehavs = targetObj._originalBehaviors || targetObj.behaviors || [];
                        origBehavs.forEach(b => {
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
                        origBehavs.forEach(b => {
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
                            const asset = (window.projectData?.assets || []).find(a => a.id === params.assetId);
                            if (asset) url = asset.url;
                        }
                        if (url) {
                            targetObj.imageUrl = url;
                        }
                        if (params?.color) {
                            targetObj.color = params.color;
                        }
                    }
                    break;
                case 'SetPlayerSkin': {
                    const playerObj = gameObjects.find(o => 
                        !o.isUI && 
                        (
                            (o.behaviors || []).some(b => ['PlatformerCharacter', 'TopDownRPGMovement', 'Player3D'].includes(b.name)) ||
                            ['player', 'jugador', 'jugador_1', 'player_1'].includes(o.name.toLowerCase())
                        )
                    );
                    const targetToUse = playerObj || targetObj;
                    if (targetToUse) {
                        let url = params?.imageUrl;
                        if (params?.assetId) {
                            const asset = (window.projectData?.assets || []).find(a => a.id === params.assetId);
                            if (asset) url = asset.url;
                        }
                        if (url) {
                            targetToUse.imageUrl = url;
                        }
                        if (params?.color) {
                            targetToUse.color = params.color;
                        }
                    }
                    break;
                }
                case 'SetPosition3D':
                    if (targetObj) {
                        var pSet = getObject3DPosition(targetObj);
                        targetObj.position3D = { x: params?.x3d !== undefined && params?.x3d !== '' ? Number(params.x3d) : pSet.x, y: params?.y3d !== undefined && params?.y3d !== '' ? Number(params.y3d) : pSet.y, z: params?.z3d !== undefined && params?.z3d !== '' ? Number(params.z3d) : pSet.z };
                        targetObj._moved3DThisFrame = true;
                        targetObj._mutatedBy3DAction = true;
                        sync3DTo2D(targetObj);
                    }
                    break;
                case 'Move3D':
                    if (targetObj) {
                        var pMov = getObject3DPosition(targetObj);
                        var multMov = isContinuous ? deltaTime : 1;
                        targetObj.position3D = { x: pMov.x + Number(params?.dx || 0) * multMov, y: pMov.y + Number(params?.dy || 0) * multMov, z: pMov.z + Number(params?.dz || 0) * multMov };
                        targetObj._moved3DThisFrame = true;
                        targetObj._mutatedBy3DAction = true;
                        sync3DTo2D(targetObj);
                    }
                    break;
                case 'Rotate3D':
                    if (targetObj) {
                        var rCur = getObject3DRotation(targetObj);
                        var multR3 = isContinuous ? deltaTime : 1;
                        var nextR3 = { x: rCur.x + (((Number(params?.rx || 0)) * Math.PI) / 180) * multR3, y: rCur.y + (((Number(params?.ry || 0)) * Math.PI) / 180) * multR3, z: rCur.z + (((Number(params?.rz || 0)) * Math.PI) / 180) * multR3 };
                        targetObj.rotation3D = nextR3;
                        targetObj.rotation = (nextR3.y * 180) / Math.PI;
                        targetObj._mutatedBy3DAction = true;
                    }
                    break;
                case 'RotateContinuously3D':
                    if (targetObj) {
                        var ax3 = (params?.axis3d === 'x' || params?.axis3d === 'z') ? params.axis3d : 'y';
                        var radSpd = (Number(params?.speed ?? 90) * Math.PI) / 180;
                        var curRs3 = targetObj.rotationSpeed3D || { x: 0, y: 0, z: 0 };
                        targetObj.rotationSpeed3D = { x: ax3 === 'x' ? radSpd : (curRs3.x || 0), y: ax3 === 'y' ? radSpd : (curRs3.y || 0), z: ax3 === 'z' ? radSpd : (curRs3.z || 0) };
                        targetObj._mutatedBy3DAction = true;
                    }
                    break;
                case 'Scale3D':
                    if (targetObj) {
                        var dScl3 = getObject3DDimensions(targetObj);
                        targetObj.scale3D = {
                            x: (params?.sx != null && params?.sx !== '') ? Math.max(0.05, Number(params.sx)) : dScl3.w,
                            y: (params?.sy != null && params?.sy !== '') ? Math.max(0.05, Number(params.sy)) : dScl3.h,
                            z: (params?.sz != null && params?.sz !== '') ? Math.max(0.05, Number(params.sz)) : dScl3.d
                        };
                        targetObj._mutatedBy3DAction = true;
                    }
                    break;
                case 'ForceJump3D':
                    if (targetObj) {
                        targetObj.vy3D = Number(params?.jumpForce ?? 7);
                        targetObj.grounded3D = false;
                        targetObj.grounded = false;
                        targetObj._mutatedBy3DAction = true;
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
                            const prevLoop = targetObj._pendingLoopImpulse3D || { x: 0, y: 0, z: 0 };
                            targetObj._pendingLoopImpulse3D = {
                                x: prevLoop.x + ix,
                                y: prevLoop.y + iy,
                                z: prevLoop.z + iz
                            };
                            const burst = targetObj._burstImpulse3D;
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
                            const burst = targetObj._burstImpulse3D || { x: 0, y: 0, z: 0 };
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
                            targetObj._burstImpulse3D = burst;
                        }
                        targetObj._mutatedBy3DAction = true;
                    }
                    break;
                case 'SetModel3D':
                    if (targetObj && (params?.modelUrl || params?.url || params?.value)) {
                        var urlM = String(params.modelUrl || params.url || params.value);
                        targetObj.modelUrl = urlM;
                        if (typeof preloadExportedGLTFs === 'function') {
                            preloadExportedGLTFs([urlM]);
                        }
                        targetObj._mutatedBy3DAction = true;
                    }
                    break;
                case 'SetShape3D':
                    if (targetObj && params?.shape3D) targetObj.shape3D = params.shape3D;
                    break;
                case 'SetColor3D':
                    if (targetObj) {
                        if (params?.color) targetObj.color = params.color;
                        if (params?.emissiveColor) targetObj.emissive3D = params.emissiveColor;
                        if (params?.emissiveIntensity !== undefined && params?.emissiveIntensity !== '') targetObj.emissiveIntensity3D = Number(params.emissiveIntensity);
                    }
                    break;
                case 'SetCamera3DMode':
                    if (params?.cameraMode) camera3DRuntime.mode = params.cameraMode;
                    if (params?.targetObjectName) camera3DRuntime.targetObjectName = params.targetObjectName;
                    break;
                case 'SetCamera3DOffset':
                    camera3DRuntime.offset = {
                        x: (params?.cx != null && params?.cx !== '') ? Number(params.cx) : (camera3DRuntime.offset?.x || 0),
                        y: (params?.cy != null && params?.cy !== '') ? Number(params.cy) : (camera3DRuntime.offset?.y ?? 5),
                        z: (params?.cz != null && params?.cz !== '') ? Number(params.cz) : (camera3DRuntime.offset?.z ?? 9)
                    };
                    break;
                case 'SetCamera3DMovement':
                    camera3DRuntime.movementEnabled = (params?.enabled !== false && params?.enabled !== 'false');
                    if (typeof threeEngine !== 'undefined' && threeEngine && threeEngine.controls) {
                        threeEngine.controls.enabled = (resolveCam3DMode() === 'freeOrbit') && (camera3DRuntime.movementEnabled !== false);
                    }
                    break;
                case 'LookAtObject3D':
                    if (targetObj && params?.targetObjectName) {
                        var tLook = gameObjects.find(function(o) { return o.name === params.targetObjectName; });
                        if (tLook) {
                            var lookMap3D = new Map(gameObjects.map(function(o) { return [o.id, o]; }));
                            var pSrc = getWorldTransform3DRuntime(targetObj, lookMap3D).pos;
                            var pDst = getWorldTransform3DRuntime(tLook, lookMap3D).pos;
                            if (!targetObj.rotation3D) targetObj.rotation3D = { x: 0, y: 0, z: 0 };
                            targetObj.rotation3D.y = Math.atan2(pDst.x - pSrc.x, pDst.z - pSrc.z);
                            targetObj.rotation = (targetObj.rotation3D.y * 180) / Math.PI;
                            targetObj._mutatedBy3DAction = true;
                        }
                    }
                    break;
                case 'MoveTowards3D':
                    if (targetObj && params?.targetObjectName) {
                        var tChase = gameObjects.find(function(o) { return o.name === params.targetObjectName; });
                        if (tChase) {
                            var chaseMap3D = new Map(gameObjects.map(function(o) { return [o.id, o]; }));
                            var pFrom = getWorldTransform3DRuntime(targetObj, chaseMap3D).pos;
                            var pTo = getWorldTransform3DRuntime(tChase, chaseMap3D).pos;
                            var dx3 = pTo.x - pFrom.x, dz3 = pTo.z - pFrom.z, dist3 = Math.hypot(dx3, dz3);
                            if (dist3 > 0.15) {
                                var spd3 = Number(params?.speed ?? 3.5);
                                var stepM3 = isContinuous ? spd3 * deltaTime : Math.min(dist3, spd3 * 0.25);
                                var nextWx = pFrom.x + (dx3 / dist3) * stepM3;
                                var nextWz = pFrom.z + (dz3 / dist3) * stepM3;
                                if (targetObj.parentId && chaseMap3D.has(targetObj.parentId)) {
                                    var parM = getWorldMatrix34Runtime(chaseMap3D.get(targetObj.parentId), chaseMap3D);
                                    var invParM = invertRigidMat34Runtime(parM);
                                    var curLocalP = getObjPos3DFallback(targetObj);
                                    var desiredW = composeEulerXYZMat34Runtime(nextWx, pFrom.y, nextWz, 0, 0, 0);
                                    var nextLocalM = mulMat34Runtime(invParM, desiredW);
                                    targetObj.position3D = { x: nextLocalM[3], y: curLocalP.y, z: nextLocalM[11] };
                                } else {
                                    targetObj.position3D = { x: nextWx, y: pFrom.y, z: nextWz };
                                }
                                if (!targetObj.rotation3D) targetObj.rotation3D = { x: 0, y: 0, z: 0 };
                                targetObj.rotation3D.y = Math.atan2(dx3, dz3);
                                targetObj.rotation = (targetObj.rotation3D.y * 180) / Math.PI;
                                targetObj._moved3DThisFrame = true;
                                targetObj._mutatedBy3DAction = true;
                                sync3DTo2D(targetObj);
                            }
                        }
                    }
                    break;
                case 'CreateObject3D':
                    if (params?.templateObjectName) {
                        var tmpl3 = allScenes.flatMap(function(s) { return s.gameObjects || []; }).find(function(o) { return o.name === params.templateObjectName; }) || (globalObjects || []).find(function(o) { return o.name === params.templateObjectName; }) || gameObjects.find(function(o) { return o.name === params.templateObjectName; });
                        if (tmpl3) {
                            var spawned3 = instantiateGlobalObjectExport(tmpl3, {
                                parentId: null,
                                position3D: { x: Number(params?.x3d ?? 0), y: Number(params?.y3d ?? 0), z: Number(params?.z3d ?? 0) }
                            }, true);
                            spawned3.allObjects.forEach(function(o) { gameObjects.push(o); });
                        }
                    }
                    break;
                case 'Shoot3D':
                    if (targetObj) {
                        try {
                            if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
                                const ctxSh = new (window.AudioContext || window.webkitAudioContext)();
                                if (ctxSh.state === 'suspended') ctxSh.resume();
                                const oscSh = ctxSh.createOscillator();
                                const gainSh = ctxSh.createGain();
                                oscSh.connect(gainSh);
                                gainSh.connect(ctxSh.destination);
                                oscSh.type = 'sawtooth';
                                oscSh.frequency.setValueAtTime(400, ctxSh.currentTime);
                                oscSh.frequency.exponentialRampToValueAtTime(100, ctxSh.currentTime + 0.12);
                                gainSh.gain.setValueAtTime(0.15, ctxSh.currentTime);
                                gainSh.gain.exponentialRampToValueAtTime(0.01, ctxSh.currentTime + 0.12);
                                oscSh.start();
                                oscSh.stop(ctxSh.currentTime + 0.12);
                            }
                        } catch (eSh) {}
                        var pSh = getObject3DPosition(targetObj), rSh = getObject3DRotation(targetObj);
                        var shSpd = Number(params?.speed ?? 15);
                        var shDmg = Number(params?.damage ?? 20);
                        var bullet3D = {
                            id: Date.now() + Math.random(),
                            name: 'Bullet',
                            shape3D: 'sphere',
                            x: targetObj.x, y: targetObj.y, width: 16, height: 16, zIndex: 15,
                            color: params?.color || '#facc15',
                            emissive3D: params?.color || '#facc15',
                            emissiveIntensity3D: 0.8,
                            position3D: { x: pSh.x + Math.sin(rSh.y) * 0.9, y: pSh.y + 0.8, z: pSh.z + Math.cos(rSh.y) * 0.9 },
                            scale3D: { x: 0.35, y: 0.35, z: 0.35 },
                            vx3D: Math.sin(rSh.y) * shSpd, vy3D: 0, vz3D: Math.cos(rSh.y) * shSpd,
                            isProjectile: true, projectileLifetime: 3.0,
                            stats: { hp: 1, maxHp: 1, attack: shDmg }
                        };
                        sync3DTo2D(bullet3D);
                        gameObjects.push(bullet3D);
                    }
                    break;
                case 'SetLight3D':
                    if (targetObj && params) {
                        if (params.intensity != null && params.intensity !== '') targetObj.lightIntensity3D = Number(params.intensity);
                        if (params.distance != null && params.distance !== '') targetObj.lightDistance3D = Number(params.distance);
                        if (params.color) targetObj.color = params.color;
                    } else if (params) {
                        if (params.intensity != null && params.intensity !== '') {
                            camera3DRuntime.ambientIntensity = Number(params.intensity);
                            camera3DRuntime.sunIntensity = Number(params.intensity);
                        }
                        if (params.color) camera3DRuntime.sunColor = params.color;
                    }
                    break;
                case 'SetFog3D':
                    camera3DRuntime.fogEnabled = params?.enabled !== false && params?.enabled !== 'false';
                    if (params?.color) camera3DRuntime.fogColor = params.color;
                    if (params?.density != null && params?.density !== '') camera3DRuntime.fogDensity = Number(params.density);
                    break;
                case 'SetSkybox3D': {
                    let skyUrl = params?.imageUrl || '';
                    if (!skyUrl && params?.assetId) {
                        const assetSky = (window.projectData?.assets || []).find(a => a.id === params.assetId);
                        if (assetSky) skyUrl = assetSky.url;
                    }
                    camera3DRuntime.skyboxImageUrl = skyUrl || '';
                    break;
                }
            }
        };

        const executeAction = (action, self, isContinuous = false, deltaTime = 0, forceRestart = false, pickedObjects = undefined) => {
            if (!action.object || action.object === 'System' || action.object === 'Camera' || action.object === 'Self' || (self && action.object === self.name)) {
                executeActionSingle(action, self, undefined, isContinuous, deltaTime, forceRestart);
                return;
            }
            
            let targetInstances = pickedObjects && pickedObjects[action.object] ? pickedObjects[action.object] : undefined;
            
            if (!targetInstances || targetInstances.length === 0) {
                targetInstances = gameObjects.filter(o => o.name === action.object || String(o.id) === action.object);
            }
            
            if (targetInstances.length > 0) {
                targetInstances.forEach(inst => {
                    executeActionSingle(action, self, inst, isContinuous, deltaTime, forceRestart);
                });
            } else {
                executeActionSingle(action, self, undefined, isContinuous, deltaTime, forceRestart);
            }
        };

        const sequenceStates = new Map();
        const CONTINUOUS_WAIT_PHASE_ACTIONS = new Set([
            'Move3D', 'MoveTowards3D', 'Rotate3D', 'LookAtObject3D', 'ApplyImpulse3D',
            'MoveObject', 'RotateObject', 'ScaleObject', 'FollowObject', 'MoveInDirection'
        ]);

        const compileSequencePhases = (actionsList) => {
            const phases = [];
            let pendingActions = [];
            const sigParts = [];

            for (let i = 0; i < actionsList.length; i++) {
                const act = actionsList[i];
                if (act.action === 'Wait') {
                    const rawDur = (act.params && act.params.duration !== undefined && act.params.duration !== '') ? Number(act.params.duration) : 1;
                    const secs = Math.max(0, isFinite(rawDur) ? rawDur : 1);
                    sigParts.push('W:' + secs);
                    if (pendingActions.length === 0 && phases.length > 0) {
                        phases[phases.length - 1].waitSeconds += secs;
                    } else {
                        phases.push({ actions: pendingActions, waitSeconds: secs });
                        pendingActions = [];
                    }
                } else {
                    sigParts.push((act.action || '') + ':' + (act.object || ''));
                    pendingActions.push(act);
                }
            }
            if (pendingActions.length > 0) {
                phases.push({ actions: pendingActions, waitSeconds: 0 });
            }
            return { phases: phases, signature: sigParts.join('|') };
        };

        const advanceSequenceState = (key, state, deltaTime) => {
            if (!state.phases.length) {
                sequenceStates.delete(key);
                return;
            }

            let dtLeft = Math.max(0, deltaTime);
            let safety = state.phases.length + 4;
            let ranZeroDt = false;

            while (safety-- > 0) {
                const phase = state.phases[state.phaseIndex];
                if (!phase) {
                    sequenceStates.delete(key);
                    return;
                }

                if (!state.enteredPhase) {
                    state.enteredPhase = true;
                    for (let ai = 0; ai < phase.actions.length; ai++) {
                        const act = phase.actions[ai];
                        if (!state.isContinuous || !CONTINUOUS_WAIT_PHASE_ACTIONS.has(act.action)) {
                            executeAction(act, state.self, false, 0, false, state.pickedObjects);
                            if (sceneChangeRequested) {
                                sceneChangeRequested = false;
                                sequenceStates.delete(key);
                                return;
                            }
                        }
                    }
                }

                const remaining = Math.max(0, phase.waitSeconds - state.elapsedInPhase);
                const stepDt = phase.waitSeconds > 0 ? Math.min(dtLeft, remaining) : 0;

                if (state.isContinuous && (stepDt > 0 || (dtLeft === 0 && !ranZeroDt))) {
                    for (let ai2 = 0; ai2 < phase.actions.length; ai2++) {
                        const act2 = phase.actions[ai2];
                        if (CONTINUOUS_WAIT_PHASE_ACTIONS.has(act2.action)) {
                            executeAction(act2, state.self, true, stepDt, false, state.pickedObjects);
                            if (sceneChangeRequested) {
                                sceneChangeRequested = false;
                                sequenceStates.delete(key);
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
                        sequenceStates.delete(key);
                        return;
                    }
                } else {
                    break;
                }
            }
        };

        const stepActiveSequences = (deltaTime) => {
            const seqGen = sceneGeneration;
            const entries = Array.from(sequenceStates.entries());
            for (let i = 0; i < entries.length; i++) {
                if (sceneGeneration !== seqGen) return;
                const key = entries[i][0];
                const state = entries[i][1];
                if (state.isContinuous) {
                    if (state.lastSeenFrame !== sequenceFrame) {
                        sequenceStates.delete(key);
                    }
                } else {
                    advanceSequenceState(key, state, deltaTime);
                }
            }
        };

        const executeActionsSequential = (actionsList, self, isContinuous = false, deltaTime = 0, forceRestart = false, pickedObjects = undefined, sequenceKey = undefined) => {
            if (!actionsList || actionsList.length === 0) return;
            const hasWait = actionsList.some(a => a.action === 'Wait');
            if (!hasWait) {
                if (sequenceKey) sequenceStates.delete(sequenceKey);
                for (let i = 0; i < actionsList.length; i++) {
                    executeAction(actionsList[i], self, isContinuous, deltaTime, forceRestart, pickedObjects);
                    if (sceneChangeRequested) {
                        sceneChangeRequested = false;
                        break;
                    }
                }
                return;
            }

            const key = sequenceKey || ('anon-' + Date.now() + '-' + Math.random());
            const existing = sequenceStates.get(key);
            if (existing && !existing.isContinuous) {
                if (!isContinuous) {
                    return;
                }
            }

            const compiled = compileSequencePhases(actionsList);
            if (!compiled.phases.length) return;

            if (existing && existing.isContinuous && isContinuous && existing.signature === compiled.signature) {
                let idx = 0;
                let pCursor = 0;
                while (pCursor < existing.phases.length && idx < actionsList.length) {
                    const targetPhase = existing.phases[pCursor];
                    const nextActs = [];
                    let mergedWait = 0;
                    while (idx < actionsList.length && actionsList[idx].action !== 'Wait') {
                        nextActs.push(actionsList[idx++]);
                    }
                    while (idx < actionsList.length && actionsList[idx].action === 'Wait') {
                        const rawD = (actionsList[idx].params && actionsList[idx].params.duration !== undefined && actionsList[idx].params.duration !== '') ? Number(actionsList[idx].params.duration) : 1;
                        mergedWait += Math.max(0, isFinite(rawD) ? rawD : 1);
                        idx++;
                    }
                    targetPhase.actions = nextActs;
                    targetPhase.waitSeconds = mergedWait;
                    pCursor++;
                }
                existing.self = self;
                existing.pickedObjects = pickedObjects;
                existing.lastSeenFrame = sequenceFrame;
                advanceSequenceState(key, existing, deltaTime);
                return;
            }

            const nextState = {
                phases: compiled.phases,
                phaseIndex: 0,
                elapsedInPhase: 0,
                enteredPhase: false,
                isContinuous: isContinuous,
                lastSeenFrame: sequenceFrame,
                self: self,
                pickedObjects: pickedObjects,
                signature: compiled.signature
            };
            sequenceStates.set(key, nextState);
            advanceSequenceState(key, nextState, isContinuous ? deltaTime : 0);
        };

        const checkCondition = (cond, executingObj, executingObj2, continuousLoop = false) => {
            const rawVar = cond.params?.variable;
            const variable = rawVar ? String(rawVar).trim() : '';
            const value = cond.params?.value;
            const stat = cond.params?.stat;
            const operator = cond.params?.operator || '==';
            let obj = executingObj && executingObj.name === cond.object ? executingObj : 
                      executingObj2 && executingObj2.name === cond.object ? executingObj2 :
                      gameObjects.find(o => o.name === cond.object);

            switch (cond.trigger) {
                case 'Always': return true;
                case 'OnCollisionWith': case 'OnVerticalCollision': case 'OnHorizontalCollision':
                    return frameCollisions.some(c => {
                        const pairMatch = ((c.obj1Name === cond.object && c.obj2Name === cond.target) || (c.obj2Name === cond.object && c.obj1Name === cond.target));
                        if (!pairMatch) return false;
                        if (cond.trigger === 'OnCollisionWith') return true;
                        return c.type === cond.trigger;
                    });
                case 'OnClick':
                case 'OnObjectClicked':
                    if (obj) {
                        return frameClicks.some(c => c.id === obj.id || (cond.object && c.name === cond.object));
                    }
                    if (executingObj) {
                        return frameClicks.some(c => c.id === executingObj.id || c.name === executingObj.name);
                    }
                    if (cond.object && cond.object !== 'System') {
                        return frameClicks.some(c => c.name === cond.object);
                    }
                    return frameClicks.length > 0;
                case 'OnObjectReleased':
                    if (obj) {
                        return frameObjectReleases.some(c => c.id === obj.id || (cond.object && c.name === cond.object));
                    }
                    if (executingObj) {
                        return frameObjectReleases.some(c => c.id === executingObj.id || c.name === executingObj.name);
                    }
                    if (cond.object && cond.object !== 'System') {
                        return frameObjectReleases.some(c => c.name === cond.object);
                    }
                    return frameObjectReleases.length > 0;
                case 'OnInteract': return obj ? frameInteractions.some(c => c.id === obj.id) : frameInteractions.some(c => c.name === cond.object);
                case 'IsSceneUnlocked':
                    if (cond.params?.sceneName) {
                        return !!gameVariables['scene_unlocked_' + cond.params.sceneName];
                    }
                    return false;
                case 'OnKeyPress': {
                    const k = cond.params?.key ? String(cond.params.key).toLowerCase() : '';
                    if (!k) return false;
                    return continuousLoop
                        ? Boolean(keysPressed[k] || frameKeyPresses.includes(k))
                        : frameKeyPresses.includes(k);
                }
                case 'OnKeyRelease': return !!(cond.params?.key && frameKeyReleases.includes(String(cond.params.key).toLowerCase()));
                case 'OnAnyKeyPress':
                    return continuousLoop
                        ? (Object.values(keysPressed).some(Boolean) || frameKeyPresses.length > 0)
                        : frameKeyPresses.length > 0;
                case 'OnAnyKeyRelease': return frameKeyReleases.length > 0;
                case 'OnAttack': return obj ? frameAttacks.some(c => c.id === obj.id) : frameAttacks.some(c => c.name === cond.object);
                case 'OnTimerElapsed': return frameTimerEvents.includes(cond.params?.timerName);
                case 'OnDialogueEnd': return frameDialogueEnd;
                case 'OnObjectClicked3D':
                    if (obj) return frameClicks.some(c => c.id === obj.id || c.name === obj.name);
                    if (executingObj) return frameClicks.some(c => c.id === executingObj.id || c.name === executingObj.name);
                    if (cond.object && cond.object !== 'System') return frameClicks.some(c => c.name === cond.object);
                    return frameClicks.length > 0;
                case 'IsGrounded3D':
                    return !!(obj && (!!obj.grounded3D || !!obj.grounded));
                case 'Distance3DLessThan': {
                    const targetName = cond.target || cond.params?.targetObjectName;
                    const sourceObj = obj || executingObj;
                    if (!sourceObj || !targetName) return false;
                    const maxDist = Number(cond.params?.distance ?? 3);
                    const distMap3D = new Map(gameObjects.map(o => [o.id, o]));
                    const p1 = getWorldTransform3DRuntime(sourceObj, distMap3D).pos;
                    if (executingObj2 && executingObj2.name === targetName && executingObj2.id !== sourceObj.id) {
                        const p2 = getWorldTransform3DRuntime(executingObj2, distMap3D).pos;
                        return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z) <= maxDist;
                    }
                    return gameObjects.some(cand => {
                        if (cand.name !== targetName || cand.id === sourceObj.id) return false;
                        const p2 = getWorldTransform3DRuntime(cand, distMap3D).pos;
                        return Math.hypot(p1.x - p2.x, p1.y - p2.y, p1.z - p2.z) <= maxDist;
                    });
                }
                case 'CompareVariable': {
                    if (!variable) return false;
                    const currentVarRaw = gameVariables[variable];
                    const varValue = (currentVarRaw === undefined || currentVarRaw === null || currentVarRaw === '') ? 0 : currentVarRaw;
                    const compValue = value !== undefined ? String(value).trim() : "";

                    const nVar = parseNumericValue(varValue);
                    const nComp = parseNumericValue(compValue);
                    if (nVar !== null && nComp !== null) {
                        switch (operator) {
                            case '==': return nVar === nComp;
                            case '!=': return nVar !== nComp;
                            case '>': return nVar > nComp;
                            case '<': return nVar < nComp;
                            case '>=': return nVar >= nComp;
                            case '<=': return nVar <= nComp;
                            default: return false;
                        }
                    }

                    switch (operator) {
                        case '==': return String(varValue).trim() === compValue;
                        case '!=': return String(varValue).trim() !== compValue;
                        default: return false;
                    }
                }
                case 'IsMobile':
                    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
                case 'IsPC':
                    return !(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768);
                case 'CompareBooleanVariable': {
                    if (!variable) return false;
                    let currentVarRaw = gameVariables[variable];
                    if (currentVarRaw === 'false') currentVarRaw = false;
                    else if (currentVarRaw === 'true') currentVarRaw = true;
                    else currentVarRaw = !!currentVarRaw;

                    const targetBool = cond.params?.valueBoolean === true || cond.params?.valueBoolean === 'true';
                    return currentVarRaw === targetBool;
                }
                case 'CompareObjectVariable': {
                    if (!obj?.variables || !variable) return false;
                    const objVar = obj.variables.find(v => v.name === variable);
                    const varValue = (objVar && objVar.value !== undefined && objVar.value !== null && objVar.value !== '') ? objVar.value : 0;
                    const compValue = value !== undefined ? String(value).trim() : "";

                    const nVar = parseNumericValue(varValue);
                    const nComp = parseNumericValue(compValue);
                    if (nVar !== null && nComp !== null) {
                        switch (operator) {
                            case '==': return nVar === nComp;
                            case '!=': return nVar !== nComp;
                            case '>': return nVar > nComp;
                            case '<': return nVar < nComp;
                            case '>=': return nVar >= nComp;
                            case '<=': return nVar <= nComp;
                            default: return false;
                        }
                    }

                    switch (operator) {
                        case '==': return String(varValue).trim() === compValue;
                        case '!=': return String(varValue).trim() !== compValue;
                        default: return false;
                    }
                }
                case 'CompareObjectBooleanVariable': {
                    if (!obj?.variables || !variable) return false;
                    const objVar = obj.variables.find(v => v.name === variable);
                    let varValue = objVar ? objVar.value : false;
                    if (varValue === 'false') varValue = false;
                    else if (varValue === 'true') varValue = true;
                    else varValue = !!varValue;

                    const targetBool = cond.params?.valueBoolean === true || cond.params?.valueBoolean === 'true';
                    return varValue === targetBool;
                }
                case 'CompareStat': {
                    if (!obj || !stat) return false;
                    const statValue = obj.stats?.[stat] ?? 0;
                    const compValue = value !== undefined ? String(value).trim() : "";

                    const nStat = parseNumericValue(statValue);
                    const nComp = parseNumericValue(compValue);
                    if (nStat !== null && nComp !== null) {
                        switch (operator) {
                            case '==': return nStat === nComp;
                            case '!=': return nStat !== nComp;
                            case '>': return nStat > nComp;
                            case '<': return nStat < nComp;
                            case '>=': return nStat >= nComp;
                            case '<=': return nStat <= nComp;
                            default: return false;
                        }
                    }

                    switch (operator) {
                        case '==': return String(statValue).trim() === compValue;
                        case '!=': return String(statValue).trim() !== compValue;
                        default: return false;
                    }
                }
                case 'IsOnGround': return !!(obj && (!!obj.grounded || !!obj.grounded3D));
                case 'IsMoving': {
                    const ev = obj?._effectiveVel3D;
                    const vx3 = ev ? ev.x : (obj?.vx3D || 0);
                    const vy3 = ev ? ev.y : (obj?.vy3D || 0);
                    const vz3 = ev ? ev.z : (obj?.vz3D || 0);
                    return !!(obj && (Math.abs(obj.vx || 0) > 1 || Math.abs(obj.vy || 0) > 1 || Math.hypot(vx3, vy3, vz3) > 0.05));
                }
                case 'IsIdle': {
                    if (!obj || obj.isClimbing || obj.parentId) return false;
                    const ev = obj._effectiveVel3D;
                    const vx3 = ev ? ev.x : (obj.vx3D || 0);
                    const vz3 = ev ? ev.z : (obj.vz3D || 0);
                    const hasGrav = !!(obj.behaviors || []).some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
                    const hasTopDown = !!(obj.behaviors || []).some(b => b.name === 'TopDownRPGMovement');
                    const isGrounded = !!(obj.grounded || obj.grounded3D || (hasTopDown && !hasGrav));
                    if (!isGrounded) return false;
                    if (isCurrentScene3D) {
                        return Math.hypot(vx3, vz3) <= 0.05;
                    }
                    const moving2D = (hasTopDown && !hasGrav) ? Math.hypot(obj.vx || 0, obj.vy || 0) > 1 : Math.abs(obj.vx || 0) > 1;
                    return !moving2D;
                }
                case 'IsRunning': {
                    if (!obj || obj.isClimbing || obj.parentId) return false;
                    const ev = obj._effectiveVel3D;
                    const vx3 = ev ? ev.x : (obj.vx3D || 0);
                    const vz3 = ev ? ev.z : (obj.vz3D || 0);
                    const hasGrav = !!(obj.behaviors || []).some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
                    const hasTopDown = !!(obj.behaviors || []).some(b => b.name === 'TopDownRPGMovement');
                    const isGrounded = !!(obj.grounded || obj.grounded3D || (hasTopDown && !hasGrav));
                    if (!isGrounded) return false;
                    if (isCurrentScene3D) {
                        return Math.hypot(vx3, vz3) > 0.05;
                    }
                    return (hasTopDown && !hasGrav) ? Math.hypot(obj.vx || 0, obj.vy || 0) > 1 : Math.abs(obj.vx || 0) > 1;
                }
                case 'IsJumping': {
                    if (!obj || obj.isClimbing || obj.parentId) return false;
                    const ev = obj._effectiveVel3D;
                    const vy3 = obj.vy3D !== undefined ? obj.vy3D : (ev ? ev.y : 0);
                    const hasGrav = !!(obj.behaviors || []).some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
                    const hasTopDown = !!(obj.behaviors || []).some(b => b.name === 'TopDownRPGMovement');
                    const isGrounded = isCurrentScene3D ? !!obj.grounded3D : !!(obj.grounded || (hasTopDown && !hasGrav));
                    if (isGrounded) return false;
                    return isCurrentScene3D ? vy3 > 0.05 : (obj.vy || 0) < -0.5;
                }
                case 'IsFalling': {
                    if (!obj || obj.isClimbing || obj.parentId) return false;
                    const ev = obj._effectiveVel3D;
                    const vy3 = obj.vy3D !== undefined ? obj.vy3D : (ev ? ev.y : 0);
                    const hasGrav = !!(obj.behaviors || []).some(b => ['PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'Boss', 'Boss3D'].includes(b.name));
                    const hasTopDown = !!(obj.behaviors || []).some(b => b.name === 'TopDownRPGMovement');
                    const isGrounded = isCurrentScene3D ? !!obj.grounded3D : !!(obj.grounded || (hasTopDown && !hasGrav));
                    if (isGrounded) return false;
                    return isCurrentScene3D ? vy3 < -0.05 : (obj.vy || 0) > 0.5;
                }
                case 'IsClimbing': return !!(obj && !!obj.isClimbing);
                case 'IsLookingLeft': return !!(obj && obj.direction === 'left');
                case 'IsLookingRight': return !!(obj && obj.direction === 'right');
                case 'IsMusicPlaying': {
                    const isPlaying = backgroundMusicPlayer && !backgroundMusicPlayer.paused;
                    if (!isPlaying) return false;
                    if (!cond.params?.soundId) return true;
                    const matchedMus = (assets || []).find(a => String(a.id) === String(cond.params.soundId) || a.url === cond.params.soundId || a.name === cond.params.soundId);
                    return String(currentBackgroundMusicId) === String(cond.params.soundId) || (matchedMus && String(currentBackgroundMusicId) === String(matchedMus.id));
                }
                case 'OnJoystickMove': return joystickState.active || frameJoystickEvents.length > 0;
                case 'OnJoystickUp': return frameJoystickEvents.includes('up');
                case 'OnJoystickDown': return frameJoystickEvents.includes('down');
                case 'OnJoystickLeft': return frameJoystickEvents.includes('left');
                case 'OnJoystickRight': return frameJoystickEvents.includes('right');
                case 'OnButtonDown': {
                    const reqBtnD = cond.params?.buttonName ? String(cond.params.buttonName).toLowerCase() : '';
                    return reqBtnD ? frameButtonDown.some(b => String(b).toLowerCase() === reqBtnD) : frameButtonDown.length > 0;
                }
                case 'OnButtonUp': {
                    const reqBtnU = cond.params?.buttonName ? String(cond.params.buttonName).toLowerCase() : '';
                    return reqBtnU ? frameButtonUp.some(b => String(b).toLowerCase() === reqBtnU) : frameButtonUp.length > 0;
                }
                case 'OnTriggerDown': {
                    const reqTrigD = cond.params?.triggerName ? String(cond.params.triggerName).toLowerCase() : '';
                    return reqTrigD ? frameTriggerDown.some(t => String(t).toLowerCase() === reqTrigD) : frameTriggerDown.length > 0;
                }
                case 'OnTriggerUp': {
                    const reqTrigU = cond.params?.triggerName ? String(cond.params.triggerName).toLowerCase() : '';
                    return reqTrigU ? frameTriggerUp.some(t => String(t).toLowerCase() === reqTrigU) : frameTriggerUp.length > 0;
                }
                case 'OnConsoleCommand': {
                    const reqCmd = cond.params?.command ? String(cond.params.command).toLowerCase() : '';
                    return reqCmd ? frameConsoleCommands.some(c => String(c).toLowerCase() === reqCmd) : frameConsoleCommands.length > 0;
                }
                case 'OnMatchFound': return frameMatchFound;
                case 'OnPlayerJoined': return framePlayerJoined;
                case 'OnPlayerLeft': return framePlayerLeft;
                case 'OnReceiveNetworkMessage':
                    if (cond.params?.message) {
                        return frameNetworkMessages.some(m => String(m).toLowerCase() === String(cond.params.message).toLowerCase());
                    }
                    return frameReceiveNetworkMessage;
                case 'OnHealthDepleted': return !!(obj && obj.stats && obj.stats.hp <= 0);
                default: return false;
            }
        };
        
        let frameDialogueEnd = false;
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

        const evaluateSingleEvent = (event, deltaTime = 0, options = {}) => {
            const skipTrigger = options.skipTrigger || null;
            const skipCondIndex = options.skipCondIndex;
            const forceOneShot = !!options.forceOneShot;
            const objectMap = options.objectMap || (() => {
                const map = new Map();
                gameObjects.forEach(o => {
                    if (!map.has(o.name)) map.set(o.name, []);
                    map.get(o.name).push(o);
                });
                return map;
            })();

            const pickedObjects = {};
            let conditionsMet = true;
            const conds = event.conditions || [];
            const hasAlwaysCond = conds.some(c => c.trigger === 'Always' || c.trigger === 'OnUpdate');

            for (let i = 0; i < conds.length; i++) {
                const cond = conds[i];
                if (skipCondIndex !== undefined && i === skipCondIndex) continue;
                if (skipTrigger && cond.trigger === skipTrigger) continue;

                if (cond.trigger === 'OnCollisionWith' || cond.trigger === 'OnVerticalCollision' || cond.trigger === 'OnHorizontalCollision') {
                    const objName = cond.object;
                    const targetName = cond.target;

                    const candidateObj1 = pickedObjects[objName] || objectMap.get(objName) || [];
                    const candidateObj2 = (targetName ? (pickedObjects[targetName] || objectMap.get(targetName)) : undefined) || [];

                    const validObj1 = [];
                    const validObj2 = [];

                    frameCollisions.forEach(c => {
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
                        const valid1 = [];
                        const valid2 = [];
                        for (let a = 0; a < instances1.length; a++) {
                            const o1 = instances1[a];
                            for (let b = 0; b < instances2.length; b++) {
                                const o2 = instances2[b];
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
                        if (!checkCondition(cond, null, null, hasAlwaysCond)) {
                            conditionsMet = false;
                            break;
                        }
                    } else {
                        const instancesToCheck = pickedObjects[objectName] || objectMap.get(objectName) || [];
                        const validInstances = instancesToCheck.filter(inst => checkCondition(cond, inst, null, hasAlwaysCond));
                        if (validInstances.length === 0) {
                            conditionsMet = false;
                            break;
                        }
                        pickedObjects[objectName] = validInstances;
                    }
                } else {
                    if (!checkCondition(cond, null, null, hasAlwaysCond)) {
                        conditionsMet = false;
                        break;
                    }
                }
            }

            if (conditionsMet) {
                const isEventTrigger = forceOneShot || (!hasAlwaysCond && conds.some(c => ONE_SHOT_TRIGGERS.has(c.trigger)));
                executeActionsSequential(event.actions, null, !isEventTrigger, deltaTime, false, pickedObjects, 'event-' + event.id);
            }
        };

        const evaluateEvents = (deltaTime = 0) => {
            if (!currentScene || !currentScene.events) return;
            const evalGen = sceneGeneration;
            const objectMap = new Map();
            gameObjects.forEach(o => {
                if (!objectMap.has(o.name)) objectMap.set(o.name, []);
                objectMap.get(o.name).push(o);
            });
            currentScene.events.forEach(event => {
                if (sceneGeneration !== evalGen) return;
                if ((event.conditions || []).some(c => c.trigger === 'OnStart' || c.trigger === 'EveryXSeconds')) return;
                evaluateSingleEvent(event, deltaTime, { objectMap });
            });
        };

        function updateInteractables() {
            const playerObjForInteract = gameObjects.find(o => o.behaviors && o.behaviors.some(b => b.name === 'Player3D' || b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement'));
            let currentActiveInteractable = null;

            if (playerObjForInteract) {
                const interactables = gameObjects.filter(o => o.behaviors && o.behaviors.some(b => b.name === 'Interactable'));
                let minDistance = Infinity;
                for (const item of interactables) {
                    const dist = isCurrentScene3D
                        ? Math.hypot(
                            getObject3DPosition(item).x - getObject3DPosition(playerObjForInteract).x,
                            getObject3DPosition(item).y - getObject3DPosition(playerObjForInteract).y,
                            getObject3DPosition(item).z - getObject3DPosition(playerObjForInteract).z
                          ) * 50
                        : Math.hypot(item.x - playerObjForInteract.x, item.y - playerObjForInteract.y);
                    const interactBehav = item.behaviors.find(b => b.name === 'Interactable');
                    const radius = Number((interactBehav.properties && interactBehav.properties.radius) || 60);

                    if (dist <= radius && dist < minDistance) {
                        minDistance = dist;
                        currentActiveInteractable = {
                            id: item.id,
                            name: item.name,
                            prompt: String((interactBehav.properties && interactBehav.properties.prompt) || 'Interactuar [E]')
                        };
                    }
                }
            }
            activeInteractable = currentActiveInteractable;

            let interactOverlay = document.getElementById('engine-interact-overlay');
            let interactBtn = document.getElementById('engine-interact-btn');
            const uiContainerForInteract = document.getElementById('ui-container');

            if (activeInteractable && uiContainerForInteract) {
                if (!interactOverlay) {
                    interactOverlay = document.createElement('div');
                    interactOverlay.id = 'engine-interact-overlay';
                    interactOverlay.style.position = 'absolute';
                    interactOverlay.style.bottom = '25%';
                    interactOverlay.style.left = '50%';
                    interactOverlay.style.transform = 'translateX(-50%)';
                    interactOverlay.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
                    interactOverlay.style.border = '1px solid rgba(129, 140, 248, 0.8)';
                    interactOverlay.style.color = '#e0e7ff';
                    interactOverlay.style.padding = '8px 16px';
                    interactOverlay.style.borderRadius = '9999px';
                    interactOverlay.style.boxShadow = '0 10px 25px -5px rgba(0,0,0,0.5)';
                    interactOverlay.style.fontSize = '12px';
                    interactOverlay.style.fontWeight = 'bold';
                    interactOverlay.style.display = 'flex';
                    interactOverlay.style.alignItems = 'center';
                    interactOverlay.style.gap = '8px';
                    interactOverlay.style.zIndex = '99999';
                    interactOverlay.style.pointerEvents = 'auto';
                    interactOverlay.style.cursor = 'pointer';

                    const eBadge = document.createElement('span');
                    eBadge.innerText = 'E';
                    eBadge.style.backgroundColor = '#6366f1';
                    eBadge.style.color = 'white';
                    eBadge.style.borderRadius = '50%';
                    eBadge.style.width = '20px';
                    eBadge.style.height = '20px';
                    eBadge.style.display = 'flex';
                    eBadge.style.alignItems = 'center';
                    eBadge.style.justifyContent = 'center';
                    eBadge.style.fontFamily = 'monospace';

                    const labelSpan = document.createElement('span');
                    labelSpan.id = 'engine-interact-label';

                    interactOverlay.appendChild(eBadge);
                    interactOverlay.appendChild(labelSpan);

                    interactOverlay.addEventListener('click', () => {
                        if (activeInteractable) {
                            frameInteractions.push({
                                id: activeInteractable.id,
                                name: activeInteractable.name
                            });
                        }
                    });

                    uiContainerForInteract.appendChild(interactOverlay);
                }

                const label = document.getElementById('engine-interact-label');
                if (label) label.innerText = activeInteractable.prompt;
                interactOverlay.style.display = 'flex';

                if (!interactBtn) {
                    interactBtn = document.createElement('button');
                    interactBtn.id = 'engine-interact-btn';
                    interactBtn.style.position = 'absolute';
                    interactBtn.style.bottom = '40px';

                    const joyPos = window.projectData?.joystick?.position || 'left';
                    interactBtn.style[joyPos === 'right' ? 'left' : 'right'] = '45px';
                    interactBtn.style.width = '72px';
                    interactBtn.style.height = '72px';
                    interactBtn.style.borderRadius = '50%';
                    interactBtn.style.backgroundColor = 'rgba(99, 102, 241, 0.85)';
                    interactBtn.style.border = '3px solid rgba(255, 255, 255, 0.5)';
                    interactBtn.style.color = 'white';
                    interactBtn.style.fontWeight = 'bold';
                    interactBtn.style.fontSize = '11px';
                    interactBtn.style.display = 'flex';
                    interactBtn.style.flexDirection = 'column';
                    interactBtn.style.alignItems = 'center';
                    interactBtn.style.justifyContent = 'center';
                    interactBtn.style.gap = '2px';
                    interactBtn.style.cursor = 'pointer';
                    interactBtn.style.userSelect = 'none';
                    interactBtn.style.pointerEvents = 'auto';
                    interactBtn.style.zIndex = '99999';

                    const iconSpan = document.createElement('span');
                    iconSpan.innerText = '⚡';
                    iconSpan.style.fontSize = '14px';

                    const textSpan = document.createElement('span');
                    textSpan.innerText = 'INTERACT';

                    interactBtn.appendChild(iconSpan);
                    interactBtn.appendChild(textSpan);

                    interactBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        if (activeInteractable) {
                            frameInteractions.push({
                                id: activeInteractable.id,
                                name: activeInteractable.name
                            });
                        }
                    });

                    uiContainerForInteract.appendChild(interactBtn);
                }

                const joyPos = window.projectData?.joystick?.position || 'left';
                interactBtn.style.left = joyPos === 'right' ? '45px' : 'auto';
                interactBtn.style.right = joyPos === 'right' ? 'auto' : '45px';
                interactBtn.style.display = 'flex';
            } else {
                if (interactOverlay) interactOverlay.style.display = 'none';
                if (interactBtn) interactBtn.style.display = 'none';
            }
        }
        
        let lastTime = 0;
        let lastFrameTime = 0;
        function gameLoop(timestamp) {
            const loopGen = sceneGeneration;
            if (!currentScene) {
                if (sceneGeneration === loopGen) {
                    animationFrameId = requestAnimationFrame(gameLoop);
                }
                return;
            }
            const now = performance.now();
            if (lastTime === 0) {
                lastTime = now;
                lastFrameTime = now;
            }
            let targetFps = window.projectData && window.projectData.fps ? Number(window.projectData.fps) : 60;
            if (isNaN(targetFps) || targetFps <= 0) targetFps = 60;
            const fpsInterval = 1000 / targetFps;
            const elapsed = now - lastFrameTime;
            if (elapsed < fpsInterval) {
                animationFrameId = requestAnimationFrame(gameLoop);
                return;
            }
            
            const deltaTime = Math.min(0.1, elapsed / 1000.0);
            lastTime = now;
            lastFrameTime = now - (elapsed % fpsInterval);
            sequenceFrame += 1;

            // Filter out behaviors that are disabled
            gameObjects.forEach(obj => {
                if (obj.behaviors) {
                    if (!obj._originalBehaviors) {
                        obj._originalBehaviors = [...obj.behaviors];
                    }
                    obj.behaviors = obj._originalBehaviors.filter(b => b.disabled !== true);
                }
            });

            // Console display logic
            let consoleUI = document.getElementById('engine-console');
            if (consoleUI) consoleUI.style.display = consoleActive ? 'block' : 'none';

            frameJoystickEvents = [];

            // Gamepad Polling
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            for (const gp of gamepads) {
                if (!gp) continue;

                const getButtonName = (idx) => {
                    const mapping = {
                        0: "A", 1: "B", 2: "X", 3: "Y", 
                        4: "L1", 5: "R1", 6: "L2", 7: "R2",
                        8: "Select", 9: "Start", 10: "L3", 11: "R3",
                        12: "DpadUp", 13: "DpadDown", 14: "DpadLeft", 15: "DpadRight",
                        16: "Home", 17: "Capture"
                    };
                    return mapping[idx] || ("button_" + idx);
                };

                gp.buttons.forEach((btn, index) => {
                    const btnName = "button_" + index;
                    const readableName = getButtonName(index);
                    const isBtnPressed = !!(btn && (btn.pressed || ((index === 6 || index === 7) && btn.value > 0.3)));
                    if (isBtnPressed) {
                        if (!buttonState[btnName]) {
                            frameButtonDown.push(btnName);
                            frameButtonDown.push(readableName);

                            // Aliases & Analog Triggers
                            if (index === 6) {
                                frameButtonDown.push('ZL');
                                frameTriggerDown.push('L2', 'ZL', 'LT');
                            }
                            if (index === 7) {
                                frameButtonDown.push('ZR');
                                frameTriggerDown.push('R2', 'ZR', 'RT');
                            }
                            if (index === 8) frameButtonDown.push('Minus');
                            if (index === 9) frameButtonDown.push('Plus');
                            if (index === 4) frameButtonDown.push('L');
                            if (index === 5) frameButtonDown.push('R');

                            buttonState[btnName] = true;
                        }
                    } else if (buttonState[btnName]) {
                        frameButtonUp.push(btnName);
                        frameButtonUp.push(readableName);
                        if (index === 6) {
                            frameButtonUp.push('ZL');
                            frameTriggerUp.push('L2', 'ZL', 'LT');
                        }
                        if (index === 7) {
                            frameButtonUp.push('ZR');
                            frameTriggerUp.push('R2', 'ZR', 'RT');
                        }
                        if (index === 8) frameButtonUp.push('Minus');
                        if (index === 9) frameButtonUp.push('Plus');
                        if (index === 4) frameButtonUp.push('L');
                        if (index === 5) frameButtonUp.push('R');
                        buttonState[btnName] = false;
                    }
                });

                if (gp.axes && gp.axes.length >= 2) {
                    const gx = gp.axes[0], gy = gp.axes[1];
                    if (Math.abs(gx) > 0.3 || Math.abs(gy) > 0.3) {
                        if (!frameJoystickEvents.includes('move')) frameJoystickEvents.push('move');
                        if (gx > 0.3 && !frameJoystickEvents.includes('right')) frameJoystickEvents.push('right');
                        if (gx < -0.3 && !frameJoystickEvents.includes('left')) frameJoystickEvents.push('left');
                        if (gy > 0.3 && !frameJoystickEvents.includes('down')) frameJoystickEvents.push('down');
                        if (gy < -0.3 && !frameJoystickEvents.includes('up')) frameJoystickEvents.push('up');
                    }
                }
            }

            timers.forEach((timer, name) => {
                if (now >= timer.startTime + timer.duration) {
                    frameTimerEvents.push(name);
                    timers.delete(name);
                }
            });

            if (currentScene && currentScene.events) {
                currentScene.events.forEach((event, eventIndex) => {
                    (event.conditions || []).forEach((cond, condIndex) => {
                        if (cond.trigger === 'EveryXSeconds') {
                            const secVal = parseNumericValue(cond.params?.interval ?? 1);
                            if (secVal !== null && secVal > 0) {
                                const key = 'evt-' + (event.id || eventIndex) + '-cond-' + condIndex;
                                const intervalData = intervals.get(key);
                                const intervalMs = secVal * 1000;
                                if (!intervalData) {
                                    intervals.set(key, { interval: intervalMs, lastTriggerTime: now });
                                } else if (now >= intervalData.lastTriggerTime + intervalData.interval) {
                                    evaluateSingleEvent(event, 0, { skipCondIndex: condIndex, forceOneShot: true });
                                    intervalData.lastTriggerTime = now;
                                }
                            }
                        }
                    });
                });
            }

            const objectsById = new Map(gameObjects.map(o => [o.id, o]));

            // Pre-update 2D Solid platforms before building staticCollisionShapes so moving platforms never lag 1 frame or throw players sideways
            if (!isCurrentScene3D) {
                const now2DPre = performance.now();
                gameObjects.forEach(s => {
                    if (s.isUI || !s.behaviors?.some(b => b.name === 'Solid')) return;
                    const prevX = s._lastSolidX !== undefined ? s._lastSolidX : s.x;
                    const prevY = s._lastSolidY !== undefined ? s._lastSolidY : s.y;

                    if (s.followTarget) {
                        const target = gameObjects.find(o => o.name === s.followTarget);
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
                        const points = String(pointsStr).split(';').map((p) => {
                            const parts = p.split(',');
                            return { x: Number(parts[0] || 0), y: Number(parts[1] || 0) };
                        });
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
                            const spd = Number(move.speed || 0);
                            const dir = String(move.direction || '').toLowerCase();
                            if (dir === 'right') s.x += spd * deltaTime;
                            else if (dir === 'left') s.x -= spd * deltaTime;
                            else if (dir === 'up') s.y -= spd * deltaTime;
                            else if (dir === 'down') s.y += spd * deltaTime;
                        });
                        s.pendingMovements = [];
                    }
                    s._platformDx = s.x - prevX;
                    s._platformDy = s.y - prevY;
                    if (deltaTime > 0) {
                        s.platformVx = s._platformDx / deltaTime;
                        s.platformVy = s._platformDy / deltaTime;
                    }
                    s._solidUpdatedInPrepass = true;
                });
            }

            const staticCollisionShapes = [];
            const allObjectsWithAbsPosForPhysics = gameObjects.map(o => {
                const absPos = getObjectAbsolutePosition(o.id, objectsById);
                return { ...o, absX: absPos.x, absY: absPos.y, absRotation: absPos.rotation, x: absPos.x, y: absPos.y, rotation: absPos.rotation };
            });
            
            allObjectsWithAbsPosForPhysics.forEach(obj => {
                
                if (mpTag) {
                    const pNum = mpTag.properties?.playerNumber ?? 1;
                    if (!isPlayerJoined(pNum)) return;
                }

                if (obj.behaviors?.some(b => b.name === 'Solid')) {
                    staticCollisionShapes.push({ ...getCollisionBox(obj), owner: obj });
                }
                const tilemapBehavior = obj.behaviors?.find(b => b.name === 'Tilemap');
                if (tilemapBehavior) {
                    const { tileSize = 32, collisionData = '' } = tilemapBehavior.properties || {};
                    const rows = String(collisionData).split('\\n');
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

            ['moveLeft','moveRight','moveUp','moveDown','jump','attack','run'].forEach(act => {
                if (!actionsPressed[act+'_ui']) actionsPressed[act] = false;
            });
            actionsPressed.moveHorizontalIntensity = 0;
            actionsPressed.moveVerticalIntensity = 0;

            // Direct Gamepad (Bluetooth & USB) input processing
            gamepadRightStick = { x: 0, y: 0 };
            if (gamepadMoveLockUntilNeutral) {
                let anyDirActive = false;
                for (const gp of gamepads) {
                    if (isGamepadDirectionalActive(gp)) { anyDirActive = true; break; }
                }
                if (!anyDirActive) gamepadMoveLockUntilNeutral = false;
            }
            if (!gamepadMoveLockUntilNeutral) {
                for (const gp of gamepads) {
                    if (!gp) continue;
                    if (gp.buttons) {
                        if (gp.buttons[0]?.pressed) actionsPressed.jump = true;
                        if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) actionsPressed.attack = true;
                        if (gp.buttons[3]?.pressed) actionsPressed.jump = true;
                        if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed || gp.buttons[6]?.pressed || (gp.buttons[6]?.value > 0.3)) actionsPressed.run = true;
                        if (gp.buttons[7]?.pressed || (gp.buttons[7]?.value > 0.3)) actionsPressed.attack = true;
                        if (gp.buttons[12]?.pressed) actionsPressed.moveUp = true;
                        if (gp.buttons[13]?.pressed) actionsPressed.moveDown = true;
                        if (gp.buttons[14]?.pressed) { actionsPressed.moveLeft = true; actionsPressed.moveHorizontalIntensity = -1; }
                        if (gp.buttons[15]?.pressed) { actionsPressed.moveRight = true; actionsPressed.moveHorizontalIntensity = 1; }
                    }
                    if (gp.axes && gp.axes.length >= 2) {
                        const x = gp.axes[0], y = gp.axes[1];
                        if (Math.abs(x) > 0.18) {
                            actionsPressed.moveHorizontalIntensity = x;
                            if (x > 0.18) actionsPressed.moveRight = true;
                            if (x < -0.18) actionsPressed.moveLeft = true;
                        }
                        if (Math.abs(y) > 0.18) {
                            if (y > 0.18) actionsPressed.moveDown = true;
                            if (y < -0.18) actionsPressed.moveUp = true;
                        }
                    }
                    if (gp.axes && gp.axes.length >= 4) {
                        const rx = gp.axes[2] || 0;
                        const ry = gp.axes[3] || 0;
                        if (Math.abs(rx) > 0.18) {
                            gamepadRightStick.x = ((Math.abs(rx) - 0.18) / 0.82) * Math.sign(rx);
                        }
                        if (Math.abs(ry) > 0.18) {
                            gamepadRightStick.y = ((Math.abs(ry) - 0.18) / 0.82) * Math.sign(ry);
                        }
                    }
                }
            }
            
            if (keysPressed['shift'] || keysPressed['shiftleft'] || keysPressed['shiftright'] || keysPressed['keyz']) {
                actionsPressed.run = true;
            }
            
            const joystickIntensityNow = joystickState.active ? (joystickState.distance / Math.max(1, joystickSize / 2)) : 0;
            const joystickUpNow = joystickState.active && joystickIntensityNow > 0.02 && joystickState.angle > -135 && joystickState.angle < -45;

            joystickUpPreviousFrame = joystickUpNow;

            if (joystickState.active) {
                if (!frameJoystickEvents.includes('move')) frameJoystickEvents.push('move');
                const angle = joystickState.angle;
                const angleRad = angle * (Math.PI / 180);
                const horizontalProjection = Math.cos(angleRad);
                const intensity = joystickIntensityNow;
                
                if (intensity > 0.02 && Math.abs(horizontalProjection) > 0.15) {
                   actionsPressed.moveHorizontalIntensity = horizontalProjection * intensity;
                   if (horizontalProjection > 0) {
                       actionsPressed.moveRight = true;
                       if (!frameJoystickEvents.includes('right')) frameJoystickEvents.push('right');
                   } else {
                       actionsPressed.moveLeft = true;
                       if (!frameJoystickEvents.includes('left')) frameJoystickEvents.push('left');
                   }
                }

                if (intensity > 0.02 && angle > 45 && angle < 135) {
                   actionsPressed.moveDown = true;
                   if (!frameJoystickEvents.includes('down')) frameJoystickEvents.push('down');
                }

                if (joystickUpNow) {
                    actionsPressed.moveUp = true;
                    if (!frameJoystickEvents.includes('up')) frameJoystickEvents.push('up');
                }
            }
            
            let keyboardHorizontal = 0;
            if (keysPressed['arrowleft'] || keysPressed['keya']) keyboardHorizontal -= 1;
            if (keysPressed['arrowright'] || keysPressed['keyd']) keyboardHorizontal += 1;
            
            if (keyboardHorizontal !== 0) {
                actionsPressed.moveHorizontalIntensity = keyboardHorizontal;
            }

            if (keysPressed['arrowleft'] || keysPressed['keya']) actionsPressed.moveLeft = true;
            if (keysPressed['arrowright'] || keysPressed['keyd']) actionsPressed.moveRight = true;
            if (keysPressed['arrowup'] || keysPressed['keyw']) actionsPressed.moveUp = true;
            if (keysPressed['arrowdown'] || keysPressed['keys']) actionsPressed.moveDown = true;
            if (keysPressed['space']) actionsPressed.jump = true;
            if (keysPressed['keyx']) actionsPressed.attack = true;

            // Handle single-press actions like jump and attack so holding the key/button doesn't trigger multiple jumps/attacks
            if (actionsPressed.jump) {
                if (!actionsPressed.jumpPressed) {
                    actionsPressed.jumpAction = true;
                    actionsPressed.jumpPressed = true;
                } else {
                    actionsPressed.jumpAction = false;
                }
            } else {
                actionsPressed.jumpPressed = false;
                actionsPressed.jumpAction = false;
            }

            if (actionsPressed.attack) {
                if (!actionsPressed.attackPressed) {
                    actionsPressed.attackAction = true;
                    actionsPressed.attackPressed = true;
                } else {
                    actionsPressed.attackAction = false;
                }
            } else {
                actionsPressed.attackPressed = false;
                actionsPressed.attackAction = false;
            }
            actionsPressed.runAction = actionsPressed.run;

            if (isCurrentScene3D) {
                stepAndRender3D(deltaTime, actionsPressed);
                frameCollisions = []; frameClicks = []; frameInteractions = []; frameJoystickEvents = []; frameTimerEvents = [];
                frameAttacks = []; frameKeyPresses = []; frameKeyReleases = []; frameObjectReleases = [];
                frameButtonDown = []; frameButtonUp = []; frameTriggerDown = []; frameTriggerUp = [];
                frameConsoleCommands = []; frameNetworkMessages = []; framePlayerJoined = false; framePlayerLeft = false;
                frameMatchFound = false; frameReceiveNetworkMessage = false; frameDialogueEnd = false;
                if (sceneGeneration === loopGen) {
                    animationFrameId = requestAnimationFrame(gameLoop);
                }
                return;
            }

            const controllablePlayers = gameObjects.filter(obj => 
                !obj.isUI && obj.behaviors?.some(b => b.name === 'PlatformerCharacter' || b.name === 'TopDownRPGMovement' )
            );
            const currentControlledId = selectedPlayerId !== null && controllablePlayers.some(p => p.id === selectedPlayerId)
                ? selectedPlayerId
                : controllablePlayers[0]?.id;

            gameObjects.forEach(obj => {
                const solidPre2D = Boolean(obj._solidUpdatedInPrepass);

                if (!solidPre2D && obj.followTarget) {
                    const target = gameObjects.find(o => o.name === obj.followTarget);
                    if (target) {
                        const dx = target.x - obj.x;
                        const dy = target.y - obj.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist > 5) {
                            const speed = obj.followSpeed || 100;
                            const vx = (dx / dist) * speed * deltaTime;
                            const vy = (dy / dist) * speed * deltaTime;
                            obj.x += vx;
                            obj.y += vy;
                        }
                    }
                }

                if (mpTagForJoin) {
                    const pNum = mpTagForJoin.properties?.playerNumber ?? 1;
                    if (!isPlayerJoined(pNum)) return;
                }

                if (obj.isProjectile) {
                    obj.x += (obj.vx || 0) * deltaTime;
                    obj.y += (obj.vy || 0) * deltaTime;
                    
                    if (obj.projectileLifetime !== undefined) {
                        obj.projectileLifetime -= deltaTime;
                        if (obj.projectileLifetime <= 0) {
                            setTimeout(() => {
                                gameObjects = gameObjects.filter(o => o.id !== obj.id);
                            }, 0);
                        }
                    }

                    // Check collisions with non-projectile objects
                    const projBox = getCollisionBox(obj);
                    for (const other of gameObjects) {
                        if (other.id !== obj.id && !other.isProjectile && !other.name.includes('Proyectil') && !other.behaviors?.some(b => b.name === 'Boss')) {
                            if (isColliding(projBox, getCollisionBox(other))) {
                                if (other.stats) {
                                    other.stats.hp = Math.max(0, (other.stats.hp || 100) - 10);
                                }
                                setTimeout(() => {
                                    gameObjects = gameObjects.filter(o => o.id !== obj.id);
                                }, 0);
                                break;
                            }
                        }
                    }
                    return; // Skip standard behavior / scripting for temporary bullet objects
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
                    const value = gameVariables[variableName] ?? 0;
                    obj.text = String(format).replace('{value}', String(value));
                }
                const textVarBehavior = obj.behaviors?.find(b => b.name === 'TextVariable');
                if (textVarBehavior) {
                    const { variableName = '', prefix = '', suffix = '' } = textVarBehavior.properties;
                    const value = variableName ? (gameVariables[variableName] ?? 0) : '';
                    obj.text = String(prefix || '') + String(value) + String(suffix || '');
                }

                const tweenPathBehavior = !solidPre2D ? obj.behaviors?.find(b => b.name === 'TweenPath') : undefined;
                if (tweenPathBehavior) {
                    const { speed = 100, loop = true, points: pointsStr = '0,0;100,100' } = tweenPathBehavior.properties;
                    const points = String(pointsStr).split(';').map((p) => { 
                        const parts = p.split(','); 
                        return { x: Number(parts[0] || 0), y: Number(parts[1] || 0) }; 
                    });
                    
                    if (obj.tweenPathIndex === undefined) obj.tweenPathIndex = 0;
                    if (obj.tweenPathProgress === undefined) obj.tweenPathProgress = 0;

                    const p1 = points[obj.tweenPathIndex];
                    const p2 = points[(obj.tweenPathIndex + 1) % points.length];
                    
                    if (p1 && p2) {
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
                            obj.x = p1.x + (p2.x - p1.x) * obj.tweenPathProgress;
                            obj.y = p1.y + (p2.y - p1.y) * obj.tweenPathProgress;
                        }
                    }
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

                    const playerObj = gameObjects.find(o => 
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
                            const projId = Date.now() + Math.floor(Math.random() * 1000);
                            const angle = Math.atan2(playerObj.y - obj.y, playerObj.x - obj.x);
                            const projVx = Math.cos(angle) * attackSpeed;
                            const projVy = Math.sin(angle) * attackSpeed;

                            const bossProjectile = {
                                id: projId,
                                name: obj.name + '_Proyectil',
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

                            gameObjects.push(bossProjectile);
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

                if (obj.pendingMovements) {
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

                if (dragging && dragging.objectId === obj.id) {
                    obj.vx = 0;
                    obj.vy = 0;
                    return;
                }

                if (obj.isUI) {
                    obj.x += (obj.vx || 0) * deltaTime;
                    obj.y += (obj.vy || 0) * deltaTime;
                    return;
                }

                const isCurrentControlled = obj.id === currentControlledId;

                
                const platformer = obj.behaviors?.find(b => b.name === 'PlatformerCharacter');
                const hasRPGMovement = obj.behaviors?.some(b => b.name === 'TopDownRPGMovement');
                const rpgMovement = obj.behaviors?.find(b => b.name === 'TopDownRPGMovement');

                const isControllable = isCurrentControlled;

                let activeActions = actionsPressed;
                

                if (platformer && !hasRPGMovement) {
                    let { speed, jumpForce } = platformer.properties;
                    if (obj._customRunActive && Number(obj._customRunSpeed) > 0) {
                        speed = Number(obj._customRunSpeed);
                    } else if (activeActions.run) {
                        speed = Number(obj._configuredSprintSpeed) > 0
                            ? Number(obj._configuredSprintSpeed)
                            : speed * 2;
                    }
                    
                    // Check ladder and climber behavior
                    const climber = obj.behaviors?.find(b => b.name === 'LadderClimber');
                    const ladders = gameObjects.filter(o => o.behaviors?.some(b => b.name === 'Ladder'));
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
                            const autoRunSpd2D = Number(obj._autoRunSpeed || 0);
                            if (hasHorizInput) {
                                obj.vx = (activeActions.moveHorizontalIntensity || 0) * speed;
                                obj._customVx = undefined;
                            } else if (autoRunSpd2D > 0) {
                                obj.vx = (obj.direction === 'left' ? -1 : 1) * autoRunSpd2D;
                            } else if (obj._customVx !== undefined) {
                                obj.vx = obj._customVx;
                            } else {
                                obj.vx = 0;
                            }
                            if ((obj.vx || 0) > 0) obj.direction = 'right';
                            if ((obj.vx || 0) < 0) obj.direction = 'left';

                            if (obj._customVy !== undefined) {
                                obj.vy = obj._customVy;
                                obj._customVy = undefined;
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
                        if (activeActions.attackAction) {
                            frameAttacks.push({ name: obj.name, id: obj.id });
                        }
                    } else {
                        if (obj._customVx !== undefined) {
                            obj.vx = obj._customVx;
                        } else if (obj.vx === undefined) {
                            obj.vx = 0;
                        }
                        if ((obj.vx || 0) > 0) obj.direction = 'right';
                        if ((obj.vx || 0) < 0) obj.direction = 'left';

                        if (obj._customVy !== undefined) {
                            obj.vy = obj._customVy;
                            obj._customVy = undefined;
                        }
                        if (obj.isClimbing) {
                            obj.vy = 0;
                        }
                    }
                }
                if (rpgMovement) {
                    let { speed } = rpgMovement.properties;
                    if (obj._customRunActive && Number(obj._customRunSpeed) > 0) {
                        speed = Number(obj._customRunSpeed);
                    } else if (activeActions.run) {
                        speed = Number(obj._configuredSprintSpeed) > 0
                            ? Number(obj._configuredSprintSpeed)
                            : speed * 2;
                    }
                    
                    if (isControllable) {
                        if (joystickState.active) {
                            const maxDistance = joystickSize / 2;
                            const intensity = joystickState.distance / maxDistance;
                            const angleRad = joystickState.angle * Math.PI / 180;
                            obj.vx = speed * intensity * Math.cos(angleRad);
                            obj.vy = speed * intensity * Math.sin(angleRad);
                            obj._customVx = undefined;
                            obj._customVy = undefined;
                            if (Math.abs(joystickState.angle) > 90) {
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

                            const autoRunSpdRpg = Number(obj._autoRunSpeed || 0);
                            if (inputVx !== 0 || inputVy !== 0) {
                                obj.vx = inputVx;
                                obj.vy = inputVy;
                                obj._customVx = undefined;
                                obj._customVy = undefined;
                            } else if (autoRunSpdRpg > 0) {
                                obj.vx = (obj.direction === 'left' ? -1 : 1) * autoRunSpdRpg;
                                obj.vy = 0;
                            } else {
                                if (obj._customVx !== undefined) {
                                    obj.vx = obj._customVx;
                                } else {
                                    obj.vx = 0;
                                }
                                if (obj._customVy !== undefined) {
                                    obj.vy = obj._customVy;
                                } else {
                                    obj.vy = 0;
                                }
                            }
                        }
                    } else {
                        if (obj._customVx !== undefined) {
                            obj.vx = obj._customVx;
                        } else if (obj.vx === undefined) {
                            obj.vx = 0;
                        }
                        if (obj._customVy !== undefined) {
                            obj.vy = obj._customVy;
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

                if (!platformer && !rpgMovement && Number(obj._autoRunSpeed || 0) > 0) {
                    obj.vx = (obj.direction === 'left' ? -1 : 1) * Number(obj._autoRunSpeed);
                }

                const physics = obj.behaviors?.find(b => ['Physics', 'PlatformerCharacter', 'Boss'].includes(b.name || ''));
                if ((rpgMovement || physics) && obj._standingPlatformId) {
                    const plat2D = objectsById.get(obj._standingPlatformId);
                    if (plat2D) {
                        const isSticky2D = !(plat2D.behaviors?.some(b => (b.name === 'Oscillate' || b.name === 'Patrol') && b.properties?.sticky === false));
                        if (isSticky2D && (rpgMovement || (obj.vy || 0) >= -5)) {
                            obj.x += plat2D._platformDx || 0;
                            obj.y += plat2D._platformDy || 0;
                        }
                    }
                }
                if (rpgMovement) {
                    obj.x += (obj.vx || 0) * deltaTime;
                    let currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                    let objWithAbsPosH = {...obj, ...currentAbsPos};
                    for (const solidShape of staticCollisionShapes) {
                        if (obj.id !== solidShape.owner.id) {
                            const hBoxRpg = getCollisionBox(objWithAbsPosH);
                            const pDyRpg = solidShape.owner._platformDy || 0;
                            const mtvH = getCollisionMTV2D(hBoxRpg, solidShape);
                            if (mtvH) {
                                 if (pDyRpg < -0.001 && (hBoxRpg.y + hBoxRpg.height) <= (solidShape.y - pDyRpg) + 8) {
                                     obj.y += (solidShape.y - hBoxRpg.height) - hBoxRpg.y;
                                     obj._standingPlatformId = solidShape.owner.id;
                                     currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                     objWithAbsPosH = {...obj, ...currentAbsPos};
                                     continue;
                                 }
                                 frameCollisions.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnHorizontalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                                 obj.x += mtvH.x;
                                 obj.y += mtvH.y;
                                 if (Math.abs(mtvH.x) >= Math.abs(mtvH.y)) obj.vx = 0;
                                 currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                 objWithAbsPosH = {...obj, ...currentAbsPos};
                            }
                        }
                    }
                    
                    obj._standingPlatformId = null;
                    obj.y += (obj.vy || 0) * deltaTime;
                    currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                    let objWithAbsPosV = {...obj, ...currentAbsPos};
                    for (const solidShape of staticCollisionShapes) {
                        if (obj.id !== solidShape.owner.id) {
                            const verticalBox = getCollisionBox(objWithAbsPosV);
                            const mtvV = getCollisionMTV2D(verticalBox, solidShape);
                            if (mtvV) {
                                 frameCollisions.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                                 obj.x += mtvV.x;
                                 obj.y += mtvV.y;
                                 if (mtvV.y < 0) {
                                     obj._standingPlatformId = solidShape.owner.id;
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
                            const pDy = solidShape.owner._platformDy || 0;
                            if (pDy < -0.001) {
                                const cBox = getCollisionBox(objWithAbsPos);
                                const overX = (cBox.x + 3) < (solidShape.x + solidShape.width) && (cBox.x + cBox.width - 3) > solidShape.x;
                                const prevTop = solidShape.y - pDy;
                                const feet = cBox.y + cBox.height;
                                if (overX && feet <= prevTop + 8 && feet > solidShape.y) {
                                    obj.y += (solidShape.y - cBox.height) - cBox.y;
                                    obj.vy = 0;
                                    obj.grounded = true;
                                    obj._standingPlatformId = solidShape.owner.id;
                                    currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                                    objWithAbsPos = {...obj, ...currentAbsPos};
                                }
                            }
                        }
                    }

                    obj.x += (obj.vx || 0) * deltaTime;
                    currentAbsPos = getObjectAbsolutePosition(obj.id, objectsById);
                    objWithAbsPos = {...obj, ...currentAbsPos};

                    for (const solidShape of staticCollisionShapes) {
                        if (obj.id !== solidShape.owner.id) {
                            const horizFullBox = getCollisionBox(objWithAbsPos);
                            const rotDegSolid = solidShape.owner.absRotation !== undefined ? solidShape.owner.absRotation : (solidShape.owner.rotation || 0);
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
                                halfH: Math.max(0.5, horizontalBox.halfH - shrinkAmountY)
                            };

                            const mtvH = getCollisionMTV2D(adjustedBoxH, solidShape);
                            if (mtvH) {
                                const platDy = solidShape.owner._platformDy || 0;
                                if ((obj.vy || 0) >= 0 && platDy < -0.001 && (horizontalBox.y + horizontalBox.height) <= (solidShape.y - platDy) + 8) {
                                    obj.y += (solidShape.y - horizontalBox.height) - horizontalBox.y;
                                    obj.vy = 0;
                                    obj.grounded = true;
                                    obj._standingPlatformId = solidShape.owner.id;
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
                                                halfH: Math.max(0.5, cStep.halfH - shrinkAmountY)
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
                                    frameCollisions.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnHorizontalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
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

                    obj.grounded = false;
                    obj._standingPlatformId = null;
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
                            const rotDegSolid = solidShape.owner.absRotation !== undefined ? solidShape.owner.absRotation : (solidShape.owner.rotation || 0);
                            const isRotatedSolid = Math.abs(rotDegSolid % 180) > 0.5 || !!(solidShape.owner.fixedColRotate || solidShape.owner.collision?.fixedColRotate);
                            
                            if (isRotatedSolid) {
                                const surfaceY = getRotatedSurfaceY(verticalBox.cx - verticalBox.halfW, verticalBox.halfW * 2, solidShape.owner);
                                if (surfaceY !== null) {
                                    const playerBottom = verticalBox.y + verticalBox.height;
                                    const fallMargin = wasGrounded2D
                                        ? Math.max(24, Math.abs(obj.vx || 0) * deltaTime * 1.8 + Math.abs(obj.vy || 0) * deltaTime + 16)
                                        : Math.max(20, Math.abs(obj.vy || 0) * deltaTime + 14);
                                    if ((obj.vy || 0) >= 0 && playerBottom >= surfaceY - 14 && playerBottom <= surfaceY + fallMargin) {
                                        frameCollisions.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                                        obj.y += (surfaceY - verticalBox.height) - verticalBox.y;
                                        obj.grounded = true;
                                        obj.doubleJumped = false;
                                        obj.vy = 0;
                                        obj._standingPlatformId = solidShape.owner.id;
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
                                halfW: Math.max(0.5, verticalBox.halfW - shrinkAmountX)
                            };

                            const mtvV = getCollisionMTV2D(adjustedBoxV, solidShape);
                            if (mtvV) {
                                frameCollisions.push({ obj1Name: obj.name, obj2Name: solidShape.owner.name, type: 'OnVerticalCollision', obj1Id: obj.id, obj2Id: solidShape.owner.id });
                                if (isRotatedSolid) {
                                    obj.x += mtvV.x;
                                    obj.y += mtvV.y;
                                    if (mtvV.y < -0.25 * mtvV.depth && (obj.vy || 0) >= 0) {
                                        obj.grounded = true;
                                        obj.doubleJumped = false;
                                        obj.vy = 0;
                                        obj._standingPlatformId = solidShape.owner.id;
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
                                        obj._standingPlatformId = solidShape.owner.id;
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
                    obj.x += (obj.vx || 0) * deltaTime;
                    obj.y += (obj.vy || 0) * deltaTime;
                }

                // Clamp to camera bounds if enabled and object is a player/moving character
                if (currentScene?.cameraBounds?.enabled && !obj.isUI) {
                    const hasMovement = (obj.behaviors || []).some(b => ['PlatformerCharacter', 'TopDownRPGMovement'].includes(b.name)) ||
                                        ['player', 'jugador', 'jugador_1', 'player_1'].includes(obj.name.toLowerCase());
                    if (hasMovement) {
                        const bounds = currentScene.cameraBounds;
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
                const clearAutoAnim2D = (onlyAir) => {
                    const currentAnim = activeAnimations.get(obj.id);
                    if (!currentAnim) return;
                    const animNameL = String(currentAnim.animation?.name || '').toLowerCase();
                    const isAirAnim = currentAnim.autoKind === 'air' ||
                        animNameL.includes('jump') || animNameL.includes('salto') || animNameL.includes('saltar') || animNameL.includes('brinco') ||
                        animNameL.includes('fall') || animNameL.includes('caer') || animNameL.includes('caida') || animNameL.includes('caída');
                    if (onlyAir ? (currentAnim.autoKind === 'air' || (isAirAnim && currentAnim.animation?.loop)) : currentAnim.animation?.loop) {
                        activeAnimations.delete(obj.id);
                        const originalObject = (currentScene?.gameObjects || []).find(o => o.id === obj.id);
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
                    const adaptPoseTo2D = (poseAnim) => {
                        if (!poseAnim || !poseAnim.frames || poseAnim.frames.length === 0) return null;
                        return {
                            id: poseAnim.id,
                            name: poseAnim.name,
                            loop: poseAnim.loop !== false,
                            frames: poseAnim.frames.map(f => ({
                                assetId: f.assetId || '',
                                imageUrl: f.imageUrl,
                                duration: Math.max(20, Number(f.duration) || 150),
                                x: (f.position?.x || 0) * 50,
                                y: -(f.position?.y || 0) * 50,
                                rotation: f.rotation?.z || f.rotation?.y || 0,
                                scaleX: f.scale?.x ?? 1,
                                scaleY: f.scale?.y ?? 1
                            }))
                        };
                    };
                    const resolve2DAnimByIdOrKeywords = (preferredId, keywords) => {
                        if (preferredId) {
                            const byId = allObjAnims2D.find(a => (String(a.id) === String(preferredId) || a.name === preferredId) && a.frames && a.frames.length > 0);
                            if (byId) return byId;
                            const poseMatch = (poseAnimations || []).find(p => (String(p.id) === String(preferredId) || p.name === preferredId) && p.frames && p.frames.length > 0);
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

                    const isAttackingNow = (isControllable && activeActions.attackAction) || frameAttacks.some(a => a.id === obj.id);
                    const nowTime = performance.now();

                    // 1. Resolve Attack Animation
                    if (isAttackingNow) {
                        const matchingAttackAnim = resolve2DAnimByIdOrKeywords(attackAnimId, ['attack', 'atacar', 'golpe']);

                        let attackDuration = 350;
                        if (matchingAttackAnim) {
                            attackDuration = matchingAttackAnim.frames.reduce((sum, f) => sum + Math.max(20, Number(f?.duration) || 100), 0);
                            if (attackDuration <= 0) attackDuration = 350;
                        }

                        obj.rpgAttackEndTime = nowTime + attackDuration;

                        if (matchingAttackAnim) {
                            const currentAnim = activeAnimations.get(obj.id);
                            if (!currentAnim || String(currentAnim.animation.id) !== String(matchingAttackAnim.id)) {
                                const animCopy = JSON.parse(JSON.stringify(matchingAttackAnim));
                                animCopy.loop = false;
                                activeAnimations.set(obj.id, {
                                    animation: animCopy,
                                    startTime: nowTime,
                                    startedContinuous: false,
                                    isOneShotProtected: true,
                                    isAutoAnim: true,
                                    autoKind: 'attack'
                                });
                            }
                        }
                    }

                    const isCurrentlyAttacking = nowTime < (obj.rpgAttackEndTime || 0);
                    const hasScriptAnimActive = obj._scriptAnimTime && (nowTime - obj._scriptAnimTime < 120);

                    if (!isCurrentlyAttacking && !hasScriptAnimActive) {
                        // 2. Resolve Jump / Fall Animation (Platformer only, when not grounded and not climbing)
                        const isJumpingState = platBehav && !obj.grounded && !obj.isClimbing;

                        if (isJumpingState) {
                            const isFalling2D = (obj.vy || 0) > 0.5;
                            let targetAirAnim = undefined;

                            if (isFalling2D) {
                                targetAirAnim = resolve2DAnimByIdOrKeywords(fallAnimId, ['fall', 'caer', 'caida', 'caída']) ||
                                    resolve2DAnimByIdOrKeywords(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']);
                            } else {
                                targetAirAnim = resolve2DAnimByIdOrKeywords(jumpAnimId, ['jump', 'salto', 'saltar', 'brinco']) ||
                                    resolve2DAnimByIdOrKeywords(fallAnimId, ['fall', 'caer', 'caida', 'caída']);
                            }

                            if (targetAirAnim) {
                                const currentAnim = activeAnimations.get(obj.id);
                                if (!currentAnim || String(currentAnim.animation.id) !== String(targetAirAnim.id)) {
                                    const animCopy = JSON.parse(JSON.stringify(targetAirAnim));
                                    animCopy.loop = true;
                                    activeAnimations.set(obj.id, {
                                        animation: animCopy,
                                        startTime: nowTime,
                                        startedContinuous: true,
                                        isOneShotProtected: false,
                                        isAutoAnim: true,
                                        autoKind: 'air'
                                    });
                                }
                            }
                        }
                        // 3. Resolve Running / Walking Animation
                        else if (Math.abs(obj.vx || 0) > 1 || (platBehav ? false : Math.abs(obj.vy || 0) > 1)) {
                            const matchingWalkAnim = resolve2DAnimByIdOrKeywords(runAnimId, ['walk', 'run', 'move', 'caminar', 'correr', 'moverse']);

                            if (matchingWalkAnim) {
                                const currentAnim = activeAnimations.get(obj.id);
                                if (!currentAnim || String(currentAnim.animation.id) !== String(matchingWalkAnim.id)) {
                                    const animCopy = JSON.parse(JSON.stringify(matchingWalkAnim));
                                    animCopy.loop = true;
                                    activeAnimations.set(obj.id, {
                                        animation: animCopy,
                                        startTime: nowTime,
                                        startedContinuous: true,
                                        isOneShotProtected: false,
                                        isAutoAnim: true,
                                        autoKind: 'run'
                                    });
                                }
                            } else {
                                clearAutoAnim2D(true);
                            }
                        }
                        // 4. Resolve Idle Animation
                        else {
                            const matchingIdleAnim = resolve2DAnimByIdOrKeywords(idleAnimId, ['idle', 'quieto', 'parado', 'stand', 'reposo']);

                            if (matchingIdleAnim) {
                                const currentAnim = activeAnimations.get(obj.id);
                                if (!currentAnim || String(currentAnim.animation.id) !== String(matchingIdleAnim.id)) {
                                    const animCopy = JSON.parse(JSON.stringify(matchingIdleAnim));
                                    animCopy.loop = true;
                                    activeAnimations.set(obj.id, {
                                        animation: animCopy,
                                        startTime: nowTime,
                                        startedContinuous: true,
                                        isOneShotProtected: false,
                                        isAutoAnim: true,
                                        autoKind: 'idle'
                                    });
                                }
                            } else {
                                clearAutoAnim2D(false);
                            }
                        }
                    }
                } else {
                    clearAutoAnim2D(false);
                }

                // Centralized Online Multiplayer sync for local player character in exported build
                if (socket && isControllable) {
                    const now = Date.now();
                    const stateString = JSON.stringify({
                        x: obj.x,
                        y: obj.y,
                        vx: obj.vx,
                        vy: obj.vy,
                        direction: obj.direction,
                        isClimbing: obj.isClimbing,
                        grounded: obj.grounded,
                        actions: activeActions
                    });
                    
                    const stateChanged = stateString !== lastEmittedState;
                    const timeElapsed = now - lastEmitTime;
                    
                    if (stateChanged || timeElapsed >= 40) {
                        lastEmitTime = now;
                        lastEmittedState = stateString;
                        
                        if (socket && typeof socket.emit === 'function') {
                            socket.emit('update-player', {
                                roomId: currentScene.name || 'default-room',
                                playerState: {
                                    x: obj.x,
                                    y: obj.y,
                                    vx: obj.vx,
                                    vy: obj.vy,
                                    direction: obj.direction,
                                    isClimbing: obj.isClimbing,
                                    grounded: obj.grounded,
                                    actions: activeActions
                                }
                            });
                        }
                    }
                }
            });

            const collidables = gameObjects.map(o => ({...o, ...getObjectAbsolutePosition(o.id, objectsById)})).filter(o => !o.isUI && (o.isTouchable ?? true));
            for (let i = 0; i < collidables.length; i++) {
                if (sceneGeneration !== loopGen) return;
                for (let j = i + 1; j < collidables.length; j++) {
                    if (sceneGeneration !== loopGen) return;
                    if (isColliding(getCollisionBox(collidables[i]), getCollisionBox(collidables[j]))) {
                        frameCollisions.push({ obj1Name: collidables[i].name, obj2Name: collidables[j].name, type: 'OnCollisionWith', obj1Id: collidables[i].id, obj2Id: collidables[j].id });
                        const o1 = gameObjects.find(o => o.id === collidables[i].id);
                        const o2 = gameObjects.find(o => o.id === collidables[j].id);
                        const targetsDict = {
                            [o1.name]: [o1],
                            [o2.name]: [o2]
                        };
                        o1?.scripts?.forEach(s => {
                            if (sceneGeneration !== loopGen) return;
                            const sId = s.id || s.trigger;
                            if (s.trigger === 'OnCollisionWith' && (!s.params?.targetObjectName || s.params.targetObjectName === o2?.name)) {
                                executeActionsSequential(s.actions, o1, false, deltaTime, false, targetsDict, \`obj-\${o1.id}-script-\${sId}\`);
                            }
                        });
                        if (sceneGeneration !== loopGen) return;
                        o2?.scripts?.forEach(s => {
                            if (sceneGeneration !== loopGen) return;
                            const sId = s.id || s.trigger;
                            if (s.trigger === 'OnCollisionWith' && (!s.params?.targetObjectName || s.params.targetObjectName === o1?.name)) {
                                executeActionsSequential(s.actions, o2, false, deltaTime, false, targetsDict, \`obj-\${o2.id}-script-\${sId}\`);
                            }
                        });
                        if (sceneGeneration !== loopGen) return;
                    }
                }
            }
            if (sceneGeneration !== loopGen) return;
            
            gameObjects.forEach(obj => {
                if (sceneGeneration !== loopGen) return;
                obj.scripts?.forEach(script => {
                    if (sceneGeneration !== loopGen) return;
                    const scriptId = script.id || script.trigger;
                    if (script.trigger === 'OnUpdate' || script.trigger === 'Always') {
                        executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, \`obj-\${obj.id}-script-\${scriptId}\`);
                    } else if (!['OnStart', 'OnClick', 'OnCollisionWith', 'OnTimerElapsed', 'OnObjectReleased'].includes(script.trigger)) {
                        const mockCond = { trigger: script.trigger, object: obj.name, params: script.params, target: script.params?.targetObjectName };
                        if (checkCondition(mockCond, obj)) {
                            executeActionsSequential(script.actions, obj, true, deltaTime, false, undefined, \`obj-\${obj.id}-script-\${scriptId}\`);
                        }
                    }
                });
                if (sceneGeneration !== loopGen) return;

                if (!obj._solidUpdatedInPrepass && obj.tweens) {
                    obj.tweens = obj.tweens.filter(tween => {
                        const elapsed = now - tween.startTime;
                        const progress = Math.min(1, elapsed / tween.duration);
                        
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
            });
            if (sceneGeneration !== loopGen) return;

            updateInteractables();

            evaluateEvents(deltaTime);
            if (sceneGeneration !== loopGen) return;
            stepActiveSequences(deltaTime);
            if (sceneGeneration !== loopGen) return;

            // Save end-of-frame solid positions for accurate platform carry on the next 2D frame
            gameObjects.forEach(s => {
                s._solidUpdatedInPrepass = false;
                if (!s.isUI && s.behaviors?.some(b => b.name === 'Solid')) {
                    s._lastSolidX = s.x;
                    s._lastSolidY = s.y;
                }
            });
            frameKeyPresses = [];
            frameKeyReleases = [];
            frameCollisions = []; frameClicks = []; frameObjectReleases = []; frameInteractions = []; frameTimerEvents = []; frameAttacks = []; frameDialogueEnd = false;

            stepActiveAnimations2D(now);
            
            gameObjects.forEach(obj => {
                if (obj.attackEndTime !== undefined && Date.now() < obj.attackEndTime) {
                    const remaining = obj.attackEndTime - Date.now();
                    const progress = Math.max(0, Math.min(1, remaining / 150));
                    const swingAngle = 45 * progress;
                    obj.animRotation = (obj.direction === 'left' ? -swingAngle : swingAngle);
                }
            });
            
            
            let followTarget = gameObjects.find(o => o.behaviors?.some(b => b.name === 'FollowCamera'));
            if (currentScene?.cameraBounds?.enabled) {
                const bounds = currentScene.cameraBounds;
                const zoomedWidth = canvas.width / camera.zoom;
                const zoomedHeight = canvas.height / camera.zoom;
                
                let targetX = bounds.x + bounds.width / 2;
                let targetY = bounds.y + bounds.height / 2;

                if (followTarget) {
                    const absPos = getObjectAbsolutePosition(followTarget.id, objectsById);
                    const followTargetWithAbsPos = {...followTarget, ...absPos};
                    const collisionBox = getCollisionBox(followTargetWithAbsPos);
                    targetX = collisionBox.x + collisionBox.width / 2;
                    targetY = collisionBox.y + collisionBox.height / 2;
                }

                if (bounds.width < zoomedWidth) {
                    camera.x = bounds.x + bounds.width / 2;
                } else {
                    const minCamX = bounds.x + zoomedWidth / 2;
                    const maxCamX = bounds.x + bounds.width - zoomedWidth / 2;
                    camera.x = Math.max(minCamX, Math.min(targetX, maxCamX));
                }

                if (bounds.height < zoomedHeight) {
                    camera.y = bounds.y + bounds.height / 2;
                } else {
                    const minCamY = bounds.y + zoomedHeight / 2;
                    const maxCamY = bounds.y + bounds.height - zoomedHeight / 2;
                    camera.y = Math.max(minCamY, Math.min(targetY, maxCamY));
                }
            } else if (followTarget) {
                const absPos = getObjectAbsolutePosition(followTarget.id, objectsById);
                const followTargetWithAbsPos = {...followTarget, ...absPos};
                const collisionBox = getCollisionBox(followTargetWithAbsPos);
                camera.x = collisionBox.x + collisionBox.width / 2;
                camera.y = collisionBox.y + collisionBox.height / 2;
            } else {
                camera.x = canvas.width / 2;
                camera.y = canvas.height / 2;
            }

            const isPixelArt = currentScene?.pixelArt === true || window.projectData?.pixelArt === true;
            const isSmoothGraphics = !isPixelArt;
            ctx.imageSmoothingEnabled = isSmoothGraphics;
            if (isSmoothGraphics) ctx.imageSmoothingQuality = 'high';
            ctx.fillStyle = runtimeBackgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.scale(camera.zoom, camera.zoom);
            ctx.translate(-camera.x, -camera.y);
            
            const allDrawable = gameObjects.map(o => {
                const absPos = getObjectAbsolutePosition(o.id, objectsById);
                return { ...o, absX: absPos.x, absY: absPos.y, absRotation: absPos.rotation };
            });
            
            allDrawable
                .filter(o => {
                    if (o.isUI) return false;
                    
                    if (mpTag) {
                        const pNum = mpTag.properties?.playerNumber ?? 1;
                        if (!isPlayerJoined(pNum)) return false;
                    }
                    return true;
                })
                .sort((a,b) => a.zIndex-b.zIndex)
                .forEach(obj => renderObject(ctx, obj));
            
            // Update and render floating feedbacks in camera space
            floatingFeedbacks.forEach(f => {
                f.x += f.vx * deltaTime;
                f.y += f.vy * deltaTime;
                f.lifetime -= deltaTime;
                f.opacity = Math.max(0, f.lifetime);
            });
            floatingFeedbacks = floatingFeedbacks.filter(f => f.lifetime > 0);

            floatingFeedbacks.forEach(f => {
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
            
            // Update the premium crisp HTML UI overlay with variable interpolation and image character mapping
            updateUIDOMElements();

            frameCollisions = [];
            frameClicks = [];
            frameInteractions = [];
            frameJoystickEvents = [];
            frameTimerEvents = [];
            frameAttacks = [];
            frameKeyPresses = [];
            frameKeyReleases = [];
            frameObjectReleases = [];
            frameButtonDown = [];
            frameButtonUp = [];
            frameTriggerDown = [];
            frameTriggerUp = [];
            frameConsoleCommands = [];
            frameNetworkMessages = [];
            framePlayerJoined = false;
            framePlayerLeft = false;
            frameMatchFound = false;
            frameReceiveNetworkMessage = false;
            frameDialogueEnd = false;

            if (sceneGeneration === loopGen) {
                animationFrameId = requestAnimationFrame(gameLoop);
            }
        };
        
        function renderObject(context, obj, isUI = false) {
            const tilemapBehavior = obj.behaviors?.find(b => b.name === 'Tilemap');
            if (tilemapBehavior && obj.imageUrl) {
                const img = imageCache.get(obj.imageUrl);
                if (img && img.complete) {
                    const { tileSize = 32, collisionData = '' } = tilemapBehavior.properties || {};
                    const rows = String(collisionData).split('\\n');
                    rows.forEach((row, y) => {
                        for (let x = 0; x < row.length; x++) {
                            if (row[x] !== ' ' && row[x] !== '0') {
                                context.drawImage(img, (obj.absX || obj.x) + x * tileSize, (obj.absY || obj.y) + y * tileSize, tileSize, tileSize);
                            }
                        }
                    });
                }
                return;
            }

            context.save();
            if (obj.visible === false) { context.restore(); return; }
            context.globalAlpha = obj.opacity ?? 1;

            const baseDrawX = obj.absX !== undefined ? obj.absX : (obj.x || 0);
            const baseDrawY = obj.absY !== undefined ? obj.absY : (obj.y || 0);
            const centerX = baseDrawX + obj.width / 2;
            const centerY = baseDrawY + obj.height / 2;
            context.translate(centerX + (obj.animOffsetX || 0), centerY + (obj.animOffsetY || 0));
            const rotDeg = obj.absRotation !== undefined ? obj.absRotation : ((obj.rotation || 0) + (obj.animRotation || 0));
            context.rotate(rotDeg * Math.PI / 180);
            const scaleX = (obj.scaleX ?? 1) * (obj.animScaleX ?? 1) * (obj.direction === 'left' ? -1 : 1);
            const scaleY = (obj.scaleY ?? 1) * (obj.animScaleY ?? 1) * (obj.flipY ? -1 : 1);
            context.scale(scaleX, scaleY);
            const drawX = -obj.width/2, drawY = -obj.height/2;

            if (obj.isHealthBar) {
                let targetObj = gameObjects.find(o => o.name === obj.healthBarTarget);
                if (!targetObj && obj.healthBarTarget) {
                    targetObj = gameObjects.find(o => o.name.toLowerCase().includes(obj.healthBarTarget.toLowerCase()));
                }
                if (!targetObj) {
                    targetObj = gameObjects.find(o => o.name.toLowerCase().includes('jugador') || o.name.toLowerCase().includes('player'));
                }
                if (!targetObj) {
                    targetObj = gameObjects.find(o => o.stats && typeof o.stats.hp === 'number');
                }

                const hp = targetObj?.stats?.hp ?? 100;
                const maxHp = targetObj?.stats?.maxHp ?? 100;
                const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));

                let barColor = '#10b981'; // green-500
                if (hpPercent < 25) {
                    barColor = '#ef4444'; // red-500
                } else if (hpPercent < 50) {
                    barColor = '#f59e0b'; // amber-500
                }

                // Draw background box
                context.fillStyle = 'rgba(15, 23, 42, 0.85)';
                context.fillRect(drawX, drawY, obj.width, obj.height);
                
                // Draw border
                context.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                context.lineWidth = 1;
                context.strokeRect(drawX, drawY, obj.width, obj.height);

                // Calculate inner dimensions
                const margin = 6;
                const contentWidth = obj.width - (margin * 2);

                // Draw Name Text (left-aligned)
                context.fillStyle = 'white';
                context.font = 'bold 11px sans-serif';
                context.textAlign = 'left';
                context.textBaseline = 'top';
                const nameStr = '❤️ ' + (targetObj ? targetObj.name : (obj.healthBarTarget || 'Jugador'));
                context.fillText(nameStr, drawX + margin, drawY + margin);

                // Draw Stats Text (right-aligned)
                context.fillStyle = '#cbd5e1';
                context.font = 'bold 11px monospace';
                context.textAlign = 'right';
                const statsStr = Math.round(hp) + '/' + maxHp;
                context.fillText(statsStr, drawX + obj.width - margin, drawY + margin);

                // Draw health bar container
                const barY = drawY + 22;
                const barHeight = 8;
                context.fillStyle = '#020617';
                context.fillRect(drawX + margin, barY, contentWidth, barHeight);

                // Draw filled health bar
                context.fillStyle = barColor;
                context.fillRect(drawX + margin, barY, contentWidth * (hpPercent / 100), barHeight);

                context.restore();
                return;
            }

            if (obj.videoUrl) {
                let video = videoCache.get(obj.videoUrl);
                if (!video) {
                    video = document.createElement('video');
                    video.muted = obj.videoMuted !== false;
                    video.playsInline = true;
                    video.setAttribute('webkit-playsinline', 'true');
                    video.loop = obj.videoLoop !== false;
                    video.src = obj.videoUrl;
                    video.load();
                    videoCache.set(obj.videoUrl, video);
                }
                if (video) {
                    if (video.paused && (obj.videoAutoplay ?? true) && video.dataset.playState !== 'paused') {
                        video.dataset.playState = 'playing';
                        video.play().catch(()=>{});
                    }
                    video.loop = obj.videoLoop !== false;
                    video.muted = obj.videoMuted !== false;
                    try { context.drawImage(video, drawX, drawY, obj.width, obj.height); } catch (e) {}
                }
            } else if (obj.imageUrl || obj.assetId) {
                let rawUrl = obj.imageUrl || '';
                if (!rawUrl && obj.assetId) {
                    const foundAsset = (assets || []).find(a => String(a.id) === String(obj.assetId));
                    if (foundAsset) rawUrl = foundAsset.url;
                }
                if (rawUrl && !rawUrl.startsWith('data:') && !rawUrl.startsWith('http://') && !rawUrl.startsWith('https://') && !rawUrl.startsWith('/')) {
                    const foundAsset = (assets || []).find(a => String(a.id) === String(rawUrl) || a.name === rawUrl);
                    if (foundAsset) rawUrl = foundAsset.url;
                }

                if (rawUrl) {
                    let img = imageCache.get(rawUrl) || (obj.imageUrl ? imageCache.get(obj.imageUrl) : undefined);
                    if (!img) {
                        img = new Image();
                        img.src = rawUrl;
                        imageCache.set(rawUrl, img);
                        if (obj.imageUrl) imageCache.set(obj.imageUrl, img);
                    }
                    if (img && img.complete && img.naturalWidth > 0) {
                        context.drawImage(img, drawX, drawY, obj.width, obj.height);
                    } else if (obj.color && obj.color !== 'transparent') {
                        context.fillStyle = obj.color;
                        context.fillRect(drawX, drawY, obj.width, obj.height);
                    }
                } else if (obj.color && obj.color !== 'transparent') {
                    context.fillStyle = obj.color;
                    context.fillRect(drawX, drawY, obj.width, obj.height);
                }
            } else if (obj.color !== 'transparent') {
                context.fillStyle = obj.color;
                context.fillRect(drawX, drawY, obj.width, obj.height);
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
                
                context.fillStyle = 'rgba(0,0,0,0.6)';
                context.fillRect(barX, barY, barWidth, barHeight);
                context.fillStyle = hpPercent > 0.5 ? '#22c55e' : (hpPercent > 0.25 ? '#eab308' : '#ef4444');
                context.fillRect(barX, barY, barWidth * hpPercent, barHeight);
            }

            if (obj.text) {
                if (scaleX < 0) context.scale(-1, 1);
                context.fillStyle = obj.textColor || (isUI ? 'white' : (obj.color === 'transparent' ? 'white' : 'black'));
                context.font = "bold " + (obj.fontSize || 16) + "px sans-serif";
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                let newText = obj.text;
                for (const key in gameVariables) newText = newText.replace(new RegExp('\\\\{' + key + '\\\\}', 'g'), String(gameVariables[key]));
                if (obj.variables) {
                    obj.variables.forEach(v => {
                        newText = newText.replace(new RegExp('\\\\{' + v.name + '\\\\}', 'g'), String(v.value));
                    });
                }
                context.fillText(newText, 0, 0);
            }
            context.restore();
        }

        let isGameStarted = false;

        function renderSingleFrame() {
            try {
                const isPixelArt = currentScene?.pixelArt === true || window.projectData?.pixelArt === true;
                ctx.imageSmoothingEnabled = !isPixelArt;
                if (!isPixelArt) ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = runtimeBackgroundColor || '#111827';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.scale(camera.zoom || 1, camera.zoom || 1);
                ctx.translate(-camera.x, -camera.y);
                const objectsById = new Map(gameObjects.map(o => [o.id, o]));
                const allDrawable = gameObjects.map(o => {
                    const absPos = getObjectAbsolutePosition(o.id, objectsById);
                    return { ...o, absX: absPos.x, absY: absPos.y, absRotation: absPos.rotation };
                });
                allDrawable
                    .filter(o => !o.isUI)
                    .sort((a,b) => (a.zIndex || 0) - (b.zIndex || 0))
                    .forEach(obj => renderObject(ctx, obj));
                ctx.restore();
                setupUI();
            } catch(e) {
                console.error('Error in renderSingleFrame:', e);
            }
        }

        function showGamepadNotification(msg) {
            const toast = document.getElementById('toast-notify');
            if (!toast) return;
            toast.textContent = msg;
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
            clearTimeout(toast._timer);
            toast._timer = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(-10px)';
            }, 3000);
        }

        function setupGamepadSupport() {
            window.addEventListener('gamepadconnected', (e) => {
                const gp = e.gamepad;
                const name = gp.id ? gp.id.split('(')[0].trim() : 'Gamepad';
                console.log('Gamepad Bluetooth / USB conectado:', gp.id);
                showGamepadNotification('🎮 ' + name + ' conectado');
                const indicator = document.getElementById('gamepad-status-indicator');
                if (indicator) {
                    indicator.innerHTML = '🎮 <b>' + name + '</b> listo. Presiona cualquier botón.';
                    indicator.style.borderColor = 'rgba(52, 211, 153, 0.6)';
                    indicator.style.color = '#6ee7b7';
                }
            });

            window.addEventListener('gamepaddisconnected', (e) => {
                console.log('Gamepad desconectado:', e.gamepad.id);
                showGamepadNotification('🎮 Gamepad desconectado');
                const indicator = document.getElementById('gamepad-status-indicator');
                if (indicator) {
                    indicator.innerHTML = '🎮 Gamepad (Bluetooth / USB) Compatible';
                    indicator.style.borderColor = 'rgba(129, 140, 248, 0.3)';
                    indicator.style.color = '#c7d2fe';
                }
            });
        }

        function pollStartGamepad() {
            if (isGameStarted) return;
            try {
                const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
                for (const gp of gamepads) {
                    if (!gp) continue;
                    if (gp.buttons && gp.buttons.some(b => b && (b.pressed || b.value > 0.5))) {
                        unlockAudioAndStart();
                        return;
                    }
                    if (gp.axes && gp.axes.some(a => Math.abs(a) > 0.5)) {
                        unlockAudioAndStart();
                        return;
                    }
                }
            } catch(e) {}
            if (!isGameStarted) {
                requestAnimationFrame(pollStartGamepad);
            }
        }

        function unlockAudioAndStart() {
            if (isGameStarted) return;
            isGameStarted = true;

            try {
                if (!window.audioContext) {
                    window.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (window.audioContext && window.audioContext.state === 'suspended') {
                    window.audioContext.resume().catch(()=>{});
                }
            } catch(e) {}

            const startScreen = document.getElementById('start-screen');
            if (startScreen) {
                startScreen.classList.add('hidden');
                setTimeout(() => {
                    try { startScreen.style.display = 'none'; } catch(e) {}
                }, 400);
            }

            if (currentScene?.backgroundMusicId && !backgroundMusicPlayer) {
                const musicAsset = (assets || []).find(a => String(a.id) === String(currentScene.backgroundMusicId) || a.url === currentScene.backgroundMusicId || a.name === currentScene.backgroundMusicId);
                const audioUrl = musicAsset ? musicAsset.url : currentScene.backgroundMusicId;
                if (audioUrl) {
                    try {
                        let cachedAudio = audioCache.get(audioUrl) || (musicAsset ? audioCache.get(musicAsset.id) : null);
                        const player = cachedAudio ? cachedAudio.cloneNode() : new Audio(audioUrl);
                        player.loop = true;
                        player.volume = 1;
                        backgroundMusicPlayer = player;
                        currentBackgroundMusicId = musicAsset ? musicAsset.id : currentScene.backgroundMusicId;
                        player.play().catch(()=>{});
                    } catch(e) {}
                }
            } else if (backgroundMusicPlayer) {
                backgroundMusicPlayer.play().catch(()=>{});
            }

            (currentScene?.events || []).forEach(e => {
                const hasOnStart = (e.conditions || []).some(c => c.trigger === 'OnStart');
                if (hasOnStart) {
                    evaluateSingleEvent(e, 0, { skipTrigger: 'OnStart', forceOneShot: true });
                }
            });
            gameObjects.forEach(o => o.scripts?.forEach(s => {
                if (s.trigger === 'OnStart') {
                    const sId = s.id || s.trigger;
                    executeActionsSequential(s.actions, o, false, 0, false, undefined, 'obj-' + o.id + '-script-' + sId);
                }
            }));

            if (!animationFrameId) {
                lastTime = performance.now();
                animationFrameId = requestAnimationFrame(gameLoop);
            }
            try { canvas.focus(); } catch(e) {}
        }

        function loadSceneByName(sceneName, savedState = null) {
            console.log('loadSceneByName called', sceneName, allScenes);
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            const sceneToLoad = allScenes.find(s => s.name === sceneName) || allScenes.find(s => s.id === sceneName) || allScenes[0];
            if (!sceneToLoad) {
                console.error('Scene not found:', sceneName);
                if (!animationFrameId) animationFrameId = requestAnimationFrame(gameLoop);
                return;
            }
            sceneGeneration++;
            sceneChangeRequested = false;
            sequenceStates.clear();
            activeInteractable = null;
            resetAllInputs(true);
            const prevInteractOv = document.getElementById('engine-interact-overlay');
            if (prevInteractOv) prevInteractOv.style.display = 'none';
            const prevInteractBtn = document.getElementById('engine-interact-btn');
            if (prevInteractBtn) prevInteractBtn.style.display = 'none';
            if (backgroundMusicPlayer) {
                try {
                    backgroundMusicPlayer.pause();
                    backgroundMusicPlayer.currentTime = 0;
                } catch(e) {}
                backgroundMusicPlayer = null;
                currentBackgroundMusicId = null;
            }

            lastTime = 0;
            currentScene = sceneToLoad;
            isCurrentScene3D = resolveSceneIs3D(currentScene);
            var initialOff = currentScene?.camera3DOffset ? { ...currentScene.camera3DOffset } : { x: 0, y: 5, z: 9 };
            var initDist = Math.hypot(initialOff.x || 0, initialOff.z || 9);
            camera3DRuntime = {
                mode: currentScene?.camera3DMode || '',
                offset: initialOff,
                targetObjectName: '',
                fogEnabled: !!currentScene?.fogEnabled,
                fogColor: currentScene?.fogColor || currentScene?.backgroundColor || '#111827',
                fogDensity: currentScene?.fogDensity ?? 0.02,
                ambientIntensity: currentScene?.ambientLightIntensity ?? 0.85,
                sunIntensity: currentScene?.sunLightIntensity ?? 1.55,
                sunColor: currentScene?.sunLightColor || '#fffbeb',
                skyboxImageUrl: currentScene?.skyboxImageUrl || '',
                movementEnabled: currentScene?.camera3DMovementEnabled !== false,
                rightStickEnabled: currentScene?.camera3DRightStickEnabled === true,
                rightStickSensitivity: currentScene?.camera3DRightStickSensitivity ?? 2.4,
                yaw: Math.atan2(initialOff.x || 0, initialOff.z || 9),
                pitch: Math.max(-0.35, Math.min(1.45, Math.atan2(initialOff.y ?? 5, Math.max(0.1, initDist || 9)))),
                fpPitch: 0,
                distance: Math.max(2.5, Math.min(35, initDist || 9)),
                isOrbiting: false,
                lastPointerX: 0,
                lastPointerY: 0,
                activePointers: new Map(),
                pinchDist: null,
                pinchBaseDistance: null
            };
            const div3d = document.getElementById('game3d-container');
            if (div3d) div3d.style.display = isCurrentScene3D ? 'block' : 'none';
            if (canvas) canvas.style.display = isCurrentScene3D ? 'none' : 'block';
            clearThreeMeshes();
            
            if (typeof io !== 'undefined' && window.MULTIPLAYER_SERVER) {
                if (!socket) {
                    socket = io(window.MULTIPLAYER_SERVER, { transports: ['websocket'] });
                    socket.on('player-assigned', (pNum) => {
                        myPlayerNumber = pNum;
                    });
                    socket.on('player-updated', ({ playerNumber, state }) => {
                        remotePlayers[playerNumber] = state;
                    });
                    socket.on('player-disconnected', ({ playerNumber }) => {
                        delete remotePlayers[playerNumber];
                    });
                } else {
                    socket.emit('join-room', currentScene.name || 'default-room');
                }
            }
            
            if (savedState) {
                gameObjects = sanitizeLoadedGameObjects(savedState.gameObjects || [], isCurrentScene3D);
                gameVariables = (savedState.gameVariables && typeof savedState.gameVariables === 'object')
                    ? JSON.parse(JSON.stringify(savedState.gameVariables))
                    : {};
                if (savedState.camera && typeof savedState.camera === 'object') {
                    camera = { ...camera, ...savedState.camera };
                }
                if (savedState.camera3DRuntime && camera3DRuntime) {
                    Object.assign(camera3DRuntime, savedState.camera3DRuntime);
                    camera3DRuntime.skyboxImageUrl = savedState.camera3DRuntime.skyboxImageUrl !== undefined
                        ? savedState.camera3DRuntime.skyboxImageUrl
                        : (currentScene?.skyboxImageUrl || '');
                    camera3DRuntime.activePointers = new Map();
                    camera3DRuntime.isOrbiting = false;
                    camera3DRuntime.pinchDist = null;
                    camera3DRuntime.pinchBaseDistance = null;
                }
                if (savedState.selectedPlayerId !== undefined) {
                    selectedPlayerId = savedState.selectedPlayerId;
                }
                runtimeBackgroundColor = savedState.backgroundColor || sceneToLoad.backgroundColor || '#111827';
                if (savedState.joystickEnabled !== undefined) {
                    const joyBase = document.getElementById('joystick-base');
                    if (joyBase) {
                        joyBase.style.display = savedState.joystickEnabled ? 'block' : 'none';
                    }
                }
                activePoseAnimations.clear();
                if (savedState.activePoseAnimations && Array.isArray(savedState.activePoseAnimations)) {
                    const nowPoseLoad = performance.now();
                    savedState.activePoseAnimations.forEach(item => {
                        if (item && item.id && item.poseAnimation) {
                            activePoseAnimations.set(item.id, {
                                poseAnimation: item.poseAnimation,
                                startTime: nowPoseLoad - (item.elapsedMs || 0),
                                loop: item.loop !== false,
                                speed: item.speed || 1,
                                origVisual: undefined
                            });
                        }
                    });
                }
            } else {
                runtimeBackgroundColor = currentScene?.backgroundColor || '#111827';
                let dZoom = Number(currentScene?.defaultZoom);
                if (isNaN(dZoom) || dZoom <= 0.01) dZoom = 1;
                camera.zoom = dZoom;
                gameObjects = JSON.parse(JSON.stringify((currentScene?.gameObjects || []).map(o => {
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
                    const initO = { ...o, vx: 0, vy: 0, grounded: false, vx3D: 0, vy3D: 0, vz3D: 0, grounded3D: false, _customVx: undefined, _customVy: undefined, rpgKnockbackVx: 0, rpgKnockbackVy: 0, pendingMovements: [], tweens: undefined, _pendingLoopImpulse3D: undefined, _burstImpulse3D: undefined, _effectiveVel3D: undefined, stats };
                    if (isCurrentScene3D && !initO.isUI) {
                        initO.position3D = getObject3DPosition(initO);
                        const dInitO = getObject3DDimensions(initO);
                        initO.scale3D = { x: dInitO.w, y: dInitO.h, z: dInitO.d };
                        initO.rotation3D = getObject3DRotation(initO);
                        sync3DTo2D(initO);
                    }
                    return initO;
                })));
                
                // Ensure global variables are initialized if not already present
                (window.projectData?.globalVariables || []).forEach(v => {
                    if (gameVariables[v.name] === undefined) gameVariables[v.name] = v.value;
                });
                activePoseAnimations.clear();
            }

            if (isGameStarted && currentScene?.backgroundMusicId) {
                const musicAsset = (assets || []).find(a => String(a.id) === String(currentScene.backgroundMusicId) || a.url === currentScene.backgroundMusicId || a.name === currentScene.backgroundMusicId);
                const audioUrl = musicAsset ? musicAsset.url : currentScene.backgroundMusicId;
                if (audioUrl) {
                    let cachedAudio = audioCache.get(audioUrl) || (musicAsset ? audioCache.get(musicAsset.id) : null);
                    try {
                        const player = cachedAudio ? cachedAudio.cloneNode() : new Audio(audioUrl);
                        player.loop = true;
                        player.volume = 1;
                        backgroundMusicPlayer = player;
                        currentBackgroundMusicId = musicAsset ? musicAsset.id : currentScene.backgroundMusicId;
                        const playPromise = player.play();
                        if (playPromise && typeof playPromise.catch === 'function') {
                            playPromise.catch(() => {
                                const playOnGesture = () => {
                                    if (backgroundMusicPlayer) {
                                        backgroundMusicPlayer.play().catch(()=>{});
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
                    } catch(err) {
                        console.error('Error playing scene background music:', err);
                    }
                }
            }

            activeAnimations.clear();
            timers.clear();
            intervals.clear();
            if (dialogueElement) dialogueElement.remove();
            dialogueElement = null;
            setupUI();
            if (savedState && savedState.joystickEnabled !== undefined) {
                const joyBaseAfterUI = document.getElementById('joystick-base');
                if (joyBaseAfterUI) {
                    joyBaseAfterUI.style.display = savedState.joystickEnabled ? 'block' : 'none';
                }
            }
            resetJoystick();
            if (!savedState && isGameStarted) {
                (currentScene?.events || []).forEach(e => {
                    const hasOnStart = (e.conditions || []).some(c => c.trigger === 'OnStart');
                    if (hasOnStart) {
                        evaluateSingleEvent(e, 0, { skipTrigger: 'OnStart', forceOneShot: true });
                    }
                });
                gameObjects.forEach(o => o.scripts?.forEach(s => {
                    if (s.trigger === 'OnStart') {
                        const sId = s.id || s.trigger;
                        executeActionsSequential(s.actions, o, false, 0, false, undefined, 'obj-' + o.id + '-script-' + sId);
                    }
                }));
            }
            updateUIDOMElements();
            if (isGameStarted) {
                animationFrameId = requestAnimationFrame(gameLoop);
            } else {
                renderSingleFrame();
            }
        }
        
        async function startGame(data) {
            console.log('startGame called', data);
            canvas.width = data.gameWidth || 1024;
            canvas.height = data.gameHeight || 768;
            allScenes = data.scenes || []; 
            assets = data.assets || []; 
            animations = data.animations || [];
            poseAnimations = data.poseAnimations || [];
            globalObjects = data.globalObjects || [];

            const firstScene = allScenes[0];
            
            const assetPromises = assets.map(asset => new Promise((resolve) => {
                const timeoutId = setTimeout(() => {
                    console.warn('Asset load timed out: ' + asset.url);
                    resolve();
                }, 1500); // 1.5s timeout per asset to prevent any hang!

                if (asset.type === 'image') {
                    const img = new Image();
                    img.onload = () => { 
                        imageCache.set(asset.url, img);
                        imageCache.set(asset.id, img);
                        if (asset.name) imageCache.set(asset.name, img);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    img.onerror = () => { 
                        console.error('Failed to load image: ' + asset.url);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    img.src = asset.url;
                    
                    // Animated GIF support: mount to DOM secretly so browser animates it!
                    if (asset.url.toLowerCase().includes('.gif') || asset.url.toLowerCase().startsWith('data:image/gif')) {
                        img.style.position = 'fixed';
                        img.style.left = '-9999px';
                        img.style.top = '0';
                        img.style.width = '1px';
                        img.style.height = '1px';
                        img.style.opacity = '0';
                        img.style.pointerEvents = 'none';
                        document.body.appendChild(img);
                    }
                } else if (asset.type === 'audio') {
                    const audio = new Audio();
                    audio.preload = 'auto';
                    audio.oncanplaythrough = () => { 
                        audioCache.set(asset.url, audio);
                        audioCache.set(asset.id, audio);
                        if (asset.name) audioCache.set(asset.name, audio);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    audio.onerror = () => { 
                        console.error('Failed to load audio: ' + asset.url);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    audio.src = asset.url;
                    audio.load();
                } else if (asset.type === 'video') {
                    const video = document.createElement('video');
                    video.preload = 'auto';
                    video.oncanplaythrough = () => {
                        video.muted = true; video.playsInline = true;
                        videoCache.set(asset.url, video);
                        videoCache.set(asset.id, video);
                        if (asset.name) videoCache.set(asset.name, video);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    video.onerror = () => { 
                        console.error('Failed to load video: ' + asset.url);
                        clearTimeout(timeoutId);
                        resolve(); 
                    };
                    video.src = asset.url; 
                    video.load();
                } else {
                    clearTimeout(timeoutId);
                    resolve();
                }
            }));

            await Promise.allSettled(assetPromises);

            // Preload 3D GLB/GLTF models so 3D animations never flicker a box placeholder on first frame
            const glbModelUrls = [];
            allScenes.forEach(sc => (sc.gameObjects || []).forEach(o => { if (o.modelUrl) glbModelUrls.push(o.modelUrl); }));
            globalObjects.forEach(o => { if (o.modelUrl) glbModelUrls.push(o.modelUrl); });
            assets.forEach(a => {
                if (a.url && (a.type === '3d-model' || a.type === 'model' || a.url.endsWith('.glb') || a.url.endsWith('.gltf'))) {
                    glbModelUrls.push(a.url);
                }
            });
            poseAnimations.forEach(pa => (pa.frames || []).forEach(f => { if (f.modelUrl) glbModelUrls.push(f.modelUrl); }));
            if (glbModelUrls.length > 0 && typeof preloadExportedGLTFs === 'function') {
                await Promise.race([
                    preloadExportedGLTFs(glbModelUrls),
                    new Promise(res => setTimeout(res, 2500))
                ]);
            }
            
            const preservedVars = { ...gameVariables };
            (data.globalVariables || []).forEach(v => {
                if (preservedVars[v.name] === undefined) preservedVars[v.name] = v.value;
            });
            gameVariables = preservedVars;
            
            const startingScene = (data.scenes && data.scenes.length > 0)
                ? (data.scenes.find(s => s.id === data.activeSceneId) || data.scenes[0])
                : null;
            if (startingScene) {
                loadSceneByName(startingScene.name);
            } else {
                if (!animationFrameId) animationFrameId = requestAnimationFrame(gameLoop);
            }
        }

        let frameKeyPresses = [];
        let frameKeyReleases = [];
        let frameObjectReleases = [];
        let pointerDownObject = null;
        let consoleActive = false;
        
        const showConsole = () => {
            consoleActive = true;
            setupConsoleUI();
        };

        const setupConsoleUI = () => {
             let consoleUI = document.getElementById('engine-console');
             if (!consoleUI) {
                 consoleUI = document.createElement('div');
                 consoleUI.id = 'engine-console';
                 consoleUI.style.position = 'fixed';
                 consoleUI.style.bottom = '20px';
                 consoleUI.style.left = '50%';
                 consoleUI.style.transform = 'translateX(-50%)';
                 consoleUI.style.width = '80%';
                 consoleUI.style.maxWidth = '600px';
                 consoleUI.style.backgroundColor = 'rgba(0,0,0,0.85)';
                 consoleUI.style.padding = '10px';
                 consoleUI.style.borderRadius = '8px';
                 consoleUI.style.zIndex = '2000000';
                 consoleUI.innerHTML = '<input id="console-input" type="text" style="width:100%; background:transparent; border:none; color:white; outline:none; font-family:monospace; font-size:16px;" placeholder="Ingresa comando...">';
                 document.body.appendChild(consoleUI);
                 
                 const input = consoleUI.querySelector('input');
                 input.addEventListener('keydown', (e) => {
                     if (e.key === 'Enter') {
                         const cmd = input.value.trim();
                         if (cmd) frameConsoleCommands.push(cmd);
                         input.value = '';
                         consoleActive = false;
                         consoleUI.style.display = 'none';
                     } else if (e.key === 'Escape') {
                         consoleActive = false;
                         consoleUI.style.display = 'none';
                     }
                     e.stopPropagation();
                 });
             }
             consoleUI.style.display = 'block';
             setTimeout(() => consoleUI.querySelector('input').focus(), 10);
        };

        window.addEventListener('keydown', (e) => { 
            if (e.key === 'Tab') {
                e.preventDefault();
                if (consoleActive) {
                    consoleActive = false;
                    document.getElementById('engine-console').style.display = 'none';
                } else {
                    showConsole();
                }
                return;
            }
            if (consoleActive) return;

            const key = e.key.toLowerCase();
            const code = e.code.toLowerCase();
            if (suppressedKeysUntilRelease.has(key) || suppressedKeysUntilRelease.has(code)) {
                if (e.repeat) return;
                suppressedKeysUntilRelease.delete(key);
                suppressedKeysUntilRelease.delete(code);
            } else if (e.repeat && !keysPressed[key] && !keysPressed[code]) {
                return;
            }
            if (key === 'e' && activeInteractable) {
                frameInteractions.push({
                    id: activeInteractable.id,
                    name: activeInteractable.name
                });
            }
            if (!keysPressed[key] && !keysPressed[code]) {
                frameKeyPresses.push(key);
                frameKeyPresses.push(code);
            }
            keysPressed[code] = true; 
            keysPressed[key] = true;
        });
        window.addEventListener('keyup', (e) => { 
            const code = e.code.toLowerCase();
            const key = e.key.toLowerCase();
            suppressedKeysUntilRelease.delete(key);
            suppressedKeysUntilRelease.delete(code);
            keysPressed[code] = false; 
            keysPressed[key] = false;
            frameKeyReleases.push(key);
            frameKeyReleases.push(code);
        });
        window.addEventListener('blur', () => resetAllInputs(false));
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) resetAllInputs(false);
        });
        
        const handlePointerDown = (e) => {
            if (!window.audioContext) {
                try { window.audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch(err) {}
            }
            if (window.audioContext?.state === 'suspended') window.audioContext.resume();

            if (dialogueElement) {
                const dCb2 = dialogueElement._onComplete;
                dialogueElement.remove();
                dialogueElement = null;
                frameDialogueEnd = true;
                if (typeof dCb2 === 'function') dCb2();
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX, mouseY = (e.clientY - rect.top) * scaleY;
            const objectsById = new Map(gameObjects.map(o => [o.id, o]));
            const worldMouseX = (mouseX / camera.zoom) + camera.x - (canvas.width / (2 * camera.zoom));
            const worldMouseY = (mouseY / camera.zoom) + camera.y - (canvas.height / (2 * camera.zoom));

            const clickedObject = [...gameObjects]
                .filter(o => o.visible !== false)
                .sort((a,b)=> (b.zIndex || 0) - (a.zIndex || 0))
                .find(obj => {
                const absPos = getObjectAbsolutePosition(obj.id, objectsById);
                const collisionBox = getCollisionBox({...obj, ...absPos});
                if (isObjectUI(obj, objectsById)) {
                    return mouseX >= absPos.x && mouseX <= absPos.x + obj.width &&
                           mouseY >= absPos.y && mouseY <= absPos.y + obj.height;
                }
                return worldMouseX >= collisionBox.x && worldMouseX <= collisionBox.x + collisionBox.width &&
                       worldMouseY >= collisionBox.y && worldMouseY <= collisionBox.y + collisionBox.height;
            });

            if (clickedObject) {
                pointerDownObject = { id: clickedObject.id, name: clickedObject.name };
                const chain = [];
                let curr = clickedObject;
                let safety = 100;
                while (curr && safety-- > 0) {
                    chain.push(curr);
                    if (!curr.parentId) break;
                    curr = objectsById.get(curr.parentId);
                }

                chain.forEach(o => {
                    frameClicks.push({ name: o.name, id: o.id });
                    o.scripts?.forEach(s => {
                        if (s.trigger === 'OnClick') {
                            const sId = s.id || s.trigger;
                            executeActionsSequential(s.actions, o, true, 0, false, undefined, \`obj-\${o.id}-script-\${sId}\`);
                        }
                    });
                });
                
                if (clickedObject.isDraggable) {
                    const isUI = !!clickedObject.isUI;
                    const clickPos = isUI ? { x: mouseX, y: mouseY } : { x: worldMouseX, y: worldMouseY };
                    dragging = {
                        objectId: clickedObject.id,
                        isUI: isUI,
                        offsetX: clickedObject.x - clickPos.x,
                        offsetY: clickedObject.y - clickPos.y,
                        initialX: clickedObject.x,
                        initialY: clickedObject.y
                    };
                }
            }
        };

        const handlePointerMove = (e) => {
            if (!dragging) return;
            const targetObj = gameObjects.find(o => o.id === dragging.objectId);
            if (!targetObj) { dragging = null; return; }

            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
            const mouseX = (e.clientX - rect.left) * scaleX, mouseY = (e.clientY - rect.top) * scaleY;
            const worldMouseX = (mouseX / camera.zoom) + camera.x - (canvas.width / (2 * camera.zoom));
            const worldMouseY = (mouseY / camera.zoom) + camera.y - (canvas.height / (2 * camera.zoom));

            const isUI = !!targetObj.isUI;
            const targetX = isUI ? mouseX : worldMouseX;
            const targetY = isUI ? mouseY : worldMouseY;

            let newX = targetX + dragging.offsetX;
            let newY = targetY + dragging.offsetY;

            if (targetObj.dragMinX != null) newX = Math.max(targetObj.dragMinX, newX);
            if (targetObj.dragMaxX != null) newX = Math.min(targetObj.dragMaxX, newX);
            if (targetObj.dragMinY != null) newY = Math.max(targetObj.dragMinY, newY);
            if (targetObj.dragMaxY != null) newY = Math.min(targetObj.dragMaxY, newY);

            if (!targetObj.dragXLocked) targetObj.x = Math.round(newX);
            if (!targetObj.dragYLocked) targetObj.y = Math.round(newY);
        };

        const handlePointerUp = () => {
            const releasedList = [];
            if (dragging && dragging.objectId) {
                const draggedObj = gameObjects.find(o => o.id === dragging.objectId);
                if (draggedObj) {
                    releasedList.push({ id: draggedObj.id, name: draggedObj.name });
                    draggedObj.vx = 0;
                    draggedObj.vy = 0;

                    if (draggedObj.dragDropBehavior === 'return' && dragging.initialX !== undefined) {
                        draggedObj.x = dragging.initialX;
                        draggedObj.y = dragging.initialY;
                    } else if (draggedObj.dragDropBehavior === 'random') {
                        const minX = draggedObj.dragRandomMinX ?? (draggedObj.dragMinX ?? 50);
                        const maxX = draggedObj.dragRandomMaxX ?? (draggedObj.dragMaxX ?? ((canvas?.width || 800) - draggedObj.width));
                        const minY = draggedObj.dragRandomMinY ?? (draggedObj.dragMinY ?? 50);
                        const maxY = draggedObj.dragRandomMaxY ?? (draggedObj.dragMaxY ?? ((canvas?.height || 600) - draggedObj.height));
                        draggedObj.x = Math.round(minX + Math.random() * Math.max(1, maxX - minX));
                        draggedObj.y = Math.round(minY + Math.random() * Math.max(1, maxY - minY));
                    }
                }
            }
            if (pointerDownObject) {
                if (!releasedList.some(r => r.id === pointerDownObject.id)) {
                    releasedList.push(pointerDownObject);
                }
            }
            releasedList.forEach(rel => {
                frameObjectReleases.push(rel);
                const obj = gameObjects.find(o => o.id === rel.id);
                if (obj && obj.scripts) {
                    obj.scripts.forEach(s => {
                        if (s.trigger === 'OnObjectReleased') {
                            const sId = s.id || s.trigger;
                            executeActionsSequential(s.actions, obj, true, 0, false, undefined, \`obj-\${obj.id}-script-\${sId}\`);
                        }
                    });
                }
            });
            dragging = null;
            pointerDownObject = null;
        };

        canvas.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        
        function stepActiveAnimations2D(now) {
            const getAnimFrameDuration = (f) => Math.max(20, Number(f?.duration) || 100);
            activeAnimations.forEach((activeAnim, objId) => {
                const obj = gameObjects.find(o => o.id === objId);
                if (!obj || !activeAnim.animation || !activeAnim.animation.frames || activeAnim.animation.frames.length === 0) {
                    activeAnimations.delete(objId);
                    return;
                }
                const totalDuration = activeAnim.animation.frames.reduce((sum, f) => sum + getAnimFrameDuration(f), 0);
                if (totalDuration <= 0) {
                    activeAnimations.delete(objId);
                    return;
                }
                const elapsed = now - activeAnim.startTime;
                if (elapsed >= totalDuration) {
                    if (activeAnim.animation.loop) {
                        activeAnim.startTime = now - (elapsed % totalDuration);
                    } else {
                        activeAnimations.delete(objId);
                        const originalObject = (currentScene?.gameObjects || []).find(o => o.id === objId);
                        if (originalObject) obj.imageUrl = originalObject.imageUrl;
                        obj.animOffsetX = 0;
                        obj.animOffsetY = 0;
                        obj.animRotation = 0;
                        obj.animScaleX = 1;
                        obj.animScaleY = 1;
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
                    else if (currentFrame.imageUrl) obj.imageUrl = currentFrame.imageUrl;
                    const lerp = (a, b, tt) => a + (b - a) * tt;
                    const shouldInterpolate = activeAnim.animation.loop || currentFrameIndex < activeAnim.animation.frames.length - 1;
                    obj.animOffsetX = shouldInterpolate ? lerp(currentFrame.x ?? 0, nextFrame.x ?? currentFrame.x ?? 0, t) : (currentFrame.x ?? 0);
                    obj.animOffsetY = shouldInterpolate ? lerp(currentFrame.y ?? 0, nextFrame.y ?? currentFrame.y ?? 0, t) : (currentFrame.y ?? 0);
                    obj.animRotation = shouldInterpolate ? lerp(currentFrame.rotation ?? 0, nextFrame.rotation ?? currentFrame.rotation ?? 0, t) : (currentFrame.rotation ?? 0);
                    obj.animScaleX = shouldInterpolate ? lerp(currentFrame.scaleX ?? 1, nextFrame.scaleX ?? currentFrame.scaleX ?? 1, t) : (currentFrame.scaleX ?? 1);
                    obj.animScaleY = shouldInterpolate ? lerp(currentFrame.scaleY ?? 1, nextFrame.scaleY ?? currentFrame.scaleY ?? 1, t) : (currentFrame.scaleY ?? 1);
                }
            });
        }

        function resolveUIImageUrl(obj) {
            let url = obj.imageUrl || '';
            if (!url && obj.assetId) {
                const foundAsset = assets.find(a => String(a.id) === String(obj.assetId));
                if (foundAsset) url = foundAsset.url;
            }
            if (url && !url.startsWith('data:') && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/') && !url.startsWith('assets/')) {
                const foundByName = assets.find(a => String(a.id) === String(url) || a.name === url);
                if (foundByName) url = foundByName.url;
            }
            return url;
        }

        function createUIElementDOM(obj, uiContainer) {
            const isControlButton = Boolean((obj.controlAction && obj.controlAction !== 'none') || (obj.name || '').toLowerCase().includes('btn') || (obj.name || '').toLowerCase().includes('boton') || (obj.name || '').toLowerCase().includes('button'));
            const hasClickScript = Boolean(obj.scripts && obj.scripts.some(s => s.trigger === 'OnClick'));
            const hasEventClick = Boolean(currentScene?.events && currentScene.events.some(evt => evt.conditions && evt.conditions.some(c => (c.trigger === 'OnObjectClicked' || c.trigger === 'OnClick') && (c.object === obj.name || (!c.object && c.id === obj.id)))));
            const isInteractive = isControlButton || hasClickScript || hasEventClick;

            const elem = document.createElement(isControlButton ? 'button' : 'div');
            elem.id = 'ui-elem-' + obj.id;
            elem.dataset.isControlButton = isControlButton ? '1' : '0';
            elem.style.position = 'absolute';
            elem.style.display = 'flex';
            elem.style.alignItems = 'center';
            elem.style.justifyContent = 'center';
            elem.style.color = obj.textColor || 'white';
            elem.style.borderRadius = '8px';
            elem.style.userSelect = 'none';
            elem.style.touchAction = 'none';
            elem.style.outline = 'none';
            elem.style.transformOrigin = 'center center';
            elem.style.overflow = obj.videoUrl ? 'hidden' : 'visible';

            if (isControlButton) {
                elem.style.border = obj.imageUrl ? 'none' : '2px solid rgba(255,255,255,0.3)';
                elem.style.cursor = 'pointer';
            } else {
                elem.style.border = 'none';
                elem.style.pointerEvents = isInteractive ? 'auto' : 'none';
                if (isInteractive) elem.style.cursor = 'pointer';
            }

            if (obj.isHealthBar) {
                elem.style.flexDirection = 'column';
                elem.style.alignItems = 'stretch';
                elem.style.backgroundColor = 'rgba(15, 23, 42, 0.85)';
                elem.style.border = '1px solid rgba(255, 255, 255, 0.15)';
                elem.style.padding = '6px 8px';
                elem.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.3)';
                elem.style.pointerEvents = 'none';
                elem.innerHTML = '<div class="hp-label" style="display: flex; align-items: center; justify-content: space-between; text-align: left; font-size: 11px; font-weight: bold; color: white; margin-bottom: 6px; font-family: sans-serif; width: 100%;">❤️ ' + (obj.healthBarTarget || 'Jugador') + '</div><div class="hp-track" style="width: 100%; background-color: #020617; border-radius: 9999px; height: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05); position: relative;"><div class="hp-fill" style="width: 100%; height: 100%; border-radius: 9999px; background-color: #10b981; transition: width 0.3s ease;"></div></div>';
            } else {
                const textInner = document.createElement('div');
                textInner.className = 'text-inner';
                textInner.style.position = 'relative';
                textInner.style.zIndex = '2';
                textInner.style.width = '100%';
                textInner.style.height = '100%';
                textInner.style.display = 'flex';
                textInner.style.alignItems = 'center';
                textInner.style.justifyContent = 'center';
                elem.appendChild(textInner);
            }

            const joyBaseEl = document.getElementById('joystick-base');
            if (joyBaseEl && joyBaseEl.parentNode === uiContainer) {
                uiContainer.insertBefore(elem, joyBaseEl);
            } else {
                uiContainer.appendChild(elem);
            }

            if (isControlButton && obj.controlAction && obj.controlAction !== 'none') {
                const handlePress = e => {
                    e.preventDefault();
                    actionsPressed[obj.controlAction] = true;
                    actionsPressed[obj.controlAction + '_ui'] = true;
                };
                const handleRelease = e => {
                    e.preventDefault();
                    actionsPressed[obj.controlAction] = false;
                    actionsPressed[obj.controlAction + '_ui'] = false;
                };
                elem.addEventListener('mousedown', handlePress);
                elem.addEventListener('mouseup', handleRelease);
                elem.addEventListener('mouseleave', handleRelease);
                elem.addEventListener('touchstart', handlePress, { passive: false });
                elem.addEventListener('touchend', handleRelease, { passive: false });
                elem.addEventListener('touchcancel', handleRelease, { passive: false });
            }

            let lastClickTime = 0;
            const handleUIClick = (e) => {
                if (e.type === 'click' && e.pointerType === 'touch') return;
                const nowClk = Date.now();
                if (nowClk - lastClickTime < 150) return;
                lastClickTime = nowClk;
                if (!window.audioContext) {
                    try { window.audioContext = new (window.AudioContext || window.webkitAudioContext)(); } catch(err) {}
                }
                if (window.audioContext?.state === 'suspended') window.audioContext.resume();

                const objectsById = new Map(gameObjects.map(o => [o.id, o]));
                const chain = [];
                let curr = obj;
                let safety = 100;
                while (curr && safety-- > 0) {
                    chain.push(curr);
                    if (!curr.parentId) break;
                    curr = objectsById.get(curr.parentId);
                }

                chain.forEach(o => {
                    frameClicks.push({ name: o.name, id: o.id });
                    o.scripts?.forEach(s => {
                        if (s.trigger === 'OnClick') {
                            const sId = s.id || s.trigger;
                            executeActionsSequential(s.actions, o, false, 0, false, undefined, 'obj-' + o.id + '-script-' + sId);
                        }
                    });
                });
            };
            if (isInteractive) {
                elem.style.pointerEvents = 'auto';
                elem.style.cursor = 'pointer';
                elem.addEventListener('pointerdown', handleUIClick);
            }
            return elem;
        }

        function setupUI() {
            const uiContainer = document.getElementById('ui-container');
            if (!uiContainer) return;
            uiContainer.innerHTML = '';
            activeJoystickBase = null;
            activeJoystickHandle = null;
            
            const uiControls = gameObjects.filter(o => o.isUI);
            uiControls.forEach(obj => {
                createUIElementDOM(obj, uiContainer);
            });
            
            const joyConfig = window.projectData?.joystick || { enabled: false, size: 120, position: 'left' };
            if (joyConfig) {
                joystickSize = joyConfig.size || 120;
                const joystickBase = document.createElement('div');
                joystickBase.id = 'joystick-base';
                joystickBase.style.display = joyConfig.enabled ? 'block' : 'none';
                const joystickHandle = document.createElement('div');
                joystickHandle.id = 'joystick-handle';
                const handleSize = joystickSize / 2.4;
                
                joystickBase.style.position = 'absolute';
                joystickBase.style.bottom = '40px';
                joystickBase.style[joyConfig.position || 'left'] = '40px';
                joystickBase.style.width = joystickSize + 'px';
                joystickBase.style.height = joystickSize + 'px';
                joystickBase.style.backgroundColor = joyConfig.backgroundImageUrl ? 'transparent' : 'rgba(255, 255, 255, ' + (joyConfig.opacity ?? 0.1) + ')';
                if (joyConfig.backgroundImageUrl) {
                    joystickBase.style.backgroundImage = 'url(' + joyConfig.backgroundImageUrl + ')';
                    joystickBase.style.backgroundSize = 'cover';
                    joystickBase.style.backgroundPosition = 'center';
                }
                joystickBase.style.borderRadius = '50%';
                joystickBase.style.pointerEvents = 'auto';
                joystickBase.style.userSelect = 'none';
                joystickBase.style.touchAction = 'none';

                joystickHandle.style.position = 'absolute';
                joystickHandle.style.width = handleSize + 'px';
                joystickHandle.style.height = handleSize + 'px';
                joystickHandle.style.backgroundColor = joyConfig.handleImageUrl ? 'transparent' : 'rgba(255, 255, 255, 0.3)';
                if (joyConfig.handleImageUrl) {
                    joystickHandle.style.backgroundImage = 'url(' + joyConfig.handleImageUrl + ')';
                    joystickHandle.style.backgroundSize = 'cover';
                    joystickHandle.style.backgroundPosition = 'center';
                }
                joystickHandle.style.borderRadius = '50%';
                joystickHandle.style.left = 'calc(50% - ' + (handleSize / 2) + 'px)';
                joystickHandle.style.top = 'calc(50% - ' + (handleSize / 2) + 'px)';
                joystickHandle.style.transition = 'transform 50ms linear';
                joystickHandle.style.pointerEvents = 'none';

                joystickBase.appendChild(joystickHandle);
                uiContainer.appendChild(joystickBase);
                activeJoystickBase = joystickBase;
                activeJoystickHandle = joystickHandle;
                updateJoystickVisualsDOM();

                joystickBase.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const touch = e.changedTouches[0];
                    if (touch) {
                        joystickPointerId = null;
                        joystickTouchId = touch.identifier;
                        updateJoystickFromClient(touch.clientX, touch.clientY);
                    }
                }, { passive: false });

                joystickBase.addEventListener('pointerdown', (e) => {
                    if (e.pointerType === 'touch') return;
                    e.preventDefault();
                    e.stopPropagation();
                    joystickTouchId = null;
                    joystickPointerId = e.pointerId;
                    updateJoystickFromClient(e.clientX, e.clientY);
                });

                if (!joystickWindowListenersAttached) {
                    joystickWindowListenersAttached = true;

                    const handleJoystickTouchMove = (e) => {
                        if (joystickTouchId !== null) {
                            let matchedTouch = null;
                            for (let i = 0; i < e.changedTouches.length; i++) {
                                if (e.changedTouches[i].identifier === joystickTouchId) {
                                    matchedTouch = e.changedTouches[i];
                                    break;
                                }
                            }
                            if (!matchedTouch && e.touches) {
                                for (let i = 0; i < e.touches.length; i++) {
                                    if (e.touches[i].identifier === joystickTouchId) {
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
                            if (e.touches && !Array.from(e.touches).some(t => t.identifier === joystickTouchId)) {
                                resetJoystick();
                            }
                        }
                    };

                    const handleJoystickTouchEndOrCancel = (e) => {
                        if (joystickTouchId !== null) {
                            let ended = false;
                            for (let i = 0; i < e.changedTouches.length; i++) {
                                if (e.changedTouches[i].identifier === joystickTouchId) {
                                    ended = true;
                                    break;
                                }
                            }
                            if (!ended && (!e.touches || !Array.from(e.touches).some(t => t.identifier === joystickTouchId))) {
                                ended = true;
                            }
                            if (ended) {
                                e.preventDefault();
                                resetJoystick();
                            }
                        }
                    };

                    const handleJoystickPointerMove = (e) => {
                        if (joystickPointerId !== null && e.pointerId === joystickPointerId) {
                            if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
                                resetJoystick();
                                return;
                            }
                            updateJoystickFromClient(e.clientX, e.clientY);
                        }
                    };

                    const handleJoystickPointerEnd = (e) => {
                        if (joystickPointerId !== null && e.pointerId === joystickPointerId) {
                            resetJoystick();
                        }
                    };

                    window.addEventListener('touchmove', handleJoystickTouchMove, { passive: false });
                    window.addEventListener('touchend', handleJoystickTouchEndOrCancel, { passive: false, capture: true });
                    window.addEventListener('touchcancel', handleJoystickTouchEndOrCancel, { passive: false, capture: true });
                    window.addEventListener('pointermove', handleJoystickPointerMove);
                    window.addEventListener('pointerup', handleJoystickPointerEnd, { capture: true });
                    window.addEventListener('pointercancel', handleJoystickPointerEnd, { capture: true });
                }
            }
        }

        function updateUIDOMElements() {
            const uiContainer = document.getElementById('ui-container');
            if (!uiContainer) return;
            const uiControls = gameObjects.filter(o => o.isUI);
            const activeUiIds = new Set(uiControls.map(o => 'ui-elem-' + o.id));
            Array.from(uiContainer.children).forEach(child => {
                if (child.id && child.id.startsWith('ui-elem-') && !activeUiIds.has(child.id)) {
                    child.remove();
                }
            });

            const gameW = window.projectData?.gameWidth || 1024;
            const gameH = window.projectData?.gameHeight || 768;
            const scaleX = uiContainer.clientWidth / gameW;
            const scaleY = uiContainer.clientHeight / gameH;
            
            uiControls.forEach(obj => {
                let elem = document.getElementById('ui-elem-' + obj.id);
                if (!elem) {
                    elem = createUIElementDOM(obj, uiContainer);
                }
                if (!elem) return;
                
                const dispStr = obj.visible === false ? 'none' : 'flex';
                if (elem.dataset.lastDisplay !== dispStr) {
                    elem.dataset.lastDisplay = dispStr;
                    elem.style.display = dispStr;
                }
                if (obj.visible === false) return;

                const uiX = (obj.x || 0) + (obj.animOffsetX || 0);
                const uiY = (obj.y || 0) + (obj.animOffsetY || 0);
                const sx = (obj.scaleX !== undefined ? obj.scaleX : 1) * (obj.animScaleX !== undefined ? obj.animScaleX : 1) * (obj.direction === 'left' ? -1 : 1);
                const sy = (obj.scaleY !== undefined ? obj.scaleY : 1) * (obj.animScaleY !== undefined ? obj.animScaleY : 1) * (obj.flipY ? -1 : 1);
                const rot = (obj.rotation || 0) + (obj.animRotation || 0);

                const leftStr = (uiX * scaleX).toFixed(2) + 'px';
                const topStr = (uiY * scaleY).toFixed(2) + 'px';
                const widthStr = ((obj.width || 50) * scaleX).toFixed(2) + 'px';
                const heightStr = ((obj.height || 50) * scaleY).toFixed(2) + 'px';
                const zStr = String(obj.zIndex ?? 0);
                const opStr = String(obj.opacity ?? 1);
                const transStr = 'rotate(' + rot + 'deg) scale(' + sx + ', ' + sy + ')';

                if (elem.dataset.lastLeft !== leftStr) { elem.dataset.lastLeft = leftStr; elem.style.left = leftStr; }
                if (elem.dataset.lastTop !== topStr) { elem.dataset.lastTop = topStr; elem.style.top = topStr; }
                if (elem.dataset.lastWidth !== widthStr) { elem.dataset.lastWidth = widthStr; elem.style.width = widthStr; }
                if (elem.dataset.lastHeight !== heightStr) { elem.dataset.lastHeight = heightStr; elem.style.height = heightStr; }
                if (elem.dataset.lastZIndex !== zStr) { elem.dataset.lastZIndex = zStr; elem.style.zIndex = zStr; }
                if (elem.dataset.lastOpacity !== opStr) { elem.dataset.lastOpacity = opStr; elem.style.opacity = opStr; }
                if (!elem.dataset.originSet) { elem.dataset.originSet = '1'; elem.style.transformOrigin = 'center center'; }
                if (elem.dataset.lastTransform !== transStr) { elem.dataset.lastTransform = transStr; elem.style.transform = transStr; }

                const resolvedBg = obj.videoUrl ? '' : resolveUIImageUrl(obj);
                if (elem.dataset.currentBgUrl !== resolvedBg) {
                    elem.dataset.currentBgUrl = resolvedBg;
                    if (resolvedBg) {
                        elem.style.backgroundImage = 'url("' + resolvedBg.replace(/"/g, '\\"') + '")';
                        elem.style.backgroundSize = '100% 100%';
                        elem.style.backgroundRepeat = 'no-repeat';
                        elem.style.backgroundPosition = 'center';
                    } else {
                        elem.style.backgroundImage = 'none';
                    }
                }

                if (obj.videoUrl) {
                    let vidEl = elem.querySelector('video.ui-video-bg');
                    if (!vidEl) {
                        vidEl = document.createElement('video');
                        vidEl.className = 'ui-video-bg';
                        vidEl.autoplay = obj.videoAutoplay !== false;
                        vidEl.loop = obj.videoLoop !== false;
                        vidEl.muted = obj.videoMuted !== false;
                        vidEl.playsInline = true;
                        vidEl.style.position = 'absolute';
                        vidEl.style.inset = '0';
                        vidEl.style.width = '100%';
                        vidEl.style.height = '100%';
                        vidEl.style.objectFit = 'fill';
                        vidEl.style.pointerEvents = 'none';
                        elem.insertBefore(vidEl, elem.firstChild);
                    }
                    if (vidEl.dataset.srcUrl !== obj.videoUrl) {
                        vidEl.dataset.srcUrl = obj.videoUrl;
                        vidEl.src = obj.videoUrl;
                    }
                }

                if (!obj.isHealthBar) {
                    if (resolvedBg || obj.videoUrl) {
                        elem.style.backgroundColor = 'transparent';
                        if (elem.dataset.isControlButton === '1') elem.style.border = 'none';
                    } else if (elem.dataset.isControlButton === '1') {
                        elem.style.backgroundColor = (obj.color && obj.color !== 'transparent') ? obj.color : 'rgba(0,0,0,0.4)';
                        elem.style.border = '2px solid rgba(255,255,255,0.3)';
                    } else {
                        elem.style.backgroundColor = (obj.color && obj.color !== 'transparent') ? obj.color : 'transparent';
                    }
                }
                
                const scBehUI = (obj.behaviors || []).find(b => b.name === 'ScoreCounter');
                if (scBehUI) {
                    const varN = String(scBehUI.properties?.variableName || 'score').trim() || 'score';
                    const fmt = scBehUI.properties?.format || 'Score: {value}';
                    const val = gameVariables[varN] ?? 0;
                    obj.text = String(fmt).replace('{value}', String(val));
                }
                const tvBehUI = (obj.behaviors || []).find(b => b.name === 'TextVariable');
                if (tvBehUI) {
                    const varN = String(tvBehUI.properties?.variableName || '').trim();
                    const prefix = tvBehUI.properties?.prefix || '';
                    const suffix = tvBehUI.properties?.suffix || '';
                    const val = varN ? (gameVariables[varN] ?? 0) : '';
                    obj.text = String(prefix || '') + String(val) + String(suffix || '');
                }

                if (obj.isHealthBar) {
                    let targetObj = gameObjects.find(o => o.name === obj.healthBarTarget);
                    if (!targetObj && obj.healthBarTarget) {
                        targetObj = gameObjects.find(o => o.name.toLowerCase().includes(obj.healthBarTarget.toLowerCase()));
                    }
                    if (!targetObj) {
                        targetObj = gameObjects.find(o => o.name.toLowerCase().includes('jugador') || o.name.toLowerCase().includes('player'));
                    }
                    if (!targetObj) {
                        targetObj = gameObjects.find(o => o.stats && typeof o.stats.hp === 'number');
                    }
                    
                    const hp = targetObj?.stats?.hp ?? 100;
                    const maxHp = targetObj?.stats?.maxHp ?? 100;
                    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
                    
                    const labelElem = elem.querySelector('.hp-label');
                    const fillElem = elem.querySelector('.hp-fill');
                    const hpCacheKey = (targetObj ? targetObj.name : (obj.healthBarTarget || 'Jugador')) + '|' + Math.round(hp) + '|' + maxHp;

                    if (elem.dataset.lastHpKey !== hpCacheKey) {
                        elem.dataset.lastHpKey = hpCacheKey;
                        if (labelElem) {
                            labelElem.innerHTML = '❤️ ' + (targetObj ? targetObj.name : (obj.healthBarTarget || 'Jugador')) + ' <span style="font-family: monospace; opacity: 0.8; margin-left: auto;">' + Math.round(hp) + '/' + maxHp + '</span>';
                        }
                        if (fillElem) {
                            fillElem.style.width = hpPercent + '%';
                            if (hpPercent < 25) {
                                fillElem.style.backgroundColor = '#ef4444';
                            } else if (hpPercent < 50) {
                                fillElem.style.backgroundColor = '#f59e0b';
                            } else {
                                fillElem.style.backgroundColor = '#10b981';
                            }
                        }
                    }
                } else {
                    let innerTextContainer = elem.querySelector('.text-inner');
                    if (obj.text !== undefined && obj.text !== null && obj.text !== '') {
                        if (!innerTextContainer) {
                            innerTextContainer = document.createElement('div');
                            innerTextContainer.className = 'text-inner';
                            innerTextContainer.style.position = 'relative';
                            innerTextContainer.style.zIndex = '2';
                            innerTextContainer.style.width = '100%';
                            innerTextContainer.style.height = '100%';
                            innerTextContainer.style.display = 'flex';
                            innerTextContainer.style.alignItems = 'center';
                            innerTextContainer.style.justifyContent = 'center';
                            elem.appendChild(innerTextContainer);
                        }
                        innerTextContainer.style.transform = sx < 0 ? 'scaleX(-1)' : 'none';
                        let textVal = String(obj.text);
                        for (const key in gameVariables) {
                            textVal = textVal.replace(new RegExp('\\\\{' + key + '\\\\}', 'g'), String(gameVariables[key]));
                        }
                        if (obj.variables) {
                            obj.variables.forEach(v => {
                                textVal = textVal.replace(new RegExp('\\\\{' + v.name + '\\\\}', 'g'), String(v.value));
                            });
                        }
                        if (obj.characterImageMapping) {
                            const map = parseCharacterImageMapping(obj.characterImageMapping);
                            if (Object.keys(map).length > 0) {
                                let html = '<div style="display: flex; align-items: center; justify-content: center; gap: 2px; flex-wrap: wrap;">';
                                Array.from(textVal).forEach(char => {
                                    const imgUrl = map[char] || map[char.toLowerCase()] || map[char.toUpperCase()];
                                    if (imgUrl) {
                                        html += '<img src="' + imgUrl + '" alt="' + char + '" style="height: ' + ((obj.fontSize || 24) * scaleX) + 'px; min-width: ' + ((obj.fontSize || 24) * scaleX * 0.6) + 'px; object-fit: contain; image-rendering: auto;" referrerpolicy="no-referrer" />';
                                    } else {
                                        html += '<span style="font-size: ' + ((obj.fontSize || 16) * scaleX) + 'px; font-weight: bold; color: ' + (obj.textColor || 'white') + ';">' + char + '</span>';
                                    }
                                });
                                html += '</div>';
                                if (innerTextContainer.dataset.lastHtml !== html) {
                                    innerTextContainer.dataset.lastHtml = html;
                                    innerTextContainer.innerHTML = html;
                                }
                            } else {
                                const htmlSimple = '<span style="font-size: ' + ((obj.fontSize || 16) * scaleX) + 'px; font-weight: bold; color: ' + (obj.textColor || 'white') + ';">' + textVal + '</span>';
                                if (innerTextContainer.dataset.lastHtml !== htmlSimple) {
                                    innerTextContainer.dataset.lastHtml = htmlSimple;
                                    innerTextContainer.innerHTML = htmlSimple;
                                }
                            }
                        } else {
                            const htmlSimple = '<span style="font-size: ' + ((obj.fontSize || 16) * scaleX) + 'px; font-weight: bold; color: ' + (obj.textColor || 'white') + ';">' + textVal + '</span>';
                            if (innerTextContainer.dataset.lastHtml !== htmlSimple) {
                                innerTextContainer.dataset.lastHtml = htmlSimple;
                                innerTextContainer.innerHTML = htmlSimple;
                            }
                        }
                    } else if (innerTextContainer && innerTextContainer.dataset.lastHtml) {
                        innerTextContainer.dataset.lastHtml = '';
                        innerTextContainer.innerHTML = '';
                    }
                }
            });
        }

        window.addEventListener('resize', () => {
             const gameContainer = document.getElementById('game-container');
             const uiContainer = document.getElementById('ui-container');
             if (!gameContainer || !canvas) return;
             const w = gameContainer.clientWidth || window.innerWidth || 1024;
             const h = gameContainer.clientHeight || window.innerHeight || 768;
             const gW = (window.projectData && window.projectData.gameWidth) ? Number(window.projectData.gameWidth) : 1024;
             const gH = (window.projectData && window.projectData.gameHeight) ? Number(window.projectData.gameHeight) : 768;
             const ratio = (gW > 0 && gH > 0) ? (gW / gH) : (1024 / 768);
             
             let newCanvasWidth, newCanvasHeight;
             if (w / h > ratio) {
                newCanvasHeight = h;
                newCanvasWidth = h * ratio;
             } else {
                newCanvasWidth = w;
                newCanvasHeight = w / ratio;
             }

             if (isNaN(newCanvasWidth) || newCanvasWidth <= 0) newCanvasWidth = w;
             if (isNaN(newCanvasHeight) || newCanvasHeight <= 0) newCanvasHeight = h;

             canvas.style.height = Math.round(newCanvasHeight) + 'px';
             canvas.style.width = Math.round(newCanvasWidth) + 'px';
             if (uiContainer) {
                 uiContainer.style.height = Math.round(newCanvasHeight) + 'px';
                 uiContainer.style.width = Math.round(newCanvasWidth) + 'px';
             }
             setupUI();
             updateUIDOMElements();
        });
        
        const initGameBoot = () => {
            window.dispatchEvent(new Event('resize'));
            setupGamepadSupport();

            if (${resolvedInstantStart}) {
                unlockAudioAndStart();
                const resumeOnGesture = () => {
                    try {
                        if (window.audioContext && window.audioContext.state === 'suspended') {
                            window.audioContext.resume().catch(() => {});
                        }
                        if (backgroundMusicPlayer && backgroundMusicPlayer.paused) {
                            backgroundMusicPlayer.play().catch(() => {});
                        }
                    } catch(e) {}
                };
                window.addEventListener('pointerdown', resumeOnGesture, { once: true, capture: true });
                window.addEventListener('keydown', resumeOnGesture, { once: true, capture: true });
            } else {
                const playBtn = document.getElementById('btn-play-game');
                const startScreen = document.getElementById('start-screen');
                if (playBtn) {
                    playBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        unlockAudioAndStart();
                    });
                    playBtn.addEventListener('touchend', (e) => {
                        e.stopPropagation();
                        unlockAudioAndStart();
                    });
                }
                if (startScreen) {
                    startScreen.addEventListener('click', (e) => {
                        unlockAudioAndStart();
                    });
                }
                window.addEventListener('keydown', (e) => {
                    if (!isGameStarted) {
                        unlockAudioAndStart();
                    }
                });
            }

            requestAnimationFrame(pollStartGamepad);

            if (window.projectData) {
                startGame(window.projectData).catch(err => {
                    console.error('Error in startGame:', err);
                    if (isGameStarted && !animationFrameId) animationFrameId = requestAnimationFrame(gameLoop);
                });
            } else {
                if (isGameStarted && !animationFrameId) animationFrameId = requestAnimationFrame(gameLoop);
            }

            window.dispatchEvent(new Event('resize'));
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initGameBoot);
        } else {
            initGameBoot();
        }
    `;

    const imageRenderingStyle = filteredProjectData?.pixelArt === true ? 'pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges' : 'auto';

    const escapeHtml = (str: string) => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m] || m);
    const gameTitle = filteredProjectData?.name ? escapeHtml(filteredProjectData.name) : 'RETURN GAME ENGINE';

    const minifyJS = (js: string): string => {
        const len = js.length;
        const out: string[] = [];
        const stack: Array<{ type: 'code'; braceDepth: number } | { type: 'template' }> = [{ type: 'code', braceDepth: 0 }];
        const regexKeywords = new Set(['return', 'throw', 'case', 'delete', 'void', 'typeof', 'in', 'instanceof', 'new', 'else', 'do', 'yield', 'await', 'export', 'default', 'of']);
        let lastToken: 'start' | 'op' | 'exprEnd' = 'start';
        let atLineStart = true;
        let pendingSpace = false;
        let i = 0;

        while (i < len) {
            const top = stack[stack.length - 1];
            const ch = js[i];

            if (top.type === 'template') {
                if (ch === '\\') {
                    out.push(ch, i + 1 < len ? js[i + 1] : '');
                    i += 2;
                    continue;
                }
                if (ch === '$' && i + 1 < len && js[i + 1] === '{') {
                    out.push('${');
                    stack.push({ type: 'code', braceDepth: 1 });
                    lastToken = 'op';
                    atLineStart = false;
                    pendingSpace = false;
                    i += 2;
                    continue;
                }
                if (ch === '`') {
                    out.push('`');
                    stack.pop();
                    lastToken = 'exprEnd';
                    atLineStart = false;
                    pendingSpace = false;
                    i++;
                    continue;
                }
                out.push(ch);
                i++;
                continue;
            }

            if (ch === '\r') {
                i++;
                continue;
            }

            if (ch === '\n') {
                pendingSpace = false;
                if (!atLineStart) {
                    out.push('\n');
                    atLineStart = true;
                }
                i++;
                continue;
            }

            if (ch === ' ' || ch === '\t') {
                if (!atLineStart) pendingSpace = true;
                i++;
                continue;
            }

            if (ch === '/' && i + 1 < len) {
                const next = js[i + 1];
                if (next === '/') {
                    i += 2;
                    while (i < len && js[i] !== '\n') i++;
                    continue;
                }
                if (next === '*') {
                    i += 2;
                    while (i < len && !(js[i] === '*' && i + 1 < len && js[i + 1] === '/')) i++;
                    i += 2;
                    if (!atLineStart) pendingSpace = true;
                    continue;
                }
                if (lastToken === 'start' || lastToken === 'op') {
                    if (pendingSpace) { out.push(' '); pendingSpace = false; }
                    atLineStart = false;
                    const start = i;
                    i++;
                    let inClass = false;
                    while (i < len) {
                        const rc = js[i];
                        if (rc === '\\') { i += 2; continue; }
                        if (rc === '[') inClass = true;
                        else if (rc === ']') inClass = false;
                        else if (rc === '/' && !inClass) { i++; break; }
                        else if (rc === '\n') break;
                        i++;
                    }
                    while (i < len && /[a-zA-Z]/.test(js[i])) i++;
                    out.push(js.slice(start, i));
                    lastToken = 'exprEnd';
                    continue;
                }
            }

            if (pendingSpace) {
                out.push(' ');
                pendingSpace = false;
            }
            atLineStart = false;

            if (ch === '\'' || ch === '"') {
                const quote = ch;
                const start = i;
                i++;
                while (i < len) {
                    const sc = js[i];
                    if (sc === '\\') { i += 2; continue; }
                    if (sc === quote) { i++; break; }
                    i++;
                }
                out.push(js.slice(start, i));
                lastToken = 'exprEnd';
                continue;
            }

            if (ch === '`') {
                out.push('`');
                stack.push({ type: 'template' });
                i++;
                continue;
            }

            if (/[a-zA-Z_$]/.test(ch)) {
                const start = i;
                i++;
                while (i < len && /[a-zA-Z0-9_$]/.test(js[i])) i++;
                const ident = js.slice(start, i);
                out.push(ident);
                lastToken = regexKeywords.has(ident) ? 'op' : 'exprEnd';
                continue;
            }

            if (/[0-9]/.test(ch)) {
                const start = i;
                i++;
                while (i < len && /[0-9a-fA-FxXoObBn._eE]/.test(js[i])) {
                    if ((js[i] === 'e' || js[i] === 'E') && i + 1 < len && (js[i + 1] === '+' || js[i + 1] === '-')) {
                        i += 2;
                        continue;
                    }
                    i++;
                }
                out.push(js.slice(start, i));
                lastToken = 'exprEnd';
                continue;
            }

            if (ch === '{') {
                if (stack.length > 1) top.braceDepth++;
                out.push('{');
                lastToken = 'op';
                i++;
                continue;
            }

            if (ch === '}') {
                if (stack.length > 1) {
                    top.braceDepth--;
                    if (top.braceDepth === 0) {
                        out.push('}');
                        stack.pop();
                        i++;
                        continue;
                    }
                }
                out.push('}');
                lastToken = 'op';
                i++;
                continue;
            }

            out.push(ch);
            if (ch === ')' || ch === ']') {
                lastToken = 'exprEnd';
            } else {
                lastToken = 'op';
            }
            i++;
        }

        return out.join('');
    };

    const minifiedEngine = minifyJS(gameEngineScript);
    const useLocalThree = has3DScenes && Boolean(options?.useLocalThreeVendor || options?.threeVendorScript);
    const threeModuleScripts = has3DScenes ? (useLocalThree
        ? `
    <script src="vendor/three-bundle.min.js"></script>`
        : `
    <script type="importmap">
    {
        "imports": {
            "three": "https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js",
            "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/"
        }
    }
    </script>
    <script type="module">
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
        import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
        window.__R2D_THREE__ = { THREE, OrbitControls, RoomEnvironment, GLTFLoader, SkeletonUtils };
    </script>`) : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>${gameTitle}</title>
    ${threeModuleScripts}
    <style>
        body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background-color: #000; display: flex; justify-content: center; align-items: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; color: white; }
        #game-container { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
        canvas { display: block; image-rendering: ${imageRenderingStyle}; max-width: 100%; max-height: 100%; outline: none; }
        #game3d-container { position: absolute; inset: 0; width: 100%; height: 100%; display: none; touch-action: none; }
        #ui-container { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 1000; }
        #ui-container button { pointer-events: auto; }

        /* Start Screen (Logo + Jugar + Gamepad) */
        #start-screen {
            position: absolute;
            inset: 0;
            background: radial-gradient(circle at center, rgba(20, 18, 30, 0.96) 0%, rgba(6, 6, 10, 0.98) 100%);
            display: ${resolvedInstantStart ? 'none !important' : 'flex'};
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 100000;
            color: #ffffff;
            text-align: center;
            transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.35s;
            user-select: none;
            -webkit-user-select: none;
            padding: 24px;
            box-sizing: border-box;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
        }
        #start-screen.hidden {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .start-logo-box {
            position: relative;
            width: 88px;
            height: 88px;
            background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
            border-radius: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 45px rgba(99, 102, 241, 0.45);
            margin-bottom: 20px;
            animation: pulse-glow 3s infinite alternate ease-in-out;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        .start-logo-dot {
            position: absolute;
            top: -4px;
            right: -4px;
            width: 18px;
            height: 18px;
            background: #ffffff;
            border-radius: 7px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .start-logo-dot::after {
            content: '';
            width: 8px;
            height: 8px;
            background: #4f46e5;
            border-radius: 50%;
        }
        .start-title {
            font-size: 32px;
            font-weight: 900;
            letter-spacing: -0.5px;
            text-transform: uppercase;
            font-style: italic;
            margin: 0 0 6px 0;
            text-shadow: 0 4px 20px rgba(0,0,0,0.6);
            max-width: 90%;
            word-wrap: break-word;
        }
        .start-subtitle {
            font-size: 11px;
            font-weight: 700;
            color: #a5b4fc;
            text-transform: uppercase;
            letter-spacing: 0.35em;
            margin-bottom: 32px;
        }
        .start-play-btn {
            background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.25);
            padding: 16px 48px;
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            border-radius: 16px;
            cursor: pointer;
            box-shadow: 0 0 35px rgba(79, 70, 229, 0.5), inset 0 1px 0 rgba(255,255,255,0.3);
            display: inline-flex;
            align-items: center;
            gap: 12px;
            transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
            outline: none;
        }
        .start-play-btn:hover {
            transform: scale(1.05);
            box-shadow: 0 0 50px rgba(99, 102, 241, 0.7), inset 0 1px 0 rgba(255,255,255,0.5);
            background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%);
        }
        .start-play-btn:active {
            transform: scale(0.97);
        }
        .start-hints {
            margin-top: 28px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }
        .start-hint-text {
            font-size: 11px;
            color: #94a3b8;
            font-weight: 500;
            letter-spacing: 0.04em;
        }
        .gamepad-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(30, 27, 75, 0.7);
            border: 1px solid rgba(129, 140, 248, 0.3);
            color: #c7d2fe;
            padding: 6px 14px;
            border-radius: 9999px;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.04em;
            transition: all 0.2s ease;
        }
        @keyframes pulse-glow {
            from { box-shadow: 0 0 30px rgba(99, 102, 241, 0.35); }
            to { box-shadow: 0 0 60px rgba(99, 102, 241, 0.65); }
        }
        .toast-notification {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-10px);
            background: rgba(15, 15, 25, 0.94);
            color: #ffffff;
            border: 1px solid rgba(99, 102, 241, 0.4);
            padding: 8px 20px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
            z-index: 200000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
        }
    </style>
</head>
<body>
    <div id="game-container">
        <div id="game3d-container"></div>
        <canvas id="gameCanvas" tabindex="0"></canvas>
        <div id="ui-container"></div>
${resolvedInstantStart ? '' : `        <div id="start-screen">
            <div class="start-logo-box">
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path>
                    <path d="m3.3 7 8.7 5 8.7-5"></path>
                    <path d="M12 22V12"></path>
                </svg>
                <div class="start-logo-dot"></div>
            </div>
            <h1 class="start-title">${gameTitle}</h1>
            <div class="start-subtitle">Return Game Engine</div>
            <button id="btn-play-game" class="start-play-btn" type="button">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 3 20 12 6 21 6 3"></polygon>
                </svg>
                JUGAR
            </button>
            <div class="start-hints">
                <div class="start-hint-text">Haz clic en JUGAR, toca la pantalla o presiona cualquier tecla / botón</div>
                <div id="gamepad-status-indicator" class="gamepad-indicator">
                    🎮 Gamepad (Bluetooth / USB) Compatible
                </div>
            </div>
        </div>`}
    </div>
    <div id="toast-notify" class="toast-notification"></div>
    <script>
        window.projectData = ${JSON.stringify(filteredProjectData || null).replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')};
        window.MULTIPLAYER_SERVER = "${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}";
        ${minifiedEngine}
    </script>
</body>
</html>`;
};

// Compression utilities to reduce exported HTML file size from MB to KB
export async function compressImageBase64(base64: string): Promise<string> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return base64;
    }
    
    if (base64.length < 10000 || base64.includes('image/svg+xml') || base64.includes('image/gif')) {
        return base64;
    }

    if (base64.includes('image/webp')) {
        try {
            const commaIdx = base64.indexOf(',');
            const payload = commaIdx !== -1 ? base64.slice(commaIdx + 1, commaIdx + 200) : '';
            if (payload) {
                const rawHead = atob(payload.slice(0, Math.floor(payload.length / 4) * 4));
                if (rawHead.includes('ANIM') || rawHead.includes('ANMF') || (rawHead.slice(12, 16) === 'VP8X' && rawHead.length > 20 && (rawHead.charCodeAt(20) & 0x02) !== 0)) {
                    return base64;
                }
            }
        } catch {
            // proceed with static webp check
        }
    }

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const maxDim = 1024;
                let width = img.width;
                let height = img.height;
                
                if (!width || !height) {
                    resolve(base64);
                    return;
                }

                if (width <= 128 && height <= 128) {
                    resolve(base64);
                    return;
                }

                if (width > maxDim || height > maxDim) {
                    if (width > height) {
                        height = Math.round((height * maxDim) / width);
                        width = maxDim;
                    } else {
                        width = Math.round((width * maxDim) / height);
                        height = maxDim;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(base64);
                    return;
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);

                const mightHaveAlpha = base64.includes('image/png') || base64.includes('image/gif') || base64.includes('image/svg');
                let compressed = '';

                if (mightHaveAlpha) {
                    let hasTransparentPixels = true;
                    try {
                        const imgData = ctx.getImageData(0, 0, width, height).data;
                        hasTransparentPixels = false;
                        for (let p = 3; p < imgData.length; p += 4) {
                            if (imgData[p] < 252) {
                                hasTransparentPixels = true;
                                break;
                            }
                        }
                    } catch {
                        hasTransparentPixels = true;
                    }

                    if (!hasTransparentPixels) {
                        compressed = canvas.toDataURL('image/webp', 0.82);
                        if (!compressed.startsWith('data:image/webp')) {
                            compressed = canvas.toDataURL('image/jpeg', 0.82);
                        }
                    } else {
                        const webpAlpha = canvas.toDataURL('image/webp', 0.88);
                        const pngOut = canvas.toDataURL('image/png');
                        if (webpAlpha.startsWith('data:image/webp') && webpAlpha.length < pngOut.length) {
                            compressed = webpAlpha;
                        } else {
                            compressed = pngOut;
                        }
                    }
                } else {
                    compressed = canvas.toDataURL('image/webp', 0.80);
                    if (!compressed.startsWith('data:image/webp')) {
                        compressed = canvas.toDataURL('image/jpeg', 0.80);
                    }
                }
                
                if (compressed && compressed.length < base64.length) {
                    resolve(compressed);
                } else {
                    resolve(base64);
                }
            } catch (e) {
                console.error('Image compression failed:', e);
                resolve(base64);
            }
        };
        img.onerror = () => {
            resolve(base64);
        };
        img.src = base64;
    });
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function encodeWAV(audioBuffer: AudioBuffer): ArrayBuffer {
    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const channelData = audioBuffer.getChannelData(0);
    const numSamples = channelData.length;
    
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, numSamples * 2, true);
    
    let offset = 44;
    for (let i = 0; i < numSamples; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, channelData[i]));
        const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(offset, val, true);
    }
    
    return buffer;
}

export async function compressAudioBase64(base64: string): Promise<string> {
    if (typeof window === 'undefined' || (!window.AudioContext && !(window as any).webkitAudioContext)) {
        return base64;
    }

    if (base64.length < 15000) {
        return base64;
    }

    const lowerHead = base64.slice(0, 48).toLowerCase();
    const isAlreadyCompressedAudio =
        lowerHead.includes('audio/mpeg') ||
        lowerHead.includes('audio/mp3') ||
        lowerHead.includes('audio/ogg') ||
        lowerHead.includes('audio/webm') ||
        lowerHead.includes('audio/aac') ||
        lowerHead.includes('audio/mp4');
    if (isAlreadyCompressedAudio && base64.length < 180000) {
        return base64;
    }

    try {
        const parts = base64.split(',');
        if (parts.length < 2) return base64;
        const binaryStr = atob(parts[1]);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }

        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtxClass();
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        ctx.close();

        // Resample to mono 12000Hz (super light weight for 2D game sounds/soundtracks)
        const targetSampleRate = 12000;
        const duration = audioBuffer.duration;
        
        const OfflineCtxClass = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
        const offlineCtx = new OfflineCtxClass(1, Math.max(1, Math.floor(duration * targetSampleRate)), targetSampleRate);
        
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        
        const resampledBuffer = await offlineCtx.startRendering();

        const wavBytes = encodeWAV(resampledBuffer);
        const blob = new Blob([wavBytes], { type: 'audio/wav' });
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                if (result && result.length < base64.length) {
                    resolve(result);
                } else {
                    resolve(base64);
                }
            };
            reader.readAsDataURL(blob);
        });
    } catch (err) {
        console.error('Audio compression failed, using original:', err);
        return base64;
    }
}

export async function compressVideoBase64(base64: string): Promise<string> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return base64;
    }

    if (base64.length < 30000) {
        return base64;
    }

    return new Promise((resolve) => {
        let isResolved = false;
        const done = (result: string) => {
            if (!isResolved) {
                isResolved = true;
                resolve(result);
            }
        };

        const safetyTimeout = setTimeout(() => {
            console.warn('Video compression timed out, using original.');
            done(base64);
        }, 10000);

        try {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.crossOrigin = 'anonymous';

            video.onloadedmetadata = () => {
                try {
                    const width = video.videoWidth;
                    const height = video.videoHeight;
                    const duration = video.duration || 5;

                    if (!width || !height) {
                        clearTimeout(safetyTimeout);
                        done(base64);
                        return;
                    }

                    const maxDim = 360;
                    let targetW = width;
                    let targetH = height;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            targetH = Math.round((height * maxDim) / width);
                            targetW = maxDim;
                        } else {
                            targetW = Math.round((width * maxDim) / height);
                            targetH = maxDim;
                        }
                    }

                    const canvas = document.createElement('canvas');
                    canvas.width = targetW;
                    canvas.height = targetH;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        clearTimeout(safetyTimeout);
                        done(base64);
                        return;
                    }

                    if (typeof (canvas as any).captureStream !== 'function' || typeof window.MediaRecorder === 'undefined') {
                        clearTimeout(safetyTimeout);
                        done(base64);
                        return;
                    }

                    const stream = (canvas as any).captureStream(12);
                    const mimeTypes = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1'];
                    let chosenMime = '';
                    for (const mime of mimeTypes) {
                        if (MediaRecorder.isTypeSupported(mime)) {
                            chosenMime = mime;
                            break;
                        }
                    }

                    const options: any = { videoBitsPerSecond: 100000 };
                    if (chosenMime) options.mimeType = chosenMime;

                    const mediaRecorder = new MediaRecorder(stream, options);
                    const chunks: Blob[] = [];

                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data && event.data.size > 0) {
                            chunks.push(event.data);
                        }
                    };

                    let animationId: number;
                    const drawLoop = () => {
                        if (video.paused || video.ended) return;
                        ctx.drawImage(video, 0, 0, targetW, targetH);
                        animationId = requestAnimationFrame(drawLoop);
                    };

                    const stopAndFinish = () => {
                        try {
                            cancelAnimationFrame(animationId);
                            if (mediaRecorder.state !== 'inactive') {
                                mediaRecorder.stop();
                            }
                        } catch (e) {
                            clearTimeout(safetyTimeout);
                            done(base64);
                        }
                    };

                    mediaRecorder.onstop = () => {
                        try {
                            clearTimeout(safetyTimeout);
                            const blob = new Blob(chunks, { type: chosenMime || 'video/webm' });
                            const reader = new FileReader();
                            reader.onloadend = () => {
                                const compressedResult = reader.result as string;
                                if (compressedResult && compressedResult.length < base64.length) {
                                    done(compressedResult);
                                } else {
                                    done(base64);
                                }
                            };
                            reader.readAsDataURL(blob);
                        } catch (e) {
                            done(base64);
                        }
                    };

                    mediaRecorder.start();
                    video.play().catch(() => stopAndFinish());
                    animationId = requestAnimationFrame(drawLoop);
                    video.onended = stopAndFinish;
                    setTimeout(stopAndFinish, Math.min(20, duration) * 1000 + 100);

                } catch (innerErr) {
                    clearTimeout(safetyTimeout);
                    done(base64);
                }
            };

            video.onerror = () => {
                clearTimeout(safetyTimeout);
                done(base64);
            };

            video.src = base64;
            video.load();

        } catch (err) {
            clearTimeout(safetyTimeout);
            done(base64);
        }
    });
}

export async function compressProjectAssets(
    projectData: ProjectData, 
    onProgress?: (msg: string) => void
): Promise<ProjectData> {
    // Deep clone so we do not mutate the main editor state
    const data = JSON.parse(JSON.stringify(projectData)) as ProjectData;
    const compressionCache = new Map<string, string>();
    const base64Values: { obj: any; key: string; value: string; typeHint?: string }[] = [];
    
    function scan(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    base64Values.push({ 
                        obj, 
                        key, 
                        value: val,
                        typeHint: obj.type || undefined
                    });
                } else if (typeof val === 'object') {
                    scan(val);
                }
            }
        }
    }
    
    scan(data);
    
    if (base64Values.length === 0) {
        return data;
    }
    
    const uniqueRefs = new Map<string, { refs: { obj: any; key: string }[]; typeHint?: string; name?: string }>();
    for (const item of base64Values) {
        let entry = uniqueRefs.get(item.value);
        if (!entry) {
            entry = { refs: [], typeHint: item.typeHint, name: item.obj.name };
            uniqueRefs.set(item.value, entry);
        }
        entry.refs.push({ obj: item.obj, key: item.key });
    }

    const uniqueList = Array.from(uniqueRefs.entries());
    const total = uniqueList.length;
    let current = 0;
    const BATCH_SIZE = 4;

    for (let i = 0; i < uniqueList.length; i += BATCH_SIZE) {
        const batch = uniqueList.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async ([val, entry]) => {
            const idx = ++current;
            const name = entry.name ? ` "${entry.name}"` : '';
            if (onProgress) {
                onProgress(`Optimizando recurso ${idx}/${total}${name}...`);
            }
            let compressed = val;
            try {
                if (val.startsWith('data:image/') || entry.typeHint === 'image') {
                    compressed = await compressImageBase64(val);
                } else if (val.startsWith('data:audio/') || entry.typeHint === 'audio') {
                    compressed = await compressAudioBase64(val);
                } else if (val.startsWith('data:video/') || entry.typeHint === 'video') {
                    compressed = await compressVideoBase64(val);
                }
            } catch (e) {
                console.error('Compression of asset failed:', e);
            }
            compressionCache.set(val, compressed);
            for (const ref of entry.refs) {
                ref.obj[ref.key] = compressed;
            }
        }));
    }
    
    if (onProgress) {
        onProgress('¡Optimización completada!');
    }
    
    return data;
}

export async function generateGameZIP(
    projectData: ProjectData,
    onProgress?: (msg: string) => void,
    options?: ExportOptions
): Promise<Blob> {
    const zip = new JSZip();

    if (onProgress) onProgress('Filtrando escenas y optimizando recursos...');
    const filteredData = applyExportDimensionFilter(projectData, options);
    const optimizedData = await compressProjectAssets(filteredData, onProgress);

    // Deep clone optimized project data
    const cleanData = JSON.parse(JSON.stringify(optimizedData)) as ProjectData;
    const assetsFolder = zip.folder('assets');

    let assetCount = 0;
    const base64ToPathMap = new Map<string, string>();

    function decodeDataUriToBytes(dataUri: string): Uint8Array | null {
        const commaIdx = dataUri.indexOf(',');
        if (commaIdx === -1) return null;
        const header = dataUri.slice(0, commaIdx);
        const payload = dataUri.slice(commaIdx + 1);
        if (header.includes(';base64')) {
            const binaryStr = atob(payload.replace(/\s+/g, ''));
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return bytes;
        }
        let decodedText = payload;
        try { decodedText = decodeURIComponent(payload); } catch {}
        return new TextEncoder().encode(decodedText);
    }

    function extractAndReplace(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    let relativePath = base64ToPathMap.get(val);
                    if (!relativePath) {
                        const commaIdx = val.indexOf(',');
                        let ext = 'bin';

                        if (commaIdx !== -1) {
                            const header = val.slice(0, commaIdx);
                            const rawPayload = val.slice(commaIdx + 1);
                            if (header.includes('image/png')) ext = 'png';
                            else if (header.includes('image/jpeg') || header.includes('image/jpg')) ext = 'jpg';
                            else if (header.includes('image/webp')) ext = 'webp';
                            else if (header.includes('image/gif')) ext = 'gif';
                            else if (header.includes('image/svg')) ext = 'svg';
                            else if (header.includes('audio/wav')) ext = 'wav';
                            else if (header.includes('audio/mp3') || header.includes('audio/mpeg')) ext = 'mp3';
                            else if (header.includes('audio/ogg')) ext = 'ogg';
                            else if (header.includes('video/mp4')) ext = 'mp4';
                            else if (header.includes('video/webm')) ext = 'webm';
                            else if (header.includes('model/gltf-binary')) ext = 'glb';
                            else if (header.includes('model/gltf+json')) ext = 'gltf';
                            else {
                                try {
                                    if (header.includes(';base64') && atob(rawPayload.slice(0, 12)).startsWith('glTF')) ext = 'glb';
                                    else if ((key === 'modelUrl' || obj.type === '3d-model') && (header.includes('application/json') || header.includes('text/plain'))) ext = 'gltf';
                                    else if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                } catch (eMagic) {
                                    if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                }
                            }
                        }

                        try {
                            const bytes = decodeDataUriToBytes(val);
                            if (bytes && assetsFolder) {
                                assetCount++;
                                const nameSanitized = obj.name ? String(obj.name).toLowerCase().replace(/[^a-z0-9]/gi, '_') : 'asset';
                                const filename = `${assetCount}_${nameSanitized}.${ext}`;
                                const candidatePath = `assets/${filename}`;
                                assetsFolder.file(filename, bytes);
                                base64ToPathMap.set(val, candidatePath);
                                relativePath = candidatePath;
                            }
                        } catch (e) {
                            console.error('Error al convertir data URI a binario para ZIP:', e);
                        }
                    }
                    if (relativePath) {
                        obj[key] = relativePath;
                    }
                } else if (typeof val === 'object') {
                    extractAndReplace(val);
                }
            }
        }
    }

    if (onProgress) onProgress('Extrayendo assets multimedia a archivos individuales en assets/...');
    extractAndReplace(cleanData);

    // Save compact project.json
    zip.file('project.json', JSON.stringify(cleanData));

    const has3DScenes = Boolean(cleanData.scenes?.some(s => getSceneDimension(s) === '3d'));
    if (has3DScenes && options?.threeVendorScript) {
        zip.file('vendor/three-bundle.min.js', options.threeVendorScript);
    }

    // Generate HTML with cleanData (relative paths) directly without splash screen by default
    if (onProgress) onProgress('Generando index.html y motor optimizado...');
    const shouldInstantStart = options?.skipStartScreen !== undefined ? Boolean(options.skipStartScreen) : true;
    const standaloneHtml = generateGameHTML(cleanData, shouldInstantStart, {
        ...options,
        useLocalThreeVendor: Boolean(has3DScenes && options?.threeVendorScript),
    });
    zip.file('index.html', standaloneHtml);

    // Add LEEME.txt
    const gameName = projectData.name || projectData.scenes?.[0]?.name || 'Juego Return Game Engine';
    zip.file('LEEME.txt', `================================================
${gameName} - Return Game Engine
================================================

¡Proyecto exportado exitosamente a ZIP comprimido!

CONTENIDO DEL PAQUETE:
- index.html: Archivo HTML ejecutable del juego (inicio directo, súper ligero).
- project.json: Datos y configuración del proyecto para reimportar en el editor.
- assets/: Carpeta independiente con todas las imágenes, sonidos y videos en formato binario.
${has3DScenes && options?.threeVendorScript ? '- vendor/three-bundle.min.js: Motor Three.js 3D integrado para ejecución 100% offline.\n' : ''}
CÓMO EJECUTAR EL JUEGO:
1. Extrae todo el contenido del archivo .ZIP en una carpeta de tu ordenador.
2. Haz doble clic en "index.html" para abrirlo en tu navegador o súbelo a un servidor de hosting (Netlify, itch.io, GitHub Pages, Vercel).

Return Game Engine
`);

    if (onProgress) onProgress('Comprimiendo paquete ZIP (DEFLATE nivel máximo)...');
    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    }, (metadata) => {
        if (onProgress) {
            onProgress(`Empaquetando ZIP: ${Math.round(metadata.percent)}%`);
        }
    });

    return zipBlob;
}

export async function generateGameAPKPackage(
    projectData: ProjectData,
    onProgress?: (msg: string) => void,
    options?: ExportOptions
): Promise<Blob> {
    const zip = new JSZip();

    if (onProgress) onProgress('Filtrando escenas y optimizando recursos para APK...');
    const filteredData = applyExportDimensionFilter(projectData, options);
    const optimizedData = await compressProjectAssets(filteredData, onProgress);
    const cleanData = JSON.parse(JSON.stringify(optimizedData)) as ProjectData;
    const wwwFolder = zip.folder('www');
    const assetsFolder = wwwFolder?.folder('assets');

    let assetCount = 0;
    const base64ToPathMap = new Map<string, string>();

    function decodeDataUriToBytesApk(dataUri: string): Uint8Array | null {
        const commaIdx = dataUri.indexOf(',');
        if (commaIdx === -1) return null;
        const header = dataUri.slice(0, commaIdx);
        const payload = dataUri.slice(commaIdx + 1);
        if (header.includes(';base64')) {
            const binaryStr = atob(payload.replace(/\s+/g, ''));
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return bytes;
        }
        let decodedText = payload;
        try { decodedText = decodeURIComponent(payload); } catch {}
        return new TextEncoder().encode(decodedText);
    }

    function extractAndReplace(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    let relativePath = base64ToPathMap.get(val);
                    if (!relativePath) {
                        const commaIdx = val.indexOf(',');
                        let ext = 'bin';

                        if (commaIdx !== -1) {
                            const header = val.slice(0, commaIdx);
                            const rawPayload = val.slice(commaIdx + 1);
                            if (header.includes('image/png')) ext = 'png';
                            else if (header.includes('image/jpeg') || header.includes('image/jpg')) ext = 'jpg';
                            else if (header.includes('image/webp')) ext = 'webp';
                            else if (header.includes('image/gif')) ext = 'gif';
                            else if (header.includes('image/svg')) ext = 'svg';
                            else if (header.includes('audio/wav')) ext = 'wav';
                            else if (header.includes('audio/mp3') || header.includes('audio/mpeg')) ext = 'mp3';
                            else if (header.includes('audio/ogg')) ext = 'ogg';
                            else if (header.includes('video/mp4')) ext = 'mp4';
                            else if (header.includes('video/webm')) ext = 'webm';
                            else if (header.includes('model/gltf-binary')) ext = 'glb';
                            else if (header.includes('model/gltf+json')) ext = 'gltf';
                            else {
                                try {
                                    if (header.includes(';base64') && atob(rawPayload.slice(0, 12)).startsWith('glTF')) ext = 'glb';
                                    else if ((key === 'modelUrl' || obj.type === '3d-model') && (header.includes('application/json') || header.includes('text/plain'))) ext = 'gltf';
                                    else if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                } catch (eMagic) {
                                    if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                }
                            }
                        }

                        try {
                            const bytes = decodeDataUriToBytesApk(val);
                            if (bytes && assetsFolder) {
                                assetCount++;
                                const nameSanitized = obj.name ? String(obj.name).toLowerCase().replace(/[^a-z0-9]/gi, '_') : 'asset';
                                const filename = `${assetCount}_${nameSanitized}.${ext}`;
                                const candidatePath = `assets/${filename}`;
                                assetsFolder.file(filename, bytes);
                                base64ToPathMap.set(val, candidatePath);
                                relativePath = candidatePath;
                            }
                        } catch (e) {
                            console.error('Error al convertir data URI a binario para APK:', e);
                        }
                    }
                    if (relativePath) {
                        obj[key] = relativePath;
                    }
                } else if (typeof val === 'object') {
                    extractAndReplace(val);
                }
            }
        }
    }

    if (onProgress) onProgress('Extrayendo assets multimedia para APK...');
    extractAndReplace(cleanData);

    // Save compact project.json inside www/
    wwwFolder?.file('project.json', JSON.stringify(cleanData));

    const has3DScenes = Boolean(cleanData.scenes?.some(s => getSceneDimension(s) === '3d'));
    if (has3DScenes && options?.threeVendorScript) {
        wwwFolder?.file('vendor/three-bundle.min.js', options.threeVendorScript);
    }

    // Generate HTML with instant start (no splash, instant audio)
    if (onProgress) onProgress('Generando index.html optimizado con arranque instantáneo...');
    const apkHtml = generateGameHTML(cleanData, true, {
        ...options,
        useLocalThreeVendor: Boolean(has3DScenes && options?.threeVendorScript),
    });
    wwwFolder?.file('index.html', apkHtml);

    if (options?.wwwOnly) {
        if (onProgress) onProgress('Empaquetando recursos www/ para compilación APK directa...');
        return await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 4 }
        });
    }

    const signing = options?.signing;
    const buildType = signing?.buildType === 'release' ? 'release' : 'debug';
    const rawPackageName = (signing?.packageName || 'com.return2d.game').replace(/[^a-zA-Z0-9_.]/g, '') || 'com.return2d.game';
    const packageName = rawPackageName.includes('.') ? rawPackageName : `com.return2d.${rawPackageName}`;
    const versionName = (signing?.versionName || '1.0.0').replace(/["<>]/g, '') || '1.0.0';
    const versionCode = Math.max(1, Number(signing?.versionCode || 1) || 1);
    const appDisplayName = (signing?.appName || projectData.name || projectData.scenes?.[0]?.name || 'Return Game').replace(/[<>&"']/g, '').trim() || 'Return Game';
    const storePassword = (signing?.storePassword || (buildType === 'release' ? 'return2d123' : 'android')).replace(/"/g, '\\"');
    const keyPassword = (signing?.keyPassword || signing?.storePassword || (buildType === 'release' ? 'return2d123' : 'android')).replace(/"/g, '\\"');
    const keyAlias = (signing?.alias || (buildType === 'release' ? 'releasekey' : 'androiddebugkey')).replace(/"/g, '\\"');
    const keystoreType = signing?.keystoreType === 'jks' ? 'jks' : 'pkcs12';
    const defaultKsName = buildType === 'release' ? 'release.keystore' : 'debug.keystore';
    const keystoreFileName = (signing?.keystoreFileName || defaultKsName).replace(/[^a-zA-Z0-9._-]/g, '_') || defaultKsName;
    const hasCustomKeystore = Boolean(signing?.keystoreBase64 && signing.keystoreBase64.length > 0);
    const isReleaseAutoKeystore = buildType === 'release' && Boolean(signing?.generateKeystore) && !hasCustomKeystore;
    const effectiveKeystoreFile = (hasCustomKeystore || isReleaseAutoKeystore) ? keystoreFileName : 'debug.keystore';
    const effectiveStorePass = (hasCustomKeystore || isReleaseAutoKeystore) ? storePassword : 'android';
    const effectiveKeyPass = (hasCustomKeystore || isReleaseAutoKeystore) ? keyPassword : 'android';
    const effectiveAlias = (hasCustomKeystore || isReleaseAutoKeystore) ? keyAlias : 'androiddebugkey';
    const orientationPref = projectData.orientation === 'portrait' ? 'portrait' : 'landscape';

    // Cordova configuration: config.xml
    zip.file('config.xml', `<?xml version='1.0' encoding='utf-8'?>
<widget id="${packageName}" version="${versionName}" android-versionCode="${versionCode}" xmlns="http://www.w3.org/ns/widgets" xmlns:cdv="http://cordova.apache.org/ns/1.0">
    <name>${appDisplayName}</name>
    <description>Juego exportado desde Return Game Engine</description>
    <author email="dev@return2d.engine" href="https://return2d.engine">Return Game Engine Team</author>
    <content src="index.html" />
    <preference name="Orientation" value="${orientationPref}" />
    <preference name="Fullscreen" value="true" />
    <preference name="HideSplashScreenSpinner" value="true" />
    <preference name="SplashScreenDelay" value="0" />
    <platform name="android">
        <allow-intent href="http://*/*" />
        <allow-intent href="https://*/*" />
    </platform>
    <engine name="android" spec="^12.0.0" />
</widget>`);

    // Default Android Debug Keystore (Valid for 10000 days with standard alias 'androiddebugkey' and pass 'android')
    const defaultKeystoreBase64 = "MIIKfgIBAzCCCjQGCSqGSIb3DQEHAaCCCiUEggohMIIKHTCCBGIGCSqGSIb3DQEHBqCCBFMwggRPAgEAMIIESAYJKoZIhvcNAQcBMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAhreo34Y4LatQICCAAwDAYIKoZIhvcNAgkFADAdBglghkgBZQMEASoEEK3qfE3QOYSnp+OEgSwAj1WAggPgyeyU0K5lWApYzXNDziX01kwEU93/jASwW+hA7PlMkqETNrtYP+KAKUrkXXxurjDcquwiVOc7F076F6Apb7VqUaeNItV/wggateHlah8HUH0Q8exwb6NlL7h2FFbau8xWyj2PSw6qfp5C0Cu6QkiSfFd9PKGTPFr70mqnZ8sK4cBHN64wy0EMJTJnjSa+wWI+8JSehuV/4BL6vIQEiALyqQaqbuZzpHzQ/82kbms4UzMoR2HlE3uQvVkkeqcsFhGlv+IBch2lCaNaYUuCdk2qaSehUjAk4vdzjJvJFwG15N1gU55/rxJXjP8ANfxJMoUcX6gRy8Idg50HhhgZxVZiSTwm9vRRORLfoeUFjMz3X4kyzIA7xLTdT/UT4bQVXhCiCYIY86zO33hp4AuDMaP9xuOJuIyeqa38t43GJjb1+TynXLZ9Ce4ATj5DhLMmUakKbkHwZmgSocWEaFjcfOo7GwNyL48oMU/TePTU9EL3RSF3g+14SFVFfKjxxSn2dEQvU3pDAqS6ctnxBq7Gl30R3WaVc3K/SIIcktL/HmojCzugdrVFmtOS0F+yheNJrXCong5SZzCPGiz92HUekm5Uf74NaobYRhQ9RU1nvLawib7oYYTdX6sD4UJ+0HwPhju34aJuOhJO3Af29XNsXbJQqGbN/0uA52UmjAiLLElGaEt4OLuwq6jseRmsKLxGwPVx7AJ7hhF9MgkwlJ46nDcustv0hobfOinSxyYbYdvW/WU076//Gyzif9vNeSgIrNElcqXJmW7eTJ8IKQr0i2zLHK5PvQ3k9WeMUTCawSOiZ28BLLG5TZoeaPA05i8k3QZYmdKsATrv/Ci3TLSLC917t3kbOka2gMUB0UxVpT8DcsJqjNHvYbD8GZQYD0Sf8sSVlZ8bFQIwgddUYr6umn8tB7huM3IcBYGpCMqRxSaFtPjEMCdPelJAYXcAvW0cApVm3Sbb8/hBfJ+suee349Azb3O26fVtwowPES6G/Xi+q71MiIHsA8qtsts6iEws/E9ddSNyIa+9x+niYzMKK90HrFNuGN8RK1fQdDboYFqPPbRD9epU4zXxWLETN6zNNfU1IaBOslZnXxkGz4O6XVUSUHqJukcRXy1RuG2DLhNiVZeFPpbb1px2NUvEG6gADHj/ccKxhu0qiXk6R+wx9OlD94nD7LBYXHNaPL9xIsLTjS1zD1KznXxZ2ZLLsYjtOCm5ZqVo7yHUOShguM7K9h09ZQpXO7Jt7LjjMfkxG5wilqgewxQQR3cSdwNKKfw3vHB0CbaP9/4cwMyYkljxEJLGtNgBjlaKm+mNf2gnhmiBMiswggWzBgkqhkiG9w0BBwGgggWkBIIFoDCCBZwwggWYBgsqhkiG9w0BDAoBAqCCBTEwggUtMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAiyBuVV45Nd7QICCAAwDAYIKoZIhvcNAgkFADAdBglghkgBZQMEASoEELlektFrG/C4oNsv0GZkP00EggTQ/esORYU4IKh8JHBCifn6sIB6efhx7QVrNwmd2SSjAtLYPfrrVbq0FDm9u7T7+piAz0FAj/Fm5ADJuiPPBbbgxTdEFGuiBhF3X3JjB8lEEyMWS2i4TMimMDOTDNG/GxtN5fH3HH9J6EZ3EOwJIH/zZpkVZ/PjSRw5yxP+ucbmzcefO8+ue8Vv1fwNgQg+CH0YSyLNosYzbtukw5boVdNgX2RNUh1vJT/BkGuEiGmD15ifsb6dkfFxc05hrPp/RXf5ZtjGJSh+da/XXf+UguEnjfvagXkZoIzxr7t5+Ot8cw6YOh6pLsc1lhsamxHemca11oNXdbc9USeivR0+HjYxXV5eFoG1Wq9jgeUfoclXPHXBevQmSichBQFFJSCROGO/Yz5G7gHfPzecfbB0KpgA+SfOkKzbj9ehvb/j/2NSs1TS4BkWeGpjOU/m5akH0gKdV5x2gTRAVEkHM21A+xggz7DDNZCWs97MOhESmm50hHMBRuMwcROeleNgME38k0E8BHFq4+5VpHYZF2bCr4nROkgWH9fJhiRYcxC4W7N1QNR5EdxuL4STC//Qh3rhgdesVWy44+aZhPe2mLgOXw7TdNA6LYGzJadLYmjimzojjx2d06KIc+omsPabA8VxS7BnkGrXCOcO8dA9g/0SkGd4E2a2xTU2VYWXDediaWyT/mlqKoxoaI2Ygc9HbxLG3WesSJk82TGnCXzHHDLamwxW9c0pC0byEgmKzQoOdVRxwz8CzjZcxHIqGipJ67EPy2xFiuLgtruH7EfSLibu7VWu+H1tGfFEkPb5ORain2p8S25d9QE6q8fwYYW4MYsLb62q1kmtTYTKnW9gmdkEYFyTF94CMBIuez5JmrJenAGezvzj/UQ/DdmUY/mWmR3Akwlm3d+F/K3vxkckbuP5Z8zShyjucep4u5hORJhxSvTO7x5ciELi1h3/pSIbw7mGTai3kaDGu2GZtM1k6Wf6/SIiXqqfrEGzDrVaK9TX7OO6kdmQOheupMYuwTHfFSpKkMpPebEx3sUQ+43F8CNiBlh48OU24di8lKUdqWA71ACyUgC7bvnWD7K2MMWdFQpW0BrhzotPiSP8Q3HOyKh3aAlOE18mCjRdtj1QgWARRqSudESC+cz/+tmVh8L/ZCAi+YJtiSl/6k4UZwa1auEcUBpclGkP+4vx+k74jmewtoM2Vp147GTAg16iCGgVZAMMTeJp/NY4Hp56ElUtCfTdHrQxsEvtY1z/G3gV3t5r+PqlTHht+L2xpDupX4Q4JLgOX4M2y6ZparnNkhFi0UrC7l9sjmbXwm6I50CBz+P8VhZC2zd6/ZeQlMWJncmxjIyRh4uAreVWYJIGAB965MzoGf//hhjFFJa12F8Xa9Ra4wwUiq2hsfZbQwiIdhf49Ro2ml6RUaLp+t6UhAdleTKDp53xgrbgP2Us9CgOMS2dmQiUGl9m/XutOByFIyr+DTrFfOwekR/i+oh1RgzdVMkhsiODOnahT9B4o7lD4B8QUgr8YAnIucGNczAdzUJXrnjMNLGV1ol3NDEUpoZQrQTXVrAeJ4E17iuRZGRDm2EWnp7GKij2t9b6/UUNE+xTDgJUhV2V73jgemNfPOeZHITsARyYzqxpCP2G8lE+xRCZtZTUAcYxVDAjBgkqhkiG9w0BCRUxFgQUPt6vXvkstryCw/F/h8exrEVlAKcwLQYJKoZIhvcNAQkUMSAeHgBhAG4AZAByAG8AaQBkAGQAZQBiAHUAZwBrAGUAeTBBMDEwDQYJYIZIAWUDBAIBBQAEICIKh2wN9rn5mkxYOMMj619fTSHvVmme4mvccefUjPqABAj8JgI+bQuTxAICCAA=";

    const decodeBase64ToBytes = (b64: string) => {
        const cleanB64 = b64.includes(',') ? b64.split(',')[1] : b64;
        const raw = atob(cleanB64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes;
    };

    try {
        const debugBytes = decodeBase64ToBytes(defaultKeystoreBase64);
        zip.file('debug.keystore', debugBytes);
        zip.file('platforms/android/debug.keystore', debugBytes);
        if (hasCustomKeystore && signing?.keystoreBase64) {
            const customBytes = decodeBase64ToBytes(signing.keystoreBase64);
            zip.file(keystoreFileName, customBytes);
            zip.file(`platforms/android/${keystoreFileName}`, customBytes);
        }
    } catch (e) {
        console.error('Error al empaquetar keystore:', e);
    }

    // Cordova build.json signing config (debug & release)
    zip.file('build.json', JSON.stringify({
        android: {
            debug: {
                keystore: 'debug.keystore',
                storePassword: 'android',
                alias: 'androiddebugkey',
                password: 'android',
                keystoreType: 'pkcs12'
            },
            release: {
                keystore: effectiveKeystoreFile,
                storePassword: effectiveStorePass,
                alias: effectiveAlias,
                password: effectiveKeyPass,
                keystoreType
            }
        }
    }, null, 2));

    // Android Manifest
    const androidFolder = zip.folder('platforms/android/app/src/main');
    androidFolder?.file('AndroidManifest.xml', `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="${appDisplayName}"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/AppTheme">
        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:label="${appDisplayName}"
            android:launchMode="singleTop"
            android:theme="@style/Theme.AppCompat.NoActionBar"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);

    // Root Gradle config
    const gradleFolder = zip.folder('platforms/android');
    gradleFolder?.file('build.gradle', `buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:7.4.2'
    }
}
allprojects {
    repositories {
        google()
        mavenCentral()
    }
}`);

    // App Module Gradle with debug & release signingConfigs configured
    const appFolder = zip.folder('platforms/android/app');
    appFolder?.file('build.gradle', `apply plugin: 'com.android.application'

android {
    namespace "${packageName}"
    compileSdkVersion 33
    defaultConfig {
        applicationId "${packageName}"
        minSdkVersion 22
        targetSdkVersion 33
        versionCode ${versionCode}
        versionName "${versionName}"
    }
    signingConfigs {
        debugSignature {
            storeFile file("../../debug.keystore")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
        releaseSignature {
            storeFile file("../../${effectiveKeystoreFile}")
            storePassword "${effectiveStorePass}"
            keyAlias "${effectiveAlias}"
            keyPassword "${effectiveKeyPass}"
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debugSignature
        }
        release {
            signingConfig signingConfigs.releaseSignature
            minifyEnabled false
        }
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.6.1'
}`);

    const cordovaBuildFlag = buildType === 'release' ? '--release' : '--debug';
    const expectedApkSubpath = buildType === 'release'
        ? 'platforms/android/app/build/outputs/apk/release/app-release.apk'
        : 'platforms/android/app/build/outputs/apk/debug/app-debug.apk';
    const expectedApkSubpathWin = expectedApkSubpath.replace(/\//g, '\\');

    // Helper scripts for 1-click compiling
    zip.file('compilar-apk.bat', `@echo off
echo ================================================
echo Compilando APK Android (${buildType.toUpperCase()}) con Keystore
echo ================================================
${isReleaseAutoKeystore ? `if not exist "${keystoreFileName}" (\r\n  keytool -genkeypair -v -keystore "${keystoreFileName}" -storetype ${keystoreType === 'jks' ? 'JKS' : 'PKCS12'} -keyalg RSA -keysize 2048 -validity 10000 -alias "${effectiveAlias}" -storepass "${effectiveStorePass}" -keypass "${effectiveKeyPass}" -dname "CN=${signing?.distinguishedName?.commonName || 'Return Game'}, O=${signing?.distinguishedName?.organization || 'Return Studio'}, C=${signing?.distinguishedName?.country || 'ES'}"\r\n)\r\ncopy /Y "${keystoreFileName}" "platforms\\android\\${keystoreFileName}" >nul 2>&1\r\n` : ''}cordova build android ${cordovaBuildFlag} --buildConfig=build.json
echo ================================================
echo APK generado y firmado exitosamente en:
echo ${expectedApkSubpathWin}
echo ================================================
pause
`);

    zip.file('compilar-apk.sh', `#!/bin/bash
set -e
echo "================================================"
echo "Compilando APK Android (${buildType.toUpperCase()}) con Keystore"
echo "================================================"
${isReleaseAutoKeystore ? `if [ ! -f "${keystoreFileName}" ]; then
  keytool -genkeypair -v -keystore "${keystoreFileName}" -storetype ${keystoreType === 'jks' ? 'JKS' : 'PKCS12'} -keyalg RSA -keysize 2048 -validity 10000 -alias "${effectiveAlias}" -storepass "${effectiveStorePass}" -keypass "${effectiveKeyPass}" -dname "CN=${signing?.distinguishedName?.commonName || 'Return Game'}, O=${signing?.distinguishedName?.organization || 'Return Studio'}, C=${signing?.distinguishedName?.country || 'ES'}"
fi
cp -f "${keystoreFileName}" "platforms/android/${keystoreFileName}" 2>/dev/null || true
` : ''}cordova build android ${cordovaBuildFlag} --buildConfig=build.json
echo "================================================"
echo "APK generado y firmado exitosamente en:"
echo "${expectedApkSubpath}"
echo "================================================"
`);

    // README / LEEME
    zip.file('LEEME_APK_SIGNING.txt', `================================================================
${appDisplayName} (${packageName}) - Paquete Android APK (${buildType.toUpperCase()})
================================================================

Modo de compilación: ${buildType.toUpperCase()}
Application ID: ${packageName}
Versión: ${versionName} (versionCode ${versionCode})
Keystore configurada: ${hasCustomKeystore ? keystoreFileName : (signing?.generateKeystore ? `${keystoreFileName} (autogenerada con keytool)` : 'debug.keystore predeterminada')}
Alias: ${effectiveAlias}

ARCHIVOS INCLUIDOS:
- build.json configurado para Cordova android.debug y android.release.
- config.xml y AndroidManifest.xml con ID "${packageName}".
- platforms/android/app/build.gradle con signingConfigs listas.
- Scripts automáticos: compilar-apk.bat (Windows) y compilar-apk.sh (Linux/Mac).

COMANDO MANUAL:
cordova build android ${cordovaBuildFlag} --buildConfig=build.json

El APK firmado se generará en:
${expectedApkSubpath}
`);

    if (onProgress) onProgress('Comprimiendo paquete APK ZIP...');
    const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    }, (metadata) => {
        if (onProgress) {
            onProgress(`Empaquetando APK con Firma: ${Math.round(metadata.percent)}%`);
        }
    });

    return zipBlob;
}

export async function generateWindowsElectronZIP(
    projectData: ProjectData,
    onProgress?: (msg: string) => void,
    options?: ExportOptions
): Promise<Blob> {
    const zip = new JSZip();

    if (onProgress) onProgress('Filtrando escenas y optimizando recursos para Windows Electron...');
    const filteredData = applyExportDimensionFilter(projectData, options);
    const optimizedData = await compressProjectAssets(filteredData, onProgress);
    const cleanData = JSON.parse(JSON.stringify(optimizedData)) as ProjectData;

    const appFolder = zip.folder('app');
    const assetsFolder = appFolder?.folder('assets');

    let assetCount = 0;
    const base64ToPathMap = new Map<string, string>();

    function decodeDataUriToBytesWin(dataUri: string): Uint8Array | null {
        const commaIdx = dataUri.indexOf(',');
        if (commaIdx === -1) return null;
        const header = dataUri.slice(0, commaIdx);
        const payload = dataUri.slice(commaIdx + 1);
        if (header.includes(';base64')) {
            const binaryStr = atob(payload.replace(/\s+/g, ''));
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return bytes;
        }
        let decodedText = payload;
        try { decodedText = decodeURIComponent(payload); } catch {}
        return new TextEncoder().encode(decodedText);
    }

    function extractAndReplaceWin(obj: any) {
        if (!obj || typeof obj !== 'object') return;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const val = obj[key];
                if (typeof val === 'string' && val.startsWith('data:')) {
                    let relativePath = base64ToPathMap.get(val);
                    if (!relativePath) {
                        const commaIdx = val.indexOf(',');
                        let ext = 'bin';
                        if (commaIdx !== -1) {
                            const header = val.slice(0, commaIdx);
                            const rawPayload = val.slice(commaIdx + 1);
                            if (header.includes('image/png')) ext = 'png';
                            else if (header.includes('image/jpeg') || header.includes('image/jpg')) ext = 'jpg';
                            else if (header.includes('image/webp')) ext = 'webp';
                            else if (header.includes('image/gif')) ext = 'gif';
                            else if (header.includes('image/svg')) ext = 'svg';
                            else if (header.includes('audio/wav')) ext = 'wav';
                            else if (header.includes('audio/mp3') || header.includes('audio/mpeg')) ext = 'mp3';
                            else if (header.includes('audio/ogg')) ext = 'ogg';
                            else if (header.includes('video/mp4')) ext = 'mp4';
                            else if (header.includes('video/webm')) ext = 'webm';
                            else if (header.includes('model/gltf-binary')) ext = 'glb';
                            else if (header.includes('model/gltf+json')) ext = 'gltf';
                            else {
                                try {
                                    if (header.includes(';base64') && atob(rawPayload.slice(0, 12)).startsWith('glTF')) ext = 'glb';
                                    else if ((key === 'modelUrl' || obj.type === '3d-model') && (header.includes('application/json') || header.includes('text/plain'))) ext = 'gltf';
                                    else if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                } catch {
                                    if (key === 'modelUrl' || obj.type === '3d-model') ext = 'glb';
                                }
                            }
                        }

                        try {
                            const bytes = decodeDataUriToBytesWin(val);
                            if (bytes && assetsFolder) {
                                assetCount++;
                                const nameSanitized = obj.name ? String(obj.name).toLowerCase().replace(/[^a-z0-9]/gi, '_') : 'asset';
                                const filename = `${assetCount}_${nameSanitized}.${ext}`;
                                const candidatePath = `assets/${filename}`;
                                assetsFolder.file(filename, bytes);
                                base64ToPathMap.set(val, candidatePath);
                                relativePath = candidatePath;
                            }
                        } catch (e) {
                            console.error('Error al extraer asset para Windows Electron:', e);
                        }
                    }
                    if (relativePath) {
                        obj[key] = relativePath;
                    }
                } else if (typeof val === 'object') {
                    extractAndReplaceWin(val);
                }
            }
        }
    }

    if (onProgress) onProgress('Extrayendo assets multimedia en app/assets/...');
    extractAndReplaceWin(cleanData);

    appFolder?.file('project.json', JSON.stringify(cleanData));

    const has3DScenes = Boolean(cleanData.scenes?.some(s => getSceneDimension(s) === '3d'));
    if (has3DScenes && options?.threeVendorScript) {
        appFolder?.file('vendor/three-bundle.min.js', options.threeVendorScript);
    }

    if (onProgress) onProgress('Generando app/index.html optimizado para Electron desktop...');
    const shouldInstantStart = options?.skipStartScreen !== undefined ? Boolean(options.skipStartScreen) : true;
    const electronHtml = generateGameHTML(cleanData, shouldInstantStart, {
        ...options,
        useLocalThreeVendor: Boolean(has3DScenes && options?.threeVendorScript),
    });
    appFolder?.file('index.html', electronHtml);

    if (onProgress) onProgress('Generando icono Windows (.ico multi-resolución) y scripts Electron...');
    const winCfg: WindowsExportConfig = {
        appName: options?.windowsConfig?.appName || projectData.name || projectData.scenes?.[0]?.name || 'Return Game',
        appId: options?.windowsConfig?.appId,
        version: options?.windowsConfig?.version || '1.0.0',
        fullscreen: options?.windowsConfig?.fullscreen ?? false,
        resizable: options?.windowsConfig?.resizable ?? true,
        width: options?.windowsConfig?.width || projectData.gameWidth || 1280,
        height: options?.windowsConfig?.height || projectData.gameHeight || 720,
    };

    const { iconPng, iconIco } = generateDefaultWindowsIcons();
    const buildFolder = zip.folder('build');
    buildFolder?.file('icon.png', iconPng);
    buildFolder?.file('icon.ico', iconIco);

    zip.file('main.js', generateElectronMainJs(winCfg));
    zip.file('preload.js', generateElectronPreloadJs());
    zip.file('package.json', generateElectronPackageJson(winCfg));

    const scripts = generateWindowsBatchScripts(winCfg.appName || 'Return Game');
    zip.file('JUGAR_EN_WINDOWS.bat', scripts.playBat);
    zip.file('COMPILAR_ELECTRON_EXE.bat', scripts.buildPortableBat);
    zip.file('COMPILAR_INSTALADOR_EXE.bat', scripts.buildInstallerBat);
    zip.file('LEEME_WINDOWS.txt', scripts.readmeTxt);
    zip.file('.github/workflows/build-windows-exe.yml', scripts.githubActionYml);

    if (onProgress) onProgress('Comprimiendo paquete Windows Electron ZIP...');
    return await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    }, (metadata) => {
        if (onProgress) {
            onProgress(`Empaquetando Windows Electron: ${Math.round(metadata.percent)}%`);
        }
    });
}


