import React, { useState, useMemo, useEffect } from 'react';
import type { GameEvent, Condition, Action, Scene, Animation, PoseAnimation, Variable, GameAsset, GameObject, Shape3D } from '../types';
import { TrashIcon } from './icons/TrashIcon';
import { EditIcon } from './icons/EditIcon';
import { useLanguage } from '../LanguageContext';

interface EventEditorProps {
  onClose: () => void;
  onAddEvent: (event: GameEvent) => void;
  onDeleteEvent: (eventId: string) => void;
  onUpdateEvent: (event: GameEvent) => void;
  scene: Scene | undefined;
  animations: Animation[];
  poseAnimations?: PoseAnimation[];
  assets: GameAsset[];
  globalObjects?: GameObject[];
  globalVariables: Variable[];
  onUpdateGlobalVariables?: (vars: Variable[]) => void;
  allScenes: Scene[];
}

interface OptionItem<T extends string = string> {
  value: T;
  label: string;
  needsParams?: string[];
  needsTarget?: boolean;
}

const SHAPE_3D_OPTIONS: { value: Shape3D; label: string }[] = [
  { value: 'box', label: 'Cubo (Box)' },
  { value: 'sphere', label: 'Esfera (Sphere)' },
  { value: 'cylinder', label: 'Cilindro' },
  { value: 'cone', label: 'Cono' },
  { value: 'capsule', label: 'Cápsula' },
  { value: 'plane', label: 'Plano / Suelo' },
  { value: 'torus', label: 'Toro / Aro' },
  { value: 'ramp', label: 'Rampa 3D' },
  { value: 'character', label: 'Personaje 3D' },
  { value: 'coin', label: 'Moneda 3D' },
  { value: 'light', label: 'Foco de Luz 3D' },
  { value: 'tree', label: 'Árbol 3D' },
  { value: 'rock', label: 'Roca 3D' },
];

const CAMERA_3D_MODE_OPTIONS = [
  { value: 'thirdPerson', label: '3ª Persona (Seguir)' },
  { value: 'firstPerson', label: '1ª Persona (FPS)' },
  { value: 'isometric', label: 'Isométrica' },
  { value: 'topDown3D', label: 'Cenital 3D (Top-Down)' },
  { value: 'freeOrbit', label: 'Órbita Libre' },
];

const categorizedTriggerOptions: {
  category: string;
  options: OptionItem<Condition['trigger']>[];
}[] = [
  { category: 'event.category.core', options: [
    { value: 'OnStart', label: 'event.trigger.onStart' },
    { value: 'Always', label: 'event.trigger.always' },
  ]},
  { category: 'event.category.blocks3d', options: [
    { value: 'OnObjectClicked3D', label: 'event.trigger.onObjectClicked3D' },
    { value: 'Distance3DLessThan', label: 'event.trigger.distance3DLessThan', needsTarget: true, needsParams: ['distance'] },
    { value: 'IsGrounded3D', label: 'event.trigger.isGrounded3D' },
  ]},
  { category: 'event.category.input', options: [
    { value: 'OnKeyPress', label: 'event.trigger.onKeyPress', needsParams: ['key'] },
    { value: 'OnKeyRelease', label: 'event.trigger.onKeyRelease', needsParams: ['key'] },
    { value: 'OnAnyKeyPress', label: 'event.trigger.onAnyKeyPress' },
    { value: 'OnAnyKeyRelease', label: 'event.trigger.onAnyKeyRelease' },
    { value: 'OnObjectClicked', label: 'event.trigger.onObjectClicked' },
    { value: 'OnObjectReleased', label: 'event.trigger.onObjectReleased' },
    { value: 'OnInteract', label: 'Al interactuar con objeto [E / Botón]' },
    { value: 'OnJoystickMove', label: 'event.trigger.onJoystickMove' },
    { value: 'OnJoystickUp', label: 'event.trigger.onJoystickUp' },
    { value: 'OnJoystickDown', label: 'event.trigger.onJoystickDown' },
    { value: 'OnJoystickLeft', label: 'event.trigger.onJoystickLeft' },
    { value: 'OnJoystickRight', label: 'event.trigger.onJoystickRight' },
    { value: 'OnButtonDown', label: 'event.trigger.onButtonDown', needsParams: ['buttonName'] },
    { value: 'OnButtonUp', label: 'event.trigger.onButtonUp', needsParams: ['buttonName'] },
    { value: 'OnTriggerDown', label: 'event.trigger.onTriggerDown', needsParams: ['triggerName'] },
    { value: 'OnTriggerUp', label: 'event.trigger.onTriggerUp', needsParams: ['triggerName'] },
    { value: 'OnConsoleCommand', label: 'event.trigger.onConsoleCommand', needsParams: ['command'] },
  ]},
  { category: 'event.category.collision', options: [
    { value: 'OnCollisionWith', label: 'event.trigger.onCollisionWith', needsTarget: true },
    { value: 'OnVerticalCollision', label: 'event.trigger.onVerticalCollision', needsTarget: true },
    { value: 'OnHorizontalCollision', label: 'event.trigger.onHorizontalCollision', needsTarget: true },
  ]},
  { category: 'event.category.objectState', options: [
    { value: 'IsIdle', label: 'event.trigger.isIdle' },
    { value: 'IsRunning', label: 'event.trigger.isRunning' },
    { value: 'IsJumping', label: 'event.trigger.isJumping' },
    { value: 'IsFalling', label: 'event.trigger.isFalling' },
    { value: 'IsOnGround', label: 'event.trigger.isOnGround' },
    { value: 'IsMoving', label: 'event.trigger.isMoving' },
    { value: 'OnAttack', label: 'event.trigger.onAttack' },
    { value: 'OnHealthDepleted', label: 'event.trigger.onHealthDepleted' },
    { value: 'IsClimbing', label: 'Al subir escalera' },
    { value: 'IsLookingLeft', label: 'Al mirar a la izquierda' },
    { value: 'IsLookingRight', label: 'Al mirar a la derecha' },
  ]},
  { category: 'event.category.system', options: [
    { value: 'IsMobile', label: '¿Es dispositivo móvil?' },
    { value: 'IsPC', label: '¿Es PC?' },
    { value: 'IsSceneUnlocked', label: '¿Escena / nivel desbloqueado?', needsParams: ['sceneName'] },
  ]},
  { category: 'event.category.variables', options: [
    { value: 'CompareVariable', label: 'event.trigger.compareVariable', needsParams: ['variable', 'operator', 'value'] },
    { value: 'CompareBooleanVariable', label: 'Comparar Variable Booleana', needsParams: ['variable', 'valueBoolean'] },
    { value: 'CompareObjectVariable', label: 'event.trigger.compareObjectVariable', needsParams: ['variable', 'operator', 'value'] },
    { value: 'CompareObjectBooleanVariable', label: 'Comparar Variable Booleana de Objeto', needsParams: ['variable', 'valueBoolean'] },
    { value: 'CompareStat', label: 'event.trigger.compareStat', needsParams: ['stat', 'operator', 'value'] },
  ]},
  { category: 'event.category.time', options: [
    { value: 'OnTimerElapsed', label: 'event.trigger.onTimerElapsed', needsParams: ['timerName'] },
    { value: 'EveryXSeconds', label: 'event.trigger.everyXSeconds', needsParams: ['interval'] },
  ]},
  { category: 'event.category.ui', options: [
    { value: 'OnDialogueEnd', label: 'event.trigger.onDialogueEnd' },
  ]},
  { category: 'event.category.audio', options: [{ value: 'IsMusicPlaying', label: 'event.trigger.isMusicPlaying' }] },
  { category: 'event.category.network', options: [
    { value: 'OnMatchFound', label: 'event.trigger.onMatchFound' },
    { value: 'OnPlayerJoined', label: 'event.trigger.onPlayerJoined' },
    { value: 'OnPlayerLeft', label: 'event.trigger.onPlayerLeft' },
    { value: 'OnReceiveNetworkMessage', label: 'event.trigger.onReceiveNetworkMessage', needsParams: ['message'] },
  ]},
];
const triggerOptions = categorizedTriggerOptions.flatMap(c => c.options);

