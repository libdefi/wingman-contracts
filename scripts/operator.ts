import { ethers } from "hardhat";
import { LINK_TOKEN, ORACLE_AUTHORIZED_SENDERS } from "./consts";

async function main() {
  const [signer] = await ethers.getSigners();

  const linkToken = LINK_TOKEN.polygon;

  const Operator = await ethers.getContractFactory("Operator");
  const operator = await Operator.deploy(linkToken, signer.address);

  await operator.deploymentTransaction()?.wait();
  await operator.setAuthorizedSenders(ORACLE_AUTHORIZED_SENDERS.polygon);

  console.log(`Operator: ${operator.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
