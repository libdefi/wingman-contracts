import hre, { defender, ethers, upgrades } from "hardhat";

async function verifyInsurance() {
  const FlightInsurance = await ethers.getContractAt("FlightInsurance", "0x60362c1AfB9Cc1bA58df834F99412BF0e5220D27");
  
  console.log("Verifiying new implementation...");
  await hre.run("verify:verify", {
    address: FlightInsurance.target,
    constructorArguments: [],
  });
}

async function upgrade() {
  const registry = await ethers.getContractAt(
    "DFIRegistry",
    "0x337Ed86957Ce348E756a44624c1967CEA7a5fD21",
  );

  const insuranceProxyAddr = "0x5053B459bc7D7b61Fb0537987792580961fd542A";

  // 1. Upgrade FlightInsurance
  const FlightInsurance = await ethers.getContractFactory("FlightInsurance");
  console.log("Validating upgrade...");
  await upgrades.validateUpgrade("0x5053B459bc7D7b61Fb0537987792580961fd542A", FlightInsurance);
  console.log("Preparing proposal...");
  const proposal = await defender.proposeUpgrade(insuranceProxyAddr, FlightInsurance, {
    title: "Upgrade FlightInsurance to support sponsored",
    description:
      "Upgrade FlightInsurance to support sponsored market creation and sponsored first prediction",
    multisig: "0x001EaC1e09BF0A53835334d3A98E7FA9cAE7F1c0",
  });
  console.log("Upgrade proposal created at:", proposal.url);

  // 2. Deploy new factory
  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.target);
  console.log("Deploying new factory... Tx: ", factory.deploymentTransaction()?.hash);
  await factory.deploymentTransaction()?.wait();

  console.log("New factory deployed at", factory.target);

  // 3. Set new factory - skip since we update through Safe / Defender
  // await registry.setAddresses([1], [factory.address]);

  console.log("Done!");
}

upgrade().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