const categorizedActionOptions: {
  category: string;
  options: OptionItem<Action['action']>[];
}[] = [
  { category: 'event.category.blocks3d', options: [
    { value: 'SetPosition3D', label: 'event.action.setPosition3D', needsParams: ['x3d', 'y3d', 'z3d'] },
    { value: 'Move3D', label: 'event.action.move3D', needsParams: ['dx', 'dy', 'dz'] },
    { value: 'Rotate3D', label: 'event.action.rotate3D', needsParams: ['rx', 'ry', 'rz'] },
    { value: 'RotateContinuously3D', label: 'event.action.rotateContinuously3D', needsParams: ['axis3d', 'speed'] },
    { value: 'Scale3D', label: 'event.action.scale3D', needsParams: ['sx', 'sy', 'sz'] },
    { value: 'ForceJump3D', label: 'event.action.forceJump3D', needsParams: ['jumpForce'] },
    { value: 'ApplyImpulse3D', label: 'event.action.applyImpulse3D', needsParams: ['ix', 'iy', 'iz'] },
    { value: 'SetShape3D', label: 'event.action.setShape3D', needsParams: ['shape3D'] },
    { value: 'SetColor3D', label: 'event.action.setColor3D', needsParams: ['color', 'emissiveColor', 'emissiveIntensity'] },
    { value: 'SetModel3D', label: 'Cambiar Modelo 3D (.glb)', needsParams: ['modelUrl'] },
    { value: 'SetCamera3DMode', label: 'event.action.setCamera3DMode', needsParams: ['cameraMode', 'targetObjectName'] },
    { value: 'SetCamera3DOffset', label: 'event.action.setCamera3DOffset', needsParams: ['cx', 'cy', 'cz'] },
    { value: 'SetCamera3DMovement', label: 'Mover Cámara 3D (Activar/Desactivar)', needsParams: ['enabled'] },
    { value: 'LookAtObject3D', label: 'event.action.lookAtObject3D', needsParams: ['targetObjectName'] },
    { value: 'MoveTowards3D', label: 'event.action.moveTowards3D', needsParams: ['targetObjectName', 'speed'] },
    { value: 'CreateObject3D', label: 'event.action.createObject3D', needsParams: ['templateObjectName', 'x3d', 'y3d', 'z3d'] },
    { value: 'Shoot3D', label: 'event.action.shoot3D', needsParams: ['damage', 'speed', 'color'] },
    { value: 'SetLight3D', label: 'event.action.setLight3D', needsParams: ['intensity', 'distance', 'color'] },
    { value: 'SetFog3D', label: 'event.action.setFog3D', needsParams: ['enabled', 'color', 'density'] },
    { value: 'SetSkybox3D', label: 'event.action.setSkybox3D', needsParams: ['imageUrl'] },
    { value: 'PlayAnimation3D', label: 'event.action.playAnimation3D', needsParams: ['poseAnimationId', 'modelAnimName', 'loop3D', 'speed'] },
    { value: 'StopAnimation3D', label: 'event.action.stopAnimation3D' },
  ]},
  { category: 'event.category.object', options: [
    { value: 'Destroy', label: 'event.action.destroy' },
    { value: 'CreateObject', label: 'event.action.createObject', needsParams: ['templateObjectName'] },
    { value: 'EnableBehavior', label: 'Habilitar Comportamiento', needsParams: ['behaviorName'] },
    { value: 'DisableBehavior', label: 'Deshabilitar Comportamiento', needsParams: ['behaviorName'] },
    { value: 'SetObjectPosition', label: 'event.action.setPosition', needsParams: ['x', 'y'] },
    { value: 'TeleportToObject', label: 'Teletransportar a Objeto', needsParams: ['targetObjectName'] },
    { value: 'MoveObject', label: 'event.action.moveDirection', needsParams: ['direction', 'speed'] },
    { value: 'RunAtSpeed', label: 'event.action.runAtSpeed', needsParams: ['speed', 'runMode'] },
    { value: 'SetVelocityX', label: 'event.action.setVelocityX', needsParams: ['vx'] },
    { value: 'SetVelocityY', label: 'event.action.setVelocityY', needsParams: ['vy'] },
    { value: 'MoveTo', label: 'event.action.moveTo', needsParams: ['x', 'y', 'duration'] },
    { value: 'OscillateObject', label: 'event.action.oscillate', needsParams: ['axis', 'distance', 'speed'] },
    { value: 'OscillateScale', label: 'event.action.oscillateScale', needsParams: ['distance', 'speed'] },
    { value: 'RotateContinuously', label: 'event.action.rotateContinuously', needsParams: ['speed'] },
    { value: 'RotateObject', label: 'event.action.rotate', needsParams: ['rotation'] },
    { value: 'RotateTo', label: 'event.action.rotateTo', needsParams: ['rotation', 'duration'] },
    { value: 'ScaleObject', label: 'event.action.scale', needsParams: ['scaleX', 'scaleY'] },
    { value: 'ScaleTo', label: 'event.action.scaleTo', needsParams: ['scaleX', 'scaleY', 'duration'] },
    { value: 'SetScale', label: 'event.action.setScale', needsParams: ['scaleX', 'scaleY'] },
    { value: 'SetVisible', label: 'event.action.setVisible', needsParams: ['visible'] },
    { value: 'SetOpacity', label: 'event.action.setOpacity', needsParams: ['opacity'] },
    { value: 'SetZIndex', label: 'event.action.setZIndex', needsParams: ['zIndex'] },
    { value: 'SetFlipX', label: 'event.action.setFlipX', needsParams: ['flip'] },
    { value: 'SetFlipY', label: 'event.action.setFlipY', needsParams: ['flip'] },
    { value: 'SlideTo', label: 'event.action.slideTo', needsParams: ['x', 'y', 'duration'] },
    { value: 'SetDraggable', label: 'event.action.setDraggable', needsParams: ['enabled', 'lockX', 'lockY', 'minX', 'maxX', 'minY', 'maxY'] },
    { value: 'EnableCollision', label: 'event.action.enableCollision' },
    { value: 'DisableCollision', label: 'event.action.disableCollision' },
    { value: 'FollowObject', label: 'Seguir Objeto', needsParams: ['targetObjectName', 'speed'] },
    { value: 'MoveInDirection', label: 'Mover en Dirección', needsParams: ['direction', 'speed'] },
    { value: 'GenerateObjectAt', label: 'event.action.generateAt', needsParams: ['templateObjectName', 'targetObjectName'] },
    { value: 'ForceJump', label: 'event.action.forceJump', needsParams: ['jumpForce'] },
    { value: 'TriggerAttack', label: 'event.action.triggerAttack' },
    { value: 'Shoot', label: 'event.action.shoot', needsParams: ['damage', 'speed'] },
    { value: 'CreatePlayers', label: 'event.action.createPlayers', needsParams: ['count'] },
    { value: 'DisconnectPlayers', label: 'event.action.disconnectPlayers' },
    { value: 'SetParent', label: 'event.action.setParent', needsParams: ['parentName'] },
    { value: 'Knockback', label: 'event.action.knockback', needsParams: ['force', 'fromObjectName'] },
  ]},
  { category: 'event.category.visuals', options: [
    { value: 'PlayAnimation', label: 'event.action.playAnimation', needsParams: ['animationId'] },
    { value: 'SetSkin', label: 'Establecer Skin (Imagen/Color)', needsParams: ['imageUrl', 'color'] },
    { value: 'SetPlayerSkin', label: 'Cambiar Skin de Player', needsParams: ['imageUrl', 'color'] },
    { value: 'PlayVideo', label: 'event.action.playVideo', needsParams: ['videoAssetId'] },
    { value: 'PauseVideo', label: 'event.action.pauseVideo', needsParams: ['videoAssetId'] },
    { value: 'StopVideo', label: 'event.action.stopVideo' },
  ]},
  { category: 'event.category.variables', options: [
    { value: 'AddToVariable', label: 'event.action.addToVariable', needsParams: ['variable', 'value'] },
    { value: 'SetVariable', label: 'event.action.setVariable', needsParams: ['variable', 'value'] },
    { value: 'SetBooleanVariable', label: 'Establecer Variable Booleana', needsParams: ['variable', 'valueBoolean'] },
    { value: 'ToggleBooleanVariable', label: 'Alternar Variable Booleana', needsParams: ['variable'] },
    { value: 'AddToObjectVariable', label: 'event.action.addToObjectVariable', needsParams: ['variable', 'value'] },
    { value: 'SetObjectVariable', label: 'event.action.setObjectVariable', needsParams: ['variable', 'value'] },
    { value: 'SetObjectBooleanVariable', label: 'Establecer Var. Booleana de Objeto', needsParams: ['variable', 'valueBoolean'] },
    { value: 'ToggleObjectBooleanVariable', label: 'Alternar Var. Booleana de Objeto', needsParams: ['variable'] },
    { value: 'ModifyStat', label: 'event.action.modifyStat', needsParams: ['stat', 'operation', 'value'] },
    { value: 'GainHealth', label: 'event.action.gainHealth', needsParams: ['value'] },
    { value: 'LoseHealth', label: 'event.action.loseHealth', needsParams: ['value'] },
    { value: 'SaveGame', label: 'event.action.saveGame', needsParams: ['slot'] },
    { value: 'LoadGame', label: 'event.action.loadGame', needsParams: ['slot'] },
  ]},
  { category: 'event.category.sceneAndCamera', options: [
    { value: 'GoToScene', label: 'event.action.goToScene', needsParams: ['sceneName'] },
    { value: 'SetBackgroundColor', label: 'event.action.setBackgroundColor', needsParams: ['color'] },
    { value: 'SetCameraZoom', label: 'event.action.setCameraZoom', needsParams: ['zoomLevel'] },
    { value: 'SetSceneUnlocked', label: 'Establecer Escena Desbloqueada', needsParams: ['sceneName', 'valueBoolean'] },
  ]},
  { category: 'event.category.ui', options: [
    { value: 'SetUIText', label: 'event.action.setUIText', needsParams: ['text'] },
    { value: 'SetJoystickEnabled', label: 'Activar/Desactivar Joystick', needsParams: ['enabled'] },
    { value: 'ShowDialogue', label: 'event.action.showDialogue', needsParams: ['dialogueText'] },
    { value: 'ShowConsole', label: 'event.action.showConsole' },
  ]},
  { category: 'event.category.audio', options: [
    { value: 'PlaySound', label: 'event.action.playSound', needsParams: ['soundId', 'loop'] },
    { value: 'SetBackgroundMusic', label: 'event.action.setBackgroundMusic', needsParams: ['soundId', 'loop'] },
    { value: 'PauseBackgroundMusic', label: 'event.action.pauseBackgroundMusic' },
    { value: 'ResumeBackgroundMusic', label: 'event.action.resumeBackgroundMusic' },
    { value: 'StopBackgroundMusic', label: 'event.action.stopBackgroundMusic' },
    { value: 'SetBackgroundMusicVolume', label: 'event.action.setBackgroundMusicVolume', needsParams: ['volume'] },
  ]},
  { category: 'event.category.time', options: [
    { value: 'StartTimer', label: 'event.action.startTimer', needsParams: ['timerName', 'duration'] },
    { value: 'StopTimer', label: 'event.action.stopTimer', needsParams: ['timerName'] },
    { value: 'Wait', label: 'Esperar X segundos', needsParams: ['duration'] },
  ]},
  { category: 'event.category.rpg', options: [
    { value: 'SetQuestState', label: 'event.action.setQuestState', needsParams: ['questId', 'questState'] },
  ]},
  { category: 'event.category.network', options: [
    { value: 'CreateMatch', label: 'event.action.createMatch', needsParams: ['maxPlayers'] },
    { value: 'JoinMatch', label: 'event.action.joinMatch', needsParams: ['matchId'] },
    { value: 'SendNetworkMessage', label: 'event.action.sendNetworkMessage', needsParams: ['message'] },
    { value: 'SetPlayerName', label: 'event.action.setPlayerName', needsParams: ['name'] },
  ]},
];
const actionOptions = categorizedActionOptions.flatMap(c => c.options);

interface BlockPaletteDef {
  id: string;
  kind: 'trigger' | 'action';
  trigger?: Condition['trigger'];
  action?: Action['action'];
  label: string;
  color: string;
  badge: string;
  defaultParams?: Record<string, any>;
}

