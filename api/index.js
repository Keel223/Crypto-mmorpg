import express from 'express';
import axios from 'axios';
import crypto from 'crypto';

const app = express();
app.use(express.json());

let db = {
    users: {},
    market: [],
    nextItemId: 1
};

const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY || "ВАШ_КЛЮЧ";
const EXCHANGE_RATE = 1000;

function hashPassword(p) { return crypto.createHash('sha256').update(p).digest('hex'); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function getXpForLevel(lvl) { return lvl * 150; }

// --- АВТОРИЗАЦИЯ ---
app.post('/api/register', (req, res) => {
    let { username, password, pClass } = req.body;
    if (!username || username.length < 3) return res.status(400).json({ error: "Логин мин. 3 символа" });
    if (!password || password.length < 4) return res.status(400).json({ error: "Пароль мин. 4 символа" });
    if (db.users[username]) return res.status(400).json({ error: "Логин занят" });

    // Стартовые статы зависят от класса
    let stats = pClass === 'mage' 
        ? { maxHp: 80, baseDmg: 15, baseDef: 2 } 
        : { maxHp: 120, baseDmg: 10, baseDef: 5 };

    db.users[username] = {
        passwordHash: hashPassword(password),
        class: pClass || 'warrior',
        xp: 0, level: 1,
        hp: stats.maxHp, maxHp: stats.maxHp,
        baseDmg: stats.baseDmg, baseDef: stats.baseDef,
        gold: 50,
        inventory: [], // [{id, name, type, power, price}]
        equippedWeapon: null,
        equippedArmor: null
    };
    res.json({ success: true });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.users[username];
    if (!user || user.passwordHash !== hashPassword(password)) return res.status(400).json({ error: "Неверный логин/пароль" });
    req.session.user = username; // Сохраняем в сессию
    res.json({ success: true, user: getSafeUser(username) });
});

app.post('/api/checksession', (req, res) => {
    if (req.session.user && db.users[req.session.user]) {
        res.json({ loggedIn: true, user: getSafeUser(req.session.user) });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

function getSafeUser(username) {
    const u = db.users[username];
    if(!u) return null;
    const { passwordHash, ...safe } = u;
    return safe;
}

// --- ГЕЙМПЛЕЙ: МАГАЗИН NPC ---
app.post('/api/shop/buy', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    
    const shopItems = [
        { name: "Малое зелье лечения", type: "potion", heal: 50, price: 20 },
        { name: "Большое зелье лечения", type: "potion", heal: 150, price: 50 }
    ];
    
    const { itemId } = req.body;
    const item = shopItems[itemId];
    if(!item) return res.status(400).json({error:"Нет предмета"});
    if(user.gold < item.price) return res.status(400).json({error:"Мало золота"});

    user.gold -= item.price;
    user.inventory.push({ id: db.nextItemId++, ...item });
    res.json({ success: true, message: `Куплено ${item.name}`, user: getSafeUser(username) });
});

// --- ГЕЙМПЛЕЙ: ИСПОЛЬЗОВАНИЕ ЗЕЛИЙ ---
app.post('/api/usepotion', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    
    const idx = user.inventory.findIndex(i => i.id === req.body.itemId && i.type === 'potion');
    if(idx === -1) return res.status(400).json({error:"Нет зелья"});
    
    const potion = user.inventory.splice(idx, 1)[0];
    const oldHp = user.hp;
    user.hp = Math.min(user.maxHp, user.hp + potion.heal);
    const healed = user.hp - oldHp;
    
    res.json({ success: true, message: `Использовано ${potion.name}. Исцелено +${healed} HP.`, user: getSafeUser(username) });
});

// --- ГЕЙМПЛЕЙ: ЭКИПИРОВКА ---
app.post('/api/equip', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    const item = user.inventory.find(i => i.id === req.body.itemId);
    
    if(!item || (item.type !== 'weapon' && item.type !== 'armor')) return res.status(400).json({error:"Нельзя надеть"});
    
    if(item.type === 'weapon') user.equippedWeapon = item.id;
    if(item.type === 'armor') user.equippedArmor = item.id;

    res.json({ success: true, message: `Экипировано: ${item.name}`, user: getSafeUser(username) });
});

// --- ГЕЙМПЛЕЙ: ПОШАГОВЫЙ БОЙ ---
app.post('/api/fight', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    
    if(user.hp <= 0) return res.status(400).json({error:"Вы мертвы! Купите зелье."});

    const locations = {
        forest: { mobs: [{name:"Гоблин-разведчик", hp:40, dmg:8, def:2, xp:30, gold:15}], lootTable: [{name:"Ржавый кинжал", type:"weapon", power:5, chance:0.3}, {name:"Кожаная куртка", type:"armor", power:3, chance:0.2}] },
        dungeon: { mobs: [{name:"Каменный голем", hp:100, dmg:18, def:10, xp:80, gold:50}], lootTable: [{name:"Меч Паладина", type:"weapon", power:15, chance:0.4}, {name:"Стальная броня", type:"armor", power:12, chance:0.3}] }
    };

    const loc = locations[req.body.location] || locations.forest;
    const mobTemplate = loc.mobs[0]; // Для упрощения 1 тип моба в локации
    let mob = { ...mobTemplate, currentHp: mobTemplate.hp };

    // Считаем статы игрока
    let pDmg = user.baseDmg;
    let pDef = user.baseDef;
    const w = user.inventory.find(i => i.id === user.equippedWeapon);
    const a = user.inventory.find(i => i.id === user.equippedArmor);
    if(w) pDmg += w.power;
    if(a) pDef += a.power;

    let log = [`--- БОЙ НАЧИНАЕТСЯ: ВЫ vs ${mob.name} ---`];

    // Симуляция боя (максимум 10 раундов)
    for (let round = 1; round <= 10; round++) {
        // Ход игрока
        let playerAction = req.body.action || 'attack';
        let dmgDealt = 0;

        if (playerAction === 'attack') {
            dmgDealt = Math.max(1, pDmg - mob.def + rand(-3, 3));
        } else if (playerAction === 'heavy') {
            dmgDealt = Math.max(1, Math.floor(pDmg * 1.5) - mob.def + rand(-2, 5));
        } else if (playerAction === 'defend') {
            log.push(`Раунд ${round}: Вы встали в глухую оборону.`);
            pDef += 10; // Временный бонус
        }

        if (dmgDealt > 0) {
            mob.currentHp -= dmgDealt;
            log.push(`Раунд ${round}: Вы ударили на <span style="color:var(--success)">${dmgDealt}</span> урона. (У моба ${Math.max(0,mob.currentHp)}/${mob.hp} HP)`);
        }
        
        if(playerAction === 'defend') pDef -= 10; // Убираем временный бонус

        if (mob.currentHp <= 0) {
            log.push(`<span style="color:var(--gold)">🎉 ПОБЕДА! Вы получили ${mob.xp} XP и ${mob.gold} 💰.</span>`);
            user.xp += mob.xp;
            user.gold += mob.gold;
            
            // Дроп лута
            for (let l of loc.lootTable) {
                if (Math.random() < l.chance) {
                    let newItem = { id: db.nextItemId++, ...l };
                    user.inventory.push(newItem);
                    log.push(`Вы подобрали: <b>${l.name}</b> (${l.type === 'weapon' ? 'Урон' : 'Защита'}: +${l.power})`);
                }
            }

            // Левелап
            if (user.xp >= getXpForLevel(user.level)) {
                user.level++;
                user.xp -= getXpForLevel(user.level - 1);
                user.maxHp += 20;
                user.baseDmg += 2;
                user.baseDef += 1;
                user.hp = user.maxHp;
                log.push(`<span style="color:#f1c40f">🌟 LEVEL UP! Уровень ${user.level}! Статы повышены!</span>`);
            }
            break;
        }

        // Ход моба
        let mobDmg = Math.max(1, mob.dmg - pDef + rand(-3, 3));
        if (playerAction === 'defend') mobDmg = Math.floor(mobDmg * 0.5); // Урон снижен защитой
        
        user.hp -= mobDmg;
        log.push(`Раунд ${round}: ${mob.name} бьет вас на <span style="color:var(--hp)">${mobDmg}</span> урона. (У вас ${Math.max(0,user.hp)}/${user.maxHp} HP)`);

        if (user.hp <= 0) {
            user.hp = 0;
            let lostGold = Math.floor(user.gold * 0.15);
            user.gold -= lostGold;
            log.push(`<span style="color:var(--hp)">💀 ВЫ ПОГИБЛИ! Потеряно ${lostGold} 💰. HP сброшено.</span>`);
            user.hp = 1; // Воскрешение
            break;
        }
    }

    res.json({ success: true, log: log.join('<br>'), user: getSafeUser(username) });
});

