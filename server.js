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

// 편의 라우트
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

const gameSessions = {}; 

io.on('connection', (socket) => {
    // 1. 게임 접속
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
                // 이미 끝난 게임이거나 새 게임을 시작하는 경우 초기화
                if (prev.status.includes('완료') || prev.status.includes('종료') || prev.status.includes('파산')) {
                    gameSessions[sessionCode].players[socket.id] = {
                        name, rank, milId, balance: 50000000, trust: 10, debt: 0,
                        turn: 1, status: '의사결정 중', lastAction: '게임 시작'
                    };
                    if (existingId !== socket.id) delete gameSessions[sessionCode].players[existingId];
                } else {
                    // 진행 중 단순 재접속
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

    // 2. 실시간 상태 업데이트
    socket.on('update_state', (stateData) => {
        const sCode = socket.sessionCode;
        if (sCode && gameSessions[sCode] && gameSessions[sCode].players[socket.id]) {
            gameSessions[sCode].players[socket.id] = { ...gameSessions[sCode].players[socket.id], ...stateData };
            io.to(sCode).emit('update_dashboard', gameSessions[sCode].players);
        }
    });

    // 3. 턴 일괄 진행 (10턴 한계 완벽 적용)
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

            // 10턴 미만인 사람이 있으면 다음 턴으로 진행, 전원 10턴이면 자동 결산 종료
            if (canAdvance) {
                io.to(sessionCode).emit('trigger_next_turn');
            } else {
                io.to(sessionCode).emit('trigger_game_end');
            }
            io.to(sessionCode).emit('update_dashboard', players);
        }
    });

    // 4. 운영자 재량 게임 강제 종료
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

    // 5. 유령 참가자 개별 강제 퇴장
    socket.on('kick_player', ({ sessionCode, socketId }) => {
        if (gameSessions[sessionCode] && gameSessions[sessionCode].players[socketId]) {
            delete gameSessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', gameSessions[sessionCode].players);
        }
    });

    // 6. 세션 전체 초기화 (이전 참가자 명단 싹 비우기)
    socket.on('reset_session', (sessionCode) => {
        if (gameSessions[sessionCode]) {
            io.to(sessionCode).emit('session_reset');
            gameSessions[sessionCode].players = {};
            io.to(sessionCode).emit('update_dashboard', {});
        }
    });

    // 7. 연결 종료
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