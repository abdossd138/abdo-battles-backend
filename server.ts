import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Room state management (optional for basic sync)
  const rooms = new Map<string, any>();
  const roomConfigs = new Map<string, { maxPlayers: number, hostId: string, players: string[] }>();

  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join Room
    socket.on('join_room', (data) => {
      // Backwards compatibility if client just sends string
      const roomCode = typeof data === 'string' ? data : data.roomCode;
      const maxPlayers = typeof data === 'object' ? data.maxPlayers : 2;
      const isHost = typeof data === 'object' ? data.isHost : false;

      socket.join(roomCode);
      console.log(`User ${socket.id} joined room ${roomCode}`);
      
      if (!roomConfigs.has(roomCode)) {
        roomConfigs.set(roomCode, { maxPlayers, hostId: socket.id, players: [] });
      }
      
      const config = roomConfigs.get(roomCode)!;
      if (isHost && !config.hostId) {
        config.hostId = socket.id;
        if (maxPlayers) config.maxPlayers = maxPlayers;
      }
      
      if (!config.players.includes(socket.id)) {
        config.players.push(socket.id);
      }

      // Broadcast config
      io.to(roomCode).emit('room_config_updated', config);
      
      // Notify others in room
      socket.to(roomCode).emit('player_joined', socket.id);
      
      // If room has state, send it to the new player
      if (rooms.has(roomCode)) {
        const roomState = rooms.get(roomCode);
        for (const [key, value] of Object.entries(roomState)) {
          socket.emit('sync_shared_state', { key, value });
        }
      } else {
        rooms.set(roomCode, {});
      }
    });

    // Sync Shared State
    socket.on('update_shared_state', ({ roomCode, key, value }) => {
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, {});
      }
      rooms.get(roomCode)[key] = value;
      // Broadcast to everyone else in the room
      socket.to(roomCode).emit('sync_shared_state', { key, value });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      // Remove from roomConfigs
      for (const [roomCode, config] of roomConfigs.entries()) {
        const index = config.players.indexOf(socket.id);
        if (index !== -1) {
          config.players.splice(index, 1);
          io.to(roomCode).emit('room_config_updated', config);
          // If room empty, clean up
          if (config.players.length === 0) {
            roomConfigs.delete(roomCode);
            rooms.delete(roomCode);
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
