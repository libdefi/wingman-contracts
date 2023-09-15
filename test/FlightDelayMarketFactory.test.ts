import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";
import { FlightDelayMarketFactory } from "../typechain-types";

describe("FlightDelayMarketFactory", function () {
  async function deployFlightDelayMarketFactoryFixture() {
    const [owner] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const registryProxy = await upgrades.deployProxy(DFIRegistry, []);
    await registryProxy.waitForDeployment();
    const dfiRegistry = await ethers.getContractAt("DFIRegistry", registryProxy.target);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const deployedProxy = await upgrades.deployProxy(DFIToken, [dfiRegistry.target]);
    await deployedProxy.waitForDeployment();
    const dfiToken = await ethers.getContractAt("DFIToken", deployedProxy.target);

    const MockProduct = await ethers.getContractFactory("MockProduct");
    const mockProduct = await MockProduct.deploy();

    const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
    const mfContractAndTxReceipt = await FlightDelayMarketFactory.deploy(dfiRegistry.target);
    const flightDelayMarketFactory = mfContractAndTxReceipt as FlightDelayMarketFactory;

    return { dfiRegistry, owner, mockProduct, dfiToken, flightDelayMarketFactory };
  }

  describe("Deployment", function () {
    it("Should deploy FlightDelayMarketFactory", async function () {
      const { flightDelayMarketFactory } = await loadFixture(deployFlightDelayMarketFactoryFixture);
      assert.ok(flightDelayMarketFactory.target);
    });
  });

  describe("Validations", function () {
    it("Should not allow non-product to create market", async function () {
      const { flightDelayMarketFactory, dfiToken, owner, mockProduct } = await loadFixture(deployFlightDelayMarketFactoryFixture);

      await expect(
        flightDelayMarketFactory.createMarket(
          10,
          ethers.randomBytes(32),
          { cutoffTime: 0, closingTime: 0, fee: 0, initP: 0, lpBid: 0, maxBid: 0, minBid: 0, mode: 0, oracle: owner.address },
          { delay: 0, departureDate: 0, flightName: "AA1" }
        )
      ).to.be.revertedWith("Unknown product");
    });
  });

  describe("Getters", function () {
    it("Should return correct marketId", async function () {
      const { flightDelayMarketFactory } = await loadFixture(deployFlightDelayMarketFactoryFixture);

      const marketId = await flightDelayMarketFactory.getMarketId(
        "AA1",
        1678900000,
        90
      );

      const expected = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "uint64", "uint32"],
          ["AA1", 1678900000, 90]
        )
      );

      expect(marketId).to.equal(expected);
    });
  });
});