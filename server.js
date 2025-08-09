const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingTimeout: 30000,
  pingInterval: 10000,
});

function generateRoomId() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

const rooms = {};                 // roomId -> { hostId, players[], maxPlayers, questions[], readyPlayers:Set, phase, createdAt }
const roomDeletionTimeouts = {};  // roomId -> timeout

function getRoomState(roomId) {
  const r = rooms[roomId];
  if (!r) return null;
  return {
    roomId,
    hostId: r.hostId,
    maxPlayers: r.maxPlayers,
    players: r.players.map(p => ({ id: p.id, name: p.name })), // no Sets to JSON
    phase: r.phase,
    questionsCount: r.questions.length,
    readyCount: r.readyPlayers.size,
  };
}

io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  // CREATE
  socket.on("createRoom", ({ name, maxPlayers }, cb = () => {}) => {
    try {
      const roomId = generateRoomId();
      rooms[roomId] = {
        hostId: socket.id,
        players: [{ id: socket.id, name: name || "Player" }],
        maxPlayers: Number(maxPlayers) || 8,
        questions: [],
        readyPlayers: new Set(),
        phase: "waiting", // waiting -> question -> playing -> ended
        createdAt: Date.now(),
      };
      socket.join(roomId);
      console.log(`✅ Room created: ${roomId} by ${name}`);
      cb({ success: true, roomId, room: getRoomState(roomId) });
      io.to(roomId).emit("playerJoined", { players: rooms[roomId].players });
    } catch (e) {
      cb({ success: false, message: "Server error while creating room." });
    }
  });

  // JOIN
  socket.on("joinRoom", ({ roomId, name }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ success: false, message: "الغرفة غير موجودة." });
    if (room.players.length >= room.maxPlayers)
      return cb({ success: false, message: "الغرفة ممتلئة." });

    room.players.push({ id: socket.id, name: name || "Player" });
    socket.join(roomId);
    console.log(`👤 Player joined room ${roomId}: ${name}`);

    // cancel deletion timer if any
    if (roomDeletionTimeouts[roomId]) {
      clearTimeout(roomDeletionTimeouts[roomId]);
      delete roomDeletionTimeouts[roomId];
    }

    io.to(roomId).emit("playerJoined", { players: room.players });
    cb({ success: true, room: getRoomState(roomId) });
  });

  // HOST: start question entry
  socket.on("startQuestionEntry", ({ roomId }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ success: false, message: "Room not found." });
    if (socket.id !== room.hostId)
      return cb({ success: false, message: "Only host can start." });

    room.phase = "question";
    io.to(roomId).emit("startQuestionEntry", { room: getRoomState(roomId) });
    cb({ success: true });
  });

  // CLIENT: submit one question (ACK!)
  socket.on("submitQuestion", ({ roomId, question }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ success: false, message: "Room not found." });
    if (!question || typeof question.text !== "string")
      return cb({ success: false, message: "Invalid question." });

    const q = {
      from: socket.id,
      text: String(question.text).trim(),
      target: question.target === "random" ? "random" : String(question.target || "random"),
    };
    room.questions.push(q);
    console.log(`❓ Question submitted to ${roomId} from ${socket.id}`);
    cb({ success: true }); // IMPORTANT: ack so client can continue
  });

  // CLIENT: mark ready after submitting all their questions
  socket.on("playerReady", ({ roomId, playerId }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ success: false, message: "Room not found." });
    room.readyPlayers.add(playerId || socket.id);

    io.to(roomId).emit("playerReadyUpdate", {
      playerId: playerId || socket.id,
      readyCount: room.readyPlayers.size,
      total: room.players.length,
    });

    // If all ready, notify host to enable Start Game
    if (room.readyPlayers.size === room.players.length) {
      io.to(room.hostId).emit("allPlayersReady", { room: getRoomState(roomId) });
    }
    cb({ success: true });
  });

  // HOST: start the game for everyone
  socket.on("startGame", ({ roomId }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room) return cb({ success: false, message: "Room not found." });
    if (socket.id !== room.hostId)
      return cb({ success: false, message: "Only host can start." });

    room.phase = "playing";
    io.to(roomId).emit("startGame", {
      players: room.players,
      questions: room.questions,
      room: getRoomState(roomId),
    });
    cb({ success: true });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      const idx = room.players.findIndex((p) => p.id === socket.id);
      if (idx === -1) continue;

      const [player] = room.players.splice(idx, 1);
      room.readyPlayers.delete(socket.id);
      console.log(`🚪 ${player.name} left room ${roomId}`);

      // host left? promote first player if exists
      if (socket.id === room.hostId && room.players.length > 0) {
        room.hostId = room.players[0].id;
        io.to(roomId).emit("hostChanged", { hostId: room.hostId });
      }

      io.to(roomId).emit("playerLeft", {
        playerId: socket.id,
        players: room.players,
        room: getRoomState(roomId),
      });

      if (room.players.length === 0) {
        roomDeletionTimeouts[roomId] = setTimeout(() => {
          delete rooms[roomId];
          delete roomDeletionTimeouts[roomId];
          console.log(`🗑️ Room ${roomId} deleted after timeout`);
        }, 5 * 60 * 1000);
      }
      break;
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
