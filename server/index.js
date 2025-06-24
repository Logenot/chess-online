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

const rooms = {}; // { roomId: [socketId1, socketId2] }

io.on('connection', (socket) => {
  console.log('👤 New user connected:', socket.id);

  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push(socket.id);
    console.log(📥 ${socket.id} joined room ${roomId});
    io.to(roomId).emit('roomUpdate', rooms[roomId]);
  });

  socket.on('move', ({ roomId, move }) => {
    console.log(♟ Move in room ${roomId}:, move);
    socket.to(roomId).emit('move', move);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    for (const roomId in rooms) {
      rooms[roomId] = rooms[roomId].filter(id => id !== socket.id);
      io.to(roomId).emit('roomUpdate', rooms[roomId]);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(🚀 Server listening on port ${PORT});
});