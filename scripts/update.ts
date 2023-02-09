import { ethers } from "hardhat";

async function updateFactory() {
  const registry = await ethers.getContractAt("DFIRegistry", "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21");
  const Factory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await Factory.deploy(registry.address);

  await registry.setAddresses(
    [1],
    [factory.address]
  );
}

updateFactory().catch((error) => {
  console.error(error);
  process.exit(1);
});
