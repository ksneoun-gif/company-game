const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    pingTimeout: 60000, 
    pingInterval: 25000 
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const gameSessions = {}; 

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        const { sessionCode, name, rank, milId, isOperator } = data;
        socket.join(sessionCode);
        socket.sessionCode = sessionCode;
        socket.isOperator = isOperator;

        if (!gameSessions[sessionCode]) {
            gameSessions[sessionCode] = { players: {} };
        }

        if (!isOperator) {
            const existingId = Object.keys(gameSessions[sessionCode].players).find(
                id => gameSessions[sessionCode].players[id].milId === milId
            );

            if (existingId) {
                const prev = gameSessions[sessionCode].players[existingId];
                if (prev.status.includes('완료') || prev.status.includes('종료') || prev.status.includes('파산')) {
                    gameSessions[sessionCode].players[socket.id] = {
                        name, rank, milId, balance: 50000000, trust: 10, debt: 0,
                        turn: 1, status: '의사결정 중', lastAction: '게임 시작'
                    };
                    if (existingId !== socket.id) delete gameSessions[sessionCode].players[existingId];
                } else {
                    gameSessions[sessionCode].players[socket.id] = prev;
                    gameSessions[sessionCode].players[socket.id].status = prev.status.replace(' (네트워크 끊김)', '');
                    if (existingId !== socket.id) delete gameSessions[sessionCode].players[existingId];
                }
            } else {
                gameSessions[sessionCode].players[socket.id] = {
                    name, rank, milId, balance: 50000000, trust: 10, debt: 0,
                    turn: 1, status: '의사결정 중', lastAction: '게임 시작'
                };
            }
        }
        io.to(sessionCode).emit('update_dashboard', gameSessions[sessionCode].players);
    });

    socket.on('update_state', (stateData) => {
        const sCode = socket.sessionCode;
        if (sCode && gameSessions[sCode] && gameSessions[sCode].players[socket.id]) {
            gameSessions[sCode].players[socket.id] = { ...gameSessions[sCode].players[socket.id], ...stateData };
            io.to(sCode).emit('update_dashboard', gameSessions[sCode].players);
        }
    });

    socket.on('force_next_turn', (sessionCode) => {
        if (gameSessions[sessionCode]) {
            const players = gameSessions[sessionCode].players;
            let canAdvance = false;

            for (let id in players) {
                if (!players[id].status.includes('파산') && !players[id].status.includes('종료')) {
                    if (players[id].turn < 10) {
                        canAdvance = true;
                        players[id].turn += 1;
                        players[id].status = '의사결정 중';
                    } else {
                        players[id].status = '게임 완료';
                    }
                }
            }

            if (canAdvance) {
                io.to(sessionCode).emit('trigger_next_turn');
            } else {
                io.to(sessionCode).emit('trigger_game_end');
            }
            io.to(sessionCode).emit('update_dashboard', players);
        }
    });

    socket.on('force_end_game', (sessionCode) => {
        if (gameSessions[sessionCode]) {
            const players = gameSessions[sessionCode].players;
            for (let id in players) {
                if (!players[id].status.includes('파산')) {
                    players[id].status = '게임 완료';
                }
            }
            io.to(sessionCode).emit('trigger_game_end');
            io.to(sessionCode).emit('update_dashboard', players);
        }
    });

    socket.on('kick_player', ({ sessionCode, socketId }) => {
        if (gameSessions[sessionCode] && gameSessions[sessionCode].players[socketId]) {
            delete gameSessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', gameSessions[sessionCode].players);
        }
    });

    socket.on('reset_session', (sessionCode) => {
        if (gameSessions[sessionCode]) {
            io.to(sessionCode).emit('session_reset');
            gameSessions[sessionCode].players = {};
            io.to(sessionCode).emit('update_dashboard', {});
        }
    });

    socket.on('disconnect', () => {
        const sCode = socket.sessionCode;
        if (sCode && gameSessions[sCode] && !socket.isOperator) {
            if (gameSessions[sCode].players[socket.id]) {
                if (!gameSessions[sCode].players[socket.id].status.includes('끊김')) {
                    gameSessions[sCode].players[socket.id].status += ' (네트워크 끊김)';
                }
                io.to(sCode).emit('update_dashboard', gameSessions[sCode].players);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버 구동 완료 (Port: ${PORT})`);
});