import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

let db = { users: {}, market: {}, nextId: 1 }; // market переделан в объект для быстрых удалений
const FP_KEY = process.env.FAUCETPAY_API_KEY || "test_key";
const EX_RATE = 1000;
const JWT_SECRET = "super_mmo_secret";

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function safe(u) { if(!u) return null; const { passwordHash, ...s } = u; return s; }

function auth(req, res, next) {
    try {
        req.username = jwt.verify(req.headers['authorization'], JWT_SECRET).username;
        next();
    } catch (e) { res.status(401).json({ error: "Auth" }); }
}

// --- AUTH ---
app.post('/api/register', (req, res) => {
    let { username, password, pClass } = req.body;
    if (!username || username.length < 3 || !password || password.length < 4) return res.json({ error: "Ошибка данных" });
    if (db.users[username]) return res.json({ error: "Логин занят" });
    let stats = pClass === 'mage' ? { maxHp: 80, baseDmg: 15, baseDef: 2 } : { maxHp: 120, baseDmg: 10, baseDef: 5 };
    db.users[username] = { passwordHash: password, class: pClass || 'warrior', xp: 0, level: 1, hp: stats.maxHp, maxHp: stats.maxHp, baseDmg: stats.baseDmg, baseDef: stats.baseDef, gold: 50, inventory: [], equippedWeapon: null, equippedArmor: null, inBattle: false, battleState: null };
    res.json({ success: true, token: jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }), user: safe(db.users[username]) });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || user.passwordHash !== password) return res.json({ error: "Неверный логин/пароль" });
    res.json({ success: true, token: jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' }), user: safe(user) });
});

app.post('/api/sync', auth, (req, res) => {
    res.json({ user: safe(db.users[req.username]), market: Object.values(db.market) });
});

