import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000
          }
        }
      },
    ]
  },
  defender: {
    apiKey: process.env.DEF_API_KEY!,
    apiSecret: process.env.DEF_API_SECRET!,
  },
  networks: {
    hardhat: {},
    local: {
      url: "http://127.0.0.1:8545/"
    },
    dashboard: {
      url: "http://localhost:24012/rpc"
    },
    mumbai: {
      url: "https://rpc.ankr.com/polygon_mumbai",
      accounts: [PRIVATE_KEY]
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com/",
      accounts: [PRIVATE_KEY]
    },
    goerli: {
      url: "https://rpc.ankr.com/eth_goerli",
      accounts: [PRIVATE_KEY]
    },
    baseGoerli: {
      url: "https://goerli.base.org",
      accounts: [PRIVATE_KEY],
    }
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
    customChains: [
      {
        network: "baseGoerli",
        chainId: 84531,
        urls: {
         // Basescan by Etherscan
         apiURL: "https://api-goerli.basescan.org/api",
         browserURL: "https://goerli.basescan.org"
        }
      }
    ]
  }
};

export default config;
