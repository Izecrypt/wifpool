require("dotenv").config();
const { HardhatUserConfig } = require("hardhat/config");
require("@nomicfoundation/hardhat-toolbox");

const RPC_URL = process.env.RHCHAIN_RPC || "";
const PRIVATE_KEY = process.env.DEPLOYER_KEY || "";

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: { chainId: 31337 },
    robinhood: {
      url: RPC_URL,
      chainId: 4663,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
