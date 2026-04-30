import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const app = express();
app.use(express.json());

let db = { users: {}, market: {}, nextId: 1 };
const FP_KEY = process.env.FAUCETPAY_API_KEY || "test_key";
const EX_RATE = 1000;
const TOKENS = new Map();

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function safe(u) { if(!u) return null; const { passwordHash, ...s } = u; return s; }

function auth(req, res, next) {
    const token = req.headers['authorization'];
    if (!token || !TOKENS.has(token)) return res.status(401).json({ error: "Auth" });
    req.username = TOKENS.get(token);
    next();
}

app.post('/api/register', (req, res) => {
    try {
        let { username, password, pClass } = req.body;
        if (!username || username.length < 3 || !password || password.length < 4) return res.json({ error: "Ошибка данных" });
        if (db.users[username]) return res.json({ error: "Логин занят" });
        let stats = pClass === 'mage' ? { maxHp: 80, baseDmg: 15, baseDef: 2 } : { maxHp: 120, baseDmg: 10, baseDef: 5 };
        db.users[username] = { passwordHash: crypto.createHash('sha256').update(password).digest('hex'), class: pClass || 'warrior', xp: 0, level: 1, hp: stats.maxHp, maxHp: stats.maxHp, baseDmg: stats.baseDmg, baseDef: stats.baseDef, gold: 50, inventory: [], equippedWeapon: null, equippedArmor: null, inBattle: false, battleState: null, fpEmail: "" };
        const token = crypto.randomUUID(); TOKENS.set(token, username);
        res.json({ success: true, token, user: safe(db.users[username]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const user = db.users[username];
        if (!user || user.passwordHash !== crypto.createHash('sha256').update(password).digest('hex')) return res.json({ error: "Неверный логин/пароль" });
        const token = crypto.randomUUID(); TOKENS.set(token, username);
        res.json({ success: true, token, user: safe(user) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync', auth, (req, res) => {
    try { res.json({ user: safe(db.users[req.username]), market: Object.values(db.market) }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/action', auth, (req, res) => {
    try {
        const user = db.users[req.username];
        const { type, payload } = req.body;

        if (type === 'explore') {
            if (user.hp <= 0) return res.json({ log: "Вы мертвы.", user: safe(user) });
            const locs = { forest: { mob: "Гоблин", hp: 50, dmg: 8, def: 2, xp: 40, gold: 20, loot: [{n:"Ржавый меч",t:"weapon",p:5,c:0.3}] }, dungeon: { mob: "Голем", hp: 120, dmg: 15, def: 8, xp: 100, gold: 60, loot: [{n:"Меч Паладина",t:"weapon",p:15,c:0.4}] } };
            const loc = locs[payload];
            user.inBattle = true;
            user.battleState = { ...loc, currentHp: loc.hp, playerDefTurns: 0 };
            return res.json({ log: `Вы наткнулись на <b>${loc.mob}</b>!`, user: safe(user) });
        }

        if (type === 'battle_turn') {
            if (!user.inBattle || !user.battleState) return res.json({ log: "Вы не в бою.", user: safe(user) });
            let mob = user.battleState;
            let pDmg = user.baseDmg, pDef = user.baseDef;
            const w = user.inventory.find(i => i.id === user.equippedWeapon); if(w) pDmg += w.power;
            const a = user.inventory.find(i => i.id === user.equippedArmor); if(a) pDef += a.power;
            if (mob.playerDefTurns > 0) pDef += 15;
            let action = payload; let log = [];
            if (action === 'flee') { if (Math.random() > 0.5) { user.inBattle = false; user.battleState = null; return res.json({ log: "Вы сбежали!", user: safe(user), battleEnded: true }); } else log.push("Побег провалился!"); }
            else if (action === 'defend') { mob.playerDefTurns = 2; log.push("Вы в обороне."); }
            else { let dmg = Math.max(1, pDmg - mob.def + rand(-3, 5)); mob.currentHp -= dmg; log.push(`Удар: <span style="color:green">${dmg}</span>.`); }
            if (mob.playerDefTurns > 0 && action !== 'defend') mob.playerDefTurns--;
            if (mob.currentHp <= 0) {
                user.inBattle = false; user.battleState = null;
                log.push(`<span style="color:gold">ПОБЕДА! +${mob.xp}XP +${mob.gold}💰</span>`);
                user.xp += mob.xp; user.gold += mob.gold;
                for (let l of mob.loot) { if (Math.random() < l.c) { let it = {id: db.nextId++, name: l.n, type: l.t, power: l.p}; user.inventory.push(it); log.push(`Дроп: ${l.n}`); }}
                if (user.xp >= user.level * 150) { user.level++; user.xp -= (user.level-1)*150; user.maxHp += 20; user.baseDmg += 2; user.hp = user.maxHp; log.push("<span style='color:gold'>LEVEL UP!</span>"); }
                return res.json({ log: log.join('<br>'), user: safe(user), battleEnded: true });
            }
            let mDmg = Math.max(1, mob.dmg - pDef + rand(-3, 3)); user.hp -= mDmg; log.push(`${mob.mob} бьет: <span style="color:red">${mDmg}</span>.`);
            if (user.hp <= 0) { user.hp = 0; user.inBattle = false; user.battleState = null; let lost = Math.floor(user.gold * 0.2); user.gold -= lost; log.push(`<span style="color:red">💀 ПОГИБЛИ. -${lost}💰</span>`); user.hp = 1; return res.json({ log: log.join('<br>'), user: safe(user), battleEnded: true }); }
            return res.json({ log: log.join('<br>'), user: safe(user) });
        }

        if (type === 'use_flask') { const idx = user.inventory.findIndex(i => i.type === 'potion'); if(idx === -1) return res.json({ log: "Нет зелий!", user: safe(user) }); let pot = user.inventory.splice(idx, 1)[0]; user.hp = Math.min(user.maxHp, user.hp + pot.heal); return res.json({ log: `+${pot.heal} HP`, user: safe(user) }); }
        if (type === 'equip') { const it = user.inventory.find(i => i.id === payload); if(!it) return res.json({ log: "Ошибка", user: safe(user) }); if(it.type === 'weapon') user.equippedWeapon = payload; else if(it.type === 'armor') user.equippedArmor = payload; return res.json({ log: `Надето: ${it.name}`, user: safe(user) }); }
        if (type === 'shop') { const items = [{name:"Малое зелье",type:"potion",heal:50,price:20}, {name:"Большое зелье",type:"potion",heal:150,price:50}]; const it = items[payload]; if(!it || user.gold < it.price) return res.json({ log: "Мало золота", user: safe(user) }); user.gold -= it.price; user.inventory.push({id: db.nextId++, ...it}); return res.json({ log: `Куплено ${it.name}`, user: safe(user) }); }
        if (type === 'sell') { const idx = user.inventory.findIndex(i => i.id === payload.id && i.type !== 'potion'); if(idx === -1) return res.json({ log: "Ошибка", user: safe(user) }); if(user.equippedWeapon === payload.id) user.equippedWeapon = null; if(user.equippedArmor === payload.id) user.equippedArmor = null; const it = user.inventory.splice(idx, 1)[0]; db.market[it.id] = { id: it.id, seller: req.username, item: it, price: parseInt(payload.price) }; return res.json({ log: "Выставлено", user: safe(user) }); }
        if (type === 'buy') { const lot = db.market[payload]; if (!lot || lot.seller === req.username || user.gold < lot.price) return res.json({ log: "Ошибка", user: safe(user) }); user.gold -= lot.price; let fee = Math.floor(lot.price * 0.05); db.users[lot.seller].gold += (lot.price - fee); user.inventory.push(lot.item); delete db.market[payload]; return res.json({ log: `Куплено!`, user: safe(user) }); }
        if (type === 'link_email') { user.fpEmail = payload; return res.json({ log: "Email привязан!", user: safe(user) }); }
        if (type === 'withdraw') { if (!user.fpEmail) return res.json({ log: "Сначала привяжите Email!", user: safe(user) }); const amount = parseInt(payload.amount); if (user.gold < amount || amount < 1000) return res.json({ log: "Мало золота (мин 1000)", user: safe(user) }); let fee = Math.floor(amount * 0.10); let usdt = ((amount - fee) / EX_RATE).toFixed(2); user.gold -= amount; return res.json({ log: `Запрос на ${usdt} USDT на ${user.fpEmail} создан!`, user: safe(user) }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; font-family: Arial; }
body { background: #000; color: #fff; height: 100vh; display: flex; flex-direction: column; }
.header { background: #111; padding: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #333; }
.header h1 { font-size: 16px; color: #f1c40f; }
.hamburger { font-size: 24px; background: none; border: none; color: white; cursor: pointer; z-index: 1001; position: relative; }
.gold-hdr { font-size: 16px; color: #f1c40f; }
.content { flex: 1; overflow-y: auto; padding: 15px; background: #0a0a0a; }
.page { display: none; } .page.active { display: block; }
.bar-bg { height: 15px; background: #222; border-radius: 8px; margin-bottom: 15px; overflow: hidden; position: relative; }
.bar-fill { height: 100%; background: #e74c3c; transition: width 0.3s; }
.bar-fill.blue { background: #3498db; }
.bar-text { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; text-shadow: 1px 1px 2px black; }
.card { background: #151515; border: 1px solid #333; padding: 12px; border-radius: 5px; margin-bottom: 10px; }
.card h3 { font-size: 14px; color: #fff; margin-bottom: 5px; }
.card small { color: #888; font-size: 12px; display: block; margin-bottom: 5px; }
.log-box { background: #050505; border: 1px solid #222; padding: 10px; border-radius: 5px; font-size: 13px; line-height: 1.5; min-height: 120px; max-height: 200px; overflow-y: auto; margin-bottom: 15px; color: #aaa; }
.btn { width: 100%; padding: 15px; border: none; border-radius: 5px; font-weight: bold; font-size: 15px; cursor: pointer; margin-bottom: 8px; color: white; text-transform: uppercase; background: #333; }
.btn-g { background: #27ae60; } .btn-b { background: #2980b9; } .btn-p { background: #8e44ad; } .btn-y { background: #f1c40f; color: #000; }
.input { width: 100%; padding: 12px; background: #111; border: 1px solid #333; color: white; border-radius: 4px; margin-bottom: 8px; font-size: 14px; }

/* МЕНЮ НА ЧИСТОМ HTML И CSS (БЕЗ JAVASCRIPT) */
#menuToggle { display: none; }
.menu-bg { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 999; display: none; }
.menu-panel { position: fixed; top: 0; left: 0; width: 300px; height: 100%; background: #111; z-index: 1000; border-right: 2px solid #333; padding-top: 60px; display: none; }
.menu-link { display: block; width: 100%; text-align: left; padding: 20px; color: white; background: none; border: none; border-bottom: 1px solid #222; font-size: 16px; cursor: pointer; }
.menu-link:hover { background: #222; }
#menuToggle:checked ~ .menu-bg { display: block; }
#menuToggle:checked ~ .menu-panel { display: block; }
`;

const PAGE_AUTH = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Auth</title><style>${CSS}body{justify-content:center;padding:20px}.box{width:100%;max-width:320px}.box h1{text-align:center;margin-bottom:20px;font-size:20px}.err{color:red;font-size:12px;text-align:center;margin-bottom:10px;display:none}</style></head><body><div class="box"><h1>CRYPTO MMO</h1><div id="err" class="err"></div><input class="input" id="user" placeholder="Логин"><input class="input" type="password" id="pass" placeholder="Пароль"><select class="input" id="cls"><option value="warrior">Воин</option><option value="mage">Маг</option></select><button class="btn btn-y" onclick="reg()">СОЗДАТЬ</button><button class="btn" onclick="log()">ВХОД</button></div><script>const r=(u,b={})=>fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());const e=m=>{let el=document.getElementById('err');el.innerText=m;el.style.display='block';};async function reg(){let d=await r('register',{username:document.getElementById('user').value,password:document.getElementById('pass').value,pClass:document.getElementById('cls').value});if(d.error)return e(d.error);localStorage.setItem('tk',d.token);location.reload();}async function log(){let d=await r('login',{username:document.getElementById('user').value,password:document.getElementById('pass').value});if(d.error)return e(d.error);localStorage.setItem('tk',d.token);location.reload();}</script></body></html>`;

const PAGE_GAME = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>MMO</title><style>${CSS}</style></head><body>

<!-- ЧИСТО HTML МЕНЮ -->
<input type="checkbox" id="menuToggle">
<div class="menu-bg" onclick="document.getElementById('menuToggle').checked=false"></div>
<div class="menu-panel">
    <button class="menu-link" onclick="go('prof'); document.getElementById('menuToggle').checked=false">👤 Профиль</button>
    <button class="menu-link" onclick="go('map'); document.getElementById('menuToggle').checked=false">🗺️ Охота</button>
    <button class="menu-link" onclick="go('battle'); document.getElementById('menuToggle').checked=false">⚔️ Бой</button>
    <button class="menu-link" onclick="go('inv'); document.getElementById('menuToggle').checked=false">🎒 Инвентарь</button>
    <button class="menu-link" onclick="go('mkt'); document.getElementById('menuToggle').checked=false">🏦 Рынок</button>
    <button class="menu-link" onclick="go('wallet'); document.getElementById('menuToggle').checked=false">💰 Кошелек</button>
    <button class="menu-link" style="color:red; margin-top:50px;" onclick="location.href='/logout'">🚪 Выйти</button>
</div>

<div class="header">
    <label for="menuToggle" class="hamburger">☰</label>
    <h1 id="hdr">CRYPTO MMO</h1>
    <div class="gold-hdr">💰 <span id="hdrG">0</span></div>
</div>

<div class="content">
    <div id="pg-prof" class="page active">
        <div class="bar-bg"><div class="bar-fill" id="hpBar" style="width:0%"></div><div class="bar-text" id="hpTxt">0/0</div></div>
        <div class="bar-bg"><div class="bar-fill blue" id="xpBar" style="width:0%"></div><div class="bar-text" id="xpTxt">0/0</div></div>
        <div class="card"><h3>⚔️ Оружие</h3><span id="eqW" style="color:#888">Пусто</span></div>
        <div class="card"><h3>🛡️ Броня</h3><span id="eqA" style="color:#888">Пусто</span></div>
        <div class="card"><h3>📊 Характеристики</h3>Урон: <span id="stD" style="color:#f1c40f">0</span> | Защита: <span id="stF" style="color:#f1c40f">0</span> | Ур: <span id="stL" style="color:#f1c40f">0</span></div>
    </div>

    <div id="pg-map" class="page">
        <div class="log-box" id="mapLog">Выберите локацию для поиска врагов.</div>
        <button class="btn btn-g" onclick="explore('forest')">🌲 Идти в Тёмный Лес</button>
        <button class="btn btn-p" onclick="explore('dungeon')">💀 Идти в Пещеру</button>
        <button class="btn" style="background:#2c3e50" onclick="goShop()">🧪 Магазин Зелий</button>
    </div>

    <div id="pg-battle" class="page">
        <div class="log-box" id="batLog">Ожидание...</div>
        <div style="background:#111;padding:10px;border-radius:5px;margin-bottom:15px;text-align:center">
            <span style="color:#aaa">ВРАГ:</span> <span id="mobN" style="color:red;font-weight:bold">???</span>
            <div style="margin-top:5px"><div class="bar-bg" style="margin:0"><div class="bar-fill" id="mobHB" style="width:100%"></div></div></div>
        </div>
        <div id="batBtns">
            <button class="btn btn-g" onclick="turn('attack')">⚔️ АТАКА</button>
            <button class="btn btn-b" onclick="turn('defend')">🛡️ ЗАЩИТА</button>
            <button class="btn btn-p" onclick="useFlask()">🧪 ФЛАСКА</button>
            <button class="btn" onclick="turn('flee')">🏃 СБЕЖАТЬ</button>
        </div>
    </div>

    <div id="pg-inv" class="page"><div id="invC"></div></div>
    <div id="pg-mkt" class="page"><h3 style="margin-bottom:10px;color:#f1c40f">P2P РЫНОК</h3><div id="mktC"></div></div>

    <div id="pg-wallet" class="page">
        <div class="card" style="text-align:center">
            <h3>Привязка FaucetPay</h3>
            <small>Укажите email для вывода</small>
            <div style="margin-top:10px">
                <input class="input" type="email" id="fpEmailInput" placeholder="email@faucetpay.com">
                <button class="btn btn-b" onclick="linkEmail()">🔒 ПРИВЯЗАТЬ</button>
            </div>
            <div style="margin-top:15px; font-size:14px;">Текущий: <span id="currentEmail" style="color:#f1c40f">Нет</span></div>
        </div>
        <h3 style="margin:20px 0 10px;color:#f1c40f">ВЫВОД (1USDT = 1000💰)</h3>
        <div class="card">
            <input class="input" type="number" id="wdAmount" placeholder="Сумма золота (мин 1000)">
            <button class="btn btn-y" onclick="wd()">💸 ВЫВЕСТИ USDT</button>
        </div>
    </div>
</div>

<script>
let tk=localStorage.getItem('tk');
let battleInterval=null;

const r=async(u,b={})=>{
    let res=await fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json','Authorization':tk},body:JSON.stringify(b)}); 
    if(res.status===401){location.href='/auth';return null;} 
    return res.json();
};

function go(p){
    document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
    document.getElementById('pg-'+p).classList.add('active');
    if(p==='inv')renderInv();
    if(p==='mkt')renderMkt();
    if(p==='wallet')renderWallet();
}

window.onload = async function() {
    document.getElementById('hdr').innerText = "Подключение...";
    let d = await r('sync');
    if(d) updUI(d.user);
};

function updUI(u){
    if(!u) return;
    document.getElementById('hdr').innerText = (u.class==='mage'?'Маг ':'Воин ') + u.username;
    document.getElementById('hdrG').innerText=u.gold;
    
    document.getElementById('hpTxt').innerText = '❤️ HP: ' + u.hp + '/' + u.maxHp;
    document.getElementById('hpBar').style.width = (u.hp/u.maxHp)*100 + '%';
    
    let xN = u.level * 150;
    document.getElementById('xpTxt').innerText = '⭐ XP: ' + u.xp + '/' + xN;
    document.getElementById('xpBar').style.width = (u.xp/xN)*100 + '%';

    let dm=u.baseDmg,df=u.baseDef;
    const w=u.inventory.find(i=>i.id===u.equippedWeapon);if(w){dm+=w.power;document.getElementById('eqW').innerHTML=w.name+' <span style="color:#f1c40f">(+'+w.power+')</span>';}else document.getElementById('eqW').innerText="Пусто";
    const a=u.inventory.find(i=>i.id===u.equippedArmor);if(a){df+=a.power;document.getElementById('eqA').innerHTML=a.name+' <span style="color:#f1c40f">(+'+a.power+')</span>';}else document.getElementById('eqA').innerText="Пусто";
    document.getElementById('stD').innerText=dm;document.getElementById('stF').innerText=df;document.getElementById('stL').innerText=u.level;
    
    if(u.inBattle&&u.battleState){
        document.getElementById('mobN').innerText=u.battleState.mob;
        document.getElementById('mobHB').style.width=Math.max(0,(u.battleState.currentHp/u.battleState.hp)*100)+'%';
        if(!battleInterval)startBattleLoop();
    }
}

function renderWallet(){r('sync').then(d=>{if(d){document.getElementById('currentEmail').innerText = d.user.fpEmail || "Нет";document.getElementById('fpEmailInput').value = d.user.fpEmail || "";}});}
async function linkEmail(){let email = document.getElementById('fpEmailInput').value;if(!email || !email.includes('@')) return alert("Введите email");let d = await r('action', {type:'link_email', payload:email});if(d){ alert(d.log); updUI(d.user); renderWallet();}}
async function explore(loc){let d=await r('action',{type:'explore',payload:loc});if(d){document.getElementById('mapLog').innerHTML=d.log;updUI(d.user);if(d.user.inBattle)go('battle');}}
function startBattleLoop(){battleInterval=setInterval(async()=>{let d=await r('sync');if(!d||!d.user.inBattle){clearInterval(battleInterval);battleInterval=null;document.getElementById('batBtns').innerHTML='<button class="btn" style="background:#333">БОЙ ОКОНЧЕН</button>';updUI(d.user);return;}updUI(d.user);},1000);}
async function turn(act){let d=await r('action',{type:'battle_turn',payload:act});if(!d)return;document.getElementById('batLog').innerHTML+=d.log+'<br>';document.getElementById('batLog').scrollTop=9999;updUI(d.user);if(d.battleEnded){clearInterval(battleInterval);battleInterval=null;document.getElementById('batBtns').innerHTML='<button class="btn btn-y" onclick="go(\'map\')">ВЕРНУТЬСЯ НА КАРТУ</button>';}}
async function useFlask(){let d=await r('action',{type:'use_flask'});if(d){document.getElementById('batLog').innerHTML+=d.log+'<br>';updUI(d.user);}}
async function goShop(){let p=prompt("1. Малое (20💰)\\n2. Большое (50💰)");if(!p)return;let d=await r('action',{type:'shop',payload:parseInt(p)-1});if(d){document.getElementById('mapLog').innerHTML+="<br>"+d.log;updUI(d.user);}}
function renderInv(){r('sync').then(d=>{if(!d)return;let el=document.getElementById('invC');if(!d.user.inventory.length){el.innerHTML='<div class="card" style="text-align:center;color:#666">Пусто</div>';return;}el.innerHTML=d.user.inventory.map(i=>{let s=i.type==='weapon'?'Урон: +'+i.power:i.type==='armor'?'Защита: +'+i.power:'Лечение: +'+i.heal;let b=i.type==='potion'?'':'<button class="btn btn-y" onclick="eqItem('+i.id+')">ЭКИПИРОВАТЬ</button>';if(i.type!=='potion')b+='<button class="btn" style="margin-top:5px" onclick="sellItem('+i.id+')">ВЫСТАВИТЬ НА P2P</button>';return '<div class="card"><h3>'+i.name+'</h3><small>'+s+'</small>'+b+'</div>';}).join('');});}
async function eqItem(id){let d=await r('action',{type:'equip',payload:id});if(d){updUI(d.user);renderInv();}}
async function sellItem(id){let p=prompt("Цена в 💰:");if(!p)return;let d=await r('action',{type:'sell',payload:{id,price:p}});if(d){updUI(d.user);renderInv();}}
function renderMkt(){r('sync').then(d=>{if(!d)return;let el=document.getElementById('mktC');if(!d.market.length){el.innerHTML='<div class="card" style="text-align:center;color:#666">Рынок пуст</div>';return;}el.innerHTML=d.market.map(m=>{let s=m.item.type==='weapon'?'Урон: +'+m.item.power:'Защита: +'+m.item.power;return '<div class="card"><h3>'+m.item.name+'</h3><small>'+s+' | '+m.seller+'</small><div style="font-size:18px;color:#f1c40f;margin:10px 0">'+m.price+' 💰</div><button class="btn btn-g" onclick="buyItem('+m.id+')">КУПИТЬ</button></div>';}).join('');});}
async function buyItem(id){let d=await r('action',{type:'buy',payload:id});if(d){alert(d.log);updUI(d.user);renderMkt();}}
async function wd(){let d=await r('action',{type:'withdraw',payload:{amount:document.getElementById('wdAmount').value}});if(d) alert(d.log);updUI(d.user);}
</script>
</body></html>`;

app.get('/', (req, res) => res.redirect('/auth?v=2'));
app.get('/auth', (req, res) => res.send(PAGE_AUTH));
app.get('/game', (req, res) => res.send(PAGE_GAME));
app.get('/logout', (req, res) => res.send(`<!DOCTYPE html><html><head><script>localStorage.removeItem('tk');location.href='/auth?v=2';</script></head></html>`));

export default app;
