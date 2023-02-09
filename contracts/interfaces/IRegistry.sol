// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.17;

interface IRegistry {
    function getAddress(uint64 id) external view returns (address);

    function getId(address addr) external view returns (uint256);
}
