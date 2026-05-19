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
  cors: { origin: "*" }
});

/* -------------------- DATA -------------------- */

let rooms = [];
let players = [];
let questions = [];
let gameState = {};

/* -------------------- LOAD DATA -------------------- */

try {

  rooms = JSON.parse(
    fs.readFileSync("rooms.json", "utf8")
  );

} catch {

  rooms = [
    "TEST",
    "EVENTO2026",
    "QUIZ123"
  ];

}

try {

  questions = JSON.parse(
    fs.readFileSync("questions.json", "utf8")
  );

} catch {

  questions = [];

}

/* -------------------- SAVE -------------------- */

function saveRooms() {

  fs.writeFileSync(
    "rooms.json",
    JSON.stringify(rooms, null, 2)
  );

}

/* -------------------- HELPERS -------------------- */

function sortLeaderboard(playersList) {

  return playersList.sort((a, b) => {

    // primero score
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // empate -> menor tiempo gana
    return a.totalResponseTime - b.totalResponseTime;

  });

}

/* -------------------- ADMIN STATE -------------------- */

function emitGameState(roomCode) {

  const state = gameState[roomCode];

  const roomPlayers = players.filter(
    (p) => p.roomCode === roomCode
  );

  io.to("ADMIN").emit("gameStateUpdate", {

    roomCode,
    isPlaying: state?.isPlaying || false,
    currentIndex: state?.currentIndex ?? 0,
    currentQuestion: state?.currentQuestion || null,
    players: roomPlayers.length

  });

}

/* -------------------- GAME CORE -------------------- */

function sendQuestionToRoom(roomCode) {

  const state = gameState[roomCode];

  if (!state) return;

  const roomQuestions = questions.filter(
    (q) => q.roomCode === roomCode
  );

  const question =
    roomQuestions[state.currentIndex];

  /* -------- FIN DEL JUEGO -------- */

  if (!question) {

    state.isPlaying = false;
    state.currentIndex = 0;

    clearInterval(state.interval);

    if (state.answerTimeout) {
      clearTimeout(state.answerTimeout);
    }

    const roomPlayers = sortLeaderboard(

      players.filter(
        p => p.roomCode === roomCode
      )

    );

    io.to(roomCode).emit(
      "gameFinished",
      roomPlayers
    );

    emitGameState(roomCode);

    return;
  }

  /* -------- NUEVA PREGUNTA -------- */

  state.currentQuestion = question;

  state.questionStartTime = Date.now();

  // reset respuestas
  state.answeredPlayers = [];

  // limpiar timeout anterior
  if (state.answerTimeout) {
    clearTimeout(state.answerTimeout);
  }

  io.to(roomCode).emit("newQuestion", {

    ...question,
    questionTime: state.questionTime

  });

  /* -------- MOSTRAR CORRECTA -------- */

  state.answerTimeout = setTimeout(() => {

    io.to(roomCode).emit(
      "showCorrectAnswer",
      question.correct
    );

  }, (state.questionTime - 1) * 1000);

  emitGameState(roomCode);

}

/* -------------------- SOCKET -------------------- */