const BLOCK_3D_PALETTE_CATEGORIES: {
  id: string;
  title: string;
  accent: string;
  blocks: BlockPaletteDef[];
}[] = [
  {
    id: 'triggers3d',
    title: 'Eventos / Disparadores 3D',
    accent: 'border-amber-500/40 bg-amber-950/20',
    blocks: [
      { id: 't_onstart', kind: 'trigger', trigger: 'OnStart', label: 'Al iniciar escena 3D', color: 'bg-amber-600 border-amber-400', badge: 'CUANDO' },
      { id: 't_always', kind: 'trigger', trigger: 'Always', label: 'Cada frame (Siempre)', color: 'bg-amber-600 border-amber-400', badge: 'BUCLE' },
      { id: 't_key', kind: 'trigger', trigger: 'OnKeyPress', label: 'Al pulsar tecla', color: 'bg-amber-600 border-amber-400', badge: 'TECLA', defaultParams: { key: 'space' } },
      { id: 't_click3d', kind: 'trigger', trigger: 'OnObjectClicked3D', label: 'Al tocar / clic objeto 3D', color: 'bg-amber-600 border-amber-400', badge: 'CLIC 3D' },
      { id: 't_col', kind: 'trigger', trigger: 'OnCollisionWith', label: 'Al chocar 3D con...', color: 'bg-amber-600 border-amber-400', badge: 'COLISIÓN' },
      { id: 't_dist3d', kind: 'trigger', trigger: 'Distance3DLessThan', label: 'Distancia 3D menor que', color: 'bg-amber-600 border-amber-400', badge: 'DIST 3D', defaultParams: { distance: 3 } },
      { id: 't_ground3d', kind: 'trigger', trigger: 'IsGrounded3D', label: 'Si toca suelo 3D', color: 'bg-amber-600 border-amber-400', badge: 'SUELO 3D' },
      { id: 't_var_eq', kind: 'trigger', trigger: 'CompareVariable', label: 'Si Variable = Valor', color: 'bg-amber-600 border-amber-400', badge: 'VAR ==', defaultParams: { variable: 'score', operator: '==', value: '10' } },
      { id: 't_var_gt', kind: 'trigger', trigger: 'CompareVariable', label: 'Si Variable > Valor', color: 'bg-amber-600 border-amber-400', badge: 'VAR >', defaultParams: { variable: 'score', operator: '>', value: '0' } },
      { id: 't_var_lt', kind: 'trigger', trigger: 'CompareVariable', label: 'Si Variable < Valor', color: 'bg-amber-600 border-amber-400', badge: 'VAR <', defaultParams: { variable: 'score', operator: '<', value: '10' } },
      { id: 't_var_gte', kind: 'trigger', trigger: 'CompareVariable', label: 'Si Variable >= Valor', color: 'bg-amber-600 border-amber-400', badge: 'VAR >=', defaultParams: { variable: 'score', operator: '>=', value: '10' } },
      { id: 't_var_lte', kind: 'trigger', trigger: 'CompareVariable', label: 'Si Variable <= Valor', color: 'bg-amber-600 border-amber-400', badge: 'VAR <=', defaultParams: { variable: 'score', operator: '<=', value: '0' } },
    ]
  },
  {
    id: 'physics3d',
    title: 'Movimiento y Física 3D',
    accent: 'border-blue-500/40 bg-blue-950/20',
    blocks: [
      { id: 'a_move3d', kind: 'action', action: 'Move3D', label: 'Mover 3D (dX, dY, dZ)', color: 'bg-blue-600 border-blue-400', badge: 'MOV 3D', defaultParams: { dx: 2, dy: 0, dz: 0 } },
      { id: 'a_runspeed3d', kind: 'action', action: 'RunAtSpeed', label: 'Correr a Velocidad (Personalizada)', color: 'bg-blue-600 border-blue-400', badge: 'CORRER', defaultParams: { speed: 12, runMode: 'active' } },
      { id: 'a_pos3d', kind: 'action', action: 'SetPosition3D', label: 'Fijar Posición 3D (X, Y, Z)', color: 'bg-blue-600 border-blue-400', badge: 'POS 3D', defaultParams: { x3d: 0, y3d: 1, z3d: 0 } },
      { id: 'a_jump3d', kind: 'action', action: 'ForceJump3D', label: 'Salto 3D (Fuerza Y)', color: 'bg-blue-600 border-blue-400', badge: 'SALTO 3D', defaultParams: { jumpForce: 7 } },
      { id: 'a_imp3d', kind: 'action', action: 'ApplyImpulse3D', label: 'Impulso 3D (X, Y, Z)', color: 'bg-blue-600 border-blue-400', badge: 'IMPULSO', defaultParams: { ix: 0, iy: 6, iz: -4 } },
      { id: 'a_follow3d', kind: 'action', action: 'MoveTowards3D', label: 'Perseguir Objeto 3D', color: 'bg-blue-600 border-blue-400', badge: 'SEGUIR 3D', defaultParams: { speed: 3.5 } },
      { id: 'a_look3d', kind: 'action', action: 'LookAtObject3D', label: 'Mirar hacia Objeto 3D', color: 'bg-blue-600 border-blue-400', badge: 'MIRAR 3D' },
    ]
  },
  {
    id: 'transform3d',
    title: 'Rotación, Forma y Material 3D',
    accent: 'border-violet-500/40 bg-violet-950/20',
    blocks: [
      { id: 'a_rot3d', kind: 'action', action: 'Rotate3D', label: 'Rotar 3D (° X, Y, Z)', color: 'bg-violet-600 border-violet-400', badge: 'ROT 3D', defaultParams: { rx: 0, ry: 45, rz: 0 } },
      { id: 'a_rotc3d', kind: 'action', action: 'RotateContinuously3D', label: 'Rotar Continuo 3D', color: 'bg-violet-600 border-violet-400', badge: 'GIRO 3D', defaultParams: { axis3d: 'y', speed: 120 } },
      { id: 'a_scale3d', kind: 'action', action: 'Scale3D', label: 'Escala 3D (W, H, D)', color: 'bg-violet-600 border-violet-400', badge: 'ESC 3D', defaultParams: { sx: 1.2, sy: 1.2, sz: 1.2 } },
      { id: 'a_shape3d', kind: 'action', action: 'SetShape3D', label: 'Cambiar Forma 3D', color: 'bg-violet-600 border-violet-400', badge: 'FORMA 3D', defaultParams: { shape3D: 'sphere' } },
      { id: 'a_color3d', kind: 'action', action: 'SetColor3D', label: 'Color y Brillo Emisivo 3D', color: 'bg-violet-600 border-violet-400', badge: 'MAT 3D', defaultParams: { color: '#38bdf8', emissiveColor: '#000000', emissiveIntensity: 0 } },
      { id: 'a_model3d', kind: 'action', action: 'SetModel3D', label: 'Cambiar Modelo 3D (.glb)', color: 'bg-violet-600 border-violet-400', badge: 'MODELO 3D', defaultParams: { modelUrl: '' } },
      { id: 'a_playanim3d', kind: 'action', action: 'PlayAnimation3D', label: 'Reproducir Animación 3D', color: 'bg-violet-600 border-violet-400', badge: 'ANIM 3D', defaultParams: { poseAnimationId: '', modelAnimName: '', loop3D: 'default', speed: 1 } },
      { id: 'a_stopanim3d', kind: 'action', action: 'StopAnimation3D', label: 'Detener Animación 3D', color: 'bg-violet-600 border-violet-400', badge: 'STOP 3D' },
    ]
  },
  {
    id: 'camera3d',
    title: 'Cámara, Luces y Niebla 3D',
    accent: 'border-emerald-500/40 bg-emerald-950/20',
    blocks: [
      { id: 'a_cam_mode', kind: 'action', action: 'SetCamera3DMode', label: 'Modo Cámara 3D', color: 'bg-emerald-600 border-emerald-400', badge: 'CÁM 3D', defaultParams: { cameraMode: 'thirdPerson' } },
      { id: 'a_cam_off', kind: 'action', action: 'SetCamera3DOffset', label: 'Offset Cámara 3D (X, Y, Z)', color: 'bg-emerald-600 border-emerald-400', badge: 'OFFSET', defaultParams: { cx: 0, cy: 5, cz: 9 } },
      { id: 'a_cam_move', kind: 'action', action: 'SetCamera3DMovement', label: 'Mover Cámara 3D (Libre/Fija)', color: 'bg-emerald-600 border-emerald-400', badge: 'MOV CÁM', defaultParams: { enabled: true } },
      { id: 'a_light3d', kind: 'action', action: 'SetLight3D', label: 'Configurar Luz 3D', color: 'bg-emerald-600 border-emerald-400', badge: 'LUZ 3D', defaultParams: { intensity: 1.8, distance: 18, color: '#fef08a' } },
      { id: 'a_fog3d', kind: 'action', action: 'SetFog3D', label: 'Niebla 3D (Fog)', color: 'bg-emerald-600 border-emerald-400', badge: 'NIEBLA', defaultParams: { enabled: true, color: '#0f172a', density: 0.025 } },
      { id: 'a_skybox3d', kind: 'action', action: 'SetSkybox3D', label: 'Skybox 3D (Imagen)', color: 'bg-emerald-600 border-emerald-400', badge: 'SKYBOX', defaultParams: { imageUrl: '' } },
    ]
  },
  {
    id: 'gameplay3d',
    title: 'Juego, Spawning y Compatibilidad 2D',
    accent: 'border-rose-500/40 bg-rose-950/20',
    blocks: [
      { id: 'a_spawn3d', kind: 'action', action: 'CreateObject3D', label: 'Crear Objeto en 3D (X, Y, Z)', color: 'bg-rose-600 border-rose-400', badge: 'SPAWN 3D', defaultParams: { x3d: 0, y3d: 1, z3d: 0 } },
      { id: 'a_shoot3d', kind: 'action', action: 'Shoot3D', label: 'Disparar Proyectil 3D', color: 'bg-rose-600 border-rose-400', badge: 'TIRO 3D', defaultParams: { damage: 20, speed: 14, color: '#facc15' } },
      { id: 'a_addvar', kind: 'action', action: 'AddToVariable', label: 'Sumar a Variable Global', color: 'bg-rose-600 border-rose-400', badge: 'VAR +', defaultParams: { variable: 'score', value: 10 } },
      { id: 'a_setvar', kind: 'action', action: 'SetVariable', label: 'Fijar Variable Global', color: 'bg-rose-600 border-rose-400', badge: 'VAR =', defaultParams: { variable: 'score', value: 0 } },
      { id: 'a_destroy', kind: 'action', action: 'Destroy', label: 'Destruir Objeto', color: 'bg-rose-600 border-rose-400', badge: 'DESTRUIR' },
      { id: 'a_scene', kind: 'action', action: 'GoToScene', label: 'Cambiar de Escena', color: 'bg-rose-600 border-rose-400', badge: 'ESCENA' },
    ]
  },
];

