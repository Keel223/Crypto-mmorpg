// Обязательно используем импорт Vercel версии Express!
const app = require('express')();
const cors = require('cors');

app.use(cors());
app.use(express.json());

// БАЗА ДАННЫХ В ОПЕРАТИВНОЙ ПАМЯТИ (СБРОСИТСЯ ПРИ ПЕРЕЗАГРУЗКЕ СЕРВЕРА)
let db = {
    users: {},
    inventory: [],
    market: [],
    nextItemId: 1
};

const FAUCETPAY_API_KEY = 'ТВОЙ_API_КЛЮЧ_FAUCETPAY'; // Вставь ключ, если будешь тестировать вывод
const FAUCETPAY_CURRENCY = 'BTC';

// Защита от спама атак
const cooldowns = new Set();

// --- АВТОРИЗАЦИЯ ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password || username.length < 3) return res.status(400).json({ error: 'Логин мин. 3 символа' });
    if (db.users[username]) return res.status(400).json({ error: 'Логин занят' });
    
    db.users[username] = {
        username, password, lvl: 1, exp: 0, expNeed: 50,
        hp: 100, maxHp: 100, minDmg: 5, maxDmg: 10, def: 0,
        gold: 0, loc: 'city'
    };
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || user.password !== password) return res.status(400).json({ error: 'Неверный логин/пароль' });
    res.json(user);
});

app.get('/api/player/:username', (req, res) => {
    res.json(db.users[req.params.username] || null);
});

app.get('/api/inventory/:username', (req, res) => {
    res.json(db.inventory.filter(i => i.owner === req.params.username));
});

// --- ИГРОВАЯ ЛОГИКА (ЗАЩИЩЕННАЯ) ---
app.post('/api/action', (req, res) => {
    const { username, action, target } = req.body;
    let user = db.users[username];
    if (!user) return res.status(403).json({ error: 'Не авторизован' });
    
    let result = { log: '', type: 'sys' };

    if (action === 'move') {
        user.loc = target;
        result.log = `Вы перешли в: ${target}`;
    } 
    else if (action === 'rest') {
        user.hp = user.maxHp;
        result.log = 'HP полностью восстановлено.'; result.type = 'heal';
    } 
    else if (action === 'search') {
        // Анти-спам
        if (cooldowns.has(username)) return res.status(429).json({ error: 'Слишком быстро!' });
        cooldowns.add(username);
        setTimeout(() => cooldowns.delete(username), 1000);

        if (user.hp <= 0) return res.status(400).json({ error: 'Вы мертвы, отдыхайте в городе' });

        const enemies = {
            forest: [{name:'Гоблин',hp:30,dmg:5,exp:15,loot:['Клык']}, {name:'Волк',hp:50,dmg:8,exp:25,loot:['Шкура']}],
            cave: [{name:'Скелет',hp:80,dmg:12,exp:50,loot:['Меч']}, {name:'Голем',hp:150,dmg:18,exp:100,loot:['Кираса']}],
            swamp: [{name:'Зомби',hp:60,dmg:10,exp:30,loot:['Токсин']}],
            necropolis: [{name:'Лич',hp:200,dmg:25,exp:200,loot:['Посох']}],
            castle: [{name:'Демон',hp:300,dmg:35,exp:500,loot:['Огненный меч']}]
        };
        
        const locEnemies = enemies[user.loc];
        if(!locEnemies) return res.json({log: 'Здесь безопасно.', type: 'sys', user});
        
        const e = locEnemies[Math.floor(Math.random() * locEnemies.length)];
        let pDmg = Math.floor(Math.random() * (user.maxDmg - user.minDmg + 1)) + user.minDmg;
        let eDmg = Math.max(1, e.dmg - user.def);
        let newHp = user.hp - eDmg;
        let died = false;
        if (newHp <= 0) { newHp = 10; died = true; }
        
        let logMsg = died ? `[${e.name}] ударил на ${eDmg}. Вы погибли! Респаун в городе.` : `Ударили [${e.name}] на ${pDmg}. Он ударил на ${eDmg}.`;
        
        if ((e.hp - pDmg) <= 0 && !died) {
            logMsg += ` ${e.name} убит! +${e.exp} EXP.`;
            let newExp = user.exp + e.exp;
            if (newExp >= user.expNeed) { user.lvl++; newExp -= user.expNeed; user.maxHp += 20; user.minDmg += 2; user.maxDmg += 4; }
            user.exp = newExp;
            
            if (Math.random() < 0.7) {
                const lootName = e.loot[Math.floor(Math.random() * e.loot.length)];
                db.inventory.push({ id: db.nextItemId++, owner: username, name: lootName, type: 'trash', dmg: 0, def: 0 });
                logMsg += ` Лут: ${lootName}.`;
            }
            result.type = 'loot';
        } else { 
            result.type = 'dmg'; 
        }
        user.hp = newHp;
        result.log = logMsg;
    }
    
    res.json({ ...result, user });
});

