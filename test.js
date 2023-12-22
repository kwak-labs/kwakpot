const crypto = require("crypto");
const seedrandom = require("seedrandom");

const hash = crypto.createHash("sha256");
hash.update("dsdfsfdsffds");
const seed = hash.digest("hex");

console.log(
  deterministicSortAndShuffle(
    [
      {
        address: "bdd",
        ticket: 8,
      },
      {
        address: "add",
        ticket: 6,
      },
      {
        address: "add",
        ticket: 1,
      },
      {
        address: "gfdg",
        ticket: 9,
      },
      {
        address: "add",
        ticket: 5,
      },
      {
        address: "gfdg",
        ticket: 2,
      },
      {
        address: "gfdg",
        ticket: 3,
      },
      {
        address: "bdd",
        ticket: 7,
      },
      {
        address: "add",
        ticket: 4,
      },
    ],
    seed
  )
);
