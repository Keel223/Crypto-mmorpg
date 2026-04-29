import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// Виртуальная база данных
let db = {
    users: {},    // { username: { passwordHash, xp, level, hp, maxHp, gold, inventory: [], equipped: null } }
    market: []
};

const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY || "ВАШ_КЛЮЧ";
const EXCHANGE_RATE = 1000;

// --- УТИЛИТЫ ---
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function getXpForLevel(level) {
    return level * 100; // Простая формула: 1 лвл = 100 xp, 2 лвл = 200 xp и т.д.
}

// --- АВТОРИЗАЦИЯ ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (db.users[username]) return res.status(400).json({ error: "Имя занято" });

    db.users[username] = {
        passwordHash: hashPassword(password),
        xp: 0, level: 1,
        hp: 100, maxHp: 100,
        gold: 50, // Стартовое золото
        inventory: [],
        equipped: null // ID экипированного предмета
    };
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || user.passwordHash !== hashPassword(password)) {
        return res.status(400).json({ error: "Неверный логин или пароль" });
    }
    // Отправляем клиенту данные без пароля
    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
});

// --- ГЕЙМПЛЕЙ: ПОКОЛУПЕНИЕ И СМЕРТЬ ---
function checkLevelUp(user) {
    if (user.xp >= getXpForLevel(user.level)) {
        user.level++;
        user.xp -= getXpForLevel(user.level - 1);
        user.maxHp += 20;
        user.hp = user.maxHp; // Полное исцеление при левелапе
        return true;
    }
    return false;
}

// --- ГЕЙМПЛЕЙ: БОЙ ---
app.post('/api/fight', (req, res) => {
    const { username, location } = req.body;
    const user = db.users[username];
    
    if (user.hp <= 0) return res.status(400).json({ error: "Вы мертвы! Ждите восстановления или лечитесь." });

    // Настройки локаций
    const locations = {
        forest: { name: "Тёмный Лес", monsters: ["Волк", "Гоблин"], xpRange: [20, 40], goldRange: [10, 30], dmgRange: [5, 15], loot: ["Шкура волка", "Гоблинский кинжал"], difficulty: 1 },
        dungeon: { name: "Кристальная Пещера", monsters: ["Огр", "Скелет-воин"], xpRange: [50, 80], goldRange: [30, 60], dmgRange: [15, 30], loot: ["Меч паладина", "Кольцо защиты"], difficulty: 2 }
    };

    const loc = locations[location] || locations.forest;
    const monsterName = loc.monsters[Math.floor(Math.random() * loc.monsters.length)];
    
    let baseDmg = 10; // Базовый удар голыми руками
    if (user.equipped) {
        const weapon = user.inventory.find(i => i.id === user.equipped);
        if (weapon) baseDmg += weapon.power; // Добавляем урон от оружия
    }

    const playerDmg = baseDmg + Math.floor(Math.random() * 10);
    const monsterDmg = loc.dmgRange[0] + Math.floor(Math.random() * (loc.dmgRange[1] - loc.dmgRange[0]));
    
    const gainedXp = loc.xpRange[0] + Math.floor(Math.random() * (loc.xpRange[1] - loc.xpRange[0]));
    const gainedGold = loc.goldRange[0] + Math.floor(Math.random() * (loc.goldRange[1] - loc.goldRange[0]));
    const loot = loc.loot[Math.floor(Math.random() * loc.loot.length)];

    let log = [];
    log.push(`Вы зашли в ${loc.name} и встретили <b>${monsterName}</b>!`);
    
    // Упрощенный бой: кто бьет сильнее
    if (playerDmg >= monsterDmg) {
        log.push(`Вы нанесли удар на <span style="color:var(--success)">${playerDmg}</span> урона. Монстр нанес вам ${monsterDmg}.`);
        log.push(`Вы ПОБЕДИЛИ! +${gainedXp} XP, +${gainedGold} 💰.`);
        
        user.hp -= monsterDmg;
        user.xp += gainedXp;
        user.gold += gainedGold;
        
        // Шанс выпадения лута (60%)
        if (Math.random() > 0.4) {
            const power = loc.difficulty === 2 ? Math.floor(Math.random() * 20) + 10 : Math.floor(Math.random() * 10) + 2;
            const newItem = { id: Date.now(), name: loot, type: 'weapon', power: power };
            user.inventory.push(newItem);
            log.push(`Вы подобрали трофей: <b>${loot}</b> (Урон: +${power})`);
        }

        const leveledUp = checkLevelUp(user);
        if (leveledUp) log.push(`<span style="color:var(--gold)">🌟 LEVEL UP! Теперь вы ${user.level} уровня! Макс HP увеличено.</span>`);

    } else {
        log.push(`Монстр оказался слишком силен. Он нанес вам <span style="color:var(--hp)">${monsterDmg}</span> урона.`);
        user.hp -= monsterDmg;
        
        if (user.hp <= 0) {
            user.hp = 0;
            const lostGold = Math.floor(user.gold * 0.2); // Теряем 20% золота при смерти
            user.gold -= lostGold;
            log.push(`<span style="color:var(--hp)">💀 ВЫ ПОГИБЛИ! Потеряно ${lostGold} золота. HP восстановлено до 1.</span>`);
            user.hp = 1; // Воскрешаем с 1 хп
        }
    }

    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, log: log.join('<br>'), user: safeUser });
});

