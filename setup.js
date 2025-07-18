const mysql = require('mysql2');
const bcrypt = require('bcrypt');
require('dotenv').config();

console.log('🚀 Setting up Restaurant Management System Database...\n');

// Create database connection without database selected
const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || ''
});

// Create database if it doesn't exist
const createDatabase = () => {
    return new Promise((resolve, reject) => {
        const dbName = process.env.DB_NAME || 'restaurant_db';
        connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`, (err) => {
            if (err) {
                reject(err);
            } else {
                console.log(`✅ Database '${dbName}' created successfully`);
                resolve();
            }
        });
    });
};

// Use the database
const useDatabase = () => {
    return new Promise((resolve, reject) => {
        const dbName = process.env.DB_NAME || 'restaurant_db';
        connection.query(`USE ${dbName}`, (err) => {
            if (err) {
                reject(err);
            } else {
                console.log(`✅ Using database '${dbName}'`);
                resolve();
            }
        });
    });
};

// Create tables
const createTables = () => {
    return new Promise((resolve, reject) => {
        const tables = [
            {
                name: 'users',
                query: `CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) UNIQUE NOT NULL,
                    email VARCHAR(100) UNIQUE NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    role ENUM('admin', 'staff', 'customer') DEFAULT 'customer',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`
            },
            {
                name: 'menu_items',
                query: `CREATE TABLE IF NOT EXISTS menu_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    price DECIMAL(10, 2) NOT NULL,
                    category VARCHAR(50) NOT NULL,
                    image_url VARCHAR(255),
                    available BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )`
            },
            {
                name: 'orders',
                query: `CREATE TABLE IF NOT EXISTS orders (
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
                )`
            },
            {
                name: 'order_items',
                query: `CREATE TABLE IF NOT EXISTS order_items (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    order_id INT NOT NULL,
                    menu_item_id INT NOT NULL,
                    quantity INT NOT NULL,
                    price DECIMAL(10, 2) NOT NULL,
                    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
                    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id)
                )`
            },
            {
                name: 'inventory',
                query: `CREATE TABLE IF NOT EXISTS inventory (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    item_name VARCHAR(100) NOT NULL,
                    quantity DECIMAL(10, 2) NOT NULL,
                    unit VARCHAR(20) NOT NULL,
                    min_quantity DECIMAL(10, 2) DEFAULT 10,
                    cost_per_unit DECIMAL(10, 2) DEFAULT 0,
                    supplier VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )`
            },
            {
                name: 'payments',
                query: `CREATE TABLE IF NOT EXISTS payments (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    order_id INT NOT NULL,
                    amount DECIMAL(10, 2) NOT NULL,
                    payment_method VARCHAR(50) NOT NULL,
                    transaction_id VARCHAR(100),
                    status ENUM('pending', 'completed', 'failed') DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
                )`
            },
            {
                name: 'menu_inventory_mapping',
                query: `CREATE TABLE IF NOT EXISTS menu_inventory_mapping (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    menu_item_id INT NOT NULL,
                    inventory_item_id INT NOT NULL,
                    quantity_required DECIMAL(10, 2) NOT NULL,
                    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
                    FOREIGN KEY (inventory_item_id) REFERENCES inventory(id)
                )`
            }
        ];

        let completedQueries = 0;
        tables.forEach(table => {
            connection.query(table.query, (err) => {
                if (err) {
                    console.error(`❌ Error creating table '${table.name}':`, err);
                    reject(err);
                } else {
                    console.log(`✅ Table '${table.name}' created successfully`);
                    completedQueries++;
                    if (completedQueries === tables.length) {
                        resolve();
                    }
                }
            });
        });
    });
};

// Insert sample data
const insertSampleData = async () => {
    try {
        // Insert sample user (admin)
        const hashedPassword = await bcrypt.hash('admin123', parseInt(process.env.BCRYPT_ROUNDS || 10));
        const userQuery = `INSERT IGNORE INTO users (username, email, password, role) VALUES (?, ?, ?, ?)`;
        await new Promise((resolve, reject) => {
            connection.query(userQuery, ['admin', 'admin@example.com', hashedPassword, 'admin'], (err) => {
                if (err) reject(err);
                console.log('✅ Sample admin user inserted');
                resolve();
            });
        });

        // Insert sample menu items
        const menuItems = [
            ['Margherita Pizza', 'Classic pizza with tomato and mozzarella', 250.00, 'main', null],
            ['Caesar Salad', 'Fresh romaine with Caesar dressing', 150.00, 'appetizer', null],
            ['Chocolate Lava Cake', 'Warm cake with molten chocolate center', 120.00, 'dessert', null],
            ['Mango Lassi', 'Creamy mango yogurt drink', 80.00, 'beverage', null]
        ];
        const menuQuery = `INSERT IGNORE INTO menu_items (name, description, price, category, image_url) VALUES ?`;
        await new Promise((resolve, reject) => {
            connection.query(menuQuery, [menuItems], (err) => {
                if (err) reject(err);
                console.log('✅ Sample menu items inserted');
                resolve();
            });
        });

        // Insert sample inventory items
        const inventoryItems = [
            ['Flour', 50.00, 'kg', 10.00, 20.00, 'Local Supplier'],
            ['Mozzarella Cheese', 20.00, 'kg', 5.00, 150.00, 'Dairy Co'],
            ['Tomato', 30.00, 'kg', 10.00, 30.00, 'Farm Fresh'],
            ['Romaine Lettuce', 15.00, 'kg', 5.00, 50.00, 'Farm Fresh'],
            ['Chocolate', 10.00, 'kg', 2.00, 200.00, 'Sweet Imports'],
            ['Mango Pulp', 25.00, 'liters', 5.00, 100.00, 'Fruit Co']
        ];
        const inventoryQuery = `INSERT IGNORE INTO inventory (item_name, quantity, unit, min_quantity, cost_per_unit, supplier) VALUES ?`;
        await new Promise((resolve, reject) => {
            connection.query(inventoryQuery, [inventoryItems], (err) => {
                if (err) reject(err);
                console.log('✅ Sample inventory items inserted');
                resolve();
            });
        });

        // Insert sample menu-inventory mappings
        const mappings = [
            [1, 1, 0.2], // Margherita Pizza: 0.2 kg Flour
            [1, 2, 0.1], // Margherita Pizza: 0.1 kg Mozzarella
            [1, 3, 0.1], // Margherita Pizza: 0.1 kg Tomato
            [2, 4, 0.2], // Caesar Salad: 0.2 kg Romaine Lettuce
            [3, 5, 0.1], // Chocolate Lava Cake: 0.1 kg Chocolate
            [4, 6, 0.3]  // Mango Lassi: 0.3 liters Mango Pulp
        ];
        const mappingQuery = `INSERT IGNORE INTO menu_inventory_mapping (menu_item_id, inventory_item_id, quantity_required) VALUES ?`;
        await new Promise((resolve, reject) => {
            connection.query(mappingQuery, [mappings], (err) => {
                if (err) reject(err);
                console.log('✅ Sample menu-inventory mappings inserted');
                resolve();
            });
        });

        console.log('✅ Sample data inserted successfully');
    } catch (error) {
        console.error('❌ Error inserting sample data:', error);
        throw error;
    }
};

// Execute setup
const setup = async () => {
    try {
        await createDatabase();
        await useDatabase();
        await createTables();
        await insertSampleData();
        console.log('\n Database setup completed successfully!');
    } catch (error) {
        console.error('\n Database setup failed:', error);
    } finally {
        connection.end((err) => {
            if (err) {
                console.error(' Error closing database connection:', err);
            } else {
                console.log(' Database connection closed');
            }
        });
    }
};

setup();