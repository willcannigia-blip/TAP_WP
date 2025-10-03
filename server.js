// TAP backend — WhatsApp QR + mensagens básicas
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// rota de saúde
app.get("/", (_, res) => res.send("TAP backend online ✅"));

// --- estado da sessão (1 instância simples p/ demo) ---
let wpp = null;
let isInitializing = false;

function buildClient() {
  return new Client({
    authStrategy: new LocalAuth({ clientId: "tap-session" }),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true
    }
  });
}

// broadcast helper
function emitAll(event, payload) {
  io.sockets.sockets.forEach(s => s.emit(event, payload));
}

async function ensureClientStarted(socket) {
  if (wpp || isInitializing) return;
  isInitializing = true;

  wpp = buildClient();

  wpp.on("qr", async (qr) => {
    const dataUrl = await qrcode.toDataURL(qr);
    emitAll("qr", dataUrl);
  });

  wpp.on("ready", async () => {
    emitAll("status", "Sessão autenticada — pronto!");
    const chats = await wpp.getChats();
    emitAll("ready", chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.formattedTitle || c.id.user,
      lastMsg: c?.lastMessage?.body || ""
    })));
  });

  wpp.on("authenticated", () => emitAll("status", "Autenticando..."));
  wpp.on("auth_failure", (m) => emitAll("auth_failure", m || "Falha de autenticação"));
  wpp.on("disconnected", (reason) => {
    emitAll("disconnected", reason);
    try { wpp.destroy(); } catch {}
    wpp = null; isInitializing = false;
  });

  wpp.on("message", (m) => {
    emitAll("message", {
      id: m.id.id, body: m.body, fromMe: m.fromMe,
      timestamp: m.timestamp, chatId: m.from
    });
  });

  try {
    await wpp.initialize();
    emitAll("status", "Cliente iniciando (aguarde QR)...");
  } catch (e) {
    isInitializing = false;
    emitAll("status", "Erro ao iniciar cliente: " + (e?.message || e));
  }
}

io.on("connection", (socket) => {
  socket.emit("status", "Conectado ao TAP backend");

  // front clica em "Gerar QR" → startSession
  socket.on("startSession", async () => {
    socket.emit("status", "Inicializando sessão do WhatsApp...");
    await ensureClientStarted(socket);
  });

  // listar novamente os chats
  socket.on("getChats", async () => {
    if (!wpp) return socket.emit("status", "Cliente não iniciado");
    const chats = await wpp.getChats();
    socket.emit("chats", chats.map(c => ({
      id: c.id._serialized,
      name: c.name || c.formattedTitle || c.id.user,
      lastMsg: c?.lastMessage?.body || ""
    })));
  });

  // pegar mensagens de um chat
  socket.on("getMessages", async (chatId) => {
    if (!wpp) return socket.emit("status", "Cliente não iniciado");
    try {
      const chat = await wpp.getChatById(chatId);
      const msgs = await chat.fetchMessages({ limit: 50 });
      socket.emit("messages", {
        chatId,
        messages: msgs.map(m => ({
          id: m.id.id,
          body: m.body,
          fromMe: m.fromMe,
          timestamp: m.timestamp
        }))
      });
    } catch (e) {
      socket.emit("status", "Erro ao buscar mensagens: " + (e?.message || e));
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Rodando na porta " + port));