// --- P2P РЫНОК ---
app.get('/api/market', (req, res) => res.json(db.market));

app.post('/api/market/sell', (req, res) => {
    const { username, itemId, price } = req.body;
    if (price < 1) return res.status(400).json({ error: 'Неверная цена' });
    
    const itemIndex = db.inventory.findIndex(i => i.id === itemId && i.owner === username);
    if (itemIndex === -1) return res.status(400).json({ error: 'Нет предмета' });
    
    const item = db.inventory.splice(itemIndex, 1)[0];
    db.market.push({ id: db.nextItemId++, seller: username, itemName: item.name, type: item.type, dmg: item.dmg, def: item.def, price });
    res.json({ success: true });
});

app.post('/api/market/buy', (req, res) => {
    const { username, lotId } = req.body;
    const lotIndex = db.market.findIndex(l => l.id === lotId);
    const lot = db.market[lotIndex];
    
    if (!lot) return res.status(400).json({ error: 'Лот уже куплен' });
    if (lot.seller === username) return res.status(400).json({ error: 'Нельзя купить свое' });
    if (db.users[username].gold < lot.price) return res.status(400).json({ error: 'Мало золота' });

    db.users[username].gold -= lot.price;
    if(db.users[lot.seller]) db.users[lot.seller].gold += Math.ceil(lot.price * 0.95);
    db.inventory.push({ id: db.nextItemId++, owner: username, name: lot.itemName, type: lot.type, dmg: lot.dmg, def: lot.def });
    db.market.splice(lotIndex, 1);
    res.json({ success: true, log: `Куплено ${lot.itemName}.` });
});

// --- FAUCETPAY ВЫВОД ---
app.post('/api/faucet/withdraw', async (req, res) => {
    const { username, email, goldToWithdraw } = req.body;
    let user = db.users[username];
    
    if (user.gold < goldToWithdraw || goldToWithdraw < 1000) return res.status(400).json({ error: 'Мало GC или минимум 1000' });
    const satoshiToSend = Math.floor(goldToWithdraw / 10);

    try {
        const fpRes = await fetch('https://faucetpay.io/api/v1/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: FAUCETPAY_API_KEY, to: email, amount: satoshiToSend, currency: FAUCETPAY_CURRENCY })
        });
        const fpData = await fpRes.json();

        if (fpData.status === 200) {
            user.gold -= goldToWithdraw;
            res.json({ success: true, message: `Выведено ${satoshiToSend} Sat.` });
        } else {
            res.status(400).json({ error: fpData.message });
        }
    } catch (e) {
        res.status(500).json({ error: 'Ошибка FaucetPay' });
    }
});

// === САМОЕ ГЛАВНОЕ ДЛЯ VERCEL ===
// Vercel не запускает app.listen(), нам нужно экспортировать сам объект 'app'
module.exports = app;
