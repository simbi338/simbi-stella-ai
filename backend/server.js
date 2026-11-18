
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));

// Gemini AI configuration
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

// Home route
app.get("/", (req, res) => {
    res.json({
        message: "Simbi Stella AI V2 is working!",
        status: "online"
    });
});

// Chat handler
async function chatHandler(req, res) {
    try {
        const userMessage = req.body.message || "";
        const image = req.body.image;

        if (!userMessage.trim() && !image) {
            return res.status(400).json({
                error: "Message or image is required"
            });
        }

        const parts = [];

        // Add text
        parts.push({
            text: userMessage.trim() || "Please analyze this image and describe what you see."
        });

        // Add image if provided
        if (image) {
            const match = image.match(
                /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/
            );

            if (!match) {
                return res.status(400).json({
                    error: "Invalid image format. Use JPG, PNG or WEBP."
                });
            }

            parts.push({
                inlineData: {
                    mimeType: match[1],
                    data: match[2]
                }
            });
        }

        // Generate AI response
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
                {
                    role: "user",
                    parts: parts
                }
            ]
        });

        res.json({
            reply: response.text
        });

    } catch (error) {
        console.error("Simbi Stella AI Error:", error);

        res.status(500).json({
            error: "AI response failed. Please try again."
        });
    }
}

// Support both frontend routes
app.post("/api/chat", chatHandler);
app.post("/chat", chatHandler);

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Simbi Stella AI running on port ${PORT}`);
});
