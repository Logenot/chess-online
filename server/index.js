// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid'); // для генерации уникальных ID комнат

const app = express();

// Укажите свой фронтенд-домен
const allowedOrigin = 'https://chess-online-one.vercel.app';
app.use(cors({ origin: allowedOrigin, methods: ['GET','POST'], credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET','POST'],
    credentials: true,
  },
});

// ---- Состояние комнат и рейтинга ----
const rooms = {};          // roomId → [{ id, nickname }, …]
const waitingQueue = [];   // очередь игроков, ждущих оппонента
const leaderboard = {};
function recordResult(winner, loser) {
  [winner, loser].forEach(n => {
    if (!leaderboard[n]) leaderboard[n] = { wins: 0, totalGames: 0 };
    leaderboard[n].totalGames += 1;
  });
  leaderboard[winner].wins += 1;
}

// ---- Leaderboard REST API ----
app.get('/leaderboard', (req, res) => {
  const data = Object.entries(leaderboard).map(([nick, stats]) => ({
    nickname: nick,
    wins: stats.wins,
    totalGames: stats.totalGames,
  }));
  data.sort((a, b) => b.wins - a.wins);
  res.json(data);
});

// ---- WebSocket ----
io.on('connection', socket => {
  console.log('👤 Connected:', socket.id);

  // Игрок хочет найти соперника
  socket.on('findMatch', ({ nickname }) => {
    socket.data.nickname = nickname;
    waitingQueue.push(socket);

    // Если в очереди ≥2 — спариваем первых двоих
    if (waitingQueue.length >= 2) {
      const [sock1, sock2] = waitingQueue.splice(0, 2);
      const roomId = nanoid(8);

      // создаём комнату и добавляем обоих
      rooms[roomId] = [
        { id: sock1.id, nickname: sock1.data.nickname },
        { id: sock2.id, nickname: sock2.data.nickname },
      ];
      sock1.join(roomId);
      sock2.join(roomId);

      // уведомляем клиентов о найденном матче
      io.to(sock1.id).emit('matchFound', { roomId, color: 'white', players: rooms[roomId] });
      io.to(sock2.id).emit('matchFound', { roomId, color: 'black', players: rooms[roomId] });
      console.log(`🎯 Matched ${sock1.id} & ${sock2.id} → room ${roomId}`);
    }
  });

  socket.on('move', ({ roomId, move }) => {
    socket.to(roomId).emit('move', move);
  });

  socket.on('gameOver', ({ roomId, winner, loser }) => {
    recordResult(winner, loser);
  });

  socket.on('disconnect', () => {
    // чистим очередь
    const idxQ = waitingQueue.findIndex(s => s.id === socket.id);
    if (idxQ !== -1) waitingQueue.splice(idxQ, 1);

    // удаляем из комнат
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
server.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
