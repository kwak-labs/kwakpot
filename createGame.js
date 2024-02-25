// Only Run This One Time To BootStrap The Game, After Will Auto Make Games As One Finishes
const { DirectSecp256k1HdWallet } = require("@cosmjs/proto-signing");
let lmdb = require("lmdb");
let consola = require("consola");

(async () => {
  const wallet = await DirectSecp256k1HdWallet.generate(24, {
    prefix: "elys", // set to your chains respective prefix
  });
  let [firstAccount] = await wallet.getAccounts();
  const address = firstAccount.address;
  const block = 6081971;

  let db = lmdb.open("./db/game");

  await db.put("CurrentGame", {
    seed: wallet.mnemonic,
    address: address,
    endingBlock: block,
    entries: 0,
    totalPot: 0,
    ticketPrice: 250000,
  });

  consola.info("Seed: " + wallet.mnemonic);
  consola.info("address: " + address);
  consola.info("Ending Block: " + block);

  consola.success("Game has been created! You can now run the server");
})();
