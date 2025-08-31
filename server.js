const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    maxHttpBufferSize: 1e8
});

app.use(cors());
app.use(express.static('public', { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

const rooms = ['General', 'Tech', 'Random'];
const users = new Map();
const onlineUsers = new Map();
const messages = new Map();
const friends = new Map();
const roomExpiries = new Map();

io.on('connection', (socket) => {
    socket.on('join', ({ username, room, expiry }) => {
        if (users.has(username) && users.get(username) !== socket.id) {
            socket.emit('error', 'Username already taken');
            return;
        }

        users.set(username, socket.id);
        socket.join(room);
        socket.username = username;
        socket.room = room;

        if (!onlineUsers.has(room)) onlineUsers.set(room, []);
        if (!onlineUsers.get(room).includes(username)) {
            onlineUsers.get(room).push(username);
        }
        io.to(room).emit('onlineUsers', onlineUsers.get(room));

        io.to(room).emit('message', {
            id: Date.now(),
            username: 'System',
            text: `${username} joined the room`,
            timestamp: new Date().toLocaleTimeString(),
            seen: true,
        });
        io.emit('roomList', rooms);

        if (expiry) {
            roomExpiries.set(room, setTimeout(() => {
                io.to(room).emit('roomExpiry');
                socket.leave(room);
                onlineUsers.delete(room);
                roomExpiries.delete(room);
            }, expiry - Date.now()));
        }
    });

    socket.on('message', (msg) => {
        msg.seen = false;
        messages.set(msg.id, { ...msg, seenBy: [msg.username] });
        io.to(msg.room).emit('message', msg);
    });

    socket.on('privateMessage', ({ to, ...msg }) => {
        msg.seen = false;
        const targetSocketId = users.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('privateMessage', msg);
            io.to(users.get(msg.username)).emit('privateMessage', msg);
        }
    });

    socket.on('addFriend', ({ username, friend }) => {
        if (!friends.has(username)) friends.set(username, new Set());
        if (!friends.has(friend)) friends.set(friend, new Set());
        friends.get(username).add(friend);
        friends.get(friend).add(username);
        io.to(users.get(username)).emit('friendsUpdate', Array.from(friends.get(username)));
        if (users.get(friend)) {
            io.to(users.get(friend)).emit('friendsUpdate', Array.from(friends.get(friend)));
        }
    });

    socket.on('createRoom', ({ name, expiry }) => {
        if (!rooms.includes(name)) {
            rooms.push(name);
            io.emit('roomList', rooms);
            if (expiry) {
                roomExpiries.set(name, setTimeout(() => {
                    io.to(name).emit('roomExpiry');
                    socket.leave(name);
                    onlineUsers.delete(name);
                    roomExpiries.delete(name);
                }, expiry - Date.now()));
            }
        }
    });

    socket.on('typing', ({ username, room }) => {
        socket.to(room).emit('typing', username);
    });

    socket.on('stopTyping', ({ username, room }) => {
        socket.to(room).emit('stopTyping', username);
    });

    socket.on('seen', ({ room, id }) => {
        if (messages.has(id)) {
            const msg = messages.get(id);
            if (!msg.seenBy.includes(socket.username)) {
                msg.seenBy.push(socket.username);
                if (onlineUsers.has(room) && msg.seenBy.length === onlineUsers.get(room).length) {
                    msg.seen = true;
                    io.to(room).emit('seenUpdate', { id, seen: true });
                }
            }
        }
    });

    socket.on('file', ({ username, room, file, type, name }) => {
        const targetSocketId = users.get(room.split('-')[2]);
        if (targetSocketId) {
            io.to(targetSocketId).emit('file', { username, room, file, type, name, timestamp: new Date().toLocaleTimeString(), seen: false });
            io.to(users.get(username)).emit('file', { username, room, file, type, name, timestamp: new Date().toLocaleTimeString(), seen: false });
        } else {
            io.to(room).emit('file', { username, room, file, type, name, timestamp: new Date().toLocaleTimeString(), seen: false });
        }
    });

    socket.on('offer', ({ offer, to, type }) => {
        const targetSocketId = users.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('offer', { offer, from: socket.username, type });
        }
    });

    socket.on('answer', ({ answer, to }) => {
        const targetSocketId = users.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('answer', { answer });
        }
    });

    socket.on('candidate', ({ candidate, to }) => {
        const targetSocketId = users.get(to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('candidate', { candidate });
        }
    });

    socket.on('reaction', ({ id, reaction }) => {
        console.log(`Message ${id} got a reaction: ${reaction}`);
    });

    socket.on('canvasUpdate', ({ room, data }) => {
        io.to(room).emit('canvasUpdate', { data });
    });

    socket.on('aiQuery', ({ room, query }) => {
        const response = `AI response to "${query}" in ${room}: This is a dummy response.`;
        io.to(users.get(socket.username)).emit('aiResponse', response);
    });

    socket.on('disconnect', () => {
        if (socket.username) {
            users.delete(socket.username);
            if (onlineUsers.has(socket.room)) {
                onlineUsers.set(socket.room, onlineUsers.get(socket.room).filter((u) => u !== socket.username));
                io.to(socket.room).emit('onlineUsers', onlineUsers.get(socket.room));
            }
            io.to(socket.room).emit('message', {
                id: Date.now(),
                username: 'System',
                text: `${socket.username} left the room`,
                timestamp: new Date().toLocaleTimeString(),
                seen: true,
            });
        }
    });
});

server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
});
