import { ethers, upgrades } from "hardhat";
import { FlightInsurance } from "../typechain-types";
import { trustusRequest } from "./utils";
import { API_TRUSTUS_SIGNER, CHAINLINK_OPERATOR, LINK_TOKEN } from "./consts";

const TRUSTUS_REQUEST_ID = ethers.utils.keccak256(
  ethers.utils.toUtf8Bytes("createMarket(bool)")
);

async function deploy() {
  const [signer] = await ethers.getSigners();

  const linkToken = LINK_TOKEN.polygon;
  const operator = CHAINLINK_OPERATOR.polygon;
  const jobId = ethers.utils.toUtf8Bytes("22e206a56dd8483c82186b9016c253df"); // get flight status

  const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
  const registry = await upgrades.deployProxy(DFIRegistry, []);
  console.log(`Registry: ${registry.address}`);

  const DFIToken = await ethers.getContractFactory("DFIToken");
  const dfiToken = await upgrades.deployProxy(DFIToken, [registry.address]);
  console.log(`Token: ${dfiToken.address}`);

  const LPWallet = await ethers.getContractFactory("LPWallet");
  const lpWallet = await upgrades.deployProxy(LPWallet, [registry.address]);
  console.log(`LPWallet: ${lpWallet.address}`);

  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.address);
  console.log(`Factory: ${factory.address}`);

  const FlightStatusOracle = await ethers.getContractFactory("FlightStatusOracle");
  const oracle = await FlightStatusOracle.deploy(linkToken, operator, jobId, registry.address);
  console.log(`Oracle: ${oracle.address}`);

  await Promise.all([
    registry.deployed(),
    dfiToken.deployed(),
    lpWallet.deployed(),
    factory.deployed(),
    oracle.deployed()
  ]);

  const FlightInsurance = await ethers.getContractFactory("FlightInsurance");
  const insurance = await upgrades.deployProxy(FlightInsurance, [registry.address]) as FlightInsurance;
  console.log(`Flight insurance: ${insurance.address}`);

  await insurance.deployed();
  await insurance.setWallet(lpWallet.address).then((tx) => tx.wait());

  await insurance.setIsTrusted(signer.address, true).then((tx) => tx.wait());
  await insurance.setIsTrusted(API_TRUSTUS_SIGNER, true).then((tx) => tx.wait());

  const feeCollector = lpWallet.address;

  await registry.setAddresses(
    [1, 2, 3, 4, 5, 100],
    [factory.address, dfiToken.address, lpWallet.address, insurance.address, oracle.address, feeCollector]
  ).then((tx: any) => tx.wait());
}

async function start() {
  const [signer] = await ethers.getSigners();

  const oracle = "0x318693F60416cC758E667dEd0c179685286e1C86";
  const insurance = await ethers.getContractAt("FlightInsurance", "0x863D2EDDE72f67cB79A2E7D4842F15c020F05410");

  const cutoffTime = 1679673900;
  const departureDate = 20230324;
  const closingTime = 1679683500;
  const userBid = ethers.utils.parseEther("0.01");
  const dfiBid = ethers.utils.parseEther("0.1");

  const config = {
    mode: 0,
    oracle,
    cutoffTime,
    closingTime,
    minBid: userBid.toString(),
    maxBid: userBid.mul(10).toString(), // 0.1
    lpBid: dfiBid.toString(),
    fee: 50, // 1% = 100
    initP: 200, // 1% = 100
  };

  const flightInfo = {
    departureDate,
    flightName: "KL990",
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

  const payload = ethers.utils.defaultAbiCoder.encode(
    configArrTypes,
    configArrValues
  );

  const deadline = Math.round(Date.now()/1000) + 60;

  const packet = await trustusRequest(TRUSTUS_REQUEST_ID, signer, insurance.address, payload, deadline);

  await insurance
    .createMarket(true, packet, { value: config.minBid });
}

async function settle() {
  const departureDate = 20251231;
  const flightName = "U28436";
  const delay = 30;

  const insurance = await ethers.getContractAt("FlightInsurance", "0x15C9bAE8b96279303056b76984edd99Ef88CAA5B");
  const [mid, addr] = await insurance.findMarket(flightName, departureDate, delay);
  console.log(`Market ID: ${mid}`);
  console.log(`Market address: ${addr}`);

  const market = await ethers.getContractAt("FlightDelayMarket", addr);

  const should = await market.canBeSettled();
  console.log(`Should settle? - ${should}`);

  await market.trySettle();
}

async function claim() {
  const departureDate = 20251231;
  const flightName = "U28436";
  const delay = 30;

  const insurance = await ethers.getContractAt("FlightInsurance", "0x15C9bAE8b96279303056b76984edd99Ef88CAA5B");
  const [mid, addr] = await insurance.findMarket(flightName, departureDate, delay);
  console.log(`Market ID: ${mid}`);
  console.log(`Market address: ${addr}`);

  const market = await ethers.getContractAt("FlightDelayMarket", addr);

  await market.claim();
}

deploy().catch((error) => {
  console.error(error);
  process.exit(1);
});
