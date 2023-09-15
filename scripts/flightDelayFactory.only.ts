import { ethers } from "hardhat";

async function deploy() {
  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(
    "0x00a5c21B91E4de4aEdb8d6D5715b609c1Dbe3a39", // TODO: replace with the actual DFI Registry address
  );
  await factory.deploymentTransaction()?.wait();
  console.log("FlightDelayMarketFactory deployed to:", factory.target);
}

deploy().catch((error) => {
  console.error(error);
  process.exit(1);
});
