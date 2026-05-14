const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let rooms = [];

try {
  const data = fs.readFileSync("rooms.json", "utf8");
  rooms = JSON.parse(data);
} catch (error) {
  console.log("No se pudieron cargar rooms");
  rooms = ["TEST", "EVENTO2026", "QUIZ123"];
}

function saveRooms() {
  fs.writeFileSync(
    "rooms.json",
    JSON.stringify(rooms, null, 2)
  );
}
let gameState = {};
let players = [];
let questions = [];

try {

  const data = fs.readFileSync(
    "questions.json",
    "utf8"
  );

  questions = JSON.parse(data);

} catch (error) {

  console.log(
    "No se pudieron cargar preguntas"
  );
}

function sendQuestionToRoom(roomCode) {

  const roomQuestions = questions.filter(
    (q) => q.roomCode === roomCode
  );

  const state = gameState[roomCode];

  if (!state) return;

  const question =
    roomQuestions[state.currentIndex];

  if (!question) {

    clearInterval(state.interval);

    io.to(roomCode).emit(
      "gameFinished"
    );

    return;
  }

  state.currentQuestion = question;

  io.to(roomCode).emit(
    "newQuestion",
    question
  );
}

io.on("connection", (socket) => {
socket.on("answerQuestion", (data) => {

  const player = players.find(
    (p) => p.id === socket.id
  );

  if (!player) return;

  const state = gameState[data.roomCode];

  if (!state || !state.currentQuestion) return;

  const correct = state.currentQuestion.correct;

  if (parseInt(data.answer) === parseInt(correct)) {

    player.score += 1;

    const roomPlayers = players
  .filter(
    (p) => p.roomCode === data.roomCode
  )
  .sort((a, b) => b.score - a.score);

io.to(data.roomCode).emit(
  "leaderboardUpdated",
  roomPlayers
);

    console.log(
      `${player.nickname} CORRECTO (+1)`
    );

  } else {

    console.log(
      `${player.nickname} incorrecto`
    );
  }
});
  socket.on("getRooms", () => {

  io.emit("roomsList", rooms);

});
  
  console.log("Usuario conectado:", socket.id);

socket.on("startGame", (data) => {

  const roomCode = data.roomCode;

  console.log(
    `Partida iniciada en room: ${roomCode}`
  );

  gameState[roomCode] = {
    currentIndex: 0,
    currentQuestion: null,
    interval: null
  };

  io.to(roomCode).emit(
    "gameStarted"
  );

  // primera pregunta
  sendQuestionToRoom(roomCode);

  // timer automático
  gameState[roomCode].interval = setInterval(() => {

    gameState[roomCode].currentIndex++;

    sendQuestionToRoom(roomCode);

  }, 5000);

});

socket.on("getQuestions", () => {

  socket.emit(
    "questionsList",
    questions
  );

});

socket.on("createRoom", (roomCode) => {

  if (!rooms.includes(roomCode)) {
    rooms.push(roomCode);

    saveRooms(); // 👈 persistencia
  }

  io.emit("roomsList", rooms); // 👈 importante: TODOS

  console.log("Room creada:", roomCode);
});

socket.on("sendQuestion", (roomCode) => {

  sendQuestionToRoom(roomCode);

});

socket.on("saveQuestion", (questionData) => {

const question = {
  id: questions.length + 1,
  roomCode: questionData.roomCode,
  question: questionData.question,
  options: questionData.options,
  correct: questionData.correct
};

  questions.push(question);
  fs.writeFileSync(
  "questions.json",
  JSON.stringify(questions, null, 2)
);

  console.log("Pregunta guardada:");
  console.log(question);

  socket.emit(
    "questionSaved",
    questions
  );
});
  socket.on("deleteQuestion", (id) => {

  questions = questions.filter(
    (q) => q.id !== id
  );

  fs.writeFileSync(
    "questions.json",
    JSON.stringify(questions, null, 2)
  );

  socket.emit(
    "questionsList",
    questions
  );

  console.log(`Pregunta ${id} eliminada`);
});
  socket.on("joinGame", (playerData) => {

    // validar room
    if (!rooms.includes(playerData.roomCode)) {

      socket.emit(
        "invalidRoom",
        "Código de evento inválido"
      );

      return;
    }

    // evitar duplicados
    const exists = players.find(
      (p) => p.id === socket.id
    );

    if (exists) {
      return;
    }

    // unir socket a room
    socket.join(playerData.roomCode);

    // crear jugador
    const player = {
      id: socket.id,
      nickname: playerData.nickname,
      roomCode: playerData.roomCode,
      score: 0
    };

    players.push(player);

    console.log(
      `Jugador unido: ${player.nickname} (${player.roomCode})`
    );

    // jugadores SOLO de esa room
    const roomPlayers = players.filter(
      (p) => p.roomCode === playerData.roomCode
    );

    // emitir SOLO a esa room
    io.to(playerData.roomCode).emit(
      "playersUpdated",
      roomPlayers
    );
  });

  socket.on("disconnect", () => {

    const disconnectedPlayer = players.find(
      (p) => p.id === socket.id
    );

    if (!disconnectedPlayer) {
      return;
    }

    players = players.filter(
      (p) => p.id !== socket.id
    );

    const roomPlayers = players.filter(
      (p) =>
        p.roomCode === disconnectedPlayer.roomCode
    );

    io.to(disconnectedPlayer.roomCode).emit(
      "playersUpdated",
      roomPlayers
    );

    console.log("Usuario desconectado");
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    `Servidor corriendo en puerto ${PORT}`
  );

});