import { ethers, upgrades } from "hardhat";
import { GELATO_RELAYER } from "../consts";

async function upgrade() {
  const registry = await ethers.getContractAt("DFIRegistry", "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21");

  // 1. Upgrade FlightInsurance
  const FlightInsurance = await ethers.getContractFactory("FlightInsurance");
  await upgrades.upgradeProxy("0x5053B459bc7D7b61Fb0537987792580961fd542A", FlightInsurance);

  console.log("FlightInsurance upgraded");

  // 2. Deploy new factory
  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.address);

  console.log("New factory deployed at", factory.address);

  // 3. Set GelatoRelayer as per ERC-2771 forwarder mechanism, and set new factory
  await registry.setAddresses([
    1,
    101
  ], [
    factory.address,
    GELATO_RELAYER
  ]);

  console.log("Done!");
}

upgrade().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
