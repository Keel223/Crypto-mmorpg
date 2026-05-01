// ВСТАВЬТЕ СЮДА ССЫЛКУ НА ВАШ ВЕРСЕЛ СЕРВЕР!
const API_URL = 'https://crypto-mmorpg.vercel.app/api/game'; 
let currentUser = null;

const RES_NAMES = { wood: '🪵Дерево', stone: '🪨Камень', iron: '⛏️Железо', food: '🌾Еда', mana: '🔮Мана' };
const BUILDING_META = {
    townhall:   { name: '🏛️ Ратуша',       baseCost: { wood: 500, stone: 500, iron: 200 }, baseHp: 100, req: 0 },
    woodcutter: { name: '🪵 Лесопилка',     baseCost: { wood: 150, stone: 50 },             baseHp: 50,  req: 1 },
    mine:       { name: '⛏️ Шахта',         baseCost: { wood: 150, stone: 50, iron: 20 },    baseHp: 60,  req: 1 },
    farm:       { name: '🌾 Ферма',         baseCost: { wood: 150, stone: 50 },              baseHp: 40,  req: 1 },
    barrack:    { name: '⚔️ Казарма',       baseCost: { wood: 300, stone: 300, iron: 100 },  baseHp: 80,  req: 3 },
    archery:    { name: '🏹 Стрельбище',    baseCost: { wood: 300, stone: 200, iron: 200 },  baseHp: 70,  req: 4 },
    stable:     { name: '🐎 Конюшня',       baseCost: { wood: 400, stone: 300, iron: 200 },  baseHp: 90,  req: 5 },
    tower:      { name: '🔮 Башня Мага',    baseCost: { wood: 500, stone: 400, iron: 300 },  baseHp: 150, req: 7 },
    forge:      { name: '🔨 Кузница',       baseCost: { wood: 600, stone: 600, iron: 400 },  baseHp: 120, req: 4 }
};

async function apiCall(data) { 
    try {
        const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); 
        return await res.json(); 
    } catch(e) {
        console.error("API Error:", e);
        alert("Сервер недоступен! Проверьте ссылку API_URL в script.js");
        return { success: false, error: "Network error" };
    }
}

async function login() { 
    const u = document.getElementById('username-input').value.trim(); 
    const p = document.getElementById('password-input').value; 
    if(!u || !p) return alert("Введите логин и пароль!");
    
    const data = await apiCall({ action: 'login', username: u, password: p }); 
    
    if (data.success) { 
        currentUser = data.user; 
        document.getElementById('login-screen').classList.add('hidden'); 
        document.getElementById('game-screen').classList.remove('hidden'); 
        document.getElementById('user-name').innerText = currentUser.username; 
        updateUI(); 
        if(data.map) renderMap(data.map); 
        loadMarket(); 
        if(data.castleOwner) document.getElementById('castle-owner').innerText = data.castleOwner; 
        startAutoSync(); 
        startTimers(); 
    } else { 
        alert(data.error); 
    } 
}

async function register() { 
    const u = document.getElementById('username-input').value.trim(); 
    const p = document.getElementById('password-input').value; 
    if(!u || !p) return alert("Введите логин и пароль!");
    const data = await apiCall({ action: 'register', username: u, password: p }); 
    if (data.success) alert(data.message); 
    else alert(data.error); 
}

function startAutoSync() {
    setInterval(() => { 
        if (!currentUser) return; 
        let b = currentUser.boosts.gather || 1; 
        if(currentUser.hero==='miner') b *= 1.5; 
        b *= (1 + (currentUser.rings.gather * 0.05)); 
        currentUser.resources.wood += currentUser.buildings.woodcutter * 2 * b;
        currentUser.resources.iron += currentUser.buildings.mine * 1 * b;
        currentUser.resources.stone += currentUser.buildings.mine * 1 * b;
        currentUser.resources.food += currentUser.buildings.farm * 5 * b;
        currentUser.resources.mana += currentUser.buildings.tower * 0.5 * b;
        updateResourceDisplay(); 
    }, 1000);

    setInterval(async () => { 
        if(!currentUser) return;
        const data = await apiCall({ action: 'sync', username: currentUser.username }); 
        if (data.success) { 
            currentUser = data.user; 
            updateUI(); 
            if(data.map) renderMap(data.map); 
            if(data.castleOwner) document.getElementById('castle-owner').innerText = data.castleOwner; 
        } 
    }, 15000);
}

