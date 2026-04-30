// ══════════════════════════════════════════════════════════════════
//  Wandr AI  —  Backend Server  (server.js)
//  Groq API is called ONLY here — never exposed to the browser
// ══════════════════════════════════════════════════════════════════
require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const crypto     = require("crypto");
const path       = require("path");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Groq config ──────────────────────────────────────────────────
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = process.env.GROQ_MODEL || "llama3-70b-8192";
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";

if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here") {
  console.warn("⚠️  GROQ_API_KEY is not set in .env — AI features will fail.");
}

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── In-memory stores (replace with DB in production) ─────────────
const users    = new Map();
const sessions = new Map();
const plans    = new Map();
const chats    = new Map();

// ── Helpers ──────────────────────────────────────────────────────
const uid     = () => crypto.randomBytes(10).toString("hex");
const now     = () => new Date().toISOString();
const hashPw  = (pw, salt) =>
  crypto.createHmac("sha256", salt).update(pw).digest("hex");

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!t) return res.status(401).json({ success: false, error: "Unauthorized" });
  // Offline tokens (prefixed off.) are validated client-side only
  if (t.startsWith("off.")) {
    req.userId = "offline";
    return next();
  }
  const sess = sessions.get(t);
  if (!sess || sess.exp < Date.now())
    return res.status(401).json({ success: false, error: "Session expired" });
  req.userId = sess.userId;
  next();
}

// ══════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════════════
app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password)
    return res.status(400).json({ success: false, error: "Missing fields" });

  const e = email.toLowerCase().trim();
  if ([...users.values()].find(u => u.email === e))
    return res.status(409).json({ success: false, error: "Email already registered" });

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPw(password, salt);
  const user = { id: uid(), name: name.trim(), email: e, hash, salt, at: now() };
  users.set(user.id, user);

  const token = uid();
  sessions.set(token, { userId: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000 });

  const { hash: _h, salt: _s, ...safe } = user;
  res.json({ success: true, token, user: safe });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  const e = (email || "").toLowerCase().trim();
  const user = [...users.values()].find(u => u.email === e);
  if (!user) return res.status(401).json({ success: false, error: "Invalid email or password" });

  const hash = hashPw(password, user.salt);
  if (hash !== user.hash)
    return res.status(401).json({ success: false, error: "Invalid email or password" });

  const token = uid();
  sessions.set(token, { userId: user.id, exp: Date.now() + 7 * 24 * 3600 * 1000 });

  const { hash: _h, salt: _s, ...safe } = user;
  res.json({ success: true, token, user: safe });
});

app.get("/api/auth/me", auth, (req, res) => {
  if (req.userId === "offline")
    return res.json({ success: true, user: { id: "offline", name: "Offline User", email: "" } });
  const user = users.get(req.userId);
  if (!user) return res.status(404).json({ success: false, error: "Not found" });
  const { hash, salt, ...safe } = user;
  res.json({ success: true, user: safe });
});

app.post("/api/auth/logout", auth, (req, res) => {
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (t) sessions.delete(t);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
//  AI ROUTE  —  Groq API (key stays on server only)
// ══════════════════════════════════════════════════════════════════
app.post("/api/ai/chat", auth, async (req, res) => {
  const { messages, systemPrompt } = req.body || {};
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ success: false, error: "messages array required" });

  if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here")
    return res.status(500).json({ success: false, error: "GROQ_API_KEY not configured on server" });

  // Build Groq request
  const groqMessages = [];
  if (systemPrompt) groqMessages.push({ role: "system", content: systemPrompt });
  for (const m of messages) {
    if (m.role === "user" || m.role === "assistant") {
      groqMessages.push({ role: m.role, content: m.content });
    }
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    groqMessages,
        max_tokens:  2048,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("Groq error:", groqRes.status, errText);
      return res.status(502).json({ success: false, error: `Groq API error: ${groqRes.status}` });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content || "";
    res.json({ success: true, text });
  } catch (err) {
    console.error("Groq fetch error:", err);
    res.status(500).json({ success: false, error: "Failed to reach Groq API" });
  }
});

