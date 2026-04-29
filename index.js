import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';

const app = express();
app.use(express.json());

// База данных в памяти
let db = { users: {}, market: [], nextId: 1 };
const FP_KEY = process.env.FAUCETPAY_API_KEY || "6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9";
const EX_RATE = 1000;
const JWT_SECRET = "super_secret_mmo_key_123"; // В проде это тоже нужно прятать в Env

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function safe(u) { if(!u) return null; const { passwordHash, ...s } = u; return s; }

// --- АВТОРИЗАЦИЯ ЧЕРЕЗ JWT ---
function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: "Нет токена" });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.username = decoded.username;
        next();
    } catch (err) {
        res.status(401).json({ error: "Неверный токен" });
    }
}

app.post('/api/register', (req, res) => {
    let { username, password, pClass } = req.body;
    if (!username || username.length < 3) return res.json({ error: "Логин мин. 3 символа" });
    if (!password || password.length < 4) return res.json({ error: "Пароль мин. 4 символа" });
    if (db.users[username]) return res.json({ error: "Логин занят" });

    let stats = pClass === 'mage' ? { maxHp: 80, baseDmg: 15, baseDef: 2 } : { maxHp: 120, baseDmg: 10, baseDef: 5 };
    
    db.users[username] = {
        passwordHash: password, class: pClass || 'warrior', // В примере без хеширования для скорости
        xp: 0, level: 1, hp: stats.maxHp, maxHp: stats.maxHp,
        baseDmg: stats.baseDmg, baseDef: stats.baseDef, gold: 50,
        inventory: [], equippedWeapon: null, equippedArmor: null
    };
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user: safe(db.users[username]) });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || user.passwordHash !== password) return res.json({ error: "Неверный логин/пароль" });
    
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token, user: safe(user) });
});

app.post('/api/verify', (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.json({ ok: false });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (db.users[decoded.username]) return res.json({ ok: true, user: safe(db.users[decoded.username]) });
    } catch (e) {}
    res.json({ ok: false });
});

