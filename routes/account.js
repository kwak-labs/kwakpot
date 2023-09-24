const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/account/:address", async (req, resp) => {
    let address = req.params.address;

    return global.databases.players.get(address)
      ? global.databases.players.get(address)
      : false;
  });
});