// --- GAME LOGIC ---
app.post('/api/action', auth, (req, res) => {
    const user = db.users[req.username];
    const { type, payload } = req.body;

    if (type === 'explore') {
        if (user.hp <= 0) return res.json({ log: "Вы мертвы.", user: safe(user) });
        const locs = {
            forest: { mob: "Гоблин-разведчик", hp: 50, dmg: 8, def: 2, xp: 40, gold: 20, loot: [{n:"Ржавый меч",t:"weapon",p:5,c:0.3}] },
            dungeon: { mob: "Каменный голем", hp: 120, dmg: 15, def: 8, xp: 100, gold: 60, loot: [{n:"Меч Паладина",t:"weapon",p:15,c:0.4}] }
        };
        const loc = locs[payload];
        user.inBattle = true;
        user.battleState = { ...loc, currentHp: loc.hp, playerDefTurns: 0 }; // playerDefTurns - счетчик защиты
        return res.json({ log: `Вы наткнулись на <b>${loc.mob}</b>! Бой начался!`, user: safe(user) });
    }

    if (type === 'battle_turn') {
        if (!user.inBattle || !user.battleState) return res.json({ log: "Вы не в бою.", user: safe(user) });
        let mob = user.battleState;
        let pDmg = user.baseDmg, pDef = user.baseDef;
        const w = user.inventory.find(i => i.id === user.equippedWeapon); if(w) pDmg += w.power;
        const a = user.inventory.find(i => i.id === user.equippedArmor); if(a) pDef += a.power;
        
        // Применяем защиту если она активна
        if (mob.playerDefTurns > 0) pDef += 15;
        
        let action = payload; // 'attack', 'defend', 'flee'
        let log = [];

        // Ход Игрока
        if (action === 'flee') {
            if (Math.random() > 0.5) {
                user.inBattle = false; user.battleState = null;
                return res.json({ log: "Вы успешно сбежали!", user: safe(user), battleEnded: true });
            } else {
                log.push("Попытка сбежать провалилась!");
            }
        } else if (action === 'defend') {
            mob.playerDefTurns = 2; // Защита длится 2 хода
            log.push("Вы встали в глухую оборону (2 хода).");
        } else { // attack
            let dmg = Math.max(1, pDmg - mob.def + rand(-3, 5));
            mob.currentHp -= dmg;
            log.push(`Вы ударили на <span style="color:var(--g)">${dmg}</span> урона.`);
        }

        if (mob.playerDefTurns > 0 && action !== 'defend') mob.playerDefTurns--; // Снижаем счетчик защиты, если не повторяем защиту

        // Проверка смерти моба
        if (mob.currentHp <= 0) {
            user.inBattle = false; user.battleState = null;
            log.push(`<span style="color:var(--g)">🎉 ПОБЕДА! +${mob.xp} XP, +${mob.gold} 💰</span>`);
            user.xp += mob.xp; user.gold += mob.gold;
            for (let l of mob.loot) { if (Math.random() < l.c) { let it = {id: db.nextId++, name: l.n, type: l.t, power: l.p}; user.inventory.push(it); log.push(`Выпал: <b>${l.n}</b>`); }}
            if (user.xp >= user.level * 150) { user.level++; user.xp -= (user.level-1)*150; user.maxHp += 20; user.baseDmg += 2; user.hp = user.maxHp; log.push("<span style='color:var(--y)'>LEVEL UP!</span>"); }
            return res.json({ log: log.join('<br>'), user: safe(user), battleEnded: true });
        }

        // Ход Моба
        let mDmg = Math.max(1, mob.dmg - pDef + rand(-3, 3));
        user.hp -= mDmg;
        log.push(`${mob.mob} бьет вас на <span style="color:var(--r)">${mDmg}</span>.`);

        // Проверка смерти игрока
        if (user.hp <= 0) {
            user.hp = 0; user.inBattle = false; user.battleState = null;
            let lost = Math.floor(user.gold * 0.2); user.gold -= lost;
            log.push(`<span style="color:var(--r)">💀 ВЫ ПОГИБЛИ. -${lost} 💰.</span>`);
            user.hp = 1; // Воскрешаем сразу для удобства
            return res.json({ log: log.join('<br>'), user: safe(user), battleEnded: true });
        }

        return res.json({ log: log.join('<br>'), user: safe(user) });
    }

    if (type === 'use_flask') {
        const idx = user.inventory.findIndex(i => i.type === 'potion');
        if(idx === -1) return res.json({ log: "Нет зелий!", user: safe(user) });
        let pot = user.inventory.splice(idx, 1)[0]; user.hp = Math.min(user.maxHp, user.hp + pot.heal);
        return res.json({ log: `Использовано ${pot.name} (+${pot.heal} HP)`, user: safe(user) });
    }

    if (type === 'equip') {
        const it = user.inventory.find(i => i.id === payload);
        if(!it) return res.json({ log: "Ошибка", user: safe(user) });
        if(it.type === 'weapon') user.equippedWeapon = payload; else if(it.type === 'armor') user.equippedArmor = payload;
        return res.json({ log: `Надето: ${it.name}`, user: safe(user) });
    }

    if (type === 'shop') {
        const items = [{name:"Малое зелье",type:"potion",heal:50,price:20}, {name:"Большое зелье",type:"potion",heal:150,price:50}];
        const it = items[payload]; if(!it || user.gold < it.price) return res.json({ log: "Мало золота", user: safe(user) });
        user.gold -= it.price; user.inventory.push({id: db.nextId++, ...it});
        return res.json({ log: `Куплено ${it.name}`, user: safe(user) });
    }

    if (type === 'sell') {
        const idx = user.inventory.findIndex(i => i.id === payload.id && i.type !== 'potion');
        if(idx === -1) return res.json({ log: "Ошибка", user: safe(user) });
        if(user.equippedWeapon === payload.id) user.equippedWeapon = null;
        if(user.equippedArmor === payload.id) user.equippedArmor = null;
        const it = user.inventory.splice(idx, 1)[0];
        db.market[it.id] = { id: it.id, seller: req.username, item: it, price: parseInt(payload.price) };
        return res.json({ log: "Выставлено", user: safe(user) });
    }

    if (type === 'buy') {
        const lot = db.market[payload];
        if (!lot || lot.seller === req.username || user.gold < lot.price) return res.json({ log: "Ошибка", user: safe(user) });
        user.gold -= lot.price; let fee = Math.floor(lot.price * 0.05); db.users[lot.seller].gold += (lot.price - fee);
        user.inventory.push(lot.item); delete db.market[payload];
        return res.json({ log: `Куплено! (-${fee}💰 комис)`, user: safe(user) });
    }

    if (type === 'withdraw') {
        const amount = parseInt(payload.amount);
        if (user.gold < amount || amount < 1000) return res.json({ log: "Мало золота (мин 1000)", user: safe(user) });
        let fee = Math.floor(amount * 0.10); let usdt = ((amount - fee) / EX_RATE).toFixed(2);
        user.gold -= amount; 
        return res.json({ log: `Выведено ${usdt} USDT!`, user: safe(user) });
    }
});

