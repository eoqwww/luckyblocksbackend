// server.js
import express from "express";
import Stripe from "stripe";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Database setup ---
// --- Database setup ---
let db;
async function initDB() {
  db = await open({
    filename: path.join(__dirname, "orders.db"),
    driver: sqlite3.Database,
  });

  // Orders table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      email TEXT,
      items TEXT,
      total REAL,
      date TEXT
    )
  `);

  // Reviews table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT,
      date TEXT
    )
  `);

  // --- Seed reviews if table is empty ---
  const count = await db.get("SELECT COUNT(*) as c FROM reviews");
  if (count.c === 0) {
    const sampleReviews = [
      "fast and easy",
      "yo this was fire dude",
      "Very easy to use and great customer support",
      "Excellent gift! My younger brother really enjoyed these",
      "My kids love them. 5 stars!"
    ];
    for (const r of sampleReviews) {
      await db.run(`INSERT INTO reviews (text, date) VALUES (?, ?)`, [
        r,
        new Date().toISOString(),
      ]);
    }
    console.log("✅ Seeded default reviews");
  }
}
await initDB();


  // Orders table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      email TEXT,
      items TEXT,
      total REAL,
      date TEXT
    )
  `);

  // Reviews table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT,
      date TEXT
    )
  `);

await initDB();

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Checkout Session for Cart ---
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items } = req.body; // items: [{title, price, qty}]
    const lineItems = items.map(p => ({
      price_data: {
        currency: "usd",
        product_data: { name: p.title },
        unit_amount: Math.round(p.price * 100),
      },
      quantity: p.qty,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: lineItems,
      success_url: "http://localhost:4242/success.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "http://localhost:4242/cancel.html",
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Webhook (Stripe events) ---
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("⚠️ Webhook signature verification failed:", err.message);
    return res.sendStatus(400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const items = lineItems.data.map(li => `${li.quantity} x ${li.description}`);
      const total = session.amount_total / 100;

      await db.run(
        `INSERT INTO orders (id, email, items, total, date) VALUES (?, ?, ?, ?, ?)`,
        [
          session.id,
          session.customer_details?.email || "unknown",
          items.join(", "),
          total,
          new Date().toISOString(),
        ]
      );
      console.log("✅ Order saved:", session.id);
    } catch (err) {
      console.error("DB error:", err.message);
    }
  }
  res.sendStatus(200);
});

// --- Orders endpoints ---
app.get("/orders", async (req, res) => {
  const auth = req.headers["authorization"];
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const orders = await db.all("SELECT * FROM orders ORDER BY date DESC");
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// Get a single order by ID
app.get("/order/:id", async (req, res) => {
  try {
    const order = await db.get("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    res.json(order);
  } catch (err) {
    console.error("Error fetching order:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// --- Reviews endpoints ---
app.post("/add-review", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim() === "") {
      return res.status(400).json({ error: "Review cannot be empty" });
    }

    await db.run(`INSERT INTO reviews (text, date) VALUES (?, ?)`, [
      text.trim(),
      new Date().toISOString(),
    ]);

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving review:", err);
    res.status(500).json({ error: "Failed to save review" });
  }
});
// --- Get reviews route (randomized) ---
app.get("/reviews", async (req, res) => {
  try {
    // Get all reviews from DB
    const reviews = await db.all("SELECT text FROM reviews");

    // Shuffle reviews array
    for (let i = reviews.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [reviews[i], reviews[j]] = [reviews[j], reviews[i]];
    }

    // Return them (limit to, say, 20 max to avoid overload)
    res.json(reviews.slice(0, 20));
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});


// --- Start server ---
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
