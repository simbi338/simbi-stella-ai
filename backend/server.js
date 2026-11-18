
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const { Pool } = pg;

app.use(cors());
app.use(express.json({ limit: "8mb" }));

const required = [
    "DATABASE_URL",
    "JWT_SECRET",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "GEMINI_API_KEY"
];

for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`Missing environment variable: ${key}`);
    }
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false
});

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// CREATE DATABASE TABLE AND ADMIN
async function initializeDatabase() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role VARCHAR(20) DEFAULT 'user',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
        )
    `);

    const email = process.env.ADMIN_EMAIL.toLowerCase();
    const passwordHash = await bcrypt.hash(
        process.env.ADMIN_PASSWORD,
        12
    );

    await pool.query(
        `INSERT INTO users
         (username, email, password_hash, role)
         VALUES ($1, $2, $3, 'admin')
         ON CONFLICT (email)
         DO UPDATE SET role = 'admin'`,
        ["Simbi Stella", email, passwordHash]
    );

    console.log("Database ready. Admin account checked.");
}

// CREATE LOGIN TOKEN
function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
}

// VERIFY LOGIN
function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            error: "Please log in first."
        });
    }

    try {
        req.user = jwt.verify(
            header.split(" ")[1],
            process.env.JWT_SECRET
        );
        next();
    } catch {
        return res.status(401).json({
            error: "Invalid or expired login. Please log in again."
        });
    }
}

// ADMIN ONLY
function requireAdmin(req, res, next) {
    if (req.user.role !== "admin") {
        return res.status(403).json({
            error: "Admin access only."
        });
    }

    next();
}

// HOME
app.get("/", (req, res) => {
    res.json({
        message: "Simbi Stella AI is online!",
        status: "working"
    });
});

// REGISTER
app.post("/api/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            username.trim().length < 2 ||
            username.trim().length > 50 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            password.length < 8 ||
            password.length > 128
        ) {
            return res.status(400).json({
                error: "Enter a valid username, email and password of at least 8 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const passwordHash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO users
             (username, email, password_hash, role)
             VALUES ($1, $2, $3, 'user')
             RETURNING id, username, email, role`,
            [username.trim(), normalizedEmail, passwordHash]
        );

        const user = result.rows[0];

        res.status(201).json({
            message: "Account created successfully.",
            token: createToken(user),
            user
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                error: "This email is already registered."
            });
        }

        console.error(error);
        res.status(500).json({
            error: "Registration failed."
        });
    }
});

// LOGIN
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Email and password are required."
            });
        }

        const result = await pool.query(
            "SELECT * FROM users WHERE email = $1",
            [email.trim().toLowerCase()]
        );

        const user = result.rows[0];

        if (
            !user ||
            !(await bcrypt.compare(password, user.password_hash))
        ) {
            return res.status(401).json({
                error: "Incorrect email or password."
            });
        }

        await pool.query(
            "UPDATE users SET last_login_at = NOW() WHERE id = $1",
            [user.id]
        );

        res.json({
            message: "Login successful.",
            token: createToken(user),
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Login failed."
        });
    }
});

// CURRENT USER
app.get("/api/me", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, email, role, created_at, last_login_at
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (!result.rows[0]) {
            return res.status(404).json({
                error: "User not found."
            });
        }

        res.json({ user: result.rows[0] });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Could not load profile."
        });
    }
});

// ADMIN: VIEW REGISTERED USERS
app.get(
    "/api/admin/users",
    authenticate,
    requireAdmin,
    async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    id,
                    username,
                    email,
                    role,
                    created_at,
                    last_login_at
                FROM users
                ORDER BY created_at DESC
            `);

            res.json({
                totalUsers: result.rows.length,
                users: result.rows
            });

        } catch (error) {
            console.error(error);
            res.status(500).json({
                error: "Could not load users."
            });
        }
    }
);

// AI CHAT AND IMAGE UPLOAD
async function chatHandler(req, res) {
    try {
        const message =
            typeof req.body.message === "string"
                ? req.body.message.trim()
                : "";

        const image = req.body.image;

        if (!message && !image) {
            return res.status(400).json({
                error: "Message or image is required."
            });
        }

        const parts = [{
            text: message ||
                "Please describe this image."
        }];

        if (image) {
            if (typeof image !== "string" || image.length > 7_000_000) {
                return res.status(400).json({
                    error: "Image is too large."
                });
            }

            const match = image.match(
                /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
            );

            if (!match) {
                return res.status(400).json({
                    error: "Use JPG, PNG or WEBP images."
                });
            }

            parts.push({
                inlineData: {
                    mimeType: match[1],
                    data: match[2]
                }
            });
        }

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [{
                role: "user",
                parts
            }]
        });

        res.json({
            reply: response.text
        });

    } catch (error) {
        console.error("AI Error:", error);
        res.status(500).json({
            error: "AI response failed. Please try again."
        });
    }
}

app.post("/api/chat", chatHandler);
app.post("/chat", chatHandler);

// START SERVER
const PORT = process.env.PORT || 3000;

initializeDatabase()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `Simbi Stella AI running on port ${PORT}`
            );
        });
    })
    .catch(error => {
        console.error("Database startup failed:", error);
        process.exit(1);
    });
