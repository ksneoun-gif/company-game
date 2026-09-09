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
            sessions[sessionCode] = { players: {}, turn: 1, phase: 'playing' };
        }

        if (isOperator) {
            socket.emit('update_dashboard', {
                players: sessions[sessionCode].players,
                turn: sessions[sessionCode].turn,
                phase: sessions[sessionCode].phase
            });
        } else {
            sessions[sessionCode].players[socket.id] = {
                socketId: socket.id, milId, name, rank,
                balance: 75000000, trust: 45, debt: 30, execRate: 0, availableCash: 52000000,
                turn: sessions[sessionCode].turn, status: '집행 대기중', lastAction: '접속 완료'
            };
            socket.emit('sync_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', {
                players: sessions[sessionCode].players,
                turn: sessions[sessionCode].turn,
                phase: sessions[sessionCode].phase
            });
        }
    });

    // 💡 [버그 2 해결] 소켓 ID가 변경되더라도 고유 군번(milId)을 추적하여 실시간 연동 보장
    socket.on('update_state', (data) => {
        const { sessionCode, milId } = data;
        if (!sessionCode || !milId) return;

        if (sessions[sessionCode]) {
            let playerKey = Object.keys(sessions[sessionCode].players).find(k => sessions[sessionCode].players[k].milId === milId);
            
            if (playerKey) {
                // 모바일 환경 등에서 소켓 연결이 끊겼다 다시 붙은 경우 식별자 강제 업데이트
                if (playerKey !== socket.id) {
                    sessions[sessionCode].players[socket.id] = sessions[sessionCode].players[playerKey];
                    sessions[sessionCode].players[socket.id].socketId = socket.id;
                    delete sessions[sessionCode].players[playerKey];
                    playerKey = socket.id;
                    socket.join(sessionCode); // 방 재입장
                }
                
                Object.assign(sessions[sessionCode].players[playerKey], data);
                io.to(sessionCode).emit('update_dashboard', {
                    players: sessions[sessionCode].players,
                    turn: sessions[sessionCode].turn,
                    phase: sessions[sessionCode].phase
                });
            }
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
            let currentTurn = sessions[sessionCode].turn;
            let isSuppPhase = (currentTurn >= 4 && currentTurn <= 8);
            sessions[sessionCode].phase = isSuppPhase ? 'waiting_supp' : 'playing';

            for (let id in sessions[sessionCode].players) {
                if (!sessions[sessionCode].players[id].status.includes('사고')) {
                    sessions[sessionCode].players[id].turn = currentTurn;
                    sessions[sessionCode].players[id].status = isSuppPhase ? '추경 검토 대기중' : '예산 집행 중';
                }
            }
            
            if (isSuppPhase) {
                io.to(sessionCode).emit('wait_for_supp_budget', currentTurn);
            } else {
                io.to(sessionCode).emit('trigger_next_turn', currentTurn);
            }
            
            io.to(sessionCode).emit('update_dashboard', {
                players: sessions[sessionCode].players, turn: currentTurn, phase: sessions[sessionCode].phase
            });
        }
    });

    socket.on('start_execution', (sessionCode) => {
        if (sessions[sessionCode]) {
            sessions[sessionCode].phase = 'playing';
            for (let id in sessions[sessionCode].players) {
                if (!sessions[sessionCode].players[id].status.includes('사고')) {
                    sessions[sessionCode].players[id].status = '예산 집행 중';
                }
            }
            io.to(sessionCode).emit('trigger_next_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', {
                players: sessions[sessionCode].players, turn: sessions[sessionCode].turn, phase: sessions[sessionCode].phase
            });
        }
    });

    socket.on('force_end_game', (sessionCode) => {
        if (sessions[sessionCode]) {
            for (let id in sessions[sessionCode].players) {
                sessions[sessionCode].players[id].status = '종합 결산 완료';
            }
            io.to(sessionCode).emit('trigger_game_end');
            io.to(sessionCode).emit('update_dashboard', {
                players: sessions[sessionCode].players, turn: sessions[sessionCode].turn, phase: 'ended'
            });
        }
    });

    socket.on('kick_player', (data) => {
        const { sessionCode, socketId } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[socketId]) {
            delete sessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', {
                players: sessions[sessionCode].players, turn: sessions[sessionCode].turn, phase: sessions[sessionCode].phase
            });
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