// --- ГЕЙМПЛЕЙ: ОТДЫХ (ЛЕЧЕНИЕ) ---
app.post('/api/rest', (req, res) => {
    const { username } = req.body;
    const user = db.users[username];
    if (user.hp === user.maxHp) return res.status(400).json({ error: "Вы полностью здоровы" });
    
    const healCost = Math.floor((user.maxHp - user.hp) * 0.5); // Лечение стоит золото
    if (user.gold < healCost) return res.status(400).json({ error: `Недостаточно золота для лечения (Нужно: ${healCost} 💰)` });
    
    user.gold -= healCost;
    user.hp = user.maxHp;
    
    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, message: `Вы отдохнули в таверне. Потрачено ${healCost} 💰. HP полностью восстановлено.`, user: safeUser });
});

// --- ИНВЕНТАРЬ И ЭКИПИРОВКА ---
app.post('/api/equip', (req, res) => {
    const { username, itemId } = req.body;
    const user = db.users[username];
    const item = user.inventory.find(i => i.id === itemId);
    
    if (!item || item.type !== 'weapon') return res.status(400).json({ error: "Нельзя экипировать" });
    
    user.equipped = itemId; // Одеваем предмет
    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, message: `Экипировано: ${item.name} (+${item.power} урона)`, user: safeUser });
});

// --- P2P РЫНОК ---
app.post('/api/market/sell', (req, res) => {
    const { username, itemId, price } = req.body;
    const user = db.users[username];
    const itemIndex = user.inventory.findIndex(i => i.id === itemId);
    
    if (itemIndex === -1) return res.status(400).json({ error: "Нет предмета" });
    if (user.equipped === itemId) user.equipped = null; // Снимаем экипировку если продаем надетое
    
    const item = user.inventory.splice(itemIndex, 1)[0];
    db.market.push({ id: Date.now(), seller: username, item, price: parseInt(price) });
    
    const { passwordHash, ...safeUser } = user;
    res.json({ success: true, message: "Выставлено на рынок", user: safeUser, market: db.market });
});

app.post('/api/market/buy', (req, res) => {
    const { username, lotId } = req.body;
    const buyer = db.users[username];
    const lotIndex = db.market.findIndex(m => m.id === lotId);
    const lot = db.market[lotIndex];

    if (!lot || lot.seller === username) return res.status(400).json({ error: "Нельзя купить" });
    if (buyer.gold < lot.price) return res.status(400).json({ error: "Мало золота" });

    buyer.gold -= lot.price;
    const fee = Math.floor(lot.price * 0.05);
    db.users[lot.seller].gold += (lot.price - fee);
    buyer.inventory.push(lot.item); // Передаем сам предмет с его силой!
    db.market.splice(lotIndex, 1);

    const { passwordHash, ...safeUser } = buyer;
    res.json({ success: true, message: `Куплено! Комиссия: ${fee}💰`, user: safeUser, market: db.market });
});

// --- ВЫВОД FAUCETPAY ---
app.post('/api/withdraw', async (req, res) => {
    const { username, email, amountGold } = req.body;
    const user = db.users[username];
    if (user.gold < amountGold) return res.status(400).json({ error: "Недостаточно золота" });

    const fee = Math.floor(amountGold * 0.10);
    const netGold = amountGold - fee;
    const amountUSDT = (netGold / EXCHANGE_RATE).toFixed(2);

    try {
        const response = await axios.post('https://faucetpay.io/api/v1/send', new URLSearchParams({
            api_key: FAUCETPAY_API_KEY, to: email, amount: amountUSDT, currency: 'USDT'
        }));

        if (response.data.status === 200) {
            user.gold -= amountGold;
            const { passwordHash, ...safeUser } = user;
            res.json({ success: true, message: `Выплачено ${amountUSDT} USDT!`, user: safeUser });
        } else {
            res.status(400).json({ error: response.data.message });
        }
    } catch (err) { res.status(500).json({ error: "Ошибка вывода" }); }
});

app.post('/api/sync', (req, res) => {
    const { username } = req.body;
    const user = db.users[username];
    if (!user) return res.status(401).json({ error: "Not logged in" });
    const { passwordHash, ...safeUser } = user;
    res.json({ user: safeUser, market: db.market });
});

export default app;
