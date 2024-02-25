let consola = require("consola");
const crypto = require("crypto");
const seedrandom = require("seedrandom");
const {
  DirectSecp256k1HdWallet,
  decodeTxRaw,
  Registry,
} = require("@cosmjs/proto-signing");
const {
  defaultRegistryTypes,
  SigningStargateClient,
} = require("@cosmjs/stargate");

module.exports = async function startSyncLoop() {
  // Fetch Network data
  async function syncNetworkInfo() {
    try {
      let gatewayNetworkInfo = await fetch(config.rpcUrl + "/abci_info")
        .catch((e) => null)
        .then((c) => c.json());

      global.networkInfo =
        gatewayNetworkInfo.result.response || global.networkInfo;
      global.block = global.networkInfo.last_block_height;
    } catch (e) {
      console.log(e);
    }
  }

  // Sync Game Data
  // We do it like this cuz if many transactions are coming in to update the game
  // It may cause data loss and incorrect data
  async function syncToGlobal() {
    global.game.totalPot = await global.databases.game.get("CurrentGame")
      .totalPot;
    global.game.entries = await global.databases.game.get("CurrentGame")
      .entries;
  }

  async function syncGameData() {
    if (global.gameEnding == true)
      return consola.error("Cant update game data as new game is being made");

    await global.databases.game.put("CurrentGame", {
      totalPot: global.game.totalPot,
      entries: global.game.entries,
      address: await global.databases.game.get("CurrentGame").address,
      endingBlock: await global.databases.game.get("CurrentGame").endingBlock,
      seed: await global.databases.game.get("CurrentGame").seed,
      ticketPrice: await global.databases.game.get("CurrentGame").ticketPrice,
    });
  }

  await syncNetworkInfo();
  await syncToGlobal();

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
    try {
      if (global.gameEnding == true) return;

      let game = await global.databases.game.get("CurrentGame");

      // End the game, pay everyone out, create new game
      if (global.block >= game.endingBlock) {
        global.gameEnding = true;
        let endBlock = game.endingBlock;

        await indexTxs();

        let allTickets = [];
        let ticketNumber = 1;

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

        if (allTickets.length <= 0) {
          consola.error("Game ended with no pool");
          await createGame();
          return;
        }


        let fetchBlock = await stargateClient.getBlock(endBlock);
        let blockHash = fetchBlock.id;

        allTickets = deterministicSortAndShuffle(allTickets, blockHash);

        let numberFromHash = parseInt(blockHash, 16);

        let winningNumber = (numberFromHash % allTickets.length) + 1;

        /* Runs if there is one ticket */
        if(allTickets.length == 1) {
          winningNumber = 0
        }

        const Winner = allTickets[winningNumber];


        let winningAddress = Winner.address;

        /* Payment Code */

        let walletBalance = await stargateClient.getAllBalances(
          await global.databases.game.get("CurrentGame").address
        );

        const token = walletBalance.filter(
          (obj) => obj.denom === global.config.coin
        );

        if (token[0]?.amount == "0" || token.length <= 0) {
          consola.error("Game ended with no pool");
          await createGame();
          return;
        }

        let amount = parseInt(token[0].amount) - 2500;
        let amountAsset = amount / global.config.denom;

        let amountSentToDevs = Math.trunc(
          global.config.devFee * parseFloat(amountAsset) * global.config.denom
        );

        let amountSentToWinner = amount - amountSentToDevs;

        const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
          await global.databases.game.get("CurrentGame").seed,
          {
            prefix: global.config.prefix,
          }
        );

        const signingClient = await SigningStargateClient.connectWithSigner(
          global.config.rpcUrl,
          wallet
        );

        let [firstAccount] = await wallet.getAccounts();
        let address = firstAccount.address;

        const res = await signingClient.signAndBroadcast(
          address,
          [
            // Send to winner message
            {
              typeUrl: "/cosmos.bank.v1beta1.MsgSend",

              value: {
                fromAddress: address,
                toAddress: winningAddress,
                amount: [
                  {
                    denom: global.config.coin,
                    amount: amountSentToWinner.toString(),
                  },
                ],
              },
            },
            {
              typeUrl: "/cosmos.bank.v1beta1.MsgSend",

              value: {
                fromAddress: address,
                toAddress: global.config.devWallet,
                amount: [
                  {
                    denom: config.coin,
                    amount: amountSentToDevs.toString(),
                  },
                ],
              },
            },
          ],
          global.config.gas,
          "kwakpot Winner"
        );

        consola.success(res.transactionHash + ": " + "Game has been paid out!");

        /* Create new Game */

        // Upload game to Arweave
        let tx = await global.arweave.createTransaction(
          {
            data: JSON.stringify({
              potAddress: await game.address,
              totalPot: global.game.totalPot,
              entries: global.game.entries,
              ticketPrice: await game.ticketPrice,
              endingHeight: await game.endingBlock,
              date: Date.now(),
              winner: {
                address: winningAddress,
                chanceToWin:
                  ((await global.databases.players.get(winningAddress)
                    .tickets) /
                    allTickets.length) *
                  100,
              },
            }),
            tags: encodeTags([
              {
                name: "App-Name",
                value: "kwakpot",
              },
              {
                name: "kwakpot-game",
                value: "beta-test",
              },
              {
                name: "Nonce",
                value: Date.now().toString(),
              },
            ]),
          },
          global.jwk
        );

        await arweave.transactions.sign(tx, global.jwk);

        await arweave.transactions.post(tx);

        consola.success(tx.id + ": " + "Game was uploaded to Arweave!");

        await createGame();

        // Made this a function because sometimes dont need to pay out or upload to arweave. (In the case no one partipcated in the pot)
        async function createGame() {
          for (let {
            key,
            value,
          } of await global.databases.entries.getRange()) {
            await global.databases.entries.remove(key);
          }

          for (let {
            key,
            value,
          } of await global.databases.players.getRange()) {
            await global.databases.players.remove(key);
          }

          for (let { key, value } of await global.databases.game.getRange()) {
            await global.databases.players.remove(key);
          }

          consola.success("Game data has been deleted!");

          const newWallet = await DirectSecp256k1HdWallet.generate(24, {
            prefix: global.config.prefix, // set to your chains respective prefix
          });

          let [firstWallet] = await newWallet.getAccounts();
          const newAddress = firstWallet.address;

          await global.databases.game.put("CurrentGame", {
            seed: newWallet.mnemonic,
            address: newAddress,
            endingBlock: parseInt(global.block) + global.config.gameLength,
            entries: 0,
            totalPot: 0,
            ticketPrice: parseInt(global.config.ticketPrice),
          });

          global.game.entries = 0;
          global.game.totalPot = 0;

          global.gameEnding = false;
          consola.success("New Game Was Created!");
        }
      }
    } catch (e) {
      console.log(e);
    }
  }, 15000);

  // Check global.txs fetch data and throw it into the pot
  setInterval(async () => {
    if (global.gameEnding == true)
      return consola.error(
        "Cant index transaction(s) game has ended, Waiting till new game is created"
      );

    await indexTxs();
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

function deterministicSortAndShuffle(array, seed) {
  // console.log(array)
  const prng = seedrandom(seed);
  let newArr = array.sort((a, b) => a.address.localeCompare(b.address));

  // Fisher-Yates algorithm
  for (let i = newArr.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
  }

  // console.log(newArr)

  return newArr;
}

function encodeTags(tags) {
  return tags.map((tag) => ({
    name: btoa(tag.name),
    value: btoa(tag.value),
  }));
}

async function indexTxs() {
  const TXs = [...global.txs];

  if (TXs.length <= 0) return;

  // If the game has ended, dont try to index the transaction wait for a new game to be made
  TXs.forEach(async (txid) => {
    let decodedTx;

    if (global.databases.entries.get(txid)) {
      return consola.error(txid + ": " + "Transaction was already indexed!");
    }

    try {
      decodedTx = decodeTxRaw((await stargateClient.getTx(txid)).tx);
    } catch (e) {
      console.log(e)
      consola.error("TX couldnt be decoded");
      return false;
    }

    // Register Default Cosmos Types
    const registry = new Registry(defaultRegistryTypes);

    // Find the message where they send coins
    const MsgSend = decodedTx.body.messages.filter(
      (obj) => obj.typeUrl === "/cosmos.bank.v1beta1.MsgSend"
    );
    let DecodeMsgSend;
    // Decode that message
    try {
      DecodeMsgSend = registry.decode(MsgSend[0]);
    } catch (e) {
      console.log("TX was inputted thats not part of default registry");
    }

    if (
      DecodeMsgSend.toAddress !=
      (await global.databases.game.get("CurrentGame").address)
    )
      return;

    let { denom, amount } = DecodeMsgSend.amount[0];

    // Make sure there sending the official coin, and not an inflated one so they get more tickets
    if (denom != global.config.coin) return;

    // How many tickets they get
    let tickets = Math.floor(
      parseInt(amount) /
        (await global.databases.game.get("CurrentGame").ticketPrice)
    );

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
}
