const API_URL = '/api/game';
let currentUser = null;
let syncIntervalId = null;
let timerIntervalId = null;

const RES_NAMES = { wood: '🪵Дерево', stone: '🪨Камень', iron: '⛏️Железо', food: '🌾Еда', mana: '🔮Мана' };
const BUILDING_META = {
    townhall:   { name: '🏛️ Ратуша',       baseCost: { wood: 500, stone: 500, iron: 200 }, baseHp: 100, req: 0 },
    woodcutter: { name: '🪵 Лесопилка',     baseCost: { wood: 150, stone: 50 },             baseHp: 50,  req: 1 },
    mine:       { name: '⛏️ Шахта (Железо + Камень)', baseCost: { wood: 150, stone: 50, iron: 20 }, baseHp: 60,  req: 1 },
    farm:       { name: '🌾 Ферма',         baseCost: { wood: 150, stone: 50 },              baseHp: 40,  req: 1 },
    barrack:    { name: '⚔️ Казарма',       baseCost: { wood: 300, stone: 300, iron: 100 },  baseHp: 80,  req: 3 },
    archery:    { name: '🏹 Стрельбище',    baseCost: { wood: 300, stone: 200, iron: 200 },  baseHp: 70,  req: 4 },
    stable:     { name: '🐎 Конюшня',       baseCost: { wood: 400, stone: 300, iron: 200 },  baseHp: 90,  req: 5 },
    tower:      { name: '🔮 Башня Мага',    baseCost: { wood: 500, stone: 400, iron: 300 },  baseHp: 150, req: 7 }
};

async function apiCall(data) {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return await res.json();
}

async function login() {
    const u = document.getElementById('username-input').value.trim();
    const p = document.getElementById('password-input').value;
    const data = await apiCall({ action: 'login', username: u, password: p });
    if (data.success) {
        currentUser = { name: u, ...data.user };
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('user-name').innerText = u;
        updateUI(); renderMap(data.map); loadMarket();
        startAutoSync(); startTimers();
    } else alert(data.error);
}

async function register() {
    const u = document.getElementById('username-input').value.trim();
    const p = document.getElementById('password-input').value;
    const data = await apiCall({ action: 'register', username: u, password: p });
    if (data.success) alert(data.message); else alert(data.error);
}

function startAutoSync() {
    if (syncIntervalId) clearInterval(syncIntervalId);
    setInterval(() => {
        if (!currentUser) return;
        let b = currentUser.boosts.gather || 1;
        currentUser.resources.wood += currentUser.buildings.woodcutter * 2 * b;
        currentUser.resources.iron += currentUser.buildings.mine * 1 * b;
        currentUser.resources.stone += currentUser.buildings.mine * 1 * b;
        currentUser.resources.food += currentUser.buildings.farm * 5 * b;
        currentUser.resources.mana += currentUser.buildings.tower * 0.5 * b;
        updateResourceDisplay();
    }, 1000);

    syncIntervalId = setInterval(async () => {
        const data = await apiCall({ action: 'sync', username: currentUser.name });
        if (data.success) { currentUser = { name: currentUser.name, ...data.user }; updateUI(); renderMap(data.map); }
    }, 15000);
}

function startTimers() {
    if (timerIntervalId) clearInterval(timerIntervalId);
    timerIntervalId = setInterval(() => {
        if (!currentUser) return;
        const now = Date.now();
        if (currentUser.construction) { document.getElementById('con-bar').style.display = 'block'; const s = Math.max(0, Math.ceil((currentUser.construction.finishTime - now) / 1000)); document.getElementById('con-text').innerText = `Строится ${BUILDING_META[currentUser.construction.building]?.name} (${s}с)`; } else document.getElementById('con-bar').style.display = 'none';
        if (currentUser.expedition) { document.getElementById('exp-bar').style.display = 'block'; const s = Math.max(0, Math.ceil((currentUser.expedition.finishTime - now) / 1000)); document.getElementById('exp-text').innerText = `🗺️ Руины вернутся через ${s}с`; } else document.getElementById('exp-bar').style.display = 'none';
    }, 1000);
}

