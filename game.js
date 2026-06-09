import * as THREE from 'three';

/* =========================================================
 *  侏罗之夜 - 固定机位探索 + ATB 实时战斗
 *  致敬 寄生前夜系列：场景内移动 → 遭遇敌人 → 在当前场景战斗
 * ========================================================= */

const $ = (s) => document.querySelector(s);
const stage = $('#stage');
const fxLayer = $('#fxLayer');
const canvas = $('#c');
const subMenu = $('#subMenu');
const cmdMenu = $('#cmdMenu');
const atbHint = $('#atbHint');
const logEl = $('#log');
const bigTitleEl = $('#bigTitle');
const toastEl = $('#toast');
const fadeEl = $('#fade');
const joystickEl = $('#joystick');
const nubEl = $('#nub');
const actBtnEl = $('#actBtn');
const areaBadge = $('#areaBadge');
const modeBadge = $('#modeBadge');

const G = {
  scene:null, camera:null, renderer:null,
  state:'title', player:null, enemies:[], bullets:[],
  areaIdx:0, curArea:null, curCamIdx:0,
  selectedEnemy:0, pendingAction:null,
  battleArena:null, arenaRing:null,
  actCallback:null,
  joy:{active:false, x:0, y:0, id:null, baseX:0, baseY:0},
  paused:false, // 行动执行中暂停游戏
  _fires: [],
  doors: [],
  walls: [],
  _lights: [],
};

const Player = {
  hp:100, hpMax:100, mp:30, mpMax:30,
  atk:14, def:4, atb:0, atbMax:100, atbSpeed:14, // v2: 14 -> 慢
  speed:3.6, battleSpeed:3.2, alive:true,
  baseCrit: 0.18,
  foreseeCritBonus: 0.6,
  buffs:{ haste:0, foresee:0 },
  skills:[
    { id:'aimshot', name:'瞄准射击', cost:6,  desc:'伤害×1.6 必中要害',  dmg:1.6, crit:1, range:14 },
    { id:'burst',   name:'三连射',   cost:10, desc:'连续3次伤害',         dmg:0.7, hits:3,  range:12 },
    { id:'grenade', name:'手雷',     cost:14, desc:'范围伤害（圆心3m）',  dmg:1.1, aoe:3,   range:9 },
  ],
  items:[
    { id:'med', name:'医疗包',   count:3, desc:'回复60HP', heal:60 },
    { id:'adr', name:'肾上腺素', count:2, desc:'回复15MP+加速ATB', mp:15, buff:'haste' },
  ],
};

const EnemyTpl = {
  velo:   { name:'迅猛龙', hp:55,  atk:11, def:1, atbSpeed:18, color:0x6faa55, scale:0.9, type:'raptor', speed:1.4, atkRange:1.7, atkPrep:0.8, atkAoe:0,   pauseChance:0.45, pauseDur:[1.2,2.2] },
  pter:   { name:'翼龙',   hp:42,  atk:9,  def:0, atbSpeed:22, color:0x9b6bbd, scale:0.8, type:'ptero',  speed:1.7, atkRange:1.6, atkPrep:0.7, atkAoe:0,   pauseChance:0.35, pauseDur:[0.8,1.8] },
  tricer: { name:'三角龙', hp:110, atk:16, def:5, atbSpeed:12, color:0x8a6a3a, scale:1.2, type:'tricer', speed:1.0, atkRange:2.1, atkPrep:1.2, atkAoe:0,   pauseChance:0.55, pauseDur:[1.6,2.8] },
  rex:    { name:'霸王龙', hp:220, atk:22, def:6, atbSpeed:13, color:0x5a3a2a, scale:1.4, type:'rex',    speed:1.2, atkRange:2.6, atkPrep:1.3, atkAoe:2.5, pauseChance:0.40, pauseDur:[1.5,2.5] },
};

const Areas = [];

// ---------- 几何工具 ----------
function makeGroundPatch(w,h, color=0x2c3a30){
  const geo = new THREE.PlaneGeometry(w, h, Math.ceil(w/3), Math.ceil(h/3));
  geo.rotateX(-Math.PI/2);
  const pos = geo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i), z=pos.getZ(i);
    pos.setY(i, Math.sin(x*0.3)*Math.cos(z*0.25)*0.25 + Math.sin(x*0.7+z*0.5)*0.15);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, flatShading:true, roughness:1 }));
  m.receiveShadow=true;
  return m;
}
function makeTree(){
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.25,1.4,5),
    new THREE.MeshStandardMaterial({color:0x3a2a1a,flatShading:true}));
  trunk.position.y=0.7; trunk.castShadow=true; g.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({color:0x2d4a2a,flatShading:true});
  for(let i=0;i<3;i++){
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.9-i*0.2,1.0,5), leafMat);
    c.position.y = 1.4 + i*0.55; c.castShadow=true; g.add(c);
  }
  return g;
}
function makeRock(){
  const r = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6,0),
    new THREE.MeshStandardMaterial({color:0x4a5560, flatShading:true}));
  r.castShadow=true; r.receiveShadow=true; return r;
}
function makeCampfire(pos){
  const g = new THREE.Group();
  const logMat = new THREE.MeshStandardMaterial({ color:0x3d2a1a, flatShading:true });
  const logGeo = new THREE.CylinderGeometry(0.08,0.08,0.9,5);
  for(let i=0;i<4;i++){
    const lg = new THREE.Mesh(logGeo,logMat);
    lg.rotation.z = Math.PI/2; lg.rotation.y = i*Math.PI/4;
    lg.position.y = 0.1; lg.castShadow=true; g.add(lg);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35,0.9,5),
    new THREE.MeshBasicMaterial({color:0xff8a3a}));
  flame.position.y=0.55; g.add(flame);
  g.position.copy(pos);
  const light = new THREE.PointLight(0xff8a3a, 1.6, 14, 2);
  light.position.set(pos.x, 1.2, pos.z);
  G.scene.add(light);
  G._fires.push({flame, light});
  return g;
}
function makeTent(){
  const g = new THREE.Group();
  const tent = new THREE.Mesh(new THREE.ConeGeometry(1.2,1.4,4),
    new THREE.MeshStandardMaterial({color:0x5a4032,flatShading:true}));
  tent.rotation.y = Math.PI/4; tent.position.y=0.7; tent.castShadow=true; g.add(tent);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6,0.7),
    new THREE.MeshStandardMaterial({color:0x1a1208,side:THREE.DoubleSide}));
  door.position.set(0,0.35,0.85); g.add(door);
  return g;
}
function makeCrate(){
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8),
    new THREE.MeshStandardMaterial({color:0x7a5530,flatShading:true}));
  c.position.y=0.4; c.castShadow=true; c.receiveShadow=true; return c;
}

