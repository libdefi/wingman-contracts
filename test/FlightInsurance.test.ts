import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";
import { BigNumberish, EventLog } from "ethers";

import { trustusRequest } from "../scripts/utils";
import { DFIToken, FlightDelayMarket } from "../typechain-types";

const TRUSTUS_REQUEST_ID = ethers.keccak256(
  ethers.toUtf8Bytes("createMarket(bool)")
);

interface MarketConfig {
  cutoffTime: number;
  closingTime: number;

  lpBid: string;
  minBid: string;
  maxBid: string;
  initP: number;
  fee: number;

  mode: number;

  oracle: string;
}

interface FlightInfo {
  flightName: string;
  departureDate: number;

  delay: number;
}

function createMarketConfig(oracle: string, mode: number, customConfig?: Partial<MarketConfig>) {
  const now = Math.ceil(Date.now()/1000);

  const departureDate = 20251231;
  const cutoffTime = now + 24 * 3600;
  const closingTime = cutoffTime + 2.5 * 3600;

  const dfiBid = ethers.parseEther("100");
  const userBid = ethers.parseEther("5");

  const config: MarketConfig = {
    mode,
    oracle,
    cutoffTime,
    closingTime,
    minBid: userBid.toString(),
    maxBid: (userBid * 10n).toString(), // 50
    lpBid: dfiBid.toString(),
    fee: 50, // 1% = 100
    initP: 200, // 1% = 100

    ...customConfig
  };

  const flightInfo: FlightInfo = {
    departureDate,
    flightName: "BA442",
    delay: 30,
  };

  const configArrValues = [
    config.cutoffTime,
    config.closingTime,

    config.lpBid,
    config.minBid, config.maxBid,
    config.initP, config.fee,
    config.mode, config.oracle,

    flightInfo.flightName,
    flightInfo.departureDate,
    flightInfo.delay
  ];

  const configArrTypes = [
    "uint64",
    "uint64",

    "uint256",
    "uint256", "uint256",
    "uint16", "uint16",
    "uint8", "address",

    "string",
    "uint64",
    "uint32"
  ];

  return { config, flightInfo, configArrValues, configArrTypes, userBid, dfiBid };
}

function ethToFloatStr(value: BigNumberish) {
  return parseFloat(ethers.formatEther(value)).toFixed(7);
}

