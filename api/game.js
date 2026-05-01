const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent'); // Нужна для прокси

// === НАСТРОЙКИ БАЗЫ ДАННЫХ UPSTASH ===
const UPSTASH_URL = 'https://willing-cicada-111832.upstash.io/';
const UPSTASH_TOKEN = 'gQAAAAAAAbTYAAIgcDE3OWExNWY2NTdkMTk0NDE1ODA3YzNiY2Y5OThkYTYwYg';

// === НАСТРОЙКИ XROCKET ===
const XROCKET_API_KEY = '37e361c1f41bdde2e63381737';
// ВСТАВЬТЕ СЮДА ВАШУ ССЫЛКУ ИЗ VERCEL (Без слэша на конце!)
const VERCEL_URL = 'https://crypto-strategia.vercel.app'; 

// === НАСТРОЙКИ ВЫВОДА FAUCETPAY ===
const FP_API_KEY = '6093864477e0ad75814f955d6d382665829b1912072310cbfcd17f6a499b77c9';
const FP_CURRENCY = 'DOGE';
const DEPOSIT_RATE = 1000; // 1 DOGE = 1000 GRC
const WITHDRAW_RATE = 10000; // 10000 GRC = 1 DOGE

// === ПРОКСИ (НАСТРОЙКА ДЛЯ ОБХОДА БЛОКИРОВОК) ===
// Если ошибка "недоступен" останется, купи любой IPv4 HTTPS прокси и вставь сюда.
// Формат: 'http://логин:пароль@ip:порт'
const PROXY_URL = ''; // Пока пусто

function hashPassword(password) { return crypto.createHash('sha256').update(password).digest('hex'); }

const BUILDING_COSTS = {
    townhall:   { wood: 500,  stone: 500,  iron: 200, time: 30, hp: 100, req: 0 },
    woodcutter: { wood: 150,  stone: 50,   iron: 0,   time: 10, hp: 50,  req: 1 },
    mine:       { wood: 150,  stone: 50,   iron: 20,  time: 15, hp: 60,  req: 1 },
    farm:       { wood: 150,  stone: 50,   iron: 0,   time: 10, hp: 40,  req: 1 },
    barrack:    { wood: 300,  stone: 300,  iron: 100, time: 20, hp: 80,  req: 3 },
    archery:    { wood: 300,  stone: 200,  iron: 200, time: 25, hp: 70,  req: 4 },
    stable:     { wood: 400,  stone: 300,  iron: 200, time: 30, hp: 90,  req: 5 },
    tower:      { wood: 500,  stone: 400,  iron: 300, time: 60, hp: 150, req: 7 },
    forge:      { wood: 600,  stone: 600,  iron: 400, time: 40, hp: 120, req: 4 }
};

