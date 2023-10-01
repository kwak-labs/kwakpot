const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/transactions", async (req, resp) => {
    let txs = [];
    for (let { key, value } of await global.databases.entries.getRange({})) {
      txs.push(value);
    }

    return txs;
  });
});
