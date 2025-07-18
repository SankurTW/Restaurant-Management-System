const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Razorpay
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Initialize Nodemailer
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(rateLimit({
    windowMs: process.env.RATE_LIMIT_WINDOW * 60 * 1000,
    max: process.env.RATE_LIMIT_MAX
}));

// Database connection
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'restaurant_db'
});

// Connect to database
db.connect((err) => {
    if (err) {
        console.error('Database connection failed:', err);
        return;
    }
    console.log('Connected to MySQL database');
});

// Create tables if they don't exist
const createTables = () => {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role ENUM('admin', 'staff', 'customer') DEFAULT 'customer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS menu_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            price DECIMAL(10, 2) NOT NULL,
            category VARCHAR(50) NOT NULL,
            image_url VARCHAR(255),
            available BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            customer_name VARCHAR(100) NOT NULL,
            customer_phone VARCHAR(20) NOT NULL,
            customer_email VARCHAR(100),
            total_amount DECIMAL(10, 2) NOT NULL,
            status ENUM('pending', 'preparing', 'ready', 'delivered', 'cancelled') DEFAULT 'pending',
            payment_status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
            payment_method VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            menu_item_id INT NOT NULL,
            quantity INT NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
        )`,
        `CREATE TABLE IF NOT EXISTS inventory (
            id INT AUTO_INCREMENT PRIMARY KEY,
            item_name VARCHAR(100) NOT NULL,
            quantity DECIMAL(10, 2) NOT NULL,
            unit VARCHAR(20) NOT NULL,
            min_quantity DECIMAL(10, 2) DEFAULT 10,
            cost_per_unit DECIMAL(10, 2) DEFAULT 0,
            supplier VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS payments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            payment_method VARCHAR(50) NOT NULL,
            transaction_id VARCHAR(100),
            status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS menu_inventory_mapping (
            id INT AUTO_INCREMENT PRIMARY KEY,
            menu_item_id INT NOT NULL,
            inventory_item_id INT NOT NULL,
            quantity_required DECIMAL(10, 2) NOT NULL,
            FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
            FOREIGN KEY (inventory_item_id) REFERENCES inventory(id)
        )`
    ];

    tables.forEach(table => {
        db.query(table, (err) => {
            if (err) console.error('Error creating table:', err);
        });
    });
};

createTables();

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Role-based middleware
const restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
};

// File upload middleware
const multer = require('multer');
const upload = multer({
    dest: process.env.UPLOAD_PATH,
    limits: { fileSize: process.env.MAX_FILE_SIZE }
});

// Send email notification
async function sendEmail(to, subject, text) {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            text
        });
        console.log('Email sent to', to);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// Routes

// User Authentication
app.post('/api/register', [
    body('username').notEmpty().isString(),
    body('email').isEmail(),
    body('password').isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const { username, email, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS));

        const query = 'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)';
        db.query(query, [username, email, hashedPassword, role || 'customer'], (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Username or email already exists' });
                }
                return res.status(500).json({ error: 'Registration failed' });
            }
            res.status(201).json({ message: 'User registered successfully', userId: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', [
    body('username').notEmpty().isString(),
    body('password').notEmpty()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, password } = req.body;

    const query = 'SELECT * FROM users WHERE username = ?';
    db.query(query, [username], async (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Server error' });
        }

        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = results[0];
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: process.env.JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });
    });
});

// File Upload
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const image_url = `/uploads/${req.file.filename}`;
    res.json({ image_url });
});

// Menu Items
app.get('/api/menu', (req, res) => {
    const query = 'SELECT * FROM menu_items WHERE available = true ORDER BY category, name';
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch menu items' });
        }
        res.json(results);
    });
});

app.post('/api/menu', authenticateToken, restrictTo('admin', 'staff'), [
    body('name').notEmpty().isString(),
    body('price').isFloat({ min: 0 }),
    body('category').isIn(['appetizer', 'main', 'dessert', 'beverage'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { name, description, price, category, image_url } = req.body;
    
    const query = 'INSERT INTO menu_items (name, description, price, category, image_url) VALUES (?, ?, ?, ?, ?)';
    db.query(query, [name, description, price, category, image_url], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to add menu item' });
        }
        res.status(201).json({ message: 'Menu item added successfully', id: result.insertId });
    });
});

app.put('/api/menu/:id', authenticateToken, restrictTo('admin', 'staff'), [
    body('name').notEmpty().isString(),
    body('price').isFloat({ min: 0 }),
    body('category').isIn(['appetizer', 'main', 'dessert', 'beverage'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { name, description, price, category, image_url, available } = req.body;
    
    const query = 'UPDATE menu_items SET name = ?, description = ?, price = ?, category = ?, image_url = ?, available = ? WHERE id = ?';
    db.query(query, [name, description, price, category, image_url, available, id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update menu item' });
        }
        res.json({ message: 'Menu item updated successfully' });
    });
});

app.delete('/api/menu/:id', authenticateToken, restrictTo('admin', 'staff'), (req, res) => {
    const { id } = req.params;
    
    const query = 'DELETE FROM menu_items WHERE id = ?';
    db.query(query, [id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete menu item' });
        }
        res.json({ message: 'Menu item deleted successfully' });
    });
});

// Orders
app.get('/api/orders', authenticateToken, restrictTo('admin', 'staff'), (req, res) => {
    const query = `
        SELECT o.*, 
               GROUP_CONCAT(CONCAT(mi.name, ' (', oi.quantity, ')') SEPARATOR ', ') as items
        FROM orders o
        LEFT JOIN order_items oi ON o.id = oi.order_id
        LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
        GROUP BY o.id
        ORDER BY o.created_at DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch orders' });
        }
        res.json(results);
    });
});

