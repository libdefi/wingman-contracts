import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("FlightDelayMarketFactory", function () {
  async function deployFlightDelayMarketFactoryFixture() {
    const [owner] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const dfiRegistry = await upgrades.deployProxy(DFIRegistry, []);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const dfiToken = await upgrades.deployProxy(DFIToken, [dfiRegistry.address]);

    const MockProduct = await ethers.getContractFactory("MockProduct");
    const mockProduct = await MockProduct.deploy();

    const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
    const flightDelayMarketFactory = await FlightDelayMarketFactory.deploy(dfiRegistry.address);

    return { dfiRegistry, owner, mockProduct, dfiToken, flightDelayMarketFactory };
  }

  describe("Deployment", function () {
    it("Should deploy FlightDelayMarketFactory", async function () {
      const { flightDelayMarketFactory } = await loadFixture(deployFlightDelayMarketFactoryFixture);
      assert.ok(flightDelayMarketFactory.address);
    });
  });

  describe("Validations", function () {
    it("Should not allow non-product to create market", async function () {
      const { flightDelayMarketFactory, dfiToken, owner, mockProduct } = await loadFixture(deployFlightDelayMarketFactoryFixture);

      await expect(
        flightDelayMarketFactory.createMarket(
          10,
          ethers.utils.randomBytes(32),
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

      const expected = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["string", "uint64", "uint32"],
          ["AA1", 1678900000, 90]
        )
      );

      expect(marketId).to.equal(expected);
    });
  });
});