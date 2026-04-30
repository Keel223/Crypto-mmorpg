const API_URL = '/api/game'; // Vercel сам направит это в api/game.js
let currentUser = null;

// --- АВТОРИЗАЦИЯ ---
async function login() {
    const username = document.getElementById('username-input').value.trim();
    if (!username) return alert('Введите ник!');

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username })
    });

    const data = await res.json();
    if (data.success) {
        currentUser = { name: username, ...data.user };
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('user-name').innerText = username;
        updateUI();
        loadMarket();
    }
}

// --- ИГРОВАЯ ЛОГИКА ---
async function gatherResources() {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gather', username: currentUser.name })
    });
    const data = await res.json();
    if (data.success) {
        currentUser.resources = data.resources;
        updateUI();
    }
}

async function placeSellOrder() {
    const resource = document.getElementById('sell-resource').value;
    const amount = parseInt(document.getElementById('sell-amount').value);
    const price = parseFloat(document.getElementById('sell-price').value);

    if (!amount || !price) return alert('Заполните количество и цену');

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sell', username: currentUser.name, resource, amount, price })
    });
    const data = await res.json();
    
    if (data.success) {
        currentUser.resources = data.resources;
        updateUI();
        loadMarket(); // Обновляем рынок
        document.getElementById('sell-amount').value = '';
        document.getElementById('sell-price').value = '';
    } else {
        alert(data.error);
    }
}

async function buyOrder(orderId) {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'buy', username: currentUser.name, orderId })
    });
    const data = await res.json();
    
    if (data.success) {
        currentUser = { name: currentUser.name, ...data.user };
        updateUI();
        loadMarket();
    } else {
        alert(data.error);
    }
}

async function loadMarket() {
    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'getMarket' })
    });
    const data = await res.json();
    
    const list = document.getElementById('market-orders');
    list.innerHTML = '';
    
    data.orders.forEach(order => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${order.seller} продает ${order.amount} ${order.resource} за ${order.total} GRC</span>
            <button class="buy-btn" onclick="buyOrder(${order.id})">Купить</button>
        `;
        list.appendChild(li);
    });
}

async function withdrawFunds() {
    const wallet = document.getElementById('fp-wallet').value;
    const amount = parseFloat(document.getElementById('fp-amount').value);
    
    if (!wallet || !amount) return alert('Укажите кошелек и сумму');

    const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'withdraw', username: currentUser.name, wallet, withdrawAmount: amount })
    });
    const data = await res.json();
    
    if (data.success) {
        alert('Вывод успешен! ID выплаты: ' + data.payout_id);
        currentUser.balance = data.newBalance;
        updateUI();
    } else {
        alert('Ошибка вывода: ' + data.error);
    }
}

// --- ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ---
function updateUI() {
    if (!currentUser) return;
    document.getElementById('user-balance').innerText = currentUser.balance.toFixed(2);
    document.getElementById('res-wood').innerText = currentUser.resources.wood;
    document.getElementById('res-iron').innerText = currentUser.resources.iron;
    document.getElementById('res-food').innerText = currentUser.resources.food;
}
