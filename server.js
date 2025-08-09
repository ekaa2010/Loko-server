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

// 6 أرقام
function generateRoomId() {
return Math.floor(100000 + Math.random() * 900000).toString();
}

// الحالة
const rooms = {};                 // roomId -> { hostId, maxPlayers, players[], questions[], readyPlayers:Set, phase, createdAt }
const roomDeletionTimeouts = {};  // roomId -> timeoutId

function getRoomState(roomId) {
const r = rooms[roomId];
if (!r) return null;
return {
roomId,
hostId: r.hostId,
maxPlayers: r.maxPlayers,
phase: r.phase,
players: (r.players || []).map(p => ({ id: p.id, name: p.name })),
readyCount: r.readyPlayers.size,
questionsCount: r.questions.length,
};
}

io.on("connection", (socket) => {
console.log("🔌 connected:", socket.id);

// إنشاء غرفة
socket.on("createRoom", ({ name, maxPlayers }, cb = () => {}) => {
try {
const roomId = generateRoomId();
rooms[roomId] = {
hostId: socket.id,
maxPlayers: Number(maxPlayers) || 8,
players: [{ id: socket.id, name: name || "Player" }],
questions: [],
readyPlayers: new Set(),
phase: "waiting", // waiting -> question -> playing -> ended
createdAt: Date.now(),
};
socket.join(roomId);
console.log(✅ Room created ${roomId} by ${name});
cb({ success: true, roomId, room: getRoomState(roomId) });
io.to(roomId).emit("playerJoined", { players: rooms[roomId].players });
} catch (e) {
console.error(e);
cb({ success: false, message: "Server error while creating room." });
}
});

// الانضمام
socket.on("joinRoom", ({ roomId, name }, cb = () => {}) => {
const room = rooms[roomId];
if (!room) return cb({ success: false, message: "الغرفة غير موجودة." });
if (room.players.length >= room.maxPlayers)
return cb({ success: false, message: "الغرفة ممتلئة." });

room.players.push({ id: socket.id, name: name || "Player" });  
socket.join(roomId);  
console.log(`👤 joined ${roomId}: ${name}`);  

if (roomDeletionTimeouts[roomId]) {  
  clearTimeout(roomDeletionTimeouts[roomId]);  
  delete roomDeletionTimeouts[roomId];  
}  

io.to(roomId).emit("playerJoined", { players: room.players });  
cb({ success: true, room: getRoomState(roomId) });

});

// الهوست يبدأ مرحلة إدخال الأسئلة
socket.on("startQuestionEntry", ({ roomId }, cb = () => {}) => {
const room = rooms[roomId];
if (!room) return cb({ success: false, message: "Room not found." });
if (socket.id !== room.hostId)
return cb({ success: false, message: "Only host can start." });

room.phase = "question";  
io.to(roomId).emit("startQuestionEntry", { room: getRoomState(roomId) });  
cb({ success: true });

});

// إضافة سؤال (ACK مهم)
socket.on("submitQuestion", ({ roomId, question }, cb = () => {}) => {
const room = rooms[roomId];
if (!room) return cb({ success: false, message: "Room not found." });
if (!question || typeof question.text !== "string")
return cb({ success: false, message: "Invalid question." });

const q = {  
  from: socket.id,  
  text: String(question.text).trim(),  
  target:  
    question.target === "random"  
      ? "random"  
      : String(question.target || "random"),  
};  
room.questions.push(q);  
console.log(`❓ Q -> ${roomId} from ${socket.id}`);  
cb({ success: true });

});

// اللاعب جاهز
socket.on("playerReady", ({ roomId, playerId }, cb = () => {}) => {
const room = rooms[roomId];
if (!room) return cb({ success: false, message: "Room not found." });

const pid = playerId || socket.id;  
room.readyPlayers.add(pid);  

// بث تحديث العدّاد  
io.to(roomId).emit("playerReadyUpdate", {  
  playerId: pid,  
  readyCount: room.readyPlayers.size,  
  total: room.players.length,  
});  

// لو الكل جاهز أبعت إشارة واضحة ومعاها hostId  
if (room.readyPlayers.size === room.players.length) {  
  io.to(roomId).emit("allPlayersReady", {  
    room: getRoomState(roomId),  
    hostId: room.hostId,  
  });  
  console.log(`🟢 all ready in ${roomId}`);  
}  
cb({ success: true });

});

// الهوست يبدأ اللعبة
socket.on("startGame", ({ roomId }, cb = () => {}) => {
const room = rooms[roomId];
if (!room) return cb({ success: false, message: "Room not found." });
if (socket.id !== room.hostId)
return cb({ success: false, message: "Only host can start." });

room.phase = "playing";  
io.to(roomId).emit("startGame", {  
  room: getRoomState(roomId),  
  players: room.players,  
  questions: room.questions,  
});  
console.log(`🚀 startGame -> ${roomId}`);  
cb({ success: true });

});

// فصل الاتصال
socket.on("disconnect", () => {
console.log("❌ disconnected:", socket.id);
for (const roomId in rooms) {
const room = rooms[roomId];
const idx = room.players.findIndex(p => p.id === socket.id);
if (idx === -1) continue;

const [player] = room.players.splice(idx, 1);  
  room.readyPlayers.delete(socket.id);  
  console.log(`🚪 ${player.name} left ${roomId}`);  

  // لو الهوست خرج نرقي أول لاعب باقي  
  if (socket.id === room.hostId && room.players.length > 0) {  
    room.hostId = room.players[0].id;  
    io.to(roomId).emit("hostChanged", { hostId: room.hostId });  
  }  

  io.to(roomId).emit("playerLeft", {  
    playerId: socket.id,  
    players: room.players,  
    room: getRoomState(roomId),  
  });  

  // لو فاضية نحط تايمر حذف 5 دقايق  
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