// =============== 室内构件（v2） ===============
function makeFloor(w, d, color=0x383d44){
  const geo = new THREE.PlaneGeometry(w, d, Math.max(2,Math.floor(w/2)), Math.max(2,Math.floor(d/2)));
  geo.rotateX(-Math.PI/2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color, flatShading:true, roughness:0.92}));
  m.receiveShadow = true; return m;
}
function makeWall(x1,z1,x2,z2, h=3.0, color=0x6a6f78){
  const dx=x2-x1, dz=z2-z1;
  const len=Math.sqrt(dx*dx+dz*dz);
  const angle=Math.atan2(dx, dz);
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, h, len),
    new THREE.MeshStandardMaterial({color, flatShading:true, roughness:0.95})
  );
  m.position.set((x1+x2)/2, h/2, (z1+z2)/2);
  m.rotation.y = angle - Math.PI/2;
  m.castShadow = true; m.receiveShadow = true;
  G.walls.push({x1,z1,x2,z2});
  return m;
}
function makeCeiling(w, d, y=3.0, color=0x12161c){
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(Math.PI/2);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color, flatShading:true, roughness:1, side:THREE.DoubleSide}));
  m.position.y = y; return m;
}
function makeDoor(x, z, label, target, locked=false){
  const g = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 2.4, 0.18),
    new THREE.MeshStandardMaterial({color:0x2a2f38, flatShading:true})
  );
  frame.position.y = 1.2; g.add(frame);
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 2.2, 0.12),
    new THREE.MeshStandardMaterial({
      color: locked?0x4a1a1a:0x2c4f6e,
      emissive: locked?0x331010:0x18324a, flatShading:true
    })
  );
  panel.position.set(0,1.2,0.05); g.add(panel);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.07,8,8),
    new THREE.MeshBasicMaterial({color: locked?0xff3344:0x7ff0c4})
  );
  led.position.set(0.55, 2.15, 0.13); g.add(led);
  // 顶部小灯
  const lit = new THREE.PointLight(locked?0xff3344:0x7ff0c4, 0.4, 3);
  lit.position.set(0, 2.4, 0.3); g.add(lit);
  g.position.set(x, 0, z);
  return { mesh:g, pos:new THREE.Vector3(x,0,z), label, target, locked };
}
function makeDeskV2(){
  const g = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.08, 0.8),
    new THREE.MeshStandardMaterial({color:0x4a4a52, flatShading:true})
  );
  top.position.y=0.85; top.castShadow=true; g.add(top);
  for(const [sx,sz] of [[-0.7,-0.3],[0.7,-0.3],[-0.7,0.3],[0.7,0.3]]){
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.08,0.85,0.08),
      new THREE.MeshStandardMaterial({color:0x2a2e36,flatShading:true})
    );
    leg.position.set(sx,0.42,sz); g.add(leg);
  }
  return g;
}
function makeMonitor(){
  const g = new THREE.Group();
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.55,0.4,0.05),
    new THREE.MeshStandardMaterial({color:0x111418, emissive:0x1a3a4a, emissiveIntensity:0.8, flatShading:true})
  );
  screen.position.y=0.32;
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.16,0.18,0.1),
    new THREE.MeshStandardMaterial({color:0x2a2e36, flatShading:true})
  );
  stand.position.y=0.05;
  g.add(stand); g.add(screen);
  return g;
}
function makeBarrel(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4,0.4,1.0,12),
    new THREE.MeshStandardMaterial({color:0x9a5a28, flatShading:true})
  );
  body.position.y=0.5; body.castShadow=true; g.add(body);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.4,0.04,6,16),
    new THREE.MeshStandardMaterial({color:0x3a2515, flatShading:true})
  );
  ring.rotation.x = Math.PI/2;
  ring.position.y = 0.25; g.add(ring);
  const ring2 = ring.clone(); ring2.position.y = 0.75; g.add(ring2);
  return g;
}
function makeCage(){
  const g = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({color:0x2a3038, flatShading:true});
  const barMat = new THREE.MeshStandardMaterial({color:0x4a4f55, flatShading:true});
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.1,2.4), baseMat);
  base.position.y=0.05; g.add(base);
  for(const [x,z] of [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]){
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12,2.4,0.12), baseMat);
    p.position.set(x,1.2,z); g.add(p);
  }
  for(let i=-1;i<=1;i+=0.4){
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.04,2.0,0.04), barMat);
    b1.position.set(i+0.1,1.0,-1.1); g.add(b1);
    const b2 = b1.clone(); b2.position.set(i+0.1,1.0,1.1); g.add(b2);
  }
  // 撞坏的笼门
  const broken = new THREE.Mesh(new THREE.BoxGeometry(0.04,1.4,2.0), barMat);
  broken.position.set(-1.1,0.7,0); broken.rotation.z=0.6; g.add(broken);
  return g;
}
function makeBlood(x, z, scale=1){
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.6*scale, 12),
    new THREE.MeshBasicMaterial({color:0x4a0a10, transparent:true, opacity:0.7})
  );
  m.rotation.x = -Math.PI/2;
  m.position.set(x,0.02,z);
  return m;
}
function addCeilingLight(x, z, color=0xfff2c8, intensity=0.9, flicker=false){
  // v2.1: range 增大到 22，decay 改 1（线性）让落到地面强度更高
  const lamp = new THREE.PointLight(color, intensity*1.6, 22, 1.0);
  lamp.position.set(x, 2.7, z);
  G.scene.add(lamp);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25,0.32,0.08,8),
    new THREE.MeshStandardMaterial({color:0xddd6c0, emissive:color, emissiveIntensity:0.8, flatShading:true})
  );
  cap.position.set(x, 2.85, z);
  G.scene.add(cap);
  G._lights.push({lamp, base:intensity*1.6, flicker, t:Math.random()*10});
}

// 房间 1：研究站 · 大厅
function buildRoomLobby(){
  const W=12, D=14;
  G.scene.add(makeFloor(W, D, 0x383d44));
  // v2.2: 不画天花板，避免俯视摄像机被遮挡
  // G.scene.add(makeCeiling(W, D, 3.0, 0x14181e));
  // 北墙留 1.6 宽门洞（在 x=0 处）
  G.scene.add(makeWall(-W/2, -D/2,  -0.8, -D/2));
  G.scene.add(makeWall( 0.8, -D/2,   W/2, -D/2));
  G.scene.add(makeWall(-W/2,  D/2,   W/2,  D/2));
  G.scene.add(makeWall( W/2, -D/2,   W/2,  D/2));
  G.scene.add(makeWall(-W/2, -D/2,  -W/2,  D/2));
  // 灯
  addCeilingLight(-3, -3, 0xfff2c8, 1.0, true);
  addCeilingLight( 3,  3, 0xfff2c8, 0.9);
  addCeilingLight( 3, -3, 0xfff2c8, 0.7, true);
  addCeilingLight(-3,  3, 0xfff2c8, 0.8);
  // 桌+显示器
  const desk = makeDeskV2(); desk.position.set(-4, 0, 0); desk.rotation.y = Math.PI/2; G.scene.add(desk);
  const mon = makeMonitor(); mon.position.set(-4, 0.85, 0.3); mon.rotation.y = Math.PI; G.scene.add(mon);
  // 木箱堆
  for(const [x,y,z] of [[4.5,0,4],[4.5,0,3],[4.5,0.8,4]]){
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8),
      new THREE.MeshStandardMaterial({color:0x6a4a28,flatShading:true}));
    c.position.set(x, y+0.4, z); c.castShadow=true; c.receiveShadow=true;
    G.scene.add(c);
  }
  // 桶
  const b1 = makeBarrel(); b1.position.set(-5, 0, -5); G.scene.add(b1);
  const b2 = makeBarrel(); b2.position.set(-4, 0, -5); G.scene.add(b2);
  // 北门 → 实验室
  const door = makeDoor(0, -D/2 + 0.15, '前往 实验室', 1, false);
  G.scene.add(door.mesh);
  G.doors.push(door);
}

// 房间 2：研究站 · 实验室
function buildRoomLab(){
  const W=14, D=12;
  G.scene.add(makeFloor(W, D, 0x303a40));
  // v2.2: 不画天花板
  // G.scene.add(makeCeiling(W, D, 3.0, 0x10141a));
  // 南墙留洞（玩家从这里进来）
  G.scene.add(makeWall(-W/2,  D/2,  -0.8,  D/2));
  G.scene.add(makeWall( 0.8,  D/2,   W/2,  D/2));
  // 北墙留洞（去饲养区）
  G.scene.add(makeWall(-W/2, -D/2,  -0.8, -D/2));
  G.scene.add(makeWall( 0.8, -D/2,   W/2, -D/2));
  G.scene.add(makeWall( W/2, -D/2,   W/2,  D/2));
  G.scene.add(makeWall(-W/2, -D/2,  -W/2,  D/2));
  // 红色应急灯 + 一盏暖灯
  addCeilingLight(-4, 0, 0xff5544, 0.8, true);
  addCeilingLight( 4, 0, 0xff5544, 0.6, true);
  addCeilingLight( 0, -3, 0xfff2c8, 0.7);
  addCeilingLight( 0,  3, 0xfff2c8, 0.5);
  // 实验台
  for(let i=0;i<2;i++){
    const desk = makeDeskV2();
    desk.position.set(-4 + i*8, 0, -2);
    G.scene.add(desk);
    const m = makeMonitor();
    m.position.set(-4 + i*8, 0.85, -2.1);
    G.scene.add(m);
  }
  // 笼子（被撞破，剧情暗示）
  const cage = makeCage();
  cage.position.set(0, 0, 2);
  G.scene.add(cage);
  G.scene.add(makeBlood(-1, 1.2, 1.2));
  G.scene.add(makeBlood(1.5, -0.5, 0.8));
  G.scene.add(makeBlood(2.5, -2, 0.6));
  // 翻倒的桶
  const fallen = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4,0.4,1.0,12),
    new THREE.MeshStandardMaterial({color:0x9a5a28, flatShading:true})
  );
  fallen.position.set(5, 0.4, 3); fallen.rotation.z = Math.PI/2;
  G.scene.add(fallen);
  // 北门 → 饲养区
  const door = makeDoor(0, -D/2 + 0.15, '前往 饲养区', 2, false);
  G.scene.add(door.mesh);
  G.doors.push(door);
}

