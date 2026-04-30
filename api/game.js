const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join('/tmp', 'db.json');
const FP_API_KEY = '6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9';
const FP_CURRENCY = 'DOGE';
const DEPOSIT_RATE = 1000;   // 1 DOGE = 1000 GRC
const WITHDRAW_RATE = 10000; // 10000 GRC = 1 DOGE
const FP_CALLBACK_SECRET = 'MY_SUPER_SECRET_123'; // ПОМЕНЯЙТЕ НА СВОЙ!

function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

// ЦЕНЫ ПОДОБРАНЫ ТАК, ЧТОБЫ ХВАТИЛО СТАРТОВЫХ РЕСУРСОВ НА 1 УРОВЕНЬ ЛЮБОГО ЗДАНИЯ
const BUILDING_COSTS = {
    townhall:   { wood: 500,  stone: 500,  iron: 200, time: 30, hp: 100, req: 0 },
    woodcutter: { wood: 150,  stone: 50,   iron: 0,   time: 10, hp: 50,  req: 1 },
    mine:       { wood: 100,  stone: 150,  iron: 50,  time: 15, hp: 60,  req: 1 },
    quarry:     { wood: 150,  stone: 50,   iron: 20,  time: 12, hp: 60,  req: 2 },
    farm:       { wood: 150,  stone: 50,   iron: 0,   time: 10, hp: 40,  req: 1 },
    barrack:    { wood: 300,  stone: 300,  iron: 100, time: 20, hp: 80,  req: 3 },
    archery:    { wood: 300,  stone: 200,  iron: 200, time: 25, hp: 70,  req: 4 },
    stable:     { wood: 400,  stone: 300,  iron: 200, time: 30, hp: 90,  req: 5 },
    tower:      { wood: 500,  stone: 400,  iron: 300, time: 60, hp: 150, req: 7 }
};

function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        const defaultDB = { users: {}, orders: [], map: [], chat: [], pvpQueue: null };
        for(let i=1; i<=10; i++) defaultDB.map.push({ id: i, name: `Форпост ${i}`, owner: null, bonus: 0.1 + (i*0.02) });
        fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db)); }

