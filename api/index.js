export default async function handler(req, res) {
    // Настройка CORS для любых запросов
    if (req.method === 'OPTIONS') {
        return res.status(200).send();
    }

    // Инициализация базы в памяти
    if (!globalThis.db) {
        globalThis.db = { users: {}, inv: [], market: [], id: 1 };
    }
    let db = globalThis.db;

    // Парсинг тела запроса
    let body = {};
    if (req.body && typeof req.body === 'object') {
        body = req.body;
    }

    try {
        // Роут: ВХОД
        if (req.url === '/api/login' && req.method === 'POST') {
            let email = body.email;
            if (!email || !email.includes('@')) return res.status(400).json({ e: 'EMAIL' });
            if (!db.users[email]) {
                db.users[email] = { username: email, lvl: 1, exp: 0, expNeed: 50, hp: 100, maxHp: 100, minDmg: 5, maxDmg: 10, def: 0, gold: 0, loc: 'city' };
            }
            return res.status(200).json(db.users[email]);
        }

        // Роут: ДАННЫЕ ИГРОКА
        if (req.url.startsWith('/api/player/') && req.method === 'GET') {
            let u = req.url.split('/')[3];
            return res.status(200).json(db.users[u] || null);
        }

        // Роут: ИНВЕНТАРЬ
        if (req.url.startsWith('/api/inv/') && req.method === 'GET') {
            let u = req.url.split('/')[3];
            return res.status(200).json(db.inv.filter(i => i.owner === u));
        }

        // Роут: ДЕЙСТВИЯ
        if (req.url === '/api/action' && req.method === 'POST') {
            let u = db.users[body.username];
            if (!u) return res.status(403).json({ e: 'NO' });
            let r = { log: '', type: 'sys' };

            if (body.action === 'move') { u.loc = body.target; r.log = 'MOVE'; }
            else if (body.action === 'rest') { u.hp = u.maxHp; r.log = 'HEAL'; r.type = 'heal'; }
            else if (body.action === 'search') {
                if (u.hp <= 0) return res.status(400).json({ e: 'DEAD' });
                let en = { forest: [{ n: 'G', h: 30, d: 5, e: 15, l: 'F' }, { n: 'W', h: 50, d: 8, e: 25, l: 'S' }], cave: [{ n: 'S', h: 80, d: 12, e: 50, l: 'Sw' }], swamp: [{ n: 'Z', h: 60, d: 10, e: 30, l: 'T' }], necropolis: [{ n: 'L', h: 200, d: 25, e: 200, l: 'St' }], castle: [{ n: 'D', h: 300, d: 35, e: 500, l: 'F' }] };
                let list = en[u.loc];
                if (!list) return res.status(200).json({ log: 'SAFE', type: 'sys', user: u });
                let e = list[Math.floor(Math.random() * list.length)];
                let pD = Math.floor(Math.random() * (u.maxDmg - u.minDmg + 1)) + u.minDmg;
                let eD = Math.max(1, e.d - u.def);
                let nHp = u.hp - eD; let died = false; if (nHp <= 0) { nHp = 10; died = true; }
                let msg = died ? 'DIED' : 'HIT';
                if ((e.h - pD) <= 0 && !died) {
                    msg += ' KILL+' + e.e;
                    let nE = u.exp + e.e;
                    if (nE >= u.expNeed) { u.lvl++; nE -= u.expNeed; u.maxHp += 20; u.minDmg += 2; u.maxDmg += 4; }
                    u.exp = nE;
                    if (Math.random() < 0.7) { db.inv.push({ id: db.id++, owner: u.username, name: e.l, type: 'trash' }); msg += ' LOOT:' + e.l; }
                    r.type = 'loot';
                } else { r.type = 'dmg'; }
                u.hp = nHp; r.log = msg;
            }
            return res.status(200).json({ ...r, user: u });
        }

        // Роут: РЫНОК
        if (req.url === '/api/market' && req.method === 'GET') {
            return res.status(200).json(db.market);
        }
        if (req.url === '/api/market/sell' && req.method === 'POST') {
            let i = db.inv.findIndex(x => x.id === body.itemId && x.owner === body.username);
            if (i === -1) return res.status(400).json({ e: 'NO' });
            let item = db.inv.splice(i, 1)[0];
            db.market.push({ id: db.id++, seller: body.username, itemName: item.name, price: body.price });
            return res.status(200).json({ ok: true });
        }
        if (req.url === '/api/market/buy' && req.method === 'POST') {
            let i = db.market.findIndex(x => x.id === body.lotId);
            let lot = db.market[i];
            if (!lot) return res.status(400).json({ e: 'SOLD' });
            if (lot.seller === body.username) return res.status(400).json({ e: 'SELF' });
            if (db.users[body.username].gold < lot.price) return res.status(400).json({ e: 'GOLD' });
            db.users[body.username].gold -= lot.price;
            if (db.users[lot.seller]) db.users[lot.seller].gold += Math.ceil(lot.price * 0.95);
            db.inv.push({ id: db.id++, owner: body.username, name: lot.itemName, type: 'trash' });
            db.market.splice(i, 1);
            return res.status(200).json({ ok: true });
        }

    } catch (err) {
        return res.status(500).json({ e: 'CRASH', msg: err.message });
    }

    return res.status(404).json({ e: 'NOT_FOUND' });
}