// 房间 3：研究站 · 饲养区（Boss）
function buildRoomNest(){
  const W=18, D=16;
  G.scene.add(makeFloor(W, D, 0x2a221a));
  // v2.2: 不画天花板
  // G.scene.add(makeCeiling(W, D, 3.4, 0x0a0608));
  G.scene.add(makeWall(-W/2,  D/2,   W/2,  D/2));
  G.scene.add(makeWall(-W/2, -D/2,   W/2, -D/2));
  G.scene.add(makeWall( W/2, -D/2,   W/2,  D/2));
  G.scene.add(makeWall(-W/2, -D/2,  -W/2,  D/2));
  // 红色应急灯
  addCeilingLight(-4, 4, 0xaa2222, 1.0, true);
  addCeilingLight( 4, -4, 0xaa2222, 1.0, true);
  addCeilingLight( 0, 0, 0xff5544, 0.6, true);
  addCeilingLight(-5,-5, 0xaa2222, 0.6);
  addCeilingLight( 5, 5, 0xaa2222, 0.6);
  // 散落的骨头
  const boneMat = new THREE.MeshStandardMaterial({color:0xc8c0a8, flatShading:true});
  for(let i=0;i<22;i++){
    const b = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06,0.06, 0.8+Math.random()*0.6, 5),
      boneMat
    );
    b.position.set((Math.random()-0.5)*W*0.7, 0.05, (Math.random()-0.5)*D*0.7);
    b.rotation.z = Math.random()*Math.PI;
    b.rotation.y = Math.random()*Math.PI;
    G.scene.add(b);
  }
  // 砸破的笼子
  const cage1 = makeCage(); cage1.position.set(-5, 0, -4); cage1.rotation.y = 0.3; G.scene.add(cage1);
  const cage2 = makeCage(); cage2.position.set(6, 0, 5); cage2.rotation.y = -0.6; G.scene.add(cage2);
  // 大量血迹
  G.scene.add(makeBlood(0, 0, 2.5));
  G.scene.add(makeBlood(-3, 2, 1.4));
  G.scene.add(makeBlood(2.5, -3, 1.2));
  // 翻倒的箱
  for(let i=0;i<4;i++){
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.8,0.8),
      new THREE.MeshStandardMaterial({color:0x6a4a28,flatShading:true}));
    c.position.set((Math.random()-0.5)*W*0.6, 0.4, (Math.random()-0.5)*D*0.6);
    c.rotation.y = Math.random()*Math.PI;
    G.scene.add(c);
  }
  // Boss 战 - 无出口门
}

function setupAreas(){
  Areas.length = 0;
  Areas.push({
    name:'研究站 · 大厅',
    bounds:{minX:-5.6, maxX:5.6, minZ:-6.6, maxZ:6.6},
    spawn: new THREE.Vector3(0, 0, 5),
    cams:[{ pos:new THREE.Vector3(0, 13, 11), look:new THREE.Vector3(0, 0, -1), fov:50 }],
    battle:{
      trigger:{ pos:new THREE.Vector3(0,0,-1), radius:2.2 },
      arena:{ center:new THREE.Vector3(0,0,-1), radius:5.0 },
      enemies:['velo','velo'],
    },
    build: buildRoomLobby,
  });
  Areas.push({
    name:'研究站 · 实验室',
    bounds:{minX:-6.6, maxX:6.6, minZ:-5.6, maxZ:5.6},
    spawn: new THREE.Vector3(0, 0, 4.5),
    cams:[{ pos:new THREE.Vector3(0, 13, 10), look:new THREE.Vector3(0, 0, -1.5), fov:54 }],
    battle:{
      trigger:{ pos:new THREE.Vector3(0,0,0), radius:2.2 },
      arena:{ center:new THREE.Vector3(0,0,0), radius:5.0 },
      enemies:['velo','pter','tricer'],
    },
    build: buildRoomLab,
  });
  Areas.push({
    name:'研究站 · 饲养区',
    bounds:{minX:-8.6, maxX:8.6, minZ:-7.6, maxZ:7.6},
    spawn: new THREE.Vector3(0, 0, 6.5),
    cams:[{ pos:new THREE.Vector3(0, 15, 12), look:new THREE.Vector3(0, 0.5, -1.5), fov:50 }],
    battle:{
      trigger:{ pos:new THREE.Vector3(0,0,1.5), radius:2.5 },
      arena:{ center:new THREE.Vector3(0,0,0), radius:6.5 },
      enemies:['rex'], isFinal:true,
    },
    build: buildRoomNest,
  });
}

// ---------- 角色 / 恐龙 ----------
function makeHuman(){
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({color:0xd6a98a,flatShading:true});
  const cloth = new THREE.MeshStandardMaterial({color:0x44505a,flatShading:true});
  const pants = new THREE.MeshStandardMaterial({color:0x2a323a,flatShading:true});
  const gunMat = new THREE.MeshStandardMaterial({color:0x222a30,flatShading:true,metalness:.6,roughness:.4});
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55,0.7,0.35), cloth);
  body.position.y=1.15; body.castShadow=true; g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36,0.36,0.36), skin);
  head.position.y=1.7; head.castShadow=true; g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.12,0.4),
    new THREE.MeshStandardMaterial({color:0x1a1a1a,flatShading:true}));
  hair.position.y=1.92; g.add(hair);
  const legGeo = new THREE.BoxGeometry(0.18,0.7,0.22);
  const legL = new THREE.Mesh(legGeo,pants); legL.position.set(-0.13,0.45,0); legL.castShadow=true; g.add(legL);
  const legR = new THREE.Mesh(legGeo,pants); legR.position.set( 0.13,0.45,0); legR.castShadow=true; g.add(legR);
  const armGeo = new THREE.BoxGeometry(0.16,0.55,0.18);
  const armL = new THREE.Mesh(armGeo,cloth); armL.position.set(-0.36,1.2,0); armL.castShadow=true; g.add(armL);
  const armR = new THREE.Mesh(armGeo,cloth); armR.position.set( 0.36,1.2,0); armR.castShadow=true; g.add(armR);
  const gun = new THREE.Group();
  const gBody = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.12,0.55), gunMat);
  gBody.position.z=-0.2; gun.add(gBody);
  const gBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.4,6), gunMat);
  gBarrel.rotation.x=Math.PI/2; gBarrel.position.z=-0.65; gun.add(gBarrel);
  gun.position.set(0.36,1.1,-0.1); g.add(gun);
  g.userData = { body, head, armL, armR, legL, legR, gun };
  return g;
}

function makeDino(type, color){
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({color, flatShading:true});
  const dark = new THREE.MeshStandardMaterial({color: new THREE.Color(color).multiplyScalar(0.55), flatShading:true});
  const eyeMat = new THREE.MeshBasicMaterial({color:0xffd24a});
  const tooth = new THREE.MeshStandardMaterial({color:0xfff4dc,flatShading:true});
  let body, head, tail, legs=[];
  if(type==='raptor' || type==='rex'){
    const bs = type==='rex' ? [1.6,1.2,2.4] : [0.9,0.7,1.4];
    body = new THREE.Mesh(new THREE.BoxGeometry(...bs), skin);
    body.position.y = type==='rex'? 1.6 : 1.0; body.castShadow=true; g.add(body);
    const hs = type==='rex' ? [1.0,1.0,1.4] : [0.55,0.5,0.7];
    head = new THREE.Mesh(new THREE.BoxGeometry(...hs), skin);
    head.position.set(0, body.position.y + (type==='rex'?0.5:0.4), -bs[2]/2 - hs[2]/2 + 0.1);
    head.castShadow=true; g.add(head);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(hs[0]*0.85,hs[1]*0.4,hs[2]*0.9), dark);
    jaw.position.set(0, head.position.y - hs[1]*0.35, head.position.z+0.05);
    g.add(jaw);
    for(let i=0;i<4;i++){
      const t = new THREE.Mesh(new THREE.ConeGeometry(0.05*(type==='rex'?2:1),0.12*(type==='rex'?2:1),4), tooth);
      t.rotation.x=Math.PI;
      t.position.set(-hs[0]*0.3+i*hs[0]*0.2, head.position.y-hs[1]*0.15, head.position.z-hs[2]*0.3);
      g.add(t);
    }
    [-1,1].forEach(s=>{
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.08*(type==='rex'?1.6:1),6,6), eyeMat);
      e.position.set(s*hs[0]*0.35, head.position.y+hs[1]*0.15, head.position.z-hs[2]*0.2);
      g.add(e);
    });
    tail = new THREE.Mesh(new THREE.ConeGeometry(bs[0]*0.45, bs[2]*1.2, 5), skin);
    tail.rotation.x = Math.PI/2;
    tail.position.set(0, body.position.y, bs[2]*0.7);
    g.add(tail);
    const legGeo = new THREE.BoxGeometry(bs[0]*0.3, body.position.y, bs[0]*0.3);
    [-1,1].forEach(s=>{
      const l = new THREE.Mesh(legGeo, dark);
      l.position.set(s*bs[0]*0.3, body.position.y/2, 0);
      l.castShadow=true; g.add(l); legs.push(l);
    });
    if(type==='rex'){
      [-1,1].forEach(s=>{
        const a = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.5,0.18), skin);
        a.position.set(s*bs[0]*0.55, body.position.y+0.1, -bs[2]*0.25);
        g.add(a);
      });
    }
  } else if(type==='ptero'){
    body = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.5,0.9), skin);
    body.position.y=1.4; body.castShadow=true; g.add(body);
    head = new THREE.Mesh(new THREE.ConeGeometry(0.25,0.8,5), skin);
    head.rotation.x=-Math.PI/2; head.position.set(0,1.55,-0.85); g.add(head);
    const wingGeo = new THREE.BoxGeometry(1.6,0.06,0.7);
    [-1,1].forEach(s=>{
      const w = new THREE.Mesh(wingGeo, dark);
      w.position.set(s*0.9,1.4,0); w.rotation.z = s*0.2;
      g.add(w); legs.push(w);
    });
    tail = new THREE.Mesh(new THREE.ConeGeometry(0.1,0.6,4), skin);
    tail.rotation.x=Math.PI/2; tail.position.set(0,1.4,0.7); g.add(tail);
    [-1,1].forEach(s=>{
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.06,6,6), eyeMat);
      e.position.set(s*0.1,1.6,-0.6); g.add(e);
    });
  } else if(type==='tricer'){
    body = new THREE.Mesh(new THREE.BoxGeometry(1.4,1.0,2.0), skin);
    body.position.y=1.0; body.castShadow=true; g.add(body);
    head = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.8,0.9), skin);
    head.position.set(0,1.0,-1.4); g.add(head);
    const frill = new THREE.Mesh(new THREE.BoxGeometry(1.6,1.2,0.15), dark);
    frill.position.set(0,1.2,-1.05); g.add(frill);
    [[0,1.1,-1.85,0.18,0.5],[ -0.3,1.4,-1.65,0.12,0.4],[ 0.3,1.4,-1.65,0.12,0.4]].forEach(h=>{
      const c = new THREE.Mesh(new THREE.ConeGeometry(h[3],h[4],5), tooth);
      c.position.set(h[0],h[1],h[2]); c.rotation.x=-Math.PI/2; g.add(c);
    });
    const legGeo = new THREE.BoxGeometry(0.3,1.0,0.3);
    [[-0.5,0,-0.6],[0.5,0,-0.6],[-0.5,0,0.6],[0.5,0,0.6]].forEach(p=>{
      const l = new THREE.Mesh(legGeo,dark); l.position.set(p[0],0.5,p[2]); l.castShadow=true; g.add(l); legs.push(l);
    });
    tail = new THREE.Mesh(new THREE.ConeGeometry(0.3,1.2,5), skin);
    tail.rotation.x=Math.PI/2; tail.position.set(0,1.0,1.4); g.add(tail);
  }
  g.userData = { body, head, tail, legs };
  return g;
}

