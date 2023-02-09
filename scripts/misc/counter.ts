import { ethers } from "hardhat";
import { GelatoRelay } from "@gelatonetwork/relay-sdk";

const relay = new GelatoRelay();

const GELATO_RELAY = "0xaBcC9b596420A9E9172FD5938620E265a0f9Df92";
const GELATO_RELAY_ERC2771 = "0xBf175FCC7086b4f9bd59d5EAE8eA67b8f940DE0d";

const GELATO_API_KEY = process.env.GELATO_API_KEY as string;

async function counterTest() {
  const [signer] = await ethers.getSigners();

  const Counter = await ethers.getContractFactory("CounterERC2771");
  const counter = await Counter.deploy(GELATO_RELAY_ERC2771);

  console.log("Counter deployed at", counter.address);

  const { data } = await counter
    .connect(signer)
    .populateTransaction
    .incrementContext();

  const { taskId } = await relay.sponsoredCallERC2771(
    {
      chainId: ethers.provider.network.chainId,
      target: counter.address,
      data: data!,
      user: await signer.getAddress(),
    },
    signer as any,
    GELATO_API_KEY
  );

  await new Promise((resolve) => setTimeout(resolve, 5000));

  console.log(await relay.getTaskStatus(taskId));
}

counterTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