// --- ИГРОВАЯ ЛОГИКА ---
app.post('/api/action', authMiddleware, async (req, res) => {
    const user = db.users[req.username];
    const { type, target, payload } = req.body;

    if (type === 'fight') {
        if(user.hp <= 0) return res.json({ log: "<span style='color:red'>Вы мертвы!</span>", user: safe(user) });
        const locs = {
            forest: { mob: "Гоблин", hp: 40, dmg: 8, def: 2, xp: 30, gold: 15, loot: [{n:"Кинжал",t:"weapon",p:5,c:0.3}] },
            dungeon: { mob: "Голем", hp: 100, dmg: 18, def: 10, xp: 80, gold: 50, loot: [{n:"Меч Паладина",t:"weapon",p:15,c:0.4}] }
        };
        const loc = locs[target] || locs.forest;
        let mob = { hp: loc.hp, maxHp: loc.hp };
        let pDmg = user.baseDmg, pDef = user.baseDef;
        const w = user.inventory.find(i => i.id === user.equippedWeapon); if(w) pDmg += w.power;
        const a = user.inventory.find(i => i.id === user.equippedArmor); if(a) pDef += a.power;

        let log = [`--- БОЙ: ВЫ vs ${loc.mob} ---`];
        let action = payload || 'attack';

        let dmgDealt = action === 'heavy' ? Math.max(1, Math.floor(pDmg * 1.5) - loc.def + rand(-2, 5)) : Math.max(1, pDmg - loc.def + rand(-3, 3));
        if(action === 'defend') { pDef += 10; log.push("Вы встали в защиту."); } else { mob.hp -= dmgDealt; log.push(`Вы ударили на <span style='color:green'>${dmgDealt}</span>. (Моб: ${Math.max(0,mob.hp)}/${mob.maxHp})`); }
        if(action === 'defend') pDef -= 10;

        if (mob.hp <= 0) {
            log.push(`<span style='color:gold'>ПОБЕДА! +${loc.xp} XP, +${loc.gold} 💰</span>`);
            user.xp += loc.xp; user.gold += loc.gold;
            for (let l of loc.loot) { if (Math.random() < l.c) { let it = {id: db.nextId++, name: l.n, type: l.t, power: l.p}; user.inventory.push(it); log.push(`Дроп: <b>${l.n}</b> (+${l.p})`); }}
            if (user.xp >= user.level * 150) { user.level++; user.xp -= (user.level-1)*150; user.maxHp += 20; user.baseDmg += 2; user.hp = user.maxHp; log.push("<span style='color:gold'>LEVEL UP!</span>"); }
        } else {
            let mDmg = Math.max(1, loc.dmg - pDef + rand(-3, 3));
            if (action === 'defend') mDmg = Math.floor(mDmg * 0.5);
            user.hp -= mDmg; log.push(`${loc.mob} бьет вас на <span style='color:red'>${mDmg}</span>. (Вы: ${Math.max(0,user.hp)}/${user.maxHp})`);
            if (user.hp <= 0) { user.hp = 1; let lost = Math.floor(user.gold * 0.15); user.gold -= lost; log.push(`<span style='color:red'>💀 ПОГИБЛИ! Потеряно ${lost}💰.</span>`); }
        }
        return res.json({ log: log.join('<br>'), user: safe(user) });
    }

    if (type === 'shop') {
        const items = [{name:"Малое зелье",type:"potion",heal:50,price:20}, {name:"Большое зелье",type:"potion",heal:150,price:50}];
        const it = items[target]; if(!it || user.gold < it.price) return res.json({ log: "<span style='color:red'>Мало золота</span>", user: safe(user) });
        user.gold -= it.price; user.inventory.push({id: db.nextId++, ...it});
        return res.json({ log: `Куплено ${it.name}`, user: safe(user) });
    }

    if (type === 'use') {
        const idx = user.inventory.findIndex(i => i.id === target && i.type === 'potion');
        if(idx === -1) return res.json({ log: "<span style='color:red'>Нет зелья</span>", user: safe(user) });
        const pot = user.inventory.splice(idx, 1)[0]; user.hp = Math.min(user.maxHp, user.hp + pot.heal);
        return res.json({ log: `Исцелено на ${pot.heal} HP`, user: safe(user) });
    }

    if (type === 'equip') {
        const it = user.inventory.find(i => i.id === target);
        if(!it || (it.type !== 'weapon' && it.type !== 'armor')) return res.json({ log: "Ошибка", user: safe(user) });
        if(it.type === 'weapon') user.equippedWeapon = target; else user.equippedArmor = target;
        return res.json({ log: `Экипировано: ${it.name}`, user: safe(user) });
    }

    if (type === 'sell') {
        const idx = user.inventory.findIndex(i => i.id === target);
        if(idx === -1 || user.inventory[idx].type === 'potion') return res.json({ log: "Ошибка", user: safe(user) });
        if(user.equippedWeapon === target) user.equippedWeapon = null;
        if(user.equippedArmor === target) user.equippedArmor = null;
        const it = user.inventory.splice(idx, 1)[0];
        db.market.push({ id: Date.now(), seller: req.username, item: it, price: parseInt(payload) });
        return res.json({ log: "Выставлено на P2P рынок", user: safe(user), market: db.market });
    }

    if (type === 'buy') {
        const lot = db.market.find(m => m.id === target);
        if (!lot || lot.seller === req.username || user.gold < lot.price) return res.json({ log: "<span style='color:red'>Ошибка покупки</span>", user: safe(user) });
        user.gold -= lot.price; let fee = Math.floor(lot.price * 0.05); db.users[lot.seller].gold += (lot.price - fee);
        user.inventory.push(lot.item); db.market = db.market.filter(m => m.id !== target);
        return res.json({ log: `Куплено! Комиссия: ${fee}💰`, user: safe(user), market: db.market });
    }

    if (type === 'withdraw') {
        const email = payload.email; const amount = parseInt(payload.amount);
        if (user.gold < amount || amount < 1000) return res.json({ log: "<span style='color:red'>Мало золота (мин 1000)</span>", user: safe(user) });
        let fee = Math.floor(amount * 0.10); let usdt = ((amount - fee) / EX_RATE).toFixed(2);
        user.gold -= amount; 
        return res.json({ log: `<span style='color:green'>Успешно выведено ${usdt} USDT на ${email}!</span>`, user: safe(user) });
    }
});

