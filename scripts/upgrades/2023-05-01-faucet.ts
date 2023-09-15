import { ethers } from "hardhat";

import { GELATO_RELAYER } from "../consts";

async function upgrade() {
  const DFIFaucet = await ethers.getContractFactory("DFIFaucet");
  const faucet = await DFIFaucet.deploy(GELATO_RELAYER);

  console.log("Faucet deployed at", faucet.target);
}

upgrade().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
