// const express = require("express");
// const http = require("http");
// const socket = require("socket.io");
// const { Chess } = require("chess.js");
// const path = require("path");
// const app = express();
// const server = http.createServer(app);
// const io = socket(server);

// const chess = new Chess();
// let players = {};
// let currentPlayer = "W";
// app.use(express.static(path.join(__dirname, "public")));
// app.set("view engine", "ejs");

// app.get("/", (req, res) => {
//   res.render("index", { title: "CHESS GAME" });
// });

// io.on("connection", function (uniquesocket) {
//   console.log("Connected");
//   //     uniquesocket.on("joinGame",function(){  to send request to frontend
//   // console.log("PlayerJoined");
//   // io.emit("newgameee"); it is used for every entry including the from initial one

//   // })
//   if (!players.white) {
//     players.white = uniquesocket.id;
//     uniquesocket.emit("playerRole", "W");
//   } else if (!players.black) {
//     players.black = uniquesocket.id;
//     uniquesocket.emit("playerRole", "B");
//   } else {
//     uniquesocket.emit("spectatorRole");
//   }
//   uniquesocket.on("disconnect", function () {
//     if (uniquesocket.id == players.white) {
//       delete players.white;
//     } else if (uniquesocket.id == players.black) {
//       delete players.black;
//     }
//   });
//   uniquesocket.on("move", (move) => {
//     try {
//       // chess.turn() returns 'w' or 'b' (lowercase)
//     //   if (chess.turn() === "w" && uniquesocket.id !== players.white) return;
//       if (chess.turn() === "b" && uniquesocket.id !== players.black) return;
//       const result = chess.move(move);
//       if (result) {
//         currentPlayer = chess.turn();
//         io.emit("move", move);
//         io.emit("boardState", chess.fen());
//       } else {
//         console.log("Invalid Move :", move);
//         uniquesocket.emit("invlaidMove", move);
//       }
//     } catch (err) {
//       console.log(err);
//       uniquesocket.emit("Error in move processing", move);
//     }
//   });
// });

// server.listen(3000, () => {
//   console.log("Server is running on http://localhost:3000");
// });

const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { Chess } = require("chess.js");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const chess = new Chess();
let players = {}; // { white: socketId, black: socketId }

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    lastModified: false,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    },
  })
);
app.set("view engine", "ejs");
// Be explicit about views path to avoid CWD-related issues
app.set("views", path.join(__dirname, "views"));

// Serve main page
app.get("/", (req, res) => {
  res.render("index", { title: "CHESS GAME" });
});