app.post('/api/orders', [
    body('customer_name').notEmpty().isString(),
    body('customer_phone').notEmpty().isString(),
    body('customer_email').isEmail().optional({ nullable: true }),
    body('total_amount').isFloat({ min: 0 }),
    body('items').isArray({ min: 1 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { customer_name, customer_phone, customer_email, items, total_amount, payment_method } = req.body;
    
    // Start transaction
    db.beginTransaction(async (err) => {
        if (err) {
            return res.status(500).json({ error: 'Transaction failed' });
        }

        try {
            // Insert order
            const orderQuery = 'INSERT INTO orders (customer_name, customer_phone, customer_email, total_amount, payment_method) VALUES (?, ?, ?, ?, ?)';
            const orderResult = await new Promise((resolve, reject) => {
                db.query(orderQuery, [customer_name, customer_phone, customer_email, total_amount, payment_method], (err, result) => {
                    if (err) reject(err);
                    resolve(result);
                });
            });

            const orderId = orderResult.insertId;

            // Insert order items
            const itemsQuery = 'INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES ?';
            const itemsData = items.map(item => [orderId, item.menu_item_id, item.quantity, item.price]);
            await new Promise((resolve, reject) => {
                db.query(itemsQuery, [itemsData], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Update inventory
            for (const item of items) {
                const mappingQuery = 'SELECT inventory_item_id, quantity_required FROM menu_inventory_mapping WHERE menu_item_id = ?';
                const mappings = await new Promise((resolve, reject) => {
                    db.query(mappingQuery, [item.menu_item_id], (err, results) => {
                        if (err) reject(err);
                        resolve(results);
                    });
                });

                for (const mapping of mappings) {
                    const updateQuery = 'UPDATE inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?';
                    await new Promise((resolve, reject) => {
                        db.query(updateQuery, [mapping.quantity_required * item.quantity, mapping.inventory_item_id, mapping.quantity_required * item.quantity], (err, result) => {
                            if (err || result.affectedRows === 0) reject(new Error('Insufficient inventory'));
                            resolve();
                        });
                    });
                }
            }

            // Create payment record
            const paymentQuery = 'INSERT INTO payments (order_id, amount, payment_method) VALUES (?, ?, ?)';
            await new Promise((resolve, reject) => {
                db.query(paymentQuery, [orderId, total_amount, payment_method], (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });

            // Send email notification
            if (customer_email) {
                await sendEmail(
                    customer_email,
                    `Order #${orderId} Confirmation`,
                    `Dear ${customer_name},\n\nYour order #${orderId} has been placed successfully.\nTotal: ₹${total_amount}\nItems: ${items.map(item => `${item.name} x ${item.quantity}`).join(', ')}\n\nThank you for choosing us!`
                );
            }

            db.commit((err) => {
                if (err) {
                    return db.rollback(() => {
                        res.status(500).json({ error: 'Transaction commit failed' });
                    });
                }
                res.status(201).json({ message: 'Order created successfully', orderId });
            });
        } catch (error) {
            db.rollback(() => {
                res.status(500).json({ error: error.message || 'Failed to create order' });
            });
        }
    });
});

app.put('/api/orders/:id/status', authenticateToken, restrictTo('admin', 'staff'), [
    body('status').isIn(['pending', 'preparing', 'ready', 'delivered', 'cancelled'])
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { status } = req.body;
    
    const query = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(query, [status, id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update order status' });
        }
        res.json({ message: 'Order status updated successfully' });
    });
});

// Inventory
app.get('/api/inventory', authenticateToken, restrictTo('admin', 'staff'), (req, res) => {
    const query = 'SELECT * FROM inventory ORDER BY item_name';
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch inventory' });
        }
        res.json(results);
    });
});

app.post('/api/inventory', authenticateToken, restrictTo('admin', 'staff'), [
    body('item_name').notEmpty().isString(),
    body('quantity').isFloat({ min: 0 }),
    body('unit').notEmpty().isString()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { item_name, quantity, unit, min_quantity, cost_per_unit, supplier } = req.body;
    
    const query = 'INSERT INTO inventory (item_name, quantity, unit, min_quantity, cost_per_unit, supplier) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(query, [item_name, quantity, unit, min_quantity, cost_per_unit, supplier], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to add inventory item' });
        }
        res.status(201).json({ message: 'Inventory item added successfully', id: result.insertId });
    });
});

