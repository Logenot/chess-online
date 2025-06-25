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
const waitingPlayers = new Map();

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
    
    if (waitingPlayers.size > 0) {
      const [opponentId, opponentNick] = waitingPlayers.entries().next().value;
      waitingPlayers.delete(opponentId);
      
      const roomId = `auto_${Date.now()}`;
      rooms[roomId] = [
        { id: opponentId, nickname: opponentNick },
        { id: socket.id, nickname }
      ];
      
      const opponentSocket = io.sockets.sockets.get(opponentId);
      opponentSocket.join(roomId);
      socket.join(roomId);
      
      io.to(opponentId).emit('joinAutoRoom', roomId);
      socket.emit('joinAutoRoom', roomId);
      
      io.to(roomId).emit('roomUpdate', {
        players: rooms[roomId],
      });
      
      console.log(`🤝 Created auto room ${roomId} for ${nickname} and ${opponentNick}`);
    } else {
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
    
    if (rooms[roomId]) {
      delete rooms[roomId];
      console.log(`🗑 Room ${roomId} deleted after game over`);
    }
  });
  
  // Обработка сдачи
  socket.on('surrender', ({ roomId }) => {
    console.log(`🏳️ Player surrendered in room ${roomId}`);
    
    if (!rooms[roomId]) return;
    
    const surrenderingPlayer = rooms[roomId].find(p => p.id === socket.id);
    const opponent = rooms[roomId].find(p => p.id !== socket.id);
    
    if (!surrenderingPlayer || !opponent) return;
    
    // Запись результата
    recordResult(opponent.nickname, surrenderingPlayer.nickname);
    
    // Уведомление игроков
    io.to(socket.id).emit('gameOver', { 
      winner: opponent.nickname, 
      loser: surrenderingPlayer.nickname 
    });
    
    socket.to(roomId).emit('opponentSurrendered', {
      winner: opponent.nickname,
      loser: surrenderingPlayer.nickname
    });
    
    // Удаление комнаты
    if (rooms[roomId]) {
      delete rooms[roomId];
      console.log(`🗑 Room ${roomId} deleted after surrender`);
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    
    if (waitingPlayers.has(socket.id)) {
      const nickname = waitingPlayers.get(socket.id);
      waitingPlayers.delete(socket.id);
      console.log(`🚮 ${nickname} removed from waiting queue (disconnected)`);
    }
    
    for (const roomId in rooms) {
      const roomPlayers = rooms[roomId];
      const playerIndex = roomPlayers.findIndex(player => player.id === socket.id);
      
      if (playerIndex !== -1) {
        const nickname = roomPlayers[playerIndex].nickname;
        rooms[roomId] = roomPlayers.filter(player => player.id !== socket.id);
        
        io.to(roomId).emit('roomUpdate', {
          players: rooms[roomId],
        });
        
        console.log(`🚪 ${nickname} left room ${roomId} (disconnected)`);
        
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