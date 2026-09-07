const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// HTML 파일이 있는 폴더를 정적 제공 (예: public 폴더에 index.html, admin.html 배치)
app.use(express.static('public'));

const sessions = {};

io.on('connection', (socket) => {
    console.log(`[+] 유저 접속: ${socket.id}`);

    // 게임/관제 접속
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
                balance: 50000000, trust: 10, debt: 0, execRate: 0,
                turn: sessions[sessionCode].turn, status: '집행 대기중', lastAction: '접속 완료'
            };
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 상태 업데이트
    socket.on('update_state', (data) => {
        let userSession = null;
        for (const code in sessions) {
            if (sessions[code].players[socket.id]) {
                userSession = code;
                break;
            }
        }
        if (userSession) {
            Object.assign(sessions[userSession].players[socket.id], data);
            io.to(userSession).emit('update_dashboard', sessions[userSession].players);
        }
    });

    // [신규] 운영자 개별 추경 예산 지급 기능
    socket.on('admin_grant_budget', (data) => {
        const { sessionCode, targetId, amount } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[targetId]) {
            io.to(targetId).emit('receive_special_budget', { amount });
            console.log(`[!] ${sessionCode} 세션 - ${targetId}에게 추경 ${amount}원 배정`);
        }
    });

    // 일괄 분기(턴) 진행
    socket.on('force_next_turn', (sessionCode) => {
        if (sessions[sessionCode]) {
            sessions[sessionCode].turn++;
            for (let id in sessions[sessionCode].players) {
                sessions[sessionCode].players[id].turn = sessions[sessionCode].turn;
                sessions[sessionCode].players[id].status = '예산 집행 중';
            }
            io.to(sessionCode).emit('trigger_next_turn');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 강제 결산 종료
    socket.on('force_end_game', (sessionCode) => {
        if (sessions[sessionCode]) {
            for (let id in sessions[sessionCode].players) {
                sessions[sessionCode].players[id].status = '종합 결산 완료';
            }
            io.to(sessionCode).emit('trigger_game_end');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 개별 참가자 직위해제(추방)
    socket.on('kick_player', (data) => {
        const { sessionCode, socketId } = data;
        if (sessions[sessionCode] && sessions[sessionCode].players[socketId]) {
            delete sessions[sessionCode].players[socketId];
            io.to(socketId).emit('kicked');
            io.to(sessionCode).emit('update_dashboard', sessions[sessionCode].players);
        }
    });

    // 세션 초기화
    socket.on('reset_session', (sessionCode) => {
        if (sessions[sessionCode]) {
            io.to(sessionCode).emit('session_reset');
            delete sessions[sessionCode];
        }
    });

    socket.on('disconnect', () => {
        console.log(`[-] 유저 연결 끊김: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`국방 재정 시뮬레이션 서버가 포트 ${PORT}에서 실행 중입니다.`);
});