async function redis(command, ...args) {
    const res = await axios.post(`${UPSTASH_URL}${command}/${args.join('/')}`, null, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    return res.data.result;
}

function processOfflineProgress(u, world, now) {
    let elapsed = Math.min((now - u.last_update) / 1000, 86400);
    if (elapsed <= 0) return;
    let mapBonus = 1 + ((world.map || []).filter(p => p.owner === u.username).reduce((acc, p) => acc + p.bonus, 0));
    let heroGatherBonus = u.hero === 'miner' ? 1.5 : 1;
    let ringBonus = 1 + (u.rings.gather * 0.05);
    let chaosBonus = (world.chaos_event_end > now) ? 2 : 1;
    let g = u.boosts.gather * mapBonus * heroGatherBonus * ringBonus * chaosBonus;
    
    u.resources.wood += Math.floor((u.buildings.woodcutter * 2 * elapsed * g * ((u.building_hp.woodcutter||0) / (BUILDING_COSTS.woodcutter.hp * u.buildings.woodcutter || 1))) || 0);
    u.resources.iron += Math.floor((u.buildings.mine * 1 * elapsed * g * ((u.building_hp.mine||0) / (BUILDING_COSTS.mine.hp * u.buildings.mine || 1))) || 0);
    u.resources.stone += Math.floor((u.buildings.mine * 1 * elapsed * g * ((u.building_hp.mine||0) / (BUILDING_COSTS.mine.hp * u.buildings.mine || 1))) || 0);
    u.resources.food += Math.floor((u.buildings.farm * 5 * elapsed * g * ((u.building_hp.farm||0) / (BUILDING_COSTS.farm.hp * u.buildings.farm || 1))) || 0);
    u.resources.mana += Math.floor((u.buildings.tower * 0.5 * elapsed * g * ((u.building_hp.tower||0) / (BUILDING_COSTS.tower.hp * u.buildings.tower || 1))) || 0);
    u.last_update = now;
    
    if (u.construction && now >= u.construction.finishTime) { u.buildings[u.construction.building]++; u.building_hp[u.construction.building] = BUILDING_COSTS[u.construction.building].hp * u.buildings[u.construction.building]; u.construction = null; }
    if (u.expedition && now >= u.expedition.finishTime) { u.resources.wood += 5000; u.resources.iron += 2000; u.resources.stone += 2000; u.expedition = null; }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const isGet = req.method === 'GET';
    const body = isGet ? req.query : req.body;
    let { action, username, password } = body || {};
    if (username) username = String(username).toLowerCase().trim();

    try {
        const now = Date.now();

        // РЕГИСТРАЦИЯ
        if (action === 'register') {
            if (!username || !password) return res.json({ success: false, error: 'Введите логин и пароль' });
            const exists = await redis('GET', `user:${username}`);
            if (exists) return res.json({ success: false, error: 'Такой игрок уже есть' });
            
            const newUser = {
                username, password_hash: hashPassword(password), balance: 0, glory: 0,
                resources: { wood: 500, stone: 500, iron: 500, food: 500, mana: 0 },
                buildings: { townhall: 1, woodcutter: 0, mine: 0, farm: 0, barrack: 0, archery: 0, stable: 0, tower: 0, forge: 0 },
                building_hp: { townhall: 100, woodcutter: 50, mine: 60, farm: 40, barrack: 80, archery: 70, stable: 90, tower: 150, forge: 120 },
                construction: null, army: { warriors: 0, archers: 0, cavalry: 0 },
                boosts: { gather: 1, build: 1 }, expedition: null, hero: null, shield: 0, forge_lvl: 0, rings: { gather: 0, attack: 0 }, last_update: now
            };
            await redis('SET', `user:${username}`, JSON.stringify(newUser));
            
            let world = await redis('GET', 'world:main');
            if (!world) {
                const map = [];
                for(let i=1; i<=10; i++) map.push({ id: i, name: `Форпост ${i}`, owner: null, bonus: 0.1 + (i*0.02) });
                await redis('SET', 'world:main', JSON.stringify({ map, castle_owner: null, chaos_event_end: 0 }));
            }
            return res.json({ success: true, message: 'Успех! Войдите.' });
        }

        // АВТОРИЗАЦИЯ
        if (action === 'login') {
            if (!username || !password) return res.json({ success: false, error: 'Введите данные' });
            const uData = await redis('GET', `user:${username}`);
            if (!uData) return res.json({ success: false, error: 'Неверный логин или пароль' });
            
            const u = JSON.parse(uData);
            if (u.password_hash !== hashPassword(password)) return res.json({ success: false, error: 'Неверный логин или пароль' });

            const wData = await redis('GET', 'world:main');
            let world = wData ? JSON.parse(wData) : { map: [], castle_owner: null, chaos_event_end: 0 };

            processOfflineProgress(u, world, now);
            await redis('SET', `user:${username}`, JSON.stringify(u));
            
            delete u.password_hash;
            return res.json({ success: true, user: u, map: world.map, castleOwner: world.castle_owner, chaosEventEnd: world.chaos_event_end });
        }

        // ЗАЩИЩЕННЫЕ ДЕЙСТВИЯ
        if (!username) return res.json({ success: false, error: 'Not authorized' });
        const uData = await redis('GET', `user:${username}`);
        if (!uData) return res.json({ success: false, error: 'User not found' });
        let u = JSON.parse(uData);

        const wData = await redis('GET', 'world:main');
        let world = wData ? JSON.parse(wData) : { map: [], castle_owner: null, chaos_event_end: 0 };

        processOfflineProgress(u, world, now);

        // === ДЕЙСТВИЯ ИГРЫ ===
        if (action === 'upgrade') { const b=req.body.building;if(u.construction)return res.json({success:false,error:'Строится!'});const c=BUILDING_COSTS[b];if(!c)return res.json({success:false,error:'Не найдено'});if(u.buildings.townhall<c.req)return res.json({success:false,error:`Ратуша ${c.req} ур!`});const m=Math.pow(1.5,u.buildings[b]);for(let r in c)if(r!=='time'&&r!=='hp'&&r!=='req'&&(u.resources[r]||0)<c[r]*m)return res.json({success:false,error:`Мало ${r}!`});for(let r in c)if(r!=='time'&&r!=='hp'&&r!=='req')u.resources[r]-=c[r]*m;u.construction={building:b,finishTime:now+((c.time*m)/(u.boosts.build||1)*1000)}; }
        else if (action === 'repair') { const b=req.body.building;const mH=BUILDING_COSTS[b].hp*u.buildings[b];const mP=mH-(u.building_hp[b]||mH);if(mP<=0)return res.json({success:false,error:'Целое'});const cW=mP*5,cS=mP*5;if(u.resources.wood<cW||u.resources.stone<cS)return res.json({success:false,error:'Нужно '+cW+' дер/кам'});u.resources.wood-=cW;u.resources.stone-=cS;u.building_hp[b]=mH; }
        else if (action === 'recruit') { let c=req.body.amount||1;const ut=req.body.unitType;const uc={warriors:{food:100,iron:50},archers:{food:80,wood:100},cavalry:{food:200,iron:100,stone:50}};const cs=uc[ut];if(!cs)return res.json({success:false,error:'Тип не найден'});for(let r in cs)if(u.resources[r]<cs[r]*c)return res.json({success:false,error:'Мало ресурсов!'});for(let r in cs)u.resources[r]-=cs[r]*c;u.army[ut]+=c; }
        else if (action === 'upgradeArmy') { const cost = 1000 * (u.forge_lvl + 1); if(u.balance < cost) return res.json({success:false,error:`Нужно ${cost} GRC`}); u.balance -= cost; u.forge_lvl++; }
        else if (action === 'alchemy') { const t=req.body.type; if(t==='wood_to_stone'){if(u.resources.wood<500)return res.json({success:false,error:'Мало дерева'});u.resources.wood-=500;u.resources.stone+=200;} else if(t==='food_to_iron'){if(u.resources.food<500)return res.json({success:false,error:'Мало еды'});u.resources.food-=500;u.resources.iron+=200;} }
        else if (action === 'buyHero') { const h=req.body.hero; const cost = 50; if(u.balance < cost) return res.json({success:false,error:'Нужно 50 GRC'}); if(u.hero) return res.json({success:false,error:'Уже есть герой'}); u.balance -= cost; u.hero = h; }
        else if (action === 'buyShield') { const cost = 20; if(u.balance < cost) return res.json({success:false,error:'Нужно 20 GRC'}); u.balance -= cost; u.shield = now + 86400000; }
        else if (action === 'blackMarket') { const t=req.body.type; const cost=100; if(u.balance<cost)return res.json({success:false,error:'Нужно 100 GRC'}); u.balance-=cost; if(t==='wood')u.resources.wood+=10000; else if(t==='iron')u.resources.iron+=5000; else if(t==='stone')u.resources.stone+=5000; }
        else if (action === 'buyRing') { const t=req.body.type; const cost=200; if(u.balance<cost)return res.json({success:false,error:'Нужно 200 GRC'}); if(u.rings[t]>=5)return res.json({success:false,error:'Максимум 5 колец!'}); u.balance-=cost; u.rings[t]++; }
        else if (action === 'triggerChaos') { const cost=500; if(u.balance<cost)return res.json({success:false,error:'Нужно 500 GRC'}); u.balance-=cost; world.chaos_event_end=now+3600000; await redis('SET', 'world:main', JSON.stringify(world)); }
        else if (action === 'siegeCastle') { let ap=u.army.warriors*10+u.army.archers*15+u.army.cavalry*25; if(ap < 5000) return res.json({success:false,error:'Нужно 5000 силы!'}); if(world.castle_owner === username) return res.json({success:false,error:'Вы уже Владыка!'}); world.castle_owner = username; u.army.warriors = Math.ceil(u.army.warriors * 0.5); u.army.archers = Math.ceil(u.army.archers * 0.5); u.army.cavalry = Math.ceil(u.army.cavalry * 0.5); u.glory += 100; await redis('SET', 'world:main', JSON.stringify(world)); }
        else if (action === 'raid') { 
            let t = req.body.targetUser; if(!t) return res.json({success:false,error:'Введите цель'});
            t = String(t).toLowerCase().trim(); if(t===username)return res.json({success:false,error:'Себя бить нельзя!'});
            const enData = await redis('GET', `user:${t}`); if(!enData) return res.json({success:false,error:'Цель не найдена!'}); 
            let en = JSON.parse(enData); if(en.shield > now) return res.json({success:false,error:'У цели Щит!'}); 
            let ap=u.army.warriors*10+u.army.archers*15+u.army.cavalry*25; ap *= (1 + (u.forge_lvl * 0.1) + (u.rings.attack * 0.05)); if(u.hero === 'general') ap *= 1.2; if(ap===0)return res.json({success:false,error:'Нет армии!'}); 
            let dp=en.army.warriors*15+en.army.archers*10+en.army.cavalry*20; 
            if(ap>dp){let s={};for(let r in u.resources)s[r]=Math.floor(en.resources[r]*0.2);for(let r in s){en.resources[r]-=s[r];u.resources[r]+=s[r];}u.army.cavalry=Math.ceil(u.army.cavalry*0.8);u.army.archers=Math.ceil(u.army.archers*0.6);u.army.warriors=Math.ceil(u.army.warriors*0.4);en.army={warriors:0,archers:0,cavalry:0};u.glory+=10;const bk=Object.keys(en.buildings).filter(k=>en.buildings[k]>0&&k!=='townhall');if(bk.length>0){const rb=bk[Math.floor(Math.random()*bk.length)];en.building_hp[rb]=Math.max(0,en.building_hp[rb]-30);} 
            await redis('SET', `user:${t}`, JSON.stringify(en)); } else { u.army={warriors:0,archers:0,cavalry:0}; en.army.warriors+=10; en.glory+=10; await redis('SET', `user:${t}`, JSON.stringify(en)); } 
        }
        else if (action === 'sendExpedition') { let ta=u.army.warriors+u.army.archers+u.army.cavalry;if(ta<50)return res.json({success:false,error:'Нужно 50 юнитов'});if(u.expedition)return res.json({success:false,error:'Уже в экспедиции'});u.expedition={finishTime:now+3600000};u.army.warriors=Math.ceil(u.army.warriors*0.8);u.army.archers=Math.ceil(u.army.archers*0.8);u.army.cavalry=Math.ceil(u.army.cavalry*0.8); }
        else if (action === 'sell') { const r=req.body.resource,a=req.body.amount,p=parseFloat(req.body.pricePerUnit);if(u.resources[r]<a)return res.json({success:false,error:'Мало ресов'});u.resources[r]-=a; const orderId = Date.now(); await redis('SET', `order:${orderId}`, JSON.stringify({id:orderId, seller:username, resource:r, amount:a, price_per_unit:p, total:a*p})); }
        else if (action === 'buy') { const oi=req.body.orderId; const oData = await redis('GET', `order:${oi}`); if(!oData) return res.json({success:false,error:'Ордер не найден'}); const o=JSON.parse(oData); if(u.balance<o.total) return res.json({success:false,error:'Мало GRC!'}); let tax=o.total*0.1; if(world.castle_owner){const coData = await redis('GET', `user:${world.castle_owner}`); if(coData){let co = JSON.parse(coData); co.balance+=tax; await redis('SET', `user:${world.castle_owner}`, JSON.stringify(co));}} u.balance-=o.total; const sData = await redis('GET', `user:${o.seller}`); if(sData){let s = JSON.parse(sData); s.balance+=(o.total-tax); await redis('SET', `user:${o.seller}`, JSON.stringify(s));} u.resources[o.resource]+=o.amount; await redis('DEL', `order:${oi}`); }
        else if (action === 'getMarket') { const keys = await redis('KEYS', 'order:*'); let orders = []; for(let k of keys) { const d = await redis('GET', k); if(d) orders.push(JSON.parse(d)); } await redis('SET', `user:${username}`, JSON.stringify(u)); return res.json({ success: true, orders }); }
        
        // === ПОПОЛНЕНИЕ ЧЕРЕЗ XROCKET (ИСПРАВЛЕНО!) ===
        else if (action === 'getDepositAddress') { 
            try { 
                // Настройка агента для прокси (если понадобится)
                const axiosConfig = {
                    headers: { 'Authorization': `Bearer ${XROCKET_API_KEY}` },
                    timeout: 15000 // Увеличили таймаут до 15 секунд
                };
                if (PROXY_URL) {
                    axiosConfig.httpsAgent = new HttpsProxyAgent(PROXY_URL);
                }

                // ИЗМЕНЕН URL НА АКТУАЛЬНЫЙ И ИСПРАВЛЕН ТЕЛО ЗАПРОСА
                const xrRes = await axios.post('https://api.xrocket.app/v2/invoice', {
                    amount: 1, // Минимум 1 DOGE
                    currency: 'DOGE',
                    description: `Deposit for ${username}`,
                    hidden_message: `user:${username}`,
                    callback_url: `${VERCEL_URL}/api/game?action=xr_callback` 
                }, axiosConfig);

                if(xrRes.data && xrRes.data.success) { 
                    await redis('SET', `user:${username}`, JSON.stringify(u));
                    return res.json({ 
                        success: true, 
                        address: xrRes.data.data.address, 
                        min_amount: 1,
                        currency: 'DOGE' 
                    }); 
                } else return res.json({ success: false, error: 'Ошибка xRocket: ' + (xrRes.data.message || 'Unknown') }); 
            } catch(e) { 
                // Детальный лог ошибки в консоль Vercel
                console.error('xRocket Error Details:', e.response?.data || e.code || e.message);
                return res.json({ success: false, error: 'Сервер xRocket недоступен. Попробуйте позже.' }); 
            } 
        }
        
        // ВЕБХУК XROCKET (ИСПРАВЛЕНО СОХРАНЕНИЕ В БАЗУ!)
        else if (isGet && action === 'xr_callback') {
            if (body.status === 'paid') {
                const amount = body.amount;
                const hiddenMsg = body.hidden_message;
                const targetUser = hiddenMsg ? hiddenMsg.replace('user:', '').toLowerCase().trim() : null;
                
                if (targetUser && amount) {
                    const uData = await redis('GET', `user:${targetUser}`);
                    if (uData) {
                        let u = JSON.parse(uData);
                        const grcAmount = parseFloat(amount) * DEPOSIT_RATE; // 1 DOGE = 1000 GRC
                        u.balance += grcAmount;
                        // ВАЖНО: Сохраняем начисление в базу!
                        await redis('SET', `user:${targetUser}`, JSON.stringify(u));
                        console.log(`Начислено ${grcAmount} GRC для ${targetUser}`);
                    }
                }
            }
            return res.status(200).send('OK');
        }

        // ВЫВОД (FaucetPay)
        else if (action === 'withdraw') { const w=req.body.wallet,ga=parseFloat(req.body.grcAmount);if(u.balance<ga)return res.json({success:false,error:'Мало GRC'});const da=ga/WITHDRAW_RATE;if(da<1)return res.json({success:false,error:`Мин ${WITHDRAW_RATE} GRC`});try{const fpRes=await axios.post('https://faucetpay.io/api/v1/send',null,{params:{api_key:FP_API_KEY,amount:Math.floor(da),to:w,currency:FP_CURRENCY}});if(fpRes.data.status===200){u.balance-=ga; await redis('SET', `user:${username}`, JSON.stringify(u)); const ud={...u};delete ud.password_hash;return res.json({success:true,user:ud,dogeSent:Math.floor(da)});}else return res.json({success:false,error:fpRes.data.message});}catch(e){return res.json({success:false,error:'Ошибка сети FP'});} }
        
        else if (action === 'capturePost') { let p=world.map.find(p=>p.id===req.body.postId);if(!p)return res.json({success:false,error:'Пост не найден'});let pw=u.army.warriors+u.army.archers*2+u.army.cavalry*3;if(pw<50)return res.json({success:false,error:'Мало армии'});p.owner=username;u.army.warriors=Math.ceil(u.army.warriors*0.9);u.army.archers=Math.ceil(u.army.archers*0.9);u.army.cavalry=Math.ceil(u.army.cavalry*0.9); await redis('SET', 'world:main', JSON.stringify(world)); }
        else if (action === 'getLeaderboard') { const keys = await redis('KEYS', 'user:*'); let users = []; for(let k of keys) { const d = await redis('GET', k); if(d) { const usr = JSON.parse(d); users.push({username: usr.username, glory: usr.glory}); } } users.sort((a,b)=>b.glory-a.glory); await redis('SET', `user:${username}`, JSON.stringify(u)); return res.json({ success: true, leaderboard: users.slice(0, 10) }); }
        else if (action === 'sync') { await redis('SET', `user:${username}`, JSON.stringify(u)); delete u.password_hash; return res.json({ success: true, user: u, map: world.map, castleOwner: world.castle_owner, chaosEventEnd: world.chaos_event_end || 0 }); }

        // Сохраняем пользователя после любого действия
        await redis('SET', `user:${username}`, JSON.stringify(u));
        delete u.password_hash;
        return res.json({ success: true, user: u, map: world.map, castleOwner: world.castle_owner, chaosEventEnd: world.chaos_event_end || 0 });

    } catch (error) { 
        console.error(error); 
        return res.status(500).json({ success: false, error: 'Server error: ' + error.message }); 
    }
};
