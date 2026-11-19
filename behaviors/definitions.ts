

export interface BehaviorDefinition {
  name: string;
  description: string;
  defaultProperties: Record<string, any>;
}

export const availableBehaviors: BehaviorDefinition[] = [
  {
    name: 'PlatformerCharacter',
    description: 'Habilita controles de teclado para movimiento lateral y salto.',
    defaultProperties: {
      speed: 150,
      jumpForce: 350,
      gravity: 500,
      doubleJumpEnabled: false,
      idleAnimId: '',
      runAnimId: '',
      jumpAnimId: '',
      fallAnimId: '',
      attackAnimId: '',
    },
  },
  {
    name: 'TopDownRPGMovement',
    description: 'Habilita movimiento en 8 direcciones (arriba/abajo/lados/diagonales) sin gravedad.',
    defaultProperties: {
      speed: 100,
      idleAnimId: '',
      runAnimId: '',
      jumpAnimId: '',
      fallAnimId: '',
      attackAnimId: '',
    },
  },
  {
    name: 'Solid',
    description: 'Convierte el objeto en un obstáculo sólido sobre el que otros objetos pueden pararse o colisionar.',
    defaultProperties: {},
  },
  {
    name: 'Physics',
    description: 'Aplica gravedad al objeto, haciendo que caiga.',
    defaultProperties: {
      gravity: 500,
    },
  },
  {
    name: 'Patrol',
    description: 'Mueve el objeto de un lado a otro horizontalmente dentro de un rango establecido.',
    defaultProperties: {
      speed: 50,
      range: 100,
      sticky: true,
    },
  },
  {
    name: 'Oscillate',
    description: 'Hace que el objeto se mueva de un lado a otro en un eje (x o y) de forma fluida.',
    defaultProperties: {
      axis: 'x',
      distance: 100,
      speed: 2,
      sticky: true,
    },
  },
  {
    name: 'Rotate',
    description: 'Hace que el objeto gire continuamente.',
    defaultProperties: {
      rotationSpeed: 90,
    },
  },
  {
    name: 'Pulse',
    description: 'Hace que el objeto cambie de tamaño de forma pulsante.',
    defaultProperties: {
      distance: 0.2,
      speed: 2,
    },
  },
  {
    name: 'FollowCamera',
    description: 'Hace que la cámara del juego siga a este objeto.',
    defaultProperties: {},
  },
  {
    name: 'Tilemap',
    description: 'Genera un mapa de colisiones estático basado en una rejilla de texto. Usa cualquier caracter para un bloque sólido y "0" o espacio para vacío.',
    defaultProperties: {
      tileSize: 32,
      collisionData: '11111111111111111111\n10000000000000000001\n10000000000000000001\n10000000000000000001\n11111111111111111111',
    },
  },
  {
    name: 'Health',
    description: 'Gestiona la salud y puntos de vida (hp) del objeto.',
    defaultProperties: {
      hp: 100,
      maxHp: 100,
      showHealthBar: true,
    },
  },
  {
    name: 'ScoreCounter',
    description: 'Muestra el valor de una variable. Usa {value} en la plantilla de texto.',
    defaultProperties: {
      variableName: 'score',
      format: 'Score: {value}',
    },
  },
  {
    name: 'Attack',
    description: 'Genera un cubo de daño al atacar.',
    defaultProperties: {
      attackDistance: 30,
      damage: 10,
    },
  },
  {
    name: 'TweenPath',
    description: 'Mueve el objeto siguiendo una serie de puntos.',
    defaultProperties: {
      speed: 100,
      loop: true,
      points: '0,0;100,100',
    },
  },
  {
    name: 'TextVariable',
    description: 'Muestra el valor de una variable en este objeto de texto.',
    defaultProperties: {
      variableName: '',
      prefix: '',
      suffix: '',
    },
  },
  {
    name: 'Boss',
    description: 'Comportamiento de Jefe (Boss). Persigue al jugador, salta obstáculos, y lanza proyectiles con intervalo, velocidad y color personalizados.',
    defaultProperties: {
      hp: 500,
      maxHp: 500,
      speed: 80,
      jumpForce: 300,
      attackInterval: 2,
      attackSpeed: 300,
      followPlayer: true,
      projectileColor: '#ef4444',
    },
  },
  {
    name: 'Ladder',
    description: 'Convierte el objeto en una escalera que se puede subir superponiéndose con ella.',
    defaultProperties: {},
  },
  {
    name: 'LadderClimber',
    description: 'Permite al objeto subir y bajar por escaleras usando los controles de dirección (Arriba / Abajo).',
    defaultProperties: {
      speed: 100,
    },
  },
  {
    name: 'Interactable',
    description: 'Permite al jugador interactuar con este objeto presionando la tecla "E" o el botón de interactuar en pantalla cuando está cerca.',
    defaultProperties: {
      radius: 60,
      prompt: 'Interactuar [E]',
      showPrompt: true,
    },
  },
  {
    name: 'MultiplayerTag',
    description: 'Etiqueta el objeto como un personaje multijugador con número de jugador y tipo de movimiento asignados.',
    defaultProperties: {
      playerNumber: 1,
      movementType: 'topdown',
      speed: 150,
      jumpForce: 350,
      gravity: 500,
      doubleJumpEnabled: false,
      idleAnimId: '',
      runAnimId: '',
      jumpAnimId: '',
      fallAnimId: '',
      attackAnimId: '',
    },
  },
  {
    name: 'Player3D',
    description: 'Controla este objeto en 3D (WASD / Flechas / Joystick + Espacio para saltar y gravedad 3D).',
    defaultProperties: {
      speed: 6,
      jumpForce: 8,
      gravity: 18,
      canJump: true,
      idleAnimId: '',
      runAnimId: '',
      jumpAnimId: '',
      fallAnimId: '',
      attackAnimId: '',
    },
  },
  {
    name: 'Solid3D',
    description: 'Convierte este objeto en una plataforma, suelo o pared sólida en 3D con colisión AABB.',
    defaultProperties: {},
  },
  {
    name: 'Physics3D',
    description: 'Aplica gravedad 3D y colisión contra plataformas sólidas 3D.',
    defaultProperties: {
      gravity: 18,
    },
  },
  {
    name: 'FollowCamera3D',
    description: 'Hace que la cámara 3D siga a este objeto (3ª Persona, 1ª Persona o Isométrica).',
    defaultProperties: {
      mode: 'thirdPerson',
      distance: 9,
      height: 5,
    },
  },
  {
    name: 'Patrol3D',
    description: 'Mueve el objeto en ida y vuelta en el eje X, Y o Z en 3D.',
    defaultProperties: {
      axis: 'x',
      speed: 2.5,
      range: 4,
    },
  },
  {
    name: 'Oscillate3D',
    description: 'Oscilación suave senoidal en el eje X, Y o Z en 3D.',
    defaultProperties: {
      axis: 'y',
      distance: 1,
      speed: 2,
    },
  },
  {
    name: 'Rotate3D',
    description: 'Gira el objeto continuamente en 3D (grados/segundo en eje Y por defecto).',
    defaultProperties: {
      speedX: 0,
      speedY: 90,
      speedZ: 0,
    },
  },
  {
    name: 'Boss3D',
    description: 'Jefe 3D: persigue al jugador por el escenario, salta obstáculos y dispara proyectiles 3D.',
    defaultProperties: {
      hp: 500,
      maxHp: 500,
      speed: 2.5,
      jumpForce: 6,
      attackInterval: 2,
      attackSpeed: 9,
      projectileColor: '#ef4444',
    },
  },
];