app.post('/api/sync', authMiddleware, (req, res) => {
    res.json({ user: safe(db.users[req.username]), market: db.market });
});

// ==========================================
// HTML СТРАНИЦЫ
// ==========================================

const PAGE_AUTH = `<!DOCTYPE html><html><head><title>Crypto MMO - Вход</title>
<style>
body{background:#0a0a0a;color:#fff;font-family:Arial;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.box{background:#151515;padding:30px;border:1px solid #333;border-radius:8px;width:350px}
h2{text-align:center;color:#f1c40f;margin-bottom:20px}
input,select{width:100%;padding:12px;margin-bottom:10px;background:#222;border:1px solid #333;color:white;box-sizing:border-box}
button{width:100%;padding:14px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:15px;margin-bottom:5px}
.b1{background:#f1c40f;color:#000}.b2{background:#333;color:#fff}
.err{color:#e74c3c;font-size:13px;text-align:center;margin-bottom:10px;display:none}
</style></head><body>
<div class="box">
<h2>REALM OF CRYPTO</h2>
<div id="err" class="err"></div>
<input type="text" id="user" placeholder="Логин">
<input type="password" id="pass" placeholder="Пароль">
<select id="cls"><option value="warrior">Воин (Живучий)</option><option value="mage">Маг (Убийственный)</option></select>
<button class="b1" onclick="reg()">СОЗДАТЬ ПЕРСОНАЖА</button>
<button class="b2" onclick="log()">ВХОД</button>
</div>
<script>
async function r(u,b={}){let res=await fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return res.json();}
function e(m){let el=document.getElementById('err');el.innerText=m;el.style.display='block';}
async function reg(){let d=await r('register',{username:document.getElementById('user').value,password:document.getElementById('pass').value,pClass:document.getElementById('cls').value});if(d.error)return e(d.error);if(d.token){localStorage.setItem('token',d.token);window.location.href='/game';}}
async function log(){let d=await r('login',{username:document.getElementById('user').value,password:document.getElementById('pass').value});if(d.error)return e(d.error);if(d.token){localStorage.setItem('token',d.token);window.location.href='/game';}}
</script></body></html>`;

