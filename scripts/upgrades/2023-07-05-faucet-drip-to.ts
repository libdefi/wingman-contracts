import { ethers } from "hardhat";

import { API_TRUSTUS_SIGNER, GELATO_RELAYER } from "../consts";

async function upgrade() {
  const DFIFaucet = await ethers.getContractFactory("DFIFaucet");
  const faucet = await DFIFaucet.deploy(GELATO_RELAYER);
  await faucet.deployed();

  await faucet.grantRole(await faucet.DRIPPER_ROLE(), API_TRUSTUS_SIGNER)
    .then((tx) => tx.wait());

  console.log("Faucet deployed at", faucet.address);
}

upgrade().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
