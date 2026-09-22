import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

app.get("/", (req, res) => {
    res.json({
        message: "Simbi Stella AI backend is working!"
    });
});

app.post("/chat", async (req, res) => {
    try {
        const userMessage = req.body.message;

        if (!userMessage) {
            return res.status(400).json({
                error: "Message is required"
            });
        }

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: userMessage
        });

        res.json({
            reply: response.text
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "AI response failed"
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
