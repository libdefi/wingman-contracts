import { ethers } from "hardhat";
import { LINK_TOKEN } from "./consts";

async function main() {
  const [signer] = await ethers.getSigners();

  const linkToken = LINK_TOKEN.mumbai;

  const Operator = await ethers.getContractFactory("Operator");
  const operator = await Operator.deploy(linkToken, signer.address);

  await operator.deployed();
  await operator.setAuthorizedSenders([
    "0x16219a5078aBBEc4aEBb1b88Dc02688E5750Aa3b",
    "0x82f92e34d031EBd0B89BA95c86eb3D8732fCe3f0",
  ]);

  console.log(`Operator: ${operator.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
