// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');

const app = express();
const allowedOrigin = 'https://chess-online-one.vercel.app'; // <-- ваш фронтенд
app.use(cors({ origin: allowedOrigin, methods: ['GET','POST'], credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET','POST'],
    credentials: true,
  },
});

// Состояние
const rooms = {};        // roomId → [{ id, nickname }, ...]
const waitingQueue = []; // очередь для поиска случайного соперника
const leaderboard = {};  // nickname → { wins, totalGames }

function recordResult(winner, loser) {
  [winner, loser].forEach(nick => {
    if (!leaderboard[nick]) leaderboard[nick] = { wins: 0, totalGames: 0 };
    leaderboard[nick].totalGames += 1;
  });
  leaderboard[winner].wins += 1;
}

// REST для таблицы лидеров
app.get('/leaderboard', (req, res) => {
  const data = Object.entries(leaderboard).map(([nick, stats]) => ({
    nickname: nick,
    wins: stats.wins,
    totalGames: stats.totalGames,
  }));
  data.sort((a, b) => b.wins - a.wins);
  res.json(data);
});

io.on('connection', socket => {
  console.log('👤 New connection:', socket.id);

  // ==== Вариант A: Join by Room ID ====
  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.data.nickname = nickname;
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push({ id: socket.id, nickname });
    socket.join(roomId);
    io.to(roomId).emit('roomUpdate', { players: rooms[roomId] });
    console.log(`🔑 ${nickname} joined room ${roomId}`);
  });

  // ==== Вариант B: Find random opponent ====
  socket.on('findMatch', ({ nickname }) => {
    socket.data.nickname = nickname;
    waitingQueue.push(socket);
    console.log(`🎯 ${nickname} is searching for match, queue length = ${waitingQueue.length}`);
    
    if (waitingQueue.length >= 2) {
      const [s1, s2] = waitingQueue.splice(0, 2);
      const roomId = nanoid(8);
      rooms[roomId] = [
        { id: s1.id, nickname: s1.data.nickname },
        { id: s2.id, nickname: s2.data.nickname },
      ];
      s1.join(roomId);
      s2.join(roomId);
      // Белыми первый в паре, чёрными второй
      io.to(s1.id).emit('matchFound', { roomId, color: 'white', players: rooms[roomId] });
      io.to(s2.id).emit('matchFound', { roomId, color: 'black', players: rooms[roomId] });
      console.log(`🤝 Matched ${s1.data.nickname} & ${s2.data.nickname} in room ${roomId}`);
    }
  });

  // Перенаправляем ход
  socket.on('move', ({ roomId, move }) => {
    socket.to(roomId).emit('move', move);
  });

  // Игра окончена
  socket.on('gameOver', ({ roomId, winner, loser }) => {
    recordResult(winner, loser);
    console.log(`🏁 Game over in ${roomId}: ${winner} beat ${loser}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnected:', socket.id);
    // удалить из waitingQueue
    const qi = waitingQueue.findIndex(s => s.id === socket.id);
    if (qi !== -1) waitingQueue.splice(qi, 1);
    // удалить из всех комнат
    for (const roomId in rooms) {
      const arr = rooms[roomId];
      const idx = arr.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        arr.splice(idx, 1);
        io.to(roomId).emit('roomUpdate', { players: arr });
        if (arr.length === 0) delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
