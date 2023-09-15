import { ethers } from "hardhat";

async function testDistribution() {
    const market = await ethers.getContractAt("FlightDelayMarket", '0x78a01b4640a6ec313ab143619f1ac9ee10d51cd6');

    const currentDistribution = await market.currentDistribution();

    console.log(`Market current distribution: ${currentDistribution}`);
}

testDistribution().catch((error) => {
    console.error(error);
    process.exit(1);
});