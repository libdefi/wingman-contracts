import { ethers } from "hardhat";

async function upgrade() {
  const registry = await ethers.getContractAt("DFIRegistry", "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21");

  // 1. Deploy new factory
  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.address);

  console.log("New factory deployed at", factory.address);

  // 2. Set new factory
  await registry.setAddresses([
    1,
  ], [
    factory.address,
  ]);

  console.log("Done!");
}

upgrade().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
