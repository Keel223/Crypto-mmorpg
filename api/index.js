const app = require("express")();
const cors = require("cors");
app.use(cors());
app.use(express.json());

let db = {users:{}, inv:[], market:[], id:1};

app.post("/api/register", (req, res) => {
    try {
        let u = req.body.username;
        let p = req.body.password;
        if (!u || !p || u.length < 3) return res.status(400).json({e: "SHORT"});
        if (db.users[u]) return res.status(400).json({e: "TAKEN"});
        db.users[u] = {username:u, password:p, lvl:1, exp:0, expNeed:50, hp:100, maxHp:100, minDmg:5, maxDmg:10, def:0, gold:0, loc:"city"};
        res.json({ok: true});
    } catch(e) { res.status(500).json({e: "ERR"}); }
});

app.post("/api/login", (req, res) => {
    try {
        let u = db.users[req.body.username];
        if (!u || u.password !== req.body.password) return res.status(400).json({e: "WRONG"});
        res.json(u);
    } catch(e) { res.status(500).json({e: "ERR"}); }
});

app.get("/api/player/:u", (req, res) => res.json(db.users[req.params.u] || null));

app.get("/api/inv/:u", (req, res) => res.json(db.inv.filter(i => i.owner === req.params.u)));

app.post("/api/action", (req, res) => {
    try {
        let u = db.users[req.body.username];
        if (!u) return res.status(403).json({e: "NOAUTH"});
        let r = {log: "", type: "sys"};

        if (req.body.action === "move") {
            u.loc = req.body.target;
            r.log = "MOVE " + u.loc;
        } 
        else if (req.body.action === "rest") {
            u.hp = u.maxHp;
            r.log = "HEAL";
            r.type = "heal";
        } 
        else if (req.body.action === "search") {
            if (u.hp <= 0) return res.status(400).json({e: "DEAD"});
            
            let en = {
                forest: [{n:"Gob",h:30,d:5,e:15,l:"Fang"},{n:"Wolf",h:50,d:8,e:25,l:"Skin"}],
                cave: [{n:"Skel",h:80,d:12,e:50,l:"Sword"},{n:"Golem",h:150,d:18,e:100,l:"Armor"}],
                swamp: [{n:"Zomb",h:60,d:10,e:30,l:"Toxin"}],
                necropolis: [{n:"Lich",h:200,d:25,e:200,l:"Staff"}],
                castle: [{n:"Demon",h:300,d:35,e:500,l:"FireSword"}]
            };
            
            let list = en[u.loc];
            if (!list) return res.json({log: "SAFE", type: "sys", user: u});
            
            let e = list[Math.floor(Math.random() * list.length)];
            let pD = Math.floor(Math.random() * (u.maxDmg - u.minDmg + 1)) + u.minDmg;
            let eD = Math.max(1, e.d - u.def);
            let nHp = u.hp - eD;
            let died = false;
            if (nHp <= 0) { nHp = 10; died = true; }
            
            let msg = died ? "DIED" : "HIT";
            
            if ((e.h - pD) <= 0 && !died) {
                msg += " KILL+" + e.e;
                let nE = u.exp + e.e;
                if (nE >= u.expNeed) { u.lvl++; nE -= u.expNeed; u.maxHp += 20; u.minDmg += 2; u.maxDmg += 4; }
                u.exp = nE;
                if (Math.random() < 0.7) {
                    db.inv.push({id: db.id++, owner: u.username, name: e.l, type: "trash"});
                    msg += " LOOT:" + e.l;
                }
                r.type = "loot";
            } else { r.type = "dmg"; }
            u.hp = nHp;
            r.log = msg;
        }
        res.json({...r, user: u});
    } catch(e) { res.status(500).json({e: "ERR"}); }
});

app.get("/api/market", (req, res) => res.json(db.market));

app.post("/api/market/sell", (req, res) => {
    try {
        let i = db.inv.findIndex(x => x.id === req.body.itemId && x.owner === req.body.username);
        if (i === -1) return res.status(400).json({e: "NOITEM"});
        let item = db.inv.splice(i, 1)[0];
        db.market.push({id: db.id++, seller: req.body.username, itemName: item.name, price: req.body.price});
        res.json({ok: true});
    } catch(e) { res.status(500).json({e: "ERR"}); }
});

app.post("/api/market/buy", (req, res) => {
    try {
        let i = db.market.findIndex(x => x.id === req.body.lotId);
        let lot = db.market[i];
        if (!lot) return res.status(400).json({e: "SOLD"});
        if (lot.seller === req.body.username) return res.status(400).json({e: "SELF"});
        if (db.users[req.body.username].gold < lot.price) return res.status(400).json({e: "GOLD"});
        
        db.users[req.body.username].gold -= lot.price;
        if (db.users[lot.seller]) db.users[lot.seller].gold += Math.ceil(lot.price * 0.95);
        db.inv.push({id: db.id++, owner: req.body.username, name: lot.itemName, type: "trash"});
        db.market.splice(i, 1);
        res.json({ok: true, log: "BOUGHT"});
    } catch(e) { res.status(500).json({e: "ERR"}); }
});

module.exports = app;
