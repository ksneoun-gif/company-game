const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// 통신이 지연되어도 연결을 유지하도록 타임아웃 대폭 연장
const io = new Server(server, {
    pingTimeout: 60000, 
    pingInterval: 25000 
});

app.use(express.static(path.join(__dirname, 'public')));
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
            // 접속이 끊겼던 유저가 돌아왔는지 군번(milId)으로 확인하여 데이터 복구
            const existingId = Object.keys(gameSessions[sessionCode].players).find(
                id => gameSessions[sessionCode].players[id].milId === milId
            );

            if (existingId) {
                gameSessions[sessionCode].players[socket.id] = gameSessions[sessionCode].players[existingId];
                gameSessions[sessionCode].players[socket.id].status = gameSessions[sessionCode].players[socket.id].status.replace(' (네트워크 끊김)', '');
                if (existingId !== socket.id) delete gameSessions[sessionCode].players[existingId];
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
            for (let id in players) {
                if (!players[id].status.includes('파산')) {
                    players[id].status = '의사결정 중';
                    players[id].turn += 1;
                }
            }
            io.to(sessionCode).emit('trigger_next_turn');
            io.to(sessionCode).emit('update_dashboard', players);
        }
    });

    socket.on('disconnect', () => {
        const sCode = socket.sessionCode;
        if (sCode && gameSessions[sCode] && !socket.isOperator) {
            // 완전히 튕겨도 데이터는 살려두고 상태만 끊김으로 표기
            if (gameSessions[sCode].players[socket.id]) {
                if (!gameSessions[sCode].players[socket.id].status.includes('끊김')) {
                    gameSessions[sCode].players[socket.id].status += ' (네트워크 끊김)';
                }
                io.to(sCode).emit('update_dashboard', gameSessions[sCode].players);
            }
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 서버 구동 완료: http://localhost:${PORT}`);
});