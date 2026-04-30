const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Путь к файлу базы данных (на Vercel папка tmp единственная для записи)
const DB_PATH = path.join('/tmp', 'db.json');

// КОНФИГ FAUCETPAY (Внесите свои ключи)
const FP_API_KEY = 'ВАШ_API_КЛЮЧ';
const FP_CURRENCY = 'DOGE';
const MARKET_FEE = 0.05; // 5% комиссия рынка

// Инициализация БД
function getDB() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: {}, orders: [] }));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function saveDB(db) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db));
}

module.exports = async (req, res) => {
    // Настройка CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action, username, resource, amount, price, orderId } = req.body || {};

    try {
        const db = getDB();

        // Регистрация / Вход
        if (action === 'login') {
            if (!db.users[username]) {
                db.users[username] = {
                    balance: 0,
                    resources: { wood: 0, stone: 0, iron: 0, food: 100 },
                    buildings: { woodcutter: 1, mine: 0, farm: 1 }
                };
                saveDB(db);
            }
            return res.json({ success: true, user: db.users[username] });
        }

        if (!db.users[username]) return res.json({ success: false, error: 'User not found' });

        // Добыча ресурсов
        if (action === 'gather') {
            const user = db.users[username];
            user.resources.wood += user.buildings.woodcutter * 10;
            user.resources.iron += user.buildings.mine * 5;
            user.resources.food += user.buildings.farm * 20;
            saveDB(db);
            return res.json({ success: true, resources: user.resources });
        }

        // Продажа на P2P рынке
        if (action === 'sell') {
            const user = db.users[username];
            if (user.resources[resource] < amount) return res.json({ success: false, error: 'Not enough resources' });

            user.resources[resource] -= amount;
            const newOrder = {
                id: Date.now(),
                seller: username,
                resource,
                amount,
                pricePerUnit: price,
                total: amount * price
            };
            db.orders.push(newOrder);
            saveDB(db);
            return res.json({ success: true, resources: user.resources });
        }

        // Покупка на P2P рынке
        if (action === 'buy') {
            const buyer = db.users[username];
            const orderIndex = db.orders.findIndex(o => o.id === orderId);
            if (orderIndex === -1) return res.json({ success: false, error: 'Order not found' });

            const order = db.orders[orderIndex];
            if (buyer.balance < order.total) return res.json({ success: false, error: 'Not enough balance' });

            const seller = db.users[order.seller];
            
            // Перевод средств (с вычетом комиссии рынка)
            buyer.balance -= order.total;
            seller.balance += order.total * (1 - MARKET_FEE); // Продавец получает минус 5%
            
            // Передача ресурсов
            buyer.resources[order.resource] += order.amount;

            // Удаление ордера
            db.orders.splice(orderIndex, 1);
            saveDB(db);
            return res.json({ success: true, user: buyer });
        }

        // Получить все ордера рынка
        if (action === 'getMarket') {
            return res.json({ success: true, orders: db.orders });
        }

        // Вывод средств (FaucetPay API)
        if (action === 'withdraw') {
            const user = db.users[username];
            const toAddress = req.body.wallet;
            const withdrawAmount = req.body.withdrawAmount;

            if (user.balance < withdrawAmount) return res.json({ success: false, error: 'Not enough balance' });

            // Запрос к FaucetPay
            const fpRes = await axios.post('https://faucetpay.io/api/v1/send', null, {
                params: {
                    api_key: FP_API_KEY,
                    amount: Math.floor(withdrawAmount), // Сатоши/Литоши должны быть целыми
                    to: toAddress,
                    currency: FP_CURRENCY
                }
            });

            if (fpRes.data.status === 200) {
                user.balance -= withdrawAmount;
                saveDB(db);
                return res.json({ success: true, newBalance: user.balance, payout_id: fpRes.data.payout_id });
            } else {
                return res.json({ success: false, error: fpRes.data.message });
            }
        }

        return res.json({ success: false, error: 'Invalid action' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
};