// ---------- 场景 / 区域控制 ----------
function initThree(){
  G.renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  G.renderer.shadowMap.enabled = true;
  G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  G.scene = new THREE.Scene();
  G.scene.fog = new THREE.Fog(0x1a2028, 28, 80);
  G.scene.background = new THREE.Color(0x16222e);
  G.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  resize();
  window.addEventListener('resize', resize);
}
function resize(){
  const w = stage.clientWidth, h = stage.clientHeight;
  G.renderer.setSize(w,h,false);
  G.camera.aspect = w/h; G.camera.updateProjectionMatrix();
}
function clearScene(){
  for(let i=G.scene.children.length-1;i>=0;i--){
    const o = G.scene.children[i];
    G.scene.remove(o);
    o.traverse?.(c=>{
      if(c.geometry) c.geometry.dispose?.();
      if(c.material){
        const mats = Array.isArray(c.material)?c.material:[c.material];
        mats.forEach(m=>m.dispose?.());
      }
    });
  }
  G.enemies = []; G.bullets = []; G._fires = [];
  G.doors = []; G.walls = []; G._lights = [];
}
function addBaseLights(){
  // v2.1: 大幅提亮，避免一片漆黑
  // 顶部白光做主光（不投影，避免天花板挡住）
  const dir = new THREE.DirectionalLight(0xeaf0f8, 1.1);
  dir.position.set(-2, 14, 4);
  G.scene.add(dir);
  // 第二盏补光（暖色，从对侧打来）
  const dir2 = new THREE.DirectionalLight(0xffd9a8, 0.5);
  dir2.position.set(4, 10, -3);
  G.scene.add(dir2);
  // 半球光（让上下都有色彩）
  G.scene.add(new THREE.HemisphereLight(0xa8c0d8, 0x5a4838, 1.1));
  // 全局环境光保底
  G.scene.add(new THREE.AmbientLight(0x99a4b3, 0.85));
}

function loadArea(idx){
  G.areaIdx = idx;
  const area = Areas[idx];
  G.curArea = area; G.curCamIdx = 0;
  clearScene(); addBaseLights(); area.build();
  const m = makeHuman();
  m.position.copy(area.spawn); m.rotation.y = 0; // 脸朝 -Z（出口方向）
  G.scene.add(m);
  // v2.2: 给玩家挂一盏跟随聚光灯，避免他在暗处看不见
  const playerLight = new THREE.PointLight(0xfff5e6, 0.8, 6, 1.0);
  playerLight.position.set(0, 2.0, 0);
  m.add(playerLight);
  G.player = { mesh:m, anim:0, atkTime:0, hurtTime:0, walkPhase:0, light: playerLight };
  applyCamera(area.cams[0]);
  areaBadge.textContent = area.name;
  if(area.battle) area.battle.triggered = false;
  setMode('explore');
  showBigTitle(area.name);
  G.state = 'explore';
}
function applyCamera(cam, smooth=false){
  if(!smooth){
    G.camera.position.copy(cam.pos);
    G.camera.lookAt(cam.look);
  } else {
    const startPos = G.camera.position.clone();
    const startQuat = G.camera.quaternion.clone();
    G.camera.position.copy(cam.pos); G.camera.lookAt(cam.look);
    const endQuat = G.camera.quaternion.clone();
    G.camera.position.copy(startPos); G.camera.quaternion.copy(startQuat);
    const t0 = performance.now(); const dur=500;
    const tween = ()=>{
      const k = Math.min(1,(performance.now()-t0)/dur);
      G.camera.position.lerpVectors(startPos, cam.pos, k);
      G.camera.quaternion.slerpQuaternions(startQuat, endQuat, k);
      if(k<1) requestAnimationFrame(tween);
    };
    tween();
  }
  if(cam.fov && cam.fov!==G.camera.fov){
    G.camera.fov = cam.fov; G.camera.updateProjectionMatrix();
  }
}
function updateCameraByZone(){
  const cams = G.curArea.cams;
  if(cams.length<=1) return;
  const z = G.player.mesh.position.z;
  for(let i=0;i<cams.length;i++){
    const r = cams[i].range;
    if(!r) continue;
    if(z >= r[0] && z <= r[1]){
      if(G.curCamIdx !== i){
        G.curCamIdx = i;
        applyCamera(cams[i], true);
      }
      return;
    }
  }
}
function setMode(m){
  if(m==='explore'){
    modeBadge.textContent = '探索中';
    modeBadge.classList.remove('danger','foresee');
    cmdMenu.classList.remove('show');
    atbHint.classList.add('hide');
  } else if(m==='battle'){
    modeBadge.textContent = '⚔ 战斗';
    modeBadge.classList.remove('foresee');
    modeBadge.classList.add('danger');
    atbHint.classList.remove('hide');
  } else if(m==='cinema'){
    modeBadge.textContent = '过场';
    modeBadge.classList.remove('danger','foresee');
    actBtnEl.classList.remove('show');
  }
}

// 暂停/恢复
function pauseGame(reason){
  G.paused = true;
  G.joy.active = false; G.joy.x = 0; G.joy.y = 0;
  hideJoystick();
  if(reason) modeBadge.textContent = reason;
}
function resumeGame(){
  G.paused = false;
  if(G.state==='battle'){
    if(Player.buffs.foresee>0){
      modeBadge.textContent = '👁 伺机中';
      modeBadge.classList.remove('danger');
      modeBadge.classList.add('foresee');
    } else {
      modeBadge.textContent = '⚔ 战斗';
      modeBadge.classList.remove('foresee');
      modeBadge.classList.add('danger');
    }
  } else if(G.state==='explore'){
    modeBadge.textContent = '探索中';
    modeBadge.classList.remove('danger','foresee');
  }
}
function updateExploreHints(){
  if(G.state!=='explore') return;
  const p = G.player.mesh.position;
  const area = G.curArea;
  // v2: 检查门
  let nearDoor = null;
  for(const d of G.doors){
    if(p.distanceTo(d.pos) < 1.6){ nearDoor = d; break; }
  }
  if(nearDoor){
    actBtnEl.textContent = nearDoor.label;
    actBtnEl.classList.add('show');
    G.actCallback = ()=>{
      if(nearDoor.locked){ toast('门被锁住了'); return; }
      goToArea(nearDoor.target);
    };
  } else {
    actBtnEl.classList.remove('show');
    G.actCallback = null;
  }
  if(area.battle && !area.battle.triggered){
    if(p.distanceTo(area.battle.trigger.pos) < area.battle.trigger.radius){
      area.battle.triggered = true;
      enterBattle();
    }
  }
}
function goToArea(idx){
  if(idx >= Areas.length) return;
  setMode('cinema');
  fadeEl.classList.add('show');
  setTimeout(()=>{ loadArea(idx); fadeEl.classList.remove('show'); }, 500);
}
function goNextArea(){ goToArea(G.areaIdx+1); }

