const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const allowedOrigin = 'https://chess-online-one.vercel.app';

app.use(cors({
  origin: allowedOrigin,
  methods: ['GET', 'POST'],
  credentials: true,
}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
  }
});

// Статистика игроков
const playerStats = new Map(); // nickname: { wins: 0, totalGames: 0 }

app.get('/', (req, res) => {
  res.send('Chess backend is running');
});

const rooms = {}; // { roomId: [{ id: socket.id, nickname: string }] }

io.on('connection', (socket) => {
  console.log('👤 New user connected:', socket.id);

  // Установка никнейма
  socket.on('setNickname', (nickname) => {
    socket.nickname = nickname;
    if (!playerStats.has(nickname)) {
      playerStats.set(nickname, { wins: 0, totalGames: 0 });
    }
  });

  // Присоединение к комнате
  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    
    rooms[roomId].push({ 
      id: socket.id, 
      nickname: socket.nickname || `Player_${socket.id.slice(0, 5)}`
    });
    
    console.log(`📥 ${socket.id} joined room ${roomId}`);
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  // Обработка хода
  socket.on('move', ({ roomId, move }) => {
    socket.to(roomId).emit('move', move);
  });

  // Окончание игры
  socket.on('gameOver', ({ winner, loser }) => {
    if (winner && playerStats.has(winner)) {
      const stats = playerStats.get(winner);
      stats.wins += 1;
      stats.totalGames += 1;
    }

    if (loser && playerStats.has(loser)) {
      const stats = playerStats.get(loser);
      stats.totalGames += 1;
    }
  });

  // Запрос таблицы лидеров
  socket.on('getLeaderboard', () => {
    const leaderboard = Array.from(playerStats.entries())
      .map(([nickname, stats]) => ({
        nickname,
        wins: stats.wins,
        totalGames: stats.totalGames
      }))
      .sort((a, b) => b.wins - a.wins || b.totalGames - a.totalGames)
      .slice(0, 10);
      
    socket.emit('leaderboardData', leaderboard);
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    for (const roomId in rooms) {
      rooms[roomId] = rooms[roomId].filter(player => player.id !== socket.id);
      io.to(roomId).emit('roomUpdate', rooms[roomId]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});