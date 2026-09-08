const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

const sessions = {};

io.on('connection', (socket) => {
    socket.on('join_game', (data) => {
        const { sessionCode, milId, name, rank, isOperator } = data;
        socket.join(sessionCode);

        if (!sessions[sessionCode]) {
            sessions[sessionCode] = { players: {}, turn: 1 };
        }

        if (isOperator) {
            socket.emit('update_dashboard', sessions[sessionCode].players);
        } else {
            // 💡 [수정] 가동률 50%, 리스크 20%로 초기화
            sessions[sessionCode].players[socket.id] = {
                socketId: socket.id, milId, name, rank,
                balance: 100000000, trust: 50, debt: 20, execRate: 0,
                turn: sessions[sessionCode].turn, status: '집행 대기중', lastAction: '접속 완료'
            };
            socket.emit('sync_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    socket.on('update_state', (data) => {
        let userSession = Object.keys(sessions).find(c => sessions[c].players[socket.id]);
        if (userSession) {
            Object.assign(sessions[userSession].players[socket.id], data);
            io.to(userSession).emit('update_dashboard', sessions[userSession].players);
        }
    });

    socket.on('admin_grant_budget', (data) => {
        const { sessionCode, targetId, amount } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[targetId]) {
            io.to(targetId).emit('receive_special_budget', { amount });
        }
    });

    socket.on('force_next_turn', (sessionCode) => {
        if (sessions[sessionCode]) {
            sessions[sessionCode].turn++;
            for (let id in sessions[sessionCode].players) {
                if (!sessions[sessionCode].players[id].status.includes('사고')) {
                    sessions[sessionCode].players[id].turn = sessions[sessionCode].turn;
                    sessions[sessionCode].players[id].status = '예산 집행 중';
                }
            }
            io.to(sessionCode).emit('trigger_next_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    socket.on('force_end_game', (sessionCode) => {
        if (sessions[sessionCode]) {
            for (let id in sessions[sessionCode].players) {
                sessions[sessionCode].players[id].status = '종합 결산 완료';
            }
            io.to(sessionCode).emit('trigger_game_end');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    socket.on('kick_player', (data) => {
        const { sessionCode, socketId } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[socketId]) {
            delete sessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    socket.on('reset_session', (sessionCode) => {
        if (sessions[sessionCode]) {
            io.to(sessionCode).emit('session_reset');
            delete sessions[sessionCode];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`국방 재정 시뮬레이션 서버가 포트 ${PORT}에서 정상 실행 중입니다.`);
});