const PAGE_GAME = `<!DOCTYPE html><html><head><title>Crypto MMO - Игра</title>
<style>
:root{--bg:#0a0a0a;--p:#151515;--b:#2a2a2a;--g:#f1c40f;--r:#c0392b;--bl:#2980b9;--gr:#27ae60}*{box-sizing:border-box;margin:0}body{background:var(--bg);color:#ddd;font-family:Arial;display:flex;justify-content:center;padding:10px}
.app{max-width:1100px;width:100%;display:grid;grid-template-columns:280px 1fr;gap:15px}
.p{background:var(--p);border:1px solid var(--b);padding:15px;border-radius:8px}
h2{color:var(--g);font-size:13px;text-transform:uppercase;margin-bottom:10px;border-bottom:1px solid var(--b);padding-bottom:5px}
.sb{display:flex;flex-direction:column;gap:10px}
.cn{font-size:18px;font-weight:bold;color:white}.cc{font-size:12px;color:#888;margin-bottom:15px}
.sr{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
.bar{height:8px;background:#000;border-radius:4px;margin-bottom:10px}.bf{height:100%;transition:width 0.3s}
.bh{background:var(--r)}.bx{background:var(--bl)}
.sl{font-size:13px;color:#aaa}.sl span{color:white}
.eb{background:#000;border:1px dashed #333;padding:10px;margin-top:5px;font-size:13px;color:#666;min-height:40px}
.gd{font-size:24px;color:var(--g);text-align:center;margin:10px 0}
.mn{display:flex;flex-direction:column;gap:10px}
.lb{height:250px;overflow-y:auto;background:#000;padding:15px;border-radius:8px;font-size:13px;line-height:1.6;border:1px solid var(--b)}
.ct{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cg{display:flex;gap:5px}.cg button{flex:1;padding:10px;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;color:white}
.bl{background:#2c3e50}.ba{background:#7f8c8d}.bb{background:var(--bl)}
.tabs{display:flex;gap:5px;margin-bottom:10px}.tab{padding:8px 15px;background:#222;cursor:pointer;border-radius:4px 4px 0 0;font-size:12px}
.tab.a{background:var(--p);border:1px solid var(--b);border-bottom:none;color:var(--g)}
.tc{display:none}.tc.a{display:block}
.ig{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cd{background:#1a1a1a;border:1px solid #333;padding:10px;border-radius:5px;font-size:12px}
.cd h4{color:white;margin-bottom:5px}.cd small{color:#888}.ca{margin-top:8px;display:flex;gap:5px}
.bs{padding:4px 8px;font-size:11px;border:none;border-radius:3px;cursor:pointer;color:white}
.bg{background:var(--gr)}.br{background:var(--r)}.bbl{background:var(--bl)}
.wf{display:flex;gap:5px;margin-top:10px}.wf input{flex:1;padding:8px;background:#000;border:1px solid #333;color:white;font-size:12px}
.lo{position:absolute;top:20px;right:20px;color:#666;text-decoration:none}.lo:hover{color:white}
</style></head><body>
<a href="/logout" class="lo">[Выйти]</a>
<div class="app">
<div class="sb">
<div class="p"><div class="cn" id="uN"></div><div class="cc" id="uC"></div>
<div class="sr"><span>❤️ HP</span><span id="hpT"></span></div><div class="bar"><div class="bf bh" id="hpB"></div></div>
<div class="sr"><span>⭐ XP</span><span id="xpT"></span></div><div class="bar"><div class="bf bx" id="xpB"></div></div>
<div class="gd">💰 <span id="uG"></span></div>
<div class="sl">Урон: <span id="sD"></span> | Защита: <span id="sDf"></span> | Ур: <span id="sL"></span></div>
</div>
<div class="p"><h2>Экипировка</h2><div class="eb" id="eW">⚔️ Пусто</div><div class="eb" id="eA">🛡️ Пусто</div></div>
<div class="p"><h2>Финансы</h2>
<div class="wf"><input type="email" id="fpE" placeholder="FaucetPay Email"></div>
<div class="wf"><input type="number" id="fpA" placeholder="Сумма 💰" min="1000"><button class="bs bg" onclick="wd()">Вывод USDT</button></div>
</div></div>
<div class="mn">
<div class="lb" id="lg">Загрузка...</div>
<div class="ct">
<div class="cg"><button class="bl" onclick="sl('forest')">🌲 Лес</button><button class="bl" onclick="sl('dungeon')">💀 Пещера</button></div>
<div class="cg"><button class="ba" onclick="ft('attack')">⚔️ Атака</button><button class="ba" onclick="ft('heavy')">🔥 Тяжелый</button><button class="ba" onclick="ft('defend')">🛡️ Защита</button><button class="bb" onclick="sh()">🧪 Магазин</button></div>
</div>
<div class="p">
<div class="tabs"><div class="tab a" onclick="st('inv',this)">🎒 Инвентарь</div><div class="tab" onclick="st('mkt',this)">🏪 Рынок</div></div>
<div id="t-inv" class="tc a"><div class="ig" id="iL"></div></div>
<div id="t-mkt" class="tc"><div class="ig" id="mL"></div></div>
</div></div></div>
<script>
let tk=localStorage.getItem('token');let loc='forest';
async function r(u,b={}){let res=await fetch('/api/'+u,{method:'POST',headers:{'Content-Type':'application/json','Authorization':tk},body:JSON.stringify(b)});if(res.status===401){window.location.href='/auth';return null;}return res.json();}
function a(h){let l=document.getElementById('lg');l.innerHTML+=h+'<br>';l.scrollTop=l.scrollHeight;}
function st(t,el){document.querySelectorAll('.tab').forEach(e=>e.classList.remove('a'));document.querySelectorAll('.tc').forEach(e=>e.classList.remove('a'));el.classList.add('a');document.getElementById('t-'+t).classList.add('a');}
function sl(l){loc=l;a('Локация изменена.');}
async function ft(act){a('<i>Действие...</i>');let d=await r('action',{type:'fight',target:loc,payload:act});if(d)up(d.user);}
async function sh(){let p=prompt("1. Малое зелье (20💰)\\n2. Большое зелье (50💰)");if(!p)return;let d=await r('action',{type:'shop',target:parseInt(p)-1});if(d)up(d.user);}
async function use(id){let d=await r('action',{type:'use',target:id});if(d){a(d.log);up(d.user);}}
async function eq(id){let d=await r('action',{type:'equip',target:id});if(d){a(d.log);up(d.user);}}
async function sel(id){let p=prompt("Цена в 💰:");if(!p)return;let d=await r('action',{type:'sell',target:id,payload:p});if(d){a(d.log);up(d.user);rm(d.market);}}
async function buy(id){let d=await r('action',{type:'buy',target:id});if(d){a(d.log);up(d.user);rm(d.market);}}
async function wd(){let d=await r('action',{type:'withdraw',payload:{email:document.getElementById('fpE').value,amount:document.getElementById('fpA').value}});if(d){a(d.log);up(d.user);}}
function up(u){
if(!u)return;
document.getElementById('uN').innerText=u.username;document.getElementById('uC').innerText=u.class==='mage'?'Маг':'Воин';
document.getElementById('uG').innerText=u.gold;document.getElementById('sL').innerText=u.level;
let dm=u.baseDmg,df=u.baseDef,wn="Пусто",an="Пусто";
if(u.equippedWeapon){let w=u.inventory.find(i=>i.id===u.equippedWeapon);if(w){dm+=w.power;wn=w.name+' (+'+w.power+')';}}
if(u.equippedArmor){let ar=u.inventory.find(i=>i.id===u.equippedArmor);if(ar){df+=ar.power;an=ar.name+' (+'+ar.power+')';}}
document.getElementById('sD').innerText=dm;document.getElementById('sDf').innerText=df;
document.getElementById('eW').innerText='⚔️ '+wn;document.getElementById('eA').innerText='🛡️ '+an;
document.getElementById('hpT').innerText=u.hp+'/'+u.maxHp;document.getElementById('hpB').style.width=(u.hp/u.maxHp)*100+'%';
let xn=u.level*150;document.getElementById('xpT').innerText=u.xp+'/'+xn;document.getElementById('xpB').style.width=(u.xp/xn)*100+'%';
ri(u);
}
function ri(u){let el=document.getElementById('iL');if(!u.inventory.length){el.innerHTML='<div style="color:#666;grid-column:span 2;">Пусто</div>';return;}
el.innerHTML=u.inventory.map(i=>{let s=i.type==='weapon'?'Урон: +'+i.power:i.type==='armor'?'Защита: +'+i.power:'Лечение: +'+i.heal;let b=i.type==='potion'?'<button class="bs bg" onclick="use('+i.id+')">Пить</button>':'<button class="bs bbl" onclick="eq('+i.id+')">Надеть</button> <button class="bs br" onclick="sel('+i.id+')">P2P</button>';return '<div class="cd"><h4>'+(i.type==='potion'?'🧪':'⚔️')+i.name+'</h4><small>'+s+'</small><div class="ca">'+b+'</div></div>';}).join('');}
function rm(m){let el=document.getElementById('mL');if(!m.length){el.innerHTML='<div style="color:#666;grid-column:span 2;">Пусто</div>';return;}
el.innerHTML=m.map(i=>{let s=i.item.type==='weapon'?'Урон: +'+i.item.power:'Защита: +'+i.item.power;return '<div class="cd"><h4>⚔️ '+i.item.name+'</h4><small>'+s+'<br>Продавец: '+i.seller+'</small><div style="color:var(--g);font-weight:bold;margin:5px 0;">'+i.price+' 💰</div><div class="ca"><button class="bs bg" onclick="buy('+i.id+')">Купить</button></div></div>';}).join('');}
async function init(){let d=await r('sync');if(d){up(d.user);rm(d.market);}else{window.location.href='/auth';}}
init();
</script></body></html>`;

// ==========================================
// МАРШРУТИЗАЦИЯ
// ==========================================

app.get('/auth', (req, res) => res.send(PAGE_AUTH));
app.get('/game', (req, res) => res.send(PAGE_GAME));
app.get('/logout', (req, res) => res.send(`<!DOCTYPE html><html><head><script>localStorage.removeItem('token');window.location.href='/auth';</script></head></html>`));
app.get('/', (req, res) => res.redirect('/auth'));

export default app;
