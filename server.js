const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Generate 6-digit numeric room ID
function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const rooms = {};

io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  socket.on("createRoom", ({ name, maxPlayers }) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      maxPlayers,
      questions: [],
      readyPlayers: new Set(),
      createdAt: Date.now(),
    };
    socket.join(roomId);
    console.log(`✅ Room created: ${roomId} by ${name}`);
    socket.emit("roomCreated", { roomId });
  });

  socket.on("joinRoom", ({ roomId, name }, callback) => {
    if (!rooms[roomId]) {
      return callback({ success: false, message: "الغرفة غير موجودة." });
    }

    const room = rooms[roomId];
    if (room.players.length >= room.maxPlayers) {
      return callback({ success: false, message: "الغرفة ممتلئة." });
    }

    room.players.push({ id: socket.id, name });
    socket.join(roomId);
    console.log(`👤 Player joined room ${roomId}: ${name}`);

    io.to(roomId).emit("playerJoined", { players: room.players });
    callback({ success: true });
  });

  socket.on("submitQuestion", ({ roomId, question }) => {
    if (rooms[roomId]) {
      rooms[roomId].questions.push(question);
      console.log(`❓ Question submitted to ${roomId}`);
    }
  });

  socket.on("playerReady", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (room) {
      room.readyPlayers.add(playerId);
      io.to(roomId).emit("playerReadyUpdate", {
        playerId,
        readyCount: room.readyPlayers.size,
        total: room.players.length,
      });

      if (room.readyPlayers.size === room.players.length) {
        io.to(roomId).emit("allPlayersReady", {
          questions: room.questions,
          players: room.players,
        });
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.findIndex((p) => p.id === socket.id);

      if (index !== -1) {
        const player = room.players.splice(index, 1)[0];
        console.log(`🚪 ${player.name} left room ${roomId}`);

        io.to(roomId).emit("playerLeft", {
          playerId: socket.id,
          players: room.players,
        });

        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`🗑️ Room ${roomId} deleted (empty)`);
        }
        break;
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