// --- HTML PAGES ---

const CSS = `
:root { --bg:#0a0a0a; --p:#141414; --b:#222; --g:#f1c40f; --r:#e74c3c; --bl:#3498db; --gr:#2ecc71; --y:#f39c12; --t:#ddd; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
body { background: var(--bg); color: var(--t); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.header { background: var(--p); padding: 15px; border-bottom: 1px solid var(--b); display: flex; justify-content: space-between; align-items: center; z-index: 10; }
.header h1 { font-size: 16px; color: var(--g); }
.content { flex: 1; overflow-y: auto; padding: 15px; background: #000; }
.nav { background: var(--p); display: grid; grid-template-columns: repeat(5, 1fr); border-top: 1px solid var(--b); z-index: 10; }
.nav button { background: none; border: none; color: #888; padding: 15px 0; font-size: 20px; cursor: pointer; }
.nav button.active { color: var(--g); background: #1a1a1a; border-top: 2px solid var(--g); }
.page { display: none; height: 100%; } .page.active { display: flex; flex-direction: column; }
.stat-row { display: flex; justify-content: space-between; margin-bottom: 5px; font-size: 13px; color: #aaa; }
.stat-row span { color: white; font-weight: bold; }
.bar { height: 6px; background: #222; border-radius: 3px; margin-bottom: 15px; overflow: hidden; }
.bar-fill { height: 100%; transition: width 0.3s; }
.hp { background: var(--r); } .xp { background: var(--bl); }
.card { background: var(--p); border: 1px solid var(--b); padding: 12px; border-radius: 6px; margin-bottom: 10px; }
.card h3 { font-size: 14px; margin-bottom: 5px; color: white; }
.card small { color: #888; font-size: 12px; display: block; margin-bottom: 8px; }
.log-box { background: #050505; border: 1px solid #1a1a1a; padding: 10px; border-radius: 6px; font-size: 13px; line-height: 1.5; min-height: 150px; max-height: 200px; overflow-y: auto; margin-bottom: 15px; color: #aaa; }
.btn { width: 100%; padding: 14px; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; cursor: pointer; margin-bottom: 8px; color: white; text-transform: uppercase; }
.btn-atk { background: #27ae60; } .btn-def { background: #2980b9; } .btn-flask { background: #8e44ad; } .btn-flee { background: #555; } .btn-sell { background: var(--y); color: #000; }
.btn:disabled { background: #333 !important; color: #666 !important; cursor: not-allowed; }
.input { width: 100%; padding: 12px; background: #111; border: 1px solid var(--b); color: white; border-radius: 4px; margin-bottom: 8px; font-size: 14px; }
`;