// ---------- 战斗 ----------
function enterBattle(){
  const cfg = G.curArea.battle;
  G.state = 'battle';
  setMode('battle');
  G.battleArena = { center: cfg.arena.center.clone(), radius: cfg.arena.radius };
  const ringGeo = new THREE.RingGeometry(cfg.arena.radius-0.05, cfg.arena.radius, 64);
  ringGeo.rotateX(-Math.PI/2);
  const ring = new THREE.Mesh(ringGeo,
    new THREE.MeshBasicMaterial({color:0xff5566, transparent:true, opacity:0.5, side:THREE.DoubleSide}));
  ring.position.copy(cfg.arena.center); ring.position.y = 0.03;
  G.scene.add(ring); G.arenaRing = ring;
  cfg.enemies.forEach((type,i)=>{
    const tpl = EnemyTpl[type];
    const m = makeDino(tpl.type, tpl.color);
    m.scale.setScalar(tpl.scale);
    const a = (i / cfg.enemies.length) * Math.PI*2 - Math.PI/2;
    const r = cfg.arena.radius * 0.7;
    const pos = cfg.arena.center.clone().add(new THREE.Vector3(Math.cos(a)*r, 0, Math.sin(a)*r));
    m.position.copy(pos);
    // 初始朝向玩家（恐龙头在-Z）
    const tp = new THREE.Vector3().subVectors(G.player.mesh.position, pos);
    m.rotation.y = Math.atan2(tp.x, tp.z) + Math.PI;
    G.scene.add(m);
    G.enemies.push({
      tpl, mesh:m,
      hp: tpl.hp, hpMax: tpl.hp,
      atk: tpl.atk, def: tpl.def,
      // v2: 初始 ATB 减少，加上 pauseTime 字段
      atb: 5 + Math.random()*15, atbMax:100, atbSpeed: tpl.atbSpeed,
      alive:true, anim:Math.random()*Math.PI*2,
      atkTime:0, hurtTime:0,
      aiState:'chase', stateTime:0, atkTarget:null,
      pauseTime: 0.5 + Math.random()*1.0, // 进战斗后先观察一下
      _distAcc: 0,
    });
  });
  showBigTitle('遭遇！', true);
  log('恐龙出现！保持距离寻找射击机会');
  Player.atb = 0;
  Player.buffs.foresee = 0;
  updateHUD();
}
function leaveBattle(victory){
  if(G.arenaRing){ G.scene.remove(G.arenaRing); G.arenaRing=null; }
  G.battleArena = null;
  Player.buffs.foresee = 0;
  if(victory){
    if(G.curArea.battle.isFinal){ endGame(true); return; }
    log('威胁解除');
    G.state = 'explore'; setMode('explore');
    showBigTitle('威胁解除');
    Player.hp = Math.min(Player.hpMax, Player.hp + 20);
    Player.mp = Math.min(Player.mpMax, Player.mp + 8);
    updateHUD();
  }
}
function tryPlayerAction(kind){
  if(G.state!=='battle') return;
  if(Player.atb < Player.atbMax){ toast('ATB 未充满'); return; }
  if(kind==='attack'){ requestTarget('attack'); }
  else if(kind==='foresee'){
    // 伺机：清空 ATB，提高暴击率，下次暴击命中后清除
    Player.atb = 0;
    Player.buffs.foresee = 1;
    cmdMenu.classList.remove('show');
    hideSubMenu();
    G.pendingAction = null;
    atbHint.classList.remove('hide');
    showDmg(G.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)),'伺机','heal');
    log(`进入伺机状态：暴击率 +${Math.round(Player.foreseeCritBonus*100)}%`);
    updateHUD();
    resumeGame();
  }
  else if(kind==='skill'){ showSubMenu('skill'); }
  else if(kind==='item'){ showSubMenu('item'); }
}
function requestTarget(action, data){
  const alives = G.enemies.filter(e=>e.alive);
  if(alives.length===0) return;
  // 进入待选目标状态：关菜单、保持暂停，玩家可以看清屏幕点目标
  cmdMenu.classList.remove('show');
  hideSubMenu();
  if(alives.length===1){
    const idx = G.enemies.indexOf(alives[0]);
    runAction(action, idx, data); return;
  }
  G.pendingAction = { action, data };
  G.selectedEnemy = G.enemies.indexOf(alives[0]);
  modeBadge.textContent = '🎯 选择目标';
  toast('点击目标恐龙');
}
function runAction(action, idx, data){
  const t = G.enemies[idx];
  if(!t || !t.alive) return;
  const dist = G.player.mesh.position.distanceTo(t.mesh.position);
  const range = action==='skill' ? (data.range||10) : 12;
  if(dist > range){
    toast('距离太远 ('+dist.toFixed(1)+'m)，请靠近');
    return; // 保留 pendingAction，让玩家可以再点（但需先恢复跑动）
  }
  G.pendingAction = null;
  if(action==='attack') executeAttack(idx);
  else if(action==='skill') executeSkill(data, idx);
}
// v2: 伺机相关
function getCritRate(){
  return Player.baseCrit + (Player.buffs.foresee>0 ? Player.foreseeCritBonus : 0);
}
function consumeForeseeIfCrit(crit){
  if(crit && Player.buffs.foresee>0){
    Player.buffs.foresee = 0;
    log('伺机命中要害！状态解除');
    showDmg(G.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)), '伺机·命中', 'crit');
    if(G.state==='battle' && !G.paused){
      modeBadge.textContent = '⚔ 战斗';
      modeBadge.classList.remove('foresee');
      modeBadge.classList.add('danger');
    }
  }
}

