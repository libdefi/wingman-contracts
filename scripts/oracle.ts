import { ethers } from "hardhat";
import { CHAINLINK_OPERATOR, LINK_TOKEN } from "./consts";

async function oracle() {
  const linkToken = LINK_TOKEN.mumbai;
  const operator = CHAINLINK_OPERATOR.mumbai;
  const jobId = ethers.toUtf8Bytes("28bceca08bb0464da5d2c822b9b85f73");

  const registry = await ethers.getContractAt("DFIRegistry", "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21");

  const FlightStatusOracle = await ethers.getContractFactory("FlightStatusOracle");
  const oracle = await FlightStatusOracle.deploy(linkToken, operator, jobId, registry.target);

  await oracle.deploymentTransaction()?.wait();
  console.log(`Oracle: ${oracle.target}`);
}

async function request() {
  const oracle = await ethers.getContractAt("FlightStatusOracle", "0x47B036a0e212e4742DA5b0DA1565b8556D42568f");

  const tx = await oracle.requestFlightStatus(
    "BA442",
    20230502,
    ethers.toUtf8Bytes("0000")
  );
  const receipt = await tx.wait();
  let requestId;
  receipt?.logs
    .map((log) => {
      const topics = log?.topics.map((topic)=> topic); // copy to avoid readonly error
      const data = log?.data;
      try {
        return oracle.interface.parseLog({topics, data});
      } catch {
        return null;
      }
    })
    .filter((log) => log && log.name === "FlightStatusRequested")
    .forEach((log) => {
      requestId = log?.args[0];
    });
  console.log(`FlightStatusRequested: ${requestId}`);
}

async function manual() {
  const oracle = await ethers.getContractAt("FlightStatusOracle", "0xc1F38F911F6F6b9a10f091cab63f047045Cb3f9c");

  const requestId = '0x3a7c3217d22c54f6826bad4e6ea90dfdd10522fb65f12ee531c69329055206f3';
  await oracle.manualFulfillment(requestId, ethers.toUtf8Bytes("L"), 85);
}

request().catch((err) => {
  console.error(err);
  process.exit(1);
});
