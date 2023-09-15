import { ethers } from "hardhat";

async function deploy() {
  const jobId = ethers.toUtf8Bytes("7733b99d0bbd4b61986e9bb9a9d0605f");

  const LexisNexisTester = await ethers.getContractFactory("LexisNexisTester");
  const tester = await LexisNexisTester.deploy(
    "0x326C977E6efc84E512bB9C30f76E30c160eD06FB",
    "0x050B435b29435EAd36034EdA2FA7d2fCcf1FA327",
    jobId
  );

  await tester.deploymentTransaction()?.wait();

  console.log(`LexisNexisTester: ${tester.target}`);
}

async function requestStatus() {
  const tester = await ethers.getContractAt("LexisNexisTester", "0xc59111ca58293392Ab41a57391E71c317aAb718E");

  await tester.requestFlightStatus(
    "GR0606",
    1676904000
  );
}

requestStatus().catch((error) => {
  console.error(error);
  process.exit(1);
});
