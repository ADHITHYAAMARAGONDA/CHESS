const socket = io();
const chess = new Chess();
const boardElement = document.querySelector(".chessboard");
const newGameBtn = document.getElementById("newGameBtn");
const gameStatusEl = document.getElementById("gameStatus");
const whiteTurnEl = document.getElementById("whiteTurn");
const blackTurnEl = document.getElementById("blackTurn");
let draggedPiece = null;
let playRole = null; // 'w' | 'b' | 'both' | null
let gameOver = false;
let sourceSquare = null;

const renderBoard = () => {
  const board = chess.board();
  if (!boardElement) return;
  boardElement.innerHTML = "";

  board.forEach((row, rowIndex) => {
    row.forEach((square, colIndex) => {
      const squareElement = document.createElement("div");
      const isLight = (rowIndex + colIndex) % 2 === 0;
      squareElement.classList.add("square", isLight ? "light" : "dark");
      squareElement.dataset.row = rowIndex;
      squareElement.dataset.col = colIndex;

      if (square) {
        const pieceElement = document.createElement("div");
        const pieceColor = square.color === "w" ? "w" : "b";
        const pieceColorClass = pieceColor === "w" ? "white" : "black";
        pieceElement.classList.add("piece", pieceColorClass);

        const type = square.type ? square.type.toLowerCase() : "";
        if (type === "p") pieceElement.classList.add("pawn");
        pieceElement.innerText = getPieceUnicode(type, square.color) || " ";

        // draggable only if the player owns this piece, is in solo mode, or no role assigned
        const canDrag =
          !gameOver &&
          (playRole === null || playRole === "both" || playRole === pieceColor);
        pieceElement.draggable = canDrag;

        pieceElement.addEventListener("dragstart", (e) => {
          if (pieceElement.draggable) {
            draggedPiece = pieceElement;
            sourceSquare = { row: rowIndex, col: colIndex };
            try {
              e.dataTransfer.setData("text/plain", "");
            } catch (err) {}
          }
        });

        pieceElement.addEventListener("dragend", () => {
          draggedPiece = null;
          sourceSquare = null;
        });

        squareElement.appendChild(pieceElement);
      }

      squareElement.addEventListener("dragover", function (e) {
        e.preventDefault();
      });

      squareElement.addEventListener("drop", function (e) {
        e.preventDefault();
        if (draggedPiece && sourceSquare) {
          const targetSquare = {
            row: parseInt(squareElement.dataset.row, 10),
            col: parseInt(squareElement.dataset.col, 10),
          };
          handleMove(sourceSquare, targetSquare);
        }
      });

      boardElement.appendChild(squareElement);
    });
  });

  // Flip the board only when strictly playing as Black
  if (!gameOver && playRole === "b") {
    boardElement.classList.add("flipped");
  } else {
    boardElement.classList.remove("flipped");
  }

  // Update turn indicators
  if (!gameOver) {
    const turn = chess.turn(); // 'w' or 'b'
    if (whiteTurnEl && blackTurnEl) {
      if (turn === "w") {
        whiteTurnEl.classList.remove("hidden");
        blackTurnEl.classList.add("hidden");
      } else {
        blackTurnEl.classList.remove("hidden");
        whiteTurnEl.classList.add("hidden");
      }
    }
  } else {
    if (whiteTurnEl) whiteTurnEl.classList.add("hidden");
    if (blackTurnEl) blackTurnEl.classList.add("hidden");
  }
};

const handleMove = (source, target) => {
  const move = {
    from: `${String.fromCharCode(97 + source.col)}${8 - source.row}`,
    to: `${String.fromCharCode(97 + target.col)}${8 - target.row}`,
    promotion: "q",
  };
  // Client-side legality check using a temporary chess instance
  try {
    const preview = new Chess(chess.fen());
    const result = preview.move(move);
    if (!result) {
      return; // ignore illegal drags
    }
    socket.emit("move", move);
  } catch (_) {
    // On any error, do not emit
  }
};

const getPieceUnicode = (type, color) => {
  const map = {
    p: "♟",
    r: "♜",
    n: "♞",
    b: "♝",
    q: "♛",
    k: "♚",
  };
  return map[type];
};

// --- Socket events ---

socket.on("playerRole", function (role) {
  const r = (role || "").toString().toLowerCase();
  playRole = r === "both" ? "both" : r; // support solo mode
  renderBoard();
});

socket.on("spectatorRole", function () {
  playRole = null;
  renderBoard();
});

socket.on("boardState", function (fen) {
  chess.load(fen);
  renderBoard();
});

// We rely on authoritative FEN updates from the server to avoid drift.
socket.on("move", function () {
  // no-op; 'boardState' will immediately follow and re-render
});

socket.on("gameOver", function ({ reason, winner }) {
  gameOver = true;
  renderBoard();
  let msg = "Game over: ";
  if (reason === "checkmate") {
    msg += `checkmate. Winner: ${winner === "w" ? "White" : "Black"}`;
  } else if (reason === "stalemate") {
    msg += "stalemate";
  } else if (reason === "threefold") {
    msg += "draw by threefold repetition";
  } else if (reason === "insufficient_material") {
    msg += "draw by insufficient material";
  } else {
    msg += "draw";
  }
  if (gameStatusEl) {
    gameStatusEl.textContent = msg;
    gameStatusEl.classList.remove("hidden");
  } else {
    try {
      alert(msg);
    } catch (_) {}
  }
});

// New Game UI
if (newGameBtn) {
  newGameBtn.addEventListener("click", function () {
    socket.emit("newGame");
  });
}

socket.on("newGame", function () {
  gameOver = false;
  renderBoard();
  // resync role after reset
  socket.emit("requestRole");
  if (gameStatusEl) {
    gameStatusEl.textContent = "";
    gameStatusEl.classList.add("hidden");
  }
});

// Initial role sync in case we missed the first assignment
socket.emit("requestRole");

// Initial render
renderBoard();
