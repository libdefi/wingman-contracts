import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("DFIToken", function () {
  async function deployDFITokenRegistryFixture() {
    const [owner] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const dfiRegistry = await upgrades.deployProxy(DFIRegistry, []);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const dfiToken = await upgrades.deployProxy(DFIToken, [dfiRegistry.address]);

    const MockProduct = await ethers.getContractFactory("MockProduct");
    const mockProduct = await MockProduct.deploy();

    const marketId = ethers.utils.randomBytes(32);
    const tokenIdYes = 100;
    const tokenIdNo = 101;

    const MockMarket = await ethers.getContractFactory("MockMarket");
    const mockMarket = await MockMarket.deploy(
      mockProduct.address,
      marketId,
      tokenIdYes,
      tokenIdNo,
      dfiToken.address
    );

    return { dfiToken, dfiRegistry, owner, mockMarket, mockProduct, marketId, tokenIdNo, tokenIdYes };
  }

  describe("Deployment", function () {
    it("Should deploy DFIToken", async function () {
      const { dfiToken } = await loadFixture(deployDFITokenRegistryFixture);
      assert.ok(dfiToken.address);
    });
  });

  describe("Validations", function () {
    it("Should not allow market from unknown product to mint tokens", async function () {
      const { mockMarket, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await expect(
        mockMarket.mint(owner.address, tokenIdYes, 100)
      ).to.be.revertedWith("Unknown product");
    });

    it("Should not allow market from unknown product to burn tokens", async function () {
      const { mockMarket, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await expect(
        mockMarket.burn(owner.address, tokenIdYes, 100)
      ).to.be.revertedWith("Unknown product");
    });

    it("Should not allow minting tokens for unknown market", async function () {
      const { mockMarket, mockProduct, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await expect(
        mockMarket.mint(owner.address, tokenIdYes, 100)
      ).to.be.revertedWith("Unknown market");
    });

    it("Should not allow burning tokens for unknown market", async function () {
      const { mockMarket, mockProduct, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await expect(
        mockMarket.burn(owner.address, tokenIdYes, 100)
      ).to.be.revertedWith("Unknown market");
    });

    it("Should not allow minting tokens for market with different token ID", async function () {
      const { mockMarket, mockProduct, dfiRegistry, owner, marketId } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await expect(
        mockMarket.mint(owner.address, 123, 100)
      ).to.be.revertedWith("Wrong tokens");
    });

    it("Should not allow burning tokens for market with different token ID", async function () {
      const { mockMarket, mockProduct, dfiRegistry, owner, marketId } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await expect(
        mockMarket.burn(owner.address, 123, 100)
      ).to.be.revertedWith("Wrong tokens");
    });
  });

  describe("Minting", function () {
    it("Should mint tokens for market", async function () {
      const { mockMarket, mockProduct, dfiToken, marketId, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await mockMarket.mint(owner.address, tokenIdYes, 100);

      const balance = await dfiToken.balanceOf(owner.address, tokenIdYes);
      expect(balance).to.equal(100);
    });
  });

  describe("Burning", function () {
    it("Should burn tokens for market", async function () {
      const { mockMarket, mockProduct, dfiToken, marketId, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await mockMarket.mint(owner.address, tokenIdYes, 100);
      await mockMarket.burn(owner.address, tokenIdYes, 50);

      const balance = await dfiToken.balanceOf(owner.address, tokenIdYes);
      expect(balance).to.equal(50);
    });
  });

  describe("Total Supply", function () {
    it("Should return total supply for one mint", async function () {
      const { mockMarket, mockProduct, dfiToken, marketId, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await mockMarket.mint(owner.address, tokenIdYes, 100);

      const totalSupply = await dfiToken.totalSupply(tokenIdYes);
      expect(totalSupply).to.equal(100);
    });

    it("Should return total supply for multiple random mints", async function () {
      const { mockMarket, mockProduct, dfiToken, marketId, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      const randomAmounts = Array.from({ length: 10 }, () => Math.floor(Math.random() * 100));
      const expectedSupply = randomAmounts.reduce((a, b) => a + b, 0);

      for (const amount of randomAmounts) {
        await mockMarket.mint(owner.address, tokenIdYes, amount);
      }

      const totalSupply = await dfiToken.totalSupply(tokenIdYes);
      expect(totalSupply).to.equal(expectedSupply);
    });

    it("Should return total supply for multiple random mints and burns", async function () {
      const { mockMarket, mockProduct, dfiToken, marketId, dfiRegistry, owner, tokenIdYes } = await loadFixture(deployDFITokenRegistryFixture);

      await mockProduct.setMarket(marketId, mockMarket.address);
      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      const randomAmounts = Array.from({ length: 10 }, () => Math.floor(Math.random() * 100));
      const expectedSupply = randomAmounts.reduce((a, b) => a + b, 0);

      for (const amount of randomAmounts) {
        await mockMarket.mint(owner.address, tokenIdYes, amount);
      }

      const burnAmounts = Array.from({ length: 5 }, () => Math.floor(Math.random() * 100));

      for (const amount of burnAmounts) {
        await mockMarket.burn(owner.address, tokenIdYes, amount);
      }

      const totalSupply = await dfiToken.totalSupply(tokenIdYes);
      expect(totalSupply).to.equal(expectedSupply - burnAmounts.reduce((a, b) => a + b, 0));
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade DFIToken directly", async function () {
      const { dfiToken } = await loadFixture(deployDFITokenRegistryFixture);

      const DFITokenV2 = await ethers.getContractFactory("DFIToken");
      const dfiTokenV2 = await upgrades.upgradeProxy(dfiToken.address, DFITokenV2);
      await dfiTokenV2.deployed();
      expect(dfiTokenV2.address).to.be.equal(dfiToken.address);
    });
  });
});