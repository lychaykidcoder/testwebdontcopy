const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();

const DB_PATH = path.join(__dirname, 'db.json');

// --- Middleware ---
app.use(express.json());
app.use(express.static('views'));

// --- Database Helper Functions ---
function readDB() {
    try {
        if (!fs.existsSync(DB_PATH)) {
            // If db.json doesn't exist, create it with a default structure
            fs.writeFileSync(DB_PATH, JSON.stringify({ users: [], orders: [], tickets: [] }, null, 2));
        }
        const dbRaw = fs.readFileSync(DB_PATH);
        return JSON.parse(dbRaw);
    } catch (error) {
        console.error("Error reading or creating DB:", error);
        // Return a default structure if there's a parsing error
        return { users: [], orders: [], tickets: [] };
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// --- Auth Route ---
app.get('/auth/telegram/callback', (req, res) => {
    try {
        const db = readDB();
        const authData = req.query;
        const checkHash = authData.hash;
        delete authData.hash;
        const dataCheckString = Object.keys(authData).sort().map(key => `${key}=${authData[key]}`).join('\n');
        const secretKey = crypto.createHash('sha256').update(process.env.BOT_TOKEN).digest();
        const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

        if (hmac !== checkHash) {
            return res.status(400).send('<h1>Error: Invalid Data</h1>');
        }

        const userUsername = authData.username || '';
        let userIndex = db.users.findIndex(u => u.id == authData.id);

        let user;
        if (userIndex === -1) {
            user = { id: parseInt(authData.id, 10), first_name: authData.first_name, username: userUsername, role: 'user' };
            db.users.push(user);
        } else {
            user = db.users[userIndex];
        }
        
        user.role = userUsername.toLowerCase() === 'aurorastore_safe' ? 'admin' : 'user';
        writeDB(db);

        res.send(`<script>window.opener.handleTelegramLogin(${JSON.stringify(user)}); window.close();</script>`);
    } catch (error) {
        console.error(error);
        res.status(500).send('<h1>Internal Server Error</h1>');
    }
});

// --- API ROUTES ---

// GET all data for a user
app.get('/api/data/:userId', (req, res) => {
    const db = readDB();
    const userId = parseInt(req.params.userId, 10);
    const user = db.users.find(u => u.id === userId);

    if (!user) return res.status(404).json({ message: 'User not found' });

    const data = {
        orders: db.orders.filter(o => o.buyerId === userId),
        tickets: db.tickets.filter(t => t.userId === userId || t.userId === 'all')
    };
    
    if (user.role === 'admin') {
        data.adminData = {
            allOrders: db.orders,
            allTickets: db.tickets,
            allUsers: db.users
        };
    }
    
    res.json(data);
});

// POST a new order
app.post('/api/orders', (req, res) => {
    const db = readDB();
    const newOrder = req.body;
    newOrder.id = `order_${Date.now()}`;
    db.orders.push(newOrder);
    writeDB(db);
    res.json({ success: true, order: newOrder });
});

// UPDATE an order (for payment status and fulfillment)
app.put('/api/orders/:orderId', (req, res) => {
    const db = readDB();
    const updatedData = req.body;
    const orderIndex = db.orders.findIndex(o => o.id === req.params.orderId);

    if (orderIndex > -1) {
        db.orders[orderIndex] = { ...db.orders[orderIndex], ...updatedData };
        writeDB(db);
        res.json({ success: true, order: db.orders[orderIndex] });
    } else {
        res.status(404).json({ success: false, message: 'Order not found' });
    }
});

// POST a new ticket or reply
app.post('/api/tickets', (req, res) => {
    const db = readDB();
    const { userId, subject, message } = req.body;
    const newTicket = {
        ticketId: `t_${Date.now()}`,
        userId,
        subject,
        status: 'open',
        createdAt: new Date().toISOString(),
        messages: [{ senderId: userId, text: message, timestamp: new Date().toISOString() }]
    };
    db.tickets.push(newTicket);
    writeDB(db);
    res.json({ success: true, ticket: newTicket });
});

app.post('/api/tickets/:ticketId/reply', (req, res) => {
    const db = readDB();
    const { senderId, text } = req.body;
    const ticketIndex = db.tickets.findIndex(t => t.ticketId === req.params.ticketId);
    if (ticketIndex > -1) {
        db.tickets[ticketIndex].messages.push({ senderId, text, timestamp: new Date().toISOString() });
        db.tickets[ticketIndex].status = 'open'; // Re-open ticket on reply
        writeDB(db);
        res.json({ success: true, ticket: db.tickets[ticketIndex] });
    } else {
        res.status(404).json({ success: false, message: 'Ticket not found' });
    }
});

// ADMIN actions
app.post('/api/admin/message', (req, res) => {
    const db = readDB();
    const { adminId, target, subject, message } = req.body;
    if (target === 'all') { // Broadcast
        const announcement = {
            ticketId: `t_${Date.now()}`,
            userId: 'all',
            subject: `[សេចក្តីជូនដំណឹង] ${subject}`,
            status: 'closed',
            createdAt: new Date().toISOString(),
            messages: [{ senderId: adminId, text: message, timestamp: new Date().toISOString() }]
        };
        db.tickets.push(announcement);
    } else { // Direct message
        const dm = {
            ticketId: `t_${Date.now()}`,
            userId: parseInt(target, 10),
            subject,
            status: 'open',
            createdAt: new Date().toISOString(),
            messages: [{ senderId: adminId, text: message, timestamp: new Date().toISOString() }]
        };
        db.tickets.push(dm);
    }
    writeDB(db);
    res.json({ success: true });
});

// Start server
const listener = app.listen(process.env.PORT || 3000, () => {
    console.log('Your app is listening on port ' + listener.address().port);
});