// Функция расчета добычи с учетом HP здания
function calcProduction(u, building, resName, rate) {
    if (u.buildings[building] === 0) return 0;
    const maxHp = BUILDING_COSTS[building].hp * u.buildings[building];
    const hpMod = (u.buildingHp[building] || 0) / maxHp;
    return u.buildings[building] * rate * hpMod;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const isGet = req.method === 'GET';
    const body = isGet ? req.query : req.body;
    const { action, username, password } = body || {};
    
    try {
        const db = getDB();
        const now = Date.now();

        // --- FAUCETPAY CALLBACK ---
        if (isGet && action === 'fp_callback') {
            const { custom_username, amount, currency, secret } = body;
            if (secret !== FP_CALLBACK_SECRET || currency !== FP_CURRENCY) return res.status(403).send('Invalid');
            const u = db.users[custom_username];
            if (u) { u.balance += parseFloat(amount) * DEPOSIT_RATE; saveDB(db); return res.status(200).send('OK'); }
            return res.status(404).send('User not found');
        }

        // --- РЕГИСТРАЦИЯ (СТАРТОВЫЕ РЕСУРСЫ) ---
        if (action === 'register') {
            if (!username || !password) return res.json({ success: false, error: 'Введите логин и пароль' });
            if (db.users[username]) return res.json({ success: false, error: 'Такой игрок уже есть' });
            db.users[username] = {
                passwordHash: hashPassword(password), balance: 0, glory: 0,
                // СТАРТОВЫЕ РЕСУРСЫ: Хватит на постройку 1 уровня любого доступного здания
                resources: { wood: 1500, stone: 1500, iron: 500, food: 500, mana: 0 },
                buildings: { townhall: 1, woodcutter: 0, mine: 0, quarry: 0, farm: 0, barrack: 0, archery: 0, stable: 0, tower: 0 },
                buildingHp: { townhall: 100, woodcutter: 50, mine: 60, quarry: 60, farm: 40, barrack: 80, archery: 70, stable: 90, tower: 150 },
                construction: null, army: { warriors: 0, archers: 0, cavalry: 0 },
                boosts: { gather: 1, build: 1 }, expedition: null
            };
            saveDB(db); return res.json({ success: true, message: 'Успех! Войдите.' });
        }

        // --- АВТОРИЗАЦИЯ ---
        if (action === 'login') {
            if (!username || !password) return res.json({ success: false, error: 'Введите данные' });
            const u = db.users[username];
            if (!u || u.passwordHash !== hashPassword(password)) return res.json({ success: false, error: 'Неверный логин или пароль' });
            
            let elapsed = (now - u.lastUpdate) / 1000;
            let mapBonus = 1 + (db.map.filter(p => p.owner === username).reduce((acc, p) => acc + p.bonus, 0));
            
            u.resources.wood += calcProduction(u, 'woodcutter', 'wood', 2) * elapsed * mapBonus * u.boosts.gather;
            u.resources.iron += calcProduction(u, 'mine', 'iron', 1) * elapsed * mapBonus * u.boosts.gather;
            u.resources.stone += calcProduction(u, 'quarry', 'stone', 2) * elapsed * mapBonus * u.boosts.gather;
            u.resources.food += calcProduction(u, 'farm', 'food', 5) * elapsed * mapBonus * u.boosts.gather;
            u.resources.mana += calcProduction(u, 'tower', 'mana', 0.5) * elapsed * mapBonus * u.boosts.gather;
            u.lastUpdate = now; 
            
            if (u.construction && now >= u.construction.finishTime) { u.buildings[u.construction.building]++; u.buildingHp[u.construction.building] = BUILDING_COSTS[u.construction.building].hp * u.buildings[u.construction.building]; u.construction = null; }
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
        u.resources.wood += calcProduction(u, 'woodcutter', 'wood', 2) * elapsed * mapBonus * u.boosts.gather;
        u.resources.iron += calcProduction(u, 'mine', 'iron', 1) * elapsed * mapBonus * u.boosts.gather;
        u.resources.stone += calcProduction(u, 'quarry', 'stone', 2) * elapsed * mapBonus * u.boosts.gather;
        u.resources.food += calcProduction(u, 'farm', 'food', 5) * elapsed * mapBonus * u.boosts.gather;
        u.resources.mana += calcProduction(u, 'tower', 'mana', 0.5) * elapsed * mapBonus * u.boosts.gather;
        u.lastUpdate = now;

        if (u.construction && now >= u.construction.finishTime) { u.buildings[u.construction.building]++; u.buildingHp[u.construction.building] = BUILDING_COSTS[u.construction.building].hp * u.buildings[u.construction.building]; u.construction = null; }
        if (u.expedition && now >= u.expedition.finishTime) { u.resources.wood += 5000; u.resources.iron += 2000; u.resources.stone += 2000; u.glory += 20; u.expedition = null; }

        // УЛУЧШЕНИЕ ЗДАНИЙ
        if (action === 'upgrade') {
            const building = req.body.building;
            if (u.construction) return res.json({success:false, error:'Уже строится!'});
            const costs = BUILDING_COSTS[building]; 
            if(!costs) return res.json({success:false, error:'Здание не найдено'});
            if(u.buildings.townhall < costs.req) return res.json({success:false, error:`Нужна Ратуша уровня ${costs.req}!`});
            
            const mult = Math.pow(1.5, u.buildings[building]);
            for(let r in costs) {
                if(r !== 'time' && r !== 'hp' && r !== 'req' && (u.resources[r]||0) < costs[r]*mult) {
                    return res.json({success:false, error:`Не хватает ${r}!`});
                }
            }
            for(let r in costs) {
                if(r !== 'time' && r !== 'hp' && r !== 'req') u.resources[r] -= costs[r]*mult;
            }
            const buildTime = (costs.time * mult) / (u.boosts.build || 1);
            u.construction = { building: building, finishTime: now + (buildTime * 1000) };
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData });
        }

        if (action === 'repair') { 
            const building = req.body.building; 
            const maxHp = BUILDING_COSTS[building].hp * u.buildings[building]; 
            const missingHp = maxHp - (u.buildingHp[building] || maxHp); 
            if(missingHp <= 0) return res.json({success:false, error:'Не нуждается в ремонте'}); 
            const costWood = missingHp * 5; const costStone = missingHp * 5; 
            if(u.resources.wood < costWood || u.resources.stone < costStone) return res.json({success:false, error:'Нужно дерева и камня: ' + costWood}); 
            u.resources.wood -= costWood; u.resources.stone -= costStone; 
            u.buildingHp[building] = maxHp; 
            saveDB(db); const userData={...u}; delete userData.passwordHash; return res.json({ success: true, user: userData }); 
        }

        if (action === 'recruit') { 
            let c=req.body.amount||1; const ut=req.body.unitType; const uc={warriors:{food:100,iron:50},archers:{food:80,wood:100},cavalry:{food:200,iron:100,stone:50}}; const cs=uc[ut]; if(!cs)return res.json({success:false,error:'Тип не найден'}); for(let r in cs)if(u.resources[r]<cs[r]*c)return res.json({success:false,error:'Мало ресурсов!'}); for(let r in cs)u.resources[r]-=cs[r]*c; u.army[ut]+=c; saveDB(db); const ud={...u}; delete ud.passwordHash; return res.json({success:true,user:ud}); 
        }
        
        if (action === 'raid') { 
            const t=req.body.targetUser; if(!db.users[t])return res.json({success:false,error:'Цель не найдена!'}); if(username===t)return res.json({success:false,error:'Себя бить нельзя!'}); let ap=u.army.warriors*10+u.army.archers*15+u.army.cavalry*25; if(ap===0)return res.json({success:false,error:'Нет армии!'}); let en=db.users[t]; let dp=en.army.warriors*15+en.army.archers*10+en.army.cavalry*20; if(ap>dp){let s={};for(let r in u.resources)s[r]=Math.floor(en.resources[r]*0.2);for(let r in s){en.resources[r]-=s[r];u.resources[r]+=s[r];}u.army.cavalry=Math.ceil(u.army.cavalry*0.8);u.army.archers=Math.ceil(u.army.archers*0.6);u.army.warriors=Math.ceil(u.army.warriors*0.4);en.army={warriors:0,archers:0,cavalry:0};u.glory+=10;const bk=Object.keys(en.buildings).filter(k=>en.buildings[k]>0&&k!=='townhall');if(bk.length>0){const rb=bk[Math.floor(Math.random()*bk.length)];en.buildingHp[rb]=Math.max(0,en.buildingHp[rb]-30);}saveDB(db);const ud={...u};delete ud.passwordHash;return res.json({success:true,user:ud,stolen:s});}else{u.army={warriors:0,archers:0,cavalry:0};en.army.warriors+=10;en.glory+=10;saveDB(db);return res.json({success:false,error:'Армия разбита!'});} 
        }

        if (action === 'sendExpedition') { 
            let ta=u.army.warriors+u.army.archers+u.army.cavalry; if(ta<50)return res.json({success:false,error:'Нужно 50 юнитов'}); if(u.expedition)return res.json({success:false,error:'Уже в экспедиции'}); u.expedition={finishTime:now+3600000}; u.army.warriors=Math.ceil(u.army.warriors*0.8); u.army.archers=Math.ceil(u.army.archers*0.8); u.army.cavalry=Math.ceil(u.army.cavalry*0.8); saveDB(db); const ud={...u}; delete ud.passwordHash; return res.json({success:true,user:ud}); 
        }
        
        if (action === 'sell') { 
            const r=req.body.resource,a=req.body.amount,p=parseFloat(req.body.pricePerUnit); if(u.resources[r]<a)return res.json({success:false,error:'Мало ресов'}); u.resources[r]-=a; db.orders.push({id:Date.now(),seller:username,resource:r,amount:a,pricePerUnit:p,total:a*p}); saveDB(db); const ud={...u}; delete ud.passwordHash; return res.json({success:true,user:ud}); 
        }
        if (action === 'buy') { 
            const oi=db.orders.findIndex(o=>o.id===req.body.orderId); if(oi===-1)return res.json({success:false,error:'Ордер не найден'}); const o=db.orders[oi]; if(u.balance<o.total)return res.json({success:false,error:'Мало GRC!'}); db.users[o.seller].balance+=o.total; u.balance-=o.total; u.resources[o.resource]+=o.amount; db.orders.splice(oi,1); saveDB(db); const ud={...u}; delete ud.passwordHash; return res.json({success:true,user:ud}); 
        }
        if (action === 'getMarket') return res.json({ success: true, orders: db.orders });

        if (action === 'withdraw') { 
            const w = req.body.wallet, ga = parseFloat(req.body.grcAmount); 
            if(u.balance < ga) return res.json({success:false, error:'Мало GRC'}); 
            const da = ga / WITHDRAW_RATE; 
            if(da < 1) return res.json({success:false, error:`Минимальная сумма вывода: ${WITHDRAW_RATE} GRC`}); 
            try {
                const fpRes = await axios.post('https://faucetpay.io/api/v1/send', null, {params:{api_key:FP_API_KEY, amount:Math.floor(da), to:w, currency:FP_CURRENCY}}); 
                if(fpRes.data.status === 200) { u.balance -= ga; saveDB(db); const ud={...u}; delete ud.passwordHash; return res.json({success:true, user:ud, dogeSent:Math.floor(da)}); } 
                else return res.json({success:false, error:fpRes.data.message}); 
            } catch(e) {
                return res.json({success:false, error:'Ошибка сети FaucetPay'});
            }
        }

        if (action === 'capturePost') { let p=db.map.find(p=>p.id===req.body.postId);if(!p)return res.json({success:false,error:'Пост не найден'});let pw=u.army.warriors+u.army.archers*2+u.army.cavalry*3;if(pw<50)return res.json({success:false,error:'Мало армии'});p.owner=username;u.army.warriors=Math.ceil(u.army.warriors*0.9);u.army.archers=Math.ceil(u.army.archers*0.9);u.army.cavalry=Math.ceil(u.army.cavalry*0.9);saveDB(db);const ud={...u};delete ud.passwordHash;return res.json({success:true,user:ud,map:db.map}); }
        if (action === 'sendMessage') { db.chat.push({user:username,text:req.body.message,time:now});if(db.chat.length>50)db.chat.shift();saveDB(db);return res.json({success:true,chat:db.chat.slice(-20)}); }
        if (action === 'sync') { saveDB(db);const ud={...u};delete ud.passwordHash;return res.json({success:true,user:ud,map:db.map}); }

        return res.json({ success: false, error: 'Invalid action' });
    } catch (error) { console.error(error); return res.status(500).json({ success: false, error: 'Server error' }); }
};
