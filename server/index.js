// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

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

// ---- Состояние комнат и пользователей ----
const rooms = {};
// Словарь для рейтинга
const leaderboard = {};
function recordResult(winner, loser) {
  [winner, loser].forEach(nick => {
    if (!leaderboard[nick]) {
      leaderboard[nick] = { wins: 0, totalGames: 0 };
    }
    leaderboard[nick].totalGames += 1;
  });
  leaderboard[winner].wins += 1;
}

// ---- REST маршрут для Leaderboard ----
app.get('/leaderboard', (req, res) => {
  const data = Object.keys(leaderboard).map(nick => {
    const stats = leaderboard[nick];
    return {
      nickname: nick,
      wins: stats.wins,
      totalGames: stats.totalGames,
    };
  });
  data.sort((a, b) => b.wins - a.wins);
  res.json(data);
});

// ---- WebSocket логика ----
io.on('connection', (socket) => {
  console.log('👤 New user connected:', socket.id);

  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.data.nickname = nickname;
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);
    console.log(`📥 ${socket.id} (${nickname}) joined room ${roomId}`);
    io.to(roomId).emit('roomUpdate', {
      players: rooms[roomId],
    });
  });

  socket.on('move', ({ roomId, move }) => {
    console.log(`♟ Move in room ${roomId}:`, move);
    socket.to(roomId).emit('move', move);
  });

  // Приходит от клиента по окончании игры
  socket.on('gameOver', ({ roomId, winner, loser }) => {
    console.log(`🏁 Game over in room ${roomId}. Winner: ${winner}, Loser: ${loser}`);
    recordResult(winner, loser);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    for (const roomId in rooms) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      io.to(roomId).emit('roomUpdate', { players: rooms[roomId] });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
