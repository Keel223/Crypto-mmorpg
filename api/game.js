const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join('/tmp', 'db.json');
const FP_API_KEY = '6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9'; // ВАШ КЛЮЧ
const FP_CURRENCY = 'DOGE';
const MARKET_FEE = 0.05;

function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        const defaultDB = { users: {}, orders: [], clans: {}, map: [], chat: [] };
        // Инициализация глобальной карты (10 аванпостов)
        for(let i=1; i<=10; i++) defaultDB.map.push({ id: i, name: `Форпост ${i}`, owner: null, bonus: 0.1 + (i*0.02) });
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db)); }
function getReqCost(base, lvl) { return Math.floor(base * Math.pow(1.5, lvl - 1)); }

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action, username, targetUser, clanName, postId, message, item, unitType, amount, resource, price, orderId } = req.body || {};
    try {
        const db = getDB();
        const now = Date.now();

        if (action === 'login') {
            if (!db.users[username]) {
                db.users[username] = {
                    balance: 0, clan: null,
                    resources: { wood: 500, stone: 500, iron: 200, food: 300, mana: 0 },
                    buildings: { townhall: 1, woodcutter: 0, mine: 0, farm: 0, barrack: 0, archery: 0, stable: 0, tower: 0 },
                    army: { warriors: 0, archers: 0, cavalry: 0 },
                    boosts: { gather: 1, recruit: 1 },
                    lastUpdate: now
                };
                saveDB(db);
            }
            // Автодобыча при входе
            let u = db.users[username];
            let elapsed = (now - u.lastUpdate) / 1000;
            let mapBonus = 1 + (db.map.filter(p => p.owner === username).reduce((acc, p) => acc + p.bonus, 0));
            u.resources.wood += u.buildings.woodcutter * 2 * elapsed * mapBonus * u.boosts.gather;
            u.resources.iron += u.buildings.mine * 1 * elapsed * mapBonus * u.boosts.gather;
            u.resources.food += u.buildings.farm * 5 * elapsed * mapBonus * u.boosts.gather;
            u.resources.mana += u.buildings.tower * 0.5 * elapsed * mapBonus * u.boosts.gather;
            u.lastUpdate = now;
            saveDB(db);
            return res.json({ success: true, user: u, map: db.map, chat: db.chat.slice(-20) });
        }

        if (!db.users[username]) return res.json({ success: false, error: 'User not found' });
        let u = db.users[username];

        // Автодобыча при действии
        let elapsed = (now - u.lastUpdate) / 1000;
        let mapBonus = 1 + (db.map.filter(p => p.owner === username).reduce((acc, p) => acc + p.bonus, 0));
        u.resources.wood += u.buildings.woodcutter * 2 * elapsed * mapBonus * u.boosts.gather;
        u.resources.iron += u.buildings.mine * 1 * elapsed * mapBonus * u.boosts.gather;
        u.resources.food += u.buildings.farm * 5 * elapsed * mapBonus * u.boosts.gather;
        u.resources.mana += u.buildings.tower * 0.5 * elapsed * mapBonus * u.boosts.gather;
        u.lastUpdate = now;

        // УЛУЧШЕНИЕ ЗДАНИЙ
        if (action === 'upgrade') {
            const costs = {
                townhall: { wood: 1000, stone: 1000, iron: 500 }, woodcutter: { wood: 200, stone: 100, iron: 0 },
                mine: { wood: 100, stone: 200, iron: 50 }, farm: { wood: 150, stone: 50, iron: 0 },
                barrack: { wood: 300, stone: 500, iron: 300 }, archery: { wood: 400, stone: 200, iron: 400 },
                stable: { wood: 500, stone: 300, iron: 600 }, tower: { wood: 1000, stone: 800, iron: 500, mana: 100 }
            };
            const c = costs[building]; if(!c) return res.json({success:false, error:'Здание не найдено'});
            const mult = getReqCost(1, u.buildings[building] + 1);
            for(let r in c) if((u.resources[r]||0) < c[r]*mult) return res.json({success:false, error:`Мало ${r}!`});
            for(let r in c) u.resources[r] -= c[r]*mult;
            u.buildings[building]++;
            saveDB(db); return res.json({ success: true, user: u });
        }

        // НАЕМ АРМИИ (Разные юниты)
        if (action === 'recruit') {
            let count = amount || 1;
            const unitCosts = {
                warriors: { food: 100, iron: 50 }, archers: { food: 80, wood: 100 }, cavalry: { food: 200, iron: 100, stone: 50 }
            };
            const c = unitCosts[unitType]; if(!c) return res.json({success:false, error:'Тип юнита не найден'});
            const costMod = 1 / u.boosts.recruit;
            for(let r in c) if(u.resources[r] < c[r]*count*costMod) return res.json({success:false, error:'Мало ресурсов для найма!'});
            for(let r in c) u.resources[r] -= c[r]*count*costMod;
            u.army[unitType] += count;
            saveDB(db); return res.json({ success: true, user: u });
        }

        // ПвП РЕЙД
        if (action === 'raid') {
            if (!db.users[targetUser]) return res.json({ success: false, error: 'Цель не найдена!' });
            let totalAtk = u.army.warriors*10 + u.army.archers*15 + u.army.cavalry*25;
            if(totalAtk === 0) return res.json({success:false, error:'Нет армии!'});
            let t = db.users[targetUser];
            let totalDef = t.army.warriors*15 + t.army.archers*10 + t.army.cavalry*20;
            
            if (totalAtk > totalDef) {
                let stolen = {};
                for(let r in u.resources) stolen[r] = Math.floor(t.resources[r] * 0.2);
                for(let r in stolen) { t.resources[r] -= stolen[r]; u.resources[r] += stolen[r]; }
                u.army.cavalry = Math.ceil(u.army.cavalry * 0.8); u.army.archers = Math.ceil(u.army.archers * 0.6); u.army.warriors = Math.ceil(u.army.warriors * 0.4);
                t.army = { warriors: 0, archers: 0, cavalry: 0 };
                saveDB(db); return res.json({ success: true, user: u, stolen });
            } else {
                u.army = { warriors: 0, archers: 0, cavalry: 0 };
                t.army.warriors += 10; // Защитник получает трофеи
                saveDB(db); return res.json({ success: false, error: 'Армия разбита!' });
            }
        }

        // ЗАХВАТ КАРТЫ
        if (action === 'capturePost') {
            let post = db.map.find(p => p.id === postId);
            if(!post) return res.json({success:false, error:'Пост не найден'});
            let power = u.army.warriors + u.army.archers*2 + u.army.cavalry*3;
            if(power < 50) return res.json({success:false, error:'Нужно больше армии (мин. 50 силы)'});
            post.owner = username;
            u.army.warriors = Math.ceil(u.army.warriors*0.9); // Потери при захвате
            u.army.archers = Math.ceil(u.army.archers*0.9);
            u.army.cavalry = Math.ceil(u.army.cavalry*0.9);
            saveDB(db); return res.json({ success: true, user: u, map: db.map });
        }

        // АЛХИМИЯ (Крафт за ману)
        if (action === 'craft') {
            if(item === 'speed_gather' && u.resources.mana >= 50) { u.resources.mana -= 50; u.boosts.gather = 2; setTimeout(()=>{u.boosts.gather=1;}, 3600000); }
            else if(item === 'speed_recruit' && u.resources.mana >= 80) { u.resources.mana -= 80; u.boosts.recruit = 2; setTimeout(()=>{u.boosts.recruit=1;}, 3600000); }
            else return res.json({success:false, error:'Мало маны или нет рецепта'});
            saveDB(db); return res.json({ success: true, user: u });
        }

        // ПРЕМИУМ МАГАЗИН (Сжигание GRC)
        if (action === 'buyPremium') {
            if(item === 'vip1' && u.balance >= 10) { u.balance -= 10; u.boosts.gather = 1.5; }
            else if(item === 'shield' && u.balance >= 5) { u.balance -= 5; /* Логика щита */ }
            else return res.json({success:false, error:'Мало баланса'});
            saveDB(db); return res.json({ success: true, user: u });
        }

        // КЛАНЫ
        if (action === 'createClan') {
            if(u.clan) return res.json({success:false, error:'Вы уже в клане'});
            if(!db.clans[clanName]) { db.clans[clanName] = { owner: username, members: [username] }; u.clan = clanName; }
            saveDB(db); return res.json({ success: true, user: u });
        }

        // ЧАТ
        if (action === 'sendMessage') {
            db.chat.push({ user: username, text: message, time: now });
            if(db.chat.length > 50) db.chat.shift();
            saveDB(db); return res.json({ success: true, chat: db.chat.slice(-20) });
        }

        // P2P РЫНОК И FAUCETPAY (Оставляем как было, добавляем ману и камень)
        if (action === 'sell') {
            if ((u.resources[resource]||0) < amount) return res.json({ success: false, error: 'Мало ресов' });
            u.resources[resource] -= amount;
            db.orders.push({ id: Date.now(), seller: username, resource, amount, pricePerUnit: price, total: amount * price });
            saveDB(db); return res.json({ success: true, user: u });
        }
        if (action === 'buy') {
            const oi = db.orders.findIndex(o => o.id === orderId);
            if (oi === -1) return res.json({ success: false, error: 'Ордер не найден' });
            const o = db.orders[oi];
            if (u.balance < o.total) return res.json({ success: false, error: 'Мало баланса' });
            db.users[o.seller].balance += o.total * (1 - MARKET_FEE);
            u.balance -= o.total; u.resources[o.resource] += o.amount;
            db.orders.splice(oi, 1);
            saveDB(db); return res.json({ success: true, user: u });
        }
        if (action === 'getMarket') return res.json({ success: true, orders: db.orders });
        
        if (action === 'withdraw') {
            const { wallet, withdrawAmount } = req.body;
            if (u.balance < withdrawAmount) return res.json({ success: false, error: 'Мало баланса' });
            const fpRes = await axios.post('https://faucetpay.io/api/v1/send', null, {
                params: { api_key: FP_API_KEY, amount: Math.floor(withdrawAmount), to: wallet, currency: FP_CURRENCY }
            });
            if (fpRes.data.status === 200) { u.balance -= withdrawAmount; saveDB(db); return res.json({ success: true, newBalance: u.balance }); }
            else return res.json({ success: false, error: fpRes.data.message });
        }

        if (action === 'sync') { saveDB(db); return res.json({ success: true, user: u, map: db.map }); }
        return res.json({ success: false, error: 'Invalid action' });

    } catch (error) { console.error(error); return res.status(500).json({ success: false, error: 'Server error' }); }
};
