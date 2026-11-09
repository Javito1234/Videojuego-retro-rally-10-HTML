'use strict';
// ============================================================================
// RETRO RALLY 10 - CAMPEONATO, RALLY, CARRERA INDIVIDUAL Y CONTRARRELOJ
// Quinto juego de la saga: 12 circuitos con vueltas + 12 etapas punto a punto, todos con túneles y puentes,
// rivales de IA, daño, copiloto, y 4 modos: campeonato, rally individual, carrera individual y contrarreloj con sombra.
// ============================================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const WIDTH = 800, HEIGHT = 450;
canvas.width = WIDTH;
canvas.height = HEIGHT;

const STEP = 1 / 60;
const SEG_LEN = 200;          // largo de cada segmento de ruta (unidades de mundo)
const ROAD_W = 2000;          // semiancho de la ruta
const RUMBLE_LEN = 3;
const LANES = 3;
const DRAW_DIST = 240;        // segmentos que se dibujan hacia adelante
const CAM_DEPTH = 0.84;
const CAM_H = 1000;
const PLAYER_Z = CAM_H * CAM_DEPTH;   // el auto va "adelante" de la cámara
const KMH_WORLD = 45;         // unidades de mundo por segundo por cada km/h
const M_PER_UNIT = 0.00617;   // metros por unidad de mundo
const RUNOUT_SEGS = 160;      // tramo de frenado después de la meta (solo etapas)
const BARRIER_X = 2.3;        // valla lateral en campo abierto
const TUNNEL_X = 1.14;        // pared del túnel (en semianchos de ruta)
const BRIDGE_X = 1.07;        // baranda del puente
const TUNNEL_H = 2200;        // alto del túnel (unidades de mundo)
const RAIL_H = 430;           // alto de la baranda del puente
const ACCENT = '#ff4fa3';     // color de acento de la décima entrega

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
const easeInOut = (a, b, p) => a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5);

function formatTime(sec) {
    if (sec == null || !isFinite(sec)) return '--:--.--';
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
}


function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = function (sh) { return Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t); };
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

// ---------------------------------------------------------------------------
// DATOS: vehículos, superficies, temas, dificultad y pruebas
// ---------------------------------------------------------------------------
const carImgs = ['escarabajo.png', 'coupe.png', 'hypercar.png'].map(function (n) {
    const im = new Image(); im.src = n; return im;
});

// top = km/h máx. | a0 = aceleración base (km/h por seg) | brake = frenada | steer = respuesta de dirección
// surf = multiplicador de agarre por superficie (el Hypercar vuela en asfalto y sufre en nieve)
const VEHICLES = [
    { name: 'VW Escarabajo', top: 172, a0: 33, brake: 120, steer: 2.25, surf: { asphalt: 0.95, gravel: 1.12, snow: 1.05 }, rpmMax: 5600, pulses: 2, tone: 0.55 },
    { name: 'Coupé GT',      top: 205, a0: 42, brake: 135, steer: 2.35, surf: { asphalt: 1.00, gravel: 1.00, snow: 1.00 }, rpmMax: 7000, pulses: 2, tone: 0.80 },
    { name: 'V12 Hypercar',  top: 242, a0: 58, brake: 150, steer: 2.45, surf: { asphalt: 1.06, gravel: 0.84, snow: 0.74 }, rpmMax: 8500, pulses: 3, tone: 1.10 }
];

const SURFACES = {
    asphalt: { name: 'ASFALTO', grip: 1.00, push: 1.00, accel: 1.00, brake: 1.00, top: 1.00, road: ['#4b4b50', '#444449'], rumble: ['#ffffff', '#d61f1f'], noiseF: 1400, noiseG: 0.030 },
    gravel:  { name: 'TIERRA',  grip: 0.74, push: 1.25, accel: 0.93, brake: 0.78, top: 0.92, road: ['#b58f5a', '#a9844f'], rumble: ['#8a6b3f', '#7a5c34'], noiseF: 900,  noiseG: 0.090 },
    snow:    { name: 'NIEVE',   grip: 0.56, push: 1.50, accel: 0.85, brake: 0.55, top: 0.84, road: ['#e2eaf3', '#d5e0ec'], rumble: ['#9db4cb', '#8aa5c0'], noiseF: 500,  noiseG: 0.040 }
};


const THEMES = {
    // Puerto de noche: ciudad iluminada, farolas y agua negra
    harbor: {
        skyTop: '#02030f', skyMid: '#10163a', skyBottom: '#2a2f66', mt1: '#0b0d24', mt2: '#151a3c',
        grass: ['#1b2433', '#161e2b'], fog: '#1d2350', fogD: 2.4,
        sun: { x: 0.74, y: 95, r: 22, color: '#e8f0ff' }, stars: true, skyline: true,
        deco: [{ k: 'lamp', w: 7 }, { k: 'bldg', w: 5 }, { k: 'bush', w: 1 }],
        water: ['#0b1b36', '#0e2342'], snowfall: false
    },
    // Cañón del desierto: mesas rojas, cactus y arena
    canyon: {
        skyTop: '#2c7be0', skyMid: '#7cc0f0', skyBottom: '#ffe9c4', mt1: '#c0663a', mt2: '#a24a2a',
        grass: ['#d9a066', '#cf9659'], fog: '#f2d3a8', fogD: 2.0,
        sun: { x: 0.30, y: 110, r: 28, color: '#fff3c4' }, stars: false, skyline: false,
        deco: [{ k: 'cactus', w: 5 }, { k: 'mesa', w: 3 }, { k: 'rock', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#2c6b8f', '#2a6385'], snowfall: false,
        surfColors: { gravel: { road: ['#d8b27c', '#cca66f'], rumble: ['#b98a52', '#a97d48'] } }
    },
    // Lago por la mañana: neblina, pinos y árboles de hoja ancha
    lake: {
        skyTop: '#7fa4c8', skyMid: '#b9d0e0', skyBottom: '#eef3f0', mt1: '#6f8fa6', mt2: '#4f7a5a',
        grass: ['#4f8f4a', '#478742'], fog: '#dfe8e6', fogD: 3.0,
        sun: { x: 0.62, y: 60, r: 24, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 4 }, { k: 'broadleaf', w: 4 }, { k: 'bush', w: 2 }, { k: 'rock', w: 1 }],
        water: ['#3e7f9e', '#397793'], snowfall: false
    },
    // Sierra alpina: picos nevados, pinos y prados
    alpine: {
        skyTop: '#1e6fd0', skyMid: '#6fb3ee', skyBottom: '#eaf6ff', mt1: '#d3deea', mt2: '#7390a8',
        grass: ['#6c9a52', '#648f4b'], fog: '#dcecf8', fogD: 2.2,
        sun: { x: 0.78, y: 120, r: 22, color: '#fffbe8' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 5 }, { k: 'snowpine', w: 2 }, { k: 'rock', w: 3 }, { k: 'bush', w: 1 }],
        water: ['#4a86b0', '#437ca3'], snowfall: false
    },
    // Selva húmeda: vegetación densa y tierra oscura
    jungle: {
        skyTop: '#3a7fb0', skyMid: '#9ccfa8', skyBottom: '#e5f3c9', mt1: '#4b7d63', mt2: '#2f5e48',
        grass: ['#2f7a35', '#2a712f'], fog: '#cfe8c0', fogD: 2.8,
        sun: { x: 0.45, y: 80, r: 26, color: '#fff7c4' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'palm', w: 3 }, { k: 'bush', w: 3 }],
        water: ['#6b5a3a', '#615233'], snowfall: false,
        surfColors: { gravel: { road: ['#8a6a46', '#7e5f3e'], rumble: ['#5a4128', '#4e3822'] } }
    },
    // Costa al atardecer: acantilados, mar violeta y sol bajo
    dusk: {
        skyTop: '#2a1450', skyMid: '#d6457a', skyBottom: '#ffb15a', mt1: '#3b2260', mt2: '#5a2c70',
        grass: ['#3c5a3e', '#365236'], fog: '#e08a8a', fogD: 2.4,
        sun: { x: 0.50, y: 25, r: 44, color: '#ffd9a0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 3 }, { k: 'bush', w: 3 }, { k: 'rock', w: 3 }],
        water: ['#2e3c78', '#283468'], snowfall: false
    },
    // Ciudad neón de noche: cielo violeta, rascacielos y farolas
    neon: {
        skyTop: '#05010f', skyMid: '#2a0a52', skyBottom: '#7a1f8f', mt1: '#1a0836', mt2: '#2a0f4d',
        grass: ['#1a1030', '#150c28'], fog: '#4a1a6e', fogD: 2.4,
        sun: { x: 0.35, y: 90, r: 26, color: '#ff7ad9' }, stars: true, skyline: true,
        deco: [{ k: 'lamp', w: 7 }, { k: 'bldg', w: 6 }, { k: 'bush', w: 1 }],
        water: ['#10143a', '#0c1030'], snowfall: false
    },
    // Otoño: hojas naranjas y rojizas, luz cálida
    autumn: {
        skyTop: '#3f6fb5', skyMid: '#e3a35a', skyBottom: '#ffe2b0', mt1: '#a8552a', mt2: '#7a3a1e',
        grass: ['#b5651d', '#a85a18'], fog: '#f0cf9c', fogD: 2.6,
        sun: { x: 0.70, y: 90, r: 26, color: '#fff0c0' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'pine', w: 2 }, { k: 'bush', w: 2 }, { k: 'rock', w: 1 }],
        water: ['#4a6e8a', '#436680'], snowfall: false,
        leaf: ['#b5470f', '#d9701c', '#e8a02a'], bushC: ['#a2561a', '#c47a24'],
        surfColors: { gravel: { road: ['#a97a4a', '#9c6f42'], rumble: ['#6e4a28', '#60401f'] } }
    },
    // Dunas: arena clara, cactus y palmeras
    dunes: {
        skyTop: '#4aa3e8', skyMid: '#bfe2f5', skyBottom: '#fff1c9', mt1: '#e0b46a', mt2: '#c99548',
        grass: ['#ecc57a', '#e2b96c'], fog: '#f6dcaa', fogD: 2.2,
        sun: { x: 0.55, y: 120, r: 30, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'cactus', w: 4 }, { k: 'rock', w: 3 }, { k: 'palm', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#2f8fb0', '#2a86a6'], snowfall: false,
        bushC: ['#8f9a3a', '#a8b04a'],
        surfColors: { gravel: { road: ['#d9b57a', '#cfa96d'], rumble: ['#b58a4c', '#a67d42'] } }
    },
    // Noche polar: nevada constante, luna y pinos cargados de nieve
    frost: {
        skyTop: '#020816', skyMid: '#0e2548', skyBottom: '#27508a', mt1: '#1c3354', mt2: '#2c4a73',
        grass: ['#dfe9f5', '#d3e0f0'], fog: '#25406b', fogD: 2.4,
        sun: { x: 0.25, y: 110, r: 20, color: '#cfe4ff' }, stars: true, skyline: false,
        deco: [{ k: 'snowpine', w: 6 }, { k: 'pine', w: 2 }, { k: 'rock', w: 2 }],
        water: ['#0f2a4a', '#0c2340'], snowfall: true
    },
    // Volcán: cielo rojizo, roca negra y lava en lugar de agua
    volcano: {
        skyTop: '#1a0606', skyMid: '#6a1a10', skyBottom: '#d4541f', mt1: '#2a0f0c', mt2: '#4a1a10',
        grass: ['#2b2220', '#241c1a'], fog: '#7a2a18', fogD: 2.2,
        sun: { x: 0.40, y: 70, r: 34, color: '#ff9a3c' }, stars: false, skyline: false,
        deco: [{ k: 'rock', w: 6 }, { k: 'mesa', w: 2 }, { k: 'bush', w: 1 }],
        water: ['#c2410c', '#a8360a'], snowfall: false,
        bushC: ['#4a2a22', '#5e362b'],
        surfColors: { gravel: { road: ['#6b5a52', '#5f4f48'], rumble: ['#3a2e2a', '#322824'] } }
    },
    // Sakura: cerezos en flor, cielo claro y rosado
    sakura: {
        skyTop: '#6aa9e8', skyMid: '#f7cfe0', skyBottom: '#fff3f6', mt1: '#c98aa8', mt2: '#9a6a8a',
        grass: ['#6fae5a', '#67a553'], fog: '#f6dfe8', fogD: 2.8,
        sun: { x: 0.35, y: 90, r: 26, color: '#fff6d8' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 6 }, { k: 'pine', w: 1 }, { k: 'bush', w: 3 }, { k: 'rock', w: 1 }],
        water: ['#5a8fb8', '#5385ad'], snowfall: false,
        leaf: ['#e58fb0', '#f2a9c4', '#f7c6d8'], bushC: ['#d9729a', '#ee93b4']
    },
    // Sabana: hierba dorada, cielo anaranjado y arbustos secos
    savanna: {
        skyTop: '#2f78d0', skyMid: '#f0b060', skyBottom: '#ffe0a0', mt1: '#b9803a', mt2: '#8f5f2a',
        grass: ['#c9a548', '#bf9b40'], fog: '#f2d49a', fogD: 2.2,
        sun: { x: 0.60, y: 60, r: 36, color: '#fff0b0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 2 }, { k: 'bush', w: 4 }, { k: 'rock', w: 3 }, { k: 'cactus', w: 1 }],
        water: ['#7a6a3a', '#6f6032'], snowfall: false,
        bushC: ['#8a8a2a', '#a3a33a'],
        surfColors: { gravel: { road: ['#c7a064', '#bb9558'], rumble: ['#8a6a3a', '#7c5e32'] } }
    },
    // Pantano: neblina verde oscura, árboles retorcidos y agua turbia
    swamp: {
        skyTop: '#34524a', skyMid: '#7c9a7a', skyBottom: '#c6d6b0', mt1: '#3a5a48', mt2: '#2a4638',
        grass: ['#3f5a2f', '#385228'], fog: '#a8bd9c', fogD: 3.2,
        sun: { x: 0.50, y: 130, r: 22, color: '#e8f0c0' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 5 }, { k: 'palm', w: 2 }, { k: 'bush', w: 4 }, { k: 'rock', w: 1 }],
        water: ['#3a4a2a', '#33422a'], snowfall: false,
        leaf: ['#2f5a2a', '#3a6a30', '#4a7a3a'], bushC: ['#35592b', '#44703a']
    },
    // Amanecer: cielo rosado y dorado, luz baja y campos verdes
    dawn: {
        skyTop: '#3a4f9a', skyMid: '#e58aa0', skyBottom: '#ffd9a0', mt1: '#6a5a8a', mt2: '#4e4672',
        grass: ['#5f9a4a', '#578f43'], fog: '#f2c4a6', fogD: 2.6,
        sun: { x: 0.30, y: 120, r: 34, color: '#fff2c4' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 4 }, { k: 'pine', w: 3 }, { k: 'bush', w: 3 }, { k: 'rock', w: 1 }],
        water: ['#6a86b8', '#5f7bad'], snowfall: false,
        leaf: ['#4f8a3a', '#6aa04a', '#8ab85a'], bushC: ['#4a7a35', '#5e9140']
    },
    // Valle de niebla: bruma densa, verdes fríos y poca visibilidad
    mist: {
        skyTop: '#7f94a0', skyMid: '#b4c4c8', skyBottom: '#e2eceb', mt1: '#87a09a', mt2: '#6c8780',
        grass: ['#4f7a52', '#477049'], fog: '#cfdcd9', fogD: 3.6,
        sun: { x: 0.60, y: 140, r: 24, color: '#f4f8f0' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 5 }, { k: 'broadleaf', w: 3 }, { k: 'bush', w: 3 }, { k: 'rock', w: 1 }],
        water: ['#6f8a90', '#668288'], snowfall: false,
        leaf: ['#3f6a46', '#4f7e55', '#62926a'], bushC: ['#436e4a', '#548259'],
        surfColors: { gravel: { road: ['#9a9486', '#8e887b'], rumble: ['#6a665c', '#5e5a51'] } }
    },
    // Mesa roja: roca escarlata, cactus y cielo de atardecer seco
    redrock: {
        skyTop: '#2f5fa8', skyMid: '#e0884a', skyBottom: '#ffd08a', mt1: '#b0472a', mt2: '#8a321c',
        grass: ['#c0643a', '#b45a32'], fog: '#efb082', fogD: 2.3,
        sun: { x: 0.65, y: 110, r: 32, color: '#fff0c0' }, stars: false, skyline: false,
        deco: [{ k: 'mesa', w: 4 }, { k: 'cactus', w: 3 }, { k: 'rock', w: 4 }, { k: 'bush', w: 1 }],
        water: ['#3a7a9a', '#337090'], snowfall: false,
        bushC: ['#8a6a2a', '#a07c34'],
        surfColors: { gravel: { road: ['#c98a5a', '#bd7e50'], rumble: ['#8a4a2a', '#7c4022'] } }
    },
    // Tundra: cielo plomizo, pasto ralo y nieve en polvo
    tundra: {
        skyTop: '#56687a', skyMid: '#8fa1b0', skyBottom: '#cfd9e0', mt1: '#7c8d9c', mt2: '#62748a',
        grass: ['#8e9a7c', '#848f73'], fog: '#bcc8d2', fogD: 2.8,
        sun: { x: 0.45, y: 135, r: 22, color: '#f0f4f8' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 3 }, { k: 'snowpine', w: 3 }, { k: 'rock', w: 4 }, { k: 'bush', w: 2 }],
        water: ['#4a6478', '#425c70'], snowfall: true,
        bushC: ['#7a8468', '#8a9476']
    },
    // Noche de luna llena: cielo estrellado, pasto azulado y farolas
    moon: {
        skyTop: '#03061a', skyMid: '#0f1f4a', skyBottom: '#24428a', mt1: '#0d1830', mt2: '#16254a',
        grass: ['#1d3a3a', '#183232'], fog: '#1c3566', fogD: 2.5,
        sun: { x: 0.68, y: 80, r: 30, color: '#e8f0ff' }, stars: true, skyline: false,
        deco: [{ k: 'pine', w: 4 }, { k: 'lamp', w: 3 }, { k: 'rock', w: 3 }, { k: 'bush', w: 2 }],
        water: ['#0a1a3a', '#081632'], snowfall: false,
        bushC: ['#1f4040', '#285050']
    },
    // Costa: arena clara, palmeras y mar celeste
    coast: {
        skyTop: '#2f8fe0', skyMid: '#8cd0f0', skyBottom: '#eaf8ff', mt1: '#5aa0b8', mt2: '#4a8aa5',
        grass: ['#dcc78c', '#d1bb80'], fog: '#cfeaf5', fogD: 2.2,
        sun: { x: 0.52, y: 110, r: 30, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 5 }, { k: 'rock', w: 2 }, { k: 'bush', w: 2 }],
        water: ['#1f78b0', '#1b6ea6'], snowfall: false,
        bushC: ['#6a9a4a', '#7fae58'],
        surfColors: { gravel: { road: ['#cdb98a', '#c2ae7f'], rumble: ['#9a875a', '#8c7a4f'] } }
    },
    // Viñedos: luz dorada de tarde, filas de verde y colinas moradas
    vineyard: {
        skyTop: '#4a78c0', skyMid: '#f0b070', skyBottom: '#ffe4b0', mt1: '#8a6a8a', mt2: '#6a5070',
        grass: ['#7a9a3a', '#6e8f33'], fog: '#f4d8a8', fogD: 2.5,
        sun: { x: 0.72, y: 105, r: 30, color: '#fff2c0' }, stars: false, skyline: false,
        deco: [{ k: 'bush', w: 6 }, { k: 'broadleaf', w: 3 }, { k: 'rock', w: 1 }, { k: 'pine', w: 1 }],
        water: ['#5a7a9a', '#52708f'], snowfall: false,
        leaf: ['#6a8a2a', '#8aa63a', '#b0a838'], bushC: ['#5a7a28', '#6f9033']
    },
    // Bambú: bosque verde brillante con bruma suave
    bamboo: {
        skyTop: '#6a9a8a', skyMid: '#b6d8c0', skyBottom: '#e8f4e0', mt1: '#5a8a70', mt2: '#487a60',
        grass: ['#3f8a45', '#378040'], fog: '#cfe6d2', fogD: 3.0,
        sun: { x: 0.4, y: 120, r: 24, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 4 }, { k: 'broadleaf', w: 3 }, { k: 'bush', w: 4 }, { k: 'rock', w: 1 }],
        water: ['#3a7a6a', '#336f60'], snowfall: false,
        leaf: ['#3c8a3a', '#58a84a', '#7ac860'], bushC: ['#3f8a45', '#52a055']
    },
    // Salinas: blanco brillante, lagunas rosadas y rocas
    salt: {
        skyTop: '#6aa8e0', skyMid: '#cfe6f5', skyBottom: '#fdfdfd', mt1: '#c8b8c8', mt2: '#b0a0b8',
        grass: ['#f0e8e8', '#e6dede'], fog: '#f4eef4', fogD: 2.0,
        sun: { x: 0.6, y: 100, r: 32, color: '#ffffff' }, stars: false, skyline: false,
        deco: [{ k: 'rock', w: 4 }, { k: 'bush', w: 1 }, { k: 'cactus', w: 1 }],
        water: ['#e89aa8', '#df8d9c'], snowfall: false,
        bushC: ['#a89a8a', '#b8aa9a'],
        surfColors: { gravel: { road: ['#d8cfcf', '#cdc4c4'], rumble: ['#a89a9a', '#9a8c8c'] } }
    },
    // Pradera: campo amarillo, cielo abierto
    prairie: {
        skyTop: '#4a90d8', skyMid: '#a8d0f0', skyBottom: '#f8f0c8', mt1: '#8aa070', mt2: '#708a5a',
        grass: ['#c8b84a', '#bcac42'], fog: '#ece6b8', fogD: 2.3,
        sun: { x: 0.5, y: 115, r: 28, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'bush', w: 5 }, { k: 'rock', w: 2 }, { k: 'broadleaf', w: 1 }, { k: 'mesa', w: 1 }],
        water: ['#4a8aa8', '#42809e'], snowfall: false,
        bushC: ['#a09638', '#b6aa44'],
        surfColors: { gravel: { road: ['#c4a874', '#b89c68'], rumble: ['#8a7442', '#7c6838'] } }
    },
    // Aurora boreal: noche polar con cielo verde
    aurora: {
        skyTop: '#021a20', skyMid: '#0a5a50', skyBottom: '#2a9a7a', mt1: '#0a2a38', mt2: '#12384a',
        grass: ['#e0ecf4', '#d4e2ee'], fog: '#1a5a5a', fogD: 2.4,
        sun: { x: 0.5, y: 90, r: 18, color: '#d8fff0' }, stars: true, skyline: false,
        deco: [{ k: 'snowpine', w: 6 }, { k: 'pine', w: 2 }, { k: 'rock', w: 2 }],
        water: ['#0c3a4a', '#0a3040'], snowfall: true
    },
    // Tormenta: cielo plomo, verdes oscuros y agua gris
    storm: {
        skyTop: '#2a323c', skyMid: '#4a5664', skyBottom: '#7a8896', mt1: '#3a4654', mt2: '#2e3a48',
        grass: ['#3a5a3a', '#335232'], fog: '#5a6674', fogD: 3.0,
        sun: { x: 0.5, y: 150, r: 18, color: '#aab4c0' }, stars: false, skyline: false,
        deco: [{ k: 'pine', w: 4 }, { k: 'broadleaf', w: 3 }, { k: 'bush', w: 2 }, { k: 'rock', w: 2 }],
        water: ['#2a4050', '#243848'], snowfall: false,
        leaf: ['#2f5a2a', '#3a6a30', '#4a7a3a'], bushC: ['#2f4a2c', '#3a5a35']
    },
    // Brezal: matorral violeta y cielo rosado
    heath: {
        skyTop: '#5a70a8', skyMid: '#c8b0c8', skyBottom: '#f0dcd8', mt1: '#7a6a8a', mt2: '#625474',
        grass: ['#7a5a8a', '#6e5080'], fog: '#e2ccd6', fogD: 2.6,
        sun: { x: 0.35, y: 118, r: 26, color: '#fff0e0' }, stars: false, skyline: false,
        deco: [{ k: 'bush', w: 5 }, { k: 'rock', w: 3 }, { k: 'pine', w: 1 }],
        water: ['#6a6a9a', '#606092'], snowfall: false,
        bushC: ['#8a5a9a', '#a070b0'],
        surfColors: { gravel: { road: ['#a08a8a', '#947e7e'], rumble: ['#6a5a6a', '#5e4e5e'] } }
    },
    // Brasas: cielo de ceniza anaranjada, suelo oscuro y rocas ardientes
    ember: {
        skyTop: '#1a0c0c', skyMid: '#6a2412', skyBottom: '#e8803a', mt1: '#2a1612', mt2: '#3a1c14',
        grass: ['#3a2a26', '#32231f'], fog: '#8a3a1c', fogD: 2.4,
        sun: { x: 0.45, y: 112, r: 34, color: '#ffb060' }, stars: false, skyline: false,
        deco: [{ k: 'rock', w: 5 }, { k: 'bush', w: 2 }, { k: 'cactus', w: 1 }],
        water: ['#c8441a', '#b53c16'], snowfall: false,
        bushC: ['#4a2a1e', '#5a3422'],
        surfColors: { gravel: { road: ['#5a4640', '#4e3c36'], rumble: ['#2e201c', '#261a16'] } }
    },
    // Orquídea: selva rosada y violeta con bruma tibia
    orchid: {
        skyTop: '#7a4a9a', skyMid: '#e8a0c8', skyBottom: '#ffe4ee', mt1: '#8a5a9a', mt2: '#6e4482',
        grass: ['#4a8a5a', '#3f7e50'], fog: '#f2c8dc', fogD: 2.8,
        sun: { x: 0.62, y: 115, r: 26, color: '#fff2f8' }, stars: false, skyline: false,
        deco: [{ k: 'broadleaf', w: 5 }, { k: 'bush', w: 4 }, { k: 'palm', w: 2 }, { k: 'rock', w: 1 }],
        water: ['#8a5ab0', '#7e50a4'], snowfall: false,
        leaf: ['#c85aa0', '#e87ac0', '#f4a0d4'], bushC: ['#b04a9a', '#cc66b4']
    },
    // Glaciar: turquesa helado, mañana despejada
    glacier: {
        skyTop: '#3a8ad0', skyMid: '#a8dcf0', skyBottom: '#f0fbff', mt1: '#a8d0e0', mt2: '#8abcd2',
        grass: ['#e4f2f8', '#d6e8f2'], fog: '#d8f0f8', fogD: 2.1,
        sun: { x: 0.3, y: 100, r: 28, color: '#ffffff' }, stars: false, skyline: false,
        deco: [{ k: 'snowpine', w: 4 }, { k: 'rock', w: 3 }],
        water: ['#2aa0c0', '#2494b4'], snowfall: false,
        bushC: ['#9ab8c8', '#aac6d4']
    },
    // Oasis: arena, palmeras y agua turquesa bajo sol alto
    oasis: {
        skyTop: '#2a7ad8', skyMid: '#8ec8ee', skyBottom: '#fff4d0', mt1: '#d8b070', mt2: '#c49a56',
        grass: ['#e6cc88', '#dcc07a'], fog: '#f6e4b4', fogD: 2.3,
        sun: { x: 0.5, y: 96, r: 32, color: '#fffbe0' }, stars: false, skyline: false,
        deco: [{ k: 'palm', w: 5 }, { k: 'cactus', w: 2 }, { k: 'rock', w: 2 }, { k: 'bush', w: 2 }],
        water: ['#20b0b0', '#1aa4a6'], snowfall: false,
        bushC: ['#6a9a3a', '#82b04a'],
        surfColors: { gravel: { road: ['#d4b880', '#c8ac74'], rumble: ['#a88a50', '#9a7c46'] } }
    },
    // Amatista: noche violeta con cristales y luna grande
    amethyst: {
        skyTop: '#0a0620', skyMid: '#3a1a6a', skyBottom: '#8a4ac0', mt1: '#2a1450', mt2: '#3a1c6a',
        grass: ['#3a2a5a', '#32244e'], fog: '#5a2e8a', fogD: 2.5,
        sun: { x: 0.7, y: 90, r: 30, color: '#e8d0ff' }, stars: true, skyline: false,
        deco: [{ k: 'rock', w: 5 }, { k: 'bush', w: 2 }, { k: 'pine', w: 1 }],
        water: ['#5a2a9a', '#502490'], snowfall: false,
        bushC: ['#5a3a8a', '#6e4aa0']
    },
    harbor2: {"skyTop":"#0f0702","skyMid":"#3a1f10","skyBottom":"#66432a","mt1":"#24150b","mt2":"#3c2415","grass":["#331e1b","#2b1816"],"fog":"#50311d","fogD":2.4,"sun":{"x":0.74,"y":95,"r":22,"color":"#ffebe8"},"stars":true,"skyline":true,"deco":[{"k":"lamp","w":7},{"k":"bldg","w":5},{"k":"bush","w":1}],"water":["#36110b","#42130e"],"snowfall":false},
    canyon2: {"skyTop":"#e0cd2c","skyMid":"#f0d37c","skyBottom":"#c4c6ff","mt1":"#3a67c0","mt2":"#2a5aa2","grass":["#6679d9","#596bcf"],"fog":"#a8aef2","fogD":2,"sun":{"x":0.3,"y":110,"r":28,"color":"#ccc4ff"},"stars":false,"skyline":false,"deco":[{"k":"cactus","w":5},{"k":"mesa","w":3},{"k":"rock","w":2},{"k":"bush","w":1}],"water":["#8f712c","#856a2a"],"snowfall":false,"surfColors":{"gravel":{"road":["#d8b27c","#cca66f"],"rumble":["#b98a52","#a97d48"]}}},
    lake2: {"skyTop":"#c87fbc","skyMid":"#e0b9dd","skyBottom":"#eeeef3","mt1":"#a66fa1","mt2":"#4f527a","grass":["#4a668f","#425e87"],"fog":"#e3dfe8","fogD":3,"sun":{"x":0.62,"y":60,"r":24,"color":"#e0fff1"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":4},{"k":"bush","w":2},{"k":"rock","w":1}],"water":["#9d3e9e","#913993"],"snowfall":false},
    alpine2: {"skyTop":"#7f1ed0","skyMid":"#aa6fee","skyBottom":"#f3eaff","mt1":"#dfd3ea","mt2":"#8b73a8","grass":["#529a80","#4b8f76"],"fog":"#e8dcf8","fogD":2.2,"sun":{"x":0.78,"y":120,"r":22,"color":"#ecffe8"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":5},{"k":"snowpine","w":2},{"k":"rock","w":3},{"k":"bush","w":1}],"water":["#744ab0","#6a43a3"],"snowfall":false},
    jungle2: {"skyTop":"#7fb03a","skyMid":"#cfa89c","skyBottom":"#f3c9e5","mt1":"#7d634b","mt2":"#5e482f","grass":["#7a352f","#712f2a"],"fog":"#e8c0cf","fogD":2.8,"sun":{"x":0.45,"y":80,"r":26,"color":"#f7c4ff"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"palm","w":3},{"k":"bush","w":3}],"water":["#5a3a6b","#523361"],"snowfall":false,"surfColors":{"gravel":{"road":["#8a6a46","#7e5f3e"],"rumble":["#5a4128","#4e3822"]}}},
    dusk2: {"skyTop":"#143a50","skyMid":"#a145d6","skyBottom":"#ff5aa8","mt1":"#224760","mt2":"#2c4270","grass":["#585a3c","#525236"],"fog":"#e08ae0","fogD":2.4,"sun":{"x":0.5,"y":25,"r":44,"color":"#ffa0c6"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":3},{"k":"bush","w":3},{"k":"rock","w":3}],"water":["#2e786a","#28685c"],"snowfall":false},
    neon2: {"skyTop":"#01040f","skyMid":"#0a0e52","skyBottom":"#421f8f","mt1":"#080d36","mt2":"#0f134d","grass":["#101630","#0c1128"],"fog":"#201a6e","fogD":2.4,"sun":{"x":0.35,"y":90,"r":26,"color":"#e37aff"},"stars":true,"skyline":true,"deco":[{"k":"lamp","w":7},{"k":"bldg","w":6},{"k":"bush","w":1}],"water":["#10293a","#0c2230"],"snowfall":false},
    autumn2: {"skyTop":"#b53f6f","skyMid":"#5ae3a3","skyBottom":"#b0ffe2","mt1":"#2aa855","mt2":"#1e7a3a","grass":["#1db565","#18a85a"],"fog":"#9cf0cf","fogD":2.6,"sun":{"x":0.7,"y":90,"r":26,"color":"#c0fff0"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"pine","w":2},{"k":"bush","w":2},{"k":"rock","w":1}],"water":["#8a4a6e","#804366"],"snowfall":false,"leaf":["#0fb547","#1cd970","#2ae8a0"],"bushC":["#1aa256","#24c47a"],"surfColors":{"gravel":{"road":["#a97a4a","#9c6f42"],"rumble":["#6e4a28","#60401f"]}}},
    dunes2: {"skyTop":"#e88f4a","skyMid":"#f5d2bf","skyBottom":"#c9d7ff","mt1":"#6a96e0","mt2":"#487cc9","grass":["#7aa1ec","#6c95e2"],"fog":"#aac4f6","fogD":2.2,"sun":{"x":0.55,"y":120,"r":30,"color":"#e0e4ff"},"stars":false,"skyline":false,"deco":[{"k":"cactus","w":4},{"k":"rock","w":3},{"k":"palm","w":2},{"k":"bush","w":1}],"water":["#b0502f","#a64a2a"],"snowfall":false,"bushC":["#453a9a","#524ab0"],"surfColors":{"gravel":{"road":["#d9b57a","#cfa96d"],"rumble":["#b58a4c","#a67d42"]}}},
    frost2: {"skyTop":"#021606","skyMid":"#0e4814","skyBottom":"#278a2f","mt1":"#1c5421","mt2":"#2c7332","grass":["#dff5e0","#d3f0d4"],"fog":"#256b2d","fogD":2.4,"sun":{"x":0.25,"y":110,"r":20,"color":"#cfffd2"},"stars":true,"skyline":false,"deco":[{"k":"snowpine","w":6},{"k":"pine","w":2},{"k":"rock","w":2}],"water":["#0f4a12","#0c400f"],"snowfall":true},
    volcano2: {"skyTop":"#1a1306","skyMid":"#6a5610","skyBottom":"#d4cd1f","mt1":"#2a230c","mt2":"#4a4110","grass":["#2b2920","#24231a"],"fog":"#7a6b18","fogD":2.2,"sun":{"x":0.4,"y":70,"r":34,"color":"#e2ff3c"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":6},{"k":"mesa","w":2},{"k":"bush","w":1}],"water":["#c2ba0c","#a89f0a"],"snowfall":false,"bushC":["#4a4522","#5e582b"],"surfColors":{"gravel":{"road":["#6b5a52","#5f4f48"],"rumble":["#3a2e2a","#322824"]}}},
    sakura2: {"skyTop":"#e8e86a","skyMid":"#cff4f7","skyBottom":"#f3fcff","mt1":"#8ac7c9","mt2":"#6a9a92","grass":["#ae5a99","#a55390"],"fog":"#dff4f6","fogD":2.8,"sun":{"x":0.35,"y":90,"r":26,"color":"#e3d8ff"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"pine","w":1},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#b8b25a","#ada853"],"snowfall":false,"leaf":["#8fdbe5","#a9e8f2","#c6f1f7"],"bushC":["#72cdd9","#93e2ee"]},
    savanna2: {"skyTop":"#d02fc8","skyMid":"#60f068","skyBottom":"#a0ffb1","mt1":"#3ab940","mt2":"#2a8f2d","grass":["#48c964","#40bf5c"],"fog":"#9af2a8","fogD":2.2,"sun":{"x":0.6,"y":60,"r":36,"color":"#b0ffc9"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":2},{"k":"bush","w":4},{"k":"rock","w":3},{"k":"cactus","w":1}],"water":["#3a7a4a","#326f42"],"snowfall":false,"bushC":["#2a8a5a","#3aa36e"],"surfColors":{"gravel":{"road":["#c7a064","#bb9558"],"rumble":["#8a6a3a","#7c5e32"]}}},
    swamp2: {"skyTop":"#345236","skyMid":"#919a7a","skyBottom":"#d6cdb0","mt1":"#415a3a","mt2":"#2f462a","grass":["#5a582f","#525028"],"fog":"#bdbc9c","fogD":3.2,"sun":{"x":0.5,"y":130,"r":22,"color":"#f0d8c0"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":5},{"k":"palm","w":2},{"k":"bush","w":4},{"k":"rock","w":1}],"water":["#4a452a","#42412a"],"snowfall":false,"leaf":["#4f5a2a","#616a30","#757a3a"],"bushC":["#54592b","#68703a"]},
    dawn2: {"skyTop":"#9a653a","skyMid":"#8ae5b1","skyBottom":"#a0e6ff","mt1":"#8a8a5a","mt2":"#726b46","grass":["#6a4a9a","#62438f"],"fog":"#a6edf2","fogD":2.6,"sun":{"x":0.3,"y":120,"r":34,"color":"#c4e5ff"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":4},{"k":"pine","w":3},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#b8826a","#ad775f"],"snowfall":false,"leaf":["#5a3a8a","#634aa0","#695ab8"],"bushC":["#4e357a","#584091"]},
    mist2: {"skyTop":"#8fa07f","skyMid":"#c1c8b4","skyBottom":"#ebece2","mt1":"#a09e87","mt2":"#87846c","grass":["#7a594f","#705047"],"fog":"#dcdbcf","fogD":3.6,"sun":{"x":0.6,"y":140,"r":24,"color":"#f8f0f3"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":5},{"k":"broadleaf","w":3},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#84906f","#7c8866"],"snowfall":false,"leaf":["#6a4d3f","#7e5d4f","#927262"],"bushC":["#6e5143","#826154"],"surfColors":{"gravel":{"road":["#9a9486","#8e887b"],"rumble":["#6a665c","#5e5a51"]}}},
    redrock2: {"skyTop":"#3c2fa8","skyMid":"#e0d34a","skyBottom":"#f3ff8a","mt1":"#b08a2a","mt2":"#8a691c","grass":["#c0a73a","#b49b32"],"fog":"#efe682","fogD":2.3,"sun":{"x":0.65,"y":110,"r":32,"color":"#efffc0"},"stars":false,"skyline":false,"deco":[{"k":"mesa","w":4},{"k":"cactus","w":3},{"k":"rock","w":4},{"k":"bush","w":1}],"water":["#3a4a9a","#334290"],"snowfall":false,"bushC":["#7a8a2a","#8ea034"],"surfColors":{"gravel":{"road":["#c98a5a","#bd7e50"],"rumble":["#8a4a2a","#7c4022"]}}},
    tundra2: {"skyTop":"#567a5c","skyMid":"#8fb093","skyBottom":"#cfe0d0","mt1":"#7c9c80","mt2":"#628a6b","grass":["#9a7e7c","#8f7573"],"fog":"#bcd2bf","fogD":2.8,"sun":{"x":0.45,"y":135,"r":22,"color":"#f0f8f1"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":3},{"k":"snowpine","w":3},{"k":"rock","w":4},{"k":"bush","w":2}],"water":["#4a784f","#427047"],"snowfall":true,"bushC":["#846968","#947676"]},
    moon2: {"skyTop":"#1a0403","skyMid":"#4a0f15","skyBottom":"#8a2431","mt1":"#300d12","mt2":"#4a161c","grass":["#3a1d35","#32182e"],"fog":"#661c29","fogD":2.5,"sun":{"x":0.68,"y":80,"r":30,"color":"#ffe8ec"},"stars":true,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"lamp","w":3},{"k":"rock","w":3},{"k":"bush","w":2}],"water":["#3a0a12","#32080f"],"snowfall":false,"bushC":["#401f3a","#502849"]},
    coast2: {"skyTop":"#e09d2f","skyMid":"#f0bd8c","skyBottom":"#fff4ea","mt1":"#b8825a","mt2":"#a5744a","grass":["#8c94dc","#8089d1"],"fog":"#f5e0cf","fogD":2.2,"sun":{"x":0.52,"y":110,"r":30,"color":"#e1e0ff"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":5},{"k":"rock","w":2},{"k":"bush","w":2}],"water":["#b06f1f","#a66a1b"],"snowfall":false,"bushC":["#874a9a","#9558ae"],"surfColors":{"gravel":{"road":["#cdb98a","#c2ae7f"],"rumble":["#9a875a","#8c7a4f"]}}},
    vineyard2: {"skyTop":"#b94ac0","skyMid":"#85f070","skyBottom":"#b1ffb0","mt1":"#8a756a","mt2":"#705550","grass":["#3a9a7a","#338f73"],"fog":"#abf4a8","fogD":2.5,"sun":{"x":0.72,"y":105,"r":30,"color":"#c0ffc8"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":6},{"k":"broadleaf","w":3},{"k":"rock","w":1},{"k":"pine","w":1}],"water":["#8f5a9a","#85528f"],"snowfall":false,"leaf":["#2a8a6a","#3aa67a","#38b058"],"bushC":["#287a63","#339073"]},
    bamboo2: {"skyTop":"#6a9a7a","skyMid":"#b7d8b6","skyBottom":"#eff4e0","mt1":"#5a8a60","mt2":"#487a4f","grass":["#528a3f","#468037"],"fog":"#d4e6cf","fogD":3,"sun":{"x":0.4,"y":120,"r":24,"color":"#fff1e0"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":3},{"k":"bush","w":4},{"k":"rock","w":1}],"water":["#3a7a55","#336f4c"],"snowfall":false,"leaf":["#578a3a","#77a84a","#9dc860"],"bushC":["#528a3f","#69a052"]},
    salt2: {"skyTop":"#cfe06a","skyMid":"#f3f5cf","skyBottom":"#fdfdfd","mt1":"#b8c8c3","mt2":"#a0b8a8","grass":["#e8ebf0","#dee1e6"],"fog":"#eef4f2","fogD":2,"sun":{"x":0.6,"y":100,"r":32,"color":"#ffffff"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":4},{"k":"bush","w":1},{"k":"cactus","w":1}],"water":["#9ac2e8","#8db7df"],"snowfall":false,"bushC":["#908aa8","#a09ab8"],"surfColors":{"gravel":{"road":["#d8cfcf","#cdc4c4"],"rumble":["#a89a9a","#9a8c8c"]}}},
    prairie2: {"skyTop":"#d84aa8","skyMid":"#f0a8dc","skyBottom":"#c8f8e8","mt1":"#7092a0","mt2":"#5a788a","grass":["#4ac8a3","#42bc98"],"fog":"#b8ecdd","fogD":2.3,"sun":{"x":0.5,"y":115,"r":28,"color":"#e0fff6"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":5},{"k":"rock","w":2},{"k":"broadleaf","w":1},{"k":"mesa","w":1}],"water":["#a84a9a","#9e428f"],"snowfall":false,"bushC":["#38a085","#44b697"],"surfColors":{"gravel":{"road":["#c4a874","#b89c68"],"rumble":["#8a7442","#7c6838"]}}},
    aurora2: {"skyTop":"#021020","skyMid":"#0a495a","skyBottom":"#2a959a","mt1":"#0a1b38","mt2":"#12254a","grass":["#e0e5f4","#d4d9ee"],"fog":"#1a455a","fogD":2.4,"sun":{"x":0.5,"y":90,"r":18,"color":"#d8fffd"},"stars":true,"skyline":false,"deco":[{"k":"snowpine","w":6},{"k":"pine","w":2},{"k":"rock","w":2}],"water":["#0c254a","#0a1e40"],"snowfall":true},
    storm2: {"skyTop":"#2a3c31","skyMid":"#4a6454","skyBottom":"#7a9683","mt1":"#3a5444","mt2":"#2e4838","grass":["#5a553a","#524c32"],"fog":"#5a7464","fogD":3,"sun":{"x":0.5,"y":150,"r":18,"color":"#aac0b2"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":3},{"k":"bush","w":2},{"k":"rock","w":2}],"water":["#2a5034","#24482e"],"snowfall":false,"leaf":["#5a4d2a","#6a5630","#7a5f3a"],"bushC":["#4a422c","#5a4f35"]},
    heath2: {"skyTop":"#a8855a","skyMid":"#b4c8b0","skyBottom":"#d8f0f0","mt1":"#7f8a6a","mt2":"#6b7454","grass":["#728a5a","#6a8050"],"fog":"#cce2d4","fogD":2.6,"sun":{"x":0.35,"y":118,"r":26,"color":"#e0f4ff"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":5},{"k":"rock","w":3},{"k":"pine","w":1}],"water":["#9a926a","#928a60"],"snowfall":false,"bushC":["#759a5a","#8bb070"],"surfColors":{"gravel":{"road":["#a08a8a","#947e7e"],"rumble":["#6a5a6a","#5e4e5e"]}}},
    ember2: {"skyTop":"#110c1a","skyMid":"#41126a","skyBottom":"#ba3ae8","mt1":"#1e122a","mt2":"#29143a","grass":["#31263a","#291f32"],"fog":"#5f1c8a","fogD":2.4,"sun":{"x":0.45,"y":112,"r":34,"color":"#e560ff"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":5},{"k":"bush","w":2},{"k":"cactus","w":1}],"water":["#7e1ac8","#7116b5"],"snowfall":false,"bushC":["#391e4a","#47225a"],"surfColors":{"gravel":{"road":["#5a4640","#4e3c36"],"rumble":["#2e201c","#261a16"]}}},
    orchid2: {"skyTop":"#9a4a77","skyMid":"#e8b4a0","skyBottom":"#fff1e4","mt1":"#9a5a75","mt2":"#824462","grass":["#4a858a","#3f787e"],"fog":"#f2d7c8","fogD":2.8,"sun":{"x":0.62,"y":115,"r":26,"color":"#fff7f2"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":5},{"k":"bush","w":4},{"k":"palm","w":2},{"k":"rock","w":1}],"water":["#b05a8e","#a45084"],"snowfall":false,"leaf":["#c8705a","#e8907a","#f4b2a0"],"bushC":["#b04f4a","#cc6d66"]},
    glacier2: {"skyTop":"#3ad099","skyMid":"#a8f0c8","skyBottom":"#f0fff7","mt1":"#a8e0c1","mt2":"#8ad2ac","grass":["#e4f8ed","#d6f2e5"],"fog":"#d8f8e5","fogD":2.1,"sun":{"x":0.3,"y":100,"r":28,"color":"#ffffff"},"stars":false,"skyline":false,"deco":[{"k":"snowpine","w":4},{"k":"rock","w":3}],"water":["#2ac063","#24b45c"],"snowfall":false,"bushC":["#9ac8b2","#aad4bf"]},
    oasis2: {"skyTop":"#d82a40","skyMid":"#ee8ea8","skyBottom":"#d0faff","mt1":"#70d8d3","mt2":"#56c4bf","grass":["#88e1e6","#7ad7dc"],"fog":"#b4f2f6","fogD":2.3,"sun":{"x":0.5,"y":96,"r":32,"color":"#e0f9ff"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":5},{"k":"cactus","w":2},{"k":"rock","w":2},{"k":"bush","w":2}],"water":["#b02080","#a61a75"],"snowfall":false,"bushC":["#3a4a9a","#4a60b0"],"surfColors":{"gravel":{"road":["#d4b880","#c8ac74"],"rumble":["#a88a50","#9a7c46"]}}},
    amethyst2: {"skyTop":"#062006","skyMid":"#1a6a2d","skyBottom":"#4ac076","mt1":"#145020","mt2":"#1c6a2d","grass":["#2a5a32","#244e2b"],"fog":"#2e8a4b","fogD":2.5,"sun":{"x":0.7,"y":90,"r":30,"color":"#d0ffe0"},"stars":true,"skyline":false,"deco":[{"k":"rock","w":5},{"k":"bush","w":2},{"k":"pine","w":1}],"water":["#2a9a47","#24903e"],"snowfall":false,"bushC":["#3a8a4d","#4aa060"]},
    harbor3: {"skyTop":"#020f07","skyMid":"#103a1f","skyBottom":"#2a6643","mt1":"#0b2416","mt2":"#153c24","grass":["#1b331e","#162b18"],"fog":"#1d5031","fogD":2.4,"sun":{"x":0.74,"y":95,"r":22,"color":"#e8ffeb"},"stars":true,"skyline":true,"deco":[{"k":"lamp","w":7},{"k":"bldg","w":5},{"k":"bush","w":1}],"water":["#0b3611","#0e4213"],"snowfall":false},
    canyon3: {"skyTop":"#2ce0cd","skyMid":"#7cf0d3","skyBottom":"#ffc4c6","mt1":"#c03a67","mt2":"#a22a5a","grass":["#d96679","#cf596b"],"fog":"#f2a8ae","fogD":2,"sun":{"x":0.3,"y":110,"r":28,"color":"#ffccc4"},"stars":false,"skyline":false,"deco":[{"k":"cactus","w":5},{"k":"mesa","w":3},{"k":"rock","w":2},{"k":"bush","w":1}],"water":["#2c8f71","#2a856a"],"snowfall":false,"surfColors":{"gravel":{"road":["#d8b27c","#cca66f"],"rumble":["#b98a52","#a97d48"]}}},
    lake3: {"skyTop":"#bcc87f","skyMid":"#dde0b9","skyBottom":"#f3eeee","mt1":"#a1a66f","mt2":"#7a4f52","grass":["#8f4a66","#87425e"],"fog":"#e8e3df","fogD":3,"sun":{"x":0.62,"y":60,"r":24,"color":"#f1e0ff"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":4},{"k":"bush","w":2},{"k":"rock","w":1}],"water":["#9e9d3e","#939139"],"snowfall":false},
    alpine3: {"skyTop":"#d07f1e","skyMid":"#eeaa6f","skyBottom":"#fff3ea","mt1":"#eadfd3","mt2":"#a88b73","grass":["#80529a","#764b8f"],"fog":"#f8e8dc","fogD":2.2,"sun":{"x":0.78,"y":120,"r":22,"color":"#e8ecff"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":5},{"k":"snowpine","w":2},{"k":"rock","w":3},{"k":"bush","w":1}],"water":["#b0744a","#a36a43"],"snowfall":false},
    jungle3: {"skyTop":"#3a7fb0","skyMid":"#9ccfa8","skyBottom":"#e5f3c9","mt1":"#4b7d63","mt2":"#2f5e48","grass":["#2f7a35","#2a712f"],"fog":"#cfe8c0","fogD":2.8,"sun":{"x":0.45,"y":80,"r":26,"color":"#fff7c4"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"palm","w":3},{"k":"bush","w":3}],"water":["#6b5a3a","#615233"],"snowfall":false,"surfColors":{"gravel":{"road":["#8a6a46","#7e5f3e"],"rumble":["#5a4128","#4e3822"]}}},
    dusk3: {"skyTop":"#50143a","skyMid":"#d6a145","skyBottom":"#a8ff5a","mt1":"#602247","mt2":"#702c42","grass":["#3c585a","#365252"],"fog":"#e0e08a","fogD":2.4,"sun":{"x":0.5,"y":25,"r":44,"color":"#c6ffa0"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":3},{"k":"bush","w":3},{"k":"rock","w":3}],"water":["#6a2e78","#5c2868"],"snowfall":false},
    neon3: {"skyTop":"#0f0104","skyMid":"#520a0e","skyBottom":"#8f421f","mt1":"#36080d","mt2":"#4d0f13","grass":["#301016","#280c11"],"fog":"#6e201a","fogD":2.4,"sun":{"x":0.35,"y":90,"r":26,"color":"#ffe27a"},"stars":true,"skyline":true,"deco":[{"k":"lamp","w":7},{"k":"bldg","w":6},{"k":"bush","w":1}],"water":["#3a1029","#300c22"],"snowfall":false},
    autumn3: {"skyTop":"#6fb53f","skyMid":"#a35ae3","skyBottom":"#e2b0ff","mt1":"#552aa8","mt2":"#3a1e7a","grass":["#651db5","#5a18a8"],"fog":"#cf9cf0","fogD":2.6,"sun":{"x":0.7,"y":90,"r":26,"color":"#f0c0ff"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"pine","w":2},{"k":"bush","w":2},{"k":"rock","w":1}],"water":["#6e8a4a","#668043"],"snowfall":false,"leaf":["#470fb5","#701cd9","#a02ae8"],"bushC":["#561aa2","#7a24c4"],"surfColors":{"gravel":{"road":["#a97a4a","#9c6f42"],"rumble":["#6e4a28","#60401f"]}}},
    dunes3: {"skyTop":"#4ae88f","skyMid":"#bff5d2","skyBottom":"#ffc9d7","mt1":"#e06a96","mt2":"#c9487c","grass":["#ec7aa1","#e26c95"],"fog":"#f6aac4","fogD":2.2,"sun":{"x":0.55,"y":120,"r":30,"color":"#ffe0e4"},"stars":false,"skyline":false,"deco":[{"k":"cactus","w":4},{"k":"rock","w":3},{"k":"palm","w":2},{"k":"bush","w":1}],"water":["#2fb050","#2aa64a"],"snowfall":false,"bushC":["#9a453a","#b0524a"],"surfColors":{"gravel":{"road":["#d9b57a","#cfa96d"],"rumble":["#b58a4c","#a67d42"]}}},
    frost3: {"skyTop":"#060216","skyMid":"#140e48","skyBottom":"#2f278a","mt1":"#211c54","mt2":"#322c73","grass":["#e0dff5","#d4d3f0"],"fog":"#2d256b","fogD":2.4,"sun":{"x":0.25,"y":110,"r":20,"color":"#d2cfff"},"stars":true,"skyline":false,"deco":[{"k":"snowpine","w":6},{"k":"pine","w":2},{"k":"rock","w":2}],"water":["#120f4a","#0f0c40"],"snowfall":true},
    volcano3: {"skyTop":"#061a13","skyMid":"#106a56","skyBottom":"#1fd4cd","mt1":"#0c2a23","mt2":"#104a41","grass":["#202b29","#1a2423"],"fog":"#187a6b","fogD":2.2,"sun":{"x":0.4,"y":70,"r":34,"color":"#3ce2ff"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":6},{"k":"mesa","w":2},{"k":"bush","w":1}],"water":["#0cc2ba","#0aa89f"],"snowfall":false,"bushC":["#224a45","#2b5e58"],"surfColors":{"gravel":{"road":["#6b5a52","#5f4f48"],"rumble":["#3a2e2a","#322824"]}}},
    sakura3: {"skyTop":"#6ae8e8","skyMid":"#f7cff4","skyBottom":"#fff3fc","mt1":"#c98ac8","mt2":"#926a9a","grass":["#99ae5a","#90a553"],"fog":"#f6dff4","fogD":2.8,"sun":{"x":0.35,"y":90,"r":26,"color":"#ffe3d8"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":6},{"k":"pine","w":1},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#5ab8b2","#53ada8"],"snowfall":false,"leaf":["#e58fdb","#f2a9e8","#f7c6f1"],"bushC":["#d972cd","#ee93e2"]},
    savanna3: {"skyTop":"#c9d02f","skyMid":"#6860f0","skyBottom":"#b1a0ff","mt1":"#403ab9","mt2":"#2d2a8f","grass":["#6448c9","#5b40bf"],"fog":"#a89af2","fogD":2.2,"sun":{"x":0.6,"y":60,"r":36,"color":"#c9b0ff"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":2},{"k":"bush","w":4},{"k":"rock","w":3},{"k":"cactus","w":1}],"water":["#4a3a7a","#42326f"],"snowfall":false,"bushC":["#5a2a8a","#6e3aa3"],"surfColors":{"gravel":{"road":["#c7a064","#bb9558"],"rumble":["#8a6a3a","#7c5e32"]}}},
    swamp3: {"skyTop":"#363452","skyMid":"#7a919a","skyBottom":"#b0d6cd","mt1":"#3a415a","mt2":"#2a2f46","grass":["#2f5a58","#285250"],"fog":"#9cbdbc","fogD":3.2,"sun":{"x":0.5,"y":130,"r":22,"color":"#c0f0d8"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":5},{"k":"palm","w":2},{"k":"bush","w":4},{"k":"rock","w":1}],"water":["#2a4a45","#2a4241"],"snowfall":false,"leaf":["#2a4f5a","#30616a","#3a757a"],"bushC":["#2b5459","#3a6870"]},
    dawn3: {"skyTop":"#3a9a65","skyMid":"#b18ae5","skyBottom":"#ffa0e6","mt1":"#5a8a8a","mt2":"#46726b","grass":["#9a6a4a","#8f6243"],"fog":"#f2a6ed","fogD":2.6,"sun":{"x":0.3,"y":120,"r":34,"color":"#ffc4e5"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":4},{"k":"pine","w":3},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#6ab882","#5fad77"],"snowfall":false,"leaf":["#8a5a3a","#a0634a","#b8695a"],"bushC":["#7a4e35","#915840"]},
    mist3: {"skyTop":"#7f8fa0","skyMid":"#b4c1c8","skyBottom":"#e2ebec","mt1":"#87a09e","mt2":"#6c8784","grass":["#4f7a59","#477050"],"fog":"#cfdcdb","fogD":3.6,"sun":{"x":0.6,"y":140,"r":24,"color":"#f3f8f0"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":5},{"k":"broadleaf","w":3},{"k":"bush","w":3},{"k":"rock","w":1}],"water":["#6f8490","#667c88"],"snowfall":false,"leaf":["#3f6a4d","#4f7e5d","#629272"],"bushC":["#436e51","#548261"],"surfColors":{"gravel":{"road":["#9a9486","#8e887b"],"rumble":["#6a665c","#5e5a51"]}}},
    redrock3: {"skyTop":"#a83c2f","skyMid":"#4ae0d3","skyBottom":"#8af3ff","mt1":"#2ab08a","mt2":"#1c8a69","grass":["#3ac0a7","#32b49b"],"fog":"#82efe6","fogD":2.3,"sun":{"x":0.65,"y":110,"r":32,"color":"#c0eeff"},"stars":false,"skyline":false,"deco":[{"k":"mesa","w":4},{"k":"cactus","w":3},{"k":"rock","w":4},{"k":"bush","w":1}],"water":["#9a3a4a","#903342"],"snowfall":false,"bushC":["#2a7a8a","#348ea0"],"surfColors":{"gravel":{"road":["#c98a5a","#bd7e50"],"rumble":["#8a4a2a","#7c4022"]}}},
    tundra3: {"skyTop":"#5c567a","skyMid":"#938fb0","skyBottom":"#d0cfe0","mt1":"#807c9c","mt2":"#6b628a","grass":["#7c9a7e","#738f75"],"fog":"#bfbcd2","fogD":2.8,"sun":{"x":0.45,"y":135,"r":22,"color":"#f1f0f8"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":3},{"k":"snowpine","w":3},{"k":"rock","w":4},{"k":"bush","w":2}],"water":["#4f4a78","#474270"],"snowfall":true,"bushC":["#688469","#769476"]},
    moon3: {"skyTop":"#031a04","skyMid":"#154a0f","skyBottom":"#318a24","mt1":"#12300d","mt2":"#1c4a16","grass":["#353a1d","#2e3218"],"fog":"#29661c","fogD":2.5,"sun":{"x":0.68,"y":80,"r":30,"color":"#ecffe8"},"stars":true,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"lamp","w":3},{"k":"rock","w":3},{"k":"bush","w":2}],"water":["#123a0a","#0f3208"],"snowfall":false,"bushC":["#3b401f","#495028"]},
    coast3: {"skyTop":"#2fe09d","skyMid":"#8cf0bd","skyBottom":"#eafff4","mt1":"#5ab882","mt2":"#4aa574","grass":["#dc8c94","#d18089"],"fog":"#cff5e0","fogD":2.2,"sun":{"x":0.52,"y":110,"r":30,"color":"#ffe1e0"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":5},{"k":"rock","w":2},{"k":"bush","w":2}],"water":["#1fb06f","#1ba66a"],"snowfall":false,"bushC":["#9a874a","#ae9558"],"surfColors":{"gravel":{"road":["#cdb98a","#c2ae7f"],"rumble":["#9a875a","#8c7a4f"]}}},
    vineyard3: {"skyTop":"#c0b94a","skyMid":"#7085f0","skyBottom":"#b0b1ff","mt1":"#6a8a75","mt2":"#507055","grass":["#7a3a9a","#73338f"],"fog":"#a8abf4","fogD":2.5,"sun":{"x":0.72,"y":105,"r":30,"color":"#c8c0ff"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":6},{"k":"broadleaf","w":3},{"k":"rock","w":1},{"k":"pine","w":1}],"water":["#9a8f5a","#8f8552"],"snowfall":false,"leaf":["#6a2a8a","#7a3aa6","#5838b0"],"bushC":["#63287a","#733390"]},
    bamboo3: {"skyTop":"#7a6a9a","skyMid":"#b6b7d8","skyBottom":"#e0eff4","mt1":"#605a8a","mt2":"#4f487a","grass":["#3f528a","#374680"],"fog":"#cfd4e6","fogD":3,"sun":{"x":0.4,"y":120,"r":24,"color":"#e0fff1"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":3},{"k":"bush","w":4},{"k":"rock","w":1}],"water":["#553a7a","#4c336f"],"snowfall":false,"leaf":["#3a578a","#4a77a8","#609dc8"],"bushC":["#3f528a","#5269a0"]},
    salt3: {"skyTop":"#6acfe0","skyMid":"#cff3f5","skyBottom":"#fdfdfd","mt1":"#c3b8c8","mt2":"#a8a0b8","grass":["#f0e8eb","#e6dee1"],"fog":"#f2eef4","fogD":2,"sun":{"x":0.6,"y":100,"r":32,"color":"#ffffff"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":4},{"k":"bush","w":1},{"k":"cactus","w":1}],"water":["#e89ac2","#df8db7"],"snowfall":false,"bushC":["#a8908a","#b8a09a"],"surfColors":{"gravel":{"road":["#d8cfcf","#cdc4c4"],"rumble":["#a89a9a","#9a8c8c"]}}},
    prairie3: {"skyTop":"#a8d84a","skyMid":"#dcf0a8","skyBottom":"#e8c8f8","mt1":"#a07092","mt2":"#8a5a78","grass":["#a34ac8","#9842bc"],"fog":"#ddb8ec","fogD":2.3,"sun":{"x":0.5,"y":115,"r":28,"color":"#f6e0ff"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":5},{"k":"rock","w":2},{"k":"broadleaf","w":1},{"k":"mesa","w":1}],"water":["#9aa84a","#8f9e42"],"snowfall":false,"bushC":["#8538a0","#9744b6"],"surfColors":{"gravel":{"road":["#c4a874","#b89c68"],"rumble":["#8a7442","#7c6838"]}}},
    aurora3: {"skyTop":"#200210","skyMid":"#5a0a49","skyBottom":"#9a2a95","mt1":"#380a1b","mt2":"#4a1225","grass":["#f4e0e5","#eed4d9"],"fog":"#5a1a45","fogD":2.4,"sun":{"x":0.5,"y":90,"r":18,"color":"#fdd8ff"},"stars":true,"skyline":false,"deco":[{"k":"snowpine","w":6},{"k":"pine","w":2},{"k":"rock","w":2}],"water":["#4a0c25","#400a1e"],"snowfall":true},
    storm3: {"skyTop":"#312a3c","skyMid":"#544a64","skyBottom":"#837a96","mt1":"#443a54","mt2":"#382e48","grass":["#3a5a55","#32524c"],"fog":"#645a74","fogD":3,"sun":{"x":0.5,"y":150,"r":18,"color":"#b2aac0"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":3},{"k":"bush","w":2},{"k":"rock","w":2}],"water":["#342a50","#2e2448"],"snowfall":false,"leaf":["#2a5a4d","#306a56","#3a7a5f"],"bushC":["#2c4a42","#355a4f"]},
    heath3: {"skyTop":"#5aa885","skyMid":"#b0b4c8","skyBottom":"#f0d8f0","mt1":"#6a7f8a","mt2":"#546b74","grass":["#5a728a","#506a80"],"fog":"#d4cce2","fogD":2.6,"sun":{"x":0.35,"y":118,"r":26,"color":"#ffe0f4"},"stars":false,"skyline":false,"deco":[{"k":"bush","w":5},{"k":"rock","w":3},{"k":"pine","w":1}],"water":["#6a9a92","#60928a"],"snowfall":false,"bushC":["#5a759a","#708bb0"],"surfColors":{"gravel":{"road":["#a08a8a","#947e7e"],"rumble":["#6a5a6a","#5e4e5e"]}}},
    ember3: {"skyTop":"#1a110c","skyMid":"#6a4112","skyBottom":"#e8ba3a","mt1":"#2a1e12","mt2":"#3a2914","grass":["#3a3126","#32291f"],"fog":"#8a5f1c","fogD":2.4,"sun":{"x":0.45,"y":112,"r":34,"color":"#ffe560"},"stars":false,"skyline":false,"deco":[{"k":"rock","w":5},{"k":"bush","w":2},{"k":"cactus","w":1}],"water":["#c87e1a","#b57116"],"snowfall":false,"bushC":["#4a391e","#5a4722"],"surfColors":{"gravel":{"road":["#5a4640","#4e3c36"],"rumble":["#2e201c","#261a16"]}}},
    orchid3: {"skyTop":"#779a4a","skyMid":"#a0e8b4","skyBottom":"#e4fff1","mt1":"#759a5a","mt2":"#628244","grass":["#8a4a85","#7e3f78"],"fog":"#c8f2d7","fogD":2.8,"sun":{"x":0.62,"y":115,"r":26,"color":"#f2fff7"},"stars":false,"skyline":false,"deco":[{"k":"broadleaf","w":5},{"k":"bush","w":4},{"k":"palm","w":2},{"k":"rock","w":1}],"water":["#8eb05a","#84a450"],"snowfall":false,"leaf":["#5ac870","#7ae890","#a0f4b2"],"bushC":["#4ab04f","#66cc6d"]},
    glacier3: {"skyTop":"#993ad0","skyMid":"#c8a8f0","skyBottom":"#f7f0ff","mt1":"#c1a8e0","mt2":"#ac8ad2","grass":["#ede4f8","#e5d6f2"],"fog":"#e5d8f8","fogD":2.1,"sun":{"x":0.3,"y":100,"r":28,"color":"#ffffff"},"stars":false,"skyline":false,"deco":[{"k":"snowpine","w":4},{"k":"rock","w":3}],"water":["#632ac0","#5c24b4"],"snowfall":false,"bushC":["#b29ac8","#bfaad4"]},
    oasis3: {"skyTop":"#40d82a","skyMid":"#a8ee8e","skyBottom":"#ffd0fa","mt1":"#d370d8","mt2":"#bf56c4","grass":["#e688e1","#dc7ad7"],"fog":"#f6b4f2","fogD":2.3,"sun":{"x":0.5,"y":96,"r":32,"color":"#ffe0f9"},"stars":false,"skyline":false,"deco":[{"k":"palm","w":5},{"k":"cactus","w":2},{"k":"rock","w":2},{"k":"bush","w":2}],"water":["#80b020","#75a61a"],"snowfall":false,"bushC":["#9a3a4a","#b04a60"],"surfColors":{"gravel":{"road":["#d4b880","#c8ac74"],"rumble":["#a88a50","#9a7c46"]}}},
    amethyst3: {"skyTop":"#060620","skyMid":"#2d1a6a","skyBottom":"#764ac0","mt1":"#201450","mt2":"#2d1c6a","grass":["#322a5a","#2b244e"],"fog":"#4b2e8a","fogD":2.5,"sun":{"x":0.7,"y":90,"r":30,"color":"#e0d0ff"},"stars":true,"skyline":false,"deco":[{"k":"rock","w":5},{"k":"bush","w":2},{"k":"pine","w":1}],"water":["#472a9a","#3e2490"],"snowfall":false,"bushC":["#4d3a8a","#604aa0"]},
    harbor4: {"skyTop":"#07020f","skyMid":"#1f103a","skyBottom":"#432a66","mt1":"#160b24","mt2":"#24153c","grass":["#1e1b33","#18162b"],"fog":"#311d50","fogD":2.4,"sun":{"x":0.74,"y":95,"r":22,"color":"#ece8ff"},"stars":true,"skyline":true,"deco":[{"k":"lamp","w":7},{"k":"bldg","w":5},{"k":"bush","w":1}],"water":["#110b36","#130e42"],"snowfall":false},
    canyon4: {"skyTop":"#cd2ce0","skyMid":"#d37cf0","skyBottom":"#c6ffc4","mt1":"#67c03a","mt2":"#5aa22a","grass":["#79d966","#6bcf59"],"fog":"#aef2a8","fogD":2,"sun":{"x":0.3,"y":110,"r":28,"color":"#c4ffcc"},"stars":false,"skyline":false,"deco":[{"k":"cactus","w":5},{"k":"mesa","w":3},{"k":"rock","w":2},{"k":"bush","w":1}],"water":["#712c8f","#6a2a85"],"snowfall":false,"surfColors":{"gravel":{"road":["#d8b27c","#cca66f"],"rumble":["#b98a52","#a97d48"]}}},
    lake4: {"skyTop":"#7fbcc8","skyMid":"#b9dde0","skyBottom":"#eef3ee","mt1":"#6fa1a6","mt2":"#527a4f","grass":["#668f4a","#5e8742"],"fog":"#dfe8e3","fogD":3,"sun":{"x":0.62,"y":60,"r":24,"color":"#fff1e0"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":4},{"k":"broadleaf","w":4},{"k":"bush","w":2},{"k":"rock","w":1}],"water":["#3e9e9d","#399391"],"snowfall":false},
    alpine4: {"skyTop":"#1ed07f","skyMid":"#6feeaa","skyBottom":"#eafff3","mt1":"#d3eadf","mt2":"#73a88b","grass":["#9a8052","#8f764b"],"fog":"#dcf8e8","fogD":2.2,"sun":{"x":0.78,"y":120,"r":22,"color":"#ffe8ec"},"stars":false,"skyline":false,"deco":[{"k":"pine","w":5},{"k":"snowpine","w":2},{"k":"rock","w":3},{"k":"bush","w":1}],"water":["#4ab074","#43a36a"],"snowfall":false}
};


// Dificultad (todos los valores son fracciones de la velocidad ideal de la etapa):
//  - rival: rango de ritmo de los 4 rivales de IA (siempre hay uno más rápido y uno más lento dentro del rango).
//  - allow: ritmo mínimo que alcanza para llegar a cada checkpoint (tiempo que suma cada uno).
// Las medallas NO dependen de estos números: se dan por posición de llegada (P1 oro, P2 plata, P3 bronce).
// NOTA: calibrado con simulación, no con jugadores reales: es lo primero a retocar.
const DIFFS = [
    { name: 'Fácil',   allow: 0.42, rival: [0.56, 0.68] },
    { name: 'Media',   allow: 0.50, rival: [0.68, 0.80] },
    { name: 'Difícil', allow: 0.58, rival: [0.78, 0.90] }
];
const MEDALS = ['ORO', 'PLATA', 'BRONCE'];
function medalForRank(rank) { return MEDALS[rank - 1] || 'SIN MEDALLA'; }


// ---------------------------------------------------------------------------
// LAS 6 PRUEBAS (orden del campeonato): 3 circuitos cerrados y 3 etapas punto a punto
// Circuito: pts = puntos de control del trazado (la pista sale de esa forma), hill = altura por fracción de vuelta
//           (en múltiplos de SEG_LEN), surfaces/tunnels/bridges = rangos como fracción de vuelta.
// Etapa:    sección = [entrada, tramo, salida, curva, desnivel, superficie?, rasgo?]  rasgo: 'T' túnel, 'B' puente
// ---------------------------------------------------------------------------
// @@EVENTS_BEGIN
const EVENTS = [
    // ===================== CIRCUITOS (0-99) =====================
    {
        kind: 'circuit', name: "Gran Premio Roca Verde", short: "Roca Verde", theme: 'harbor', seed: 6101750, laps: 3, N: 2174, surface: 'asphalt',
        pts: [[60,268],[60,439],[97,476],[127,476],[164,513],[164,543],[201,580],[231,580],[268,543],[268,513],[305,476],[335,476],[372,439],[372,305],[409,268],[439,268],[476,231],[476,201],[439,164],[409,164],[372,127],[372,97],[335,60],[305,60],[268,97],[268,127],[231,164],[201,164],[164,127],[164,97],[127,60],[97,60],[60,97]],
        hill: [[0,-1],[0.153,-4],[0.291,-6],[0.433,1],[0.55,0],[0.682,0],[0.836,0]],
        surfaces: [], tunnels: [[0.36,0.43],[0.5,0.565]], bridges: [[0.74,0.809],[0.85,0.919]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cañón Este", short: "Cañón Este", theme: 'canyon', seed: 6000209, laps: 3, N: 1931, surface: 'asphalt',
        pts: [[60,320],[60,535],[105,580],[145,580],[190,535],[190,410],[280,320],[535,320],[580,275],[580,235],[535,190],[495,190],[450,145],[450,105],[405,60],[365,60],[320,105],[320,145],[275,190],[235,190],[190,145],[190,105],[145,60],[105,60],[60,105]],
        hill: [[0,-4],[0.142,-1],[0.337,2],[0.481,3],[0.64,3],[0.817,-3]],
        surfaces: [[0.768,0.904,'gravel']], tunnels: [[0.35,0.413]], bridges: [[0.08,0.149],[0.24,0.313]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Cañón Sur", short: "Cañón Sur", theme: 'lake', seed: 6001518, laps: 3, N: 1882, surface: 'asphalt',
        pts: [[164,164],[95,164],[60,199],[60,233],[95,268],[199,268],[268,337],[268,441],[303,476],[337,476],[372,441],[372,407],[407,372],[545,372],[580,337],[580,303],[545,268],[511,268],[476,233],[476,199],[441,164],[407,164],[372,129],[372,95],[337,60],[303,60],[268,95],[268,129],[233,164]],
        hill: [[0,1],[0.118,1],[0.285,-3],[0.431,-3],[0.585,-2],[0.749,-4],[0.866,-5]],
        surfaces: [], tunnels: [[0.24,0.305],[0.46,0.52]], bridges: [[0.1,0.175]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cima Gris", short: "Cima Gris", theme: 'alpine', seed: 6004503, laps: 3, N: 2036, surface: 'asphalt',
        pts: [[372,60],[197,60],[164,93],[164,131],[131,164],[93,164],[60,197],[60,235],[93,268],[131,268],[164,301],[164,443],[197,476],[235,476],[268,443],[268,301],[301,268],[339,268],[372,301],[372,443],[405,476],[443,476],[476,443],[476,301],[509,268],[547,268],[580,235],[580,125],[515,60]],
        hill: [[0,-1],[0.163,-2],[0.329,0],[0.45,-5],[0.616,-2],[0.783,0],[0.909,2]],
        surfaces: [[0.814,0.948,'gravel']], tunnels: [[0.42,0.489]], bridges: [[0.27,0.341]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Pico Oeste", short: "Pico Oeste", theme: 'jungle', seed: 6004757, laps: 3, N: 1874, surface: 'asphalt',
        pts: [[372,476],[372,437],[437,372],[515,372],[580,307],[580,229],[515,164],[404,164],[372,132],[372,92],[340,60],[300,60],[268,92],[268,236],[236,268],[196,268],[164,300],[164,340],[132,372],[92,372],[60,404],[60,548],[92,580],[132,580],[164,548],[164,508],[196,476],[236,476],[268,508],[268,548],[300,580],[340,580],[372,548]],
        hill: [[0,-4],[0.146,-1],[0.325,4],[0.478,0],[0.648,1],[0.802,2]],
        surfaces: [], tunnels: [[0.21,0.281],[0.65,0.718]], bridges: [[0.44,0.512]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Salto Real", short: "Salto Real", theme: 'dusk', seed: 6103734, laps: 3, N: 2224, surface: 'asphalt',
        pts: [[190,320],[282,320],[320,358],[320,412],[358,450],[542,450],[580,412],[580,358],[542,320],[488,320],[450,282],[450,98],[412,60],[358,60],[320,98],[320,152],[282,190],[98,190],[60,228],[60,282],[98,320]],
        hill: [[0,-1],[0.12,-1],[0.288,-3],[0.411,-3],[0.527,-4],[0.65,1],[0.78,3]],
        surfaces: [], tunnels: [[0.18,0.248]], bridges: [[0.45,0.524]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Salto Oeste", short: "Salto Oeste", theme: 'neon', seed: 6104233, laps: 3, N: 1638, surface: 'asphalt',
        pts: [[580,216],[580,163],[477,60],[337,60],[268,129],[268,199],[199,268],[94,268],[60,302],[60,338],[94,372],[130,372],[164,406],[164,442],[198,476],[234,476],[268,442],[268,406],[302,372],[338,372],[372,338],[372,302],[406,268],[442,268],[476,302],[476,338],[510,372],[546,372],[580,338]],
        hill: [[0,-3],[0.165,-6],[0.344,3],[0.512,3],[0.656,-4],[0.797,-2]],
        surfaces: [[0.792,0.891,'gravel']], tunnels: [[0.07,0.144],[0.29,0.354]], bridges: [[0.18,0.252],[0.42,0.489]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Campo Verde", short: "Campo Verde", theme: 'autumn', seed: 6004023, laps: 3, N: 2131, surface: 'asphalt',
        pts: [[60,233],[60,348],[118,407],[204,407],[233,436],[233,464],[204,493],[176,493],[147,523],[147,551],[176,580],[262,580],[320,522],[320,349],[349,320],[377,320],[407,291],[407,176],[377,147],[349,147],[320,117],[320,89],[291,60],[148,60],[60,148]],
        hill: [[0,-6],[0.192,4],[0.333,4],[0.527,-2],[0.689,4],[0.88,3]],
        surfaces: [], tunnels: [[0.45,0.518]], bridges: [[0.34,0.412],[0.78,0.846]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Monte Norte", short: "Monte Norte", theme: 'dunes', seed: 6002743, laps: 3, N: 1779, surface: 'asphalt',
        pts: [[580,216],[580,307],[515,372],[405,372],[372,339],[372,301],[339,268],[301,268],[268,301],[268,339],[235,372],[93,372],[60,339],[60,301],[93,268],[131,268],[164,235],[164,93],[197,60],[235,60],[268,93],[268,131],[301,164],[339,164],[372,131],[372,93],[405,60],[515,60],[580,125]],
        hill: [[0,-2],[0.136,-6],[0.319,-1],[0.489,0],[0.651,-1],[0.828,-4]],
        surfaces: [], tunnels: [[0.35,0.413]], bridges: [[0.55,0.62]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cerro Oeste", short: "Cerro Oeste", theme: 'frost', seed: 6004807, laps: 3, N: 2102, surface: 'asphalt',
        pts: [[268,476],[268,545],[233,580],[199,580],[164,545],[164,511],[129,476],[95,476],[60,441],[60,407],[95,372],[129,372],[164,337],[164,303],[129,268],[95,268],[60,233],[60,199],[95,164],[233,164],[268,129],[268,95],[303,60],[405,60],[476,131],[476,233],[441,268],[407,268],[372,303],[372,337],[337,372],[303,372],[268,407]],
        hill: [[0,-1],[0.122,0],[0.249,2],[0.402,-2],[0.542,-2],[0.665,-3],[0.83,-1]],
        surfaces: [[0.571,0.676,'snow']], tunnels: [[0.71,0.78]], bridges: [[0.19,0.257],[0.47,0.537]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Valle Gris", short: "Valle Gris", theme: 'volcano', seed: 6101697, laps: 3, N: 2316, surface: 'asphalt',
        pts: [[60,268],[60,366],[170,476],[335,476],[372,439],[372,409],[409,372],[543,372],[580,335],[580,305],[543,268],[409,268],[372,231],[372,201],[335,164],[305,164],[268,201],[268,231],[231,268],[201,268],[164,231],[164,97],[127,60],[97,60],[60,97]],
        hill: [[0,0],[0.153,2],[0.283,-1],[0.436,-1],[0.603,1],[0.743,-3],[0.901,-5]],
        surfaces: [], tunnels: [[0.16,0.228]], bridges: [[0.33,0.397]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cruz Gris", short: "Cruz Gris", theme: 'sakura', seed: 6103715, laps: 3, N: 2177, surface: 'asphalt',
        pts: [[268,372],[268,198],[302,164],[338,164],[372,198],[372,304],[440,372],[512,372],[580,304],[580,198],[546,164],[510,164],[476,130],[476,94],[442,60],[266,60],[164,162],[164,338],[130,372],[94,372],[60,406],[60,442],[94,476],[130,476],[164,510],[164,546],[198,580],[234,580],[268,546]],
        hill: [[0,-5],[0.158,2],[0.349,0],[0.541,3],[0.722,3],[0.914,1]],
        surfaces: [[0.752,0.842,'gravel']], tunnels: [[0.5,0.575],[0.62,0.694]], bridges: [[0.17,0.235],[0.3,0.366]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Playa Este", short: "Playa Este", theme: 'savanna', seed: 6003732, laps: 3, N: 1660, surface: 'asphalt',
        pts: [[320,190],[320,98],[282,60],[228,60],[190,98],[190,282],[152,320],[98,320],[60,358],[60,412],[98,450],[152,450],[190,488],[190,542],[228,580],[375,580],[450,505],[450,358],[412,320],[358,320],[320,282]],
        hill: [[0,-1],[0.127,-5],[0.279,2],[0.427,-3],[0.597,1],[0.739,4],[0.87,-4]],
        surfaces: [[0.21,0.292,'gravel']], tunnels: [[0.77,0.838]], bridges: [[0.6,0.672]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cañón Norte", short: "Cañón Norte", theme: 'swamp', seed: 6103426, laps: 3, N: 2277, surface: 'asphalt',
        pts: [[407,407],[407,444],[358,493],[258,493],[233,518],[233,556],[209,580],[109,580],[60,531],[60,431],[84,407],[122,407],[147,382],[147,344],[122,320],[84,320],[60,296],[60,258],[84,233],[122,233],[147,209],[147,171],[171,147],[209,147],[233,122],[233,84],[258,60],[296,60],[320,84],[320,122],[344,147],[382,147],[407,171],[407,209],[382,233],[344,233],[320,258],[320,296],[344,320],[382,320],[407,344]],
        hill: [[0,-4],[0.15,0],[0.27,3],[0.386,-1],[0.527,-3],[0.671,4],[0.842,1]],
        surfaces: [], tunnels: [[0.19,0.25]], bridges: [[0.29,0.363]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Campo Este", short: "Campo Este", theme: 'dawn', seed: 6103729, laps: 3, N: 1689, surface: 'asphalt',
        pts: [[268,60],[94,60],[60,94],[60,130],[94,164],[130,164],[164,198],[164,234],[198,268],[234,268],[268,234],[268,198],[302,164],[338,164],[372,198],[372,304],[440,372],[546,372],[580,338],[580,302],[546,268],[510,268],[476,234],[476,128],[408,60]],
        hill: [[0,-1],[0.125,-1],[0.291,-2],[0.424,-6],[0.576,-1],[0.708,2],[0.832,4]],
        surfaces: [[0.238,0.352,'gravel']], tunnels: [[0.46,0.534],[0.8,0.872]], bridges: [[0.57,0.636]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Monte Verde", short: "Monte Verde", theme: 'mist', seed: 6004893, laps: 3, N: 2021, surface: 'asphalt',
        pts: [[320,60],[124,60],[60,124],[60,236],[92,268],[132,268],[164,236],[164,196],[196,164],[340,164],[372,196],[372,236],[340,268],[300,268],[268,300],[268,340],[236,372],[196,372],[164,404],[164,548],[196,580],[236,580],[268,548],[268,508],[300,476],[340,476],[372,444],[372,404],[404,372],[516,372],[580,308],[580,156],[484,60]],
        hill: [[0,-4],[0.166,-6],[0.321,-3],[0.468,-1],[0.613,0],[0.734,1],[0.867,-6]],
        surfaces: [], tunnels: [[0.85,0.921]], bridges: [[0.73,0.801]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Roca Norte", short: "Roca Norte", theme: 'redrock', seed: 6102518, laps: 3, N: 2021, surface: 'asphalt',
        pts: [[476,320],[476,96],[440,60],[408,60],[372,96],[372,232],[336,268],[304,268],[268,304],[268,336],[232,372],[200,372],[164,336],[164,304],[128,268],[96,268],[60,304],[60,405],[131,476],[336,476],[372,512],[372,544],[408,580],[440,580],[476,544]],
        hill: [[0,1],[0.181,-5],[0.33,-2],[0.474,-2],[0.663,-1],[0.849,-5]],
        surfaces: [], tunnels: [[0.2,0.264]], bridges: [[0.57,0.643],[0.68,0.751]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Roca Este", short: "Roca Este", theme: 'tundra', seed: 6103022, laps: 3, N: 2316, surface: 'asphalt',
        pts: [[233,363],[233,177],[264,147],[290,147],[320,177],[320,203],[350,233],[376,233],[407,203],[407,121],[346,60],[207,60],[147,121],[147,203],[116,233],[90,233],[60,264],[60,376],[90,407],[116,407],[147,437],[147,550],[177,580],[203,580],[233,550]],
        hill: [[0,-3],[0.164,1],[0.3,-4],[0.44,-5],[0.593,-2],[0.716,0],[0.88,-5]],
        surfaces: [], tunnels: [[0.62,0.687]], bridges: [[0.26,0.333],[0.37,0.442]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Puna Sur", short: "Puna Sur", theme: 'moon', seed: 6003722, laps: 3, N: 1951, surface: 'asphalt',
        pts: [[60,363],[60,465],[88,493],[119,493],[147,465],[147,376],[203,320],[292,320],[320,292],[320,261],[348,233],[379,233],[407,261],[407,292],[435,320],[524,320],[580,264],[580,175],[552,147],[521,147],[493,119],[493,88],[465,60],[348,60],[320,88],[320,119],[292,147],[175,147],[147,175],[147,205],[119,233],[88,233],[60,261]],
        hill: [[0,2],[0.171,4],[0.338,-1],[0.471,-4],[0.613,-3],[0.798,-1]],
        surfaces: [[0.463,0.549,'gravel']], tunnels: [[0.78,0.852]], bridges: [[0.12,0.192],[0.66,0.729]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Monte Sur", short: "Monte Sur", theme: 'coast', seed: 6104542, laps: 3, N: 1628, surface: 'asphalt',
        pts: [[385,580],[268,580],[190,502],[190,359],[151,320],[99,320],[60,281],[60,229],[99,190],[281,190],[320,151],[320,99],[359,60],[411,60],[450,99],[450,151],[489,190],[541,190],[580,229],[580,281],[541,320],[489,320],[450,359],[450,411],[489,450],[541,450],[580,489],[580,541],[541,580]],
        hill: [[0,3],[0.155,-4],[0.292,-3],[0.438,-1],[0.6,1],[0.746,-1],[0.881,-2]],
        surfaces: [], tunnels: [[0.1,0.167],[0.33,0.402]], bridges: [[0.22,0.287],[0.63,0.702]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Pampa Oeste", short: "Pampa Oeste", theme: 'vineyard', seed: 6003226, laps: 3, N: 1947, surface: 'asphalt',
        pts: [[190,580],[117,580],[60,523],[60,435],[89,407],[118,407],[147,378],[147,262],[118,233],[89,233],[60,205],[60,117],[117,60],[205,60],[233,89],[233,118],[262,147],[291,147],[320,175],[320,205],[291,233],[262,233],[233,262],[233,291],[262,320],[349,320],[407,377],[407,465],[378,493],[349,493],[320,522],[320,551],[291,580]],
        hill: [[0,-3],[0.117,-1],[0.282,1],[0.414,4],[0.569,0],[0.725,0],[0.868,-3]],
        surfaces: [], tunnels: [[0.21,0.271],[0.39,0.46]], bridges: [[0.74,0.813]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Salto Verde", short: "Salto Verde", theme: 'bamboo', seed: 6101174, laps: 3, N: 1651, surface: 'asphalt',
        pts: [[320,60],[516,60],[580,124],[580,236],[548,268],[508,268],[476,300],[476,340],[444,372],[404,372],[372,340],[372,196],[340,164],[300,164],[268,196],[268,340],[236,372],[196,372],[164,340],[164,300],[132,268],[92,268],[60,236],[60,124],[124,60]],
        hill: [[0,2],[0.184,3],[0.344,0],[0.496,3],[0.653,1],[0.834,-2]],
        surfaces: [], tunnels: [[0.38,0.454]], bridges: [[0.54,0.608]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Alba Verde", short: "Alba Verde", theme: 'salt', seed: 6101171, laps: 3, N: 2069, surface: 'asphalt',
        pts: [[190,320],[137,320],[60,243],[60,98],[98,60],[152,60],[190,98],[190,152],[228,190],[282,190],[320,152],[320,98],[358,60],[412,60],[450,98],[450,152],[488,190],[542,190],[580,228],[580,282],[542,320],[488,320],[450,358],[450,412],[412,450],[358,450],[320,412],[320,358],[282,320]],
        hill: [[0,0],[0.141,-1],[0.302,-5],[0.456,-1],[0.582,3],[0.729,-2],[0.882,2]],
        surfaces: [], tunnels: [[0.07,0.134]], bridges: [[0.31,0.38],[0.8,0.872]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Río Azul", short: "Río Azul", theme: 'prairie', seed: 6002768, laps: 3, N: 2029, surface: 'asphalt',
        pts: [[424,476],[297,476],[268,447],[268,401],[239,372],[119,372],[60,313],[60,193],[89,164],[135,164],[164,193],[164,239],[193,268],[239,268],[268,239],[268,193],[297,164],[343,164],[372,135],[372,89],[401,60],[447,60],[476,89],[476,239],[505,268],[551,268],[580,297],[580,417],[521,476]],
        hill: [[0,-5],[0.137,2],[0.332,1],[0.515,-5],[0.679,3],[0.848,3]],
        surfaces: [[0.311,0.434,'gravel']], tunnels: [[0.69,0.752]], bridges: [[0.84,0.914]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Mesa Oeste", short: "Mesa Oeste", theme: 'aurora', seed: 6001685, laps: 3, N: 1818, surface: 'asphalt',
        pts: [[60,216],[60,119],[119,60],[209,60],[268,119],[268,209],[327,268],[521,268],[580,327],[580,417],[521,476],[402,476],[372,446],[372,402],[342,372],[298,372],[268,402],[268,446],[238,476],[194,476],[164,446],[164,402],[134,372],[90,372],[60,342]],
        hill: [[0,0],[0.139,3],[0.262,-5],[0.4,1],[0.521,-4],[0.662,1],[0.804,-1]],
        surfaces: [[0.8,0.884,'snow']], tunnels: [[0.33,0.402]], bridges: [[0.09,0.162],[0.55,0.618]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Campo Oeste", short: "Campo Oeste", theme: 'storm', seed: 6003250, laps: 3, N: 1854, surface: 'asphalt',
        pts: [[372,60],[543,60],[580,97],[580,127],[543,164],[380,164],[268,276],[268,505],[193,580],[135,580],[60,505],[60,409],[97,372],[127,372],[164,335],[164,172],[276,60]],
        hill: [[0,4],[0.168,-5],[0.333,-4],[0.48,1],[0.609,-1],[0.771,3],[0.934,-1]],
        surfaces: [[0.589,0.677,'gravel']], tunnels: [[0.18,0.247],[0.42,0.484]], bridges: [[0.28,0.348],[0.79,0.855]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Roca Gris", short: "Roca Gris", theme: 'heath', seed: 6002708, laps: 3, N: 1963, surface: 'asphalt',
        pts: [[216,60],[341,60],[372,91],[372,133],[403,164],[445,164],[476,133],[476,91],[507,60],[549,60],[580,91],[580,207],[519,268],[403,268],[372,299],[372,341],[403,372],[445,372],[476,403],[476,445],[445,476],[299,476],[268,445],[268,403],[237,372],[195,372],[164,341],[164,299],[133,268],[91,268],[60,237],[60,121],[121,60]],
        hill: [[0,0],[0.128,-5],[0.284,2],[0.441,-6],[0.568,1],[0.695,1],[0.845,0]],
        surfaces: [], tunnels: [[0.59,0.653]], bridges: [[0.86,0.926]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cerro Gris", short: "Cerro Gris", theme: 'ember', seed: 6104338, laps: 3, N: 1513, surface: 'asphalt',
        pts: [[424,60],[547,60],[580,93],[580,131],[547,164],[509,164],[476,197],[476,235],[443,268],[405,268],[372,301],[372,443],[339,476],[301,476],[268,443],[268,334],[202,268],[93,268],[60,235],[60,197],[93,164],[235,164],[268,131],[268,93],[301,60]],
        hill: [[0,-1],[0.145,-6],[0.311,-3],[0.478,-6],[0.604,4],[0.734,-3],[0.904,3]],
        surfaces: [[0.453,0.552,'gravel']], tunnels: [[0.32,0.381]], bridges: [[0.59,0.658],[0.77,0.841]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Pico Este", short: "Pico Este", theme: 'orchid', seed: 6101399, laps: 3, N: 1820, surface: 'asphalt',
        pts: [[277,60],[202,60],[147,115],[147,206],[119,233],[87,233],[60,261],[60,293],[87,320],[119,320],[147,347],[147,379],[119,407],[87,407],[60,434],[60,466],[87,493],[119,493],[147,521],[147,553],[174,580],[293,580],[320,553],[320,521],[293,493],[261,493],[233,466],[233,434],[261,407],[293,407],[320,379],[320,347],[347,320],[466,320],[493,293],[493,261],[466,233],[434,233],[407,206],[407,115],[352,60]],
        hill: [[0,2],[0.18,4],[0.33,2],[0.484,0],[0.633,-6],[0.81,3]],
        surfaces: [], tunnels: [[0.71,0.776]], bridges: [[0.46,0.527],[0.86,0.928]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cueva Azul", short: "Cueva Azul", theme: 'glacier', seed: 6102917, laps: 3, N: 2163, surface: 'asphalt',
        pts: [[268,372],[268,200],[304,164],[336,164],[372,128],[372,96],[336,60],[96,60],[60,96],[60,128],[96,164],[128,164],[164,200],[164,232],[128,268],[96,268],[60,304],[60,508],[132,580],[196,580],[268,508]],
        hill: [[0,-5],[0.154,3],[0.318,4],[0.461,1],[0.613,1],[0.734,1],[0.868,-3]],
        surfaces: [], tunnels: [[0.29,0.353],[0.64,0.708]], bridges: [[0.51,0.578],[0.78,0.847]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Valle Real", short: "Valle Real", theme: 'oasis', seed: 6002732, laps: 3, N: 1803, surface: 'asphalt',
        pts: [[60,320],[60,469],[171,580],[335,580],[372,543],[372,513],[335,476],[201,476],[164,439],[164,409],[201,372],[298,372],[372,298],[372,171],[261,60],[171,60],[60,171]],
        hill: [[0,-5],[0.129,1],[0.25,2],[0.39,3],[0.555,2],[0.687,4],[0.857,-3]],
        surfaces: [], tunnels: [[0.16,0.233],[0.35,0.425]], bridges: [[0.71,0.781]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Faro Gris", short: "Faro Gris", theme: 'amethyst', seed: 6103815, laps: 3, N: 1951, surface: 'asphalt',
        pts: [[268,580],[200,580],[60,440],[60,269],[165,164],[337,164],[372,129],[372,95],[407,60],[545,60],[580,95],[580,129],[545,164],[511,164],[476,199],[476,233],[441,268],[407,268],[372,303],[372,337],[407,372],[441,372],[476,407],[476,510],[406,580]],
        hill: [[0,4],[0.15,-4],[0.277,2],[0.444,-1],[0.588,-1],[0.709,-4],[0.851,-2]],
        surfaces: [], tunnels: [[0.31,0.379]], bridges: [[0.16,0.226],[0.83,0.904]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Alba Real", short: "Alba Real", theme: 'harbor2', seed: 6104971, laps: 3, N: 1657, surface: 'asphalt',
        pts: [[164,476],[164,548],[196,580],[236,580],[268,548],[268,404],[300,372],[340,372],[372,340],[372,196],[340,164],[300,164],[268,132],[268,92],[236,60],[196,60],[164,92],[164,236],[132,268],[92,268],[60,300],[60,340],[92,372],[132,372],[164,404]],
        hill: [[0,-5],[0.199,1],[0.353,-3],[0.519,4],[0.655,3],[0.8,-5]],
        surfaces: [], tunnels: [[0.15,0.224],[0.34,0.413]], bridges: [[0.68,0.746],[0.81,0.883]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Alba Gris", short: "Alba Gris", theme: 'canyon2', seed: 6102598, laps: 3, N: 1804, surface: 'asphalt',
        pts: [[476,320],[476,129],[407,60],[302,60],[268,94],[268,130],[302,164],[338,164],[372,198],[372,338],[338,372],[302,372],[268,338],[268,302],[234,268],[94,268],[60,302],[60,338],[94,372],[130,372],[164,406],[164,511],[233,580],[373,580],[476,477]],
        hill: [[0,-5],[0.14,-6],[0.318,0],[0.483,-5],[0.672,0],[0.841,1]],
        surfaces: [], tunnels: [[0.31,0.382]], bridges: [[0.49,0.565],[0.78,0.85]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Cruz Sur", short: "Cruz Sur", theme: 'lake2', seed: 6104060, laps: 3, N: 2349, surface: 'asphalt',
        pts: [[216,60],[335,60],[372,97],[372,127],[409,164],[439,164],[476,201],[476,231],[513,268],[543,268],[580,305],[580,335],[543,372],[409,372],[372,335],[372,305],[335,268],[305,268],[268,305],[268,439],[231,476],[201,476],[164,439],[164,305],[127,268],[97,268],[60,231],[60,134],[134,60]],
        hill: [[0,4],[0.117,2],[0.276,-2],[0.442,-1],[0.587,3],[0.732,-1],[0.884,-1]],
        surfaces: [], tunnels: [[0.54,0.609]], bridges: [[0.34,0.407],[0.69,0.76]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Loma Azul", short: "Loma Azul", theme: 'alpine2', seed: 6104559, laps: 3, N: 1561, surface: 'asphalt',
        pts: [[190,60],[104,60],[60,104],[60,146],[104,190],[146,190],[190,234],[190,276],[146,320],[104,320],[60,364],[60,406],[104,450],[276,450],[320,494],[320,536],[364,580],[406,580],[450,536],[450,494],[494,450],[536,450],[580,406],[580,278],[492,190],[364,190],[320,146],[320,104],[276,60]],
        hill: [[0,3],[0.161,1],[0.324,-1],[0.492,-4],[0.654,2],[0.791,-2]],
        surfaces: [], tunnels: [[0.37,0.431],[0.7,0.775]], bridges: [[0.81,0.879]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Pampa Este", short: "Pampa Este", theme: 'jungle2', seed: 6001322, laps: 3, N: 2003, surface: 'asphalt',
        pts: [[190,233],[262,233],[320,176],[320,118],[378,60],[436,60],[493,118],[493,205],[522,233],[551,233],[580,262],[580,291],[551,320],[522,320],[493,349],[493,465],[465,493],[435,493],[407,465],[407,349],[378,320],[349,320],[320,349],[320,378],[291,407],[175,407],[147,378],[147,349],[118,320],[89,320],[60,291],[60,262],[89,233]],
        hill: [[0,2],[0.138,3],[0.292,-3],[0.446,-5],[0.57,-6],[0.732,4],[0.89,0]],
        surfaces: [], tunnels: [[0.57,0.644]], bridges: [[0.73,0.799]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Salto Gris", short: "Salto Gris", theme: 'dusk2', seed: 6002453, laps: 3, N: 2332, surface: 'asphalt',
        pts: [[190,407],[145,407],[60,321],[60,203],[117,147],[205,147],[233,175],[233,205],[262,233],[292,233],[320,205],[320,175],[348,147],[378,147],[407,118],[407,88],[435,60],[465,60],[493,88],[493,118],[522,147],[552,147],[580,175],[580,205],[552,233],[522,233],[493,262],[493,292],[465,320],[435,320],[407,348],[407,378],[435,407],[465,407],[493,435],[493,465],[465,493],[348,493],[320,465],[320,435],[292,407]],
        hill: [[0,1],[0.196,2],[0.372,-2],[0.525,3],[0.689,-1],[0.855,-4]],
        surfaces: [[0.535,0.67,'gravel']], tunnels: [[0.1,0.174]], bridges: [[0.84,0.907]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Río Verde", short: "Río Verde", theme: 'neon2', seed: 6101442, laps: 3, N: 1914, surface: 'asphalt',
        pts: [[60,320],[60,96],[96,60],[128,60],[164,96],[164,232],[200,268],[232,268],[268,304],[268,336],[232,372],[200,372],[164,408],[164,440],[200,476],[232,476],[268,512],[268,544],[232,580],[132,580],[60,508]],
        hill: [[0,-2],[0.118,-2],[0.266,2],[0.411,-4],[0.548,-6],[0.706,1],[0.839,-4]],
        surfaces: [[0.39,0.524,'gravel']], tunnels: [[0.07,0.141]], bridges: [[0.28,0.35],[0.85,0.919]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Mesa Este", short: "Mesa Este", theme: 'autumn2', seed: 6103041, laps: 3, N: 1861, surface: 'asphalt',
        pts: [[190,255],[190,414],[154,450],[96,450],[60,486],[60,544],[96,580],[284,580],[320,544],[320,486],[356,450],[507,450],[580,377],[580,263],[507,190],[356,190],[320,154],[320,96],[284,60],[226,60],[190,96]],
        hill: [[0,3],[0.144,0],[0.268,0],[0.414,-2],[0.58,3],[0.743,-5],[0.885,-1]],
        surfaces: [], tunnels: [[0.27,0.341]], bridges: [[0.69,0.764]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Río Este", short: "Río Este", theme: 'dunes2', seed: 6001881, laps: 3, N: 1769, surface: 'asphalt',
        pts: [[320,372],[126,372],[60,306],[60,230],[126,164],[235,164],[268,197],[268,235],[301,268],[443,268],[476,235],[476,197],[443,164],[405,164],[372,131],[372,93],[405,60],[514,60],[580,126],[580,273],[481,372]],
        hill: [[0,3],[0.149,1],[0.312,-2],[0.429,-2],[0.57,-4],[0.726,1],[0.848,3]],
        surfaces: [[0.52,0.645,'gravel']], tunnels: [[0.4,0.467],[0.75,0.823]], bridges: [[0.07,0.143]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Pico Sur", short: "Pico Sur", theme: 'frost2', seed: 6004210, laps: 3, N: 1924, surface: 'asphalt',
        pts: [[255,580],[406,580],[450,536],[450,494],[406,450],[364,450],[320,406],[320,364],[364,320],[406,320],[450,276],[450,234],[494,190],[536,190],[580,146],[580,104],[536,60],[364,60],[320,104],[320,146],[276,190],[234,190],[190,146],[190,104],[146,60],[104,60],[60,104],[60,276],[104,320],[146,320],[190,364],[190,406],[146,450],[104,450],[60,494],[60,536],[104,580]],
        hill: [[0,-3],[0.15,-3],[0.284,3],[0.43,-2],[0.552,3],[0.716,2],[0.851,-4]],
        surfaces: [], tunnels: [[0.41,0.478]], bridges: [[0.14,0.207],[0.66,0.731]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Bahía Gris", short: "Bahía Gris", theme: 'volcano2', seed: 6101127, laps: 3, N: 2169, surface: 'asphalt',
        pts: [[450,320],[525,320],[580,265],[580,174],[553,147],[521,147],[493,119],[493,87],[466,60],[347,60],[320,87],[320,119],[293,147],[261,147],[233,174],[233,265],[178,320],[87,320],[60,347],[60,379],[87,407],[119,407],[147,434],[147,466],[119,493],[87,493],[60,521],[60,553],[87,580],[178,580],[233,525],[233,434],[261,407],[293,407],[320,379],[320,347],[347,320]],
        hill: [[0,4],[0.135,-3],[0.289,-6],[0.469,-4],[0.639,3],[0.821,-4]],
        surfaces: [], tunnels: [[0.73,0.794]], bridges: [[0.38,0.445]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Pampa Verde", short: "Pampa Verde", theme: 'sakura2', seed: 6104569, laps: 3, N: 2171, surface: 'asphalt',
        pts: [[320,60],[241,60],[60,241],[60,535],[105,580],[145,580],[190,535],[190,495],[235,450],[275,450],[320,495],[320,535],[365,580],[405,580],[450,535],[450,235],[495,190],[535,190],[580,145],[580,105],[535,60]],
        hill: [[0,-2],[0.139,-6],[0.273,-1],[0.447,-5],[0.606,-4],[0.745,-3]],
        surfaces: [[0.294,0.431,'gravel']], tunnels: [[0.18,0.246]], bridges: [[0.63,0.702],[0.85,0.92]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Duna Azul", short: "Duna Azul", theme: 'savanna2', seed: 6003919, laps: 3, N: 2169, surface: 'asphalt',
        pts: [[268,268],[96,268],[60,232],[60,200],[96,164],[336,164],[372,128],[372,96],[408,60],[440,60],[476,96],[476,128],[512,164],[544,164],[580,200],[580,440],[544,476],[512,476],[476,440],[476,339],[405,268]],
        hill: [[0,-1],[0.153,-5],[0.309,-5],[0.46,3],[0.641,-2],[0.815,2]],
        surfaces: [], tunnels: [[0.26,0.32]], bridges: [[0.59,0.663]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Monte Real", short: "Monte Real", theme: 'swamp2', seed: 6001211, laps: 3, N: 1678, surface: 'asphalt',
        pts: [[60,450],[60,396],[136,320],[244,320],[320,244],[320,136],[396,60],[542,60],[580,98],[580,152],[542,190],[488,190],[450,228],[450,282],[488,320],[542,320],[580,358],[580,412],[542,450],[488,450],[450,488],[450,542],[412,580],[358,580],[320,542],[320,488],[282,450],[228,450],[190,488],[190,542],[152,580],[98,580],[60,542]],
        hill: [[0,4],[0.163,0],[0.322,-6],[0.482,-4],[0.613,-3],[0.738,2],[0.858,4]],
        surfaces: [[0.647,0.762,'gravel']], tunnels: [[0.11,0.183],[0.24,0.31]], bridges: [[0.45,0.522]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Playa Sur", short: "Playa Sur", theme: 'dawn2', seed: 6102633, laps: 3, N: 2218, surface: 'asphalt',
        pts: [[60,190],[60,149],[149,60],[261,60],[320,119],[320,204],[350,233],[377,233],[407,204],[407,176],[436,147],[550,147],[580,176],[580,204],[550,233],[523,233],[493,263],[493,290],[464,320],[350,320],[320,350],[320,377],[290,407],[263,407],[233,377],[233,350],[204,320],[119,320],[60,261]],
        hill: [[0,-3],[0.125,-2],[0.268,-2],[0.437,-1],[0.58,3],[0.718,-4],[0.886,0]],
        surfaces: [[0.786,0.917,'gravel']], tunnels: [[0.11,0.172]], bridges: [[0.39,0.458],[0.62,0.69]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Lago Este", short: "Lago Este", theme: 'mist2', seed: 6002447, laps: 3, N: 1822, surface: 'asphalt',
        pts: [[268,268],[94,268],[60,234],[60,198],[94,164],[234,164],[268,130],[268,94],[302,60],[338,60],[372,94],[372,130],[406,164],[513,164],[580,231],[580,338],[546,372],[510,372],[476,338],[476,302],[442,268]],
        hill: [[0,-5],[0.198,0],[0.34,2],[0.529,-3],[0.722,-1],[0.921,-3]],
        surfaces: [], tunnels: [[0.54,0.606],[0.65,0.716]], bridges: [[0.21,0.285]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Mesa Verde", short: "Mesa Verde", theme: 'redrock2', seed: 6004339, laps: 3, N: 1938, surface: 'asphalt',
        pts: [[580,385],[580,233],[537,190],[493,190],[450,147],[450,103],[407,60],[363,60],[320,103],[320,147],[277,190],[103,190],[60,233],[60,277],[103,320],[147,320],[190,363],[190,407],[233,450],[407,450],[450,493],[450,537],[493,580],[537,580],[580,537]],
        hill: [[0,-6],[0.128,-2],[0.277,-2],[0.424,-2],[0.558,0],[0.717,-5],[0.857,-6]],
        surfaces: [[0.458,0.54,'gravel']], tunnels: [[0.36,0.428],[0.68,0.749]], bridges: [[0.82,0.895]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Loma Norte", short: "Loma Norte", theme: 'tundra2', seed: 6001965, laps: 3, N: 2171, surface: 'asphalt',
        pts: [[164,216],[164,96],[200,60],[232,60],[268,96],[268,232],[304,268],[336,268],[372,304],[372,336],[336,372],[304,372],[268,408],[268,440],[304,476],[336,476],[372,512],[372,544],[336,580],[200,580],[164,544],[164,512],[128,476],[96,476],[60,440],[60,408],[96,372],[128,372],[164,336]],
        hill: [[0,0],[0.168,-3],[0.365,-1],[0.548,-5],[0.724,3],[0.897,4]],
        surfaces: [[0.734,0.844,'snow']], tunnels: [[0.6,0.666]], bridges: [[0.17,0.245]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Mesa Gris", short: "Mesa Gris", theme: 'moon2', seed: 6100975, laps: 3, N: 1886, surface: 'asphalt',
        pts: [[320,60],[453,60],[580,187],[580,408],[538,450],[492,450],[450,408],[450,362],[408,320],[362,320],[320,362],[320,408],[278,450],[102,450],[60,408],[60,362],[102,320],[148,320],[190,278],[190,232],[148,190],[102,190],[60,148],[60,102],[102,60]],
        hill: [[0,-3],[0.152,-3],[0.302,0],[0.422,3],[0.583,-1],[0.7,0],[0.86,-4]],
        surfaces: [[0.392,0.481,'gravel']], tunnels: [[0.17,0.231],[0.53,0.604]], bridges: [[0.07,0.135]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Isla Azul", short: "Isla Azul", theme: 'coast2', seed: 6002953, laps: 3, N: 2128, surface: 'asphalt',
        pts: [[476,320],[476,544],[440,580],[408,580],[372,544],[372,408],[336,372],[304,372],[268,336],[268,237],[195,164],[96,164],[60,128],[60,96],[96,60],[331,60],[476,205]],
        hill: [[0,-6],[0.178,-3],[0.342,4],[0.5,3],[0.681,-2],[0.839,-3]],
        surfaces: [[0.336,0.423,'gravel']], tunnels: [[0.22,0.29],[0.67,0.741]], bridges: [[0.85,0.919]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Monte Azul", short: "Monte Azul", theme: 'vineyard2', seed: 6003487, laps: 3, N: 2264, surface: 'asphalt',
        pts: [[60,450],[60,526],[114,580],[207,580],[233,553],[233,520],[260,493],[380,493],[407,467],[407,433],[380,407],[287,407],[233,353],[233,260],[260,233],[293,233],[320,207],[320,173],[293,147],[173,147],[147,120],[147,87],[120,60],[87,60],[60,87],[60,207],[87,233],[120,233],[147,260],[147,293],[120,320],[87,320],[60,347]],
        hill: [[0,0],[0.134,-2],[0.294,1],[0.447,-6],[0.626,3],[0.797,1]],
        surfaces: [], tunnels: [[0.57,0.641]], bridges: [[0.38,0.451]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Faro Sur", short: "Faro Sur", theme: 'bamboo2', seed: 6100165, laps: 3, N: 2265, surface: 'asphalt',
        pts: [[60,320],[60,480],[160,580],[339,580],[372,547],[372,509],[339,476],[301,476],[268,443],[268,405],[301,372],[443,372],[476,339],[476,301],[443,268],[301,268],[268,235],[268,197],[301,164],[339,164],[372,131],[372,93],[339,60],[160,60],[60,160]],
        hill: [[0,2],[0.138,-3],[0.303,-1],[0.468,-3],[0.634,-1],[0.801,0],[0.932,0]],
        surfaces: [], tunnels: [[0.76,0.827]], bridges: [[0.16,0.225],[0.4,0.467]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Monte Oeste", short: "Monte Oeste", theme: 'salt2', seed: 6102692, laps: 3, N: 2186, surface: 'asphalt',
        pts: [[424,268],[301,268],[268,301],[268,339],[235,372],[197,372],[164,339],[164,301],[131,268],[93,268],[60,235],[60,93],[93,60],[131,60],[164,93],[164,131],[197,164],[339,164],[372,131],[372,93],[405,60],[513,60],[580,127],[580,201],[513,268]],
        hill: [[0,2],[0.124,-1],[0.251,-2],[0.38,-1],[0.531,2],[0.671,-2],[0.8,-4]],
        surfaces: [], tunnels: [[0.33,0.403],[0.55,0.613]], bridges: [[0.15,0.223],[0.76,0.833]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cañón Verde", short: "Cañón Verde", theme: 'prairie2', seed: 6004516, laps: 3, N: 2054, surface: 'asphalt',
        pts: [[268,164],[268,124],[204,60],[92,60],[60,92],[60,132],[92,164],[132,164],[164,196],[164,236],[132,268],[92,268],[60,300],[60,340],[92,372],[132,372],[164,404],[164,548],[196,580],[236,580],[268,548],[268,404],[300,372],[340,372],[372,340],[372,300],[340,268],[300,268],[268,236]],
        hill: [[0,-1],[0.156,2],[0.315,2],[0.476,-5],[0.611,4],[0.772,0],[0.91,-4]],
        surfaces: [], tunnels: [[0.69,0.756]], bridges: [[0.49,0.561]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Cueva Oeste", short: "Cueva Oeste", theme: 'aurora2', seed: 6002190, laps: 3, N: 2069, surface: 'asphalt',
        pts: [[277,320],[440,320],[493,267],[493,173],[520,147],[553,147],[580,120],[580,87],[553,60],[460,60],[407,113],[407,207],[380,233],[347,233],[320,207],[320,173],[293,147],[260,147],[233,173],[233,207],[207,233],[173,233],[147,207],[147,173],[120,147],[87,147],[60,173],[60,267],[113,320]],
        hill: [[0,1],[0.193,2],[0.349,-2],[0.525,-2],[0.724,0],[0.888,1]],
        surfaces: [[0.527,0.612,'snow']], tunnels: [[0.31,0.376],[0.81,0.884]], bridges: [[0.14,0.212]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Playa Azul", short: "Playa Azul", theme: 'storm2', seed: 6101109, laps: 3, N: 2065, surface: 'asphalt',
        pts: [[268,372],[443,372],[476,339],[476,301],[509,268],[547,268],[580,235],[580,197],[547,164],[405,164],[372,131],[372,93],[339,60],[301,60],[268,93],[268,203],[203,268],[93,268],[60,301],[60,339],[93,372]],
        hill: [[0,-1],[0.128,-2],[0.262,-1],[0.395,-5],[0.51,-1],[0.648,-1],[0.805,3]],
        surfaces: [], tunnels: [[0.33,0.402],[0.72,0.783]], bridges: [[0.08,0.146],[0.6,0.668]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Faro Azul", short: "Faro Azul", theme: 'heath2', seed: 6002978, laps: 3, N: 2331, surface: 'asphalt',
        pts: [[424,268],[542,268],[580,306],[580,334],[542,372],[410,372],[372,410],[372,438],[334,476],[306,476],[268,438],[268,410],[230,372],[202,372],[164,334],[164,306],[126,268],[98,268],[60,230],[60,202],[98,164],[126,164],[164,126],[164,98],[202,60],[230,60],[268,98],[268,192],[344,268]],
        hill: [[0,-3],[0.19,2],[0.358,-1],[0.547,0],[0.741,-4],[0.921,1]],
        surfaces: [], tunnels: [[0.17,0.244],[0.83,0.898]], bridges: [[0.07,0.14]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Isla Norte", short: "Isla Norte", theme: 'ember2', seed: 6000167, laps: 3, N: 1636, surface: 'asphalt',
        pts: [[164,476],[164,545],[199,580],[233,580],[268,545],[268,511],[303,476],[337,476],[372,441],[372,407],[407,372],[441,372],[476,337],[476,199],[441,164],[407,164],[372,199],[372,233],[337,268],[303,268],[268,233],[268,95],[233,60],[199,60],[164,95],[164,129],[129,164],[95,164],[60,199],[60,337],[95,372],[129,372],[164,407]],
        hill: [[0,0],[0.152,1],[0.267,-5],[0.421,-3],[0.589,0],[0.729,-3],[0.858,0]],
        surfaces: [[0.124,0.213,'gravel']], tunnels: [[0.3,0.374]], bridges: [[0.57,0.639],[0.81,0.882]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Mesa Norte", short: "Mesa Norte", theme: 'orchid2', seed: 6004350, laps: 3, N: 1902, surface: 'asphalt',
        pts: [[372,60],[542,60],[580,98],[580,126],[542,164],[306,164],[268,202],[268,230],[230,268],[98,268],[60,230],[60,202],[98,164],[126,164],[164,126],[164,98],[202,60]],
        hill: [[0,0],[0.168,2],[0.309,1],[0.478,-1],[0.616,0],[0.753,-4]],
        surfaces: [], tunnels: [[0.3,0.365]], bridges: [[0.09,0.156],[0.55,0.623]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cala Azul", short: "Cala Azul", theme: 'glacier2', seed: 6101672, laps: 3, N: 1891, surface: 'asphalt',
        pts: [[372,320],[372,522],[314,580],[193,580],[164,551],[164,505],[135,476],[89,476],[60,447],[60,401],[89,372],[135,372],[164,343],[164,297],[135,268],[89,268],[60,239],[60,193],[89,164],[135,164],[164,135],[164,89],[193,60],[314,60],[372,118]],
        hill: [[0,-3],[0.156,-3],[0.324,0],[0.462,4],[0.628,-2],[0.769,-3]],
        surfaces: [], tunnels: [[0.76,0.832]], bridges: [[0.07,0.137],[0.17,0.24]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Bahía Oeste", short: "Bahía Oeste", theme: 'oasis2', seed: 6100256, laps: 3, N: 2095, surface: 'asphalt',
        pts: [[190,320],[96,320],[60,284],[60,226],[96,190],[154,190],[190,154],[190,96],[226,60],[284,60],[320,96],[320,154],[356,190],[508,190],[580,262],[580,414],[544,450],[486,450],[450,486],[450,544],[414,580],[356,580],[320,544],[320,392],[248,320]],
        hill: [[0,-2],[0.161,0],[0.318,0],[0.46,1],[0.609,-4],[0.768,2]],
        surfaces: [], tunnels: [[0.38,0.449]], bridges: [[0.53,0.601],[0.83,0.901]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Selva Real", short: "Selva Real", theme: 'amethyst2', seed: 6103475, laps: 3, N: 2117, surface: 'asphalt',
        pts: [[268,60],[96,60],[60,96],[60,128],[96,164],[232,164],[268,200],[268,232],[232,268],[96,268],[60,304],[60,336],[96,372],[232,372],[268,408],[268,440],[304,476],[336,476],[372,440],[372,408],[408,372],[508,372],[580,300],[580,200],[544,164],[512,164],[476,128],[476,96],[440,60]],
        hill: [[0,-2],[0.146,4],[0.286,-1],[0.433,2],[0.564,-3],[0.728,-3],[0.854,-1]],
        surfaces: [], tunnels: [[0.16,0.232],[0.43,0.497]], bridges: [[0.29,0.36]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Cruz Verde", short: "Cruz Verde", theme: 'harbor3', seed: 6104995, laps: 3, N: 2309, surface: 'asphalt',
        pts: [[60,268],[60,443],[93,476],[131,476],[164,509],[164,547],[197,580],[235,580],[268,547],[268,509],[301,476],[443,476],[476,443],[476,405],[443,372],[334,372],[268,306],[268,197],[235,164],[197,164],[164,131],[164,93],[131,60],[93,60],[60,93]],
        hill: [[0,0],[0.118,2],[0.277,-5],[0.408,2],[0.573,2],[0.716,3],[0.877,3]],
        surfaces: [[0.716,0.85,'gravel']], tunnels: [[0.61,0.681]], bridges: [[0.07,0.135],[0.36,0.428]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Salto Azul", short: "Salto Azul", theme: 'canyon3', seed: 6101958, laps: 3, N: 1647, surface: 'asphalt',
        pts: [[476,268],[436,268],[372,204],[372,92],[340,60],[300,60],[268,92],[268,132],[236,164],[92,164],[60,196],[60,236],[92,268],[132,268],[164,300],[164,340],[196,372],[340,372],[372,404],[372,444],[404,476],[444,476],[476,444],[476,404],[508,372],[548,372],[580,340],[580,300],[548,268]],
        hill: [[0,-1],[0.193,3],[0.336,-5],[0.474,-1],[0.612,1],[0.756,-1]],
        surfaces: [], tunnels: [[0.31,0.377],[0.59,0.655]], bridges: [[0.1,0.17]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Isla Este", short: "Isla Este", theme: 'lake3', seed: 6103176, laps: 3, N: 1955, surface: 'asphalt',
        pts: [[363,407],[525,407],[580,352],[580,261],[553,233],[521,233],[493,206],[493,87],[466,60],[434,60],[407,87],[407,179],[352,233],[261,233],[233,206],[233,174],[206,147],[87,147],[60,174],[60,206],[87,233],[119,233],[147,261],[147,352],[201,407]],
        hill: [[0,-3],[0.198,-5],[0.392,1],[0.562,-2],[0.737,-6],[0.932,2]],
        surfaces: [[0.368,0.495,'gravel']], tunnels: [[0.62,0.687]], bridges: [[0.25,0.319]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Bahía Verde", short: "Bahía Verde", theme: 'alpine3', seed: 6001165, laps: 3, N: 2295, surface: 'asphalt',
        pts: [[372,60],[231,60],[164,127],[164,235],[131,268],[93,268],[60,301],[60,339],[93,372],[201,372],[268,305],[268,197],[301,164],[339,164],[372,197],[372,339],[405,372],[443,372],[476,339],[476,301],[509,268],[547,268],[580,235],[580,127],[513,60]],
        hill: [[0,0],[0.2,-6],[0.345,-4],[0.481,-2],[0.64,-5],[0.838,2]],
        surfaces: [[0.405,0.508,'gravel']], tunnels: [[0.57,0.637]], bridges: [[0.12,0.19],[0.82,0.893]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Campo Gris", short: "Campo Gris", theme: 'jungle3', seed: 6001128, laps: 3, N: 2287, surface: 'asphalt',
        pts: [[60,320],[60,441],[95,476],[129,476],[164,441],[164,407],[199,372],[233,372],[268,407],[268,441],[303,476],[476,476],[580,372],[580,199],[545,164],[511,164],[476,199],[476,233],[441,268],[338,268],[268,198],[268,95],[233,60],[199,60],[164,95],[164,129],[129,164],[95,164],[60,199]],
        hill: [[0,0],[0.175,0],[0.369,3],[0.516,-4],[0.666,-1],[0.826,4]],
        surfaces: [[0.127,0.245,'gravel']], tunnels: [[0.29,0.358],[0.64,0.704]], bridges: [[0.44,0.509],[0.75,0.821]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cima Verde", short: "Cima Verde", theme: 'dusk3', seed: 6104437, laps: 3, N: 1753, surface: 'asphalt',
        pts: [[216,60],[95,60],[60,95],[60,129],[95,164],[129,164],[164,199],[164,233],[129,268],[95,268],[60,303],[60,337],[95,372],[129,372],[164,407],[164,545],[199,580],[233,580],[268,545],[268,511],[303,476],[337,476],[372,441],[372,407],[337,372],[303,372],[268,337],[268,303],[303,268],[441,268],[476,233],[476,199],[441,164],[407,164],[372,129],[372,95],[337,60]],
        hill: [[0,-5],[0.167,-5],[0.318,-2],[0.468,-3],[0.652,-3],[0.809,-2]],
        surfaces: [[0.253,0.336,'gravel']], tunnels: [[0.72,0.791]], bridges: [[0.15,0.22],[0.37,0.439]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Pico Real", short: "Pico Real", theme: 'neon3', seed: 6003623, laps: 3, N: 2075, surface: 'asphalt',
        pts: [[320,363],[320,261],[292,233],[261,233],[233,206],[233,115],[178,60],[88,60],[60,88],[60,119],[88,147],[119,147],[147,174],[147,292],[119,320],[88,320],[60,348],[60,379],[88,407],[119,407],[147,434],[147,466],[174,493],[206,493],[233,521],[233,552],[261,580],[379,580],[407,552],[407,521],[379,493],[348,493],[320,466]],
        hill: [[0,-6],[0.161,2],[0.292,-1],[0.434,2],[0.602,1],[0.724,-6],[0.879,-4]],
        surfaces: [], tunnels: [[0.21,0.279],[0.39,0.454]], bridges: [[0.09,0.156],[0.74,0.808]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cañón Real", short: "Cañón Real", theme: 'autumn3', seed: 6104625, laps: 3, N: 1983, surface: 'asphalt',
        pts: [[580,268],[580,226],[518,164],[403,164],[372,133],[372,91],[341,60],[299,60],[268,91],[268,237],[237,268],[195,268],[164,237],[164,195],[133,164],[91,164],[60,195],[60,341],[91,372],[133,372],[164,403],[164,445],[195,476],[237,476],[268,445],[268,403],[299,372],[341,372],[372,341],[372,299],[403,268],[445,268],[476,299],[476,341],[507,372],[549,372],[580,341]],
        hill: [[0,-5],[0.123,0],[0.246,-4],[0.416,2],[0.57,1],[0.741,2],[0.87,-3]],
        surfaces: [], tunnels: [[0.25,0.316],[0.47,0.532]], bridges: [[0.08,0.15]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Valle Verde", short: "Valle Verde", theme: 'dunes3', seed: 6001448, laps: 3, N: 1876, surface: 'asphalt',
        pts: [[450,60],[542,60],[580,98],[580,152],[542,190],[488,190],[450,228],[450,282],[488,320],[542,320],[580,358],[580,412],[542,450],[488,450],[450,488],[450,542],[412,580],[265,580],[190,505],[190,358],[152,320],[98,320],[60,282],[60,228],[98,190],[282,190],[320,152],[320,98],[358,60]],
        hill: [[0,-1],[0.165,-3],[0.299,3],[0.47,3],[0.631,-2],[0.778,-6],[0.922,-5]],
        surfaces: [[0.159,0.257,'gravel']], tunnels: [[0.58,0.647],[0.79,0.854]], bridges: [[0.48,0.549]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Duna Real", short: "Duna Real", theme: 'frost3', seed: 6000775, laps: 3, N: 1947, surface: 'asphalt',
        pts: [[268,60],[160,60],[60,160],[60,272],[160,372],[339,372],[372,405],[372,443],[405,476],[547,476],[580,443],[580,405],[547,372],[509,372],[476,339],[476,301],[509,268],[547,268],[580,235],[580,197],[547,164],[509,164],[476,131],[476,93],[443,60]],
        hill: [[0,1],[0.181,0],[0.339,-4],[0.525,1],[0.691,-3],[0.876,2]],
        surfaces: [], tunnels: [[0.32,0.387],[0.46,0.52]], bridges: [[0.08,0.149]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Selva Verde", short: "Selva Verde", theme: 'volcano3', seed: 6103872, laps: 3, N: 1839, surface: 'asphalt',
        pts: [[216,580],[165,580],[60,475],[60,303],[95,268],[129,268],[164,233],[164,199],[199,164],[233,164],[268,199],[268,233],[303,268],[337,268],[372,233],[372,95],[407,60],[441,60],[476,95],[476,233],[511,268],[545,268],[580,303],[580,337],[545,372],[442,372],[372,442],[372,510],[302,580]],
        hill: [[0,2],[0.145,-2],[0.291,3],[0.481,-4],[0.616,-6],[0.794,-1]],
        surfaces: [[0.277,0.396,'gravel']], tunnels: [[0.12,0.183],[0.59,0.659]], bridges: [[0.45,0.523],[0.77,0.845]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Alba Azul", short: "Alba Azul", theme: 'sakura3', seed: 6104790, laps: 3, N: 2325, surface: 'asphalt',
        pts: [[164,216],[164,340],[132,372],[92,372],[60,404],[60,444],[92,476],[132,476],[164,508],[164,548],[196,580],[340,580],[372,548],[372,508],[404,476],[444,476],[476,444],[476,404],[508,372],[548,372],[580,340],[580,300],[548,268],[508,268],[476,236],[476,92],[444,60],[404,60],[372,92],[372,132],[340,164],[300,164],[268,132],[268,92],[236,60],[196,60],[164,92]],
        hill: [[0,0],[0.189,-5],[0.362,3],[0.551,-4],[0.693,-2],[0.871,0]],
        surfaces: [[0.123,0.229,'gravel']], tunnels: [[0.27,0.334],[0.63,0.697]], bridges: [[0.78,0.849]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Campo Sur", short: "Campo Sur", theme: 'savanna3', seed: 6001879, laps: 3, N: 1646, surface: 'asphalt',
        pts: [[60,372],[60,546],[94,580],[130,580],[164,546],[164,406],[198,372],[234,372],[268,406],[268,442],[302,476],[408,476],[476,408],[476,336],[408,268],[336,268],[268,200],[268,94],[234,60],[198,60],[164,94],[164,130],[130,164],[94,164],[60,198]],
        hill: [[0,-3],[0.144,0],[0.279,2],[0.412,2],[0.563,-1],[0.721,1],[0.867,-5]],
        surfaces: [[0.752,0.888,'gravel']], tunnels: [[0.18,0.248],[0.37,0.439]], bridges: [[0.62,0.694]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Río Gris", short: "Río Gris", theme: 'swamp3', seed: 6101220, laps: 3, N: 2034, surface: 'asphalt',
        pts: [[580,268],[580,95],[545,60],[511,60],[476,95],[476,129],[441,164],[407,164],[372,199],[372,233],[337,268],[303,268],[268,233],[268,199],[233,164],[199,164],[164,199],[164,233],[129,268],[95,268],[60,303],[60,441],[95,476],[129,476],[164,441],[164,407],[199,372],[233,372],[268,407],[268,441],[303,476],[476,476],[580,372]],
        hill: [[0,-2],[0.146,-5],[0.263,-1],[0.43,-3],[0.568,2],[0.736,-3],[0.906,1]],
        surfaces: [], tunnels: [[0.8,0.864]], bridges: [[0.52,0.588],[0.66,0.731]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Isla Verde", short: "Isla Verde", theme: 'dawn3', seed: 6002829, laps: 3, N: 1681, surface: 'asphalt',
        pts: [[60,320],[60,228],[124,164],[236,164],[268,132],[268,92],[300,60],[444,60],[476,92],[476,132],[444,164],[404,164],[372,196],[372,236],[404,268],[516,268],[580,332],[580,412],[516,476],[332,476],[268,412],[268,300],[236,268],[196,268],[164,300],[164,444],[132,476],[92,476],[60,444]],
        hill: [[0,-2],[0.171,2],[0.285,3],[0.406,0],[0.571,1],[0.734,-4],[0.851,3]],
        surfaces: [], tunnels: [[0.19,0.263],[0.57,0.644]], bridges: [[0.41,0.478],[0.83,0.9]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cala Verde", short: "Cala Verde", theme: 'mist3', seed: 6104958, laps: 3, N: 1922, surface: 'asphalt',
        pts: [[60,476],[60,545],[95,580],[129,580],[164,545],[164,511],[199,476],[302,476],[372,406],[372,303],[407,268],[441,268],[476,233],[476,199],[441,164],[407,164],[372,129],[372,95],[337,60],[199,60],[164,95],[164,129],[199,164],[233,164],[268,199],[268,233],[233,268],[199,268],[164,303],[164,337],[129,372],[95,372],[60,407]],
        hill: [[0,-4],[0.124,2],[0.272,-5],[0.424,1],[0.563,-3],[0.728,-3],[0.859,-3]],
        surfaces: [[0.45,0.554,'gravel']], tunnels: [[0.17,0.238],[0.59,0.654]], bridges: [[0.74,0.813]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Isla Oeste", short: "Isla Oeste", theme: 'redrock3', seed: 6101784, laps: 3, N: 2217, surface: 'asphalt',
        pts: [[450,320],[450,102],[408,60],[362,60],[320,102],[320,148],[278,190],[144,190],[60,274],[60,538],[102,580],[148,580],[190,538],[190,362],[232,320],[278,320],[320,362],[320,538],[362,580],[408,580],[450,538]],
        hill: [[0,4],[0.136,1],[0.327,0],[0.497,-3],[0.683,3],[0.856,-5]],
        surfaces: [], tunnels: [[0.37,0.437]], bridges: [[0.59,0.66],[0.73,0.805]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Lago Gris", short: "Lago Gris", theme: 'tundra3', seed: 6103372, laps: 3, N: 2284, surface: 'asphalt',
        pts: [[60,424],[60,482],[158,580],[307,580],[372,515],[372,437],[437,372],[515,372],[580,307],[580,125],[515,60],[405,60],[372,93],[372,131],[339,164],[301,164],[268,197],[268,339],[235,372],[197,372],[164,339],[164,301],[131,268],[93,268],[60,301]],
        hill: [[0,-2],[0.17,-1],[0.309,-1],[0.428,-6],[0.574,0],[0.708,2],[0.863,-6]],
        surfaces: [[0.517,0.597,'snow']], tunnels: [[0.42,0.485]], bridges: [[0.08,0.148],[0.72,0.788]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Valle Este", short: "Valle Este", theme: 'moon3', seed: 6002610, laps: 3, N: 2342, surface: 'asphalt',
        pts: [[580,320],[580,535],[535,580],[495,580],[450,535],[450,495],[405,450],[235,450],[190,495],[190,535],[145,580],[105,580],[60,535],[60,235],[105,190],[145,190],[190,235],[190,275],[235,320],[275,320],[320,275],[320,149],[409,60],[491,60],[580,149]],
        hill: [[0,0],[0.139,-3],[0.323,-3],[0.5,-4],[0.678,1],[0.86,-5]],
        surfaces: [], tunnels: [[0.48,0.555]], bridges: [[0.22,0.293]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Duna Sur", short: "Duna Sur", theme: 'coast3', seed: 6102599, laps: 3, N: 2113, surface: 'asphalt',
        pts: [[450,580],[360,580],[320,540],[320,490],[280,450],[140,450],[60,370],[60,230],[100,190],[150,190],[190,150],[190,100],[230,60],[280,60],[320,100],[320,280],[360,320],[410,320],[450,360],[450,410],[490,450],[540,450],[580,490],[580,540],[540,580]],
        hill: [[0,-3],[0.124,0],[0.289,2],[0.408,2],[0.525,2],[0.695,-5],[0.851,0]],
        surfaces: [[0.718,0.825,'gravel']], tunnels: [[0.28,0.35],[0.59,0.656]], bridges: [[0.14,0.205],[0.86,0.927]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Loma Verde", short: "Loma Verde", theme: 'vineyard3', seed: 6100397, laps: 3, N: 2239, surface: 'asphalt',
        pts: [[372,60],[197,60],[164,93],[164,131],[131,164],[93,164],[60,197],[60,339],[93,372],[131,372],[164,405],[164,443],[197,476],[339,476],[372,443],[372,405],[339,372],[301,372],[268,339],[268,301],[301,268],[339,268],[372,235],[372,197],[405,164],[547,164],[580,131],[580,93],[547,60]],
        hill: [[0,-6],[0.119,1],[0.247,-5],[0.404,1],[0.573,2],[0.739,-3],[0.862,-2]],
        surfaces: [], tunnels: [[0.41,0.484],[0.75,0.824]], bridges: [[0.24,0.313]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cueva Gris", short: "Cueva Gris", theme: 'bamboo3', seed: 6101816, laps: 3, N: 1647, surface: 'asphalt',
        pts: [[580,255],[580,410],[540,450],[490,450],[450,410],[450,360],[410,320],[230,320],[190,360],[190,410],[150,450],[100,450],[60,410],[60,230],[100,190],[150,190],[190,150],[190,100],[230,60],[280,60],[320,100],[320,150],[360,190],[410,190],[450,150],[450,100],[490,60],[540,60],[580,100]],
        hill: [[0,0],[0.168,-1],[0.346,-1],[0.516,-3],[0.681,-3],[0.858,-3]],
        surfaces: [], tunnels: [[0.46,0.529]], bridges: [[0.2,0.275],[0.64,0.708]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Pico Azul", short: "Pico Azul", theme: 'salt3', seed: 6002564, laps: 3, N: 2038, surface: 'asphalt',
        pts: [[255,580],[96,580],[60,544],[60,486],[96,450],[154,450],[190,414],[190,226],[154,190],[96,190],[60,154],[60,96],[96,60],[284,60],[320,96],[320,154],[356,190],[544,190],[580,226],[580,284],[544,320],[486,320],[450,356],[450,508],[378,580]],
        hill: [[0,-4],[0.17,3],[0.306,-4],[0.447,2],[0.617,-2],[0.778,4]],
        surfaces: [], tunnels: [[0.44,0.507]], bridges: [[0.61,0.68]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Cima Este", short: "Cima Este", theme: 'prairie3', seed: 6101752, laps: 3, N: 2343, surface: 'asphalt',
        pts: [[60,233],[60,381],[86,407],[121,407],[147,433],[147,528],[198,580],[294,580],[320,554],[320,519],[294,493],[259,493],[233,467],[233,346],[207,320],[173,320],[147,294],[147,259],[173,233],[207,233],[233,207],[233,173],[207,147],[173,147],[147,121],[147,86],[121,60],[86,60],[60,86]],
        hill: [[0,-4],[0.165,2],[0.312,1],[0.483,1],[0.647,1],[0.783,-4]],
        surfaces: [[0.717,0.803,'gravel']], tunnels: [[0.28,0.351],[0.47,0.541]], bridges: [[0.17,0.239]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Selva Este", short: "Selva Este", theme: 'aurora3', seed: 6004489, laps: 3, N: 2157, surface: 'asphalt',
        pts: [[216,580],[163,580],[60,477],[60,302],[94,268],[130,268],[164,234],[164,94],[198,60],[234,60],[268,94],[268,130],[302,164],[407,164],[476,233],[476,303],[407,372],[302,372],[268,406],[268,442],[302,476],[338,476],[372,510],[372,546],[338,580]],
        hill: [[0,4],[0.13,0],[0.271,0],[0.387,4],[0.504,3],[0.618,-2],[0.774,-5]],
        surfaces: [], tunnels: [[0.12,0.194],[0.29,0.363]], bridges: [[0.49,0.561],[0.66,0.727]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Monte Este", short: "Monte Este", theme: 'storm3', seed: 6100462, laps: 3, N: 1825, surface: 'asphalt',
        pts: [[580,372],[580,443],[547,476],[509,476],[476,443],[476,405],[443,372],[405,372],[372,405],[372,443],[339,476],[301,476],[268,443],[268,405],[235,372],[197,372],[164,339],[164,301],[131,268],[93,268],[60,235],[60,197],[93,164],[131,164],[164,131],[164,93],[197,60],[235,60],[268,93],[268,235],[301,268],[339,268],[372,235],[372,197],[405,164],[443,164],[476,197],[476,235],[509,268],[547,268],[580,301]],
        hill: [[0,0],[0.14,-6],[0.274,1],[0.437,2],[0.555,3],[0.682,2],[0.808,4]],
        surfaces: [], tunnels: [[0.63,0.697]], bridges: [[0.14,0.211],[0.81,0.884]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Lago Norte", short: "Lago Norte", theme: 'heath3', seed: 6000539, laps: 3, N: 1688, surface: 'asphalt',
        pts: [[372,320],[372,154],[278,60],[123,60],[60,123],[60,205],[123,268],[237,268],[268,299],[268,341],[237,372],[195,372],[164,403],[164,517],[227,580],[309,580],[372,517]],
        hill: [[0,-2],[0.144,-5],[0.296,-1],[0.43,2],[0.566,-4],[0.706,1],[0.847,-1]],
        surfaces: [[0.56,0.654,'gravel']], tunnels: [[0.2,0.266],[0.85,0.923]], bridges: [[0.07,0.136],[0.44,0.508]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Duna Verde", short: "Duna Verde", theme: 'ember3', seed: 6003168, laps: 3, N: 2195, surface: 'asphalt',
        pts: [[580,268],[580,442],[546,476],[510,476],[476,442],[476,337],[407,268],[302,268],[268,302],[268,338],[234,372],[198,372],[164,338],[164,302],[130,268],[94,268],[60,234],[60,198],[94,164],[130,164],[164,130],[164,94],[198,60],[338,60],[372,94],[372,130],[406,164],[442,164],[476,130],[476,94],[510,60],[546,60],[580,94]],
        hill: [[0,3],[0.14,2],[0.304,-1],[0.467,1],[0.596,2],[0.764,4],[0.883,2]],
        surfaces: [], tunnels: [[0.24,0.31],[0.66,0.722]], bridges: [[0.11,0.181],[0.35,0.418]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Roca Oeste", short: "Roca Oeste", theme: 'orchid3', seed: 6103903, laps: 3, N: 2310, surface: 'asphalt',
        pts: [[320,580],[464,580],[580,464],[580,229],[541,190],[489,190],[450,151],[450,99],[411,60],[267,60],[190,137],[190,281],[229,320],[281,320],[320,359],[320,411],[281,450],[99,450],[60,489],[60,541],[99,580]],
        hill: [[0,0],[0.159,-2],[0.348,3],[0.545,-3],[0.722,-2],[0.884,1]],
        surfaces: [], tunnels: [[0.18,0.248],[0.74,0.801]], bridges: [[0.39,0.462],[0.51,0.578]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Playa Gris", short: "Playa Gris", theme: 'glacier3', seed: 6104414, laps: 3, N: 2037, surface: 'asphalt',
        pts: [[580,385],[580,229],[541,190],[489,190],[450,229],[450,281],[411,320],[359,320],[320,281],[320,138],[242,60],[99,60],[60,99],[60,151],[99,190],[151,190],[190,229],[190,281],[151,320],[99,320],[60,359],[60,411],[99,450],[281,450],[320,489],[320,541],[359,580],[502,580],[580,502]],
        hill: [[0,4],[0.143,-6],[0.3,3],[0.44,2],[0.608,-6],[0.743,-4]],
        surfaces: [[0.482,0.568,'snow']], tunnels: [[0.25,0.314],[0.68,0.753]], bridges: [[0.35,0.417]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Selva Oeste", short: "Selva Oeste", theme: 'oasis3', seed: 6103701, laps: 3, N: 2240, surface: 'asphalt',
        pts: [[60,320],[60,536],[104,580],[146,580],[190,536],[190,494],[234,450],[276,450],[320,406],[320,364],[364,320],[406,320],[450,364],[450,536],[494,580],[536,580],[580,536],[580,277],[493,190],[364,190],[320,146],[320,104],[276,60],[147,60],[60,147]],
        hill: [[0,2],[0.123,1],[0.267,-4],[0.413,-3],[0.568,-3],[0.732,-3],[0.858,-4]],
        surfaces: [[0.34,0.426,'gravel']], tunnels: [[0.52,0.589]], bridges: [[0.64,0.71],[0.81,0.876]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Valle Azul", short: "Valle Azul", theme: 'amethyst3', seed: 6101831, laps: 3, N: 2200, surface: 'asphalt',
        pts: [[580,320],[580,536],[536,580],[494,580],[450,536],[450,494],[406,450],[148,450],[60,362],[60,234],[104,190],[146,190],[190,234],[190,276],[234,320],[276,320],[320,276],[320,234],[364,190],[406,190],[450,146],[450,104],[494,60],[536,60],[580,104]],
        hill: [[0,-2],[0.134,2],[0.283,-3],[0.443,-3],[0.612,-1],[0.767,-3]],
        surfaces: [[0.554,0.662,'gravel']], tunnels: [[0.25,0.314]], bridges: [[0.08,0.154],[0.42,0.493]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Gran Premio Puna Oeste", short: "Puna Oeste", theme: 'harbor4', seed: 6004978, laps: 3, N: 2232, surface: 'asphalt',
        pts: [[147,407],[147,521],[205,580],[291,580],[320,551],[320,523],[349,493],[377,493],[407,464],[407,436],[377,407],[349,407],[320,377],[320,349],[349,320],[377,320],[407,291],[407,263],[377,233],[292,233],[233,175],[233,89],[204,60],[176,60],[147,89],[147,117],[117,147],[89,147],[60,176],[60,204],[89,233],[117,233],[147,263]],
        hill: [[0,-5],[0.128,-1],[0.247,-1],[0.379,0],[0.504,3],[0.659,0],[0.822,-2]],
        surfaces: [], tunnels: [[0.13,0.191],[0.59,0.652]], bridges: [[0.34,0.412],[0.46,0.53]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Circuito Cañón Gris", short: "Cañón Gris", theme: 'canyon4', seed: 6004968, laps: 3, N: 1971, surface: 'asphalt',
        pts: [[190,320],[291,320],[320,349],[320,378],[349,407],[378,407],[407,378],[407,349],[436,320],[522,320],[580,262],[580,176],[551,147],[522,147],[493,176],[493,204],[464,233],[378,233],[320,175],[320,89],[291,60],[262,60],[233,89],[233,118],[204,147],[118,147],[60,205],[60,262],[118,320]],
        hill: [[0,1],[0.157,-6],[0.283,-2],[0.401,3],[0.562,3],[0.705,-1],[0.875,0]],
        surfaces: [[0.196,0.298,'gravel']], tunnels: [[0.57,0.631]], bridges: [[0.82,0.885]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Autódromo Campo Norte", short: "Campo Norte", theme: 'lake4', seed: 6103804, laps: 3, N: 2128, surface: 'asphalt',
        pts: [[320,60],[235,60],[60,235],[60,492],[148,580],[276,580],[320,536],[320,494],[364,450],[406,450],[450,494],[450,536],[494,580],[536,580],[580,536],[580,408],[492,320],[364,320],[320,276],[320,234],[364,190],[536,190],[580,146],[580,104],[536,60]],
        hill: [[0,-4],[0.196,2],[0.374,-5],[0.512,-5],[0.703,1],[0.849,1]],
        surfaces: [[0.328,0.416,'gravel']], tunnels: [[0.17,0.235]], bridges: [[0.6,0.672],[0.78,0.846]],
        landmarks: []
    },
    {
        kind: 'circuit', name: "Anillo Pico Gris", short: "Pico Gris", theme: 'alpine4', seed: 6001786, laps: 3, N: 1999, surface: 'asphalt',
        pts: [[60,190],[60,89],[89,60],[117,60],[147,89],[147,117],[176,147],[261,147],[320,206],[320,291],[349,320],[377,320],[407,349],[407,521],[348,580],[263,580],[233,551],[233,523],[204,493],[89,493],[60,464],[60,436],[89,407],[117,407],[147,377],[147,349],[117,320],[89,320],[60,291]],
        hill: [[0,0],[0.116,4],[0.287,-1],[0.453,0],[0.576,3],[0.703,-3],[0.846,4]],
        surfaces: [[0.808,0.919,'gravel']], tunnels: [[0.43,0.491],[0.67,0.738]], bridges: [[0.18,0.25],[0.55,0.616]],
        landmarks: []
    },
    // ===================== ETAPAS (100-199) =====================
    {
        kind: 'stage', name: "Ruta Cerro Verde", short: "Cerro Verde", theme: 'harbor', seed: 7102707, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[25,154,20,0,-4,'asphalt','B'],[18,55,15,-2.9,-12],[24,26,23,0,13],
            [22,54,15,-2.6,-3],[20,176,17,0,0],[18,91,16,5.8,18],[25,173,21,0,-1,'asphalt','T'],
            [19,39,15,2.3,-15],[26,138,21,0,15],[22,21,18,-2.5,1,'gravel'],[19,55,18,0,-1,'gravel'],
            [22,31,18,-2,-1,'gravel'],[27,123,18,0,4,'asphalt','B'],[22,85,19,5.4,1,'gravel'],[25,177,20,0,2,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cima Azul", short: "Cima Azul", theme: 'canyon', seed: 7001796, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[24,177,21,0,-5,'asphalt','B'],[22,88,15,5.5,9,'asphalt'],[16,25,22,0,17,'asphalt'],
            [22,41,18,-2.7,-14],[27,19,19,0,18],[22,64,21,-4,-7],[22,183,24,0,3,'asphalt','B'],
            [17,40,18,2.1,3],[27,38,16,0,5,'asphalt'],[17,42,17,-2.7,-17,'asphalt'],[17,109,19,0,-9],
            [17,82,20,-4.7,4,'asphalt'],[22,67,22,0,7,'asphalt'],[18,32,19,-2.2,-5],[26,162,19,0,2,'asphalt','T'],
            [20,41,19,-2.8,-2],[26,106,24,0,3,'asphalt','T'],[16,86,17,6,-1],[19,120,19,0,-17],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Río Oeste", short: "Río Oeste", theme: 'lake', seed: 7104163, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[22,135,19,0,-15],[21,82,15,6.2,2],[25,32,19,0,-3,'gravel'],
            [21,25,19,-2.7,12],[27,25,15,0,-17],[18,69,17,4.9,-8],[24,32,23,0,-11],
            [20,60,19,-3.4,12],[26,159,18,0,-3,'asphalt','B'],[21,72,17,4.5,18],[17,34,20,0,15],
            [22,24,15,-2.3,8],[24,139,24,0,4,'asphalt','B'],[17,76,18,5.3,9],[22,120,20,0,-4,'asphalt','T'],
            [22,73,21,-5.7,-16],[26,139,18,0,-5,'asphalt','T'],[21,57,21,-3.6,-6],[26,29,18,0,-13,'gravel'],
            [0,60,0,0,0,'gravel']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Monte Gris", short: "Monte Gris", theme: 'alpine', seed: 7102326, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[18,88,17,0,5],[18,87,20,5.7,12],[18,22,20,0,-13],
            [21,29,20,2,12],[25,39,23,0,-8],[19,33,16,3,-18,'gravel'],[26,161,19,0,-12,'gravel'],
            [19,64,20,4.7,2],[27,172,19,0,-1,'asphalt','B'],[21,39,15,-3.1,13],[18,21,21,0,7,'gravel'],
            [20,87,17,5.2,9],[26,185,24,0,6,'asphalt','T'],[20,75,16,-5.6,-5],[25,120,20,0,-3,'asphalt','T'],
            [18,55,19,-3.7,2,'gravel'],[25,135,20,0,-3,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Cueva Real", short: "Cueva Real", theme: 'jungle', seed: 7004403, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[24,140,19,0,6,'asphalt','T'],[16,55,18,-3.8,13,'asphalt'],[23,155,23,0,-5,'asphalt','T'],
            [21,69,16,-5.1,18],[23,139,23,0,6,'asphalt','B'],[18,33,18,-2.5,7],[21,27,15,0,-11],
            [16,82,19,5.1,12],[25,115,20,0,5,'asphalt','B'],[18,84,17,-5.3,10],[25,149,18,0,-3,'asphalt','T'],
            [16,74,15,-4.1,-17],[23,35,18,0,15],[18,25,17,-2.2,-14],[17,201,18,0,1,'asphalt'],
            [0,60,0,0,0,'asphalt']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cala Norte", short: "Cala Norte", theme: 'dusk', seed: 7004084, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[23,114,18,0,2,'asphalt','T'],[17,80,16,5.7,-4],[23,114,22,0,-5,'asphalt','B'],
            [22,85,18,-5.7,-2],[17,75,20,0,17],[17,54,21,2.8,-11],[24,23,22,0,-17,'gravel'],
            [22,28,21,-2.5,1],[27,103,19,0,-3,'asphalt','B'],[17,81,19,-5.9,-14],[22,117,21,0,0,'asphalt','T'],
            [16,42,18,3.3,-8],[27,42,22,0,12],[17,62,20,-3.6,4],[21,30,16,0,-11,'gravel'],
            [16,43,20,2.4,12],[22,149,24,0,0,'asphalt','T'],[17,78,21,-4.5,-9],[27,205,21,0,-9],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cala Real", short: "Cala Real", theme: 'neon', seed: 7101048, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[24,151,22,0,-6,'asphalt','T'],[19,33,16,-2.6,-13],[22,36,19,0,-7],
            [19,67,15,4.3,-5],[23,38,17,0,8],[21,44,18,3.4,9],[22,182,18,0,-3,'asphalt','T'],
            [19,90,15,-5.5,0],[19,189,21,0,9],[16,23,19,2,-13],[26,160,15,0,-7],
            [16,87,19,5.6,-1,'gravel'],[27,157,18,0,-2,'asphalt','B'],[21,56,16,-3.2,-18],[21,136,20,0,1],
            [21,30,21,2.6,-1],[22,110,20,0,5,'asphalt','B'],[17,73,18,4.1,13,'gravel'],[26,124,19,0,10],
            [19,66,21,3.7,4],[18,113,23,0,16],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Alba Sur", short: "Alba Sur", theme: 'autumn', seed: 7001205, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[18,127,15,0,-4],[21,45,16,-2.8,13],[19,93,21,0,13],
            [18,78,19,6.1,7,'asphalt'],[26,174,20,0,-4,'asphalt','B'],[20,49,19,-3.5,11],[22,158,19,0,-3,'asphalt','T'],
            [17,90,16,-5.3,6],[27,184,16,0,-6],[20,81,15,5.6,-16],[20,94,22,0,11],
            [19,37,16,-2.9,-17],[22,28,17,0,11,'asphalt'],[16,74,20,-5,-8],[27,145,21,0,2,'asphalt','B'],
            [22,62,18,4.1,-5],[25,154,18,0,4,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Cueva Norte", short: "Cueva Norte", theme: 'dunes', seed: 7102651, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,128,19,0,3],[21,45,20,2.8,-17],[21,24,16,0,-10],
            [17,80,18,-5.9,-6],[24,161,18,0,3,'asphalt','B'],[22,75,19,6.1,-11,'asphalt'],[16,51,18,0,-4],
            [19,66,18,-3.9,16],[24,36,17,0,-17],[19,80,15,5.6,11],[26,171,24,0,5,'asphalt','B'],
            [22,47,18,3.5,17],[25,146,18,0,1,'asphalt','T'],[20,37,19,-2.2,18],[17,33,16,0,10],
            [19,89,16,-5.8,14,'asphalt'],[20,92,22,0,-17,'asphalt'],[16,51,20,2.8,-17],[26,114,19,0,-6,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Mesa Sur", short: "Mesa Sur", theme: 'frost', seed: 7100845, surface: 'snow',
        sections: [
            [0,60,0,0,0],[25,165,19,0,4,'asphalt','B'],[20,73,21,-3.8,-13],[26,139,19,0,2,'asphalt','T'],
            [22,84,20,5.4,-7],[16,69,23,0,6,'asphalt'],[20,52,21,3,-3,'asphalt'],[21,69,15,0,8],
            [22,50,16,2.4,-8],[27,64,18,0,-6],[16,31,18,-1.9,16],[22,108,20,0,14],
            [17,64,21,3.8,-11],[27,161,20,0,-4,'asphalt','T'],[16,74,18,5.1,17],[24,28,16,0,17],
            [19,24,16,-2.3,-17],[27,167,19,0,5,'asphalt','T'],[16,79,19,-4.8,-13],[22,154,23,0,2,'asphalt','B'],
            [21,82,19,5.8,18],[18,30,23,0,-6,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cerro Azul", short: "Cerro Azul", theme: 'volcano', seed: 7103778, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,152,20,0,-6,'asphalt','B'],[22,79,21,6,10],[22,163,23,0,-5,'asphalt','B'],
            [20,45,17,-3,-4],[27,50,22,0,-18,'asphalt'],[16,21,19,2.5,-16],[22,92,20,0,3],
            [20,27,17,-2.1,-5],[27,141,15,0,8],[21,77,16,5.7,-7],[26,160,22,0,-6,'asphalt','T'],
            [21,31,19,-2.4,1],[26,41,20,0,9],[18,86,16,5,4,'asphalt'],[16,69,23,0,-15],
            [20,58,21,-2.8,10],[25,132,22,0,-1,'asphalt','T'],[18,84,20,-4.8,7],[23,148,23,0,1,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Bahía Norte", short: "Bahía Norte", theme: 'sakura', seed: 7101714, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[24,131,21,0,2,'asphalt','T'],[17,62,17,3.9,-3],[16,74,21,0,-17,'asphalt'],
            [20,29,21,2.4,16,'asphalt'],[18,202,21,0,5],[20,79,21,4.7,-14,'asphalt'],[25,148,16,0,-1],
            [19,73,16,-3.9,-14],[23,112,23,0,-6,'asphalt','T'],[19,81,18,6.2,-7],[25,180,22,0,1,'asphalt','B'],
            [20,56,21,2.9,-9,'asphalt'],[19,184,17,0,5],[19,85,15,-6.1,1,'asphalt'],[26,156,24,0,1,'asphalt','B'],
            [19,39,15,-2.1,-9],[23,134,15,0,17],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Isla Gris", short: "Isla Gris", theme: 'savanna', seed: 7102242, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,173,21,0,-3,'asphalt','T'],[18,53,19,-2.7,-1],[22,157,24,0,2,'asphalt','T'],
            [21,76,15,5.6,-10],[21,38,23,0,14],[18,25,15,2.4,-10,'asphalt'],[23,133,18,0,6,'asphalt','B'],
            [21,81,18,-5.6,18],[24,183,24,0,-5,'asphalt','B'],[19,42,21,2.6,3],[22,188,22,0,14,'asphalt'],
            [16,81,20,-6.2,4,'asphalt'],[27,202,23,0,16],[22,41,15,2.6,2],[16,25,20,0,-7],
            [21,71,21,4.3,-1],[18,57,17,0,-14],[21,72,19,-4.3,3],[26,164,24,0,-3,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Puna Gris", short: "Puna Gris", theme: 'swamp', seed: 7003947, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,41,18,0,-18],[16,82,20,-5.4,10],[27,176,23,0,-6,'asphalt','T'],
            [18,77,18,5.1,7,'asphalt'],[27,189,24,0,2,'asphalt','B'],[18,59,18,-4,7,'asphalt'],[23,113,24,0,1,'asphalt','B'],
            [17,68,18,-4.4,-6],[23,19,17,0,-15,'asphalt'],[21,86,16,-5.1,-4,'asphalt'],[17,24,22,0,3],
            [17,85,21,5,-6],[27,19,15,0,17],[17,54,17,3.4,17],[23,134,23,0,-4,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Roca Sur", short: "Roca Sur", theme: 'dawn', seed: 7101962, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[19,44,22,0,17],[21,79,20,-6.2,-7],[27,20,22,0,-11],
            [18,75,19,4.4,-7,'gravel'],[26,121,23,0,-6,'asphalt','B'],[17,68,17,4.5,3,'gravel'],[26,166,21,0,1,'asphalt','T'],
            [19,27,19,-2.6,14],[27,132,18,0,4,'asphalt','T'],[18,89,17,-5.8,-4,'gravel'],[26,149,24,0,6,'asphalt','B'],
            [17,26,17,1.9,-11],[27,158,21,0,-6,'asphalt','T'],[18,80,16,5.9,-1],[18,57,17,0,6],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Lago Real", short: "Lago Real", theme: 'mist', seed: 7002890, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,190,19,0,6,'asphalt','T'],[16,71,21,4.8,0],[26,180,21,0,3,'asphalt','T'],
            [19,54,21,4,-16],[26,131,22,0,-3,'asphalt','B'],[20,86,20,-5.5,-1],[26,107,22,0,0,'asphalt','T'],
            [22,56,19,-3.2,8],[17,29,22,0,2,'asphalt'],[17,32,18,-2.6,-9,'asphalt'],[26,179,20,0,1,'asphalt','B'],
            [17,51,18,3.4,-13],[20,103,21,0,-17,'asphalt'],[0,60,0,0,0,'asphalt']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Pico Norte", short: "Pico Norte", theme: 'redrock', seed: 7003715, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,112,16,0,-8],[19,49,19,3.2,-5],[26,77,18,0,-4,'asphalt'],
            [16,40,17,-2.1,-7,'asphalt'],[19,131,16,0,-3],[19,23,20,2.2,-12],[16,142,18,0,4,'asphalt'],
            [17,82,15,-4.7,-4,'asphalt'],[20,80,22,0,18],[17,58,18,-3.3,-7],[26,144,19,0,5,'asphalt','B'],
            [22,32,15,-2.6,-13],[27,102,24,0,4,'asphalt','B'],[18,53,15,2.9,14],[24,107,22,0,1,'asphalt','T'],
            [16,56,19,2.9,11],[22,149,18,0,6,'asphalt','T'],[19,80,19,4.5,13],[23,27,16,0,-6],
            [21,31,20,2.4,14],[22,97,23,0,0],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Pampa Azul", short: "Pampa Azul", theme: 'tundra', seed: 7100846, surface: 'snow',
        sections: [
            [0,60,0,0,0],[26,190,22,0,-3,'asphalt','T'],[21,85,19,5.6,-8,'asphalt'],[22,106,19,0,-1,'asphalt','B'],
            [17,47,21,3.1,-6],[23,160,20,0,2,'asphalt','T'],[19,82,17,-5.8,3,'asphalt'],[26,181,20,0,-5,'asphalt','T'],
            [19,41,16,3,-12],[16,28,23,0,-11],[20,79,20,-6.2,6],[24,33,20,0,2,'asphalt'],
            [18,49,16,2.8,-7,'asphalt'],[22,176,23,0,2,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Loma Real", short: "Loma Real", theme: 'moon', seed: 7001433, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,159,24,0,-5,'asphalt','T'],[20,84,20,6,-18],[25,151,20,0,6,'asphalt','B'],
            [19,26,19,2.4,17],[20,40,20,0,-16],[22,72,19,5,-4,'asphalt'],[24,163,18,0,-3,'asphalt','T'],
            [19,61,21,-3.2,-11,'asphalt'],[16,203,21,0,15],[18,87,18,5.7,-18],[22,56,17,0,14],
            [18,49,16,-2.8,-12],[22,127,23,0,6,'asphalt','B'],[20,66,16,3.5,-13],[20,205,21,0,10],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Cala Oeste", short: "Cala Oeste", theme: 'coast', seed: 7004338, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[18,152,15,0,13],[19,75,21,-4.3,5,'gravel'],[25,204,23,0,-5],
            [18,88,16,-5.2,-4],[25,172,23,0,-4,'asphalt','B'],[21,78,16,4.4,-4],[25,129,24,0,4,'asphalt','T'],
            [21,76,21,-5.4,14,'gravel'],[25,167,24,0,2,'asphalt','B'],[20,65,17,-3.5,-11],[23,149,16,0,2],
            [17,27,18,-2.2,0],[25,187,20,0,-5,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Mesa Azul", short: "Mesa Azul", theme: 'vineyard', seed: 7103779, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,164,22,0,-4,'asphalt','T'],[17,71,16,-4.6,4],[26,132,22,0,1,'asphalt','T'],
            [18,80,18,-5.1,4],[27,39,20,0,7],[22,76,15,5,-10],[20,134,21,0,9,'asphalt'],
            [17,55,16,3.5,-13,'asphalt'],[23,109,19,0,-5,'asphalt','B'],[19,69,17,-4.9,-2],[22,115,20,0,5,'asphalt','T'],
            [17,77,19,5.6,15],[20,142,22,0,-3,'asphalt'],[18,63,20,4.4,-12,'asphalt'],[24,161,23,0,-2,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Faro Verde", short: "Faro Verde", theme: 'bamboo', seed: 7003591, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,158,21,0,-4],[20,22,16,2.4,-10],[20,27,17,0,3],
            [19,73,19,-4.4,-12],[22,195,17,0,0,'asphalt'],[19,80,15,-5.2,-4],[26,126,18,0,-6,'asphalt','B'],
            [19,73,19,4.9,0],[25,174,18,0,4,'asphalt','T'],[16,71,20,-4.2,-4],[23,181,18,0,-2,'asphalt','T'],
            [20,61,17,-4.1,7,'asphalt'],[24,162,24,0,5,'asphalt','T'],[21,57,18,3.1,6],[16,83,19,0,-17],
            [17,88,16,-5.5,18],[22,173,18,0,6,'asphalt','B'],[17,43,16,2.1,15],[26,98,15,0,12],
            [22,74,21,5.4,14,'asphalt'],[21,186,15,0,-1,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Valle Oeste", short: "Valle Oeste", theme: 'salt', seed: 7003079, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,135,23,0,-1,'asphalt','T'],[17,85,18,5.7,17],[26,124,18,0,3,'asphalt','T'],
            [21,61,16,-3.3,6],[17,32,18,0,-10],[17,32,17,2.7,6,'asphalt'],[23,160,22,0,4,'asphalt','B'],
            [22,74,21,-5.2,-5],[27,138,23,0,-5,'asphalt','B'],[19,29,19,2.3,-14,'asphalt'],[17,34,17,0,18,'asphalt'],
            [16,90,19,-5.8,-4],[25,123,20,0,-1,'asphalt','T'],[19,68,20,4.8,-13,'asphalt'],[18,25,21,0,-17,'asphalt'],
            [20,23,17,2.1,14],[21,38,19,0,-5,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Puna Verde", short: "Puna Verde", theme: 'prairie', seed: 7102904, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[20,161,16,0,-2],[19,77,15,-5,-7],[16,153,16,0,13],
            [20,33,21,2.1,-12],[23,135,22,0,-15],[18,42,17,-2.5,-5],[17,29,22,0,9,'asphalt'],
            [22,69,20,-3.8,-2],[25,29,16,0,10],[16,29,21,-1.9,10],[22,146,19,0,6,'asphalt','B'],
            [20,25,20,2.3,8],[27,101,18,0,-5,'asphalt','T'],[17,76,20,5.6,-5,'asphalt'],[23,158,20,0,4,'asphalt','T'],
            [20,22,18,2.2,0],[21,60,23,0,1],[17,51,19,-3,-2,'asphalt'],[26,110,22,0,0,'asphalt','B'],
            [18,80,18,6.3,15],[16,20,23,0,10],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Lago Azul", short: "Lago Azul", theme: 'aurora', seed: 7103612, surface: 'snow',
        sections: [
            [0,60,0,0,0],[18,95,23,0,-18],[17,84,16,-5.5,8],[19,55,23,0,2],
            [21,44,21,-3.2,-12,'asphalt'],[24,105,16,0,-14,'asphalt'],[22,25,16,2.3,-15],[25,151,24,0,3,'asphalt','T'],
            [18,65,18,4.7,15],[24,138,19,0,1,'asphalt','T'],[22,36,15,2.1,8],[22,133,18,0,2,'asphalt','B'],
            [21,75,20,5.6,-13,'asphalt'],[26,37,23,0,-4,'asphalt'],[17,25,17,2,-8],[25,136,19,0,-4,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Río Sur", short: "Río Sur", theme: 'storm', seed: 7102405, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,123,18,0,-5,'asphalt','T'],[20,54,15,-2.6,-2,'gravel'],[27,148,23,0,-1,'asphalt','B'],
            [18,80,15,4.8,-4],[24,152,22,0,2,'asphalt','T'],[21,73,17,-5.5,15,'gravel'],[25,164,20,0,-6,'asphalt','B'],
            [16,77,20,6,-17],[25,172,24,0,5,'asphalt','T'],[16,75,20,3.8,-15,'gravel'],[16,119,19,0,-13,'gravel'],
            [20,85,16,-5.6,16],[22,61,20,0,11],[22,80,17,5.3,17],[27,108,17,0,12],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Campo Azul", short: "Campo Azul", theme: 'heath', seed: 7001253, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[17,40,20,0,14],[21,18,16,-2.5,-10],[23,183,19,0,5,'asphalt','B'],
            [19,71,17,5.1,-1],[23,179,24,0,-5,'asphalt','T'],[18,22,20,2.4,-1,'asphalt'],[19,180,23,0,4,'asphalt'],
            [20,20,19,-2.6,17],[23,26,17,0,-13],[22,59,18,4.1,-12],[25,39,18,0,16],
            [17,75,19,5.4,-18],[27,152,19,0,-5,'asphalt','T'],[19,80,15,-5.7,-6,'asphalt'],[25,145,21,0,4,'asphalt','B'],
            [16,74,20,5.3,-12],[26,144,18,0,5,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Cima Oeste", short: "Cima Oeste", theme: 'ember', seed: 7002218, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,186,20,0,-1,'asphalt','T'],[18,22,16,2.6,-2],[24,147,19,0,-1,'asphalt','T'],
            [22,61,20,-4.3,-4,'asphalt'],[16,109,21,0,7,'asphalt'],[21,73,19,-4.5,-11,'asphalt'],[25,39,19,0,-7],
            [21,44,21,2.5,-18],[25,165,21,0,-1,'asphalt','B'],[19,77,19,-4.6,1],[27,27,23,0,-7,'asphalt'],
            [16,64,15,4,-6],[27,150,24,0,5,'asphalt','B'],[21,26,20,2.6,6],[17,40,22,0,13],
            [18,83,21,5.9,1],[23,115,22,0,-3,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Playa Real", short: "Playa Real", theme: 'orchid', seed: 7000595, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,182,20,0,-4,'asphalt','T'],[22,65,18,-4.8,-17],[27,110,18,0,-4,'asphalt','T'],
            [17,29,19,2.5,14],[17,36,20,0,-18],[17,44,16,-3.1,-14],[24,159,18,0,-5,'asphalt','T'],
            [22,28,17,2.4,10],[22,35,17,0,3,'asphalt'],[20,83,20,4.8,18,'asphalt'],[17,36,20,0,2],
            [22,50,21,2.6,-4],[27,106,22,0,-1,'asphalt','B'],[16,79,19,-5.7,-17],[26,127,21,0,6,'asphalt','B'],
            [18,71,16,3.8,-18],[22,162,15,0,6,'asphalt'],[19,64,17,4,4],[25,187,16,0,13],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Alba Este", short: "Alba Este", theme: 'glacier', seed: 7002593, surface: 'snow',
        sections: [
            [0,60,0,0,0],[20,84,20,0,-17],[19,73,20,4,-4],[16,140,16,0,16,'asphalt'],
            [20,42,19,-2.4,3,'asphalt'],[22,172,18,0,6,'asphalt','B'],[17,75,20,-4.9,-1,'asphalt'],[25,163,23,0,4,'asphalt','B'],
            [19,40,18,2.2,-3],[21,49,20,0,-18],[17,87,17,5.7,17,'asphalt'],[18,39,16,0,18,'asphalt'],
            [22,34,21,-3,-18],[27,34,18,0,18],[19,51,21,2.7,-13],[23,113,19,0,0,'asphalt','T'],
            [21,67,20,3.8,-6],[19,135,16,0,-17],[22,70,19,-5,2],[23,176,22,0,1,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Campo Real", short: "Campo Real", theme: 'oasis', seed: 7103537, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[17,65,19,0,-8],[20,78,17,-5.6,-6],[27,146,21,0,-11],
            [16,86,15,5.1,9],[22,122,20,0,-4,'asphalt','T'],[16,37,18,-2.4,12,'asphalt'],[23,133,20,0,-4,'asphalt','B'],
            [21,59,18,3.3,-7],[22,29,22,0,0],[19,73,18,-4.7,16],[22,160,20,0,4,'asphalt','T'],
            [21,78,19,5.4,-6],[21,104,20,0,13],[17,27,19,2.7,15],[27,133,20,0,-2],
            [20,50,15,3,9],[25,119,21,0,-7],[20,59,15,-2.8,-10],[22,137,21,0,4,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Pico Verde", short: "Pico Verde", theme: 'amethyst', seed: 7004294, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,88,19,0,-13],[18,82,17,-4.8,0],[24,145,17,0,-18,'asphalt'],
            [17,49,15,3.1,14,'asphalt'],[23,154,24,0,5,'asphalt','B'],[21,80,16,5.7,17],[27,118,21,0,-4,'asphalt','T'],
            [18,56,15,-2.8,9],[16,123,17,0,-16,'asphalt'],[18,48,19,3,6,'asphalt'],[23,147,19,0,1,'asphalt','B'],
            [18,87,21,-5.8,-11],[17,87,23,0,3],[21,86,15,5.9,16],[24,103,23,0,1,'asphalt','T'],
            [18,46,16,-3.3,15],[21,23,19,0,12],[19,66,20,4.9,-2],[24,76,21,0,-5],
            [17,55,15,3.7,8],[27,70,18,0,17],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Puna Este", short: "Puna Este", theme: 'harbor2', seed: 7102726, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[20,109,21,0,14],[18,57,15,-3.5,11],[21,37,21,0,-12,'gravel'],
            [22,28,15,-2.7,1,'gravel'],[27,40,18,0,-2],[16,85,18,-5.6,-7],[18,149,17,0,-12],
            [17,79,15,4.7,9],[26,144,18,0,-4,'asphalt','T'],[21,85,17,-4.9,16,'gravel'],[25,168,23,0,5,'asphalt','T'],
            [20,81,15,6.1,-14,'gravel'],[19,192,15,0,12],[18,34,21,-2,-5],[25,176,23,0,3,'asphalt','B'],
            [20,47,16,2.6,16],[22,159,24,0,-2,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Cañón Azul", short: "Cañón Azul", theme: 'canyon2', seed: 7001689, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,45,22,0,-11],[19,75,17,-4.6,2],[26,107,24,0,4,'asphalt','B'],
            [19,51,20,-3.8,-12],[24,158,23,0,-5,'asphalt','T'],[22,82,16,4.8,-15,'asphalt'],[20,66,17,0,18,'asphalt'],
            [21,22,21,-2.5,-7,'asphalt'],[23,170,18,0,1,'asphalt','B'],[18,73,16,-5.2,-6],[27,39,22,0,-13],
            [19,65,19,-3.7,8,'asphalt'],[22,104,21,0,-3,'asphalt','T'],[16,58,20,3.8,18,'asphalt'],[25,28,16,0,3,'asphalt'],
            [20,68,16,3.8,-6],[19,71,16,0,-17],[16,83,18,6.2,-2],[20,32,21,0,18],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Duna Oeste", short: "Duna Oeste", theme: 'lake2', seed: 7100548, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[16,182,21,0,9],[19,68,20,-5.1,11],[26,20,22,0,4,'gravel'],
            [17,66,20,4,-12],[24,168,24,0,0,'asphalt','B'],[21,82,20,-5.8,-7],[23,117,20,0,0,'asphalt','T'],
            [20,68,20,4.3,0],[24,33,17,0,4],[17,53,18,3.2,3,'gravel'],[26,173,23,0,6,'asphalt','T'],
            [20,74,18,3.9,-13],[20,21,16,0,13],[17,71,16,-3.9,10],[25,100,22,0,6,'asphalt','T'],
            [16,80,18,5,10],[26,135,21,0,-3,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Duna Este", short: "Duna Este", theme: 'alpine2', seed: 7001538, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[26,71,15,0,-7],[17,41,21,3.2,12,'gravel'],[18,88,15,0,16],
            [21,30,16,-2.7,-10],[24,101,22,0,4,'asphalt','T'],[22,24,19,-2,14],[23,137,22,0,4,'asphalt','B'],
            [21,76,17,5.7,18],[26,168,22,0,-1,'asphalt','B'],[22,19,17,2.3,3,'gravel'],[21,32,23,0,12,'gravel'],
            [16,82,18,4.9,-14],[22,42,21,0,-8],[21,81,18,-6,-8],[17,30,19,0,-6],
            [20,30,18,-2.4,18],[27,132,23,0,4,'asphalt','T'],[21,50,18,-3.5,3],[24,120,22,0,4],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Mesa Real", short: "Mesa Real", theme: 'jungle2', seed: 7002534, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,121,20,0,5,'asphalt','T'],[19,83,17,5.7,-8],[25,189,21,0,5,'asphalt','T'],
            [21,39,21,-2.5,-14],[24,36,16,0,7],[20,32,18,2.2,10,'asphalt'],[25,147,21,0,0,'asphalt','B'],
            [19,74,21,-4.2,-7],[19,85,19,0,-10],[19,60,18,-3.2,-18],[26,188,15,0,12],
            [19,40,20,2.2,18],[20,58,22,0,-17],[22,84,16,5.2,-15,'asphalt'],[23,187,21,0,-2,'asphalt','T'],
            [16,85,16,-6,-9],[27,104,20,0,4,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Cruz Azul", short: "Cruz Azul", theme: 'dusk2', seed: 7101897, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[19,42,19,0,-1],[22,22,15,-2.5,7],[25,183,21,0,6,'asphalt','T'],
            [20,16,19,2.4,16],[20,24,22,0,15],[19,76,20,-5.3,0],[23,145,19,0,0,'asphalt','T'],
            [22,35,16,-2.4,-8],[25,131,18,0,-2,'asphalt','B'],[16,83,16,6.2,9],[24,116,18,0,-1,'asphalt','B'],
            [22,83,16,-5.9,11,'gravel'],[17,31,18,0,0,'gravel'],[22,41,19,3.2,12],[19,40,18,0,-11],
            [16,57,19,-2.7,12],[27,152,18,0,-12,'gravel'],[19,85,15,-5.6,3],[23,192,23,0,11],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Alba Oeste", short: "Alba Oeste", theme: 'neon2', seed: 7101278, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,52,16,0,15],[17,85,15,-5.1,-11],[17,113,22,0,6],
            [22,57,19,3.4,6,'gravel'],[25,205,21,0,6,'gravel'],[19,45,21,2.4,-11],[26,149,20,0,5,'asphalt','B'],
            [17,76,18,-5.9,0],[24,122,15,0,5],[21,44,21,2.8,13],[22,134,23,0,4,'asphalt','T'],
            [21,85,19,-5.2,13,'gravel'],[19,198,19,0,1,'gravel'],[20,25,18,2.1,-2],[22,143,23,0,2,'asphalt','T'],
            [22,32,20,-2.1,-17],[26,133,21,0,-4,'asphalt','B'],[17,79,16,4,-5],[23,118,19,0,-1],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Cueva Verde", short: "Cueva Verde", theme: 'autumn2', seed: 7103503, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[17,147,19,0,-17],[21,53,21,3.3,-2],[18,20,21,0,-14],
            [16,31,15,-1.9,-10],[27,23,22,0,10,'asphalt'],[16,80,18,6.3,-15,'asphalt'],[26,121,22,0,6,'asphalt','B'],
            [22,77,20,-6.2,13,'asphalt'],[22,186,21,0,5,'asphalt','T'],[20,88,19,5.8,-10],[27,114,19,0,-4,'asphalt','T'],
            [16,33,17,-2.5,-7],[20,84,17,0,11],[17,56,15,-3.5,-11],[23,166,18,0,2,'asphalt','T'],
            [18,73,16,4.2,12],[25,166,24,0,1,'asphalt','B'],[18,43,20,2.5,17],[23,20,21,0,-16],
            [19,24,19,2.1,-7],[16,61,22,0,7],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cruz Oeste", short: "Cruz Oeste", theme: 'dunes2', seed: 7100451, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,100,22,0,3,'asphalt','T'],[20,81,17,6.2,-13,'asphalt'],[22,146,19,0,6,'asphalt','B'],
            [20,79,21,-4.7,-9],[24,197,22,0,13],[19,88,18,5.8,-17],[20,147,17,0,-6,'asphalt'],
            [22,25,20,2.2,10],[25,113,21,0,-6,'asphalt','B'],[19,50,21,2.6,-17],[24,37,19,0,-9,'asphalt'],
            [19,57,18,-3.8,1],[21,141,15,0,10],[19,77,20,-5.6,-2],[23,152,21,0,1,'asphalt','T'],
            [16,29,17,2.4,16],[22,41,21,0,-4,'asphalt'],[18,33,16,2.5,-17],[25,168,18,0,3,'asphalt','T'],
            [18,82,17,5.7,-12],[21,91,17,0,6],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cerro Este", short: "Cerro Este", theme: 'frost2', seed: 7101403, surface: 'snow',
        sections: [
            [0,60,0,0,0],[27,117,21,0,0,'asphalt','T'],[20,19,21,-2.4,-2,'asphalt'],[27,176,23,0,-4,'asphalt','B'],
            [19,38,15,-3.1,9,'asphalt'],[22,163,24,0,4,'asphalt','T'],[20,68,19,5,-18],[16,91,19,0,-13,'asphalt'],
            [20,67,19,3.8,6,'asphalt'],[27,143,22,0,2,'asphalt','B'],[18,24,20,-2.3,-4],[20,168,21,0,-1],
            [21,82,15,5.6,-4],[26,102,18,0,4,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Faro Oeste", short: "Faro Oeste", theme: 'volcano2', seed: 7001945, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[23,119,23,0,2,'asphalt','T'],[21,29,19,2,-13],[18,23,19,0,-16],
            [20,70,21,-5.3,8],[26,80,22,0,-6],[20,54,19,-3.8,-9,'asphalt'],[23,36,19,0,-14,'asphalt'],
            [20,72,21,4.3,13],[27,104,18,0,6,'asphalt','B'],[21,81,21,-4.9,0,'asphalt'],[25,125,21,0,16],
            [17,87,15,5.1,5],[23,121,24,0,-1,'asphalt','T'],[21,35,17,2,-10,'asphalt'],[21,182,23,0,6],
            [16,85,16,5,-14],[23,187,24,0,1,'asphalt','B'],[16,51,15,-3.3,17],[25,182,24,0,-3,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Faro Este", short: "Faro Este", theme: 'sakura2', seed: 7001770, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[23,166,24,0,-2,'asphalt','T'],[22,71,16,-5,-14],[26,183,18,0,-2,'asphalt','T'],
            [22,38,17,2.2,12],[23,63,20,0,7],[18,84,17,-5.9,-6,'asphalt'],[24,75,15,0,7],
            [19,28,19,2.5,11],[26,137,19,0,-9],[20,53,18,-3,-18],[22,105,21,0,3,'asphalt','B'],
            [16,30,15,-2.6,-3],[23,187,19,0,-5,'asphalt','B'],[18,71,19,-4.5,3],[23,173,18,0,-8,'asphalt'],
            [21,79,16,6.3,-11,'asphalt'],[19,101,23,0,-3],[20,50,16,-3.5,5],[25,25,23,0,3],
            [19,65,21,4,3],[26,148,23,0,10],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Cruz Real", short: "Cruz Real", theme: 'savanna2', seed: 7002806, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,126,22,0,2,'asphalt','T'],[17,33,16,2.1,2,'asphalt'],[25,117,21,0,-6,'asphalt','B'],
            [19,74,16,-5.5,-7],[27,59,16,0,18],[21,81,19,5.9,6,'asphalt'],[18,66,21,0,11,'asphalt'],
            [19,24,17,2.1,-18],[17,147,23,0,-6],[21,40,18,-2.1,-8],[22,54,20,0,-12],
            [21,72,18,4.8,-13],[27,160,19,0,1,'asphalt','B'],[22,73,19,3.7,-16],[24,142,22,0,-2,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Selva Azul", short: "Selva Azul", theme: 'swamp2', seed: 7001924, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,177,21,0,-4,'asphalt','B'],[22,43,15,3.3,1],[17,147,19,0,7],
            [22,89,16,5.8,-15],[20,187,22,0,-7],[19,81,19,-5.4,18],[27,18,23,0,-18,'asphalt'],
            [20,67,15,3.5,-6,'asphalt'],[20,97,15,0,-13],[16,50,20,3.2,-8],[27,31,18,0,17],
            [21,59,19,-3.7,-11,'asphalt'],[25,140,19,0,3,'asphalt','T'],[22,85,21,5.4,-12],[26,109,24,0,0,'asphalt','B'],
            [22,40,17,2.7,12],[26,109,22,0,-4,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Bahía Azul", short: "Bahía Azul", theme: 'dawn2', seed: 7103330, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[24,179,19,0,-4,'asphalt','T'],[22,53,17,3.4,-7,'gravel'],[26,110,21,0,-2,'asphalt','T'],
            [17,90,15,-5.7,8,'gravel'],[23,166,24,0,4,'asphalt','B'],[21,32,18,2,17],[16,120,21,0,-15],
            [18,59,20,-4.3,17],[21,96,22,0,17],[19,79,19,5.7,16],[26,132,21,0,-3,'asphalt','B'],
            [18,74,16,3.7,-5],[25,165,24,0,-3,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Isla Real", short: "Isla Real", theme: 'mist2', seed: 7002730, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[16,148,23,0,5],[16,23,21,-2.3,-15],[25,162,17,0,8,'asphalt'],
            [22,80,20,5.9,-14,'asphalt'],[26,112,21,0,4,'asphalt','B'],[20,58,20,-3.7,-7],[18,25,16,0,10],
            [16,53,20,-3,17],[23,130,21,0,-2,'asphalt','B'],[17,44,15,-3.3,0],[26,164,22,0,4,'asphalt','T'],
            [19,26,21,-2.7,-14],[25,22,18,0,-3],[22,74,21,-5.6,3,'asphalt'],[22,152,20,0,0,'asphalt','T'],
            [20,78,18,5.7,-5],[27,166,24,0,6,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Selva Norte", short: "Selva Norte", theme: 'redrock2', seed: 7103984, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[23,153,23,0,-3,'asphalt','B'],[17,23,20,2.1,7,'asphalt'],[26,81,15,0,7,'asphalt'],
            [18,85,18,5.6,-13],[26,161,19,0,4],[18,72,21,-4.4,6,'asphalt'],[22,166,19,0,3,'asphalt','T'],
            [21,37,18,-2.1,3],[25,30,20,0,9],[21,75,16,5.2,-16],[26,137,19,0,-17],
            [17,73,20,4.4,-18],[22,134,24,0,1,'asphalt','B'],[22,66,19,-4.1,17],[25,172,19,0,-3,'asphalt','T'],
            [18,26,20,2.2,18],[23,140,19,0,2,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Pampa Gris", short: "Pampa Gris", theme: 'tundra2', seed: 7100804, surface: 'snow',
        sections: [
            [0,60,0,0,0],[20,52,15,0,-5],[20,45,18,2.6,-4],[21,23,23,0,11],
            [16,79,18,5.4,-3],[23,114,20,0,0,'asphalt','B'],[18,22,16,2.4,0,'asphalt'],[26,151,18,0,4,'asphalt','B'],
            [16,60,16,3.9,-7],[26,103,20,0,2,'asphalt','T'],[19,30,15,2.8,-1],[22,195,17,0,-6],
            [18,80,17,4.8,-3,'asphalt'],[22,142,19,0,1,'asphalt','T'],[16,52,20,3.8,-15],[20,141,22,0,-15,'asphalt'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Loma Oeste", short: "Loma Oeste", theme: 'moon2', seed: 7001980, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[24,84,15,0,-6],[22,48,16,2.8,-5],[27,23,19,0,-10],
            [16,82,21,-4.7,-4],[21,85,19,0,-6],[17,44,18,-2.7,15],[26,109,19,0,-2,'asphalt','B'],
            [22,87,20,-5.7,7],[24,104,23,0,4,'asphalt','T'],[20,83,19,5.6,-9],[19,19,15,0,16],
            [17,55,21,-2.8,18,'asphalt'],[22,117,23,0,-1,'asphalt','T'],[18,39,20,-3.2,-2],[25,31,15,0,13],
            [22,38,18,2.7,5,'asphalt'],[24,172,19,0,-4,'asphalt','B'],[16,83,20,4.5,16],[18,181,20,0,-14],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cruz Este", short: "Cruz Este", theme: 'coast2', seed: 7100203, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[16,99,18,0,2],[19,90,15,5.8,-10],[22,131,18,0,-8],
            [21,49,21,3.5,-11],[24,155,19,0,-15],[21,90,15,-5.6,6,'gravel'],[22,142,20,0,-2,'asphalt','B'],
            [21,83,16,5.9,17,'gravel'],[26,177,18,0,-2,'asphalt','T'],[22,71,18,4.1,7],[24,140,18,0,2,'asphalt','B'],
            [19,60,17,2.9,-9,'gravel'],[22,150,23,0,6,'asphalt','T'],[22,34,20,-2.8,5],[23,205,17,0,2],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Cala Este", short: "Cala Este", theme: 'vineyard2', seed: 7101823, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,188,21,0,-2,'asphalt','T'],[22,73,20,-4.4,-11],[27,125,24,0,-3,'asphalt','T'],
            [19,70,19,-4.9,17],[18,19,19,0,0],[18,88,21,5.8,5,'asphalt'],[23,40,16,0,-3,'asphalt'],
            [18,59,21,4.2,-16],[23,188,17,0,-1],[22,31,18,-2.1,-1,'asphalt'],[27,149,18,0,8],
            [16,58,20,3.7,-3,'asphalt'],[27,122,20,0,-6,'asphalt','T'],[17,62,20,3.8,1],[23,157,24,0,-6,'asphalt','B'],
            [21,54,19,-3.2,-4],[23,136,24,0,3,'asphalt','B'],[16,74,17,4.4,13],[22,112,19,0,6],
            [20,70,18,4.4,16],[27,51,20,0,15],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Salto Sur", short: "Salto Sur", theme: 'bamboo2', seed: 7004368, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,147,22,0,-2,'asphalt','T'],[22,87,20,5.5,-10],[25,141,24,0,-5,'asphalt','B'],
            [22,37,20,2.7,0,'asphalt'],[24,181,22,0,-5,'asphalt','B'],[21,28,21,-1.9,-6],[24,159,18,0,2,'asphalt','T'],
            [17,56,16,-3.2,11],[22,152,15,0,-11],[17,71,20,3.8,15],[18,42,20,0,7],
            [20,85,16,-5.4,7],[21,32,16,0,1,'asphalt'],[21,33,18,-2.6,-11],[19,121,20,0,17],
            [17,57,20,-3.1,0],[25,126,16,0,-9],[21,52,16,2.5,-15],[23,141,19,0,-2,'asphalt','T'],
            [16,81,16,-5.2,4,'asphalt'],[20,112,19,0,-4,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Lago Sur", short: "Lago Sur", theme: 'salt2', seed: 7100298, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,111,19,0,-4,'asphalt','T'],[19,68,15,-4.9,0],[17,29,18,0,-16],
            [21,69,18,5.2,-14],[27,131,19,0,3,'asphalt','B'],[21,79,19,-5.2,16],[18,175,21,0,1,'asphalt'],
            [21,59,17,-4.2,4],[20,42,18,0,-6],[16,33,16,-1.9,10],[25,106,22,0,1,'asphalt','B'],
            [18,85,20,6,4],[21,98,22,0,12,'asphalt'],[21,67,20,-3.7,-5],[26,145,21,0,3,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Puna Azul", short: "Puna Azul", theme: 'prairie2', seed: 7104396, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,116,21,0,3,'asphalt','T'],[16,83,15,-5.9,0],[25,183,21,0,6,'asphalt','T'],
            [16,81,16,4.3,18],[25,153,20,0,4,'asphalt','B'],[18,20,19,2.3,-13,'asphalt'],[21,96,19,0,-16],
            [17,71,18,-3.9,2],[20,127,23,0,-14,'asphalt'],[17,26,15,-2.2,-5],[24,40,15,0,-17],
            [16,68,20,-4.6,-5],[22,161,21,0,-4,'asphalt','B'],[19,89,16,-5.6,-5],[24,118,17,0,8,'asphalt'],
            [0,60,0,0,0,'asphalt']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cerro Real", short: "Cerro Real", theme: 'aurora2', seed: 7002740, surface: 'snow',
        sections: [
            [0,60,0,0,0],[26,150,16,0,-7],[22,72,16,-4.8,13,'asphalt'],[24,151,21,0,0,'asphalt','T'],
            [19,72,18,5.3,12,'asphalt'],[22,131,19,0,-5,'asphalt','B'],[19,67,20,3.6,2],[22,138,20,0,-1,'asphalt','T'],
            [21,58,16,-3.8,18,'asphalt'],[25,127,22,0,4,'asphalt','B'],[21,69,15,5,9,'asphalt'],[16,177,21,0,11,'asphalt'],
            [22,73,18,4.6,12],[25,167,19,0,-6,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Cima Real", short: "Cima Real", theme: 'storm2', seed: 7001768, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[22,153,21,0,-2,'asphalt','B'],[22,22,16,2.3,12],[17,143,15,0,-15],
            [22,80,15,-6.4,1],[27,158,23,0,-6,'asphalt','T'],[18,26,16,-2.4,10,'gravel'],[24,139,21,0,5,'asphalt','T'],
            [17,33,19,-2.5,6,'gravel'],[23,167,19,0,0,'asphalt','T'],[20,73,16,4.5,14],[23,152,22,0,4],
            [21,79,21,5.3,4],[22,129,22,0,-3,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Lago Oeste", short: "Lago Oeste", theme: 'heath2', seed: 7101128, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,116,18,0,0,'asphalt','T'],[22,20,18,2.3,6,'asphalt'],[22,168,24,0,5,'asphalt','T'],
            [21,78,15,5.9,-11],[22,122,23,0,1,'asphalt','B'],[18,30,15,-2.6,-14,'asphalt'],[21,39,17,0,-1],
            [21,84,15,-5.5,-10],[25,171,19,0,0,'asphalt','T'],[17,84,21,5.4,12],[23,62,19,0,-7],
            [22,54,20,-2.9,-10],[21,25,22,0,-1,'asphalt'],[21,84,19,6,3],[19,27,16,0,-13],
            [16,67,17,-3.8,12],[23,201,17,0,-6],[17,80,17,-4.6,13],[27,186,19,0,-2,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Pampa Real", short: "Pampa Real", theme: 'ember2', seed: 7103390, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,106,24,0,-3,'asphalt','T'],[17,82,17,-5.8,-8],[25,171,20,0,3,'asphalt','B'],
            [21,78,18,6.2,-9,'asphalt'],[21,206,16,0,10],[18,57,19,-3.6,-15],[18,198,16,0,-11],
            [20,40,15,2.9,18],[18,28,23,0,6],[16,60,16,3.8,18],[24,23,23,0,-17],
            [17,71,19,-5.2,0],[25,34,20,0,-10],[22,57,17,-2.7,5],[16,192,20,0,17],
            [16,46,20,-2.5,18],[25,138,23,0,-5,'asphalt','B'],[19,67,19,-3.9,-6],[22,189,24,0,-2,'asphalt','T'],
            [19,32,15,2.2,-6,'asphalt'],[22,21,16,0,-1,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cañón Oeste", short: "Cañón Oeste", theme: 'orchid2', seed: 7000250, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,153,18,0,-5,'asphalt','T'],[20,70,17,-4.8,-5],[22,150,19,0,1,'asphalt','T'],
            [22,79,21,6.2,12],[16,177,17,0,10],[17,61,15,-3.7,-18,'asphalt'],[26,101,20,0,0,'asphalt','T'],
            [20,54,21,-3.1,-9],[20,59,21,0,-7],[16,88,19,5.8,8],[25,198,18,0,12],
            [17,33,20,-2.3,-6],[16,127,18,0,-4],[18,84,21,5.6,-12,'asphalt'],[25,105,21,0,-6,'asphalt','B'],
            [20,78,20,-5.2,-16],[23,168,22,0,-3,'asphalt','B'],[17,36,20,-2.3,18],[26,149,19,0,-10],
            [17,82,21,-6.1,12],[27,110,17,0,-14],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Puna Real", short: "Puna Real", theme: 'glacier2', seed: 7100382, surface: 'snow',
        sections: [
            [0,60,0,0,0],[21,39,22,0,12],[20,15,20,-2.5,3,'asphalt'],[25,85,21,0,0],
            [16,48,15,3,-12],[23,106,18,0,-4,'asphalt','T'],[16,78,15,-3.9,9,'asphalt'],[27,184,19,0,-4,'asphalt','T'],
            [17,45,17,-3.4,-18],[26,156,24,0,3,'asphalt','B'],[20,38,19,2.3,5],[24,166,19,0,4,'asphalt','T'],
            [18,81,16,-5.3,4],[20,197,19,0,-2],[16,23,21,2.2,-16],[25,20,17,0,12],
            [18,76,20,-4.9,11],[21,157,21,0,3],[21,89,16,5.9,15],[22,117,18,0,4,'asphalt','B'],
            [22,54,16,-3.9,9],[20,73,16,0,-13,'asphalt'],[0,60,0,0,0,'asphalt']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Bahía Real", short: "Bahía Real", theme: 'oasis2', seed: 7003018, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[24,150,18,0,-2,'asphalt','T'],[21,69,15,4.4,3],[26,122,22,0,4,'asphalt','T'],
            [18,34,16,-2.1,10],[22,129,19,0,-1,'asphalt','B'],[20,59,18,-4.2,7],[26,179,16,0,-6],
            [16,81,18,6.2,-12,'asphalt'],[24,125,20,0,-7,'asphalt'],[20,27,16,2,8,'asphalt'],[22,102,18,0,-1],
            [16,77,18,-4.4,12],[25,105,19,0,6,'asphalt','B'],[22,71,21,-5.1,0],[26,120,24,0,3,'asphalt','T'],
            [19,55,20,3.7,5,'asphalt'],[16,153,16,0,14,'asphalt'],[21,56,15,2.8,-4],[27,179,23,0,11],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Salto Este", short: "Salto Este", theme: 'amethyst2', seed: 7002654, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[21,149,21,0,0],[16,82,20,-5.1,-5],[23,109,20,0,6,'asphalt','B'],
            [18,79,17,5.4,1],[23,152,20,0,-5,'asphalt','T'],[20,80,20,-5.6,2],[23,174,21,0,-1,'asphalt','T'],
            [20,26,16,-2.1,-16],[23,184,22,0,-6,'asphalt','B'],[17,81,15,-6,-6],[19,143,23,0,-15,'asphalt'],
            [19,81,17,6.2,13,'asphalt'],[26,34,20,0,5],[22,20,20,-2.6,-7],[18,38,17,0,-6],
            [22,68,17,3.7,17],[24,139,24,0,5,'asphalt','T'],[18,69,21,-4.6,-8,'asphalt'],[19,23,20,0,18,'asphalt'],
            [19,41,17,-2.7,-5],[23,69,19,0,-9],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Valle Sur", short: "Valle Sur", theme: 'harbor3', seed: 7104340, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[24,137,20,0,0,'asphalt','B'],[21,57,20,2.9,-1],[18,171,20,0,-11,'gravel'],
            [20,85,18,5.9,11,'gravel'],[25,164,18,0,-6,'asphalt','T'],[20,83,15,-5.8,-12],[23,180,23,0,0,'asphalt','T'],
            [18,82,19,5.2,4],[23,178,20,0,5,'asphalt','B'],[22,82,17,-6.1,16],[19,40,18,0,2,'gravel'],
            [18,79,21,5,-1,'gravel'],[17,150,16,0,-11],[16,44,20,2.6,2,'gravel'],[25,26,22,0,2],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Bahía Este", short: "Bahía Este", theme: 'canyon3', seed: 7002860, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,131,24,0,-1,'asphalt','T'],[19,82,21,-4.9,-8],[24,105,19,0,2,'asphalt','T'],
            [19,89,18,5.6,-14,'asphalt'],[27,131,20,0,-4,'asphalt','B'],[18,77,15,-4.8,13],[26,126,21,0,-1,'asphalt','B'],
            [17,88,21,5.5,-10],[24,19,22,0,-5],[16,35,15,2.2,-11],[19,172,15,0,-11,'asphalt'],
            [21,55,21,3,15,'asphalt'],[27,125,18,0,0,'asphalt','T'],[22,30,20,-2.6,17],[16,182,15,0,17],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Selva Gris", short: "Selva Gris", theme: 'lake3', seed: 7003158, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[26,111,22,0,-6,'asphalt','T'],[22,77,19,6.2,-6],[17,41,21,0,-13],
            [20,29,18,2.2,5],[17,39,17,0,16,'gravel'],[19,66,17,4.5,-1,'gravel'],[22,86,19,0,12,'gravel'],
            [19,18,17,2.5,4],[27,153,21,0,-5,'asphalt','B'],[16,73,20,4.4,-4],[27,187,18,0,-3,'asphalt','T'],
            [18,71,20,-5.1,18],[25,184,21,0,3,'asphalt','T'],[19,45,18,-3.2,-2],[22,137,20,0,8,'gravel'],
            [17,68,18,-4.8,14],[22,143,18,0,6,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Bahía Sur", short: "Bahía Sur", theme: 'alpine3', seed: 7104074, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,101,16,0,12],[22,19,21,-2.1,-2],[25,168,23,0,-3,'asphalt','B'],
            [19,75,16,-4.1,-5],[22,42,15,0,-5,'gravel'],[18,78,16,4.8,-3],[23,121,19,0,-6,'asphalt','T'],
            [19,74,18,5,-5],[22,175,20,0,-18],[19,39,17,-3.2,6],[27,190,22,0,-4,'asphalt','T'],
            [19,73,18,-4.2,12,'gravel'],[26,78,21,0,-10,'gravel'],[20,54,19,-3.3,0],[24,184,19,0,-1,'asphalt','B'],
            [19,19,20,2.4,5],[16,35,20,0,16],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Cerro Sur", short: "Cerro Sur", theme: 'jungle3', seed: 7104349, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,71,18,0,-1],[19,80,17,5.5,9,'asphalt'],[21,128,23,0,18],
            [18,36,19,2.1,4],[22,141,18,0,4,'asphalt','B'],[21,81,21,-5.9,-3],[16,140,19,0,-18],
            [19,40,20,-3.2,13,'asphalt'],[26,113,21,0,-6,'asphalt','T'],[18,71,16,3.9,13],[23,128,24,0,5,'asphalt','B'],
            [16,84,17,-5.3,13],[20,41,21,0,10],[20,41,15,-3,-13],[19,34,16,0,-7],
            [18,79,18,4.1,1,'asphalt'],[25,154,22,0,1,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Faro Norte", short: "Faro Norte", theme: 'dusk3', seed: 7103253, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[24,58,23,0,4],[19,68,18,4.3,1],[25,29,15,0,17,'gravel'],
            [16,72,15,-4.4,-13,'gravel'],[25,154,24,0,-6,'asphalt','B'],[18,80,20,5.5,14],[24,140,21,0,-6,'asphalt','B'],
            [19,68,20,-4.2,9],[27,126,24,0,-1,'asphalt','T'],[20,82,17,-5.4,-15],[23,104,18,0,5,'asphalt','T'],
            [20,40,20,3.3,-4],[25,130,22,0,-5,'asphalt','T'],[17,82,21,-5,2],[17,31,17,0,-7,'gravel'],
            [20,68,21,4,-9],[20,40,20,0,-16],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Duna Norte", short: "Duna Norte", theme: 'neon3', seed: 7100532, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,151,24,0,6,'asphalt','B'],[16,53,21,2.5,4,'gravel'],[18,18,20,0,6],
            [17,42,16,2.8,3],[24,100,24,0,-5,'asphalt','B'],[20,82,16,-6.1,18],[24,145,21,0,0,'asphalt','T'],
            [16,57,19,-2.9,2],[23,39,18,0,-15,'gravel'],[20,44,17,-3.3,13,'gravel'],[18,50,18,0,-13],
            [19,81,16,6.3,7],[21,53,17,0,-2],[21,68,21,-4.8,3],[23,110,17,0,14],
            [19,69,15,-4,14],[26,175,19,0,3,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cerro Norte", short: "Cerro Norte", theme: 'autumn3', seed: 7102170, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,153,24,0,-2,'asphalt','B'],[19,77,16,5.4,0],[22,146,21,0,-6,'asphalt','B'],
            [21,82,15,4.6,-10,'asphalt'],[24,36,20,0,-11],[16,77,17,-6,-9,'asphalt'],[18,148,21,0,13],
            [16,90,16,5.3,5],[16,156,15,0,8],[18,54,17,2.9,-10],[23,139,21,0,-4,'asphalt','T'],
            [17,29,18,-2.5,-11],[25,65,18,0,-11],[22,21,17,2.3,6],[26,155,20,0,18],
            [16,88,15,-5.1,2],[19,30,16,0,-5],[21,32,19,2.9,-18,'asphalt'],[22,126,24,0,-4,'asphalt','T'],
            [17,55,20,-3.8,3,'asphalt'],[21,103,20,0,17,'asphalt'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Pampa Norte", short: "Pampa Norte", theme: 'dunes3', seed: 7104457, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,183,18,0,-2,'asphalt','T'],[22,49,18,-2.8,-7,'asphalt'],[22,39,20,0,-15],
            [16,63,20,-3.7,3],[23,132,20,0,2,'asphalt','T'],[21,69,20,3.8,14],[24,142,16,0,-16],
            [22,84,18,6,-5,'asphalt'],[23,110,18,0,2,'asphalt','B'],[19,77,19,-5.9,16,'asphalt'],[24,107,20,0,6,'asphalt','B'],
            [20,72,18,5.4,18],[22,174,21,0,6,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Cueva Este", short: "Cueva Este", theme: 'frost3', seed: 7001718, surface: 'snow',
        sections: [
            [0,60,0,0,0],[26,103,19,0,-3,'asphalt','T'],[17,73,17,3.9,-18,'asphalt'],[27,128,18,0,0,'asphalt','T'],
            [16,45,19,-3,15],[27,31,17,0,10],[20,87,17,5.4,-11,'asphalt'],[23,168,20,0,-4,'asphalt','B'],
            [19,27,15,2,8],[17,52,17,0,-3],[20,74,16,-4.7,3],[24,102,22,0,-12],
            [22,80,15,-4.7,9],[26,170,20,0,-6,'asphalt','T'],[16,79,18,6.2,-15,'asphalt'],[22,178,23,0,0,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Roca Real", short: "Roca Real", theme: 'volcano3', seed: 7102270, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,117,19,0,16],[19,74,21,5.5,-17],[27,157,23,0,2,'asphalt','B'],
            [21,60,15,-3.9,11],[26,139,19,0,6,'asphalt','T'],[17,50,17,-2.4,-10],[25,138,20,0,3,'asphalt','T'],
            [22,31,16,-2.6,18,'asphalt'],[19,108,18,0,15,'asphalt'],[18,52,15,-2.9,-12],[24,19,17,0,4],
            [19,26,19,2.7,16],[22,26,15,0,0],[17,35,18,2.1,10],[22,104,24,0,-1,'asphalt','B'],
            [16,76,15,-4.9,8],[24,82,23,0,-12,'asphalt'],[21,63,16,-3.9,-16],[23,152,18,0,-10],
            [22,78,21,6.3,18],[25,130,20,0,6,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Faro Real", short: "Faro Real", theme: 'sakura3', seed: 7100264, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,107,24,0,3,'asphalt','T'],[17,87,17,5.1,12,'asphalt'],[27,187,24,0,-2,'asphalt','T'],
            [20,87,16,-5.7,-17],[24,126,23,0,2,'asphalt','B'],[19,89,15,5.6,18],[18,105,15,0,-11],
            [19,50,17,2.4,3],[27,173,17,0,-2],[19,78,16,-4.8,-5],[26,197,20,0,-4,'asphalt'],
            [22,66,18,-4.2,4,'asphalt'],[25,40,19,0,-12,'asphalt'],[21,60,21,3.5,0,'asphalt'],[25,22,19,0,-8],
            [22,82,16,-5.4,-1],[22,137,18,0,5,'asphalt','B'],[20,78,20,-6.4,-10],[21,19,15,0,6],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Loma Este", short: "Loma Este", theme: 'savanna3', seed: 7100732, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[19,167,16,0,16],[21,72,19,-5.4,16],[17,25,16,0,16,'asphalt'],
            [20,43,16,-2.6,-13,'asphalt'],[26,153,21,0,3,'asphalt','B'],[19,65,18,4.5,9,'asphalt'],[26,102,22,0,6,'asphalt','B'],
            [21,74,21,4.2,-16],[25,184,18,0,-6,'asphalt','T'],[19,83,17,-5.7,7],[21,169,18,0,-14],
            [19,45,20,-3.4,-6],[22,143,21,0,6,'asphalt','T'],[22,80,20,5,-15,'asphalt'],[18,29,15,0,-8,'asphalt'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Roca Azul", short: "Roca Azul", theme: 'swamp3', seed: 7002802, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,42,16,0,13],[16,48,21,2.5,2],[17,122,16,0,16],
            [21,16,16,-2.5,1],[21,39,22,0,-11],[20,77,17,4.1,18],[25,186,24,0,4,'asphalt','B'],
            [17,80,15,-6.2,14,'asphalt'],[24,171,22,0,-5,'asphalt','B'],[22,55,16,-2.9,0],[16,42,22,0,9],
            [21,82,15,5.9,-17],[27,120,24,0,-5,'asphalt','T'],[19,63,19,-3.7,-2],[27,66,18,0,4],
            [22,70,18,5,5],[25,98,15,0,6],[21,25,17,2.6,0,'asphalt'],[25,187,20,0,-3,'asphalt','T'],
            [20,63,20,3.3,8],[22,172,19,0,1],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Loma Sur", short: "Loma Sur", theme: 'dawn3', seed: 7100758, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[23,151,20,0,-2,'asphalt','T'],[17,53,19,-3.4,-5],[23,132,24,0,4,'asphalt','T'],
            [17,56,20,3.5,3,'gravel'],[19,116,15,0,-4,'gravel'],[16,88,16,-5.3,-4],[21,42,20,0,-11],
            [22,19,20,-2.6,2,'gravel'],[22,100,21,0,-14,'gravel'],[19,73,15,5.1,18],[27,189,22,0,-4,'asphalt','B'],
            [20,32,21,-2.3,-7],[22,122,18,0,-4,'asphalt','B'],[22,87,18,5.5,4],[22,26,18,0,14],
            [16,43,17,2.8,9,'gravel'],[25,108,16,0,11,'gravel'],[19,71,16,-3.4,-12],[22,140,19,0,-1,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Pampa Sur", short: "Pampa Sur", theme: 'mist3', seed: 7100112, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,106,21,0,1,'asphalt','B'],[18,71,16,-4.2,16],[27,175,23,0,-1,'asphalt','T'],
            [22,53,20,-3.4,6],[18,38,19,0,17,'asphalt'],[22,80,18,5.2,7],[20,164,22,0,14,'asphalt'],
            [21,28,19,-2.3,-11],[24,141,22,0,2,'asphalt','T'],[22,79,15,6,9],[26,175,18,0,-4,'asphalt','T'],
            [19,86,16,-5.9,3,'asphalt'],[27,172,19,0,-2,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Playa Verde", short: "Playa Verde", theme: 'redrock3', seed: 7103148, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[25,172,17,0,5],[18,80,18,-5.1,-5],[20,130,22,0,-12],
            [20,37,15,2,-8],[18,208,20,0,-10,'asphalt'],[21,56,16,2.7,-9,'asphalt'],[24,182,20,0,-1,'asphalt','B'],
            [18,28,17,-2.2,12,'asphalt'],[16,37,17,0,11],[18,83,16,5.7,-14,'asphalt'],[23,164,22,0,-4,'asphalt','T'],
            [20,53,19,-3.5,5],[25,202,15,0,-4],[16,48,21,3.4,-4],[24,153,22,0,6,'asphalt','B'],
            [16,82,20,5.9,10],[24,144,22,0,-3,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cueva Sur", short: "Cueva Sur", theme: 'tundra3', seed: 7003625, surface: 'snow',
        sections: [
            [0,60,0,0,0],[26,141,22,0,-5,'asphalt','T'],[21,79,16,6,18],[27,135,23,0,-4,'asphalt','T'],
            [19,81,20,-6.2,9],[19,204,19,0,9],[21,70,20,-4.4,5],[27,110,18,0,-8],
            [22,26,15,-2.3,3],[27,24,16,0,-9],[17,62,20,-4.1,1],[22,21,21,0,-5],
            [18,66,16,3.7,3],[22,129,23,0,2,'asphalt','B'],[20,71,17,-3.9,14,'asphalt'],[17,185,23,0,-17,'asphalt'],
            [17,46,16,3.2,11],[27,103,20,0,-4,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Loma Gris", short: "Loma Gris", theme: 'moon3', seed: 7101016, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[23,175,19,0,13],[17,74,20,4,16,'asphalt'],[19,63,23,0,18],
            [22,61,21,4,1],[24,41,22,0,13],[17,52,17,-3.2,5,'asphalt'],[26,114,18,0,-4,'asphalt','B'],
            [20,66,16,-3.5,-18],[27,108,23,0,5,'asphalt','B'],[16,85,18,-5.9,-17],[18,98,15,0,-11],
            [18,64,19,4.2,8],[23,187,21,0,-2,'asphalt','T'],[16,56,16,3.9,15],[24,54,22,0,-6],
            [19,79,20,-6.1,12],[25,111,22,0,2,'asphalt','T'],[22,44,16,3.1,8],[25,99,18,0,6],
            [16,49,19,2.5,-13],[18,28,22,0,-5],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Cima Norte", short: "Cima Norte", theme: 'coast3', seed: 7000107, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[24,127,21,0,2,'asphalt','T'],[16,85,15,-4.6,9],[27,163,23,0,-5,'asphalt','B'],
            [16,33,19,-2.6,13,'gravel'],[26,159,23,0,16,'gravel'],[20,79,18,-4.7,-10,'gravel'],[19,154,17,0,5],
            [19,73,21,5,1],[17,39,21,0,-14],[20,86,19,-5.9,10],[20,145,23,0,-16,'gravel'],
            [17,32,19,1.9,1],[24,149,18,0,3,'asphalt','B'],[16,85,18,6.1,2],[26,124,24,0,3,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Isla Sur", short: "Isla Sur", theme: 'vineyard3', seed: 7001262, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[23,120,20,0,-5,'asphalt','T'],[17,75,17,3.9,1],[23,146,22,0,6],
            [19,65,21,-3.7,8],[22,65,21,0,4],[17,42,15,-2.7,-6,'asphalt'],[17,100,16,0,11,'asphalt'],
            [18,86,16,-5.9,18],[16,132,20,0,-8],[20,74,17,5.1,-4,'asphalt'],[23,202,19,0,-15,'asphalt'],
            [22,43,16,3,16],[24,113,21,0,1,'asphalt','T'],[19,33,19,2.4,-12],[23,127,22,0,3,'asphalt','B'],
            [22,65,20,5,-9],[19,181,19,0,13],[16,31,21,-2.3,14],[26,129,23,0,2,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cala Sur", short: "Cala Sur", theme: 'bamboo3', seed: 7001754, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,158,24,0,3,'asphalt','B'],[16,85,21,-6,7,'asphalt'],[23,156,24,0,-5,'asphalt','T'],
            [18,34,18,2.9,-11],[25,106,24,0,-2,'asphalt','T'],[17,87,19,-5.7,1],[17,187,22,0,-18],
            [21,81,21,5.2,-12,'asphalt'],[16,41,18,0,18,'asphalt'],[17,23,21,2.4,-4],[23,140,20,0,5,'asphalt','B'],
            [18,33,21,-2.2,-1],[20,187,20,0,2],[22,72,18,-5.4,14,'asphalt'],[18,36,22,0,-14],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Cala Gris", short: "Cala Gris", theme: 'salt3', seed: 7004457, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,114,21,0,16],[21,28,20,1.9,-17],[23,101,19,0,-18,'asphalt'],
            [20,74,20,-3.9,-8],[23,179,19,0,-2,'asphalt','B'],[18,73,19,-5.2,-6],[27,136,24,0,-1,'asphalt','B'],
            [20,89,15,5.7,15,'asphalt'],[24,25,19,0,-5],[19,27,15,2.3,16],[22,121,21,0,6,'asphalt','T'],
            [17,71,18,-3.5,-7],[26,139,23,0,-3,'asphalt'],[22,79,21,6,13],[27,142,22,0,1,'asphalt','T'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Río Norte", short: "Río Norte", theme: 'prairie3', seed: 7103414, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[27,88,21,0,-3],[18,77,20,5.1,-5],[24,150,20,0,6,'asphalt','T'],
            [16,30,19,-1.9,-9,'asphalt'],[25,190,21,0,-1,'asphalt','B'],[19,25,21,2.3,1],[22,122,20,0,3,'asphalt','B'],
            [19,82,18,5,10,'asphalt'],[24,179,19,0,0,'asphalt','T'],[20,82,17,4.8,-15],[21,22,23,0,1],
            [22,79,16,-5.9,-16],[24,162,23,0,3,'asphalt','T'],[19,32,16,2.5,-5,'asphalt'],[20,24,15,0,11],
            [21,75,21,-4.5,-12,'asphalt'],[26,146,22,0,10],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Playa Oeste", short: "Playa Oeste", theme: 'aurora3', seed: 7101655, surface: 'snow',
        sections: [
            [0,60,0,0,0],[16,96,20,0,5],[20,85,15,-5,-17],[20,82,18,0,-14],
            [21,81,20,5,18],[24,190,16,0,-15,'asphalt'],[17,52,15,3.1,-9,'asphalt'],[23,104,20,0,-4,'asphalt','T'],
            [20,60,15,4.2,16],[25,123,21,0,2,'asphalt','T'],[19,17,20,-2.4,-3],[25,37,22,0,12],
            [20,21,21,2.5,1],[22,42,18,0,15,'asphalt'],[17,35,20,2.2,10,'asphalt'],[23,113,21,0,-1,'asphalt','B'],
            [19,74,16,4.7,1],[18,145,18,0,13],[20,58,18,3.1,2],[24,142,19,0,4,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Río Real", short: "Río Real", theme: 'storm3', seed: 7103277, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[22,120,18,0,2,'asphalt','B'],[18,78,15,-5.1,-17,'gravel'],[22,107,24,0,-5,'asphalt','T'],
            [21,21,16,-2.4,-9],[26,113,24,0,6,'asphalt','T'],[17,73,20,-5.1,-1],[22,185,22,0,-1,'asphalt','T'],
            [16,32,20,2.1,-5],[20,185,19,0,17],[22,74,18,-5,16,'gravel'],[16,30,23,0,-1],
            [17,55,19,3.9,8],[24,110,23,0,-1,'asphalt','B'],[19,76,21,-4.3,-13],[24,39,15,0,-12],
            [17,71,21,-5,-8,'gravel'],[22,27,22,0,5],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Cima Sur", short: "Cima Sur", theme: 'heath3', seed: 7101274, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,162,23,0,5,'asphalt','T'],[17,63,21,-3.2,-17],[26,118,21,0,0,'asphalt','T'],
            [20,25,19,2.7,7],[20,39,22,0,11],[17,74,21,4.5,8],[21,156,16,0,-1,'asphalt'],
            [20,80,17,4.4,8],[21,42,19,0,-15],[16,71,18,-3.5,15],[22,41,19,0,10],
            [16,73,21,-5.2,-16,'asphalt'],[25,108,19,0,5,'asphalt','B'],[18,33,20,3,17],[25,205,20,0,4],
            [19,75,20,5.6,4],[27,195,19,0,17,'asphalt'],[22,82,15,-6,4],[24,151,21,0,-1,'asphalt','B'],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Salto Norte", short: "Salto Norte", theme: 'ember3', seed: 7001920, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[22,163,20,0,1,'asphalt','B'],[18,69,16,4.4,13],[24,80,16,0,14],
            [18,65,19,4.2,-13],[19,88,15,0,-15],[20,79,21,-6.2,-2,'asphalt'],[26,191,15,0,0],
            [18,32,17,-1.9,-3],[24,149,20,0,3,'asphalt','T'],[16,54,19,-3.8,-17],[22,162,22,0,6,'asphalt','T'],
            [22,69,16,-4.8,5],[17,29,22,0,-17],[16,57,21,3.6,-9,'asphalt'],[23,157,24,0,-3,'asphalt','B'],
            [19,33,20,2.5,12],[22,35,20,0,-11],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Cruz Norte", short: "Cruz Norte", theme: 'orchid3', seed: 7103332, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[26,103,18,0,-3,'asphalt','B'],[19,79,20,-6.2,7],[19,25,20,0,2],
            [20,78,20,4.2,3],[26,132,23,0,4,'asphalt','B'],[20,75,17,4.7,-16],[17,27,18,0,16,'asphalt'],
            [16,31,20,-2.1,6,'asphalt'],[25,123,18,0,-1,'asphalt','T'],[16,86,17,-5.8,-17,'asphalt'],[24,187,19,0,6,'asphalt','T'],
            [21,37,16,2.2,-15],[16,198,21,0,-9],[18,46,16,-2.4,13],[20,109,22,0,-14],
            [16,84,16,-5.6,8],[26,183,24,0,0,'asphalt','T'],[16,89,16,5.8,-14],[16,37,16,0,16],
            [18,22,15,2.4,6],[26,23,15,0,-9],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Puna Norte", short: "Puna Norte", theme: 'glacier3', seed: 7102837, surface: 'snow',
        sections: [
            [0,60,0,0,0],[22,142,21,0,-4,'asphalt','T'],[16,23,21,2.5,-16],[18,24,19,0,5,'asphalt'],
            [18,67,19,-3.5,-15],[24,30,21,0,3],[19,84,17,-5.1,-16],[18,145,16,0,-6],
            [20,78,20,5.3,4],[16,32,21,0,16],[16,80,18,-4.7,-18,'asphalt'],[22,174,24,0,0,'asphalt','T'],
            [21,84,15,5.8,13],[25,102,23,0,3,'asphalt','B'],[19,35,18,2.1,-18],[27,178,18,0,-1,'asphalt','B'],
            [22,76,18,-4,8],[18,71,16,0,11],[21,50,19,-2.4,-7],[22,33,20,0,15],
            [0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Selva Sur", short: "Selva Sur", theme: 'oasis3', seed: 7003480, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[20,143,18,0,-15],[20,64,18,3.1,8],[26,35,17,0,-13],
            [17,74,21,4.4,-11],[24,159,19,0,12],[22,34,15,-2.4,-9],[16,22,22,0,3],
            [18,62,20,3.5,-17],[20,130,15,0,6,'asphalt'],[16,82,15,-5.7,18],[27,115,19,0,-1,'asphalt','T'],
            [17,23,20,2.3,-18],[23,25,17,0,10],[16,42,18,-2.9,-7],[24,134,22,0,-2,'asphalt','T'],
            [19,52,18,-3.4,-8],[24,122,20,0,6,'asphalt','B'],[22,73,20,5.2,-8],[22,188,18,0,4,'asphalt'],
            [16,84,15,-6,12],[23,154,21,0,6,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Ruta Playa Norte", short: "Playa Norte", theme: 'amethyst3', seed: 7004246, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[17,175,15,0,-17],[19,77,18,-5.2,8],[23,201,20,0,7,'asphalt'],
            [22,81,17,6,-6],[22,175,19,0,2,'asphalt','B'],[19,29,15,2.7,15,'asphalt'],[24,177,18,0,-5,'asphalt','T'],
            [19,66,21,-4.8,12],[23,112,22,0,16],[19,42,20,-3.4,-2],[27,163,19,0,-6,'asphalt','B'],
            [22,76,18,5.8,-14],[26,111,18,0,-1,'asphalt','T'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Camino Alba Norte", short: "Alba Norte", theme: 'harbor4', seed: 7002772, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[25,126,21,0,6,'asphalt','B'],[22,63,16,4.5,-1],[27,155,23,0,6,'asphalt','T'],
            [19,88,15,5.9,2],[27,132,23,0,-3,'gravel'],[21,85,21,-5.7,6,'gravel'],[26,146,24,0,-6,'asphalt','T'],
            [16,64,19,-3.4,-16],[16,31,23,0,-7],[16,25,21,2.6,-2],[23,29,19,0,-14],
            [17,75,20,5.8,3],[23,28,21,0,5,'gravel'],[18,50,16,-2.3,9,'gravel'],[26,158,19,0,-5,'asphalt','T'],
            [17,77,19,5.5,9],[22,42,17,0,-9],[21,64,17,-3.1,8],[27,145,24,0,-5,'asphalt','B'],
            [18,84,18,-5.7,16],[24,21,16,0,-12],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Sendero Duna Gris", short: "Duna Gris", theme: 'canyon4', seed: 7102696, surface: 'gravel',
        sections: [
            [0,60,0,0,0],[16,64,21,0,-9],[19,49,15,2.5,12],[26,173,19,0,3,'asphalt','T'],
            [16,76,19,5.8,-1],[26,184,21,0,2,'asphalt','B'],[20,57,21,-3.1,-2],[18,106,16,0,-4,'asphalt'],
            [16,46,21,3.2,-11,'asphalt'],[22,131,15,0,10],[17,88,15,5.4,12],[27,133,21,0,-2,'asphalt','T'],
            [19,67,16,-3.2,-9],[21,150,22,0,-13,'asphalt'],[20,47,15,-2.6,-1],[24,173,24,0,-5,'asphalt','T'],
            [22,49,17,-3.3,-6],[27,173,19,0,-1,'asphalt','B'],[19,51,15,-3.5,6],[16,119,15,0,16,'asphalt'],
            [21,47,19,3.1,1],[25,70,15,0,-3,'asphalt'],[0,60,0,0,0,'asphalt']
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Paso Valle Norte", short: "Valle Norte", theme: 'lake4', seed: 7002843, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,137,21,0,-3,'asphalt','T'],[20,75,19,-6,7],[20,41,21,0,-4],
            [16,68,15,3.3,18],[24,41,18,0,1],[18,76,15,4.7,8],[17,41,16,0,11],
            [16,57,16,2.7,9],[22,185,22,0,-3,'asphalt','B'],[17,82,19,-5.9,-16],[26,135,19,0,-4,'asphalt','T'],
            [17,67,17,3.5,-10],[20,24,15,0,-5],[18,58,20,-3.7,-10,'gravel'],[17,22,23,0,-9,'gravel'],
            [22,77,19,-4.9,-2],[27,143,21,0,-1,'asphalt','B'],[0,60,0,0,0]
        ],
        landmarks: []
    },
    {
        kind: 'stage', name: "Cuesta Lago Verde", short: "Lago Verde", theme: 'alpine4', seed: 7103276, surface: 'asphalt',
        sections: [
            [0,60,0,0,0],[27,162,22,0,-6,'asphalt','T'],[21,81,16,-4.6,-7],[27,139,20,0,-1,'asphalt','B'],
            [21,24,16,-2.7,-9,'gravel'],[21,20,19,0,2,'gravel'],[19,81,20,4.4,13],[25,204,15,0,-2,'gravel'],
            [22,72,19,5.6,-14,'gravel'],[22,121,22,0,3,'asphalt','B'],[18,70,16,-4.4,-15,'gravel'],[24,168,20,0,-4,'asphalt','T'],
            [21,60,18,3.7,11],[16,106,15,0,4],[17,77,19,-4.2,-13],[18,36,16,0,17],
            [0,60,0,0,0]
        ],
        landmarks: []
    }
];
// @@EVENTS_END
const SHORT_NAMES = EVENTS.map(function (ev) { return ev.short; });
const CIRCUIT_IDS = [], STAGE_IDS = [];
EVENTS.forEach(function (ev, i) { (ev.kind === 'circuit' ? CIRCUIT_IDS : STAGE_IDS).push(i); });
const CHAMP_ORDER = [];   // el campeonato alterna circuito y etapa: C1 E1 C2 E2 ...
for (let i = 0; i < CIRCUIT_IDS.length; i++) CHAMP_ORDER.push(CIRCUIT_IDS[i], STAGE_IDS[i]);
const GHOST_DT = 0.1;     // la sombra se graba a 10 muestras por segundo


// ---------------------------------------------------------------------------
// GEOMETRÍA DE CIRCUITOS: spline cerrada -> segmentos equidistantes -> curva por segmento -> cierre exacto.
// Cada segmento gira curva/SEG_LEN radianes (la misma relación que usa el render), y el minimapa integra
// exactamente esa curva: lo que se ve en el mapa es lo que se maneja.
// ---------------------------------------------------------------------------
function catmullClosed(pts, samplesPerSpan) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        for (let s = 0; s < samplesPerSpan; s++) {
            const t = s / samplesPerSpan, t2 = t * t, t3 = t2 * t;
            out.push([
                0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            ]);
        }
    }
    return out;
}
function resampleClosed(dense, N) {
    const M = dense.length, cum = [0];
    for (let i = 0; i < M; i++) { const a = dense[i], b = dense[(i + 1) % M]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = cum[M], out = [];
    let j = 0;
    for (let k = 0; k < N; k++) {
        const target = total * k / N;
        while (cum[j + 1] < target) j++;
        const a = dense[j], b = dense[(j + 1) % M], f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
        out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
}
function wrapPi(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function gaussSmoothCyclic(arr, sigma) {
    const N = arr.length, R = Math.ceil(sigma * 3), ker = [];
    let ks = 0;
    for (let k = -R; k <= R; k++) { const v = Math.exp(-(k * k) / (2 * sigma * sigma)); ker.push(v); ks += v; }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -R; k <= R; k++) s += arr[((i + k) % N + N) % N] * ker[k + R]; out[i] = s / ks; }
    return out;
}
// Cierre exacto: giro total = T y punto final = punto inicial, con la mínima corrección suave (K armónicos, los más bruscos penalizados)
function closeSolve(base, T, K) {
    const N = base.length, P = 2 * K + 1, cosT = [], sinT = [];
    for (let k = 1; k <= K; k++) {
        const c = new Float64Array(N), sn = new Float64Array(N);
        for (let i = 0; i < N; i++) { const a = 2 * Math.PI * k * i / N; c[i] = Math.cos(a); sn[i] = Math.sin(a); }
        cosT[k] = c; sinT[k] = sn;
    }
    const W = [];
    for (let j = 0; j < P; j++) W.push(j === 0 ? 1 : 1 + Math.pow(Math.ceil(j / 2), 3));
    const turnAt = function (p, i) {
        let d = base[i] + p[0];
        for (let k = 1; k <= K; k++) d += p[2 * k - 1] * cosT[k][i] + p[2 * k] * sinT[k][i];
        return d;
    };
    const residual = function (p) {
        let h = 0, x = 0, y = 0, H = 0;
        for (let i = 0; i < N; i++) { const d = turnAt(p, i); h += d; H += d; x += Math.cos(h); y += Math.sin(h); }
        return [H - T, x / N, y / N];
    };
    const norm = function (g) { return Math.hypot(g[0], g[1] * 100, g[2] * 100); };
    let p = new Array(P).fill(0), g = residual(p);
    for (let it = 0; it < 80 && norm(g) > 1e-11; it++) {
        const J = [];
        for (let j = 0; j < P; j++) {
            const q = p.slice(); q[j] += 1e-6;
            const gj = residual(q);
            J.push([(gj[0] - g[0]) / 1e-6, (gj[1] - g[1]) / 1e-6, (gj[2] - g[2]) / 1e-6]);
        }
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let j = 0; j < P; j++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += J[j][a] * J[j][b] / W[j];
        const A = [0, 1, 2].map(function (r) { return [M[r][0], M[r][1], M[r][2], -g[r]]; });
        for (let c = 0; c < 3; c++) {
            let piv = c;
            for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
            const tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
            for (let r = 0; r < 3; r++) if (r !== c) { const m = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= m * A[c][k]; }
        }
        const w = [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
        const du = J.map(function (col, j) { return (col[0] * w[0] + col[1] * w[1] + col[2] * w[2]) / W[j]; });
        const n0 = norm(g);
        let step = 1, ok = false;
        for (let tries = 0; tries < 40; tries++) {
            const q = p.map(function (v, j) { return v + step * du[j]; });
            const gq = residual(q);
            if (norm(gq) < n0) { p = q; g = gq; ok = true; break; }
            step *= 0.5;
        }
        if (!ok) break;
    }
    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) out[i] = turnAt(p, i);
    return out;
}
// puntos de control -> curva por segmento (unidades de juego) y rumbo inicial
function circuitCurves(ctrl, N) {
    const P = resampleClosed(catmullClosed(ctrl, 60), N);
    const th = new Float64Array(N);
    for (let i = 0; i < N; i++) { const a = P[i], b = P[(i + 1) % N]; th[i] = Math.atan2(b[1] - a[1], b[0] - a[0]); }
    const d0 = new Float64Array(N);
    let D = 0;
    for (let i = 0; i < N; i++) { d0[i] = wrapPi(th[i] - th[(i - 1 + N) % N]); D += d0[i]; }
    const T = Math.round(D / (2 * Math.PI)) * 2 * Math.PI;
    const sm = gaussSmoothCyclic(d0, 6);
    let Ds = 0;
    for (let i = 0; i < N; i++) Ds += sm[i];
    const base = new Float64Array(N);
    for (let i = 0; i < N; i++) base[i] = sm[i] + (T - Ds) / N;
    const deltas = closeSolve(base, T, 8);
    const curve = new Float64Array(N);
    for (let i = 0; i < N; i++) curve[i] = deltas[i] * SEG_LEN;
    return { curve: curve, h0: th[0] };
}
// altura periódica (interpolación coseno) entre puntos [fracción, altura]
function heightAt(pts, f) {
    const n = pts.length;
    f = ((f % 1) + 1) % 1;
    let i = 0;
    while (i < n - 1 && pts[i + 1][0] <= f) i++;
    const a = pts[i], b = pts[(i + 1) % n];
    const fa = a[0];
    let fb = b[0], ff = f;
    if (fb <= fa) fb += 1;
    if (ff < fa) ff += 1;
    const t = (ff - fa) / (fb - fa);
    return a[1] + (b[1] - a[1]) * ((1 - Math.cos(t * Math.PI)) / 2);
}

// ---------------------------------------------------------------------------
// CONSTRUCCIÓN DE PISTAS
// ---------------------------------------------------------------------------
const TRACK_CACHE = [];
function getTrack(i) {
    if (!TRACK_CACHE[i]) TRACK_CACHE[i] = buildTrack(i);
    return TRACK_CACHE[i];
}

function pickWeighted(list, rng) {
    let total = 0;
    for (const e of list) total += e.w;
    let r = rng() * total;
    for (const e of list) { r -= e.w; if (r <= 0) return e.k; }
    return list[0].k;
}

function gradeFor(peak) {
    if (peak >= 7) return 1;
    if (peak >= 5.5) return 2;
    if (peak >= 4.2) return 3;
    if (peak >= 3) return 4;
    if (peak >= 2.2) return 5;
    return 6;
}
const GRADE_WORDS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];


function detectNotes(segs) {
    const notes = [];
    const N = segs.length;
    let i = 0;
    while (i < N) {
        const c = segs[i].curve;
        if (Math.abs(c) >= 1.2) {
            const sign = Math.sign(c);
            let j = i, peak = 0;
            while (j < N && Math.sign(segs[j].curve) === sign && Math.abs(segs[j].curve) >= 0.5) {
                peak = Math.max(peak, Math.abs(segs[j].curve));
                j++;
            }
            if (peak >= 2) {
                const grade = gradeFor(peak);
                const len = j - i;
                const note = { seg: i, end: j, dir: sign < 0 ? 'L' : 'R', grade: grade, len: len, long: len >= 70, hairpin: grade === 1 };
                note.voice = (note.dir === 'L' ? 'izquierda ' : 'derecha ') + GRADE_WORDS[grade] +
                    (note.hairpin ? ', horquilla' : '') + (note.long ? ', larga' : '');
                notes.push(note);
            }
            i = j;
        } else {
            i++;
        }
    }
    return notes;
}


function buildTrack(idx) {
    const def = EVENTS[idx];
    const theme = THEMES[def.theme];
    const rng = mulberry32(def.seed);
    const circ = def.kind === 'circuit';
    const segs = [];

    function mkPt(z, y) { return { world: { x: 0, y: y, z: z }, camera: { x: 0, y: 0, z: 0 }, screen: { x: 0, y: 0, w: 0, scale: 0 } }; }
    function lastY() { return segs.length ? segs[segs.length - 1].p2.world.y : 0; }
    function pushSeg(curve, y1, y2, surface) {
        const n = segs.length;
        segs.push({
            index: n, p1: mkPt(n * SEG_LEN, y1), p2: mkPt((n + 1) * SEG_LEN, y2),
            curve: curve, surface: surface, alt: Math.floor(n / RUMBLE_LEN) % 2, colors: null, objs: [], gate: null,
            tunnel: false, bridge: false, tunnelStart: false, lamp: false, arch: false
        });
    }
    function addRoad(enter, hold, leave, curve, hill, surface, feat) {
        const startY = lastY(), endY = startY + (hill || 0) * SEG_LEN, total = enter + hold + leave;
        const first = segs.length;
        let n;
        for (n = 0; n < enter; n++) pushSeg(easeIn(0, curve, n / enter), lastY(), easeInOut(startY, endY, n / total), surface);
        for (n = 0; n < hold; n++) pushSeg(curve, lastY(), easeInOut(startY, endY, (enter + n) / total), surface);
        for (n = 0; n < leave; n++) pushSeg(easeInOut(curve, 0, n / leave), lastY(), easeInOut(startY, endY, (enter + hold + n) / total), surface);
        if (feat) for (let i = first; i < segs.length; i++) segs[i][feat === 'T' ? 'tunnel' : 'bridge'] = true;
    }

    let finishSeg, h0;
    if (circ) {
        const cc = circuitCurves(def.pts, def.N);
        h0 = cc.h0;
        for (let i = 0; i < def.N; i++) {
            const f = i / def.N;
            let surf = def.surface;
            for (const r of def.surfaces) if (f >= r[0] && f < r[1]) surf = r[2];
            pushSeg(cc.curve[i], heightAt(def.hill, f) * SEG_LEN, heightAt(def.hill, (i + 1) / def.N) * SEG_LEN, surf);
        }
        const mark = function (list, key) {
            for (const r of list) { const a = Math.round(r[0] * def.N), b = Math.round(r[1] * def.N); for (let i = a; i < b; i++) segs[i][key] = true; }
        };
        mark(def.tunnels, 'tunnel');
        mark(def.bridges, 'bridge');
        finishSeg = def.N;
    } else {
        for (const s of def.sections) addRoad(s[0], s[1], s[2], s[3], s[4], s[5] || def.surface, s[6]);
        addRoad(0, RUNOUT_SEGS, 0, 0, 0, def.surface);
        finishSeg = segs.length - RUNOUT_SEGS;
        h0 = -Math.PI / 2;
    }
    const N = segs.length;

    // Bordes de las estructuras: boca del túnel, luces del techo, arcos del puente
    let bridgeRun = 0;
    for (let i = 0; i < N; i++) {
        const s = segs[i], prev = segs[(i - 1 + N) % N];
        if (s.tunnel && !prev.tunnel) s.tunnelStart = true;
        if (s.tunnel && i % 8 < 2) s.lamp = true;
        if (s.bridge) { bridgeRun = (prev.bridge ? bridgeRun : 0) + 1; if (bridgeRun % 26 === 13) s.arch = true; } else bridgeRun = 0;
    }

    // Colores por segmento (el tema pone el paisaje; túnel y puente cambian el suelo y los bordes)
    for (let i = 0; i < N; i++) {
        const s = segs[i], alt = s.alt, base = SURFACES[s.surface];
        const oc = theme.surfColors && theme.surfColors[s.surface];
        let road = (oc ? oc.road : base.road)[alt], rumble = (oc ? oc.rumble : base.rumble)[alt], grass = theme.grass[alt];
        if (s.bridge) { grass = theme.water[alt]; rumble = ['#cfcdc4', '#b9b7ae'][alt]; }
        if (s.tunnel) { grass = '#0a0a0e'; road = mixHex(road, '#000000', 0.5); rumble = ['#4a4a55', '#3d3d47'][alt]; }
        s.colors = { grass: grass, road: road, rumble: rumble };
    }

    // Puertas: salida/checkpoints/meta en etapas; línea de meta en circuitos
    const cps = [];
    if (circ) {
        segs[0].gate = 'finish';
    } else {
        segs[14].gate = 'start';
        [0.27, 0.54, 0.79].forEach(function (f) {
            let c = Math.round(finishSeg * f);
            while (segs[c].tunnel || segs[c].bridge || segs[c - 5].tunnel || segs[c - 5].bridge || segs[c + 5].tunnel || segs[c + 5].bridge) c++;
            cps.push(c);
            segs[c].gate = 'cp';
        });
        segs[finishSeg].gate = 'finish';
    }

    // Decorado (determinístico por semilla); sin objetos sobre túneles, puentes ni sus accesos
    const nearStruct = function (i) {
        for (let d = -4; d <= 4; d++) { const q = segs[(i + d + N) % N]; if (q.tunnel || q.bridge) return true; }
        return false;
    };
    for (let i = circ ? 6 : 24; i < finishSeg; i++) {
        const s = segs[i];
        if (nearStruct(i)) continue;
        if (i % 3 === 0) {
            for (const side of [-1, 1]) {
                if (rng() < 0.55) {
                    const kind = pickWeighted(theme.deco, rng);
                    if (kind === 'lamp') { s.objs.push({ kind: kind, offset: side * 1.3, size: 1, hitW: 0.05 }); continue; }
                    const off = side * (kind === 'bldg' ? 2.8 + rng() * 3 : 1.55 + rng() * 3.2);
                    let hit = 0;
                    if ((kind === 'pine' || kind === 'snowpine' || kind === 'broadleaf') && Math.abs(off) < 2.1) hit = 0.12;
                    if ((kind === 'rock' || kind === 'cactus' || kind === 'mesa') && Math.abs(off) < 2.1) hit = 0.16;
                    s.objs.push({ kind: kind, offset: off, size: 0.8 + rng() * 0.6, hitW: hit });
                }
            }
        }
        if (rng() < 0.012 && i < finishSeg - 10) {
            const side = rng() < 0.5 ? -1 : 1;
            s.objs.push({ kind: (theme === THEMES.canyon || theme === THEMES.dunes) ? 'cactus' : 'rock', offset: side * (1.08 + rng() * 0.25), size: 0.7 + rng() * 0.4, hitW: 0.16 });
        }
        if (Math.abs(s.curve) >= 3.5 && i % 4 === 0) {
            s.objs.push({ kind: 'chevron', offset: -Math.sign(s.curve) * 1.3, dir: Math.sign(s.curve), size: 1, hitW: 0.07 });
        }
    }
    for (const lm of (def.landmarks || [])) {
        const li = Math.floor(lm.frac * finishSeg);
        if (!nearStruct(li)) segs[li].objs.push({ kind: lm.kind, offset: lm.offset, size: 1, hitW: 0 });
    }

    // Notas del copiloto: curvas + avisos de túnel y puente
    const notes = detectNotes(circ ? segs : segs.slice(0, finishSeg));
    notes.forEach(function (n) { n.kind = 'curve'; });
    const addFeatureNotes = function (key, kind, voice) {
        let i = 0;
        while (i < finishSeg) {
            if (segs[i][key]) {
                let j = i;
                while (j < finishSeg && segs[j][key]) j++;
                notes.push({ seg: i, end: j, kind: kind, grade: 0, dir: null, voice: voice, len: j - i });
                i = j;
            } else i++;
        }
    };
    addFeatureNotes('tunnel', 'tunnel', 'túnel');
    addFeatureNotes('bridge', 'bridge', 'puente');
    notes.sort(function (a, b) { return a.seg - b.seg; });

    // Minimapa: geometría real (cada segmento gira curva/SEG_LEN)
    let hh = h0, mx = 0, my = 0;
    const raw = [], feat = [];
    for (let i = 0; i < finishSeg; i++) {
        hh += segs[i].curve / SEG_LEN;
        mx += Math.cos(hh); my += Math.sin(hh);
        if (i % 6 === 0) { raw.push({ x: mx, y: my }); feat.push(segs[i].tunnel ? 1 : (segs[i].bridge ? 2 : 0)); }
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY, 1);
    const mini = {
        pts: raw.map(function (p) { return { x: (p.x - minX) / span, y: (p.y - minY) / span }; }),
        w: (maxX - minX) / span, h: (maxY - minY) / span, feat: feat, closed: circ
    };

    const surfSeen = [];
    for (let i = 0; i < finishSeg; i++) if (surfSeen.indexOf(segs[i].surface) < 0) surfSeen.push(segs[i].surface);
    let nT = 0, nB = 0;
    notes.forEach(function (n) { if (n.kind === 'tunnel') nT++; if (n.kind === 'bridge') nB++; });

    return {
        idx: idx, def: def, mode: def.kind, theme: theme, segs: segs, N: N, TL: N * SEG_LEN,
        laps: circ ? def.laps : 1, finishSeg: finishSeg, cps: cps, notes: notes, mini: mini,
        km: finishSeg * SEG_LEN * M_PER_UNIT / 1000,
        surfaces: surfSeen.map(function (k) { return SURFACES[k].name; }), nT: nT, nB: nB
    };
}

// Velocidad "ideal" por segmento (km/h): tope de la superficie, límite de agarre en cada curva y límites de
// frenada/aceleración entre segmentos (en circuitos se recorre dos veces para cerrar el lazo).
function idealSpeeds(stg, vehIdx) {
    if (!stg.vcache) stg.vcache = [];
    if (stg.vcache[vehIdx]) return stg.vcache[vehIdx];
    const veh = VEHICLES[vehIdx], circ = stg.mode === 'circuit', n = circ ? stg.N : stg.finishSeg, v = new Array(n);
    for (let i = 0; i < n; i++) {
        const seg = stg.segs[i], surf = SURFACES[seg.surface], vs = veh.surf[seg.surface];
        const effGrip = surf.grip * vs, topSeg = veh.top * surf.top, c = Math.abs(seg.curve);
        let vc = topSeg;
        if (c > 0.3) vc = Math.min(topSeg, veh.top * 0.85 * veh.steer * effGrip / (c * 0.42 * surf.push / vs));
        v[i] = Math.max(35, vc);
    }
    const nextOf = function (i) { return circ ? (i + 1) % n : i + 1; };
    for (let p = 0; p < (circ ? 2 : 1); p++) {
        for (let i = circ ? n - 1 : n - 2; i >= 0; i--) {
            const surf = SURFACES[stg.segs[i].surface];
            v[i] = Math.min(v[i], v[nextOf(i)] + 3.2 * (veh.brake / 135) * surf.brake);
        }
    }
    let prev = circ ? v[n - 1] : 20;
    for (let p = 0; p < (circ ? 2 : 1); p++) {
        for (let i = 0; i < n; i++) {
            const surf = SURFACES[stg.segs[i].surface];
            v[i] = Math.min(v[i], prev + 1.3 * (veh.a0 / 42) * surf.accel);
            prev = v[i];
        }
    }
    stg.vcache[vehIdx] = v;
    return v;
}

// Tiempo para recorrer los segmentos [a,b) a "ratio" de la velocidad ideal
function refTime(stg, vehIdx, ratio, a, b) {
    const v = idealSpeeds(stg, vehIdx);
    let t = 0;
    for (let i = a; i < b; i++) t += SEG_LEN / (v[i] * KMH_WORLD * ratio);
    return t;
}


// ---------------------------------------------------------------------------
// ESTADO DEL JUEGO
// ---------------------------------------------------------------------------
let gameState = 'START';   // START, COUNTDOWN, RUNNING, PAUSED, FINISHING, ENDED
let selMode = 0, selEventVal = 0, selOrder = [], selGroup = 'all', selVeh = 0, selDiff = 1;
let ghostRec = null, ghostCar = null, runGhost = { p: [0], x: [0] }, ghostAcc = 0;   // contrarreloj: récord guardado, auto de sombra y grabación de la vuelta en curso
let voiceMode = 0;         // 0 voz + texto, 1 solo texto, 2 apagado
let musicOn = true;
let comp = null;           // { order:[...], k:0, results:[], playerPoints, rivals }
let stage = null, stageIdx = 0, curTheme = THEMES.harbor, skyGrad = null, stars = [];

let position = 0, playerX = 0, vx = 0, speed = 0, steerInput = 0, slip = 0;
let stageTime = 0, timeLeft = 0, damage = 0, stageStartDamage = 0;
let crashCooldown = 0, crashFlash = 0;
let nextCp = 0, cpBonus = [], lapAllow = 0, lapNo = 0, lapTimes = [], lapStartTime = 0;
let noteAnnounced = {}, lastFeature = '', lastIdx = -1;
let popup = { t: 0, text: '', sub: '' };
let countdown = 0, lastCountNum = 4, finishTimer = 0, stageResult = null;
let rpm = 1200, gear = 1, bgX = 0;
let particles = [], flakes = [];
const keys = { left: false, right: false, up: false, down: false };
const entries = [];         // segmentos visibles del cuadro actual
let rivals = [];            // rivales de IA de la prueba en curso
let raceClock = 0;          // reloj de los rivales (arranca con la cuenta regresiva)
let raceT0 = 0;             // valor de raceClock en el instante de la largada (¡YA!)

const RECORDS_KEY = 'retroRally10Records_v1';
function loadRecords() { try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) || {}; } catch (e) { return {}; } }
function saveRecords(r) { try { localStorage.setItem(RECORDS_KEY, JSON.stringify(r)); return true; } catch (e) { return false; } }

// Distancia dentro de la vuelta (circuitos) o absoluta (etapas)
function wrapZ(z) { const TL = stage.TL; return ((z % TL) + TL) % TL; }
function segIndexAt(z) {
    const N = stage.N;
    return stage.mode === 'circuit' ? Math.floor(wrapZ(z) / SEG_LEN) % N : clamp(Math.floor(z / SEG_LEN), 0, N - 1);
}
function raceGoal() { return stage.mode === 'circuit' ? stage.laps * stage.TL : stage.finishSeg * SEG_LEN; }

function setTheme(stg) {
    curTheme = stg.theme;
    skyGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT / 2);
    skyGrad.addColorStop(0, curTheme.skyTop);
    skyGrad.addColorStop(0.6, curTheme.skyMid);
    skyGrad.addColorStop(1, curTheme.skyBottom);
    const r = mulberry32(7);
    stars = [];
    for (let i = 0; i < 70; i++) stars.push({ x: r() * WIDTH, y: r() * HEIGHT * 0.40, s: r() * 1.6 + 0.4, tw: r() * 6 });
    flakes = [];
    for (let i = 0; i < 130; i++) flakes.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: 1 + Math.random() * 2, s: 40 + Math.random() * 60 });
}

// ---------------------------------------------------------------------------
// AUDIO (todo procedural, sin archivos)
// ---------------------------------------------------------------------------
let _ac = null;
function getAC() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    return _ac;
}
function makeNoiseBuffer(a, secs) {
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * secs), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
}


// Motor: dientes de sierra + cuadrada por un pasa-bajos, ruido de ruta según la superficie y eco de túnel
let eng = null;
function startEngine() {
    try {
        stopEngine();
        const a = getAC();
        const veh = VEHICLES[selVeh];
        const master = a.createGain(); master.gain.value = 0.55; master.connect(a.destination);
        // Eco del túnel: retardo con realimentación; solo se oye (ganancia > 0) mientras se está dentro de un túnel
        const wet = a.createGain(); wet.gain.value = 0;
        const dly = a.createDelay(0.6); dly.delayTime.value = 0.085;
        const fb = a.createGain(); fb.gain.value = 0.45;
        const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        master.connect(wet); wet.connect(dly); dly.connect(lp); lp.connect(fb); fb.connect(dly); lp.connect(a.destination);
        const filt = a.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 700; filt.connect(master);
        const o1 = a.createOscillator(); o1.type = 'sawtooth';
        const o2 = a.createOscillator(); o2.type = 'square';
        const g1 = a.createGain(); g1.gain.value = 0.12;
        const g2 = a.createGain(); g2.gain.value = 0.05;
        o1.connect(g1); o2.connect(g2); g1.connect(filt); g2.connect(filt);
        const nb = makeNoiseBuffer(a, 1.5);
        const n1 = a.createBufferSource(); n1.buffer = nb; n1.loop = true;
        const nf = a.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.7;
        const ng = a.createGain(); ng.gain.value = 0;
        n1.connect(nf); nf.connect(ng); ng.connect(master);
        const t = a.currentTime;
        o1.start(t); o2.start(t); n1.start(t);
        eng = { o1: o1, o2: o2, g1: g1, g2: g2, filt: filt, n1: n1, nf: nf, ng: ng, master: master, wet: wet, dly: dly, fb: fb, lp: lp, veh: veh };
    } catch (e) { eng = null; }
}
function stopEngine() {
    if (!eng) return;
    try {
        eng.o1.stop(); eng.o2.stop(); eng.n1.stop();
        eng.master.disconnect(); eng.wet.disconnect(); eng.dly.disconnect(); eng.fb.disconnect(); eng.lp.disconnect();
    } catch (e) {}
    eng = null;
}
function updateEngineAudio() {
    if (!eng) return;
    try {
        const a = getAC(), t = a.currentTime, veh = eng.veh;
        const f = rpm / 60 * veh.pulses;
        eng.o1.frequency.setTargetAtTime(f, t, 0.04);
        eng.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
        eng.filt.frequency.setTargetAtTime(350 + rpm * 0.16 * veh.tone, t, 0.05);
        eng.g1.gain.setTargetAtTime(0.08 + 0.10 * (rpm / veh.rpmMax), t, 0.05);
        const seg = stage ? stage.segs[segIndexAt(position + PLAYER_Z)] : null;
        const surf = seg ? SURFACES[seg.surface] : SURFACES.asphalt;
        const sr = clamp(speed / veh.top, 0, 1);
        const tun = !!(seg && seg.tunnel);
        eng.nf.frequency.setTargetAtTime(surf.noiseF, t, 0.1);
        eng.ng.gain.setTargetAtTime(surf.noiseG * sr * (Math.abs(playerX) > 1.08 && !tun ? 1.8 : 1) * (tun ? 1.4 : 1), t, 0.08);
        eng.wet.gain.setTargetAtTime(tun ? 0.55 : 0, t, 0.12);
        eng.master.gain.setTargetAtTime(tun ? 0.7 : 0.55, t, 0.12);
    } catch (e) {}
}
// Golpe grave al cruzar las juntas de dilatación de un puente
function playThump() {
    try {
        const a = getAC(), t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.07);
        g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.1);
    } catch (e) {}
}

function beep(freq, len) {
    try {
        const a = getAC(), t = a.currentTime;
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'square'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + len + 0.02);
    } catch (e) {}
}
function playCrashSound() {
    try {
        const a = getAC(), t = a.currentTime;
        const src = a.createBufferSource(); src.buffer = makeNoiseBuffer(a, 0.28);
        const f = a.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
        f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.24);
        const g = a.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        src.connect(f); f.connect(g); g.connect(a.destination); src.start(t); src.stop(t + 0.28);
    } catch (e) {}
}
function playCheckpointSound() { beep(660, 0.12); setTimeout(function () { beep(990, 0.22); }, 120); }
function playFinishSound() { beep(523, 0.15); setTimeout(function () { beep(659, 0.15); }, 150); setTimeout(function () { beep(784, 0.35); }, 300); }

// Música chiptune (Dm - Bb - F - C)
const MUSIC_BPM = 146;
const MUSIC_CHORDS = [
    { bass: 146.83, arp: [293.66, 349.23, 440.00, 349.23] },
    { bass: 116.54, arp: [233.08, 293.66, 349.23, 293.66] },
    { bass: 174.61, arp: [349.23, 440.00, 523.25, 440.00] },
    { bass: 130.81, arp: [329.63, 392.00, 523.25, 392.00] }
];
let _mTimer = null, _mGain = null, _mNext = 0, _mStep = 0, _mNoise = null;
function mTone(type, freq, t, len, vol) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + len + 0.02);
}
function mKick(t) {
    const a = getAC(), o = a.createOscillator(), g = a.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    o.connect(g); g.connect(_mGain); o.start(t); o.stop(t + 0.18);
}
function mSnare(t) {
    const a = getAC(), s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = _mNoise; f.type = 'highpass'; f.frequency.value = 1800;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f); f.connect(g); g.connect(_mGain); s.start(t); s.stop(t + 0.13);
}
function playMusicStep(step, t, dur) {
    const chord = MUSIC_CHORDS[Math.floor(step / 16) % MUSIC_CHORDS.length];
    if (step % 2 === 0) mTone('triangle', chord.bass, t, dur * 1.9, 0.9);
    mTone('square', chord.arp[step % 4], t, dur * 0.8, 0.20);
    const pos = step % 16;
    if (pos === 0 || pos === 3 || pos === 6 || pos === 10 || pos === 12) mTone('square', chord.arp[(pos >> 2) % 4] * 2, t, dur * 1.4, 0.16);
    if (step % 4 === 0) mKick(t);
    if (step % 8 === 4) mSnare(t);
}
function scheduleMusic() {
    try {
        const a = getAC(), stepDur = 60 / MUSIC_BPM / 4;
        while (_mNext < a.currentTime + 0.15) {
            playMusicStep(_mStep, _mNext, stepDur);
            _mNext += stepDur;
            _mStep = (_mStep + 1) % (MUSIC_CHORDS.length * 16);
        }
    } catch (e) {}
}
function startMusic() {
    try {
        if (!musicOn || _mTimer) return;
        const a = getAC();
        if (a.state === 'suspended') a.resume();
        _mGain = a.createGain(); _mGain.gain.value = 0.10; _mGain.connect(a.destination);
        _mNoise = makeNoiseBuffer(a, 0.2);
        _mNext = a.currentTime + 0.05; _mStep = 0;
        _mTimer = setInterval(scheduleMusic, 25);
    } catch (e) {}
}
function stopMusic() {
    if (_mTimer) { clearInterval(_mTimer); _mTimer = null; }
    try { if (_mGain) _mGain.disconnect(); } catch (e) {}
    _mGain = null;
}

// Copiloto por voz
function speak(text) {
    if (voiceMode !== 0) return;
    try {
        if (!('speechSynthesis' in window)) return;
        if (window.speechSynthesis.pending) window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'es-ES'; u.rate = 1.25; u.volume = 1;
        window.speechSynthesis.speak(u);
    } catch (e) {}
}
function cancelSpeech() { try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {} }
function stopAllAudio() { stopEngine(); stopMusic(); cancelSpeech(); }


// ---------------------------------------------------------------------------
// ENTRADA
// ---------------------------------------------------------------------------
function initInput() {
    const NAV = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '];
    window.addEventListener('keydown', function (e) {
        if (NAV.indexOf(e.key) >= 0) e.preventDefault();
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = true;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = true;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = true;
        if (e.key === 'ArrowDown' || k === 's') keys.down = true;
        if (!e.repeat && (k === 'p' || e.key === 'Escape')) togglePause();
        if (!e.repeat && k === 'm') toggleMusic();
        if (!e.repeat && k === 'c') cycleVoice();
    });
    window.addEventListener('keyup', function (e) {
        const k = e.key.toLowerCase();
        if (e.key === 'ArrowLeft' || k === 'a') keys.left = false;
        if (e.key === 'ArrowRight' || k === 'd') keys.right = false;
        if (e.key === 'ArrowUp' || k === 'w') keys.up = false;
        if (e.key === 'ArrowDown' || k === 's') keys.down = false;
    });
    window.pressTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = true; };
    window.releaseTouchKey = function (key) { if (Object.prototype.hasOwnProperty.call(keys, key)) keys[key] = false; };
    window.addEventListener('blur', function () { if (gameState === 'RUNNING') togglePause(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden && gameState === 'RUNNING') togglePause(); });

    document.getElementById('btnStartRace').onclick = startCompetition;
}

function togglePause() {
    if (gameState === 'RUNNING') {
        gameState = 'PAUSED';
        stopAllAudio();
    } else if (gameState === 'PAUSED') {
        gameState = 'RUNNING';
        startEngine(); startMusic();
    }
}
window.togglePause = togglePause;

function toggleMusic() {
    musicOn = !musicOn;
    if (gameState === 'RUNNING' || gameState === 'COUNTDOWN') { if (musicOn) startMusic(); else stopMusic(); }
}
function cycleVoice() {
    voiceMode = (voiceMode + 1) % 3;
    popup = { t: 1.6, text: 'COPILOTO', sub: ['VOZ + TEXTO', 'SOLO TEXTO', 'APAGADO'][voiceMode] };
    if (voiceMode !== 0) cancelSpeech();
}


// ---------------------------------------------------------------------------
// COPILOTO: curvas, túneles y puentes (con vuelta completa en circuitos)
// ---------------------------------------------------------------------------
// Unidades de mundo hasta el inicio de la nota (0 si ya estás dentro). Infinity si queda después de la meta.
function noteDistance(n) {
    const circ = stage.mode === 'circuit';
    const pzT = position + PLAYER_Z;
    const pz = circ ? wrapZ(pzT) : pzT;
    const start = n.seg * SEG_LEN, end = n.end * SEG_LEN;
    if (pz >= start && pz < end) return 0;
    let d = start - pz;
    if (d < 0) { if (circ) d += stage.TL; else return Infinity; }
    if (d > raceGoal() - pzT) return Infinity;   // quedaría después de la meta
    return d;
}
function upcomingNotes(maxN, maxM) {
    const out = [];
    for (let i = 0; i < stage.notes.length; i++) {
        const m = noteDistance(stage.notes[i]) * M_PER_UNIT;
        if (m <= maxM) out.push({ n: stage.notes[i], i: i, m: m });
    }
    out.sort(function (a, b) { return a.m - b.m; });
    return out.slice(0, maxN);
}
function updateCopilot() {
    if (voiceMode !== 0) return;
    const lead = 55 + (speed / 3.6) * 2.8;   // metros de anticipación
    const key = stage.mode === 'circuit' ? Math.floor((position + PLAYER_Z) / stage.TL) : 0;
    for (let i = 0; i < stage.notes.length; i++) {
        const n = stage.notes[i];
        if (n.kind === 'curve' && n.grade > 4) continue;       // por voz solo las curvas importantes; el texto muestra todas
        if (noteAnnounced[i] === key) continue;
        const m = noteDistance(n) * M_PER_UNIT;
        if (m <= lead) {
            noteAnnounced[i] = key;
            if (m > 0) { speak(n.voice); return; }
        }
    }
}

// ---------------------------------------------------------------------------
// FLUJO: menú, campeonato, pruebas, resultados
// ---------------------------------------------------------------------------
const DAMAGE_CARRY = 0.3;   // fracción del daño que sigue puesta entre pruebas (el equipo repara el 70%)
function readMenu() {
    const g = function (id, d) { const e = document.getElementById(id); const v = e ? parseInt(e.value, 10) : d; return isNaN(v) ? d : v; };
    selMode = g('selectMode', 0);
    selEventVal = g('selectEvent', 0);
    selVeh = g('selectVehicle', 0);
    selDiff = g('selectDifficulty', 1);
    voiceMode = g('selectVoice', 0);
    musicOn = g('selectMusic', 1) === 1;
    if (selMode === 0) { selOrder = CHAMP_ORDER.slice(); selGroup = 'all'; }
    else if (selMode === 1) { selGroup = selEventVal === 0 ? 'stg' : 'cir'; selOrder = (selEventVal === 0 ? STAGE_IDS : CIRCUIT_IDS).slice(); }
    else { selOrder = [clamp(selEventVal, 0, EVENTS.length - 1)]; selGroup = 'one'; }
}

// Carga las opciones del selector de prueba según el modo (campeonato: todas; rally: 6 etapas o 6 circuitos; individual y contrarreloj: una a elección)
let lastMenuMode = -1;
function populateEvents() {
    const sel = document.getElementById('selectEvent'), ms = document.getElementById('selectMode');
    if (!sel || !ms) return;
    const mode = parseInt(ms.value, 10) || 0;
    const prev = sel.value;
    let html = '';
    if (mode === 0) html = '<option value="0">Las ' + CHAMP_ORDER.length + ' pruebas (' + CIRCUIT_IDS.length + ' circuitos + ' + STAGE_IDS.length + ' etapas)</option>';
    else if (mode === 1) html = '<option value="0">Las ' + STAGE_IDS.length + ' etapas</option><option value="1">Los ' + CIRCUIT_IDS.length + ' circuitos</option>';
    else {
        const opt = function (i) { return '<option value="' + i + '">' + EVENTS[i].name + '</option>'; };
        html = '<optgroup label="Circuitos">' + CIRCUIT_IDS.map(opt).join('') + '</optgroup><optgroup label="Etapas">' + STAGE_IDS.map(opt).join('') + '</optgroup>';
    }
    sel.innerHTML = html;
    sel.disabled = (mode === 0);
    if (mode >= 2 && lastMenuMode >= 2 && prev !== '') sel.value = prev;   // al pasar de carrera a contrarreloj conserva la prueba
    lastMenuMode = mode;
    const ds = document.getElementById('selectDifficulty');
    if (ds) ds.disabled = (mode === 3);   // en la contrarreloj no hay rivales
}
function onModeChange() { populateEvents(); updateMenu(); }
window.onModeChange = onModeChange;

function updateMenu() {
    readMenu();
    const contSnap = refreshCont();
    if (contSnap) readMenu();
    const first = contSnap ? selOrder[contSnap.k] : selOrder[0];
    const stg = getTrack(first);
    setBackdrop(first);

    const pc = document.getElementById('menuMapCanvas');
    if (pc) {
        const pctx = pc.getContext('2d');
        pctx.clearRect(0, 0, pc.width, pc.height);
        drawMini(pctx, 0, 0, 130, stg, -1, null);
    }
    const nm = document.getElementById('previewName'), inf = document.getElementById('previewInfo');
    const circuit = stg.mode === 'circuit';
    if (nm && inf) {
        if (selMode <= 1) {
            nm.textContent = selMode === 0 ? 'CAMPEONATO · ' + CHAMP_ORDER.length + ' PRUEBAS' : (selGroup === 'stg' ? 'RALLY · ' + STAGE_IDS.length + ' ETAPAS' : 'RALLY · ' + CIRCUIT_IDS.length + ' CIRCUITOS');
            const nC = selOrder.filter(function (i) { return EVENTS[i].kind === 'circuit'; }).length, nS = selOrder.length - nC;
            inf.textContent = (nC ? nC + ' circuitos' : '') + (nC && nS ? ' + ' : '') + (nS ? nS + ' etapas' : '') + ' · de ' + SHORT_NAMES[selOrder[0]] + ' a ' + SHORT_NAMES[selOrder[selOrder.length - 1]] + ' · con túneles y puentes';
        } else {
            nm.textContent = (selMode === 3 ? 'CRONO · ' : '') + (circuit ? 'CIRCUITO · ' : 'ETAPA · ') + stg.def.name.toUpperCase();
            inf.textContent = (circuit ? stg.laps + ' vueltas de ' + stg.km.toFixed(1) + ' km' : 'A→B · ' + stg.km.toFixed(1) + ' km') +
                ' · ' + stg.nT + ' túneles · ' + stg.nB + ' puentes · ' + stg.surfaces.join(' + ');
        }
    }
    const inf2 = document.getElementById('previewInfo');
    if (contSnap && inf2) inf2.textContent = 'PARTIDA GUARDADA · ' + contSnap.k + ' de ' + selOrder.length + ' pruebas hechas · sigue ' + SHORT_NAMES[first] + ' · ' + contSnap.playerPoints + ' pts';
    const sb = document.getElementById('btnStartRace');
    if (sb) sb.innerText = contSnap ? 'CONTINUAR (PRUEBA ' + (contSnap.k + 1) + '/' + selOrder.length + ')' : 'A LA PARTIDA';
    const note = document.getElementById('menuNote');
    if (note) { note.textContent = menuNote; if (menuNote) note.classList.remove('hidden'); else note.classList.add('hidden'); }
    const rec = document.getElementById('menuRecords');
    if (rec) {
        const r = loadRecords();
        if (selMode <= 1) {
            rec.textContent = 'RÉCORD ' + (selMode === 0 ? 'CAMPEONATO' : (selGroup === 'stg' ? 'RALLY ETAPAS' : 'RALLY CIRCUITOS')) + ' ' + formatTime(r['c' + selGroup + '_' + selVeh + '_' + selDiff]);
        } else if (selMode === 2) {
            const e = r['e' + first + '_' + selVeh + '_' + selDiff] || {};
            rec.textContent = circuit
                ? 'RÉCORD CARRERA ' + formatTime(e.race) + '  ·  VUELTA ' + formatTime(e.lap)
                : 'RÉCORD ETAPA ' + formatTime(e.race);
        } else {
            const e = r['t' + first + '_' + selVeh] || {};
            rec.textContent = e.time == null ? 'SIN SOMBRA TODAVÍA: la primera carrera la crea'
                : 'SOMBRA ' + formatTime(e.time) + (circuit ? '  ·  MEJOR VUELTA ' + formatTime(e.lap) : '');
        }
    }
}
window.updateMenu = updateMenu;

function setBackdrop(i) {
    rivals = []; ghostCar = null; ghostRec = null;
    stage = getTrack(i); stageIdx = i; setTheme(stage);
    position = 0; playerX = 0; speed = 0; bgX = 0;
}


// ---------------- partida guardada del campeonato / rally ----------------
// Una partida por grupo: 'all' (campeonato), 'stg' (rally de etapas), 'cir' (rally de circuitos).
const SAVE_KEY = RECORDS_KEY.replace('Records', 'Save');
function loadSaves() { try { const o = JSON.parse(localStorage.getItem(SAVE_KEY)); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
function writeSaves(o) {
    try {
        if (Object.keys(o).length) localStorage.setItem(SAVE_KEY, JSON.stringify(o)); else localStorage.removeItem(SAVE_KEY);
        return true;
    } catch (e) { return false; }
}
function groupOrder(group) { return group === 'all' ? CHAMP_ORDER : group === 'stg' ? STAGE_IDS : group === 'cir' ? CIRCUIT_IDS : null; }
// Devuelve la partida guardada del grupo solo si es coherente con este juego; si no, null
function getSave(group) {
    const s = loadSaves()[group];
    const ord = groupOrder(group);
    if (!s || !ord || s.group !== group || !Array.isArray(s.order) || s.order.length !== ord.length) return null;
    for (let i = 0; i < ord.length; i++) if (s.order[i] !== ord[i]) return null;
    if (!(s.k >= 1 && s.k < ord.length) || s.results.length !== s.k) return null;
    if (!(s.veh >= 0 && s.veh <= 2 && s.diff >= 0 && s.diff <= 2)) return null;
    if (!Array.isArray(s.rivals) || s.rivals.length !== RIVAL_NAMES.length) return null;
    for (const r of s.rivals) if (!(r && r.id >= 0 && r.veh >= 0 && r.veh <= 2 && isFinite(r.ratio) && isFinite(r.points) && isFinite(r.totalTime))) return null;
    for (const x of s.results) if (!(x && isFinite(x.time) && isFinite(x.stageIdx))) return null;
    if (!isFinite(s.playerPoints)) return null;
    return s;
}
function clearSave(group) { const o = loadSaves(); if (o[group]) { delete o[group]; writeSaves(o); } }
// Guarda el progreso: comp.k ya es la prueba terminada, la partida retoma en la siguiente
function saveProgress() {
    const o = loadSaves();
    o[comp.group] = {
        v: 1, mode: comp.mode, group: comp.group, order: comp.order.slice(), k: comp.k + 1,
        results: JSON.parse(JSON.stringify(comp.results)), playerPoints: comp.playerPoints || 0,
        rivals: comp.rivals.map(function (r) { return { id: r.id, name: r.name, veh: r.veh, ratio: r.ratio, points: r.points, totalTime: r.totalTime }; }),
        damage: damage, veh: selVeh, diff: selDiff, savedAt: Date.now()
    };
    return writeSaves(o);
}
let menuNote = '';
let contSig = null;   // firma de las opciones del selector de partida, para reconstruirlo solo cuando cambian
function contLabelName() { return selMode === 0 ? 'campeonato' : 'rally'; }
// Arma el selector "Nuevo / Continuar" según el modo y la partida guardada. Devuelve la partida si se elige continuar.
function refreshCont() {
    const row = document.getElementById('rowCont'), sel = document.getElementById('selectCont');
    const vs = document.getElementById('selectVehicle'), ds = document.getElementById('selectDifficulty');
    let snap = null;
    if (row && sel && selMode <= 1) {
        snap = getSave(selGroup);
        const sig = selMode + '|' + selGroup + '|' + (snap ? snap.savedAt + '|' + snap.k : '-');
        row.classList.remove('hidden');
        if (sig !== contSig) {
            contSig = sig;
            const nm = contLabelName();
            let h = '<option value="0">Nuevo ' + nm + '</option>';
            if (snap) h += '<option value="1">Continuar ' + nm + ' · prueba ' + (snap.k + 1) + '/' + snap.order.length + ' · ' + carShort(snap.veh) + ' · ' + ['Fácil', 'Media', 'Difícil'][snap.diff] + '</option>';
            sel.innerHTML = h;
            sel.value = snap ? '1' : '0';
        }
        if (!(snap && sel.value === '1')) snap = null;
    } else {
        if (row) row.classList.add('hidden');
        contSig = null;
    }
    if (vs && ds) {
        if (snap) { vs.value = String(snap.veh); ds.value = String(snap.diff); }
        vs.disabled = !!snap;
        ds.disabled = !!snap || selMode === 3;
    }
    return snap;
}

function startCompetition() {
    readMenu();
    const snap = refreshCont();
    if (snap) readMenu();   // toma el auto y la dificultad de la partida guardada
    if (!snap && selMode <= 1 && getSave(selGroup)) {
        let ok = true;
        try { if (typeof confirm === 'function') ok = confirm('Ya tenés un ' + contLabelName() + ' guardado. Si empezás uno nuevo, el guardado se borra. ¿Empezar de cero?'); } catch (e) {}
        if (!ok) return;
        clearSave(selGroup);
    }
    try { const a = getAC(); if (a.state === 'suspended') a.resume(); } catch (e) {}
    menuNote = '';
    if (snap) {
        comp = { mode: selMode, group: selGroup, tt: false, order: selOrder.slice(), k: snap.k,
                 results: JSON.parse(JSON.stringify(snap.results)), playerPoints: snap.playerPoints,
                 rivals: snap.rivals.map(function (r) { return { id: r.id, name: r.name, veh: r.veh, ratio: r.ratio, points: r.points, totalTime: r.totalTime }; }) };
        damage = snap.damage || 0;   // startStage aplica la reparación del equipo (comp.k > 0)
        startStage(comp.order[comp.k], false);
        return;
    }
    comp = { mode: selMode, group: selGroup, tt: selMode === 3, order: selOrder.slice(), k: 0, results: [], playerPoints: 0,
             rivals: selMode === 3 ? [] : createCompRivals() };
    damage = 0;
    startStage(comp.order[0], false);
}

// ---------------- contrarreloj: récord guardado + auto de sombra ----------------
function ghostKey(idx) { return 't' + idx + '_' + selVeh; }
function setupGhost() {
    ghostCar = null; ghostRec = null; runGhost = { p: [0], x: [0] }; ghostAcc = 0;
    if (!comp.tt) return;
    const e = loadRecords()[ghostKey(stageIdx)];
    if (e && e.g && e.g.d && e.g.d.length > 1 && e.time != null) {
        const cum = [0]; for (let i = 0; i < e.g.d.length; i++) cum.push(cum[i] + e.g.d[i]);
        e.g.p = cum;   // posiciones absolutas (en disco solo se guardan las diferencias)
        ghostRec = e;
        ghostCar = { ghost: true, id: -1, z: PLAYER_Z, x: e.g.x[0] / 100, veh: selVeh, v: 0 };
    }
}
function updateGhost(dt) {
    if (!comp.tt) return;
    if (gameState === 'RUNNING') {
        ghostAcc += dt;
        while (ghostAcc >= GHOST_DT - 1e-9) {
            ghostAcc -= GHOST_DT;
            runGhost.p.push(Math.round(position)); runGhost.x.push(Math.round(playerX * 100));
        }
    }
    if (ghostRec) {
        const gp = ghostRec.g.p, gx = ghostRec.g.x, f = stageTime / ghostRec.g.dt;
        const i = Math.min(Math.floor(f), gp.length - 1), j = Math.min(i + 1, gp.length - 1), u = Math.min(1, Math.max(0, f - i));
        ghostCar.z = PLAYER_Z + gp[i] + (gp[j] - gp[i]) * u;
        ghostCar.x = (gx[i] + (gx[j] - gx[i]) * u) / 100;
    }
}
// Diferencia con la sombra en la misma posición de la pista: + = vas atrás, - = vas adelante (segundos)
function ghostDelta() {
    if (!ghostRec) return null;
    const gp = ghostRec.g.p, dt = ghostRec.g.dt;
    if (position <= gp[0]) return 0;
    let lo = 0, hi = gp.length - 1;
    if (position >= gp[hi]) return stageTime - hi * dt;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (gp[mid] >= position) hi = mid; else lo = mid; }
    const tg = (lo + (position - gp[lo]) / ((gp[hi] - gp[lo]) || 1)) * dt;
    return stageTime - tg;
}

function startStage(idx, isRetry) {
    stageIdx = idx;
    stage = getTrack(idx);
    setTheme(stage);
    position = 0; playerX = 0; vx = 0; speed = 0; steerInput = 0; slip = 0;
    stageTime = 0; nextCp = 0; lapNo = 0; lapTimes = []; lapStartTime = 0;
    noteAnnounced = {}; lastFeature = ''; lastIdx = -1;
    crashCooldown = 0; crashFlash = 0; particles = []; popup.t = 0;
    rpm = 1200; gear = 1; bgX = 0; stageResult = null;
    for (const sg of stage.segs) for (const ob of sg.objs) ob.down = false;   // carteles derribados vuelven a su lugar
    if (isRetry) damage = stageStartDamage;
    else if (comp.k > 0) damage = Math.round(damage * DAMAGE_CARRY);   // el equipo repara gran parte del daño
    stageStartDamage = damage;
    spawnRivals();
    setupGhost();

    const veh = selVeh, d = DIFFS[selDiff];
    cpBonus = [];
    if (stage.mode === 'circuit') {
        lapAllow = refTime(stage, veh, d.allow, 0, stage.N);        // cada vuelta suma ese tiempo
        timeLeft = lapAllow + 8;
    } else {
        const b = [0].concat(stage.cps, [stage.finishSeg]);
        timeLeft = refTime(stage, veh, d.allow, b[0], b[1]) + 8;
        for (let j = 0; j < stage.cps.length; j++) cpBonus.push(refTime(stage, veh, d.allow, b[j + 1], b[j + 2]));
    }

    if (comp.tt) timeLeft = 1e9;   // contrarreloj: sin límite de tiempo, solo vos contra tu récord
    countdown = 3.6; lastCountNum = 4;
    gameState = 'COUNTDOWN';
    document.getElementById('menuStart').classList.add('hidden');
    document.getElementById('menuResult').classList.add('hidden');
    startEngine(); startMusic();
    if (voiceMode === 0) setTimeout(function () {
        speak((comp.tt ? 'Contrarreloj, ' : '') + (stage.mode === 'circuit' ? 'Circuito, ' : 'Etapa, ') + stage.def.name + (stage.mode === 'circuit' ? ', ' + stage.laps + ' vueltas' : ''));
    }, 300);
}

function showResult(title, text, victory, primaryLabel, primaryFn, secondaryLabel, secondaryFn, midLabel, midFn) {
    const t = document.getElementById('resTitle');
    t.innerText = title;
    t.style.color = victory ? ACCENT : '#ff3d5a';
    document.getElementById('resText').innerText = text;
    const nLines = text.split('\n').length;
    document.getElementById('resText').style.fontSize = nLines > 22 ? '0.68rem' : nLines > 11 ? '0.8rem' : '';
    const b1 = document.getElementById('btnResPrimary'), b2 = document.getElementById('btnResSecondary');
    b1.innerText = primaryLabel; b1.onclick = primaryFn;
    if (secondaryLabel) { b2.classList.remove('hidden'); b2.innerText = secondaryLabel; b2.onclick = secondaryFn; }
    else { b2.classList.add('hidden'); b2.onclick = null; }
    const bm = document.getElementById('btnResMid');
    if (bm) {
        if (midLabel) { bm.classList.remove('hidden'); bm.innerText = midLabel; bm.onclick = midFn; }
        else { bm.classList.add('hidden'); bm.onclick = null; }
    }
    document.getElementById('menuResult').classList.remove('hidden');
}


function backToMenu() {
    stopAllAudio();
    rivals = []; ghostCar = null; ghostRec = null;
    gameState = 'START';
    keys.left = keys.right = keys.up = keys.down = false;
    document.getElementById('menuResult').classList.add('hidden');
    document.getElementById('menuStart').classList.remove('hidden');
    updateMenu();
}
window.backToMenu = backToMenu;

function failStage(msg) {
    gameState = 'ENDED';
    stopAllAudio();
    showResult(stage.mode === 'circuit' ? 'CARRERA FALLIDA' : 'ETAPA FALLIDA', msg, false,
        'REINTENTAR', function () { startStage(comp.order[comp.k], true); }, 'VOLVER AL MENÚ', backToMenu);
}

function crash(dmg, spdMul) {
    if (crashCooldown > 0) return;
    speed *= spdMul;
    damage = Math.min(100, damage + dmg);
    crashCooldown = 0.6; crashFlash = 0.35;
    playCrashSound();
    if (damage >= 100) failStage('VEHÍCULO AVERIADO\nEl daño llegó al 100%.');
}


// Se llama en el instante de cruzar la meta: fija el resultado y arranca el frenado
function onFinish() {
    gameState = 'FINISHING'; finishTimer = 0;
    const circ = stage.mode === 'circuit';
    const t = stageTime;
    if (circ) lapTimes.push(t - lapStartTime);
    const bestLap = circ ? Math.min.apply(null, lapTimes) : null;
    if (comp.tt) { onFinishTT(t, circ, bestLap); return; }
    const recs = loadRecords();
    const key = 'e' + stageIdx + '_' + selVeh + '_' + selDiff;
    const e = recs[key] || {};
    const newRecord = (e.race == null || t < e.race);
    const newLapRecord = circ && (e.lap == null || bestLap < e.lap);
    if (newRecord) e.race = t;
    if (newLapRecord) e.lap = bestLap;
    recs[key] = e; saveRecords(recs);
    // Clasificación: los rivales que ya cruzaron la meta tienen su tiempo; a los demás se les proyecta
    const entriesT = [{ name: 'TÚ', player: true, time: t }];
    rivals.forEach(function (r) { entriesT.push({ name: r.name, veh: r.veh, id: r.id, time: projectRivalFinish(r) }); });
    entriesT.sort(function (a, b) { return a.time - b.time; });
    const rank = entriesT.findIndex(function (x) { return x.player; }) + 1;
    const pts = STAGE_POINTS[rank - 1] || 0;
    const medal = medalForRank(rank);   // la medalla es por posición de llegada, no por tiempo
    comp.playerPoints = (comp.playerPoints || 0) + pts;
    entriesT.forEach(function (x, i) {
        if (x.player) return;
        comp.rivals[x.id].points += STAGE_POINTS[i] || 0;
        comp.rivals[x.id].totalTime += x.time;
    });
    stageResult = { stageIdx: stageIdx, kind: stage.mode, time: t, laps: lapTimes.slice(), bestLap: bestLap, medal: medal,
                    damage: Math.round(damage), newRecord: newRecord, newLapRecord: newLapRecord, rank: rank, points: pts, table: entriesT };
    comp.results[comp.k] = stageResult;
    popup = { t: 3, text: 'META', sub: formatTime(t) };
    playFinishSound();
    cancelSpeech();
}

// Contrarreloj: guarda récord + sombra si mejoraste, y deja el resultado listo para mostrar
function onFinishTT(t, circ, bestLap) {
    const recs = loadRecords();
    const key = ghostKey(stageIdx);
    const e = recs[key] || {};
    const prev = e.time;
    const newRecord = (prev == null || t < prev);
    const newLapRecord = circ && (e.lap == null || bestLap < e.lap);
    let saved = true;
    if (newRecord) {
        const n = Math.round(t / GHOST_DT);
        while (runGhost.p.length - 1 < n) { runGhost.p.push(Math.round(position)); runGhost.x.push(Math.round(playerX * 100)); }
        const dp = []; for (let i = 1; i < runGhost.p.length; i++) dp.push(runGhost.p[i] - runGhost.p[i - 1]);
        e.time = t; e.g = { dt: GHOST_DT, d: dp, x: runGhost.x.slice() };
    }
    if (newLapRecord) e.lap = bestLap;
    if (newRecord || newLapRecord) { recs[key] = e; saved = saveRecords(recs); }
    stageResult = { stageIdx: stageIdx, kind: stage.mode, tt: true, time: t, laps: lapTimes.slice(), bestLap: bestLap, prev: prev,
                    damage: Math.round(damage), newRecord: newRecord, newLapRecord: newLapRecord, saved: saved, rank: 1, points: 0, medal: '', table: [] };
    comp.results[comp.k] = stageResult;
    popup = { t: 3, text: newRecord ? '¡NUEVO RÉCORD!' : 'META', sub: formatTime(t) };
    playFinishSound();
    cancelSpeech();
}

function finishTimeTrial() {
    gameState = 'ENDED';
    stopAllAudio();
    const r = stageResult, circ = r.kind === 'circuit', def = EVENTS[r.stageIdx];
    let text = 'Tiempo: ' + formatTime(r.time) + (r.newRecord ? '  ★ NUEVO RÉCORD' : '');
    if (r.prev != null) {
        const d = r.time - r.prev;
        text += '\nRécord anterior: ' + formatTime(r.prev) + '  (' + (d <= 0 ? '-' : '+') + Math.abs(d).toFixed(2) + ' s)';
    } else text += '\nPrimer registro: queda como récord y como sombra';
    if (circ) {
        text += '\nVueltas: ' + r.laps.map(function (t) { return formatTime(t); }).join(' · ') +
            '\nMejor vuelta: ' + formatTime(r.bestLap) + (r.newLapRecord ? '  ★ RÉCORD' : '');
    }
    text += '\nDaño: ' + r.damage + '%';
    if (r.newRecord) text += '\n\nTu sombra ahora es esta carrera: en el próximo intento vas a correr contra ella.';
    else text += '\n\nLa sombra sigue siendo tu mejor tiempo (' + formatTime(r.prev) + ').';
    if (!r.saved) text += '\n\n⚠ No se pudo guardar el récord (almacenamiento del navegador bloqueado o lleno).';
    const label = 'CONTRARRELOJ · ' + def.name.toUpperCase();
    showResult(r.newRecord ? '¡NUEVO RÉCORD!' : label, text, true, 'REINTENTAR', function () { startStage(comp.order[0], false); }, 'VOLVER AL MENÚ', backToMenu);
}

function carShort(v) { return ['Escarabajo', 'Coupé GT', 'V12 Hypercar'][v]; }
function padRight(str, n) { str = String(str); while (str.length < n) str += ' '; return str; }


// Clasificación del campeonato: puntos y, a igualdad, menor tiempo total
function standingsList() {
    const list = [{ name: 'TÚ', player: true, points: comp.playerPoints || 0,
                    total: comp.results.reduce(function (a, x) { return a + x.time; }, 0) }];
    comp.rivals.forEach(function (cr) { list.push({ name: cr.name, veh: cr.veh, points: cr.points, total: cr.totalTime }); });
    list.sort(function (a, b) { return (b.points - a.points) || (a.total - b.total); });
    return list;
}

function finishStage() {
    if (comp.tt) { finishTimeTrial(); return; }
    gameState = 'ENDED';
    stopAllAudio();
    const r = stageResult;
    const circ = r.kind === 'circuit';
    const def = EVENTS[r.stageIdx];
    const last = comp.k >= comp.order.length - 1;
    const multi = comp.order.length > 1;
    const sumTime = comp.results.reduce(function (a, x) { return a + x.time; }, 0);
    let text = 'Tiempo: ' + formatTime(r.time) + (r.newRecord ? '  ★ RÉCORD' : '') +
        '\nPosición: P' + r.rank + ' de ' + r.table.length + '  (+' + r.points + ' pts)' +
        '\nMedalla: ' + r.medal + (r.rank <= 3 ? '  (P' + r.rank + ')' : '');
    if (circ) {
        text += '\nVueltas: ' + r.laps.map(function (t) { return formatTime(t); }).join(' · ') +
            '\nMejor vuelta: ' + formatTime(r.bestLap) + (r.newLapRecord ? '  ★ RÉCORD' : '');
    }
    text += '\nDaño: ' + r.damage + '%' + '\n\nCLASIFICACIÓN';
    r.table.forEach(function (e, i) {
        text += '\n' + (i + 1) + '. ' + padRight(e.player ? 'TÚ' : e.name + ' (' + carShort(e.veh) + ')', 25) + formatTime(e.time);
    });
    if (multi) {
        const st = standingsList();
        text += '\n\nCampeonato: P' + (st.findIndex(function (e) { return e.player; }) + 1) + ' con ' + (comp.playerPoints || 0) + ' pts · acumulado ' + formatTime(sumTime);
    }
    const label = (circ ? 'CARRERA' : 'ETAPA') + ' COMPLETADA · ' + def.name.toUpperCase();

    if (!last) {
        if (r.damage > 0) text += '\nEl equipo repara parte del daño: ' + r.damage + '% → ' + Math.round(r.damage * DAMAGE_CARRY) + '%';
        showResult('PRUEBA ' + (comp.k + 1) + '/' + comp.order.length + ' · ' + label, text, true,
            'SIGUIENTE PRUEBA', function () { comp.k++; startStage(comp.order[comp.k], false); }, 'ABANDONAR', backToMenu,
            multi && comp.group !== 'one' ? 'GUARDAR Y SALIR' : null, function () {
                const done = comp.k + 1, tot = comp.order.length, nm = comp.mode === 0 ? 'campeonato' : 'rally';
                if (!saveProgress()) {
                    const b = document.getElementById('btnResMid');
                    if (b) b.innerText = 'NO SE PUDO GUARDAR';
                    return;
                }
                menuNote = '✔ ' + nm.charAt(0).toUpperCase() + nm.slice(1) + ' guardado: ' + done + '/' + tot + ' pruebas hechas. Elegí "Continuar" para seguir.';
                backToMenu();
            });
        return;
    }
    if (!multi) {
        showResult(label, text, true, 'VOLVER AL MENÚ', backToMenu, 'REPETIR', function () {
            comp.k = 0; comp.results = []; comp.playerPoints = 0; comp.rivals = createCompRivals();
            damage = 0; startStage(comp.order[0], false);
        });
        return;
    }
    // Final del campeonato
    clearSave(comp.group);
    const recs = loadRecords();
    const ck = 'c' + comp.group + '_' + selVeh + '_' + selDiff;
    const newChamp = (recs[ck] == null || sumTime < recs[ck]);
    if (newChamp) { recs[ck] = sumTime; saveRecords(recs); }
    const counts = { ORO: 0, PLATA: 0, BRONCE: 0 };
    comp.results.forEach(function (x) { if (counts[x.medal] !== undefined) counts[x.medal]++; });
    const st = standingsList();
    const myPos = st.findIndex(function (e) { return e.player; }) + 1;
    let fin = '';
    comp.results.forEach(function (x, i) {
        fin += (i ? '\n' : '') + padRight((i + 1) + '.', 4) + padRight(SHORT_NAMES[x.stageIdx], 13) + formatTime(x.time) + '  P' + x.rank + '  [' + x.medal + ']';
    });
    fin += '\n\nCLASIFICACIÓN FINAL';
    st.forEach(function (e, i) {
        fin += '\n' + (i + 1) + '. ' + padRight(e.player ? 'TÚ' : e.name + ' (' + carShort(e.veh) + ')', 25) + padRight(e.points + ' pts', 8) + formatTime(e.total);
    });
    fin += '\n\nMedalla del campeonato: ' + medalForRank(myPos) + '  (P' + myPos + ')' +
        '\nTiempo total: ' + formatTime(sumTime) + (newChamp ? '  ★ RÉCORD' : '') +
        '\nMedallas de prueba: ' + counts.ORO + ' oro, ' + counts.PLATA + ' plata, ' + counts.BRONCE + ' bronce';
    const title = myPos === 1 ? (counts.ORO === comp.order.length ? '¡CAMPEÓN PERFECTO!' : '¡CAMPEÓN!')
                : myPos <= 3 ? '¡PODIO: P' + myPos + '!' : 'CAMPEONATO FINALIZADO · P' + myPos;
    showResult(title, fin, true, 'VOLVER AL MENÚ', backToMenu, null, null);
}

// ---------------------------------------------------------------------------
// RIVALES DE IA
// Cada rival conduce uno de los 3 autos y sigue el perfil de velocidad ideal de la pista multiplicado por su ritmo
// (el rango depende de la dificultad). Largan adelante tuyo (salís último en la parrilla). En circuitos dan vueltas.
// Se mueven de lado, no se bloquean entre sí y chocan con vos.
// ---------------------------------------------------------------------------
const RIVAL_NAMES = ['Álvarez', 'Benítez', 'Castro', 'Duarte'];
const RIVAL_COLORS = ['#ff2a00', '#0066ff', '#ccaa00'];
const STAGE_POINTS = [10, 7, 5, 3, 1];
// Los rivales largan RIVAL_LAUNCH segundos antes del ¡YA! (como en el juego 1): al arrancar vos ya vienen en carrera y no te los comés de entrada
const RIVAL_LAUNCH = 3.0;
const RIVAL_LANES = [-0.5, 0.5, -0.5, 0.5];
const RIVAL_HIT_X = 0.42;        // solapamiento lateral para que haya choque
const RIVAL_HIT_BEHIND = 180;    // unidades de mundo detrás de tu auto
const RIVAL_HIT_AHEAD = 380;     // unidades de mundo delante de tu auto

// Pilotos del campeonato: mismo auto y ritmo en todas las pruebas, con puntos acumulados
function createCompRivals() {
    const d = DIFFS[selDiff];
    const cars = [0, 1, 2, Math.floor(Math.random() * 3)];
    for (let i = cars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = cars[i]; cars[i] = cars[j]; cars[j] = tmp;
    }
    return RIVAL_NAMES.map(function (name, i) {
        const f = (i + 0.2 + Math.random() * 0.6) / RIVAL_NAMES.length;   // repartidos a lo largo del rango
        return { id: i, name: name, veh: cars[i], ratio: d.rival[0] + (d.rival[1] - d.rival[0]) * f, points: 0, totalTime: 0 };
    });
}

function spawnRivals() {
    raceClock = 0; raceT0 = 0;
    rivals = comp.rivals.map(function (cr, i) {
        return {
            id: cr.id, name: cr.name, veh: cr.veh,
            ratio: cr.ratio * (0.985 + Math.random() * 0.03),
            x: RIVAL_LANES[i], lane: RIVAL_LANES[i], baseLane: RIVAL_LANES[i], pushX: 0,
            z: PLAYER_Z + 500 + i * 500, v: 0, finished: false, time: null,   // z = distancia total recorrida (todas las vueltas)
            profile: idealSpeeds(stage, cr.veh)
        };
    });
}

function stepRival(r, clock, dt) {
    const circ = stage.mode === 'circuit';
    const zl = circ ? r.z % stage.TL : r.z;
    const idx = clamp(Math.floor(zl / SEG_LEN), 0, stage.N - 1);
    const veh = VEHICLES[r.veh];
    let target = 0;
    if (!r.finished && (circ || idx < stage.finishSeg)) target = r.profile[idx] * r.ratio * (1 + 0.03 * Math.sin(clock * 0.5 + r.id * 1.7));
    if (target > r.v) r.v = Math.min(target, r.v + veh.a0 * 0.9 * dt);
    else r.v = Math.max(target, r.v - veh.brake * 0.8 * dt);
    r.z += r.v * KMH_WORLD * dt;
    if (!circ) r.z = Math.min(r.z, (stage.N - 3) * SEG_LEN);
    // Cortesía: si el rival te viene alcanzando por atrás, se corre al lado libre para pasarte sin chocarte;
    // cuando ya te pasó (o está lejos) vuelve a su carril. No cambia su velocidad, solo su posición lateral.
    let wantLane = r.baseLane;
    if (gameState === 'RUNNING') {
        const dzP = r.z - (position + PLAYER_Z);
        if (dzP < -40 && dzP > -1300 && r.v > speed - 5) wantLane = playerX >= 0 ? -0.6 : 0.6;
    }
    r.lane += clamp(wantLane - r.lane, -0.9 * dt, 0.9 * dt);
    r.pushX *= Math.pow(0.05, dt);
    r.x = clamp(r.lane + Math.sin(clock * 0.8 + r.id * 2.1) * 0.14 + r.pushX, -0.85, 0.85);   // vaivén lateral
    if (!r.finished && r.z >= raceGoal()) { r.finished = true; r.time = clock - raceT0; }
}

function updateRivals(dt) {
    raceClock += dt;
    for (let i = 0; i < rivals.length; i++) stepRival(rivals[i], raceClock, dt);
}

// Tiempo de meta de un rival: el real si ya cruzó, o proyectado sobre una copia (los rivales reales siguen corriendo)
function projectRivalFinish(r) {
    if (r.finished) return r.time;
    const c = Object.assign({}, r);
    let clock = raceClock, guard = 0;
    while (!c.finished && guard < 60 * 900) { clock += STEP; stepRival(c, clock, STEP); guard++; }
    return c.finished ? c.time : clock - raceT0;
}

function currentRank() {
    const pz = position + PLAYER_Z;
    let rank = 1;
    for (let i = 0; i < rivals.length; i++) if (rivals[i].z > pz) rank++;
    return rank;
}

// Choque con un rival: -45% velocidad, +12% daño y empujón a ambos autos (igual que en los juegos 1 y 2)
function checkRivalCollisions() {
    const pz = position + PLAYER_Z;
    for (let i = 0; i < rivals.length; i++) {
        const r = rivals[i];
        const dz = r.z - pz;
        if (dz < -RIVAL_HIT_BEHIND || dz > RIVAL_HIT_AHEAD) continue;
        const dxp = playerX - r.x;
        if (Math.abs(dxp) >= RIVAL_HIT_X) continue;
        if (crashCooldown > 0) return false;
        crash(12, 0.55);
        const push = dxp !== 0 ? Math.sign(dxp) : (Math.random() < 0.5 ? -1 : 1);
        playerX += push * 0.4;
        r.pushX -= push * 0.15;
        return true;
    }
    return false;
}

function drawRival(r, seg, alpha) {
    if (r.ghost) alpha *= 0.5;   // auto de sombra: translúcido
    const pct = (r.z % SEG_LEN) / SEG_LEN, a = seg.p1.screen, b = seg.p2.screen;
    const sc = a.scale + (b.scale - a.scale) * pct;
    if (sc <= 0) return;
    const sx = a.x + (b.x - a.x) * pct + sc * r.x * ROAD_W * WIDTH / 2;
    const sy = a.y + (b.y - a.y) * pct;
    const k = sc * WIDTH / 2;
    const bw = 760 * k, bh = 600 * k;
    if (bw < 3 || sy < 0 || sx < -500 || sx > WIDTH + 500) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(sx, sy, bw * 0.46, Math.max(1, bw * 0.05), 0, 0, Math.PI * 2); ctx.fill();
    const img = carImgs[r.veh];
    if (img && img.complete && img.naturalWidth) {
        const d = fitDims(img, bw, bh);
        ctx.drawImage(img, sx - d.w / 2, sy - d.h, d.w, d.h);
    } else {
        ctx.fillStyle = RIVAL_COLORS[r.veh];
        ctx.fillRect(sx - bw * 0.4, sy - bh * 0.7, bw * 0.8, bh * 0.7);
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// FÍSICA
// ---------------------------------------------------------------------------
function emitParticle(color, size, life) {
    if (particles.length > 90) return;
    particles.push({
        x: WIDTH / 2 + (Math.random() < 0.5 ? -1 : 1) * (45 + Math.random() * 25) + steerInput * 30,
        y: HEIGHT - 55 - Math.random() * 10,
        vx: (Math.random() - 0.5) * 60 - vx * 20, vy: -25 - Math.random() * 45,
        life: life, max: life, size: size, color: color
    });
}

function updateRpm(dt) {
    const veh = VEHICLES[selVeh];
    const ratio = clamp(speed / veh.top, 0, 1.05);
    const g = Math.min(5, Math.floor(ratio * 5 * 0.98) + 1);
    const within = clamp(ratio * 5 * 0.98 - (g - 1), 0, 1);
    let target = 1900 + within * (veh.rpmMax - 1900);
    if (gameState === 'COUNTDOWN') target = keys.up ? veh.rpmMax * 0.6 : 1200;
    else if (speed < 3 && !keys.up) target = 1200;
    else if (!keys.up) target = Math.max(1300, target * 0.85);
    gear = g;
    rpm += (target - rpm) * Math.min(1, dt * 10);
}


function updatePhysics(dt) {
    if (!stage) return;
    if (crashCooldown > 0) crashCooldown -= dt;
    if (crashFlash > 0) crashFlash -= dt;
    if (popup.t > 0) popup.t -= dt;

    if (gameState === 'COUNTDOWN') {
        countdown -= dt;
        const num = Math.ceil(countdown - 0.6);
        if (num !== lastCountNum) { lastCountNum = num; if (num >= 1) beep(440, 0.15); }
        if (countdown - 0.6 <= RIVAL_LAUNCH) updateRivals(dt);   // los rivales ya están corriendo en los últimos RIVAL_LAUNCH s de la cuenta
        if (countdown <= 0.6) {
            raceT0 = raceClock;                                   // los tiempos de los rivales se miden desde el ¡YA!, igual que el tuyo
            gameState = 'RUNNING';
            beep(880, 0.35);
            popup = { t: 1.0, text: '¡YA!', sub: '' };
        }
        updateRpm(dt); updateEngineAudio();
        return;
    }
    const finishing = (gameState === 'FINISHING');
    if (gameState !== 'RUNNING' && !finishing) return;
    updateRivals(dt);
    updateGhost(dt);

    const circ = stage.mode === 'circuit';
    const veh = VEHICLES[selVeh];
    const pzT = position + PLAYER_Z;                 // distancia total recorrida por el auto
    const idx = segIndexAt(pzT);
    const seg = stage.segs[idx];
    const surf = SURFACES[seg.surface];
    const vs = veh.surf[seg.surface];
    const effGrip = surf.grip * vs;
    const inTunnel = seg.tunnel, inBridge = seg.bridge;
    const offroad = !inTunnel && !inBridge && Math.abs(playerX) > 1.08;

    if (!finishing) {
        stageTime += dt; timeLeft -= dt;
        if (timeLeft <= 0) {
            timeLeft = 0;
            failStage('TIEMPO AGOTADO\n' + (circ ? 'No completaste la vuelta a tiempo.' : 'No llegaste al próximo checkpoint a tiempo.'));
            return;
        }
    } else {
        finishTimer += dt;
        if (finishTimer > 1.2 && (speed < 2 || finishTimer > 3.2)) { finishStage(); return; }
    }

    // ---- velocidad
    let maxEff = veh.top * surf.top * (1 - 0.25 * damage / 100);
    if (offroad) maxEff *= 0.55;
    const throttle = finishing ? false : keys.up;
    const braking = finishing ? true : keys.down;
    const slope = (seg.p2.world.y - seg.p1.world.y) / SEG_LEN;
    if (braking) {
        speed -= veh.brake * surf.brake * (finishing ? 0.7 : 1) * dt;
    } else if (throttle) {
        const x = Math.min(1, speed / maxEff);
        speed += (veh.a0 * surf.accel * (1 - Math.pow(x, 1.6)) + 2) * dt;
    } else {
        speed -= (14 + 0.30 * speed) * dt;
    }
    if (speed > 5) speed -= slope * 45 * dt;             // cuesta arriba frena, cuesta abajo ayuda
    if (speed > maxEff) speed = Math.max(maxEff, speed - 60 * dt);
    if (offroad) speed -= (10 + 0.25 * speed) * dt;
    speed = clamp(speed, 0, veh.top * 1.1);

    // ---- dirección y deslizamiento lateral
    const sr = speed / veh.top;
    let dir = 0;
    if (finishing) dir = playerX > 0.06 ? -1 : (playerX < -0.06 ? 1 : 0);
    else dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (dir !== 0) steerInput = clamp(steerInput + dir * dt * 5.5, -1, 1);
    else steerInput *= Math.pow(0.86, dt * 60);

    const authority = veh.steer * effGrip * (0.35 + 0.65 * Math.min(1, sr * 1.4));
    const targetLat = steerInput * authority * Math.min(1, speed / 8);
    vx += (targetLat - vx) * Math.min(1, (4 + 6 * effGrip) * dt);   // menos agarre = más inercia lateral
    const push = seg.curve * sr * 0.42 * surf.push / vs;             // fuerza centrífuga
    playerX += (vx - push) * dt;

    const overload = Math.abs(push) / Math.max(0.15, authority);
    slip = sr > 0.2 ? clamp((overload - 0.75) / 0.5, 0, 1) : 0;

    // ---- paredes: túnel y puente son angostos y no perdonan; en campo abierto hay una valla lejana
    const limitX = inTunnel ? TUNNEL_X : (inBridge ? BRIDGE_X : BARRIER_X);
    if (Math.abs(playerX) > limitX) {
        playerX = Math.sign(playerX) * limitX; vx = 0;
        crash(inTunnel || inBridge ? 8 : 6, 0.55);
        if (gameState === 'ENDED') return;
    }

    // ---- avance
    const prevZ = pzT;
    position += speed * KMH_WORLD * dt;
    if (!circ) {
        const maxPos = (stage.N - 3) * SEG_LEN - PLAYER_Z;
        if (position > maxPos) position = maxPos;
    }
    const newZ = position + PLAYER_Z;

    // ---- colisión con decorado (revisa todos los segmentos cruzados en este paso)
    if (!finishing) {
        const z0 = Math.floor(prevZ / SEG_LEN), z1 = Math.floor(newZ / SEG_LEN);
        for (let zi = z0; zi <= z1; zi++) {
            const sg = stage.segs[circ ? zi % stage.N : clamp(zi, 0, stage.N - 1)];
            const objs = sg.objs;
            for (let k = 0; k < objs.length; k++) {
                const o = objs[k];
                if (o.hitW > 0 && !o.down && Math.abs(playerX - o.offset) < o.hitW + 0.15) {
                    if (o.kind === 'chevron' || o.kind === 'lamp') { o.down = true; crash(3, 0.82); }   // carteles y farolas se derriban: golpe leve, una sola vez
                    else crash(o.kind === 'rock' || o.kind === 'mesa' ? 9 : 12, 0.45);
                    playerX += (playerX >= o.offset ? 1 : -1) * 0.25;
                    if (gameState === 'ENDED') return;
                    break;
                }
            }
        }
    }

    // ---- choque con rivales de IA
    if (!finishing) {
        checkRivalCollisions();
        if (gameState === 'ENDED') return;
    }

    // ---- vueltas, checkpoints y meta
    if (!finishing) {
        if (circ) {
            const lapNow = Math.floor(newZ / stage.TL);
            if (lapNow > lapNo && newZ < raceGoal()) {
                lapNo = lapNow;
                const lt = stageTime - lapStartTime;
                lapTimes.push(lt); lapStartTime = stageTime;
                timeLeft += lapAllow;
                popup = { t: 2.4, text: 'VUELTA ' + lapNo + '/' + stage.laps, sub: formatTime(lt) + (lt <= Math.min.apply(null, lapTimes) ? '  ★ MEJOR' : '') };
                playCheckpointSound();
            }
        } else {
            while (nextCp < stage.cps.length && newZ >= stage.cps[nextCp] * SEG_LEN) {
                timeLeft += cpBonus[nextCp];
                popup = { t: 2.2, text: 'CHECKPOINT', sub: '+' + Math.round(cpBonus[nextCp]) + ' s' };
                playCheckpointSound();
                nextCp++;
            }
        }
        if (newZ >= raceGoal()) { onFinish(); }
    }

    // ---- copiloto, avisos de túnel/puente y juntas del puente
    if (!finishing) {
        updateCopilot();
        const feat = inTunnel ? 'tunnel' : (inBridge ? 'bridge' : '');
        if (feat !== lastFeature) {
            if (feat) popup = { t: 1.4, text: feat === 'tunnel' ? 'TÚNEL' : 'PUENTE', sub: '' };
            lastFeature = feat;
        }
        if (inBridge && idx !== lastIdx && idx % 22 === 0 && speed > 40) playThump();
    }
    lastIdx = idx;

    // ---- efectos
    bgX -= seg.curve * sr * dt * 30;
    if (speed > 25) {
        if (offroad) { if (Math.random() < 0.5) emitParticle('#9e7a44', 4 + Math.random() * 4, 0.6); }
        else if (seg.surface === 'gravel') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle(curTheme.surfColors && curTheme.surfColors.gravel ? curTheme.surfColors.gravel.road[0] : '#c9a56a', 4 + Math.random() * 5, 0.7); }
        else if (seg.surface === 'snow') { if (Math.random() < 0.15 + 0.5 * sr) emitParticle('#ffffff', 3 + Math.random() * 5, 0.7); }
        if (slip > 0.3 && seg.surface === 'asphalt' && Math.random() < 0.6) emitParticle('#d8d8d8', 3 + Math.random() * 4, 0.5);
        if ((inTunnel || inBridge) && Math.abs(playerX) > limitX - 0.05 && Math.random() < 0.5) emitParticle('#ffd27a', 2 + Math.random() * 2, 0.35);   // chispas contra la pared
    }
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }

    updateRpm(dt);
    updateEngineAudio();
}


// ---------------------------------------------------------------------------
// RENDER (algoritmo del pintor: de lejos a cerca, así paredes, techos, barandas y autos tapan lo que corresponde)
// ---------------------------------------------------------------------------
function project(p, camX, camY, camZ) {
    const cx = p.world.x - camX, cy = p.world.y - camY, cz = p.world.z - camZ;
    p.camera.x = cx; p.camera.y = cy; p.camera.z = cz;
    const sc = cz > 0.0001 ? CAM_DEPTH / cz : 0;
    p.screen.scale = sc;
    p.screen.x = Math.round(WIDTH / 2 + sc * cx * WIDTH / 2);
    p.screen.y = Math.round(HEIGHT / 2 - sc * cy * HEIGHT / 2);
    p.screen.w = Math.round(sc * ROAD_W * WIDTH / 2);
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
    ctx.closePath();
    ctx.fill();
}

function mountainH(u, layer) {
    const a = Math.sin(u * 0.013 + layer * 1.7) * 0.5 + Math.sin(u * 0.031 + layer * 3.1) * 0.3 + Math.sin(u * 0.071 + layer) * 0.2;
    return Math.abs(a);
}


function hash01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

function drawBackground() {
    const horizonY = HEIGHT / 2;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, WIDTH, horizonY + 1);
    if (curTheme.stars) {
        ctx.fillStyle = '#ffffff';
        for (const s of stars) {
            ctx.globalAlpha = 0.45 + 0.35 * Math.sin(stageTime * 1.7 + s.tw);
            ctx.fillRect(s.x, s.y, s.s, s.s);
        }
        ctx.globalAlpha = 1;
    }
    const sun = curTheme.sun;
    if (sun) {
        const sx = ((sun.x * WIDTH + bgX * 0.15) % (WIDTH + 200) + (WIDTH + 200)) % (WIDTH + 200) - 100;
        ctx.fillStyle = sun.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(sx, horizonY - sun.y, sun.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }
    for (let layer = 0; layer < 2; layer++) {
        const f = layer === 0 ? 1 : 2;
        ctx.fillStyle = layer === 0 ? curTheme.mt1 : curTheme.mt2;
        if (curTheme.skyline) {
            // Ciudad de noche: edificios con ventanas encendidas que se desplazan con las curvas
            const w = layer === 0 ? 34 : 24, off = bgX * f, hMax = layer === 0 ? 70 : 46;
            const j0 = Math.floor(-off / w) - 1, j1 = Math.floor((WIDTH - off) / w) + 1;
            for (let j = j0; j <= j1; j++) {
                const bx = j * w + off, bh = 22 + hash01(j + layer * 100) * hMax;
                ctx.fillStyle = layer === 0 ? curTheme.mt1 : curTheme.mt2;
                ctx.fillRect(bx, horizonY - bh, w - 2, bh + 1);
                for (let wy = horizonY - bh + 5; wy < horizonY - 4; wy += 7) {
                    for (let wx = bx + 4; wx < bx + w - 6; wx += 7) {
                        if (hash01(j * 13.7 + wy * 0.31 + wx * 0.17 + layer) > 0.6) { ctx.fillStyle = layer === 0 ? '#ffd98a' : '#c9a85e'; ctx.fillRect(wx, wy, 2, 3); }
                    }
                }
            }
        } else {
            const amp = layer === 0 ? 85 : 50;
            ctx.beginPath();
            ctx.moveTo(0, horizonY + 1);
            for (let x = 0; x <= WIDTH; x += 8) ctx.lineTo(x, horizonY - (0.12 + mountainH(x - bgX * f, layer)) * amp);
            ctx.lineTo(WIDTH, horizonY + 1);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.fillStyle = curTheme.fog;
    ctx.fillRect(0, horizonY, WIDTH, HEIGHT - horizonY);
}

// Ruta de un segmento: suelo (césped / agua / oscuridad), bordes, calzada, marcas y niebla
function drawRoadSegment(seg, fogA) {
    const a = seg.p1.screen, b = seg.p2.screen, col = seg.colors;
    const x1 = a.x, y1 = a.y, w1 = a.w, x2 = b.x, y2 = b.y, w2 = b.w;
    const r1 = w1 / Math.max(6, 2 * LANES), r2 = w2 / Math.max(6, 2 * LANES);
    const l1 = w1 / Math.max(32, 8 * LANES), l2 = w2 / Math.max(32, 8 * LANES);
    const yb = y1 + 1;   // +1px: evita líneas finas entre segmentos

    ctx.fillStyle = col.grass;
    ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
    if (seg.bridge) {   // reflejos en el agua: franjas claras que corren a medida que avanzás
        ctx.fillStyle = seg.alt === 0 ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, y2, WIDTH, Math.max(1, (y1 - y2 + 1) * 0.5));
    }
    quad(x1 - w1 - r1, yb, x1 - w1, yb, x2 - w2, y2, x2 - w2 - r2, y2, col.rumble);
    quad(x1 + w1 + r1, yb, x1 + w1, yb, x2 + w2, y2, x2 + w2 + r2, y2, col.rumble);
    quad(x1 - w1, yb, x1 + w1, yb, x2 + w2, y2, x2 - w2, y2, col.road);

    if (seg.surface === 'asphalt') {
        if (seg.alt === 0) {
            const lw1 = w1 * 2 / LANES, lw2 = w2 * 2 / LANES;
            let lx1 = x1 - w1 + lw1, lx2 = x2 - w2 + lw2;
            const lc = seg.tunnel ? '#a8a8b4' : '#f2f2f2';
            for (let lane = 1; lane < LANES; lane++, lx1 += lw1, lx2 += lw2) {
                quad(lx1 - l1 / 2, yb, lx1 + l1 / 2, yb, lx2 + l2 / 2, y2, lx2 - l2 / 2, y2, lc);
            }
        }
    } else {
        const rut = seg.surface === 'gravel' ? 'rgba(0,0,0,0.13)' : 'rgba(80,110,150,0.16)';
        for (let s = -1; s <= 1; s += 2) {
            const c1 = x1 + s * w1 * 0.38, c2 = x2 + s * w2 * 0.38;
            quad(c1 - l1 * 2.2, yb, c1 + l1 * 2.2, yb, c2 + l2 * 2.2, y2, c2 - l2 * 2.2, y2, rut);
        }
    }
    if (fogA > 0.02) {
        ctx.globalAlpha = fogA;
        ctx.fillStyle = seg.tunnel ? '#06060a' : curTheme.fog;
        ctx.fillRect(0, y2, WIDTH, y1 - y2 + 1);
        ctx.globalAlpha = 1;
    }
}

// Túnel: paredes, techo con luces y, en la entrada, el frente de roca (el hueco deja ver el interior)
function drawTunnelShell(seg, fogA) {
    const A = seg.p1.screen, B = seg.p2.screen;
    const hA = TUNNEL_H * A.scale * WIDTH / 2, hB = TUNNEL_H * B.scale * WIDTH / 2;
    const xlA = A.x - A.w * TUNNEL_X, xrA = A.x + A.w * TUNNEL_X, xlB = B.x - B.w * TUNNEL_X, xrB = B.x + B.w * TUNNEL_X;
    const yA = A.y, yB = B.y;
    const wallCol = seg.alt ? '#3a3d49' : '#33363f', ceilCol = seg.alt ? '#2a2c36' : '#252730';
    quad(xlA, yA, xlA, yA - hA, xlB, yB - hB, xlB, yB, wallCol);
    quad(xrA, yA, xrA, yA - hA, xrB, yB - hB, xrB, yB, wallCol);
    quad(xlA, yA - hA, xrA, yA - hA, xrB, yB - hB, xlB, yB - hB, ceilCol);
    if (seg.lamp) {   // luminarias del techo
        const cA = A.w * 0.2, cB = B.w * 0.2;
        quad(A.x - cA, yA - hA + 1, A.x + cA, yA - hA + 1, B.x + cB, yB - hB + 1, B.x - cB, yB - hB + 1, '#fff2b0');
        ctx.globalAlpha = 0.16;
        quad(xlA, yA - hA, xrA, yA - hA, xrB, yB - hB, xlB, yB - hB, '#ffe9a0');
        ctx.globalAlpha = 1;
    }
    if (fogA > 0.02) {   // la oscuridad crece con la distancia
        ctx.globalAlpha = Math.min(0.95, fogA);
        ctx.fillStyle = '#050509';
        ctx.beginPath(); ctx.moveTo(xlA, yA); ctx.lineTo(xlA, yA - hA); ctx.lineTo(xrA, yA - hA); ctx.lineTo(xrA, yA);
        ctx.lineTo(xrB, yB); ctx.lineTo(xrB, yB - hB); ctx.lineTo(xlB, yB - hB); ctx.lineTo(xlB, yB); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    }
    if (seg.tunnelStart) drawPortal(seg, xlA, xrA, yA, hA);
}
function drawPortal(seg, xl, xr, y, h) {
    const A = seg.p1.screen;
    const ox0 = A.x - A.w * TUNNEL_X * 1.9, ox1 = A.x + A.w * TUNNEL_X * 1.9;
    const top = y - h * 2.3, bottom = y + 2;
    ctx.fillStyle = '#6e6a63';
    ctx.beginPath();
    ctx.rect(ox0, top, ox1 - ox0, bottom - top);     // frente de roca
    ctx.rect(xl, y - h, xr - xl, h + 2);             // hueco del túnel
    ctx.fill('evenodd');
    ctx.fillStyle = 'rgba(0,0,0,0.18)';              // sombreado de la mitad inferior de la roca
    ctx.beginPath();
    ctx.rect(ox0, y - h * 1.15, ox1 - ox0, h * 1.15 + 2);
    ctx.rect(xl, y - h, xr - xl, h + 2);
    ctx.fill('evenodd');
    ctx.fillStyle = '#9b958a';                        // dintel
    ctx.fillRect(xl - A.w * 0.08, y - h - A.w * 0.12, (xr - xl) + A.w * 0.16, A.w * 0.12);
    if (h > 30) {
        ctx.fillStyle = '#ffcc33';
        const sw = (xr - xl) * 0.28, sh = h * 0.2;
        ctx.fillRect(A.x - sw / 2, y - h - A.w * 0.12 - sh * 1.15, sw, sh);
        ctx.font = 'bold ' + Math.max(8, Math.floor(sh * 0.7)) + 'px monospace';
        ctx.textAlign = 'center'; ctx.fillStyle = '#111';
        ctx.fillText('TÚNEL', A.x, y - h - A.w * 0.12 - sh * 0.35);
        ctx.textAlign = 'left';
    }
}

// Puente: parapeto con baranda, sombra sobre el agua y juntas
function drawBridgeParts(seg) {
    const A = seg.p1.screen, B = seg.p2.screen;
    const hA = RAIL_H * A.scale * WIDTH / 2, hB = RAIL_H * B.scale * WIDTH / 2;
    for (let s = -1; s <= 1; s += 2) {
        const xA = A.x + s * A.w * 1.04, xB = B.x + s * B.w * 1.04;
        // sombra del tablero sobre el agua
        quad(xA, A.y, xA + s * A.w * 0.5, A.y, xB + s * B.w * 0.5, B.y, xB, B.y, 'rgba(0,10,30,0.30)');
        // parapeto
        quad(xA, A.y, xA, A.y - hA, xB, B.y - hB, xB, B.y, seg.alt ? '#d8d6cd' : '#c3c1b8');
        ctx.strokeStyle = '#f2f0e8'; ctx.lineWidth = Math.max(1, A.w * 0.012);
        ctx.beginPath(); ctx.moveTo(xA, A.y - hA); ctx.lineTo(xB, B.y - hB); ctx.stroke();
    }
    if (seg.alt === 0 && A.w > 12) {   // junta de dilatación
        quad(A.x - A.w, A.y + 1, A.x + A.w, A.y + 1, B.x + B.w, B.y, B.x - B.w, B.y, 'rgba(0,0,0,0.20)');
    }
}
function drawArch(seg, alpha) {
    const a = seg.p1.screen, k = a.scale * WIDTH / 2;
    const half = ROAD_W * 1.06 * k, hgt = 3300 * k, th = Math.max(2, 130 * k);
    if (hgt < 6) return;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#c6483a'; ctx.lineWidth = th; ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(a.x - half, a.y); ctx.lineTo(a.x - half, a.y - hgt * 0.5);
    ctx.ellipse(a.x, a.y - hgt * 0.5, half, hgt * 0.5, 0, Math.PI, 2 * Math.PI);
    ctx.lineTo(a.x + half, a.y);
    ctx.stroke();
    ctx.strokeStyle = '#8f2f26'; ctx.lineWidth = Math.max(1, th * 0.4);
    for (let i = 1; i < 5; i++) {   // tirantes verticales
        const f = (i / 5) * 2 - 1, hx = a.x + f * half, topY = a.y - hgt * 0.5 - Math.sqrt(Math.max(0, 1 - f * f)) * hgt * 0.5;
        ctx.beginPath(); ctx.moveTo(hx, topY); ctx.lineTo(hx, a.y - RAIL_H * k); ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function tri(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath();
    ctx.fill(); ctx.stroke();
}

function drawObj(o, x, y, k) {
    const s = o.size;
    switch (o.kind) {
        case 'pine':
        case 'snowpine': {
            const h = 2300 * s * k, w = 1200 * s * k;
            if (h < 3) return;
            ctx.fillStyle = '#4a3018';
            ctx.fillRect(x - w * 0.06, y - h * 0.22, w * 0.12, h * 0.22);
            const snow = o.kind === 'snowpine';
            ctx.fillStyle = snow ? '#1f5a3a' : '#2f8a42';
            ctx.strokeStyle = '#0a2410';
            ctx.lineWidth = Math.max(1, w * 0.03);
            tri(x, y - h, x - w * 0.5, y - h * 0.30, x + w * 0.5, y - h * 0.30);
            tri(x, y - h * 0.68, x - w * 0.42, y - h * 0.12, x + w * 0.42, y - h * 0.12);
            if (snow) {
                ctx.fillStyle = '#f4f8fc';
                tri(x, y - h, x - w * 0.22, y - h * 0.72, x + w * 0.22, y - h * 0.72);
                tri(x, y - h * 0.68, x - w * 0.19, y - h * 0.44, x + w * 0.19, y - h * 0.44);
            }
            break;
        }
        case 'palm': {
            const h = 2100 * s * k, w = 1500 * s * k;
            if (h < 3) return;
            ctx.strokeStyle = '#6b4a26'; ctx.lineWidth = Math.max(1, w * 0.07);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.12, y - h * 0.5, x + w * 0.05, y - h); ctx.stroke();
            ctx.strokeStyle = '#2f9a48'; ctx.lineWidth = Math.max(1, w * 0.06);
            const tx = x + w * 0.05, ty = y - h;
            const ang = [-2.7, -2.1, -1.57, -1.0, -0.4];
            for (let i = 0; i < ang.length; i++) {
                ctx.beginPath(); ctx.moveTo(tx, ty);
                ctx.quadraticCurveTo(tx + Math.cos(ang[i]) * w * 0.35, ty + Math.sin(ang[i]) * w * 0.35 - w * 0.12, tx + Math.cos(ang[i]) * w * 0.55, ty + Math.sin(ang[i]) * w * 0.35 + w * 0.2);
                ctx.stroke();
            }
            break;
        }
        case 'bush': {
            const h = 650 * s * k, w = 900 * s * k;
            if (h < 2) return;
            const bc = curTheme.bushC || ['#3f8f3a', '#4fa848'];
            ctx.fillStyle = bc[0];
            ctx.beginPath(); ctx.ellipse(x - w * 0.22, y - h * 0.4, w * 0.3, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(x + w * 0.2, y - h * 0.45, w * 0.32, h * 0.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = bc[1];
            ctx.beginPath(); ctx.ellipse(x, y - h * 0.55, w * 0.28, h * 0.45, 0, 0, Math.PI * 2); ctx.fill();
            break;
        }
        case 'rock': {
            const h = 520 * s * k, w = 760 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#7d7f86'; ctx.strokeStyle = '#3b3c40'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.beginPath();
            ctx.moveTo(x - w * 0.5, y); ctx.lineTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h);
            ctx.lineTo(x + w * 0.25, y - h * 0.85); ctx.lineTo(x + w * 0.5, y - h * 0.25); ctx.lineTo(x + w * 0.45, y);
            ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.beginPath(); ctx.moveTo(x - w * 0.38, y - h * 0.7); ctx.lineTo(x - w * 0.1, y - h); ctx.lineTo(x + w * 0.05, y - h * 0.6); ctx.closePath(); ctx.fill();
            break;
        }
        case 'hay': {
            const h = 480 * s * k, w = 800 * s * k;
            if (h < 2) return;
            ctx.fillStyle = '#d9b24a'; ctx.strokeStyle = '#8a6a1c'; ctx.lineWidth = Math.max(1, w * 0.03);
            ctx.fillRect(x - w / 2, y - h, w, h); ctx.strokeRect(x - w / 2, y - h, w, h);
            ctx.beginPath(); ctx.moveTo(x - w / 2, y - h * 0.5); ctx.lineTo(x + w / 2, y - h * 0.5); ctx.stroke();
            break;
        }
        case 'chevron': {
            const h = 1300 * k, w = 700 * k;
            if (h < 4) return;
            ctx.fillStyle = '#555';
            ctx.fillRect(x - w * 0.03, y - h * 0.75, w * 0.06, h * 0.75);
            ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, w * 0.05);
            ctx.fillRect(x - w / 2, y - h, w, h * 0.5); ctx.strokeRect(x - w / 2, y - h, w, h * 0.5);
            ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.5, w * 0.09);
            const d = o.dir, cy = y - h * 0.75;
            ctx.beginPath();
            ctx.moveTo(x - d * w * 0.15, cy - h * 0.16); ctx.lineTo(x + d * w * 0.15, cy); ctx.lineTo(x - d * w * 0.15, cy + h * 0.16);
            ctx.stroke();
            break;
        }
        case 'lighthouse': {
            const h = 7000 * k, w = 1500 * k;
            if (h < 6) return;
            const bands = 6;
            for (let i = 0; i < bands; i++) {
                const y0 = y - h * (0.85 * (i + 1) / bands), hh = h * 0.85 / bands;
                const wt = w * (1 - 0.35 * (i / bands));
                ctx.fillStyle = i % 2 === 0 ? '#f4f4f4' : '#c8302a';
                ctx.fillRect(x - wt / 2, y0, wt, hh + 1);
            }
            ctx.fillStyle = '#2a2f3a'; ctx.fillRect(x - w * 0.34, y - h * 0.95, w * 0.68, h * 0.1);
            ctx.fillStyle = '#ffe98a'; ctx.fillRect(x - w * 0.22, y - h * 0.93, w * 0.44, h * 0.06);
            ctx.fillStyle = '#c8302a'; tri(x, y - h, x - w * 0.36, y - h * 0.95, x + w * 0.36, y - h * 0.95);
            break;
        }
        case 'cabin': {
            const h = 1800 * k, w = 2600 * k;
            if (h < 4) return;
            ctx.fillStyle = '#7a4a26'; ctx.fillRect(x - w / 2, y - h * 0.6, w, h * 0.6);
            ctx.fillStyle = '#f4f8fc'; ctx.strokeStyle = '#8fa3b8'; ctx.lineWidth = Math.max(1, w * 0.01);
            tri(x - w * 0.6, y - h * 0.6, x, y - h, x + w * 0.6, y - h * 0.6);
            ctx.fillStyle = '#ffd77a'; ctx.fillRect(x - w * 0.12, y - h * 0.45, w * 0.2, h * 0.22);
            break;
        }
    }
}

function drawGate(seg, k, sx, sy) {
    const half = ROAD_W * 1.12 * k;
    const postW = Math.max(2, 90 * k);
    const top = 2100 * k, bh = 520 * k;
    if (top < 4) return;
    ctx.fillStyle = '#d8d8d8';
    ctx.fillRect(sx - half - postW / 2, sy - top, postW, top);
    ctx.fillRect(sx + half - postW / 2, sy - top, postW, top);
    const bx = sx - half, bw = half * 2, by = sy - top;
    let label;
    if (seg.gate === 'finish') {
        const cols = 16, cw = bw / cols;
        for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
            ctx.fillStyle = (r + c) % 2 ? '#ffffff' : '#111111';
            ctx.fillRect(bx + c * cw, by + r * bh / 2, cw + 1, bh / 2 + 1);
        }
        label = 'META';
    } else {
        ctx.fillStyle = seg.gate === 'start' ? '#1fae4b' : '#ffb800';
        ctx.fillRect(bx, by, bw, bh);
        label = seg.gate === 'start' ? 'SALIDA' : 'CHECKPOINT';
    }
    if (bh > 12) {
        ctx.font = 'bold ' + Math.floor(bh * 0.6) + 'px monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(2, bh * 0.1);
        ctx.strokeStyle = '#000';
        ctx.strokeText(label, sx, by + bh * 0.72);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, sx, by + bh * 0.72);
        ctx.textAlign = 'left';
    }
}


// Objetos nuevos de los temas de la tercera entrega (los demás los dibuja drawObj)
function drawObjExt(o, x, y, k) {
    const s = o.size;
    switch (o.kind) {
        case 'cactus': {
            const h = 1700 * s * k, w = 380 * s * k;
            if (h < 3) return;
            ctx.fillStyle = '#3f8f46'; ctx.strokeStyle = '#1f4d27'; ctx.lineWidth = Math.max(1, w * 0.08);
            ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w / 2, y - h + w / 2); ctx.arc(x, y - h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
            ctx.fillRect(x - w * 1.5, y - h * 0.55, w * 1.0, w * 0.5); ctx.fillRect(x - w * 1.5, y - h * 0.82, w * 0.5, h * 0.27 + w * 0.5);
            ctx.fillRect(x + w * 0.5, y - h * 0.4, w * 1.0, w * 0.5); ctx.fillRect(x + w * 1.0, y - h * 0.62, w * 0.5, h * 0.22 + w * 0.5);
            break;
        }
        case 'mesa': {
            const h = 2600 * s * k, w = 3400 * s * k;
            if (h < 4) return;
            ctx.fillStyle = '#b5562f';
            ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.lineTo(x - w * 0.38, y - h * 0.85); ctx.lineTo(x - w * 0.3, y - h); ctx.lineTo(x + w * 0.28, y - h); ctx.lineTo(x + w * 0.4, y - h * 0.8); ctx.lineTo(x + w / 2, y); ctx.closePath(); ctx.fill();
            for (let i = 1; i <= 3; i++) { ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,200,150,0.14)'; ctx.fillRect(x - w * 0.46, y - h * i / 3.4, w * 0.92, h / 7); }
            break;
        }
        case 'lamp': {
            const h = 1900 * k, w = Math.max(1.5, 90 * k);
            if (h < 5) return;
            const dir = o.offset > 0 ? -1 : 1;
            ctx.fillStyle = '#2a2d3a'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillRect(Math.min(x, x + dir * 420 * k), y - h, Math.abs(420 * k), w);
            const hx = x + dir * 420 * k;
            if (h > 12) {
                const g = ctx.createRadialGradient(hx, y - h, 1, hx, y - h, 650 * k);
                g.addColorStop(0, 'rgba(255,236,170,0.55)'); g.addColorStop(1, 'rgba(255,236,170,0)');
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, y - h, 650 * k, 0, Math.PI * 2); ctx.fill();
            }
            ctx.fillStyle = '#fff4c2'; ctx.fillRect(hx - w * 1.4, y - h - w * 0.3, w * 2.8, w * 1.2);
            break;
        }
        case 'bldg': {
            const w = 2600 * s * k, h = (3600 + 1800 * s) * k;
            if (h < 6) return;
            ctx.fillStyle = '#1a2036'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillStyle = '#10152a'; ctx.fillRect(x - w / 2, y - h, w * 0.08, h);
            const cell = Math.max(3, w * 0.2);
            for (let wy = y - h + cell * 0.6; wy < y - cell; wy += cell * 1.5) {
                for (let wx = x - w / 2 + cell * 0.6; wx < x + w / 2 - cell; wx += cell * 1.4) {
                    ctx.fillStyle = hash01(o.size * 1000 + wy * 0.13 + wx * 0.07) > 0.5 ? '#ffd98a' : '#2b3350';
                    ctx.fillRect(wx, wy, cell * 0.7, cell * 0.9);
                }
            }
            break;
        }
        case 'broadleaf': {
            const h = 1100 * s * k, w = 260 * s * k, R = 900 * s * k;
            if (R < 3) return;
            const lf = curTheme.leaf || ['#2e7d32', '#388e3c', '#43a047'];
            ctx.fillStyle = '#5a3b1e'; ctx.fillRect(x - w / 2, y - h, w, h);
            ctx.fillStyle = lf[0]; ctx.beginPath(); ctx.arc(x - R * 0.55, y - h - R * 0.35, R * 0.75, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = lf[1]; ctx.beginPath(); ctx.arc(x + R * 0.55, y - h - R * 0.35, R * 0.75, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = lf[2]; ctx.beginPath(); ctx.arc(x, y - h - R * 0.85, R * 0.85, 0, Math.PI * 2); ctx.fill();
            break;
        }
        default:
            drawObj(o, x, y, k);
    }
}

// Un segmento completo, de lejos a cerca: ruta, estructuras, puertas, objetos, rivales y arcos
function drawEntry(e, rl) {
    const seg = e.seg, a = seg.p1.screen, b = seg.p2.screen;
    if (b.y < a.y) {   // los tramos "de espaldas" (bajada oculta) no se dibujan
        drawRoadSegment(seg, e.fog);
        if (seg.tunnel) drawTunnelShell(seg, e.fog);
        if (seg.bridge) drawBridgeParts(seg);
    }
    if (seg.p1.camera.z < PLAYER_Z * 0.6) return;
    const sc = a.scale, k = sc * WIDTH / 2, alpha = clamp(1 - e.fog, 0.05, 1);
    if (seg.gate) { ctx.globalAlpha = alpha; drawGate(seg, k, a.x, a.y); ctx.globalAlpha = 1; }
    for (let j = 0; j < seg.objs.length; j++) {
        const o = seg.objs[j];
        if (o.down) continue;
        const sx = a.x + sc * o.offset * ROAD_W * WIDTH / 2;
        if (sx < -700 || sx > WIDTH + 700) continue;
        ctx.globalAlpha = alpha;
        drawObjExt(o, sx, a.y, k);
        ctx.globalAlpha = 1;
    }
    if (rl) for (let j = 0; j < rl.length; j++) drawRival(rl[j], seg, alpha);
    if (seg.arch) drawArch(seg, alpha);
}

function renderWorld() {
    const segs = stage.segs, N = stage.N, TL = stage.TL, circ = stage.mode === 'circuit';
    const pos = circ ? wrapZ(position) : position;                  // z de la cámara dentro de la vuelta
    const baseIdx = clamp(Math.floor(pos / SEG_LEN), 0, N - 1);
    const base = segs[baseIdx];
    const basePercent = (pos % SEG_LEN) / SEG_LEN;
    const pzL = circ ? wrapZ(position + PLAYER_Z) : position + PLAYER_Z;
    const pSeg = segs[clamp(Math.floor(pzL / SEG_LEN), 0, N - 1)];
    const pPct = (pzL % SEG_LEN) / SEG_LEN;
    const playerY = pSeg.p1.world.y + (pSeg.p2.world.y - pSeg.p1.world.y) * pPct;

    let shakeX = 0, shakeY = 0;
    if (gameState === 'RUNNING' && speed > 20) {
        const rough = SURFACES[pSeg.surface].noiseG * 6 + (Math.abs(playerX) > 1.08 && !pSeg.tunnel && !pSeg.bridge ? 1.2 : 0.2);
        const amt = (speed / VEHICLES[selVeh].top) * rough * 60;
        shakeX = (Math.random() - 0.5) * amt; shakeY = (Math.random() - 0.5) * amt;
    }
    const camX = playerX * ROAD_W + shakeX;
    const camY = playerY + CAM_H + shakeY;

    drawBackground();

    // 1) proyección de cerca a lejos (acumula el desplazamiento lateral de las curvas)
    let x = 0, dx = -(base.curve * basePercent);
    entries.length = 0;
    for (let n = 0; n < DRAW_DIST; n++) {
        let idx = baseIdx + n, camZ = pos;
        if (idx >= N) { if (!circ) break; idx -= N; camZ = pos - TL; }
        const seg = segs[idx];
        project(seg.p1, camX - x, camY, camZ);
        project(seg.p2, camX - x - dx, camY, camZ);
        x += dx; dx += seg.curve;
        if (seg.p1.camera.z <= CAM_DEPTH) continue;
        entries.push({ seg: seg, fog: 1 - 1 / Math.exp(Math.pow(n / DRAW_DIST, 2) * (seg.tunnel ? 3.6 : curTheme.fogD)) });
    }

    // rivales agrupados por segmento (solo los que están dentro de la distancia de dibujo)
    const rivalBy = {}, pzT = position + PLAYER_Z;
    const drawList = ghostCar ? rivals.concat([ghostCar]) : rivals;
    for (let i = 0; i < drawList.length; i++) {
        const r = drawList[i], d = r.z - pzT;
        if (d < -PLAYER_Z * 0.6 - 200 || d > (DRAW_DIST - 2) * SEG_LEN) continue;
        const ri = circ ? Math.floor(wrapZ(r.z) / SEG_LEN) % N : clamp(Math.floor(r.z / SEG_LEN), 0, N - 1);
        (rivalBy[ri] = rivalBy[ri] || []).push(r);
    }

    // 2) dibujo de lejos a cerca
    for (let i = entries.length - 1; i >= 0; i--) drawEntry(entries[i], rivalBy[entries[i].seg.index]);
    return { shakeX: shakeX, shakeY: shakeY };
}

// Dentro de un túnel: oscurece la escena y suma el haz de los faros
function drawTunnelLight() {
    const seg = stage.segs[segIndexAt(position + PLAYER_Z)];
    if (!seg || !seg.tunnel) return;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const g = ctx.createRadialGradient(WIDTH / 2, HEIGHT * 0.66, 10, WIDTH / 2, HEIGHT * 0.66, 280);
    g.addColorStop(0, 'rgba(255,244,200,0.38)'); g.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalCompositeOperation = 'source-over';
}

function fitDims(img, boxW, boxH) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return { w: boxW, h: boxH };
    const ba = boxW / boxH, ia = img.naturalWidth / img.naturalHeight;
    return ia > ba ? { w: boxW, h: boxW / ia } : { w: boxH * ia, h: boxH };
}

function drawPlayerCar(shake) {
    const cW = 300, cH = 205;
    const bounce = (gameState === 'RUNNING' && speed > 5) ? Math.sin(stageTime * 16) * (speed / VEHICLES[selVeh].top) * 2.4 : 0;
    const lean = clamp(steerInput * 0.08 + vx * 0.02, -0.14, 0.14);
    const cX = WIDTH / 2 - cW / 2 + steerInput * 30 + shake.shakeX;
    const cY = HEIGHT - cH - 14 + shake.shakeY + bounce;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(WIDTH / 2 + steerInput * 30, HEIGHT - 16, cW * 0.42, 9, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.translate(cX + cW / 2, cY + cH);
    ctx.rotate(lean);
    ctx.translate(-(cX + cW / 2), -(cY + cH));
    const img = carImgs[selVeh];
    if (img && img.complete && img.naturalWidth !== 0) {
        const d = fitDims(img, cW, cH);
        ctx.drawImage(img, cX + (cW - d.w) / 2, cY + (cH - d.h), d.w, d.h);
    } else {
        const col = ['#ff2a00', '#0066ff', '#ccaa00'][selVeh];
        ctx.fillStyle = '#0f0f14'; ctx.fillRect(cX + 6, cY + cH - 35, 24, 35); ctx.fillRect(cX + cW - 30, cY + cH - 35, 24, 35);
        ctx.fillStyle = col; ctx.fillRect(cX, cY + 25, cW, cH - 40);
        ctx.fillStyle = '#14161f'; ctx.fillRect(cX + 16, cY + 35, cW - 32, 25);
        ctx.fillStyle = keys.down ? '#ff1111' : '#660000'; ctx.fillRect(cX + 8, cY + cH - 28, 22, 10); ctx.fillRect(cX + cW - 30, cY + cH - 28, 22, 10);
    }
    ctx.restore();
}

function drawParticles(shake) {
    for (const p of particles) {
        ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * 0.65;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x + shake.shakeX, p.y + shake.shakeY, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
}

function drawSnowfall() {
    if (!curTheme.snowfall || gameState === 'START') return;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const moving = gameState !== 'PAUSED';
    const wind = -bgX * 0.0; // el viento no depende de la curva para no marear
    for (const f of flakes) {
        if (moving) {
            f.y += f.s * STEP * (1 + speed / 260);
            f.x += Math.sin(f.y * 0.03 + f.r) * 0.4 - speed * 0.004 + wind;
            if (f.y > HEIGHT) { f.y = -4; f.x = Math.random() * WIDTH; }
            if (f.x < -4) f.x += WIDTH + 8;
        }
        ctx.fillRect(f.x, f.y, f.r, f.r);
    }
}

// ---- Minimapa (también se usa en el menú) ----


// ---- Minimapa: la geometría real de la pista; túneles en naranja y puentes en celeste ----
function drawMini(c, x, y, size, stg, playerSeg, riv) {
    c.fillStyle = 'rgba(8, 14, 26, 0.85)';
    c.fillRect(x, y, size, size);
    c.strokeStyle = ACCENT; c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, size - 2, size - 2);
    const pad = 12, span = size - pad * 2;
    const ox = x + pad + span * (1 - stg.mini.w) / 2, oy = y + pad + span * (1 - stg.mini.h) / 2;
    const pts = stg.mini.pts, feat = stg.mini.feat, n = pts.length;
    const P = function (i) { return [ox + pts[i % n].x * span, oy + pts[i % n].y * span]; };
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 3;
    c.beginPath();
    for (let i = 0; i < n; i++) { const p = P(i); if (i === 0) c.moveTo(p[0], p[1]); else c.lineTo(p[0], p[1]); }
    if (stg.mini.closed) c.closePath();
    c.stroke();
    // estructuras: tramos marcados con color
    for (let kind = 1; kind <= 2; kind++) {
        c.strokeStyle = kind === 1 ? '#ff9f1a' : '#4fc3f7'; c.lineWidth = 4.5;
        let i = 0;
        while (i < n) {
            if (feat[i] === kind) {
                let j = i;
                c.beginPath(); const p0 = P(i > 0 ? i - 1 : i); c.moveTo(p0[0], p0[1]);
                while (j < n && feat[j] === kind) { const p = P(j); c.lineTo(p[0], p[1]); j++; }
                c.stroke();
                i = j;
            } else i++;
        }
    }
    const s0 = P(0);
    c.fillStyle = '#1fae4b';
    c.beginPath(); c.arc(s0[0], s0[1], 3.5, 0, Math.PI * 2); c.fill();
    if (!stg.mini.closed) {
        const e0 = P(n - 1);
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(e0[0], e0[1], 3.5, 0, Math.PI * 2); c.fill();
    }
    if (riv) {
        for (let i = 0; i < riv.length; i++) {
            const zl = stg.mode === 'circuit' ? ((riv[i].z % stg.TL) + stg.TL) % stg.TL : riv[i].z;
            const ri = clamp(Math.floor(zl / SEG_LEN / 6), 0, n - 1), p = P(ri);
            c.fillStyle = riv[i].ghost ? '#ffffff' : RIVAL_COLORS[riv[i].veh]; c.strokeStyle = '#000'; c.lineWidth = 1;
            c.beginPath(); c.arc(p[0], p[1], 3.2, 0, Math.PI * 2); c.fill(); c.stroke();
        }
    }
    if (playerSeg >= 0) {
        const p = P(clamp(Math.floor(playerSeg / 6), 0, n - 1));
        c.fillStyle = ACCENT; c.strokeStyle = '#000'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(p[0], p[1], 5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
}

// ---- HUD ----
function txt(str, x, y, size, color, align, bold) {
    ctx.font = (bold === false ? '' : 'bold ') + size + 'px monospace';
    ctx.fillStyle = color; ctx.textAlign = align || 'left';
    ctx.fillText(str, x, y);
    ctx.textAlign = 'left';
}
function arrow(cx, cy, dir, s, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + dir * s, cy); ctx.lineTo(cx - dir * s * 0.6, cy - s * 0.9); ctx.lineTo(cx - dir * s * 0.6, cy + s * 0.9);
    ctx.closePath(); ctx.fill();
}


function drawPacenotes() {
    const rows = upcomingNotes(3, 450);
    if (!rows.length) return;
    const px = WIDTH / 2 - 105, py = 10, rh = 27;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(px, py, 210, rows.length * rh + 6);
    rows.forEach(function (r, i) {
        const y = py + 3 + i * rh + rh / 2, n = r.n;
        ctx.globalAlpha = i === 0 ? 1 : 0.65;
        if (n.kind === 'tunnel' || n.kind === 'bridge') {
            const col = n.kind === 'tunnel' ? '#ff9f1a' : '#4fc3f7';
            ctx.strokeStyle = col; ctx.lineWidth = 3;
            ctx.beginPath();
            if (n.kind === 'tunnel') { ctx.moveTo(px + 11, y + 8); ctx.lineTo(px + 11, y - 1); ctx.arc(px + 20, y - 1, 9, Math.PI, 0); ctx.lineTo(px + 29, y + 8); }
            else { ctx.moveTo(px + 9, y + 3); ctx.quadraticCurveTo(px + 20, y - 9, px + 31, y + 3); ctx.moveTo(px + 9, y + 7); ctx.lineTo(px + 31, y + 7); }
            ctx.stroke();
            txt(n.kind === 'tunnel' ? 'TÚNEL' : 'PUENTE', px + 48, y + 6, 16, col);
        } else {
            const g = n.grade;
            const col = g <= 2 ? '#ff5252' : g <= 4 ? '#ffb800' : '#6bff8a';
            arrow(px + 20, y, n.dir === 'R' ? 1 : -1, 9, col);
            txt(String(g), px + 48, y + 8, 22, col);
            const tag = (n.hairpin ? 'HORQ ' : '') + (n.long ? 'LARGA' : '');
            if (tag) txt(tag, px + 72, y + 5, 12, '#ffffff');
        }
        txt(Math.round(r.m / 10) * 10 + 'm', px + 200, y + 6, 16, '#ffffff', 'right');
        ctx.globalAlpha = 1;
    });
}

function drawHUD() {
    if (gameState === 'START') return;
    const veh = VEHICLES[selVeh];
    const circ = stage.mode === 'circuit';
    const seg = stage.segs[segIndexAt(position + PLAYER_Z)];

    // Paneles de fondo para que el HUD se lea sobre cualquier paisaje
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(10, 8, 198, 144);
    ctx.fillRect(10, HEIGHT - 124, 160, 116);

    txt((comp && comp.tt ? 'CRONO   ' : (circ ? 'CARRERA ' : 'ETAPA   ')) + formatTime(stageTime), 20, 30, 20, '#ffffff');
    if (comp && comp.tt) txt(ghostRec ? 'RÉC ' + formatTime(ghostRec.time) : 'SIN RÉCORD', 20, 55, 20, ACCENT);
    else txt('LÍMITE ' + Math.ceil(Math.max(0, timeLeft)) + ' s', 20, 55, 20, timeLeft < 10 ? '#ff4d4d' : ACCENT);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, 66, 120, 6);
    ctx.fillStyle = damage > 66 ? '#ff4d4d' : damage > 33 ? '#ffb800' : '#6bff8a';
    ctx.fillRect(20, 66, 120 * damage / 100, 6);
    txt('DAÑO ' + Math.round(damage) + '%', 20, 90, 13, '#c8d2e0', 'left', false);
    if (rivals.length) {
        const rk = currentRank();
        txt('POSICIÓN P' + rk + '/' + (rivals.length + 1), 20, 118, 17, rk === 1 ? '#6bff8a' : '#ffffff');
    } else if (comp && comp.tt) {
        const gd = ghostDelta();
        if (gd == null) txt('SIN SOMBRA', 20, 118, 17, '#c8d2e0');
        else txt('SOMBRA ' + (gd > 0 ? '+' : '-') + Math.abs(gd).toFixed(2) + ' s', 20, 118, 17, gd > 0.005 ? '#ff6b6b' : '#6bff8a');
    }
    if (circ) {
        const lapCur = Math.min(lapNo + 1, stage.laps);
        txt('VUELTA ' + lapCur + '/' + stage.laps + '  ' + formatTime(stageTime - lapStartTime), 20, 142, 14, '#ffffff');
    } else {
        const pct = Math.round(clamp((position + PLAYER_Z) / (stage.finishSeg * SEG_LEN), 0, 1) * 100);
        txt(pct + '% DE LA ETAPA', 20, 142, 14, '#ffffff');
    }

    // Minimapa + datos de la prueba
    drawMini(ctx, WIDTH - 112, 12, 100, stage, seg.index, ghostCar ? rivals.concat([ghostCar]) : rivals);
    ctx.fillStyle = 'rgba(8,14,26,0.85)';
    ctx.fillRect(WIDTH - 112, 112, 100, 38);
    if (circ) txt('VUELTA ' + Math.min(lapNo + 1, stage.laps) + '/' + stage.laps, WIDTH - 62, 129, 14, '#ffffff', 'center');
    else txt(Math.max(0, (stage.finishSeg * SEG_LEN - (position + PLAYER_Z)) * M_PER_UNIT / 1000).toFixed(1) + ' km', WIDTH - 62, 129, 14, '#ffffff', 'center');
    txt((comp && comp.order.length > 1 ? (comp.k + 1) + '/' + comp.order.length + ' ' : '') + SHORT_NAMES[stageIdx].toUpperCase(), WIDTH - 62, 144, 9, '#c8d2e0', 'center', false);

    if (gameState !== 'COUNTDOWN') drawPacenotes();

    // Velocímetro
    txt(String(Math.floor(speed)), 20, HEIGHT - 30, 44, '#ffffff');
    txt('KM/H', 112, HEIGHT - 32, 14, '#9fb0c8', 'left', false);
    const sLabel = seg.tunnel ? 'TÚNEL' : seg.bridge ? 'PUENTE' : SURFACES[seg.surface].name;
    txt(sLabel, 20, HEIGHT - 104, 15, seg.tunnel ? '#ff9f1a' : seg.bridge ? '#4fc3f7' : ACCENT);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(20, HEIGHT - 22, 130, 7);
    ctx.fillStyle = rpm > veh.rpmMax * 0.9 ? '#ff4d4d' : ACCENT;
    ctx.fillRect(20, HEIGHT - 22, 130 * clamp(rpm / veh.rpmMax, 0, 1), 7);
    txt('MARCHA ' + gear, 20, HEIGHT - 84, 15, '#c8d2e0', 'left', false);

    // Barra de progreso (con checkpoints en etapas y vueltas en circuitos)
    const bx = 250, bw = 300, by = HEIGHT - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx, by, bw, 4);
    const prog = clamp((position + PLAYER_Z) / raceGoal(), 0, 1);
    ctx.fillStyle = ACCENT; ctx.fillRect(bx, by, bw * prog, 4);
    ctx.fillStyle = '#ffffff';
    if (circ) { for (let l = 1; l < stage.laps; l++) ctx.fillRect(bx + bw * l / stage.laps - 1, by - 3, 2, 10); }
    else stage.cps.forEach(function (c) { ctx.fillRect(bx + bw * c / stage.finishSeg - 1, by - 3, 2, 10); });

    // Cuenta regresiva y avisos
    if (gameState === 'COUNTDOWN') {
        const num = Math.ceil(countdown - 0.6);
        if (num >= 1) txt(String(num), WIDTH / 2, HEIGHT / 2 - 40, 90, ACCENT, 'center');
    }
    if (popup.t > 0) {
        txt(popup.text, WIDTH / 2, HEIGHT / 2 - 60, 40, '#ffffff', 'center');
        if (popup.sub) txt(popup.sub, WIDTH / 2, HEIGHT / 2 - 24, 28, ACCENT, 'center');
    }
    if (gameState === 'PAUSED') {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
        txt('PAUSA', WIDTH / 2, HEIGHT / 2, 52, ACCENT, 'center');
        txt('P / Esc: continuar  ·  M: música  ·  C: copiloto', WIDTH / 2, HEIGHT / 2 + 34, 15, '#ffffff', 'center', false);
    }
}

function renderFrame() {
    if (!stage) return;
    ctx.imageSmoothingEnabled = false;
    const shake = renderWorld();
    drawTunnelLight();
    drawParticles(shake);
    if (gameState !== 'START') drawPlayerCar(shake);
    drawSnowfall();
    if (crashFlash > 0) {
        ctx.fillStyle = 'rgba(255, 30, 0, ' + ((crashFlash / 0.35) * 0.5).toFixed(3) + ')';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    drawHUD();
}

// ---------------------------------------------------------------------------
// LOOP PRINCIPAL (pasos fijos con acumulador: igual en cualquier navegador)
// ---------------------------------------------------------------------------
let _last = null, _acc = 0;
const MAX_STEPS = 5;
function masterLoop(now) {
    if (_last === null) _last = now;
    let d = (now - _last) / 1000;
    _last = now;
    if (d > 0.25) d = 0.25;
    _acc += d;
    let steps = 0;
    while (_acc >= STEP && steps < MAX_STEPS) { updatePhysics(STEP); _acc -= STEP; steps++; }
    renderFrame();
    requestAnimationFrame(masterLoop);
}

window.onload = function () {
    initInput();
    populateEvents();
    updateMenu();
    requestAnimationFrame(masterLoop);
};