io.on("connection", (socket) => {

  console.log(
    "Usuario conectado:",
    socket.id
  );

  /* -------- ADMIN -------- */

  socket.on("joinAdmin", () => {

    socket.join("ADMIN");

  });

  /* -------- ROOMS -------- */

  socket.on("getRooms", () => {

    io.emit("roomsList", rooms);

  });

  socket.on("createRoom", (roomCode) => {

    if (!rooms.includes(roomCode)) {

      rooms.push(roomCode);

      saveRooms();

    }

    io.emit("roomsList", rooms);

  });

  /* -------- QUESTIONS -------- */

  socket.on("getQuestions", () => {

    socket.emit(
      "questionsList",
      questions
    );

  });

  socket.on("saveQuestion", (data) => {

    const question = {

      id: Date.now(),

      roomCode: data.roomCode,

      question: data.question,

      options: data.options,

      correct: data.correct

    };

    questions.push(question);

    fs.writeFileSync(

      "questions.json",

      JSON.stringify(
        questions,
        null,
        2
      )

    );

    socket.emit(
      "questionsList",
      questions
    );

  });

  socket.on("deleteQuestion", (id) => {

    questions = questions.filter(
      q => q.id !== id
    );

    fs.writeFileSync(

      "questions.json",

      JSON.stringify(
        questions,
        null,
        2
      )

    );

    socket.emit(
      "questionsList",
      questions
    );

  });

  /* -------- START GAME -------- */

  socket.on("startGame", (data) => {

    const roomCode = data.roomCode;

    if (gameState[roomCode]?.interval) {

      clearInterval(
        gameState[roomCode].interval
      );

    }

    if (gameState[roomCode]?.answerTimeout) {

      clearTimeout(
        gameState[roomCode].answerTimeout
      );

    }

    gameState[roomCode] = {

      currentIndex: 0,

      currentQuestion: null,

      interval: null,

      answerTimeout: null,

      isPlaying: true,

      questionTime:
  parseInt(data.questionTime) || 5,

      answeredPlayers: []

    };

    io.to(roomCode).emit(
      "gameStarted"
    );

    emitGameState(roomCode);

    setTimeout(() => {

      sendQuestionToRoom(roomCode);

      gameState[roomCode].interval =
        setInterval(() => {

          gameState[roomCode]
            .currentIndex++;

          sendQuestionToRoom(roomCode);

        }, gameState[roomCode]
          .questionTime * 1000);

    }, 3000);

  });

  /* -------- RESTART GAME -------- */

socket.on("restartGame", (data) => {

  const roomCode = data.roomCode;

  const state = gameState[roomCode];

    if (state?.isPlaying) {

      socket.emit("adminMessage", {

        type: "error",

        text:
          "No se puede reiniciar mientras la partida está en curso"

      });

      return;
    }

    if (gameState[roomCode]?.interval) {

      clearInterval(
        gameState[roomCode].interval
      );

    }

    if (gameState[roomCode]?.answerTimeout) {

      clearTimeout(
        gameState[roomCode].answerTimeout
      );

    }

    /* -------- RESET PLAYERS -------- */

    players = players.map((p) =>

      p.roomCode === roomCode

        ? {

            ...p,

            score: 0,

            totalResponseTime: 0

          }

        : p

    );

    gameState[roomCode] = {

      currentIndex: 0,

      currentQuestion: null,

      interval: null,

      answerTimeout: null,

      isPlaying: true,

      questionTime:
  parseInt(data.questionTime) || 5,

      answeredPlayers: []

    };

    const roomPlayers = sortLeaderboard(

      players.filter(
        p => p.roomCode === roomCode
      )

    );

    io.to(roomCode).emit(
      "leaderboardUpdated",
      roomPlayers
    );

    io.to(roomCode).emit(
      "gameStarted"
    );

    emitGameState(roomCode);

    setTimeout(() => {

      sendQuestionToRoom(roomCode);

      gameState[roomCode].interval =
        setInterval(() => {

          gameState[roomCode]
            .currentIndex++;

          sendQuestionToRoom(roomCode);

        }, gameState[roomCode]
          .questionTime * 1000);

    }, 3000);

  });

  /* -------- JOIN GAME -------- */

  socket.on("joinGame", (data) => {

    if (!rooms.includes(data.roomCode)) {

      socket.emit(
        "invalidRoom",
        "Código inválido"
      );

      return;
    }

    const exists = players.find(
      p => p.id === socket.id
    );

    if (exists) return;

    socket.join(data.roomCode);

    players.push({

      id: socket.id,

      nickname: data.nickname,

      roomCode: data.roomCode,

      score: 0,

      totalResponseTime: 0

    });

    const roomPlayers = players.filter(
      p => p.roomCode === data.roomCode
    );

    io.to(data.roomCode).emit(
      "playersUpdated",
      roomPlayers
    );

  });

  /* -------- ANSWERS -------- */

  socket.on("answerQuestion", (data) => {

    const player = players.find(
      p => p.id === socket.id
    );

    if (!player) return;

    const state =
      gameState[data.roomCode];

    if (
      !state ||
      !state.currentQuestion
    ) {
      return;
    }

    /* -------- BLOQUEAR MULTI RESPUESTAS -------- */

    if (
      state.answeredPlayers.includes(
        socket.id
      )
    ) {
      return;
    }

    state.answeredPlayers.push(
      socket.id
    );

    const correct =
      state.currentQuestion.correct;

    /* -------- RESPUESTA CORRECTA -------- */

    if (
      parseInt(data.answer) ===
      parseInt(correct)
    ) {

      const now = Date.now();

      const timeTaken = Math.min(

        (now - state.questionStartTime)
          / 1000,

        state.questionTime

      );

      player.totalResponseTime +=
        timeTaken;

      /* -------- PUNTAJE -------- */

      let points = 0;

      if (timeTaken <= 1) {
        points = 5;
      }

      else if (timeTaken <= 2) {
        points = 4;
      }

      else if (timeTaken <= 3) {
        points = 3;
      }

      else if (timeTaken <= 4) {
        points = 2;
      }

      else if (timeTaken <= 5) {
        points = 1;
      }

      player.score += points;

      const roomPlayers =
        sortLeaderboard(

          players.filter(
            p =>
              p.roomCode ===
              data.roomCode
          )

        );

      io.to(data.roomCode).emit(

        "leaderboardUpdated",

        roomPlayers

      );

      console.log(

        `${player.nickname} correcto +${points} (${timeTaken.toFixed(2)}s)`

      );

    } else {

      console.log(
        `${player.nickname} incorrecto`
      );

    }

  });

socket.on("endGame", ({ roomCode }) => {
  console.log("Finalizando partida:", roomCode);

  const state = gameState[roomCode];

  if (state) {
    if (state.interval) clearInterval(state.interval);
    if (state.answerTimeout) clearTimeout(state.answerTimeout);

    state.isPlaying = false;
    state.currentIndex = 0;
    state.currentQuestion = null;
    state.answeredPlayers = [];
  }

  // avisar screen
  io.to(roomCode).emit("gameEndedForce");

  // expulsar jugadores del room
  const room = io.sockets.adapter.rooms.get(roomCode);

  if (room) {
    for (const socketId of room) {
      const s = io.sockets.sockets.get(socketId);
      if (s) {
        s.leave(roomCode);
        s.emit("kicked");
      }
    }
  }

  // limpiar jugadores del array
  players = players.filter(p => p.roomCode !== roomCode);

  emitGameState(roomCode);
});

  /* -------- DISCONNECT -------- */

  socket.on("disconnect", () => {

    const player = players.find(
      p => p.id === socket.id
    );

    if (!player) return;

    players = players.filter(
      p => p.id !== socket.id
    );

    const roomPlayers = players.filter(
      p => p.roomCode === player.roomCode
    );

    io.to(player.roomCode).emit(
      "playersUpdated",
      roomPlayers
    );

  });

});
/* -------------------- finalizar partida-------------------- */

/* -------------------- START -------------------- */

const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    `Servidor corriendo en puerto ${PORT}`
  );

});