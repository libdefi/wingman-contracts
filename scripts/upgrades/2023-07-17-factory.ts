import { ethers } from "hardhat";

async function upgrade() {
  const registry = await ethers.getContractAt("DFIRegistry", "0x00a5c21B91E4de4aEdb8d6D5715b609c1Dbe3a39");

  // 1. Deploy new factory
  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.address, {
    gasLimit: 5000000,
  });

  console.log("New factory deployed at", factory.address);
  await factory.deployed();

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
