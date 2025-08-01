
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log("✅ User connected:", socket.id);

  socket.on('createRoom', ({ name, maxPlayers, questionsPerPlayer }, callback) => {
    const roomId = Math.floor(1000 + Math.random() * 9000).toString();
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

  socket.on('joinRoom', ({ roomId, name }, callback) => {
    const room = rooms[roomId];
    if (!room) return callback({ success: false, message: "Room not found" });
    if (room.players.length >= room.maxPlayers) return callback({ success: false, message: "Room full" });

    room.players.push({ id: socket.id, name, isReady: false });
    socket.join(roomId);

    io.to(roomId).emit('playerJoined', room.players);
    callback({ success: true, roomId });
    console.log(`👤 ${name} joined room ${roomId}`);
  });

  socket.on('submitQuestion', ({ roomId, question, target }) => {
    if (rooms[roomId]) {
      rooms[roomId].questions.push({ from: socket.id, text: question, to: target });
    }
  });

  socket.on('playerReady', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.isReady = true;

    io.to(roomId).emit('updateReadyList', room.players.map(p => ({ id: p.id, name: p.name, isReady: p.isReady })));

    const allReady = room.players.every(p => p.isReady);
    if (allReady) {
      io.to(room.hostId).emit('allPlayersReady');
    }
  });

  socket.on('startGame', ({ roomId }) => {
    if (rooms[roomId] && rooms[roomId].hostId === socket.id) {
      rooms[roomId].gameStarted = true;
      io.to(roomId).emit('gameStarted', rooms[roomId].questions);
    }
  });

  socket.on('markAnswer', ({ roomId, questionIndex, isCorrect }) => {
    io.to(roomId).emit('answerResult', { questionIndex, isCorrect });
  });

  socket.on('endGame', ({ roomId, results }) => {
    io.to(roomId).emit('gameEnded', results);
  });

  socket.on('disconnect', () => {
    console.log("❌ User disconnected:", socket.id);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.hostId === socket.id) {
        io.to(roomId).emit('hostLeft');
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
