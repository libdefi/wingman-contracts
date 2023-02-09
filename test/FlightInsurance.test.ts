import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect, assert } from "chai";
import { ethers, upgrades } from "hardhat";
import { BigNumberish, BigNumber } from "ethers";

import { trustusRequest } from "../scripts/utils";
import { DFIToken, FlightDelayMarket, FlightInsurance } from "../typechain-types";

const TRUSTUS_REQUEST_ID = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("createMarket(bool)")
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

  const dfiBid = ethers.utils.parseEther("100");
  const userBid = ethers.utils.parseEther("5");

  const config: MarketConfig = {
    mode,
    oracle,
    cutoffTime,
    closingTime,
    minBid: userBid.toString(),
    maxBid: userBid.mul(10).toString(), // 50
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
  return parseFloat(ethers.utils.formatEther(value)).toFixed(7);
}

describe("FlightInsurance", function () {
  async function deployFlightInsuranceFixture() {
    const [owner, anotherAccount, yetAnotherAccount, extraAccount] = await ethers.getSigners();

    const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
    const registry = await upgrades.deployProxy(DFIRegistry, []);

    const DFIToken = await ethers.getContractFactory("DFIToken");
    const dfiToken = await upgrades.deployProxy(DFIToken, [registry.address]) as DFIToken;

    const LPWallet = await ethers.getContractFactory("LPWallet");
    const lpWallet = await upgrades.deployProxy(LPWallet, [registry.address]);

    const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
    const factory = await FlightDelayMarketFactory.deploy(registry.address);

    const MockFlightStatusOracle = await ethers.getContractFactory("MockFlightStatusOracle");
    const oracle = await MockFlightStatusOracle.deploy();

    await Promise.all([
      registry.deployed(),
      dfiToken.deployed(),
      lpWallet.deployed(),
      factory.deployed(),
      oracle.deployed()
    ]);

    const feeCollector = ethers.Wallet.createRandom();

    const FlightInsurance = await ethers.getContractFactory("FlightInsurance");

    const insurance = await upgrades.deployProxy(FlightInsurance, [registry.address]) as FlightInsurance;
    await insurance.deployed();
    await insurance.setWallet(lpWallet.address);

    await owner.sendTransaction({
      to: lpWallet.address,
      value: ethers.utils.parseEther("100")
    });

    await registry.setAddresses(
      [1, 2, 3, 4, 5, 100],
      [factory.address, dfiToken.address, lpWallet.address, insurance.address, oracle.address, feeCollector.address]
    );

    return { insurance, owner, anotherAccount, yetAnotherAccount, lpWallet, extraAccount, feeCollector, dfiToken, registry, oracle, factory };
  }

  async function createMarket(mode: number = 0, customConfig?: Partial<MarketConfig>) {
    const deployFlightInsurance = await loadFixture(deployFlightInsuranceFixture);
    const { anotherAccount, yetAnotherAccount, insurance, oracle } = deployFlightInsurance;

    const marketConfig = createMarketConfig(oracle.address, mode, customConfig);
    const { config, configArrTypes, configArrValues, flightInfo } = marketConfig;

    await insurance.setIsTrusted(yetAnotherAccount.address, true);

    const payload = ethers.utils.defaultAbiCoder.encode(
      configArrTypes,
      configArrValues
    );

    const deadline = Math.ceil(Date.now()/1000) + 60;
    const packet = await trustusRequest(TRUSTUS_REQUEST_ID, yetAnotherAccount, insurance.address, payload, deadline);

    const createMarketTx = insurance.connect(anotherAccount)
      .createMarket(true, packet, { value: config.minBid });

    const marketId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["string", "uint64", "uint32"],
        [flightInfo.flightName, flightInfo.departureDate, flightInfo.delay]
      )
    );

    return { createMarketTx, packet, marketId, ...deployFlightInsurance, ...marketConfig };
  }

  async function createMarketFinal(mode: number = 0) {
    const createMarketValues = await createMarket(mode);
    const { createMarketTx, insurance, marketId } = createMarketValues;
    await createMarketTx;

    const marketAddress = await insurance.getMarket(marketId);
    const market = await ethers.getContractAt("FlightDelayMarket", marketAddress);

    return { market, ...createMarketValues };
  }

  describe("Deployment", function () {
    it("Should set the right settings", async function () {
      const { insurance, lpWallet } = await loadFixture(deployFlightInsuranceFixture);

      expect(await insurance.wallet()).to.be.equal(lpWallet.address);
    });

    it("Should set the correct owner", async function () {
      const { insurance, owner } = await loadFixture(deployFlightInsuranceFixture);

      expect(await insurance.owner()).to.equal(owner.address);
    });
  });

  describe("Validations", function () {
    it("Reverts on untrusted Trustus package", async function () {
      const { anotherAccount, yetAnotherAccount, insurance, oracle } = await loadFixture(deployFlightInsuranceFixture);
      const { config, configArrTypes, configArrValues } = createMarketConfig(oracle.address, 0);

      const payload = ethers.utils.defaultAbiCoder.encode(
        configArrTypes,
        configArrValues
      );

      const deadline = Math.ceil(Date.now()/1000) + 60;
      const packet = await trustusRequest(TRUSTUS_REQUEST_ID, yetAnotherAccount, insurance.address, payload, deadline);

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
        .participate(true, { value: userBid.div(100) });

      await expect(participate)
        .to.be.revertedWith(
          "Value included is less than min-bid"
        );
    });

    it("Reverts if msg.value is more than maxBid in a single bind", async function () {
      const { market, anotherAccount, userBid } = await createMarketFinal();

      const participate = market.connect(anotherAccount)
        .participate(true, { value: userBid.mul(100) });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Not reverts if msg.value is equal to maxBid + fee in a single bind", async function () {
      const { market, yetAnotherAccount, extraAccount, config } = await createMarketFinal();

      const feeBase = 10000; 
      const amountPercentage = 10000 - config.fee; // 9950 - 99.5% for main amount
      const amountWithFee = BigNumber.from(config.maxBid).mul(feeBase).div(amountPercentage); // maxBid / 0.995
      const participate = market.connect(yetAnotherAccount)
        .participate(true, { value: amountWithFee});
      
      await expect(participate)
        .not.to.be.reverted;  

      const slightlyMore = amountWithFee.add(ethers.utils.parseEther("0.000000000000000001"));
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
        .participate(true, { value: userBid.mul(8) });

      const participate = market.connect(anotherAccount)
        .participate(true, { value: userBid.mul(2) });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Not reverts if msg.value is equal to maxBid + fee in multiple bids", async function () {
      const { market, yetAnotherAccount, extraAccount, config } = await createMarketFinal();

      const feeBase = 10000; 
      const amountPercentage = 10000 - config.fee; // 9950 - 99.5% for main amount
      const amountWithFee = BigNumber.from(config.maxBid).div(2).mul(feeBase).div(amountPercentage); // maxBid / 0.995
      const participate = market.connect(yetAnotherAccount)
        .participate(true, { value: amountWithFee});
      await expect(participate)
        .not.to.be.reverted;  

      const participate2 = market.connect(yetAnotherAccount) // 2nd bid, same account - should be up to maxBid
        .participate(true, { value: amountWithFee});
      await expect(participate2)
        .not.to.be.reverted;

      const slightlyMore = amountWithFee.add(ethers.utils.parseEther("0.000000000000000001"));
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
        .participate(true, { value: userBid.mul(5) });

      const participate = market.connect(anotherAccount)
        .participate(false, { value: userBid.mul(5) });

      await expect(participate)
        .to.be.revertedWith(
          "Exceeded max bid"
        );
    });

    it("Reverts if cuttoff time is in the past", async function () {
      const { createMarketTx } = await createMarket(0, { cutoffTime: Math.floor((Date.now() / 1000) - 1000) });

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

      const payload = ethers.utils.defaultAbiCoder.encode(
        ["bytes1", "uint64"],
        [ethers.utils.toUtf8Bytes("L"), 90]
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

      expect(await market.product()).to.be.equal(insurance.address);
    });

    it("Returns correct marketId", async function () {
      const { market, marketId } = await createMarketFinal();

      expect(await market.marketId()).to.be.equal(marketId);
    });

    it("Returns correct creator", async function () {
      const { market, factory } = await createMarketFinal();

      expect(await market.createdBy()).to.be.equal(factory.address);
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
      const { market, yetAnotherAccount, userBid, dfiToken, oracle, config } = await createMarketFinal();

      // Calculate potential payout for 10 ETH to YES
      const potetialPayout = await market.priceETHForPayout(userBid.mul(2), yetAnotherAccount.address, true);

      await market.connect(yetAnotherAccount)
        .participate(true, { value: userBid.mul(2) }); // 10 ETH to YES
      const balanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(yetAnotherAccount)
        .claim();

      const userBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);

      expect(ethToFloatStr(userBalanceAfterSettle.sub(balanceAfterBet)).substring(0, 5))
        .to.be.equal(ethToFloatStr(potetialPayout).substring(0, 5));
    });

    it("Returns correct predicted price ETH for Payout before market is settled for new user (zero address)", async function () {
      const { market, yetAnotherAccount, userBid, dfiToken, oracle, config } = await createMarketFinal();

      // calculate potential payout for new account - user 0 address here (no wallet connected yet)
      const yetAnotherPotetialPayout = await market.priceETHForPayout(userBid.mul(2), ethers.constants.AddressZero, false);
      await market.connect(yetAnotherAccount)
        .participate(false, { value: userBid.mul(2) }); // 10 ETH to NO
      const yetAnotherBalanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);
      const tx = await market.trySettle();
      const receipt = await tx.wait();
      const requestId = ethers.utils.arrayify(receipt.events![0].data);
      await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
        0 * 60
      );

      await market.connect(yetAnotherAccount)
        .claim();
      const yetAnotherBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);
      // slice to 5 digits after comma to not fail on gas price difference
      expect(ethToFloatStr(yetAnotherBalanceAfterSettle.sub(yetAnotherBalanceAfterBet)).substring(0, 5))
        .to.be.equal(ethToFloatStr(yetAnotherPotetialPayout).substring(0, 5));
    });

    it("Returns correct predicted price ETH for Payout before market is settled for BUYER mode and >1 bets", async function () {
      const { market, anotherAccount, yetAnotherAccount, userBid, dfiToken, oracle, config } = await createMarketFinal(1); // Mode.BUYER

      // calculate potential payout for new account - we user 0 address here (no wallet connected yet)
      const yetAnotherPotetialPayout = await market.priceETHForPayout(userBid.mul(2), ethers.constants.AddressZero, true);
      await market.connect(yetAnotherAccount)
        .participate(true, { value: userBid.mul(2) }); // 10 ETH to NO
      const yetAnotherBalanceAfterBet = await ethers.provider.getBalance(yetAnotherAccount.address);

      // Calculate potential payout for 5 ETH more to YES for another account
      // (should alread have 4.975 in ETH on market creation)
      const otherPotetialPayout = await market.priceETHForPayout(userBid.mul(1), anotherAccount.address, true);

      await market.connect(anotherAccount)
        .participate(true, { value: userBid.mul(1) }); // 5 ETH to YES
      const anotherBalanceAfterBet = await ethers.provider.getBalance(anotherAccount.address);

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(anotherAccount)
        .claim();

      const anotherBalanceAfterSettle = await ethers.provider.getBalance(anotherAccount.address);
      expect(ethToFloatStr(anotherBalanceAfterSettle.sub(anotherBalanceAfterBet)).substring(0, 5))
        .to.be.equal(ethToFloatStr(otherPotetialPayout).substring(0, 5));
        
      await market.connect(yetAnotherAccount)
        .claim();
      const yetAnotherBalanceAfterSettle = await ethers.provider.getBalance(yetAnotherAccount.address);
      // it should be slightly different because of another account claiming + gas, but still close
      expect(ethToFloatStr(yetAnotherBalanceAfterSettle.sub(yetAnotherBalanceAfterBet)).substring(0, 5))
        .to.be.equal(ethToFloatStr(yetAnotherPotetialPayout).substring(0, 5));
    });
  });

  describe("Events", function () {
    it("Emits FlightDelayMarketCreated", async function () {
      const { createMarketTx, insurance, config, anotherAccount, flightInfo } = await createMarket();

      await expect(createMarketTx)
        .to.emit(insurance, "FlightDelayMarketCreated");

      const receipt = await (await createMarketTx).wait();
      const event = receipt.events?.find(e => e.event === "FlightDelayMarketCreated");
      assert(event, "Event not found");
      const args = event!.args!;
      expect(args.uniqueId).to.be.equal(10);
      expect(args.creator).to.be.equal(anotherAccount.address);
    });

    it("Emits DecisionRendered", async function () {
      const { market, config, oracle } = await createMarketFinal();

      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
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
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("A"),
        0
      );

      await expect(fulfillTx)
        .to.emit(market, "DecisionPostponed");
    });

    it("Emits LiquidityProvided", async function () {
      const { createMarketTx, market, lpWallet, config } = await createMarketFinal();

      await expect(createMarketTx)
        .to.emit(market, "LiquidityProvided")
        .withArgs(lpWallet.address, config.lpBid);
    });

    it("Emits ParticipatedInMarket", async function () {
      const { createMarketTx, market, anotherAccount, config } = await createMarketFinal();

      const bid = BigNumber.from(config.minBid);

      const capturedMinusFee = bid
        .mul(10000 - config.fee)
        .div(10000);

      await expect(createMarketTx)
        .to.emit(market, "ParticipatedInMarket")
        .withArgs(
          anotherAccount.address,
          capturedMinusFee,
          true
        );
    });

    it("Emits BetWithdrawn", async function () {
      const { market, anotherAccount, config } = await createMarketFinal();

      const bid = BigNumber.from(config.minBid);
      const amount = bid.div(2);

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
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      const fulfillTx = await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
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
  });

  interface Balances {
    tokens?: Record<string, Record<number, string>>;
    wallets?: Record<string, string>;
    supplies?: Record<number, string>;
    prices?: Map<BigNumber, Record<"Y"|"N", string>>;
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
      expect(mAddr).to.be.equal(market.address);

      const marketAddress = await insurance.getMarket(marketId);
      expect(marketAddress).to.be.equal(market.address);

      expect(await market.result()).to.be.equal(0);
      expect(await market.decisionState()).to.be.equal(0);
      expect(await market.tvl()).to.be.equal(ethers.utils.parseEther("104.975"));
      expect(await market.finalBalance()).to.be.deep.equal([0, 0, 0]);

      await assertBalances(market, dfiToken, {
        tokens: {
          // user did bet on yes
          [anotherAccount.address]: {
            10: "951.9939152",
            11: "0"
          },
          // dfi balanced out
          [lpWallet.address]: {
            10: "9335.5560848",
            11: "209.9500000"
          },
        },
        wallets: {
          // dfi paid for init distribution
          [lpWallet.address]: "0",
          [feeCollector.address]: "0.0250000", // 5*0.005
          [market.address]: "104.9750000"
        },
        supplies: {
          10: "10287.5500000",
          11: "209.9500000"
        },
        prices: new Map([
          [ethers.utils.parseEther("5"), {
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
        .participate(true, { value: userBid.mul(2) }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          },
          [lpWallet.address]: {
            10: "8527.3004133",
            11: "229.8500000"
          },
        },
        wallets: {
          [feeCollector.address]: "0.0750000", // 5*0.005 + 10*0.005,
          [market.address]: "114.9250000"
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
        .participate(true, { value: userBid.mul(2) }); // 10

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
      assert(marketPricesYes.gte(userPricesYes), "Expected the lowest price to be selected for withdrawal");

      const [,yetAnotherAccountNoBalance] = await market.connect(yetAnotherAccount).priceETHToYesNo(userBid.mul(10));

      // Buy tokens NO for 50 ETH (- 5% fee) to drop the YES price, using yet another account
      market.connect(yetAnotherAccount)
        .participate(false, { value: userBid.mul(10) }); // 50

      const anotherAccountYesBalance = await dfiToken.balanceOf(anotherAccount.address, 10);

      [userPricesYes, ] = await market.connect(anotherAccount).priceETHForYesNo(anotherAccountYesBalance, anotherAccount.address);
      [marketPricesYes, ] = await market.connect(anotherAccount).priceETHToYesNo(anotherAccountYesBalance);

      await expect(market.connect(anotherAccount)
        .withdrawBet(anotherAccountYesBalance, true))
        .to.changeEtherBalance(anotherAccount, userPricesYes);

      // we should choose the lower price to withdraw
      assert(marketPricesYes.gte(userPricesYes), "Expected the lowest price to be selected for withdrawal");

      const lpNoBalance = await dfiToken.balanceOf(lpWallet.address, 11);


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
          [lpWallet.address]: {
            10: "13401.7930996",
            11: "146.2490866"
          },
        },
        wallets: {
          [feeCollector.address]: "0.3250000", // 5*0.005 + 10*0.005 + 50*0.005
          [market.address]: "149.7500000"
        },
        supplies: {
          10: "13401.7930996",
          11: ethToFloatStr(yetAnotherAccountNoBalance.add(lpNoBalance)) // 99.5455641 + 152.7358861 = 252.2814502
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
      assert(marketPricesYes.gte(userPricesYes), "Expected the lowest price to be selected for withdrawal");

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
          .participate(true, { value: userBid.mul(2) }); // 10

        await market.connect(anotherAccount)
          .withdrawBet(userBid, true); // 5

        const userBalanceBefore = await ethers.provider.getBalance(anotherAccount.address);
        const lpBalanceBefore = await ethers.provider.getBalance(lpWallet.address);

        await assertBalances(market, dfiToken, {
          wallets: {
            [market.address]: "114.8977183",
          }
        });

        // advance time to cutoff
        await time.increaseTo(config.cutoffTime + 1);

        const tx = await market.trySettle();
        // extract request id from event
        const receipt = await tx.wait();
        const requestId = ethers.utils.arrayify(receipt.events![0].data);

        const outcomeBefore = await market.outcome();
        expect(ethers.utils.toUtf8String(outcomeBefore[0])).to.be.equal("\u0000");
        expect(outcomeBefore[1]).to.be.equal(0);

        await oracle.fulfillFlightStatus(
          requestId,
          ethers.utils.toUtf8Bytes(status),
          delay
        );

        const outcomeAfter = await market.outcome();
        expect(outcomeAfter[0]).to.be.equal(statusBytes);
        expect(outcomeAfter[1]).to.be.equal(delay);

        await market.connect(anotherAccount)
          .claim();

        const userBalanceAfter = await ethers.provider.getBalance(anotherAccount.address);
        const dfiBalanceAfter = await ethers.provider.getBalance(lpWallet.address);

        await assertBalances(market, dfiToken, {
          tokens: {
            [anotherAccount.address]: {
              10: "0",
              11: "0"
            },
            [lpWallet.address]: {
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

        expect(ethToFloatStr(dfiBalanceAfter.sub(lpBalanceBefore)).substring(0, 5))
          .to.be.equal("87.03"); // strip gas fees

        expect(ethToFloatStr(userBalanceAfter.sub(userBalanceBefore)).substring(0, 5))
          .to.be.equal("27.86"); // strip gas fees

        const totalWithdrawn = userBalanceAfter.sub(userBalanceBefore)
          .add(dfiBalanceAfter.sub(lpBalanceBefore));
        expect(ethToFloatStr(totalWithdrawn).substring(0, 7))
          .to.be.equal("114.897");

        // bank
        expect(await ethers.provider.getBalance(market.address))
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
          [lpWallet.address]: {
            10: "9335.5560848",
            11: "209.9500000"
          },
        },
        wallets: {
          // dfi paid for init distribution
          [lpWallet.address]: "0",
          [feeCollector.address]: "0.0250000",
          [market.address]: "104.9750000"
        },
        supplies: {
          10: "10287.5500000",
          11: "209.9500000"
        },
        prices: new Map([
          [ethers.utils.parseEther("5"), {
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
        .participate(true, { value: userBid.mul(2) }); // 10

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2735.3495867",
            11: "0"
          },
          [lpWallet.address]: {
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
          [market.address]: "114.9250000"
        },
        prices: new Map([
          [ethers.utils.parseEther("5"), {
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
        .participate(true, { value: userBid.mul(2) }); // 10

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
      assert(marketPricesYes.gte(userPricesYes), "Expected the lowest price to be selected for withdrawal");

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "2730.3495867",
            11: "0"
          },
          [lpWallet.address]: {
            10: "8527.3004133",
            11: "229.8500000"
          },
        },
        wallets: {
          [feeCollector.address]: "0.0750000",
          [market.address]: "114.8977183"
        },
        supplies: {
          10: "11257.6500000",
          11: "229.8500000"
        },
        prices: new Map([
          [ethers.utils.parseEther("5"), {
            Y: "487.4492686", // ~ 0.0102
            N: "9.9523626" // ~ 0.5
          }]
        ])
      });
    });

    it("Settles correctly", async function() {
      const { insurance, anotherAccount, config, market, oracle, dfiToken, userBid, lpWallet, feeCollector } = await createMarketFinal(1);

      await market.connect(anotherAccount)
        .participate(true, { value: userBid.mul(2) }); // 10

      await market.connect(anotherAccount)
        .withdrawBet(userBid, true); // 5

      const userBalanceBefore = await ethers.provider.getBalance(anotherAccount.address);
      const lpBalanceBefore = await ethers.provider.getBalance(lpWallet.address);

      await assertBalances(market, dfiToken, {
        wallets: {
          [market.address]: "114.8977183"
        }
      });

      // advance time to cutoff
      await time.increaseTo(config.cutoffTime + 1);

      const tx = await market.trySettle();
      // extract request id from event
      const receipt = await tx.wait();
      const requestId = ethers.utils.arrayify(receipt.events![0].data);

      await oracle.fulfillFlightStatus(
        requestId,
        ethers.utils.toUtf8Bytes("L"),
        45 * 60
      );

      await market.connect(anotherAccount)
        .claim();

      const userBalanceAfter = await ethers.provider.getBalance(anotherAccount.address);
      const lpBalanceAfter = await ethers.provider.getBalance(lpWallet.address);

      await assertBalances(market, dfiToken, {
        tokens: {
          [anotherAccount.address]: {
            10: "0",
            11: "0"
          },
          [lpWallet.address]: {
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

      expect(ethToFloatStr(lpBalanceAfter.sub(lpBalanceBefore)).substring(0, 5))
        .to.be.equal("87.03"); // strip gas fees

      expect(ethToFloatStr(userBalanceAfter.sub(userBalanceBefore)).substring(0, 5))
        .to.be.equal("27.86"); // strip gas fees

      const totalWithdrawn = userBalanceAfter.sub(userBalanceBefore)
        .add(lpBalanceAfter.sub(lpBalanceBefore));
      expect(ethToFloatStr(totalWithdrawn).substring(0, 7))
        .to.be.equal("114.897");

      // bank
      expect(await ethers.provider.getBalance(market.address))
        .to.be.equal(1); // 1 wei
    });
  });

  describe("Upgrades", function () {
    it("Should upgrade LPWallet directly", async function () {
      const { insurance } = await loadFixture(deployFlightInsuranceFixture);

      const FlightInsuranceV2 = await ethers.getContractFactory("FlightInsurance");
      const insuranceV2 = await upgrades.upgradeProxy(insurance.address, FlightInsuranceV2);
      await insuranceV2.deployed();
      expect(insuranceV2.address).to.be.equal(insurance.address);
    });
  });
});
