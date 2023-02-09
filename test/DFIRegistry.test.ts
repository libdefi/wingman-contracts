import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("DFIRegistry", function () {
  async function deployDFIRegistryFixture() {
    const [owner] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const dfiRegistry = await upgrades.deployProxy(DFIRegistry, []);
    await dfiRegistry.deployed();
    return { dfiRegistry, owner };
  }

  describe("Deployment", function () {
    it("Should deploy DFIRegistry", async function () {
      const { dfiRegistry } = await loadFixture(deployDFIRegistryFixture);
      assert.ok(dfiRegistry.address);
    });

    it("Should set owner", async function () {
      const { dfiRegistry, owner } = await loadFixture(
        deployDFIRegistryFixture
      );
      expect(await dfiRegistry.owner()).to.equal(owner.address);
    });
  });

  describe("Validations", function () {
    it("Should not allow non-owner to set addressed", async function () {
      const { dfiRegistry } = await loadFixture(deployDFIRegistryFixture);
      const [_, nonOwner, other] = await ethers.getSigners();
      await expect(
        dfiRegistry.connect(nonOwner).setAddresses([1], [other.address])
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert if addresses and ids are not of same length", async function () {
      const { dfiRegistry, owner } = await loadFixture(
        deployDFIRegistryFixture
      );
      const [_, other] = await ethers.getSigners();
      await expect(
        dfiRegistry.connect(owner).setAddresses([1], [other.address, other.address])
      ).to.be.revertedWith("DFIRegistry: invalid input length");
    });
  });

  describe("Events", function () {
    it("Should emit RegistryUpdated event", async function () {
      const { dfiRegistry } = await loadFixture(
        deployDFIRegistryFixture
      );
      const [_, other1, other2] = await ethers.getSigners();
      const setAddresses = dfiRegistry.setAddresses([1, 2], [other1.address, other2.address]);
      await expect(setAddresses).to.emit(dfiRegistry, "RegistryUpdated")
        .withArgs(1, other1.address);
      await expect(setAddresses).to.emit(dfiRegistry, "RegistryUpdated")
        .withArgs(2, other2.address);
    });
  });

  describe("Getters", function () {
    it("Should return correct address for given id", async function () {
      const { dfiRegistry } = await loadFixture(
        deployDFIRegistryFixture
      );
      const [_, other1, other2] = await ethers.getSigners();
      await dfiRegistry.setAddresses([1, 2], [other1.address, other2.address]);
      expect(await dfiRegistry.getAddress(1)).to.equal(other1.address);
      expect(await dfiRegistry.getAddress(2)).to.equal(other2.address);
    });

    it("Should return correct id for given address", async function () {
      const { dfiRegistry } = await loadFixture(
        deployDFIRegistryFixture
      );
      const [_, other1, other2] = await ethers.getSigners();
      await dfiRegistry.setAddresses([1, 2], [other1.address, other2.address]);
      expect(await dfiRegistry.getId(other1.address)).to.equal(1);
      expect(await dfiRegistry.getId(other2.address)).to.equal(2);
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade DFIRegistry directly", async function () {
      const { dfiRegistry } = await loadFixture(deployDFIRegistryFixture);

      const DFIRegistryV2 = await ethers.getContractFactory("DFIRegistry");
      const dfiRegistryV2 = await upgrades.upgradeProxy(dfiRegistry.address, DFIRegistryV2);
      await dfiRegistryV2.deployed();
      expect(dfiRegistryV2.address).to.be.equal(dfiRegistry.address);
    });
  });
});