app.put('/api/inventory/:id', authenticateToken, restrictTo('admin', 'staff'), [
    body('item_name').notEmpty().isString(),
    body('quantity').isFloat({ min: 0 }),
    body('unit').notEmpty().isString()
], (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { id } = req.params;
    const { item_name, quantity, unit, min_quantity, cost_per_unit, supplier } = req.body;
    
    const query = 'UPDATE inventory SET item_name = ?, quantity = ?, unit = ?, min_quantity = ?, cost_per_unit = ?, supplier = ? WHERE id = ?';
    db.query(query, [item_name, quantity, unit, min_quantity, cost_per_unit, supplier, id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to update inventory item' });
        }
        res.json({ message: 'Inventory item updated successfully' });
    });
});

app.delete('/api/inventory/:id', authenticateToken, restrictTo('admin', 'staff'), (req, res) => {
    const { id } = req.params;
    
    const query = 'DELETE FROM inventory WHERE id = ?';
    db.query(query, [id], (err) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to delete inventory item' });
        }
        res.json({ message: 'Inventory item deleted successfully' });
    });
});

// Payments
app.get('/api/payments', authenticateToken, restrictTo('admin', 'staff'), (req, res) => {
    const query = `
        SELECT p.*, o.customer_name, o.customer_phone 
        FROM payments p
        JOIN orders o ON p.order_id = o.id
        ORDER BY p.created_at DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to fetch payments' });
        }
        res.json(results);
    });
});

app.post('/api/payments/create-razorpay-order', async (req, res) => {
    const { orderId, amount } = req.body;
    try {
        const order = await razorpay.orders.create({
            amount: amount * 100, // Razorpay expects amount in paise
            currency: 'INR',
            receipt: `order_${orderId}`
        });
        res.json({ id: order.id, amount: order.amount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create Razorpay order' });
    }
});

app.post('/api/payments/:id/process', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { transaction_id, status } = req.body;
    
    // Start transaction
    db.beginTransaction((err) => {
        if (err) {
            return res.status(500).json({ error: 'Transaction failed' });
        }

        // Update payment
        const paymentQuery = 'UPDATE payments SET transaction_id = ?, status = ? WHERE order_id = ?';
        db.query(paymentQuery, [transaction_id, status, id], (err) => {
            if (err) {
                return db.rollback(() => {
                    res.status(500).json({ error: 'Failed to update payment' });
                });
            }

            // Update order payment status
            const orderQuery = 'UPDATE orders SET payment_status = ? WHERE id = ?';
            db.query(orderQuery, [status, id], (err) => {
                if (err) {
                    return db.rollback(() => {
                        res.status(500).json({ error: 'Failed to update order payment status' });
                    });
                }

                db.commit((err) => {
                    if (err) {
                        return db.rollback(() => {
                            res.status(500).json({ error: 'Transaction commit failed' });
                        });
                    }
                    res.json({ message: 'Payment processed successfully' });
                });
            });
        });
    });
});

// Dashboard Analytics
app.get('/api/dashboard', authenticateToken, (req, res) => {
    const queries = {
        totalOrders: 'SELECT COUNT(*) as count FROM orders',
        totalRevenue: 'SELECT SUM(total_amount) as total FROM orders WHERE payment_status = "completed"',
        pendingOrders: 'SELECT COUNT(*) as count FROM orders WHERE status = "pending"',
        menuItems: 'SELECT COUNT(*) as count FROM menu_items WHERE available = true',
        lowStock: 'SELECT COUNT(*) as count FROM inventory WHERE quantity <= min_quantity',
        todayOrders: 'SELECT COUNT(*) as count FROM orders WHERE DATE(created_at) = CURDATE()'
    };

    const results = {};
    let completedQueries = 0;

    Object.keys(queries).forEach(key => {
        db.query(queries[key], (err, result) => {
            if (err) {
                results[key] = 0;
            } else {
                results[key] = result[0].count || result[0].total || 0;
            }
            
            completedQueries++;
            if (completedQueries === Object.keys(queries).length) {
                res.json(results);
            }
        });
    });
});

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT} to view the application`);
});

module.exports = app;