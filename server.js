const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // عدل حسب الدومين النهائي
    methods: ["GET", "POST"]
  }
});

const rooms = {}; // roomId -> { players: [], hostId, isStarted, ... }

function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

io.on("connection", (socket) => {
  console.log("✅ عميل متصل:", socket.id);

  socket.on("createRoom", ({ name }, callback) => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name, isReady: false }],
      questions: [],
      isStarted: false
    };
    socket.join(roomId);
    console.log(`🏠 غرفة جديدة: ${roomId} بواسطة ${name}`);
    callback({ success: true, roomId, roomState: rooms[roomId] });
  });

  socket.on("joinRoom", ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ success: false, message: "الغرفة غير موجودة" });
    if (room.players.find(p => p.id === socket.id)) {
      return callback({ success: false, message: "أنت بالفعل في الغرفة" });
    }

    room.players.push({ id: socket.id, name, isReady: false });
    socket.join(roomId);
    console.log(`👤 ${name} انضم إلى الغرفة ${roomId}`);
    io.to(roomId).emit("playerJoined", { players: room.players });
    callback({ success: true, roomState: room });
  });

  socket.on("startGame", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.hostId !== socket.id) return;

    room.isStarted = true;
    console.log(`🚀 بدء اللعبة في الغرفة ${roomId}`);
    io.to(roomId).emit("gameStarted", { players: room.players });
  });

  socket.on("submitQuestion", ({ roomId, question, fromId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.questions.push({ question, from: fromId, to: targetId });
    console.log(`📝 سؤال مضاف في ${roomId}:`, question);

    // Optional: بث تحديث عدد الأسئلة
    io.to(roomId).emit("questionSubmitted", { count: room.questions.length });
  });

  socket.on("playerReady", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === playerId);
    if (player) player.isReady = true;

    io.to(roomId).emit("playerJoined", { players: room.players });
  });

  socket.on("disconnect", () => {
    console.log("❌ لاعب فصل:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomId];
        console.log(`🗑️ حذف الغرفة ${roomId}`);
      } else {
        io.to(roomId).emit("playerJoined", { players: room.players });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🌐 السيرفر يعمل على المنفذ ${PORT}`));