function executeAttack(targetIdx){
  const t = G.enemies[targetIdx];
  if(!t || !t.alive) return;
  Player.atb = 0; G.player.atkTime = 0.001;
  cmdMenu.classList.remove('show'); atbHint.classList.remove('hide');
  resumeGame(); // 行动开始执行 → 恢复游戏
  faceTarget(t.mesh.position);
  fireBullet(
    G.player.mesh.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
    t.mesh.position.clone().add(new THREE.Vector3(0, 1.0*t.tpl.scale, 0)),
    ()=>{
      const crit = Math.random() < getCritRate();
      let dmg = Math.max(1, Player.atk - t.def + Math.floor(Math.random()*4));
      if(crit) dmg = Math.floor(dmg*1.8);
      t.hp -= dmg; t.hurtTime = 0.001;
      showDmg(t.mesh.position, dmg, crit?'crit enemy':'enemy');
      consumeForeseeIfCrit(crit);
      if(t.hp<=0) killEnemy(t);
      checkBattleEnd(); updateHUD();
    }
  );
  log('射击！');
}
function executeSkill(skill, targetIdx){
  if(Player.mp < skill.cost){ toast('MP 不足'); return; }
  Player.mp -= skill.cost;
  Player.atb = 0; G.player.atkTime = 0.001;
  cmdMenu.classList.remove('show'); atbHint.classList.remove('hide');
  resumeGame();
  if(skill.aoe){
    const t = G.enemies[targetIdx];
    if(!t) return;
    const center = t.mesh.position.clone();
    faceTarget(center);
    fireBullet(
      G.player.mesh.position.clone().add(new THREE.Vector3(0,1.5,0)),
      center.clone().add(new THREE.Vector3(0,0.3,0)),
      ()=>{
        spawnExplosion(center, skill.aoe);
        let anyCrit = false;
        G.enemies.filter(e=>e.alive).forEach(e=>{
          if(e.mesh.position.distanceTo(center) <= skill.aoe){
            const crit = Math.random() < getCritRate();
            if(crit) anyCrit = true;
            let dmg = Math.floor((Player.atk - e.def + 4) * skill.dmg + Math.random()*5);
            if(crit) dmg = Math.floor(dmg*1.5);
            e.hp -= dmg; e.hurtTime=0.001;
            showDmg(e.mesh.position, dmg, crit?'crit enemy':'enemy');
            if(e.hp<=0) killEnemy(e);
          }
        });
        consumeForeseeIfCrit(anyCrit);
        checkBattleEnd(); updateHUD();
      }, 0xffaa44
    );
    log(`投掷 ${skill.name}！`); return;
  }
  const t = G.enemies[targetIdx];
  if(!t || !t.alive) return;
  faceTarget(t.mesh.position);
  const hits = skill.hits || 1;
  for(let i=0;i<hits;i++){
    setTimeout(()=>{
      if(!t.alive){ checkBattleEnd(); return; }
      fireBullet(
        G.player.mesh.position.clone().add(new THREE.Vector3(0,1.1,0)),
        t.mesh.position.clone().add(new THREE.Vector3(0,1.0*t.tpl.scale,0)),
        ()=>{
          // skill.crit=1 表示必暴击；否则按当前暴击率
          const crit = skill.crit ? true : (Math.random() < getCritRate());
          let dmg = Math.floor(Math.max(1, Player.atk - t.def) * skill.dmg + Math.random()*4);
          if(crit) dmg = Math.floor(dmg*1.6);
          t.hp -= dmg; t.hurtTime=0.001;
          showDmg(t.mesh.position, dmg, crit?'crit enemy':'enemy');
          consumeForeseeIfCrit(crit);
          if(t.hp<=0) killEnemy(t);
          checkBattleEnd(); updateHUD();
        }
      );
    }, i*180);
  }
  log(`使用 ${skill.name}！`);
}
function executeItem(item){
  if(item.count<=0){ toast('道具用完了'); return; }
  item.count--;
  Player.atb = 0;
  cmdMenu.classList.remove('show'); atbHint.classList.remove('hide');
  resumeGame();
  if(item.heal){
    Player.hp = Math.min(Player.hpMax, Player.hp+item.heal);
    showDmg(G.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)),'+'+item.heal,'heal');
  }
  if(item.mp){ Player.mp = Math.min(Player.mpMax, Player.mp+item.mp); }
  if(item.buff==='haste'){ Player.buffs.haste = 8; }
  log(`使用 ${item.name}`); updateHUD();
}
function killEnemy(t){
  t.alive = false;
  const start = performance.now();
  const initRot = t.mesh.rotation.x;
  const initY = t.mesh.position.y;
  const fall = ()=>{
    const k = Math.min(1,(performance.now()-start)/600);
    t.mesh.rotation.x = initRot + k*Math.PI/2*0.7;
    t.mesh.position.y = initY - k*0.2;
    t.mesh.traverse(o=>{ if(o.material&&o.material.transparent!==undefined){
      o.material.transparent=true; o.material.opacity = 1-k*0.4;
    }});
    if(k<1) requestAnimationFrame(fall);
    else { setTimeout(()=>G.scene.remove(t.mesh), 800); }
  };
  fall();
  hideAttackWarning(t);
  log(`${t.tpl.name} 倒下了`);
}
function checkBattleEnd(){
  if(G.enemies.every(e=>!e.alive)){
    setTimeout(()=>leaveBattle(true), 700);
  }
}
function updateEnemyAI(e, dt){
  if(!e.alive) return;
  const playerPos = G.player.mesh.position;
  const toPlayer = new THREE.Vector3().subVectors(playerPos, e.mesh.position);
  toPlayer.y = 0;
  const dist = toPlayer.length();
  // v2: 停顿期间不积攒 ATB，也不移动
  if(e.pauseTime > 0){
    e.pauseTime -= dt;
  } else {
    e.atb = Math.min(e.atbMax, e.atb + e.atbSpeed*dt);
  }
  // 恐龙的"头"朝 -Z 方向，让 -Z 指向玩家
  const targetYaw = Math.atan2(toPlayer.x, toPlayer.z) + Math.PI;
  let dy = targetYaw - e.mesh.rotation.y;
  while(dy > Math.PI) dy -= Math.PI*2;
  while(dy < -Math.PI) dy += Math.PI*2;
  e.mesh.rotation.y += dy * Math.min(1, dt*5);
  if(e.aiState === 'chase'){
    if(e.pauseTime <= 0 && dist > e.tpl.atkRange*0.9){
      const v = toPlayer.clone().normalize();
      const step = e.tpl.speed * dt;
      e.mesh.position.x += v.x * step;
      e.mesh.position.z += v.z * step;
      clampToArena(e.mesh.position);
      // 累计移动距离，达到一定值后按概率进入停顿"观察"
      e._distAcc = (e._distAcc||0) + step;
      if(e._distAcc > 1.6){
        e._distAcc = 0;
        if(Math.random() < e.tpl.pauseChance){
          const [a,b] = e.tpl.pauseDur;
          e.pauseTime = a + Math.random()*(b-a);
        }
      }
    }
    if(e.pauseTime <= 0 && e.atb >= e.atbMax && dist <= e.tpl.atkRange*1.2){
      e.aiState = 'prepare';
      e.stateTime = e.tpl.atkPrep;
      e.atkTarget = playerPos.clone();
      showAttackWarning(e);
    }
  } else if(e.aiState === 'prepare'){
    e.stateTime -= dt;
    if(e.tpl.atkAoe>0){
      e.atkTarget.lerp(playerPos, dt*0.6);
      if(e._warning){
        e._warning.mesh.position.set(e.atkTarget.x, 0.04, e.atkTarget.z);
        e._warning.fill.position.set(e.atkTarget.x, 0.035, e.atkTarget.z);
      }
    }
    if(e.stateTime <= 0){
      e.aiState = 'attack'; e.stateTime = 0.35; e.atkTime = 0.001;
      const hit = e.tpl.atkAoe>0
        ? playerPos.distanceTo(e.atkTarget) <= e.tpl.atkAoe
        : playerPos.distanceTo(e.mesh.position) <= e.tpl.atkRange*1.1;
      if(hit){
        const dmg = Math.max(1, e.atk - Player.def + Math.floor(Math.random()*5));
        Player.hp -= dmg; G.player.hurtTime = 0.001;
        showDmg(G.player.mesh.position.clone().add(new THREE.Vector3(0,1.6,0)), dmg, 'player');
        log(`${e.tpl.name} 命中！-${dmg}`);
        if(Player.hp<=0){ Player.hp=0; Player.alive=false; updateHUD(); endGame(false); return; }
        updateHUD();
      } else {
        showDmg(G.player.mesh.position.clone().add(new THREE.Vector3(0,2,0)), 'MISS', 'heal');
        log(`${e.tpl.name} 攻击落空！`);
      }
      if(e.tpl.atkAoe>0) spawnExplosion(e.atkTarget.clone(), e.tpl.atkAoe);
      hideAttackWarning(e);
      e.atb = 0;
      // 攻击后强制小休息
      e.pauseTime = 0.8 + Math.random()*0.6;
    }
  } else if(e.aiState === 'attack'){
    e.stateTime -= dt;
    if(e.stateTime <= 0) e.aiState = 'chase';
  }
}
function showAttackWarning(e){
  const r = e.tpl.atkAoe>0 ? e.tpl.atkAoe : e.tpl.atkRange;
  const center = e.tpl.atkAoe>0 ? e.atkTarget : e.mesh.position;
  const ringGeo = new THREE.RingGeometry(r*0.92, r, 36);
  ringGeo.rotateX(-Math.PI/2);
  const ring = new THREE.Mesh(ringGeo,
    new THREE.MeshBasicMaterial({color:0xff3344, transparent:true, opacity:0.7, side:THREE.DoubleSide}));
  ring.position.set(center.x, 0.04, center.z);
  G.scene.add(ring);
  const fillGeo = new THREE.CircleGeometry(r, 36);
  fillGeo.rotateX(-Math.PI/2);
  const fill = new THREE.Mesh(fillGeo,
    new THREE.MeshBasicMaterial({color:0xff3344, transparent:true, opacity:0.18, side:THREE.DoubleSide}));
  fill.position.set(center.x, 0.035, center.z);
  G.scene.add(fill);
  e._warning = { mesh: ring, fill };
}
function hideAttackWarning(e){
  if(e._warning){
    G.scene.remove(e._warning.mesh); G.scene.remove(e._warning.fill);
    e._warning = null;
  }
}
function clampToArena(p){
  if(!G.battleArena) return;
  const c = G.battleArena.center;
  const dx = p.x - c.x, dz = p.z - c.z;
  const r = G.battleArena.radius - 0.4;
  const d2 = dx*dx + dz*dz;
  if(d2 > r*r){
    const d = Math.sqrt(d2);
    p.x = c.x + dx/d*r;
    p.z = c.z + dz/d*r;
  }
}
function clampToBounds(p){
  const b = G.curArea.bounds;
  if(p.x < b.minX) p.x = b.minX;
  if(p.x > b.maxX) p.x = b.maxX;
  if(p.z < b.minZ) p.z = b.minZ;
  if(p.z > b.maxZ) p.z = b.maxZ;
}
function faceTarget(target){
  const dx = target.x - G.player.mesh.position.x;
  const dz = target.z - G.player.mesh.position.z;
  // 玩家脸朝 -Z，转向目标
  G.player.mesh.rotation.y = Math.atan2(dx, dz) + Math.PI;
}
function updateHUD(){
  $('#hpBar').style.width = (Player.hp/Player.hpMax*100)+'%';
  $('#mpBar').style.width = (Player.mp/Player.mpMax*100)+'%';
  const atbPct = Player.atb/Player.atbMax*100;
  $('#atbBar').style.width = atbPct+'%';
  $('#atbWrap').classList.toggle('full', atbPct>=100);
  $('#hpTxt').textContent = `${Math.ceil(Player.hp)}/${Player.hpMax}`;
  $('#mpTxt').textContent = `${Math.ceil(Player.mp)}/${Player.mpMax}`;
  $('#atbTxt').textContent = Math.floor(atbPct)+'%';
  if(G.state==='battle'){
    if(atbPct >= 100){ cmdMenu.classList.add('show'); atbHint.classList.add('hide'); }
    else { cmdMenu.classList.remove('show'); atbHint.classList.remove('hide'); }
  }
}
function showDmg(worldPos, val, cls=''){
  const v = worldPos.clone().project(G.camera);
  const x = (v.x*0.5+0.5)*stage.clientWidth;
  const y = (-v.y*0.5+0.5)*stage.clientHeight;
  const d = document.createElement('div');
  d.className='dmg '+cls;
  d.textContent = val;
  d.style.left = x+'px'; d.style.top = y+'px';
  fxLayer.appendChild(d);
  setTimeout(()=>d.remove(), 1100);
}
function log(text){
  logEl.textContent = text;
  clearTimeout(log._t);
  log._t = setTimeout(()=>logEl.textContent='', 1800);
}
function toast(text){
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>toastEl.classList.remove('show'), 1200);
}
function showBigTitle(text, danger=false){
  bigTitleEl.textContent = text;
  bigTitleEl.classList.toggle('danger', danger);
  bigTitleEl.classList.remove('show'); void bigTitleEl.offsetWidth;
  bigTitleEl.classList.add('show');
}
function fireBullet(from, to, onHit, color=0xffe07a){
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshBasicMaterial({color}));
  b.position.copy(from); G.scene.add(b);
  const dir = to.clone().sub(from);
  const dist = dir.length(); dir.normalize();
  G.bullets.push({mesh:b, dir, remain:dist, speed:48, onHit});
  const flash = new THREE.PointLight(color, 3, 4);
  flash.position.copy(from); G.scene.add(flash);
  setTimeout(()=>G.scene.remove(flash), 60);
}
function updateBullets(dt){
  for(let i=G.bullets.length-1;i>=0;i--){
    const b = G.bullets[i];
    const step = b.speed*dt;
    if(step >= b.remain){
      G.scene.remove(b.mesh); G.bullets.splice(i,1);
      try{ b.onHit?.(); }catch(e){console.error(e);}
    } else {
      b.mesh.position.addScaledVector(b.dir, step);
      b.remain -= step;
    }
  }
}
function spawnExplosion(pos, radius){
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8),
    new THREE.MeshBasicMaterial({color:0xffaa44, transparent:true, opacity:0.8}));
  m.position.copy(pos); m.position.y = 0.5;
  G.scene.add(m);
  const light = new THREE.PointLight(0xffaa44, 6, radius*4);
  light.position.copy(m.position); G.scene.add(light);
  const t0 = performance.now();
  const tick = ()=>{
    const k = (performance.now()-t0)/350;
    if(k>=1){ G.scene.remove(m); G.scene.remove(light); return; }
    m.scale.setScalar(0.4 + k*1.4);
    m.material.opacity = 0.8*(1-k);
    light.intensity = 6*(1-k);
    requestAnimationFrame(tick);
  };
  tick();
}
function refreshEnemyTags(){
  if(G.state!=='battle'){
    fxLayer.querySelectorAll('.enemyTag').forEach(n=>n.remove());
    return;
  }
  G.enemies.forEach((e,idx)=>{
    // 复用：每个敌人的 DOM 节点只创建一次，更新位置/血量/选中态
    if(!e.alive){
      if(e._tagEl){ e._tagEl.remove(); e._tagEl = null; }
      return;
    }
    const head = e.mesh.position.clone(); head.y += 2.4*e.tpl.scale;
    const v = head.clone().project(G.camera);
    if(v.z>1){
      if(e._tagEl) e._tagEl.style.display='none';
      return;
    }
    const x = (v.x*0.5+0.5)*stage.clientWidth;
    const y = (-v.y*0.5+0.5)*stage.clientHeight;
    let div = e._tagEl;
    if(!div){
      div = document.createElement('div');
      div.className = 'enemyTag';
      div.innerHTML = `<div class="nm"></div><div class="hp"><i></i></div>`;
      // 用 pointerdown 单一事件响应；手机/鼠标都支持
      const onTap = (ev)=>{
        ev.stopPropagation();
        ev.preventDefault();
        const i = G.enemies.indexOf(e);
        if(G.pendingAction){
          const { action, data } = G.pendingAction;
          runAction(action, i, data);
        } else {
          G.selectedEnemy = i;
          toast('已选中: '+e.tpl.name);
        }
      };
      // pointerdown 在桌面/移动都触发；不再叠加 click 防重复
      if('PointerEvent' in window){
        div.addEventListener('pointerdown', onTap);
      } else {
        div.addEventListener('touchstart', onTap, {passive:false});
        div.addEventListener('mousedown', onTap);
      }
      e._tagEl = div;
      fxLayer.appendChild(div);
    }
    div.style.display = '';
    div.style.left = x+'px';
    div.style.top  = y+'px';
    div.classList.toggle('targeting', !!G.pendingAction);
    div.querySelector('.nm').textContent = e.tpl.name + (e.pauseTime>0 ? ' · 警戒' : '');
    div.querySelector('.hp i').style.width = Math.max(0, e.hp/e.hpMax*100) + '%';
  });
}
function showSubMenu(kind){
  subMenu.innerHTML='';
  if(kind==='skill'){
    Player.skills.forEach(s=>{
      const div = document.createElement('div');
      div.className = 'subItem' + (Player.mp<s.cost?' dis':'');
      const rangeTxt = s.range ? `<span style="color:#7ff0c4">射程${s.range}m</span> · ` : '';
      div.innerHTML = `<div><div>${s.name}</div><span class="desc">${rangeTxt}${s.desc}</span></div><span class="cost">${s.cost} MP</span>`;
      div.onclick = ()=>{
        hideSubMenu();
        requestTarget('skill', s);
      };
      subMenu.appendChild(div);
    });
  } else {
    Player.items.forEach(it=>{
      const div = document.createElement('div');
      div.className = 'subItem' + (it.count<=0?' dis':'');
      div.innerHTML = `<div><div>${it.name} ×${it.count}</div><span class="desc">${it.desc}</span></div>`;
      div.onclick = ()=>{ hideSubMenu(); executeItem(it); };
      subMenu.appendChild(div);
    });
  }
  subMenu.classList.add('show');
}
function hideSubMenu(){ subMenu.classList.remove('show'); }

