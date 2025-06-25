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
const leaderboard = {};
const waitingPlayers = new Map(); // ID сокета -> никнейм

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

    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push({ id: socket.id, nickname });
    socket.join(roomId);

    console.log(`📥 ${socket.id} (${nickname}) joined room ${roomId}`);
    io.to(roomId).emit('roomUpdate', {
      players: rooms[roomId],
    });
  });

  socket.on('findOpponent', ({ nickname }) => {
    socket.data.nickname = nickname;
    
    // Проверяем есть ли ожидающие игроки
    if (waitingPlayers.size > 0) {
      // Берём первого ожидающего
      const [opponentId, opponentNick] = waitingPlayers.entries().next().value;
      waitingPlayers.delete(opponentId);
      
      // Создаем комнату
      const roomId = `auto_${Date.now()}`;
      rooms[roomId] = [
        { id: opponentId, nickname: opponentNick },
        { id: socket.id, nickname }
      ];
      
      // Присоединяем обоих игроков
      const opponentSocket = io.sockets.sockets.get(opponentId);
      opponentSocket.join(roomId);
      socket.join(roomId);
      
      // Уведомляем игроков
      io.to(opponentId).emit('joinAutoRoom', roomId);
      socket.emit('joinAutoRoom', roomId);
      
      // Отправляем обновление состояния комнаты
      io.to(roomId).emit('roomUpdate', {
        players: rooms[roomId],
      });
      
      console.log(`🤝 Created auto room ${roomId} for ${nickname} and ${opponentNick}`);
    } else {
      // Добавляем в очередь ожидания
      waitingPlayers.set(socket.id, nickname);
      console.log(`⏳ Player ${nickname} added to waiting queue`);
    }
  });

  socket.on('cancelSearch', () => {
    if (waitingPlayers.has(socket.id)) {
      const nickname = waitingPlayers.get(socket.id);
      waitingPlayers.delete(socket.id);
      console.log(`❌ ${nickname} canceled search`);
    }
  });

  socket.on('move', ({ roomId, move }) => {
    console.log(`♟ Move in room ${roomId}:`, move);
    socket.to(roomId).emit('move', move);
  });

  socket.on('gameOver', ({ roomId, winner, loser }) => {
    console.log(`🏁 Game over in room ${roomId}. Winner: ${winner}, Loser: ${loser}`);
    recordResult(winner, loser);
    
    // Удаляем комнату после завершения игры
    if (rooms[roomId]) {
      delete rooms[roomId];
      console.log(`🗑 Room ${roomId} deleted after game over`);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    // Удаляем из очереди ожидания при отключении
    if (waitingPlayers.has(socket.id)) {
      const nickname = waitingPlayers.get(socket.id);
      waitingPlayers.delete(socket.id);
      console.log(`🚮 ${nickname} removed from waiting queue (disconnected)`);
    }
    
    // Удаляем из комнат и уведомляем других игроков
    for (const roomId in rooms) {
      const roomPlayers = rooms[roomId];
      const playerIndex = roomPlayers.findIndex(player => player.id === socket.id);
      
      if (playerIndex !== -1) {
        const nickname = roomPlayers[playerIndex].nickname;
        rooms[roomId] = roomPlayers.filter(player => player.id !== socket.id);
        
        // Уведомляем оставшихся игроков
        io.to(roomId).emit('roomUpdate', {
          players: rooms[roomId],
        });
        
        console.log(`🚪 ${nickname} left room ${roomId} (disconnected)`);
        
        // Удаляем комнату если остался 1 игрок
        if (rooms[roomId].length < 2) {
          delete rooms[roomId];
          console.log(`🗑 Room ${roomId} deleted (not enough players)`);
        }
      }
    }
  });
});

// ---- Запуск ----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});