io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Assign player roles with Solo mode support
  if (!players.white) {
    players.white = socket.id;
    // If black seat is empty (solo), grant both sides control to this socket
    socket.emit("playerRole", "both");
    console.log("White player (solo) joined:", socket.id);
  } else if (!players.black) {
    players.black = socket.id;
    socket.emit("playerRole", "b");
    // Inform the existing white player they now control only white
    if (players.white) {
      io.to(players.white).emit("playerRole", "w");
    }
    console.log("Black player joined:", socket.id);
  } else {
    socket.emit("spectatorRole");
    console.log("Spectator joined:", socket.id);
  }

  // Send current board to the new connection
  socket.emit("boardState", chess.fen());
  // Allow client to resync its role on demand
  socket.on("requestRole", () => {
    const whiteEmpty = !players.white;
    const blackEmpty = !players.black;
    if (socket.id === players.white && blackEmpty) {
      // Solo: white seated, black empty
      socket.emit("playerRole", "both");
    } else if (socket.id === players.black && whiteEmpty) {
      // Solo: black seated, white empty
      socket.emit("playerRole", "both");
    } else if (socket.id === players.white) {
      socket.emit("playerRole", "w");
    } else if (socket.id === players.black) {
      socket.emit("playerRole", "b");
    } else {
      socket.emit("spectatorRole");
    }
  });

  // Handle player disconnection
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    if (socket.id === players.white) {
      delete players.white;
      io.emit("playerLeft", "white");
      console.log("White player left");
      // If black remains, give them solo control
      if (players.black) {
        io.to(players.black).emit("playerRole", "both");
      }
    } else if (socket.id === players.black) {
      delete players.black;
      io.emit("playerLeft", "black");
      console.log("Black player left");
      // If white remains, give them solo control
      if (players.white) {
        io.to(players.white).emit("playerRole", "both");
      }
    }
  });

  // Handle chess moves
  socket.on("move", (move) => {
    try {
      // Validate turn ownership with Solo mode:
      // If opponent seat is empty, the remaining player may move for both sides.
      const turn = chess.turn(); // 'w' or 'b'
      const isWhiteTurn = turn === "w";
      const isBlackTurn = turn === "b";
      const whiteSeatEmpty = !players.white;
      const blackSeatEmpty = !players.black;

      const isAllowed =
        (isWhiteTurn && (socket.id === players.white || whiteSeatEmpty)) ||
        (isBlackTurn && (socket.id === players.black || blackSeatEmpty));
      if (!isAllowed) return;

      // Try to make the move
      const result = chess.move(move);
      if (result) {
        // Broadcast move and updated board to everyone
        io.emit("move", move);
        io.emit("boardState", chess.fen());

        // --- Game over detection (supports chess.js v1.x and 0.x APIs) ---
        const api = {
          isGameOver:
            typeof chess.isGameOver === "function"
              ? chess.isGameOver.bind(chess)
              : chess.game_over && chess.game_over.bind(chess),
          isCheckmate:
            typeof chess.isCheckmate === "function"
              ? chess.isCheckmate.bind(chess)
              : chess.in_checkmate && chess.in_checkmate.bind(chess),
          isStalemate:
            typeof chess.isStalemate === "function"
              ? chess.isStalemate.bind(chess)
              : chess.in_stalemate && chess.in_stalemate.bind(chess),
          isDraw:
            typeof chess.isDraw === "function"
              ? chess.isDraw.bind(chess)
              : chess.in_draw && chess.in_draw.bind(chess),
          isThreefold:
            typeof chess.isThreefoldRepetition === "function"
              ? chess.isThreefoldRepetition.bind(chess)
              : chess.in_threefold_repetition &&
                chess.in_threefold_repetition.bind(chess),
          isInsufficient:
            typeof chess.isInsufficientMaterial === "function"
              ? chess.isInsufficientMaterial.bind(chess)
              : chess.insufficient_material &&
                chess.insufficient_material.bind(chess),
        };

        const over = api.isGameOver ? api.isGameOver() : false;
        if (over) {
          let reason = "draw";
          let winner = null; // 'w' | 'b' | null
          if (api.isCheckmate && api.isCheckmate()) {
            reason = "checkmate";
            winner = chess.turn() === "w" ? "b" : "w"; // side to move is checkmated
          } else if (api.isStalemate && api.isStalemate()) {
            reason = "stalemate";
          } else if (api.isThreefold && api.isThreefold()) {
            reason = "threefold";
          } else if (api.isInsufficient && api.isInsufficient()) {
            reason = "insufficient_material";
          } else if (api.isDraw && api.isDraw()) {
            reason = "draw";
          }
          io.emit("gameOver", { reason, winner });
        }
      } else {
        console.log("Invalid move:", move);
        socket.emit("invalidMove", move);
      }
    } catch (err) {
      console.error("Error processing move:", err);
      socket.emit("error", "Error in move processing");
    }
  });

  // Reset game on request
  socket.on("newGame", () => {
    try {
      if (typeof chess.reset === "function") {
        chess.reset();
      } else {
        // Fallback for very old chess.js
        const { Chess: ChessCtor } = require("chess.js");
        // eslint-disable-next-line new-cap
        chess = new ChessCtor();
      }
    } catch (_) {
      const { Chess: ChessCtor } = require("chess.js");
      // eslint-disable-next-line new-cap
      chess = new ChessCtor();
    }
    io.emit("newGame");
    io.emit("boardState", chess.fen());
  });
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