// ---------- 虚拟摇杆（按下空白处生成） ----------
function bindJoystick(){
  // 监听 stage（3D 区域）上任意按下；但要排除 UI 元素
  stage.addEventListener('touchstart', onStart, {passive:false});
  stage.addEventListener('mousedown', onStart);

  function onStart(e){
    // 不在探索/战斗中不响应
    if(G.state!=='explore' && G.state!=='battle') return;
    // 已暂停（含等待选目标）时不响应
    if(G.paused || G.pendingAction) return;
    // 排除点到 UI（敌人血条、互动按钮、子菜单等）
    const tgt = e.target;
    if(tgt.closest && (tgt.closest('.enemyTag') || tgt.closest('#actBtn') || tgt.closest('#cmdMenu') || tgt.closest('#subMenu') || tgt.closest('#hud') || tgt.closest('#topBar'))) return;

    e.preventDefault();
    const t = e.touches?.[0] || e;
    G.joy.id = e.touches ? t.identifier : 'mouse';
    G.joy.active = true;
    G.joy.baseX = t.clientX;
    G.joy.baseY = t.clientY;
    G.joy.x = 0; G.joy.y = 0;
    // 摇杆出现在按下位置
    showJoystick(t.clientX, t.clientY);

    document.addEventListener('touchmove', onMove, {passive:false});
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
  }
  function onMove(e){
    if(!G.joy.active) return;
    e.preventDefault?.();
    const t = e.touches ? Array.from(e.touches).find(x=>x.identifier===G.joy.id) : e;
    if(!t) return;
    move(t.clientX, t.clientY);
  }
  function onEnd(){
    G.joy.active = false;
    G.joy.x = 0; G.joy.y = 0;
    hideJoystick();
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onEnd);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onEnd);
  }
  function move(cx, cy){
    const R = 60; // 摇杆有效半径(px)
    let dx = cx - G.joy.baseX, dy = cy - G.joy.baseY;
    const d = Math.sqrt(dx*dx+dy*dy);
    if(d > R){ dx = dx/d*R; dy = dy/d*R; }
    nubEl.style.left = (50 + dx/R*40) + '%';
    nubEl.style.top  = (50 + dy/R*40) + '%';
    G.joy.x = dx/R; G.joy.y = dy/R;
  }
}
function showJoystick(x, y){
  joystickEl.style.left = (x-60)+'px';
  joystickEl.style.top  = (y-60)+'px';
  joystickEl.style.bottom = 'auto';
  joystickEl.classList.add('show');
  nubEl.style.left='50%'; nubEl.style.top='50%';
}
function hideJoystick(){
  joystickEl.classList.remove('show');
}