const PAGE_AUTH = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Auth</title><style>${CSS} body { justify-content: center; padding: 20px; }
.box { width: 100%; max-width: 320px; }
.box h1 { text-align: center; margin-bottom: 20px; font-size: 20px; }
.err { color: var(--r); font-size: 12px; text-align: center; margin-bottom: 10px; display: none; }</style></head><body>
<div class="box">
<h1>REALM OF CRYPTO</h1>
<div id="err" class="err"></div>
<input class="input" id="user" placeholder="Логин">
<input class="input" type="password" id="pass" placeholder="Пароль">
<select class="input" id="cls"><option value="warrior">Воин</option><option value="mage">Маг</option></select>
<button class="btn" style="background:var(--g);color:#000" onclick="reg()">СОЗДАТЬ</button>
<button class="btn" style="background:#333" onclick="log()">ВХОД</button>
</div>
<script>
const r=(u,b={})=>fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
const e=m=>{let el=document.getElementById('err');el.innerText=m;el.style.display='block';};
async function reg(){let d=await r('register',{username:document.getElementById('user').value,password:document.getElementById('pass').value,pClass:document.getElementById('cls').value});if(d.error)return e(d.error);localStorage.setItem('tk',d.token);location.href='/game';}
async function log(){let d=await r('login',{username:document.getElementById('user').value,password:document.getElementById('pass').value});if(d.error)return e(d.error);localStorage.setItem('tk',d.token);location.href='/game';}
</script></body></html>`;

const PAGE_GAME = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><title>MMO</title><style>${CSS}</style></head><body>
<div class="header"><h1 id="hdr">LOADING...</h1><div style="font-size:20px;color:var(--g)">💰 <span id="hdrG">0</span></div></div>

<div class="content">
    <!-- PROFILE -->
    <div id="pg-prof" class="page active">
        <div class="stat-row"><span>❤️ HP</span><span id="hpT">0/0</span></div><div class="bar"><div class="bar-fill hp" id="hpB" style="width:0%"></div></div>
        <div class="stat-row"><span>⭐ XP</span><span id="xpT">0/0</span></div><div class="bar"><div class="bar-fill xp" id="xpB" style="width:0%"></div></div>
        
        <div class="card"><h3>⚔️ Оружие</h3><span id="eqW" style="color:#888">Пусто</span></div>
        <div class="card"><h3>🛡️ Броня</h3><span id="eqA" style="color:#888">Пусто</span></div>
        <div class="card"><h3>📊 Статы</h3>Урон: <span id="stD" style="color:var(--g)">0</span> | Защита: <span id="stF" style="color:var(--g)">0</span> | Ур: <span id="stL" style="color:var(--g)">0</span></div>
        
        <h3 style="margin:15px 0 10px; color:var(--g); font-size:14px;">ВЫВОД USDT</h3>
        <input class="input" type="email" id="fpE" placeholder="FaucetPay Email">
        <input class="input" type="number" id="fpA" placeholder="Сумма золота (мин 1000)">
        <button class="btn" style="background:var(--g);color:#000" onclick="wd()">ЗАПРОСИТЬ ВЫПЛАТУ</button>
    </div>

    <!-- MAP / EXPLORE -->
    <div id="pg-map" class="page">
        <div class="log-box" id="mapLog">Выберите локацию для поиска врагов.</div>
        <button class="btn" style="background:#27ae60" onclick="explore('forest')">🌲 Идти в Тёмный Лес</button>
        <button class="btn" style="background:#8e44ad" onclick="explore('dungeon')">💀 Идти в Пещеру</button>
        <button class="btn" style="background:#2c3e50" onclick="goShop()">🧪 Зелья (Магазин)</button>
    </div>

    <!-- BATTLE -->
    <div id="pg-battle" class="page">
        <div class="log-box" id="batLog">Ожидание...</div>
        <div style="background:#111; padding:10px; border-radius:6px; margin-bottom:15px; text-align:center;">
            <span style="color:#aaa">ВРАГ:</span> <span id="mobN" style="color:var(--r); font-weight:bold;">???</span>
            <div style="margin-top:5px;"><div class="bar" style="margin:0"><div class="bar-fill hp" id="mobHB" style="width:100%"></div></div></div>
        </div>
        <div id="batBtns">
            <button class="btn btn-atk" onclick="turn('attack')">⚔️ АТАКА</button>
            <button class="btn btn-def" onclick="turn('defend')">🛡️ ЗАЩИТА (2 хода)</button>
            <button class="btn btn-flask" onclick="useFlask()">🧪 ФЛАСКА</button>
            <button class="btn btn-flee" id="btnFlee" onclick="turn('flee')">🏃 СБЕЖАТЬ</button>
        </div>
    </div>

    <!-- INVENTORY -->
    <div id="pg-inv" class="page"><div id="invC"></div></div>

    <!-- MARKET -->
    <div id="pg-mkt" class="page"><h3 style="margin-bottom:10px;color:var(--g)">P2P РЫНОК (Комиссия 5%)</h3><div id="mktC"></div></div>
</div>

<div class="nav">
    <button class="active" onclick="go('prof', this)">👤</button>
    <button onclick="go('map', this)">🗺️</button>
    <button onclick="go('battle', this)">⚔️</button>
    <button onclick="go('inv', this)">🎒</button>
    <button onclick="go('mkt', this)">🏦</button>
</div>

<script>
let tk=localStorage.getItem('tk');
const r=async(u,b={})=>{let res=await fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json','Authorization':tk},body:JSON.stringify(b)});if(res.status===401){location.href='/auth';return null;}return res.json();};

let battleInterval = null;

function go(p, btn) {
    document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
    document.querySelectorAll('.nav button').forEach(e=>e.classList.remove('active'));
    document.getElementById('pg-'+p).classList.add('active');
    if(btn) btn.classList.add('active');
    
    if(p==='inv') renderInv();
    if(p==='mkt') renderMkt();
}

async function init() {
    let d = await r('sync');
    if(!d) return;
    updUI(d.user);
}

function updUI(u) {
    if(!u) return;
    document.getElementById('hdr').innerText = u.class==='mage'?'Маг '+u.username:'Воин '+u.username;
    document.getElementById('hdrG').innerText = u.gold;
    document.getElementById('hpT').innerText = u.hp+'/'+u.maxHp;
    document.getElementById('hpB').style.width = (u.hp/u.maxHp)*100+'%';
    let xN = u.level*150;
    document.getElementById('xpT').innerText = u.xp+'/'+xN;
    document.getElementById('xpB').style.width = (u.xp/xN)*100+'%';
    
    let dm=u.baseDmg, df=u.baseDef;
    const w=u.inventory.find(i=>i.id===u.equippedWeapon); if(w){dm+=w.power; document.getElementById('eqW').innerHTML=`${w.name} <span style="color:var(--g)">(+${w.power})</span>`;} else document.getElementById('eqW').innerText="Пусто";
    const a=u.inventory.find(i=>i.id===u.equippedArmor); if(a){df+=a.power; document.getElementById('eqA').innerHTML=`${a.name} <span style="color:var(--g)">(+${a.power})</span>`;} else document.getElementById('eqA').innerText="Пусто";
    
    document.getElementById('stD').innerText=dm; document.getElementById('stF').innerText=df; document.getElementById('stL').innerText=u.level;

    // Боевое состояние
    if(u.inBattle && u.battleState) {
        document.getElementById('mobN').innerText = u.battleState.mob;
        document.getElementById('mobHB').style.width = Math.max(0, (u.battleState.currentHp / u.battleState.hp)*100)+'%';
        if(!battleInterval) startBattleLoop();
    }
}

async function explore(loc) {
    let d = await r('action', {type:'explore', payload:loc});
    if(d) {
        document.getElementById('mapLog').innerHTML = d.log;
        updUI(d.user);
        if(d.user.inBattle) go('battle', document.querySelectorAll('.nav button')[2]); // Автопереход в бой
    }
}

function startBattleLoop() {
    battleInterval = setInterval(async () => {
        let d = await r('sync');
        if(!d || !d.user.inBattle) {
            clearInterval(battleInterval); battleInterval = null;
            document.getElementById('batBtns').innerHTML = '<button class="btn" style="background:#333">БОЙ ОКОНЧЕН</button>';
            updUI(d.user);
            return;
        }
        updUI(d.user);
    }, 1000);
}

async function turn(act) {
    let d = await r('action', {type:'battle_turn', payload:act});
    if(!d) return;
    let log = document.getElementById('batLog');
    log.innerHTML += d.log + '<br>';
    log.scrollTop = log.scrollHeight;
    
    updUI(d.user);

    if(d.battleEnded) {
        clearInterval(battleInterval); battleInterval = null;
        document.getElementById('batBtns').innerHTML = '<button class="btn" style="background:var(--g);color:#000" onclick="go(\'map\', document.querySelectorAll(\'nav button\')[1])">ВЕРНУТЬСЯ НА КАРТУ</button>';
    }
}

async function useFlask() {
    let d = await r('action', {type:'use_flask'});
    if(d) {
        document.getElementById('batLog').innerHTML += d.log + '<br>';
        updUI(d.user);
    }
}

async function goShop() {
    let p = prompt("1. Малое зелье (20💰)\n2. Большое зелье (50💰)");
    if(!p) return;
    let d = await r('action', {type:'shop', payload:parseInt(p)-1});
    if(d) {
        document.getElementById('mapLog').innerHTML += "<br>" + d.log;
        updUI(d.user);
    }
}

function renderInv() {
    r('sync').then(d => {
        if(!d) return;
        let el = document.getElementById('invC');
        if(!d.user.inventory.length) { el.innerHTML = '<div class="card" style="text-align:center;color:#666">Инвентарь пуст</div>'; return; }
        el.innerHTML = d.user.inventory.map(i => {
            let s = i.type==='weapon'?`Урон: +${i.power}`:i.type==='armor'?`Защита: +${i.power}`:`Лечение: +${i.heal} HP`;
            let b = i.type==='potion' ? '' : `<button class="btn btn-sell" onclick="eqItem(${i.id})">ЭКИПИРОВАТЬ</button>`;
            if(i.type!=='potion') b += `<button class="btn" style="background:#555;margin-top:5px" onclick="sellItem(${i.id})">ВЫСТАВИТЬ НА P2P</button>`;
            return `<div class="card"><h3>${i.name}</h3><small>${s}</small>${b}</div>`;
        }).join('');
    });
}

async function eqItem(id) { let d=await r('action',{type:'equip',payload:id}); if(d){updUI(d.user);renderInv();} }
async function sellItem(id) {
    let p = prompt("Укажите цену в золоте:");
    if(!p) return;
    let d = await r('action', {type:'sell', payload:{id, price:p}});
    if(d) { updUI(d.user); renderInv(); }
}

function renderMkt() {
    r('sync').then(d => {
        if(!d) return;
        let el = document.getElementById('mktC');
        if(!d.market.length) { el.innerHTML = '<div class="card" style="text-align:center;color:#666">Рынок пуст</div>'; return; }
        el.innerHTML = d.market.map(m => {
            let s = m.item.type==='weapon'?`Урон: +${m.item.power}`:`Защита: +${m.item.power}`;
            return `<div class="card"><h3>${m.item.name}</h3><small>${s} | Продавец: ${m.seller}</small><div style="font-size:18px;color:var(--g);margin:10px 0">${m.price} 💰</div><button class="btn btn-atk" onclick="buyItem(${m.id})">КУПИТЬ</button></div>`;
        }).join('');
    });
}

async function buyItem(id) {
    let d = await r('action', {type:'buy', payload:id});
    if(d) { alert(d.log); updUI(d.user); renderMkt(); }
}

async function wd() {
    let d = await r('action', {type:'withdraw', payload:{email:document.getElementById('fpE').value, amount:document.getElementById('fpA').value}});
    if(d) alert(d.log);
    updUI(d.user);
}

init();
</script></body></html>`;

app.get('/', (req, res) => res.redirect('/auth'));
app.get('/auth', (req, res) => res.send(PAGE_AUTH));
app.get('/game', (req, res) => res.send(PAGE_GAME));
app.get('/logout', (req, res) => res.send(`<!DOCTYPE html><html><head><script>localStorage.removeItem('tk');location.href='/auth';</script></head></html>`));

export default app;
