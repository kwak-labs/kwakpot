const { StargateClient } = require("@cosmjs/stargate");
const lmdb = require("lmdb");
const JSON5 = require("json5");
const autoLoad = require("@fastify/autoload");
const fastifyCors = require("@fastify/cors");
const app = require("fastify")({ logger: false });
const fs = require("fs");
const Arweave = require("arweave");

(async () => {
  global.config = JSON5.parse(fs.readFileSync("./config.json5", "utf8"));
  global.stargateClient = await StargateClient.connect(config.rpcUrl);
  global.arweave = Arweave.init({
    host: "ar-io.net",
    port: 443,
    protocol: "https",
  });
  global.jwk = JSON.parse(fs.readFileSync("./jwk.json", "utf8"));
  global.databases = {
    entries: lmdb.open("./db/entries"), // Just stores all the transactions and how much tickets added
    players: lmdb.open("./db/players"), // Stores each wallet, there tickets, how much depositted
    game: lmdb.open("./db/game"), // Keeps total pot, Entries, Pot address, Pot Seed
  };
  global.txs = [];
  global.block = 0;
  global.game = {
    entries: 0,
    totalPot: 0,
  };

  let startSyncLoop = require("./syncer.js");

  await startSyncLoop();
})();

const start = async () => {
  app.addHook("preHandler", (req, res, done) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "*");
    res.header("Access-Control-Allow-Headers", "*");
    const isPreflight = /options/i.test(req.method);
    if (isPreflight) {
      return res.send();
    }
    done();
  });
  app.register(fastifyCors, {
    origin: "*",
    methods: ["GET"],
  });
  app.addContentTypeParser(
    "application/octet-stream",
    function (request, payload, done) {
      let data = Buffer.alloc(0);
      payload.on("data", (chunk) => {
        if (chunk.length + data.length >= 1e8) {
          throw "Too big payload";
        }
        data = Buffer.concat([data, chunk]);
      });
      payload.on("end", () => {
        done(null, data);
      });
    }
  );
  app.register(autoLoad, {
    dir: require("path").join(__dirname, "routes"),
  });
  try {
    await app.listen({ port: global.config.port});
  } catch (err) {
    console.log(err);
    app.log.error(err);
    process.exit(1);
  }
};
start();