function switchTab(tabId) { document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); document.getElementById(`tab-${tabId}`).classList.add('active'); event.target.classList.add('active'); }

async function upgrade(b) { const d = await apiCall({action:'upgrade',username:currentUser.name,building:b}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function repair(b) { const d = await apiCall({action:'repair',username:currentUser.name,building:b}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function recruit(u, a) { const d = await apiCall({action:'recruit',username:currentUser.name,unitType:u,amount:a}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function sendExpedition() { const d=await apiCall({action:'sendExpedition',username:currentUser.name}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function raid() { const t = document.getElementById('raid-target').value.trim(); const d = await apiCall({action:'raid',username:currentUser.name,targetUser:t}); if(d.success) { currentUser={name:currentUser.name,...d.user}; document.getElementById('raid-log').innerHTML=`<span style="color:green">Победа!</span>`; updateUI(); } else { document.getElementById('raid-log').innerHTML=`<span style="color:red">Провал: ${d.error}</span>`; if(d.user){currentUser={name:currentUser.name,...d.user};updateUI();} } }
async function findPvp() { const btn = event.target; btn.disabled = true; btn.innerText = 'Поиск...'; const d = await apiCall({action:'findPvp',username:currentUser.name}); btn.disabled = false; btn.innerText = 'Найти противника'; if(d.status === 'waiting') { document.getElementById('pvp-log').innerHTML = `<span style="color:yellow">Ищем...</span>`; } else if (d.status === 'finished') { currentUser = { name: currentUser.name, ...d.user }; if(d.success) { document.getElementById('pvp-log').innerHTML = `<span style="color:green">Победа над ${d.enemyName}!</span>`; } else { document.getElementById('pvp-log').innerHTML = `<span style="color:red">Поражение!</span>`; } updateUI(); } else alert(d.error); }

async function placeSellOrder() { const r=document.getElementById('sell-resource').value, a=parseInt(document.getElementById('sell-amount').value), p=parseFloat(document.getElementById('sell-price').value); const d=await apiCall({action:'sell',username:currentUser.name,resource:r,amount:a,pricePerUnit:p}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();loadMarket();}else alert(d.error); }
async function buyOrder(id) { const d=await apiCall({action:'buy',username:currentUser.name,orderId:id}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();loadMarket();}else alert(d.error); }
async function loadMarket() { const d=await apiCall({action:'getMarket'}); const l=document.getElementById('market-orders');l.innerHTML=''; d.orders.forEach(o=>{const li=document.createElement('li');li.innerHTML=`<span>[${o.resource}] ${o.amount} шт</span><button class="buy-btn" onclick="buyOrder(${o.id})">Купить за ${o.total.toFixed(8)} GRC</button>`;l.appendChild(li);}); }

// ИСПРАВЛЕННОЕ ПОПОЛНЕНИЕ FAUCETPAY
async function depositFaucetPay() {
    if(!currentUser) return alert('Сначала войдите в игру!');
    
    // ВАЖНО: Впишите email вашего аккаунта FaucetPay (без этого не откроется страница оплаты!)
    const FP_MERCHANT_EMAIL = 'ВАШ_EMAIL_ОТ_FAUCETPAY@gmail.com'; 
    const FP_CALLBACK_SECRET = 'MY_SUPER_SECRET_123'; // Точно такой же как в api/game.js
    
    const callbackUrl = window.location.origin + `/api/game?action=fp_callback&secret=${FP_CALLBACK_SECRET}&custom_username=${currentUser.name}`;
    
    const depositLink = `https://faucetpay.io/checkout?` + new URLSearchParams({
        merchant: FP_MERCHANT_EMAIL,
        api_key: '6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9',
        currency: 'DOGE',
        amount: 1, // Минималка 1 DOGE
        callback: callbackUrl,
        custom_username: currentUser.name
    }).toString();

    window.open(depositLink, '_blank');
}

async function withdrawFunds() { const w=document.getElementById('fp-wallet').value, a=parseFloat(document.getElementById('fp-amount').value); const d=await apiCall({action:'withdraw',username:currentUser.name,wallet:w,grcAmount:a}); if(d.success){ document.getElementById('withdraw-log').innerHTML=`<span style="color:green">Успех! Отправлено ${d.dogeSent} DOGE</span>`; currentUser={name:currentUser.name,...d.user}; updateUI(); } else document.getElementById('withdraw-log').innerHTML=`<span style="color:red">${d.error}</span>`; }

function renderMap(map) { const c=document.getElementById('map-container');c.innerHTML=''; map.forEach(p=>{const div=document.createElement('div');div.className=`map-post ${p.owner===currentUser.name?'owned':''}`;div.innerHTML=`<h4>${p.name}</h4><p>+${(p.bonus*100).toFixed(0)}%</p><p>${p.owner||'Свободно'}</p>`;if(p.owner!==currentUser.name)div.onclick=()=>capturePost(p.id);c.appendChild(div);}); }
async function capturePost(id) { const d=await apiCall({action:'capturePost',username:currentUser.name,postId:id}); if(d.success){currentUser={name:currentUser.name,...d.user};renderMap(d.map);updateUI();}else alert(d.error); }

function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-balance').innerText=currentUser.balance.toFixed(4);
    document.getElementById('army-warriors').innerText=currentUser.army.warriors;
    document.getElementById('army-archers').innerText=currentUser.army.archers;
    document.getElementById('army-cavalry').innerText=currentUser.army.cavalry;
    updateResourceDisplay(); renderBuildings();
}

function renderBuildings() {
    const grid = document.getElementById('buildings-grid'); grid.innerHTML='';
    for (let bId in BUILDING_META) {
        const bMeta = BUILDING_META[bId]; const lvl = currentUser.buildings[bId];
        const isLocked = (lvl === 0) && (currentUser.buildings.townhall < bMeta.req);
        const div = document.createElement('div'); div.className = 'panel';
        if (isLocked) { div.style.opacity = '0.5'; div.style.border = '1px dashed #555'; div.innerHTML = `<h3>🔒 ???</h3><div style="color:#dc3545; font-size:14px; margin-top:10px;">Требуется Ратуша ${bMeta.req} ур.</div>`; } 
        else {
            const maxHp = bMeta.baseHp * lvl; const currentHp = currentUser.buildingHp[bId] || (lvl > 0 ? maxHp : 0); const hpPercent = lvl > 0 ? (currentHp / maxHp) * 100 : 0; const isBroken = lvl > 0 && hpPercent < 100;
            let costString = "Макс"; let nextCostObj = {};
            if (lvl < 20) { for(let r in bMeta.baseCost) nextCostObj[r] = Math.floor(bMeta.baseCost[r] * Math.pow(1.5, lvl)); costString = Object.entries(nextCostObj).map(([r, v]) => `${RES_NAMES[r]}: ${v}`).join(' | '); }
            const isBuilding = currentUser.construction && currentUser.construction.building === bId;
            let hpBarHtml = lvl > 0 ? `<div class="hp-bar-container"><div class="hp-bar" style="width:${hpPercent}%; background:${hpPercent>50?'#28a745':'#dc3545'}"></div></div>` : '';
            div.innerHTML = `<h3>${bMeta.name} (Ур. ${lvl})</h3>${hpBarHtml}${isBroken ? `<button onclick="repair('${bId}')" class="btn-danger" style="margin-bottom:5px; font-size:12px;">🔧 Ремонт</button>` : ''}<div class="cost-display">${costString}</div>${lvl<20?`<button onclick="upgrade('${bId}')" ${isBuilding||isBroken?'disabled':''}>${isBuilding?'Строится...':'Улучшить'}</button>`:'<button disabled>Макс</button>'}`;
        }
        grid.appendChild(div);
    }
}

function updateResourceDisplay() {
    document.getElementById('res-wood').innerText=Math.floor(currentUser.resources.wood);
    document.getElementById('res-iron').innerText=Math.floor(currentUser.resources.iron);
    document.getElementById('res-stone').innerText=Math.floor(currentUser.resources.stone);
    document.getElementById('res-food').innerText=Math.floor(currentUser.resources.food);
    document.getElementById('res-mana').innerText=Math.floor(currentUser.resources.mana);
                                                                                                                                                     }