// ---------- 动画 / 主循环 ----------
function updatePlayerMovement(dt){
  if(!G.player) return;
  if(G.state!=='explore' && G.state!=='battle') return;
  const speed = G.state==='battle' ? Player.battleSpeed : Player.speed;
  let mx = G.joy.x, mz = G.joy.y;
  const mag = Math.sqrt(mx*mx + mz*mz);
  const moving = mag > 0.18;
  if(moving){
    if(mag > 1){ mx/=mag; mz/=mag; }
    const p = G.player.mesh.position;
    p.x += mx * speed * dt;
    p.z += mz * speed * dt;
    if(G.state==='battle') clampToArena(p);
    else clampToBounds(p);
    // 玩家模型脸/枪朝 -Z 方向，所以让 -Z 指向运动方向 → yaw = atan2(mx,mz) + π
    G.player.mesh.rotation.y = Math.atan2(mx, mz) + Math.PI;
    G.player.walkPhase += dt * 10;
  } else {
    G.player.walkPhase *= Math.exp(-dt*5);
  }
  const ud = G.player.mesh.userData;
  const sw = Math.sin(G.player.walkPhase) * (moving?0.5:0);
  ud.legL.rotation.x = sw;
  ud.legR.rotation.x = -sw;
  ud.armL.rotation.x = -sw*0.5;
  ud.body.position.y = 1.15 + Math.abs(Math.cos(G.player.walkPhase))*(moving?0.04:0.02);
}
function updatePlayerAnims(dt){
  if(!G.player) return;
  const p = G.player.mesh;
  if(G.player.atkTime>0){
    G.player.atkTime += dt;
    const k = Math.min(1, G.player.atkTime/0.3);
    const back = Math.sin(k*Math.PI)*0.15;
    p.userData.gun.position.z = -0.1 + back;
    p.userData.armR.rotation.x = -back*1.2;
    if(k>=1) G.player.atkTime = 0;
  }
  if(G.player.hurtTime>0){
    G.player.hurtTime += dt;
    const k = G.player.hurtTime/0.4;
    if(k>=1) G.player.hurtTime=0;
  }
}
function updateEnemyAnims(dt){
  G.enemies.forEach(e=>{
    if(!e.alive) return;
    e.anim += dt;
    const ud = e.mesh.userData;
    const sway = Math.sin(e.anim*3)*0.05;
    if(ud.tail) ud.tail.rotation.y = sway*2;
    if(e.tpl.type==='ptero' && ud.legs){
      ud.legs.forEach((w,i)=>{ w.rotation.z = (i?1:-1)*(0.2 + Math.sin(e.anim*8)*0.5); });
      e.mesh.position.y = 0.6 + Math.sin(e.anim*4)*0.2;
    }
    if(e.atkTime>0){
      e.atkTime += dt;
      const k = e.atkTime/0.35;
      if(ud.body) ud.body.rotation.x = Math.sin(k*Math.PI)*0.3;
      if(ud.head) ud.head.rotation.x = -Math.sin(k*Math.PI)*0.4;
      if(k>=1){ e.atkTime=0; if(ud.body) ud.body.rotation.x=0; if(ud.head) ud.head.rotation.x=0; }
    }
    if(e.hurtTime>0){
      e.hurtTime += dt;
      const k = e.hurtTime/0.3;
      e.mesh.traverse(o=>{
        if(o.material && o.material.color){
          if(!o.material._oc) o.material._oc = o.material.color.clone();
          o.material.color.lerpColors(new THREE.Color(0xff4444), o.material._oc, k);
        }
      });
      if(k>=1){
        e.hurtTime=0;
        e.mesh.traverse(o=>{ if(o.material && o.material._oc) o.material.color.copy(o.material._oc); });
      }
    }
  });
}
function updateFires(){
  G._fires.forEach(f=>{
    f.flame.scale.y = 1 + Math.sin(performance.now()*0.012)*0.15;
    f.flame.scale.x = 1 + Math.cos(performance.now()*0.018)*0.08;
    f.light.intensity = 1.4 + Math.sin(performance.now()*0.01)*0.4;
  });
}
let lastTime = 0;
function animate(now){
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime)/1000 || 0.016);
  lastTime = now;
  updateFires();
  // 暂停状态下：仍渲染、仍刷新敌人血条标签和HUD，但不推进逻辑
  if(G.paused){
    if(G.state==='battle') refreshEnemyTags();
    G.renderer.render(G.scene, G.camera);
    return;
  }
  if(G.state==='explore' || G.state==='battle'){
    updatePlayerMovement(dt);
    updatePlayerAnims(dt);
  }
  if(G.state==='explore'){
    updateCameraByZone();
    updateExploreHints();
  }
  if(G.state==='battle'){
    if(Player.alive){
      const haste = Player.buffs.haste>0 ? 1.6 : 1;
      Player.atb = Math.min(Player.atbMax, Player.atb + Player.atbSpeed*dt*haste);
      if(Player.buffs.haste>0) Player.buffs.haste -= dt;
    }
    G.enemies.forEach(e=>updateEnemyAI(e, dt));
    updateEnemyAnims(dt);
    updateBullets(dt);
    refreshEnemyTags();
    if((animate._u=(animate._u||0)+dt) > 0.08){ animate._u=0; updateHUD(); }
    // ATB 满时：自动暂停游戏并弹出命令菜单
    if(Player.atb >= Player.atbMax && !cmdMenu.classList.contains('show')){
      cmdMenu.classList.add('show');
      atbHint.classList.add('hide');
      pauseGame('● 暂停 · 选择行动');
    }
  } else {
    updateBullets(dt);
  }
  G.renderer.render(G.scene, G.camera);
}

function endGame(win){
  G.state = win ? 'win' : 'lose';
  setMode('cinema');
  cmdMenu.classList.remove('show');
  const sc = $('#endScreen');
  sc.classList.add('show');
  sc.classList.toggle('win', win);
  sc.classList.toggle('lose', !win);
  $('#endTitle').textContent = win ? '反击成功' : '失去意识...';
  $('#endInfo').innerHTML = win
    ? '你击杀了霸王龙，等待救援的火光在远处亮起。'
    : '你失去了意识，恐龙的吼声渐渐远去...';
}

function startGame(){
  if(!G.renderer) initThree();
  setupAreas();
  // 重置玩家
  Player.hp = Player.hpMax; Player.mp = Player.mpMax;
  Player.atb = 0; Player.alive = true; Player.buffs.haste = 0; Player.buffs.foresee = 0;
  Player.items.forEach(it=>{
    if(it.id==='med') it.count=3;
    if(it.id==='adr') it.count=2;
  });
  $('#titleScreen').style.display='none';
  $('#endScreen').classList.remove('show');
  loadArea(0);
  updateHUD();
  if(!animate._started){ animate._started = true; requestAnimationFrame(animate); }
}

// ---------- 事件绑定 ----------
document.querySelectorAll('#cmdMenu .cmd').forEach(b=>{
  b.addEventListener('click', e=>{
    e.stopPropagation();
    if(b.classList.contains('disabled')){ toast('ATB 未充满'); return; }
    const c = b.dataset.cmd;
    if(subMenu.classList.contains('show')){ hideSubMenu(); return; }
    tryPlayerAction(c);
  });
});
document.addEventListener('click', e=>{
  if(!subMenu.contains(e.target) && !e.target.closest('#cmdMenu')) hideSubMenu();
});
actBtnEl.addEventListener('click', ()=>{ G.actCallback?.(); });
$('#startBtn').addEventListener('click', ()=>{ if(!bindJoystick._b){ bindJoystick(); bindJoystick._b=true; } startGame(); });
$('#restartBtn').addEventListener('click', ()=>{ startGame(); });
document.addEventListener('gesturestart', e=>e.preventDefault());
document.addEventListener('touchmove', e=>{ if(e.touches.length>1) e.preventDefault(); }, {passive:false});
