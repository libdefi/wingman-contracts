import { CallWithERC2771Request, GelatoRelay } from "@gelatonetwork/relay-sdk";
import { ethers } from "hardhat";

async function resolveTask() {
  const relay = new GelatoRelay();

  const taskId = "0x6f35cbb379fa4e98bfb3241f2e483cac8ee541a083d2d9ce8fd3563bb01166f8";
  console.log(await relay.getTaskStatus(taskId));
}

async function call() {
  const INSURANCE_ADDRESS = "0x5053B459bc7D7b61Fb0537987792580961fd542A";

  const TARGET_MARKET_ADDR = "0xcf94c93cbe787b5dc29aa7247d2aa4a367f1ffec";

  const [signer] = await ethers.getSigners();
  const intf = await ethers.getContractAt("FlightInsurance", INSURANCE_ADDRESS);
  const insurance = new ethers.Contract(INSURANCE_ADDRESS, intf.interface, signer);
  const { data } = await insurance.registerParticipantSponsored.populateTransaction([
    TARGET_MARKET_ADDR,
    false,
  ]);

  const relay = new GelatoRelay();

  const network = await ethers.provider.getNetwork();

  //   const data = insurance.interface.encodeFunctionData("registerParticipantSponsored", [
  //     TARGET_MARKET_ADDR,
  //     false,
  //   ]);

  const request: CallWithERC2771Request = {
    chainId: network.chainId,
    target: INSURANCE_ADDRESS,
    data: data,
    user: await signer.getAddress(),
  };

  console.log(request);

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, signer.provider);

  const { taskId } = await relay.sponsoredCallERC2771(request, wallet as any, process.env.GELATO_KEY!);

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(await relay.getTaskStatus(taskId));
}

resolveTask().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
