export default async function handler(req, res) {
    if (req.method === 'OPTIONS') { return res.status(200).send(); }
    if (!globalThis.db) { globalThis.db = { users: {}, inv: [], market: [], id: 1 }; }
    let db = globalThis.db;
    let body = req.body || {};

    try {
        // ВХОД
        if (req.url === '/api/login' && req.method === 'POST') {
            let e = body.email;
            if (!e || !e.includes('@')) return res.status(400).json({ e: 'EMAIL' });
            if (!db.users[e]) db.users[e] = { username: e, lvl: 1, exp: 0, expNeed: 50, hp: 100, maxHp: 100, minDmg: 5, maxDmg: 10, def: 0, gold: 0, loc: 'city' };
            return res.status(200).json(db.users[e]);
        }

        let uName = body.username;
        let u = db.users[uName];
        
        // ДАННЫЕ ИНВЕНТАРЯ
        if (req.url.startsWith('/api/player/') && req.method === 'GET') return res.status(200).json(db.users[req.url.split('/')[3]] || null);
        if (req.url.startsWith('/api/inv/') && req.method === 'GET') return res.status(200).json(db.inv.filter(i => i.owner === req.url.split('/')[3]));

        // ДЕЙСТВИЯ
        if (req.url === '/api/action' && req.method === 'POST') {
            if (!u) return res.status(403).json({ e: 'NO' });
            let r = { log: '', type: 'sys' };

            if (body.action === 'move') { u.loc = body.target; r.log = 'MOVE'; }
            else if (body.action === 'rest') { u.hp = u.maxHp; r.log = 'HEAL'; r.type = 'heal'; }
            else if (body.action === 'search') {
                if (u.hp <= 0) return res.status(400).json({ e: 'DEAD' });
                
                // Монстры (Имя, Макс HP, Мин Урон, Макс Урон, Золото, EXP, Дроп лута, Зона)
                let en = {
                    forest: [
                        { n: 'Forest Goblin', h: 40, minD: 2, maxD: 5, g: 5, e: 20, l: 'Wooden Fang', z: 1 },
                        { n: 'Mad Wolf', h: 60, minD: 4, maxD: 8, g: 10, e: 30, l: 'Wolf Skin', z: 1 }
                    ],
                    cave: [
                        { n: 'Skeleton Warrior', h: 120, minD: 8, maxD: 14, g: 20, e: 60, l: 'Rusty Sword', z: 2 },
                        { n: 'Stone Golem', h: 200, minD: 12, maxD: 20, g: 50, e: 120, l: 'Iron Ore', z: 2 }
                    ],
                    swamp: [
                        { n: 'Toxic Zombie', h: 80, minD: 6, maxD: 12, g: 15, e: 40, l: 'Poison Sac', z: 3 }
                    ],
                    necropolis: [
                        { n: 'Shadow Lich', h: 300, minD: 15, maxD: 25, g: 80, e: 200, l: 'Magic Dust', z: 3 }
                    ],
                    castle: [
                        { n: 'Arch-Demon', h: 500, minD: 25, maxD: 40, g: 200, e: 500, l: 'Demon Core', z: 4 }
                    ]
                };
                
                let list = en[u.loc];
                if (!list) return res.status(200).json({ log: 'SAFE', type: 'sys', user: u });
                
                // Спавн врага (привязываем его к сессии, чтобы бить несколько раз)
                if (!u.currentEnemy || u.currentEnemy.curHp <= 0) {
                    let e = list[Math.floor(Math.random() * list.length)];
                    u.currentEnemy = { ...e, curHp: e.h };
                    r.log = `FOUND: ${e.n} (HP: ${e.h}, Danger: ${'🟢🟡🔴'[e.z-1]})`;
                }
                
                let e = u.currentEnemy;
                
                // Урон игрока
                let pDmg = Math.floor(Math.random() * (u.maxDmg - u.minDmg + 1)) + u.minDmg;
                e.curHp -= pDmg;
                
                // Урон врага (отнимаем защиту игрока, мин 1)
                let eDmg = Math.max(1, (Math.floor(Math.random() * (e.maxD - e.minD + 1)) + e.minD) - u.def);
                u.hp -= eDmg;
                let died = false; if (u.hp <= 0) { u.hp = 10; died = true; }
                
                // Формируем лог боя
                let msg = died ? 'YOU DIED!' : `You: -${pDmg} dmg. ${e.n}: -${eDmg} dmg.`;
                
                // Проверка смерти врага
                if (e.curHp <= 0 && !died) {
                    msg += ` ${e.n} KILLED! +${e.e} EXP, +${e.g} GOLD.`;
                    u.gold += e.g;
                    let nE = u.exp + e.e;
                    if (nE >= u.expNeed) { u.lvl++; nE -= u.expNeed; u.maxHp += 25; u.minDmg += 3; u.maxDmg += 5; u.def += 1; }
                    u.exp = nE;
                    if (Math.random() < 0.8) { db.inv.push({ id: db.id++, owner: uName, name: e.l, type: 'loot' }); msg += ` LOOT: ${e.l}.`; }
                    u.currentEnemy = null; // Чистим врага
                    r.type = 'loot';
                } else { 
                    r.type = 'dmg';
                    if (!died) msg += ` (${e.curHp}/${e.h} HP left)`;
                }
                
                u.hp = u.hp; r.log = msg;
            }
            return res.status(200).json({ ...r, user: u });
        }

        // РЫНОК
        if (req.url === '/api/market' && req.method === 'GET') return res.status(200).json(db.market);
        if (req.url === '/api/market/sell' && req.method === 'POST') { let i = db.inv.findIndex(x => x.id === body.itemId && x.owner === body.username); if (i === -1) return res.status(400).json({ e: 'NO' }); let item = db.inv.splice(i, 1)[0]; db.market.push({ id: db.id++, seller: body.username, itemName: item.name, price: body.price }); return res.status(200).json({ ok: true }); }
        if (req.url === '/api/market/buy' && req.method === 'POST') { let i = db.market.findIndex(x => x.id === body.lotId); let lot = db.market[i]; if (!lot) return res.status(400).json({ e: 'SOLD' }); if (lot.seller === body.username) return res.status(400).json({ e: 'SELF' }); if (db.users[body.username].gold < lot.price) return res.status(400).json({ e: 'GOLD' }); db.users[body.username].gold -= lot.price; if (db.users[lot.seller]) db.users[lot.seller].gold += Math.ceil(lot.price * 0.95); db.inv.push({ id: db.id++, owner: body.username, name: lot.itemName, type: 'loot' }); db.market.splice(i, 1); return res.status(200).json({ ok: true }); }
    } catch (err) { return res.status(500).json({ e: 'CRASH', msg: err.message }); }
    return res.status(404).json({ e: 'NOT_FOUND' });
                    }
