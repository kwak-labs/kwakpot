const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/game", async (req, resp) => {
    let game = global.databases.game.get("CurrentGame");

    return {
      address: game.address,
      endingBlock: game.endingBlock,
      entries: game.entries,
      totalPot: game.totalPot,
      ticketPrice: game.ticketPrice,
    };
  });
});
