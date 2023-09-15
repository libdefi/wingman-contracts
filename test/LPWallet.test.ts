import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("LPWallet", function () {
  async function deployLPWalletFixture() {
    const [owner, anotherAccount] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const registryProxy = await upgrades.deployProxy(DFIRegistry, []);
    await registryProxy.waitForDeployment();
    const dfiRegistry = await ethers.getContractAt("DFIRegistry", registryProxy.target);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const deployedProxy = await upgrades.deployProxy(DFIToken, [dfiRegistry.target]);
    await deployedProxy.waitForDeployment();
    const dfiToken = await ethers.getContractAt("DFIToken", deployedProxy.target);

    const LPWallet = await ethers.getContractFactory("LPWallet");
    const walletProxy = await upgrades.deployProxy(LPWallet, [dfiRegistry.target]);
    await walletProxy.waitForDeployment();
    const lpWallet = await ethers.getContractAt("LPWallet", walletProxy.target);

    const MockProduct = await ethers.getContractFactory("MockProduct");
    const mockProduct = await MockProduct.deploy();

    const marketId = ethers.randomBytes(32);

    const MockMarket = await ethers.getContractFactory("MockMarket");
    const mockMarket = await MockMarket.deploy(
      mockProduct.target,
      marketId,
      100,
      101,
      dfiToken.target
    );

    return { dfiRegistry, owner, marketId, dfiToken, lpWallet, mockMarket, mockProduct, anotherAccount };
  }

  describe("Deployment", function () {
    it("Should deploy LPWallet", async function () {
      const { lpWallet } = await loadFixture(deployLPWalletFixture);
      assert.ok(lpWallet.target);
    });
  });

  describe("Validations", function () {
    it("Should not allow non-product to provide liquidity", async function () {
      const { lpWallet, mockMarket } = await loadFixture(deployLPWalletFixture);

      await expect(
        lpWallet.provideLiquidity(
          mockMarket.target,
          100,
        )
      ).to.be.revertedWith("Unknown product");
    });

    it("Should revert if not enough money to provide liquidity", async function () {
      const { lpWallet, mockMarket, dfiRegistry, mockProduct } = await loadFixture(deployLPWalletFixture);

      await dfiRegistry.setAddresses([1], [mockProduct.target]);

      await expect(
        mockProduct.provideLiquidity(
          lpWallet.target,
          mockMarket.target,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithoutReason();
    });

    it("Should not allow non-owner to withdraw", async function () {
      const { lpWallet, anotherAccount } = await loadFixture(deployLPWalletFixture);

      await expect(
        lpWallet.connect(anotherAccount)
          .withdraw(
            anotherAccount.address,
            100,
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert if not enough money to withdraw", async function () {
      const { lpWallet, owner } = await loadFixture(deployLPWalletFixture);

      await expect(
        lpWallet.connect(owner)
          .withdraw(
            owner.address,
            100,
          )
      ).to.be.revertedWith("Can't withdraw");
    });
  });

  describe("Liquidity", function () {
    it("Should allow liquidity to be provided", async function () {
      const { lpWallet, mockMarket, owner, dfiRegistry, mockProduct } = await loadFixture(deployLPWalletFixture);

      await dfiRegistry.setAddresses([1], [mockProduct.target]);

      await owner.sendTransaction({
        to: lpWallet.target,
        value: ethers.parseEther("101"),
      });

      const balanceBefore = await ethers.provider.getBalance(lpWallet.target);
      expect(balanceBefore).to.equal(ethers.parseEther("101"));

      await mockProduct.provideLiquidity(
        lpWallet.target,
        mockMarket.target,
        ethers.parseEther("100"),
      );

      const balanceAfter = await ethers.provider.getBalance(lpWallet.target);
      expect(balanceAfter).to.equal(ethers.parseEther("1"));
    });
  });

  describe("Withdrawal", function () {
    it("Should allow money to be withdrawn", async function () {
      const { lpWallet, owner } = await loadFixture(deployLPWalletFixture);

      await owner.sendTransaction({
        to: lpWallet.target,
        value: ethers.parseEther("101"),
      });

      const balanceBefore = await ethers.provider.getBalance(lpWallet.target);
      expect(balanceBefore).to.equal(ethers.parseEther("101"));

      const randomWallet = ethers.Wallet.createRandom();

      await lpWallet.connect(owner)
        .withdraw(
          randomWallet.address,
          ethers.parseEther("100"),
        );

      const balanceAfter = await ethers.provider.getBalance(lpWallet.target);
      expect(balanceAfter).to.equal(ethers.parseEther("1"));

      const randomWalletBalance = await ethers.provider.getBalance(randomWallet.address);
      expect(randomWalletBalance).to.equal(ethers.parseEther("100"));
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade LPWallet directly", async function () {
      const { lpWallet } = await loadFixture(deployLPWalletFixture);

      const LPWalletV2 = await ethers.getContractFactory("LPWallet");
      const lpWalletV2 = await upgrades.upgradeProxy(lpWallet.target, LPWalletV2);
      await lpWalletV2.waitForDeployment();
      expect(lpWalletV2.target).to.be.equal(lpWallet.target);
    });
  });
});