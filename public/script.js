const API_URL = '/api/game';
let currentUser = null;

async function apiCall(data) {
    const res = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return await res.json();
}

async function login() {
    const username = document.getElementById('username-input').value.trim();
    if (!username) return alert('Введите ник!');
    const data = await apiCall({ action: 'login', username });
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
    }
}

function startAutoSync() {
    setInterval(() => {
        if (!currentUser) return;
        currentUser.resources.wood += currentUser.buildings.woodcutter * 2 * (currentUser.boosts.gather || 1);
        currentUser.resources.iron += currentUser.buildings.mine * 1 * (currentUser.boosts.gather || 1);
        currentUser.resources.food += currentUser.buildings.farm * 5 * (currentUser.boosts.gather || 1);
        currentUser.resources.mana += currentUser.buildings.tower * 0.5 * (currentUser.boosts.gather || 1);
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

// ИГРОВЫЕ ДЕЙСТВИЯ
async function upgrade(b) { const d = await apiCall({action:'upgrade',username:currentUser.name,building:b}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function recruit(u, a) { const d = await apiCall({action:'recruit',username:currentUser.name,unitType:u,amount:a}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function craft(i) { const d = await apiCall({action:'craft',username:currentUser.name,item:i}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function buyPremium(i) { const d = await apiCall({action:'buyPremium',username:currentUser.name,item:i}); if(d.success){currentUser=d.user;updateUI();}else alert(d.error); }
async function createClan() { 
    const c = document.getElementById('clan-name-input').value; 
    const d = await apiCall({action:'createClan',username:currentUser.name,clanName:c}); 
    if(d.success){currentUser=d.user;updateUI();}else alert(d.error); 
}

async function raid() {
    const t = document.getElementById('raid-target').value.trim();
    const d = await apiCall({action:'raid',username:currentUser.name,targetUser:t});
    if(d.success) { currentUser=d.user; document.getElementById('raid-log').innerHTML=`<span style="color:green">Успех! Украли ресурсы!</span>`; updateUI(); }
    else { document.getElementById('raid-log').innerHTML=`<span style="color:red">Провал: ${d.error}</span>`; }
}

async function capturePost(id) {
    const d = await apiCall({action:'capturePost',username:currentUser.name,postId:id});
    if(d.success){ currentUser=d.user; renderMap(d.map); updateUI(); }
    else alert(d.error);
}

// РЫНОК
async function placeSellOrder() {
    const r = document.getElementById('sell-resource').value, a = parseInt(document.getElementById('sell-amount').value), p = parseFloat(document.getElementById('sell-price').value);
    const d = await apiCall({action:'sell',username:currentUser.name,resource:r,amount:a,price:p});
    if(d.success){currentUser=d.user;updateUI();loadMarket();}else alert(d.error);
}
async function buyOrder(id) {
    const d = await apiCall({action:'buy',username:currentUser.name,orderId:id});
    if(d.success){currentUser=d.user;updateUI();loadMarket();}else alert(d.error);
}
async function loadMarket() {
    const d = await apiCall({action:'getMarket'});
    const l = document.getElementById('market-orders'); l.innerHTML='';
    d.orders.forEach(o => { const li=document.createElement('li'); li.innerHTML=`<span>[${o.resource}] ${o.amount} за ${o.total} GRC</span><button class="buy-btn" onclick="buyOrder(${o.id})">Купить</button>`; l.appendChild(li); });
}

// ВЫВОД
async function withdrawFunds() {
    const w=document.getElementById('fp-wallet').value, a=parseFloat(document.getElementById('fp-amount').value);
    const d=await apiCall({action:'withdraw',username:currentUser.name,wallet:w,withdrawAmount:a});
    if(d.success){alert('Успех!');currentUser.balance=d.newBalance;updateUI();}else alert('Ошибка: '+d.error);
}

// ЧАТ
async function sendMessage() {
    const m=document.getElementById('chat-input').value; if(!m)return;
    document.getElementById('chat-input').value='';
    const d=await apiCall({action:'sendMessage',username:currentUser.name,message:m});
    if(d.success) renderChat(d.chat);
}
function renderChat(chat) {
    const b=document.getElementById('chat-box'); b.innerHTML='';
    chat.forEach(c => b.innerHTML+=`<div class="chat-msg"><span class="chat-author">${c.user}:</span> ${c.text}</div>`);
    b.scrollTop = b.scrollHeight;
}

// РЕНДЕР КАРТЫ
function renderMap(map) {
    const c=document.getElementById('map-container'); c.innerHTML='';
    map.forEach(p => {
        const div=document.createElement('div');
        div.className=`map-post ${p.owner===currentUser.name?'owned':''}`;
        div.innerHTML=`<h4>${p.name}</h4><p>Бонус: +${(p.bonus*100).toFixed(0)}%</p><p style="font-size:12px">${p.owner||'Свободно'}</p>`;
        if(p.owner!==currentUser.name) div.onclick=()=>capturePost(p.id);
        c.appendChild(div);
    });
}

// ОБНОВЛЕНИЕ UI
function updateUI() {
    if(!currentUser) return;
    document.getElementById('user-balance').innerText=currentUser.balance.toFixed(2);
    document.getElementById('user-clan').innerText=currentUser.clan||'Нет';
    document.getElementById('b-townhall').innerText=currentUser.buildings.townhall;
    document.getElementById('b-woodcutter').innerText=currentUser.buildings.woodcutter;
    document.getElementById('b-mine').innerText=currentUser.buildings.mine;
    document.getElementById('b-farm').innerText=currentUser.buildings.farm;
    document.getElementById('b-barrack').innerText=currentUser.buildings.barrack;
    document.getElementById('b-archery').innerText=currentUser.buildings.archery;
    document.getElementById('b-stable').innerText=currentUser.buildings.stable;
    document.getElementById('b-tower').innerText=currentUser.buildings.tower;
    document.getElementById('army-warriors').innerText=currentUser.army.warriors;
    document.getElementById('army-archers').innerText=currentUser.army.archers;
    document.getElementById('army-cavalry').innerText=currentUser.army.cavalry;
    updateResourceDisplay();
}
function updateResourceDisplay() {
    document.getElementById('res-wood').innerText=Math.floor(currentUser.resources.wood);
    document.getElementById('res-iron').innerText=Math.floor(currentUser.resources.iron);
    document.getElementById('res-food').innerText=Math.floor(currentUser.resources.food);
    document.getElementById('res-stone').innerText=Math.floor(currentUser.resources.stone);
    document.getElementById('res-mana').innerText=Math.floor(currentUser.resources.mana);
    
    let b = currentUser.boosts.gather || 1;
    document.getElementById('inc-wood').innerText=(currentUser.buildings.woodcutter * 2 * b).toFixed(1);
    document.getElementById('inc-iron').innerText=(currentUser.buildings.mine * 1 * b).toFixed(1);
    document.getElementById('inc-food').innerText=(currentUser.buildings.farm * 5 * b).toFixed(1);
    document.getElementById('inc-mana').innerText=(currentUser.buildings.tower * 0.5 * b).toFixed(1);
        }
