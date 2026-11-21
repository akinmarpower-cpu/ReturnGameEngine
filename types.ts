

export interface CollisionProperties {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fixedColRotate?: boolean;
}

export interface Behavior {
  name: string; // e.g., 'PlatformerCharacter'
  properties: Record<string, any>; // e.g., { speed: 100, jumpForce: 300 }
}

export interface Variable {
    name: string;
    value: string | number | boolean;
}

export type ObjectTrigger = 'OnStart' | 'OnUpdate' | 'OnClick' | 'OnObjectReleased' | 'OnCollisionWith' | 'CompareVariable' | 'CompareObjectVariable' | 'Always';

export interface ObjectScript {
  id: string;
  trigger: ObjectTrigger;
  actions: Action[];
  // For 'OnCollisionWith' or 'CompareObjectVariable'
  params?: {
    targetObjectName?: string;
    variable?: string;
    operator?: string;
    value?: string | number;
  };
}

export type Shape3D =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'capsule'
  | 'plane'
  | 'torus'
  | 'ramp'
  | 'character'
  | 'coin'
  | 'light'
  | 'tree'
  | 'rock';

export interface GameObject {
  id: number;
  name: string;
  // 3D properties
  modelUrl?: string; // URL for GLB model
  shape3D?: Shape3D;
  animation3D?: string; // Name of embedded GLTF animation or PoseAnimation to play
  animation3DLoop?: boolean;
  animation3DSpeed?: number;
  poseAnimationId?: string; // Active PoseAnimation ID for 3D keyframe sequence
  roughness3D?: number;
  metalness3D?: number;
  emissive3D?: string;
  emissiveIntensity3D?: number;
  castShadow3D?: boolean;
  receiveShadow3D?: boolean;
  isSolid3D?: boolean;
  lightIntensity3D?: number;
  lightDistance3D?: number;
  rotation3D?: { x: number; y: number; z: number };
  position3D?: { x: number; y: number; z: number };
  scale3D?: { x: number; y: number; z: number };
  rotationSpeed3D?: { x: number; y: number; z: number };
  x: number;
  y: number;
  width: number;
  height: number;
  color: string; // Now a hex color string, e.g., "#FF5733"
  zIndex: number;
  imageUrl?: string; // Optional image URL for the object's appearance
  assetId?: string; // Optional asset ID referencing GameAsset
  videoUrl?: string;
  videoLoop?: boolean;
  videoAutoplay?: boolean;
  videoMuted?: boolean;
  rpgAttackEndTime?: number;
  attackEndTime?: number;
  rpgKnockbackVx?: number;
  rpgKnockbackVy?: number;
  _originalBehaviors?: Behavior[];
  behaviors?: Behavior[];
  isUI?: boolean; // Is this a fixed-position UI element?
  isHealthBar?: boolean; // Is this a Health Bar UI element?
  healthBarTarget?: string; // Target object name for the health bar
  text?: string; // Text content if it's a UI text object
  characterImageMapping?: string; // Optional character mapping (e.g. "1=url,2=url" or "A=url")
  variables?: Variable[]; // For object-specific variables
  scripts?: ObjectScript[]; // For object-specific visual scripts
  controlAction?: 'moveLeft' | 'moveRight' | 'jump' | 'attack' | 'none' | 'moveUp' | 'moveDown' | 'run';
  parentId?: number | null; // For object hierarchy
  _globalChildren?: GameObject[]; // Preserved child hierarchy when saved as global template
  stats?: { // For RPG elements
    hp: number;
    maxHp: number;
    attack: number;
  };
  direction?: 'left' | 'right';
  visible?: boolean;
  opacity?: number;
  flipY?: boolean;
  rotation?: number; // In degrees
  scaleX?: number;
  scaleY?: number;
  isTouchable?: boolean; // If false, object is ignored by collision event detection. Defaults to true.
  isDraggable?: boolean;
  animations?: Animation[];
  dragXLocked?: boolean;
  dragYLocked?: boolean;
  dragMinX?: number;
  dragMaxX?: number;
  dragMinY?: number;
  dragMaxY?: number;
  dragDropBehavior?: 'fixed' | 'return' | 'random';
  dragRandomMinX?: number;
  dragRandomMaxX?: number;
  dragRandomMinY?: number;
  dragRandomMaxY?: number;
  useCustomCollision?: boolean;
  collision?: CollisionProperties;
  fixedColRotate?: boolean;

  // Boss & Projectile helper properties
  isProjectile?: boolean;
  projectileLifetime?: number;
  followTarget?: string;
  followSpeed?: number;
  bossSpeed?: number;
  bossJumpForce?: number;
  bossAttackInterval?: number;
  bossAttackSpeed?: number;
  bossFollowPlayer?: boolean;
  bossProjectileColor?: string;
  lastX?: number;
  _lastAttackTime?: number;
  vx3D?: number;
  vy3D?: number;
  vz3D?: number;
  grounded3D?: boolean;
  initial3D?: { x: number; y: number; z: number };
  
