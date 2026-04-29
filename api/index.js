import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Скрытая база данных (в оперативной памяти сервера)
let db = {
    users: {},
    market: [],
    tickets: []
};

const FAUCETPAY_API_KEY = process.env.FAUCETPAY_API_KEY || "ВАШ_КЛЮЧ_СЮДА_ПОТОМ";
const EXCHANGE_RATE = 1000;

// --- API АВТОРИЗАЦИИ ---
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!db.users[username]) {
        db.users[username] = { gold: 100, inventory: [] };
    }
    res.json({ success: true, user: db.users[username] });
});

// --- API ГЕЙМПЛЕЯ ---
app.post('/api/fight', (req, res) => {
    const { username } = req.body;
    const user = db.users[username];
    const lootTable = ["Ржавый меч", "Зелье здоровья", "Кость гоблина", "Легендарный топор"];
    const loot = lootTable[Math.floor(Math.random() * lootTable.length)];
    
    user.inventory.push(loot);
    res.json({ success: true, message: `Выбили: ${loot}`, user });
});

// --- API P2P РЫНКА ---
app.post('/api/market/sell', (req, res) => {
    const { username, itemIndex, price } = req.body;
    const user = db.users[username];
    
    if (user.inventory.length <= itemIndex) return res.status(400).json({ error: "Нет предмета" });
    
    const item = user.inventory.splice(itemIndex, 1)[0];
    db.market.push({ id: Date.now(), seller: username, itemName: item, price: parseInt(price) });
    res.json({ success: true, message: "Выставлено", user, market: db.market });
});

app.post('/api/market/buy', (req, res) => {
    const { username, lotId } = req.body;
    const buyer = db.users[username];
    const lotIndex = db.market.findIndex(m => m.id === lotId);
    const lot = db.market[lotIndex];

    if (!lot || lot.seller === username) return res.status(400).json({ error: "Нельзя купить" });
    if (buyer.gold < lot.price) return res.status(400).json({ error: "Мало золота" });

    // Транзакция
    buyer.gold -= lot.price;
    const fee = Math.floor(lot.price * 0.05); // 5% комиссии сжигается
    db.users[lot.seller].gold += (lot.price - fee);
    buyer.inventory.push(lot.itemName);
    db.market.splice(lotIndex, 1); // Удаляем лот

    res.json({ success: true, message: `Куплено! Комиссия: ${fee}`, user: buyer, market: db.market });
});

// --- API ВЫВОДА СРЕДСТВ (ЧЕРЕЗ FAUCETPAY) ---
app.post('/api/withdraw', async (req, res) => {
    const { username, email, amountGold } = req.body;
    const user = db.users[username];

    if (user.gold < amountGold) return res.status(400).json({ error: "Недостаточно золота" });
    if (amountGold < 1000) return res.status(400).json({ error: "Миним 1000" });

    const fee = Math.floor(amountGold * 0.10); // 10% комиссии за вывод
    const netGold = amountGold - fee;
    const amountUSDT = (netGold / EXCHANGE_RATE).toFixed(2);

    try {
        // ОТПРАВЛЯЕМ ЗАПРОС НА РЕАЛЬНЫЙ ВЫВОД FAUCETPAY
        const response = await axios.post('https://faucetpay.io/api/v1/send', new URLSearchParams({
            api_key: FAUCETPAY_API_KEY,
            to: email,
            amount: amountUSDT,
            currency: 'USDT' // или LTC/DOGE в зависимости от того, что у вас настроено
        }));

        if (response.data.status === 200) {
            // Если FaucetPay ответил успехом -> списываем золото
            user.gold -= amountGold;
            res.json({ success: true, message: `Выплачено ${amountUSDT} USDT! ТХ ID: ${response.data.payment_id}`, user });
        } else {
            res.status(400).json({ error: response.data.message || "Ошибка FaucetPay" });
        }
    } catch (err) {
        res.status(500).json({ error: "Серверная ошибка: " + err.message });
    }
});

// Отдаем текущее состояние рынка и пользователя
app.post('/api/sync', (req, res) => {
    const { username } = req.body;
    res.json({ user: db.users[username], market: db.market });
});

export default app;