// ── AI: Generate places for Explore page ─────────────────────────
app.post("/api/ai/places", auth, async (req, res) => {
  const { destination } = req.body || {};
  if (!destination)
    return res.status(400).json({ success: false, error: "destination required" });

  if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here")
    return res.status(500).json({ success: false, error: "GROQ_API_KEY not configured on server" });

  const systemPrompt = `You are a travel expert. Return ONLY a valid JSON array of exactly 8 specific, real, popular tourist places for "${destination}". Each entry must be: {"name":"exact real place name","desc":"one vivid, accurate sentence about why it's worth visiting","type":"Beach|Mountain|Temple|City|Museum|Nature|Heritage|Lake|Desert|Market","rating":"4.3"} — rating between 4.0 and 4.9 based on real reviews. Use only verified, well-known places. No extra text, no markdown, no explanations.`;

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [
          { role: "system",  content: systemPrompt },
          { role: "user",    content: `List 8 best real tourist places in ${destination}` },
        ],
        max_tokens:  800,
        temperature: 0.5,
      }),
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return res.status(502).json({ success: false, error: `Groq API error: ${groqRes.status}` });
    }

    const data    = await groqRes.json();
    const rawText = data.choices?.[0]?.message?.content || "";
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    const places  = JSON.parse(cleaned);
    res.json({ success: true, places });
  } catch (err) {
    console.error("Groq places error:", err);
    res.status(500).json({ success: false, error: "Failed to generate places" });
  }
});

// ── AI: Generate travel plan ──────────────────────────────────────
app.post("/api/ai/plan", auth, async (req, res) => {
  const { destination, days, budget, style } = req.body || {};
  if (!destination)
    return res.status(400).json({ success: false, error: "destination required" });

  if (!GROQ_API_KEY || GROQ_API_KEY === "your_groq_api_key_here")
    return res.status(500).json({ success: false, error: "GROQ_API_KEY not configured on server" });

  const systemPrompt = `You are an expert Indian travel planner. Create detailed, practical travel itineraries. Use markdown formatting with ## for day headers and bullet points for activities. Include real place names, local tips, estimated costs in INR, best times to visit, and transport suggestions.`;
  const userPrompt   = `Plan a ${days || 5}-day trip to ${destination} for a ${style || "leisure"} traveler with a budget of ${budget || "₹20,000"} per day. Include day-by-day itinerary, must-visit places, local food recommendations, accommodation suggestions, and travel tips.`;

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + GROQ_API_KEY,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ],
        max_tokens:  2048,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok)
      return res.status(502).json({ success: false, error: `Groq API error: ${groqRes.status}` });

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content || "";
    res.json({ success: true, text });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to generate plan" });
  }
});

// ══════════════════════════════════════════════════════════════════
//  PLANS ROUTES
// ══════════════════════════════════════════════════════════════════
app.get("/api/plans", auth, (req, res) => {
  const uid = req.userId;
  const userPlans = [...(plans.get(uid) || [])];
  res.json({ success: true, plans: userPlans });
});

app.post("/api/plans", auth, (req, res) => {
  const uid   = req.userId;
  const plan  = { ...req.body, id: uid(), userId: uid, createdAt: now() };
  const list  = plans.get(uid) || [];
  plans.set(uid, [...list, plan]);
  res.json({ success: true, plan });
});

app.put("/api/plans/:id", auth, (req, res) => {
  const uid  = req.userId;
  const list = plans.get(uid) || [];
  const idx  = list.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: "Not found" });
  list[idx] = { ...list[idx], ...req.body, id: req.params.id };
  plans.set(uid, list);
  res.json({ success: true, plan: list[idx] });
});

app.delete("/api/plans/:id", auth, (req, res) => {
  const uid  = req.userId;
  const list = plans.get(uid) || [];
  plans.set(uid, list.filter(p => p.id !== req.params.id));
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
//  CHATS ROUTES
// ══════════════════════════════════════════════════════════════════
app.get("/api/chats", auth, (req, res) => {
  const uid = req.userId;
  const userChats = [...(chats.get(uid) || [])];
  res.json({ success: true, chats: userChats });
});

app.post("/api/chats", auth, (req, res) => {
  const uid  = req.userId;
  const chat = { ...req.body, id: uid(), userId: uid, createdAt: now() };
  const list = chats.get(uid) || [];
  chats.set(uid, [...list, chat]);
  res.json({ success: true, chat });
});

app.get("/api/chats/:id", auth, (req, res) => {
  const uid  = req.userId;
  const list = chats.get(uid) || [];
  const chat = list.find(c => c.id === req.params.id);
  if (!chat) return res.status(404).json({ success: false, error: "Not found" });
  res.json({ success: true, chat });
});

app.delete("/api/chats/:id", auth, (req, res) => {
  const uid  = req.userId;
  const list = chats.get(uid) || [];
  chats.set(uid, list.filter(c => c.id !== req.params.id));
  res.json({ success: true });
});

// ── Budget summary ────────────────────────────────────────────────
app.get("/api/budget/summary", auth, (req, res) => {
  const uid      = req.userId;
  const userPlans = chats.get(uid) || [];
  res.json({ success: true, summary: {} });
});

// ── Serve frontend ────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌍 Wandr AI server running on http://localhost:${PORT}`);
  console.log(`   Groq model: ${GROQ_MODEL}`);
  console.log(`   API key:    ${GROQ_API_KEY ? "✓ Set" : "✗ Missing — set GROQ_API_KEY in .env"}\n`);
});