  // TweenPath helper properties
  tweenPathIndex?: number;
  tweenPathProgress?: number;

  // Properties for game simulation
  vx?: number;
  vy?: number;
  grounded?: boolean;
  patrolStartX?: number; // For Patrol behavior
  isAttacking?: boolean; // For attack behavior state
  pendingMovements?: { direction: string; speed: number }[]; // For MoveObject action
  isClimbing?: boolean; // For ladder climbing behavior
  doubleJumped?: boolean; // For double jump state
  isFalling?: boolean; // For falling state
  oscillation?: {
    axis: 'x' | 'y';
    distance: number;
    speed: number;
    initialX: number;
    initialY: number;
    startTime: number;
  };
  scaleOscillation?: {
    distance: number;
    speed: number;
    initialScaleX: number;
    initialScaleY: number;
    startTime: number;
  };
  rotationSpeed?: number;
  initialX?: number;
  initialY?: number;
  initialScaleX?: number;
  initialScaleY?: number;
  platformVx?: number;
  platformVy?: number;
  textColor?: string;
  fontSize?: number;
  animOffsetX?: number;
  animOffsetY?: number;
  animRotation?: number;
  animScaleX?: number;
  animScaleY?: number;
  scaleSpeedX?: number;
  scaleSpeedY?: number;
  tweens?: {
    type: 'position' | 'rotation' | 'scale';
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    startRotation?: number;
    endRotation?: number;
    startScaleX?: number;
    startScaleY?: number;
    endScaleX?: number;
    endScaleY?: number;
    startTime: number;
    duration: number;
  }[];
}

export interface AssetFolder {
  id: string;
  name: string;
  parentId?: string | null;
}

export interface GameAsset {
  id: string;
  name:string;
  type: 'image' | 'audio' | 'video' | '3d-model';
  url: string;
  folderId?: string | null;
}

export interface AnimationKeyframe {
  assetId: string; // id of the image asset
  duration: number; // in milliseconds
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
}

export interface Animation {
  id: string;
  name: string;
  frames: AnimationKeyframe[];
  loop: boolean;
}


export interface Condition {
  object: string;
  trigger: 'OnStart' | 'OnClick' | 'OnCollisionWith' | 'OnKeyPress' | 'OnKeyRelease' | 'OnAnyKeyPress' | 'OnAnyKeyRelease' | 'CompareVariable' | 'CompareBooleanVariable' | 'CompareObjectBooleanVariable' | 'OnObjectClicked' | 'OnObjectReleased' | 'IsIdle' | 'IsRunning' | 'IsJumping' | 'IsFalling' | 'OnAttack' | 'OnVerticalCollision' | 'OnHorizontalCollision' | 'IsOnGround' | 'IsMoving' | 'OnMatchFound' | 'OnPlayerJoined' | 'OnPlayerLeft' | 'OnReceiveNetworkMessage' | 'IsMusicPlaying' | 'CompareStat' | 'CompareObjectVariable' | 'OnJoystickMove' | 'OnJoystickUp' | 'OnJoystickDown' | 'OnJoystickLeft' | 'OnJoystickRight' | 'OnButtonDown' | 'OnButtonUp' | 'OnTriggerDown' | 'OnTriggerUp' | 'OnConsoleCommand' | 'OnTimerElapsed' | 'EveryXSeconds' | 'Always' | 'OnDialogueEnd' | 'OnHealthDepleted' | 'IsMobile' | 'IsPC' | 'IsClimbing' | 'IsLookingLeft' | 'IsLookingRight' | 'OnInteract' | 'IsSceneUnlocked' | 'OnObjectClicked3D' | 'Distance3DLessThan' | 'IsGrounded3D';
  target?: string;
  params?: Record<string, any>;
}

