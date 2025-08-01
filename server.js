const express = require('express'); const http = require('http'); const cors = require('cors'); const { Server } = require('socket.io');

const app = express(); app.use(cors());

const server = http.createServer(app); const io = new Server(server, { cors: { origin: "*" } });

const rooms = {};

function generateRoomCode() { return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit }

io.on('connection', (socket) => { console.log("✅ User connected:", socket.id);

socket.on('createRoom', ({ name, maxPlayers, questionsPerPlayer }, callback) => { const roomId = generateRoomCode();

rooms[roomId] = {
  hostId: socket.id,
  players: [{ id: socket.id, name, isReady: false }],
  maxPlayers,
  questionsPerPlayer,
  questions: [],
  readyList: [],
  gameStarted: false
};

socket.join(roomId);
callback({ success: true, roomId });
console.log(`📦 Room ${roomId} created by ${name}`);

});

socket.on('joinRoom', ({ roomId, name }) => { const room = rooms[roomId]; if (!room) { socket.emit('joinError', { message: "❌ الغرفة غير موجودة" }); return; }

if (room.players.length >= room.maxPlayers) {
  socket.emit('joinError', { message: "❌ الغرفة ممتلئة" });
  return;
}

const player = { id: socket.id, name, isReady: false };
room.players.push(player);
socket.join(roomId);

socket.emit('joinedRoom', room); // Send full room state to joining player
io.to(roomId).emit('playerJoined', room.players); // Update everyone

console.log(`👤 ${name} joined room ${roomId}`);

// If full, notify host to start
if (room.players.length === room.maxPlayers) {
  io.to(room.hostId).emit('allPlayersJoined');
}

});

socket.on('submitQuestion', ({ roomId, question, target }) => { const room = rooms[roomId]; if (room) { room.questions.push({ from: socket.id, text: question, to: target }); } });

socket.on('playerReady', ({ roomId }) => { const room = rooms[roomId]; if (!room) return;

const player = room.players.find(p => p.id === socket.id);
if (player) player.isReady = true;

io.to(roomId).emit('updateReadyList', room.players.map(p => ({
  id: p.id,
  name: p.name,
  isReady: p.isReady
})));

const allReady = room.players.every(p => p.isReady);
if (allReady) {
  io.to(room.hostId).emit('allPlayersReady');
}

});

socket.on('startQuestionEntry', ({ roomId }) => { const room = rooms[roomId]; if (!room) return;

// Only the host can start
if (socket.id !== room.hostId) {
  socket.emit('error', 'فقط منشئ الغرفة يمكنه بدء المرحلة');
  return;
}

// Notify all non-host players
room.players.forEach(player => {
  if (player.id !== room.hostId) {
    io.to(player.id).emit('startQuestionEntry');
  }
});

console.log(`🟡 Question entry phase started for room ${roomId}`);

});

socket.on('startGame', ({ roomId }) => { const room = rooms[roomId]; if (room && room.hostId === socket.id) { room.gameStarted = true; io.to(roomId).emit('gameStarted', room.questions); } });

socket.on('markAnswer', ({ roomId, questionIndex, isCorrect }) => { io.to(roomId).emit('answerResult', { questionIndex, isCorrect }); });

socket.on('endGame', ({ roomId, results }) => { io.to(roomId).emit('gameEnded', results); });

socket.on('disconnect', () => { console.log("❌ User disconnected:", socket.id);

for (const roomId in rooms) {
  const room = rooms[roomId];
  const index = room.players.findIndex(p => p.id === socket.id);
  if (index !== -1) {
    const player = room.players[index];
    room.players.splice(index, 1);
    io.to(roomId).emit('playerLeft', room.players);

    if (socket.id === room.hostId) {
      io.to(roomId).emit('hostLeft');
      delete rooms[roomId];
      console.log(`❌ Room ${roomId} closed because host left`);
    }
  }
}

}); });

const PORT = process.env.PORT || 3000; server.listen(PORT, () => { console.log(🚀 Server running on port ${PORT}); });

