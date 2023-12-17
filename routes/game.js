const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/game", async (req, resp) => {
    let game = global.databases.game.get("CurrentGame");

    return {
      address: game.address,
      gameEnding: lobal.gameEnding,
      endingBlock: game.endingBlock,
      currentBlock: global.block, // Used to see what block the server is on
      entries: game.entries,
      totalPot: game.totalPot,
      ticketPrice: game.ticketPrice,
    };
  });
});