export interface Action {
  object: string; // Can be an object name, 'System', or 'Self' for object scripts
  action: 'Destroy' | 'AddToVariable' | 'SetVariable' | 'SetBooleanVariable' | 'ToggleBooleanVariable' | 'SetObjectBooleanVariable' | 'ToggleObjectBooleanVariable' | 'GoToScene' | 'SetUIText' | 'SetObjectPosition' | 'TeleportToObject' | 'PlaySound' | 'SetBackgroundColor' | 'SetBackgroundMusic' | 'StopBackgroundMusic' | 'PauseBackgroundMusic' | 'ResumeBackgroundMusic' | 'SetBackgroundMusicVolume' | 'PlayAnimation' | 'PlayAnimation3D' | 'StopAnimation3D' | 'ModifyStat' | 'ShowDialogue' | 'SetQuestState' | 'CreateMatch' | 'JoinMatch' | 'SendNetworkMessage' | 'SetPlayerName' | 'CreateObject' | 'PlayVideo' | 'PauseVideo' | 'StopVideo' | 'SaveGame' | 'LoadGame' | 'SetCameraZoom' | 'SetObjectVariable' | 'AddToObjectVariable' | 'StartTimer' | 'StopTimer' | 'MoveObject' | 'RunAtSpeed' | 'ForceJump' | 'TriggerAttack' | 'Attack' | 'SetParent' | 'RotateObject' | 'ScaleObject' | 'GenerateObjectAt' | 'OscillateObject' | 'OscillateScale' | 'RotateContinuously' | 'SetScale' | 'SetVelocityX' | 'SetVelocityY' | 'SetRotationSpeed' | 'SetScaleSpeedX' | 'SetScaleSpeedY' | 'MoveTo' | 'RotateTo' | 'ScaleTo' | 'SetVisible' | 'SetOpacity' | 'SetZIndex' | 'SetFlipX' | 'SetFlipY' | 'SlideTo' | 'SetDraggable' | 'ShowConsole' | 'GainHealth' | 'LoseHealth' | 'Knockback' | 'Shoot' | 'CreatePlayers' | 'DisconnectPlayers' | 'EnableCollision' | 'DisableCollision' | 'Wait' | 'SetSceneUnlocked' | 'EnableBehavior' | 'DisableBehavior' | 'SetJoystickEnabled' | 'SetSkin' | 'SetPlayerSkin' | 'FollowObject' | 'MoveInDirection' | 'SetPosition3D' | 'Move3D' | 'Rotate3D' | 'RotateContinuously3D' | 'Scale3D' | 'ForceJump3D' | 'ApplyImpulse3D' | 'SetShape3D' | 'SetColor3D' | 'SetModel3D' | 'SetCamera3DMode' | 'SetCamera3DOffset' | 'SetCamera3DMovement' | 'LookAtObject3D' | 'MoveTowards3D' | 'CreateObject3D' | 'Shoot3D' | 'SetLight3D' | 'SetFog3D' | 'SetSkybox3D';
  params?: Record<string, any>;
  onCompleteActions?: Action[];
}

export interface GameEvent {
  id: string;
  conditions: Condition[];
  actions: Action[];
  dimension?: '2D' | '3D';
  programmingMode?: 'events' | 'blocks';
  category?: string;
}

export interface Scene {
  id: string;
  name: string;
  sceneMode?: '2d' | '3d';
  gameObjects: GameObject[];
  events: GameEvent[];
  backgroundColor: string;
  skyboxImageUrl?: string;
  backgroundMusicId?: string;
  defaultZoom?: number;
  cameraBounds?: {
    enabled: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  camera3DMode?: string;
  camera3DTargetId?: number;
  camera3DOffset?: { x: number; y: number; z: number };
  camera3DFov?: number;
  camera3DMovementEnabled?: boolean;
  camera3DRightStickEnabled?: boolean;
  camera3DRightStickSensitivity?: number;
  fogEnabled?: boolean;
  fogColor?: string;
  fogDensity?: number;
  ambientLightIntensity?: number;
  sunLightIntensity?: number;
  sunLightColor?: string;
  maxPlayers?: number;
  fourKRendering?: boolean;
  hdRendering?: boolean;
  pixelArt?: boolean;
}

export interface PoseFrame {
  id: string;
  name?: string;
  shape3D?: Shape3D;
  color?: string;
  emissive3D?: string;
  emissiveIntensity3D?: number;
  modelUrl?: string;
  modelAnimName?: string; // Embedded GLTF animation name to display/play in this frame
  modelAnimSpeed?: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  duration: number;
}

export interface PoseAnimation {
  id: string;
  name: string;
  loop?: boolean;
  frames: PoseFrame[];
}

export interface ProjectData {
  name?: string;
  defaultDimension?: '2d' | '3d';
  scenes: Scene[];
  activeSceneId: string | null;
  assetFolders?: AssetFolder[];
  assets: GameAsset[];
  animations: Animation[];
  poseAnimations?: PoseAnimation[];
  globalObjects?: GameObject[];
  globalVariables?: Variable[];
  orientation?: 'landscape' | 'portrait';
  responsive?: boolean;
  gameWidth?: number;
  gameHeight?: number;
  joystick?: {
    enabled: boolean;
    position: 'left' | 'right';
    size?: number;
    opacity?: number;
    backgroundImageUrl?: string;
    handleImageUrl?: string;
  };
  fps?: number;
  hdRendering?: boolean;
  fourKRendering?: boolean;
  smoothGraphics?: boolean;
  pixelArt?: boolean;
}

export interface Project {
  id: string;
  name: string;
  lastModified: number;
  data: ProjectData;
  icon?: string;
}