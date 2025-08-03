const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const rooms = {};

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit room ID
}

io.on("connection", (socket) => {
  console.log("⚡ عميل جديد متصل:", socket.id);

  socket.on("createRoom", ({ name, numPlayers }, callback) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name, isReady: false }],
      maxPlayers: numPlayers,
      started: false,
      questions: [],
    };
    socket.join(roomId);
    console.log(`✅ تم إنشاء غرفة ${roomId} بواسطة ${name}`);
    callback({ roomId });
    io.to(roomId).emit("playerJoined", { players: rooms[roomId].players });
  });

  socket.on("joinRoom", ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      return callback({ success: false, message: "الغرفة غير موجودة" });
    }
    if (room.players.length >= room.maxPlayers) {
      return callback({ success: false, message: "الغرفة ممتلئة" });
    }

    room.players.push({ id: socket.id, name, isReady: false });
    socket.join(roomId);
    console.log(`👤 ${name} انضم إلى الغرفة ${roomId}`);
    callback({ success: true, roomState: room });
    io.to(roomId).emit("playerJoined", { players: room.players });
  });

  socket.on("submitQuestion", ({ roomId, playerId, question }, callback) => {
    const room = rooms[roomId];
    if (!room) return;

    room.questions.push({ ...question, from: playerId });
    console.log(`📩 سؤال مضاف من لاعب ${playerId} في غرفة ${roomId}`);
    callback({ success: true });
  });

  socket.on("playerReady", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find((p) => p.id === playerId);
    if (player) player.isReady = true;

    io.to(roomId).emit("playerJoined", { players: room.players });

    const allReady = room.players.every((p) => p.isReady);
    if (allReady) {
      console.log(`🚀 جميع اللاعبين في الغرفة ${roomId} جاهزين!`);
      io.to(roomId).emit("allPlayersReady", { questions: room.questions });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ عميل قطع الاتصال:", socket.id);
    for (const [roomId, room] of Object.entries(rooms)) {
      const index = room.players.findIndex((p) => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit("playerJoined", { players: room.players });

        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`🗑️ تم حذف الغرفة ${roomId} بسبب مغادرة الجميع`);
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
