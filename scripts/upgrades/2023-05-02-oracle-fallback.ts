import hre, { ethers } from "hardhat";
import { CHAINLINK_OPERATOR, LINK_TOKEN } from "../consts";

async function upgrade() {
  const linkToken = LINK_TOKEN.mumbai;
  const operator = CHAINLINK_OPERATOR.mumbai;
  const jobId = ethers.toUtf8Bytes("28bceca08bb0464da5d2c822b9b85f73");

  const registry = await ethers.getContractAt("DFIRegistry", "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21");

  // 1. Create new oracle
  const FlightStatusOracle = await ethers.getContractFactory("FlightStatusOracle");
  const oracle = await FlightStatusOracle.deploy(linkToken, operator, jobId, registry.target);
  await oracle.deploymentTransaction()?.wait();
  console.log(`Oracle: ${oracle.target}`);

  await new Promise((resolve) => setTimeout(resolve, 30000));

  // 2. Verify it
  await hre.run("verify:verify", {
    address: oracle.target,
    constructorArguments: [
      linkToken,
      operator,
      jobId,
      registry.target,
    ],
  });
  console.log("Verified!");

  // 3. Set Oracle in registry
  await registry.setAddresses([
    5
  ], [
    oracle.target
  ]);
}

upgrade().catch((err) => {
  console.error(err);
  process.exit(1);
});
