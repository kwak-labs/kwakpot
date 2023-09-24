const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/transactions", async (req, resp) => {
    // let game = global.databases.entries.get("entries");

    // return game;

    return "Endpoint not finished";
  });
});
