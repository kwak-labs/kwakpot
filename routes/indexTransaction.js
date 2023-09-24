const fp = require("fastify-plugin");

module.exports = fp(async function (app, opts) {
  app.get("/index/:txid", async (req, resp) => {
    let tx = req.params.txid;

    if (global.txs.includes(tx)) return false;

    global.txs.push(tx);

    return true;
  });
});