describe("FlightInsurance", function () {
  async function deployFlightInsuranceFixture() {
    const [owner, anotherAccount, yetAnotherAccount, extraAccount] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const registryProxy = await upgrades.deployProxy(DFIRegistry, []);
    const registry = await ethers.getContractAt("DFIRegistry", registryProxy.target);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const tokenProxy = await upgrades.deployProxy(DFIToken, [registry.target]);
    const dfiToken = await ethers.getContractAt("DFIToken", tokenProxy.target);

    const LPWallet = await ethers.getContractFactory("LPWallet");
    const walletProxy = await upgrades.deployProxy(LPWallet, [registry.target]);
    const lpWallet = await ethers.getContractAt("LPWallet", walletProxy.target);

    const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
    const factory = await FlightDelayMarketFactory.deploy(registry.target);

    const MockFlightStatusOracle = await ethers.getContractFactory("MockFlightStatusOracle");
    const oracle = await MockFlightStatusOracle.deploy();

    await Promise.all([
      registryProxy.waitForDeployment(),
      tokenProxy.waitForDeployment(),
      walletProxy.waitForDeployment(),
      factory.deploymentTransaction()?.wait(),
      oracle.deploymentTransaction()?.wait()
    ]);

    const feeCollector = ethers.Wallet.createRandom();

    const FlightInsurance = await ethers.getContractFactory("FlightInsurance");

    const insuranceProxy = await upgrades.deployProxy(FlightInsurance, [registry.target]);
    await insuranceProxy.waitForDeployment();
    const insurance = await ethers.getContractAt("FlightInsurance", insuranceProxy.target);
    await insurance.setWallet(lpWallet.target);

    await owner.sendTransaction({
      to: lpWallet.target,
      value: ethers.parseEther("100")
    });

    await registry.setAddresses(
      [1, 2, 3, 4, 5, 100],
      [factory.target, dfiToken.target, lpWallet.target, insurance.target, oracle.target, feeCollector.address]
    );

    return { insurance, owner, anotherAccount, yetAnotherAccount, lpWallet, extraAccount, feeCollector, dfiToken, registry, oracle, factory };
  }

  async function createMarket(mode: number = 0, sponsored: boolean = false, customConfig?: Partial<MarketConfig>) {
    const deployFlightInsurance = await loadFixture(deployFlightInsuranceFixture);
    const { anotherAccount, yetAnotherAccount, insurance, oracle } = deployFlightInsurance;

    const oracleAddress = await oracle.getAddress();
    const marketConfig = createMarketConfig(oracleAddress, mode, customConfig);
    const { config, configArrTypes, configArrValues, flightInfo } = marketConfig;

    await insurance.setIsTrusted(yetAnotherAccount.address, true);

    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      configArrTypes,
      configArrValues
    );

    const deadline = Math.ceil(Date.now()/1000) + 60;
    const insuranceAddress = await insurance.getAddress();
    const packet = await trustusRequest(TRUSTUS_REQUEST_ID, yetAnotherAccount, insuranceAddress, payload, deadline);

    let createMarketTx; 
    
    if(sponsored) {
      await insurance.setSponsoredBetAmount(ethers.parseEther("5"));
      await yetAnotherAccount.sendTransaction({ to: insurance.target, value: ethers.parseEther("10") }); // 2x minBid
      createMarketTx = insurance.connect(anotherAccount).createMarketSponsored(true, packet);
    } else {
      createMarketTx = insurance.connect(anotherAccount)
        .createMarket(true, packet, { value: config.minBid });
    }

    const marketId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "uint64", "uint32"],
        [flightInfo.flightName, flightInfo.departureDate, flightInfo.delay]
      )
    );

    return { createMarketTx, packet, marketId, ...deployFlightInsurance, ...marketConfig };
  }

  async function createMarketFinal(mode: number = 0, sponsored: boolean = false) {
    const createMarketValues = await createMarket(mode, sponsored);
    const { createMarketTx, insurance, marketId } = createMarketValues;
    await createMarketTx;

    const marketAddress = await insurance.getMarket(marketId);
    const market = await ethers.getContractAt("FlightDelayMarket", marketAddress);

    return { market, ...createMarketValues };
  }

  describe("Deployment", function () {
    it("Should set the right settings", async function () {
      const { insurance, lpWallet } = await loadFixture(deployFlightInsuranceFixture);

      expect(await insurance.wallet()).to.be.equal(lpWallet.target);
    });

    it("Should set the correct owner", async function () {
      const { insurance, owner } = await loadFixture(deployFlightInsuranceFixture);

      expect(await insurance.owner()).to.equal(owner.address);
    });
  });

  describe("Validations", function () {
    it("Reverts on untrusted Trustus package", async function () {
      const { anotherAccount, yetAnotherAccount, insurance, oracle } = await loadFixture(deployFlightInsuranceFixture);
      const oracleAddress = await oracle.getAddress();
      const { config, configArrTypes, configArrValues } = createMarketConfig(oracleAddress, 0);

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        configArrTypes,
        configArrValues
      );

      const deadline = Math.ceil(Date.now()/1000) + 60;
      const insuranceAddress = await insurance.getAddress();
      const packet = await trustusRequest(TRUSTUS_REQUEST_ID, yetAnotherAccount, insuranceAddress, payload, deadline);

      const createMarket = insurance.connect(anotherAccount)
        .createMarket(true, packet, { value: config.minBid });

      await expect(createMarket)
        .to.be.revertedWithCustomError(
          insurance,
          "Trustus__InvalidPacket"
        );
    });

    it("Reverts if msg.value is less than minBid", async function () {
      const { market, anotherAccount, userBid } = await createMarketFinal();

      const participate = market.connect(anotherAccount)
        .participate(true, { value: userBid / 100n });

      await expect(participate)
        .to.be.revertedWith(
          "Value included is less than min-bid"
        );
    });

    it("Reverts if msg.value is more than maxBid in a single bind", async function () {
      const { market, anotherAccount, userBid } = await createMarketFinal();

      const participate = market.connect(anotherAccount)
        .participate(true, { value: userBid * 100n });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Not reverts if msg.value is equal to maxBid + fee in a single bind", async function () {
      const { market, yetAnotherAccount, extraAccount, config } = await createMarketFinal();

      const feeBase = 10000n;
      const amountPercentage = 10000n - BigInt(config.fee); // 9950 - 99.5% for main amount
      const amountWithFee = BigInt(config.maxBid) * feeBase / amountPercentage; // maxBid / 0.995
      const participate = market.connect(yetAnotherAccount)
        .participate(true, { value: amountWithFee});

      await expect(participate)
        .not.to.be.reverted;

      const slightlyMore = amountWithFee + ethers.parseEther("0.000000000000000001");
      const participate2 = market.connect(extraAccount)
        .participate(true, { value: slightlyMore});

      await expect(participate2)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Reverts if msg.value is more than maxBid in multiple bids", async function () {
      const { anotherAccount, market, userBid } = await createMarketFinal();

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 8n });

      const participate = market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Not reverts if msg.value is equal to maxBid + fee in multiple bids", async function () {
      const { market, yetAnotherAccount, extraAccount, config } = await createMarketFinal();

      const feeBase = 10000n;
      const amountPercentage = 10000n - BigInt(config.fee); // 9950 - 99.5% for main amount
      const amountWithFee = BigInt(config.maxBid) / 2n * feeBase / amountPercentage; // maxBid / 0.995
      const participate = market.connect(yetAnotherAccount)
        .participate(true, { value: amountWithFee});
      await expect(participate)
        .not.to.be.reverted;

      const participate2 = market.connect(yetAnotherAccount) // 2nd bid, same account - should be up to maxBid
        .participate(true, { value: amountWithFee});
      await expect(participate2)
        .not.to.be.reverted;

      const slightlyMore = amountWithFee + ethers.parseEther("0.000000000000000001");
      const participate3 = market.connect(extraAccount)
        .participate(true, { value: slightlyMore});

        await expect(participate3)
        .not.to.be.reverted;

      const participate4 = market.connect(extraAccount) // 2nd bid, same account - slightly more than maxBid
        .participate(true, { value: slightlyMore});

      await expect(participate4)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Reverts if msg.value is more than maxBid in both tokens total", async function () {
      const { market, anotherAccount, userBid } = await createMarketFinal();

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 5n });

      const participate = market.connect(anotherAccount)
        .participate(false, { value: userBid * 5n });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Reverts if cuttoff time is in the past", async function () {
      const { createMarketTx } = await createMarket(0, false, { cutoffTime: Math.floor((Date.now() / 1000) - 1000) });

      await expect(createMarketTx)
        .to.be.revertedWith("Cannot create closed market");
    });

    it("Reverts if market already exists", async function () {
      const { createMarketTx, insurance, config, anotherAccount, packet } = await createMarket(0);
      await createMarketTx;

      const createMarketAgain = insurance.connect(anotherAccount)
        .createMarket(true, packet, { value: config.minBid });

      await expect(createMarketAgain)
        .to.be.revertedWith("Market already exists");
    });

    it("Reverts if trusted is modified by non-owner", async function () {
      const { insurance, anotherAccount } = await loadFixture(deployFlightInsuranceFixture);

      const setTrusted = insurance.connect(anotherAccount)
        .setIsTrusted(anotherAccount.address, true);

      await expect(setTrusted)
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Reverts if wallet is modified by non-owner", async function () {
      const { insurance, anotherAccount } = await loadFixture(deployFlightInsuranceFixture);

      const setWallet = insurance.connect(anotherAccount)
        .setWallet(anotherAccount.address);

      await expect(setWallet)
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Reverts if trying to settle too early", async function () {
      const { market } = await createMarketFinal();

      const settle = market.trySettle();

      await expect(settle)
        .to.be.revertedWith("Market is not closed yet");
    });

    it("Reverts if trying to settle in wrong state", async function () {
      const { market, config } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);

      await market.trySettle();

      const settle = market.trySettle();

      await expect(settle)
        .to.be.revertedWith("Wrong market state");
    });

    it("Reverts if trying to record decision from non-oracle", async function () {
      const { market, anotherAccount, config } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);
      await market.trySettle();

      const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes1", "uint64"],
        [ethers.toUtf8Bytes("L"), 90]
      );

      const recordDecision = market.connect(anotherAccount)
        .recordDecision(payload);

      await expect(recordDecision)
        .to.be.revertedWith("Unauthorized sender");
    });
  });

  describe("Getters", function () {
    it("Returns correct product", async function () {
      const { insurance, market } = await createMarketFinal();

      expect(await market.product()).to.be.equal(insurance.target);
    });

    it("Returns correct marketId", async function () {
      const { market, marketId } = await createMarketFinal();

      expect(await market.marketId()).to.be.equal(marketId);
    });

    it("Returns correct creator", async function () {
      const { market, factory } = await createMarketFinal();

      expect(await market.createdBy()).to.be.equal(factory.target);
    });

    it("Returns correct token slots", async function () {
      const { market } = await createMarketFinal();

      expect(await market.tokenSlots()).to.be.equal(2);
    });

    it("Returns correct token ids", async function () {
      const { market } = await createMarketFinal();

      const [tokenIdYes, tokenIdNo] = await market.tokenIds();

      expect(tokenIdYes).to.be.equal(10);
      expect(tokenIdNo).to.be.equal(11);
    });

    it("Returns correct token balances", async function () {
      const { market } = await createMarketFinal();

      const [balanceYes, balanceNo] = await market.tokenBalances();

      expect(ethToFloatStr(balanceYes)).to.be.equal("10287.5500000");
      expect(ethToFloatStr(balanceNo)).to.be.equal("209.9500000");
    });

    it("Returns can be settled correctly", async function () {
      const { market, config } = await createMarketFinal();

      expect(await market.canBeSettled()).to.be.equal(false);

      await time.increaseTo(config.closingTime + 1);

      expect(await market.canBeSettled()).to.be.equal(true);
    });

    it("Returns correct predicted price ETH for Payout before market is settled", async function () {
      const { market, yetAnotherAccount, userBid, oracle, config } = await createMarketFinal();

      // Calculate potential payout for 10 ETH to YES
      const potetialPayout = await market.priceETHForPayout(userBid * 2n, yetAnotherAccount.address, true);

      await market.connect(yetAnotherAccount)
        .participate(true, { value: userBid * 2n }); // 10 ETH to YES
      const balanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(yetAnotherAccount)
        .claim();

      const userBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);

      expect(ethToFloatStr(userBalanceAfterSettle - balanceAfterBet).substring(0, 5))
        .to.be.equal(ethToFloatStr(potetialPayout).substring(0, 5));
    });

    it("Returns correct predicted price ETH for Payout before market is settled for new user (zero address)", async function () {
      const { market, yetAnotherAccount, userBid, oracle, config } = await createMarketFinal();

      // calculate potential payout for new account - user 0 address here (no wallet connected yet)
      const yetAnotherPotetialPayout = await market.priceETHForPayout(userBid * 2n, ethers.ZeroAddress, false);
      await market.connect(yetAnotherAccount)
        .participate(false, { value: userBid * 2n }); // 10 ETH to NO
      const yetAnotherBalanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);
      const tx = await market.trySettle();
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);
      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        0 * 60
      );

      await market.connect(yetAnotherAccount)
        .claim();
      const yetAnotherBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);
      // slice to 5 digits after comma to not fail on gas price difference
      expect(ethToFloatStr(yetAnotherBalanceAfterSettle - yetAnotherBalanceAfterBet).substring(0, 5))
        .to.be.equal(ethToFloatStr(yetAnotherPotetialPayout).substring(0, 5));
    });

    it("Returns correct predicted price ETH for Payout before market is settled for BUYER mode and >1 bets", async function () {
      const { market, anotherAccount, yetAnotherAccount, userBid, oracle, config } = await createMarketFinal(1); // Mode.BUYER

      // calculate potential payout for new account - we user 0 address here (no wallet connected yet)
      const yetAnotherPotetialPayout = await market.priceETHForPayout(userBid * 2n, ethers.ZeroAddress, true);
      await market.connect(yetAnotherAccount)
        .participate(true, { value: userBid * 2n }); // 10 ETH to NO
      const yetAnotherBalanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // Calculate potential payout for 5 ETH more to YES for another account
      // (should alread have 4.975 in ETH on market creation)
      const otherPotetialPayout = await market.priceETHForPayout(userBid, anotherAccount.address, true);

      await market.connect(anotherAccount)
        .participate(true, { value: userBid }); // 5 ETH to YES
      const anotherBalanceAfterBet = await ethers.provider.getBalance(anotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(anotherAccount)
        .claim();

      const anotherBalanceAfterSettle = await ethers.provider.getBalance(anotherAccount.address);
      expect(ethToFloatStr(anotherBalanceAfterSettle - anotherBalanceAfterBet).substring(0, 5))
        .to.be.equal(ethToFloatStr(otherPotetialPayout).substring(0, 5));

      await market.connect(yetAnotherAccount)
        .claim();
      const yetAnotherBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);
      // it should be slightly different because of another account claiming + gas, but still close
      expect(ethToFloatStr(yetAnotherBalanceAfterSettle - yetAnotherBalanceAfterBet ).substring(0, 5))
        .to.be.equal(ethToFloatStr(yetAnotherPotetialPayout).substring(0, 5));
    });
  });

  describe("Events", function () {
    it("Emits FlightDelayMarketCreated", async function () {
      const { createMarketTx, insurance, config, anotherAccount, flightInfo } = await createMarket();

      await expect(createMarketTx)
        .to.emit(insurance, "FlightDelayMarketCreated");

      const receipt = await (await createMarketTx).wait();
      const event = receipt?.logs?.find(e => (e instanceof EventLog) && e.eventName === "FlightDelayMarketCreated");
      assert(event, "Event not found");
      assert(event instanceof EventLog, "Event not found");
      const args = (event as EventLog).args;
      expect(args.uniqueId).to.be.equal(10);
      expect(args.creator).to.be.equal(anotherAccount.address);
    });

    it("Emits FlightdelayMarketParticipated", async function () {
      const { createMarketTx, marketId, insurance, config, anotherAccount } = await createMarket();

      const bid = BigInt(config.minBid);

      const capturedMinusFee = bid * (10000n - BigInt(config.fee)) / 10000n;

      // actual balance of YES tokens for AnotherAccount - acquired by 1st participation in market 
      // ** check other tests assertBalances 
      const balanceOfUserYes = "951993915217909025959"; 

      await expect(createMarketTx)
        .to.emit(insurance, "FlightDelayMarketParticipated")
        .withArgs(
          marketId,
          anotherAccount.address,
          capturedMinusFee,
          true,
          balanceOfUserYes,
          false // not sponsored participation
        );
    });

    it("Emits DecisionRendered", async function () {
      const { market, config, oracle } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      await expect(fulfillTx)
        .to.emit(market, "DecisionRendered")
        .withArgs(1);
    });

    it("Emits DecisionPostponed", async function () {
      const { market, config, oracle } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("A"),
        0
      );

      await expect(fulfillTx)
        .to.emit(market, "DecisionPostponed");
    });

    it("Emits LiquidityProvided", async function () {
      const { createMarketTx, market, lpWallet, config } = await createMarketFinal();

      await expect(createMarketTx)
        .to.emit(market, "LiquidityProvided")
        .withArgs(lpWallet.target, config.lpBid);
    });

    it("Emits ParticipatedInMarket", async function () {
      const { createMarketTx, market, anotherAccount, config } = await createMarketFinal();

      const bid = BigInt(config.minBid);

      const capturedMinusFee = bid * (10000n - BigInt(config.fee)) / 10000n;

      await expect(createMarketTx)
        .to.emit(market, "ParticipatedInMarket")
        .withArgs(
          anotherAccount.address,
          capturedMinusFee,
          true,
          false // not sponsored participation
        );
    });

    it("Emits BetWithdrawn", async function () {
      const { market, anotherAccount, config } = await createMarketFinal();

      const bid = BigInt(config.minBid);
      const amount = bid / 2n;

      const [expectedWithdrawal] = await market.priceETHForYesNo(amount, anotherAccount.address);

      const withdraw = market.connect(anotherAccount)
        .withdrawBet(amount, true);

      await expect(withdraw)
        .to.emit(market, "BetWithdrawn")
        .withArgs(
          anotherAccount.address,
          expectedWithdrawal,
          true
        );
    });

    it("Emits RewardWithdrawn", async function () {
      const { market, config, oracle, anotherAccount } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      // lp automatic withdraw
      await expect(fulfillTx)
        .to.emit(market, "RewardWithdrawn");

      // user manual withdraw
      const claim = market.connect(anotherAccount)
        .claim();

      await expect(claim)
        .to.emit(market, "RewardWithdrawn");
    });

    it("Emits FlightDelayMarketSponsored for sponsored creation", async function () {
      const { createMarketTx, insurance, anotherAccount } = await createMarket(0, true);

      await expect(createMarketTx)
        .to.emit(insurance, "FlightDelayMarketSponsored");

      const receipt = await (await createMarketTx).wait();
      const event = receipt?.logs?.find(e => (e instanceof EventLog) && e.eventName === "FlightDelayMarketCreated");
      assert(event, "Event not found");
      assert(event instanceof EventLog, "Event not found");
      const args = (event as EventLog).args;
      expect(args.uniqueId).to.be.equal(10);
      expect(args.creator).to.be.equal(anotherAccount.address);

      const sponsoredEvent = receipt?.logs?.find(e => (e instanceof EventLog) && e.eventName === "FlightDelayMarketSponsored");
      assert(sponsoredEvent, "Event not found");
      assert(sponsoredEvent instanceof EventLog, "Event not found");
      const sponsoredArgs = (sponsoredEvent as EventLog).args;
      expect(sponsoredArgs.marketId).to.be.equal(args.marketId);
      expect(sponsoredArgs.participant).to.be.equal(anotherAccount.address);
      expect(sponsoredArgs.value).to.be.equal(ethers.parseEther("5"));
      expect(sponsoredArgs.betYes).to.be.equal(true);
    });

    it("Emits FlightDelayMarketParticipated for sponsored participation", async function () {
      const { insurance, market, marketId, yetAnotherAccount } = await createMarketFinal(0, true);

      const participateSponsoredTx = insurance.connect(yetAnotherAccount).registerParticipantSponsored(market.target, false);
      await expect(participateSponsoredTx).to.emit(insurance, "FlightDelayMarketSponsored").withArgs(
        marketId,
        yetAnotherAccount.address,
        ethers.parseEther("5"),
        false
      );
      await expect(participateSponsoredTx)
        .to.emit(insurance, "FlightDelayMarketParticipated")
        .withArgs(
          marketId,
          yetAnotherAccount.address,
          "4975000000000000000",
          false,
          "9950000000000000000",
          true // sponsored participation
        );
    });
  });

  interface Balances {
    tokens?: Record<string, Record<number, string>>;
    wallets?: Record<string, string>;
    supplies?: Record<number, string>;
    prices?: Map<bigint, Record<"Y"|"N", string>>;
  }

  async function assertBalances(market: FlightDelayMarket, dfiToken: DFIToken, balances: Balances) {
    if (balances.tokens) {
      for (const address in balances.tokens) {
        const assertions = balances.tokens[address];
        for (const tokenId in assertions) {
          const expected = assertions[tokenId];
          const balance = await dfiToken.balanceOf(address, tokenId);
          const formatted = balance.toString() === "0" ? "0" : ethToFloatStr(balance);
          assert(formatted === expected, `${address} balance of ${tokenId}: ${formatted} != ${expected}`);
        }
      }
    }
    if (balances.wallets) {
      for (const address in balances.wallets) {
        const expected = balances.wallets[address];
        const balance = await ethers.provider.getBalance(address);
        const formatted = balance.toString() === "0" ? "0" : ethToFloatStr(balance);
        assert(formatted === expected, `${address} eth balance: ${formatted} != ${expected}`);
      }
    }
    if (balances.supplies) {
      for (const tokenId in balances.supplies) {
        const expected = balances.supplies[tokenId];
        const supply = await dfiToken.totalSupply(tokenId);
        const formatted = supply.toString() === "0" ? "0" : ethToFloatStr(supply);
        assert(formatted === expected, `${tokenId} supply: ${formatted} != ${expected}`);
      }
    }
    if (balances.prices) {
      for (const amount of balances.prices.keys()) {
        const expected = balances.prices.get(amount)!;
        const [amountOutYes, amountOutNo] = await market.priceETHToYesNo(amount);
        assert(ethToFloatStr(amountOutYes) === expected.Y, `Price of Y ${ethToFloatStr(amountOutYes)} != ${expected.Y}`);
        assert(ethToFloatStr(amountOutNo) === expected.N, `Price of N ${ethToFloatStr(amountOutNo)} != ${expected.N}`);
      }
    }
  }

  describe("Burn market flow", function () {
    it("Creates market correctly", async function () {
      const { insurance, marketId, flightInfo, anotherAccount, lpWallet, feeCollector, dfiToken, market } = await createMarketFinal();

      const [mId, mAddr] =
        await insurance.findMarket(flightInfo.flightName, flightInfo.departureDate, flightInfo.delay);
      expect(mId).to.be.equal(marketId);
      expect(mAddr).to.be.equal(market.target);

      const marketAddress = await insurance.getMarket(marketId);
      expect(marketAddress).to.be.equal(market.target);

      expect(await market.result()).to.be.equal(0);
      expect(await market.decisionState()).to.be.equal(0);
      expect(await market.tvl()).to.be.equal(ethers.parseEther("104.975"));
      expect(await market.finalBalance()).to.be.deep.equal([0, 0, 0]);

      await assertBalances(market, dfiToken, {
        tokens: {
          // user did bet on yes
          [anotherAccount.address]: {
            10: "951.9939152",
            11: "0"
          },
          // dfi balanced out
          [lpWallet.target as string]: {
            10: "9335.5560848",
            11: "209.9500000"
          },
        },
        wallets: {
          // dfi paid for init distribution
          [lpWallet.target as string]: "0",
          [feeCollector.address]: "0.0250000", // 5*0.005
          [market.target as string]: "104.9750000"
        },
        supplies: {
          10: "10287.5500000",
          11: "209.9500000"
        },
        prices: new Map([
          [ethers.parseEther("5"), {
            Y: "487.5500000",  // ~ 0.01020388
            N: "9.9500000" // ~ 0.5
          }]
        ])
      });

      // 9335.5560848 + 209.9500000 = 9545.5060848
      // 209.9500000 / 9545.5060848 = 0.02197802197
      const distribution = await market.currentDistribution();
      expect(distribution).to.be.equal(219);
    });

    it("Records participation correctly", async function() {
      const { anotherAccount, market, userBid, dfiToken, lpWallet, feeCollector } = await createMarketFinal();

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "951.9939152",
            11: "0"
          }
        }
      });

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          },
          [lpWallet.target as string]: {
            10: "8527.3004133",
            11: "229.8500000"
          },
        },
        wallets: {
          [feeCollector.address]: "0.0750000", // 5*0.005 + 10*0.005,
          [market.target as string]: "114.9250000"
        },
        supplies: {
          10: "11262.6500000",
          11: "229.8500000"
        },
        prices: new Map([
          [userBid, {
            Y: "487.5500000",  // ~ 0.010204,
            N: "9.9500000" // ~ 0.5
          }]
        ])
      });

      // 8527.3004133 + 229.8500000 = 8757.1504133
      // 229.8500000 / 8757.1504133 = 0.02622875816
      const distribution = await market.currentDistribution();
      expect(distribution).to.be.equal(262);
    });

    it("Records bet withdrawal correctly", async function() {
      const { market, anotherAccount, yetAnotherAccount, dfiToken, userBid, lpWallet, feeCollector } = await createMarketFinal();
      // anotherAccount should already have 4.975 in ETH and 9.95 YES tokens on market creation (see createMarketFinal)

      // Buy tokens YES for 10 ETH (- 5% fee)
      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          }
        }
      });

      let [userPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNo(userBid, anotherAccount.address);
      let [marketPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNoMarket(userBid);

      await expect(market.connect(anotherAccount)
        .withdrawBet(userBid, true))
        .to.changeEtherBalance(anotherAccount, userPricesYes);

      // we should choose the lower price to withdraw
      assert(marketPricesYes >= userPricesYes, "Expected the lowest price to be selected for withdrawal");

      const [,yetAnotherAccountNoBalance] = await market.connect(yetAnotherAccount).priceETHToYesNo(userBid * 10n);

      // Buy tokens NO for 50 ETH (- 5% fee) to drop the YES price, using yet another account
      market.connect(yetAnotherAccount)
        .participate(false, { value: userBid * 10n }); // 50

      const anotherAccountYesBalance = await dfiToken.balanceOf(anotherAccount.address, 10);

      [userPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNo(anotherAccountYesBalance, anotherAccount.address);
      [marketPricesYes, ] = await market.connect(anotherAccount).priceETHToYesNo(anotherAccountYesBalance);

      await expect(market.connect(anotherAccount)
        .withdrawBet(anotherAccountYesBalance, true))
        .to.changeEtherBalance(anotherAccount, userPricesYes);

      // we should choose the lower price to withdraw
      assert(marketPricesYes >= userPricesYes, "Expected the lowest price to be selected for withdrawal");

      const lpNoBalance = await dfiToken.balanceOf(lpWallet.target, 11);


      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "0",
            11: "0"
          },
          [yetAnotherAccount.address]: {
            10: "0",
            11: ethToFloatStr(yetAnotherAccountNoBalance)
          },
          [lpWallet.target as string]: {
            10: "13401.7930996",
            11: "146.2490866"
          },
        },
        wallets: {
          [feeCollector.address]: "0.3250000", // 5*0.005 + 10*0.005 + 50*0.005
          [market.target as string]: "149.7500000"
        },
        supplies: {
          10: "13401.7930996",
          11: ethToFloatStr(yetAnotherAccountNoBalance + lpNoBalance) // 99.5455641 + 152.7358861 = 252.2814502
        },
        prices: new Map([
          [userBid, {
            Y: "445.2348626",  // ~ 0.01020598
            N: "8.1650701" // ~ 0.668
          }]
        ])
      });
    });

    it("Withdraws everything correctly", async function() {
      const { market, yetAnotherAccount, userBid, dfiToken } = await createMarketFinal();

      await assertBalances(market, dfiToken, {
        tokens: {
          [yetAnotherAccount.address]: {
            10: "0",
            11: "0"
          }
        },
        prices: new Map([
          [userBid, {
            Y: "487.5500000",  // ~ 0.010204
            N: "9.9500000" // ~ 0.5
          }]
        ])
      });

      await market.connect(yetAnotherAccount)
        .participate(true, { value: userBid });

      await assertBalances(market, dfiToken, {
        tokens: {
          [yetAnotherAccount.address]: {
            10: "909.9637474",
            11: "0"
          }
        },
        prices: new Map([
          [userBid, {
            Y: "487.5500000",  // ~ 0.0111,
            N: "9.9500000" // ~ 0.4997
          }]
        ])
      });

      const balance = await dfiToken.balanceOf(yetAnotherAccount.address, 10);

      const [userPricesYes, ] = await market.connect(yetAnotherAccount).priceETHForYesNo(balance, yetAnotherAccount.address);
      const [marketPricesYes, ] = await market.connect(yetAnotherAccount).priceETHToYesNo(balance);

      await expect(market.connect(yetAnotherAccount)
        .withdrawBet(balance, true))
        .to.changeEtherBalance(yetAnotherAccount, userPricesYes);

      // we should choose the lower price to withdraw
      assert(marketPricesYes >= userPricesYes, "Expected the lowest price to be selected for withdrawal");

      await assertBalances(market, dfiToken, {
        tokens: {
          [yetAnotherAccount.address]: {
            10: "0",
            11: "0"
          }
        },
        prices: new Map([
          [userBid, {
            Y: "467.5308679",  // ~ 0.01117
            N: "10.4215528" // ~ 0.477
          }]
        ])
      });
    });

    const testResults = [
      { status: "L", statusBytes: "0x4c", delay: 45 },
      { status: "C", statusBytes: "0x43", delay: 0 },
    ];

    testResults.forEach(({ status, statusBytes, delay }) =>
      it(`Settles correctly with status=${status}`, async function() {
        const { anotherAccount, market, dfiToken, userBid, lpWallet, config, feeCollector, oracle } = await createMarketFinal();

        await market.connect(anotherAccount)
          .participate(true, { value: userBid * 2n }); // 10

        await market.connect(anotherAccount)
          .withdrawBet(userBid, true); // 5

        const userBalanceBefore = await ethers.provider.getBalance(anotherAccount.address);
        const lpBalanceBefore = await ethers.provider.getBalance(lpWallet.target);

        await assertBalances(market, dfiToken, {
          wallets: {
            [market.target as string]: "114.8977183",
          }
        });

        // advance time to cutoff
        await time.increaseTo(config.cutoffTime + 1);

        const tx = await market.trySettle();
        // extract request id from event
        const receipt = await tx.wait();
        const requestId = ethers.getBytes(receipt!.logs![0].data);

        const outcomeBefore = await market.outcome();
        expect(ethers.toUtf8String(outcomeBefore[0])).to.be.equal("\u0000");
        expect(outcomeBefore[1]).to.be.equal(0);

        await oracle.fulfillFlightStatus(
          requestId,
          ethers.toUtf8Bytes(status),
          delay
        );

        const outcomeAfter = await market.outcome();
        expect(outcomeAfter[0]).to.be.equal(statusBytes);
        expect(outcomeAfter[1]).to.be.equal(delay);

        await market.connect(anotherAccount)
          .claim();

        const userBalanceAfter = await ethers.provider.getBalance(anotherAccount.address);
        const dfiBalanceAfter = await ethers.provider.getBalance(lpWallet.target);

        await assertBalances(market, dfiToken, {
          tokens: {
            [anotherAccount.address]: {
              10: "0",
              11: "0"
            },
            [lpWallet.target as string]: {
              10: "0",
              11: "229.8500000"
            },
          },
          wallets: {
            [feeCollector.address]: "0.0750000"
          },
          supplies: {
            10: "0",
            11: "229.8500000"
          },
        });

        expect(ethToFloatStr(dfiBalanceAfter - lpBalanceBefore).substring(0, 5))
          .to.be.equal("87.03"); // strip gas fees

        expect(ethToFloatStr(userBalanceAfter - userBalanceBefore).substring(0, 5))
          .to.be.equal("27.86"); // strip gas fees

        const totalWithdrawn = userBalanceAfter - userBalanceBefore + dfiBalanceAfter - lpBalanceBefore;
        expect(ethToFloatStr(totalWithdrawn).substring(0, 7))
          .to.be.equal("114.897");

        // bank
        expect(await ethers.provider.getBalance(market.target))
          .to.be.equal(1); // 1 wei left
      })
    );
  });

  describe("Buyer market flow", function () {
    it("Creates market correctly", async function () {
      const { market, dfiToken, anotherAccount, lpWallet, feeCollector } = await createMarketFinal(1);

      await assertBalances(market, dfiToken, {
        tokens: {
          // user did bet on yes
          [anotherAccount.address]: {
            10: "951.9939152",
            11: "0"
          },
          // dfi balanced out
          [lpWallet.target as string]: {
            10: "9335.5560848",
            11: "209.9500000"
          },
        },
        wallets: {
          // dfi paid for init distribution
          [lpWallet.target as string]: "0",
          [feeCollector.address]: "0.0250000",
          [market.target as string]: "104.9750000"
        },
        supplies: {
          10: "10287.5500000",
          11: "209.9500000"
        },
        prices: new Map([
          [ethers.parseEther("5"), {
            Y: "487.5500000",  // ~ 0.0102,
            N: "9.9500000" // ~ 0.5
          }]
        ])
      });
    });

    it("Records participation correctly", async function() {
      const { anotherAccount, dfiToken, market, userBid, lpWallet, feeCollector } = await createMarketFinal(1);

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "951.9939152",
            11: "0"
          }
        }
      });

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          },
          [lpWallet.target as string]: {
            10: "8527.3004133",
            11: "229.8500000"
          },
        },
        supplies: {
          10: "11262.6500000",
          11: "229.8500000"
        },
        wallets: {
          [feeCollector.address]: "0.0750000",
          [market.target as string]: "114.9250000"
        },
        prices: new Map([
          [ethers.parseEther("5"), {
            Y: "487.5500000",  // ~ 0.0102
            N: "9.9500000" // ~ 0.5025
          }]
        ])
      });
    });

    it("Records bet withdrawal correctly", async function() {
      const { anotherAccount, market, dfiToken, userBid, lpWallet, feeCollector } = await createMarketFinal(1);
      // anotherAccount should already have 4.975 in ETH and 9.95 YES tokens on market creation (see createMarketFinal)

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          }
        }
      });

      let [userPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNo(userBid, anotherAccount.address);
      let [marketPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNoMarket(userBid);

      await expect(market.connect(anotherAccount)
        .withdrawBet(userBid, true))
        .to.changeEtherBalance(anotherAccount, userPricesYes); // 5

      // we should choose the lower price to withdraw
      assert(marketPricesYes >= userPricesYes, "Expected the lowest price to be selected for withdrawal");

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2730.3495867",
            11: "0"
          },
          [lpWallet.target as string]: {
            10: "8527.3004133",
            11: "229.8500000"
          },
        },
        wallets: {
          [feeCollector.address]: "0.0750000",
          [market.target as string]: "114.8977183"
        },
        supplies: {
          10: "11257.6500000",
          11: "229.8500000"
        },
        prices: new Map([
          [ethers.parseEther("5"), {
            Y: "487.4492686", // ~ 0.0102
            N: "9.9523626" // ~ 0.5
          }]
        ])
      });
    });

    it("Settles correctly", async function() {
      const { insurance, anotherAccount, config, market, oracle, dfiToken, userBid, lpWallet, feeCollector } = await createMarketFinal(1);

      await market.connect(anotherAccount)
        .participate(true, { value: userBid * 2n }); // 10

      await market.connect(anotherAccount)
        .withdrawBet(userBid, true); // 5

      const userBalanceBefore = await ethers.provider.getBalance(anotherAccount.address);
      const lpBalanceBefore = await ethers.provider.getBalance(lpWallet.target);

      await assertBalances(market, dfiToken, {
        wallets: {
          [market.target as string]: "114.8977183"
        }
      });

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(anotherAccount)
        .claim();

      const userBalanceAfter = await ethers.provider.getBalance(anotherAccount.address);
      const lpBalanceAfter = await ethers.provider.getBalance(lpWallet.target);

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "0",
            11: "0"
          },
          [lpWallet.target as string]: {
            10: "0",
            11: "229.8500000"
          },
        },
        wallets: {
          [feeCollector.address]: "0.0750000"
        },
        supplies: {
          10: "0",
          11: "229.8500000"
        },
      });

      expect(ethToFloatStr(lpBalanceAfter - lpBalanceBefore).substring(0, 5))
        .to.be.equal("87.03"); // strip gas fees

      expect(ethToFloatStr(userBalanceAfter - userBalanceBefore).substring(0, 5))
        .to.be.equal("27.86"); // strip gas fees

      const totalWithdrawn = userBalanceAfter - userBalanceBefore + lpBalanceAfter - lpBalanceBefore;
      expect(ethToFloatStr(totalWithdrawn).substring(0, 7))
        .to.be.equal("114.897");

      // bank
      expect(await ethers.provider.getBalance(market.target))
        .to.be.equal(1); // 1 wei
    });
  });

  describe("Sponsor flow", function () {
    it("Should top-up and withdraw insurance contract", async function () {
      const { insurance, anotherAccount } = await createMarketFinal();

      const balanceBefore = await ethers.provider.getBalance(insurance.target);
      await anotherAccount.sendTransaction({ to: insurance.target, value: ethers.parseEther("1") });
      const balanceAfter = await ethers.provider.getBalance(insurance.target);
      expect(balanceAfter - balanceBefore).to.be.equal(ethers.parseEther("1"));

      const accountBalance = await ethers.provider.getBalance(anotherAccount.address);
      await insurance.withdraw(anotherAccount.address);
      expect(await ethers.provider.getBalance(insurance.target)).to.be.equal(0);
      const accountBalanceAfter = await ethers.provider.getBalance(anotherAccount.address);
      expect(accountBalanceAfter - accountBalance).to.be.equal(ethers.parseEther("1"));
    });

    it("Should initialize variables, setSponsoredBetAmount", async function () {
      const { insurance, anotherAccount } = await createMarketFinal();

      expect(await insurance.sponsoredBetAmount()).to.be.equal(ethers.parseEther("0.01"));

      await insurance.setSponsoredBetAmount(ethers.parseEther("2"));

      expect(await insurance.sponsoredBetAmount()).to.be.equal(ethers.parseEther("2"));

      const anotherChange = insurance.connect(anotherAccount).setSponsoredBetAmount(ethers.parseEther("3"));

      expect(anotherChange).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should calculate sponsorAvailable properly", async function () {
      const {insurance, market, yetAnotherAccount, extraAccount} = await createMarketFinal();

      expect(await insurance.sponsorAvailable(ethers.ZeroAddress)).to.be.equal(false);

      await yetAnotherAccount.sendTransaction({ to: insurance.target, value: ethers.parseEther("10") }); // 5 to sponsor
      await insurance.setSponsoredBetAmount(ethers.parseEther("5"));

      expect(await insurance.sponsorAvailable(ethers.ZeroAddress)).to.be.equal(true);

      await insurance.setSponsoredBetAmount(0n);

      expect(await insurance.sponsorAvailable(ethers.ZeroAddress)).to.be.equal(false);

      await insurance.setSponsoredBetAmount(ethers.parseEther("5"));

      expect(await insurance.sponsorAvailable(yetAnotherAccount.address)).to.be.equal(true);

      const sponsoredTrans = insurance.connect(yetAnotherAccount).registerParticipantSponsored(market.target, true); // send 5 eth on behalf of yetAnotherAccount
      
      await expect(sponsoredTrans).not.to.be.reverted;

      expect(await insurance.sponsorAvailable(yetAnotherAccount.address)).to.be.equal(false);
      expect(await insurance.connect(extraAccount).sponsorAvailable(ethers.ZeroAddress)).to.be.equal(true);
    });

    it("Should create market with sponsored participation", async function () {
      const { insurance, market, anotherAccount, oracle, config } = await createMarketFinal(0, true); // sponsored creation + participation  

      const insuranceBalance = await ethers.provider.getBalance(insurance.target);
      expect(insuranceBalance).to.be.equal(ethers.parseEther("5")); // first transferred 10 eth and minus 5 eth for sponsored participation
      expect(await insurance.participant(anotherAccount.address)).to.be.equal(market.target);
      
      const balanceAfterBet = await ethers.provider.getBalance(anotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(anotherAccount)
        .claim();

      const userBalanceAfterSettle = await ethers.provider.getBalance(anotherAccount.address);

      expect(ethToFloatStr(userBalanceAfterSettle - balanceAfterBet).substring(0, 5))
        .to.be.equal("9.714"); // another acc bet YES 5 eth, so it should get 9.714 eth back
    });

    it("Shoukd registerParticipantSponsored correctly", async function () {
      const { insurance, market, yetAnotherAccount, oracle, config } = await createMarketFinal(0, true); // sponsored creation + participation

      await insurance.setSponsoredBetAmount(ethers.parseEther("0"));
      await expect(insurance.connect(yetAnotherAccount)
      .registerParticipantSponsored(market.target, false))
      .to.be.revertedWith("FlightDelayInsurance: Sponsored bet amount is 0");
      await insurance.setSponsoredBetAmount(ethers.parseEther("5"));

      const balanceBeforeBet = await ethers.provider.getBalance(yetAnotherAccount.address);
      await insurance.connect(yetAnotherAccount).registerParticipantSponsored(market.target, false); // send 5 eth on behalf of yetAnotherAccount
      const balanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);
      expect(ethToFloatStr(balanceBeforeBet).substring(0, 5)).to.be.equal(ethToFloatStr(balanceAfterBet).substring(0, 5)); // minus gas (will be relayed)

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.getBytes(receipt!.logs![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.toUtf8Bytes("L"),
        0 * 60
      );

      await market.connect(yetAnotherAccount)
        .claim();

      const userBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);

      expect(ethToFloatStr(userBalanceAfterSettle - balanceAfterBet).substring(0, 5))
        .to.be.equal("5.222"); // yetanother acc bet NO 5 eth, so it should get 5.222 eth back
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade LPWallet directly", async function () {
      const { insurance } = await loadFixture(deployFlightInsuranceFixture);

      const FlightInsuranceV2 = await ethers.getContractFactory("FlightInsurance");
      const insuranceV2 = await upgrades.upgradeProxy(insurance.target, FlightInsuranceV2);
      await insuranceV2.waitForDeployment();
      expect(insuranceV2.target).to.be.equal(insurance.target);
    });
  });
});
