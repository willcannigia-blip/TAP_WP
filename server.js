// TAP backend — REST simples: QR + chats + mensagens
const express = require("express");
const http = require("http");
const cors = require("cors");
const qrcode = require("qrcode");
const { Server } = require("socket.io");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const server = http.createServer(app);

// CORS liberado (troque o origin se quiser restringir ao seu domínio)
app.use(cors({ origin: "*"}));

const io = new Server(server, { cors: { origin: "*" } }); // opcional: socket para futuro

// rota de saúde
app.get("/", (_, res) => res.send("TAP backend online ✅"));

// -------- Estado global simples (demo) -----------
let wpp = null;
let initInProgress = false;
let lastStatus = "inativo";
let lastQrDataUrl = null;

function setStatus(s) {
  lastStatus = s;
  try { io.emit("status", s); } catch {}
}

function buildClient() {
  return new Client({
    authStrategy: new LocalAuth({ clientId: "tap-session" }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    }
  });
}

async function ensureClient() {
  if (wpp || initInProgress) return;
  initInProgress = true;

  wpp = buildClient();

  wpp.on("qr", async (qr) => {
    lastQrDataUrl = await qrcode.toDataURL(qr);
    setStatus("qr_disponivel"); // pronto para ler
  });

  wpp.on("authenticated", () => setStatus("autenticando"));
  wpp.on("ready", () => setStatus("pronto"));
  wpp.on("auth_failure", (m) => setStatus("falha_autenticacao: " + (m || "")));
  wpp.on("disconnected", (reason) => {
    setStatus("desconectado: " + reason);
    try { wpp.destroy(); } catch {}
    wpp = null;
    initInProgress = false;
  });

  try {
    setStatus("inicializando");
    await wpp.initialize();
  } catch (e) {
    setStatus("erro_inicializar: " + (e?.message || e));
    initInProgress = false;
    wpp = null;
  }
}

// pequena ajuda para "esperar" até ter QR/estado
function waitFor(predicateFn, timeoutMs = 15000, pollMs = 200) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const it = setInterval(() => {
      if (predicateFn()) { clearInterval(it); resolve(true); }
      else if (Date.now() - started > timeoutMs) { clearInterval(it); reject(new Error("timeout")); }
    }, pollMs);
  });
}

// -------- Rotas REST -----------------------------

// 1) Gera/retorna QR (inicia cliente se necessário)
app.get("/qrcode", async (req, res) => {
  try {
    await ensureClient();
    // espera até ter QR (ou já estar pronto)
    if (!lastQrDataUrl && lastStatus !== "pronto") {
      await waitFor(() => !!lastQrDataUrl || lastStatus === "pronto", 20000);
    }
    if (lastStatus === "pronto") {
      return res.json({ status: "pronto", qr: null });
    }
    return res.json({ status: lastStatus, qr: lastQrDataUrl });
  } catch (e) {
    return res.status(500).json({ error: "nao_foi_possivel_gerar_qr", details: e.message || String(e) });
  }
});

// 2) Status simples
app.get("/status", (req, res) => {
  res.json({ status: lastStatus });
});

// 3) Listar chats (id, nome, última mensagem)
app.get("/chats", async (req, res) => {
  try {
    if (!wpp) return res.status(400).json({ error: "cliente_nao_iniciado" });
    const chats = await wpp.getChats();
    const out = chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.formattedTitle || c.id.user,
      lastMsg: c?.lastMessage?.body || ""
    }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "erro_chats", details: e.message || String(e) });
  }
});

// 4) Mensagens de um chat ?chatId=...
app.get("/messages", async (req, res) => {
  try {
    const chatId = req.query.chatId;
    if (!chatId) return res.status(400).json({ error: "faltou_chatId" });
    if (!wpp) return res.status(400).json({ error: "cliente_nao_iniciado" });

    const chat = await wpp.getChatById(chatId);
    const msgs = await chat.fetchMessages({ limit: 50 });
    const out = msgs.map(m => ({
      id: m.id.id,
      body: m.body,
      fromMe: m.fromMe,
      timestamp: m.timestamp
    }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "erro_messages", details: e.message || String(e) });
  }
});

// (Opcional) ainda deixo Socket.IO ativo para uso futuro
io.on("connection", (socket) => {
  socket.emit("status", lastStatus || "inativo");
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Rodando na porta " + port));
