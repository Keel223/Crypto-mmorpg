const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join('/tmp', 'db.json');
const FP_API_KEY = '6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9'; // ВАШ КЛЮЧ
const FP_CURRENCY = 'DOGE';

// ЭКОНОМИКА GRC (ТОЧНО ПО ВАШЕМУ ЗАПРОСУ)
const DEPOSIT_RATE = 1000;   // 1 DOGE = 1000 GRC (Пополнение)
const WITHDRAW_RATE = 10000; // 10000 GRC = 1 DOGE (Вывод)

function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

const BUILDING_COSTS = {
    townhall: { wood: 1000, stone: 1000, iron: 500, time: 30 },
    woodcutter: { wood: 200, stone: 50, iron: 0, time: 10 },
    mine: { wood: 100, stone: 200, iron: 50, time: 15 },
    quarry: { wood: 150, stone: 50, iron: 20, time: 12 },
    farm: { wood: 150, stone: 50, iron: 0, time: 10 },
    barrack: { wood: 300, stone: 500, iron: 300, time: 20 },
    archery: { wood: 400, stone: 200, iron: 400, time: 25 },
    stable: { wood: 500, stone: 300, iron: 600, time: 30 },
    tower: { wood: 1000, stone: 800, iron: 500, mana: 100, time: 60 }
};

