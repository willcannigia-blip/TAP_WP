const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Rota principal (GET /)
app.get("/", (req, res) => {
  res.send("TAP backend online ✅");
});

io.on("connection", (socket) => {
  console.log("Novo cliente conectado");
  socket.emit("status", "Servidor conectado!");

  // Mensagem de teste a cada 5 segundos
  setInterval(() => {
    socket.emit("message", {
      chatId: "demo",
      body: "Mensagem teste",
      timestamp: Math.floor(Date.now() / 1000)
    });
  }, 5000);
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Rodando na porta " + port));
