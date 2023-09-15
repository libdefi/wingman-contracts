import { ethers, upgrades, network } from "hardhat";
import { EventLog } from "ethers";
import { trustusRequest } from "./utils";
import { API_TRUSTUS_SIGNER, CHAINLINK_OPERATOR, LINK_TOKEN } from "./consts";

const TRUSTUS_REQUEST_ID = ethers.keccak256(ethers.toUtf8Bytes("createMarket(bool)"));

async function deploy() {
  const [signer] = await ethers.getSigners();

  const linkToken = LINK_TOKEN.polygon;
  const operator = CHAINLINK_OPERATOR.polygon;
  const jobId = ethers.toUtf8Bytes("22e206a56dd8483c82186b9016c253df"); // get flight status

  const DFIRegistry = await ethers.getContractFactory("DFIRegistry");
  const registryProxy = await upgrades.deployProxy(DFIRegistry, []);
  const registry = await ethers.getContractAt("DFIRegistry", registryProxy.target);
  console.log(`Registry: ${registry.target}`);

  const DFIToken = await ethers.getContractFactory("DFIToken");
  const tokenProxy = await upgrades.deployProxy(DFIToken, [registry.target]);
  const dfiToken = await ethers.getContractAt("DFIToken", tokenProxy.target);
  console.log(`Token: ${dfiToken.target}`);

  const LPWallet = await ethers.getContractFactory("LPWallet");
  const lpWalletProxy = await upgrades.deployProxy(LPWallet, [registry.target]);
  const lpWallet = await ethers.getContractAt("LPWallet", lpWalletProxy.target);
  console.log(`LPWallet: ${lpWallet.target}`);

  const FlightDelayMarketFactory = await ethers.getContractFactory("FlightDelayMarketFactory");
  const factory = await FlightDelayMarketFactory.deploy(registry.target);
  console.log(`Factory: ${factory.target}`);

  const FlightStatusOracle = await ethers.getContractFactory("FlightStatusOracle");
  const oracle = await FlightStatusOracle.deploy(linkToken, operator, jobId, registry.target);
  console.log(`Oracle: ${oracle.target}`);

  await Promise.all([
    registryProxy.waitForDeployment(),
    tokenProxy.waitForDeployment(),
    lpWalletProxy.waitForDeployment(),
    factory.deploymentTransaction()?.wait(),
    oracle.deploymentTransaction()?.wait(),
  ]);

  const FlightInsurance = await ethers.getContractFactory("FlightInsurance");
  const insuranceProxy = await upgrades.deployProxy(FlightInsurance, [registry.target]);
  const insurance = await ethers.getContractAt("FlightInsurance", insuranceProxy.target);
  console.log(`Flight insurance: ${insurance.target}`);

  await insuranceProxy.waitForDeployment();
  await insurance.setWallet(lpWallet.target).then((tx) => tx.wait());

  await insurance.setIsTrusted(signer.address, true).then((tx) => tx.wait());
  await insurance.setIsTrusted(API_TRUSTUS_SIGNER, true).then((tx) => tx.wait());

  const feeCollector = lpWallet.target;

  await registry
    .setAddresses(
      [1, 2, 3, 4, 5, 100],
      [
        factory.target,
        dfiToken.target,
        lpWallet.target,
        insurance.target,
        oracle.target,
        feeCollector,
      ],
    )
    .then((tx: any) => tx.wait());
}

async function start() {
  const [signer] = await ethers.getSigners();

  const oracle = "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
  const insurance = await ethers.getContractAt(
    "FlightInsurance",
    "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  );

  const lpWallet = await ethers.getContractAt(
    "LPWallet",
    "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  );

  const lpBalance = await ethers.provider.getBalance(lpWallet.target);
  if (lpBalance === 0n && network.name === "local") {
    console.log(
      `Sending 2 ETH to LP Wallet ${lpWallet.target}, since on local network and empty. Network: ${network.name}`,
    );
    await signer
      .sendTransaction({
        to: lpWallet.target,
        value: ethers.parseEther("2"),
      })
      .then((tx) => tx.wait());
  }

  const departureDate = 20251231;
  const cutoffTime = Math.ceil(Date.now() / 1000) + 24 * 3600;
  const closingTime = cutoffTime + 2.5 * 3600;
  const userBid = ethers.parseEther("0.01");
  const dfiBid = ethers.parseEther("0.1");

  const config = {
    mode: 0,
    oracle,
    cutoffTime,
    closingTime,
    minBid: userBid.toString(),
    maxBid: (userBid * 10n).toString(), // 0.1
    lpBid: dfiBid.toString(),
    fee: 50, // 1% = 100
    initP: 200, // 1% = 100
  };

  const flightInfo = {
    departureDate,
    flightName: "KL992",
    delay: 30,
  };

  const configArrValues = [
    config.cutoffTime,
    config.closingTime,

    config.lpBid,
    config.minBid,
    config.maxBid,
    config.initP,
    config.fee,
    config.mode,
    config.oracle,

    flightInfo.flightName,
    flightInfo.departureDate,
    flightInfo.delay,
  ];

  const configArrTypes = [
    "uint64",
    "uint64",

    "uint256",
    "uint256",
    "uint256",
    "uint16",
    "uint16",
    "uint8",
    "address",

    "string",
    "uint64",
    "uint32",
  ];

  const payload = ethers.AbiCoder.defaultAbiCoder().encode(configArrTypes, configArrValues);

  const deadline = Math.round(Date.now() / 1000) + 60;

  const insuranceAddress = await insurance.getAddress();
  const packet = await trustusRequest(
    TRUSTUS_REQUEST_ID,
    signer,
    insuranceAddress,
    payload,
    deadline,
  );

  const result = await insurance
    .createMarket(true, packet, { value: config.minBid })
    .then((tx) => tx.wait());

  console.log(`Market created: ${result?.hash}, parsing details...`);
  console.log(
    `Market ID & address to verify: ${await insurance.findMarket(
      flightInfo.flightName,
      flightInfo.departureDate,
      flightInfo.delay,
    )}`,
  );
  console.log(`Market logs parse: `);
  const event = result?.logs?.find(
    (e) => e instanceof EventLog && e.eventName === "FlightDelayMarketCreated",
  );
  console.log(`Market Created log: ${JSON.stringify(event)}`);
  const args = (event as EventLog).args;
  console.log(`Market ID: ${args.marketId}`);
  console.log(`Market unique ID: ${args.uniqueId}`);
  console.log(`Market creator: ${args.creator}`);
}

async function settle() {
  const departureDate = 20251231;
  const flightName = "KL992";
  const delay = 30;

  const insurance = await ethers.getContractAt(
    "FlightInsurance",
    "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  );
  const [mid, addr] = await insurance.findMarket(flightName, departureDate, delay);
  console.log(`Market ID: ${mid}`);
  console.log(`Market address: ${addr}`);

  const market = await ethers.getContractAt("FlightDelayMarket", addr);

  const should = await market.canBeSettled();
  console.log(`Should settle? - ${should}`);

  if (should) {
    await market.trySettle();
  }
}

async function claim() {
  const departureDate = 20251231;
  const flightName = "KL992";
  const delay = 30;

  const insurance = await ethers.getContractAt(
    "FlightInsurance",
    "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  );
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