// --- P2P РЫНОК ---
app.post('/api/market/sell', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    const idx = user.inventory.findIndex(i => i.id === req.body.itemId);
    
    if(idx === -1) return res.status(400).json({error:"Нет предмета"});
    if(user.inventory[idx].type === 'potion') return res.status(400).json({error:"Зелья нельзя продать игрокам"});
    if(user.equippedWeapon === req.body.itemId) user.equippedWeapon = null;
    if(user.equippedArmor === req.body.itemId) user.equippedArmor = null;

    const item = user.inventory.splice(idx, 1)[0];
    db.market.push({ id: Date.now(), seller: username, item, price: parseInt(req.body.price) });
    res.json({ success: true, message: "Выставлено на рынок", user: getSafeUser(username), market: db.market });
});

app.post('/api/market/buy', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const buyer = db.users[username];
    const lotIdx = db.market.findIndex(m => m.id === req.body.lotId);
    const lot = db.market[lotIdx];

    if (!lot || lot.seller === username) return res.status(400).json({ error: "Нельзя купить" });
    if (buyer.gold < lot.price) return res.status(400).json({ error: "Мало золота" });

    buyer.gold -= lot.price;
    const fee = Math.floor(lot.price * 0.05);
    db.users[lot.seller].gold += (lot.price - fee);
    buyer.inventory.push(lot.item); // Предмет переходит со всеми статами!
    db.market.splice(lotIdx, 1);

    res.json({ success: true, message: `Куплено! Комиссия: ${fee}💰`, user: getSafeUser(username), market: db.market });
});

// --- ВЫВОД FAUCETPAY ---
app.post('/api/withdraw', async (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    const user = db.users[username];
    
    const amountGold = parseInt(req.body.amountGold);
    const email = req.body.email;
    
    if (user.gold < amountGold || amountGold < 1000) return res.status(400).json({ error: "Мало золота (мин 1000)" });

    const fee = Math.floor(amountGold * 0.10);
    const amountUSDT = ((amountGold - fee) / EXCHANGE_RATE).toFixed(2);

    try {
        const response = await axios.post('https://faucetpay.io/api/v1/send', new URLSearchParams({
            api_key: FAUCETPAY_API_KEY, to: email, amount: amountUSDT, currency: 'USDT'
        }));

        if (response.data.status === 200) {
            user.gold -= amountGold;
            res.json({ success: true, message: `Успешно выведено ${amountUSDT} USDT!`, user: getSafeUser(username) });
        } else {
            res.status(400).json({ error: response.data.message });
        }
    } catch (err) { res.status(500).json({ error: "Ошибка сети FaucetPay" }); }
});

app.post('/api/sync', (req, res) => {
    const username = req.session.user;
    if(!username) return res.status(401).json({error:"Auth"});
    res.json({ user: getSafeUser(username), market: db.market });
});

export default app;
