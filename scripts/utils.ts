import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function trustusRequest(
  request: string,
  signer: HardhatEthersSigner,
  verifyingContract: string,
  payload: string,
  deadline: number
) {
  const domain = {
    verifyingContract,
    name: "Trustus",
    version: "1",
    chainId: (await signer.provider.getNetwork()).chainId,
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

  const result = await signer.signTypedData(domain, types, message);
  const { r, v, s } = ethers.Signature.from(result);

  const packet = {
    v, r, s,
    ...message
  };

  return packet;
}