function startTimers() { 
    setInterval(() => { 
        if (!currentUser) return; 
        const now = Date.now(); 
        if (currentUser.construction) { 
            document.getElementById('con-bar').style.display = 'block'; 
            const s = Math.max(0, Math.ceil((currentUser.construction.finishTime - now) / 1000)); 
            document.getElementById('con-text').innerText = `Строится ${BUILDING_META[currentUser.construction.building]?.name} (${s}с)`; 
        } else document.getElementById('con-bar').style.display = 'none'; 
        
        if (currentUser.expedition) { 
            document.getElementById('exp-bar').style.display = 'block'; 
            const s = Math.max(0, Math.ceil((currentUser.expedition.finishTime - now) / 1000)); 
            document.getElementById('exp-text').innerText = `🗺️ Руины: ${s}с`; 
        } else document.getElementById('exp-bar').style.display = 'none'; 
    }, 1000); 
}

function switchTab(tabId) { 
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); 
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active')); 
    document.getElementById(`tab-${tabId}`).classList.add('active'); 
    event.target.classList.add('active'); 
}

async function upgrade(b) { const d = await apiCall({action:'upgrade',username:currentUser.username,building:b}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function repair(b) { const d = await apiCall({action:'repair',username:currentUser.username,building:b}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function recruit(u, a) { const d = await apiCall({action:'recruit',username:currentUser.username,unitType:u,amount:a}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function sendExpedition() { const d=await apiCall({action:'sendExpedition',username:currentUser.username}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function raid() { const t = document.getElementById('raid-target').value.trim(); const d = await apiCall({action:'raid',username:currentUser.username,targetUser:t}); if(d.success) { currentUser=d.user; document.getElementById('raid-log').innerHTML=`<span style="color:green">Победа!</span>`; updateUI(); } else { document.getElementById('raid-log').innerHTML=`<span style="color:red">${d.error}</span>`; if(d.user){currentUser=d.user;updateUI();} } }
async function buyHero(h) { const d=await apiCall({action:'buyHero',username:currentUser.username,hero:h}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function buyShield() { const d=await apiCall({action:'buyShield',username:currentUser.username}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function upgradeArmy() { const d=await apiCall({action:'upgradeArmy',username:currentUser.username}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function alchemy(t) { const d=await apiCall({action:'alchemy',username:currentUser.username,type:t}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function siegeCastle() { const d=await apiCall({action:'siegeCastle',username:currentUser.username}); if(d.success){currentUser=d.user;updateUI(); if(d.castleOwner) document.getElementById('castle-owner').innerText = d.castleOwner;}else alert(d.error); }
async function blackMarket(t) { const d=await apiCall({action:'blackMarket',username:currentUser.username,type:t}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function buyRing(t) { const d=await apiCall({action:'buyRing',username:currentUser.username,type:t}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function triggerChaos() { if(confirm('Запустить Вихрь Хаоса для ВСЕХ на 1 час за 500 GRC?')){ const d=await apiCall({action:'triggerChaos',username:currentUser.username}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error);} }
async function getLeaderboard() { const d=await apiCall({action:'getLeaderboard',username:currentUser.username}); if(d.success){ let html=''; d.leaderboard.forEach((p,i)=>html+=`<li>${i+1}. ${p.username} - ${p.glory} Славы</li>`); document.getElementById('leaderboard-list').innerHTML=html; } }
async function capturePost(id) { const d=await apiCall({action:'capturePost',username:currentUser.username,postId:id}); if(d.success){currentUser=d.user;if(d.map)renderMap(d.map);updateUI();}else alert(d.error); }

async function placeSellOrder() { const r=document.getElementById('sell-resource').value, a=parseInt(document.getElementById('sell-amount').value), p=parseFloat(document.getElementById('sell-price').value); const d=await apiCall({action:'sell',username:currentUser.username,resource:r,amount:a,pricePerUnit:p}); if(d.success){currentUser=d.user;updateUI();loadMarket();}else alert(d.error); }
async function buyOrder(id) { const d=await apiCall({action:'buy',username:currentUser.username,orderId:id}); if(d.success){currentUser=d.user;updateUI();loadMarket();}else alert(d.error); }
async function loadMarket() { const d=await apiCall({action:'getMarket', username: currentUser.username}); const l=document.getElementById('market-orders');l.innerHTML=''; if(d.orders && d.orders.length>0){ d.orders.forEach(o=>{const li=document.createElement('li');li.innerHTML=`<span>[${o.resource}] ${o.amount} шт</span><button class="buy-btn" onclick="buyOrder(${o.id})">Купить ${o.total.toFixed(4)} GRC</button>`;l.appendChild(li);}); } else { l.innerHTML = '<li>Пусто</li>'; } }

async function depositFaucetPay() { if(!currentUser) return alert('Сначала войдите!'); const d = await apiCall({action:'getDepositAddress', username: currentUser.username}); if(d.success) { document.getElementById('deposit-address-box').style.display = 'block'; document.getElementById('deposit-address-text').innerText = d.address; } else { alert('Ошибка: ' + d.error); } }
async function withdrawFunds() { const w=document.getElementById('fp-wallet').value, a=parseFloat(document.getElementById('fp-amount').value); const d=await apiCall({action:'withdraw',username:currentUser.username,wallet:w,grcAmount:a}); if(d.success){ document.getElementById('withdraw-log').innerHTML=`<span style="color:green">Успех! ${d.dogeSent} DOGE</span>`; currentUser=d.user; updateUI(); } else document.getElementById('withdraw-log').innerHTML=`<span style="color:red">${d.error}</span>`; }

function renderMap(map) { const c=document.getElementById('map-container');c.innerHTML=''; if(!map)return; map.forEach(p=>{const div=document.createElement('div');div.className=`map-post ${p.owner===currentUser.username?'owned':''}`;div.innerHTML=`<h4>${p.name}</h4><p>+${(p.bonus*100).toFixed(0)}%</p><p>${p.owner||'Свободно'}</p>`;if(p.owner!==currentUser.username)div.onclick=()=>capturePost(p.id);c.appendChild(div);}); }

function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-balance').innerText=currentUser.balance.toFixed(4);
    document.getElementById('army-warriors').innerText=currentUser.army.warriors;
    document.getElementById('army-archers').innerText=currentUser.army.archers;
    document.getElementById('army-cavalry').innerText=currentUser.army.cavalry;
    document.getElementById('hero-name').innerText = currentUser.hero ? (currentUser.hero === 'miner' ? '🧙 Шахтер (+50% ресов)' : '⚔️ Генерал (+20% атаки)') : 'Нет';
    document.getElementById('forge-lvl').innerText = currentUser.forge_lvl || 0;
    document.getElementById('shield-status').innerText = currentUser.shield > Date.now() ? '🛡️ Активен' : '❌ Нет';
    document.getElementById('rings-gather').innerText = currentUser.rings.gather;
    document.getElementById('rings-attack').innerText = currentUser.rings.attack;
    updateResourceDisplay(); 
    renderBuildings();
}

function renderBuildings() {
    const grid = document.getElementById('buildings-grid'); grid.innerHTML='';
    for (let bId in BUILDING_META) {
        const bMeta = BUILDING_META[bId]; const lvl = currentUser.buildings[bId];
        const isLocked = (lvl === 0) && (currentUser.buildings.townhall < bMeta.req);
        const div = document.createElement('div'); div.className = 'panel';
        if (isLocked) { div.style.opacity = '0.5'; div.style.border = '1px dashed #555'; div.innerHTML = `<h3>🔒 ???</h3><div style="color:#dc3545; font-size:14px; margin-top:10px;">Ратуша ${bMeta.req} ур.</div>`; } 
        else {
            const maxHp = bMeta.baseHp * lvl; const currentHp = currentUser.building_hp[bId] || (lvl > 0 ? maxHp : 0); const hpPercent = lvl > 0 ? (currentHp / maxHp) * 100 : 0; const isBroken = lvl > 0 && hpPercent < 100;
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
