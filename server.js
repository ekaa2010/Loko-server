const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

// الحالة الداخلية لكل الغرف
const rooms = {};

io.on('connection', (socket) => {
  console.log(`🔌 مستخدم متصل: ${socket.id}`);

  socket.on('createRoom', ({ playerName, playerLimit }, callback) => {
    const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();

    rooms[roomId] = {
      players: [{ id: socket.id, name: playerName, isReady: false }],
      questions: [],
      playerLimit,
      hostId: socket.id
    };

    socket.join(roomId);
    console.log(`📦 غرفة جديدة: ${roomId}`);
    callback({ success: true, roomState: { roomId, playerLimit, players: rooms[roomId].players } });
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ success: false, message: 'الغرفة غير موجودة' });
    if (room.players.length >= room.playerLimit) {
      return callback({ success: false, message: 'الغرفة ممتلئة' });
    }

    room.players.push({ id: socket.id, name: playerName, isReady: false });
    socket.join(roomId);
    console.log(`👥 انضم ${playerName} إلى الغرفة ${roomId}`);

    // إرسال الحالة الجديدة لكل اللاعبين
    io.to(roomId).emit('playerJoined', { players: room.players });

    callback({ success: true, roomState: { roomId, playerLimit: room.playerLimit, players: room.players } });
  });

  socket.on('playerReady', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.isReady = true;

    console.log(`✅ ${player.name} جاهز`);

    io.to(roomId).emit('playerReadyStatusChanged', { players: room.players });

    const allReady = room.players.length === room.playerLimit &&
                     room.players.every(p => p.isReady);
    if (allReady) {
      io.to(roomId).emit('allPlayersReady');
    }
  });

  socket.on('submitQuestion', (data) => {
    const { roomId, ...questionData } = data;
    const room = rooms[roomId];
    if (!room) return;

    room.questions.push(questionData);
    console.log(`📝 سؤال أُضيف للغرفة ${roomId}`);
  });

  socket.on('startGame', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    console.log(`🚀 بدء اللعبة في الغرفة ${roomId}`);
    io.to(roomId).emit('gameStarted', { questions: room.questions });
  });

  socket.on('disconnect', () => {
    console.log(`❌ قطع الاتصال: ${socket.id}`);
    // إزالة اللاعب من الغرف
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(roomId).emit('playerJoined', { players: room.players });
        if (room.players.length === 0) {
          delete rooms[roomId];
          console.log(`🗑️ تم حذف الغرفة ${roomId} لعدم وجود لاعبين`);
        }
        break;
      }
    }
  });
});

// بدء السيرفر
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 سيرفر يعمل على المنفذ ${PORT}`);
});