const SelectorModal: React.FC<{
  title: string;
  categorizedItems: { category: string; options: { value: string; label: string }[] }[];
  onSelect: (value: string) => void;
  onClose: () => void;
}> = ({ title, categorizedItems, onSelect, onClose }) => {
  const { t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState(categorizedItems[0].category);

  return (
    <div className="absolute inset-0 bg-gray-900/85 z-30 flex items-center justify-center p-2" onClick={onClose}>
      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl h-96 flex flex-col border border-gray-700" onClick={e => e.stopPropagation()}>
        <h4 className="text-md font-bold p-3 text-center border-b border-gray-700 shrink-0 text-white">{title}</h4>
        <div className="flex-grow flex min-h-0">
          <aside className="w-2/5 sm:w-1/3 border-r border-gray-700 p-2 overflow-y-auto space-y-0.5">
            {categorizedItems.map(group => (
              <button
                key={group.category}
                onClick={() => setActiveCategory(group.category)}
                className={`w-full text-left text-xs sm:text-sm p-2 rounded-md transition-colors ${activeCategory === group.category ? 'bg-indigo-600 text-white font-semibold' : 'hover:bg-gray-700 text-gray-300'}`}
              >
                {t(group.category)}
              </button>
            ))}
          </aside>
          <main className="w-3/5 sm:w-2/3 p-2 overflow-y-auto">
            <ul className="space-y-1">
              {(categorizedItems.find(g => g.category === activeCategory)?.options || []).map(option => (
                <li
                  key={option.value}
                  onClick={() => onSelect(option.value)}
                  className="p-2 rounded-md hover:bg-indigo-600 cursor-pointer text-gray-200 transition-colors"
                >
                  <h5 className="font-semibold text-xs sm:text-sm">{t(option.label)}</h5>
                </li>
              ))}
            </ul>
          </main>
        </div>
      </div>
    </div>
  );
};

const EventEditor: React.FC<EventEditorProps> = ({
  onClose,
  onAddEvent,
  onDeleteEvent,
  onUpdateEvent,
  scene,
  animations,
  poseAnimations = [],
  assets,
  globalObjects,
  globalVariables,
  onUpdateGlobalVariables,
  allScenes
}) => {
  const { t } = useLanguage();
  const [studioMode, setStudioMode] = useState<'2d_events' | '3d_blocks'>('2d_events');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [eventDimension, setEventDimension] = useState<'2D' | '3D'>(scene?.sceneMode === '3d' ? '3D' : '2D');
  const [conditions, setConditions] = useState<Partial<Condition>[]>([{}]);
  const [actions, setActions] = useState<Partial<Action>[]>([{}]);
  const [selectorOpen, setSelectorOpen] = useState<{ type: 'condition' | 'action'; index: number } | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [showGlobalVarsPanel, setShowGlobalVarsPanel] = useState(false);
  const [newVarName, setNewVarName] = useState('');
  const [newVarValue, setNewVarValue] = useState('0');
  const [copiedEvent, setCopiedEvent] = useState<GameEvent | null>(() => {
    try {
      const raw = localStorage.getItem('return2d-copied-event');
      return raw ? (JSON.parse(raw) as GameEvent) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    setEventDimension(scene?.sceneMode === '3d' ? '3D' : '2D');
  }, [scene?.id, scene?.sceneMode]);

  // 3D Block Stack workspace state
  const [blockStackCondition, setBlockStackCondition] = useState<Partial<Condition>>({
    object: 'System',
    trigger: 'OnStart',
    params: {}
  });
  const [blockStackActions, setBlockStackActions] = useState<Partial<Action>[]>([]);
  const [editingBlockEventId, setEditingBlockEventId] = useState<string | null>(null);

  const objectNames = useMemo(() => scene?.gameObjects.map(obj => obj.name) ?? [], [scene]);
  const globalObjectNames = useMemo(() => globalObjects?.map(obj => obj.name) ?? [], [globalObjects]);
  const templateObjectNames = useMemo(() => {
    const names = new Set([...objectNames, ...globalObjectNames]);
    return Array.from(names);
  }, [objectNames, globalObjectNames]);

  const audioAssets = useMemo(() => assets.filter(a => a.type === 'audio'), [assets]);
  const videoAssets = useMemo(() => assets.filter(a => a.type === 'video'), [assets]);
  const globalVariableNames = useMemo(() => {
    const names = new Set<string>();
    globalVariables.forEach(v => {
      if (v.name && v.name.trim()) names.add(v.name.trim());
    });
    allScenes.forEach(sc => {
      sc.events?.forEach(ev => {
        ev.conditions?.forEach(c => {
          if (['CompareVariable', 'CompareBooleanVariable'].includes(c.trigger) && c.params?.variable) {
            names.add(String(c.params.variable).trim());
          }
        });
        ev.actions?.forEach(a => {
          if (['SetVariable', 'AddToVariable', 'SetBooleanVariable', 'ToggleBooleanVariable'].includes(a.action) && a.params?.variable) {
            names.add(String(a.params.variable).trim());
          }
        });
      });
      sc.gameObjects?.forEach(obj => {
        obj.behaviors?.forEach(b => {
          if ((b.name === 'ScoreCounter' || b.name === 'TextVariable') && b.properties?.variableName) {
            names.add(String(b.properties.variableName).trim());
          }
        });
      });
    });
    return Array.from(names);
  }, [globalVariables, allScenes]);
  const sceneNames = useMemo(() => allScenes.map(s => s.name), [allScenes]);
  const allEvents = useMemo(() => scene?.events || [], [scene?.events]);

  const SYSTEM_TRIGGERS = new Set([
    'CompareVariable', 'CompareBooleanVariable', 'OnStart', 'Always', 'OnKeyPress', 'OnKeyRelease',
    'OnAnyKeyPress', 'OnAnyKeyRelease', 'EveryXSeconds', 'OnTimerElapsed', 'OnDialogueEnd',
    'IsMobile', 'IsPC', 'IsSceneUnlocked', 'IsMusicPlaying', 'OnJoystickMove', 'OnJoystickUp',
    'OnJoystickDown', 'OnJoystickLeft', 'OnJoystickRight', 'OnButtonDown', 'OnButtonUp',
    'OnTriggerDown', 'OnTriggerUp', 'OnConsoleCommand', 'OnMatchFound', 'OnPlayerJoined',
    'OnPlayerLeft', 'OnReceiveNetworkMessage'
  ]);

  const SYSTEM_ACTIONS = new Set([
    'SetVariable', 'AddToVariable', 'SetBooleanVariable', 'ToggleBooleanVariable', 'GoToScene',
    'SaveGame', 'LoadGame', 'StartTimer', 'StopTimer', 'Wait', 'SetBackgroundColor',
    'SetCameraZoom', 'SetSceneUnlocked', 'SetJoystickEnabled', 'ShowDialogue', 'ShowConsole',
    'PlaySound', 'SetBackgroundMusic', 'PauseBackgroundMusic', 'ResumeBackgroundMusic',
    'StopBackgroundMusic', 'SetBackgroundMusicVolume', 'SetCamera3DMode', 'SetCamera3DOffset', 'SetCamera3DMovement',
    'SetFog3D', 'SetSkybox3D', 'SetQuestState', 'CreateMatch', 'JoinMatch', 'SendNetworkMessage',
    'CreateObject', 'CreateObject3D', 'GenerateObjectAt'
  ]);

  const getDefaultConditionParams = (trigger?: Condition['trigger']) => {
    const firstVar = globalVariableNames[0] || 'score';
    if (trigger === 'CompareVariable') return { variable: firstVar, operator: '==', value: '0' };
    if (trigger === 'CompareObjectVariable') return { variable: '', operator: '==', value: '0' };
    if (trigger === 'CompareStat') return { stat: 'hp', operator: '==', value: '0' };
    if (trigger === 'CompareBooleanVariable') return { variable: firstVar, valueBoolean: true };
    if (trigger === 'CompareObjectBooleanVariable') return { variable: '', valueBoolean: true };
    if (trigger === 'Distance3DLessThan') return { distance: 3 };
    if (trigger === 'EveryXSeconds') return { interval: 1 };
    return {};
  };

  const getDefaultActionParams = (actionName?: Action['action']) => {
    const firstVar = globalVariableNames[0] || 'score';
    if (actionName === 'PlayAnimation3D') {
      return { poseAnimationId: poseAnimations[0]?.id || '', modelAnimName: '', loop3D: 'default', speed: 1 };
    }
    if (actionName === 'AddToVariable') return { variable: firstVar, value: '1' };
    if (actionName === 'SetVariable') return { variable: firstVar, value: '0' };
    if (actionName === 'SetBooleanVariable') return { variable: firstVar, valueBoolean: true };
    if (actionName === 'ToggleBooleanVariable') return { variable: firstVar };
    if (actionName === 'AddToObjectVariable') return { variable: '', value: '1' };
    if (actionName === 'SetObjectVariable') return { variable: '', value: '0' };
    if (actionName === 'RunAtSpeed') return { speed: scene?.sceneMode === '3d' ? 12 : 400, runMode: 'active' };
    if (actionName === 'SaveGame' || actionName === 'LoadGame') return { slot: '1' };
    if (actionName === 'Wait') return { duration: 1 };
    return {};
  };

  const ensureGlobalVariablesRegistered = (condList: Partial<Condition>[], actList: Partial<Action>[]) => {
    if (!onUpdateGlobalVariables) return;
    const nextVars = [...globalVariables];
    let changed = false;
    const registerIfMissing = (nameRaw: any, defaultVal: string | number | boolean = 0) => {
      const name = String(nameRaw || '').trim();
      if (!name) return;
      if (!nextVars.some(v => v.name === name)) {
        nextVars.push({ name, value: defaultVal });
        changed = true;
      }
    };

    condList.forEach(c => {
      if (c.trigger === 'CompareVariable') registerIfMissing(c.params?.variable, 0);
      if (c.trigger === 'CompareBooleanVariable') registerIfMissing(c.params?.variable, false);
    });
    actList.forEach(a => {
      if (a.action === 'SetVariable' || a.action === 'AddToVariable') registerIfMissing(a.params?.variable, 0);
      if (a.action === 'SetBooleanVariable' || a.action === 'ToggleBooleanVariable') registerIfMissing(a.params?.variable, false);
    });

    if (changed) {
      onUpdateGlobalVariables(nextVars);
    }
  };

  const handleAddInlineGlobalVar = () => {
    const cleanName = newVarName.trim();
    if (!cleanName || !onUpdateGlobalVariables) return;
    const trimmedVal = newVarValue.trim();
    const parsedVal: string | number | boolean =
      trimmedVal === 'true' ? true :
      trimmedVal === 'false' ? false :
      (trimmedVal !== '' && !isNaN(Number(trimmedVal))) ? Number(trimmedVal) : trimmedVal;
    const existing = globalVariables.findIndex(v => v.name === cleanName);
    if (existing >= 0) {
      onUpdateGlobalVariables(globalVariables.map((v, i) => i === existing ? { name: cleanName, value: parsedVal } : v));
    } else {
      onUpdateGlobalVariables([...globalVariables, { name: cleanName, value: parsedVal }]);
    }
    setNewVarName('');
    setNewVarValue('0');
  };

  const defaultActorName = useMemo(() => {
    return (
      objectNames.find(n => n.toLowerCase().includes('player') || n.toLowerCase().includes('jugador')) ||
      objectNames[0] ||
      'System'
    );
  }, [objectNames]);

  const showTempNotice = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice(prev => (prev === msg ? null : prev));
    }, 2200);
  };

  const handleCopyEvent = (event: GameEvent) => {
    const cloned = JSON.parse(JSON.stringify(event)) as GameEvent;
    setCopiedEvent(cloned);
    try {
      localStorage.setItem('return2d-copied-event', JSON.stringify(cloned));
    } catch {
      // ignore storage issues
    }
    showTempNotice('Evento copiado. Pulsa "Pegar Evento" o Ctrl+V aquí o en otra escena.');
  };

  const handlePasteEvent = () => {
    if (!copiedEvent) return;
    const cloned: GameEvent = {
      ...JSON.parse(JSON.stringify(copiedEvent)),
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    };
    ensureGlobalVariablesRegistered(cloned.conditions || [], cloned.actions || []);
    onAddEvent(cloned);
    showTempNotice('Evento pegado en la escena.');
  };

  const handleDuplicateEvent = (event: GameEvent) => {
    const cloned: GameEvent = {
      ...JSON.parse(JSON.stringify(event)),
      id: `evt_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    };
    ensureGlobalVariablesRegistered(cloned.conditions || [], cloned.actions || []);
    onAddEvent(cloned);
    showTempNotice('Evento duplicado.');
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (copiedEvent && !isFormOpen) {
          e.preventDefault();
          handlePasteEvent();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const handleEditEvent = (event: GameEvent) => {
    // Always open visual/3D/block events in the standard Event Editor form
    setStudioMode('2d_events');
    setEditingBlockEventId(null);
    setEditingEventId(event.id);
    setEventDimension(
      event.dimension || (event.programmingMode === 'blocks' || scene?.sceneMode === '3d' ? '3D' : '2D')
    );
    setConditions(
      event.conditions && event.conditions.length > 0
        ? JSON.parse(JSON.stringify(event.conditions))
        : [{}]
    );
    setActions(
      event.actions && event.actions.length > 0
        ? JSON.parse(JSON.stringify(event.actions))
        : [{}]
    );
    setIsFormOpen(true);
    setValidationMessage(null);
  };

  const handleAddNewEventClick = () => {
    setEditingEventId(null);
    setEventDimension(scene?.sceneMode === '3d' ? '3D' : '2D');
    setConditions([{}]);
    setActions([{}]);
    setIsFormOpen(true);
    setValidationMessage(null);
  };

  const handleCancel = () => {
    setEditingEventId(null);
    setIsFormOpen(false);
    setConditions([{}]);
    setActions([{}]);
    setValidationMessage(null);
  };

  const handleSaveEvent = () => {
    const normalizedConditions = conditions.map(c => {
      const next = { ...c };
      if (!next.object && next.trigger && SYSTEM_TRIGGERS.has(next.trigger)) {
        next.object = 'System';
      }
      if (next.params && typeof next.params.variable === 'string') {
        next.params = { ...next.params, variable: next.params.variable.trim() };
      }
      return next;
    });

    const normalizedActions = actions.map(a => {
      const next = { ...a };
      if (!next.object && next.action && SYSTEM_ACTIONS.has(next.action)) {
        next.object = 'System';
      }
      if (next.params && typeof next.params.variable === 'string') {
        next.params = { ...next.params, variable: next.params.variable.trim() };
      }
      return next;
    });

    const incompleteCondition = normalizedConditions.some(c => (c.object && !c.trigger) || (!c.object && c.trigger));
    const incompleteAction = normalizedActions.some(a => (a.object && !a.action) || (!a.object && a.action));
    if (incompleteCondition || incompleteAction) {
      setValidationMessage('Completa el objeto y disparador/acción en todas las filas antes de guardar.');
      return;
    }

    const finalEventData = {
      conditions: normalizedConditions.filter(c => c.object && c.trigger) as Condition[],
      actions: normalizedActions.filter(a => a.object && a.action) as Action[],
      dimension: eventDimension,
      programmingMode: 'events' as const
    };

    if (finalEventData.conditions.length === 0 || finalEventData.actions.length === 0) {
      setValidationMessage(t('event.invalidEvent'));
      return;
    }

    ensureGlobalVariablesRegistered(finalEventData.conditions, finalEventData.actions);

    if (editingEventId) {
      onUpdateEvent({ ...finalEventData, id: editingEventId });
    } else {
      onAddEvent({ ...finalEventData, id: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}` });
    }
    handleCancel();
  };

  const updateCondition = (index: number, update: Partial<Condition>) => {
    const newConditions = [...conditions];
    const oldTrigger = newConditions[index].trigger;
    newConditions[index] = { ...newConditions[index], ...update };
    if (update.trigger && update.trigger !== oldTrigger) {
      newConditions[index].params = getDefaultConditionParams(update.trigger);
      if (SYSTEM_TRIGGERS.has(update.trigger) && !newConditions[index].object) {
        newConditions[index].object = 'System';
      }
    }
    setConditions(newConditions);
  };

  const updateAction = (index: number, update: Partial<Action>) => {
    const newActions = [...actions];
    const oldAction = newActions[index].action;
    newActions[index] = { ...newActions[index], ...update };
    if (update.action && update.action !== oldAction) {
      newActions[index].params = getDefaultActionParams(update.action);
      if (SYSTEM_ACTIONS.has(update.action) && !newActions[index].object) {
        newActions[index].object = 'System';
      }
    }
    setActions(newActions);
  };

  const renderCustomParamInputs = (
    itemKey: string | undefined,
    params: Record<string, any> | undefined,
    updateParams: (newParams: Record<string, any>) => void,
    needsParams?: string[]
  ) => {
    if (itemKey === 'CreateObject') {
      const positionType = params?.positionType || 'absolute';
      return (
        <div key="create-obj-params" className="w-full bg-gray-700/50 p-2 rounded-md mt-1 space-y-2">
          <select className="input-field w-full" value={params?.templateObjectName ?? ''} onChange={e => updateParams({ templateObjectName: e.target.value })}>
            <option value="">{t('event.selectTemplate')}</option>
            {templateObjectNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
          </select>
          <div className="flex gap-4 text-sm">
            <label><input type="radio" value="absolute" checked={positionType === 'absolute'} onChange={() => updateParams({ positionType: 'absolute' })} /> {t('event.absolutePosition')}</label>
            <label><input type="radio" value="relativeToObject" checked={positionType === 'relativeToObject'} onChange={() => updateParams({ positionType: 'relativeToObject' })} /> {t('event.relativeToObject')}</label>
          </div>
          {positionType === 'absolute' ? (
            <div className="flex gap-2">
              <input type="number" placeholder="X" className="input-field w-1/2" value={params?.x ?? ''} onChange={e => updateParams({ x: e.target.value })} />
              <input type="number" placeholder="Y" className="input-field w-1/2" value={params?.y ?? ''} onChange={e => updateParams({ y: e.target.value })} />
            </div>
          ) : (
            <div className="space-y-2">
              <select className="input-field w-full" value={params?.relativeToObjectName ?? ''} onChange={e => updateParams({ relativeToObjectName: e.target.value })}>
                <option value="">{t('event.selectRelativeObject')}</option>
                {templateObjectNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
              </select>
              <div className="flex gap-2">
                <input type="number" placeholder="Offset X" className="input-field w-1/2" value={params?.offsetX ?? ''} onChange={e => updateParams({ offsetX: e.target.value })} />
                <input type="number" placeholder="Offset Y" className="input-field w-1/2" value={params?.offsetY ?? ''} onChange={e => updateParams({ offsetY: e.target.value })} />
              </div>
            </div>
          )}
        </div>
      );
    }

    if (!needsParams) return null;

    return needsParams.map(param => {
      switch (param) {
        case 'animationId':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.selectAnimation')}</option>
              {animations.map(anim => <option key={anim.id} value={anim.id}>{anim.name}</option>)}
            </select>
          );
        case 'poseAnimationId':
          return (
            <select key={param} className="input-field min-w-[165px]" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">
                {poseAnimations.length === 0
                  ? '-- Sin animaciones 3D creadas (o usa Clip GLB) --'
                  : (t('event.selectAnimation3D') || 'Seleccionar Animación 3D')}
              </option>
              {poseAnimations.map(pa => (
                <option key={pa.id} value={pa.id}>
                  {pa.name} ({pa.frames?.length || 0} poses)
                </option>
              ))}
            </select>
          );
        case 'modelAnimName':
          return (
            <input
              key={param}
              type="text"
              placeholder="Clip GLB opcional..."
              title="Nombre opcional de animación integrada del modelo 3D (.glb/.gltf)"
              className="input-field w-32"
              value={params?.[param] ?? ''}
              onChange={e => updateParams({ [param]: e.target.value })}
            />
          );
        case 'loop3D':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'default'} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="default">Bucle: Según animación</option>
              <option value="true">{t('event.loop.yes') || 'Bucle: Sí'}</option>
              <option value="false">{t('event.loop.no') || 'Bucle: No'}</option>
            </select>
          );
        case 'modelUrl': {
          const model3DAssets = assets.filter(a => a.type === '3d-model' || String(a.type) === 'model');
          const builtInShapes = [
            { id: 'character', name: 'Personaje 3D (Character)' },
            { id: 'box', name: 'Cubo 3D (Box)' },
            { id: 'sphere', name: 'Esfera 3D (Sphere)' },
            { id: 'cylinder', name: 'Cilindro 3D (Cylinder)' },
            { id: 'cone', name: 'Cono 3D (Cone)' },
            { id: 'capsule', name: 'Cápsula 3D (Capsule)' },
            { id: 'tree', name: 'Árbol 3D (Tree)' },
            { id: 'rock', name: 'Roca 3D (Rock)' },
            { id: 'coin', name: 'Moneda 3D (Coin)' },
            { id: 'ramp', name: 'Rampa 3D (Ramp)' },
          ];
          return (
            <select
              key={param}
              className="input-field max-w-[210px]"
              value={params?.[param] ?? ''}
              onChange={e => updateParams({ [param]: e.target.value })}
            >
              <option value="">-- Seleccionar Modelo / Forma 3D --</option>
              <optgroup label="Formas y Modelos 3D Básicos">
                {builtInShapes.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
              {model3DAssets.length > 0 && (
                <optgroup label="Modelos GLB del Proyecto">
                  {model3DAssets.map(a => (
                    <option key={a.id} value={a.url}>{a.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          );
        }
        case 'soundId':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.selectSound')}</option>
              {audioAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          );
        case 'loop': {
          const defaultValue = itemKey === 'PlaySound' ? 'false' : 'true';
          const currentValue = params?.[param] !== undefined ? String(params?.[param]) : defaultValue;
          return (
            <select key={param} className="input-field" value={currentValue} onChange={e => updateParams({ [param]: e.target.value === 'true' })}>
              <option value="true">{t('event.loop.yes') || 'Bucle: Sí'}</option>
              <option value="false">{t('event.loop.no') || 'Bucle: No'}</option>
            </select>
          );
        }
        case 'videoAssetId':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.selectVideo') || 'Seleccionar Video'}</option>
              {videoAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
            </select>
          );
        case 'variable':
          if (['CompareVariable', 'AddToVariable', 'SetVariable', 'SetBooleanVariable', 'ToggleBooleanVariable', 'CompareBooleanVariable'].includes(itemKey || '')) {
            return (
              <div key={param} className="flex gap-1 items-center flex-wrap">
                {globalVariableNames.length > 0 && (
                  <select
                    className="input-field max-w-[130px]"
                    value={globalVariableNames.includes(params?.[param] ?? '') ? (params?.[param] ?? '') : '__custom__'}
                    onChange={e => {
                      if (e.target.value !== '__custom__') {
                        updateParams({ [param]: e.target.value });
                      }
                    }}
                    title="Variables globales compartidas en todas las escenas"
                  >
                    <option value="__custom__">Elegir var...</option>
                    {globalVariableNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
                  </select>
                )}
                <input
                  list={`vars-${itemKey}`}
                  type="text"
                  placeholder={t('event.globalVariable') || 'Variable Global'}
                  className="input-field min-w-[100px]"
                  value={params?.[param] ?? ''}
                  onChange={e => updateParams({ [param]: e.target.value })}
                />
                <datalist id={`vars-${itemKey}`}>
                  {globalVariableNames.map((name, idx) => <option key={`${name}-${idx}`} value={name} />)}
                </datalist>
              </div>
            );
          }
          return <input key={param} type="text" placeholder={t('event.variableName')} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })} />;
        case 'operator':
          return (
            <select key={param} className="input-field font-semibold" value={params?.[param] ?? '=='} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="==">== (Igual)</option>
              <option value="!=">!= (Distinto)</option>
              <option value=">">&gt; (Mayor que)</option>
              <option value="<">&lt; (Menor que)</option>
              <option value=">=">&gt;= (Mayor o igual)</option>
              <option value="<=">&lt;= (Menor o igual)</option>
            </select>
          );
        case 'duration':
          return <input key={param} type="number" step="any" placeholder="Seg." className="input-field w-20" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value === '' ? '' : Number(e.target.value) })} />;
        case 'value':
          return <input key={param} type="text" placeholder={t('properties.value') || 'Valor'} className="input-field w-20" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })} />;
        case 'valueBoolean':
          return (
            <select key={param} className="input-field" value={String(params?.[param] ?? true)} onChange={e => updateParams({ [param]: e.target.value === 'true' })}>
              <option value="true">Verdadero</option>
              <option value="false">Falso</option>
            </select>
          );
        case 'sceneName':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.selectScene')}</option>
              {sceneNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
            </select>
          );
        case 'key':
          return (
            <input
              key={param}
              type="text"
              placeholder={t('event.keyPressPlaceholder')}
              className="input-field w-36 text-center font-mono cursor-pointer hover:bg-gray-700"
              value={params?.[param] ?? ''}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                let keyName = e.key.toLowerCase();
                if (keyName === ' ') keyName = 'space';
                updateParams({ [param]: keyName });
              }}
              readOnly
            />
          );
        case 'parentName':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.none')}</option>
              {templateObjectNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          );
        case 'visible':
        case 'flip':
        case 'enabled':
        case 'lockX':
        case 'lockY':
          return (
            <select key={param} className="input-field" value={String(params?.[param] ?? 'true')} onChange={e => updateParams({ [param]: e.target.value === 'true' })}>
              <option value="true">{t('common.yes') || 'Sí'}</option>
              <option value="false">{t('common.no') || 'No'}</option>
            </select>
          );
        case 'direction':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'right'} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="right">{t('event.direction.right')}</option>
              <option value="left">{t('event.direction.left')}</option>
              <option value="up">{t('event.direction.up')}</option>
              <option value="down">{t('event.direction.down')}</option>
            </select>
          );
        case 'runMode':
          return (
            <select key={param} className="input-field text-emerald-300 font-semibold" value={params?.[param] ?? 'active'} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="active">Activar Carrera (al moverse)</option>
              <option value="onSprint">Al Mantener Correr (Shift/Mando)</option>
              <option value="autoMove">Correr Automático (su dirección)</option>
              <option value="stop">Detener Carrera (Vel. Normal)</option>
            </select>
          );
        case 'axis':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'x'} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="x">{t('event.axis.x')}</option>
              <option value="y">{t('event.axis.y')}</option>
            </select>
          );
        case 'axis3d':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'y'} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="x">Eje X (Pitch)</option>
              <option value="y">Eje Y (Yaw)</option>
              <option value="z">Eje Z (Roll)</option>
            </select>
          );
        case 'shape3D':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'box'} onChange={e => updateParams({ [param]: e.target.value })}>
              {SHAPE_3D_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          );
        case 'cameraMode':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? 'thirdPerson'} onChange={e => updateParams({ [param]: e.target.value })}>
              {CAMERA_3D_MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          );
        case 'color':
        case 'emissiveColor':
          return (
            <div key={param} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-300">{param === 'emissiveColor' ? 'Emisivo:' : 'Color:'}</span>
              <input type="color" className="w-8 h-7 rounded bg-gray-800 border border-gray-600 cursor-pointer" value={params?.[param] ?? '#38bdf8'} onChange={e => updateParams({ [param]: e.target.value })} />
            </div>
          );
        case 'opacity':
        case 'emissiveIntensity':
        case 'density':
          return (
            <label key={param} className="flex items-center gap-1 text-[10px] text-gray-300">
              <span>{param === 'density' ? 'Dens.' : param === 'emissiveIntensity' ? 'Brillo' : 'Opac.'}</span>
              <input type="number" step="0.01" min="0" className="input-field w-16" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value === '' ? '' : Number(e.target.value) })} />
            </label>
          );
        case 'x3d': case 'y3d': case 'z3d':
        case 'dx': case 'dy': case 'dz':
        case 'rx': case 'ry': case 'rz':
        case 'sx': case 'sy': case 'sz':
        case 'ix': case 'iy': case 'iz':
        case 'cx': case 'cy': case 'cz':
        case 'distance': case 'intensity':
        case 'jumpForce': case 'speed': case 'damage':
        case 'x': case 'y': case 'vx': case 'vy':
        case 'maxPlayers': case 'slot': case 'zIndex': case 'zoomLevel':
        case 'scaleX': case 'scaleY': case 'rotation': {
          const shortLabels: Record<string, string> = {
            x3d: 'X', y3d: 'Y', z3d: 'Z',
            dx: 'dX', dy: 'dY', dz: 'dZ',
            rx: 'RotX°', ry: 'RotY°', rz: 'RotZ°',
            sx: 'EscW', sy: 'EscH', sz: 'EscD',
            ix: 'ImpX', iy: 'ImpY', iz: 'ImpZ',
            cx: 'CamX', cy: 'CamY', cz: 'CamZ',
            distance: 'Dist', intensity: 'Int',
            jumpForce: 'Salto', speed: 'Vel', damage: 'Daño',
          };
          return (
            <label key={param} className="flex items-center gap-1 text-[10px] text-gray-300">
              <span>{shortLabels[param] || param}</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={shortLabels[param] || param}
                className="input-field w-16"
                value={params?.[param] ?? ''}
                onChange={e => {
                  const raw = e.target.value;
                  if (raw === '' || raw === '-') {
                    updateParams({ [param]: raw });
                    return;
                  }
                  const normalized = raw.replace(',', '.');
                  if (/^-?\d*\.?\d*$/.test(normalized)) {
                    const parsed = Number(normalized);
                    updateParams({
                      [param]: (normalized.endsWith('.') || normalized === '-0')
                        ? raw
                        : (Number.isFinite(parsed) ? parsed : raw),
                    });
                  }
                }}
                onBlur={() => {
                  const cur = params?.[param];
                  if (cur === '-' || cur === '.' || cur === '-.') {
                    updateParams({ [param]: 0 });
                  }
                }}
              />
            </label>
          );
        }
        case 'templateObjectName':
        case 'targetObjectName':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{param === 'templateObjectName' ? 'Plantilla...' : t('event.selectObject')}</option>
              {templateObjectNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
            </select>
          );
        case 'fromObjectName':
          return (
            <select key={param} className="input-field text-indigo-300 font-semibold" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">-- Origen --</option>
              <option value="Self">Self</option>
              {templateObjectNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
            </select>
          );
        case 'behaviorName':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">-- Comportamiento --</option>
              {['Solid', 'Solid3D', 'PlatformerCharacter', 'Player3D', 'Physics', 'Physics3D', 'TopDownRPGMovement', 'Patrol', 'Patrol3D', 'Oscillate', 'Oscillate3D', 'Rotate', 'Rotate3D', 'FollowCamera', 'FollowCamera3D', 'Boss', 'Boss3D', 'Health'].map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          );
        case 'imageUrl': {
          const imageAssets = assets.filter(a => a.type === 'image');
          return (
            <select key={param} className="input-field min-w-[130px]" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">-- Imagen --</option>
              {imageAssets.map(asset => <option key={asset.id} value={asset.url}>{asset.name}</option>)}
            </select>
          );
        }
        case 'dialogueText':
          return <textarea key={param} placeholder={t('event.dialoguePlaceholder')} className="input-field w-full" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })} />;
        case 'stat':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="">{t('event.stat')}</option>
              <option value="hp">HP</option>
              <option value="maxHp">HP Máx</option>
              <option value="attack">Ataque</option>
            </select>
          );
        case 'operation':
          return (
            <select key={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })}>
              <option value="add">{t('event.operation.add')}</option>
              <option value="subtract">{t('event.operation.subtract')}</option>
              <option value="set">{t('event.operation.set')}</option>
            </select>
          );
        case 'volume':
          return <input key={param} type="number" placeholder="Vol (0-100)" className="input-field w-20" min="0" max="100" value={params?.[param] ?? '100'} onChange={e => updateParams({ [param]: e.target.value })} />;
        default:
          return <input key={param} type="text" placeholder={param} className="input-field" value={params?.[param] ?? ''} onChange={e => updateParams({ [param]: e.target.value })} />;
      }
    });
  };

  const renderParamInput = (
    type: 'condition' | 'action',
    item: Partial<Condition> | Partial<Action>,
    index: number
  ) => {
    const options = type === 'condition' ? triggerOptions : actionOptions;
    const key = type === 'condition' ? (item as Partial<Condition>).trigger : (item as Partial<Action>).action;
    const selectedOption = options.find(opt => opt.value === key);
    const updater = type === 'condition' ? updateCondition : updateAction;
    const updateParams = (newParams: Record<string, any>) => updater(index, { params: { ...item.params, ...newParams } });

    return renderCustomParamInputs(key, item.params, updateParams, selectedOption?.needsParams);
  };

  // --- 3D Blocks Studio helpers ---
  const handleAddBlockFromPalette = (block: BlockPaletteDef) => {
    setValidationMessage(null);
    if (block.kind === 'trigger' && block.trigger) {
      const isSysTrigger = ['OnStart', 'Always', 'OnKeyPress', 'CompareVariable', 'CompareBooleanVariable'].includes(block.trigger);
      const nextParams = { ...(block.defaultParams || {}) };
      if ((block.trigger === 'CompareVariable' || block.trigger === 'CompareBooleanVariable') && !nextParams.variable) {
        nextParams.variable = globalVariableNames[0] || 'score';
      }
      setBlockStackCondition({
        object: isSysTrigger ? 'System' : defaultActorName,
        trigger: block.trigger,
        target: block.trigger === 'OnCollisionWith' || block.trigger === 'Distance3DLessThan' ? (objectNames[1] || objectNames[0] || '') : undefined,
        params: nextParams
      });
    } else if (block.kind === 'action' && block.action) {
      const targetActor =
        ['AddToVariable', 'SetVariable', 'GoToScene', 'SetFog3D', 'SetSkybox3D', 'SetCamera3DMode', 'SetCamera3DOffset'].includes(block.action)
          ? 'System'
          : defaultActorName;
      setBlockStackActions(prev => [
        ...prev,
        {
          object: targetActor,
          action: block.action,
          params: block.action === 'PlayAnimation3D'
            ? { ...(block.defaultParams || {}), poseAnimationId: block.defaultParams?.poseAnimationId || poseAnimations[0]?.id || '' }
            : { ...(block.defaultParams || {}) }
        }
      ]);
    }
  };

  const apply3DTemplate = (templateId: string) => {
    setValidationMessage(null);
    const playerName = objectNames.find(n => n.toLowerCase().includes('jugador') || n.toLowerCase().includes('player')) || objectNames[0] || 'Jugador 3D';
    const coinName = objectNames.find(n => n.toLowerCase().includes('moneda') || n.toLowerCase().includes('coin')) || objectNames[1] || 'Moneda 3D';
    const enemyName = objectNames.find(n => n.toLowerCase().includes('enemigo') || n.toLowerCase().includes('enemy')) || objectNames[1] || 'Enemigo 3D';

    if (templateId === 'collectCoin') {
      setBlockStackCondition({ object: playerName, trigger: 'OnCollisionWith', target: coinName, params: {} });
      setBlockStackActions([
        { object: 'System', action: 'AddToVariable', params: { variable: 'score', value: 10 } },
        { object: coinName, action: 'Destroy', params: {} }
      ]);
    } else if (templateId === 'thirdPersonCam') {
      setBlockStackCondition({ object: 'System', trigger: 'OnStart', params: {} });
      setBlockStackActions([
        { object: 'System', action: 'SetCamera3DMode', params: { cameraMode: 'thirdPerson', targetObjectName: playerName } },
        { object: 'System', action: 'SetCamera3DOffset', params: { cx: 0, cy: 5, cz: 9 } }
      ]);
    } else if (templateId === 'spinCoin') {
      setBlockStackCondition({ object: 'System', trigger: 'OnStart', params: {} });
      setBlockStackActions([
        { object: coinName, action: 'RotateContinuously3D', params: { axis3d: 'y', speed: 120 } }
      ]);
    } else if (templateId === 'shootSpace') {
      setBlockStackCondition({ object: 'System', trigger: 'OnKeyPress', params: { key: 'space' } });
      setBlockStackActions([
        { object: playerName, action: 'Shoot3D', params: { damage: 20, speed: 15, color: '#facc15' } }
      ]);
    } else if (templateId === 'chasePlayer') {
      setBlockStackCondition({ object: 'System', trigger: 'Always', params: {} });
      setBlockStackActions([
        { object: enemyName, action: 'MoveTowards3D', params: { targetObjectName: playerName, speed: 3 } },
        { object: enemyName, action: 'LookAtObject3D', params: { targetObjectName: playerName } }
      ]);
    } else if (templateId === 'varThreshold') {
      const nextSceneName = sceneNames.find(n => n !== scene?.name) || sceneNames[0] || '';
      setBlockStackCondition({ object: 'System', trigger: 'CompareVariable', params: { variable: globalVariableNames[0] || 'score', operator: '>=', value: '30' } });
      setBlockStackActions([
        { object: 'System', action: 'GoToScene', params: { sceneName: nextSceneName } }
      ]);
    }
  };

  const handleSaveBlockStack = () => {
    if (!blockStackCondition.object || !blockStackCondition.trigger || blockStackActions.length === 0) {
      setValidationMessage('El bloque 3D necesita un disparador arriba y al menos 1 bloque de acción.');
      return;
    }
    const validActions = blockStackActions.filter(a => a.object && a.action) as Action[];
    if (validActions.length === 0) {
      setValidationMessage('Completa los parámetros de al menos 1 bloque de acción.');
      return;
    }
    ensureGlobalVariablesRegistered([blockStackCondition], validActions);
    const eventPayload: GameEvent = {
      id: editingBlockEventId || `evt3d_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      conditions: [blockStackCondition as Condition],
      actions: validActions,
      dimension: '3D',
      programmingMode: 'blocks'
    };
    if (editingBlockEventId) {
      onUpdateEvent(eventPayload);
    } else {
      onAddEvent(eventPayload);
    }
    setEditingBlockEventId(null);
    setBlockStackCondition({ object: 'System', trigger: 'OnStart', params: {} });
    setBlockStackActions([]);
    setValidationMessage(null);
  };

  const blockTriggerDef = triggerOptions.find(o => o.value === blockStackCondition.trigger);

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-2 sm:p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col border border-gray-800 relative" onClick={e => e.stopPropagation()}>
        {selectorOpen && (
          <SelectorModal
            title={selectorOpen.type === 'condition' ? 'Seleccionar Disparador' : 'Seleccionar Acción'}
            categorizedItems={selectorOpen.type === 'condition' ? categorizedTriggerOptions : categorizedActionOptions}
            onClose={() => setSelectorOpen(null)}
            onSelect={(value) => {
              if (selectorOpen.type === 'condition') {
                updateCondition(selectorOpen.index, { trigger: value as Condition['trigger'] });
              } else {
                updateAction(selectorOpen.index, { action: value as Action['action'] });
              }
              setSelectorOpen(null);
            }}
          />
        )}
        <style>{`
          .input-field { background-color: #1f2937; border: 1px solid #374151; border-radius: 0.375rem; padding: 0.25rem 0.5rem; font-size: 0.78rem; color: #f3f4f6; }
        `}</style>

        <header className="flex flex-wrap items-center justify-between gap-2 p-3 sm:p-4 border-b border-gray-800 shrink-0 bg-[#151518] rounded-t-lg">
          <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
            <h2 className="text-base sm:text-xl font-bold text-white">{t('event.editorTitle')}</h2>
            <div className="flex items-center bg-gray-800 p-0.5 rounded-lg border border-gray-700">
              <button
                onClick={() => { setStudioMode('2d_events'); setValidationMessage(null); }}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${studioMode === '2d_events' ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white'}`}
              >
                Editor de Eventos ({allEvents.length})
              </button>
              <button
                onClick={() => { setStudioMode('3d_blocks'); setValidationMessage(null); }}
                className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${studioMode === '3d_blocks' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:text-white'}`}
              >
                Bloques 3D ({allEvents.filter(e => e.programmingMode === 'blocks' || e.dimension === '3D').length})
              </button>
            </div>
            <span className="text-[11px] text-emerald-300/90 bg-emerald-950/50 border border-emerald-700/40 px-2 py-0.5 rounded">
              Compatible 2D ↔ 3D
            </span>
            {copiedEvent && (
              <button
                type="button"
                data-testid="paste-event-header-btn"
                onClick={handlePasteEvent}
                className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400/50 transition-colors"
              >
                Pegar Evento
              </button>
            )}
            <button
              onClick={() => setShowGlobalVarsPanel(prev => !prev)}
              className={`px-2.5 py-1 rounded text-xs font-bold border transition-colors ${showGlobalVarsPanel ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-gray-800 border-gray-700 text-indigo-300 hover:bg-gray-700'}`}
            >
              🌐 Variables Globales ({globalVariableNames.length})
            </button>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none px-2">&times;</button>
        </header>

        {showGlobalVarsPanel && (
          <div className="mx-4 mt-3 p-3 rounded-lg bg-indigo-950/30 border border-indigo-500/40 space-y-2 shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-indigo-200">
                Variables Globales Compartidas (existen y mantienen su valor en todas las escenas 2D y 3D)
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  placeholder="Nombre (ej: monedas)"
                  value={newVarName}
                  onChange={e => setNewVarName(e.target.value)}
                  className="input-field w-36"
                />
                <input
                  type="text"
                  placeholder="Valor inicial"
                  value={newVarValue}
                  onChange={e => setNewVarValue(e.target.value)}
                  className="input-field w-24"
                />
                <button
                  onClick={handleAddInlineGlobalVar}
                  className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white"
                >
                  + Añadir Global
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {globalVariables.map((v, idx) => (
                <div key={`${v.name}-${idx}`} className="flex items-center gap-1 bg-gray-900/90 border border-indigo-500/30 rounded px-2 py-1 text-xs">
                  <span className="font-mono font-bold text-indigo-300">{v.name}</span>
                  <span className="text-gray-500">=</span>
                  <input
                    type="text"
                    value={String(v.value)}
                    onChange={e => {
                      if (!onUpdateGlobalVariables) return;
                      const raw = e.target.value;
                      const val = raw === 'true' ? true : raw === 'false' ? false : (raw !== '' && !isNaN(Number(raw))) ? Number(raw) : raw;
                      onUpdateGlobalVariables(globalVariables.map((item, i) => i === idx ? { ...item, value: val } : item));
                    }}
                    className="bg-black/50 border border-gray-700 rounded px-1.5 py-0.5 w-16 text-xs text-white font-mono"
                  />
                  {onUpdateGlobalVariables && (
                    <button
                      onClick={() => onUpdateGlobalVariables(globalVariables.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-300 font-bold ml-1"
                      title="Eliminar variable global"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
              {globalVariables.length === 0 && (
                <span className="text-xs text-gray-400 italic">No hay variables globales definidas todavía.</span>
              )}
            </div>
          </div>
        )}

        {validationMessage && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-900/60 border border-red-500/60 text-red-100 text-xs flex items-center justify-between">
            <span>{validationMessage}</span>
            <button onClick={() => setValidationMessage(null)} className="text-red-200 hover:text-white font-bold ml-3">&times;</button>
          </div>
        )}

        {statusNotice && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-emerald-900/60 border border-emerald-500/60 text-emerald-100 text-xs flex items-center justify-between">
            <span>{statusNotice}</span>
            <button onClick={() => setStatusNotice(null)} className="text-emerald-200 hover:text-white font-bold ml-3">&times;</button>
          </div>
        )}

        {studioMode === '2d_events' ? (
          <>
            <main className="flex-grow p-4 overflow-y-auto space-y-4">
              {!isFormOpen && allEvents.map((event, index) => (
                <div key={event.id || index} className="bg-black/50 p-3 rounded-lg border border-gray-800 relative group">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${event.dimension === '3D' || event.programmingMode === 'blocks' ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40' : 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'}`}>
                      {event.programmingMode === 'blocks' ? 'Visual / Bloque 3D' : (event.dimension === '3D' ? 'Evento 3D' : 'Evento 2D')}
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        data-testid={`copy-event-${index}`}
                        onClick={() => handleCopyEvent(event)}
                        title="Copiar evento para pegarlo aquí u en otra escena"
                        className="px-2 py-1 bg-gray-800 hover:bg-emerald-600 rounded text-[11px] font-semibold text-gray-200 transition-colors"
                      >
                        Copiar
                      </button>
                      <button
                        type="button"
                        data-testid={`duplicate-event-${index}`}
                        onClick={() => handleDuplicateEvent(event)}
                        title="Duplicar evento al instante"
                        className="px-2 py-1 bg-gray-800 hover:bg-cyan-600 rounded text-[11px] font-semibold text-gray-200 transition-colors"
                      >
                        Duplicar
                      </button>
                      <button
                        type="button"
                        data-testid={`edit-event-${index}`}
                        onClick={() => handleEditEvent(event)}
                        title={t('event.editEvent')}
                        className="p-1.5 bg-gray-700/80 rounded-full text-gray-300 hover:bg-indigo-600"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteEvent(event.id)}
                        title={t('event.deleteEvent')}
                        className="p-1.5 bg-red-900/50 rounded-full text-red-300 hover:bg-red-700"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="sm:w-1/2 space-y-1.5">
                      <h4 className="text-xs uppercase font-bold text-red-400 tracking-wider">{t('event.conditions')}</h4>
                      {event.conditions.map((cond, cIndex) => (
                        <div key={cIndex} className="text-sm bg-red-900/40 border border-red-800/40 p-2 rounded-md text-gray-100">
                          {`${cond.object} — ${t(triggerOptions.find(o => o.value === cond.trigger)?.label || cond.trigger)} ${cond.target || ''}`}
                        </div>
                      ))}
                    </div>
                    <div className="sm:w-1/2 space-y-1.5">
                      <h4 className="text-xs uppercase font-bold text-blue-400 tracking-wider">{t('event.actions')}</h4>
                      {event.actions.map((act, aIndex) => {
                        const poseAnimLabel = act.action === 'PlayAnimation3D' && act.params?.poseAnimationId
                          ? poseAnimations.find(pa => pa.id === act.params?.poseAnimationId || pa.name === act.params?.poseAnimationId)?.name
                          : undefined;
                        const extraLabel = poseAnimLabel || (act.action === 'PlayAnimation3D' ? act.params?.modelAnimName : '');
                        return (
                          <div key={aIndex} className="text-sm bg-blue-900/40 border border-blue-800/40 p-2 rounded-md text-gray-100">
                            {`${act.object} — ${t(actionOptions.find(o => o.value === act.action)?.label || act.action)}${extraLabel ? ` (${extraLabel})` : ''}`}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}

              {!isFormOpen && allEvents.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-xs italic bg-gray-800/30 border border-dashed border-gray-800 rounded-lg">
                  No hay eventos creados para esta escena. ¡Haz clic en "+ Añadir Nuevo Evento" o usa la pestaña "Bloques 3D"!
                </div>
              )}

              {isFormOpen && (
                <div className="bg-black/50 p-4 rounded-lg border border-indigo-500">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-800">
                    <h3 className="font-bold text-lg text-indigo-300">{editingEventId ? t('event.editEvent') : t('event.createEvent')}</h3>
                    <div className="flex gap-1 bg-gray-800 p-0.5 rounded">
                      <button onClick={() => setEventDimension('2D')} className={`px-2 py-0.5 text-xs rounded font-bold ${eventDimension === '2D' ? 'bg-indigo-600 text-white' : 'text-gray-400'}`}>2D</button>
                      <button onClick={() => setEventDimension('3D')} className={`px-2 py-0.5 text-xs rounded font-bold ${eventDimension === '3D' ? 'bg-emerald-600 text-white' : 'text-gray-400'}`}>3D</button>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="md:w-1/2 space-y-3">
                      <h4 className="font-semibold text-red-400">{t('event.conditionsWhen')}</h4>
                      {conditions.map((cond, i) => (
                        <div key={i} className="flex gap-1 items-start flex-wrap p-2 bg-gray-800/50 rounded-md">
                          <select className="input-field" value={cond.object ?? ''} onChange={e => updateCondition(i, { object: e.target.value })}>
                            <option value="">{t('event.selectObject')}</option>
                            {['System', ...templateObjectNames].map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name === 'System' ? t('properties.system') : name}</option>)}
                          </select>
                          <button onClick={() => setSelectorOpen({ type: 'condition', index: i })} className="input-field text-left flex-grow min-w-[120px] hover:bg-gray-600">
                            {t(triggerOptions.find(opt => opt.value === cond.trigger)?.label || 'event.selectTrigger')}
                          </button>
                          <button onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))} className="p-2 bg-red-900/50 rounded-md text-red-300 hover:bg-red-700">
                            <TrashIcon />
                          </button>
                          {triggerOptions.find(o => o.value === cond.trigger)?.needsTarget && (
                            <select className="input-field" value={cond.target ?? ''} onChange={e => updateCondition(i, { target: e.target.value })}>
                              <option value="">{t('event.selectTarget')}</option>
                              {templateObjectNames.map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name}</option>)}
                            </select>
                          )}
                          {renderParamInput('condition', cond, i)}
                        </div>
                      ))}
                      <button onClick={() => setConditions([...conditions, {}])} className="w-full py-2 bg-gray-800 rounded-md hover:bg-gray-700 text-sm font-medium text-gray-300">+ Añadir condición</button>
                    </div>
                    <div className="md:w-1/2 space-y-3">
                      <h4 className="font-semibold text-blue-400">{t('event.actionsDo')}</h4>
                      {actions.map((act, i) => (
                        <div key={i} className="flex gap-1 items-start flex-wrap p-2 bg-gray-800/50 rounded-md">
                          <select className="input-field" value={act.object ?? ''} onChange={e => updateAction(i, { object: e.target.value })}>
                            <option value="">{t('event.selectObject')}</option>
                            {['System', ...templateObjectNames].map((name, idx) => <option key={`${name}-${idx}`} value={name}>{name === 'System' ? t('properties.system') : name}</option>)}
                          </select>
                          <button onClick={() => setSelectorOpen({ type: 'action', index: i })} className="input-field text-left flex-grow min-w-[120px] hover:bg-gray-600">
                            {t(actionOptions.find(opt => opt.value === act.action)?.label || 'event.selectAction')}
                          </button>
                          <button onClick={() => setActions(actions.filter((_, idx) => idx !== i))} className="p-2 bg-red-900/50 rounded-md text-red-300 hover:bg-red-700">
                            <TrashIcon />
                          </button>
                          {renderParamInput('action', act, i)}
                        </div>
                      ))}
                      <button onClick={() => setActions([...actions, {}])} className="w-full py-2 bg-gray-800 rounded-md hover:bg-gray-700 text-sm font-medium text-gray-300">+ Añadir acción</button>
                    </div>
                  </div>
                </div>
              )}
            </main>

            <footer className="p-4 border-t border-gray-800 shrink-0">
              {isFormOpen ? (
                <div className="flex justify-end gap-2">
                  <button onClick={handleCancel} className="px-4 py-2 bg-gray-700 rounded-md hover:bg-gray-800 text-white">{t('common.cancel')}</button>
                  <button onClick={handleSaveEvent} className="px-4 py-2 bg-indigo-600 rounded-md hover:bg-indigo-700 text-white font-semibold">{t('event.saveEvent')}</button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={handleAddNewEventClick} className="px-4 py-2 bg-indigo-600 rounded-md hover:bg-indigo-700 text-white font-semibold">
                    {t('event.addNewEvent')}
                  </button>
                  {copiedEvent && (
                    <button
                      type="button"
                      data-testid="paste-event-footer-btn"
                      onClick={handlePasteEvent}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-md text-white font-semibold"
                    >
                      Pegar Evento Copiado
                    </button>
                  )}
                </div>
              )}
            </footer>
          </>
        ) : (
          <main className="flex-grow min-h-0 flex flex-col lg:flex-row overflow-hidden">
            {/* Left Palette of Visual 3D Blocks */}
            <aside className="lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-gray-800 bg-[#141417] overflow-y-auto p-3 space-y-3 max-h-[38vh] lg:max-h-full">
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Plantillas 3D en 1 Clic</div>
                <div className="grid grid-cols-1 gap-1">
                  <button onClick={() => apply3DTemplate('thirdPersonCam')} className="text-left text-xs px-2.5 py-1.5 rounded bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/50 text-emerald-200 font-semibold">
                    🎥 Cámara 3ª Persona al Iniciar
                  </button>
                  <button onClick={() => apply3DTemplate('collectCoin')} className="text-left text-xs px-2.5 py-1.5 rounded bg-amber-950/60 hover:bg-amber-900/70 border border-amber-700/50 text-amber-200 font-semibold">
                    🪙 Recoger Moneda 3D (+10 pts)
                  </button>
                  <button onClick={() => apply3DTemplate('spinCoin')} className="text-left text-xs px-2.5 py-1.5 rounded bg-violet-950/60 hover:bg-violet-900/70 border border-violet-700/50 text-violet-200 font-semibold">
                    🌀 Moneda Giratoria 3D
                  </button>
                  <button onClick={() => apply3DTemplate('shootSpace')} className="text-left text-xs px-2.5 py-1.5 rounded bg-rose-950/60 hover:bg-rose-900/70 border border-rose-700/50 text-rose-200 font-semibold">
                    🔫 Disparo 3D con Espacio
                  </button>
                  <button onClick={() => apply3DTemplate('chasePlayer')} className="text-left text-xs px-2.5 py-1.5 rounded bg-blue-950/60 hover:bg-blue-900/70 border border-blue-700/50 text-blue-200 font-semibold">
                    👾 Enemigo Persigue Jugador 3D
                  </button>
                  <button onClick={() => apply3DTemplate('varThreshold')} className="text-left text-xs px-2.5 py-1.5 rounded bg-indigo-950/60 hover:bg-indigo-900/70 border border-indigo-700/50 text-indigo-200 font-semibold">
                    🏆 Si Variable &gt;= 30 → Cambiar Escena
                  </button>
                </div>
              </div>

              {BLOCK_3D_PALETTE_CATEGORIES.map(cat => (
                <div key={cat.id} className={`rounded-lg border p-2 space-y-1.5 ${cat.accent}`}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-300">{cat.title}</div>
                  <div className="space-y-1">
                    {cat.blocks.map(block => (
                      <button
                        key={block.id}
                        onClick={() => handleAddBlockFromPalette(block)}
                        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border text-left text-xs font-semibold text-white shadow-sm hover:brightness-110 active:scale-[0.98] transition-all ${block.color}`}
                      >
                        <span className="truncate">{block.label}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/30 shrink-0">{block.badge}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </aside>

            {/* Right Visual Block Stack Builder + Saved Stacks */}
            <section className="flex-1 overflow-y-auto p-4 space-y-5 bg-[#101013]">
              <div className="bg-[#18181d] border border-emerald-500/40 rounded-xl p-4 space-y-3 shadow-lg">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-emerald-300">
                      {editingBlockEventId ? 'Editando Pila de Bloques 3D' : 'Constructor de Bloques 3D'}
                    </h3>
                    <p className="text-[11px] text-gray-400">
                      Toca los bloques de la izquierda para apilar acciones 3D. Todo se ejecuta junto a tus eventos 2D.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {editingBlockEventId && (
                      <button
                        onClick={() => {
                          setEditingBlockEventId(null);
                          setBlockStackCondition({ object: 'System', trigger: 'OnStart', params: {} });
                          setBlockStackActions([]);
                        }}
                        className="px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 text-xs font-semibold text-white"
                      >
                        Cancelar edición
                      </button>
                    )}
                    <button
                      onClick={handleSaveBlockStack}
                      className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow"
                    >
                      {editingBlockEventId ? 'Actualizar Pila 3D' : 'Guardar Pila 3D'}
                    </button>
                  </div>
                </div>

                {/* Trigger Hat Block */}
                <div className="bg-amber-600/90 border-2 border-amber-400 rounded-t-2xl rounded-b-md p-3 text-white shadow-md">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-extrabold uppercase bg-black/30 px-2 py-0.5 rounded">CUANDO</span>
                    <select
                      className="input-field bg-amber-950/80 border-amber-300/40 text-white"
                      value={blockStackCondition.object ?? 'System'}
                      onChange={e => setBlockStackCondition(prev => ({ ...prev, object: e.target.value }))}
                    >
                      {['System', ...templateObjectNames].map((name, idx) => (
                        <option key={`${name}-${idx}`} value={name}>{name === 'System' ? 'Sistema' : name}</option>
                      ))}
                    </select>
                    <select
                      className="input-field bg-amber-950/80 border-amber-300/40 text-white font-semibold"
                      value={blockStackCondition.trigger ?? 'OnStart'}
                      onChange={e => {
                        const nextTrig = e.target.value as Condition['trigger'];
                        setBlockStackCondition(prev => ({
                          ...prev,
                          trigger: nextTrig,
                          params: getDefaultConditionParams(nextTrig)
                        }));
                      }}
                    >
                      {triggerOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                      ))}
                    </select>
                    {blockTriggerDef?.needsTarget && (
                      <select
                        className="input-field bg-amber-950/80 border-amber-300/40 text-white"
                        value={blockStackCondition.target ?? ''}
                        onChange={e => setBlockStackCondition(prev => ({ ...prev, target: e.target.value }))}
                      >
                        <option value="">Objetivo...</option>
                        {templateObjectNames.map((name, idx) => (
                          <option key={`${name}-${idx}`} value={name}>{name}</option>
                        ))}
                      </select>
                    )}
                    {renderCustomParamInputs(
                      blockStackCondition.trigger,
                      blockStackCondition.params,
                      (newParams) => setBlockStackCondition(prev => ({ ...prev, params: { ...(prev.params || {}), ...newParams } })),
                      blockTriggerDef?.needsParams
                    )}
                  </div>
                </div>

                {/* Stacked Action Blocks */}
                <div className="pl-4 border-l-4 border-amber-500/60 space-y-1.5">
                  {blockStackActions.length === 0 ? (
                    <div className="p-4 border-2 border-dashed border-gray-700 rounded-lg text-center text-xs text-gray-500">
                      Sin bloques de acción todavía. Pulsa cualquier bloque azul, morado, verde o rojo en la paleta para encajarlo aquí.
                    </div>
                  ) : (
                    blockStackActions.map((act, idx) => {
                      const actDef = actionOptions.find(o => o.value === act.action);
                      const colorClass =
                        ['SetCamera3DMode', 'SetCamera3DOffset', 'SetCamera3DMovement', 'SetLight3D', 'SetFog3D', 'SetSkybox3D'].includes(act.action || '')
                          ? 'bg-emerald-700/90 border-emerald-400'
                          : ['Rotate3D', 'RotateContinuously3D', 'Scale3D', 'SetShape3D', 'SetColor3D', 'SetModel3D', 'PlayAnimation3D', 'StopAnimation3D'].includes(act.action || '')
                          ? 'bg-violet-700/90 border-violet-400'
                          : ['CreateObject3D', 'Shoot3D', 'AddToVariable', 'Destroy', 'GoToScene'].includes(act.action || '')
                          ? 'bg-rose-700/90 border-rose-400'
                          : 'bg-blue-700/90 border-blue-400';

                      return (
                        <div key={idx} className={`rounded-md border p-2.5 text-white shadow ${colorClass}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-mono bg-black/30 px-1.5 py-0.5 rounded">#{idx + 1}</span>
                            <select
                              className="input-field bg-black/40 border-white/20 text-white"
                              value={act.object ?? 'System'}
                              onChange={e => setBlockStackActions(prev => prev.map((it, i) => i === idx ? { ...it, object: e.target.value } : it))}
                            >
                              {['System', ...templateObjectNames].map((name, oIdx) => (
                                <option key={`${name}-${oIdx}`} value={name}>{name === 'System' ? 'Sistema' : name}</option>
                              ))}
                            </select>
                            <select
                              className="input-field bg-black/40 border-white/20 text-white font-semibold"
                              value={act.action ?? ''}
                              onChange={e => setBlockStackActions(prev => prev.map((it, i) => i === idx ? { ...it, action: e.target.value as Action['action'], params: {} } : it))}
                            >
                              {actionOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
                              ))}
                            </select>
                            {renderCustomParamInputs(
                              act.action,
                              act.params,
                              (newParams) => setBlockStackActions(prev => prev.map((it, i) => i === idx ? { ...it, params: { ...(it.params || {}), ...newParams } } : it)),
                              actDef?.needsParams
                            )}
                            <div className="ml-auto flex items-center gap-1">
                              {idx > 0 && (
                                <button
                                  onClick={() => {
                                    setBlockStackActions(prev => {
                                      const copy = [...prev];
                                      [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                                      return copy;
                                    });
                                  }}
                                  className="px-1.5 py-0.5 bg-black/30 hover:bg-black/50 rounded text-xs"
                                  title="Subir bloque"
                                >
                                  ↑
                                </button>
                              )}
                              {idx < blockStackActions.length - 1 && (
                                <button
                                  onClick={() => {
                                    setBlockStackActions(prev => {
                                      const copy = [...prev];
                                      [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
                                      return copy;
                                    });
                                  }}
                                  className="px-1.5 py-0.5 bg-black/30 hover:bg-black/50 rounded text-xs"
                                  title="Bajar bloque"
                                >
                                  ↓
                                </button>
                              )}
                              <button
                                onClick={() => setBlockStackActions(prev => prev.filter((_, i) => i !== idx))}
                                className="px-2 py-0.5 bg-red-950/60 hover:bg-red-800 rounded text-xs font-bold"
                                title="Quitar bloque"
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Existing scene events & 3D block stacks */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  Eventos y Bloques Activos en la Escena ({allEvents.length})
                </h4>
                {allEvents.length === 0 ? (
                  <div className="text-xs text-gray-500 italic p-4 border border-dashed border-gray-800 rounded-lg text-center">
                    Aún no hay bloques guardados en esta escena.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {allEvents.map((evt, index) => {
                      const is3DBlock = evt.programmingMode === 'blocks' || evt.dimension === '3D';
                      return (
                        <div key={evt.id || index} className={`rounded-lg border p-3 space-y-2 ${is3DBlock ? 'bg-emerald-950/20 border-emerald-700/40' : 'bg-gray-900/80 border-gray-800'}`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${is3DBlock ? 'bg-emerald-600/30 text-emerald-300' : 'bg-indigo-600/30 text-indigo-300'}`}>
                              {is3DBlock ? '🧱 Bloque 3D' : '⚡ Evento 2D (Compatible 3D)'}
                            </span>
                            <div className="flex gap-1">
                              <button type="button" onClick={() => handleCopyEvent(evt)} className="px-2 py-0.5 rounded bg-gray-800 hover:bg-emerald-600 text-[11px] text-gray-200">
                                Copiar
                              </button>
                              <button type="button" onClick={() => handleDuplicateEvent(evt)} className="px-2 py-0.5 rounded bg-gray-800 hover:bg-cyan-600 text-[11px] text-gray-200">
                                Duplicar
                              </button>
                              <button type="button" onClick={() => handleEditEvent(evt)} className="px-2 py-0.5 rounded bg-gray-800 hover:bg-indigo-600 text-[11px] text-gray-200">
                                Editar en Eventos
                              </button>
                              <button type="button" onClick={() => onDeleteEvent(evt.id)} className="px-2 py-0.5 rounded bg-red-900/50 hover:bg-red-700 text-[11px] text-red-200">
                                Borrar
                              </button>
                            </div>
                          </div>
                          {evt.conditions.map((c, ci) => (
                            <div key={ci} className="text-xs bg-amber-600/30 border border-amber-500/40 text-amber-100 px-2.5 py-1.5 rounded font-semibold">
                              CUANDO: {c.object} → {t(triggerOptions.find(o => o.value === c.trigger)?.label || c.trigger)} {c.target ? `[${c.target}]` : ''}
                            </div>
                          ))}
                          <div className="pl-2 border-l-2 border-blue-500/40 space-y-1">
                            {evt.actions.map((a, ai) => (
                              <div key={ai} className="text-xs bg-blue-600/25 border border-blue-500/30 text-blue-100 px-2.5 py-1 rounded">
                                {a.object} → {t(actionOptions.find(o => o.value === a.action)?.label || a.action)}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </main>
        )}
      </div>
    </div>
  );
};

export default EventEditor;