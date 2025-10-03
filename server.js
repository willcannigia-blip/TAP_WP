const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  console.log("Novo cliente conectado");
  socket.emit("status", "Servidor conectado!");

  // Simulação: mandar mensagem a cada 5 segundos
  setInterval(() => {
    socket.emit("message", {
      chatId: "demo",
      body: "Mensagem teste",
      timestamp: Date.now()
    });
  }, 5000);
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log("Rodando na porta " + port));
