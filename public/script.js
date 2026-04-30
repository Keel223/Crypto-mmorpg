const API_URL = '/api/game';
let currentUser = null;
let currentMap = [];

// Словарь названий для ресурсов
const RES_NAMES = { wood: '🪵Дерево', stone: '🪨Камень', iron: '⛏️Железо', food: '🌾Еда', mana: '🔮Мана' };

// Базовая стоимость (дублируем с бэкенда для отображения на клиенте)
const BUILDING_META = {
    townhall: { name: '🏛️ Ратуша', baseCost: { wood: 1000, stone: 1000, iron: 500 } },
    woodcutter: { name: '🪵 Лесопилка', baseCost: { wood: 200, stone: 100 } },
    mine: { name: '⛏️ Шахта', baseCost: { wood: 100, stone: 200, iron: 50 } },
    farm: { name: '🌾 Ферма', baseCost: { wood: 150, stone: 50 } },
    barrack: { name: '⚔️ Казарма', baseCost: { wood: 300, stone: 500, iron: 300 } },
    archery: { name: '🏹 Стрельбище', baseCost: { wood: 400, stone: 200, iron: 400 } },
    stable: { name: '🐎 Конюшня', baseCost: { wood: 500, stone: 300, iron: 600 } },
    tower: { name: '🔮 Башня Мага', baseCost: { wood: 1000, stone: 800, iron: 500, mana: 100 } }
};

async function apiCall(data) {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return await res.json();
}

// АВТОРИЗАЦИЯ И РЕГИСТРАЦИЯ
async function login() {
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    if (!username || !password) return alert('Заполните поля!');
    
    const data = await apiCall({ action: 'login', username, password });
    if (data.success) {
        currentUser = { name: username, ...data.user };
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('user-name').innerText = username;
        updateUI();
        renderMap(data.map);
        renderChat(data.chat);
        loadMarket();
        startAutoSync();
    } else alert(data.error);
}

async function register() {
    const username = document.getElementById('username-input').value.trim();
    const password = document.getElementById('password-input').value;
    if (!username || !password) return alert('Заполните поля!');
    
    const data = await apiCall({ action: 'register', username, password });
    if (data.success) alert(data.message);
    else alert(data.error);
}

function startAutoSync() {
    setInterval(() => {
        if (!currentUser) return;
        let b = currentUser.boosts.gather || 1;
        currentUser.resources.wood += currentUser.buildings.woodcutter * 2 * b;
        currentUser.resources.iron += currentUser.buildings.mine * 1 * b;
        currentUser.resources.food += currentUser.buildings.farm * 5 * b;
        currentUser.resources.mana += currentUser.buildings.tower * 0.5 * b;
        updateResourceDisplay();
    }, 1000);

    setInterval(async () => {
        const data = await apiCall({ action: 'sync', username: currentUser.name });
        if (data.success) { currentUser = { name: currentUser.name, ...data.user }; updateUI(); renderMap(data.map); }
    }, 15000);
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    event.target.classList.add('active');
}

// ДЕЙСТВИЯ
async function upgrade(building) {
    const data = await apiCall({ action: 'upgrade', username: currentUser.name, building });
    if (data.success) {
        currentUser = { name: currentUser.name, ...data.user };
        updateUI(data.nextLevelCosts);
    } else alert(data.error);
}