function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        const defaultDB = { users: {}, orders: [], map: [], chat: [], battles: [], pvpQueue: null };
        for(let i=1; i<=10; i++) defaultDB.map.push({ id: i, name: `Форпост ${i}`, owner: null, bonus: 0.1 + (i*0.02) });
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db)); }

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action, username, password } = req.body || {};
    try {
        const db = getDB();
        const now = Date.now();

        if (action === 'register') {
            if (!username || !password) return res.json({ success: false, error: 'Введите логин и пароль' });
            if (db.users[username]) return res.json({ success: false, error: 'Такой игрок уже есть' });
            db.users[username] = {
                passwordHash: hashPassword(password), balance: 0, glory: 0,
                resources: { wood: 500, stone: 500, iron: 200, food: 300, mana: 0 },
                buildings: { townhall: 1, woodcutter: 0, mine: 0, quarry: 0, farm: 0, barrack: 0, archery: 0, stable: 0, tower: 0 },
                construction: null, army: { warriors: 0, archers: 0, cavalry: 0 },
                boosts: { gather: 1, build: 1 }, expedition: null
            };
            saveDB(db); return res.json({ success: true, message: 'Успех! Войдите.' });
        }

        if (action === 'login') {
            if (!username || !password) return res.json({ success: false, error: 'Введите данные' });
            const u = db.users[username];
            if (!u || u.passwordHash !== hashPassword(password)) return res.json({ success: false, error: 'Неверный логин или пароль' });
            
            let elapsed = (now - u.lastUpdate) / 1000;
            let mapBonus = 1 + (db.map.filter(p => p.owner === username).reduce((acc, p) => acc + p.bonus, 0));
            u.resources.wood += u.buildings.woodcutter * 2 * elapsed * mapBonus * u.boosts.gather;
            u.resources.iron += u.buildings.mine * 1 * elapsed * mapBonus * u.boosts.gather;
            u.resources.stone += u.buildings.quarry * 2 * elapsed * mapBonus * u.boosts.gather;
            u.resources.food += u.buildings.farm * 5 * elapsed * mapBonus * u.boosts.gather;
            u.resources.mana += u.buildings.tower * 0.5 * elapsed * mapBonus * u.boosts.gather;
            u.lastUpdate = now; 
            
            if (u.construction && now >= u.construction.finishTime) { u.buildings[u.construction.building]++; u.construction = null; }
            if (u.expedition && now >= u.expedition.finishTime) { u.resources.wood += 5000; u.resources.iron += 2000; u.resources.stone += 2000; u.glory += 20; u.expedition = null; }
            
            saveDB(db);
            const userData = { ...u }; delete userData.passwordHash;
            return res.json({ success: true, user: userData, map: db.map, chat: db.chat.slice(-20) });
        }

        if (!username || !db.users[username]) return res.json({ success: false, error: 'Not authorized' });
        let u = db.users[username];

        // Автодобыча
        let elapsed = (now - u.lastUpdate) / 1000;
        let mapBonus = 1 + (db.map.filter(p => p.owner === username).reduce((acc, p) => acc + p.bonus, 0));
        u.resources.wood += u.buildings.woodcutter * 2 * elapsed * mapBonus * u.boosts.gather;
        u.resources.iron += u.buildings.mine * 1 * elapsed * mapBonus * u.boosts.gather;
        u.resources.stone += u.buildings.quarry * 2 * elapsed * mapBonus * u.boosts.gather;
        u.resources.food += u.buildings.farm * 5 * elapsed * mapBonus * u.boosts.gather;
        u.resources.mana += u.buildings.tower * 0.5 * elapsed * mapBonus * u.boosts.gather;
        u.lastUpdate = now;

        // Проверка таймеров
        if (u.construction && now >= u.construction.finishTime) { u.buildings[u.construction.building]++; u.construction = null; }
        if (u.expedition && now >= u.expedition.finishTime) { u.resources.wood += 5000; u.resources.iron += 2000; u.resources.stone += 2000; u.glory += 20; u.expedition = null; }

        // УЛУЧШЕНИЕ ЗДАНИЙ (Таймер)
        if (action === 'upgrade') {
            const building = req.body.building;
            if (u.construction) return res.json({success:false, error:'Уже строится!'});
            const costs = BUILDING_COSTS[building]; if(!costs) return res.json({success:false, error:'Здание не найдено'});
            const mult = Math.pow(1.5, u.buildings[building]);
            for(let r in costs) if(r !== 'time' && (u.resources[r]||0) < costs[r]*mult) return res.json({success:false, error:`Не хватает ${r}!`});
            for(let r in costs) if(r !== 'time') u.resources[r] -= costs[r]*mult;
            const buildTime = (costs.time * mult) / (u.boosts.build || 1);
            u.construction = { building: building, finishTime: now + (buildTime * 1000) };
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }

        // НАЕМ АРМИИ
        if (action === 'recruit') {
            let count = req.body.amount || 1; const unitType = req.body.unitType;
            const unitCosts = { warriors: { food: 100, iron: 50 }, archers: { food: 80, wood: 100 }, cavalry: { food: 200, iron: 100, stone: 50 } };
            const c = unitCosts[unitType]; if(!c) return res.json({success:false, error:'Тип не найден'});
            for(let r in c) if(u.resources[r] < c[r]*count) return res.json({success:false, error:'Мало ресурсов!'});
            for(let r in c) u.resources[r] -= c[r]*count;
            u.army[unitType] += count;
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }

        // PVP РЕЙД
        if (action === 'raid') {
            const targetUser = req.body.targetUser;
            if (!db.users[targetUser]) return res.json({ success: false, error: 'Цель не найдена!' });
            if(username === targetUser) return res.json({ success: false, error: 'Нельзя бить себя!' });
            let atkPow = u.army.warriors*10 + u.army.archers*15 + u.army.cavalry*25;
            if(atkPow === 0) return res.json({success:false, error:'Нет армии!'});
            let t = db.users[targetUser];
            let defPow = t.army.warriors*15 + t.army.archers*10 + t.army.cavalry*20;
            if (atkPow > defPow) {
                let stolen = {}; for(let r in u.resources) stolen[r] = Math.floor(t.resources[r] * 0.2);
                for(let r in stolen) { t.resources[r] -= stolen[r]; u.resources[r] += stolen[r]; }
                u.army.cavalry = Math.ceil(u.army.cavalry * 0.8); u.army.archers = Math.ceil(u.army.archers * 0.6); u.army.warriors = Math.ceil(u.army.warriors * 0.4);
                t.army = { warriors: 0, archers: 0, cavalry: 0 }; u.glory += 10;
                saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData, stolen });
            } else {
                u.army = { warriors: 0, archers: 0, cavalry: 0 }; t.army.warriors += 10; t.glory += 10;
                saveDB(db); return res.json({ success: false, error: 'Армия разбита!' });
            }
        }

        // PVP МАТЧМЕЙКИНГ
        if (action === 'findPvp') {
            let totalArmy = u.army.warriors + u.army.archers + u.army.cavalry;
            if(totalArmy === 0) return res.json({success:false, error:'Нужна армия!'});
            if (!db.pvpQueue) { db.pvpQueue = username; saveDB(db); return res.json({ success: true, status: 'waiting' }); } 
            else {
                if(db.pvpQueue === username) return res.json({success:false, error:'Вы уже в очереди!'});
                const enemyName = db.pvpQueue; db.pvpQueue = null; let enemy = db.users[enemyName];
                let atkPow = u.army.warriors*10 + u.army.archers*15 + u.army.cavalry*25;
                let defPow = enemy.army.warriors*15 + enemy.army.archers*10 + enemy.army.cavalry*20;
                let winner = atkPow > defPow ? u : enemy; let loser = atkPow > defPow ? enemy : u;
                let stolen = {}; for(let r in winner.resources) { stolen[r] = Math.floor(loser.resources[r] * 0.1); loser.resources[r] -= stolen[r]; winner.resources[r] += stolen[r]; }
                loser.army = { warriors: Math.floor(loser.army.warriors*0.3), archers: Math.floor(loser.army.archers*0.3), cavalry: Math.floor(loser.army.cavalry*0.3) };
                winner.army = { warriors: Math.ceil(winner.army.warriors*0.7), archers: Math.ceil(winner.army.archers*0.7), cavalry: Math.ceil(winner.army.cavalry*0.7) };
                winner.glory += 25;
                saveDB(db); const userData={...u}; delete userData.passwordHash;
                return res.json({ success: winner === u, status: 'finished', user: userData, enemyName });
            }
        }

        // ЭКСПЕДИЦИЯ В РУИНЫ (PvE - 1 час)
        if (action === 'sendExpedition') {
            let totalArmy = u.army.warriors + u.army.archers + u.army.cavalry;
            if(totalArmy < 50) return res.json({success:false, error:'Нужно минимум 50 юнитов!'});
            if(u.expedition) return res.json({success:false, error:'Уже в экспедиции!'});
            u.expedition = { finishTime: now + 3600000 }; // 1 час
            u.army.warriors = Math.ceil(u.army.warriors * 0.8); // 20% уходят
            u.army.archers = Math.ceil(u.army.archers * 0.8);
            u.army.cavalry = Math.ceil(u.army.cavalry * 0.8);
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }

        // КАЗИНО / ИГРА УДАЧИ (Сжигание ресурсов ради GRC)
        if (action === 'gamble') {
            const resType = req.body.resType; const resAmount = parseInt(req.body.resAmount);
            if(!u.resources[resType] || u.resources[resType] < resAmount || resAmount < 100) return res.json({success:false, error:'Мало ресурсов (мин 100)'});
            u.resources[resType] -= resAmount;
            let won = false;
            if(Math.random() < 0.3) { // 30% шанс выиграть GRC
                // Награда рассчитывается примерно: 1000 дерева = 0.1 GRC
                let rewardGrc = (resAmount / 10000); 
                u.balance += rewardGrc;
                won = true;
            }
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData, won });
        }

        // P2P РЫНОК (ЛЮБЫЕ ЦЕНЫ Вплоть до 0.0000000001)
        if (action === 'sell') {
            const resource = req.body.resource; const amount = req.body.amount; const pricePerUnit = parseFloat(req.body.pricePerUnit);
            if (u.resources[resource] < amount) return res.json({ success: false, error: 'Мало ресов' });
            u.resources[resource] -= amount;
            db.orders.push({ id: Date.now(), seller: username, resource, amount, pricePerUnit, total: amount * pricePerUnit });
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }
        if (action === 'buy') {
            const orderId = req.body.orderId;
            const oi = db.orders.findIndex(o => o.id === orderId);
            if (oi === -1) return res.json({ success: false, error: 'Ордер не найден' });
            const o = db.orders[oi];
            if (u.balance < o.total) return res.json({ success: false, error: 'Мало GRC! Пополните баланс или продавайте ресы.' });
            db.users[o.seller].balance += o.total; // Продавец получает GRC
            u.balance -= o.total; u.resources[o.resource] += o.amount;
            db.orders.splice(oi, 1);
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }
        if (action === 'getMarket') return res.json({ success: true, orders: db.orders });

        // ПОПОЛНЕНИЕ БАЛАНСА (ПОКУПКА GRC ЗА DOGE)
        if (action === 'getDepositAddress') {
            try {
                const fpRes = await axios.get(`https://faucetpay.io/api/v1/getdepositaddress?api_key=${FP_API_KEY}&currency=${FP_CURRENCY}`);
                if (fpRes.data.status === 200) return res.json({ success: true, address: fpRes.data.deposit_address });
                else return res.json({ success: false, error: 'Ошибка FaucetPay API' });
            } catch (e) { return res.json({ success: false, error: 'Сервер недоступен' }); }
        }

        // ВЫВОД GRC В DOGE
        if (action === 'withdraw') {
            const wallet = req.body.wallet; const grcAmount = parseFloat(req.body.grcAmount);
            if (u.balance < grcAmount) return res.json({ success: false, error: 'Мало GRC' });
            const dogeAmount = grcAmount / WITHDRAW_RATE; // 10000 GRC = 1 DOGE
            if (dogeAmount < 1) return res.json({ success: false, error: `Минимальная сумма вывода: ${WITHDRAW_RATE} GRC (1 DOGE)` });
            
            const fpRes = await axios.post('https://faucetpay.io/api/v1/send', null, {
                params: { api_key: FP_API_KEY, amount: Math.floor(dogeAmount), to: wallet, currency: FP_CURRENCY }
            });
            if (fpRes.data.status === 200) {
                u.balance -= grcAmount; saveDB(db);
                const userData={...u}; delete userData.passwordHash;
                return res.json({ success: true, user: userData, dogeSent: Math.floor(dogeAmount) });
            } else return res.json({ success: false, error: fpRes.data.message });
        }

        if (action === 'capturePost') { let p=db.map.find(p=>p.id===req.body.postId); if(!p)return res.json({success:false,error:'Пост не найден'}); let pw=u.army.warriors+u.army.archers*2+u.army.cavalry*3; if(pw<50)return res.json({success:false,error:'Мало армии'}); p.owner=username; u.army.warriors=Math.ceil(u.army.warriors*0.9);u.army.archers=Math.ceil(u.army.archers*0.9);u.army.cavalry=Math.ceil(u.army.cavalry*0.9); saveDB(db); const ud={...u};delete ud.passwordHash; return res.json({success:true,user:ud,map:db.map}); }
        if (action === 'sendMessage') { db.chat.push({user:username,text:req.body.message,time:now}); if(db.chat.length>50)db.chat.shift(); saveDB(db); return res.json({success:true,chat:db.chat.slice(-20)}); }
        if (action === 'sync') { saveDB(db); const ud={...u};delete ud.passwordHash; return res.json({ success: true, user: ud, map: db.map }); }

        return res.json({ success: false, error: 'Invalid action' });
    } catch (error) { console.error(error); return res.status(500).json({ success: false, error: 'Server error' }); }
};
