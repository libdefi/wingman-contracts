import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";

describe("LPWallet", function () {
  async function deployLPWalletFixture() {
    const [owner, anotherAccount] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const dfiRegistry = await upgrades.deployProxy(DFIRegistry, []);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const dfiToken = await upgrades.deployProxy(DFIToken, [dfiRegistry.address])

    const LPWallet = await ethers.getContractFactory("LPWallet");
    const lpWallet = await upgrades.deployProxy(LPWallet, [dfiRegistry.address]);

    const MockProduct = await ethers.getContractFactory("MockProduct");
    const mockProduct = await MockProduct.deploy();

    const marketId = ethers.utils.randomBytes(32);

    const MockMarket = await ethers.getContractFactory("MockMarket");
    const mockMarket = await MockMarket.deploy(
      mockProduct.address,
      marketId,
      100,
      101,
      dfiToken.address
    );

    return { dfiRegistry, owner, marketId, dfiToken, lpWallet, mockMarket, mockProduct, anotherAccount };
  }

  describe("Deployment", function () {
    it("Should deploy LPWallet", async function () {
      const { lpWallet } = await loadFixture(deployLPWalletFixture);
      assert.ok(lpWallet.address);
    });
  });

  describe("Validations", function () {
    it("Should not allow non-product to provide liquidity", async function () {
      const { lpWallet, mockMarket } = await loadFixture(deployLPWalletFixture);

      await expect(
        lpWallet.provideLiquidity(
          mockMarket.address,
          100,
        )
      ).to.be.revertedWith("Unknown product");
    });

    it("Should revert if not enough money to provide liquidity", async function () {
      const { lpWallet, mockMarket, dfiRegistry, mockProduct } = await loadFixture(deployLPWalletFixture);

      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await expect(
        mockProduct.provideLiquidity(
          lpWallet.address,
          mockMarket.address,
          ethers.utils.parseEther("100")
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

      await dfiRegistry.setAddresses([1], [mockProduct.address]);

      await owner.sendTransaction({
        to: lpWallet.address,
        value: ethers.utils.parseEther("101"),
      });

      const balanceBefore = await ethers.provider.getBalance(lpWallet.address);
      expect(balanceBefore).to.equal(ethers.utils.parseEther("101"));

      await mockProduct.provideLiquidity(
        lpWallet.address,
        mockMarket.address,
        ethers.utils.parseEther("100"),
      );

      const balanceAfter = await ethers.provider.getBalance(lpWallet.address);
      expect(balanceAfter).to.equal(ethers.utils.parseEther("1"));
    });
  });

  describe("Withdrawal", function () {
    it("Should allow money to be withdrawn", async function () {
      const { lpWallet, owner } = await loadFixture(deployLPWalletFixture);

      await owner.sendTransaction({
        to: lpWallet.address,
        value: ethers.utils.parseEther("101"),
      });

      const balanceBefore = await ethers.provider.getBalance(lpWallet.address);
      expect(balanceBefore).to.equal(ethers.utils.parseEther("101"));

      const randomWallet = ethers.Wallet.createRandom();

      await lpWallet.connect(owner)
        .withdraw(
          randomWallet.address,
          ethers.utils.parseEther("100"),
        );

      const balanceAfter = await ethers.provider.getBalance(lpWallet.address);
      expect(balanceAfter).to.equal(ethers.utils.parseEther("1"));

      const randomWalletBalance = await ethers.provider.getBalance(randomWallet.address);
      expect(randomWalletBalance).to.equal(ethers.utils.parseEther("100"));
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade LPWallet directly", async function () {
      const { lpWallet } = await loadFixture(deployLPWalletFixture);

      const LPWalletV2 = await ethers.getContractFactory("LPWallet");
      const lpWalletV2 = await upgrades.upgradeProxy(lpWallet.address, LPWalletV2);
      await lpWalletV2.deployed();
      expect(lpWalletV2.address).to.be.equal(lpWallet.address);
    });
  });
});