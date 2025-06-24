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

app.get('/', (req, res) => {
  res.send('Chess backend is running');
});

// Хранилище данных
const rooms = {}; // { roomId: { players: { socketId: nickname } } }
const playersStats = {}; // { nickname: { wins: 0 } }

io.on('connection', (socket) => {
  console.log('👤 New user connected:', socket.id);

  socket.on('joinRoom', ({ roomId, nickname }) => {
    socket.join(roomId);
    
    // Инициализация комнаты
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: {}
      };
    }
    
    // Сохраняем игрока в комнате
    rooms[roomId].players[socket.id] = nickname;
    
    // Инициализация статистики для нового игрока
    if (!playersStats[nickname]) {
      playersStats[nickname] = { wins: 0 };
    }
    
    console.log(`📥 ${nickname} (${socket.id}) joined room ${roomId}`);
  });

  socket.on('move', ({ roomId, move, nickname }) => {
    console.log(`♟ Move by ${nickname} in room ${roomId}:`, move);
    socket.to(roomId).emit('move', move);
  });

  socket.on('gameOver', ({ roomId, winner }) => {
    console.log(`🏆 Game over in room ${roomId}, winner: ${winner}`);
    
    // Обновляем статистику побед
    if (playersStats[winner]) {
      playersStats[winner].wins += 1;
    } else {
      playersStats[winner] = { wins: 1 };
    }
    
    // Рассылаем результат игры
    io.to(roomId).emit('gameOver', winner);
  });

  socket.on('getRating', () => {
    // Получаем топ-10 игроков по количеству побед
    const topPlayers = Object.entries(playersStats)
      .map(([nickname, stats]) => ({ nickname, wins: stats.wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 10);
    
    socket.emit('rating', topPlayers);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Удаляем игрока из всех комнат
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
      }
      
      // Удаляем пустые комнаты
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});