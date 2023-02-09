import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

export async function trustusRequest(
  request: string,
  signer: SignerWithAddress,
  verifyingContract: string,
  payload: string,
  deadline: number
) {
  const domain = {
    verifyingContract,
    name: "Trustus",
    version: "1",
    chainId: await signer.getChainId()
  };

  const types = {
    VerifyPacket: [
      { name: "request", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "payload", type: "bytes" },
    ],
  };

  const message = {
    deadline,
    payload,
    request,
  };

  const result = await signer._signTypedData(domain, types, message);
  const { r, v, s } = ethers.utils.splitSignature(result);

  const packet = {
    v, r, s,
    ...message
  };

  return packet;
}