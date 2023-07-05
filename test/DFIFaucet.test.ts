import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("DFIFaucet", function () {
  async function deployDFIFaucetFixture() {
    const [owner, nonOwner, other] = await ethers.getSigners();

    const DFIFaucet = await ethers.getContractFactory("DFIFaucet");
    const dfiFaucet = await DFIFaucet.deploy(other.address);
    await dfiFaucet.deployed();
    return { dfiFaucet, owner, nonOwner, other };
  }

  describe("Deployment", function () {
    it("Should deploy DFIFaucet", async function () {
      const { dfiFaucet } = await loadFixture(deployDFIFaucetFixture);
      assert.ok(dfiFaucet.address);
    });

    it("Should set admin", async function () {
      const { dfiFaucet, owner } = await loadFixture(
        deployDFIFaucetFixture
      );
      expect(await dfiFaucet.hasRole(await dfiFaucet.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
    });

    it("Should set drip amount", async function () {
      const { dfiFaucet } = await loadFixture(
        deployDFIFaucetFixture
      );
      expect(await dfiFaucet.dripAmount()).to.equal(ethers.utils.parseEther("0.05"));
    });
  });

  describe("Validations", function () {
    it("Should not allow non-owner to set drip amount", async function () {
      const { dfiFaucet, nonOwner } = await loadFixture(deployDFIFaucetFixture);
      await expect(
        dfiFaucet.connect(nonOwner).setDripAmount(ethers.utils.parseEther("0.1"))
      ).to.be.revertedWith(/is missing role/);
    });

    it("Should not allow non-owner to withdraw", async function () {
      const { dfiFaucet, nonOwner } = await loadFixture(deployDFIFaucetFixture);
      await expect(
        dfiFaucet.connect(nonOwner).withdraw()
      ).to.be.revertedWith(/is missing role/);
    });

    it("Should not allow non-dripper to drip to other", async function () {
      const { dfiFaucet, other, nonOwner } = await loadFixture(deployDFIFaucetFixture);
      await expect(
        dfiFaucet.connect(nonOwner).dripTo(other.address)
      ).to.be.revertedWith(/is missing role/);
    });

    it("Should not allow drip twice", async function () {
      const { dfiFaucet, owner, nonOwner } = await loadFixture(deployDFIFaucetFixture);
      await owner.sendTransaction({
        to: dfiFaucet.address,
        value: ethers.utils.parseEther("100")
      });

      await dfiFaucet.connect(nonOwner).drip();

      await expect(
        dfiFaucet.connect(nonOwner).drip()
      ).to.be.revertedWith("DFIFaucet: Already dripped");
    });
  });

  describe("Events", function () {
    it("Should emit Drip event", async function () {
      const { dfiFaucet, owner } = await loadFixture(
        deployDFIFaucetFixture
      );

      await owner.sendTransaction({
        to: dfiFaucet.address,
        value: ethers.utils.parseEther("100")
      });

      await expect(dfiFaucet.connect(owner).drip()).to.emit(dfiFaucet, "Drip")
        .withArgs(owner.address, ethers.utils.parseEther("0.05"));
    });
  });

  describe("Settings", function () {
    it("Should set drip amount", async function () {
      const { dfiFaucet, owner } = await loadFixture(
        deployDFIFaucetFixture
      );

      expect(await dfiFaucet.dripAmount()).to.equal(ethers.utils.parseEther("0.05"));
      await dfiFaucet.connect(owner).setDripAmount(ethers.utils.parseEther("0.1"));
      expect(await dfiFaucet.dripAmount()).to.equal(ethers.utils.parseEther("0.1"));
    });
  });

  describe("Drip", function () {
    it("Should drip", async function () {
      const { dfiFaucet, owner, nonOwner } = await loadFixture(
        deployDFIFaucetFixture
      );

      await owner.sendTransaction({
        to: dfiFaucet.address,
        value: ethers.utils.parseEther("100")
      });


      await expect(dfiFaucet.connect(nonOwner).drip())
        .to.changeEtherBalance(nonOwner, ethers.utils.parseEther("0.05"));
    });

    it("Should drip to other if dripper", async function () {
      const { dfiFaucet, owner, nonOwner, other } = await loadFixture(
        deployDFIFaucetFixture
      );

      await owner.sendTransaction({
        to: dfiFaucet.address,
        value: ethers.utils.parseEther("100")
      });

      await dfiFaucet.grantRole(await dfiFaucet.DRIPPER_ROLE(), nonOwner.address);

      await expect(dfiFaucet.connect(nonOwner).dripTo(other.address))
        .to.changeEtherBalance(other, ethers.utils.parseEther("0.05"));
    });

    it("Should save drip amount", async function () {
      const { dfiFaucet, owner, nonOwner } = await loadFixture(
        deployDFIFaucetFixture
      );

      await owner.sendTransaction({
        to: dfiFaucet.address,
        value: ethers.utils.parseEther("100")
      });

      expect(await dfiFaucet.dripped(nonOwner.address)).to.equal(0);

      await dfiFaucet.connect(nonOwner).drip();

      expect(await dfiFaucet.dripped(nonOwner.address)).to.equal(ethers.utils.parseEther("0.05"));
    });
  });
});