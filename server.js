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
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const roomCleanupTimers = {}; // مؤقتات تنظيف الغرف

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toLowerCase();
}

io.on("connection", (socket) => {
  console.log("✅ اتصال جديد:", socket.id);

  socket.on("createRoom", ({ name, numPlayers }, callback) => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      hostId: socket.id,
      players: [{ id: socket.id, name }],
      questions: [],
      maxPlayers: numPlayers,
      readyPlayers: new Set()
    };
    socket.join(roomId);
    console.log(`🎮 تم إنشاء الغرفة ${roomId} بواسطة ${name}`);
    callback({ roomId });
  });

  socket.on("joinRoom", ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) {
      callback({ success: false, message: "❌ الغرفة غير موجودة" });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      callback({ success: false, message: "❌ الغرفة ممتلئة" });
      return;
    }

    room.players.push({ id: socket.id, name });
    socket.join(roomId);
    console.log(`➕ اللاعب ${name} انضم إلى الغرفة ${roomId}`);

    // أرسل التحديث لجميع اللاعبين في الغرفة
    io.to(roomId).emit("playerJoined", { players: room.players });
    callback({ success: true, roomState: room });
  });

  socket.on("submitQuestion", ({ roomId, playerId, question }, callback) => {
    const room = rooms[roomId];
    if (!room) return;

    room.questions.push({ ...question, from: playerId });
    callback({ success: true });
  });

  socket.on("playerReady", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.readyPlayers.add(playerId);
    console.log(`✅ اللاعب ${playerId} جاهز في الغرفة ${roomId}`);

    if (room.readyPlayers.size === room.players.length) {
      console.log(`🚀 كل اللاعبين جاهزين في الغرفة ${roomId}. بدء اللعبة`);
      io.to(roomId).emit("allPlayersReady", { questions: room.questions });
    }
  });

  socket.on("disconnect", () => {
    console.log(`❌ تم فصل الاتصال: ${socket.id}`);

    for (const [roomId, room] of Object.entries(rooms)) {
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        room.readyPlayers.delete(socket.id);
        io.to(roomId).emit("playerJoined", { players: room.players });

        console.log(`🚪 اللاعب ${socket.id} خرج من الغرفة ${roomId}`);

        // إذا الغرفة فاضية، جدولة حذفها بعد 5 دقائق
        if (room.players.length === 0) {
          console.log(`⏳ الغرفة ${roomId} أصبحت فارغة، سيتم التحقق منها بعد 5 دقائق`);

          roomCleanupTimers[roomId] = setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].players.length === 0) {
              delete rooms[roomId];
              delete roomCleanupTimers[roomId];
              console.log(`🗑️ تم حذف الغرفة ${roomId} بعد مرور 5 دقائق بدون لاعبين`);
            } else {
              console.log(`✅ تم إلغاء حذف الغرفة ${roomId} لأنها لم تعد فارغة`);
            }
          }, 5 * 60 * 1000); // 5 دقائق
        }

        break;
      }
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 السيرفر شغال على البورت", process.env.PORT || 3000);
});
