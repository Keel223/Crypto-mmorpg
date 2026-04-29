const app = require("express")();
const cors = require("cors");

app.use(cors());
app.use(express.json());

let db = { users: {}, inventory: [], market: [], nextItemId: 1 };

const FAUCETPAY_API_KEY = "ТВОЙ_КЛЮЧ";
const FAUCETPAY_CURRENCY = "BTC";
const cooldowns = new Set();

app.post("/api/register", (req, res) => {
    try {
        const u = req.body.username;
        const p = req.body.password;
        if (!u || !p || u.length < 3) return res.status(400).json({ error: "Short" });
        if (db.users[u]) return res.status(400).json({ error: "Taken" });
        
        db.users[u] = { username: u, password: p, lvl: 1, exp: 0, expNeed: 50, hp: 100, maxHp: 100, minDmg: 5, maxDmg: 10, def: 0, gold: 0, loc: "city" };
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

app.post("/api/login", (req, res) => {
    try {
        const u = req.body.username;
        const p = req.body.password;
        const user = db.users[u];
        if (!user || user.password !== p) return res.status(400).json({ error: "Wrong" });
        res.json(user);
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

app.get("/api/player/:username", (req, res) => {
    res.json(db.users[req.params.username] || null);
});

app.get("/api/inventory/:username", (req, res) => {
    res.json(db.inventory.filter(i => i.owner === req.params.username));
});

app.post("/api/action", (req, res) => {
    try {
        const username = req.body.username;
        const action = req.body.action;
        const target = req.body.target;
        let user = db.users[username];
        if (!user) return res.status(403).json({ error: "NoAuth" });
        
        let result = { log: "", type: "sys" };

        if (action === "move") {
            user.loc = target;
            result.log = "Move " + target;
        } 
        else if (action === "rest") {
            user.hp = user.maxHp;
            result.log = "Healed"; 
            result.type = "heal";
        } 
        else if (action === "search") {
            if (cooldowns.has(username)) return res.status(429).json({ error: "Fast" });
            cooldowns.add(username);
            setTimeout(() => cooldowns.delete(username), 1000);

            if (user.hp <= 0) return res.status(400).json({ error: "Dead" });

            const enemies = {
                forest: [{name:"Gob",hp:30,dmg:5,exp:15,loot:["Fang"]}, {name:"Wolf",hp:50,dmg:8,exp:25,loot:["Skin"]}],
                cave: [{name:"Skel",hp:80,dmg:12,exp:50,loot:["Sword"]}, {name:"Golem",hp:150,dmg:18,exp:100,loot:["Armor"]}],
                swamp: [{name:"Zomb",hp:60,dmg:10,exp:30,loot:["Toxin"]}],
                necropolis: [{name:"Lich",hp:200,dmg:25,exp:200,loot:["Staff"]}],
                castle: [{name:"Demon",hp:300,dmg:35,exp:500,loot:["FireSword"]}]
            };
            
            const locEnemies = enemies[user.loc];
            if(!locEnemies) return res.json({log: "Safe", type: "sys", user: user});
            
            const e = locEnemies[Math.floor(Math.random() * locEnemies.length)];
            let pDmg = Math.floor(Math.random() * (user.maxDmg - user.minDmg + 1)) + user.minDmg;
            let eDmg = Math.max(1, e.dmg - user.def);
            let newHp = user.hp - eDmg;
            let died = false;
            if (newHp <= 0) { newHp = 10; died = true; }
            
            let logMsg = died ? "Killed" : "Hit. Enemy hit.";
            
            if ((e.hp - pDmg) <= 0 && !died) {
                logMsg += " Killed +" + e.exp + " EXP.";
                let newExp = user.exp + e.exp;
                if (newExp >= user.expNeed) { user.lvl++; newExp -= user.expNeed; user.maxHp += 20; user.minDmg += 2; user.maxDmg += 4; }
                user.exp = newExp;
                
                if (Math.random() < 0.7) {
                    const lootName = e.loot[Math.floor(Math.random() * e.loot.length)];
                    db.inventory.push({ id: db.nextItemId++, owner: username, name: lootName, type: "trash", dmg: 0, def: 0 });
                    logMsg += " Loot: " + lootName;
                }
                result.type = "loot";
            } else { 
                result.type = "dmg"; 
            }
            user.hp = newHp;
            result.log = logMsg;
        }
        
        res.json({ ...result, user: user });
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

app.get("/api/market", (req, res) => {
    res.json(db.market);
});

app.post("/api/market/sell", (req, res) => {
    try {
        const username = req.body.username;
        const itemId = req.body.itemId;
        const price = req.body.price;
        if (price < 1) return res.status(400).json({ error: "Price" });
        
        const itemIndex = db.inventory.findIndex(i => i.id === itemId && i.owner === username);
        if (itemIndex === -1) return res.status(400).json({ error: "NoItem" });
        
        const item = db.inventory.splice(itemIndex, 1)[0];
        db.market.push({ id: db.nextItemId++, seller: username, itemName: item.name, type: item.type, dmg: item.dmg, def: item.def, price: price });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

app.post("/api/market/buy", (req, res) => {
    try {
        const username = req.body.username;
        const lotId = req.body.lotId;
        const lotIndex = db.market.findIndex(l => l.id === lotId);
        const lot = db.market[lotIndex];
        
        if (!lot) return res.status(400).json({ error: "SoldOut" });
        if (lot.seller === username) return res.status(400).json({ error: "Self" });
        if (db.users[username].gold < lot.price) return res.status(400).json({ error: "NoGold" });

        db.users[username].gold -= lot.price;
        if(db.users[lot.seller]) db.users[lot.seller].gold += Math.ceil(lot.price * 0.95);
        db.inventory.push({ id: db.nextItemId++, owner: username, name: lot.itemName, type: lot.type, dmg: lot.dmg, def: lot.def });
        db.market.splice(lotIndex, 1);
        res.json({ success: true, log: "Bought" });
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

app.post("/api/faucet/withdraw", async (req, res) => {
    try {
        const username = req.body.username;
        const email = req.body.email;
        const goldToWithdraw = req.body.goldToWithdraw;
        let user = db.users[username];
        
        if (user.gold < goldToWithdraw || goldToWithdraw < 1000) return res.status(400).json({ error: "Min1000" });
        const satoshiToSend = Math.floor(goldToWithdraw / 10);

        const fpRes = await fetch("https://faucetpay.io/api/v1/send", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: FAUCETPAY_API_KEY, to: email, amount: satoshiToSend, currency: FAUCETPAY_CURRENCY })
        });
        const fpData = await fpRes.json();

        if (fpData.status === 200) {
            user.gold -= goldToWithdraw;
            res.json({ success: true, message: "Done" });
        } else {
            res.status(400).json({ error: fpData.message });
        }
    } catch (e) {
        res.status(500).json({ error: "Err" });
    }
});

module.exports = app;