async function recruit(u, a) { const d = await apiCall({action:'recruit',username:currentUser.name,unitType:u,amount:a}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function craft(i) { const d = await apiCall({action:'craft',username:currentUser.name,item:i}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function buyPremium(i) { const d = await apiCall({action:'buyPremium',username:currentUser.name,item:i}); if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();}else alert(d.error); }
async function createClan() { const c=document.getElementById('clan-name-input').value; const d = await apiCall({action:'createClan',username:currentUser.name,clanName:c}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }

async function raid() {
    const t = document.getElementById('raid-target').value.trim();
    const d = await apiCall({action:'raid',username:currentUser.name,targetUser:t});
    if(d.success) { currentUser={name:currentUser.name,...d.user}; document.getElementById('raid-log').innerHTML=`<span style="color:green">Успех! Украли!</span>`; updateUI(); }
    else { document.getElementById('raid-log').innerHTML=`<span style="color:red">Провал: ${d.error}</span>`; }
}

async function capturePost(id) {
    const d = await apiCall({action:'capturePost',username:currentUser.name,postId:id});
    if(d.success){ currentUser={name:currentUser.name,...d.user}; renderMap(d.map); updateUI(); }
    else alert(d.error);
}

async function placeSellOrder() {
    const r = document.getElementById('sell-resource').value, a = parseInt(document.getElementById('sell-amount').value), p = parseFloat(document.getElementById('sell-price').value);
    const d = await apiCall({action:'sell',username:currentUser.name,resource:r,amount:a,price:p});
    if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();loadMarket();}else alert(d.error);
}
async function buyOrder(id) {
    const d = await apiCall({action:'buy',username:currentUser.name,orderId:id});
    if(d.success){currentUser={name:currentUser.name,...d.user};updateUI();loadMarket();}else alert(d.error);
}
async function loadMarket() {
    const d = await apiCall({action:'getMarket'});
    const l = document.getElementById('market-orders'); l.innerHTML='';
    d.orders.forEach(o => { const li=document.createElement('li'); li.innerHTML=`<span>[${o.resource}] ${o.amount} за ${o.total} GRC</span><button class="buy-btn" onclick="buyOrder(${o.id})">Купить</button>`; l.appendChild(li); });
}
async function withdrawFunds() {
    const w=document.getElementById('fp-wallet').value, a=parseFloat(document.getElementById('fp-amount').value);
    const d=await apiCall({action:'withdraw',username:currentUser.name,wallet:w,withdrawAmount:a});
    if(d.success){alert('Успех!');currentUser.balance=d.newBalance;updateUI();}else alert('Ошибка: '+d.error);
}
async function sendMessage() {
    const m=document.getElementById('chat-input').value; if(!m)return;
    document.getElementById('chat-input').value='';
    const d=await apiCall({action:'sendMessage',username:currentUser.name,message:m});
    if(d.success) renderChat(d.chat);
}

// РЕНДЕРЫ ИНТЕРФЕЙСА
function renderChat(chat) {
    const b=document.getElementById('chat-box'); b.innerHTML='';
    chat.forEach(c => b.innerHTML+=`<div class="chat-msg"><span class="chat-author">${c.user}:</span> ${c.text}</div>`);
    b.scrollTop = b.scrollHeight;
}

function renderMap(map) {
    currentMap = map;
    const c=document.getElementById('map-container'); c.innerHTML='';
    map.forEach(p => {
        const div=document.createElement('div');
        div.className=`map-post ${p.owner===currentUser.name?'owned':''}`;
        div.innerHTML=`<h4>${p.name}</h4><p>Бонус: +${(p.bonus*100).toFixed(0)}%</p><p style="font-size:12px">${p.owner||'Свободно'}</p>`;
        if(p.owner!==currentUser.name) div.onclick=()=>capturePost(p.id);
        c.appendChild(div);
    });
}

function updateUI(nextLevelCostsOverride) {
    if(!currentUser) return;
    document.getElementById('user-balance').innerText=currentUser.balance.toFixed(2);
    document.getElementById('user-clan').innerText=currentUser.clan||'Нет';
    document.getElementById('army-warriors').innerText=currentUser.army.warriors;
    document.getElementById('army-archers').innerText=currentUser.army.archers;
    document.getElementById('army-cavalry').innerText=currentUser.army.cavalry;
    updateResourceDisplay();
    renderBuildings(nextLevelCostsOverride);
}

function renderBuildings(nextCosts) {
    const grid = document.getElementById('buildings-grid');
    grid.innerHTML = '';
    
    for (let bId in BUILDING_META) {
        const bMeta = BUILDING_META[bId];
        const lvl = currentUser.buildings[bId];
        
        // Считаем стоимость следующего уровня
        let costString = "Макс";
        let nextCostObj = {};
        if (lvl < 20) { // Лимит 20 уровней
            if (nextCosts && nextCosts[bId]) {
                nextCostObj = nextCosts[bId]; // Берем с бэкенда после апгрейда
            } else {
                for(let r in bMeta.baseCost) {
                    nextCostObj[r] = Math.floor(bMeta.baseCost[r] * Math.pow(1.5, lvl));
                }
            }
            costString = Object.entries(nextCostObj).map(([r, v]) => `${RES_NAMES[r]}: ${v}`).join('<br>');
        }

        const div = document.createElement('div');
        div.className = 'panel';
        div.innerHTML = `
            <h3>${bMeta.name} (Ур. ${lvl})</h3>
            <div class="cost-display">${costString}</div>
            ${lvl < 20 ? `<button onclick="upgrade('${bId}')">Улучшить</button>` : '<button disabled>Макс</button>'}
        `;
        grid.appendChild(div);
    }
}

function updateResourceDisplay() {
    document.getElementById('res-wood').innerText=Math.floor(currentUser.resources.wood);
    document.getElementById('res-iron').innerText=Math.floor(currentUser.resources.iron);
    document.getElementById('res-food').innerText=Math.floor(currentUser.resources.food);
    document.getElementById('res-stone').innerText=Math.floor(currentUser.resources.stone);
    document.getElementById('res-mana').innerText=Math.floor(currentUser.resources.mana);
        }
