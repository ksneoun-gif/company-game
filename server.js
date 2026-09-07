const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// 정적 파일 제공 (index.html, admin.html 등이 위치한 폴더)
app.use(express.static('public'));

const sessions = {};

io.on('connection', (socket) => {
    // 1. 관서(플레이어) 및 관제 접속
    socket.on('join_game', (data) => {
        const { sessionCode, milId, name, rank, isOperator } = data;
        socket.join(sessionCode);

        if (!sessions[sessionCode]) {
            sessions[sessionCode] = { players: {}, turn: 1 };
        }

        if (isOperator) {
            socket.emit('update_dashboard', sessions[sessionCode].players);
        } else {
            sessions[sessionCode].players[socket.id] = {
                socketId: socket.id, milId, name, rank,
                balance: 100000000, trust: 30, debt: 0, execRate: 0,
                turn: sessions[sessionCode].turn, status: '집행 대기중', lastAction: '접속 완료'
            };
            // 💡 [버그 2 해결] 접속 시 현재 서버 턴으로 동기화
            socket.emit('sync_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 2. 상태 동기화
    socket.on('update_state', (data) => {
        let userSession = Object.keys(sessions).find(c => sessions[c].players[socket.id]);
        if (userSession) {
            Object.assign(sessions[userSession].players[socket.id], data);
            io.to(userSession).emit('update_dashboard', sessions[userSession].players);
        }
    });

    // 3. [신규] 운영자 개별 추경 지급
    socket.on('admin_grant_budget', (data) => {
        const { sessionCode, targetId, amount } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[targetId]) {
            io.to(targetId).emit('receive_special_budget', { amount });
        }
    });

    // 4. 일괄 분기 진행 (턴 강제 진행)
    socket.on('force_next_turn', (sessionCode) => {
        if (sessions[sessionCode]) {
            sessions[sessionCode].turn++;
            for (let id in sessions[sessionCode].players) {
                // 💡 [버그 1 해결] 사고(게임오버) 처리된 유저는 턴을 진행시키지 않음
                if (!sessions[sessionCode].players[id].status.includes('사고')) {
                    sessions[sessionCode].players[id].turn = sessions[sessionCode].turn;
                    sessions[sessionCode].players[id].status = '예산 집행 중';
                }
            }
            io.to(sessionCode).emit('trigger_next_turn', sessions[sessionCode].turn);
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 5. 강제 결산 종료
    socket.on('force_end_game', (sessionCode) => {
        if (sessions[sessionCode]) {
            for (let id in sessions[sessionCode].players) {
                sessions[sessionCode].players[id].status = '종합 결산 완료';
            }
            io.to(sessionCode).emit('trigger_game_end');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 6. 플레이어 추방
    socket.on('kick_player', (data) => {
        const { sessionCode, socketId } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[socketId]) {
            delete sessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 7. 세션 초기화
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