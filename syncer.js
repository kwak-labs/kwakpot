let consola = require("consola");
const {
  DirectSecp256k1HdWallet,
  decodeTxRaw,
  decodePubkey,
  Registry,
} = require("@cosmjs/proto-signing");
const { toBech32, fromHex, fromUtf8 } = require("@cosmjs/encoding");
const { pubkeyToAddress } = require("@cosmjs/tendermint-rpc");
const { defaultRegistryTypes } = require("@cosmjs/stargate");

module.exports = async function startSyncLoop() {
  // Fetch Network data
  async function syncNetworkInfo() {
    let gatewayNetworkInfo = await fetch(config.rpcUrl + "/abci_info")
      .catch((e) => null)
      .then((c) => c.json());

    global.networkInfo =
      gatewayNetworkInfo.result.response || global.networkInfo;
    global.block = global.networkInfo.last_block_height;
  }

  // Sync Game Data
  // We do it like this cuz if many transactions are coming in to update the game
  // It may cause data loss and incorrect data
  async function syncGameData() {
    await global.databases.game.put("CurrentGame", {
      totalPot: global.game.totalPot,
      entries: global.game.entries,
      address: await global.databases.game.get("CurrentGame").address,
      endingBlock: await global.databases.game.get("CurrentGame").endingBlock,
      seed: await global.databases.game.get("CurrentGame").seed,
    });
  }

  await syncNetworkInfo();
  await syncGameData();

  //   Log network info
  consola.info("Chain Name/Data: " + global.networkInfo.data);
  consola.info("Block height: " + global.block);
  consola.info("App Version: " + global.networkInfo.version);
  consola.info(
    "Last Block App hash: " + global.networkInfo.last_block_app_hash
  );

  /* Interval functions */

  setInterval(syncNetworkInfo, 10000); // Do this so we can keep the block height mostly
  setInterval(syncGameData, 20000); // Do this so we can keep the game synced with the db

  // Check if game is over
  setInterval(async () => {
    // This function is already running
    if (global.gameEnding == true) return;

    let game = await global.databases.game.get("CurrentGame");

    // End the game, pay everyone out, create new game
    if (global.block >= game.endingBlock) {
      global.gameEnding = true;

      let allTickets = [];
      let ticketNumber = 1;

      /*                        Winner Finder                                */

      for (let { key, value } of global.databases.players.getRange({})) {
        const userAddress = key;
        const numberOfTickets = value.tickets;

        for (let i = 0; i < numberOfTickets; i++) {
          const ticket = {
            address: userAddress,
            ticketNumber: ticketNumber,
          };
          allTickets.push(ticket);
          ticketNumber++;
        }
      }

      allTickets = shuffle(allTickets);

      const winningNumber = Math.floor(Math.random() * allTickets.length);

      const Winner = allTickets[winningNumber];

      let winningAddress = Winner.address;
      let winningTicket = Winner.ticket;

      ///////////////////////////////////////////////////////////////////////////

      console.log(allTickets);
      console.log(Winner);

      /* Payment Code */

      /* Create new Game */
    }
  }, 15000);

  // Check global.txs fetch data and throw it into the pot
  setInterval(async () => {
    const TXs = [...global.txs];

    if (TXs.length <= 0) return;

    // If the game has ended, dont try to index the transaction wait for a new game to be made
    if (global.gameEnding == true)
      return consola.error(
        "Cant index transaction(s) game has ended, Waiting till new game is created"
      );

    TXs.forEach(async (txid) => {
      let decodedTx;

      if (global.databases.entries.get(txid)) {
        return consola.error(txid + ": " + "Transaction was already indexed!");
      }

      try {
        decodedTx = decodeTxRaw((await stargateClient.getTx(txid)).tx);
      } catch (e) {
        consola.error("TX couldnt be decoded");
        return false;
      }

      // Register Default Cosmos Types
      const registry = new Registry(defaultRegistryTypes);

      // Find the message where they send coins
      const MsgSend = decodedTx.body.messages.filter(
        (obj) => obj.typeUrl === "/cosmos.bank.v1beta1.MsgSend"
      );

      // Decode that message
      let DecodeMsgSend = registry.decode(MsgSend[0]);

      // if (DecodeMsgSend.toAddress != global.pot.address) return;

      let { denom, amount } = DecodeMsgSend.amount[0];

      // Make sure there sending the official coin, and not an inflated one so they get more tickets
      if (denom != global.config.coin) return;

      // How many tickets they get
      let tickets = parseInt(amount) / parseInt(global.config.ticketPrice);

      // Log the transaction
      await global.databases.entries.put(txid, {
        tx: txid,
        address: DecodeMsgSend.fromAddress,
        amount: parseInt(amount),
        tickets: tickets,
        block: global.block,
      });

      /* Add to player/create */

      await global.databases.players.put(DecodeMsgSend.fromAddress, {
        amount: global.databases.players.get(DecodeMsgSend.fromAddress)
          ? global.databases.players.get(DecodeMsgSend.fromAddress).amount +
            parseInt(amount)
          : parseInt(amount),
        tickets: global.databases.players.get(DecodeMsgSend.fromAddress)
          ? global.databases.players.get(DecodeMsgSend.fromAddress).tickets +
            tickets
          : tickets,
      });

      /* Add To The Game  */
      global.game.totalPot = global.game.totalPot + parseInt(amount);
      global.game.entries = global.game.entries + 1;

      consola.success(txid + ": " + "Has been indexed!");
    });

    global.txs.splice(0, TXs.length);
  }, 10000);
};

function shuffle(array) {
  let currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex > 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }

  return array;
}
